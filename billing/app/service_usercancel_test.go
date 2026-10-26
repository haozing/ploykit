package app

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/platform/webx"
)

// ---- fakeRepo: LC-4 cancel_requested_at bookkeeping (migration 053 shape) ----

func (f *fakeRepo) SetWorkspaceCancelRequested(_ context.Context, ws string, now time.Time) error {
	if !f.wsExists[ws] {
		return fmt.Errorf("set workspace cancel requested: workspace not found: %s", ws)
	}
	f.setCancelReqs = append(f.setCancelReqs, ws)
	f.wsCancelReq[ws] = now
	return nil
}

func (f *fakeRepo) GetWorkspaceCancelRequested(_ context.Context, ws string) (time.Time, bool, error) {
	at, ok := f.wsCancelReq[ws]
	return at, ok, nil
}

// GetWorkspacePlanExpiry mirrors the pgrepo read (R5): the paid period end off
// the workspace subscription state; no sub or zero expiry = not present.
func (f *fakeRepo) GetWorkspacePlanExpiry(_ context.Context, ws string) (time.Time, bool, error) {
	st, ok := f.wsSub[ws]
	if !ok || st.expiresAt.IsZero() {
		return time.Time{}, false, nil
	}
	return st.expiresAt, true, nil
}

func (f *fakeRepo) ClearWorkspaceCancelRequested(_ context.Context, ws string) error {
	f.clearCancelReqs = append(f.clearCancelReqs, ws)
	delete(f.wsCancelReq, ws)
	return nil
}

func (f *fakeRepo) ListCancelRequestedWorkspaces(_ context.Context, limit int) ([]CancelRequestView, error) {
	ids := make([]string, 0, len(f.wsCancelReq))
	for ws := range f.wsCancelReq {
		ids = append(ids, ws)
	}
	sort.Strings(ids)
	if limit > 0 && len(ids) > limit {
		ids = ids[:limit]
	}
	out := make([]CancelRequestView, 0, len(ids))
	for _, ws := range ids {
		out = append(out, CancelRequestView{
			WorkspaceID: ws, RequestedAt: f.wsCancelReq[ws],
			PlanCode: f.wsPlan[ws], SubscriptionRef: f.wsSub[ws].ref,
		})
	}
	return out, nil
}

// cancelChannel is a cfgChannel that also declares capabilities, so the
// user-cancel flow can be driven with any CancelTiming.
type cancelChannel struct {
	*cfgChannel
	caps ChannelCaps
}

func (c *cancelChannel) Capabilities() ChannelCaps { return c.caps }

func newCancelChannel(name string, timing CancelTiming) *cancelChannel {
	return &cancelChannel{
		cfgChannel: &cfgChannel{name: name, configured: true},
		caps:       ChannelCaps{CancelTiming: timing},
	}
}

func userPrincipal(ws string) *webx.Principal {
	return &webx.Principal{UserID: "usr_1", WorkspaceID: ws}
}

