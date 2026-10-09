package migrations

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPlanCurrency_UpDownUp_040(t *testing.T) {
	pool, m := testMigrator(t)
	ctx := context.Background()

	colExists := func() bool {
		var exists bool
		require.NoError(t, pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM information_schema.columns
				WHERE table_name = 'plan' AND column_name = 'currency')`).Scan(&exists))
		return exists
	}

	assert.True(t, colExists(), "040 up 后 plan 应有 currency 列")

	var freeCcy string
	require.NoError(t, pool.QueryRow(ctx, `SELECT currency FROM plan WHERE code = 'free'`).Scan(&freeCcy))
	assert.Equal(t, "CNY", freeCcy, "存量 plan 行应回填默认 CNY（行为零变）")

	_, err := pool.Exec(ctx,
		`INSERT INTO plan (code, name, limits, sort_no) VALUES ('mig040_d', 'x', '{}', 900)`)
	require.NoError(t, err)
	var dft string
	require.NoError(t, pool.QueryRow(ctx, `SELECT currency FROM plan WHERE code = 'mig040_d'`).Scan(&dft))
	assert.Equal(t, "CNY", dft)
	_, err = pool.Exec(ctx,
		`INSERT INTO plan (code, name, limits, sort_no, currency) VALUES ('mig040_usd', 'x', '{}', 901, 'USD')`)
	require.NoError(t, err)
	for _, bad := range []string{"cny", "US12", "USDD", ""} {
		_, err := pool.Exec(ctx,
			`INSERT INTO plan (code, name, limits, sort_no, currency) VALUES ($1, 'x', '{}', 902, $2)`,
			"mig040_bad", bad)
		assert.Error(t, err, "currency=%q 应被 CHECK 拒绝（^[A-Z]{3}$）", bad)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM plan WHERE code LIKE 'mig040_%'`)
	})

	rolled := rollbackAbove(t, m, pool, "039")
	require.NotEmpty(t, rolled)
	assert.Equal(t, "040", rolled[len(rolled)-1], "最低回滚点必须是 040")
	assert.False(t, colExists())

	_, err = m.Up(ctx, 0)
	require.NoError(t, err)
	assert.True(t, colExists())
	var usd string
	require.NoError(t, pool.QueryRow(ctx, `SELECT currency FROM plan WHERE code = 'mig040_usd'`).Scan(&usd))
	assert.Equal(t, "CNY", usd, "down 撤列后重建：存续行回填 DEFAULT CNY")
	_, err = pool.Exec(ctx,
		`INSERT INTO plan (code, name, limits, sort_no, currency) VALUES ($1, 'x', '{}', 903, 'eur')`,
		"mig040_bad2")
	assert.Error(t, err, "再 up 后 CHECK 仍生效")
}
