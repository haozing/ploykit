package settingshttp

import (
	"context"
	"log/slog"
	"net/http"
	"regexp"
	"strings"

	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/settings"
)

var emailRe = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

func emailOK(s string) bool { return len(s) <= 254 && emailRe.MatchString(s) }

const (
	MailModeSMTP = "smtp"

	MailModeDev = "dev"

	// MailModeResend labels the Resend HTTP email channel
	// (notify/adapters/email/resend) — the /config mail_mode value and the
	// admin status badge share it (shuijing already used the string).
	MailModeResend = "resend"
)

type Mailer interface {
	Send(ctx context.Context, to, subject, body string) error
}

type AdminDeps struct {
	Store *settings.Store

	Guard func(http.Handler) http.Handler

	Mailer Mailer

	// MailModeFn reports the active mail channel (MailModeDev / MailModeSMTP)
	// and is read per request so hot-swapped mailers stay truthful. Breaking
	// change vs the old static MailMode string. nil = not tracked: the list
	// response carries an empty "mail_mode" and testEmail takes the smtp
	// branch (same as the old empty-string default).
	MailModeFn func() string

	// OAuthInfo optionally reports the configured OAuth providers together
	// with their EXPECTED callback URLs (derived from the configured base
	// URL, for comparison against what is registered in the provider
	// console). The actual runtime callback is computed per-request from
	// Host + X-Forwarded-Proto, so reverse proxies must forward both. A nil
	// func omits the "oauth" field from the list response entirely
	// (silently degrade when unwired).
	OAuthInfo func() []OAuthProviderInfo

	Log *slog.Logger
}

// OAuthProviderInfo describes one OAuth provider for the admin status card.
type OAuthProviderInfo struct {
	Name        string `json:"name"`
	CallbackURL string `json:"callback_url"`
}

// mailMode resolves MailModeFn; "" means the integrator does not track it.
func (d AdminDeps) mailMode() string {
	if d.MailModeFn == nil {
		return ""
	}
	return d.MailModeFn()
}

func MountAdmin(mux webx.Router, d AdminDeps) {
	if d.Guard == nil {
		panic("settings: AdminDeps.Guard is required (platform admin closure)")
	}
	if d.Log == nil {
		d.Log = slog.Default()
	}
	g := d.Guard
	mux.Handle("GET /api/admin/settings", g(http.HandlerFunc(d.list)))
	mux.Handle("PUT /api/admin/settings/{key}", g(http.HandlerFunc(d.put)))
	mux.Handle("POST /api/admin/settings/test-email", g(http.HandlerFunc(d.testEmail)))
}

func (d AdminDeps) list(w http.ResponseWriter, r *http.Request) {
	items, err := d.Store.All(r.Context())
	if err != nil {
		d.Log.Error("settings list", "err", err)
		webx.ErrInternal(w)
		return
	}
	effective, err := d.Store.Effective(r.Context())
	if err != nil {
		d.Log.Error("settings effective", "err", err)
		webx.ErrInternal(w)
		return
	}
	// Both tables are masked: items may hold the sealed smtp_pass blob and
	// effective the decrypted value — neither may ever reach the client.
	// Masking and the merged defaults/descriptions are store-aware so
	// product-registered keys (settings.RegisterKeys) behave like built-ins.
	d.maskMap(items)
	d.maskMap(effective)
	resp := map[string]any{
		"items":        items,
		"effective":    effective,
		"defaults":     d.Store.DefaultsMap(),
		"descriptions": d.Store.Descriptions(),
		"mail_mode":    d.mailMode(),
	}
	if d.OAuthInfo != nil {
		resp["oauth"] = d.OAuthInfo()
	}
	webx.WriteJSON(w, http.StatusOK, resp)
}

// maskMap masks sensitive values in place. Empty stays empty (nothing to
// leak); anything else — plaintext or sealed blob — becomes MaskedValue.
// Store-level sensitivity so registered credential keys mask too.
func (d AdminDeps) maskMap(m map[string]string) {
	for k, v := range m {
		if d.Store.IsSensitive(k) && v != "" {
			m[k] = settings.MaskedValue
		}
	}
}

