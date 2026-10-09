package app_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/admin/app"
	"github.com/haozing/ploykit/platform/webx"
)

type billOpsAuditor struct{ events []billOpsAuditEvent }

type billOpsAuditEvent struct {
	action, resType, resID string
	meta                   map[string]any
}

func (a *billOpsAuditor) Record(_ context.Context, _ *string, _ *webx.Principal, action, resourceType, resID string, meta map[string]any) {
	a.events = append(a.events, billOpsAuditEvent{action, resourceType, resID, meta})
}

func (a *billOpsAuditor) find(action string) (billOpsAuditEvent, bool) {
	for _, e := range a.events {
		if e.action == action {
			return e, true
		}
	}
	return billOpsAuditEvent{}, false
}

type fakeBillingOps struct {
	gotOrders struct {
		ws, status    string
		limit, offset int
	}
	orders []app.AdminOrder

	gotEvents struct {
		ws            string
		limit, offset int
	}
	events []app.AdminPaymentEvent

	cancelErr error
	gotCancel string

	expiredN   int
	overageN   int
	overageErr error

	codes []string

	planViews    []app.AdminPlanView
	markPaidErr  error
	gotMarkPaid  string
	markPaidCall bool

	config         app.AdminBillingConfig
	gotTestChannel string
	testChannelErr error
	gotCancelSub   string
	cancelSubErr   error
}

func (f *fakeBillingOps) ListAllOrders(_ context.Context, ws, status string, limit, offset int) ([]app.AdminOrder, int, error) {
	f.gotOrders.ws, f.gotOrders.status, f.gotOrders.limit, f.gotOrders.offset = ws, status, limit, offset
	return f.orders, len(f.orders), nil
}

func (f *fakeBillingOps) ListPaymentEvents(_ context.Context, ws string, limit, offset int) ([]app.AdminPaymentEvent, int, error) {
	f.gotEvents.ws, f.gotEvents.limit, f.gotEvents.offset = ws, limit, offset
	return f.events, len(f.events), nil
}

func (f *fakeBillingOps) AdminCancelPendingOrder(_ context.Context, _ *webx.Principal, orderID string) error {
	f.gotCancel = orderID
	return f.cancelErr
}

func (f *fakeBillingOps) RunExpiryNow(context.Context) (int, error) { return f.expiredN, nil }

func (f *fakeBillingOps) RunOverageNow(context.Context) (int, error) { return f.overageN, f.overageErr }

func (f *fakeBillingOps) ListPlanCodes(context.Context) ([]string, error) { return f.codes, nil }

func (f *fakeBillingOps) ListPlanViews(context.Context) ([]app.AdminPlanView, error) {
	return f.planViews, nil
}

func (f *fakeBillingOps) MarkOrderPaid(_ context.Context, _ *webx.Principal, orderID string) error {
	f.markPaidCall = true
	f.gotMarkPaid = orderID
	return f.markPaidErr
}

func (f *fakeBillingOps) BillingConfig(context.Context) (app.AdminBillingConfig, error) {
	return f.config, nil
}

func (f *fakeBillingOps) TestChannelConnection(_ context.Context, channel string) error {
	f.gotTestChannel = channel
	return f.testChannelErr
}

func (f *fakeBillingOps) AdminCancelSubscription(_ context.Context, _ *webx.Principal, workspaceID string) error {
	f.gotCancelSub = workspaceID
	return f.cancelSubErr
}

type fakeWebhookOps struct {
	gotList struct {
		ws, status    string
		limit, offset int
	}
	rows []app.AdminWebhookDelivery

	gotRedeliver string
	newDelivery  app.AdminWebhookDelivery
	redeliverErr error
}

func (f *fakeWebhookOps) ListAllDeliveries(_ context.Context, ws, status string, limit, offset int) ([]app.AdminWebhookDelivery, int, error) {
	f.gotList.ws, f.gotList.status, f.gotList.limit, f.gotList.offset = ws, status, limit, offset
	return f.rows, len(f.rows), nil
}

func (f *fakeWebhookOps) AdminRedeliver(_ context.Context, deliveryID string) (app.AdminWebhookDelivery, error) {
	f.gotRedeliver = deliveryID
	return f.newDelivery, f.redeliverErr
}

