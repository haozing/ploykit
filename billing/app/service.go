package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/platform/webx"
)

type Config struct {
	SuccessURL string
	CancelURL  string

	Currency string
}

type BillingService struct {
	repo     Repo
	channels *ChannelRegistry
	hooks    BillingHooks
	auditor  Auditor
	cfg      Config
	now      Clock
	log      *slog.Logger

	meters MeterRegistry

	eventEmit EventEmit
}

func NewBillingService(repo Repo, channels *ChannelRegistry, cfg Config, hooks BillingHooks, auditor Auditor, now Clock, log *slog.Logger) *BillingService {
	if cfg.Currency == "" {
		cfg.Currency = "CNY"
	}
	if log == nil {
		log = slog.Default()
	}
	return &BillingService{repo: repo, channels: channels, hooks: hooks, cfg: cfg, auditor: auditor, now: now, log: log}
}

func (s *BillingService) audit(ctx context.Context, wsID *string, p *webx.Principal, action, resourceID string, meta map[string]any) {
	if s.auditor != nil {
		s.auditor.Record(ctx, wsID, p, action, "order", resourceID, meta)
	}
}

func (s *BillingService) CreateCheckout(ctx context.Context, p *webx.Principal, workspaceID, planCode string, interval domain.BillingInterval, channelName string) (*domain.CheckoutSession, error) {

	if s.hooks.BeforeCheckout != nil {
		if err := s.hooks.BeforeCheckout(ctx, workspaceID, p.UserID, planCode); err != nil {
			return nil, err
		}
	}

	plan, ok, err := s.repo.GetPlan(ctx, planCode)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, webx.NewNotFound("plan not found: " + planCode)
	}

	channel, ok := s.channels.Get(channelName)
	if !ok {
		return nil, webx.NewValidation("unknown payment channel: " + channelName)
	}

	amount := planAmountCents(plan, interval)

	if amount <= 0 {
		return nil, webx.NewValidation("plan is not priced for this interval: " + planCode)
	}
	order, err := s.repo.CreateOrder(ctx, domain.Order{
		WorkspaceID: workspaceID,
		UserID:      p.UserID,
		PlanCode:    planCode,
		Interval:    interval,
		AmountCents: amount,
		Currency:    planCurrency(plan, s.cfg.Currency),
		Channel:     channelName,
		Status:      domain.OrderPending,
		TrialDays:   plan.Limits["trial_days"],
	})
	if err != nil {
		return nil, err
	}

	session, err := channel.CreateCheckout(ctx, order, s.cfg.SuccessURL, s.cfg.CancelURL)
	if err != nil {

		_ = s.repo.UpdateOrderStatus(ctx, order.ID, domain.OrderPending, domain.OrderFailed, s.now())
		return nil, fmt.Errorf("create checkout: %w", err)
	}

	_ = s.repo.SetOrderChannelRef(ctx, order.ID, session.SessionRef)
	s.audit(ctx, &workspaceID, p, "billing.checkout_created", order.ID, map[string]any{
		"plan": planCode, "channel": channelName, "amount_cents": amount,
	})
	return &session, nil
}

func (s *BillingService) HandleWebhook(ctx context.Context, channelName string, req WebhookRequest) error {
	channel, ok := s.channels.Get(channelName)
	if !ok {
		return webx.NewNotFound("unknown channel: " + channelName)
	}

	event, err := channel.ParseWebhook(ctx, req)
	if err != nil {
		return webx.NewUnauthenticated("webhook signature verification failed")
	}

	isNew, err := s.repo.InsertPaymentEvent(ctx, event)
	if err != nil {
		return err
	}
	if !isNew {
		s.log.Info("webhook duplicate, ignored", "channel", channelName, "event_id", event.ChannelEventID)
		return nil
	}

	switch event.Type {
	case domain.EventCheckoutCompleted:
		return s.handlePaid(ctx, event)
	case domain.EventPaymentFailed:
		return s.handleFailed(ctx, event)
	case domain.EventRefundCreated:
		return s.handleRefund(ctx, event)
	case domain.EventSubscriptionRenewed:
		return s.handleRenewed(ctx, event)
	case domain.EventSubscriptionCanceled:
		return s.handleCanceled(ctx, event)
	default:
		s.log.Info("webhook event ignored", "type", event.Type, "channel", channelName)
		return s.repo.MarkEventProcessed(ctx, event.Channel, event.ChannelEventID)
	}
}

