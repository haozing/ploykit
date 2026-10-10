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

	"github.com/haozing/ploykit/migrations"
	"github.com/haozing/ploykit/platform/pg"
	"github.com/haozing/ploykit/platform/pgmigrate"
	"github.com/haozing/ploykit/quota"
)

func workerTestDB(t *testing.T) (*quota.Service, *pgxpool.Pool) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	ctx := context.Background()
	db, err := pg.Connect(ctx, dsn, pg.Options{})
	require.NoError(t, err)
	_, err = pgmigrate.New(db.Pool(), migrations.FS, ".").Up(ctx, 0)
	require.NoError(t, err)
	t.Cleanup(func() { db.Close() })
	return quota.NewService(db.Pool()), db.Pool()
}

func seedWS(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	ctx := context.Background()
	uid := uuid.NewString()
	email := fmt.Sprintf("qwx-%s@test.local", uid[:12])
	_, err := pool.Exec(ctx, `INSERT INTO "user" (id, email) VALUES ($1, $2)`, uid, email)
	require.NoError(t, err)
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM "user" WHERE id = $1`, uid) })
	wsID := uuid.NewString()
	_, err = pool.Exec(ctx,
		`INSERT INTO workspace (id, slug, name, created_by) VALUES ($1, $2, 'quota worker test', $3)`,
		wsID, "qw-"+uid[:8], uid)
	require.NoError(t, err)
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM workspace WHERE id = $1`, wsID) })
	return wsID
}

func TestExpiryWorker_NameAndShutdown(t *testing.T) {
	w := &ExpiryWorker{}
	assert.Equal(t, "quota_reservation_expiry", w.Name())

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

func TestExpiryWorker_SweepsExpiredReservations(t *testing.T) {
	svc, pool := workerTestDB(t)
	ctx := context.Background()
	ws := seedWS(t, pool)

	res, err := svc.Reserve(ctx, ws, "tasks_monthly", 6, "worker-res-1", quota.ReserveOpts{})
	require.NoError(t, err)
	st, err := svc.Check(ctx, ws, "tasks_monthly", time.Now().UTC())
	require.NoError(t, err)
	assert.Equal(t, int64(6), st.Reserved)

	_, err = pool.Exec(ctx,
		`UPDATE quota_reservation SET expires_at = now() - interval '1 hour' WHERE id = $1`,
		res.ReservationID)
	require.NoError(t, err)

	var expiredHook int
	var mu sync.Mutex
	svc.WithHooks(quota.QuotaHooks{
		OnReservationExpired: func(_ context.Context, _, _, _ string, _ int64) error {
			mu.Lock()
			defer mu.Unlock()
			expiredHook++
			return nil
		},
	})

	w := &ExpiryWorker{Service: svc, Every: 30 * time.Millisecond, Batch: 10}
	wctx, cancel := context.WithCancel(ctx)
	done := make(chan error, 1)
	go func() { done <- w.Run(wctx) }()
	require.Eventually(t, func() bool {
		st, err := svc.Check(context.Background(), ws, "tasks_monthly", time.Now().UTC())
		return err == nil && st.Reserved == 0
	}, 5*time.Second, 20*time.Millisecond, "worker 应在数个 tick 内回退 reserved")
	cancel()
	select {
	case err := <-done:
		assert.NoError(t, err)
	case <-time.After(2 * time.Second):
		t.Fatal("worker 未随 ctx 取消退出")
	}

	var status string
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT status FROM quota_reservation WHERE id = $1`, res.ReservationID).Scan(&status))
	assert.Equal(t, quota.ReservationExpired, status)
	mu.Lock()
	defer mu.Unlock()
	assert.Equal(t, 1, expiredHook, "钩子恰一次（重复扫描不重复触发）")
}
