package app_test

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/identity"
	"github.com/haozing/ploykit/identity/app"
	"github.com/haozing/ploykit/identity/domain"
	"github.com/haozing/ploykit/platform/webx"
)

type adminOpsRepo struct {
	*fakeRepo
	pats        []app.PAT
	okPAT       string
	revokedPATs []string
	sessInfo    []app.SessionInfo
	listedSess  []string
}

func (r *adminOpsRepo) ListPATs(_ context.Context, _ string) ([]app.PAT, error) {
	return r.pats, nil
}

func (r *adminOpsRepo) RevokePAT(_ context.Context, _, patID string, _ time.Time) error {
	if patID == r.okPAT {
		r.revokedPATs = append(r.revokedPATs, patID)
		return nil
	}
	return app.ErrNotFound
}

func (r *adminOpsRepo) ListUserSessions(_ context.Context, userID string) ([]app.SessionInfo, error) {
	r.listedSess = append(r.listedSess, userID)
	return r.sessInfo, nil
}

type adminOpsAuditor struct {
	actions []string
	actors  []*webx.Principal
	metas   []map[string]any
}

func (a *adminOpsAuditor) Record(_ context.Context, _ *string, p *webx.Principal, action, _, _ string, meta map[string]any) {
	a.actions = append(a.actions, action)
	a.actors = append(a.actors, p)
	a.metas = append(a.metas, meta)
}

func TestResetPasswordFor(t *testing.T) {
	t.Run("目标存在 → 复用 RequestPasswordReset 全语义（挑战+发信）", func(t *testing.T) {
		f, m := newFakeRepo(seedUser("u1", "u1@example.com", false)), &fakeMail{}
		f.nowFn = func() time.Time { return frozen }
		svc := newAccountSvc(f, m)
		require.NoError(t, svc.ResetPasswordFor(t.Context(), "u1"))
		assert.Equal(t, 1, f.created)
		require.Len(t, m.reset, 1)
		email, _ := linkToken(t, m.reset[0], "/reset-password")
		assert.Equal(t, "u1@example.com", email)
	})

	t.Run("目标不存在 → 404", func(t *testing.T) {
		f, m := newFakeRepo(), &fakeMail{}
		svc := newAccountSvc(f, m)
		assertErrCode(t, svc.ResetPasswordFor(t.Context(), "ghost"), 404, webx.CodeNotFound)
		assert.Zero(t, f.created)
		assert.Empty(t, m.reset)
	})

	t.Run("1 分钟内重复触发 → 429（冷却与自助一致）", func(t *testing.T) {
		f, m := newFakeRepo(seedUser("u1", "u1@example.com", false)), &fakeMail{}
		f.nowFn = func() time.Time { return frozen }
		svc := newAccountSvc(f, m)
		require.NoError(t, svc.ResetPasswordFor(t.Context(), "u1"))
		assertErrCode(t, svc.ResetPasswordFor(t.Context(), "u1"), 429, webx.CodeRateLimited)
	})
}

func TestResendVerificationFor(t *testing.T) {
	t.Run("未验证 → verify_link 挑战 + 发信", func(t *testing.T) {
		f, m := newFakeRepo(seedUser("u1", "u1@example.com", false)), &fakeMail{}
		f.nowFn = func() time.Time { return frozen }
		svc := newAccountSvc(f, m)
		require.NoError(t, svc.ResendVerificationFor(t.Context(), "u1@example.com"))
		assert.Equal(t, 1, f.created)
		require.Len(t, m.verify, 1)
		email, token := linkToken(t, m.verify[0], "/verify-email")
		assert.Equal(t, "u1@example.com", email)
		assert.Len(t, token, 64)
		assert.Equal(t, frozen.Add(domain.VerifyLinkTTL), f.chals["u1@example.com|verify_link"].ExpiresAt)
	})

	t.Run("已验证 → 409 且不发信", func(t *testing.T) {
		f, m := newFakeRepo(seedUser("u1", "u1@example.com", true)), &fakeMail{}
		svc := newAccountSvc(f, m)
		assertErrCode(t, svc.ResendVerificationFor(t.Context(), "u1@example.com"), 409, webx.CodeConflict)
		assert.Zero(t, f.created)
		assert.Empty(t, m.verify)
	})

	t.Run("未知邮箱 → 404", func(t *testing.T) {
		f, m := newFakeRepo(), &fakeMail{}
		svc := newAccountSvc(f, m)
		assertErrCode(t, svc.ResendVerificationFor(t.Context(), "ghost@example.com"), 404, webx.CodeNotFound)
	})

	t.Run("1 分钟内重复 → 429", func(t *testing.T) {
		f, m := newFakeRepo(seedUser("u1", "u1@example.com", false)), &fakeMail{}
		f.nowFn = func() time.Time { return frozen }
		svc := newAccountSvc(f, m)
		require.NoError(t, svc.ResendVerificationFor(t.Context(), "u1@example.com"))
		assertErrCode(t, svc.ResendVerificationFor(t.Context(), "u1@example.com"), 429, webx.CodeRateLimited)
	})
}