func newBillOpsSvc(b app.BillingAdminOps, wh app.WebhookAdminOps, aud app.Auditor) *app.BillingOpsService {
	base := app.NewAdminService(nil, func() time.Time {
		return time.Date(2026, 10, 7, 0, 0, 0, 0, time.UTC)
	})
	if aud != nil {
		base = base.WithAuditor(aud)
	}
	svc := app.NewBillingOpsService(base)
	if b != nil {
		svc = svc.WithBillingOps(b)
	}
	if wh != nil {
		svc = svc.WithWebhookOps(wh)
	}
	return svc
}

func TestBillOpsListOrders(t *testing.T) {
	ctx := context.Background()

	t.Run("分页钳制与透传", func(t *testing.T) {
		b := &fakeBillingOps{orders: []app.AdminOrder{{ID: "ord_1"}}}
		svc := newBillOpsSvc(b, nil, nil)

		items, total, err := svc.ListOrders(ctx, "ws-1", "pending", 2, 50)
		require.NoError(t, err)
		assert.Equal(t, b.orders, items)
		assert.Equal(t, 1, total)
		assert.Equal(t, "ws-1", b.gotOrders.ws)
		assert.Equal(t, "pending", b.gotOrders.status)
		assert.Equal(t, 50, b.gotOrders.limit)
		assert.Equal(t, 50, b.gotOrders.offset)

		_, _, err = svc.ListOrders(ctx, "", "", 0, 0)
		require.NoError(t, err)
		assert.Equal(t, 20, b.gotOrders.limit, "缺省页大小 20")
		assert.Equal(t, 0, b.gotOrders.offset)
	})

	t.Run("非法状态 → 400", func(t *testing.T) {
		svc := newBillOpsSvc(&fakeBillingOps{}, nil, nil)
		_, _, err := svc.ListOrders(ctx, "", "zombie", 1, 20)
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusBadRequest, we.Status)
	})
}

func TestBillOpsListWebhookDeliveries(t *testing.T) {
	ctx := context.Background()

	t.Run("透传 + 状态枚举", func(t *testing.T) {
		wh := &fakeWebhookOps{rows: []app.AdminWebhookDelivery{{ID: "dlv_1", Status: "dead"}}}
		svc := newBillOpsSvc(nil, wh, nil)

		items, total, err := svc.ListWebhookDeliveries(ctx, "ws-2", "dead", 1, 20)
		require.NoError(t, err)
		assert.Equal(t, wh.rows, items)
		assert.Equal(t, 1, total)
		assert.Equal(t, "ws-2", wh.gotList.ws)
		assert.Equal(t, "dead", wh.gotList.status)
		assert.Equal(t, 20, wh.gotList.limit)

		_, _, err = svc.ListWebhookDeliveries(ctx, "", "sent", 1, 20)
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusBadRequest, we.Status)
	})
}

func TestBillOpsNotWired(t *testing.T) {
	ctx := context.Background()
	svc := newBillOpsSvc(nil, nil, nil)
	p := &webx.Principal{UserID: "op", IsPlatformAdmin: true}

	assert503 := func(t *testing.T, err error) {
		t.Helper()
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusServiceUnavailable, we.Status)
	}

	_, _, err := svc.ListOrders(ctx, "", "", 1, 20)
	assert503(t, err)
	_, _, err = svc.ListPaymentEvents(ctx, "", 1, 20)
	assert503(t, err)
	_, err = svc.ListPlans(ctx)
	assert503(t, err)
	_, err = svc.ListPlanViews(ctx)
	assert503(t, err)
	assert503(t, svc.AdminMarkOrderPaid(ctx, p, "ord_1"))
	assert503(t, svc.AdminCancelOrder(ctx, p, "ord_1"))
	_, err = svc.RunExpiry(ctx, p)
	assert503(t, err)
	_, err = svc.RunOverage(ctx, p)
	assert503(t, err)
	_, _, err = svc.ListWebhookDeliveries(ctx, "", "", 1, 20)
	assert503(t, err)
	_, err = svc.AdminRedeliver(ctx, p, "dlv_1")
	assert503(t, err)

	_, err = svc.BillingConfig(ctx)
	assert503(t, err)
	assert503(t, svc.TestChannelConnection(ctx, "stripe"))
	assert503(t, svc.AdminCancelSubscription(ctx, p, "ws_1"))
}

