package pgrepo

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSetOrderChannelRefAndExpiry_DB(t *testing.T) {
	pool := newBillingScratchPool(t)
	ctx := context.Background()
	repo := New(pool)

	uid, ws := uuid.NewString(), uuid.NewString()
	_, err := pool.Exec(ctx, `INSERT INTO "user" (id, email) VALUES ($1, $2)`, uid, uid[:8]+"@oe.test")
	require.NoError(t, err)
	_, err = pool.Exec(ctx,
		`INSERT INTO workspace (id, slug, name, plan_code, created_by) VALUES ($1, $2, 'oe', 'free', $3)`,
		ws, "oe-"+ws[:12], uid)
	require.NoError(t, err)
	orderID := uuid.NewString()
	_, err = pool.Exec(ctx, `
		INSERT INTO "order" (id, workspace_id, user_id, plan_code, interval, amount_cents, currency, channel, status)
		VALUES ($1, $2, $3, 'pro', 'monthly', 9900, 'CNY', 'stripe', 'pending')`,
		orderID, ws, uid)
	require.NoError(t, err)

	t.Run("会话引用与到期一并落库", func(t *testing.T) {
		exp := time.Now().UTC().Add(24 * time.Hour).Truncate(time.Microsecond)
		require.NoError(t, repo.SetOrderChannelRefAndExpiry(ctx, orderID, "cs_1", exp))
		var ref string
		var gotExp *time.Time
		require.NoError(t, pool.QueryRow(ctx,
			`SELECT channel_ref, expires_at FROM "order" WHERE id = $1`, orderID).Scan(&ref, &gotExp))
		assert.Equal(t, "cs_1", ref)
		require.NotNil(t, gotExp, "到期时间应写入（弃单清扫的依据）")
		assert.True(t, gotExp.UTC().Equal(exp))
	})

	t.Run("零值到期 → NULL（未知到期不参与清扫）", func(t *testing.T) {
		zeroOrder := uuid.NewString()
		_, err := pool.Exec(ctx, `
			INSERT INTO "order" (id, workspace_id, user_id, plan_code, interval, amount_cents, currency, channel, status)
			VALUES ($1, $2, $3, 'pro', 'monthly', 9900, 'CNY', 'manual', 'pending')`,
			zeroOrder, ws, uid)
		require.NoError(t, err)
		require.NoError(t, repo.SetOrderChannelRefAndExpiry(ctx, zeroOrder, "manual:"+zeroOrder, time.Time{}))
		var gotExp *time.Time
		require.NoError(t, pool.QueryRow(ctx,
			`SELECT expires_at FROM "order" WHERE id = $1`, zeroOrder).Scan(&gotExp))
		assert.Nil(t, gotExp)
	})
}

func TestExpireStaleOrders_DB(t *testing.T) {
	pool := newBillingScratchPool(t)
	ctx := context.Background()
	repo := New(pool)

	uid, ws := uuid.NewString(), uuid.NewString()
	_, err := pool.Exec(ctx, `INSERT INTO "user" (id, email) VALUES ($1, $2)`, uid, uid[:8]+"@oe.test")
	require.NoError(t, err)
	_, err = pool.Exec(ctx,
		`INSERT INTO workspace (id, slug, name, plan_code, created_by) VALUES ($1, $2, 'oe', 'free', $3)`,
		ws, "oe-"+ws[:12], uid)
	require.NoError(t, err)

	insertOrder := func(status string, expires any) string {
		id := uuid.NewString()
		_, err := pool.Exec(ctx, `
			INSERT INTO "order" (id, workspace_id, user_id, plan_code, interval, amount_cents, currency, channel, status, expires_at)
			VALUES ($1, $2, $3, 'pro', 'monthly', 9900, 'CNY', 'waffo', $4, $5)`,
			id, ws, uid, status, expires)
		require.NoError(t, err)
		return id
	}

	now := time.Now().UTC()
	due := insertOrder("pending", now.Add(-time.Hour))      // 过期 pending → 清扫
	future := insertOrder("pending", now.Add(24*time.Hour)) // 未到期 pending → 保留
	noExpiry := insertOrder("pending", nil)                 // 无到期（legacy）→ 保留
	paidExpired := insertOrder("paid", now.Add(-time.Hour)) // 已支付 → 保留

	expired, err := repo.ExpireStaleOrders(ctx, now, 100)
	require.NoError(t, err)
	require.Len(t, expired, 1)
	assert.Equal(t, due, expired[0].ID)
	assert.Equal(t, ws, expired[0].WorkspaceID)

	statusOf := func(id string) string {
		var status string
		require.NoError(t, pool.QueryRow(ctx, `SELECT status FROM "order" WHERE id = $1`, id).Scan(&status))
		return status
	}
	assert.Equal(t, "canceled", statusOf(due), "过期 pending 置 canceled")
	assert.Equal(t, "pending", statusOf(future))
	assert.Equal(t, "pending", statusOf(noExpiry))
	assert.Equal(t, "paid", statusOf(paidExpired))

	var canceledAt *time.Time
	require.NoError(t, pool.QueryRow(ctx, `SELECT canceled_at FROM "order" WHERE id = $1`, due).Scan(&canceledAt))
	require.NotNil(t, canceledAt, "清扫应留 canceled_at 时间戳")

	// 幂等：再扫一轮无新增（pending 已不存在）。
	again, err := repo.ExpireStaleOrders(ctx, now, 100)
	require.NoError(t, err)
	assert.Empty(t, again)
}