func (d AdminDeps) put(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	var body struct {
		Value string `json:"value"`
	}
	if !webx.DecodeJSON(w, r, &body) {
		return
	}
	// Mask echo = "unchanged": the UI round-trips the masked read-back, so a
	// submit of MaskedValue is acknowledged without touching the store (and
	// without requiring the sealer). Runs before Validate on purpose.
	if d.Store.IsSensitive(key) && body.Value == settings.MaskedValue {
		webx.WriteJSON(w, http.StatusOK, map[string]string{"key": key, "value": settings.MaskedValue})
		return
	}
	if err := d.Store.Validate(key, body.Value); err != nil {
		webx.WriteError(w, http.StatusBadRequest, webx.CodeValidation, "invalid settings key/value", err.Error())
		return
	}
	value := d.Store.Normalize(key, body.Value)

	old, _, err := d.Store.Get(r.Context(), key)
	if err != nil {
		d.Log.Error("settings get old", "key", key, "err", err)
		webx.ErrInternal(w)
		return
	}
	actor := actorOf(r)
	if err := d.Store.Set(r.Context(), key, value, actor); err != nil {
		d.Log.Error("settings set", "key", key, "err", err)
		webx.ErrInternal(w)
		return
	}

	// Sensitive keys never appear in the change log or the response body —
	// neither the new plaintext nor the previous stored (sealed) value.
	logFrom, logTo := old, value
	respValue := value
	if d.Store.IsSensitive(key) {
		logFrom, logTo = settings.MaskedValue, settings.MaskedValue
		respValue = settings.MaskedValue
	}
	p := webx.PrincipalFromRequest(r)
	d.Log.Info("admin.setting_change",
		"key", key, "from", logFrom, "to", logTo, "actor", actor,
		"user_id", pUserID(p), "request_id", webx.RequestID(r))

	webx.WriteJSON(w, http.StatusOK, map[string]string{"key": key, "value": respValue})
}

func (d AdminDeps) testEmail(w http.ResponseWriter, r *http.Request) {
	var body struct {
		To string `json:"to"`
	}
	if !webx.DecodeJSON(w, r, &body) {
		return
	}
	to := strings.TrimSpace(body.To)
	if !emailOK(to) {
		webx.ErrValidation(w, "to 必须是单个合法邮箱地址")
		return
	}
	if d.Mailer == nil {
		webx.WriteError(w, http.StatusServiceUnavailable, webx.CodeUnavailable, "mail channel not configured", nil)
		return
	}
	const subject = "MyProduct 测试邮件"
	const text = "这是一封来自管理控制台的测试邮件：若你收到它，说明邮件通道工作正常。"
	if d.mailMode() == MailModeDev {
		if err := d.Mailer.Send(r.Context(), to, subject, text); err != nil {
			d.Log.Error("test email (dev)", "to", to, "err", err)
			webx.ErrInternal(w)
			return
		}
		p := webx.PrincipalFromRequest(r)
		d.Log.Info("admin.setting_change",
			"key", "test-email", "to", to, "actor", actorOf(r), "user_id", pUserID(p), "request_id", webx.RequestID(r))
		webx.WriteJSON(w, http.StatusOK, map[string]string{
			"mode": "dev",
			"hint": "当前为开发邮件通道：邮件内容已打日志，请到后端日志查看，真实邮箱不会收到",
		})
		return
	}
	if err := d.Mailer.Send(r.Context(), to, subject, text); err != nil {
		d.Log.Error("test email", "to", to, "err", err)
		webx.WriteError(w, http.StatusBadGateway, "E_MAIL_SEND", "测试邮件发送失败", err.Error())
		return
	}
	p := webx.PrincipalFromRequest(r)
	d.Log.Info("admin.setting_change",
		"key", "test-email", "to", to, "actor", actorOf(r), "user_id", pUserID(p), "request_id", webx.RequestID(r))
	webx.WriteJSON(w, http.StatusOK, map[string]string{"mode": d.mailMode(), "status": "sent"})
}

func actorOf(r *http.Request) string {
	if p := webx.PrincipalFromRequest(r); p != nil {
		if p.Email != "" {
			return p.Email
		}
		return p.UserID
	}
	return "unknown"
}

func pUserID(p *webx.Principal) string {
	if p == nil {
		return ""
	}
	return p.UserID
}
