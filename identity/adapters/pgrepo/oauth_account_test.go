package pgrepo

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/migrations"
	"github.com/haozing/ploykit/platform/pg"
	pgm "github.com/haozing/ploykit/platform/pgmigrate"
)

func oauthTestDB(t *testing.T) (*Repo, func()) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	ctx := context.Background()
	db, err := pg.Connect(ctx, dsn, pg.Options{})
	require.NoError(t, err)
	require.NoError(t, pgm.Up(ctx, db.Pool(), migrations.FS, "."))
	repo := New(db.Pool(), Config{})
	return repo, db.Close
}

func oauthTestUser(t *testing.T, repo *Repo) (id, email string) {
	t.Helper()
	ctx := context.Background()
	email = fmt.Sprintf("oauth-%s@test.dev", uuid.NewString()[:12])
	u, err := repo.UpsertUserByEmail(ctx, email, time.Now().UTC())
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = repo.pool.Exec(ctx, `DELETE FROM "user" WHERE id = $1`, u.ID)
	})
	return u.ID, email
}

func TestOAuthAccount_LinkAndFind(t *testing.T) {
	repo, closeDB := oauthTestDB(t)
	defer closeDB()
	ctx := context.Background()
	uid, email := oauthTestUser(t, repo)
	now := time.Now().UTC()

	_, ok, err := repo.FindOAuthAccount(ctx, "github", "subj-"+uuid.NewString()[:8])
	require.NoError(t, err)
	assert.False(t, ok, "陌生 subject 应未命中")

	subject := "gh-" + uuid.NewString()[:12]
	require.NoError(t, repo.LinkOAuthAccount(ctx, "github", subject, uid, email, now))

	got, ok, err := repo.FindOAuthAccount(ctx, "github", subject)
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, uid, got)

	other, otherEmail := oauthTestUser(t, repo)
	require.NoError(t, repo.LinkOAuthAccount(ctx, "github", subject, other, otherEmail, now))
	got, _, err = repo.FindOAuthAccount(ctx, "github", subject)
	require.NoError(t, err)
	assert.Equal(t, uid, got, "重复 Link 不得改写既有归属")
}

func TestOAuthAccount_ProviderScoping(t *testing.T) {
	repo, closeDB := oauthTestDB(t)
	defer closeDB()
	ctx := context.Background()
	uid, email := oauthTestUser(t, repo)

	subject := "dup-" + uuid.NewString()[:8]
	require.NoError(t, repo.LinkOAuthAccount(ctx, "github", subject, uid, email, time.Now().UTC()))
	require.NoError(t, repo.LinkOAuthAccount(ctx, "google", subject, uid, email, time.Now().UTC()))

	for _, p := range []string{"github", "google"} {
		got, ok, err := repo.FindOAuthAccount(ctx, p, subject)
		require.NoError(t, err)
		assert.True(t, ok, "provider=%s 应命中", p)
		assert.Equal(t, uid, got)
	}
	_, ok, err := repo.FindOAuthAccount(ctx, "gitlab", subject)
	require.NoError(t, err)
	assert.False(t, ok, "未支持 provider 恒未命中")
}
