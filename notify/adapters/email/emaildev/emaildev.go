package emaildev

import (
	"context"
	"log/slog"
)

type Sender struct {
	Log *slog.Logger
}

func New() *Sender { return &Sender{Log: slog.Default()} }

func (s *Sender) SendLoginCode(_ context.Context, to, code string) error {
	s.Log.Info("[emaildev] login code", "to", to, "code", code)
	return nil
}

func (s *Sender) SendInvite(_ context.Context, to, workspaceName, invitationID string) error {
	s.Log.Info("[emaildev] workspace invitation", "to", to, "workspace", workspaceName, "invitation_id", invitationID)
	return nil
}

func (s *Sender) SendPasswordReset(_ context.Context, to, link string) error {
	s.Log.Info("[emaildev] password reset", "to", to, "link", link)
	return nil
}

func (s *Sender) SendEmailVerification(_ context.Context, to, link string) error {
	s.Log.Info("[emaildev] email verification", "to", to, "link", link)
	return nil
}

func (s *Sender) Send(_ context.Context, to, subject, body string) error {
	s.Log.Info("[emaildev] email", "to", to, "subject", subject, "body_len", len(body))
	return nil
}