func (s *BillingService) failEvent(ctx context.Context, event domain.PaymentEvent, processErr error) error {
	if err := s.repo.MarkEventError(ctx, event.Channel, event.ChannelEventID, processErr.Error()); err != nil {
		s.log.Error("mark payment event error failed", "channel", event.Channel, "event_id", event.ChannelEventID, "err", err)
	}
	return processErr
}

func (s *BillingService) handlePaid(ctx context.Context, event domain.PaymentEvent) error {

	order, ok, err := s.resolveOrder(ctx, event)
	if err != nil {
		return s.failEvent(ctx, event, err)
	}
	if !ok {
		return s.repo.MarkEventProcessed(ctx, event.Channel, event.ChannelEventID)
	}

	if amountMismatch(order, event) {
		s.log.Error("payment amount mismatch, refusing to credit order",
			"order_id", order.ID, "order_amount_cents", order.AmountCents,
			"event_amount_cents", event.AmountCents,
			"order_currency", order.Currency, "event_currency", event.Currency,
			"channel", event.Channel, "event_id", event.ChannelEventID)
		s.audit(ctx, &order.WorkspaceID, nil, "billing.amount_mismatch", order.ID, map[string]any{
			"order_amount_cents": order.AmountCents, "event_amount_cents": event.AmountCents,
			"order_currency": order.Currency, "event_currency": event.Currency,
		})
		return s.repo.MarkEventProcessed(ctx, event.Channel, event.ChannelEventID)
	}

	if event.PaymentIntentRef != "" {
		if err := s.repo.SetOrderPaymentIntentRef(ctx, order.ID, event.PaymentIntentRef); err != nil {
			return s.failEvent(ctx, event, err)
		}
	}

	now := s.now()
	if err := s.repo.UpdateOrderStatus(ctx, order.ID, domain.OrderPending, domain.OrderPaid, now); err != nil {
		if !errors.Is(err, domain.ErrStatusConflict) {
			return s.failEvent(ctx, event, err)
		}
		cur, ok2, err2 := s.repo.GetOrder(ctx, order.ID)
		if err2 != nil {
			return s.failEvent(ctx, event, err2)
		}
		if !ok2 || cur.Status != domain.OrderPaid {
			s.log.Warn("paid event for non-pending order, ignored",
				"order_id", order.ID, "status", cur.Status, "event_id", event.ChannelEventID)
			return s.repo.MarkEventProcessed(ctx, event.Channel, event.ChannelEventID)
		}
	}

	from, err := s.repo.GetWorkspacePlan(ctx, order.WorkspaceID)
	if err != nil {
		return s.failEvent(ctx, event, err)
	}
	if err := s.repo.ChangeWorkspacePlan(ctx, order.WorkspaceID, order.PlanCode, "webhook:"+event.Channel, "order:"+order.ID, now, s.planChangedTx(ctx, order.WorkspaceID, order.PlanCode)); err != nil {
		return s.failEvent(ctx, event, err)
	}

	if event.SubscriptionRef != "" {
		expiresAt := s.subscriptionExpiry(ctx, order, now)
		if err := s.repo.SetWorkspaceSubscription(ctx, order.WorkspaceID, event.SubscriptionRef, expiresAt, now); err != nil {
			return s.failEvent(ctx, event, err)
		}
	}

	if from != order.PlanCode {
		if s.hooks.OnPlanChanged != nil {
			if err := s.hooks.OnPlanChanged(ctx, order.WorkspaceID, from, order.PlanCode); err != nil {
				s.log.Error("OnPlanChanged hook failed", "err", err)
			}
		}
		s.audit(ctx, &order.WorkspaceID, nil, "billing.order_paid", order.ID, nil)
	}
	return s.repo.MarkEventProcessed(ctx, event.Channel, event.ChannelEventID)
}

