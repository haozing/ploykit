package pgrepo

// 迁移 051 / canceled_by / 宽限期 / 复活转换 / 注册原子化的 DB 测试
// （billing 内核修复批次 2026-10-24，fix #1 / #12）。

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/migrations"
	"github.com/haozing/ploykit/platform/pgmigrate"
)

func seedCancelUserWS(t *testing.T, pool *pgxpool.Pool, tag string) (userID, wsID string) {
	t.Helper()
	ctx := context.Background()
	uid, ws := uuid.NewString(), uuid.NewString()
	_, err := pool.Exec(ctx, `INSERT INTO "user" (id, email) VALUES ($1, $2)`, uid, uid[:8]+"@"+tag+".test")
	require.NoError(t, err)
	_, err = pool.Exec(ctx,
		`INSERT INTO workspace (id, slug, name, plan_code, created_by) VALUES ($1, $2, $3, 'free', $4)`,
		ws, tag+"-"+ws[:12], tag, uid)
	require.NoError(t, err)
	return uid, ws
}

func insertPendingOrder(t *testing.T, pool *pgxpool.Pool, wsID, userID, channel string, expires any) string {
	t.Helper()
	id := uuid.NewString()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO "order" (id, workspace_id, user_id, plan_code, interval, amount_cents, currency, channel, status, expires_at)
		VALUES ($1, $2, $3, 'pro', 'monthly', 9900, 'CNY', $4, 'pending', $5)`,
		id, wsID, userID, channel, expires)
	require.NoError(t, err)
	return id
}

func orderStatusCanceledBy(t *testing.T, pool *pgxpool.Pool, id string) (status string, canceledBy *string) {
	t.Helper()
	require.NoError(t, pool.QueryRow(context.Background(),
		`SELECT status, canceled_by FROM "order" WHERE id = $1`, id).Scan(&status, &canceledBy))
	return status, canceledBy
}

// TestOrderCanceledBy_UpDownUp_051_DB verifies migration 051 (framework
// range 001-999) adds and symmetrically drops order.canceled_by.
func TestOrderCanceledBy_UpDownUp_051_DB(t *testing.T) {
	pool := newBillingScratchPool(t)
	ctx := context.Background()

	colExists := func() bool {
		var exists bool
		require.NoError(t, pool.QueryRow(ctx, `
			SELECT EXISTS (SELECT 1 FROM information_schema.columns
				WHERE table_name = 'order' AND column_name = 'canceled_by')`).Scan(&exists))
		return exists
	}

	assert.True(t, colExists(), "051 up 后 order 应有 canceled_by 列")

	m := pgmigrate.New(pool, migrations.FS, ".")
	// 051 之上可能已有更新的框架迁移（052/053…）——按 Status 数出 051 之上的
	// 框架版本步数回滚到 050 为止，rolled 末位必须是 051 本身（清单随更高版本自动扩展）。
	st, err := m.Status(ctx)
	require.NoError(t, err)
	steps := 0
	for _, r := range st {
		if r.Applied && len(r.Version) == 3 && r.Version > "051" {
			steps++
		}
	}
	require.Positive(t, steps, "051 之上应已有更新的框架迁移（052/053）")
	steps++ // 连 051 本身一起回滚（对齐原语义：验证 051 的对称 DROP）
	rolled, err := m.Down(ctx, steps)
	require.NoError(t, err)
	require.Len(t, rolled, steps)
	assert.Equal(t, "051", rolled[len(rolled)-1], "回滚清单末位必须是 051")
	assert.False(t, colExists(), "down 应对称 DROP 列")

	_, err = m.Up(ctx, 0)
	require.NoError(t, err)
	assert.True(t, colExists(), "down 后再 up 幂等重建列")
}

// TestExpireStaleOrders_CanceledByAndGrace_DB covers fix #1's repo semantics:
// the sweep stamps canceled_by='expiry', and the CALLER-chosen cutoff decides
// what is stale (the worker passes now-24h; rows inside the grace window must
// survive the sweep).
func TestExpireStaleOrders_CanceledByAndGrace_DB(t *testing.T) {
	pool := newBillingScratchPool(t)
	ctx := context.Background()
	repo := New(pool)

	uid, wsID := seedCancelUserWS(t, pool, "cb51")

	now := time.Now().UTC()
	stale30h := insertPendingOrder(t, pool, wsID, uid, "waffo", now.Add(-30*time.Hour))
	withinGrace := insertPendingOrder(t, pool, wsID, uid, "waffo", now.Add(-2*time.Hour))

	// worker 语义：cutoff = now - 24h（宽限期内不扫）。
	expired, err := repo.ExpireStaleOrders(ctx, now.Add(-24*time.Hour), 100)
	require.NoError(t, err)
	require.Len(t, expired, 1)
	assert.Equal(t, stale30h, expired[0].ID, "仅清扫过期超过宽限期的订单")

	st, by := orderStatusCanceledBy(t, pool, stale30h)
	assert.Equal(t, "canceled", st)
	require.NotNil(t, by, "清扫必须留 canceled_by")
	assert.Equal(t, "expiry", *by, "清扫写 canceled_by='expiry'（复活路径的判定依据）")

	st, _ = orderStatusCanceledBy(t, pool, withinGrace)
	assert.Equal(t, "pending", st, "2h 前到期的订单在 24h 宽限期内不被清扫（在途 webhook 重试窗口）")

	// repo 原始语义保持 expires_at <= $1：以 now 为 cutoff 时宽限期内行也可扫。
	expired, err = repo.ExpireStaleOrders(ctx, now, 100)
	require.NoError(t, err)
	require.Len(t, expired, 1)
	st, by = orderStatusCanceledBy(t, pool, withinGrace)
	assert.Equal(t, "canceled", st)
	assert.Equal(t, "expiry", *by)
}

// TestCancelOrder_CanceledBy_DB covers the human cancel paths (fix #1):
// CancelOrder stamps 'user'/'admin' and keeps the ErrStatusConflict contract.
func TestCancelOrder_CanceledBy_DB(t *testing.T) {
	pool := newBillingScratchPool(t)
	ctx := context.Background()
	repo := New(pool)

	uid, wsID := seedCancelUserWS(t, pool, "uc51")
	userOrder := insertPendingOrder(t, pool, wsID, uid, "stripe", nil)
	adminOrder := insertPendingOrder(t, pool, wsID, uid, "stripe", nil)
	paidOrder := insertPendingOrder(t, pool, wsID, uid, "stripe", nil)
	_, err := pool.Exec(ctx, `UPDATE "order" SET status = 'paid' WHERE id = $1`, paidOrder)
	require.NoError(t, err)

	require.NoError(t, repo.CancelOrder(ctx, userOrder, domain.OrderPending, "user", time.Now()))
	st, by := orderStatusCanceledBy(t, pool, userOrder)
	assert.Equal(t, "canceled", st)
	require.NotNil(t, by)
	assert.Equal(t, "user", *by, "用户取消写 canceled_by='user'（不可复活）")

	require.NoError(t, repo.CancelOrder(ctx, adminOrder, domain.OrderPending, "admin", time.Now()))
	_, by = orderStatusCanceledBy(t, pool, adminOrder)
	require.NotNil(t, by)
	assert.Equal(t, "admin", *by, "管理员取消写 canceled_by='admin'（不可复活）")

	err = repo.CancelOrder(ctx, paidOrder, domain.OrderPending, "admin", time.Now())
	assert.ErrorIs(t, err, domain.ErrStatusConflict, "状态不符维持终局冲突语义")
}

// TestReviveOrderAfterExpiry_DB covers the revival transition (fix #1):
// canceled_by='expiry' rows revive canceled→paid; 'user'/'admin'/NULL do not.
func TestReviveOrderAfterExpiry_DB(t *testing.T) {
	pool := newBillingScratchPool(t)
	ctx := context.Background()
	repo := New(pool)

	uid, wsID := seedCancelUserWS(t, pool, "rv51")

	seedCanceled := func(canceledBy *string) string {
		id := insertPendingOrder(t, pool, wsID, uid, "waffo", time.Now().Add(-30*time.Hour))
		_, err := pool.Exec(ctx,
			`UPDATE "order" SET status = 'canceled', canceled_at = now(), canceled_by = $2 WHERE id = $1`,
			id, canceledBy)
		require.NoError(t, err)
		return id
	}

	t.Run("canceled_by=expiry → 复活为 paid 且清 canceled_by", func(t *testing.T) {
		id := seedCanceled(&[]string{"expiry"}[0])
		revived, err := repo.ReviveOrderAfterExpiry(ctx, id, time.Now())
		require.NoError(t, err)
		assert.True(t, revived)
		st, by := orderStatusCanceledBy(t, pool, id)
		assert.Equal(t, "paid", st)
		assert.Nil(t, by, "复活后 canceled_by 语义已了结，清空")
		var paidAt *time.Time
		require.NoError(t, pool.QueryRow(ctx, `SELECT paid_at FROM "order" WHERE id = $1`, id).Scan(&paidAt))
		require.NotNil(t, paidAt, "复活留 paid_at")
	})

	t.Run("canceled_by=user / admin / NULL → 不可复活", func(t *testing.T) {
		for _, v := range []*string{&[]string{"user"}[0], &[]string{"admin"}[0], nil} {
			id := seedCanceled(v)
			revived, err := repo.ReviveOrderAfterExpiry(ctx, id, time.Now())
			require.NoError(t, err)
			assert.False(t, revived, "canceled_by=%v 不可复活（NULL=存量行来源不明）", deref(v))
			st, _ := orderStatusCanceledBy(t, pool, id)
			assert.Equal(t, "canceled", st)
		}
	})

	t.Run("非 canceled 终局 → no-op", func(t *testing.T) {
		id := insertPendingOrder(t, pool, wsID, uid, "waffo", nil)
		revived, err := repo.ReviveOrderAfterExpiry(ctx, id, time.Now())
		require.NoError(t, err)
		assert.False(t, revived)
	})
}

func deref(p *string) string {
	if p == nil {
		return "<NULL>"
	}
	return *p
}

// TestRegisterChannelProductAtomic_DoubleClick_DB covers fix #12: two
// concurrent registrations of the same (channel, plan, interval) serialize on
// the advisory lock — the channel REST callback runs exactly once and the
// loser returns the winner's mapping.
func TestRegisterChannelProductAtomic_DoubleClick_DB(t *testing.T) {
	pool := newBillingScratchPool(t)
	ctx := context.Background()
	repo := New(pool)

	entered := make(chan struct{})
	release := make(chan struct{})
	var registerCalls int32

	winnerDone := make(chan struct{})
	var winnerID string
	var winnerErr error
	go func() {
		defer close(winnerDone)
		winnerID, _, winnerErr = repo.RegisterChannelProductAtomic(ctx, "catalog", "pro", domain.IntervalMonthly,
			func(context.Context) (string, error) {
				atomic.AddInt32(&registerCalls, 1)
				close(entered) // 渠道回调已进入 → advisory lock 已持有
				<-release      // 模拟慢渠道 REST，让双击重叠
				return "PROD_A", nil
			}, 990, time.Now())
	}()
	<-entered

	loserDone := make(chan struct{})
	var loserID string
	var loserExisted bool
	var loserErr error
	go func() {
		defer close(loserDone)
		loserID, loserExisted, loserErr = repo.RegisterChannelProductAtomic(ctx, "catalog", "pro", domain.IntervalMonthly,
			func(context.Context) (string, error) {
				atomic.AddInt32(&registerCalls, 1)
				return "PROD_B", nil
			}, 990, time.Now())
	}()

	// 给败者一点时间撞上锁（无论是否已撞上，正确性由提交序保证）。
	time.Sleep(150 * time.Millisecond)
	close(release)
	<-winnerDone
	<-loserDone

	require.NoError(t, winnerErr)
	require.NoError(t, loserErr)
	assert.Equal(t, "PROD_A", winnerID)
	assert.Equal(t, "PROD_A", loserID, "败者拿胜者落库的 id")
	assert.True(t, loserExisted, "败者 existed=true（幂等短路，不再调渠道）")
	assert.EqualValues(t, 1, atomic.LoadInt32(&registerCalls), "渠道 REST 只跑一次")

	var stored string
	require.NoError(t, pool.QueryRow(ctx, `
		SELECT channel_product_id FROM billing_channel_products
		WHERE channel = 'catalog' AND plan_code = 'pro' AND interval = 'monthly'`).Scan(&stored))
	assert.Equal(t, "PROD_A", stored, "映射不得被败者覆盖")
}
