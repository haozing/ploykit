package pgpart

import (
	"context"
	"os"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/pg"
)

func TestMonthStartUTC(t *testing.T) {

	in := time.Date(2026, 11, 1, 2, 30, 0, 0, time.FixedZone("CST", 8*3600))
	got := MonthStart(in)
	assert.Equal(t, time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC), got,
		"2026-11-01 02:30+08 = 2026-10-31 18:30Z，应归 2026-10 月")
}

func TestPartitionNameRoundTrip(t *testing.T) {
	parent := "audit_event"
	for _, m := range []time.Time{
		time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC),
		time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC),
		time.Date(2099, 12, 1, 0, 0, 0, 0, time.UTC),
	} {
		name := partitionName(parent, m)
		back, ok := parsePartitionMonth(parent, name)
		assert.True(t, ok)
		assert.Equal(t, m, back, "命名契约应无损往返: %s", name)
	}

	for _, bad := range []string{"audit_event_old035", "audit_event_2026_1", "other_2026_10"} {
		_, ok := parsePartitionMonth(parent, bad)
		assert.False(t, ok, "非契约名 %s 不应被识别", bad)
	}
}

func TestRetentionDefault(t *testing.T) {
	assert.Equal(t, DefaultRetentionMonths, (&Table{RetentionMonths: 0}).retention(),
		"env 未写（0 值）回落缺省 12（ADR 0009）")
	assert.Equal(t, 3, (&Table{RetentionMonths: 3}).retention())
}

func partTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	ctx := context.Background()
	db, err := pg.Connect(ctx, dsn, pg.Options{})
	require.NoError(t, err)
	t.Cleanup(db.Close)
	pool := db.Pool()
	_, err = pool.Exec(ctx, `DROP TABLE IF EXISTS pgpart_test_tbl CASCADE`)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `
		CREATE TABLE pgpart_test_tbl (
			k          int NOT NULL,
			created_at timestamptz NOT NULL,
			PRIMARY KEY (k, created_at)
		) PARTITION BY RANGE (created_at)`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DROP TABLE IF EXISTS pgpart_test_tbl CASCADE`)
	})
	return pool
}

func attachedNames(t *testing.T, pool *pgxpool.Pool) []string {
	t.Helper()
	rows, err := pool.Query(context.Background(), `
		SELECT c.relname FROM pg_inherits i
		JOIN pg_class c ON c.oid = i.inhrelid
		WHERE i.inhparent = 'pgpart_test_tbl'::regclass ORDER BY c.relname`)
	require.NoError(t, err)
	defer rows.Close()
	var out []string
	for rows.Next() {
		var n string
		require.NoError(t, rows.Scan(&n))
		out = append(out, n)
	}
	require.NoError(t, rows.Err())
	return out
}

func day(y int, m time.Month, d int) time.Time {
	return time.Date(y, m, d, 10, 0, 0, 0, time.UTC)
}

func TestEnsureForward_Idempotent(t *testing.T) {
	pool := partTestDB(t)
	ctx := context.Background()
	tbl := &Table{Pool: pool, Parent: "pgpart_test_tbl", RetentionMonths: 12}

	created, err := tbl.EnsureForward(ctx, day(2020, 9, 15))
	require.NoError(t, err)
	assert.Equal(t,
		[]string{"pgpart_test_tbl_2020_09", "pgpart_test_tbl_2020_10", "pgpart_test_tbl_2020_11"},
		created, "应预建当前月+未来 2 月（ADR 0009 worker 义务）")

	created, err = tbl.EnsureForward(ctx, day(2020, 9, 20))
	require.NoError(t, err)
	assert.Empty(t, created, "同月重复轮应零新建（attached 检查短路）")
	assert.Len(t, attachedNames(t, pool), 3)
}

func TestDropExpired_RetentionWindow(t *testing.T) {
	pool := partTestDB(t)
	ctx := context.Background()
	tbl := &Table{Pool: pool, Parent: "pgpart_test_tbl", RetentionMonths: 12}
	_, err := tbl.EnsureForward(ctx, day(2020, 9, 15))
	require.NoError(t, err)

	dropped, err := tbl.DropExpired(ctx, day(2021, 9, 15))
	require.NoError(t, err)
	assert.Equal(t, []string{"pgpart_test_tbl_2020_09"}, dropped)
	assert.Equal(t, []string{"pgpart_test_tbl_2020_10", "pgpart_test_tbl_2020_11"}, attachedNames(t, pool))

	dropped, err = tbl.DropExpired(ctx, day(2021, 10, 15))
	require.NoError(t, err)
	assert.Equal(t, []string{"pgpart_test_tbl_2020_10"}, dropped)
	assert.Equal(t, []string{"pgpart_test_tbl_2020_11"}, attachedNames(t, pool))

	_, err = pool.Exec(ctx, `INSERT INTO pgpart_test_tbl (k, created_at) VALUES (1, $1)`, day(2020, 11, 5))
	require.NoError(t, err, "清理后母表写入应路由到存活分区")
	var n int
	require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM pgpart_test_tbl`).Scan(&n))
	assert.Equal(t, 1, n)
}

