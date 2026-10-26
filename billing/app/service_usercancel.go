package app

import (
	"context"
	"net/http"
	"time"

	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/platform/webx"
)

// User-cancel outcome values (LC-4). The HTTP layer answers 200 with
// {ok:true, outcome} for every one of them — a cancel request is always
// ACCEPTED; which shape it takes is channel knowledge:
//
//   - cancelled: the channel revoked access immediately; the local plan is
//     downgraded right away (same local path as admin cancel).
//   - period_end: the channel honors the paid period; only the
//     cancel_requested_at mark is set and the plan/subscription rows stay
//     untouched until the period runs out (expiry sweeper collects).
//   - operator_pending: the channel has no canceller API (none of the three
//     built-in channels — 2026-10-26 correction: stripe implements it too,
//     so this branch is reachable only for third-party channels) or the plan
//     has no channel subscription at all; the framework CANNOT stop the next
//     charge (audit L2) — the request lands in the admin cancel-requests
//     queue and an operator finishes it in the channel console. This is never
//     surfaced as a 4xx: the user's action is accepted.
const (
	CancelOutcomeCancelled       = "cancelled"
	CancelOutcomePeriodEnd       = "period_end"
	CancelOutcomeOperatorPending = "operator_pending"
)

// UserCancelSubscription cancels the workspace's subscription on the user's
// own behalf (LC-4: cancel must be same-medium as signup — an in-product
// endpoint, not a channel email portal). It must NOT be used to re-expose the
// admin semantics: admin cancel is an immediate local downgrade, which would
// contradict the "access continues until the end of the paid period" promise
// for period-end channels (audit L2). The local behavior follows the
// channel's declared CancelTiming.
func (s *BillingService) UserCancelSubscription(ctx context.Context, p *webx.Principal, workspaceID string) (string, error) {
	if p == nil || p.WorkspaceID == "" {
		return "", webx.NewUnauthenticated("authentication and workspace context required")
	}
	// Authorization: only a principal bounded to THIS workspace may cancel —
	// a platform admin or a member of another workspace must not be able to
	// cancel on someone else's behalf. 404 (not 403) so existence does not
	// leak, same discipline as CancelPendingOrder. The route already bounds
	// callers via WsMW + billing:manage; the service re-checks so it stays
	// safe under any wiring.
	if p.WorkspaceID != workspaceID {
		return "", webx.NewNotFound("workspace not found")
	}

	subRef, ok, err := s.repo.GetWorkspaceSubscription(ctx, workspaceID)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", webx.NewNotFound("workspace not found")
	}
	fromPlan, err := s.repo.GetWorkspacePlan(ctx, workspaceID)
	if err != nil {
		return "", err
	}

	// Idempotency: a request already recorded answers with what that request
	// means today — no second channel call, no state change.
	if _, pending, err := s.repo.GetWorkspaceCancelRequested(ctx, workspaceID); err != nil {
		return "", err
	} else if pending {
		return s.replayCancelOutcome(ctx, workspaceID, subRef, fromPlan)
	}

	if subRef == "" && fromPlan == "free" {
		return "", webx.NewConflict("workspace has no active subscription")
	}

	now := s.now()

	// No channel subscription behind the plan (operator-granted manual plan):
	// the operator IS the channel — record the request for the queue. Never
	// silently downgrade something an admin granted by hand.
	if subRef == "" {
		if err := s.repo.SetWorkspaceCancelRequested(ctx, workspaceID, now); err != nil {
			return "", err
		}
		s.auditUserCancel(ctx, workspaceID, p, CancelOutcomeOperatorPending, subRef)
		return CancelOutcomeOperatorPending, nil
	}

	ch, _, err := s.locateSubscriptionChannel(ctx, workspaceID)
	if err != nil {
		return "", err
	}
	var canceller SubscriptionCanceller
	if ch != nil {
		canceller, _ = ch.(SubscriptionCanceller)
	}
	if canceller == nil {
		// Audit L2 honesty rule: without a channel API the framework cannot
		// stop the next MoR charge — record the request (operator queue) and
		// say so via the outcome. The HTTP layer MUST answer 200: the user's
		// cancel was accepted, it just needs a human on the channel side.
		if err := s.repo.SetWorkspaceCancelRequested(ctx, workspaceID, now); err != nil {
			return "", err
		}
		s.auditUserCancel(ctx, workspaceID, p, CancelOutcomeOperatorPending, subRef)
		return CancelOutcomeOperatorPending, nil
	}

	// Channel-through cancel (all three built-in canceller channels: stripe
	// and paypal immediate — see their Caps — waffo period_end). Failure keeps
	// local state untouched and surfaces as 502 — the user may retry.
	if err := canceller.CancelSubscription(ctx, subRef); err != nil {
		return "", webx.NewError(http.StatusBadGateway, webx.CodeInternal,
			"取消渠道订阅失败，已保持本地状态不变: "+err.Error())
	}

	if channelCancelTiming(ch) == CancelTimingImmediate {
		// Same local path as admin cancel — the channel already revoked
		// access, there is no paid period left to honor.
		actorLabel := "user:" + p.UserID
		if err := s.repo.ChangeWorkspacePlan(ctx, workspaceID, "free", actorLabel, "user cancel", now, s.planChangedTx(ctx, workspaceID, "free")); err != nil {
			return "", err
		}
		if err := s.repo.SetWorkspaceSubscription(ctx, workspaceID, "", time.Time{}, now); err != nil {
			return "", err
		}
		if s.hooks.OnPlanChanged != nil {
			if err := s.hooks.OnPlanChanged(ctx, workspaceID, fromPlan, "free"); err != nil {
				s.log.Error("OnPlanChanged hook failed", "err", err)
			}
		}
		s.auditWSWithPrincipal(ctx, workspaceID, p, "billing.subscription_canceled",
			map[string]any{"admin": false, "subscription_ref": subRef})
		return CancelOutcomeCancelled, nil
	}

	// Period end (declared, or undeclared timing on a canceller channel —
	// the promise-preserving default): the buyer keeps what they paid for.
	// Only the mark is set; the plan/subscription rows are untouched, and the
	// expiry sweeper collects the workspace if the period runs out without a
	// renewal (the renewal-no-show case is logged loudly by handleRenewed).
	if err := s.repo.SetWorkspaceCancelRequested(ctx, workspaceID, now); err != nil {
		return "", err
	}
	s.auditUserCancel(ctx, workspaceID, p, CancelOutcomePeriodEnd, subRef)
	return CancelOutcomePeriodEnd, nil
}