func TestUserCancelSubscription_Outcomes(t *testing.T) {
	t.Run("CancelTimingImmediate → channel cancel + 本地立即降级（同 admin 语义）+ cancelled", func(t *testing.T) {
		repo := &cfgRepo{fakeRepo: newFakeRepo()}
		ch := newCancelChannel("paypal", CancelTimingImmediate)
		subFixture(repo, "paypal", "ws_1")
		svc, aud, hooks := newCancelSvc(repo, ch)

		outcome, err := svc.UserCancelSubscription(context.Background(), userPrincipal("ws_1"), "ws_1")
		require.NoError(t, err)
		assert.Equal(t, CancelOutcomeCancelled, outcome)

		assert.Equal(t, []string{"sub_1"}, ch.cancelCalls)
		require.Len(t, repo.changePlans, 1)
		assert.Equal(t, changePlanCall{ws: "ws_1", to: "free", actor: "user:usr_1", reason: "user cancel"}, repo.changePlans[0])
		require.Len(t, repo.setSubs, 1)
		assert.Equal(t, setSubCall{ws: "ws_1", ref: ""}, repo.setSubs[0])
		assert.Equal(t, "free", repo.wsPlan["ws_1"])
		assert.Equal(t, [][3]string{{"ws_1", "pro", "free"}}, hooks.planChanged)

		require.Len(t, aud.calls, 1)
		assert.Equal(t, "billing.subscription_canceled", aud.calls[0].action)
		assert.Equal(t, map[string]any{"admin": false, "subscription_ref": "sub_1"}, aud.calls[0].meta)

		_, pending, err := svc.repo.GetWorkspaceCancelRequested(context.Background(), "ws_1")
		require.NoError(t, err)
		assert.False(t, pending, "immediate path resolves fully; no operator-queue mark")
	})

	t.Run("CancelTimingPeriodEnd → channel cancel + 只置 cancel_requested_at，plan/订阅不动", func(t *testing.T) {
		repo := &cfgRepo{fakeRepo: newFakeRepo()}
		ch := newCancelChannel("waffo", CancelTimingPeriodEnd)
		subFixture(repo, "waffo", "ws_1")
		svc, aud, hooks := newCancelSvc(repo, ch)

		outcome, err := svc.UserCancelSubscription(context.Background(), userPrincipal("ws_1"), "ws_1")
		require.NoError(t, err)
		assert.Equal(t, CancelOutcomePeriodEnd, outcome)

		assert.Equal(t, []string{"sub_1"}, ch.cancelCalls, "渠道直通取消仍然发生")
		assert.Empty(t, repo.changePlans, "周期末语义：plan 不动")
		assert.Empty(t, repo.setSubs, "订阅行不动")
		assert.Equal(t, "pro", repo.wsPlan["ws_1"])
		assert.Empty(t, hooks.planChanged)

		require.Len(t, repo.setCancelReqs, 1)
		assert.Equal(t, testNow, repo.wsCancelReq["ws_1"])
		require.Len(t, aud.calls, 1)
		assert.Equal(t, "billing.subscription_cancel_requested", aud.calls[0].action)
		assert.Equal(t, map[string]any{"admin": false, "outcome": "period_end", "subscription_ref": "sub_1"}, aud.calls[0].meta)
	})

	t.Run("CancelTiming 未声明（空串）→ 按 period_end 兜底（不截断已付费周期）", func(t *testing.T) {
		repo := &cfgRepo{fakeRepo: newFakeRepo()}
		ch := newCancelChannel("mystery", "")
		subFixture(repo, "mystery", "ws_1")
		svc, _, _ := newCancelSvc(repo, ch)

		outcome, err := svc.UserCancelSubscription(context.Background(), userPrincipal("ws_1"), "ws_1")
		require.NoError(t, err)
		assert.Equal(t, CancelOutcomePeriodEnd, outcome)
		assert.Empty(t, repo.changePlans)
		_, pending, _ := svc.repo.GetWorkspaceCancelRequested(context.Background(), "ws_1")
		assert.True(t, pending)
	})

	t.Run("渠道未实现 SubscriptionCanceller → 200 语义受理：置标 + operator_pending，不碰渠道", func(t *testing.T) {
		repo := &cfgRepo{fakeRepo: newFakeRepo()}
		subFixture(repo, "plain", "ws_1")
		svc, aud, _ := newCancelSvc(repo, &plainChannel{name: "plain"})

		outcome, err := svc.UserCancelSubscription(context.Background(), userPrincipal("ws_1"), "ws_1")
		require.NoError(t, err, "无 canceller 不是错误：用户请求被受理（HTTP 层 200）")
		assert.Equal(t, CancelOutcomeOperatorPending, outcome)

		assert.Equal(t, []string{"ws_1"}, repo.setCancelReqs)
		assert.Empty(t, repo.changePlans)
		assert.Empty(t, repo.setSubs)
		assert.Equal(t, "pro", repo.wsPlan["ws_1"])
		require.Len(t, aud.calls, 1)
		assert.Equal(t, map[string]any{"admin": false, "outcome": "operator_pending", "subscription_ref": "sub_1"}, aud.calls[0].meta)
	})

	t.Run("订阅渠道不在注册表（运行时摘除）→ operator_pending（运营处置，不是 4xx）", func(t *testing.T) {
		repo := &cfgRepo{fakeRepo: newFakeRepo()}
		subFixture(repo, "gonechan", "ws_1")
		svc, _, _ := newCancelSvc(repo)

		outcome, err := svc.UserCancelSubscription(context.Background(), userPrincipal("ws_1"), "ws_1")
		require.NoError(t, err)
		assert.Equal(t, CancelOutcomeOperatorPending, outcome)
		assert.Equal(t, []string{"ws_1"}, repo.setCancelReqs)
	})

	t.Run("无渠道订阅的手工套餐 → operator_pending（运营即渠道，不静默降级管理员手工授予）", func(t *testing.T) {
		repo := &cfgRepo{fakeRepo: newFakeRepo()}
		repo.wsExists["ws_1"] = true
		repo.wsPlan["ws_1"] = "pro"
		svc, _, _ := newCancelSvc(repo, &ManualChannel{})

		outcome, err := svc.UserCancelSubscription(context.Background(), userPrincipal("ws_1"), "ws_1")
		require.NoError(t, err)
		assert.Equal(t, CancelOutcomeOperatorPending, outcome)
		assert.Empty(t, repo.changePlans)
		assert.True(t, repo.wsCancelReq["ws_1"].Equal(testNow))
	})

	t.Run("渠道取消失败 → 502 且本地状态不变（可重试）", func(t *testing.T) {
		repo := &cfgRepo{fakeRepo: newFakeRepo()}
		ch := newCancelChannel("paypal", CancelTimingImmediate)
		ch.cancelErr = assert.AnError
		subFixture(repo, "paypal", "ws_1")
		svc, _, _ := newCancelSvc(repo, ch)

		outcome, err := svc.UserCancelSubscription(context.Background(), userPrincipal("ws_1"), "ws_1")
		require.Error(t, err)
		assert.Empty(t, outcome)
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusBadGateway, we.Status)
		assert.Empty(t, repo.changePlans)
		assert.Empty(t, repo.setCancelReqs)
		assert.Equal(t, "pro", repo.wsPlan["ws_1"])
	})

	t.Run("free 且无订阅 → 409", func(t *testing.T) {
		repo := &cfgRepo{fakeRepo: newFakeRepo()}
		repo.wsExists["ws_1"] = true
		repo.wsPlan["ws_1"] = "free"
		svc, _, _ := newCancelSvc(repo)

		_, err := svc.UserCancelSubscription(context.Background(), userPrincipal("ws_1"), "ws_1")
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusConflict, we.Status)
	})

	t.Run("工作区不存在 → 404", func(t *testing.T) {
		svc, _, _ := newCancelSvc(&cfgRepo{fakeRepo: newFakeRepo()})
		_, err := svc.UserCancelSubscription(context.Background(), userPrincipal("ws_ghost"), "ws_ghost")
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusNotFound, we.Status)
	})
}

