package pgrepo

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/webhooks/app"
)

func TestRepo_ClaimPendingFinalizesOrphans_DQ_DEF_6(t *testing.T) {
	pool := testPool(t)
	repo := New(pool)
	ctx := context.Background()
	ws := mkFixture(t, pool)
	sub := mkSub(t, repo, ws, []string{"task.created"})
	active := mkSub(t, repo, ws, []string{"task.created"})

	require.NoError(t, repo.EnqueuePing(ctx, ws, sub.ID))
	require.NoError(t, repo.EnqueuePing(ctx, ws, active.ID))
	var orphanID string
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT id FROM webhook_delivery WHERE subscription_id = $1`, sub.ID).Scan(&orphanID))
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM webhook_delivery WHERE id IN ($1)`, orphanID)
	})
	require.NoError(t, repo.DeleteSubscription(ctx, ws, sub.ID))

	pending, err := repo.ClaimPending(ctx, 10)
	require.NoError(t, err)
	claimedActive := false
	for _, p := range pending {
		if p.DeliveryID == orphanID {
			t.Fatal("孤儿投递不得被认领投递")
		}
		if p.SubscriptionID == active.ID {
			claimedActive = true
		}
	}
	assert.True(t, claimedActive, "活跃订阅的投递照常认领（孤儿终态化不误伤正常路径）")

	var status, lastError string
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT status, COALESCE(last_error,'') FROM webhook_delivery WHERE id = $1`, orphanID).
		Scan(&status, &lastError))
	assert.Equal(t, app.StatusDead, status)
	assert.Contains(t, lastError, "orphaned")

	pending2, err := repo.ClaimPending(ctx, 10)
	require.NoError(t, err)
	for _, p := range pending2 {
		if p.DeliveryID == orphanID {
			t.Fatal("dead 孤儿行不得被重复处理")
		}
	}
}
