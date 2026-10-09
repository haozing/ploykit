package pgrepo

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/audit"
	"github.com/haozing/ploykit/platform/webx"
)

func TestQueryAudit(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	var uid string
	email := fmt.Sprintf("adq-%s@test.local", uuid.NewString()[:12])
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO "user" (email, display_name) VALUES ($1, 'admin query test') RETURNING id`, email).Scan(&uid))
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM "user" WHERE id = $1`, uid) })
	var wsID string
	slug := "adq-" + uuid.NewString()[:8]
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO workspace (slug, name, created_by) VALUES ($1, 'Admin Query', $2) RETURNING id`, slug, uid).Scan(&wsID))
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM audit_event WHERE workspace_id = $1`, wsID)
		_, _ = pool.Exec(ctx, `DELETE FROM workspace WHERE id = $1`, wsID)
	})

	rec := audit.NewRecorder(pool, nil)
	ws := &wsID
	rec.Record(ctx, ws, &webx.Principal{UserID: uid, Email: email, Source: webx.SourceSession, WorkspaceID: wsID, Role: "owner"},
		"task.created", "task", "t-1", map[string]any{"k": "v"})
	rec.Record(ctx, ws, nil, "workspace.provisioned", "workspace", wsID, nil)

	repo := New(pool)

	entries, total, err := repo.QueryAudit(ctx, audit.ListQuery{WorkspaceID: wsID, Action: "task.created"})
	require.NoError(t, err)
	assert.Equal(t, 1, total)
	require.Len(t, entries, 1)
	e := entries[0]
	assert.NotEmpty(t, e.ID)
	assert.Equal(t, wsID, e.WorkspaceID)
	assert.Equal(t, "user", e.ActorType)
	assert.Equal(t, uid, e.ActorID)
	assert.Equal(t, email, e.ActorSnapshot["email"])
	assert.Equal(t, "task.created", e.Action)
	assert.Equal(t, "task", e.ResourceType)
	assert.Equal(t, "t-1", e.ResourceID)
	assert.Equal(t, "v", e.Metadata["k"])
	assert.WithinDuration(t, time.Now(), e.CreatedAt, time.Minute)

	_, total, err = repo.QueryAudit(ctx, audit.ListQuery{WorkspaceID: wsID})
	require.NoError(t, err)
	assert.Equal(t, 2, total)
}

func TestListUserWorkspacesAndAllActiveUserIDs(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	var uid string
	email := fmt.Sprintf("adw-%s@test.local", uuid.NewString()[:12])
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO "user" (email, display_name) VALUES ($1, 'bridge sink test') RETURNING id`, email).Scan(&uid))
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM "user" WHERE id = $1`, uid) })
	var wsID string
	slug := "adw-" + uuid.NewString()[:8]
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO workspace (slug, name, created_by) VALUES ($1, 'Bridge Sink', $2) RETURNING id`, slug, uid).Scan(&wsID))
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM workspace WHERE id = $1`, wsID) })
	_, err = pool.Exec(ctx,
		`INSERT INTO member (workspace_id, user_id, role, created_by) VALUES ($1, $2, 'owner', $2)`, wsID, uid)
	require.NoError(t, err)

	repo := New(pool)

	wss, err := repo.ListUserWorkspaces(ctx, uid)
	require.NoError(t, err)
	require.Len(t, wss, 1)
	assert.Equal(t, wsID, wss[0].ID)
	assert.Equal(t, slug, wss[0].Slug)
	assert.Equal(t, "Bridge Sink", wss[0].Name)
	assert.Equal(t, "owner", wss[0].Role)
	assert.False(t, wss[0].CreatedAt.IsZero())

	ids, err := repo.AllActiveUserIDs(ctx)
	require.NoError(t, err)
	assert.Contains(t, ids, uid)
}
