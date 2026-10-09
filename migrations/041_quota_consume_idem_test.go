package migrations

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestQuotaConsumeIdemUpDownUp_041(t *testing.T) {
	pool, m := testMigrator(t)
	ctx := context.Background()

	tableExists := func() bool {
		var exists bool
		require.NoError(t, pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'quota_consume_idem')`).Scan(&exists))
		return exists
	}

	assert.True(t, tableExists(), "041 up 后 quota_consume_idem 应存在")

	_, wsID := seedMigUserWS(t, pool, "ci41")
	insert := func(counterKey, idem, period string) error {
		_, err := pool.Exec(ctx, `
			INSERT INTO quota_consume_idem (workspace_id, counter_key, idem_key, period, amount)
			VALUES ($1, $2, $3, $4, 5)`, wsID, counterKey, idem, period)
		return err
	}

	require.NoError(t, insert("tasks_monthly", "op-1", "2026-10"))
	assert.Error(t, insert("tasks_monthly", "op-1", "2026-10"),
		"同 (ws,counter_key,idem_key) 第二行必须被 PK 拒绝（重放不双计的 DB 兜底）")

	assert.Error(t, insert("tasks_monthly", "op-1", "2026-11"),
		"period 不参与去重：跨周期同键重放仍是重放")

	require.NoError(t, insert("storage_gb", "op-1", "2026-10"))

	rolled := rollbackAbove(t, m, pool, "040")
	require.NotEmpty(t, rolled)
	assert.Equal(t, "041", rolled[len(rolled)-1], "最低回滚点必须是 041（更高版本自动扩展）")
	assert.False(t, tableExists())

	_, err := m.Up(ctx, 0)
	require.NoError(t, err)
	assert.True(t, tableExists(), "down 后再 up 幂等重建")
}
