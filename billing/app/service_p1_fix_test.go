package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/billing/domain"
)

func seedPaidOrder(repo *fakeRepo, id, pi string) {
	repo.orders[id] = &domain.Order{
		ID: id, WorkspaceID: "ws_1", PlanCode: "pro", Interval: domain.IntervalMonthly,
		AmountCents: 9900, Currency: "CNY", Channel: "stripe", Status: domain.OrderPaid,
	}
	if pi != "" {
		repo.byPI[pi] = id
		repo.orders[id].Metadata = map[string]any{"payment_intent": pi}
	}
}

func webhookSvc(repo *fakeRepo, hooks BillingHooks) *BillingService {
	svc := NewBillingService(repo, NewChannelRegistry(), Config{Currency: "CNY"}, hooks,
		&fakeAuditor{}, func() time.Time { return testNow }, nil)
	return svc
}

func fireWebhook(t *testing.T, svc *BillingService, evt domain.PaymentEvent) error {
	t.Helper()
	svc.channels.Register(&fakeChannel{event: evt})
	return svc.HandleWebhook(context.Background(), evt.Channel, WebhookRequest{})
}

func TestRefundEvent_ResolvesViaPaymentIntentAnchor_P1_3(t *testing.T) {
	t.Run("checkout 完成锚 PI → 退款事件（只携 pi_）成功关联并降级", func(t *testing.T) {
		repo := newFakeRepo()
		repo.wsPlan["ws_1"] = "pro"
		repo.orders["ord_1"] = &domain.Order{
			ID: "ord_1", WorkspaceID: "ws_1", PlanCode: "pro", Interval: domain.IntervalMonthly,
			AmountCents: 9900, Currency: "CNY", Channel: "stripe", Status: domain.OrderPending,
		}
		svc := webhookSvc(repo, BillingHooks{})

		require.NoError(t, fireWebhook(t, svc, domain.PaymentEvent{
			Channel: "stripe", ChannelEventID: "evt_pay", Type: domain.EventCheckoutCompleted,
			OrderID: "ord_1", ChannelRef: "cs_1", PaymentIntentRef: "pi_1", AmountCents: 9900,
		}))
		assert.Equal(t, domain.OrderPaid, repo.orders["ord_1"].Status)
		require.Equal(t, "ord_1", repo.byPI["pi_1"], "PI 必须锚进订单（metadata）")
		assert.Equal(t, "pro", repo.wsPlan["ws_1"])

		require.NoError(t, fireWebhook(t, svc, domain.PaymentEvent{
			Channel: "stripe", ChannelEventID: "evt_rf", Type: domain.EventRefundCreated,
			ChannelRef: "pi_1", PaymentIntentRef: "pi_1",
		}))
		assert.Equal(t, domain.OrderRefunded, repo.orders["ord_1"].Status, "P1-3：退款经 PI 锚关联到订单")
		assert.Equal(t, "free", repo.wsPlan["ws_1"], "BQ3 降级随退款生效")
		assert.True(t, repo.processed["stripe:evt_rf"])
	})

	t.Run("payment_intent.payment_failed 只携 PI → 经锚关联置 failed", func(t *testing.T) {
		repo := newFakeRepo()

		repo.orders["ord_2"] = &domain.Order{
			ID: "ord_2", WorkspaceID: "ws_1", PlanCode: "pro", Interval: domain.IntervalMonthly,
			AmountCents: 9900, Currency: "CNY", Channel: "stripe", Status: domain.OrderPending,
		}
		repo.byPI["pi_2"] = "ord_2"
		svc := webhookSvc(repo, BillingHooks{})

		require.NoError(t, fireWebhook(t, svc, domain.PaymentEvent{
			Channel: "stripe", ChannelEventID: "evt_pf", Type: domain.EventPaymentFailed,
			ChannelRef: "pi_2", PaymentIntentRef: "pi_2",
		}))
		assert.Equal(t, domain.OrderFailed, repo.orders["ord_2"].Status, "P1-3：失败事件经 PI 锚关联")
	})

	t.Run("无锚且 channel_ref 不匹配 → 终态收敛 processed（不误伤）", func(t *testing.T) {
		repo := newFakeRepo()
		seedPaidOrder(repo, "ord_3", "")
		repo.byRef["stripe:cs_3"] = "ord_3"
		svc := webhookSvc(repo, BillingHooks{})

		require.NoError(t, fireWebhook(t, svc, domain.PaymentEvent{
			Channel: "stripe", ChannelEventID: "evt_x", Type: domain.EventRefundCreated,
			ChannelRef: "pi_unknown",
		}))
		assert.Equal(t, domain.OrderPaid, repo.orders["ord_3"].Status, "关联不到则不动订单")
		assert.True(t, repo.processed["stripe:evt_x"])
	})
}

