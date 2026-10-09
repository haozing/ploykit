package quota

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/webx"
)

func seedPlanWS(t *testing.T, pool *pgxpool.Pool, limitsJSON string) string {
	t.Helper()
	ctx := context.Background()
	code := "lm" + uuid.NewString()[:8]
	_, err := pool.Exec(ctx,
		`INSERT INTO plan (code, name, limits, sort_no) VALUES ($1, '限额模式测试', $2::jsonb, 99)`,
		code, limitsJSON)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM plan WHERE code = $1`, code)
	})
	ws := seedWS(t, pool)
	_, err = pool.Exec(ctx, `UPDATE workspace SET plan_code = $2 WHERE id = $1`, ws, code)
	require.NoError(t, err)
	return ws
}

func TestConsume_SoftModeOverLimitAllowed(t *testing.T) {
	pool := testPool(t)
	ws := seedPlanWS(t, pool, `{"tasks_monthly":50,"limit_mode":"soft"}`)
	ctx := context.Background()
	now := time.Now().UTC()
	svc := NewService(pool)

	require.NoError(t, svc.Consume(ctx, ws, "tasks_monthly", 51, now),
		"soft 档首笔超限（51>50）应放行")
	used, _, err := svc.Usage(ctx, ws, "tasks_monthly", Period(now))
	require.NoError(t, err)
	assert.Equal(t, int64(51), used)

	require.NoError(t, svc.Consume(ctx, ws, "tasks_monthly", 100, now),
		"soft 档已超限后继续消费应放行")
	used, _, err = svc.Usage(ctx, ws, "tasks_monthly", Period(now))
	require.NoError(t, err)
	assert.Equal(t, int64(151), used, "soft 档计数继续累加")

	exhausted := 0
	svc.WithHooks(QuotaHooks{
		OnExhausted: func(_ context.Context, _, _ string) error { exhausted++; return nil },
	})
	require.NoError(t, svc.Consume(ctx, ws, "tasks_monthly", 1000, now))
	assert.Zero(t, exhausted, "soft 放行不是耗尽事件")
}

func TestConsume_HardModeExplicitUnchanged(t *testing.T) {
	pool := testPool(t)
	ws := seedPlanWS(t, pool, `{"tasks_monthly":50,"limit_mode":"hard"}`)
	ctx := context.Background()
	now := time.Now().UTC()
	svc := NewService(pool)

	require.NoError(t, svc.Consume(ctx, ws, "tasks_monthly", 50, now))
	err := svc.Consume(ctx, ws, "tasks_monthly", 1, now)
	var we *webx.Error
	require.ErrorAs(t, err, &we)
	assert.Equal(t, 402, we.Status, "hard 档超限必须维持 402")
}

func TestConsume_LimitModeDoesNotTouchUnlimited(t *testing.T) {
	pool := testPool(t)
	for _, mode := range []string{`"soft"`, `"hard"`} {
		ws := seedPlanWS(t, pool, `{"tasks_monthly":-1,"limit_mode":`+mode+`}`)
		ctx := context.Background()
		now := time.Now().UTC()
		svc := NewService(pool)
		require.NoError(t, svc.Consume(ctx, ws, "tasks_monthly", 1<<20, now),
			"limit_mode=%s 不得改变 -1 不限语义", mode)
	}
}
