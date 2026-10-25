package smtp

import (
	"context"
	"text/template"

	"github.com/haozing/ploykit/notify/adapters/email/mailtpl"
)

// Copy machinery lives in mailtpl so every email adapter (resend …) shares
// one template set. The aliases below keep the historical notifysmtp.* names
// source-compatible: notifysmtp.Templates IS mailtpl.Templates.
type (
	Template          = mailtpl.Template
	Templates         = mailtpl.Templates
	LoginCodeData     = mailtpl.LoginCodeData
	InviteData        = mailtpl.InviteData
	LinkData          = mailtpl.LinkData
	compiledTemplates = mailtpl.Compiled
)

var (
	compileTemplates = mailtpl.Compile
	render           = mailtpl.Render
)

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
