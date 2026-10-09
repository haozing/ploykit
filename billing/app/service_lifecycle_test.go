package app

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/platform/webx"
)

type plansRepo struct {
	*fakeRepo
	plans  []domain.Plan
	orders []domain.Order
}

func (f *plansRepo) ListPlans(_ context.Context) ([]domain.Plan, error) { return f.plans, nil }

func (f *plansRepo) ListOrdersByWorkspace(_ context.Context, _ string, limit int) ([]domain.Order, error) {
	return f.orders[:min(limit, len(f.orders))], nil
}

func TestHandleWebhook_PaymentFailed_UTBA03(t *testing.T) {
	repo := newFakeRepo()
	repo.orders["ord_1"] = &domain.Order{ID: "ord_1", WorkspaceID: "ws_1", PlanCode: "pro", Status: domain.OrderPending}
	aud := &fakeAuditor{}
	failed := [][2]string{}
	svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{
		OnPaymentFailed: func(_ context.Context, ws, orderID, _ string) error {
			failed = append(failed, [2]string{ws, orderID})
			return nil
		},
	}, aud, func() time.Time { return testNow }, nil)
	svc.channels.Register(&fakeChannel{event: domain.PaymentEvent{
		Channel: "stripe", ChannelEventID: "evt_f", Type: domain.EventPaymentFailed, OrderID: "ord_1",
	}})

	require.NoError(t, svc.HandleWebhook(context.Background(), "stripe", WebhookRequest{}))
	assert.Equal(t, domain.OrderFailed, repo.orders["ord_1"].Status)
	assert.Equal(t, [][2]string{{"ws_1", "ord_1"}}, failed, "OnPaymentFailed 应携带 ws 与订单")
	assert.True(t, repo.processed["stripe:evt_f"], "事件应标记 processed")
}

func TestHandleWebhook_Refund_UTBA04(t *testing.T) {
	repo := newFakeRepo()
	repo.orders["ord_1"] = &domain.Order{ID: "ord_1", WorkspaceID: "ws_1", PlanCode: "pro", Status: domain.OrderPaid}
	repo.byRef["stripe:ch_1"] = "ord_1"
	svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{
		OnPlanChanged: func(_ context.Context, _, _, _ string) error { return nil },
	}, &fakeAuditor{}, func() time.Time { return testNow }, nil)
	svc.channels.Register(&fakeChannel{event: domain.PaymentEvent{
		Channel: "stripe", ChannelEventID: "evt_r", Type: domain.EventRefundCreated, ChannelRef: "ch_1",
	}})

	require.NoError(t, svc.HandleWebhook(context.Background(), "stripe", WebhookRequest{}))
	assert.Equal(t, domain.OrderRefunded, repo.orders["ord_1"].Status)
	assert.True(t, repo.processed["stripe:evt_r"])
}

func TestResolveOrder_UTBA05(t *testing.T) {
	repo := newFakeRepo()
	repo.orders["ord_by_ref"] = &domain.Order{ID: "ord_by_ref", WorkspaceID: "ws_1", Status: domain.OrderPending}
	repo.byRef["stripe:ch_9"] = "ord_by_ref"

	svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{}, nil, func() time.Time { return testNow }, nil)
	svc.channels.Register(&fakeChannel{event: domain.PaymentEvent{
		Channel: "stripe", ChannelEventID: "evt_x", Type: domain.EventPaymentFailed,
		OrderID: "ord_missing", ChannelRef: "ch_9",
	}})
	require.NoError(t, svc.HandleWebhook(context.Background(), "stripe", WebhookRequest{}))
	assert.Equal(t, domain.OrderPending, repo.orders["ord_by_ref"].Status, "OrderID 优先且不存在时不应回落 ChannelRef")
	assert.True(t, repo.processed["stripe:evt_x"])

	svc.channels.Register(&fakeChannel{event: domain.PaymentEvent{
		Channel: "stripe", ChannelEventID: "evt_y", Type: domain.EventPaymentFailed,
	}})
	require.NoError(t, svc.HandleWebhook(context.Background(), "stripe", WebhookRequest{}))
	assert.True(t, repo.processed["stripe:evt_y"])
}

