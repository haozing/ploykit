package notifyhttp

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/haozing/ploykit/notify/app"
	"github.com/haozing/ploykit/platform/webx"
)

type Deps struct {
	Svc *app.NotifyService
}

func Mount(mux *http.ServeMux, d Deps) {
	mux.HandleFunc("GET /api/notifications", webx.P(d.handleInbox))
	mux.HandleFunc("GET /api/notifications/badge", webx.P(d.handleBadge))
	mux.HandleFunc("POST /api/notifications/{id}/read", webx.P(d.handleMarkRead))
	mux.HandleFunc("POST /api/notifications/read-all", webx.P(d.handleMarkAllRead))
	mux.HandleFunc("POST /api/notifications/{id}/archive", webx.P(d.handleArchive))

	mux.HandleFunc("GET /api/notification-preferences", webx.P(d.handleListPrefs))
	mux.HandleFunc("PUT /api/notification-preferences/{type}", webx.P(d.handleUpsertPref))
}

func (d Deps) handleInbox(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	limit := 20
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil {
			webx.ErrValidation(w, "limit must be an integer between 1 and 100")
			return
		}
		if n > 100 {
			webx.ErrValidation(w, "limit must be an integer between 1 and 100")
			return
		}
		limit = n
	}
	list, err := d.Svc.Inbox(r.Context(), p.UserID, limit)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	if list == nil {
		list = []app.Notification{}
	}
	webx.WriteJSON(w, http.StatusOK, list)
}

func (d Deps) handleBadge(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	n, err := d.Svc.Badge(r.Context(), p.UserID)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]int{"count": n})
}

func (d Deps) handleMarkRead(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if err := d.Svc.MarkRead(r.Context(), p.UserID, r.PathValue("id")); err != nil {
		if errors.Is(err, app.ErrNotFound) {
			webx.ErrNotFound(w, "notification not found")
			return
		}
		webx.WriteErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (d Deps) handleMarkAllRead(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if err := d.Svc.MarkAllRead(r.Context(), p.UserID); err != nil {
		webx.WriteErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (d Deps) handleArchive(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if err := d.Svc.Archive(r.Context(), p.UserID, r.PathValue("id")); err != nil {
		if errors.Is(err, app.ErrNotFound) {
			webx.ErrNotFound(w, "notification not found")
			return
		}
		webx.WriteErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (d Deps) handleListPrefs(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	items, err := d.Svc.ListPreferences(r.Context(), p.UserID)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	if items == nil {
		items = []app.Preference{}
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (d Deps) handleUpsertPref(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	var req struct {
		EmailEnabled *bool `json:"email_enabled"`
		InAppEnabled *bool `json:"in_app_enabled"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	pref, err := d.Svc.UpsertPreference(r.Context(), p.UserID, r.PathValue("type"), req.EmailEnabled, req.InAppEnabled)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, pref)
}
