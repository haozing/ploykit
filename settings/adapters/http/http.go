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
)

type Mailer interface {
	Send(ctx context.Context, to, subject, body string) error
}

type AdminDeps struct {
	Store *settings.Store

	Guard func(http.Handler) http.Handler

	Mailer Mailer

	MailMode string

	Log *slog.Logger
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
	webx.WriteJSON(w, http.StatusOK, map[string]any{
		"items":        items,
		"effective":    effective,
		"defaults":     settings.Defaults,
		"descriptions": settings.Descriptions,
	})
}

func (d AdminDeps) put(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	var body struct {
		Value string `json:"value"`
	}
	if !webx.DecodeJSON(w, r, &body) {
		return
	}
	if err := settings.Validate(key, body.Value); err != nil {
		webx.WriteError(w, http.StatusBadRequest, webx.CodeValidation, "invalid settings key/value", err.Error())
		return
	}
	value := settings.Normalize(key, body.Value)

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

	p := webx.PrincipalFromRequest(r)
	d.Log.Info("admin.setting_change",
		"key", key, "from", old, "to", value, "actor", actor,
		"user_id", pUserID(p), "request_id", webx.RequestID(r))

	webx.WriteJSON(w, http.StatusOK, map[string]string{"key": key, "value": value})
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
	if d.MailMode == MailModeDev {
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
	webx.WriteJSON(w, http.StatusOK, map[string]string{"mode": "smtp", "status": "sent"})
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
