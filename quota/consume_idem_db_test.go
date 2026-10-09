package quota

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/webx"
)

func TestConsumeWith_IdemKeyReplayCountsOnce(t *testing.T) {
	pool := testPool(t)
	ws := seedWS(t, pool)
	ctx := context.Background()
	now := time.Now().UTC()
	svc := NewService(pool)

	res, err := svc.ConsumeWith(ctx, ws, "tasks_monthly", 30, now, ConsumeOpts{IdemKey: "op-idem-1"})
	require.NoError(t, err)
	assert.False(t, res.Replay, "首次消费不是重放")

	res, err = svc.ConsumeWith(ctx, ws, "tasks_monthly", 30, now, ConsumeOpts{IdemKey: "op-idem-1"})
	require.NoError(t, err, "同 key 重放必须成功（返回首次结果）")
	assert.True(t, res.Replay, "同 key 重放应标记 Replay")
	used, _, err := svc.Usage(ctx, ws, "tasks_monthly", Period(now))
	require.NoError(t, err)
	assert.Equal(t, int64(30), used, "同 key 重放计数只加一次")

	res, err = svc.ConsumeWith(ctx, ws, "tasks_monthly", 5, now, ConsumeOpts{IdemKey: "op-idem-2"})
	require.NoError(t, err)
	assert.False(t, res.Replay)
	used, _, _ = svc.Usage(ctx, ws, "tasks_monthly", Period(now))
	assert.Equal(t, int64(35), used, "不同 key 正常累加")

	unlocked, err := svc.Grant(ctx, ws, "storage_gb", "test", "ref-idem-cross-dim", 100, now)
	require.NoError(t, err)
	require.True(t, unlocked)
	_, err = svc.ConsumeWith(ctx, ws, "storage_gb", 3, now, ConsumeOpts{IdemKey: "op-idem-1"})
	require.NoError(t, err, "同 key 不同维度是不同账（键含 counter_key）")
	usedSG, _, err := svc.Usage(ctx, ws, "storage_gb", Period(now))
	require.NoError(t, err)
	assert.Equal(t, int64(3), usedSG, "跨维度不误判重放（新账首次计数）")
}

func TestConsumeWith_EmptyIdemKeyZeroImpact(t *testing.T) {
	pool := testPool(t)
	ws := seedWS(t, pool)
	ctx := context.Background()
	now := time.Now().UTC()
	svc := NewService(pool)

	_, err := svc.ConsumeWith(ctx, ws, "tasks_monthly", 10, now, ConsumeOpts{})
	require.NoError(t, err)
	_, err = svc.ConsumeWith(ctx, ws, "tasks_monthly", 10, now, ConsumeOpts{IdemKey: "   "})
	require.NoError(t, err)
	used, _, err := svc.Usage(ctx, ws, "tasks_monthly", Period(now))
	require.NoError(t, err)
	assert.Equal(t, int64(20), used, "空键路径两次各记一次（现状语义）")

	var rows int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM quota_consume_idem WHERE workspace_id = $1`, ws).Scan(&rows))
	assert.Zero(t, rows, "空键不得落幂等行")
}

func TestConsumeWith_ExceededDoesNotClaimKey(t *testing.T) {
	pool := testPool(t)
	ws := seedWS(t, pool)
	ctx := context.Background()
	now := time.Now().UTC()
	svc := NewService(pool)

	_, err := svc.ConsumeWith(ctx, ws, "tasks_monthly", 60, now, ConsumeOpts{IdemKey: "op-retry"})
	var we *webx.Error
	require.ErrorAs(t, err, &we)
	assert.Equal(t, 402, we.Status)
	var rows int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM quota_consume_idem WHERE workspace_id = $1`, ws).Scan(&rows))
	assert.Zero(t, rows, "被拒的消费不得认领幂等键")

	unlocked, err := svc.Grant(ctx, ws, "tasks_monthly", "milestone", "ref-idem-retry", 100, now)
	require.NoError(t, err)
	require.True(t, unlocked)

	res, err := svc.ConsumeWith(ctx, ws, "tasks_monthly", 60, now, ConsumeOpts{IdemKey: "op-retry"})
	require.NoError(t, err, "解锁后同键重试是合法新尝试")
	assert.False(t, res.Replay)
	used, _, err := svc.Usage(ctx, ws, "tasks_monthly", Period(now))
	require.NoError(t, err)
	assert.Equal(t, int64(60), used)
}

func TestConsumeWith_ReplayAcrossPeriods(t *testing.T) {
	pool := testPool(t)
	ws := seedWS(t, pool)
	ctx := context.Background()
	svc := NewService(pool)

	jan := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)
	feb := time.Date(2026, 2, 10, 12, 0, 0, 0, time.UTC)

	_, err := svc.ConsumeWith(ctx, ws, "tasks_monthly", 7, jan, ConsumeOpts{IdemKey: "op-cross"})
	require.NoError(t, err)

	res, err := svc.ConsumeWith(ctx, ws, "tasks_monthly", 7, feb, ConsumeOpts{IdemKey: "op-cross"})
	require.NoError(t, err)
	assert.True(t, res.Replay, "跨周期同键仍是重放")
	used, _, err := svc.Usage(ctx, ws, "tasks_monthly", Period(feb))
	require.NoError(t, err)
	assert.Zero(t, used, "重放不得在新周期记账")
}
