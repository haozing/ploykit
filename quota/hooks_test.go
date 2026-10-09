package quota

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/webx"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	return pool
}

func seedWS(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	ctx := context.Background()
	var uid string
	email := fmt.Sprintf("ws3q-%s@test.local", uuid.NewString()[:12])
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO "user" (email, display_name) VALUES ($1, 'ws3 quota') RETURNING id`, email).Scan(&uid))
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM "user" WHERE id = $1`, uid) })
	slug := "ws3q-" + uuid.NewString()[:8]
	var wsID string
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO workspace (slug, name, created_by) VALUES ($1, 'WS3 Quota', $2) RETURNING id`, slug, uid).Scan(&wsID))
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM workspace WHERE id = $1`, wsID) })
	return wsID
}

func TestService_QuotaHooks(t *testing.T) {
	pool := testPool(t)
	ws := seedWS(t, pool)
	ctx := context.Background()
	now := time.Now().UTC()

	var nearCalls, exhaustCalls int
	var nearUsed, nearLimit int64
	var grants []string
	svc := NewService(pool).WithHooks(QuotaHooks{
		OnNearLimit: func(_ context.Context, _, _ string, used, limit int64) error {
			nearCalls++
			nearUsed, nearLimit = used, limit
			return nil
		},
		OnExhausted: func(_ context.Context, _, _ string) error {
			exhaustCalls++
			return nil
		},
		OnGrant: func(_ context.Context, _, key, reason, refID string, amount int) error {
			grants = append(grants, fmt.Sprintf("%s/%s/%s/%d", key, reason, refID, amount))
			return nil
		},
	})

	require.NoError(t, svc.Consume(ctx, ws, "tasks_monthly", 30, now))
	assert.Zero(t, nearCalls)

	require.NoError(t, svc.Consume(ctx, ws, "tasks_monthly", 10, now))
	assert.Equal(t, 1, nearCalls)
	assert.Equal(t, int64(40), nearUsed)
	assert.Equal(t, int64(50), nearLimit)

	require.NoError(t, svc.Consume(ctx, ws, "tasks_monthly", 10, now))
	err := svc.Consume(ctx, ws, "tasks_monthly", 1, now)
	var we *webx.Error
	require.ErrorAs(t, err, &we)
	assert.Equal(t, 402, we.Status)
	assert.Equal(t, 1, exhaustCalls)

	unlocked, err := svc.Grant(ctx, ws, "tasks_monthly", "milestone", "ref-1", 10, now)
	require.NoError(t, err)
	assert.True(t, unlocked)
	unlocked, err = svc.Grant(ctx, ws, "tasks_monthly", "milestone", "ref-1", 10, now)
	require.NoError(t, err)
	assert.False(t, unlocked)
	assert.Equal(t, []string{"tasks_monthly/milestone/ref-1/10"}, grants)

	require.NoError(t, svc.Consume(ctx, ws, "tasks_monthly", 5, now))
}

func TestService_HookErrorsDoNotAffectMainFlow(t *testing.T) {
	pool := testPool(t)
	ws := seedWS(t, pool)
	ctx := context.Background()
	now := time.Now().UTC()

	boom := errors.New("hook broke")
	svc := NewService(pool).WithHooks(QuotaHooks{
		OnNearLimit: func(_ context.Context, _, _ string, _, _ int64) error { return boom },
		OnExhausted: func(_ context.Context, _, _ string) error { return boom },
		OnGrant:     func(_ context.Context, _, _, _, _ string, _ int) error { return boom },
	})

	require.NoError(t, svc.Consume(ctx, ws, "tasks_monthly", 45, now))

	err := svc.Consume(ctx, ws, "tasks_monthly", 100, now)
	var we *webx.Error
	require.ErrorAs(t, err, &we)
	assert.Equal(t, 402, we.Status)

	unlocked, err := svc.Grant(ctx, ws, "tasks_monthly", "milestone", "ref-x", 10, now)
	require.NoError(t, err)
	assert.True(t, unlocked)
}

func TestService_NoHooksUnchanged(t *testing.T) {
	pool := testPool(t)
	ws := seedWS(t, pool)
	ctx := context.Background()
	now := time.Now().UTC()
	svc := NewService(pool)

	require.NoError(t, svc.Consume(ctx, ws, "tasks_monthly", 50, now))
	err := svc.Consume(ctx, ws, "tasks_monthly", 1, now)
	var we *webx.Error
	require.ErrorAs(t, err, &we)
	assert.Equal(t, 402, we.Status)
}
