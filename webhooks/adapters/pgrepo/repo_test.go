package pgrepo

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/migrations"
	pgm "github.com/haozing/ploykit/platform/pgmigrate"
	"github.com/haozing/ploykit/webhooks/app"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}

	if err := pgm.Up(ctx, pool, migrations.FS, "."); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func mkFixture(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	ctx := context.Background()
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	var userID, wsID string
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO "user" (email) VALUES ($1) RETURNING id`,
		"whk-test-"+suffix+"@example.com").Scan(&userID))
	var err error
	wsID, err = mkWorkspace(ctx, pool, userID, suffix)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM workspace WHERE id = $1`, wsID)
		_, _ = pool.Exec(ctx, `DELETE FROM "user" WHERE id = $1`, userID)
	})
	return wsID
}

func mkWorkspace(ctx context.Context, pool *pgxpool.Pool, userID, suffix string) (string, error) {
	var wsID string
	err := pool.QueryRow(ctx,
		`INSERT INTO workspace (slug, name, created_by) VALUES ($1, $2, $3) RETURNING id`,
		"whk-test-ws-"+suffix, "whk test", userID).Scan(&wsID)
	return wsID, err
}

func mkSub(t *testing.T, repo *Repo, wsID string, eventTypes []string) app.Subscription {
	t.Helper()
	sub, err := repo.CreateSubscription(context.Background(), app.Subscription{
		WorkspaceID: wsID,
		EventTypes:  eventTypes,
		URL:         "https://example.com/hook",
		Description: "test",
		IsActive:    true,
	}, "whk_secret_"+wsID[:8])
	require.NoError(t, err)
	return sub
}

func TestRepo_GetSubscription(t *testing.T) {
	pool := testPool(t)
	repo := New(pool)
	ctx := context.Background()
	ws := mkFixture(t, pool)
	other := mkFixture(t, pool)
	sub := mkSub(t, repo, ws, []string{"task.created"})

	got, ok, err := repo.GetSubscription(ctx, ws, sub.ID)
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, sub.ID, got.ID)
	assert.Equal(t, ws, got.WorkspaceID)
	assert.True(t, got.IsActive)
	assert.Equal(t, []string{"task.created"}, got.EventTypes)

	_, ok, err = repo.GetSubscription(ctx, other, sub.ID)
	require.NoError(t, err)
	assert.False(t, ok, "cross-workspace get must not be found")

	_, ok, err = repo.GetSubscription(ctx, ws, "00000000-0000-0000-0000-000000000000")
	require.NoError(t, err)
	assert.False(t, ok)
}

func TestRepo_SetSubscriptionActive(t *testing.T) {
	pool := testPool(t)
	repo := New(pool)
	ctx := context.Background()
	ws := mkFixture(t, pool)
	other := mkFixture(t, pool)
	sub := mkSub(t, repo, ws, []string{"task.created"})
	now := time.Now().UTC()

	require.NoError(t, repo.SetSubscriptionActive(ctx, ws, sub.ID, false, now))
	subs, err := repo.ListSubscriptions(ctx, ws)
	require.NoError(t, err)
	require.Len(t, subs, 1)
	assert.False(t, subs[0].IsActive, "ListSubscriptions should reflect paused state")

	require.NoError(t, repo.SetSubscriptionActive(ctx, ws, sub.ID, true, now))
	subs, err = repo.ListSubscriptions(ctx, ws)
	require.NoError(t, err)
	require.Len(t, subs, 1)
	assert.True(t, subs[0].IsActive)

	err = repo.SetSubscriptionActive(ctx, other, sub.ID, false, now)
	assert.ErrorIs(t, err, app.ErrNotFound, "cross-workspace toggle must be not found")
	err = repo.SetSubscriptionActive(ctx, ws, "00000000-0000-0000-0000-000000000000", false, now)
	assert.ErrorIs(t, err, app.ErrNotFound)
}