func amountMismatch(order domain.Order, event domain.PaymentEvent) bool {
	if order.TrialDays > 0 || event.AmountCents <= 0 {
		return false
	}
	if order.AmountCents != event.AmountCents {
		return true
	}
	if event.Currency != "" && order.Currency != "" && !strings.EqualFold(event.Currency, order.Currency) {
		return true
	}
	return false
}

func (s *BillingService) handleFailed(ctx context.Context, event domain.PaymentEvent) error {

	order, ok, err := s.resolveOrder(ctx, event)
	if err != nil {
		return s.failEvent(ctx, event, err)
	}
	if !ok {
		return s.repo.MarkEventProcessed(ctx, event.Channel, event.ChannelEventID)
	}

	now := s.now()
	emit, err := s.paymentFailedEmitFn(ctx, order, event, now)
	if err != nil {
		return s.failEvent(ctx, event, err)
	}
	if err := s.repo.FailOrder(ctx, order, event, emit, now); err != nil {
		if errors.Is(err, domain.ErrStatusConflict) {

			s.firePaymentFailedHook(ctx, order)
			return s.repo.MarkEventProcessed(ctx, event.Channel, event.ChannelEventID)
		}
		return s.failEvent(ctx, event, err)
	}
	s.firePaymentFailedHook(ctx, order)
	return nil
}

func (s *BillingService) firePaymentFailedHook(ctx context.Context, order domain.Order) {
	if s.hooks.OnPaymentFailed != nil {
		if err := s.hooks.OnPaymentFailed(ctx, order.WorkspaceID, order.ID, "payment failed"); err != nil {
			s.log.Error("OnPaymentFailed hook failed", "err", err)
		}
	}
}

func (s *BillingService) handleRefund(ctx context.Context, event domain.PaymentEvent) error {

	order, ok, err := s.resolveOrder(ctx, event)
	if err != nil {
		return s.failEvent(ctx, event, err)
	}
	if !ok {
		return s.repo.MarkEventProcessed(ctx, event.Channel, event.ChannelEventID)
	}

	now := s.now()

	if err := s.repo.UpdateOrderStatus(ctx, order.ID, domain.OrderPaid, domain.OrderRefunded, now); err != nil {
		if errors.Is(err, domain.ErrStatusConflict) {
			return s.repo.MarkEventProcessed(ctx, event.Channel, event.ChannelEventID)
		}
		return s.failEvent(ctx, event, err)
	}

	if err := s.repo.ChangeWorkspacePlan(ctx, order.WorkspaceID, "free", "webhook:"+event.Channel, "refund:"+order.ID, now, s.planChangedTx(ctx, order.WorkspaceID, "free")); err != nil {
		return s.failEvent(ctx, event, err)
	}

	if event.SubscriptionRef != "" {
		if err := s.repo.SetWorkspaceSubscription(ctx, order.WorkspaceID, "", time.Time{}, now); err != nil {
			return s.failEvent(ctx, event, err)
		}
	}
	if s.hooks.OnPlanChanged != nil {
		if err := s.hooks.OnPlanChanged(ctx, order.WorkspaceID, order.PlanCode, "free"); err != nil {
			s.log.Error("OnPlanChanged hook failed", "err", err)
		}
	}
	return s.repo.MarkEventProcessed(ctx, event.Channel, event.ChannelEventID)
}

func (s *BillingService) resolveOrder(ctx context.Context, event domain.PaymentEvent) (domain.Order, bool, error) {
	if event.OrderID != "" {
		return s.repo.GetOrder(ctx, event.OrderID)
	}
	if event.ChannelRef != "" {
		if o, ok, err := s.repo.FindOrderByChannelRef(ctx, event.Channel, event.ChannelRef); err != nil {
			return domain.Order{}, false, err
		} else if ok {
			return o, true, nil
		}
	}
	pi := event.PaymentIntentRef
	if pi == "" {
		pi = event.ChannelRef
	}
	if pi != "" {
		return s.repo.FindOrderByPaymentIntent(ctx, pi)
	}
	return domain.Order{}, false, nil
}