func TestUserCancelSubscription_Authz(t *testing.T) {
	setup := func() (*cfgRepo, *BillingService) {
		repo := &cfgRepo{fakeRepo: newFakeRepo()}
		subFixture(repo, "paypal", "ws_1")
		svc, _, _ := newCancelSvc(repo, newCancelChannel("paypal", CancelTimingImmediate))
		return repo, svc
	}

	t.Run("无 principal → 401", func(t *testing.T) {
		_, svc := setup()
		_, err := svc.UserCancelSubscription(context.Background(), nil, "ws_1")
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusUnauthorized, we.Status)
	})

	t.Run("principal 无工作区上下文 → 401", func(t *testing.T) {
		_, svc := setup()
		_, err := svc.UserCancelSubscription(context.Background(), &webx.Principal{UserID: "usr_1"}, "ws_1")
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusUnauthorized, we.Status)
	})

	t.Run("他人工作区（普通成员）→ 404 且零副作用", func(t *testing.T) {
		repo, svc := setup()
		_, err := svc.UserCancelSubscription(context.Background(), userPrincipal("ws_other"), "ws_1")
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusNotFound, we.Status)
		assert.Empty(t, repo.changePlans)
		assert.Empty(t, repo.setCancelReqs)
	})

	t.Run("平台管理员（不在本工作区）也不可代取消 → 404", func(t *testing.T) {
		repo, svc := setup()
		admin := &webx.Principal{UserID: "root_1", WorkspaceID: "ws_root", IsPlatformAdmin: true}
		_, err := svc.UserCancelSubscription(context.Background(), admin, "ws_1")
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusNotFound, we.Status)
		assert.Empty(t, repo.changePlans)
		assert.Empty(t, repo.setCancelReqs)
	})
}

