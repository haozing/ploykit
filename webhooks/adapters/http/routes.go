package http

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/haozing/ploykit/authz"
	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/webhooks/app"
)

type MemberLookup func(ctx context.Context, workspaceID, userID string) (role string, member bool, err error)

type Deps struct {
	Service     *app.WebhookService
	MemberCheck MemberLookup
	Log         *slog.Logger

	Authz *authz.Authorizer
}

func (d Deps) errLog(w http.ResponseWriter, r *http.Request, err error) {
	if d.Log != nil {
		d.Log.Error("webhooks handler", "path", r.URL.Path, "err", err)
	}
	webx.ErrInternal(w)
}

func (d Deps) fail(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, app.ErrNotFound) {
		webx.ErrNotFound(w, "webhook subscription or delivery not found")
		return
	}
	var we *webx.Error
	if errors.As(err, &we) {
		if d.Log != nil {
			d.Log.Warn("webhooks handler rejected", "path", r.URL.Path, "err", err)
		}
		webx.WriteError(w, we.Status, we.Code, we.Message, nil)
		return
	}
	d.errLog(w, r, err)
}

func Mount(mux webx.Router, d Deps) {
	mux.HandleFunc("GET /api/workspaces/{workspaceId}/webhooks/events", d.member(d.handleEvents))
	mux.HandleFunc("GET /api/workspaces/{workspaceId}/webhooks/deliveries", d.member(d.handleDeliveries))
	mux.HandleFunc("POST /api/workspaces/{workspaceId}/webhooks/deliveries/{deliveryId}/redeliver", d.admin(d.handleRedeliver))
	mux.HandleFunc("POST /api/workspaces/{workspaceId}/webhooks/subscriptions", d.admin(d.handleCreate))
	mux.HandleFunc("GET /api/workspaces/{workspaceId}/webhooks/subscriptions", d.member(d.handleList))
	mux.HandleFunc("POST /api/workspaces/{workspaceId}/webhooks/subscriptions/{subscriptionId}/ping", d.admin(d.handlePing))
	mux.HandleFunc("POST /api/workspaces/{workspaceId}/webhooks/subscriptions/{subscriptionId}/rotate-secret", d.admin(d.handleRotateSecret))
	mux.HandleFunc("PATCH /api/workspaces/{workspaceId}/webhooks/subscriptions/{subscriptionId}", d.admin(d.handleToggleActive))
	mux.HandleFunc("DELETE /api/workspaces/{workspaceId}/webhooks/subscriptions/{subscriptionId}", d.admin(d.handleDelete))
}

func (d Deps) member(fn func(w http.ResponseWriter, r *http.Request, p *webx.Principal)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		p := webx.PrincipalFromRequest(r)
		if p == nil {
			webx.ErrUnauthenticated(w, "authentication required")
			return
		}
		ws := r.PathValue("workspaceId")
		role, ok, err := d.MemberCheck(r.Context(), ws, p.UserID)
		if err != nil || !ok {
			webx.ErrForbidden(w, "workspace membership required")
			return
		}
		p.WorkspaceID, p.Role = ws, role
		if !d.canRead(p) {
			webx.ErrForbidden(w, "webhooks:read permission required")
			return
		}
		fn(w, r, p)
	}
}

func (d Deps) canRead(p *webx.Principal) bool {
	return d.Authz.Can(p, "webhooks:read")
}

func (d Deps) canManage(p *webx.Principal) bool {
	return d.Authz.Can(p, "webhooks:manage")
}

func (d Deps) admin(fn func(w http.ResponseWriter, r *http.Request, p *webx.Principal)) http.HandlerFunc {
	return d.member(func(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
		if !d.canManage(p) {
			webx.ErrForbidden(w, "webhooks:manage permission required")
			return
		}
		fn(w, r, p)
	})
}

func (d Deps) handleCreate(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	var in struct {
		URL         string   `json:"url"`
		Events      []string `json:"events"`
		Description string   `json:"description"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&in); err != nil {
		webx.ErrValidation(w, "invalid JSON body")
		return
	}
	if in.URL == "" || len(in.Events) == 0 {
		webx.ErrValidation(w, "url and events are required")
		return
	}
	sub, secret, err := d.Service.CreateSubscription(r.Context(), p.WorkspaceID, in.URL, in.Description, in.Events)
	if err != nil {

		d.fail(w, r, err)
		return
	}

	webx.WriteJSON(w, http.StatusCreated, map[string]any{"subscription": sub, "secret": secret})
}

func (d Deps) handleList(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	subs, err := d.Service.ListSubscriptions(r.Context(), p.WorkspaceID)
	if err != nil {
		d.errLog(w, r, err)
		return
	}
	if subs == nil {
		subs = []app.Subscription{}
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{"items": subs})
}

func (d Deps) handleDelete(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if err := d.Service.DeleteSubscription(r.Context(), p.WorkspaceID, r.PathValue("subscriptionId")); err != nil {

		d.fail(w, r, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (d Deps) handleToggleActive(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	var in struct {
		IsActive *bool `json:"is_active"`
	}
	if !webx.DecodeJSON(w, r, &in) {
		return
	}
	if in.IsActive == nil {
		webx.ErrValidation(w, "is_active is required")
		return
	}
	if err := d.Service.SetSubscriptionActive(r.Context(), p.WorkspaceID, r.PathValue("subscriptionId"), *in.IsActive); err != nil {
		d.fail(w, r, err)
		return
	}
	sub, ok, err := d.Service.GetSubscription(r.Context(), p.WorkspaceID, r.PathValue("subscriptionId"))
	if err != nil {

		d.errLog(w, r, err)
		return
	}
	if !ok {
		d.fail(w, r, app.ErrNotFound)
		return
	}
	webx.WriteJSON(w, http.StatusOK, sub)
}

func (d Deps) handlePing(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if err := d.Service.Ping(r.Context(), p.WorkspaceID, r.PathValue("subscriptionId")); err != nil {
		d.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (d Deps) handleRotateSecret(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	secret, err := d.Service.RotateSecret(r.Context(), p.WorkspaceID, r.PathValue("subscriptionId"))
	if err != nil {
		d.fail(w, r, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{"secret": secret})
}

func (d Deps) handleRedeliver(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	dl, err := d.Service.Redeliver(r.Context(), p.WorkspaceID, r.PathValue("deliveryId"))
	if err != nil {
		d.fail(w, r, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, dl)
}

func (d Deps) handleDeliveries(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	items, err := d.Service.ListDeliveries(r.Context(), p.WorkspaceID, limit)
	if err != nil {
		d.errLog(w, r, err)
		return
	}
	if items == nil {
		items = []app.Delivery{}
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (d Deps) handleEvents(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	types := d.Service.Catalog().List()
	out := make([]map[string]string, 0, len(types))
	for t, desc := range types {
		out = append(out, map[string]string{"type": t, "description": desc})
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{"items": out})
}
