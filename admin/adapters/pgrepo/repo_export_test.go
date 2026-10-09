package pgrepo

import (
	"bytes"
	"context"
	"fmt"
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

func newTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	return pool
}

func seedExportUser(t *testing.T, pool *pgxpool.Pool, email string) (userID string) {
	t.Helper()
	ctx := context.Background()
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO "user" (email, display_name, password_hash, status)
		 VALUES ($1, 'Export Test', '$argon2id$x', 'active') RETURNING id`, email).Scan(&userID))
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM audit_event WHERE actor_id = $1`, userID)
		_, _ = pool.Exec(ctx, `DELETE FROM workspace WHERE created_by = $1`, userID)
		_, _ = pool.Exec(ctx, `DELETE FROM "user" WHERE id = $1`, userID)
	})

	var wsID string
	slug := "exp-" + uuid.NewString()[:8]
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO workspace (slug, name, created_by) VALUES ($1, 'Export WS', $2) RETURNING id`,
		slug, userID).Scan(&wsID))
	_, err := pool.Exec(ctx,
		`INSERT INTO member (workspace_id, user_id, role, created_by) VALUES ($1, $2, 'owner', $2)`, wsID, userID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `
		INSERT INTO session (user_id, token_hash, ip_hash, user_agent, expires_at, absolute_expires_at)
		VALUES ($1, $2, 'iph', 'ua-test', now() + interval '1 day', now() + interval '7 days')`,
		userID, "th-"+userID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `
		INSERT INTO personal_access_token (user_id, name, token_hash, prefix)
		VALUES ($1, 'ci', $2, 'pk_ci')`, userID, "pth-"+userID)
	require.NoError(t, err)
	rec := audit.NewRecorder(pool, nil)
	rec.Record(ctx, &wsID, &webx.Principal{UserID: userID, Email: email, Source: webx.SourceSession},
		"task.created", "task", "t-1", map[string]any{"k": "v"})
	rec.Record(ctx, nil, &webx.Principal{UserID: userID, Email: email, Source: webx.SourceSession},
		"admin.user_kick", "user", userID, nil)
	return userID
}

func TestExportUserdata_Integration(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	repo := New(pool)
	email := fmt.Sprintf("exp-%s@test.local", uuid.NewString()[:12])
	uid := seedExportUser(t, pool, email)

	out, err := repo.ExportUserdata(ctx, uid)
	require.NoError(t, err)

	user := out["user"].(exportUserRow)
	assert.Equal(t, uid, user.ID)
	assert.Equal(t, email, user.Email)
	assert.True(t, user.IsPlatformAdmin == false)
	assert.True(t, user.TokensValidAfter == nil, "'-infinity' 归一为 NULL")

	assert.Len(t, out["memberships"].([]exportMembershipRow), 1)
	assert.Equal(t, "Export WS", out["memberships"].([]exportMembershipRow)[0].Name)
	assert.Len(t, out["sessions"].([]exportSessionRow), 1)
	assert.Equal(t, "ua-test", *out["sessions"].([]exportSessionRow)[0].UserAgent)
	assert.Len(t, out["personal_access_tokens"].([]exportPATRow), 1)
	events := out["audit_events"].([]exportAuditEventRow)
	require.Len(t, events, 2, "该用户 actor_id 命中的 2 条平台+工作区事件")
	assert.Equal(t, "admin.user_kick", events[0].Action, "created_at 倒序")

	_, err = repo.ExportUserdata(ctx, uuid.NewString())
	assert.Error(t, err, "用户行缺失返回错误（锚点语义）")
}

func TestQueryAuditExt_ActorIN(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	repo := New(pool)
	u1Email := fmt.Sprintf("ax1-%s@test.local", uuid.NewString()[:8])
	u1 := seedExportUser(t, pool, u1Email)
	seedExportUser(t, pool, fmt.Sprintf("ax2-%s@test.local", uuid.NewString()[:8]))

	prefix := strings.ToUpper(strings.SplitN(u1Email, "@", 2)[0])
	ids, err := repo.UserIDsByEmailPrefix(ctx, prefix, 50)
	require.NoError(t, err)
	require.Len(t, ids, 1, "邮箱前缀 ilike 命中 1 个账号")
	assert.Equal(t, u1, ids[0])

	entries, total, err := repo.QueryAuditExt(ctx, audit.ListQuery{Action: "task.created"}, ids)
	require.NoError(t, err)
	assert.Equal(t, 1, total, "IN 集合内只有 u1 的 task.created")
	require.Len(t, entries, 1)
	assert.Equal(t, u1, entries[0].ActorID)

	_, total, err = repo.QueryAuditExt(ctx, audit.ListQuery{}, nil)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, total, 2, "nil ids = 不加 actor 条件（全量可见）")
}

func TestExportAuditCSV_PaginationAndTruncation(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	repo := New(pool)
	email := fmt.Sprintf("csv-%s@test.local", uuid.NewString()[:8])
	uid := seedExportUser(t, pool, email)

	t.Run("未超上限：表头 + 行，truncated=false", func(t *testing.T) {
		var buf bytes.Buffer
		trunc, err := repo.ExportAuditCSV(ctx, audit.ListQuery{Action: "task.created"}, nil, 50000, &buf)
		require.NoError(t, err)
		assert.False(t, trunc)
		lines := strings.Split(strings.TrimSpace(buf.String()), "\n")
		require.GreaterOrEqual(t, len(lines), 2, "表头 + 至少 1 行")
		assert.Contains(t, lines[0], "actor_email")
		assert.Contains(t, buf.String(), email)
	})

	t.Run("超上限：maxRows 截断 + truncated=true（写满后探一行判定）", func(t *testing.T) {

		var buf bytes.Buffer
		trunc, err := repo.ExportAuditCSV(ctx, audit.ListQuery{ActorID: uid}, nil, 1, &buf)
		require.NoError(t, err)
		assert.True(t, trunc)
		lines := strings.Split(strings.TrimSpace(buf.String()), "\n")
		assert.Len(t, lines, 2, "表头 + 恰好 1 行（上限截断）")
	})

	t.Run("命中恰等于上限：truncated=false", func(t *testing.T) {
		var buf bytes.Buffer
		trunc, err := repo.ExportAuditCSV(ctx, audit.ListQuery{ActorID: uid}, nil, 2, &buf)
		require.NoError(t, err)
		assert.False(t, trunc, "恰好 2 条 = 未截断")
		lines := strings.Split(strings.TrimSpace(buf.String()), "\n")
		assert.Len(t, lines, 3, "表头 + 2 行")
	})
}