func (s *BillingService) handleRenewed(ctx context.Context, event domain.PaymentEvent) error {
	wsID, currentPlan, ok, err := s.repo.FindWorkspaceBySubscription(ctx, event.SubscriptionRef)
	if err != nil {
		return s.failEvent(ctx, event, err)
	}
	if !ok {
		s.log.Info("renewal for unknown subscription, ignored", "subscription_ref", event.SubscriptionRef)
		return s.repo.MarkEventProcessed(ctx, event.Channel, event.ChannelEventID)
	}

	now := s.now()
	interval := domain.IntervalMonthly
	if iv, ok, err := s.repo.LatestPaidOrderInterval(ctx, wsID); err != nil {
		return s.failEvent(ctx, event, err)
	} else if ok {
		interval = domain.BillingInterval(iv)
	}
	expiresAt := addInterval(now, interval, 0)
	if err := s.repo.SetWorkspaceSubscription(ctx, wsID, event.SubscriptionRef, expiresAt, now); err != nil {
		return s.failEvent(ctx, event, err)
	}

	if event.OrderID != "" && currentPlan == "free" {
		if o, ok, err := s.repo.GetOrder(ctx, event.OrderID); err != nil {
			return s.failEvent(ctx, event, err)
		} else if ok && o.PlanCode != "" && o.PlanCode != currentPlan {
			if err := s.repo.ChangeWorkspacePlan(ctx, wsID, o.PlanCode, "webhook:"+event.Channel,
				"renewal:"+event.OrderID, now, s.planChangedTx(ctx, wsID, o.PlanCode)); err != nil {
				return s.failEvent(ctx, event, err)
			}
			if s.hooks.OnPlanChanged != nil {
				if err := s.hooks.OnPlanChanged(ctx, wsID, currentPlan, o.PlanCode); err != nil {
					s.log.Error("OnPlanChanged hook failed", "err", err)
				}
			}
		}
	}

	if s.hooks.OnSubscriptionRenewed != nil {
		if err := s.hooks.OnSubscriptionRenewed(ctx, wsID, expiresAt); err != nil {
			s.log.Error("OnSubscriptionRenewed hook failed", "err", err)
		}
	}
	s.auditWS(ctx, wsID, "billing.subscription_renewed", map[string]any{"subscription_ref": event.SubscriptionRef})
	return s.repo.MarkEventProcessed(ctx, event.Channel, event.ChannelEventID)
}

func (s *BillingService) handleCanceled(ctx context.Context, event domain.PaymentEvent) error {
	wsID, fromPlan, ok, err := s.repo.FindWorkspaceBySubscription(ctx, event.SubscriptionRef)
	if err != nil {
		return s.failEvent(ctx, event, err)
	}
	if !ok {
		s.log.Info("cancellation for unknown subscription, ignored", "subscription_ref", event.SubscriptionRef)
		return s.repo.MarkEventProcessed(ctx, event.Channel, event.ChannelEventID)
	}

	now := s.now()
	if err := s.repo.ChangeWorkspacePlan(ctx, wsID, "free", "webhook:"+event.Channel, "subscription:"+event.SubscriptionRef, now, s.planChangedTx(ctx, wsID, "free")); err != nil {
		return s.failEvent(ctx, event, err)
	}
	if err := s.repo.SetWorkspaceSubscription(ctx, wsID, "", time.Time{}, now); err != nil {
		return s.failEvent(ctx, event, err)
	}

	if s.hooks.OnPlanChanged != nil {
		if err := s.hooks.OnPlanChanged(ctx, wsID, fromPlan, "free"); err != nil {
			s.log.Error("OnPlanChanged hook failed", "err", err)
		}
	}
	s.auditWS(ctx, wsID, "billing.subscription_canceled", map[string]any{"subscription_ref": event.SubscriptionRef})
	return s.repo.MarkEventProcessed(ctx, event.Channel, event.ChannelEventID)
}

func (s *BillingService) subscriptionExpiry(ctx context.Context, order domain.Order, now time.Time) time.Time {
	trialDays := 0
	if plan, ok, err := s.repo.GetPlan(ctx, order.PlanCode); err == nil && ok {
		trialDays = plan.Limits["trial_days"]
	}
	return addInterval(now, order.Interval, trialDays)
}