func TestRepo_EnqueuePing(t *testing.T) {
	pool := testPool(t)
	repo := New(pool)
	ctx := context.Background()
	ws := mkFixture(t, pool)
	other := mkFixture(t, pool)
	sub := mkSub(t, repo, ws, []string{"task.created"})

	require.NoError(t, repo.EnqueuePing(ctx, ws, sub.ID))

	var eventID, eventType, status string
	var payload []byte
	var attempts int
	err := pool.QueryRow(ctx, `
		SELECT event_id, event_type, payload, status, attempts
		FROM webhook_delivery WHERE subscription_id = $1`, sub.ID).
		Scan(&eventID, &eventType, &payload, &status, &attempts)
	require.NoError(t, err)
	assert.Equal(t, "ping", eventType)
	assert.Equal(t, app.StatusPending, status)
	assert.Equal(t, 0, attempts)
	assert.JSONEq(t, `{"message":"webhooks.ping"}`, string(payload))
	assert.NotEmpty(t, eventID, "ping needs its own event_id")

	_, err = repo.ListDeliveries(ctx, ws, 10)
	require.NoError(t, err, "ListDeliveries must tolerate never-attempted pending rows")

	pending, err := repo.ClaimPending(ctx, 10)
	require.NoError(t, err)
	found := false
	for _, p := range pending {
		if p.SubscriptionID == sub.ID {
			found = true
			assert.Equal(t, "ping", p.EventType)
			assert.NotEmpty(t, p.URL)
		}
	}
	assert.True(t, found, "ping delivery should be claimable")

	err = repo.EnqueuePing(ctx, other, sub.ID)
	assert.ErrorIs(t, err, app.ErrNotFound, "cross-workspace ping must be not found")
	err = repo.EnqueuePing(ctx, ws, "00000000-0000-0000-0000-000000000000")
	assert.ErrorIs(t, err, app.ErrNotFound)

	var pingBefore int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM webhook_delivery WHERE subscription_id = $1 AND event_type = 'ping'`,
		sub.ID).Scan(&pingBefore))
	require.NoError(t, repo.SetSubscriptionActive(ctx, ws, sub.ID, false, time.Now().UTC()))
	err = repo.EnqueuePing(ctx, ws, sub.ID)
	assert.ErrorIs(t, err, app.ErrNotFound, "paused subscription must not enqueue ping (WH4)")
	var pingAfter int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM webhook_delivery WHERE subscription_id = $1 AND event_type = 'ping'`,
		sub.ID).Scan(&pingAfter))
	assert.Equal(t, pingBefore, pingAfter, "paused subscription must not accumulate new ping rows")
}

