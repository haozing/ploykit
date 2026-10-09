package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/platform/webx"
)

func paidChannel(eventID, orderID string) *fakeChannel {
	return &fakeChannel{event: domain.PaymentEvent{
		Channel: "stripe", ChannelEventID: eventID, Type: domain.EventCheckoutCompleted, OrderID: orderID,
	}}
}

func TestHandleWebhook_Paid_UpdateError_MarksEventError_BQ1(t *testing.T) {
	repo := newFakeRepo()
	repo.orders["ord_1"] = &domain.Order{ID: "ord_1", WorkspaceID: "ws_1", PlanCode: "pro", Status: domain.OrderPending}
	repo.updateStatusErr = errors.New("db connection reset")
	svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{}, &fakeAuditor{},
		func() time.Time { return testNow }, nil)
	svc.channels.Register(paidChannel("evt_e1", "ord_1"))

	err := svc.HandleWebhook(context.Background(), "stripe", WebhookRequest{})
	require.Error(t, err, "非冲突错误必须上抛（渠道重试的信号）")
	assert.ErrorIs(t, err, repo.updateStatusErr)

	assert.False(t, repo.processed["stripe:evt_e1"], "DB 故障不得标 processed（事件会永久丢失）")
	require.Contains(t, repo.eventErrors, "stripe:evt_e1", "事件应标 error 可重放")
	assert.NotEmpty(t, repo.eventErrors["stripe:evt_e1"])
	assert.Equal(t, domain.OrderPending, repo.orders["ord_1"].Status)
	assert.Empty(t, repo.changePlans, "未完成支付前不得变更套餐")
}

func TestHandleWebhook_Paid_StatusConflict_Idempotent_BQ1(t *testing.T) {
	repo := newFakeRepo()
	repo.orders["ord_1"] = &domain.Order{ID: "ord_1", WorkspaceID: "ws_1", PlanCode: "pro", Status: domain.OrderPaid}
	svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{}, &fakeAuditor{},
		func() time.Time { return testNow }, nil)
	svc.channels.Register(paidChannel("evt_c1", "ord_1"))

	require.NoError(t, svc.HandleWebhook(context.Background(), "stripe", WebhookRequest{}))
	assert.True(t, repo.processed["stripe:evt_c1"], "重复 webhook 应幂等收敛 processed")
	assert.Empty(t, repo.eventErrors)
	assert.Equal(t, domain.OrderPaid, repo.orders["ord_1"].Status)
}

func TestHandleWebhook_Paid_ResolveError_MarksEventError_BQ1(t *testing.T) {
	repo := newFakeRepo()
	repo.orders["ord_1"] = &domain.Order{ID: "ord_1", WorkspaceID: "ws_1", Status: domain.OrderPending}
	repo.getOrderErr = errors.New("get order: ctx deadline")
	svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{}, &fakeAuditor{},
		func() time.Time { return testNow }, nil)
	svc.channels.Register(paidChannel("evt_e2", "ord_1"))

	err := svc.HandleWebhook(context.Background(), "stripe", WebhookRequest{})
	require.Error(t, err)
	assert.False(t, repo.processed["stripe:evt_e2"], "resolveOrder 的 DB 错误不得终态 processed")
	require.Contains(t, repo.eventErrors, "stripe:evt_e2")
}

