package migrations

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBillingMeter_UpDownUp_039(t *testing.T) {
	pool, m := testMigrator(t)
	ctx := context.Background()

	tableExists := func() bool {
		var exists bool
		require.NoError(t, pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'billing_meter')`).Scan(&exists))
		return exists
	}

	assert.True(t, tableExists(), "039 up 后 billing_meter 应存在")

	_, err := pool.Exec(ctx,
		`INSERT INTO billing_meter (slug, display_name, agg_type) VALUES ('mig039_a', 'x', 'avg')`)
	assert.Error(t, err, "agg_type='avg' 应被 CHECK 拒绝")
	for _, agg := range []string{"sum", "count", "unique_count", "latest"} {
		_, err := pool.Exec(ctx,
			`INSERT INTO billing_meter (slug, display_name, agg_type, unit) VALUES ($1, 'x', $2, '次')`,
			"mig039_"+agg, agg)
		require.NoError(t, err, "agg_type=%s 应合法", agg)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM billing_meter WHERE slug LIKE 'mig039_%'`)
	})

	_, err = pool.Exec(ctx, `UPDATE billing_meter SET agg_type = 'sum' WHERE slug = 'mig039_count'`)
	assert.Error(t, err, "直连改 agg_type 应被触发器拒绝（重定义已采集用量）")
	_, err = pool.Exec(ctx, `UPDATE billing_meter SET slug = 'mig039_moved' WHERE slug = 'mig039_count'`)
	assert.Error(t, err, "直连改 slug 应被触发器拒绝")
	_, err = pool.Exec(ctx, `UPDATE billing_meter SET display_name = 'y' WHERE slug = 'mig039_count'`)
	require.NoError(t, err, "描述性元数据可改")

	rolled := rollbackAbove(t, m, pool, "038")
	require.NotEmpty(t, rolled)
	assert.Equal(t, "039", rolled[len(rolled)-1], "最低回滚点必须是 039（更高版本自动扩展）")
	assert.False(t, tableExists())

	_, err = m.Up(ctx, 0)
	require.NoError(t, err)
	assert.True(t, tableExists())
	_, err = pool.Exec(ctx,
		`INSERT INTO billing_meter (slug, display_name, agg_type) VALUES ('mig039_count', 'x', 'count')`)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `UPDATE billing_meter SET agg_type = 'sum' WHERE slug = 'mig039_count'`)
	assert.Error(t, err, "再 up 后不可变触发器仍生效")
}
