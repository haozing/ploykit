// Package resend sends email through the Resend HTTP API
// (https://api.resend.com). It exists next to the SMTP adapter because the
// two channels fail differently in the field (shuijing field report,
// 2026-10-25): HTTP sidesteps outbound SMTP port blocks (25/465/587 are
// commonly firewalled on cloud/home networks), returns structured error
// codes (APIError.Name distinguishes "key invalid" from "recipient refused"),
// and is the prerequisite for the email.* webhook event family.
//
// It speaks the REST API directly with net/http instead of pulling the
// resend-go SDK: the send path is one endpoint and one JSON shape, and the
// framework does not take single-use dependencies for 30 lines of calls
// (same ruling as webx.SvixVerify). Note the SDK gap this avoids too: Go's
// resend-go v2 has no Receiving API — consumers that need inbound forwarding
// read GET /emails/receiving/{id} as raw REST either way.
package resend

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"text/template"
	"time"

	"github.com/haozing/ploykit/notify/adapters/email/mailtpl"
)

// DefaultEndpoint is the Resend API root. Config.Endpoint overrides it —
// that is how the hermetic tests point the sender at an httptest server.
const DefaultEndpoint = "https://api.resend.com"

// DefaultSendTimeout mirrors the SMTP adapter's cap. See the Sender doc
// comment for the context contract.
const DefaultSendTimeout = 30 * time.Second

type Config struct {
	APIKey string
	From   string

	// Endpoint defaults to DefaultEndpoint. Test seam, not a product knob.
	Endpoint string

	// HTTPClient overrides the transport (nil = a default client). The
	// per-send deadline comes from SendTimeout via ctx, so a client-level
	// Timeout is unnecessary.
	HTTPClient *http.Client

	// SendTimeout caps each send (zero = DefaultSendTimeout).
	SendTimeout time.Duration
}

// APIError is a non-2xx Resend response. Name is the API's machine-readable
// error identifier (missing_api_key, invalid_from, validation_failure,
// rate_limit_exceeded, application_error …) — the reason to prefer this
// channel over SMTP, whose failures are free-form relay text.
type APIError struct {
	Status  int
	Name    string
	Message string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("resend: %s: %s (HTTP %d)", e.Name, e.Message, e.Status)
}

// Sender sends templated email through the Resend HTTP API. Same context
// contract as the SMTP adapter: every send method DETACHES from the caller's
// cancellation/deadline (an HTTP request timeout must not kill an in-flight
// login-code send) and keeps only the ctx values, under its own timeout
// (Config.SendTimeout, default 30s).
type Sender struct {
	cfg         Config
	log         *slog.Logger
	hc          *http.Client
	tpl         *mailtpl.Compiled
	sendTimeout time.Duration
}

func New(cfg Config, log *slog.Logger) *Sender {
	// Built-in defaults always parse (mailtpl contract), so this error is
	// impossible in practice.
	s, _ := NewWithTemplates(cfg, mailtpl.Templates{}, log)
	return s
}

// NewWithTemplates builds a Sender with a custom copy set (shared with the
// other email adapters through mailtpl). A parse failure fails construction.
func NewWithTemplates(cfg Config, tpl mailtpl.Templates, log *slog.Logger) (*Sender, error) {
	compiled, err := mailtpl.Compile(tpl)
	if err != nil {
		return nil, fmt.Errorf("resend templates: %w", err)
	}
	if log == nil {
		log = slog.Default()
	}
	if cfg.Endpoint == "" {
		cfg.Endpoint = DefaultEndpoint
	}
	hc := cfg.HTTPClient
	if hc == nil {
		hc = &http.Client{}
	}
	timeout := cfg.SendTimeout
	if timeout <= 0 {
		timeout = DefaultSendTimeout
	}
	return &Sender{cfg: cfg, log: log, hc: hc, tpl: compiled, sendTimeout: timeout}, nil
}