func TestHandleWebhook_Paid_ErrorEventReplayedAndRecovered_BQ1(t *testing.T) {
	repo := newFakeRepo()
	repo.plans["pro"] = domain.Plan{Code: "pro", Limits: map[string]int{"price_monthly_cents": 9900}}
	repo.orders["ord_1"] = &domain.Order{ID: "ord_1", WorkspaceID: "ws_1", PlanCode: "pro",
		Interval: domain.IntervalMonthly, Status: domain.OrderPending}
	hooks := &hookTrace{}
	svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{
		OnPlanChanged: func(_ context.Context, _, from, to string) error {
			hooks.planChanged = append(hooks.planChanged, [3]string{"ws_1", from, to})
			return nil
		},
	}, &fakeAuditor{}, func() time.Time { return testNow }, nil)
	svc.channels.Register(paidChannel("evt_r1", "ord_1"))

	repo.updateStatusErr = errors.New("transient db failure")
	require.Error(t, svc.HandleWebhook(context.Background(), "stripe", WebhookRequest{}))
	require.Contains(t, repo.eventErrors, "stripe:evt_r1")
	assert.False(t, repo.processed["stripe:evt_r1"])

	repo.updateStatusErr = nil
	require.NoError(t, svc.HandleWebhook(context.Background(), "stripe", WebhookRequest{}))
	assert.Equal(t, domain.OrderPaid, repo.orders["ord_1"].Status)
	assert.Equal(t, "pro", repo.wsPlan["ws_1"])
	require.Len(t, hooks.planChanged, 1, "重放成功后套餐变更钩子恰触发一次")
	assert.True(t, repo.processed["stripe:evt_r1"])
}

func TestHandleWebhook_Failed_UpdateError_MarksEventError_BQ1(t *testing.T) {
	repo := newFakeRepo()
	repo.orders["ord_1"] = &domain.Order{ID: "ord_1", WorkspaceID: "ws_1", Status: domain.OrderPending}

	repo.updateStatusErr = errors.New("db down")
	svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{}, &fakeAuditor{},
		func() time.Time { return testNow }, nil)
	svc.channels.Register(&fakeChannel{event: domain.PaymentEvent{
		Channel: "stripe", ChannelEventID: "evt_f1", Type: domain.EventPaymentFailed, OrderID: "ord_1",
	}})
	require.Error(t, svc.HandleWebhook(context.Background(), "stripe", WebhookRequest{}))
	require.Contains(t, repo.eventErrors, "stripe:evt_f1")
	assert.False(t, repo.processed["stripe:evt_f1"])

	repo.updateStatusErr = nil
	repo.orders["ord_1"].Status = domain.OrderFailed
	svc.channels.Register(&fakeChannel{event: domain.PaymentEvent{
		Channel: "stripe", ChannelEventID: "evt_f2", Type: domain.EventPaymentFailed, OrderID: "ord_1",
	}})
	require.NoError(t, svc.HandleWebhook(context.Background(), "stripe", WebhookRequest{}))
	assert.True(t, repo.processed["stripe:evt_f2"])
}

func TestHandleWebhook_Refund_RecoversPlanAndSubscription_BQ3(t *testing.T) {
	repo := newFakeRepo()
	repo.orders["ord_1"] = &domain.Order{ID: "ord_1", WorkspaceID: "ws_1", PlanCode: "pro", Status: domain.OrderPaid}
	repo.wsPlan["ws_1"] = "pro"
	repo.wsSub["ws_1"] = subState{ref: "sub_1", expiresAt: testNow.AddDate(0, 1, 0)}
	repo.bySub["sub_1"] = "ws_1"
	hooks := &hookTrace{}
	svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{
		OnPlanChanged: func(_ context.Context, ws, from, to string) error {
			hooks.planChanged = append(hooks.planChanged, [3]string{ws, from, to})
			return nil
		},
	}, &fakeAuditor{}, func() time.Time { return testNow }, nil)
	svc.channels.Register(&fakeChannel{event: domain.PaymentEvent{
		Channel: "stripe", ChannelEventID: "evt_rf", Type: domain.EventRefundCreated,
		OrderID: "ord_1", SubscriptionRef: "sub_1",
	}})

	require.NoError(t, svc.HandleWebhook(context.Background(), "stripe", WebhookRequest{}))
	assert.Equal(t, domain.OrderRefunded, repo.orders["ord_1"].Status)

	require.Len(t, repo.changePlans, 1, "退款必须降级 free（BQ3：钩子是通知不是状态变更）")
	assert.Equal(t, "ws_1", repo.changePlans[0].ws)
	assert.Equal(t, "free", repo.changePlans[0].to)
	assert.Equal(t, "webhook:stripe", repo.changePlans[0].actor)
	assert.Equal(t, "refund:ord_1", repo.changePlans[0].reason)
	assert.Equal(t, "free", repo.wsPlan["ws_1"])

	require.Len(t, repo.setSubs, 1)
	assert.Equal(t, "", repo.setSubs[0].ref)
	_, still := repo.bySub["sub_1"]
	assert.False(t, still, "订阅号反查应失效")

	require.Len(t, hooks.planChanged, 1)
	assert.Equal(t, [3]string{"ws_1", "pro", "free"}, hooks.planChanged[0])
	assert.True(t, repo.processed["stripe:evt_rf"])
}

