package pg

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestPG_ResetAndPing_UTPG05(t *testing.T) {
	db := testDB(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	require.NoError(t, db.Ping(ctx), "初始 Ping 应成功")

	conn, err := db.Acquire(ctx)
	require.NoError(t, err)
	var one int
	require.NoError(t, conn.QueryRow(ctx, `SELECT 1`).Scan(&one))
	require.Equal(t, 1, one)
	conn.Release()

	db.Reset()
	require.NoError(t, db.Ping(ctx), "Reset 后 Ping 应自愈")

	var two int
	require.NoError(t, db.Tx(ctx).QueryRow(ctx, `SELECT 2`).Scan(&two))
	require.Equal(t, 2, two)
}

func TestPG_WrapPool_UTPG06(t *testing.T) {
	base := testDB(t)
	wrapped := WrapPool(base.Pool())
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	require.NoError(t, wrapped.Ping(ctx))
	var v int
	require.NoError(t, wrapped.Within(ctx, func(ctx context.Context) error {
		return wrapped.Tx(ctx).QueryRow(ctx, `SELECT 3`).Scan(&v)
	}))
	require.Equal(t, 3, v)
	require.NoError(t, wrapped.Read(ctx, func(ctx context.Context, q DBTX) error {
		return q.QueryRow(ctx, `SELECT 4`).Scan(&v)
	}))
	require.Equal(t, 4, v)
}
