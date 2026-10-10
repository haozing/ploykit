package events

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/ids"
	"github.com/haozing/ploykit/platform/workers"
)

func newScratchPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	admin, err := pgxpool.New(ctx, dsn)
	require.NoError(t, err)
	scratch := "events_it_" + ids.NewV4().String()[:8]
	_, err = admin.Exec(ctx, "CREATE DATABASE "+scratch)
	require.NoError(t, err, "scratch db (needs CREATEDB privilege; dev compose user pk 是 superuser)")

	u, err := url.Parse(dsn)
	require.NoError(t, err)
	u.Path = "/" + scratch
	pool, err := pgxpool.New(ctx, u.String())
	require.NoError(t, err)

	require.NoError(t, Migrate(ctx, pool)) // 狗粮：框架自用导出的引导入口

	t.Cleanup(func() {
		pool.Close()
		dropCtx, dropCancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer dropCancel()
		_, _ = admin.Exec(dropCtx, fmt.Sprintf("DROP DATABASE %s WITH (FORCE)", scratch))
		admin.Close()
	})
	return pool
}

func countJobs(t *testing.T, pool *pgxpool.Pool, where string, args ...any) int {
	t.Helper()
	var n int
	require.NoError(t, pool.QueryRow(context.Background(),
		"SELECT count(*) FROM river_job WHERE kind = 'ploykit.event' AND "+where, args...).Scan(&n))
	return n
}

func TestEmit_SameTxLifecycle(t *testing.T) {
	pool := newScratchPool(t)
	em, err := New(pool, nil)
	require.NoError(t, err)

	ctx := context.Background()
	ws := uuid.New()
	ev := Event{
		Kind:           "it.tick",
		WorkspaceID:    ws,
		Payload:        []byte(`{"n":1}`),
		IDempotencyKey: "tx-life-1",
	}

	tx, err := pool.Begin(ctx)
	require.NoError(t, err)
	require.NoError(t, em.Emit(ctx, tx, ev))
	require.Equal(t, 0, countJobs(t, pool, "true"), "未提交事件对其它连接（池侧）不可见")
	require.NoError(t, tx.Rollback(ctx))
	require.Equal(t, 0, countJobs(t, pool, "true"), "回滚后事件必须不存在（验收门①）")

	tx, err = pool.Begin(ctx)
	require.NoError(t, err)
	require.NoError(t, em.Emit(ctx, tx, ev))
	require.NoError(t, tx.Commit(ctx))
	require.Equal(t, 1, countJobs(t, pool, "true"))

	var kind, idem, wsOut string
	var payload []byte
	require.NoError(t, pool.QueryRow(ctx, `
		SELECT args->>'kind', args->>'idempotency_key', args->'payload', args->>'workspace_id'
		FROM river_job WHERE kind = 'ploykit.event'`).Scan(&kind, &idem, &payload, &wsOut))
	require.Equal(t, "it.tick", kind)
	require.Equal(t, "tx-life-1", idem)
	require.JSONEq(t, `{"n":1}`, string(payload))
	require.Equal(t, ws.String(), wsOut)
}