func TestUserCancelSubscription_Idempotent(t *testing.T) {
	t.Run("period_end：重复调用 → 同 outcome，不二次调渠道不重写标记", func(t *testing.T) {
		repo := &cfgRepo{fakeRepo: newFakeRepo()}
		ch := newCancelChannel("waffo", CancelTimingPeriodEnd)
		subFixture(repo, "waffo", "ws_1")
		svc, _, _ := newCancelSvc(repo, ch)

		for i := 0; i < 2; i++ {
			outcome, err := svc.UserCancelSubscription(context.Background(), userPrincipal("ws_1"), "ws_1")
			require.NoError(t, err)
			assert.Equal(t, CancelOutcomePeriodEnd, outcome)
		}
		assert.Equal(t, []string{"sub_1"}, ch.cancelCalls, "渠道只取消一次")
		assert.Equal(t, []string{"ws_1"}, repo.setCancelReqs, "标记只写一次")
	})

	t.Run("operator_pending：重复调用 → 同 outcome 幂等", func(t *testing.T) {
		repo := &cfgRepo{fakeRepo: newFakeRepo()}
		subFixture(repo, "plain", "ws_1")
		svc, _, _ := newCancelSvc(repo, &plainChannel{name: "plain"})

		for i := 0; i < 2; i++ {
			outcome, err := svc.UserCancelSubscription(context.Background(), userPrincipal("ws_1"), "ws_1")
			require.NoError(t, err)
			assert.Equal(t, CancelOutcomeOperatorPending, outcome)
		}
		assert.Equal(t, []string{"ws_1"}, repo.setCancelReqs)
	})

	t.Run("标记在而订阅已结束（plan=free 且无订阅号）→ cancelled（请求已走完）", func(t *testing.T) {
		repo := &cfgRepo{fakeRepo: newFakeRepo()}
		repo.wsExists["ws_1"] = true
		repo.wsPlan["ws_1"] = "free"
		repo.wsCancelReq["ws_1"] = testNow
		svc, _, _ := newCancelSvc(repo)

		outcome, err := svc.UserCancelSubscription(context.Background(), userPrincipal("ws_1"), "ws_1")
		require.NoError(t, err)
		assert.Equal(t, CancelOutcomeCancelled, outcome)
		assert.Empty(t, repo.setCancelReqs, "重放不产生新写入")
	})
}

// logSink captures records at or above a level (slog.Handler for the renewal
// ERROR assertion).
type logSink struct {
	min     slog.Level
	records []slog.Record
}

func (h *logSink) Enabled(_ context.Context, l slog.Level) bool { return l >= h.min }
func (h *logSink) Handle(_ context.Context, r slog.Record) error {
	h.records = append(h.records, r)
	return nil
}
func (h *logSink) WithAttrs(_ []slog.Attr) slog.Handler { return h }
func (h *logSink) WithGroup(_ string) slog.Handler      { return h }

