package pgrepo

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/migrations"
	"github.com/haozing/ploykit/platform/pg"
	pgm "github.com/haozing/ploykit/platform/pgmigrate"
)

func subTestDB(t *testing.T) *Repo {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	ctx := context.Background()
	db, err := pg.Connect(ctx, dsn, pg.Options{})
	require.NoError(t, err)
	require.NoError(t, pgm.Up(ctx, db.Pool(), migrations.FS, "."))
	t.Cleanup(func() { db.Close() })
	return New(db.Pool())
}

func timePtr(t time.Time) *time.Time { return &t }

func seedWS(t *testing.T, repo *Repo, planCode string, subRef string, expiresAt *time.Time) string {
	t.Helper()
	ctx := context.Background()
	uid := uuid.NewString()
	slug := "ws-" + uid[:12]
	_, err := repo.pool.Exec(ctx, `INSERT INTO "user" (id, email) VALUES ($1, $2)`, uid, fmt.Sprintf("sub-%s@test.dev", uid[:12]))
	require.NoError(t, err)
	wsID := uuid.NewString()
	_, err = repo.pool.Exec(ctx, `
		INSERT INTO workspace (id, slug, name, plan_code, created_by, plan_expires_at, subscription_ref)
		VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''))`,
		wsID, slug, "订阅测试", planCode, uid, expiresAt, subRef)
	require.NoError(t, err)
	t.Cleanup(func() {

		cctx := context.Background()
		_, _ = repo.pool.Exec(cctx, `DELETE FROM workspace WHERE id = $1`, wsID)
		_, _ = repo.pool.Exec(cctx, `DELETE FROM "user" WHERE id = $1`, uid)
	})
	return wsID
}

func seedPaidOrder(t *testing.T, repo *Repo, wsID, planCode, interval string, paidAt time.Time) {
	t.Helper()
	_, err := repo.pool.Exec(context.Background(), `
		INSERT INTO "order" (workspace_id, user_id, plan_code, interval, amount_cents, currency, channel, status, paid_at, created_at)
		VALUES ($1, (SELECT created_by FROM workspace WHERE id = $1), $2, $3, 9900, 'USD', 'stripe', 'paid', $4, $4)`,
		wsID, planCode, interval, paidAt)
	require.NoError(t, err)
}

func TestSetWorkspaceSubscription(t *testing.T) {
	repo := subTestDB(t)
	ctx := context.Background()
	ws := seedWS(t, repo, "free", "", nil)
	now := time.Now().UTC().Truncate(time.Microsecond)
	expiry := now.AddDate(0, 1, 0)

	require.NoError(t, repo.SetWorkspaceSubscription(ctx, ws, "sub_1", expiry, now))
	var gotRef string
	var gotExp time.Time
	require.NoError(t, repo.pool.QueryRow(ctx,
		`SELECT subscription_ref, plan_expires_at FROM workspace WHERE id = $1`, ws).Scan(&gotRef, &gotExp))
	assert.Equal(t, "sub_1", gotRef)
	assert.True(t, gotExp.Equal(expiry), "到期时间应精确写入，got %v", gotExp)

	expiry2 := expiry.AddDate(1, 0, 0)
	require.NoError(t, repo.SetWorkspaceSubscription(ctx, ws, "sub_2", expiry2, now))
	require.NoError(t, repo.pool.QueryRow(ctx,
		`SELECT subscription_ref, plan_expires_at FROM workspace WHERE id = $1`, ws).Scan(&gotRef, &gotExp))
	assert.Equal(t, "sub_2", gotRef)
	assert.True(t, gotExp.Equal(expiry2))

	require.NoError(t, repo.SetWorkspaceSubscription(ctx, ws, "", time.Time{}, now))
	var nullRef, nullExp any
	require.NoError(t, repo.pool.QueryRow(ctx,
		`SELECT subscription_ref, plan_expires_at FROM workspace WHERE id = $1`, ws).Scan(&nullRef, &nullExp))
	assert.Nil(t, nullRef)
	assert.Nil(t, nullExp)

	require.Error(t, repo.SetWorkspaceSubscription(ctx, uuid.NewString(), "sub_x", expiry, now))
}

