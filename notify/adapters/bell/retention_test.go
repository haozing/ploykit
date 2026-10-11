package pgrepo

import (
	"context"
	"testing"
	"time"

	"github.com/haozing/ploykit/migrations"
	"github.com/haozing/ploykit/platform/pg"
	"github.com/haozing/ploykit/platform/pgmigrate"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/notify/app"
)

// F8-4: retention sweep prunes aged archived/read rows, never unread ones,
// and respects the batch cap.
func TestDeleteAged_F84(t *testing.T) {
	dsn := dsn0()
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	ctx := context.Background()
	repo, uid := setupRetention(t, ctx)

	past := func(d time.Duration) time.Time { return time.Now().UTC().Add(-d) }

	// unread, ancient — must survive every sweep
	mustInsertAt(t, repo, app.NotifyInput{UserID: uid, Type: "t", Title: "unread-old"}, past(400*24*time.Hour))
	// read long ago, never archived — pruned by readTTL
	mustInsertAt(t, repo, app.NotifyInput{UserID: uid, Type: "t", Title: "read-old"}, past(200*24*time.Hour))
	markRead(t, repo, uid, "read-old")
	// archived long ago — pruned by archivedTTL
	mustInsertAt(t, repo, app.NotifyInput{UserID: uid, Type: "t", Title: "arch-old"}, past(200*24*time.Hour))
	markArchived(t, repo, uid, "arch-old")
	// fresh read — survives
	mustInsertAt(t, repo, app.NotifyInput{UserID: uid, Type: "t", Title: "read-new"}, past(time.Hour))
	markRead(t, repo, uid, "read-new")

	n, err := repo.DeleteAged(ctx, 30*24*time.Hour, 90*24*time.Hour, 1000)
	require.NoError(t, err)
	assert.EqualValues(t, 2, n, "read-old + arch-old pruned; unread-old and read-new survive")

	list, err := repo.ListInbox(ctx, uid, "", 50)
	require.NoError(t, err)
	titles := map[string]bool{}
	for _, item := range list {
		titles[item.Title] = true
	}
	assert.True(t, titles["unread-old"], "unread rows are never swept")
	assert.True(t, titles["read-new"])
	assert.False(t, titles["read-old"])
	assert.False(t, titles["arch-old"])

	// batch cap: with a backlog larger than the cap only that many rows go per call
	for i := 0; i < 3; i++ {
		mustInsertAt(t, repo, app.NotifyInput{UserID: uid, Type: "t", Title: "arch-bulk"}, past(400*24*time.Hour))
		markArchived(t, repo, uid, "arch-bulk")
	}
	n, err = repo.DeleteAged(ctx, 30*24*time.Hour, 90*24*time.Hour, 2)
	require.NoError(t, err)
	assert.EqualValues(t, 2, n, "batch cap respected")
	n, err = repo.DeleteAged(ctx, 30*24*time.Hour, 90*24*time.Hour, 1000)
	require.NoError(t, err)
	assert.EqualValues(t, 1, n, "second pass drains the remainder")
}

func setupRetention(t *testing.T, ctx context.Context) (*Repo, string) {
	t.Helper()
	db, err := pgConnect0(ctx, dsn0())
	require.NoError(t, err)
	t.Cleanup(func() { db.Close() })
	repo := New(db.Pool())
	return repo, seedScopeUser(t, db.Pool())
}

func mustInsertAt(t *testing.T, repo *Repo, in app.NotifyInput, at time.Time) {
	t.Helper()
	_, err := repo.Insert(context.Background(), in, at)
	require.NoError(t, err)
}

func markRead(t *testing.T, repo *Repo, uid, title string) {
	t.Helper()
	repo.pool.Exec(context.Background(),
		`UPDATE notification SET read_at = created_at - interval '1 hour' WHERE user_id = $1 AND title = $2`, uid, title)
}

func markArchived(t *testing.T, repo *Repo, uid, title string) {
	t.Helper()
	repo.pool.Exec(context.Background(),
		`UPDATE notification SET read_at = created_at - interval '1 hour', archived_at = created_at - interval '30 minutes' WHERE user_id = $1 AND title = $2`, uid, title)
}

func pgConnect0(ctx context.Context, dsn string) (*pg.DB, error) {
	db, err := pg.Connect(ctx, dsn, pg.Options{})
	if err != nil {
		return nil, err
	}
	if err := pgmigrate.Up(ctx, db.Pool(), migrations.FS, "."); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}
