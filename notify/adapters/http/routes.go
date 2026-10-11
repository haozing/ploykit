package notifyhttp

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/google/uuid"

	"github.com/haozing/ploykit/notify/app"
	"github.com/haozing/ploykit/platform/webx"
)

type Deps struct {
	Svc *app.NotifyService
}

func Mount(mux webx.Router, d Deps) {
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
	ws, ok := workspaceFilter(w, r)
	if !ok {
		return
	}
	list, err := d.Svc.Inbox(r.Context(), p.UserID, ws, limit)
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
	ws, ok := workspaceFilter(w, r)
	if !ok {
		return
	}
	n, err := d.Svc.Badge(r.Context(), p.UserID, ws)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]int{"count": n})
}

// workspaceFilter reads the optional ?workspace_id= scoping parameter (F8):
// absent = the user's whole inbox (bell semantics); present = that workspace's
// scoped inbox. Malformed values are rejected up front — a bogus uuid would
// otherwise surface as an opaque query error.
func workspaceFilter(w http.ResponseWriter, r *http.Request) (string, bool) {
	raw := r.URL.Query().Get("workspace_id")
	if raw == "" {
		return "", true
	}
	if _, err := uuid.Parse(raw); err != nil {
		webx.ErrValidation(w, "workspace_id must be a uuid")
		return "", false
	}
	return raw, true
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
