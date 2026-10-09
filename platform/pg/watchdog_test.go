package pg

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := Connect(ctx, dsn, Options{})
	require.NoError(t, err)
	t.Cleanup(db.Close)
	return db.Pool()
}

func TestProbeDB_HealthyPool(t *testing.T) {
	pool := testPool(t)
	require.NoError(t, probeDB(pool))
}

func TestWatchdog_DetectsWedgeWhenAllConnsAcquired(t *testing.T) {
	pool := testPool(t)
	require.NoError(t, probeDB(pool))

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	max := int(pool.Stat().MaxConns())
	held := make([]*pgxpool.Conn, 0, max)
	for len(held) < max {
		c, err := pool.Acquire(ctx)
		require.NoError(t, err)
		held = append(held, c)
	}

	pingCtx, pingCancel := probeCtx()
	defer pingCancel()
	require.Error(t, pool.Ping(pingCtx), "全池被借出时 Ping 应超时失败（楔死特征）")
	require.NoError(t, probeDB(pool), "DB 本身仍可达（独立探测绕过池）")

	for _, c := range held {
		c.Release()
	}
	okCtx, okCancel := probeCtx()
	defer okCancel()
	require.NoError(t, pool.Ping(okCtx), "连接归还后池应恢复")
}

func TestProbeDB_Unreachable(t *testing.T) {
	pool, err := pgxpool.New(context.Background(), "postgres://127.0.0.1:1/db?sslmode=disable&connect_timeout=1")
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	require.Error(t, probeDB(pool))
}
