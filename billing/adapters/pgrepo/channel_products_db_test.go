package pgrepo

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/billing/domain"
)

func TestChannelProductsCRUDDB(t *testing.T) {
	pool := newBillingScratchPool(t)
	repo := New(pool)
	ctx := context.Background()

	// 空：未命中、列表为空。
	_, found, err := repo.GetChannelProduct(ctx, "waffo", "pro", domain.IntervalMonthly)
	require.NoError(t, err)
	assert.False(t, found)
	rows, err := repo.ListChannelProducts(ctx)
	require.NoError(t, err)
	assert.Empty(t, rows)

	// 插入（注册）。
	syncedAt := time.Date(2026, 10, 23, 8, 0, 0, 0, time.UTC)
	p1 := domain.ChannelProduct{
		Channel: "waffo", PlanCode: "pro", Interval: domain.IntervalMonthly,
		ChannelProductID: "PROD_1", SyncedPriceCents: 990, SyncedAt: &syncedAt,
	}
	require.NoError(t, repo.UpsertChannelProduct(ctx, p1))
	require.NoError(t, repo.UpsertChannelProduct(ctx, domain.ChannelProduct{
		Channel: "waffo", PlanCode: "pro", Interval: domain.IntervalYearly,
		ChannelProductID: "PROD_2",
	}))

	// 命中：主键三元组精确匹配；年付行 synced_at 为 NULL 可扫描。
	got, found, err := repo.GetChannelProduct(ctx, "waffo", "pro", domain.IntervalMonthly)
	require.NoError(t, err)
	require.True(t, found)
	assert.Equal(t, "PROD_1", got.ChannelProductID)
	assert.Equal(t, 990, got.SyncedPriceCents)
	require.NotNil(t, got.SyncedAt)

	_, found, err = repo.GetChannelProduct(ctx, "waffo", "pro", domain.IntervalYearly)
	require.NoError(t, err)
	require.True(t, found)
	assert.Nil(t, got2SyncedAt(t, repo, ctx))

	// 同键 upsert 覆盖：改价同步后 id/价格/时间更新。
	p1.ChannelProductID = "PROD_1B"
	p1.SyncedPriceCents = 1990
	now := time.Now().UTC().Truncate(time.Microsecond)
	p1.SyncedAt = &now
	require.NoError(t, repo.UpsertChannelProduct(ctx, p1))
	got, found, err = repo.GetChannelProduct(ctx, "waffo", "pro", domain.IntervalMonthly)
	require.NoError(t, err)
	require.True(t, found)
	assert.Equal(t, "PROD_1B", got.ChannelProductID)
	assert.Equal(t, 1990, got.SyncedPriceCents)
	require.NotNil(t, got.SyncedAt)

	// 列表：按 channel/plan/interval 排序。
	rows, err = repo.ListChannelProducts(ctx)
	require.NoError(t, err)
	require.Len(t, rows, 2)
	assert.Equal(t, domain.IntervalMonthly, rows[0].Interval)
	assert.Equal(t, domain.IntervalYearly, rows[1].Interval)

	// 不同渠道同 plan 不串键。
	_, found, err = repo.GetChannelProduct(ctx, "stripe", "pro", domain.IntervalMonthly)
	require.NoError(t, err)
	assert.False(t, found)
}

func got2SyncedAt(t *testing.T, repo *Repo, ctx context.Context) *time.Time {
	t.Helper()
	got, found, err := repo.GetChannelProduct(ctx, "waffo", "pro", domain.IntervalYearly)
	require.NoError(t, err)
	require.True(t, found)
	return got.SyncedAt
}