func TestHandlePaid_SecondHalfFailure_FailsEventAndRecovers_P1_4(t *testing.T) {
	repo := newFakeRepo()
	repo.orders["ord_1"] = &domain.Order{
		ID: "ord_1", WorkspaceID: "ws_1", PlanCode: "pro", Interval: domain.IntervalMonthly,
		AmountCents: 9900, Currency: "CNY", Channel: "stripe", Status: domain.OrderPending,
	}
	var hookFires [][3]string
	svc := webhookSvc(repo, BillingHooks{
		OnPlanChanged: func(_ context.Context, ws, from, to string) error {
			hookFires = append(hookFires, [3]string{ws, from, to})
			return nil
		},
	})

	repo.changePlanErr = errors.New("db down")
	evt := domain.PaymentEvent{
		Channel: "stripe", ChannelEventID: "evt_p1", Type: domain.EventCheckoutCompleted,
		OrderID: "ord_1", ChannelRef: "cs_1", AmountCents: 9900,
	}
	err := fireWebhook(t, svc, evt)
	require.Error(t, err, "failEvent 原样上抛（HTTP 5xx 触发渠道重试）")
	assert.Equal(t, "error", repo.events["stripe:evt_p1"], "P1-4：事件标 error 可重放（修复前裸 return 停留 received）")
	assert.Equal(t, domain.OrderPaid, repo.orders["ord_1"].Status, "状态迁移已成功")
	_, written := repo.wsPlan["ws_1"]
	assert.False(t, written, "套餐尚未写入")

	repo.changePlanErr = nil
	require.NoError(t, fireWebhook(t, svc, evt))
	assert.Equal(t, "pro", repo.wsPlan["ws_1"], "P1-4：重试补完套餐写入（不提前收敛）")
	assert.True(t, repo.processed["stripe:evt_p1"])
	assert.Equal(t, [][3]string{{"ws_1", "free", "pro"}}, hookFires, "补写场景钩子仍扇出一次")
}

func TestHandleRenewed_AllErrors_FailEvent_P1_4(t *testing.T) {
	t.Run("FindWorkspaceBySubscription 失败 → 标 error（不裸 return）", func(t *testing.T) {
		repo := newFakeRepo()
		repo.bySub["sub_1"] = "ws_1"
		repo.findSubErr = errors.New("db down")
		svc := webhookSvc(repo, BillingHooks{})
		err := fireWebhook(t, svc, domain.PaymentEvent{
			Channel: "stripe", ChannelEventID: "evt_r1", Type: domain.EventSubscriptionRenewed,
			SubscriptionRef: "sub_1",
		})
		require.Error(t, err)
		assert.Equal(t, "error", repo.events["stripe:evt_r1"], "P1-4：续期路径错误同样标 error 可重放")
	})
}

func TestHandleCanceled_AllErrors_FailEvent_P1_4(t *testing.T) {
	repo := newFakeRepo()
	repo.bySub["sub_2"] = "ws_1"
	repo.wsPlan["ws_1"] = "pro"
	repo.changePlanErr = errors.New("db down")
	svc := webhookSvc(repo, BillingHooks{})
	err := fireWebhook(t, svc, domain.PaymentEvent{
		Channel: "stripe", ChannelEventID: "evt_c1", Type: domain.EventSubscriptionCanceled,
		SubscriptionRef: "sub_2",
	})
	require.Error(t, err)
	assert.Equal(t, "error", repo.events["stripe:evt_c1"], "P1-4：取消路径错误同样标 error 可重放")
}

