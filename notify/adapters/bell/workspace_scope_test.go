package pgrepo

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/migrations"
	"github.com/haozing/ploykit/notify/app"
	"github.com/haozing/ploykit/platform/pg"
	"github.com/haozing/ploykit/platform/pgmigrate"
)

// F8: the workspace dimension is real SQL — insert with/without workspace_id,
// then ListInbox/UnreadCount under empty (bell) and scoped filters.
func TestNotification_WorkspaceScope_F8(t *testing.T) {
	dsn := dsn0()
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	ctx := context.Background()
	db, err := pg.Connect(ctx, dsn, pg.Options{})
	require.NoError(t, err)
	defer db.Close()
	require.NoError(t, pgmigrate.Up(ctx, db.Pool(), migrations.FS, "."))

	repo := New(db.Pool())
	uid := seedScopeUser(t, db.Pool())
	wsA, wsB := uuid.NewString(), uuid.NewString()
	for _, w := range []string{wsA, wsB} {
		seedScopeWorkspace(t, db.Pool(), w, uid)
	}

	now := time.Now().UTC().Truncate(time.Second)
	mustInsert(t, repo, app.NotifyInput{UserID: uid, Type: "t", Title: "global", Workspace: ""}, now)
	mustInsert(t, repo, app.NotifyInput{UserID: uid, Type: "t", Title: "in-a", Workspace: wsA}, now)
	mustInsert(t, repo, app.NotifyInput{UserID: uid, Type: "t", Title: "in-a-2", Workspace: wsA}, now)
	mustInsert(t, repo, app.NotifyInput{UserID: uid, Type: "t", Title: "in-b", Workspace: wsB}, now)

	t.Run("空过滤=用户全部收件箱（bell 语义）", func(t *testing.T) {
		list, err := repo.ListInbox(ctx, uid, "", 50)
		require.NoError(t, err)
		assert.Len(t, list, 4)
		n, err := repo.UnreadCount(ctx, uid, "")
		require.NoError(t, err)
		assert.Equal(t, 4, n)
	})

	t.Run("workspace 过滤只含该域通知", func(t *testing.T) {
		list, err := repo.ListInbox(ctx, uid, wsA, 50)
		require.NoError(t, err)
		require.Len(t, list, 2)
		assert.Equal(t, wsA, list[0].Workspace)
		assert.Equal(t, wsA, list[1].Workspace)
		n, err := repo.UnreadCount(ctx, uid, wsA)
		require.NoError(t, err)
		assert.Equal(t, 2, n)
	})

	t.Run("全局通知不属于任何 workspace 过滤", func(t *testing.T) {
		list, err := repo.ListInbox(ctx, uid, uuid.NewString(), 50)
		require.NoError(t, err)
		assert.Empty(t, list)
	})

	t.Run("Notification 携带 workspace_id 字段（全局为空串）", func(t *testing.T) {
		list, err := repo.ListInbox(ctx, uid, "", 50)
		require.NoError(t, err)
		for _, n := range list {
			if n.Title == "global" {
				assert.Empty(t, n.Workspace)
			} else {
				assert.NotEmpty(t, n.Workspace)
			}
		}
	})
}

func mustInsert(t *testing.T, repo *Repo, in app.NotifyInput, now time.Time) {
	t.Helper()
	_, err := repo.Insert(context.Background(), in, now)
	require.NoError(t, err)
}

func dsn0() string { return os.Getenv("TEST_DATABASE_URL") }

func seedScopeUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	uid := uuid.NewString()
	_, err := pool.Exec(context.Background(),
		`INSERT INTO "user" (id, email, display_name) VALUES ($1, $2, 'scope tester')`,
		uid, "scope-"+uuid.NewString()[:12]+"@test.dev")
	require.NoError(t, err)
	return uid
}

func seedScopeWorkspace(t *testing.T, pool *pgxpool.Pool, id, owner string) {
	t.Helper()
	_, err := pool.Exec(context.Background(),
		`INSERT INTO workspace (id, slug, name, created_by) VALUES ($1, $2, $3, $4)`,
		id, "ws-"+id[:12], "scope ws", owner)
	require.NoError(t, err)
}