func TestEmit_IdempotencyKeyDedup(t *testing.T) {
	pool := newScratchPool(t)
	em, err := New(pool, nil)
	require.NoError(t, err)

	ctx := context.Background()
	ws := uuid.New()
	emit := func(key, payload string) {
		tx, err := pool.Begin(ctx)
		require.NoError(t, err)
		require.NoError(t, em.Emit(ctx, tx, Event{
			Kind: "it.dedup", WorkspaceID: ws,
			Payload: []byte(payload), IDempotencyKey: key,
		}))
		require.NoError(t, tx.Commit(ctx))
	}

	emit("same-key", `{"v":1}`)
	emit("same-key", `{"v":1}`)
	require.Equal(t, 1, countJobs(t, pool, "true"), "同幂等键重放不得双投")

	emit("same-key", `{"v":2,"recomputed_at":"2026-10-09T00:00:00Z"}`)
	require.Equal(t, 1, countJobs(t, pool, "true"), "同键异 payload 仍命中同一唯一 job（ByArgs 哈希不含 payload）")
	var stored string
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT args->>'payload' FROM river_job WHERE kind = 'ploykit.event'`).Scan(&stored))
	require.JSONEq(t, `{"v":1}`, stored, "首投的 payload 原样保留，不被重放改写")

	emit("other-key", `{"v":1}`)
	require.Equal(t, 2, countJobs(t, pool, "true"), "不同键是不同事件")

	for range 2 {
		tx, err := pool.Begin(ctx)
		require.NoError(t, err)
		require.NoError(t, em.Emit(ctx, tx, Event{Kind: "it.nokey", WorkspaceID: ws, Payload: nil}))
		require.NoError(t, tx.Commit(ctx))
	}
	require.Equal(t, 2, countJobs(t, pool, "args->>'kind' = 'it.nokey'"),
		"无幂等键的事件每次都是新投递（at-least-once，幂等归订阅方契约）")
}

func TestEmit_QueueIsolation(t *testing.T) {
	pool := newScratchPool(t)
	em, err := New(pool, nil)
	require.NoError(t, err)

	ctx := context.Background()
	ws := uuid.New()

	tx, err := pool.Begin(ctx)
	require.NoError(t, err)
	require.NoError(t, em.Emit(ctx, tx, Event{Kind: "it.queue-default", WorkspaceID: ws}))
	require.NoError(t, tx.Commit(ctx))
	require.Equal(t, 1, countJobs(t, pool, "queue = 'events'"),
		"缺省事件 job 必须落在 events 队列（与产品 River client 的 default 队列隔离）")

	tx, err = pool.Begin(ctx)
	require.NoError(t, err)
	require.NoError(t, em.Emit(ctx, tx, Event{Kind: "it.queue-override", WorkspaceID: ws},
		river.InsertOpts{Queue: "default"}))
	require.NoError(t, tx.Commit(ctx))
	require.Equal(t, 1, countJobs(t, pool, "queue = 'default' AND args->>'kind' = 'it.queue-override'"),
		"显式 Queue 逃生口落指定队列")
}

func TestEmit_RejectsEmptyKind(t *testing.T) {
	pool := newScratchPool(t)
	em, err := New(pool, nil)
	require.NoError(t, err)

	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer tx.Rollback(ctx)
	require.ErrorContains(t, em.Emit(ctx, tx, Event{WorkspaceID: uuid.New()}), "empty kind")
}

func TestEvents_Roundtrip(t *testing.T) {
	pool := newScratchPool(t)

	got := make(chan Event, 1)
	Subscribe("it.roundtrip", func(_ context.Context, ev Event) error {
		got <- ev
		return nil
	})

	wks := workers.NewWorkers(slog.Default())
	em, err := New(pool, wks)
	require.NoError(t, err)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	wks.Start(ctx)

	ws := uuid.New()
	tx, err := pool.Begin(context.Background())
	require.NoError(t, err)
	require.NoError(t, em.Emit(context.Background(), tx, Event{
		Kind:           "it.roundtrip",
		WorkspaceID:    ws,
		Payload:        []byte(`{"x":1}`),
		IDempotencyKey: "rt-1",
	}))
	require.NoError(t, tx.Commit(context.Background()))

	select {
	case ev := <-got:
		require.Equal(t, "it.roundtrip", ev.Kind)
		require.Equal(t, ws, ev.WorkspaceID)
		require.Equal(t, "rt-1", ev.IDempotencyKey)
		require.JSONEq(t, `{"x":1}`, string(ev.Payload))
	case <-time.After(15 * time.Second):
		t.Fatal("event not delivered within 15s")
	}

	cancel()
	wks.Drain(20 * time.Second)
	require.False(t, wks.AnyCrashed(), "river_events worker should exit cleanly, not crash")
	require.Equal(t, 1, countJobs(t, pool, "state = 'completed'"), "handled job completes exactly once")
}


func TestMigrate_Idempotent(t *testing.T) {
	pool := newScratchPool(t) // 内部已 Migrate 一次
	ctx := context.Background()
	require.NoError(t, Migrate(ctx, pool)) // 再跑一遍应无副作用
	var n int
	require.NoError(t, pool.QueryRow(ctx, "SELECT count(*) FROM river_job").Scan(&n))
	require.Equal(t, 0, n)
}


func TestEmitAt_ScheduledAtPersisted(t *testing.T) {
	pool := newScratchPool(t)
	em, err := New(pool, nil)
	require.NoError(t, err)
	ctx := context.Background()

	at := time.Now().Add(2 * time.Hour).UTC().Truncate(time.Second)
	tx, err := pool.Begin(ctx)
	require.NoError(t, err)
	require.NoError(t, em.EmitAt(ctx, tx, Event{Kind: "probe.once", Payload: []byte(`{}`)}, at))
	require.NoError(t, tx.Commit(ctx))

	var got time.Time
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT scheduled_at FROM river_job WHERE args->>'kind' = 'probe.once'`).Scan(&got))
	require.WithinDuration(t, at, got, time.Second, "scheduled_at 应等于传入时刻")
}