func TestCancelPendingOrder_UTBA06(t *testing.T) {
	repo := newFakeRepo()
	repo.orders["ord_paid"] = &domain.Order{ID: "ord_paid", WorkspaceID: "ws_1", Status: domain.OrderPaid}
	repo.orders["ord_pend"] = &domain.Order{ID: "ord_pend", WorkspaceID: "ws_1", Status: domain.OrderPending}
	aud := &fakeAuditor{}
	svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{}, aud, func() time.Time { return testNow }, nil)
	p := &webx.Principal{UserID: "u1", WorkspaceID: "ws_1"}

	err := svc.CancelPendingOrder(context.Background(), p, "ord_none")
	var we *webx.Error
	require.ErrorAs(t, err, &we)
	assert.Equal(t, 404, we.Status)

	err = svc.CancelPendingOrder(context.Background(), p, "ord_paid")
	require.ErrorAs(t, err, &we)
	assert.Equal(t, 409, we.Status)

	require.NoError(t, svc.CancelPendingOrder(context.Background(), p, "ord_pend"))
	assert.Equal(t, domain.OrderCanceled, repo.orders["ord_pend"].Status)
	require.Len(t, aud.calls, 1)
	assert.Equal(t, "billing.order_canceled", aud.calls[0].action)
	assert.Equal(t, "order", aud.calls[0].resourceType)
}

func TestCancelPendingOrder_CrossWorkspace_SEC_V1(t *testing.T) {
	repo := newFakeRepo()
	repo.orders["ord_pend"] = &domain.Order{ID: "ord_pend", WorkspaceID: "ws_1", Status: domain.OrderPending}
	aud := &fakeAuditor{}
	svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{}, aud, func() time.Time { return testNow }, nil)

	err := svc.CancelPendingOrder(context.Background(), &webx.Principal{UserID: "u2", WorkspaceID: "ws_2"}, "ord_pend")
	var we *webx.Error
	require.ErrorAs(t, err, &we)
	assert.Equal(t, 404, we.Status)
	assert.Equal(t, domain.OrderPending, repo.orders["ord_pend"].Status)
	assert.Empty(t, aud.calls)

	err = svc.CancelPendingOrder(context.Background(), &webx.Principal{UserID: "u1"}, "ord_pend")
	require.ErrorAs(t, err, &we)
	assert.Equal(t, 400, we.Status)
	assert.Equal(t, domain.OrderPending, repo.orders["ord_pend"].Status)
}

func TestCancelPendingOrder_Concurrent_SEC_V1(t *testing.T) {
	repo := newFakeRepo()
	repo.orders["ord_pend"] = &domain.Order{ID: "ord_pend", WorkspaceID: "ws_1", Status: domain.OrderPending}
	svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{}, nil, func() time.Time { return testNow }, nil)
	p := &webx.Principal{UserID: "u1", WorkspaceID: "ws_1"}

	const n = 2
	errs := make(chan error, n)
	for i := 0; i < n; i++ {
		go func() { errs <- svc.CancelPendingOrder(context.Background(), p, "ord_pend") }()
	}
	var okCount, conflictCount int
	for i := 0; i < n; i++ {
		if err := <-errs; err == nil {
			okCount++
		} else {
			var we *webx.Error
			if require.ErrorAs(t, err, &we); we.Status == 409 {
				conflictCount++
			}
		}
	}
	assert.Equal(t, 1, okCount, "恰一次取消成功")
	assert.Equal(t, 1, conflictCount, "另一次因状态迁移 409")
	assert.Equal(t, domain.OrderCanceled, repo.orders["ord_pend"].Status)
}

func TestListPlansAndGetSubscription_UTBA07(t *testing.T) {
	base := newFakeRepo()
	base.wsPlan["ws_1"] = "pro"
	base.orders["o1"] = &domain.Order{ID: "o1", WorkspaceID: "ws_1", PlanCode: "pro", Status: domain.OrderPaid}
	repo := &plansRepo{fakeRepo: base,
		plans:  []domain.Plan{{Code: "pro", Name: "Pro"}, {Code: "free", Name: "Free"}},
		orders: []domain.Order{*base.orders["o1"]},
	}
	svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{}, nil, func() time.Time { return testNow }, nil)

	plans, err := svc.ListPlans(context.Background())
	require.NoError(t, err)
	assert.Len(t, plans, 2)

	plan, orders, err := svc.GetSubscription(context.Background(), "ws_1")
	require.NoError(t, err)
	assert.Equal(t, "pro", plan)
	require.Len(t, orders, 1)
	assert.Equal(t, "o1", orders[0].ID)
}

func TestPlanAmountCents_UTBA08(t *testing.T) {
	plan := domain.Plan{Limits: map[string]int{
		"price_monthly_cents": 9900, "price_yearly_cents": 99000, "price_one_time_cents": 29900,
	}}
	assert.Equal(t, 9900, planAmountCents(plan, domain.IntervalMonthly))
	assert.Equal(t, 99000, planAmountCents(plan, domain.IntervalYearly))
	assert.Equal(t, 29900, planAmountCents(plan, domain.IntervalOneTime))
	assert.Equal(t, 0, planAmountCents(domain.Plan{}, domain.IntervalMonthly), "缺价格键应返回 0（free/未定价）")
}