func addInterval(now time.Time, interval domain.BillingInterval, trialDays int) time.Time {
	if trialDays > 0 {
		return now.AddDate(0, 0, trialDays)
	}
	if interval == domain.IntervalYearly {
		return now.AddDate(1, 0, 0)
	}
	return now.AddDate(0, 1, 0)
}

func (s *BillingService) auditWS(ctx context.Context, wsID, action string, meta map[string]any) {
	if s.auditor != nil {
		s.auditor.Record(ctx, &wsID, nil, action, "workspace", wsID, meta)
	}
}

func (s *BillingService) planChangedTx(ctx context.Context, workspaceID, to string) func(pgx.Tx, string) error {
	if s.hooks.OnPlanChangedTx == nil {
		return nil
	}
	h := s.hooks.OnPlanChangedTx
	return func(tx pgx.Tx, from string) error {
		return h(ctx, tx, workspaceID, from, to)
	}
}

func (s *BillingService) ExpireDueWorkspaces(ctx context.Context, now time.Time, limit int) ([]ExpiredWorkspace, error) {
	expired, err := s.repo.ExpireDueWorkspaces(ctx, now, limit)
	if err != nil {
		return nil, err
	}
	for _, e := range expired {
		if s.hooks.OnPlanChanged != nil {
			if err := s.hooks.OnPlanChanged(ctx, e.WorkspaceID, e.FromPlan, "free"); err != nil {
				s.log.Error("OnPlanChanged hook failed", "err", err)
			}
		}
		s.auditWS(ctx, e.WorkspaceID, "billing.plan_expired", nil)
	}
	return expired, nil
}

type meteredDim struct {
	Dim       string
	UnitCents int
	Included  int
}

const (
	meteredKeyPrefix = "metered_"
	meteredKeyUnit   = "_unit_cents"
	meteredKeyIncl   = "_included"
)

func meteredDims(limits map[string]int) []meteredDim {
	byDim := map[string]*meteredDim{}
	for k, v := range limits {
		rest, ok := strings.CutPrefix(k, meteredKeyPrefix)
		if !ok {
			continue
		}
		var dim string
		switch {
		case strings.HasSuffix(rest, meteredKeyUnit):
			dim = strings.TrimSuffix(rest, meteredKeyUnit)
			m := byDim[dim]
			if m == nil {
				m = &meteredDim{Dim: dim}
				byDim[dim] = m
			}
			m.UnitCents = v
		case strings.HasSuffix(rest, meteredKeyIncl):
			dim = strings.TrimSuffix(rest, meteredKeyIncl)
			m := byDim[dim]
			if m == nil {
				m = &meteredDim{Dim: dim}
				byDim[dim] = m
			}
			m.Included = v
		}
	}
	dims := make([]meteredDim, 0, len(byDim))
	for _, m := range byDim {
		if m.UnitCents > 0 {
			dims = append(dims, *m)
		}
	}
	if len(dims) == 0 {
		return nil
	}
	sort.Slice(dims, func(i, j int) bool { return dims[i].Dim < dims[j].Dim })
	return dims
}

func previousMonthPeriod(now time.Time) string {
	first := time.Date(now.UTC().Year(), now.UTC().Month(), 1, 0, 0, 0, 0, time.UTC)
	return first.AddDate(0, -1, 0).Format("2006-01")
}

type OverageItem struct {
	Dim         string
	Used        int64
	Included    int64
	UnitCents   int64
	DisplayName string
	AggType     string
	Unit        string
}

type overageMetaItem struct {
	Dim          string `json:"dim"`
	Used         int64  `json:"used"`
	Included     int64  `json:"included"`
	UnitCents    int64  `json:"unit_cents"`
	OverageUnits int64  `json:"overage_units"`
	OverageCents int64  `json:"overage_cents"`
	DisplayName  string `json:"display_name,omitempty"`
	AggType      string `json:"agg_type,omitempty"`
	Unit         string `json:"unit,omitempty"`
}

