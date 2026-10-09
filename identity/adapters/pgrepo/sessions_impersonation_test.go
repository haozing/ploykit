package pgrepo

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/pg"
)

func TestImpersonatedSession_Marking(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	ctx := context.Background()
	db, err := pg.Connect(ctx, dsn, pg.Options{})
	require.NoError(t, err)
	t.Cleanup(db.Close)
	repo := New(db.Pool(), Config{SessionTTL: 7 * 24 * time.Hour, AbsoluteTTL: 30 * 24 * time.Hour})

	admin, err := repo.UpsertUserByEmail(ctx, "imp-mark-admin@test.dev", time.Now().UTC())
	require.NoError(t, err)
	target, err := repo.UpsertUserByEmail(ctx, "imp-mark-target@test.dev", time.Now().UTC())
	require.NoError(t, err)

	impToken, _, err := repo.CreateImpersonatedSession(ctx, target.ID, admin.ID, "h", "ua", time.Now().UTC())
	require.NoError(t, err)
	t.Cleanup(func() { _ = repo.RevokeSession(ctx, impToken) })

	normToken, _, err := repo.CreateSession(ctx, target.ID, "h", "ua", time.Now().UTC())
	require.NoError(t, err)
	t.Cleanup(func() { _ = repo.RevokeSession(ctx, normToken) })

	p, err := repo.VerifySession(ctx, impToken, time.Now().UTC())
	require.NoError(t, err)
	require.NotNil(t, p)
	assert.Equal(t, target.ID, p.UserID)
	assert.Equal(t, admin.ID, p.ImpersonatedBy, "模拟会话必须带出 impersonated_by")

	p2, err := repo.VerifySession(ctx, normToken, time.Now().UTC())
	require.NoError(t, err)
	require.NotNil(t, p2)
	assert.Empty(t, p2.ImpersonatedBy, "普通会话 impersonated_by 必须为空串（NULL）")
}