func (h *logSink) findError(substr string) bool {
	for _, r := range h.records {
		if r.Level == slog.LevelError && strings.Contains(r.Message, substr) {
			return true
		}
	}
	return false
}

func TestUserCancelSubscription_RenewalAfterCancelRequest(t *testing.T) {
	newRenewalSvc := func(repo *cfgRepo, sink *logSink) *BillingService {
		reg := NewChannelRegistry()
		reg.Register(&fakeChannel{event: domain.PaymentEvent{
			Channel: "stripe", ChannelEventID: "evt_r", Type: domain.EventSubscriptionRenewed,
			SubscriptionRef: "sub_r",
		}})
		return NewBillingService(repo, reg, Config{}, BillingHooks{}, nil,
			func() time.Time { return testNow }, slog.New(sink))
	}

	t.Run("cancel_requested 已置又收到续费成功 → ERROR 日志 + 权益照付 + 标记保留 + 不自动退款", func(t *testing.T) {
		repo := &cfgRepo{fakeRepo: newFakeRepo()}
		repo.wsPlan["ws_9"] = "pro"
		repo.bySub["sub_r"] = "ws_9"
		repo.wsSub["ws_9"] = subState{ref: "sub_r", expiresAt: testNow.Add(-time.Hour)}
		repo.wsCancelReq["ws_9"] = testNow.Add(-24 * time.Hour)
		repo.paidIv["ws_9"] = domain.IntervalMonthly
		sink := &logSink{min: slog.LevelInfo}
		svc := newRenewalSvc(repo, sink)

		require.NoError(t, svc.HandleWebhook(context.Background(), "stripe", WebhookRequest{}))

		assert.True(t, sink.findError("cancel request"),
			"钱照收=渠道侧没停，必须打 ERROR 供运营介入；got records: %v", sink.records)
		require.Len(t, repo.setSubs, 1, "已扣款的周期照常延长（不自动退款）")
		assert.Equal(t, setSubCall{ws: "ws_9", ref: "sub_r", expiresAt: testNow.AddDate(0, 1, 0)}, repo.setSubs[0])
		_, pending, _ := repo.GetWorkspaceCancelRequested(context.Background(), "ws_9")
		assert.True(t, pending, "运营队列条目保留（渠道侧仍未停）")
		assert.Empty(t, repo.clearCancelReqs)
	})

	t.Run("无 cancel_requested 的正常续费 → 无 ERROR", func(t *testing.T) {
		repo := &cfgRepo{fakeRepo: newFakeRepo()}
		repo.wsPlan["ws_8"] = "pro"
		repo.bySub["sub_r2"] = "ws_8"
		repo.wsSub["ws_8"] = subState{ref: "sub_r2", expiresAt: testNow.Add(-time.Hour)}
		sink := &logSink{min: slog.LevelInfo}
		svc := newRenewalSvc(repo, sink)

		require.NoError(t, svc.HandleWebhook(context.Background(), "stripe", WebhookRequest{}))
		assert.False(t, sink.findError("cancel request"))
	})
}

func TestUserCancelSubscription_ResubscribeClearsMark(t *testing.T) {
	repo := newFakeRepo()
	repo.plans["pro"] = domain.Plan{Code: "pro", Limits: map[string]int{"price_monthly_cents": 9900}}
	repo.orders["ord_1"] = &domain.Order{
		ID: "ord_1", WorkspaceID: "ws_1", PlanCode: "pro",
		Interval: domain.IntervalMonthly, Status: domain.OrderPending,
		AmountCents: 9900, Currency: "usd",
	}
	repo.wsCancelReq["ws_1"] = testNow.Add(-24 * time.Hour) // stale request
	reg := NewChannelRegistry()
	reg.Register(&fakeChannel{event: domain.PaymentEvent{
		Channel: "stripe", ChannelEventID: "evt_p", Type: domain.EventCheckoutCompleted,
		OrderID: "ord_1", SubscriptionRef: "sub_new", AmountCents: 9900,
	}})
	repo.wsExists["ws_1"] = true
	repo.wsPlan["ws_1"] = "free"
	svc := NewBillingService(repo, reg, Config{}, BillingHooks{}, nil,
		func() time.Time { return testNow }, nil)

	require.NoError(t, svc.HandleWebhook(context.Background(), "stripe", WebhookRequest{}))

	_, pending, err := repo.GetWorkspaceCancelRequested(context.Background(), "ws_1")
	require.NoError(t, err)
	assert.False(t, pending, "再次订阅（新订单支付完成）必须清除 cancel_requested_at")
	assert.Equal(t, []string{"ws_1"}, repo.clearCancelReqs)
}

