package pg

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func testDB(t *testing.T) *DB {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := Connect(ctx, dsn, Options{})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(db.Close)
	return db
}

func TestPG_WithinCommits(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	db.Within(ctx, func(ctx context.Context) error {
		_, err := db.Tx(ctx).Exec(ctx, `CREATE TABLE IF NOT EXISTS pg_uow_probe (v text)`)
		return err
	})
	db.Within(ctx, func(ctx context.Context) error {
		_, err := db.Tx(ctx).Exec(ctx, `TRUNCATE pg_uow_probe`)
		return err
	})

	err := db.Within(ctx, func(ctx context.Context) error {
		_, err := db.Tx(ctx).Exec(ctx, `INSERT INTO pg_uow_probe (v) VALUES ('committed')`)
		return err
	})
	if err != nil {
		t.Fatalf("Within: %v", err)
	}
	var got string
	db.Tx(ctx).QueryRow(ctx, `SELECT v FROM pg_uow_probe LIMIT 1`).Scan(&got)
	if got != "committed" {
		t.Fatalf("commit lost: %q", got)
	}
}

func TestPG_WithinRollsBackOnError(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	boom := errors.New("boom")
	err := db.Within(ctx, func(ctx context.Context) error {
		if _, err := db.Tx(ctx).Exec(ctx, `INSERT INTO pg_uow_probe (v) VALUES ('dirty')`); err != nil {
			return err
		}
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("want boom, got %v", err)
	}
	var n int
	db.Tx(ctx).QueryRow(ctx, `SELECT count(*) FROM pg_uow_probe WHERE v='dirty'`).Scan(&n)
	if n != 0 {
		t.Fatal("error path not rolled back")
	}
}

func TestPG_NestedWithinReusesOuterTx(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()

	boom := errors.New("outer fail")
	err := db.Within(ctx, func(ctx context.Context) error {
		if _, err := db.Tx(ctx).Exec(ctx, `INSERT INTO pg_uow_probe (v) VALUES ('outer')`); err != nil {
			return err
		}
		if err := db.Within(ctx, func(ctx context.Context) error {
			_, err := db.Tx(ctx).Exec(ctx, `INSERT INTO pg_uow_probe (v) VALUES ('inner')`)
			return err
		}); err != nil {
			return err
		}
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("want boom, got %v", err)
	}
	var n int
	db.Tx(ctx).QueryRow(ctx, `SELECT count(*) FROM pg_uow_probe WHERE v IN ('outer','inner')`).Scan(&n)
	if n != 0 {
		t.Fatalf("nested transaction did not reuse the outer one (%d rows left)", n)
	}

	if err := db.Within(ctx, func(ctx context.Context) error {
		if _, err := db.Tx(ctx).Exec(ctx, `INSERT INTO pg_uow_probe (v) VALUES ('outer2')`); err != nil {
			return err
		}
		return db.Within(ctx, func(ctx context.Context) error {
			_, err := db.Tx(ctx).Exec(ctx, `INSERT INTO pg_uow_probe (v) VALUES ('inner2')`)
			return err
		})
	}); err != nil {
		t.Fatalf("nested commit: %v", err)
	}
	db.Tx(ctx).QueryRow(ctx, `SELECT count(*) FROM pg_uow_probe WHERE v IN ('outer2','inner2')`).Scan(&n)
	if n != 2 {
		t.Fatalf("nested commit lost (%d/2)", n)
	}
}

func TestPG_ReadFallsBackToPrimaryWithoutReplica(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	var v int
	err := db.Read(ctx, func(ctx context.Context, q DBTX) error {
		return q.QueryRow(ctx, `SELECT 1`).Scan(&v)
	})
	if err != nil || v != 1 {
		t.Fatalf("Read: v=%d err=%v", v, err)
	}
}

func TestPG_ReplicaWatchdogAligned_PG4(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	var mu sync.Mutex
	watched := []*pgxpool.Pool{}
	oldStart := watchdogStart
	watchdogStart = func(p *pgxpool.Pool, _ bool) {
		mu.Lock()
		watched = append(watched, p)
		mu.Unlock()
	}
	defer func() { watchdogStart = oldStart }()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := Connect(ctx, dsn, Options{ReplicaDSN: dsn})
	require.NoError(t, err)
	t.Cleanup(db.Close)

	rp := db.replica.Load()
	require.NotNil(t, rp, "同 DSN 副本应拨号成功")
	mu.Lock()
	defer mu.Unlock()
	require.Len(t, watched, 2, "主/副本两池都必须挂看门狗（PG4 对齐）")
	require.Contains(t, watched, db.Pool(), "主池看门狗（既有行为）")
	require.Contains(t, watched, rp, "副本池看门狗（PG4 新增）")
}

func TestIsConnectTransient(t *testing.T) {
	pool, err := pgxpool.New(context.Background(), "postgres://no-host-invalid.example:5/sql")
	if err == nil {
		pool.Close()
	}

	if isConnectTransient(errors.New("forced")) {
		t.Fatal("non-connection errors should not be retried")
	}
}

func TestPG_BreakerMatrix(t *testing.T) {
	newBreakerWithClock := func() (*breaker, *time.Time) {
		base := time.Unix(1780000000, 0)
		now := base
		b := &breaker{openFor: 2 * time.Second, now: func() time.Time { return now }}
		return b, &now
	}

	t.Run("initial closed passes the copy", func(t *testing.T) {
		b, _ := newBreakerWithClock()
		assert.True(t, b.Allow())
	})

	t.Run("connection error → breaker open, straight to primary within the window", func(t *testing.T) {
		b, now := newBreakerWithClock()
		b.Trip()
		assert.False(t, b.Allow(), "replicas untouched while the breaker is open")

		*now = now.Add(1999 * time.Millisecond)
		assert.False(t, b.Allow(), "within the window (<2s) still open")
	})

	t.Run("half-open probe after the window", func(t *testing.T) {
		b, now := newBreakerWithClock()
		b.Trip()
		*now = now.Add(2 * time.Second)
		assert.True(t, b.Allow(), "probes allowed from the window deadline on")
	})

	t.Run("half-open probe success → close again", func(t *testing.T) {
		b, now := newBreakerWithClock()
		b.Trip()
		*now = now.Add(2 * time.Second)
		require.True(t, b.Allow())
		b.OnSuccess()
		assert.True(t, b.Allow(), "keeps passing after closing")

		b.Trip()
		assert.False(t, b.Allow())
	})

	t.Run("half-open probe failure → reopen", func(t *testing.T) {
		b, now := newBreakerWithClock()
		b.Trip()
		*now = now.Add(2 * time.Second)
		require.True(t, b.Allow())
		b.Trip()
		assert.False(t, b.Allow())
		*now = now.Add(4 * time.Second)
		assert.True(t, b.Allow(), "half-opens again after the reopen window")
	})

	t.Run("half-open holds a single probe slot until it resolves", func(t *testing.T) {
		b, now := newBreakerWithClock()
		b.Trip()
		*now = now.Add(2 * time.Second)
		require.True(t, b.Allow(), "first caller becomes the probe")
		assert.False(t, b.Allow(), "reservation held: others rejected (gobreaker maxRequests=1 semantics)")
		assert.False(t, b.Allow())
		b.release()
		assert.True(t, b.Allow(), "after release the next caller can probe")
		assert.False(t, b.Allow())
	})

	t.Run("closed state passes all callers without reservation", func(t *testing.T) {
		b, _ := newBreakerWithClock()
		assert.True(t, b.Allow())
		assert.True(t, b.Allow())
		assert.True(t, b.Allow())
	})
}

func TestPG_ReadFallsBackWhenReplicaErrors(t *testing.T) {
	db := testDB(t)

	bad, err := pgxpool.New(context.Background(),
		"postgres://no-host-invalid.example:5/sql?sslmode=disable&connect_timeout=1")
	require.NoError(t, err)
	t.Cleanup(bad.Close)
	db.replica.Store(bad)

	ctx := context.Background()
	var v int
	err = db.Read(ctx, func(ctx context.Context, q DBTX) error {
		return q.QueryRow(ctx, `SELECT 1`).Scan(&v)
	})
	require.NoError(t, err, "replica failure should degrade to primary success in the same call")
	require.Equal(t, 1, v)

	require.False(t, db.breaker.Allow(), "circuit breaker should be open after replica connection errors")
	v = 0
	err = db.Read(ctx, func(ctx context.Context, q DBTX) error {
		return q.QueryRow(ctx, `SELECT 2`).Scan(&v)
	})
	require.NoError(t, err, "goes straight to primary while the breaker is open")
	require.Equal(t, 2, v)
}

func TestPG_ReplicaFailureLoggedAndPrimaryOnly_PG1(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	sink := &logSink{}
	oldDefault := slog.Default()
	slog.SetDefault(slog.New(sink))
	defer slog.SetDefault(oldDefault)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := Connect(ctx, dsn, Options{
		ReplicaDSN:     "postgres://127.0.0.1:1/none?sslmode=disable&connect_timeout=1",
		StartupTimeout: 4 * time.Second,
	})
	require.NoError(t, err, "副本拨号失败不得阻断主库启动")
	t.Cleanup(db.Close)

	require.True(t, sink.contains("pg: replica connect failed, running primary-only"),
		"PG1：副本失败必须有 Error 日志，got %v", sink.snapshot())

	var v int
	require.NoError(t, db.Read(ctx, func(ctx context.Context, q DBTX) error {
		return q.QueryRow(ctx, `SELECT 1`).Scan(&v)
	}))
	require.Equal(t, 1, v, "replica 尚未重试成功 → Read 直走主库")
	require.Nil(t, db.replica.Load())
}

func TestPG_DialSelfTimeoutStillCounts_PG2(t *testing.T) {
	pool, err := pgxpool.New(context.Background(),
		"postgres://pk:pk@10.255.255.1:5432/pk?sslmode=disable&connect_timeout=1")
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	err = pool.Ping(context.Background())
	require.Error(t, err)
	require.True(t, isConnectTransient(err), "自建拨号窗超时必须计故障: %v", err)
}