func TestMaintain_AdvisoryLockSkips(t *testing.T) {
	pool := partTestDB(t)
	ctx := context.Background()

	conn, err := pool.Acquire(ctx)
	require.NoError(t, err)
	defer conn.Release()
	var locked bool
	require.NoError(t, conn.QueryRow(ctx,
		`SELECT pg_try_advisory_lock(hashtext($1))`, "ploykit_pgpart:pgpart_test_tbl").Scan(&locked))
	require.True(t, locked)
	defer func() {
		_, _ = conn.Exec(context.Background(),
			`SELECT pg_advisory_unlock(hashtext($1))`, "ploykit_pgpart:pgpart_test_tbl")
	}()

	tbl := &Table{Pool: pool, Parent: "pgpart_test_tbl", RetentionMonths: 12}
	r, err := tbl.Maintain(ctx, day(2020, 9, 15))
	require.NoError(t, err)
	assert.True(t, r.Skipped, "锁被占时应让位而非排队/报错")
	assert.Empty(t, r.Created)
	assert.Empty(t, attachedNames(t, pool), "让位轮不得建任何分区")
}

func TestMaintain_NonContractPartitionUntouched(t *testing.T) {
	pool := partTestDB(t)
	ctx := context.Background()
	tbl := &Table{Pool: pool, Parent: "pgpart_test_tbl", RetentionMonths: 12}

	_, err := pool.Exec(ctx, `
		CREATE TABLE pgpart_test_tbl_legacy PARTITION OF pgpart_test_tbl
		FOR VALUES FROM ('2020-05-01T00:00:00+00') TO ('2020-06-01T00:00:00+00')`)
	require.NoError(t, err)

	_, err = tbl.Maintain(ctx, day(2020, 9, 15))
	require.NoError(t, err)

	r, err := tbl.Maintain(ctx, day(2021, 10, 15))
	require.NoError(t, err)
	assert.Equal(t, []string{"pgpart_test_tbl_2020_09", "pgpart_test_tbl_2020_10"}, r.Dropped)
	names := attachedNames(t, pool)
	assert.True(t, slices.Contains(names, "pgpart_test_tbl_legacy"),
		"非契约命名分区不应被滚动清理触及")
	assert.True(t, slices.Contains(names, "pgpart_test_tbl_2020_11"), "窗口内契约分区留存")
}

func TestMaintain_LockReleasedAfterReturn(t *testing.T) {
	pool := partTestDB(t)
	ctx := context.Background()
	tbl := &Table{Pool: pool, Parent: "pgpart_test_tbl", RetentionMonths: 12}

	_, err := tbl.Maintain(ctx, day(2020, 9, 15))
	require.NoError(t, err, "首轮维护成功（正常拿锁）")

	conn, err := pool.Acquire(ctx)
	require.NoError(t, err)
	defer conn.Release()
	var locked bool
	require.NoError(t, conn.QueryRow(ctx,
		`SELECT pg_try_advisory_lock(hashtext($1))`, "ploykit_pgpart:pgpart_test_tbl").Scan(&locked))
	require.True(t, locked, "Maintain 返回后锁必须已释放（否则后续轮永久 Skipped）")
	_, _ = conn.Exec(ctx, `SELECT pg_advisory_unlock(hashtext($1))`, "ploykit_pgpart:pgpart_test_tbl")

	r, err := tbl.Maintain(ctx, day(2020, 9, 20))
	require.NoError(t, err)
	assert.False(t, r.Skipped, "外部会话已解锁，第二轮应正常维护")
	assert.Empty(t, r.Created, "同月重复轮零新建")
}

func TestEnsureForward_DetachedResidualSkipsCreate(t *testing.T) {
	pool := partTestDB(t)
	ctx := context.Background()
	tbl := &Table{Pool: pool, Parent: "pgpart_test_tbl", RetentionMonths: 12}

	_, err := pool.Exec(ctx, `CREATE TABLE pgpart_test_tbl_2020_09 (k int)`)
	require.NoError(t, err)

	created, err := tbl.EnsureForward(ctx, day(2020, 9, 15))
	require.NoError(t, err, "残留导致跳过建表不是错误（降级可观测）")
	assert.NotContains(t, created, "pgpart_test_tbl_2020_09",
		"未真正挂上母表的月份不得虚报进 created（P3-34）")
	assert.Equal(t, []string{"pgpart_test_tbl_2020_10", "pgpart_test_tbl_2020_11"}, created,
		"其余月份正常预建")

	_, err = pool.Exec(ctx, `INSERT INTO pgpart_test_tbl (k, created_at) VALUES (1, $1)`, day(2020, 9, 20))
	require.Error(t, err, "残留月份缺分区，写入必须失败（可观测降级）")
}