func TestAdminCancelSubscription_ClearsCancelRequest(t *testing.T) {
	repo := &cfgRepo{fakeRepo: newFakeRepo()}
	ch := &cfgChannel{name: "stripe", configured: true}
	subFixture(repo, "stripe", "ws_1")
	repo.wsCancelReq["ws_1"] = testNow.Add(-24 * time.Hour)
	svc, _, _ := newCancelSvc(repo, ch)

	require.NoError(t, svc.AdminCancelSubscription(context.Background(), principal(), "ws_1"))

	_, pending, err := repo.GetWorkspaceCancelRequested(context.Background(), "ws_1")
	require.NoError(t, err)
	assert.False(t, pending, "管理员完成取消 = 运营队列条目了结")
	assert.Equal(t, []string{"ws_1"}, repo.clearCancelReqs)
}

func TestHandleCanceledWebhook_ClearsCancelRequest(t *testing.T) {
	repo := newFakeRepo()
	repo.wsPlan["ws_1"] = "pro"
	repo.bySub["sub_1"] = "ws_1"
	repo.wsSub["ws_1"] = subState{ref: "sub_1", expiresAt: testNow.AddDate(0, 1, 0)}
	repo.wsCancelReq["ws_1"] = testNow.Add(-24 * time.Hour)
	reg := NewChannelRegistry()
	reg.Register(&fakeChannel{event: domain.PaymentEvent{
		Channel: "stripe", ChannelEventID: "evt_c", Type: domain.EventSubscriptionCanceled,
		SubscriptionRef: "sub_1",
	}})
	svc := NewBillingService(repo, reg, Config{}, BillingHooks{}, nil,
		func() time.Time { return testNow }, nil)

	require.NoError(t, svc.HandleWebhook(context.Background(), "stripe", WebhookRequest{}))

	_, pending, err := repo.GetWorkspaceCancelRequested(context.Background(), "ws_1")
	require.NoError(t, err)
	assert.False(t, pending, "渠道确认订阅结束 → 请求了结，出运营队列")
}

func TestListCancelRequests(t *testing.T) {
	repo := &cfgRepo{fakeRepo: newFakeRepo()}
	repo.wsExists["ws_1"] = true
	repo.wsPlan["ws_1"] = "pro"
	repo.wsSub["ws_1"] = subState{ref: "sub_1"}
	repo.wsCancelReq["ws_1"] = testNow
	repo.wsExists["ws_2"] = true
	repo.wsPlan["ws_2"] = "pro"
	repo.wsCancelReq["ws_2"] = testNow.Add(-time.Hour)
	svc, _, _ := newCancelSvc(repo)

	items, err := svc.ListCancelRequests(context.Background(), 0)
	require.NoError(t, err)
	require.Len(t, items, 2)
	assert.Equal(t, CancelRequestView{
		WorkspaceID: "ws_1", RequestedAt: testNow, PlanCode: "pro", SubscriptionRef: "sub_1",
	}, items[0])
	assert.Equal(t, CancelRequestView{
		WorkspaceID: "ws_2", RequestedAt: testNow.Add(-time.Hour), PlanCode: "pro",
	}, items[1])

	limited, err := svc.ListCancelRequests(context.Background(), 1)
	require.NoError(t, err)
	assert.Len(t, limited, 1)
}

