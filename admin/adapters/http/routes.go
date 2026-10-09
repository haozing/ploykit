package http

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/haozing/ploykit/admin"
	"github.com/haozing/ploykit/admin/app"
	"github.com/haozing/ploykit/audit"
	"github.com/haozing/ploykit/platform/webx"
)

type SessionMinter interface {
	CreateSession(ctx context.Context, userID, ipHash, userAgent string, now time.Time) (token string, exp time.Time, err error)
	CreateImpersonatedSession(ctx context.Context, userID, impersonatedBy, ipHash, userAgent string, now time.Time) (token string, exp time.Time, err error)
}

type AuditRecorder interface {
	Record(ctx context.Context, workspaceID *string, p *webx.Principal, action, resourceType, resourceID string, meta map[string]any)
}

type Deps struct {
	Svc *app.AdminService

	Rec AuditRecorder

	Sessions SessionMinter

	AuthCfg *webx.AuthConfig

	Hooks *admin.Hooks
}

func Mount(mux *http.ServeMux, d Deps) {
	admin := d.requireAdmin

	mux.Handle("GET /api/admin/stats", admin(d.stats))
	mux.Handle("GET /api/admin/users", admin(d.listUsers))
	mux.Handle("PATCH /api/admin/users/{id}/status", admin(d.setUserStatus))
	mux.Handle("PATCH /api/admin/users/{id}/admin", admin(d.setAdmin))
	mux.Handle("POST /api/admin/users/{id}/impersonate", admin(d.impersonate))
	mux.Handle("GET /api/admin/workspaces", admin(d.listWorkspaces))
	mux.Handle("PATCH /api/admin/workspaces/{id}/plan", admin(d.changePlan))
	mux.Handle("GET /api/admin/audit", admin(d.listAudit))
	mux.Handle("GET /api/admin/audit/export.csv", admin(d.exportAudit))
	mux.Handle("GET /api/admin/analytics", admin(d.analyticsSummary))
}

func (d Deps) requireAdmin(next func(w http.ResponseWriter, r *http.Request, p *webx.Principal)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		p := webx.PrincipalFromRequest(r)
		if p == nil {
			webx.ErrUnauthenticated(w, "authentication required")
			return
		}
		if !p.IsPlatformAdmin {
			webx.ErrForbidden(w, "platform admin required")
			return
		}
		if p.ImpersonatedBy != "" {
			webx.ErrForbidden(w, "admin API is not available to impersonated sessions")
			return
		}
		if p.Source == webx.SourcePAT {
			webx.ErrForbidden(w, "personal access tokens are not accepted on the admin API; use a browser session")
			return
		}
		next(w, r, p)
	}
}

func (d Deps) stats(w http.ResponseWriter, r *http.Request, _ *webx.Principal) {
	s, err := d.Svc.Stats(r.Context())
	if err != nil {
		webx.ErrInternal(w)
		return
	}
	webx.WriteJSON(w, http.StatusOK, s)
}

func (d Deps) listUsers(w http.ResponseWriter, r *http.Request, _ *webx.Principal) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	size, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
	q := r.URL.Query().Get("q")
	status := r.URL.Query().Get("status")
	users, err := d.Svc.ListUsers(r.Context(), q, status, page, size)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	total, err := d.Svc.CountUsers(r.Context(), q, status)
	if err != nil {
		webx.ErrInternal(w)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{"items": users, "total": total})
}