func TestHandlePaid_AmountMismatch_RefusesCredit_P2_1(t *testing.T) {
	t.Run("金额错配 → 拒入账 + 告警收敛（processed）+ 审计留痕", func(t *testing.T) {
		repo := newFakeRepo()
		auditor := &fakeAuditor{}
		repo.orders["ord_1"] = &domain.Order{
			ID: "ord_1", WorkspaceID: "ws_1", PlanCode: "pro", Interval: domain.IntervalMonthly,
			AmountCents: 9900, Currency: "CNY", Channel: "stripe", Status: domain.OrderPending,
		}
		svc := NewBillingService(repo, NewChannelRegistry(), Config{Currency: "CNY"}, BillingHooks{},
			auditor, func() time.Time { return testNow }, nil)

		require.NoError(t, fireWebhook(t, svc, domain.PaymentEvent{
			Channel: "stripe", ChannelEventID: "evt_m1", Type: domain.EventCheckoutCompleted,
			OrderID: "ord_1", ChannelRef: "cs_1", AmountCents: 100, Currency: "cny",
		}))
		assert.Equal(t, domain.OrderPending, repo.orders["ord_1"].Status, "错配不得入账")
		_, written := repo.wsPlan["ws_1"]
		assert.False(t, written, "错配不得换档")
		assert.True(t, repo.processed["stripe:evt_m1"], "重试不会修复金额错配：告警收敛")
		found := false
		for _, c := range auditor.calls {
			if c.action == "billing.amount_mismatch" {
				found = true
			}
		}
		assert.True(t, found, "错配必须审计留痕（billing.amount_mismatch）")
	})

	t.Run("币种错配 → 同款拒入账", func(t *testing.T) {
		repo := newFakeRepo()
		repo.orders["ord_2"] = &domain.Order{
			ID: "ord_2", WorkspaceID: "ws_1", PlanCode: "pro", Interval: domain.IntervalMonthly,
			AmountCents: 9900, Currency: "CNY", Channel: "stripe", Status: domain.OrderPending,
		}
		svc := webhookSvc(repo, BillingHooks{})
		require.NoError(t, fireWebhook(t, svc, domain.PaymentEvent{
			Channel: "stripe", ChannelEventID: "evt_m2", Type: domain.EventCheckoutCompleted,
			OrderID: "ord_2", ChannelRef: "cs_2", AmountCents: 9900, Currency: "usd",
		}))
		assert.Equal(t, domain.OrderPending, repo.orders["ord_2"].Status)
		assert.True(t, repo.processed["stripe:evt_m2"])
	})

	t.Run("币种大小写差异不算错配（CNY vs cny）", func(t *testing.T) {
		repo := newFakeRepo()
		repo.orders["ord_3"] = &domain.Order{
			ID: "ord_3", WorkspaceID: "ws_1", PlanCode: "pro", Interval: domain.IntervalMonthly,
			AmountCents: 9900, Currency: "CNY", Channel: "stripe", Status: domain.OrderPending,
		}
		svc := webhookSvc(repo, BillingHooks{})
		require.NoError(t, fireWebhook(t, svc, domain.PaymentEvent{
			Channel: "stripe", ChannelEventID: "evt_m3", Type: domain.EventCheckoutCompleted,
			OrderID: "ord_3", ChannelRef: "cs_3", AmountCents: 9900, Currency: "cny",
		}))
		assert.Equal(t, domain.OrderPaid, repo.orders["ord_3"].Status, "EqualFold 比对：大小写不敏感")
	})

	t.Run("试用期订单 amount_total=0 跳过比对", func(t *testing.T) {
		repo := newFakeRepo()
		repo.plans["pro"] = domain.Plan{Code: "pro", Limits: map[string]int{"trial_days": 14}}
		repo.orders["ord_4"] = &domain.Order{
			ID: "ord_4", WorkspaceID: "ws_1", PlanCode: "pro", Interval: domain.IntervalMonthly,
			AmountCents: 9900, Currency: "CNY", Channel: "stripe", Status: domain.OrderPending, TrialDays: 14,
		}
		svc := webhookSvc(repo, BillingHooks{})
		require.NoError(t, fireWebhook(t, svc, domain.PaymentEvent{
			Channel: "stripe", ChannelEventID: "evt_m4", Type: domain.EventCheckoutCompleted,
			OrderID: "ord_4", ChannelRef: "cs_4", AmountCents: 0, SubscriptionRef: "sub_t",
		}))
		assert.Equal(t, domain.OrderPaid, repo.orders["ord_4"].Status, "试用期会话 amount_total=0 属正常")
	})
}