func TestRepo_Redeliver(t *testing.T) {
	pool := testPool(t)
	repo := New(pool)
	ctx := context.Background()
	ws := mkFixture(t, pool)
	other := mkFixture(t, pool)
	sub := mkSub(t, repo, ws, []string{"task.created"})

	n, err := repo.EmitForEvent(ctx, ws, app.OutboundEvent{
		ID: "evt-redeliver-1", Type: "task.created", Payload: map[string]any{"task": "t1"},
	})
	require.NoError(t, err)
	require.Equal(t, 1, n)
	var deliveryID string
	err = pool.QueryRow(ctx,
		`SELECT id FROM webhook_delivery WHERE subscription_id = $1 AND event_id = 'evt-redeliver-1'`,
		sub.ID).Scan(&deliveryID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx,
		`UPDATE webhook_delivery SET status='delivered', attempts=3 WHERE id=$1`, deliveryID)
	require.NoError(t, err)

	got, err := repo.Redeliver(ctx, ws, deliveryID)
	require.NoError(t, err)
	assert.NotEqual(t, deliveryID, got.ID, "redeliver must create a new row")
	assert.Equal(t, sub.ID, got.SubscriptionID)
	assert.Equal(t, "evt-redeliver-1", got.EventID,
		"WH12：重投复用原 event_id（接收方按 ID 幂等去重；不再加 .r 后缀）")
	assert.Equal(t, app.StatusPending, got.Status)
	assert.Equal(t, 0, got.Attempts)
	assert.Equal(t, "task.created", got.EventType)

	var oldStatus string
	err = pool.QueryRow(ctx,
		`SELECT status FROM webhook_delivery WHERE id = $1`, deliveryID).Scan(&oldStatus)
	require.NoError(t, err)
	assert.Equal(t, "delivered", oldStatus)

	var newPayload []byte
	err = pool.QueryRow(ctx,
		`SELECT payload FROM webhook_delivery WHERE id = $1`, got.ID).Scan(&newPayload)
	require.NoError(t, err)
	assert.JSONEq(t, `{"task":"t1"}`, string(newPayload))

	_, err = repo.Redeliver(ctx, other, deliveryID)
	assert.ErrorIs(t, err, app.ErrNotFound, "cross-workspace redeliver must be not found")
	var cnt int
	err = pool.QueryRow(ctx,
		`SELECT count(*) FROM webhook_delivery WHERE subscription_id = $1 AND event_id LIKE 'evt-redeliver-1%'`,
		sub.ID).Scan(&cnt)
	require.NoError(t, err)
	assert.Equal(t, 2, cnt, "only the one legit redeliver row should exist")

	_, err = repo.Redeliver(ctx, ws, "00000000-0000-0000-0000-000000000000")
	assert.ErrorIs(t, err, app.ErrNotFound)
}

func TestRepo_EmitForEventSkipsInactive(t *testing.T) {
	pool := testPool(t)
	repo := New(pool)
	ctx := context.Background()
	ws := mkFixture(t, pool)
	sub := mkSub(t, repo, ws, []string{"task.created"})

	n, err := repo.EmitForEvent(ctx, ws, app.OutboundEvent{ID: "evt-a", Type: "task.created", Payload: map[string]any{}})
	require.NoError(t, err)
	require.Equal(t, 1, n)

	require.NoError(t, repo.SetSubscriptionActive(ctx, ws, sub.ID, false, time.Now().UTC()))
	n, err = repo.EmitForEvent(ctx, ws, app.OutboundEvent{ID: "evt-b", Type: "task.created", Payload: map[string]any{}})
	require.NoError(t, err)
	assert.Equal(t, 0, n, "paused subscription must not receive new events")
}

func TestRepo_ClaimPendingSkipsPaused(t *testing.T) {
	pool := testPool(t)
	repo := New(pool)
	ctx := context.Background()
	ws := mkFixture(t, pool)
	active := mkSub(t, repo, ws, []string{"task.created"})
	paused := mkSub(t, repo, ws, []string{"task.created"})

	require.NoError(t, repo.EnqueuePing(ctx, ws, active.ID))
	require.NoError(t, repo.EnqueuePing(ctx, ws, paused.ID))
	require.NoError(t, repo.SetSubscriptionActive(ctx, ws, paused.ID, false, time.Now().UTC()))

	pending, err := repo.ClaimPending(ctx, 10)
	require.NoError(t, err)
	var claimedActive, claimedPaused int
	for _, p := range pending {
		switch p.SubscriptionID {
		case active.ID:
			claimedActive++
		case paused.ID:
			claimedPaused++
		}
	}
	assert.Equal(t, 1, claimedActive, "active subscription's delivery must be claimed")
	assert.Equal(t, 0, claimedPaused, "paused subscription's pending delivery must not be claimed")

	var status string
	var attempts int
	err = pool.QueryRow(ctx,
		`SELECT status, attempts FROM webhook_delivery WHERE subscription_id = $1`, paused.ID).
		Scan(&status, &attempts)
	require.NoError(t, err)
	assert.Equal(t, app.StatusPending, status)
	assert.Equal(t, 0, attempts, "paused subscription's delivery must not get attempts incremented")
}