func (s *BillingService) CreateOverageOrder(ctx context.Context, workspaceID, period string, items []OverageItem, now time.Time) (domain.Order, bool, error) {
	var amount int64
	meta := []overageMetaItem{}
	for _, it := range items {
		units := it.Used - it.Included
		if units <= 0 || it.UnitCents <= 0 {
			continue
		}
		amount += units * it.UnitCents
		meta = append(meta, overageMetaItem{
			Dim: it.Dim, Used: it.Used, Included: it.Included, UnitCents: it.UnitCents,
			OverageUnits: units, OverageCents: units * it.UnitCents,
			DisplayName: it.DisplayName, AggType: it.AggType, Unit: it.Unit,
		})
	}
	if amount <= 0 {
		return domain.Order{}, false, nil
	}
	order, created, err := s.repo.InsertOverageOrder(ctx, domain.Order{
		WorkspaceID: workspaceID,
		Interval:    domain.IntervalOneTime,
		AmountCents: int(amount),
		Currency:    s.overageCurrency(ctx, workspaceID),
		Channel:     "manual",
		Status:      domain.OrderPending,
		Metadata:    map[string]any{"overage_period": period, "items": meta},
	})
	if err != nil || !created {
		return order, created, err
	}
	if s.hooks.OnMeteredOverage != nil {
		if err := s.hooks.OnMeteredOverage(ctx, workspaceID, order.ID, period, len(meta), amount); err != nil {
			s.log.Error("OnMeteredOverage hook failed", "err", err)
		}
	}
	s.audit(ctx, &workspaceID, nil, "billing.metered_overage", order.ID, map[string]any{
		"period": period, "item_count": len(meta), "amount_cents": amount,
	})
	return order, created, nil
}

func (s *BillingService) MeterDueOverages(ctx context.Context, now time.Time, usage func(ctx context.Context, workspaceID, key, period string) (used, granted int64, err error), limit int) ([]domain.Order, error) {
	if limit <= 0 {
		limit = 50
	}

	meters := map[string]Meter{}
	if s.meters != nil {
		if ms, err := s.meters.ListMeters(ctx); err != nil {
			s.log.Warn("meter registry unavailable, billing without meter metadata", "err", err)
		} else {
			for _, m := range ms {
				meters[m.Slug] = m
			}
		}
	}
	candidates, err := s.repo.ListMeteredWorkspaces(ctx, limit)
	if err != nil {
		return nil, err
	}
	period := previousMonthPeriod(now)
	created := []domain.Order{}
	for _, c := range candidates {
		if c.PlanExpiresAt == nil || !c.PlanExpiresAt.After(now) {
			continue
		}
		items := []OverageItem{}
		for _, m := range meteredDims(c.Limits) {
			used, _, err := usage(ctx, c.WorkspaceID, m.Dim, period)
			if err != nil {
				s.log.Error("metered usage read failed", "workspace", c.WorkspaceID, "dim", m.Dim, "period", period, "err", err)
				continue
			}
			item := OverageItem{Dim: m.Dim, Used: used, Included: int64(m.Included), UnitCents: int64(m.UnitCents)}
			if mt, ok := meters[m.Dim]; ok {
				item.DisplayName, item.AggType, item.Unit = mt.DisplayName, mt.AggType, mt.Unit
			}
			items = append(items, item)
		}
		order, ok, err := s.CreateOverageOrder(ctx, c.WorkspaceID, period, items, now)
		if err != nil {
			s.log.Error("create overage order failed", "workspace", c.WorkspaceID, "period", period, "err", err)
			continue
		}
		if ok {
			created = append(created, order)
		}
	}
	return created, nil
}

type UsagePreviewItem struct {
	Dim                   string `json:"dim"`
	Used                  int64  `json:"used"`
	Included              int64  `json:"included"`
	UnitCents             int64  `json:"unit_cents"`
	ProjectedOverageCents int64  `json:"projected_overage_cents"`
}

type UsagePreview struct {
	Period              string             `json:"period"`
	Items               []UsagePreviewItem `json:"items"`
	ProjectedTotalCents int64              `json:"projected_total_cents"`
}

