package workers

import (
	"context"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/billing/adapters/pgrepo"
	"github.com/haozing/ploykit/billing/app"
	"github.com/haozing/ploykit/migrations"
	"github.com/haozing/ploykit/platform/pg"
	"github.com/haozing/ploykit/platform/pgmigrate"
	"github.com/haozing/ploykit/platform/webx"
)

func workerTestDB(t *testing.T) (*pgrepo.Repo, *pgxpool.Pool) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	ctx := context.Background()
	db, err := pg.Connect(ctx, dsn, pg.Options{})
	require.NoError(t, err)
	require.NoError(t, pgmigrate.Up(ctx, db.Pool(), migrations.FS, "."))
	t.Cleanup(func() { db.Close() })
	return pgrepo.New(db.Pool()), db.Pool()
}

func seedDueWS(t *testing.T, pool *pgxpool.Pool, expiredAgo time.Duration) string {
	t.Helper()
	ctx := context.Background()
	uid := uuid.NewString()
	_, err := pool.Exec(ctx, `INSERT INTO "user" (id, email) VALUES ($1, $2)`,
		uid, fmt.Sprintf("wk-%s@test.dev", uid[:12]))
	require.NoError(t, err)
	wsID := uuid.NewString()
	_, err = pool.Exec(ctx, `
		INSERT INTO workspace (id, slug, name, plan_code, created_by, plan_expires_at, subscription_ref)
		VALUES ($1, $2, '到期worker测试', 'pro', $3, $4, $5)`,
		wsID, "wk-"+uid[:12], uid, time.Now().UTC().Add(-expiredAgo), "sub_wk_"+uid[:8])
	require.NoError(t, err)
	t.Cleanup(func() {
		cctx := context.Background()
		_, _ = pool.Exec(cctx, `DELETE FROM workspace WHERE id = $1`, wsID)
		_, _ = pool.Exec(cctx, `DELETE FROM "user" WHERE id = $1`, uid)
	})
	return wsID
}

type planChange struct{ ws, from, to string }

type hookSink struct {
	mu      sync.Mutex
	changes []planChange
}

func (h *hookSink) onPlanChanged(_ context.Context, ws, from, to string) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.changes = append(h.changes, planChange{ws, from, to})
	return nil
}

func (h *hookSink) snapshot() []planChange {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]planChange(nil), h.changes...)
}

type auditSink struct {
	mu      sync.Mutex
	actions []string
}

func (a *auditSink) Record(_ context.Context, _ *string, _ *webx.Principal, action, _, _ string, _ map[string]any) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.actions = append(a.actions, action)
}

func (a *auditSink) snapshot() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]string(nil), a.actions...)
}

func TestExpiryWorker_NameAndShutdown(t *testing.T) {
	w := &ExpiryWorker{}
	assert.Equal(t, "billing_expiry", w.Name())

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

func TestExpiryWorker_DowngradesDueWorkspaces(t *testing.T) {
	repo, pool := workerTestDB(t)
	ctx := context.Background()

	due := seedDueWS(t, pool, time.Hour)
	seedDueWS(t, pool, -24*time.Hour)
	hooks := &hookSink{}
	audits := &auditSink{}
	svc := app.NewBillingService(repo, app.NewChannelRegistry(), app.Config{}, app.BillingHooks{
		OnPlanChanged: hooks.onPlanChanged,
	}, audits, func() time.Time { return time.Now().UTC() }, nil)

	expired, err := svc.ExpireDueWorkspaces(ctx, time.Now().UTC(), 10)
	require.NoError(t, err)
	require.Len(t, expired, 1)
	assert.Equal(t, due, expired[0].WorkspaceID)
	assert.Equal(t, "pro", expired[0].FromPlan)

	var plan string
	require.NoError(t, pool.QueryRow(ctx, `SELECT plan_code FROM workspace WHERE id = $1`, due).Scan(&plan))
	assert.Equal(t, "free", plan, "到期工作区应降级 free")
	require.Contains(t, hooks.snapshot(), planChange{due, "pro", "free"})
	require.Contains(t, audits.snapshot(), "billing.plan_expired")

	due2 := seedDueWS(t, pool, 30*time.Minute)
	w := &ExpiryWorker{Service: svc, Every: 30 * time.Millisecond, Batch: 10}
	wctx, cancel := context.WithCancel(ctx)
	done := make(chan error, 1)
	go func() { done <- w.Run(wctx) }()
	require.Eventually(t, func() bool {
		for _, c := range hooks.snapshot() {
			if c.ws == due2 && c.to == "free" {
				return true
			}
		}
		return false
	}, 5*time.Second, 20*time.Millisecond, "worker 应在数个 tick 内降级新到期的工作区")
	cancel()
	select {
	case err := <-done:
		assert.NoError(t, err)
	case <-time.After(2 * time.Second):
		t.Fatal("worker 未随 ctx 取消退出")
	}

	var n int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM subscription_event WHERE workspace_id = $1 AND to_plan = 'free'`, due2).Scan(&n))
	assert.Equal(t, 1, n, "重复扫描不得重复降级留痕")
}
