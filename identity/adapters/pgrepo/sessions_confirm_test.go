package pgrepo

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/identity/app"
	"github.com/haozing/ploykit/platform/pg"
	"github.com/haozing/ploykit/platform/webx"
)

func TestSessionPasswordConfirmation(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	ctx := context.Background()
	db, err := pg.Connect(ctx, dsn, pg.Options{})
	require.NoError(t, err)
	t.Cleanup(db.Close)
	repo := New(db.Pool(), Config{SessionTTL: 7 * 24 * time.Hour, AbsoluteTTL: 30 * 24 * time.Hour})

	user, err := repo.UpsertUserByEmail(ctx, "stepup-confirm@test.dev", time.Now().UTC())
	require.NoError(t, err)

	t.Run("密码证明创建的会话天生已确认", func(t *testing.T) {
		token, _, err := repo.CreateSession(ctx, webx.SessionCreate{
			UserID: user.ID, IPHash: "h", UserAgent: "ua",
			PasswordConfirmed: true, Now: time.Now().UTC(),
		})
		require.NoError(t, err)
		t.Cleanup(func() { _ = repo.RevokeSession(ctx, token) })

		p, err := repo.VerifySession(ctx, token, time.Now().UTC())
		require.NoError(t, err)
		require.NotNil(t, p)
		assert.False(t, p.PasswordConfirmedAt.IsZero())
	})

	t.Run("验证码/第三方会话未确认，confirm 后变新鲜", func(t *testing.T) {
		token, _, err := repo.CreateSession(ctx, webx.SessionCreate{
			UserID: user.ID, IPHash: "h", UserAgent: "ua", Now: time.Now().UTC(),
		})
		require.NoError(t, err)
		t.Cleanup(func() { _ = repo.RevokeSession(ctx, token) })

		p, err := repo.VerifySession(ctx, token, time.Now().UTC())
		require.NoError(t, err)
		require.NotNil(t, p)
		assert.True(t, p.PasswordConfirmedAt.IsZero(), "无密码证明的会话不得天生确认")

		at := time.Now().UTC()
		require.NoError(t, repo.ConfirmSessionPassword(ctx, p.SessionID, at))

		p2, err := repo.VerifySession(ctx, token, time.Now().UTC())
		require.NoError(t, err)
		require.NotNil(t, p2)
		assert.WithinDuration(t, at, p2.PasswordConfirmedAt, time.Second)
	})

	t.Run("吊销后的会话盖戳返回 NotFound", func(t *testing.T) {
		token, _, err := repo.CreateSession(ctx, webx.SessionCreate{
			UserID: user.ID, Now: time.Now().UTC(),
		})
		require.NoError(t, err)
		p, err := repo.VerifySession(ctx, token, time.Now().UTC())
		require.NoError(t, err)
		require.NotNil(t, p)
		require.NoError(t, repo.RevokeSession(ctx, token))

		err = repo.ConfirmSessionPassword(ctx, p.SessionID, time.Now().UTC())
		assert.ErrorIs(t, err, app.ErrNotFound)
	})
}
