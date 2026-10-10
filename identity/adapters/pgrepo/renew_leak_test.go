package pgrepo

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/pg"
	"github.com/haozing/ploykit/platform/webx"
)

func TestRenewSession_ReleasesConnectionAndReturnsExp(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	ctx := context.Background()
	db, err := pg.Connect(ctx, dsn, pg.Options{})
	require.NoError(t, err)
	t.Cleanup(db.Close)

	repo := New(db.Pool(), Config{SessionTTL: 7 * 24 * time.Hour, AbsoluteTTL: 30 * 24 * time.Hour})

	email := "renew-leak@test.dev"
	u, err := repo.UpsertUserByEmail(ctx, email, time.Now().UTC())
	require.NoError(t, err)

	token, _, err := repo.CreateSession(ctx, webx.SessionCreate{UserID: u.ID, IPHash: "h", UserAgent: "ua", Now: time.Now().UTC().Add(-6 * 24 * time.Hour)})
	require.NoError(t, err)
	t.Cleanup(func() { _ = repo.RevokeSession(ctx, token) })

	before := db.Pool().Stat().AcquiredConns()
	exp, renewed, err := repo.RenewSession(ctx, token, time.Now().UTC())
	require.NoError(t, err)
	require.True(t, renewed, "剩余寿命不足半 TTL 必须真续期")
	require.WithinDuration(t, time.Now().UTC().Add(7*24*time.Hour), exp, 2*time.Minute)
	require.Equal(t, before, db.Pool().Stat().AcquiredConns(), "RenewSession 必须归还连接")

	before = db.Pool().Stat().AcquiredConns()
	exp2, renewed2, err := repo.RenewSession(ctx, token, time.Now().UTC())
	require.NoError(t, err)
	require.False(t, renewed2, "剩余寿命 ≥ 半 TTL 时必须跳过写库（W1 节流）")
	require.True(t, exp2.IsZero())
	require.Equal(t, before, db.Pool().Stat().AcquiredConns(), "未续期路径同样必须归还连接")
}

func TestVerifySession_InvalidTokenAnonymous_NoError(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	ctx := context.Background()
	db, err := pg.Connect(ctx, dsn, pg.Options{})
	require.NoError(t, err)
	t.Cleanup(db.Close)
	repo := New(db.Pool(), Config{SessionTTL: 7 * 24 * time.Hour, AbsoluteTTL: 30 * 24 * time.Hour})
	p, err := repo.VerifySession(ctx, "definitely-not-a-session-token", time.Now().UTC())
	require.NoError(t, err, "无效令牌必须 (nil, nil)，不得把 DB 层错误伪装成匿名")
	require.Nil(t, p)
}