func (s *BillingService) UsagePreview(ctx context.Context, workspaceID string, usage func(ctx context.Context, workspaceID, key, period string) (used, granted int64, err error)) (UsagePreview, error) {
	pv := UsagePreview{Period: s.now().UTC().Format("2006-01"), Items: []UsagePreviewItem{}}
	planCode, err := s.repo.GetWorkspacePlan(ctx, workspaceID)
	if err != nil {
		return pv, err
	}
	plan, ok, err := s.repo.GetPlan(ctx, planCode)
	if err != nil {
		return pv, err
	}
	if !ok {
		return pv, nil
	}
	for _, m := range meteredDims(plan.Limits) {
		used, _, err := usage(ctx, workspaceID, m.Dim, pv.Period)
		if err != nil {
			return UsagePreview{}, err
		}
		item := UsagePreviewItem{Dim: m.Dim, Used: used, Included: int64(m.Included), UnitCents: int64(m.UnitCents)}
		if over := used - int64(m.Included); over > 0 {
			item.ProjectedOverageCents = over * int64(m.UnitCents)
		}
		pv.ProjectedTotalCents += item.ProjectedOverageCents
		pv.Items = append(pv.Items, item)
	}
	return pv, nil
}

func (s *BillingService) ListPlans(ctx context.Context) ([]domain.Plan, error) {
	return s.repo.ListPlans(ctx)
}

func (s *BillingService) GetSubscription(ctx context.Context, workspaceID string) (currentPlan string, orders []domain.Order, err error) {
	currentPlan, err = s.repo.GetWorkspacePlan(ctx, workspaceID)
	if err != nil {
		return "", nil, err
	}
	orders, err = s.repo.ListOrdersByWorkspace(ctx, workspaceID, 20)
	return currentPlan, orders, err
}

type CheckoutCanceller interface {
	CancelCheckout(ctx context.Context, sessionRef string) error
}

func (s *BillingService) CancelPendingOrder(ctx context.Context, p *webx.Principal, orderID string) error {
	if p.WorkspaceID == "" {
		return webx.NewValidation("workspace context required")
	}
	order, ok, err := s.repo.GetOrder(ctx, orderID)
	if err != nil || !ok {
		return webx.NewNotFound("order not found")
	}
	if order.WorkspaceID != p.WorkspaceID {
		return webx.NewNotFound("order not found")
	}
	if order.Status != domain.OrderPending {
		return webx.NewConflict("order is not pending")
	}
	if err := s.repo.UpdateOrderStatus(ctx, orderID, domain.OrderPending, domain.OrderCanceled, s.now()); err != nil {
		return err
	}
	if order.ChannelRef != "" {
		if ch, ok := s.channels.Get(order.Channel); ok {
			if cc, ok := ch.(CheckoutCanceller); ok {
				if cerr := cc.CancelCheckout(ctx, order.ChannelRef); cerr != nil {
					s.log.Warn("channel checkout cancel failed (session will expire)",
						"order_id", orderID, "channel", order.Channel, "err", cerr)
				}
			}
		}
	}
	s.audit(ctx, &order.WorkspaceID, p, "billing.order_canceled", orderID, nil)
	return nil
}

func planAmountCents(plan domain.Plan, interval domain.BillingInterval) int {
	var key string
	switch interval {
	case domain.IntervalYearly:
		key = "price_yearly_cents"
	case domain.IntervalOneTime:
		key = "price_one_time_cents"
	default:
		key = "price_monthly_cents"
	}
	if v, ok := plan.Limits[key]; ok {
		return v
	}
	return 0
}

func planCurrency(plan domain.Plan, fallback string) string {
	if plan.Currency != "" {
		return plan.Currency
	}
	return fallback
}

func (s *BillingService) overageCurrency(ctx context.Context, workspaceID string) string {
	planCode, err := s.repo.GetWorkspacePlan(ctx, workspaceID)
	if err != nil {
		s.log.Warn("overage currency: read workspace plan failed, fallback to config currency",
			"workspace", workspaceID, "err", err)
		return s.cfg.Currency
	}
	plan, ok, err := s.repo.GetPlan(ctx, planCode)
	if err != nil || !ok {
		return s.cfg.Currency
	}
	return planCurrency(plan, s.cfg.Currency)
}
