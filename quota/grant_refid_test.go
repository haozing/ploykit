package quota

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/webx"
)

func TestGrant_EmptyRefIDRejected_BQ11(t *testing.T) {
	svc := NewService(nil)
	for _, ref := range []string{"", "   ", "\t"} {
		unlocked, err := svc.Grant(context.Background(), "ws-1", "tasks_monthly", "milestone", ref, 10, time.Now())
		assert.False(t, unlocked)
		var we *webx.Error
		require.ErrorAs(t, err, &we, "ref=%q", ref)
		assert.Equal(t, 400, we.Status)
		assert.Equal(t, webx.CodeValidation, we.Code)
	}
}

func TestGrant_IdempotentOnFullKey_BQ11(t *testing.T) {
	pool := testPool(t)
	ws := seedWS(t, pool)
	ctx := context.Background()
	now := time.Now().UTC()
	svc := NewService(pool)

	unlocked, err := svc.Grant(ctx, ws, "tasks_monthly", "milestone", "ref-bq11", 100, now)
	require.NoError(t, err)
	assert.True(t, unlocked)

	unlocked, err = svc.Grant(ctx, ws, "tasks_monthly", "milestone", "ref-bq11", 100, now)
	require.NoError(t, err)
	assert.False(t, unlocked, "同四元组二次授予必须幂等（unlocked=false）")

	var rows, nullRefs int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*), count(*) FILTER (WHERE ref_id IS NULL)
		 FROM quota_grant WHERE workspace_id = $1 AND counter_key = 'tasks_monthly'`, ws).
		Scan(&rows, &nullRefs))
	assert.Equal(t, 1, rows, "重复授予不得落新行")
	assert.Equal(t, 0, nullRefs, "ref_id 不再落 NULL")
}

func TestGrant_DedupIgnoresPeriod_BQ11(t *testing.T) {
	pool := testPool(t)
	ws := seedWS(t, pool)
	ctx := context.Background()
	svc := NewService(pool)

	jan := time.Date(2026, 1, 15, 0, 0, 0, 0, time.UTC)
	feb := time.Date(2026, 2, 15, 0, 0, 0, 0, time.UTC)

	unlocked, err := svc.Grant(ctx, ws, "tasks_monthly", "milestone", "ref-period", 100, jan)
	require.NoError(t, err)
	assert.True(t, unlocked)
	unlocked, err = svc.Grant(ctx, ws, "tasks_monthly", "milestone", "ref-period", 100, feb)
	require.NoError(t, err)
	assert.False(t, unlocked, "同 (ws,key,reason,ref) 跨 period 只生效一次")
}
