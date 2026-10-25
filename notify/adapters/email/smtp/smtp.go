package smtp

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	gomail "github.com/wneessen/go-mail"
)

// DefaultSendTimeout bounds one SMTP conversation when the caller's context
// carries no deadline of its own. See Sender for the context contract.
const DefaultSendTimeout = 30 * time.Second

type Config struct {
	Host     string
	Port     int
	Username string
	Password string
	From     string

	// SendTimeout caps each send (zero = DefaultSendTimeout). Raise it for
	// slow relays; it exists so a hanging SMTP server cannot pin a goroutine
	// forever once the caller's deadline is deliberately ignored.
	SendTimeout time.Duration
}

// Sender sends templated email over SMTP. Context contract (shuijing field
// report, 2026-10-25): every send method DETACHES from the caller's
// cancellation and deadline — the ctx passed in by an HTTP handler carries the
// request timeout (typically 5s), and a slow SMTP relay used to get the login
// code killed mid-send: the mail lost AND the request failed. Sends keep only
// the ctx VALUES (request id, tenant values) and run under their own timeout
// (Config.SendTimeout, default 30s): better late than lost. Callers that need
// to bound a send should set Config.SendTimeout, not a request-scoped ctx.
type Sender struct {
	cfg    Config
	log    *slog.Logger
	client *gomail.Client
	tpl    *compiledTemplates

	sendTimeout time.Duration
	initErr     error
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
	s := &Sender{cfg: cfg, log: log, tpl: compiled, sendTimeout: cfg.SendTimeout}
	if s.sendTimeout <= 0 {
		s.sendTimeout = DefaultSendTimeout
	}
	opts := []gomail.Option{
		gomail.WithPort(cfg.Port),
		gomail.WithTLSPolicy(gomail.TLSMandatory),
		// The connection deadline for the phases go-mail bounds with its own
		// timer (dial + greeting read) instead of the ctx — both must agree
		// with SendTimeout, otherwise a hanging relay outlives the sender's
		// cap by the go-mail default (15s).
		gomail.WithTimeout(s.sendTimeout),
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
	// Detach from the caller's cancellation/deadline (request timeouts must
	// not kill an in-flight send), keep its values, and impose the sender's
	// own cap — see the Sender doc comment.
	sendCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), s.sendTimeout)
	defer cancel()
	if err := s.client.DialAndSendWithContext(sendCtx, msg); err != nil {
		s.log.Error("smtp send failed", "to", to, "subject", subject, "err", err)
		return fmt.Errorf("smtp send to %s: %w", to, err)
	}
	return nil
}

func (s *Sender) SendLoginCode(ctx context.Context, to, code string) error {
	return s.renderAndSend(ctx, to, s.tpl.LoginCodeSubject, s.tpl.LoginCodeBody, LoginCodeData{Code: code})
}

func (s *Sender) SendInvite(ctx context.Context, to, workspaceName, invitationID string) error {
	return s.renderAndSend(ctx, to, s.tpl.InviteSubject, s.tpl.InviteBody, InviteData{Workspace: workspaceName, InvitationID: invitationID})
}

func (s *Sender) Send(ctx context.Context, to, subject, body string) error {
	return s.send(ctx, to, subject, body)
}

func (s *Sender) SendPasswordReset(ctx context.Context, to, link string) error {
	return s.renderAndSend(ctx, to, s.tpl.PasswordResetSubject, s.tpl.PasswordResetBody, LinkData{Link: link})
}

func (s *Sender) SendEmailVerification(ctx context.Context, to, link string) error {
	return s.renderAndSend(ctx, to, s.tpl.EmailVerificationSubject, s.tpl.EmailVerificationBody, LinkData{Link: link})
}
