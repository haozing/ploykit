package workers

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/pgpart"
)

func unreachablePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool, err := pgxpool.New(context.Background(),
		"postgres://nouser@127.0.0.1:1/nowhere?sslmode=disable&connect_timeout=2")
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	return pool
}

func TestRetentionWorker_RoundFailsOnUnreachableDB_P3_28(t *testing.T) {
	w := &RetentionWorker{Table: &pgpart.Table{Pool: unreachablePool(t), Parent: "audit_event"}}
	err := w.round(context.Background(), time.Now().UTC())
	require.Error(t, err, "不可达 DB 必须报错而非静默成功")
}

func TestRetentionWorker_RunRetriesOnFailureAndStopsOnCancel_P3_28(t *testing.T) {
	w := &RetentionWorker{
		Table: &pgpart.Table{Pool: unreachablePool(t), Parent: "audit_event"},
		Every: 5 * time.Millisecond,
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- w.Run(ctx) }()

	time.Sleep(30 * time.Millisecond)
	select {
	case err := <-done:
		t.Fatalf("round 失败不得退出循环，但 Run 已返回: %v", err)
	default:
	}
	cancel()
	select {
	case err := <-done:
		assert.NoError(t, err, "ctx 取消后 Run 返回 nil")
	case <-time.After(3 * time.Second):
		t.Fatal("Run 未随 ctx 取消退出")
	}
}
