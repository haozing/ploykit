package pgrepo

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/billing/app"
	"github.com/haozing/ploykit/billing/domain"
)

func seedMeteredPlan(t *testing.T, repo *Repo) string {
	t.Helper()
	const code = "meter_e2e"
	_, err := repo.pool.Exec(context.Background(), `
		INSERT INTO plan (code, name, limits, sort_no) VALUES
		($1, '计量测试档', '{"metered_tasks_monthly_unit_cents":10,"metered_tasks_monthly_included":100,
			"metered_api_calls_unit_cents":2,"metered_api_calls_included":1000,"tasks_monthly":-1}'::jsonb, 90)`,
		code)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = repo.pool.Exec(context.Background(), `DELETE FROM plan WHERE code = $1`, code)
	})
	return code
}

func TestInsertOverageOrder_UniqueIndex(t *testing.T) {
	repo := subTestDB(t)
	seedMeteredPlan(t, repo)
	ctx := context.Background()
	exp := time.Now().UTC().AddDate(0, 1, 0)
	ws := seedWS(t, repo, "meter_e2e", "sub_ov", &exp)

	order, created, err := repo.InsertOverageOrder(ctx, domain.Order{
		WorkspaceID: ws, PlanCode: "meter_e2e", Interval: domain.IntervalOneTime,
		AmountCents: 200, Currency: "CNY", Channel: "manual", Status: domain.OrderPending,
		Metadata: map[string]any{"overage_period": "2026-09", "dim": "tasks_monthly", "used": int64(120), "included": int64(100)},
	})
	require.NoError(t, err)
	assert.True(t, created)
	assert.NotEmpty(t, order.ID)
	assert.Equal(t, "meter_e2e", order.PlanCode, "回填套餐应为工作区当前档")

	var interval, status, channel string
	var amount int
	var meta map[string]any
	var userID string
	require.NoError(t, repo.pool.QueryRow(ctx, `
		SELECT interval, status, channel, amount_cents, metadata, user_id
		FROM "order" WHERE id = $1`, order.ID).
		Scan(&interval, &status, &channel, &amount, &meta, &userID))
	assert.Equal(t, "one_time", interval)
	assert.Equal(t, "pending", status)
	assert.Equal(t, "manual", channel)
	assert.Equal(t, 200, amount)
	assert.Equal(t, "2026-09", meta["overage_period"])
	assert.Equal(t, "tasks_monthly", meta["dim"])
	assert.Equal(t, float64(120), meta["used"])
	assert.Equal(t, float64(100), meta["included"])

	var creator string
	require.NoError(t, repo.pool.QueryRow(ctx, `SELECT created_by FROM workspace WHERE id = $1`, ws).Scan(&creator))
	assert.Equal(t, creator, userID)

	_, created, err = repo.InsertOverageOrder(ctx, domain.Order{
		WorkspaceID: ws, Interval: domain.IntervalOneTime,
		AmountCents: 40, Currency: "CNY", Channel: "manual", Status: domain.OrderPending,
		Metadata: map[string]any{"overage_period": "2026-09", "dim": "api_calls", "used": int64(1020), "included": int64(1000)},
	})
	require.NoError(t, err)
	assert.False(t, created, "uq_order_overage_period 粒度 = (workspace_id, period)：同周期至多一张超额订单")

	_, created, err = repo.InsertOverageOrder(ctx, domain.Order{
		WorkspaceID: ws, Interval: domain.IntervalOneTime,
		AmountCents: 60, Currency: "CNY", Channel: "manual", Status: domain.OrderPending,
		Metadata: map[string]any{"overage_period": "2026-10", "dim": "tasks_monthly", "used": int64(106), "included": int64(100)},
	})
	require.NoError(t, err)
	assert.True(t, created, "跨周期可再出账")

	var n int
	require.NoError(t, repo.pool.QueryRow(ctx,
		`SELECT count(*) FROM "order" WHERE workspace_id = $1 AND metadata->>'overage_period' = '2026-09'`, ws).Scan(&n))
	assert.Equal(t, 1, n)
}

func TestCreateOverageOrder_ServiceIntegration(t *testing.T) {
	repo := subTestDB(t)
	seedMeteredPlan(t, repo)
	ctx := context.Background()
	exp := time.Now().UTC().AddDate(0, 1, 0)
	ws := seedWS(t, repo, "meter_e2e", "sub_ov2", &exp)
	now := time.Now().UTC().Truncate(time.Microsecond)
	svc := app.NewBillingService(repo, app.NewChannelRegistry(), app.Config{Currency: "CNY"},
		app.BillingHooks{}, nil, func() time.Time { return now }, nil)

	order, created, err := svc.CreateOverageOrder(ctx, ws, "2026-09",
		[]app.OverageItem{{Dim: "tasks_monthly", Used: 120, Included: 100, UnitCents: 10}}, now)
	require.NoError(t, err)
	require.True(t, created)
	assert.Equal(t, 200, order.AmountCents)
	assert.Equal(t, domain.IntervalOneTime, order.Interval)
	assert.Equal(t, domain.OrderPending, order.Status)

	_, created, err = svc.CreateOverageOrder(ctx, ws, "2026-09",
		[]app.OverageItem{{Dim: "api_calls", Used: 40, Included: 1000, UnitCents: 2}}, now)
	require.NoError(t, err)
	assert.False(t, created)

	_, created, err = svc.CreateOverageOrder(ctx, ws, "2026-09",
		[]app.OverageItem{{Dim: "tasks_monthly", Used: 130, Included: 100, UnitCents: 10}}, now)
	require.NoError(t, err)
	assert.False(t, created)
}