func TestFindWorkspaceBySubscription(t *testing.T) {
	repo := subTestDB(t)
	ctx := context.Background()
	expiry := time.Now().UTC().AddDate(0, 1, 0)
	ws := seedWS(t, repo, "pro", "sub_find_me", &expiry)

	gotWS, gotPlan, ok, err := repo.FindWorkspaceBySubscription(ctx, "sub_find_me")
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, ws, gotWS)
	assert.Equal(t, "pro", gotPlan)

	_, _, ok, err = repo.FindWorkspaceBySubscription(ctx, "sub_unknown")
	require.NoError(t, err)
	assert.False(t, ok)
}

func TestLatestPaidOrderInterval(t *testing.T) {
	repo := subTestDB(t)
	ctx := context.Background()
	ws := seedWS(t, repo, "pro", "", nil)
	base := time.Now().UTC().Add(-48 * time.Hour)

	_, ok, err := repo.LatestPaidOrderInterval(ctx, ws)
	require.NoError(t, err)
	assert.False(t, ok)

	seedPaidOrder(t, repo, ws, "pro", "monthly", base)
	seedPaidOrder(t, repo, ws, "pro", "yearly", base.Add(time.Hour))
	interval, ok, err := repo.LatestPaidOrderInterval(ctx, ws)
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, "yearly", interval, "应取 paid_at 最近一张的 interval")

	seedPaidOrder(t, repo, ws, "pro", "one_time", base.Add(2*time.Hour))
	interval, ok, err = repo.LatestPaidOrderInterval(ctx, ws)
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, "yearly", interval, "P2-2：one_time 超额单不得覆盖周期推断")

	other := seedWS(t, repo, "pro", "", nil)
	_, err = repo.pool.Exec(ctx, `
		INSERT INTO "order" (workspace_id, user_id, plan_code, interval, amount_cents, currency, channel, status)
		VALUES ($1, (SELECT created_by FROM workspace WHERE id = $1), 'pro', 'yearly', 9900, 'USD', 'stripe', 'pending')`, other)
	require.NoError(t, err)
	_, ok, err = repo.LatestPaidOrderInterval(ctx, other)
	require.NoError(t, err)
	assert.False(t, ok, "pending 订单不算 paid")
}

func TestOrderPaymentIntentAnchor_P1_3(t *testing.T) {
	repo := subTestDB(t)
	ctx := context.Background()
	ws := seedWS(t, repo, "pro", "", nil)
	now := time.Now().UTC()
	seedPaidOrder(t, repo, ws, "pro", "monthly", now)

	var orderID string
	require.NoError(t, repo.pool.QueryRow(ctx,
		`SELECT id FROM "order" WHERE workspace_id = $1 LIMIT 1`, ws).Scan(&orderID))

	_, ok, err := repo.FindOrderByPaymentIntent(ctx, "pi_anchor_1")
	require.NoError(t, err)
	assert.False(t, ok)

	require.NoError(t, repo.SetOrderPaymentIntentRef(ctx, orderID, "pi_anchor_1"))
	require.NoError(t, repo.SetOrderPaymentIntentRef(ctx, orderID, "pi_anchor_1"))
	got, ok, err := repo.FindOrderByPaymentIntent(ctx, "pi_anchor_1")
	require.NoError(t, err)
	require.True(t, ok)
	assert.Equal(t, orderID, got.ID)
	assert.Equal(t, domain.BillingInterval("monthly"), got.Interval)
	var pi string
	require.NoError(t, repo.pool.QueryRow(ctx,
		`SELECT metadata->>'payment_intent' FROM "order" WHERE id = $1`, orderID).Scan(&pi))
	assert.Equal(t, "pi_anchor_1", pi)

	_, ok, err = repo.FindOrderByPaymentIntent(ctx, "pi_unknown")
	require.NoError(t, err)
	assert.False(t, ok)
}

