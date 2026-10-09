package pgm

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/ids"
)

func scratchDSN(t *testing.T) string {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test（带库跑法：make -C example db-up && make test-db）")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	admin, err := pgxpool.New(ctx, dsn)
	require.NoError(t, err)
	scratch := "pgm_it_" + ids.NewV4().String()[:8]
	_, err = admin.Exec(ctx, "CREATE DATABASE "+scratch)
	require.NoError(t, err, "scratch db (needs CREATEDB privilege; dev compose user pk 是 superuser)")
	u, err := url.Parse(dsn)
	require.NoError(t, err)
	u.Path = "/" + scratch
	t.Cleanup(func() {
		dropCtx, dropCancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer dropCancel()
		_, _ = admin.Exec(dropCtx, fmt.Sprintf("DROP DATABASE %s WITH (FORCE)", scratch))
		admin.Close()
	})
	return u.String()
}

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool, err := pgxpool.New(context.Background(), scratchDSN(t))
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	return pool
}

func tableExists(t *testing.T, pool *pgxpool.Pool, name string) bool {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var reg *string
	require.NoError(t, pool.QueryRow(ctx, `SELECT to_regclass($1)`, fmt.Sprintf("public.%s", name)).Scan(&reg))
	return reg != nil
}

func TestUpDownNumericOrderLegacyDeleteAndFullRollback(t *testing.T) {
	pool := testPool(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	m := New(pool, testFS, "testdata")

	appliedList, err := m.Up(ctx, 0)
	require.NoError(t, err)

	assert.Equal(t, []string{"002", "500", "999", "1001"}, appliedList)

	assert.True(t, tableExists(t, pool, "pgm_probe_users"), "002 建表应生效")

	_, err = pool.Exec(ctx, `UPDATE schema_migrations SET version='002_users' WHERE version='002'`)
	require.NoError(t, err)

	rolled, err := m.Down(ctx, -1)
	require.NoError(t, err)
	assert.Equal(t, []string{"1001", "999", "500", "002"}, rolled, "回滚按数值从新到旧")

	var n int
	require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM schema_migrations`).Scan(&n))
	assert.Zero(t, n, "全量回滚后记账表应为空（含 legacy 完整名行）")
	assert.False(t, tableExists(t, pool, "pgm_probe_users"), "探针表应随 002 回滚消失")

	_, err = m.Down(ctx, 0)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "拒绝执行")
}

func TestStatusReportsOrphans(t *testing.T) {
	pool := testPool(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	m := New(pool, testFS, "testdata")

	_, err := m.Up(ctx, 0)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `INSERT INTO schema_migrations(version) VALUES ('777_ghost')`)
	require.NoError(t, err)

	rows, err := m.Status(ctx)
	require.NoError(t, err)
	var orphanSeen, applied002 bool
	for _, r := range rows {
		if r.Orphan {
			orphanSeen = true
			assert.Equal(t, "777", r.Version, "孤儿行以归一化版本报出")
			assert.True(t, r.Applied)
			require.NotNil(t, r.AppliedAt)
		}
		if r.Version == "002" {
			applied002 = true
			assert.True(t, r.Applied)
			assert.False(t, r.Orphan)
		}
	}
	assert.True(t, orphanSeen, "Status 必须报出孤儿版本（对账最关键的漂移场景）")
	assert.True(t, applied002)

	_, err = m.Down(ctx, -1)
	require.NoError(t, err)
}

func TestMaxConns1NoSelfLock(t *testing.T) {
	dsn := scratchDSN(t)
	sep := "&"
	if !containsByte(dsn, '?') {
		sep = "?"
	}
	pool, err := pgxpool.New(context.Background(), dsn+sep+"pool_max_conns=1")
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	require.Equal(t, int32(1), pool.Stat().MaxConns())

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, err := New(pool, testFS, "testdata").Up(ctx, 0)
		done <- err
	}()
	select {
	case err := <-done:
		require.NoError(t, err, "MaxConns=1 下迁移不得自锁")
	case <-time.After(45 * time.Second):
		t.Fatal("MaxConns=1 下迁移疑似自锁（锁连接未被复用）")
	}

	_, err = New(pool, testFS, "testdata").Down(ctx, -1)
	require.NoError(t, err)
}

func containsByte(s string, b byte) bool {
	for i := 0; i < len(s); i++ {
		if s[i] == b {
			return true
		}
	}
	return false
}