func (d Deps) setUserStatus(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	var req struct {
		Status string `json:"status"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	var err error
	switch req.Status {
	case "disabled":
		err = d.Svc.DisableUser(r.Context(), p, r.PathValue("id"))
	case "active":
		err = d.Svc.EnableUser(r.Context(), p, r.PathValue("id"))
	default:
		webx.ErrValidation(w, "status must be active or disabled")
		return
	}
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (d Deps) setAdmin(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	var req struct {
		IsAdmin bool `json:"is_admin"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	if err := d.Svc.SetPlatformAdmin(r.Context(), p, r.PathValue("id"), req.IsAdmin); err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (d Deps) listWorkspaces(w http.ResponseWriter, r *http.Request, _ *webx.Principal) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	size, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
	q := r.URL.Query().Get("q")
	wss, err := d.Svc.ListWorkspaces(r.Context(), q, page, size)
	if err != nil {
		webx.ErrInternal(w)
		return
	}
	total, err := d.Svc.CountWorkspaces(r.Context(), q)
	if err != nil {
		webx.ErrInternal(w)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{"items": wss, "total": total})
}

func (d Deps) changePlan(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	var req struct {
		PlanCode string `json:"plan_code"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	if err := d.Svc.ChangePlan(r.Context(), p, r.PathValue("id"), req.PlanCode); err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func parseAuditQuery(r *http.Request) (audit.ListQuery, string) {
	q := audit.ListQuery{
		WorkspaceID:  r.URL.Query().Get("workspace"),
		ActorID:      r.URL.Query().Get("actor_id"),
		Action:       r.URL.Query().Get("action"),
		ResourceType: r.URL.Query().Get("resource_type"),
	}
	if q.WorkspaceID != "" {
		if _, err := uuid.Parse(q.WorkspaceID); err != nil {
			return q, "workspace must be a uuid"
		}
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	q.Limit, q.Offset = limit, offset
	for _, s := range []struct {
		name string
		dst  **time.Time
	}{
		{"from", &q.From},
		{"to", &q.To},
	} {
		if v := r.URL.Query().Get(s.name); v != "" {
			t, err := time.Parse(time.RFC3339, v)
			if err != nil {
				return q, s.name + " must be RFC3339 (e.g. 2026-10-05T00:00:00Z)"
			}
			*s.dst = &t
		}
	}
	return q, ""
}

const exportAuditMaxRows = 50000

func (d Deps) exportAudit(w http.ResponseWriter, r *http.Request, _ *webx.Principal) {
	q, msg := parseAuditQuery(r)
	if msg != "" {
		webx.ErrValidation(w, msg)
		return
	}
	actor := r.URL.Query().Get("actor")
	total, err := d.Svc.CountAudit(r.Context(), q, actor)
	if err != nil {
		webx.ErrInternal(w)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition",
		`attachment; filename="audit-admin-`+time.Now().UTC().Format("20060102")+`.csv"`)
	w.Header().Set("X-Export-Truncated", strconv.FormatBool(total > exportAuditMaxRows))
	truncated, err := d.Svc.ExportAuditCSV(r.Context(), q, actor, exportAuditMaxRows, w)
	if err != nil {

		slog.Error("admin audit export", "err", err, "truncated", truncated)
	}
}

func (d Deps) listAudit(w http.ResponseWriter, r *http.Request, _ *webx.Principal) {
	q, msg := parseAuditQuery(r)
	if msg != "" {
		webx.ErrValidation(w, msg)
		return
	}
	entries, total, err := d.Svc.QueryAudit(r.Context(), q, r.URL.Query().Get("actor"))
	if err != nil {
		webx.ErrInternal(w)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{"items": entries, "total": total})
}

func (d Deps) analyticsSummary(w http.ResponseWriter, r *http.Request, _ *webx.Principal) {

	days := 7
	if v := r.URL.Query().Get("days"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 || n > 90 {
			webx.ErrValidation(w, "days must be an integer between 1 and 90")
			return
		}
		days = n
	}
	since := time.Now().AddDate(0, 0, -days)
	summary, err := d.Svc.AnalyticsSummary(r.Context(), since)
	if err != nil {
		webx.ErrInternal(w)
		return
	}
	webx.WriteJSON(w, http.StatusOK, summary)
}

func realIP(r *http.Request) string {
	if xf := r.Header.Get("X-Forwarded-For"); xf != "" {
		if i := strings.IndexByte(xf, ','); i > 0 {
			return strings.TrimSpace(xf[:i])
		}
		return strings.TrimSpace(xf)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (d Deps) impersonate(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if d.Sessions == nil || d.AuthCfg == nil {
		webx.ErrUnavailable(w, "impersonation not wired")
		return
	}
	target, err := d.Svc.Impersonate(r.Context(), p, r.PathValue("id"))
	if err != nil {
		webx.WriteErr(w, err)
		return
	}

	ipHash := webx.HashIP(realIP(r), d.AuthCfg.IPHashSecret)
	token, exp, err := d.Sessions.CreateImpersonatedSession(r.Context(), target.ID, p.UserID, ipHash, r.UserAgent(), time.Now().UTC())
	if err != nil {
		webx.ErrInternal(w)
		return
	}
	d.AuthCfg.SetSessionCookie(w, token, exp)
	if d.Rec != nil {

		d.Rec.Record(r.Context(), nil, p, "admin.impersonate", "user", target.ID,
			map[string]any{"target_email": target.Email, "session_token_hash": webx.HashToken(token)})
	}
	if d.Hooks != nil && d.Hooks.OnImpersonation != nil {

		if err := d.Hooks.OnImpersonation(r.Context(), p.UserID, target.ID); err != nil {
			slog.Warn("admin impersonation hook", "err", err)
		}
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{"user": target})
}
