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

	"github.com/haozing/ploykit/identity/app"
	"github.com/haozing/ploykit/migrations"
	"github.com/haozing/ploykit/platform/pg"
	"github.com/haozing/ploykit/platform/pgmigrate"
)

func fedTestDB(t *testing.T) (*Repo, func()) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	ctx := context.Background()
	db, err := pg.Connect(ctx, dsn, pg.Options{})
	require.NoError(t, err)
	require.NoError(t, pgmigrate.Up(ctx, db.Pool(), migrations.FS, "."))
	repo := New(db.Pool(), Config{})
	return repo, db.Close
}

func seedFedWorkspace(t *testing.T, repo *Repo) (wsID string) {
	t.Helper()
	ctx := context.Background()
	uid := uuid.NewString()
	_, err := repo.pool.Exec(ctx, `
		INSERT INTO "user" (id, email, display_name)
		VALUES ($1, $2, 'fed tester')`, uid, fmt.Sprintf("fed-%s@test.dev", uuid.NewString()[:12]))
	require.NoError(t, err)
	slug := "fed-" + uuid.NewString()[:8]
	wsID = uuid.NewString()
	_, err = repo.pool.Exec(ctx, `
		INSERT INTO workspace (id, slug, name, created_by)
		VALUES ($1, $2, 'Fed 测试区', $3)`, wsID, slug, uid)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = repo.pool.Exec(ctx, `DELETE FROM workspace WHERE id = $1`, wsID)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM "user" WHERE id = $1`, uid)
	})
	return wsID
}

func TestFedProvider_GetUnconfigured(t *testing.T) {
	repo, closeDB := fedTestDB(t)
	defer closeDB()

	_, ok, err := repo.GetFedProvider(context.Background(), uuid.NewString())
	require.NoError(t, err)
	assert.False(t, ok)
}

func TestFedProvider_UpsertGetDelete(t *testing.T) {
	repo, closeDB := fedTestDB(t)
	defer closeDB()
	ctx := context.Background()
	wsID := seedFedWorkspace(t, repo)
	now := time.Now().UTC().Truncate(time.Second)

	row := &app.FedProviderRow{
		WorkspaceID: wsID, IssuerURL: "https://idp.example.com",
		ClientID: "cid-1", ClientSecret: "sec-1", Scopes: "openid email profile",
	}
	require.NoError(t, repo.UpsertFedProvider(ctx, row, now))
	got, ok, err := repo.GetFedProvider(ctx, wsID)
	require.NoError(t, err)
	require.True(t, ok)
	assert.Equal(t, "https://idp.example.com", got.IssuerURL)
	assert.Equal(t, "cid-1", got.ClientID)
	assert.Equal(t, "sec-1", got.ClientSecret)
	assert.Equal(t, "openid email profile", got.Scopes)
	assert.WithinDuration(t, now, got.UpdatedAt, time.Second)

	row2 := &app.FedProviderRow{
		WorkspaceID: wsID, IssuerURL: "https://idp2.example.com",
		ClientID: "cid-2", ClientSecret: "sec-2", Scopes: "openid email",
	}
	later := now.Add(time.Hour)
	require.NoError(t, repo.UpsertFedProvider(ctx, row2, later))
	got, ok, err = repo.GetFedProvider(ctx, wsID)
	require.NoError(t, err)
	require.True(t, ok)
	assert.Equal(t, "https://idp2.example.com", got.IssuerURL)
	assert.Equal(t, "cid-2", got.ClientID)
	assert.Equal(t, "sec-2", got.ClientSecret)
	assert.Equal(t, "openid email", got.Scopes)

	require.NoError(t, repo.DeleteFedProvider(ctx, wsID))
	_, ok, err = repo.GetFedProvider(ctx, wsID)
	require.NoError(t, err)
	assert.False(t, ok)
	err = repo.DeleteFedProvider(ctx, wsID)
	assert.ErrorIs(t, err, app.ErrNotFound)
}

func TestFedProvider_WorkspaceCascade(t *testing.T) {
	repo, closeDB := fedTestDB(t)
	defer closeDB()
	ctx := context.Background()
	wsID := seedFedWorkspace(t, repo)

	require.NoError(t, repo.UpsertFedProvider(ctx, &app.FedProviderRow{
		WorkspaceID: wsID, IssuerURL: "https://idp.example.com",
		ClientID: "cid", ClientSecret: "sec",
	}, time.Now().UTC()))

	_, err := repo.pool.Exec(ctx, `DELETE FROM workspace WHERE id = $1`, wsID)
	require.NoError(t, err)
	_, ok, err := repo.GetFedProvider(ctx, wsID)
	require.NoError(t, err)
	assert.False(t, ok, "workspace 删除后联邦配置必须级联消失")
}

func TestOAuthAccount_FedProviderKey(t *testing.T) {
	repo, closeDB := fedTestDB(t)
	defer closeDB()
	ctx := context.Background()
	wsID := seedFedWorkspace(t, repo)
	uid, email := oauthTestUser(t, repo)
	now := time.Now().UTC()

	key := "oidc_fed:" + wsID
	require.NoError(t, repo.LinkOAuthAccount(ctx, key, "sub-fed-1", uid, email, now))
	got, ok, err := repo.FindOAuthAccount(ctx, key, "sub-fed-1")
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, uid, got)

	ws2 := seedFedWorkspace(t, repo)
	key2 := "oidc_fed:" + ws2
	uid2, email2 := oauthTestUser(t, repo)
	require.NoError(t, repo.LinkOAuthAccount(ctx, key2, "sub-fed-1", uid2, email2, now))
	got2, ok, err := repo.FindOAuthAccount(ctx, key2, "sub-fed-1")
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, uid2, got2)
	assert.NotEqual(t, got, got2, "不同工作区的同 sub 不得串号")

	err = repo.LinkOAuthAccount(ctx, "gitlab", "sub-x", uid, email, now)
	assert.Error(t, err, "provider CHECK 必须仍然拒绝未知提供商")
}
