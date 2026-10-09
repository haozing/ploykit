package pgrepo

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestChangeWorkspacePlan_TxHookRollback_UpDown(t *testing.T) {
	repo := subTestDB(t)
	ctx := context.Background()
	ws := seedWS(t, repo, "free", "", nil)
	now := time.Now().UTC()

	countSubEvents := func() int {
		var n int
		require.NoError(t, repo.pool.QueryRow(ctx,
			`SELECT count(*) FROM subscription_event WHERE workspace_id = $1`, ws).Scan(&n))
		return n
	}
	planOf := func() string {
		var p string
		require.NoError(t, repo.pool.QueryRow(ctx,
			`SELECT plan_code FROM workspace WHERE id = $1`, ws).Scan(&p))
		return p
	}

	err := repo.ChangeWorkspacePlan(ctx, ws, "pro", "webhook:stripe", "order:o1", now,
		func(pgx.Tx, string) error { return errors.New("proration ledger failed") })
	require.Error(t, err)
	assert.Equal(t, "free", planOf(), "Tx 钩子返 error：plan_code 必须回滚不变")
	assert.Zero(t, countSubEvents(), "回滚含 subscription_event 留痕（同生共死）")

	var gotFrom string
	var txWritable bool
	require.NoError(t, repo.ChangeWorkspacePlan(ctx, ws, "pro", "webhook:stripe", "order:o2", now,
		func(tx pgx.Tx, from string) error {
			gotFrom = from

			_, err := tx.Exec(ctx,
				`INSERT INTO subscription_event (workspace_id, from_plan, to_plan, reason, actor)
				 VALUES ($1, 'pro', 'pro', 'tx_hook_probe', 'test')`, ws)
			txWritable = err == nil
			return err
		}))
	assert.Equal(t, "free", gotFrom, "from 应为 FOR UPDATE 锁定读的旧套餐")
	assert.True(t, txWritable, "钩子拿到的是活动事务句柄（可写）")
	assert.Equal(t, "pro", planOf())
	assert.Equal(t, 2, countSubEvents(), "换档留痕 + 钩子同事务写入各一条")
}