func TestHandleWebhook_Refund_StatusConflict_NoDoubleDowngrade_BQ3(t *testing.T) {
	repo := newFakeRepo()
	repo.orders["ord_1"] = &domain.Order{ID: "ord_1", WorkspaceID: "ws_1", PlanCode: "pro", Status: domain.OrderRefunded}
	svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{}, &fakeAuditor{},
		func() time.Time { return testNow }, nil)
	svc.channels.Register(&fakeChannel{event: domain.PaymentEvent{
		Channel: "stripe", ChannelEventID: "evt_rf2", Type: domain.EventRefundCreated, OrderID: "ord_1",
	}})

	require.NoError(t, svc.HandleWebhook(context.Background(), "stripe", WebhookRequest{}))
	assert.True(t, repo.processed["stripe:evt_rf2"])
	assert.Empty(t, repo.changePlans, "冲突分支不重复降级（首次退款已完成过回收）")
	assert.Empty(t, repo.setSubs)
}

func TestHandleWebhook_Refund_UpdateError_MarksEventError_BQ1(t *testing.T) {
	repo := newFakeRepo()
	repo.orders["ord_1"] = &domain.Order{ID: "ord_1", WorkspaceID: "ws_1", PlanCode: "pro", Status: domain.OrderPaid}
	repo.updateStatusErr = errors.New("db down")
	svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{}, &fakeAuditor{},
		func() time.Time { return testNow }, nil)
	svc.channels.Register(&fakeChannel{event: domain.PaymentEvent{
		Channel: "stripe", ChannelEventID: "evt_rf3", Type: domain.EventRefundCreated, OrderID: "ord_1",
	}})

	require.Error(t, svc.HandleWebhook(context.Background(), "stripe", WebhookRequest{}))
	require.Contains(t, repo.eventErrors, "stripe:evt_rf3")
	assert.False(t, repo.processed["stripe:evt_rf3"])
	assert.Empty(t, repo.changePlans, "未完成状态迁移前不得降级")
}

func TestCreateCheckout_UnpricedPlanRejected_BQ7(t *testing.T) {
	repo := newFakeRepo()
	repo.plans["broken"] = domain.Plan{Code: "broken", Limits: map[string]int{"tasks_monthly": 50}}
	reg := NewChannelRegistry()
	registered := false
	reg.Register(&pricedProbeChannel{allow: &registered})
	svc := NewBillingService(repo, reg, Config{}, BillingHooks{}, nil, func() time.Time { return testNow }, nil)

	_, err := svc.CreateCheckout(context.Background(), principal(), "ws_1", "broken", domain.IntervalMonthly, "probe")
	var we *webx.Error
	require.ErrorAs(t, err, &we)
	assert.Equal(t, 400, we.Status)
	assert.Contains(t, we.Message, "not priced")

	assert.Empty(t, repo.orders, "不得建 0 元订单")
	assert.False(t, registered, "不得进渠道创建会话")
}

type pricedProbeChannel struct{ allow *bool }

func (c *pricedProbeChannel) Name() string { return "probe" }
func (c *pricedProbeChannel) CreateCheckout(_ context.Context, _ domain.Order, _, _ string) (domain.CheckoutSession, error) {
	*c.allow = true
	return domain.CheckoutSession{}, nil
}
func (c *pricedProbeChannel) ParseWebhook(_ context.Context, _ WebhookRequest) (domain.PaymentEvent, error) {
	return domain.PaymentEvent{}, nil
}