func TestRepo_DeliverySurvivesSubscriptionDelete(t *testing.T) {
	pool := testPool(t)
	repo := New(pool)
	ctx := context.Background()
	ws := mkFixture(t, pool)
	sub := mkSub(t, repo, ws, []string{"task.created"})

	require.NoError(t, repo.EnqueuePing(ctx, ws, sub.ID))
	var deliveryID string
	err := pool.QueryRow(ctx,
		`SELECT id FROM webhook_delivery WHERE subscription_id = $1`, sub.ID).Scan(&deliveryID)
	require.NoError(t, err)

	require.NoError(t, repo.DeleteSubscription(ctx, ws, sub.ID))

	var subID *string
	var wsID string
	var status string
	err = pool.QueryRow(ctx,
		`SELECT subscription_id, workspace_id, status FROM webhook_delivery WHERE id = $1`, deliveryID).
		Scan(&subID, &wsID, &status)
	require.NoError(t, err, "delivery row must survive subscription deletion")
	assert.Nil(t, subID, "orphaned delivery must have NULL subscription_id")
	assert.Equal(t, ws, wsID, "027 起孤儿行保留 workspace_id 归属")
	assert.Equal(t, app.StatusPending, status)

	items, err := repo.ListDeliveries(ctx, ws, 50)
	require.NoError(t, err)
	found := false
	for _, d := range items {
		if d.ID == deliveryID {
			found = true
			assert.Empty(t, d.SubscriptionID, "孤儿行的 subscription_id 扫为空串")
		}
	}
	assert.True(t, found, "删订阅后的孤儿投递必须在本工作区列表可见（WH5）")

	pending, err := repo.ClaimPending(ctx, 10)
	require.NoError(t, err)
	for _, p := range pending {
		if p.DeliveryID == deliveryID {
			t.Fatal("orphaned delivery must not be claimed")
		}
	}
}

func TestRepo_ListDeliveriesShowsOrphans_WH5(t *testing.T) {
	pool := testPool(t)
	repo := New(pool)
	ctx := context.Background()
	ws := mkFixture(t, pool)
	other := mkFixture(t, pool)
	alive := mkSub(t, repo, ws, []string{"task.created"})
	doomed := mkSub(t, repo, ws, []string{"task.created"})

	n, err := repo.EmitForEvent(ctx, ws, app.OutboundEvent{ID: "evt-wh5", Type: "task.created", Payload: map[string]any{}})
	require.NoError(t, err)
	require.Equal(t, 2, n, "两个订阅都匹配 task.created")
	require.NoError(t, repo.EnqueuePing(ctx, ws, doomed.ID))
	var orphanID string
	err = pool.QueryRow(ctx,
		`SELECT id FROM webhook_delivery WHERE subscription_id = $1 AND event_type = 'ping'`, doomed.ID).
		Scan(&orphanID)
	require.NoError(t, err)
	require.NoError(t, repo.DeleteSubscription(ctx, ws, doomed.ID))

	items, err := repo.ListDeliveries(ctx, ws, 50)
	require.NoError(t, err)
	require.Len(t, items, 3, "存活订阅两条投递 + 孤儿一条，全部可见")
	sawOrphan, sawAlive := false, false
	for _, d := range items {
		switch d.ID {
		case orphanID:
			sawOrphan = true
			assert.Empty(t, d.SubscriptionID, "孤儿行 subscription_id 为空串（订阅已删）")
		default:
			sawAlive = sawAlive || d.SubscriptionID == alive.ID
		}
	}
	assert.True(t, sawOrphan, "孤儿投递必须在本工作区视图可见（WH5 修复主断言）")
	assert.True(t, sawAlive, "存活订阅的投递仍应可见")

	otherItems, err := repo.ListDeliveries(ctx, other, 50)
	require.NoError(t, err)
	assert.Empty(t, otherItems, "跨工作区视图必须为空")
}

