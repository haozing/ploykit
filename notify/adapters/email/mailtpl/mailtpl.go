// Package mailtpl is the email copy set shared by every email adapter
// (smtp, resend) — one Templates value drives every channel, so a product
// switching or stacking channels keeps a single source of copy (shuijing
// field report, 2026-10-25: the product had to re-render framework templates
// product-side just to give its Resend channel the same wording as SMTP).
//
// The type surface lived in the smtp package first; smtp re-exports it as
// type aliases, so notifysmtp.Templates and mailtpl.Templates are the same
// type and existing code keeps compiling.
package mailtpl

import (
	"bytes"
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
// wants and passes it to the adapter's NewWithTemplates.
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
// from the pre-template smtp sender (back-compat contract of the zero-value
// Templates — guarded by TestZeroValueMatchesLegacyCopy).
const (
	LoginCodeSubjectDefault = "你的登录验证码"
	LoginCodeBodyDefault    = "验证码：{{.Code}}\n\n若非本人操作，请忽略本邮件。"

	InviteSubjectDefault = "工作区邀请"
	InviteBodyDefault    = "你被邀请加入工作区「{{.Workspace}}」。\n\n邀请标识：{{.InvitationID}}"

	PasswordResetSubjectDefault = "重置你的密码"
	PasswordResetBodyDefault    = "点击以下链接重置密码（有效期有限；若非本人操作，请忽略本邮件）：\n{{.Link}}"

	EmailVerificationSubjectDefault = "验证你的邮箱"
	EmailVerificationBodyDefault    = "点击以下链接完成邮箱验证：\n{{.Link}}"
)

// Compiled holds the eight parsed templates produced once at construction;
// send methods only execute them.
type Compiled struct {
	LoginCodeSubject         *template.Template
	LoginCodeBody            *template.Template
	InviteSubject            *template.Template
	InviteBody               *template.Template
	PasswordResetSubject     *template.Template
	PasswordResetBody        *template.Template
	EmailVerificationSubject *template.Template
	EmailVerificationBody    *template.Template
}

// Compile parses a Templates once. A parse failure fails construction
// (fail-fast in the adapter); empty pieces fall back to the built-in Chinese
// defaults.
func Compile(tpl Templates) (*Compiled, error) {
	c := &Compiled{}
	pieces := []struct {
		name     string
		src      string
		fallback string
		dst      **template.Template
	}{
		{"login_code.subject", tpl.LoginCode.Subject, LoginCodeSubjectDefault, &c.LoginCodeSubject},
		{"login_code.body", tpl.LoginCode.Body, LoginCodeBodyDefault, &c.LoginCodeBody},
		{"invite.subject", tpl.Invite.Subject, InviteSubjectDefault, &c.InviteSubject},
		{"invite.body", tpl.Invite.Body, InviteBodyDefault, &c.InviteBody},
		{"password_reset.subject", tpl.PasswordReset.Subject, PasswordResetSubjectDefault, &c.PasswordResetSubject},
		{"password_reset.body", tpl.PasswordReset.Body, PasswordResetBodyDefault, &c.PasswordResetBody},
		{"email_verification.subject", tpl.EmailVerification.Subject, EmailVerificationSubjectDefault, &c.EmailVerificationSubject},
		{"email_verification.body", tpl.EmailVerification.Body, EmailVerificationBodyDefault, &c.EmailVerificationBody},
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

// Render executes one compiled piece. A render failure surfaces before any
// network activity in the adapters.
func Render(t *template.Template, data any) (string, error) {
	var buf bytes.Buffer
	if err := t.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("render %s: %w", t.Name(), err)
	}
	return buf.String(), nil
}
