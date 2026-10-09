package pgrepo

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/analytics/app"
)

func anBoundLit(m time.Time) string { return "'" + m.UTC().Format("2006-01-02T15:04:05+00:00") + "'" }

func TestQueries_AcrossPartitions(t *testing.T) {
	repo, pool, closeDB := anTestDB(t)

	defer closeDB()
	ctx := context.Background()

	now := time.Now().UTC()
	cur := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	prev := cur.AddDate(0, -1, 0)

	prevPart := fmt.Sprintf("analytics_event_%s", prev.Format("2006_01"))
	var attached bool
	require.NoError(t, pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM pg_inherits i
		JOIN pg_class c ON c.oid = i.inhrelid
		WHERE i.inhparent = 'analytics_event'::regclass AND c.relname = $1)`, prevPart).Scan(&attached))
	createdHere := !attached
	if createdHere {
		_, err := pool.Exec(ctx, fmt.Sprintf(
			`CREATE TABLE IF NOT EXISTS %s PARTITION OF analytics_event FOR VALUES FROM (%s) TO (%s)`,
			prevPart, anBoundLit(prev), anBoundLit(cur)))
		require.NoError(t, err)
	}

	typ := anType("an_part")
	ws := uuid.NewString()
	other := uuid.NewString()
	prevAt1 := prev.AddDate(0, 0, 3)
	prevAt2 := prev.AddDate(0, 0, 7)
	curAt := cur.AddDate(0, 0, 2)
	defer func() {
		cctx := context.Background()
		_, _ = pool.Exec(cctx, `DELETE FROM analytics_event WHERE event_type = $1`, typ)
		if createdHere {
			_, _ = pool.Exec(cctx, fmt.Sprintf(`ALTER TABLE analytics_event DETACH PARTITION %s`, prevPart))
			_, _ = pool.Exec(cctx, fmt.Sprintf(`DROP TABLE %s`, prevPart))
		}
	}()

	repo.Track(ctx, app.Event{Type: typ, WorkspaceID: ws, EntityType: "post"}, prevAt1)
	repo.Track(ctx, app.Event{Type: typ, WorkspaceID: ws, EntityType: "task"}, prevAt2)
	repo.Track(ctx, app.Event{Type: typ, WorkspaceID: other, EntityType: "post"}, curAt)

	rows, err := repo.RecentByType(ctx, typ, 10)
	require.NoError(t, err)
	require.Len(t, rows, 3, "三口径之一：RecentByType 应跨分区读全")
	assert.True(t, rows[0].CreatedAt.Equal(curAt), "最新行（当前月分区）应排首位")
	assert.True(t, rows[1].CreatedAt.After(rows[2].CreatedAt), "上月两行降序")
	assert.True(t, rows[2].CreatedAt.Before(cur), "最早行落在上月分区（跨分区证据）")

	n, err := repo.CountByType(ctx, typ, prev)
	require.NoError(t, err)
	assert.Equal(t, 3, n, "三口径之二：CountByType 跨分区计数")

	n, err = repo.CountByType(ctx, typ, cur)
	require.NoError(t, err)
	assert.Equal(t, 1, n, "分区裁剪：since=当前月初只计当前分区")

	n, err = repo.CountByTypeInWorkspace(ctx, ws, typ, prev)
	require.NoError(t, err)
	assert.Equal(t, 2, n, "三口径之三：工作区内计数")
	n, err = repo.CountByTypeInWorkspace(ctx, other, typ, prev)
	require.NoError(t, err)
	assert.Equal(t, 1, n)

	conn, err := pool.Acquire(ctx)
	require.NoError(t, err)
	defer func() {
		_, _ = conn.Exec(context.Background(), `SET enable_seqscan = on`)
		conn.Release()
	}()
	_, err = conn.Exec(ctx, `SET enable_seqscan = off`)
	require.NoError(t, err)
	erows, err := conn.Query(ctx, "EXPLAIN (COSTS OFF) "+
		`SELECT count(*) FROM analytics_event WHERE event_type = $1 AND created_at >= $2`, typ, prev)
	require.NoError(t, err)
	defer erows.Close()
	var plan strings.Builder
	for erows.Next() {
		var line string
		require.NoError(t, erows.Scan(&line))
		plan.WriteString(line + "\n")
	}
	require.NoError(t, erows.Err())
	assert.Contains(t, plan.String(), "Index", "CountByType 应可走分区本地索引")
	assert.NotContains(t, plan.String(), "Seq Scan", "关 seqscan 后不得退化全分区乱扫")
}

func TestRecent_AcrossPartitions_WithWindow(t *testing.T) {
	repo, pool, closeDB := anTestDB(t)
	defer closeDB()
	ctx := context.Background()

	now := time.Now().UTC()
	cur := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	prev := cur.AddDate(0, -1, 0)

	prevPart := fmt.Sprintf("analytics_event_%s", prev.Format("2006_01"))
	var attached bool
	require.NoError(t, pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM pg_inherits i
		JOIN pg_class c ON c.oid = i.inhrelid
		WHERE i.inhparent = 'analytics_event'::regclass AND c.relname = $1)`, prevPart).Scan(&attached))
	createdHere := !attached
	if createdHere {
		_, err := pool.Exec(ctx, fmt.Sprintf(
			`CREATE TABLE IF NOT EXISTS %s PARTITION OF analytics_event FOR VALUES FROM (%s) TO (%s)`,
			prevPart, anBoundLit(prev), anBoundLit(cur)))
		require.NoError(t, err)
	}

	typ := anType("an_recent")
	prevAt := prev.AddDate(0, 0, 10)
	curAt := cur.AddDate(0, 0, 5)
	defer func() {
		cctx := context.Background()
		_, _ = pool.Exec(cctx, `DELETE FROM analytics_event WHERE event_type = $1`, typ)
		if createdHere {
			_, _ = pool.Exec(cctx, fmt.Sprintf(`ALTER TABLE analytics_event DETACH PARTITION %s`, prevPart))
			_, _ = pool.Exec(cctx, fmt.Sprintf(`DROP TABLE %s`, prevPart))
		}
	}()

	repo.Track(ctx, app.Event{Type: typ}, prevAt)
	repo.Track(ctx, app.Event{Type: typ}, curAt)

	rows, err := repo.Recent(ctx, prev.AddDate(0, 0, 1), 10)
	require.NoError(t, err)
	require.Len(t, rows, 2, "P2-17：窗口覆盖上月时跨分区读全")
	assert.True(t, rows[0].CreatedAt.Equal(curAt), "当前月行应排首位")
	assert.True(t, rows[1].CreatedAt.Equal(prevAt), "上月行在次位（跨分区证据）")

	rows, err = repo.Recent(ctx, cur, 10)
	require.NoError(t, err)
	require.Len(t, rows, 1, "P2-17：时间窗谓词裁剪上月分区")
	assert.True(t, rows[0].CreatedAt.Equal(curAt))

	rows, err = repo.Recent(ctx, now.Add(time.Hour), 10)
	require.NoError(t, err)
	assert.Empty(t, rows)
}