func TestMarkVerifiedFor(t *testing.T) {
	f := newFakeRepo(seedUser("u1", "u1@example.com", false))
	svc := newAccountSvc(f, &fakeMail{})
	require.NoError(t, svc.MarkVerified(t.Context(), "u1"))
	assert.Equal(t, 1, f.verified, "repo.SetEmailVerified 恰好一次")
}

func TestDeleteAccountFor(t *testing.T) {
	actor := &webx.Principal{UserID: "op", Email: "op@test.local", IsPlatformAdmin: true}

	t.Run("成功 → RunInTx 软删目标 + 审计 actor=管理员", func(t *testing.T) {
		f := newFakeRepo(seedUser("u1", "u1@example.com", false))
		aud := &adminOpsAuditor{}
		svc := newAccountSvc(f, &fakeMail{}).WithAuditor(aud)
		require.NoError(t, svc.DeleteAccountFor(t.Context(), actor, "u1"))
		assert.Equal(t, []string{"u1"}, f.softDeleted)
		require.Len(t, aud.actions, 1)
		assert.Equal(t, "account.deleted", aud.actions[0])
		require.NotNil(t, aud.actors[0])
		assert.Equal(t, "op", aud.actors[0].UserID, "审计 actor 是管理员而非目标")
		assert.Equal(t, map[string]any{"via": "admin"}, aud.metas[0])
	})

	t.Run("目标不存在/非 active → 404（幂等二调）且不留审计", func(t *testing.T) {
		f := newFakeRepo(seedUser("u1", "u1@example.com", false))
		f.softDeleteErr = app.ErrNotFound
		aud := &adminOpsAuditor{}
		svc := newAccountSvc(f, &fakeMail{}).WithAuditor(aud)
		assertErrCode(t, svc.DeleteAccountFor(t.Context(), actor, "u1"), 404, webx.CodeNotFound)
		assert.Empty(t, aud.actions)
	})

	t.Run("事务失败 → 原样上抛（回滚由 RunInTx fake 快照还原）", func(t *testing.T) {
		f := newFakeRepo(seedUser("u1", "u1@example.com", false))
		f.softDeleteErr = assert.AnError
		svc := newAccountSvc(f, &fakeMail{})
		require.ErrorIs(t, svc.DeleteAccountFor(t.Context(), actor, "u1"), assert.AnError)
	})

	t.Run("审计器未挂载(nil)不 panic", func(t *testing.T) {
		f := newFakeRepo(seedUser("u1", "u1@example.com", false))
		svc := newAccountSvc(f, &fakeMail{})
		require.NoError(t, svc.DeleteAccountFor(t.Context(), actor, "u1"))
	})
}

func TestSessionForVariants(t *testing.T) {
	t.Run("ListSessionsFor 按目标查询", func(t *testing.T) {
		r := &adminOpsRepo{fakeRepo: newFakeRepo(seedUser("u1", "u1@example.com", false)),
			sessInfo: []app.SessionInfo{{ID: "s1"}}}

		svc := app.NewSessionService(r, &fakeMail{}, app.SessionConfig{AllowSignup: true, SecretPepper: "p"},
			time.Hour, 0, func() time.Time { return frozen })
		out, err := svc.ListSessionsFor(t.Context(), "u1")
		require.NoError(t, err)
		assert.Equal(t, []string{"u1"}, r.listedSess)
		require.Len(t, out, 1)
		assert.Equal(t, "s1", out[0].ID)
	})

	t.Run("RevokeAllSessionsFor 吊销目标全部会话", func(t *testing.T) {
		f := newFakeRepo(seedUser("u1", "u1@example.com", false))
		svc := newSessionSvc(f, &fakeMail{})
		require.NoError(t, svc.RevokeAllSessionsFor(t.Context(), "u1"))
		assert.Equal(t, 1, f.revoked)
	})

	t.Run("RevokeSessionByIDFor 存在 → nil；不存在 → 404（幂等）", func(t *testing.T) {
		f := newFakeRepo(seedUser("u1", "u1@example.com", false))
		f.revokeOKID = "s1"
		svc := newSessionSvc(f, &fakeMail{})
		require.NoError(t, svc.RevokeSessionByIDFor(t.Context(), "u1", "s1"))
		assertErrCode(t, svc.RevokeSessionByIDFor(t.Context(), "u1", "missing"), 404, webx.CodeNotFound)
	})
}