func TestBillOpsAdminCancelOrderAudits(t *testing.T) {
	ctx := context.Background()
	p := &webx.Principal{UserID: "op", IsPlatformAdmin: true}

	t.Run("成功 → admin.order_cancel", func(t *testing.T) {
		b := &fakeBillingOps{}
		aud := &billOpsAuditor{}
		svc := newBillOpsSvc(b, nil, aud)

		require.NoError(t, svc.AdminCancelOrder(ctx, p, "ord_9"))
		assert.Equal(t, "ord_9", b.gotCancel, "orderID 透传 billing 侧")
		e, ok := aud.find("admin.order_cancel")
		require.True(t, ok)
		assert.Equal(t, "order", e.resType)
		assert.Equal(t, "ord_9", e.resID)
		assert.Len(t, aud.events, 1, "只记一条（域内审计在 billing 侧）")
	})

	t.Run("billing 侧失败 → 错误透传且不写审计", func(t *testing.T) {
		b := &fakeBillingOps{cancelErr: webx.NewConflict("order is not pending")}
		aud := &billOpsAuditor{}
		svc := newBillOpsSvc(b, nil, aud)

		err := svc.AdminCancelOrder(ctx, p, "ord_9")
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusConflict, we.Status)
		assert.Empty(t, aud.events)
	})

	t.Run("未挂 auditor 不 panic", func(t *testing.T) {
		svc := newBillOpsSvc(&fakeBillingOps{}, nil, nil)
		assert.NotPanics(t, func() {
			require.NoError(t, svc.AdminCancelOrder(ctx, p, "ord_9"))
		})
	})
}

func TestBillOpsRunExpiryAndOverageAudits(t *testing.T) {
	ctx := context.Background()
	p := &webx.Principal{UserID: "op", IsPlatformAdmin: true}

	t.Run("RunExpiry → admin.billing_run_expiry（meta 记降级数）", func(t *testing.T) {
		b := &fakeBillingOps{expiredN: 3}
		aud := &billOpsAuditor{}
		svc := newBillOpsSvc(b, nil, aud)

		n, err := svc.RunExpiry(ctx, p)
		require.NoError(t, err)
		assert.Equal(t, 3, n)
		e, ok := aud.find("admin.billing_run_expiry")
		require.True(t, ok)
		assert.Equal(t, map[string]any{"expired": 3}, e.meta)
	})

	t.Run("RunOverage → admin.billing_run_overage（meta 记新建订单数）", func(t *testing.T) {
		b := &fakeBillingOps{overageN: 1}
		aud := &billOpsAuditor{}
		svc := newBillOpsSvc(b, nil, aud)

		n, err := svc.RunOverage(ctx, p)
		require.NoError(t, err)
		assert.Equal(t, 1, n)
		e, ok := aud.find("admin.billing_run_overage")
		require.True(t, ok)
		assert.Equal(t, map[string]any{"orders_created": 1}, e.meta)
	})

	t.Run("RunOverage 失败（usage 未装配等）→ 不写审计", func(t *testing.T) {
		b := &fakeBillingOps{overageErr: webx.NewError(http.StatusServiceUnavailable, webx.CodeUnavailable, "usage reader not wired")}
		aud := &billOpsAuditor{}
		svc := newBillOpsSvc(b, nil, aud)

		_, err := svc.RunOverage(ctx, p)
		require.Error(t, err)
		assert.Empty(t, aud.events)
	})
}

