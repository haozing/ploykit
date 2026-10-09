package pgrepo

import (
	"bytes"
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/audit"
	"github.com/haozing/ploykit/platform/webx"
)

func newAuditExtEnv(t *testing.T) (*pgxpool.Pool, *Repo, string) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	var uid string
	email := fmt.Sprintf("aext-%s@test.local", uuid.NewString()[:12])
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO "user" (email, display_name) VALUES ($1, 'audit ext test') RETURNING id`, email).Scan(&uid))
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM "user" WHERE id = $1`, uid) })
	var wsID string
	slug := "aext-" + uuid.NewString()[:8]
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO workspace (slug, name, created_by) VALUES ($1, 'Audit Ext', $2) RETURNING id`, slug, uid).Scan(&wsID))
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM audit_event WHERE workspace_id = $1`, wsID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM workspace WHERE id = $1`, wsID)
	})
	return pool, New(pool), wsID
}

func insertAuditRows(t *testing.T, pool *pgxpool.Pool, wsID string, n int) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO audit_event (workspace_id, actor_type, action, resource_type, resource_id, metadata, created_at)
		SELECT $1, 'system', 'ad4.row', 'ad4', 'ad4-' || g, '{}', now() - (g * interval '1 second')
		FROM generate_series(1, $2) g`, wsID, n)
	require.NoError(t, err)
}

type pageHookWriter struct {
	w      io.Writer
	fired  bool
	insert func() error
}

func (h *pageHookWriter) Write(p []byte) (int, error) {
	if !h.fired {
		h.fired = true
		if err := h.insert(); err != nil {
			return 0, err
		}
	}
	return h.w.Write(p)
}

func TestExportAuditCSV_KeysetStableUnderInsert_AD4(t *testing.T) {
	pool, repo, wsID := newAuditExtEnv(t)
	ctx := context.Background()
	const seed = 520
	insertAuditRows(t, pool, wsID, seed)

	hook := &pageHookWriter{w: &bytes.Buffer{}, insert: func() error {
		_, err := pool.Exec(ctx, `
			INSERT INTO audit_event (workspace_id, actor_type, action, resource_type, resource_id, metadata)
			VALUES ($1, 'system', 'ad4.row', 'ad4', 'ad4-injected', '{}')`, wsID)
		return err
	}}
	truncated, err := repo.ExportAuditCSV(ctx, audit.ListQuery{WorkspaceID: wsID}, nil, 0, hook)
	require.NoError(t, err)
	assert.False(t, truncated, "520 行远低于上限，不应截断")

	rows, err := csv.NewReader(strings.NewReader(hook.w.(*bytes.Buffer).String())).ReadAll()
	require.NoError(t, err)
	require.Len(t, rows, seed+1, "表头 + 恰好 %d 行（OFFSET 实现会多一行重复）", seed)

	seen := map[string]int{}
	for _, r := range rows[1:] {
		seen[r[6]]++
	}
	for g := 1; g <= seed; g++ {
		assert.Equal(t, 1, seen[fmt.Sprintf("ad4-%d", g)], "ad4-%d 出现 %d 次（应恰好 1）", g, seen[fmt.Sprintf("ad4-%d", g)])
	}
	assert.Zero(t, seen["ad4-injected"], "导出开始后追加的头行按快照语义排除")
}

func TestExportAuditCSV_FormulaInjection_AD3(t *testing.T) {
	pool, repo, wsID := newAuditExtEnv(t)
	ctx := context.Background()

	rec := audit.NewRecorder(pool, nil)
	rec.Record(ctx, &wsID,
		&webx.Principal{UserID: "u-e", Email: `=HYPERLINK("http://evil","x")`, Source: webx.SourceSession},
		"ad3a.payload", "task", `+cmd|'/c calc'!A1`, nil)

	var buf bytes.Buffer
	truncated, err := repo.ExportAuditCSV(ctx, audit.ListQuery{WorkspaceID: wsID, Action: "ad3a.payload"}, nil, 0, &buf)
	require.NoError(t, err)
	assert.False(t, truncated)

	rows, err := csv.NewReader(strings.NewReader(buf.String())).ReadAll()
	require.NoError(t, err)
	require.Len(t, rows, 2, "表头 + 单行")
	assert.Equal(t, `'=HYPERLINK("http://evil","x")`, rows[1][3], "actor_email 危险前缀转义")
	assert.Equal(t, `'+cmd|'/c calc'!A1`, rows[1][6], "resource_id 危险前缀转义")
}

func TestExportAuditCSV_TruncatedProbe_Keyset(t *testing.T) {
	pool, repo, wsID := newAuditExtEnv(t)
	ctx := context.Background()
	insertAuditRows(t, pool, wsID, 30)

	var buf bytes.Buffer
	truncated, err := repo.ExportAuditCSV(ctx, audit.ListQuery{WorkspaceID: wsID}, nil, 10, &buf)
	require.NoError(t, err)
	assert.True(t, truncated, "命中超上限应截断")
	rows, err := csv.NewReader(strings.NewReader(buf.String())).ReadAll()
	require.NoError(t, err)
	require.Len(t, rows, 11, "表头 + 恰好 maxRows 行")

	var buf2 bytes.Buffer
	truncated, err = repo.ExportAuditCSV(ctx, audit.ListQuery{WorkspaceID: wsID}, nil, 30, &buf2)
	require.NoError(t, err)
	assert.False(t, truncated, "命中恰等于上限不截断")
}
