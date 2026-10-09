package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/billing/domain"
)

func TestOnPlanChangedTx_ErrorRollsBackPlanChange(t *testing.T) {
	repo := newFakeRepo()
	repo.plans["team"] = domain.Plan{Code: "team", Limits: map[string]int{"price_monthly_cents": 9900}}
	repo.wsPlan["ws_1"] = "pro"
	repo.orders["ord_1"] = &domain.Order{
		ID: "ord_1", WorkspaceID: "ws_1", PlanCode: "team",
		Interval: domain.IntervalMonthly, Status: domain.OrderPending,
	}
	notified := [][3]string{}
	svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{
		OnPlanChangedTx: func(_ context.Context, _ pgx.Tx, _, _, _ string) error {
			return errors.New("proration ledger write failed")
		},
		OnPlanChanged: func(_ context.Context, ws, from, to string) error {
			notified = append(notified, [3]string{ws, from, to})
			return nil
		},
	}, &fakeAuditor{}, func() time.Time { return testNow }, nil)
	svc.channels.Register(&fakeChannel{event: domain.PaymentEvent{
		Channel: "stripe", ChannelEventID: "evt_tx1", Type: domain.EventCheckoutCompleted, OrderID: "ord_1",
	}})

	err := svc.HandleWebhook(context.Background(), "stripe", WebhookRequest{})
	require.Error(t, err, "Tx 钩子 error 必须上抛（触发整体回滚语义）")
	assert.Equal(t, "pro", repo.wsPlan["ws_1"], "Tx 钩子返 error 时 plan_code 必须回滚不变")
	assert.Empty(t, repo.changePlans, "换档写事务未成立：ChangeWorkspacePlan 整体作废")
	assert.Empty(t, notified, "换档未成立：Observational OnPlanChanged 不得触发")
}

func TestOnPlanChangedTx_SuccessPassesFromTo(t *testing.T) {
	repo := newFakeRepo()
	repo.plans["team"] = domain.Plan{Code: "team", Limits: map[string]int{"price_monthly_cents": 9900}}
	repo.wsPlan["ws_1"] = "pro"
	repo.orders["ord_1"] = &domain.Order{
		ID: "ord_1", WorkspaceID: "ws_1", PlanCode: "team",
		Interval: domain.IntervalMonthly, Status: domain.OrderPending,
	}
	var txFrom, txTo string
	notified := [][3]string{}
	svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{
		OnPlanChangedTx: func(_ context.Context, _ pgx.Tx, _, from, to string) error {
			txFrom, txTo = from, to
			return nil
		},
		OnPlanChanged: func(_ context.Context, ws, from, to string) error {
			notified = append(notified, [3]string{ws, from, to})
			return nil
		},
	}, &fakeAuditor{}, func() time.Time { return testNow }, nil)
	svc.channels.Register(&fakeChannel{event: domain.PaymentEvent{
		Channel: "stripe", ChannelEventID: "evt_tx2", Type: domain.EventCheckoutCompleted, OrderID: "ord_1",
	}})

	require.NoError(t, svc.HandleWebhook(context.Background(), "stripe", WebhookRequest{}))
	assert.Equal(t, "team", repo.wsPlan["ws_1"])
	assert.Equal(t, "pro", txFrom, "Tx 钩子的 from 应为锁定读的旧套餐")
	assert.Equal(t, "team", txTo)
	assert.Equal(t, [][3]string{{"ws_1", "pro", "team"}}, notified, "通知类钩子照常触发（分工并存）")
}
