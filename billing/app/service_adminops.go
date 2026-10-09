package app

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/platform/webx"
)

type AdminOrderFilter struct {
	WorkspaceID string
	Status      string
}

type AdminOrderView struct {
	domain.Order
	WorkspaceName string `json:"workspace_name"`
}

type PaymentEventFilter struct {
	WorkspaceID string
}

type PaymentEventView struct {
	ID             string     `json:"id"`
	Channel        string     `json:"channel"`
	ChannelEventID string     `json:"channel_event_id"`
	Type           string     `json:"event_type"`
	OrderID        string     `json:"order_id,omitempty"`
	ProcessStatus  string     `json:"process_status"`
	ProcessError   string     `json:"process_error,omitempty"`
	ProcessedAt    *time.Time `json:"processed_at,omitempty"`

	Processed bool      `json:"processed"`
	CreatedAt time.Time `json:"created_at"`
}

type AdminUsageFunc func(ctx context.Context, workspaceID, key, period string) (used, granted int64, err error)

type AdminRepo interface {
	ListAllOrders(ctx context.Context, f AdminOrderFilter, limit, offset int) ([]AdminOrderView, int, error)

	ListPaymentEvents(ctx context.Context, f PaymentEventFilter, limit, offset int) ([]PaymentEventView, int, error)

	ListPlanCodes(ctx context.Context) ([]string, error)
}

const (
	adminExpiryBatch  = 100
	adminOverageBatch = 50
)

type BillingAdminService struct {
	core      *BillingService
	adminRepo AdminRepo
	usage     AdminUsageFunc
	now       Clock
	log       *slog.Logger
}

func NewBillingAdminService(core *BillingService, adminRepo AdminRepo, now Clock, log *slog.Logger) *BillingAdminService {
	if now == nil {
		now = time.Now
	}
	if log == nil {
		log = slog.Default()
	}
	return &BillingAdminService{core: core, adminRepo: adminRepo, now: now, log: log}
}

func (s *BillingAdminService) WithUsage(u AdminUsageFunc) *BillingAdminService {
	s.usage = u
	return s
}

func validAdminOrderStatus(st string) bool {
	switch domain.OrderStatus(st) {
	case domain.OrderPending, domain.OrderPaid, domain.OrderFailed, domain.OrderCanceled, domain.OrderRefunded:
		return true
	}
	return false
}

func (s *BillingAdminService) ListAllOrders(ctx context.Context, f AdminOrderFilter, limit, offset int) ([]AdminOrderView, int, error) {
	if f.Status != "" && !validAdminOrderStatus(f.Status) {
		return nil, 0, webx.NewValidation("invalid status filter")
	}
	return s.adminRepo.ListAllOrders(ctx, f, limit, offset)
}

func (s *BillingAdminService) ListPaymentEvents(ctx context.Context, f PaymentEventFilter, limit, offset int) ([]PaymentEventView, int, error) {
	return s.adminRepo.ListPaymentEvents(ctx, f, limit, offset)
}

func (s *BillingAdminService) ListPlanCodes(ctx context.Context) ([]string, error) {
	return s.adminRepo.ListPlanCodes(ctx)
}

func (s *BillingAdminService) AdminCancelPendingOrder(ctx context.Context, actor *webx.Principal, orderID string) error {
	order, ok, err := s.core.repo.GetOrder(ctx, orderID)
	if err != nil {
		return err
	}
	if !ok {
		return webx.NewNotFound("order not found")
	}
	if order.Status != domain.OrderPending {
		return webx.NewConflict("order is not pending")
	}
	if err := s.core.repo.UpdateOrderStatus(ctx, orderID, domain.OrderPending, domain.OrderCanceled, s.now()); err != nil {
		if errors.Is(err, domain.ErrStatusConflict) {

			return webx.NewConflict("order is not pending")
		}
		return err
	}
	s.core.audit(ctx, &order.WorkspaceID, actor, "billing.order_canceled", orderID, map[string]any{"admin": true})
	return nil
}

func (s *BillingAdminService) RunExpiryNow(ctx context.Context) (int, error) {
	expired, err := s.core.ExpireDueWorkspaces(ctx, s.now(), adminExpiryBatch)
	return len(expired), err
}

func (s *BillingAdminService) RunOverageNow(ctx context.Context) (int, error) {
	if s.usage == nil {
		return 0, webx.NewError(http.StatusServiceUnavailable, webx.CodeUnavailable, "usage reader not wired")
	}
	orders, err := s.core.MeterDueOverages(ctx, s.now(), s.usage, adminOverageBatch)
	return len(orders), err
}
