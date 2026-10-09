package app

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/platform/events"
)

type emitCapture struct {
	events []events.Event
	err    error
}

func (c *emitCapture) emit(_ context.Context, _ pgx.Tx, ev events.Event) error {
	if c.err != nil {
		return c.err
	}
	c.events = append(c.events, ev)
	return nil
}

func newFailedSvc(t *testing.T, repo *fakeRepo, cap *emitCapture, hooks BillingHooks) *BillingService {
	t.Helper()
	svc := NewBillingService(repo, NewChannelRegistry(), Config{}, hooks, &fakeAuditor{},
		func() time.Time { return testNow }, nil)
	if cap != nil {
		svc = svc.WithEventEmitter(cap.emit)
	}
	return svc
}

func TestHandleWebhook_PaymentFailed_EmitsEvent(t *testing.T) {
	ws := uuid.NewString()
	repo := newFakeRepo()
	repo.orders["ord_1"] = &domain.Order{
		ID: "ord_1", WorkspaceID: ws, PlanCode: "pro",
		Interval: domain.IntervalMonthly, Status: domain.OrderPending, AmountCents: 9900, Currency: "CNY",
	}
	failedHook := [][2]string{}
	cap := &emitCapture{}
	svc := newFailedSvc(t, repo, cap, BillingHooks{
		OnPaymentFailed: func(_ context.Context, w, orderID, _ string) error {
			failedHook = append(failedHook, [2]string{w, orderID})
			return nil
		},
	})
	svc.channels.Register(&fakeChannel{event: domain.PaymentEvent{
		Channel: "stripe", ChannelEventID: "evt_pf1", Type: domain.EventPaymentFailed, OrderID: "ord_1",
	}})

	require.NoError(t, svc.HandleWebhook(context.Background(), "stripe", WebhookRequest{}))
	assert.Equal(t, domain.OrderFailed, repo.orders["ord_1"].Status)

	require.Len(t, cap.events, 1)
	ev := cap.events[0]
	assert.Equal(t, KindPaymentFailed, ev.Kind)
	assert.Equal(t, ws, ev.WorkspaceID.String())
	assert.NotEmpty(t, ev.IDempotencyKey, "幂等键跟订单（failed 是终态，一单至多一投）")
	var payload map[string]any
	require.NoError(t, json.Unmarshal(ev.Payload, &payload))
	assert.Equal(t, "ord_1", payload["order_id"])
	assert.Equal(t, ws, payload["workspace_id"])
	assert.Equal(t, "stripe", payload["channel"])

	assert.Equal(t, [][2]string{{ws, "ord_1"}}, failedHook)
	assert.True(t, repo.processed["stripe:evt_pf1"])
}

func TestHandleWebhook_PaymentFailed_DuplicateNoReEmit(t *testing.T) {
	ws := uuid.NewString()
	repo := newFakeRepo()
	repo.orders["ord_1"] = &domain.Order{ID: "ord_1", WorkspaceID: ws, PlanCode: "pro", Status: domain.OrderFailed}
	hookCalls := 0
	cap := &emitCapture{}
	svc := newFailedSvc(t, repo, cap, BillingHooks{
		OnPaymentFailed: func(context.Context, string, string, string) error { hookCalls++; return nil },
	})
	svc.channels.Register(&fakeChannel{event: domain.PaymentEvent{
		Channel: "stripe", ChannelEventID: "evt_pf2", Type: domain.EventPaymentFailed, OrderID: "ord_1",
	}})

	require.NoError(t, svc.HandleWebhook(context.Background(), "stripe", WebhookRequest{}))
	assert.Empty(t, cap.events, "重复失败（状态冲突）不重复出事件")
	assert.Equal(t, 1, hookCalls, "钩子维持既有口径（冲突路径照常触发）")
	assert.True(t, repo.processed["stripe:evt_pf2"])
}

func TestHandleWebhook_PaymentFailed_EmitErrorFailsEvent(t *testing.T) {
	ws := uuid.NewString()
	repo := newFakeRepo()
	repo.orders["ord_1"] = &domain.Order{ID: "ord_1", WorkspaceID: ws, PlanCode: "pro", Status: domain.OrderPending}
	cap := &emitCapture{err: errors.New("river down")}
	svc := newFailedSvc(t, repo, cap, BillingHooks{})
	svc.channels.Register(&fakeChannel{event: domain.PaymentEvent{
		Channel: "stripe", ChannelEventID: "evt_pf3", Type: domain.EventPaymentFailed, OrderID: "ord_1",
	}})

	err := svc.HandleWebhook(context.Background(), "stripe", WebhookRequest{})
	require.Error(t, err)
	require.Contains(t, repo.eventErrors, "stripe:evt_pf3", "入队失败走 failEvent：事件标 error 可重放")
	assert.False(t, repo.processed["stripe:evt_pf3"])
}
