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

	initErr error
}

func New(cfg Config, log *slog.Logger) *Sender {
	if log == nil {
		log = slog.Default()
	}
	s := &Sender{cfg: cfg, log: log}
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
		return s
	}
	s.client = c
	return s
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
	return s.send(ctx, to, "你的登录验证码", "验证码："+code+"\n\n若非本人操作，请忽略本邮件。")
}

func (s *Sender) SendInvite(ctx context.Context, to, workspaceName, invitationID string) error {
	return s.send(ctx, to, "工作区邀请", "你被邀请加入工作区「"+workspaceName+"」。\n\n邀请标识："+invitationID)
}

func (s *Sender) Send(ctx context.Context, to, subject, body string) error {
	return s.send(ctx, to, subject, body)
}

func (s *Sender) SendPasswordReset(ctx context.Context, to, link string) error {
	return s.send(ctx, to, "重置你的密码",
		"点击以下链接重置密码（有效期有限；若非本人操作，请忽略本邮件）：\n"+link)
}

func (s *Sender) SendEmailVerification(ctx context.Context, to, link string) error {
	return s.send(ctx, to, "验证你的邮箱",
		"点击以下链接完成邮箱验证：\n"+link)
}
