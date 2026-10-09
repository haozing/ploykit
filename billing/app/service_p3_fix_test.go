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

func TestHandleRenewed_IntervalDerivation_P3_13(t *testing.T) {
	tests := []struct {
		name       string
		paidIv     domain.BillingInterval
		hasPaidIv  bool
		wantExpiry time.Time
	}{
		{"年付订单 → 顺延一年", domain.IntervalYearly, true, testNow.AddDate(1, 0, 0)},
		{"月付订单 → 顺延一月", domain.IntervalMonthly, true, testNow.AddDate(0, 1, 0)},
		{"无 paid 订单 → 默认 monthly", domain.IntervalMonthly, false, testNow.AddDate(0, 1, 0)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := newFakeRepo()
			repo.bySub["sub_iv"] = "ws_iv"
			repo.wsPlan["ws_iv"] = "pro"
			if tt.hasPaidIv {
				repo.paidIv["ws_iv"] = tt.paidIv
			}
			svc := webhookSvc(repo, BillingHooks{})
			require.NoError(t, fireWebhook(t, svc, domain.PaymentEvent{
				Channel: "stripe", ChannelEventID: "evt_iv", Type: domain.EventSubscriptionRenewed,
				SubscriptionRef: "sub_iv",
			}))
			require.Len(t, repo.setSubs, 1)
			assert.True(t, repo.setSubs[0].expiresAt.Equal(tt.wantExpiry),
				"got %v want %v", repo.setSubs[0].expiresAt, tt.wantExpiry)
		})
	}
}

func TestHandlePaid_LatePaymentForCanceledOrder_Ignored_P3_13(t *testing.T) {
	repo := newFakeRepo()
	repo.orders["ord_c"] = &domain.Order{
		ID: "ord_c", WorkspaceID: "ws_1", PlanCode: "pro", Interval: domain.IntervalMonthly,
		AmountCents: 9900, Currency: "CNY", Channel: "stripe", Status: domain.OrderCanceled,
	}
	var hookFires [][3]string
	svc := webhookSvc(repo, BillingHooks{
		OnPlanChanged: func(_ context.Context, ws, from, to string) error {
			hookFires = append(hookFires, [3]string{ws, from, to})
			return nil
		},
	})
	require.NoError(t, fireWebhook(t, svc, domain.PaymentEvent{
		Channel: "stripe", ChannelEventID: "evt_late", Type: domain.EventCheckoutCompleted,
		OrderID: "ord_c", ChannelRef: "cs_c", AmountCents: 9900,
	}))
	assert.Equal(t, domain.OrderCanceled, repo.orders["ord_c"].Status, "迟到支付不得复活已取消订单")
	_, written := repo.wsPlan["ws_1"]
	assert.False(t, written, "迟到支付不得换档")
	assert.Empty(t, hookFires)
	assert.True(t, repo.processed["stripe:evt_late"], "残余路径事件告警收敛（可观测）")
}

type fakeCancelChannel struct {
	fakeChannel
	cancelRefs []string
	cancelErr  error
}

func (f *fakeCancelChannel) CancelCheckout(_ context.Context, ref string) error {
	f.cancelRefs = append(f.cancelRefs, ref)
	return f.cancelErr
}

func TestCancelPendingOrder_ChannelCancel_P3_11(t *testing.T) {
	principal := &webx.Principal{UserID: "u1", WorkspaceID: "ws_1"}

	t.Run("本地取消 + 渠道会话尽力撤销", func(t *testing.T) {
		repo := newFakeRepo()
		repo.orders["ord_x"] = &domain.Order{
			ID: "ord_x", WorkspaceID: "ws_1", PlanCode: "pro", Channel: "stripe",
			Status: domain.OrderPending, ChannelRef: "cs_cancel_me",
		}
		svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{},
			&fakeAuditor{}, func() time.Time { return testNow }, nil)
		fc := &fakeCancelChannel{}
		svc.channels.Register(fc)
		repo.byRef["stripe:cs_cancel_me"] = "ord_x"

		require.NoError(t, svc.CancelPendingOrder(context.Background(), principal, "ord_x"))
		assert.Equal(t, domain.OrderCanceled, repo.orders["ord_x"].Status)
		assert.Equal(t, []string{"cs_cancel_me"}, fc.cancelRefs, "P3-11：必须尽力撤销渠道会话")
	})

	t.Run("渠道撤销失败不回滚本地取消", func(t *testing.T) {
		repo := newFakeRepo()
		repo.orders["ord_y"] = &domain.Order{
			ID: "ord_y", WorkspaceID: "ws_1", PlanCode: "pro", Channel: "stripe",
			Status: domain.OrderPending, ChannelRef: "cs_fail",
		}
		svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{},
			&fakeAuditor{}, func() time.Time { return testNow }, nil)
		svc.channels.Register(&fakeCancelChannel{cancelErr: errors.New("stripe down")})

		require.NoError(t, svc.CancelPendingOrder(context.Background(), principal, "ord_y"),
			"撤销失败是 best-effort：本地取消必须成立")
		assert.Equal(t, domain.OrderCanceled, repo.orders["ord_y"].Status)
	})

	t.Run("渠道未实现可选能力 → 跳过撤销（零值兼容）", func(t *testing.T) {
		repo := newFakeRepo()
		repo.orders["ord_z"] = &domain.Order{
			ID: "ord_z", WorkspaceID: "ws_1", PlanCode: "pro", Channel: "manual",
			Status: domain.OrderPending, ChannelRef: "manual-ref",
		}
		svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{},
			&fakeAuditor{}, func() time.Time { return testNow }, nil)
		svc.channels.Register(&fakeChannel{})

		require.NoError(t, svc.CancelPendingOrder(context.Background(), principal, "ord_z"))
		assert.Equal(t, domain.OrderCanceled, repo.orders["ord_z"].Status)
	})
}