type sendRequest struct {
	From    string   `json:"from"`
	To      []string `json:"to"`
	Subject string   `json:"subject"`
	Text    string   `json:"text"`
}

var errNoAPIKey = errors.New("resend: no API key configured")
var errNoFrom = errors.New("resend: no from address configured")

func (s *Sender) send(ctx context.Context, to, subject, body string) error {
	if s.cfg.APIKey == "" {
		return errNoAPIKey
	}
	if s.cfg.From == "" {
		return errNoFrom
	}
	payload, err := json.Marshal(sendRequest{From: s.cfg.From, To: []string{to}, Subject: subject, Text: body})
	if err != nil {
		return fmt.Errorf("resend marshal: %w", err)
	}
	// Detach from the caller's cancellation/deadline, keep its values, cap
	// with the sender's own timeout — see the Sender doc comment.
	sendCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), s.sendTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(sendCtx, http.MethodPost, strings.TrimSuffix(s.cfg.Endpoint, "/")+"/emails", bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("resend request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+s.cfg.APIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.hc.Do(req)
	if err != nil {
		s.log.Error("resend send failed", "to", to, "err", err)
		return fmt.Errorf("resend send to %s: %w", to, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return s.apiError(resp)
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 8192))
	return nil
}

// apiError converts a non-2xx body into an APIError. The error envelope is
// {"name": "...", "message": "..."}; anything else degrades to name
// "http_error" with a truncated body snippet.
func (s *Sender) apiError(resp *http.Response) error {
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	var env struct {
		Name    string `json:"name"`
		Message string `json:"message"`
	}
	if json.Unmarshal(raw, &env) == nil && env.Name != "" {
		return &APIError{Status: resp.StatusCode, Name: env.Name, Message: env.Message}
	}
	snippet := strings.TrimSpace(string(raw))
	if len(snippet) > 200 {
		snippet = snippet[:200]
	}
	return &APIError{Status: resp.StatusCode, Name: "http_error", Message: snippet}
}

func (s *Sender) SendLoginCode(ctx context.Context, to, code string) error {
	return s.renderAndSend(ctx, to, s.tpl.LoginCodeSubject, s.tpl.LoginCodeBody, mailtpl.LoginCodeData{Code: code})
}

func (s *Sender) SendInvite(ctx context.Context, to, workspaceName, invitationID string) error {
	return s.renderAndSend(ctx, to, s.tpl.InviteSubject, s.tpl.InviteBody, mailtpl.InviteData{Workspace: workspaceName, InvitationID: invitationID})
}

func (s *Sender) Send(ctx context.Context, to, subject, body string) error {
	return s.send(ctx, to, subject, body)
}

func (s *Sender) SendPasswordReset(ctx context.Context, to, link string) error {
	return s.renderAndSend(ctx, to, s.tpl.PasswordResetSubject, s.tpl.PasswordResetBody, mailtpl.LinkData{Link: link})
}

func (s *Sender) SendEmailVerification(ctx context.Context, to, link string) error {
	return s.renderAndSend(ctx, to, s.tpl.EmailVerificationSubject, s.tpl.EmailVerificationBody, mailtpl.LinkData{Link: link})
}

// renderAndSend renders one subject/body pair with its group's data and hands
// the result to send. A render failure returns before any network activity.
func (s *Sender) renderAndSend(ctx context.Context, to string, subjectTpl, bodyTpl *template.Template, data any) error {
	subject, err := mailtpl.Render(subjectTpl, data)
	if err != nil {
		s.log.Error("resend render subject failed", "template", subjectTpl.Name(), "to", to, "err", err)
		return err
	}
	body, err := mailtpl.Render(bodyTpl, data)
	if err != nil {
		s.log.Error("resend render body failed", "template", bodyTpl.Name(), "to", to, "err", err)
		return err
	}
	return s.send(ctx, to, subject, body)
}