func TestBillOpsAdminMarkOrderPaidAudits(t *testing.T) {
	ctx := context.Background()
	p := &webx.Principal{UserID: "op", IsPlatformAdmin: true}

	t.Run("成功 → admin.order_mark_paid（批次 2.8）", func(t *testing.T) {
		b := &fakeBillingOps{}
		aud := &billOpsAuditor{}
		svc := newBillOpsSvc(b, nil, aud)

		require.NoError(t, svc.AdminMarkOrderPaid(ctx, p, "ord_m1"))
		assert.Equal(t, "ord_m1", b.gotMarkPaid, "orderID 透传 billing 侧")
		e, ok := aud.find("admin.order_mark_paid")
		require.True(t, ok)
		assert.Equal(t, "order", e.resType)
		assert.Equal(t, "ord_m1", e.resID)
		assert.Len(t, aud.events, 1, "只记一条（域内审计在 billing 侧）")
	})

	t.Run("billing 侧失败（非 manual 400 / 非 pending 409）→ 透传且不写审计", func(t *testing.T) {
		b := &fakeBillingOps{markPaidErr: webx.NewConflict("order is not pending")}
		aud := &billOpsAuditor{}
		svc := newBillOpsSvc(b, nil, aud)

		err := svc.AdminMarkOrderPaid(ctx, p, "ord_m1")
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusConflict, we.Status)
		assert.Empty(t, aud.events)
	})

	t.Run("未挂 auditor 不 panic", func(t *testing.T) {
		svc := newBillOpsSvc(&fakeBillingOps{}, nil, nil)
		assert.NotPanics(t, func() {
			require.NoError(t, svc.AdminMarkOrderPaid(ctx, p, "ord_m1"))
		})
	})
}

func TestBillOpsListPlanViews(t *testing.T) {
	ctx := context.Background()

	t.Run("透传（批次 2.5 收尾：trial_days/currency 露出）", func(t *testing.T) {
		want := []app.AdminPlanView{
			{Code: "pro", Name: "Pro", Currency: "CNY", TrialDays: 14, SortNo: 2,
				Limits: map[string]int{"trial_days": 14, "price_monthly": 9900}},
		}
		svc := newBillOpsSvc(&fakeBillingOps{planViews: want}, nil, nil)
		got, err := svc.ListPlanViews(ctx)
		require.NoError(t, err)
		assert.Equal(t, want, got)
	})
}

func TestBillOpsWebhookRedeliverAudits(t *testing.T) {
	ctx := context.Background()
	p := &webx.Principal{UserID: "op", IsPlatformAdmin: true}

	t.Run("成功 → admin.webhook_redeliver（meta 记新投递行）", func(t *testing.T) {
		wh := &fakeWebhookOps{newDelivery: app.AdminWebhookDelivery{ID: "dlv_new", Status: "pending"}}
		aud := &billOpsAuditor{}
		svc := newBillOpsSvc(nil, wh, aud)

		got, err := svc.AdminRedeliver(ctx, p, "dlv_src")
		require.NoError(t, err)
		assert.Equal(t, "dlv_new", got.ID)
		assert.Equal(t, "dlv_src", wh.gotRedeliver, "deliveryID 透传 webhooks 侧")
		e, ok := aud.find("admin.webhook_redeliver")
		require.True(t, ok)
		assert.Equal(t, "webhook_delivery", e.resType)
		assert.Equal(t, "dlv_src", e.resID)
		assert.Equal(t, map[string]any{"new_delivery_id": "dlv_new"}, e.meta)
	})

	t.Run("重投失败 → 错误透传且不写审计", func(t *testing.T) {
		wh := &fakeWebhookOps{redeliverErr: webx.NewNotFound("delivery not found")}
		aud := &billOpsAuditor{}
		svc := newBillOpsSvc(nil, wh, aud)

		_, err := svc.AdminRedeliver(ctx, p, "dlv_x")
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusNotFound, we.Status)
		assert.Empty(t, aud.events)
	})
}

func TestBillOpsQueriesDoNotAudit(t *testing.T) {
	ctx := context.Background()
	b := &fakeBillingOps{
		orders: []app.AdminOrder{{ID: "ord_1"}},
		events: []app.AdminPaymentEvent{{ID: "pe_1"}},
		codes:  []string{"free", "pro"},
		config: app.AdminBillingConfig{Channels: []app.AdminBillingChannel{{Name: "stripe", Configured: true}}},
	}
	wh := &fakeWebhookOps{rows: []app.AdminWebhookDelivery{{ID: "dlv_1"}}}
	aud := &billOpsAuditor{}
	svc := newBillOpsSvc(b, wh, aud)

	_, _, err := svc.ListOrders(ctx, "", "", 1, 20)
	require.NoError(t, err)
	_, _, err = svc.ListPaymentEvents(ctx, "", 1, 20)
	require.NoError(t, err)
	_, err = svc.ListPlans(ctx)
	require.NoError(t, err)
	_, _, err = svc.ListWebhookDeliveries(ctx, "", "", 1, 20)
	require.NoError(t, err)
	_, err = svc.BillingConfig(ctx)
	require.NoError(t, err)
	require.NoError(t, svc.TestChannelConnection(ctx, "stripe"))
	assert.Empty(t, aud.events, "查询类用例零审计（含连接测试——provider 侧只读探活）")
}

