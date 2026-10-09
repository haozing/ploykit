package migrations

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestQuotaGrantPeriodicUpDownUp_042(t *testing.T) {
	pool, m := testMigrator(t)
	ctx := context.Background()

	colExists := func() bool {
		var exists bool
		require.NoError(t, pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM information_schema.columns
				WHERE table_name = 'quota_grant' AND column_name = 'period_cycle')`).Scan(&exists))
		return exists
	}

	assert.True(t, colExists(), "042 up 后 quota_grant 应有 period_cycle 列")

	_, wsID := seedMigUserWS(t, pool, "gp42")
	insertGrant := func(cycle any) error {
		_, err := pool.Exec(ctx, `
			INSERT INTO quota_grant (workspace_id, period, counter_key, amount, reason, ref_id, period_cycle)
			VALUES ($1, '2026-10', 'tasks_monthly', 10, 'monthly_bonus', $2, $3)`,
			wsID, "mig042-"+uuid.NewString()[:8], cycle)
		return err
	}

	require.NoError(t, insertGrant(nil), "NULL=一次性授予（现状）必须合法")
	require.NoError(t, insertGrant("monthly"), "'monthly' 模板行必须合法")
	assert.Error(t, insertGrant("weekly"), "未支持的周期值应被 CHECK 拒绝（新周期=新迁移，显式演进）")

	rolled := rollbackAbove(t, m, pool, "041")
	require.NotEmpty(t, rolled)
	assert.Equal(t, "042", rolled[len(rolled)-1], "最低回滚点必须是 042")
	assert.False(t, colExists())
	var rows int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM quota_grant WHERE workspace_id = $1`, wsID).Scan(&rows))
	assert.Equal(t, 2, rows, "down 只拆列：既有授予行（模板标记丢弃）保留")

	_, err := m.Up(ctx, 0)
	require.NoError(t, err)
	assert.True(t, colExists(), "down 后再 up 幂等重建列")

	var nullCycles int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM quota_grant WHERE workspace_id = $1 AND period_cycle IS NULL`, wsID).Scan(&nullCycles))
	assert.Equal(t, 2, nullCycles)
}