// replayCancelOutcome derives what an already-recorded cancel request means
// for the caller right now. The column stores only a timestamp, so the answer
// comes from live state:
//   - subscription and paid plan both gone → the cancel ran its course
//     (expiry sweeper / webhook) → cancelled;
//   - the channel behind the subscription is canceller-capable and not
//     immediate → period_end (the immediate path never leaves the mark);
//   - anything else → operator_pending (the queue still holds the request).
func (s *BillingService) replayCancelOutcome(ctx context.Context, workspaceID, subRef, fromPlan string) (string, error) {
	if subRef == "" && fromPlan == "free" {
		return CancelOutcomeCancelled, nil
	}
	if subRef != "" {
		ch, _, err := s.locateSubscriptionChannel(ctx, workspaceID)
		if err != nil {
			return "", err
		}
		if ch != nil {
			if _, hasCanceller := ch.(SubscriptionCanceller); hasCanceller && channelCancelTiming(ch) != CancelTimingImmediate {
				return CancelOutcomePeriodEnd, nil
			}
		}
	}
	return CancelOutcomeOperatorPending, nil
}

// channelCancelTiming resolves a channel's declared cancel timing, defaulting
// to period-end when a canceller channel declares none: an unknown timing must
// never cut a paying user short (the promise-preserving default, see
// CancelTiming).
func channelCancelTiming(ch PaymentChannel) CancelTiming {
	if viewer, ok := ch.(ChannelCapabilityViewer); ok && viewer.Capabilities().CancelTiming != "" {
		return viewer.Capabilities().CancelTiming
	}
	return CancelTimingPeriodEnd
}

