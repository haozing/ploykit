package smtp

import (
	"context"
	"fmt"
	"log/slog"

	gomail "github.com/wneessen/go-mail"
)

type Config struct {
	Host     string
	Port     int
	Username string
	Password string
	From     string
}

type Sender struct {
	cfg    Config
	log    *slog.Logger
	client *gomail.Client
	tpl    *compiledTemplates

	initErr error
}

// New builds a Sender with the built-in Chinese copy (zero-value Templates).
func New(cfg Config, log *slog.Logger) *Sender {
	// The built-in defaults are compile-time constants that always parse
	// (guarded by TestNewWithTemplates_ZeroValueMatchesLegacyCopy), so the
	// error here is impossible in practice.
	s, _ := NewWithTemplates(cfg, Templates{}, log)
	return s
}

// NewWithTemplates builds a Sender with a custom copy set. All templates are
// parsed once here; a parse failure fails construction (fail-fast). Empty
// Subject/Body fields fall back to the built-in Chinese defaults.
func NewWithTemplates(cfg Config, tpl Templates, log *slog.Logger) (*Sender, error) {
	compiled, err := compileTemplates(tpl)
	if err != nil {
		return nil, fmt.Errorf("smtp templates: %w", err)
	}
	if log == nil {
		log = slog.Default()
	}
	s := &Sender{cfg: cfg, log: log, tpl: compiled}
	opts := []gomail.Option{
		gomail.WithPort(cfg.Port),
		gomail.WithTLSPolicy(gomail.TLSMandatory),
	}
	if cfg.Username != "" {
		opts = append(opts,
			gomail.WithSMTPAuth(gomail.SMTPAuthPlain),
			gomail.WithUsername(cfg.Username),
			gomail.WithPassword(cfg.Password),
		)
	}
	c, err := gomail.NewClient(cfg.Host, opts...)
	if err != nil {
		s.initErr = fmt.Errorf("smtp client init: %w", err)
		return s, nil
	}
	s.client = c
	return s, nil
}

func buildMessage(from, to, subject, body string) (*gomail.Msg, error) {
	msg := gomail.NewMsg()
	if err := msg.From(from); err != nil {
		return nil, fmt.Errorf("invalid from %q: %w", from, err)
	}
	if err := msg.AddTo(to); err != nil {
		return nil, fmt.Errorf("invalid to %q: %w", to, err)
	}
	msg.Subject(subject)
	msg.SetBodyString(gomail.TypeTextPlain, body)
	return msg, nil
}

func (s *Sender) send(ctx context.Context, to, subject, body string) error {
	if s.initErr != nil {
		return s.initErr
	}
	msg, err := buildMessage(s.cfg.From, to, subject, body)
	if err != nil {
		s.log.Error("smtp build message failed", "to", to, "err", err)
		return err
	}
	if err := s.client.DialAndSendWithContext(ctx, msg); err != nil {
		s.log.Error("smtp send failed", "to", to, "subject", subject, "err", err)
		return fmt.Errorf("smtp send to %s: %w", to, err)
	}
	return nil
}

func (s *Sender) SendLoginCode(ctx context.Context, to, code string) error {
	return s.renderAndSend(ctx, to, s.tpl.loginCodeSubject, s.tpl.loginCodeBody, LoginCodeData{Code: code})
}

func (s *Sender) SendInvite(ctx context.Context, to, workspaceName, invitationID string) error {
	return s.renderAndSend(ctx, to, s.tpl.inviteSubject, s.tpl.inviteBody, InviteData{Workspace: workspaceName, InvitationID: invitationID})
}

func (s *Sender) Send(ctx context.Context, to, subject, body string) error {
	return s.send(ctx, to, subject, body)
}

func (s *Sender) SendPasswordReset(ctx context.Context, to, link string) error {
	return s.renderAndSend(ctx, to, s.tpl.passwordResetSubject, s.tpl.passwordResetBody, LinkData{Link: link})
}

func (s *Sender) SendEmailVerification(ctx context.Context, to, link string) error {
	return s.renderAndSend(ctx, to, s.tpl.emailVerificationSubject, s.tpl.emailVerificationBody, LinkData{Link: link})
}
