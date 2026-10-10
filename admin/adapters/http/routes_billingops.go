package http

import (
	"net/http"
	"strconv"

	"github.com/google/uuid"

	"github.com/haozing/ploykit/admin/app"
	"github.com/haozing/ploykit/platform/webx"
)

type BillingOpsDeps struct {
	Svc *app.BillingOpsService
}

func (d BillingOpsDeps) mounted(next func(w http.ResponseWriter, r *http.Request, p *webx.Principal)) func(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if d.Svc != nil {
		return next
	}
	return func(w http.ResponseWriter, _ *http.Request, _ *webx.Principal) {
		webx.ErrUnavailable(w, "billing ops not wired")
	}
}

func MountBillingOps(mux webx.Router, d BillingOpsDeps) {
	admin := (&Deps{}).requireAdmin
	mux.Handle("GET /api/admin/plans", admin(d.mounted(d.listPlans)))
	mux.Handle("GET /api/admin/orders", admin(d.mounted(d.listOrders)))
	mux.Handle("DELETE /api/admin/orders/{id}", admin(d.mounted(d.cancelOrder)))

	mux.Handle("POST /api/admin/billing/orders/{id}/mark-paid", admin(d.mounted(d.markOrderPaid)))
	mux.Handle("GET /api/admin/payment-events", admin(d.mounted(d.listPaymentEvents)))
	mux.Handle("POST /api/admin/billing/run-expiry", admin(d.mounted(d.runExpiry)))
	mux.Handle("POST /api/admin/billing/run-overage", admin(d.mounted(d.runOverage)))
	mux.Handle("GET /api/admin/webhook-deliveries", admin(d.mounted(d.listWebhookDeliveries)))
	mux.Handle("POST /api/admin/webhook-deliveries/{id}/redeliver", admin(d.mounted(d.redeliverWebhook)))

	mux.Handle("GET /api/admin/billing/config", admin(d.mounted(d.billingConfig)))
	mux.Handle("POST /api/admin/billing/test-connection", admin(d.mounted(d.testChannelConnection)))
	mux.Handle("POST /api/admin/workspaces/{id}/cancel-subscription", admin(d.mounted(d.cancelSubscription)))
}

func wsFilterQ(r *http.Request) (ws, msg string) {
	ws = r.URL.Query().Get("workspace_id")
	if ws == "" {
		return "", ""
	}
	if _, err := uuid.Parse(ws); err != nil {
		return ws, "workspace_id must be a uuid"
	}
	return ws, ""
}

func pageQ(r *http.Request) (page, size int) {
	page, _ = strconv.Atoi(r.URL.Query().Get("page"))
	size, _ = strconv.Atoi(r.URL.Query().Get("page_size"))
	return page, size
}

func (d BillingOpsDeps) listPlans(w http.ResponseWriter, r *http.Request, _ *webx.Principal) {
	codes, err := d.Svc.ListPlans(r.Context())
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	views, err := d.Svc.ListPlanViews(r.Context())
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{"items": codes, "plans": views})
}

func (d BillingOpsDeps) listOrders(w http.ResponseWriter, r *http.Request, _ *webx.Principal) {
	ws, msg := wsFilterQ(r)
	if msg != "" {
		webx.ErrValidation(w, msg)
		return
	}
	page, size := pageQ(r)
	items, total, err := d.Svc.ListOrders(r.Context(), ws, r.URL.Query().Get("status"), page, size)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{"items": items, "total": total})
}

func (d BillingOpsDeps) cancelOrder(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if err := d.Svc.AdminCancelOrder(r.Context(), p, r.PathValue("id")); err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (d BillingOpsDeps) markOrderPaid(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if err := d.Svc.AdminMarkOrderPaid(r.Context(), p, r.PathValue("id")); err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (d BillingOpsDeps) listPaymentEvents(w http.ResponseWriter, r *http.Request, _ *webx.Principal) {
	ws, msg := wsFilterQ(r)
	if msg != "" {
		webx.ErrValidation(w, msg)
		return
	}
	page, size := pageQ(r)
	items, total, err := d.Svc.ListPaymentEvents(r.Context(), ws, page, size)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{"items": items, "total": total})
}

func (d BillingOpsDeps) runExpiry(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	n, err := d.Svc.RunExpiry(r.Context(), p)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{"expired": n})
}

func (d BillingOpsDeps) runOverage(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	n, err := d.Svc.RunOverage(r.Context(), p)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{"orders_created": n})
}

func (d BillingOpsDeps) listWebhookDeliveries(w http.ResponseWriter, r *http.Request, _ *webx.Principal) {
	ws, msg := wsFilterQ(r)
	if msg != "" {
		webx.ErrValidation(w, msg)
		return
	}
	page, size := pageQ(r)
	items, total, err := d.Svc.ListWebhookDeliveries(r.Context(), ws, r.URL.Query().Get("status"), page, size)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{"items": items, "total": total})
}

func (d BillingOpsDeps) redeliverWebhook(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	d2, err := d.Svc.AdminRedeliver(r.Context(), p, r.PathValue("id"))
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, d2)
}

func (d BillingOpsDeps) billingConfig(w http.ResponseWriter, r *http.Request, _ *webx.Principal) {
	cfg, err := d.Svc.BillingConfig(r.Context())
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, cfg)
}

func (d BillingOpsDeps) testChannelConnection(w http.ResponseWriter, r *http.Request, _ *webx.Principal) {
	var req struct {
		Channel string `json:"channel"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	if err := d.Svc.TestChannelConnection(r.Context(), req.Channel); err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (d BillingOpsDeps) cancelSubscription(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if err := d.Svc.AdminCancelSubscription(r.Context(), p, r.PathValue("id")); err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