func TestRepo_NewDeliveriesCarryWorkspaceID_WH5(t *testing.T) {
	pool := testPool(t)
	repo := New(pool)
	ctx := context.Background()
	ws := mkFixture(t, pool)
	sub := mkSub(t, repo, ws, []string{"task.created"})

	n, err := repo.EmitForEvent(ctx, ws, app.OutboundEvent{ID: "evt-ws-a", Type: "task.created", Payload: map[string]any{}})
	require.NoError(t, err)
	require.Equal(t, 1, n)
	require.NoError(t, repo.EnqueuePing(ctx, ws, sub.ID))

	var emitWS, pingWS string
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT workspace_id FROM webhook_delivery WHERE event_id = 'evt-ws-a'`).Scan(&emitWS))
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT workspace_id FROM webhook_delivery WHERE event_type = 'ping' AND subscription_id = $1`, sub.ID).Scan(&pingWS))
	assert.Equal(t, ws, emitWS, "EmitForEvent 新行必须落 workspace_id")
	assert.Equal(t, ws, pingWS, "EnqueuePing 新行必须落 workspace_id")

	redelivered, err := repo.Redeliver(ctx, ws, pingWSDeliveryID(t, pool, sub.ID))
	require.NoError(t, err)
	var redeliverWS string
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT workspace_id FROM webhook_delivery WHERE id = $1`, redelivered.ID).Scan(&redeliverWS))
	assert.Equal(t, ws, redeliverWS, "Redeliver 复制行必须落 workspace_id")
}

func pingWSDeliveryID(t *testing.T, pool *pgxpool.Pool, subID string) string {
	t.Helper()
	var id string
	require.NoError(t, pool.QueryRow(context.Background(),
		`SELECT id FROM webhook_delivery WHERE event_type = 'ping' AND subscription_id = $1`, subID).Scan(&id))
	return id
}

func TestRepo_ClaimPending_ConcurrentWorkers(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	ws := mkFixture(t, pool)

	seedRepo := New(pool)
	mkSub(t, seedRepo, ws, []string{"task.created"})

	const rows = 24
	for range rows {
		_, err := pool.Exec(ctx, `
			INSERT INTO webhook_delivery (workspace_id, subscription_id, event_id, event_type, payload)
			SELECT $1, s.id, gen_random_uuid()::text, 'task.created', '{}'::jsonb
			FROM webhook_subscription s WHERE s.workspace_id = $1
			LIMIT 1`, ws)
		require.NoError(t, err)
	}

	const workers = 4
	type result struct {
		ids []string
		err error
	}
	resCh := make(chan result, workers)
	for range workers {
		go func() {
			repo := New(pool)
			var ids []string
			for {
				batch, err := repo.ClaimPending(ctx, 5)
				if err != nil {
					resCh <- result{err: err}
					return
				}
				if len(batch) == 0 {
					resCh <- result{ids: ids}
					return
				}
				for _, d := range batch {
					ids = append(ids, d.DeliveryID)
					if err := repo.MarkDelivered(ctx, d.DeliveryID, 200, time.Now().UTC()); err != nil {
						resCh <- result{ids: ids, err: err}
						return
					}
				}
			}
		}()
	}

	total := 0
	seen := map[string]int{}
	for range workers {
		r := <-resCh
		require.NoError(t, r.err)
		total += len(r.ids)
		for _, id := range r.ids {
			seen[id]++
		}
	}
	assert.Len(t, seen, rows, "并发认领的行并集应覆盖全部 %d 行（有行饿死）", rows)
	assert.GreaterOrEqual(t, total, rows, "总认领数应不少于行数")
	var delivered int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM webhook_delivery WHERE workspace_id = $1 AND status = 'delivered'`, ws).Scan(&delivered))
	assert.Equal(t, rows, delivered, "终态应全部 delivered")
}