func TestHandleRenewed_LateRenewalAfterExpiry_SelfHeals_P2_3(t *testing.T) {
	t.Run("到期降级 free + 发票带 order_id → 恢复套餐 + 重订到期", func(t *testing.T) {
		repo := newFakeRepo()
		repo.bySub["sub_1"] = "ws_1"
		repo.wsPlan["ws_1"] = "free"
		repo.orders["ord_1"] = &domain.Order{ID: "ord_1", WorkspaceID: "ws_1", PlanCode: "pro",
			Interval: domain.IntervalMonthly, Status: domain.OrderPaid}
		repo.paidIv["ws_1"] = domain.IntervalMonthly
		var restored [][3]string
		svc := webhookSvc(repo, BillingHooks{
			OnPlanChanged: func(_ context.Context, ws, from, to string) error {
				restored = append(restored, [3]string{ws, from, to})
				return nil
			},
		})

		require.NoError(t, fireWebhook(t, svc, domain.PaymentEvent{
			Channel: "stripe", ChannelEventID: "evt_l1", Type: domain.EventSubscriptionRenewed,
			SubscriptionRef: "sub_1", OrderID: "ord_1",
		}))
		assert.Equal(t, "pro", repo.wsPlan["ws_1"], "P2-3：迟到续期自愈恢复付费档（修复前永久 free）")
		require.Len(t, restored, 1)
		assert.Equal(t, [3]string{"ws_1", "free", "pro"}, restored[0])
		require.Len(t, repo.setSubs, 1)
		assert.Equal(t, "sub_1", repo.setSubs[0].ref, "到期时间重订")
		assert.True(t, repo.processed["stripe:evt_l1"])
	})

	t.Run("未降级（plan 已是订单套餐）→ 只续期，不重复换档", func(t *testing.T) {
		repo := newFakeRepo()
		repo.bySub["sub_2"] = "ws_2"
		repo.wsPlan["ws_2"] = "pro"
		repo.orders["ord_2"] = &domain.Order{ID: "ord_2", WorkspaceID: "ws_2", PlanCode: "pro", Status: domain.OrderPaid}
		svc := webhookSvc(repo, BillingHooks{})

		require.NoError(t, fireWebhook(t, svc, domain.PaymentEvent{
			Channel: "stripe", ChannelEventID: "evt_l2", Type: domain.EventSubscriptionRenewed,
			SubscriptionRef: "sub_2", OrderID: "ord_2",
		}))
		assert.Empty(t, repo.changePlans, "正常续期零额外换档")
	})

	t.Run("发票不带 order_id → 仅续期（原行为）", func(t *testing.T) {
		repo := newFakeRepo()
		repo.bySub["sub_3"] = "ws_3"
		repo.wsPlan["ws_3"] = "free"
		svc := webhookSvc(repo, BillingHooks{})
		require.NoError(t, fireWebhook(t, svc, domain.PaymentEvent{
			Channel: "stripe", ChannelEventID: "evt_l3", Type: domain.EventSubscriptionRenewed,
			SubscriptionRef: "sub_3",
		}))
		assert.Empty(t, repo.changePlans, "无 order_id 不猜测套餐")
		assert.Len(t, repo.setSubs, 1, "到期时间仍重订")
	})
}