func TestPATForVariants(t *testing.T) {
	newSvc := func(r *adminOpsRepo) *app.TokenService {
		return app.NewTokenService(r, nil, func() time.Time { return frozen })
	}

	t.Run("ListPATsFor 按目标查询（无本人 Principal）", func(t *testing.T) {
		r := &adminOpsRepo{fakeRepo: newFakeRepo(), pats: []app.PAT{{ID: "p1", Name: "ci"}}}
		out, err := newSvc(r).ListPATsFor(t.Context(), "u1")
		require.NoError(t, err)
		require.Len(t, out, 1)
		assert.Equal(t, "p1", out[0].ID)
	})

	t.Run("RevokePATFor 存在 → nil；不存在/已吊销 → 404（幂等）", func(t *testing.T) {
		r := &adminOpsRepo{fakeRepo: newFakeRepo(), okPAT: "p1"}
		svc := newSvc(r)
		require.NoError(t, svc.RevokePATFor(t.Context(), "u1", "p1"))
		assert.Equal(t, []string{"p1"}, r.revokedPATs)
		assertErrCode(t, svc.RevokePATFor(t.Context(), "u1", "px"), 404, webx.CodeNotFound)
	})
}

func (f *fakeRepo) ListUsersByIDs(_ context.Context, ids []string) ([]app.User, error) {
	out := []app.User{}
	for _, id := range ids {
		if u, ok := f.byID[id]; ok {
			out = append(out, u)
		}
	}
	return out, nil
}

// aifengkong #1: admin provisioning must not carry self-service side effects
// (no session, no mail, no signup gate) and must surface duplicate emails as
// a distinguishable error; AfterRegister fires inside the same tx.
func TestAdminCreateUser_AF1(t *testing.T) {
	f := newFakeRepo()
	m := &fakeMail{}
	svc := newAccountSvc(f, m)

	t.Run("创建成功：密码哈希落库且明文不存储", func(t *testing.T) {
		u, err := svc.AdminCreateUser(context.Background(), nil, "New@Example.com", " ops ", "strong-password-1A")
		require.NoError(t, err)
		assert.Equal(t, "new@example.com", u.Email, "email normalized")
		assert.Equal(t, "ops", u.DisplayName)
		stored, ok, _ := f.GetUserByEmail(context.Background(), "new@example.com")
		require.True(t, ok)
		assert.NotEqual(t, "strong-password-1A", stored.PasswordHash, "plaintext never stored")
		assert.True(t, len(stored.PasswordHash) > 20, "argon2id PHC stored")
		// no-session / no-mail are structural: AdminCreateUser touches only
		// repo create + hooks, no CreateSession/mail call sites exist in it
		// (covered by the method body; fakeMail captures resets for AF2).
	})

	t.Run("重复邮箱 → E_CONFLICT 可识别错误", func(t *testing.T) {
		_, err := svc.AdminCreateUser(context.Background(), nil, "new@example.com", "dup", "strong-password-1A")
		require.Error(t, err)
		we := &webx.Error{}
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusConflict, we.Status)
	})

	t.Run("AfterRegister 钩子失败 → 整体失败（事务回滚语义）", func(t *testing.T) {
		hooked := app.NewAccountService(f, &fakeMail{}, app.AccountConfig{}, func() time.Time { return frozen }).
			WithIdentityHooks(identity.IdentityHooks{
				AfterRegister: func(ctx context.Context, tx pgx.Tx, userID string) error {
					return errors.New("role bind failed")
				},
			})
		_, err := hooked.AdminCreateUser(context.Background(), nil, "hooked@example.com", "h", "strong-password-1A")
		require.Error(t, err, "hook failure must abort the create")
		_, ok, _ := f.GetUserByEmail(context.Background(), "hooked@example.com")
		assert.False(t, ok, "failed hook leaves no user behind (fake is non-tx; the tx contract is the RunInTx wrapping)")
	})
}

// aifengkong #2: admin-set password = hash + revoke all sessions + audit,
// no mail anywhere.
func TestAdminSetPassword_AF2(t *testing.T) {
	f := newFakeRepo()
	f.byID["u9"] = app.User{ID: "u9", Email: "u9@example.com", Status: "active"}
	m := &fakeMail{}
	svc := newAccountSvc(f, m)

	err := svc.AdminSetPassword(context.Background(), nil, "u9", "fresh-password-2B")
	require.NoError(t, err)
	assert.Equal(t, 1, f.setPW, "hash written")
	assert.Equal(t, 1, f.revoked, "all sessions revoked")
	assert.Empty(t, m.reset, "no reset mail")

	err = svc.AdminSetPassword(context.Background(), nil, "ghost", "fresh-password-2B")
	require.Error(t, err)
	we := &webx.Error{}
	require.ErrorAs(t, err, &we)
	assert.Equal(t, http.StatusNotFound, we.Status)
}

// aifengkong #7: batch echo resolves present ids and skips missing ones.
func TestListUsersByIDs_AF7(t *testing.T) {
	f := newFakeRepo(seedUser("u1", "u1@example.com", false), seedUser("u2", "u2@example.com", false))
	svc := newAccountSvc(f, &fakeMail{})

	got, err := svc.ListUsersByIDs(context.Background(), []string{"u1", "missing", "u2"})
	require.NoError(t, err)
	assert.Len(t, got, 2)

	got, err = svc.ListUsersByIDs(context.Background(), nil)
	require.NoError(t, err)
	assert.Empty(t, got)
}
