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

	// Locale is passed through to channel checkout pages ("en"/"zh"…);
	// empty = channel default (F19).
	Locale string

	// AutoRegisterCatalog lets CreateCheckout register a missing catalog
	// product on the fly for catalog-based channels that implement
	// ProductRegistrar (BC-7). Default false: an unmapped plan+interval fails
	// checkout with a "register it in the admin billing page" validation so
	// products never get silently created on the channel side.
	AutoRegisterCatalog bool
}

// BuyerEmailResolver resolves a checkout buyer's email from the identity side
// (user table). Injected by the product's main.go — billing must not import
// identity. Returning an error degrades to no email prefill, never fails checkout.
type BuyerEmailResolver func(ctx context.Context, userID string) (string, error)

type BillingService struct {
	repo     Repo
	channels ChannelSet
	hooks    BillingHooks
	auditor  Auditor
	cfg      Config
	now      Clock
	log      *slog.Logger

	meters MeterRegistry

	eventEmit EventEmit

	buyerEmail BuyerEmailResolver
}

func NewBillingService(repo Repo, channels ChannelSet, cfg Config, hooks BillingHooks, auditor Auditor, now Clock, log *slog.Logger) *BillingService {
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

// WithBuyerEmailResolver injects the identity-side email lookup used to
// prefill checkout (F2). nil = checkout without email prefill.
func (s *BillingService) WithBuyerEmailResolver(fn BuyerEmailResolver) *BillingService {
	s.buyerEmail = fn
	return s
}

// resolveBuyerEmail never fails checkout: a missing resolver or lookup error
// degrades to an empty prefill with a warn log.
func (s *BillingService) resolveBuyerEmail(ctx context.Context, userID string) string {
	if s.buyerEmail == nil {
		return ""
	}
	email, err := s.buyerEmail(ctx, userID)
	if err != nil {
		s.log.Warn("resolve buyer email failed, checkout without email prefill", "user_id", userID, "err", err)
		return ""
	}
	return email
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

	// BC-7: catalog-based channels need a channel-side product for the
	// plan+interval before any session can be created; resolve it up front so
	// an unmapped catalog fails BEFORE a pending order row exists.
	channelProductID, err := s.resolveChannelProduct(ctx, channel, channelName, plan, interval, amount)
	if err != nil {
		return nil, err
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

	session, err := channel.CreateCheckout(ctx, CheckoutRequest{
		Order:      order,
		SuccessURL: s.cfg.SuccessURL,
		CancelURL:  s.cfg.CancelURL,
		BuyerEmail: s.resolveBuyerEmail(ctx, order.UserID),
		Locale:     s.cfg.Locale,

		ChannelProductID: channelProductID,
	})
	if err != nil {

		_ = s.repo.UpdateOrderStatus(ctx, order.ID, domain.OrderPending, domain.OrderFailed, s.now())
		return nil, fmt.Errorf("create checkout: %w", err)
	}

	_ = s.repo.SetOrderChannelRefAndExpiry(ctx, order.ID, session.SessionRef, session.ExpiresAt)
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
			// P0 竞态修复（billing fix #1）：订单已被弃单清扫置 canceled，而钱
			// 真的到账了。canceled_by='expiry' 的清扫是启发式记账，迟到支付赢：
			// canceled→paid 复活后权益逻辑照常。canceled_by 为 user/admin（人
			// 主动取消）或 NULL（051 前存量行，来源不明）→ 维持现状忽略——宁可
			// 漏复活不可错发权益。
			revived := false
			if ok2 && cur.Status == domain.OrderCanceled {
				var rerr error
				revived, rerr = s.repo.ReviveOrderAfterExpiry(ctx, order.ID, now)
				if rerr != nil {
					return s.failEvent(ctx, event, rerr)
				}
				if revived {
					s.log.Warn("late paid event revived expiry-canceled order; grace window missed the webhook",
						"order_id", order.ID, "workspace_id", order.WorkspaceID,
						"channel", event.Channel, "event_id", event.ChannelEventID)
					s.audit(ctx, &order.WorkspaceID, nil, "billing.order_revived_after_expiry", order.ID, map[string]any{
						"channel": event.Channel, "event_id": event.ChannelEventID,
					})
				}
			}
			if !revived {
				s.log.Warn("paid event for non-pending order, ignored",
					"order_id", order.ID, "status", cur.Status, "event_id", event.ChannelEventID)
				return s.repo.MarkEventProcessed(ctx, event.Channel, event.ChannelEventID)
			}
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

	// LC-4: a completed (re)subscribe clears any stale cancel request — the
	// user paid again, the old request must not linger in the operator queue.
	// Blind idempotent UPDATE (no-op when nothing is pending).
	if err := s.repo.ClearWorkspaceCancelRequested(ctx, order.WorkspaceID); err != nil {
		return s.failEvent(ctx, event, err)
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
		// LC-4: the subscription is revoked — any recorded cancel request is
		// resolved (out of the operator queue).
		if err := s.repo.ClearWorkspaceCancelRequested(ctx, order.WorkspaceID); err != nil {
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
	// PayPal 续期接缝（billing fix #3，内核侧）。仅当事件携带 OrderID 时生效：
	//   1) PaymentIntentRef 落库——续期发票携带 PI 时锚进订单 metadata，修复
	//      「退款反查锚死代码」：此前全仓只在 handlePaid 落 PI，续期路径漏锚，
	//      后续仅携 PI 的退款/失败事件将关联不到订单。
	//   2) 金额对账——「目录价即收款价，改价必须同步」防线在续期路径的兑现：
	//      按订单的 planCode+interval 查当前 plan 价格对账（plan 缺失或无价则
	//      跳过对账），不等则与 handlePaid 的拒付语义一致：log.Error + 审计
	//      billing.amount_mismatch + 收敛 processed，不发放续期。OrderID 为空
	//      （waffo/stripe 续期）行为完全不变。
	if event.OrderID != "" {
		if event.PaymentIntentRef != "" {
			if err := s.repo.SetOrderPaymentIntentRef(ctx, event.OrderID, event.PaymentIntentRef); err != nil {
				return s.failEvent(ctx, event, err)
			}
		}
		if mismatch, order, err := s.renewalAmountMismatch(ctx, event); err != nil {
			return s.failEvent(ctx, event, err)
		} else if mismatch {
			s.log.Error("renewal amount mismatch, refusing to extend subscription",
				"order_id", event.OrderID, "plan_price_cents", order.expectedCents,
				"event_amount_cents", event.AmountCents,
				"order_currency", order.currency, "event_currency", event.Currency,
				"channel", event.Channel, "event_id", event.ChannelEventID)
			s.audit(ctx, &order.workspaceID, nil, "billing.amount_mismatch", event.OrderID, map[string]any{
				"phase": "renewal", "plan_price_cents": order.expectedCents,
				"event_amount_cents": event.AmountCents,
				"order_currency": order.currency, "event_currency": event.Currency,
			})
			return s.repo.MarkEventProcessed(ctx, event.Channel, event.ChannelEventID)
		}
	}

	wsID, currentPlan, ok, err := s.repo.FindWorkspaceBySubscription(ctx, event.SubscriptionRef)
	if err != nil {
		return s.failEvent(ctx, event, err)
	}
	if !ok {
		s.log.Info("renewal for unknown subscription, ignored", "subscription_ref", event.SubscriptionRef)
		return s.repo.MarkEventProcessed(ctx, event.Channel, event.ChannelEventID)
	}

	// LC-4 guard: a renewal charged on a workspace with a recorded cancel
	// request means the channel-side auto-renewal was NOT stopped (no channel
	// canceller, or the operator has not finished the queue item yet). The
	// money is already charged, so rights follow the payment — the extension
	// below proceeds and NO automatic refund is issued; the loud ERROR log is
	// the operator-intervention signal and the request stays in the queue.
	if reqAt, pending, err := s.repo.GetWorkspaceCancelRequested(ctx, wsID); err != nil {
		return s.failEvent(ctx, event, err)
	} else if pending {
		s.log.Error("renewal charged after cancel request; channel-side auto-renewal was not stopped, operator intervention required",
			"workspace_id", wsID, "subscription_ref", event.SubscriptionRef,
			"cancel_requested_at", reqAt, "channel", event.Channel, "event_id", event.ChannelEventID)
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

// renewalMismatchContext carries what the mismatch branch of handleRenewed
// needs for its log/audit record.
type renewalMismatchContext struct {
	workspaceID    string
	currency       string
	expectedCents  int
}

// renewalAmountMismatch reconciles a renewal event's amount against the
// CURRENT plan price for the order's planCode+interval (billing fix #3). The
// order's snapshotted AmountCents is deliberately not used: renewals bill at
// the live catalog price, and drifting channel prices are exactly what this
// check exists to catch. Skipped (false, zero ctx, nil err) when the event
// carries no amount, the order is unknown, or the plan is missing/unpriced —
// reconciliation is a guard, not a blocker for degenerate catalog rows.
func (s *BillingService) renewalAmountMismatch(ctx context.Context, event domain.PaymentEvent) (bool, renewalMismatchContext, error) {
	if event.AmountCents <= 0 {
		return false, renewalMismatchContext{}, nil
	}
	order, ok, err := s.repo.GetOrder(ctx, event.OrderID)
	if err != nil || !ok {
		return false, renewalMismatchContext{}, err
	}
	plan, ok, err := s.repo.GetPlan(ctx, order.PlanCode)
	if err != nil || !ok {
		return false, renewalMismatchContext{}, err
	}
	expected := planAmountCents(plan, order.Interval)
	if expected <= 0 {
		return false, renewalMismatchContext{}, nil // plan 无该周期定价 → 无从对账
	}
	mc := renewalMismatchContext{workspaceID: order.WorkspaceID, currency: order.Currency, expectedCents: expected}
	if event.Currency != "" && order.Currency != "" && !strings.EqualFold(event.Currency, order.Currency) {
		return true, mc, nil
	}
	if expected != event.AmountCents {
		return true, mc, nil
	}
	return false, renewalMismatchContext{}, nil
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
	// LC-4: the channel confirmed the subscription ended — any recorded user
	// cancel request is resolved (out of the operator queue).
	if err := s.repo.ClearWorkspaceCancelRequested(ctx, wsID); err != nil {
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

// ExpireStaleOrders sweeps pending orders whose checkout session expired
// (F15: waffo drops abandoned sessions with zero callbacks). No hooks fire —
// a pending order never granted rights, so canceling it changes nothing but
// the order row.
func (s *BillingService) ExpireStaleOrders(ctx context.Context, now time.Time, limit int) ([]string, error) {
	expired, err := s.repo.ExpireStaleOrders(ctx, now, limit)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(expired))
	for _, e := range expired {
		ids = append(ids, e.ID)
		s.log.Info("stale pending order expired", "order_id", e.ID, "workspace_id", e.WorkspaceID)
		s.audit(ctx, &e.WorkspaceID, nil, "billing.order_expired", e.ID, nil)
	}
	return ids, nil
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
	if err := s.repo.CancelOrder(ctx, orderID, domain.OrderPending, "user", s.now()); err != nil {
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

// PlanPriceCents is the exported planPriceCents lookup (BC-7): checkout, the
// admin catalog view and channel ProductRegistrar implementations all price a
// plan+interval from the same DB limits keys.
func PlanPriceCents(plan domain.Plan, interval domain.BillingInterval) int {
	return planAmountCents(plan, interval)
}

// channelCurrencyAllowed reports whether the channel's declared Currencies
// (ChannelCaps, empty = no restriction) accept the given currency
// (case-insensitive). Non-capability channels are unrestricted.
func channelCurrencyAllowed(ch PaymentChannel, currency string) bool {
	viewer, ok := ch.(ChannelCapabilityViewer)
	if !ok || len(viewer.Capabilities().Currencies) == 0 {
		return true
	}
	for _, c := range viewer.Capabilities().Currencies {
		if strings.EqualFold(c, currency) {
			return true
		}
	}
	return false
}

// errChannelCurrencyUnsupported is the register-product currency gate's 400
// (billing fix #7): failing BEFORE the channel REST call keeps a CNY plan from
// registering successfully on a USD-only channel and then hard-failing every
// checkout at the cashier.
func errChannelCurrencyUnsupported(channelName, currency, planCode string) error {
	return webx.NewValidation(fmt.Sprintf(
		"渠道 %s 不支持币种 %s（套餐 %s）：请先调整套餐币种或在渠道侧开通该币种，再注册渠道商品",
		channelName, currency, planCode))
}

// resolveChannelProduct fills the CheckoutRequest.ChannelProductID for
// catalog-based channels (BC-7): mapping hit → use it; miss + AutoRegister
// + ProductRegistrar → register and persist; anything else → validation
// error naming the channel and pointing at the admin registration page
// (F4: the one-off create-products script becomes a button).
func (s *BillingService) resolveChannelProduct(ctx context.Context, channel PaymentChannel, channelName string, plan domain.Plan, interval domain.BillingInterval, amount int) (string, error) {
	viewer, ok := channel.(ChannelCapabilityViewer)
	if !ok || !viewer.Capabilities().CatalogBased {
		return "", nil // ad-hoc priced channel (stripe/manual): no catalog to resolve
	}
	if currency := planCurrency(plan, s.cfg.Currency); !channelCurrencyAllowed(channel, currency) {
		return "", errChannelCurrencyUnsupported(channelName, currency, plan.Code)
	}
	if p, ok, err := s.repo.GetChannelProduct(ctx, channelName, plan.Code, interval); err != nil {
		return "", err
	} else if ok {
		return p.ChannelProductID, nil
	}
	reg, ok := channel.(ProductRegistrar)
	if ok && s.cfg.AutoRegisterCatalog {
		// check+register+upsert 原子化（billing fix #12）：渠道 REST 在 per-mapping
		// advisory lock 内串行，并发双击只有一次真正注册。
		id, existed, err := s.repo.RegisterChannelProductAtomic(ctx, channelName, plan.Code, interval,
			func(ctx context.Context) (string, error) { return reg.RegisterProduct(ctx, plan, interval) },
			amount, s.now())
		if err != nil {
			return "", fmt.Errorf("register channel product: %w", err)
		}
		if existed {
			return id, nil // 并发赢家已落映射：直接复用
		}
		s.audit(ctx, nil, nil, "billing.channel_product_auto_registered", plan.Code, map[string]any{
			"channel": channelName, "interval": string(interval), "channel_product_id": id,
		})
		return id, nil
	}
	return "", webx.NewValidation(fmt.Sprintf(
		"渠道 %s 尚未注册套餐 %s（%s）的渠道商品，请管理员在后台计费 → 渠道页完成商品注册后再发起支付",
		channelName, plan.Code, string(interval)))
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