func TestBillOpsBillingConfigPassthrough(t *testing.T) {
	ctx := context.Background()
	want := app.AdminBillingConfig{Channels: []app.AdminBillingChannel{
		{Name: "stripe", Configured: true, KeyMasked: "sk_live_***abc9", WebhookConfigured: true},
		{Name: "gopay", Configured: false, KeyMasked: "未配置"},
	}}
	b := &fakeBillingOps{config: want}
	svc := newBillOpsSvc(b, nil, nil)

	got, err := svc.BillingConfig(ctx)
	require.NoError(t, err)
	assert.Equal(t, want, got)
}

func TestBillOpsTestChannelConnection(t *testing.T) {
	ctx := context.Background()

	t.Run("透传渠道名", func(t *testing.T) {
		b := &fakeBillingOps{}
		svc := newBillOpsSvc(b, nil, nil)
		require.NoError(t, svc.TestChannelConnection(ctx, "stripe"))
		assert.Equal(t, "stripe", b.gotTestChannel)
	})

	t.Run("billing 侧失败（未配置密钥等）→ 保形透传", func(t *testing.T) {
		b := &fakeBillingOps{testChannelErr: webx.NewError(400, "E_CHANNEL_NOT_CONFIGURED", "渠道未配置密钥")}
		svc := newBillOpsSvc(b, nil, nil)
		err := svc.TestChannelConnection(ctx, "stripe")
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusBadRequest, we.Status)
		assert.Equal(t, "E_CHANNEL_NOT_CONFIGURED", we.Code)
	})

	t.Run("channel 缺失 → 400（不透传到 billing 侧）", func(t *testing.T) {
		b := &fakeBillingOps{}
		svc := newBillOpsSvc(b, nil, nil)
		err := svc.TestChannelConnection(ctx, "")
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusBadRequest, we.Status)
		assert.Empty(t, b.gotTestChannel)
	})
}

func TestBillOpsAdminCancelSubscriptionAudits(t *testing.T) {
	ctx := context.Background()
	p := &webx.Principal{UserID: "op", IsPlatformAdmin: true}

	t.Run("成功 → admin.subscription_cancel（workspace 主体）", func(t *testing.T) {
		b := &fakeBillingOps{}
		aud := &billOpsAuditor{}
		svc := newBillOpsSvc(b, nil, aud)

		require.NoError(t, svc.AdminCancelSubscription(ctx, p, "ws_9"))
		assert.Equal(t, "ws_9", b.gotCancelSub, "workspaceID 透传 billing 侧")
		e, ok := aud.find("admin.subscription_cancel")
		require.True(t, ok)
		assert.Equal(t, "workspace", e.resType)
		assert.Equal(t, "ws_9", e.resID)
		assert.Len(t, aud.events, 1, "只记一条（域内降级审计在 billing 侧）")
	})

	t.Run("billing 侧失败（provider 取消失败 502 / 无订阅 409）→ 透传且不写审计", func(t *testing.T) {
		b := &fakeBillingOps{cancelSubErr: webx.NewConflict("workspace has no active subscription")}
		aud := &billOpsAuditor{}
		svc := newBillOpsSvc(b, nil, aud)

		err := svc.AdminCancelSubscription(ctx, p, "ws_9")
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusConflict, we.Status)
		assert.Empty(t, aud.events)
	})

	t.Run("未挂 auditor 不 panic", func(t *testing.T) {
		svc := newBillOpsSvc(&fakeBillingOps{}, nil, nil)
		assert.NotPanics(t, func() {
			require.NoError(t, svc.AdminCancelSubscription(ctx, p, "ws_9"))
		})
	})
}
