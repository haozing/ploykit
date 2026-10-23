package app

import (
	"context"

	"github.com/haozing/ploykit/platform/webx"
)

type BillingOpsService struct {
	*AdminService
	billing  BillingAdminOps
	webhooks WebhookAdminOps
}

func NewBillingOpsService(base *AdminService) *BillingOpsService {
	return &BillingOpsService{AdminService: base}
}

func (s *BillingOpsService) WithBillingOps(ops BillingAdminOps) *BillingOpsService {
	s.billing = ops
	return s
}

func (s *BillingOpsService) WithWebhookOps(ops WebhookAdminOps) *BillingOpsService {
	s.webhooks = ops
	return s
}

func billingPage(page, pageSize int) (limit, offset int) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	return pageSize, (page - 1) * pageSize
}

func validOrderStatusFilter(st string) bool {
	switch st {
	case "pending", "paid", "failed", "canceled", "refunded":
		return true
	}
	return false
}

func validDeliveryStatusFilter(st string) bool {
	switch st {
	case "pending", "delivered", "dead":
		return true
	}
	return false
}

func (s *BillingOpsService) ListOrders(ctx context.Context, workspaceID, status string, page, pageSize int) ([]AdminOrder, int, error) {
	if s.billing == nil {
		return nil, 0, errNotWired("billing ops")
	}
	if status != "" && !validOrderStatusFilter(status) {
		return nil, 0, webx.NewValidation("invalid status filter")
	}
	limit, offset := billingPage(page, pageSize)
	return s.billing.ListAllOrders(ctx, workspaceID, status, limit, offset)
}

func (s *BillingOpsService) ListPaymentEvents(ctx context.Context, workspaceID string, page, pageSize int) ([]AdminPaymentEvent, int, error) {
	if s.billing == nil {
		return nil, 0, errNotWired("billing ops")
	}
	limit, offset := billingPage(page, pageSize)
	return s.billing.ListPaymentEvents(ctx, workspaceID, limit, offset)
}

func (s *BillingOpsService) ListPlans(ctx context.Context) ([]string, error) {
	if s.billing == nil {
		return nil, errNotWired("billing ops")
	}
	return s.billing.ListPlanCodes(ctx)
}

func (s *BillingOpsService) ListPlanViews(ctx context.Context) ([]AdminPlanView, error) {
	if s.billing == nil {
		return nil, errNotWired("billing ops")
	}
	return s.billing.ListPlanViews(ctx)
}

// AdminUpdatePlan is a pass-through to the billing domain, which validates,
// writes and audits (admin.plan_change with from/to snapshots) — a single
// audit source, so the admin side records nothing extra here.
func (s *BillingOpsService) AdminUpdatePlan(ctx context.Context, p *webx.Principal, code string, input AdminPlanUpdateInput) (AdminPlanView, error) {
	if s.billing == nil {
		return AdminPlanView{}, errNotWired("billing ops")
	}
	return s.billing.AdminUpdatePlan(ctx, p, code, input)
}

func (s *BillingOpsService) ListWebhookDeliveries(ctx context.Context, workspaceID, status string, page, pageSize int) ([]AdminWebhookDelivery, int, error) {
	if s.webhooks == nil {
		return nil, 0, errNotWired("webhook ops")
	}
	if status != "" && !validDeliveryStatusFilter(status) {
		return nil, 0, webx.NewValidation("invalid status filter")
	}
	limit, offset := billingPage(page, pageSize)
	return s.webhooks.ListAllDeliveries(ctx, workspaceID, status, limit, offset)
}

func (s *BillingOpsService) AdminCancelOrder(ctx context.Context, p *webx.Principal, orderID string) error {
	if s.billing == nil {
		return errNotWired("billing ops")
	}
	if err := s.billing.AdminCancelPendingOrder(ctx, p, orderID); err != nil {
		return err
	}

	if s.auditor != nil {
		s.auditor.Record(ctx, nil, p, "admin.order_cancel", "order", orderID, nil)
	}
	return nil
}

func (s *BillingOpsService) RunExpiry(ctx context.Context, p *webx.Principal) (int, error) {
	if s.billing == nil {
		return 0, errNotWired("billing ops")
	}
	n, err := s.billing.RunExpiryNow(ctx)
	if err != nil {
		return 0, err
	}
	if s.auditor != nil {
		s.auditor.Record(ctx, nil, p, "admin.billing_run_expiry", "billing", "expiry",
			map[string]any{"expired": n})
	}
	return n, nil
}

