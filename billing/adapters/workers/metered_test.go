package workers

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/billing/app"
	"github.com/haozing/ploykit/platform/webx"
)

type fakeUsageReader struct {
	mu   sync.Mutex
	vals map[string]int64
}

func (f *fakeUsageReader) read(_ context.Context, ws, key, period string) (int64, int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.vals[ws+"|"+key+"|"+period], 0, nil
}

func seedMeteredPlan(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	const code = "meter_wk"
	_, err := pool.Exec(context.Background(), `
		INSERT INTO plan (code, name, limits, sort_no) VALUES
		($1, 'worker计量档', '{"metered_tasks_monthly_unit_cents":10,"metered_tasks_monthly_included":100,
			"metered_api_calls_unit_cents":2,"metered_api_calls_included":1000}'::jsonb, 91)`, code)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM plan WHERE code = $1`, code)
	})
	return code
}

func seedMeteredWS(t *testing.T, pool *pgxpool.Pool, planCode string, expiresAt *time.Time) string {
	t.Helper()
	ctx := context.Background()
	uid := uuid.NewString()
	_, err := pool.Exec(ctx, `INSERT INTO "user" (id, email) VALUES ($1, $2)`,
		uid, fmt.Sprintf("mt-%s@test.dev", uid[:12]))
	require.NoError(t, err)
	wsID := uuid.NewString()
	_, err = pool.Exec(ctx, `
		INSERT INTO workspace (id, slug, name, plan_code, created_by, plan_expires_at)
		VALUES ($1, $2, 'worker计量测试', $3, $4, $5)`,
		wsID, "mt-"+uid[:12], planCode, uid, expiresAt)
	require.NoError(t, err)
	t.Cleanup(func() {
		cctx := context.Background()
		_, _ = pool.Exec(cctx, `DELETE FROM workspace WHERE id = $1`, wsID)
		_, _ = pool.Exec(cctx, `DELETE FROM "user" WHERE id = $1`, uid)
	})
	return wsID
}

type overageAuditSink struct {
	mu      sync.Mutex
	actions []string
}

func (a *overageAuditSink) Record(_ context.Context, _ *string, _ *webx.Principal, action, _, _ string, _ map[string]any) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.actions = append(a.actions, action)
}

func (a *overageAuditSink) count(action string) int {
	a.mu.Lock()
	defer a.mu.Unlock()
	n := 0
	for _, x := range a.actions {
		if x == action {
			n++
		}
	}
	return n
}

func countOverageOrders(t *testing.T, pool *pgxpool.Pool, ws, period string) int {
	t.Helper()
	var n int
	require.NoError(t, pool.QueryRow(context.Background(),
		`SELECT count(*) FROM "order" WHERE workspace_id = $1 AND metadata->>'overage_period' = $2`, ws, period).Scan(&n))
	return n
}

func TestMeteredOverageWorker_NameAndShutdown(t *testing.T) {
	w := &MeteredOverageWorker{}
	assert.Equal(t, "billing_metered", w.Name())

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- w.Run(ctx) }()
	cancel()
	select {
	case err := <-done:
		assert.NoError(t, err)
	case <-time.After(2 * time.Second):
		t.Fatal("Run 未随 ctx 取消退出")
	}
}

func TestMeterDueOverages_Integration(t *testing.T) {
	repo, pool := workerTestDB(t)
	planCode := seedMeteredPlan(t, pool)
	ctx := context.Background()

	now := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	active := now.AddDate(0, 3, 0)
	past := now.Add(-time.Hour)

	wsNull := seedMeteredWS(t, pool, planCode, nil)
	wsPast := seedMeteredWS(t, pool, planCode, &past)
	wsLive := seedMeteredWS(t, pool, planCode, &active)

	usage := &fakeUsageReader{vals: map[string]int64{
		wsNull + "|tasks_monthly|2026-09": 500,
		wsPast + "|tasks_monthly|2026-09": 500,
		wsLive + "|tasks_monthly|2026-09": 120,
	}}
	audits := &overageAuditSink{}
	var hookCount int
	var mu sync.Mutex
	svc := app.NewBillingService(repo, app.NewChannelRegistry(), app.Config{Currency: "CNY"}, app.BillingHooks{
		OnMeteredOverage: func(_ context.Context, _, _, _ string, _ int, _ int64) error {
			mu.Lock()
			defer mu.Unlock()
			hookCount++
			return nil
		},
	}, audits, func() time.Time { return time.Now().UTC() }, nil)

	created, err := svc.MeterDueOverages(ctx, now, usage.read, 10)
	require.NoError(t, err)
	require.Len(t, created, 1, "只有当前订阅有效的工作区出账")
	assert.Equal(t, wsLive, created[0].WorkspaceID)
	assert.Equal(t, 200, created[0].AmountCents)
	assert.Equal(t, 1, countOverageOrders(t, pool, wsLive, "2026-09"))
	assert.Equal(t, 0, countOverageOrders(t, pool, wsNull, "2026-09"), "无订阅（plan_expires_at IS NULL）不计量")
	assert.Equal(t, 0, countOverageOrders(t, pool, wsPast, "2026-09"), "订阅已过期（< now）不计量")
	assert.Equal(t, 1, audits.count("billing.metered_overage"))

	created, err = svc.MeterDueOverages(ctx, now, usage.read, 10)
	require.NoError(t, err)
	assert.Empty(t, created)
	assert.Equal(t, 1, countOverageOrders(t, pool, wsLive, "2026-09"))
	mu.Lock()
	assert.Equal(t, 1, hookCount)
	mu.Unlock()

	usage.vals[wsLive+"|tasks_monthly|2026-10"] = 150
	created, err = svc.MeterDueOverages(ctx, now.AddDate(0, 1, 0), usage.read, 10)
	require.NoError(t, err)
	require.Len(t, created, 1)
	assert.Equal(t, 500, created[0].AmountCents)
	assert.Equal(t, 1, countOverageOrders(t, pool, wsLive, "2026-10"))
}

func TestMeterDueOverages_MultiDim_Integration(t *testing.T) {
	repo, pool := workerTestDB(t)
	planCode := seedMeteredPlan(t, pool)
	ctx := context.Background()

	active := time.Now().UTC().AddDate(0, 1, 0)
	ws := seedMeteredWS(t, pool, planCode, &active)
	usage := &fakeUsageReader{vals: map[string]int64{
		ws + "|tasks_monthly|2026-09": 130,
		ws + "|api_calls|2026-09":     1020,
	}}
	var dims []int
	var mu sync.Mutex
	svc := app.NewBillingService(repo, app.NewChannelRegistry(), app.Config{Currency: "CNY"}, app.BillingHooks{
		OnMeteredOverage: func(_ context.Context, _, _, _ string, items int, _ int64) error {
			mu.Lock()
			defer mu.Unlock()
			dims = append(dims, items)
			return nil
		},
	}, nil, func() time.Time { return time.Now().UTC() }, nil)

	now := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	created, err := svc.MeterDueOverages(ctx, now, usage.read, 10)
	require.NoError(t, err)
	require.Len(t, created, 1, "多维同周期：聚合为一单")
	assert.Equal(t, 340, created[0].AmountCents, "(130-100)*10 + (1020-1000)*2 = 340")
	assert.Equal(t, 1, countOverageOrders(t, pool, ws, "2026-09"))
	mu.Lock()
	assert.Equal(t, []int{2}, dims, "钩子只在首次出账触发一次，携带聚合维度数")
	mu.Unlock()
}

func TestMeteredOverageWorker_LoopCreatesOrders(t *testing.T) {
	repo, pool := workerTestDB(t)
	planCode := seedMeteredPlan(t, pool)
	active := time.Now().UTC().AddDate(0, 1, 0)
	ws := seedMeteredWS(t, pool, planCode, &active)

	usage := &fakeUsageReader{vals: map[string]int64{
		ws + "|tasks_monthly|2026-09": 120,
	}}
	svc := app.NewBillingService(repo, app.NewChannelRegistry(), app.Config{Currency: "CNY"},
		app.BillingHooks{}, nil, func() time.Time { return time.Now().UTC() }, nil)

	w := &MeteredOverageWorker{Billing: svc, Usage: usage.read, Every: 30 * time.Millisecond, Batch: 10}
	wctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- w.Run(wctx) }()
	require.Eventually(t, func() bool {
		return countOverageOrdersQuiet(pool, ws, "2026-09") == 1
	}, 5*time.Second, 20*time.Millisecond, "worker 应在数个 tick 内生成超额订单")
	cancel()
	select {
	case err := <-done:
		assert.NoError(t, err)
	case <-time.After(2 * time.Second):
		t.Fatal("worker 未随 ctx 取消退出")
	}

	assert.Equal(t, 1, countOverageOrdersQuiet(pool, ws, "2026-09"))
}

func countOverageOrdersQuiet(pool *pgxpool.Pool, ws, period string) int {
	var n int
	_ = pool.QueryRow(context.Background(),
		`SELECT count(*) FROM "order" WHERE workspace_id = $1 AND metadata->>'overage_period' = $2`, ws, period).Scan(&n)
	return n
}
