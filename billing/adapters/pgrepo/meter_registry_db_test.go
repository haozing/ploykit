package pgrepo

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/billing/app"
)

func TestMeterRegistryDB(t *testing.T) {
	repo := subTestDB(t)
	ctx := context.Background()

	cleanup := func() {
		_, _ = repo.pool.Exec(context.Background(), `DELETE FROM billing_meter WHERE slug LIKE 'mreg_%'`)
	}
	cleanup()
	t.Cleanup(cleanup)

	require.NoError(t, repo.RegisterMeter(ctx, app.Meter{
		Slug: "mreg_api", DisplayName: "API 调用", AggType: "count", Unit: "",
	}))
	got, ok, err := repo.GetMeter(ctx, "mreg_api")
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, "count", got.AggType)
	assert.Equal(t, "", got.Unit, "空 unit（NULL 折回空串）")
	assert.False(t, got.CreatedAt.IsZero())

	require.NoError(t, repo.RegisterMeter(ctx, app.Meter{
		Slug: "mreg_api", DisplayName: "API 调用次数", AggType: "count", Unit: "次",
	}))
	got, ok, err = repo.GetMeter(ctx, "mreg_api")
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, "API 调用次数", got.DisplayName)
	assert.Equal(t, "次", got.Unit)

	err = repo.RegisterMeter(ctx, app.Meter{Slug: "mreg_api", DisplayName: "API", AggType: "unique_count"})
	require.ErrorIs(t, err, app.ErrMeterImmutable)

	_, err = repo.pool.Exec(ctx,
		`INSERT INTO billing_meter (slug, display_name, agg_type) VALUES ('mreg_bad', 'x', 'avg')`)
	assert.Error(t, err, "agg_type 非四档之一应被 CHECK 拒绝")

	_, err = repo.pool.Exec(ctx, `UPDATE billing_meter SET agg_type = 'sum' WHERE slug = 'mreg_api'`)
	assert.Error(t, err, "直连改 agg_type 应被 039 触发器拒绝")
	_, err = repo.pool.Exec(ctx, `UPDATE billing_meter SET slug = 'mreg_renamed' WHERE slug = 'mreg_api'`)
	assert.Error(t, err, "直连改 slug 应被 039 触发器拒绝")
	_, err = repo.pool.Exec(ctx, `UPDATE billing_meter SET display_name = '手工改名' WHERE slug = 'mreg_api'`)
	require.NoError(t, err, "display_name 是描述性元数据，可改")

	meters, err := repo.ListMeters(ctx)
	require.NoError(t, err)
	var n int
	for _, m := range meters {
		if m.Slug == "mreg_api" {
			n++
			assert.Equal(t, "手工改名", m.DisplayName)
		}
	}
	assert.Equal(t, 1, n, "幂等注册不产生重复行")
}