func (s *BillingOpsService) RunOverage(ctx context.Context, p *webx.Principal) (int, error) {
	if s.billing == nil {
		return 0, errNotWired("billing ops")
	}
	n, err := s.billing.RunOverageNow(ctx)
	if err != nil {
		return 0, err
	}
	if s.auditor != nil {
		s.auditor.Record(ctx, nil, p, "admin.billing_run_overage", "billing", "overage",
			map[string]any{"orders_created": n})
	}
	return n, nil
}

func (s *BillingOpsService) AdminMarkOrderPaid(ctx context.Context, p *webx.Principal, orderID string) error {
	if s.billing == nil {
		return errNotWired("billing ops")
	}
	if err := s.billing.MarkOrderPaid(ctx, p, orderID); err != nil {
		return err
	}

	if s.auditor != nil {
		s.auditor.Record(ctx, nil, p, "admin.order_mark_paid", "order", orderID, nil)
	}
	return nil
}

func (s *BillingOpsService) AdminRedeliver(ctx context.Context, p *webx.Principal, deliveryID string) (AdminWebhookDelivery, error) {
	if s.webhooks == nil {
		return AdminWebhookDelivery{}, errNotWired("webhook ops")
	}
	d, err := s.webhooks.AdminRedeliver(ctx, deliveryID)
	if err != nil {
		return AdminWebhookDelivery{}, err
	}
	if s.auditor != nil {
		s.auditor.Record(ctx, nil, p, "admin.webhook_redeliver", "webhook_delivery", deliveryID,
			map[string]any{"new_delivery_id": d.ID})
	}
	return d, nil
}

func (s *BillingOpsService) BillingConfig(ctx context.Context) (AdminBillingConfig, error) {
	if s.billing == nil {
		return AdminBillingConfig{}, errNotWired("billing ops")
	}
	return s.billing.BillingConfig(ctx)
}

func (s *BillingOpsService) TestChannelConnection(ctx context.Context, channel string) error {
	if s.billing == nil {
		return errNotWired("billing ops")
	}
	if channel == "" {
		return webx.NewValidation("channel required")
	}
	return s.billing.TestChannelConnection(ctx, channel)
}

func (s *BillingOpsService) AdminCancelSubscription(ctx context.Context, p *webx.Principal, workspaceID string) error {
	if s.billing == nil {
		return errNotWired("billing ops")
	}
	if err := s.billing.AdminCancelSubscription(ctx, p, workspaceID); err != nil {
		return err
	}

	if s.auditor != nil {
		s.auditor.Record(ctx, &workspaceID, p, "admin.subscription_cancel", "workspace", workspaceID, nil)
	}
	return nil
}

// validCatalogInterval guards the BC-7 endpoints' interval path/body param:
// subscription catalogs are monthly/yearly (one_time packs are a BC-8 open
// question, rejected here until a channel declares support).
func validCatalogInterval(iv string) bool {
	return iv == "monthly" || iv == "yearly"
}

func (s *BillingOpsService) ChannelCards(ctx context.Context) ([]AdminChannelCard, error) {
	if s.billing == nil {
		return nil, errNotWired("billing ops")
	}
	return s.billing.ChannelCards(ctx)
}

func (s *BillingOpsService) UpdateChannelFields(ctx context.Context, p *webx.Principal, channel string, fields map[string]string) (AdminChannelCard, error) {
	if s.billing == nil {
		return AdminChannelCard{}, errNotWired("billing ops")
	}
	if channel == "" {
		return AdminChannelCard{}, webx.NewValidation("channel required")
	}
	if fields == nil {
		fields = map[string]string{}
	}
	return s.billing.UpdateChannelFields(ctx, p, channel, fields)
}

func (s *BillingOpsService) ChannelCatalog(ctx context.Context) (AdminChannelCatalog, error) {
	if s.billing == nil {
		return AdminChannelCatalog{}, errNotWired("billing ops")
	}
	return s.billing.ChannelCatalog(ctx)
}

func (s *BillingOpsService) RegisterChannelProduct(ctx context.Context, p *webx.Principal, channel, planCode, interval string) (string, error) {
	if s.billing == nil {
		return "", errNotWired("billing ops")
	}
	if channel == "" || planCode == "" || !validCatalogInterval(interval) {
		return "", webx.NewValidation("channel, plan_code and interval (monthly|yearly) required")
	}
	return s.billing.RegisterChannelProduct(ctx, p, channel, planCode, interval)
}

func (s *BillingOpsService) SyncChannelPrice(ctx context.Context, p *webx.Principal, channel, planCode, interval string) (int, error) {
	if s.billing == nil {
		return 0, errNotWired("billing ops")
	}
	if channel == "" || planCode == "" || !validCatalogInterval(interval) {
		return 0, webx.NewValidation("channel, plan_code and interval (monthly|yearly) required")
	}
	return s.billing.SyncChannelPrice(ctx, p, channel, planCode, interval)
}
