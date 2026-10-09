package pgrepo

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/identity/app"
	"github.com/haozing/ploykit/identity/domain"
	"github.com/haozing/ploykit/migrations"
	"github.com/haozing/ploykit/platform/pg"
	pgm "github.com/haozing/ploykit/platform/pgmigrate"
)

func delTestDB(t *testing.T) (*Repo, *pgxpool.Pool, func()) {
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
	return repo, db.Pool(), db.Close
}

type delFixture struct {
	uid   string
	email string
	token string
	pool  *pgxpool.Pool
	repo  *Repo
}

func seedDeletable(t *testing.T, repo *Repo, pool *pgxpool.Pool) delFixture {
	t.Helper()
	ctx := context.Background()
	uid := uuid.NewString()
	email := "del-" + uuid.NewString()[:12] + "@test.dev"
	_, err := pool.Exec(ctx, `
		INSERT INTO "user" (id, email, display_name, password_hash, avatar_url)
		VALUES ($1, $2, 'to delete', '$argon2id$fake', 'https://cdn/x.png')`, uid, email)
	require.NoError(t, err)
	token, _, err := repo.CreateSession(ctx, uid, "iph", "ua", time.Now().UTC())
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `
		INSERT INTO personal_access_token (user_id, name, token_hash, prefix)
		VALUES ($1, 'ci', $2, 'pk_ci')`, uid, "hash-"+uid)
	require.NoError(t, err)
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM "user" WHERE id = $1`, uid) })
	return delFixture{uid: uid, email: email, token: token, pool: pool, repo: repo}
}

func softDelete(ctx context.Context, repo *Repo, uid string, now time.Time) error {
	return repo.RunInTx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return repo.SoftDeleteUserTx(ctx, tx, uid, now)
	})
}

func TestSoftDeleteUserTx(t *testing.T) {
	repo, pool, closeDB := delTestDB(t)
	defer closeDB()
	ctx := context.Background()
	fx := seedDeletable(t, repo, pool)
	now := time.Now().UTC()

	p, err := repo.VerifySession(ctx, fx.token, now)
	require.NoError(t, err)
	require.NotNil(t, p)

	require.NoError(t, softDelete(ctx, repo, fx.uid, now))
	require.ErrorIs(t, softDelete(ctx, repo, fx.uid, now), app.ErrNotFound)

	var status, email, displayName string
	var avatar, password *string
	var tokensValidAfter time.Time
	err = pool.QueryRow(ctx, `
		SELECT status, email, display_name, avatar_url, password_hash, tokens_valid_after
		FROM "user" WHERE id = $1`, fx.uid).
		Scan(&status, &email, &displayName, &avatar, &password, &tokensValidAfter)
	require.NoError(t, err)
	assert.Equal(t, "deleted", status, "019 约束应允许 status='deleted'")
	assert.Equal(t, "deleted+"+fx.uid+"@invalid", email, "邮箱改写为 deleted+<id>@invalid")
	assert.Empty(t, displayName)
	assert.Nil(t, avatar)
	assert.Nil(t, password)
	assert.False(t, tokensValidAfter.IsZero())

	p, err = repo.VerifySession(ctx, fx.token, now.Add(time.Second))
	require.NoError(t, err)
	assert.Nil(t, p, "注销后旧会话必须按匿名处理")

	var revokedAt *time.Time
	err = pool.QueryRow(ctx, `
		SELECT revoked_at FROM personal_access_token WHERE user_id = $1`, fx.uid).Scan(&revokedAt)
	require.NoError(t, err)
	require.NotNil(t, revokedAt, "注销应吊销全部 PAT")

	_, err = pool.Exec(ctx, `
		INSERT INTO "user" (id, email, display_name) VALUES ($1, $2, 'reborn')`,
		uuid.NewString(), fx.email)
	require.NoError(t, err, "原邮箱应允许重新注册")

	_, err = repo.GetUser(ctx, fx.uid)
	require.ErrorIs(t, err, app.ErrNotFound)
}

func TestSoftDeleteUserTx_UnbindsOAuthAccount_I3(t *testing.T) {
	repo, pool, closeDB := delTestDB(t)
	defer closeDB()
	ctx := context.Background()
	fx := seedDeletable(t, repo, pool)

	subject := "gh-del-" + uuid.NewString()[:8]
	require.NoError(t, repo.LinkOAuthAccount(ctx, "github", subject, fx.uid, fx.email, time.Now().UTC()))

	require.NoError(t, softDelete(ctx, repo, fx.uid, time.Now().UTC()))

	_, ok, err := repo.FindOAuthAccount(ctx, "github", subject)
	require.NoError(t, err)
	assert.False(t, ok, "软删必须同事务删除 oauth_account 行（I3）")

	reborn, err := repo.UpsertUserByEmail(ctx, fx.email, time.Now().UTC())
	require.NoError(t, err)
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM "user" WHERE id = $1`, reborn.ID) })
	require.NoError(t, repo.LinkOAuthAccount(ctx, "github", subject, reborn.ID, fx.email, time.Now().UTC()))
	got, ok, err := repo.FindOAuthAccount(ctx, "github", subject)
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, reborn.ID, got, "重注册者的 OAuth 关联必须指向新用户")
}

func TestUpsertUserByEmailDisplayNameLimit_I12(t *testing.T) {
	repo, pool, closeDB := delTestDB(t)
	defer closeDB()
	ctx := context.Background()

	long := strings.Repeat("a", 150) + "@test.dev"
	u, err := repo.UpsertUserByEmail(ctx, long, time.Now().UTC())
	require.NoError(t, err)
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM "user" WHERE id = $1`, u.ID) })

	assert.LessOrEqual(t, utf8.RuneCountInString(u.DisplayName), domain.DisplayNameMaxLen,
		"JIT 建号展示名不得超过 100 rune（API-FT2-8）")
	assert.Equal(t, strings.Repeat("a", domain.DisplayNameMaxLen), u.DisplayName, "截断兜底保留前 100 rune")
}

func TestLatestPendingChallenge_UsesCallerCtx_I13(t *testing.T) {
	repo, _, closeDB := delTestDB(t)
	defer closeDB()

	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := repo.LatestPendingChallenge(canceled, "x@test.dev", "login_code")
	require.Error(t, err, "入参 ctx 已取消时不得吞掉改用 context.Background()")
}