// ---- R5: cancel-state snapshot for GET /api/billing/subscription ----

func TestGetCancelSnapshot(t *testing.T) {
	t.Run("period_end 渠道 + 待处理取消 → 三字段齐", func(t *testing.T) {
		repo := &cfgRepo{fakeRepo: newFakeRepo()}
		ch := newCancelChannel("waffo", CancelTimingPeriodEnd)
		subFixture(repo, "waffo", "ws_1")
		repo.wsCancelReq["ws_1"] = testNow
		svc, _, _ := newCancelSvc(repo, ch)

		snap, err := svc.GetCancelSnapshot(context.Background(), "ws_1")
		require.NoError(t, err)
		require.NotNil(t, snap.CancelRequestedAt)
		assert.True(t, snap.CancelRequestedAt.Equal(testNow))
		require.NotNil(t, snap.RenewsAt)
		assert.True(t, snap.RenewsAt.Equal(testNow.AddDate(0, 1, 0)), "subFixture 的周期期末")
		require.NotNil(t, snap.CancelTiming)
		assert.Equal(t, CancelTimingPeriodEnd, *snap.CancelTiming)
	})

	t.Run("immediate 渠道 → cancel_timing=immediate，无取消请求时 requested 为 null", func(t *testing.T) {
		repo := &cfgRepo{fakeRepo: newFakeRepo()}
		ch := newCancelChannel("stripe", CancelTimingImmediate)
		subFixture(repo, "stripe", "ws_1")
		svc, _, _ := newCancelSvc(repo, ch)

		snap, err := svc.GetCancelSnapshot(context.Background(), "ws_1")
		require.NoError(t, err)
		assert.Nil(t, snap.CancelRequestedAt, "尚未请求取消")
		require.NotNil(t, snap.CancelTiming)
		assert.Equal(t, CancelTimingImmediate, *snap.CancelTiming)
	})

	t.Run("未声明时序的 canceller 渠道 → 按 period_end 兜底（与取消流一致）", func(t *testing.T) {
		repo := &cfgRepo{fakeRepo: newFakeRepo()}
		ch := newCancelChannel("mystery", "")
		subFixture(repo, "mystery", "ws_1")
		svc, _, _ := newCancelSvc(repo, ch)

		snap, err := svc.GetCancelSnapshot(context.Background(), "ws_1")
		require.NoError(t, err)
		require.NotNil(t, snap.CancelTiming)
		assert.Equal(t, CancelTimingPeriodEnd, *snap.CancelTiming)
	})

	t.Run("409-free 形态：free 工作区无订阅 → 全 null 不报错", func(t *testing.T) {
		repo := &cfgRepo{fakeRepo: newFakeRepo()}
		repo.wsExists["ws_free"] = true
		repo.wsPlan["ws_free"] = "free"
		svc, _, _ := newCancelSvc(repo)

		snap, err := svc.GetCancelSnapshot(context.Background(), "ws_free")
		require.NoError(t, err, "订阅 GET 对 free 工作区必须照常 200，快照不得炸")
		assert.Nil(t, snap.CancelRequestedAt)
		assert.Nil(t, snap.RenewsAt)
		assert.Nil(t, snap.CancelTiming)
	})

	t.Run("无 canceller 渠道 → timing=null（运营队列形态）", func(t *testing.T) {
		repo := &cfgRepo{fakeRepo: newFakeRepo()}
		subFixture(repo, "plain", "ws_1")
		svc, _, _ := newCancelSvc(repo, &plainChannel{name: "plain"})

		snap, err := svc.GetCancelSnapshot(context.Background(), "ws_1")
		require.NoError(t, err)
		assert.Nil(t, snap.CancelTiming, "ports.go：无 canceller 的渠道不读时序声明")
		assert.NotNil(t, snap.RenewsAt, "周期期末照常暴露")
	})
}
