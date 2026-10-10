package pgrepo

import (
	"bytes"
	"context"
	"encoding/csv"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/audit"
	"github.com/haozing/ploykit/migrations"
	"github.com/haozing/ploykit/platform/pg"
	"github.com/haozing/ploykit/platform/pgmigrate"
)

func boundLit(m time.Time) string { return "'" + m.UTC().Format("2006-01-02T15:04:05+00:00") + "'" }

func TestExportAuditCSV_AcrossPartitions(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	ctx := context.Background()
	db, err := pg.Connect(ctx, dsn, pg.Options{})
	require.NoError(t, err)
	t.Cleanup(db.Close)
	pool := db.Pool()
	require.NoError(t, pgmigrate.Up(ctx, pool, migrations.FS, "."))
	repo := New(pool)

	now := time.Now().UTC()
	cur := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	months := []time.Time{cur.AddDate(0, -2, 0), cur.AddDate(0, -1, 0), cur}

	createdParts := map[string]bool{}
	actor := uuid.NewString()
	t.Cleanup(func() {
		cctx := context.Background()
		_, _ = pool.Exec(cctx, `DELETE FROM audit_event WHERE actor_id = $1 AND action = 'ad4.part'`, actor)
		for name := range createdParts {
			_, _ = pool.Exec(cctx, fmt.Sprintf(`ALTER TABLE audit_event DETACH PARTITION %s`, name))
			_, _ = pool.Exec(cctx, fmt.Sprintf(`DROP TABLE %s`, name))
		}
	})
	var wantTS []time.Time
	for mi, m := range months {
		part := fmt.Sprintf("audit_event_%s", m.Format("2006_01"))
		var attached bool
		require.NoError(t, pool.QueryRow(ctx, `
			SELECT EXISTS (SELECT 1 FROM pg_inherits i
			JOIN pg_class c ON c.oid = i.inhrelid
			WHERE i.inhparent = 'audit_event'::regclass AND c.relname = $1)`, part).Scan(&attached))
		if !attached {
			_, err := pool.Exec(ctx, fmt.Sprintf(
				`CREATE TABLE IF NOT EXISTS %s PARTITION OF audit_event FOR VALUES FROM (%s) TO (%s)`,
				part, boundLit(m), boundLit(m.AddDate(0, 1, 0))))
			require.NoError(t, err, "自建旧月分区 %s", part)
			createdParts[part] = true
		}
		for d := 1; d <= 3; d++ {
			at := m.AddDate(0, 0, d).Add(time.Duration(mi) * time.Hour)
			_, err := pool.Exec(ctx, `
				INSERT INTO audit_event (id, actor_type, actor_id, action, resource_type, created_at)
				VALUES ($1, 'user', $2, 'ad4.part', 'test', $3)`,
				uuid.NewString(), actor, at)
			require.NoError(t, err, "灌入应路由到 %s", part)
			wantTS = append(wantTS, at)
		}
	}

	var buf bytes.Buffer
	trunc, err := repo.ExportAuditCSV(ctx, audit.ListQuery{ActorID: actor}, nil, 9, &buf)
	require.NoError(t, err)
	assert.False(t, trunc, "9 行全量导出不应截断")
	recs, err := csv.NewReader(&buf).ReadAll()
	require.NoError(t, err)
	require.Len(t, recs, 10, "表头 + 9 行")
	assert.Equal(t, "created_at", recs[0][0], "列头契约锁死")
	got := map[string]bool{}
	for i, r := range recs[1:] {
		ts, err := time.Parse(time.RFC3339Nano, r[0])
		require.NoError(t, err)
		assert.False(t, got[r[0]], "第 %d 行时间戳重复（keyset 跨页不得重复）", i+1)
		got[r[0]] = true
		if i > 0 {
			prev, _ := time.Parse(time.RFC3339Nano, recs[i][0])
			assert.True(t, prev.After(ts), "created_at 必须严格递减（跨分区序同向，AD4）")
		}
	}
	assert.Len(t, got, 9)
	wantSet := map[string]bool{}
	for _, ts := range wantTS {
		wantSet[ts.UTC().Format(time.RFC3339Nano)] = true
	}
	assert.Equal(t, wantSet, got, "导出时间戳集合与灌入一致（不重不漏）")

	minTS, maxTS := wantTS[0], wantTS[0]
	for _, ts := range wantTS[1:] {
		if ts.Before(minTS) {
			minTS = ts
		}
		if ts.After(maxTS) {
			maxTS = ts
		}
	}
	assert.True(t, minTS.Before(cur.AddDate(0, -1, 0)), "含最早分区（当前月-2）数据")
	assert.True(t, maxTS.After(cur.AddDate(0, 0, 1)), "含当前月分区数据")

	buf.Reset()
	trunc, err = repo.ExportAuditCSV(ctx, audit.ListQuery{ActorID: actor}, nil, 5, &buf)
	require.NoError(t, err)
	assert.True(t, trunc, "5/9 行应报告截断（X-Export-Truncated 语义）")

	conn, err := pool.Acquire(ctx)
	require.NoError(t, err)
	defer func() {
		_, _ = conn.Exec(context.Background(), `SET enable_seqscan = on`)
		conn.Release()
	}()
	_, err = conn.Exec(ctx, `SET enable_seqscan = off`)
	require.NoError(t, err)
	rows, err := conn.Query(ctx, "EXPLAIN (COSTS OFF) "+
		`SELECT created_at, id FROM audit_event
		 WHERE actor_id = $1 AND (created_at, id) < ($2, $3::uuid)
		 ORDER BY created_at DESC, id DESC LIMIT 500`,
		actor, maxTS, uuid.NewString())
	require.NoError(t, err)
	defer rows.Close()
	var plan strings.Builder
	for rows.Next() {
		var line string
		require.NoError(t, rows.Scan(&line))
		plan.WriteString(line + "\n")
	}
	require.NoError(t, rows.Err())
	assert.Contains(t, plan.String(), "Index Scan", "keyset 页查询应可走分区本地索引")
	assert.Contains(t, plan.String(), "actor_id", "索引应匹配 actor 过滤形态")
	assert.NotContains(t, plan.String(), "Seq Scan", "关 seqscan 后不得退化全分区乱扫")
}
