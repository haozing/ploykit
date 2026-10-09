package pgrepo

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/billing/domain"
)

func seedPendingOrder(t *testing.T, repo *Repo, wsID string) string {
	t.Helper()
	var orderID string
	require.NoError(t, repo.pool.QueryRow(context.Background(), `
		INSERT INTO "order" (workspace_id, user_id, plan_code, interval, amount_cents, currency, channel, status)
		VALUES ($1, (SELECT created_by FROM workspace WHERE id = $1), 'pro', 'monthly', 9900, 'CNY', 'stripe', 'pending')
		RETURNING id`, wsID).Scan(&orderID))
	return orderID
}

func TestUpdateOrderStatus_SEC_V1(t *testing.T) {
	repo := subTestDB(t)
	ctx := context.Background()
	ws := seedWS(t, repo, "pro", "", nil)
	now := time.Now().UTC().Truncate(time.Microsecond)

	t.Run("pending→canceled 成功且时间戳落库（旧实现 42P18→500）", func(t *testing.T) {
		id := seedPendingOrder(t, repo, ws)
		require.NoError(t, repo.UpdateOrderStatus(ctx, id, domain.OrderPending, domain.OrderCanceled, now))

		var status string
		var canceledAt, paidAt *time.Time
		require.NoError(t, repo.pool.QueryRow(ctx,
			`SELECT status, canceled_at, paid_at FROM "order" WHERE id = $1`, id).
			Scan(&status, &canceledAt, &paidAt))
		assert.Equal(t, string(domain.OrderCanceled), status)
		require.NotNil(t, canceledAt, "canceled_at 应置位")
		assert.Nil(t, paidAt, "非 paid 迁移不应置 paid_at")
	})

	t.Run("pending→paid 成功且 paid_at 置位", func(t *testing.T) {
		id := seedPendingOrder(t, repo, ws)
		require.NoError(t, repo.UpdateOrderStatus(ctx, id, domain.OrderPending, domain.OrderPaid, now))

		var status string
		var paidAt *time.Time
		require.NoError(t, repo.pool.QueryRow(ctx,
			`SELECT status, paid_at FROM "order" WHERE id = $1`, id).Scan(&status, &paidAt))
		assert.Equal(t, string(domain.OrderPaid), status)
		require.NotNil(t, paidAt)
	})

	t.Run("状态不匹配 → ErrStatusConflict（409 路径）", func(t *testing.T) {
		id := seedPendingOrder(t, repo, ws)
		require.NoError(t, repo.UpdateOrderStatus(ctx, id, domain.OrderPending, domain.OrderCanceled, now))
		err := repo.UpdateOrderStatus(ctx, id, domain.OrderPending, domain.OrderCanceled, now)
		assert.ErrorIs(t, err, domain.ErrStatusConflict)
	})
}

func TestUpdateOrderStatus_Concurrent_SEC_V1(t *testing.T) {
	repo := subTestDB(t)
	ctx := context.Background()
	ws := seedWS(t, repo, "pro", "", nil)
	id := seedPendingOrder(t, repo, ws)
	now := time.Now().UTC().Truncate(time.Microsecond)

	const n = 4
	var wg sync.WaitGroup
	errs := make([]error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			errs[i] = repo.UpdateOrderStatus(ctx, id, domain.OrderPending, domain.OrderCanceled, now)
		}(i)
	}
	wg.Wait()

	okCount, conflictCount := 0, 0
	for _, err := range errs {
		switch {
		case err == nil:
			okCount++
		case assert.ErrorIs(t, err, domain.ErrStatusConflict):
			conflictCount++
		}
	}
	assert.Equal(t, 1, okCount, "并发取消恰一次成功")
	assert.Equal(t, n-1, conflictCount, "其余全部 409 语义冲突")

	var status string
	require.NoError(t, repo.pool.QueryRow(ctx,
		`SELECT status FROM "order" WHERE id = $1`, id).Scan(&status))
	assert.Equal(t, string(domain.OrderCanceled), status)
}
