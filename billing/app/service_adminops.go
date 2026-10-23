package app

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
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

	UpdatePlan(ctx context.Context, code, name, limitsJSON string, sortNo int, currency string) (found bool, err error)
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

	// BC-5/BC-6: settings store backing billing_channel.* keys and the
	// hot-reload trigger wired after a field save. Both optional.
	channelSettings ChannelSettingsStore
	refresher       ChannelRefresher
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

// PlanUpdateInput is the full-replace payload for AdminUpdatePlan; the plan
// code is carried outside (path identity) and can never be edited.
type PlanUpdateInput struct {
	Name     string
	Currency string
	SortNo   int
	Limits   map[string]int
}

var (
	// aligned with migrations/040_plan_currency.up.sql's CHECK constraint
	planCurrencyRe = regexp.MustCompile(`^[A-Z]{3}$`)
	// limits is an open KV (unknown keys are harmless today); only the shape
	// is policed so a typo can never poison the JSONB column
	planLimitsKeyRe = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)
)

// AdminUpdatePlan full-replaces a plan's editable fields and writes a
// platform-level audit record (`admin.plan_change`, workspaceID nil) with
// from/to snapshots. Full-replace semantics: the UI submits the whole card,
// keys absent from Limits disappear. -1 keeps its seed meaning of "unlimited";
// limit values are JSON integers by construction (map[string]int). Readers
// (checkout, plan listings) hit the DB per request, so the change is effective
// immediately — no cache, no restart; existing orders keep their snapshotted
// amount.
func (s *BillingAdminService) AdminUpdatePlan(ctx context.Context, actor *webx.Principal, code string, in PlanUpdateInput) (PlanView, error) {
	name := strings.TrimSpace(in.Name)
	if n := len([]rune(name)); n < 1 || n > 100 {
		return PlanView{}, webx.NewValidation("plan name must be 1..100 characters")
	}
	if !planCurrencyRe.MatchString(in.Currency) {
		return PlanView{}, webx.NewValidation("plan currency must be a 3-letter uppercase ISO 4217 code")
	}
	limits := in.Limits
	if limits == nil {
		limits = map[string]int{}
	}
	for k := range limits {
		if !planLimitsKeyRe.MatchString(k) {
			return PlanView{}, webx.NewValidation("invalid plan limits key (want ^[a-z][a-z0-9_]{0,63}$): " + k)
		}
	}

	before, ok, err := s.core.repo.GetPlan(ctx, code)
	if err != nil {
		return PlanView{}, err
	}
	if !ok {
		return PlanView{}, webx.NewNotFound("plan not found")
	}

	limitsJSON, err := json.Marshal(limits)
	if err != nil {
		return PlanView{}, err
	}
	found, err := s.adminRepo.UpdatePlan(ctx, code, name, string(limitsJSON), in.SortNo, in.Currency)
	if err != nil {
		return PlanView{}, err
	}
	if !found {
		return PlanView{}, webx.NewNotFound("plan not found")
	}

	after := domain.Plan{Code: code, Name: name, Limits: limits, SortNo: in.SortNo, Currency: in.Currency}
	if s.core.auditor != nil {
		// resource type "plan" — core.audit pins "order", so record via the
		// shared auditor directly
		s.core.auditor.Record(ctx, nil, actor, "admin.plan_change", "plan", code,
			map[string]any{"from": planSnapshot(before), "to": planSnapshot(after)})
	}
	return planView(after), nil
}

func planSnapshot(p domain.Plan) map[string]any {
	limits := make(map[string]int, len(p.Limits))
	for k, v := range p.Limits {
		limits[k] = v
	}
	return map[string]any{
		"code": p.Code, "name": p.Name, "currency": p.Currency,
		"sort_no": p.SortNo, "limits": limits,
	}
}
