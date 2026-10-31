package http

import (
	"io"
	"net/http"

	"github.com/haozing/ploykit/authz"
	"github.com/haozing/ploykit/billing/adapters/workers"
	"github.com/haozing/ploykit/billing/app"
	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/platform/webx"
)

type Deps struct {
	Svc *app.BillingService

	WsMW func(http.Handler) http.Handler

	Authz *authz.Authorizer

	Usage workers.UsageReader
}

func (d Deps) guard(perm authz.Permission, next http.Handler) http.Handler {
	return authz.Require(d.Authz, perm)(next.ServeHTTP)
}

func Mount(mux webx.Router, d Deps) {
	wsMW := d.WsMW
	if wsMW == nil {
		wsMW = func(next http.Handler) http.Handler { return next }
	}

	mux.Handle("GET /api/billing/subscription", wsMW(d.guard("billing:read", http.HandlerFunc(d.getSubscription))))
	mux.Handle("GET /api/billing/usage-preview", wsMW(d.guard("billing:read", http.HandlerFunc(d.usagePreview))))
	mux.Handle("POST /api/billing/checkout", wsMW(d.guard("billing:manage", http.HandlerFunc(d.createCheckout))))
	mux.Handle("POST /api/billing/orders/{id}/cancel", wsMW(d.guard("billing:manage", http.HandlerFunc(d.cancelOrder))))
	mux.Handle("POST /api/billing/subscription/cancel", wsMW(d.guard("billing:manage", http.HandlerFunc(d.cancelSubscription))))

	mux.HandleFunc("GET /api/billing/plans", d.listPlans)

	mux.HandleFunc("POST /webhooks/billing/{channel}", d.handleWebhook)
}

// AdminDeps mounts the operator-facing billing endpoints. Guard is the
// platform-admin middleware — pass adminhttp.PlatformAdminGuard() (products
// mount their own admin-facing endpoints through it instead of hand-written
// closures; billing cannot import admin, so the guard is injected). A nil
// Guard panics: an unguarded admin route is a security hole, not a degraded
// feature (same discipline as settingshttp.AdminDeps).
type AdminDeps struct {
	Svc *app.BillingService

	Guard func(http.Handler) http.Handler
}

func MountAdmin(mux webx.Router, d AdminDeps) {
	if d.Guard == nil {
		panic("billing: AdminDeps.Guard is required (platform admin closure, e.g. adminhttp.PlatformAdminGuard())")
	}
	// LC-4 operator queue: user cancel requests that need a human on the
	// channel side (no canceller API) or are waiting out the paid period.
	mux.Handle("GET /api/admin/billing/cancel-requests", d.Guard(http.HandlerFunc(d.listCancelRequests)))
}

func (d AdminDeps) listCancelRequests(w http.ResponseWriter, r *http.Request) {
	items, err := d.Svc.ListCancelRequests(r.Context(), 0)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (d Deps) listPlans(w http.ResponseWriter, r *http.Request) {
	plans, err := d.Svc.ListPlanViews(r.Context())
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, plans)
}

func (d Deps) getSubscription(w http.ResponseWriter, r *http.Request) {
	p := webx.PrincipalFromRequest(r)
	if p == nil || p.WorkspaceID == "" {
		webx.ErrValidation(w, "workspace context required")
		return
	}
	plan, orders, err := d.Svc.GetSubscription(r.Context(), p.WorkspaceID)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	// R5 cancel-state triple (cancel_requested_at / renews_at / cancel_timing):
	// the framework data source for account-settings cancel UIs. Assembled
	// after plan/orders so a snapshot failure cannot half-answer — and the
	// 409-free shapes (free workspace, no subscription) render as nulls.
	snap, err := d.Svc.GetCancelSnapshot(r.Context(), p.WorkspaceID)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{
		"plan_code":           plan,
		"orders":              orders,
		"cancel_requested_at": snap.CancelRequestedAt,
		"renews_at":           snap.RenewsAt,
		"cancel_timing":       snap.CancelTiming,
	})
}

func (d Deps) usagePreview(w http.ResponseWriter, r *http.Request) {
	p := webx.PrincipalFromRequest(r)
	if p == nil || p.WorkspaceID == "" {
		webx.ErrValidation(w, "workspace context required")
		return
	}
	if d.Usage == nil {
		webx.ErrValidation(w, "usage reader not configured")
		return
	}
	preview, err := d.Svc.UsagePreview(r.Context(), p.WorkspaceID, d.Usage)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, preview)
}

func (d Deps) createCheckout(w http.ResponseWriter, r *http.Request) {
	p := webx.PrincipalFromRequest(r)
	if p == nil || p.WorkspaceID == "" {
		webx.ErrValidation(w, "workspace context required")
		return
	}
	var req struct {
		PlanCode string `json:"plan_code"`
		Interval string `json:"interval"`
		Channel  string `json:"channel"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	session, err := d.Svc.CreateCheckout(r.Context(), p, p.WorkspaceID, req.PlanCode, domain.BillingInterval(req.Interval), req.Channel)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusCreated, session)
}

func (d Deps) cancelOrder(w http.ResponseWriter, r *http.Request) {
	p := webx.PrincipalFromRequest(r)
	if p == nil || p.WorkspaceID == "" {
		webx.ErrValidation(w, "workspace context required")
		return
	}
	if err := d.Svc.CancelPendingOrder(r.Context(), p, r.PathValue("id")); err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// cancelSubscription is the LC-4 user self-serve cancel: same medium and
// difficulty as signup (CA ARL / AB 2863). Every accepted outcome answers 200
// with {ok:true, outcome} — operator_pending is an ACCEPTED request that
// needs a human on the channel side, not a client error.
func (d Deps) cancelSubscription(w http.ResponseWriter, r *http.Request) {
	p := webx.PrincipalFromRequest(r)
	if p == nil || p.WorkspaceID == "" {
		webx.ErrValidation(w, "workspace context required")
		return
	}
	outcome, err := d.Svc.UserCancelSubscription(r.Context(), p, p.WorkspaceID)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "outcome": outcome})
}

func (d Deps) handleWebhook(w http.ResponseWriter, r *http.Request) {
	channel := r.PathValue("channel")

	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		webx.ErrValidation(w, "failed to read body")
		return
	}

	header := make(map[string][]string, len(r.Header))
	for k, v := range r.Header {
		header[k] = v
	}

	if err := d.Svc.HandleWebhook(r.Context(), channel, app.WebhookRequest{Header: header, Body: body}); err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]string{"status": "received"})
}
