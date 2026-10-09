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

func Mount(mux *http.ServeMux, d Deps) {
	wsMW := d.WsMW
	if wsMW == nil {
		wsMW = func(next http.Handler) http.Handler { return next }
	}

	mux.Handle("GET /api/billing/subscription", wsMW(d.guard("billing:read", http.HandlerFunc(d.getSubscription))))
	mux.Handle("GET /api/billing/usage-preview", wsMW(d.guard("billing:read", http.HandlerFunc(d.usagePreview))))
	mux.Handle("POST /api/billing/checkout", wsMW(d.guard("billing:manage", http.HandlerFunc(d.createCheckout))))
	mux.Handle("POST /api/billing/orders/{id}/cancel", wsMW(d.guard("billing:manage", http.HandlerFunc(d.cancelOrder))))

	mux.HandleFunc("GET /api/billing/plans", d.listPlans)

	mux.HandleFunc("POST /webhooks/billing/{channel}", d.handleWebhook)
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
	webx.WriteJSON(w, http.StatusOK, map[string]any{
		"plan_code": plan,
		"orders":    orders,
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