// locateSubscriptionChannel finds the channel behind the workspace's latest
// paid recurring order. A nil channel with a non-empty reason is a CONDITION,
// not an error: the admin path surfaces it as 400 E_CHANNEL_CANCEL_UNSUPPORTED
// (subscriptionChannel), the user path routes it to the operator queue.
func (s *BillingService) locateSubscriptionChannel(ctx context.Context, workspaceID string) (PaymentChannel, string, error) {
	orders, err := s.repo.ListOrdersByWorkspace(ctx, workspaceID, 20)
	if err != nil {
		return nil, "", err
	}
	for _, o := range orders {
		if o.Status != domain.OrderPaid || o.Interval == domain.IntervalOneTime {
			continue
		}
		ch, ok := s.channels.Get(o.Channel)
		if !ok {
			return nil, "subscription channel not registered: " + o.Channel, nil
		}
		return ch, "", nil
	}
	return nil, "cannot locate subscription channel (no paid recurring order)", nil
}

func (s *BillingService) auditUserCancel(ctx context.Context, workspaceID string, p *webx.Principal, outcome, subRef string) {
	s.auditWSWithPrincipal(ctx, workspaceID, p, "billing.subscription_cancel_requested",
		map[string]any{"admin": false, "outcome": outcome, "subscription_ref": subRef})
}

// auditWSWithPrincipal is auditWS with the acting principal recorded — the
// user-cancel flows attribute the action to the requesting user instead of
// the system.
func (s *BillingService) auditWSWithPrincipal(ctx context.Context, wsID string, p *webx.Principal, action string, meta map[string]any) {
	if s.auditor != nil {
		s.auditor.Record(ctx, &wsID, p, action, "workspace", wsID, meta)
	}
}

// ListCancelRequests feeds the admin operator queue (LC-4): every workspace
// with a recorded cancel request that has not resolved yet.
func (s *BillingService) ListCancelRequests(ctx context.Context, limit int) ([]CancelRequestView, error) {
	if limit <= 0 {
		limit = 200
	}
	return s.repo.ListCancelRequestedWorkspaces(ctx, limit)
}

// CancelSnapshot is the cancel-state triple GET /api/billing/subscription
// exposes alongside plan/orders (R5): the framework-level data source for
// account-settings UIs (ui LegalAndPrivacySection) to render "取消请求已于 X
// 受理 / 当前周期至 Y / 取消立即生效" without product-side assembly.
//
// All three fields are nullable; a free workspace with no subscription (the
// 409-free GET shape) answers nulls, never an error.
type CancelSnapshot struct {
	// CancelRequestedAt is when the user's cancel request was recorded
	// (migration 053 mark); null = no pending request.
	CancelRequestedAt *time.Time `json:"cancel_requested_at"`
	// RenewsAt is workspace.plan_expires_at — the end of the currently paid
	// period (what a period-end cancel keeps access until); null = perpetual
	// or manual plan.
	RenewsAt *time.Time `json:"renews_at"`
	// CancelTiming is the subscription channel's DECLARED cancel timing
	// (undeclared canceller channels surface the period_end default the
	// cancel flow applies); null = no channel subscription, channel not
	// registered, or channel without a canceller (operator-queue shape).
	CancelTiming *CancelTiming `json:"cancel_timing"`
}

// GetCancelSnapshot assembles the cancel-state triple for the subscription
// view. Channel-location conditions (no paid recurring order, unregistered
// channel) surface as a null timing, not an error — the subscription GET must
// answer for every workspace shape; only real storage failures fail it.
func (s *BillingService) GetCancelSnapshot(ctx context.Context, workspaceID string) (CancelSnapshot, error) {
	var snap CancelSnapshot

	if at, ok, err := s.repo.GetWorkspaceCancelRequested(ctx, workspaceID); err != nil {
		return snap, err
	} else if ok {
		snap.CancelRequestedAt = &at
	}

	if exp, ok, err := s.repo.GetWorkspacePlanExpiry(ctx, workspaceID); err != nil {
		return snap, err
	} else if ok {
		snap.RenewsAt = &exp
	}

	if subRef, ok, err := s.repo.GetWorkspaceSubscription(ctx, workspaceID); err != nil {
		return snap, err
	} else if ok && subRef != "" {
		if ch, _, err := s.locateSubscriptionChannel(ctx, workspaceID); err != nil {
			return snap, err
		} else if ch != nil {
			if _, hasCanceller := ch.(SubscriptionCanceller); hasCanceller {
				timing := channelCancelTiming(ch)
				snap.CancelTiming = &timing
			}
		}
	}
	return snap, nil
}
