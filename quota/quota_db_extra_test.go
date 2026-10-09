package quota

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/webx"
)

func TestService_Release_UTQT05(t *testing.T) {
	pool := testPool(t)
	ws := seedWS(t, pool)
	ctx := context.Background()
	now := time.Now().UTC()
	svc := NewService(pool)

	require.NoError(t, svc.Consume(ctx, ws, "tasks_monthly", 30, now))
	used, _, err := svc.Usage(ctx, ws, "tasks_monthly", Period(now))
	require.NoError(t, err)
	require.Equal(t, int64(30), used)

	require.NoError(t, svc.Release(ctx, ws, "tasks_monthly", 10, now))
	used, _, err = svc.Usage(ctx, ws, "tasks_monthly", Period(now))
	require.NoError(t, err)
	assert.Equal(t, int64(20), used, "Release 应扣减用量桶")

	require.NoError(t, svc.Release(ctx, ws, "tasks_monthly", 999, now))
	used, _, err = svc.Usage(ctx, ws, "tasks_monthly", Period(now))
	require.NoError(t, err)
	assert.Equal(t, int64(0), used, "回退应钳制到 0")
}

func TestConsume_FirstInsertEnforcesLimit_BQ2(t *testing.T) {
	pool := testPool(t)
	ws := seedWS(t, pool)
	ctx := context.Background()
	now := time.Now().UTC()
	svc := NewService(pool)

	err := svc.Consume(ctx, ws, "tasks_monthly", 51, now)
	var we *webx.Error
	require.ErrorAs(t, err, &we)
	assert.Equal(t, 402, we.Status)
	used, _, uErr := svc.Usage(ctx, ws, "tasks_monthly", Period(now))
	require.NoError(t, uErr)
	assert.Equal(t, int64(0), used, "被拒的首笔不得落桶")

	require.NoError(t, svc.Consume(ctx, ws, "tasks_monthly", 50, now))

	err = svc.Consume(ctx, ws, "tasks_monthly", 1, now)
	require.ErrorAs(t, err, &we)
	assert.Equal(t, 402, we.Status)
}

func TestConsume_FirstInsertCountsGrants_BQ2(t *testing.T) {
	pool := testPool(t)
	ws := seedWS(t, pool)
	ctx := context.Background()
	now := time.Now().UTC()
	svc := NewService(pool)

	unlocked, err := svc.Grant(ctx, ws, "tasks_monthly", "milestone", "ref-bq2", 100, now)
	require.NoError(t, err)
	require.True(t, unlocked)

	require.NoError(t, svc.Consume(ctx, ws, "tasks_monthly", 120, now), "首笔 120 <= 50+100 应放行")

	err = svc.Consume(ctx, ws, "tasks_monthly", 31, now)
	var we *webx.Error
	require.ErrorAs(t, err, &we)
	assert.Equal(t, 402, we.Status)
}
