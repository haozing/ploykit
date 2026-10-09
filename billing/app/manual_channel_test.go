package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/platform/webx"
)

func TestManualChannel_RegistryResolvable(t *testing.T) {
	reg := NewChannelRegistry()
	reg.Register(&ManualChannel{})
	ch, ok := reg.Get("manual")
	require.True(t, ok, "manual 渠道注册后应可解析")
	assert.Equal(t, "manual", ch.Name())
}

func TestManualChannel_CheckoutAndWebhookShape(t *testing.T) {
	ch := &ManualChannel{InfoURL: "https://example.com/pay-by-transfer"}
	session, err := ch.CreateCheckout(context.Background(), domain.Order{ID: "ord_m", PlanCode: "pro"}, "https://s", "https://c")
	require.NoError(t, err)
	assert.Equal(t, "ord_m", session.OrderID)
	assert.Equal(t, "manual", session.Channel)
	assert.Equal(t, "https://example.com/pay-by-transfer", session.ActionURL)
	assert.NotEmpty(t, session.SessionRef)
	assert.True(t, session.ExpiresAt.After(time.Now()), "会话有期限（默认 7 天线下支付窗口）")

	_, err = ch.ParseWebhook(context.Background(), WebhookRequest{})
	var we *webx.Error
	require.ErrorAs(t, err, &we)
	assert.Equal(t, 400, we.Status, "manual 渠道不接受 webhook（无签名可验，防伪造核销）")
}

func TestMarkOrderPaid_ManualPending(t *testing.T) {
	repo := newFakeRepo()
	repo.orders["ord_m"] = &domain.Order{
		ID: "ord_m", WorkspaceID: uuid.NewString(), PlanCode: "pro",
		Interval: domain.IntervalOneTime, AmountCents: 4200, Currency: "CNY",
		Channel: "manual", Status: domain.OrderPending,
	}
	aud := &fakeAuditor{}
	cap := &emitCapture{}
	svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{}, aud,
		func() time.Time { return testNow }, nil).WithEventEmitter(cap.emit)

	require.NoError(t, svc.MarkOrderPaid(context.Background(), principal(), "ord_m"))
	assert.Equal(t, domain.OrderPaid, repo.orders["ord_m"].Status)
	assert.NotNil(t, repo.orders["ord_m"].PaidAt, "核销时间落 paid_at")

	require.Len(t, aud.calls, 1)
	assert.Equal(t, "billing.order_marked_paid", aud.calls[0].action)
	assert.Equal(t, "ord_m", aud.calls[0].resourceID)
	assert.Equal(t, true, aud.calls[0].meta["admin"])

	require.Len(t, cap.events, 1)
	assert.Equal(t, KindOrderMarkedPaid, cap.events[0].Kind)
	assert.Contains(t, cap.events[0].IDempotencyKey, "ord_m")
}

func TestMarkOrderPaid_Guards(t *testing.T) {
	repo := newFakeRepo()
	repo.orders["ord_stripe"] = &domain.Order{ID: "ord_stripe", WorkspaceID: "ws_1", Channel: "stripe", Status: domain.OrderPending}
	repo.orders["ord_paid"] = &domain.Order{ID: "ord_paid", WorkspaceID: "ws_1", Channel: "manual", Status: domain.OrderPaid}
	svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{}, nil,
		func() time.Time { return testNow }, nil)
	p := principal()

	var we *webx.Error
	err := svc.MarkOrderPaid(context.Background(), p, "ord_stripe")
	require.ErrorAs(t, err, &we)
	assert.Equal(t, 400, we.Status, "非 manual 渠道不得核销（防绕过支付渠道记账）")
	assert.Equal(t, domain.OrderPending, repo.orders["ord_stripe"].Status)

	err = svc.MarkOrderPaid(context.Background(), p, "ord_paid")
	require.ErrorAs(t, err, &we)
	assert.Equal(t, 409, we.Status, "非 pending 不可核销")

	err = svc.MarkOrderPaid(context.Background(), p, "ord_none")
	require.ErrorAs(t, err, &we)
	assert.Equal(t, 404, we.Status)
}

func TestMarkOrderPaid_ConcurrentConflict(t *testing.T) {
	repo := newFakeRepo()
	repo.orders["ord_m"] = &domain.Order{ID: "ord_m", WorkspaceID: "ws_1", Channel: "manual", Status: domain.OrderPending}
	svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{}, nil,
		func() time.Time { return testNow }, nil)
	p := principal()

	const n = 2
	errs := make(chan error, n)
	for i := 0; i < n; i++ {
		go func() { errs <- svc.MarkOrderPaid(context.Background(), p, "ord_m") }()
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
	assert.Equal(t, 1, okCount, "恰一次核销成功")
	assert.Equal(t, 1, conflictCount, "另一次因状态迁移 409")
	assert.Equal(t, domain.OrderPaid, repo.orders["ord_m"].Status)
}

func TestMarkOrderPaid_EmitErrorRollsBack(t *testing.T) {
	repo := newFakeRepo()
	repo.orders["ord_m"] = &domain.Order{ID: "ord_m", WorkspaceID: uuid.NewString(), Channel: "manual", Status: domain.OrderPending}
	aud := &fakeAuditor{}
	cap := &emitCapture{err: errors.New("river down")}
	svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{}, aud,
		func() time.Time { return testNow }, nil).WithEventEmitter(cap.emit)

	require.Error(t, svc.MarkOrderPaid(context.Background(), principal(), "ord_m"))
	assert.Equal(t, domain.OrderPending, repo.orders["ord_m"].Status, "入队失败：核销与事件同生共死")
	assert.Empty(t, aud.calls, "回滚路径不落审计")
}
