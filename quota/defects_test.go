package quota

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestIsQuotaDimKey_DQ_DEF_3(t *testing.T) {
	for _, k := range []string{
		"price_monthly_cents", "price_yearly_cents", "price_one_time_cents",
		"metered_tasks_unit_cents", "metered_tasks_included", "trial_days",
	} {
		assert.False(t, isQuotaDimKey(k), "计价/配置键 %q 不应是配额维度", k)
	}
	for _, k := range []string{"workspaces", "tasks_monthly", "seats", "storage_gb"} {
		assert.True(t, isQuotaDimKey(k), "配额维度键 %q 应保留", k)
	}
	assert.Empty(t, quotaDims(Limits{
		"price_monthly_cents": 9900, "trial_days": 14, "metered_x_unit_cents": 3,
	}))
	assert.Equal(t, Limits{"workspaces": int64(1), "tasks_monthly": int64(50)}, quotaDims(Limits{
		"workspaces": 1, "tasks_monthly": 50, "price_monthly_cents": 9900, "price_yearly_cents": 99900,
	}))
}

func TestLimitsFor_FiltersPriceKeys_DQ_DEF_3(t *testing.T) {
	pool := testPool(t)
	ws := seedWS(t, pool)
	ctx := context.Background()

	code := "dq3-" + uuid.NewString()[:8]
	_, err := pool.Exec(ctx,
		`INSERT INTO plan (code, name, limits, sort_no) VALUES ($1, 'DQ3 Plan',
		 '{"workspaces":-1,"tasks_monthly":50,"price_monthly_cents":9900,"price_yearly_cents":99900,"trial_days":14}'::jsonb, 99)`, code)
	require.NoError(t, err)
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM plan WHERE code = $1`, code) })

	_, err = pool.Exec(ctx, `UPDATE workspace SET plan_code = $2 WHERE id = $1`, ws, code)
	require.NoError(t, err)
	svc := NewService(pool)

	limits, planCode, err := svc.LimitsFor(ctx, ws)
	require.NoError(t, err)
	assert.Equal(t, code, planCode)
	assert.Equal(t, Limits{"workspaces": -1, "tasks_monthly": 50}, limits,
		"价格/配置键不应作为配额维度返回")

	st, err := svc.Check(ctx, ws, "tasks_monthly", time.Now().UTC())
	require.NoError(t, err)
	assert.Equal(t, int64(50), st.Limit)
}

func TestCounterUpdatedAtUsesDBClock_DQ_DEF_2(t *testing.T) {
	pool := testPool(t)
	ws := seedWS(t, pool)
	ctx := context.Background()
	svc := NewService(pool)

	staleClock := time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
	require.NoError(t, svc.Consume(ctx, ws, "tasks_monthly", 1, staleClock))

	fresh := readCounterUpdatedAt(t, pool, ws, Period(staleClock))
	assert.True(t, fresh.After(time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)),
		"updated_at 应为 DB now() 而非注入的应用钟（2000），got %v", fresh)

	require.NoError(t, svc.Release(ctx, ws, "tasks_monthly", 1, staleClock))
	fresh = readCounterUpdatedAt(t, pool, ws, Period(staleClock))
	assert.True(t, fresh.After(time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)),
		"Release 后 updated_at 应仍为 DB now()，got %v", fresh)
}

func readCounterUpdatedAt(t *testing.T, pool *pgxpool.Pool, ws, period string) time.Time {
	t.Helper()
	var ts time.Time
	require.NoError(t, pool.QueryRow(context.Background(),
		`SELECT updated_at FROM quota_counter WHERE workspace_id = $1 AND period = $2 AND counter_key = 'tasks_monthly'`,
		ws, period).Scan(&ts))
	return ts
}
