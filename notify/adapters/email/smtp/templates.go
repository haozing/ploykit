package smtp

import (
	"bytes"
	"context"
	"fmt"
	"text/template"
)

// Template is one renderable piece of email copy: a subject plus a plain-text
// body, both text/template sources. An empty Subject or Body means "use the
// built-in Chinese default for that piece", so the zero-value Templates
// reproduces the original hardcoded copy byte for byte.
type Template struct {
	Subject string
	Body    string
}

// Templates is the injectable copy set for the four templated send methods.
// Per-locale selection stays product-side: the product compiles the copy it
// wants and passes it to NewWithTemplates.
//
// Each group is executed with exactly the data its method carries:
//   - LoginCode:         LoginCodeData{Code}
//   - Invite:            InviteData{Workspace, InvitationID}
//   - PasswordReset:     LinkData{Link}
//   - EmailVerification: LinkData{Link}
//
// Referencing a field outside the group's data (e.g. {{.Link}} in a LoginCode
// body) fails the send at render time.
type Templates struct {
	LoginCode         Template
	Invite            Template
	PasswordReset     Template
	EmailVerification Template
}

// LoginCodeData is the data fed to the LoginCode templates.
type LoginCodeData struct {
	Code string
}

// InviteData is the data fed to the Invite templates. InvitationID is part of
// the default body ("邀请标识：…"), so it travels with the workspace name.
type InviteData struct {
	Workspace    string
	InvitationID string
}

// LinkData is the data fed to the PasswordReset and EmailVerification templates.
type LinkData struct {
	Link string
}

// Built-in defaults. Keep these byte-identical to the original hardcoded copy
// in the Send methods (back-compat contract of the zero-value Templates).
const (
	loginCodeSubjectDefault = "你的登录验证码"
	loginCodeBodyDefault    = "验证码：{{.Code}}\n\n若非本人操作，请忽略本邮件。"

	inviteSubjectDefault = "工作区邀请"
	inviteBodyDefault    = "你被邀请加入工作区「{{.Workspace}}」。\n\n邀请标识：{{.InvitationID}}"

	passwordResetSubjectDefault = "重置你的密码"
	passwordResetBodyDefault    = "点击以下链接重置密码（有效期有限；若非本人操作，请忽略本邮件）：\n{{.Link}}"

	emailVerificationSubjectDefault = "验证你的邮箱"
	emailVerificationBodyDefault    = "点击以下链接完成邮箱验证：\n{{.Link}}"
)

// compiledTemplates holds the eight parsed templates produced once at
// construction; send methods only execute them.
type compiledTemplates struct {
	loginCodeSubject         *template.Template
	loginCodeBody            *template.Template
	inviteSubject            *template.Template
	inviteBody               *template.Template
	passwordResetSubject     *template.Template
	passwordResetBody        *template.Template
	emailVerificationSubject *template.Template
	emailVerificationBody    *template.Template
}

func compileTemplates(tpl Templates) (*compiledTemplates, error) {
	c := &compiledTemplates{}
	pieces := []struct {
		name     string
		src      string
		fallback string
		dst      **template.Template
	}{
		{"login_code.subject", tpl.LoginCode.Subject, loginCodeSubjectDefault, &c.loginCodeSubject},
		{"login_code.body", tpl.LoginCode.Body, loginCodeBodyDefault, &c.loginCodeBody},
		{"invite.subject", tpl.Invite.Subject, inviteSubjectDefault, &c.inviteSubject},
		{"invite.body", tpl.Invite.Body, inviteBodyDefault, &c.inviteBody},
		{"password_reset.subject", tpl.PasswordReset.Subject, passwordResetSubjectDefault, &c.passwordResetSubject},
		{"password_reset.body", tpl.PasswordReset.Body, passwordResetBodyDefault, &c.passwordResetBody},
		{"email_verification.subject", tpl.EmailVerification.Subject, emailVerificationSubjectDefault, &c.emailVerificationSubject},
		{"email_verification.body", tpl.EmailVerification.Body, emailVerificationBodyDefault, &c.emailVerificationBody},
	}
	for _, p := range pieces {
		src := p.src
		if src == "" {
			src = p.fallback
		}
		t, perr := template.New(p.name).Parse(src)
		if perr != nil {
			return nil, fmt.Errorf("parse %s: %w", p.name, perr)
		}
		*p.dst = t
	}
	return c, nil
}

func render(t *template.Template, data any) (string, error) {
	var buf bytes.Buffer
	if err := t.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("render %s: %w", t.Name(), err)
	}
	return buf.String(), nil
}

// renderAndSend renders one subject/body pair with its group's data and hands
// the result to send. A render failure returns before any network activity.
func (s *Sender) renderAndSend(ctx context.Context, to string, subjectTpl, bodyTpl *template.Template, data any) error {
	subject, err := render(subjectTpl, data)
	if err != nil {
		s.log.Error("smtp render subject failed", "template", subjectTpl.Name(), "to", to, "err", err)
		return err
	}
	body, err := render(bodyTpl, data)
	if err != nil {
		s.log.Error("smtp render body failed", "template", bodyTpl.Name(), "to", to, "err", err)
		return err
	}
	return s.send(ctx, to, subject, body)
}
