package pgrepo

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/migrations"
	"github.com/haozing/ploykit/notify/app"
	"github.com/haozing/ploykit/platform/pg"
	"github.com/haozing/ploykit/platform/pgmigrate"
)

func prefTestDB(t *testing.T) (*Repo, *pgxpool.Pool, func()) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	ctx := context.Background()
	db, err := pg.Connect(ctx, dsn, pg.Options{})
	require.NoError(t, err)
	require.NoError(t, pgmigrate.Up(ctx, db.Pool(), migrations.FS, "."))
	repo := New(db.Pool())
	return repo, db.Pool(), db.Close
}

func seedPrefUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	ctx := context.Background()
	uid := uuid.NewString()
	_, err := pool.Exec(ctx, `INSERT INTO "user" (id, email, display_name) VALUES ($1, $2, 'pref tester')`,
		uid, "pref-"+uuid.NewString()[:12]+"@test.dev")
	require.NoError(t, err)
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM "user" WHERE id = $1`, uid) })
	return uid
}

func TestPreference_UpsertIdempotentAndPartial(t *testing.T) {
	repo, pool, closeDB := prefTestDB(t)
	defer closeDB()
	ctx := context.Background()
	uid := seedPrefUser(t, pool)

	no, yes := false, true

	p1, err := repo.Upsert(ctx, uid, "quota_near_limit", nil, &no)
	require.NoError(t, err)
	assert.Equal(t, app.Preference{NotificationType: "quota_near_limit", EmailEnabled: true, InAppEnabled: false, UpdatedAt: p1.UpdatedAt}, p1)
	assert.False(t, p1.UpdatedAt.IsZero(), "updated_at 由库端 now() 生成")

	p2, err := repo.Upsert(ctx, uid, "quota_near_limit", &no, nil)
	require.NoError(t, err)
	assert.False(t, p2.EmailEnabled)
	assert.False(t, p2.InAppEnabled, "in_app 未显式给定应保持原值")

	p3, err := repo.Upsert(ctx, uid, "quota_near_limit", nil, &yes)
	require.NoError(t, err)
	assert.False(t, p3.EmailEnabled)
	assert.True(t, p3.InAppEnabled)

	rows, err := repo.List(ctx, uid)
	require.NoError(t, err)
	require.Len(t, rows, 1, "(user, type) 主键保证 upsert 幂等")
	assert.Equal(t, "quota_near_limit", rows[0].NotificationType)
}

func TestPreference_AllowedDefaultTrue(t *testing.T) {
	repo, pool, closeDB := prefTestDB(t)
	defer closeDB()
	ctx := context.Background()
	uid := seedPrefUser(t, pool)

	ok, err := repo.Allowed(ctx, uid, "quota_near_limit")
	require.NoError(t, err)
	assert.True(t, ok)

	no := false
	_, err = repo.Upsert(ctx, uid, "quota_near_limit", nil, &no)
	require.NoError(t, err)
	ok, err = repo.Allowed(ctx, uid, "quota_near_limit")
	require.NoError(t, err)
	assert.False(t, ok, "显式关闭后闸门应拦截")

	ok, err = repo.Allowed(ctx, uid, "indexed_milestone")
	require.NoError(t, err)
	assert.True(t, ok)

	rows, err := repo.List(ctx, uid)
	require.NoError(t, err)
	assert.Len(t, rows, 1)
}

func TestPreference_UserCascade(t *testing.T) {
	repo, pool, closeDB := prefTestDB(t)
	defer closeDB()
	ctx := context.Background()
	uid := seedPrefUser(t, pool)

	no := false
	_, err := repo.Upsert(ctx, uid, "quota_near_limit", &no, nil)
	require.NoError(t, err)

	_, err = pool.Exec(ctx, `DELETE FROM "user" WHERE id = $1`, uid)
	require.NoError(t, err)
	rows, err := repo.List(ctx, uid)
	require.NoError(t, err)
	assert.Empty(t, rows)
}