func TestExpireDueWorkspaces(t *testing.T) {
	repo := subTestDB(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Microsecond)

	due := seedWS(t, repo, "pro", "sub_due", timePtr(time.Now().UTC().Add(-time.Hour)))
	future := seedWS(t, repo, "pro", "sub_future", timePtr(time.Now().UTC().Add(24*time.Hour)))
	permanent := seedWS(t, repo, "pro", "", nil)

	expired, err := repo.ExpireDueWorkspaces(ctx, now, 100)
	require.NoError(t, err)
	require.Len(t, expired, 1)
	assert.Equal(t, due, expired[0].WorkspaceID)
	assert.Equal(t, "pro", expired[0].FromPlan)

	var plan, ref, exp interface{}
	require.NoError(t, repo.pool.QueryRow(ctx,
		`SELECT plan_code, subscription_ref, plan_expires_at FROM workspace WHERE id = $1`, due).Scan(&plan, &ref, &exp))
	assert.Equal(t, "free", plan)
	assert.Equal(t, "sub_due", ref, "P2-3：降级保留订阅软链（不再一并清空）")
	assert.Nil(t, exp)

	var fromP, toP, reason, actor string
	require.NoError(t, repo.pool.QueryRow(ctx, `
		SELECT from_plan, to_plan, reason, actor FROM subscription_event
		WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 1`, due).Scan(&fromP, &toP, &reason, &actor))
	assert.Equal(t, "pro", fromP)
	assert.Equal(t, "free", toP)
	assert.Equal(t, "plan_expired", reason)
	assert.NotEmpty(t, actor)

	for _, ws := range []string{future, permanent} {
		var p string
		require.NoError(t, repo.pool.QueryRow(ctx, `SELECT plan_code FROM workspace WHERE id = $1`, ws).Scan(&p))
		assert.Equal(t, "pro", p)
	}

	again, err := repo.ExpireDueWorkspaces(ctx, now, 100)
	require.NoError(t, err)
	assert.Empty(t, again)

	for i := 0; i < 3; i++ {
		seedWS(t, repo, "pro", "", timePtr(time.Now().UTC().Add(-time.Hour)))
	}
	capped, err := repo.ExpireDueWorkspaces(ctx, now, 2)
	require.NoError(t, err)
	assert.Len(t, capped, 2)
}

func TestExpireDueWorkspaces_SkipLocked(t *testing.T) {
	repo := subTestDB(t)
	ctx := context.Background()
	now := time.Now().UTC()

	ws1 := seedWS(t, repo, "pro", "sub_l1", timePtr(now.Add(-time.Hour)))
	ws2 := seedWS(t, repo, "pro", "sub_l2", timePtr(now.Add(-time.Hour)))

	conn, err := repo.pool.Acquire(ctx)
	require.NoError(t, err)
	defer conn.Release()
	tx, err := conn.Begin(ctx)
	require.NoError(t, err)
	lockRows, err := tx.Query(ctx, `SELECT id FROM workspace WHERE id = $1 FOR UPDATE`, ws1)
	require.NoError(t, err)
	for lockRows.Next() {
		var id string
		require.NoError(t, lockRows.Scan(&id))
	}
	require.NoError(t, lockRows.Err())
	lockRows.Close()

	expired, err := repo.ExpireDueWorkspaces(ctx, now, 10)
	require.NoError(t, err)
	require.Len(t, expired, 1)
	assert.Equal(t, ws2, expired[0].WorkspaceID)

	require.NoError(t, tx.Rollback(ctx))
	expired, err = repo.ExpireDueWorkspaces(ctx, now, 10)
	require.NoError(t, err)
	assert.Len(t, expired, 1)
	assert.Equal(t, ws1, expired[0].WorkspaceID)
}

func TestGetWorkspacePlan_FallbackOnlyOnNoRows_BQ4(t *testing.T) {
	repo := subTestDB(t)
	ctx := context.Background()

	ws := seedWS(t, repo, "pro", "", nil)
	plan, err := repo.GetWorkspacePlan(ctx, ws)
	require.NoError(t, err)
	assert.Equal(t, "pro", plan)

	plan, err = repo.GetWorkspacePlan(ctx, "00000000-0000-0000-0000-000000000000")
	require.NoError(t, err)
	assert.Equal(t, "free", plan)
}

func TestGetWorkspacePlan_DBErrorPropagates_BQ4(t *testing.T) {
	pool, err := pgxpool.New(context.Background(),
		"postgres://nouser@127.0.0.1:1/nowhere?sslmode=disable&connect_timeout=2")
	require.NoError(t, err)
	t.Cleanup(pool.Close)

	repo := New(pool)
	plan, err := repo.GetWorkspacePlan(context.Background(), "00000000-0000-0000-0000-000000000000")
	require.Error(t, err, "DB 故障必须上抛（修复前被吞成 free）")
	assert.Empty(t, plan)
}
