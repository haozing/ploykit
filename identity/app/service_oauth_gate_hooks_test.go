package app_test

import (
	"context"
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/identity"
	"github.com/haozing/ploykit/identity/app"
	"github.com/haozing/ploykit/platform/webx"
)

func allowNoneGate(string) bool { return true }

func TestOAuthCallback_SignupGate_P1_1(t *testing.T) {
	existing := app.User{ID: "u-existing", Email: "existing@example.com", Status: "active"}

	t.Run("分支③ 全新用户被闸门拦截 → 403 不建号", func(t *testing.T) {
		repo := newOAuthFakeRepo()
		p := &fakeOAuthProvider{name: "github", id: app.OAuthIdentity{
			Provider: "github", Subject: "s-new", Email: "fresh@example.com", EmailVerified: true}}
		svc := newOAuthSvc(repo, p)

		res, err := svc.Callback(context.Background(),
			oauthCallbackReq("github", "st", "st"), "github", "c", "st", allowNoneGate)
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusForbidden, we.Status)
		assert.Zero(t, repo.upserts, "被闸门拦截不得建号")
		assert.Empty(t, repo.linkCalls)
		assert.Empty(t, res.UserID)
		assert.Equal(t, "fresh@example.com", res.Email, "断言邮箱仍带回（OnLoginFailed 用）")
	})

	t.Run("分支② 同邮箱既有用户不受闸门影响（老用户始终可登录）", func(t *testing.T) {
		repo := newOAuthFakeRepo(existing)
		p := &fakeOAuthProvider{name: "github", id: app.OAuthIdentity{
			Provider: "github", Subject: "s-old", Email: "existing@example.com", EmailVerified: true}}
		svc := newOAuthSvc(repo, p)

		res, err := svc.Callback(context.Background(),
			oauthCallbackReq("github", "st", "st"), "github", "c", "st", allowNoneGate)
		require.NoError(t, err)
		assert.Equal(t, "u-existing", res.UserID)
		assert.False(t, res.JITNew)
		require.Len(t, repo.linkCalls, 1)
	})

	t.Run("分支① 已关联不受闸门影响", func(t *testing.T) {
		repo := newOAuthFakeRepo(existing)
		repo.links["github|s-1"] = "u-existing"
		p := &fakeOAuthProvider{name: "github", id: app.OAuthIdentity{
			Provider: "github", Subject: "s-1", Email: "existing@example.com", EmailVerified: true}}
		svc := newOAuthSvc(repo, p)

		res, err := svc.Callback(context.Background(),
			oauthCallbackReq("github", "st", "st"), "github", "c", "st", allowNoneGate)
		require.NoError(t, err)
		assert.Equal(t, "u-existing", res.UserID)
		assert.Zero(t, repo.upserts)
	})

	t.Run("gate=nil（独立装配）保持建号能力", func(t *testing.T) {
		repo := newOAuthFakeRepo()
		p := &fakeOAuthProvider{name: "github", id: app.OAuthIdentity{
			Provider: "github", Subject: "s-n", Email: "n@example.com", EmailVerified: true}}
		svc := newOAuthSvc(repo, p)

		res, err := svc.Callback(context.Background(),
			oauthCallbackReq("github", "st", "st"), "github", "c", "st", nil)
		require.NoError(t, err)
		assert.Equal(t, 1, repo.upserts)
		assert.True(t, res.JITNew)
	})

	t.Run("闸门放行的域名建号正常", func(t *testing.T) {
		repo := newOAuthFakeRepo()
		p := &fakeOAuthProvider{name: "github", id: app.OAuthIdentity{
			Provider: "github", Subject: "s-d", Email: "vip@corp.example", EmailVerified: true}}
		svc := newOAuthSvc(repo, p)
		allowDomains := func(email string) bool { return !strings_HasDomainSuffix(email, "corp.example") }

		res, err := svc.Callback(context.Background(),
			oauthCallbackReq("github", "st", "st"), "github", "c", "st", allowDomains)
		require.NoError(t, err)
		assert.Equal(t, 1, repo.upserts)
		assert.True(t, res.JITNew)
	})
}

func strings_HasDomainSuffix(email, suffix string) bool {
	return len(email) > len(suffix)+1 && email[len(email)-len(suffix):] == suffix
}

func TestCompleteThirdPartyLogin_Hooks_P1_2(t *testing.T) {
	newUser := app.User{ID: "u-3p", Email: "third@example.com", Status: "active"}
	oldUser := app.User{ID: "u-old", Email: "old@example.com", Status: "active"}

	t.Run("JIT 新用户：AfterRegister(tx=nil) + AfterLogin + 记账 success", func(t *testing.T) {
		f, m := newFakeRepo(newUser), &fakeMail{}
		var regUID, loginUID, loginSess string
		var regTx pgx.Tx
		svc := newSessionSvc(f, m).WithHooks(identity.IdentityHooks{
			AfterRegister: func(_ context.Context, tx pgx.Tx, userID string) error {
				regUID, regTx = userID, tx
				return nil
			},
			AfterLogin: func(_ context.Context, userID, sessionID string) error {
				loginUID, loginSess = userID, sessionID
				return nil
			},
		})

		res, err := svc.CompleteThirdPartyLogin(context.Background(), "u-3p", true, "iph", "ua")
		require.NoError(t, err)
		assert.Equal(t, "u-3p", res.User.ID)
		assert.Equal(t, "sess-token", res.Token)
		assert.Equal(t, "u-3p", regUID, "JIT 新用户必须触发 AfterRegister")
		assert.Nil(t, regTx, "第三方 JIT 的 AfterRegister 契约：tx=nil（提交后触发）")
		assert.Equal(t, "u-3p", loginUID)
		assert.Equal(t, "sess-1", loginSess, "AfterLogin 必须携带会话 ID")
		assert.Equal(t, []bool{true}, f.attemptLog, "成功登录记账 success=true")
	})

	t.Run("非 JIT（分支①②）：只触发 AfterLogin", func(t *testing.T) {
		f, m := newFakeRepo(oldUser), &fakeMail{}
		regCalled := false
		svc := newSessionSvc(f, m).WithHooks(identity.IdentityHooks{
			AfterRegister: func(context.Context, pgx.Tx, string) error {
				regCalled = true
				return nil
			},
		})
		_, err := svc.CompleteThirdPartyLogin(context.Background(), "u-old", false, "iph", "ua")
		require.NoError(t, err)
		assert.False(t, regCalled, "老用户登录不得触发 AfterRegister")
	})

	t.Run("AfterRegister 失败不阻断登录（幂等契约，I4 同款）", func(t *testing.T) {
		f, m := newFakeRepo(newUser), &fakeMail{}
		svc := newSessionSvc(f, m).WithHooks(identity.IdentityHooks{
			AfterRegister: func(context.Context, pgx.Tx, string) error {
				return assert.AnError
			},
		})
		res, err := svc.CompleteThirdPartyLogin(context.Background(), "u-3p", true, "iph", "ua")
		require.NoError(t, err, "Observational/幂等契约：钩子错误不影响登录结果")
		assert.NotEmpty(t, res.Token)
	})

	t.Run("AfterLogin 失败不阻断登录（Observational）", func(t *testing.T) {
		f, m := newFakeRepo(newUser), &fakeMail{}
		svc := newSessionSvc(f, m).WithHooks(identity.IdentityHooks{
			AfterLogin: func(context.Context, string, string) error { return assert.AnError },
		})
		_, err := svc.CompleteThirdPartyLogin(context.Background(), "u-3p", false, "iph", "ua")
		require.NoError(t, err)
	})

	t.Run("用户不存在 → 报错不签会话", func(t *testing.T) {
		f, m := newFakeRepo(), &fakeMail{}
		svc := newSessionSvc(f, m)
		_, err := svc.CompleteThirdPartyLogin(context.Background(), "ghost", false, "iph", "ua")
		require.ErrorIs(t, err, app.ErrNotFound)
		assert.Empty(t, f.attemptLog)
	})
}

func TestLoginRateLimit_429_P2_20(t *testing.T) {
	t.Run("LoginWithPassword 失败次数达上限 → 429 E_RATE_LIMITED", func(t *testing.T) {
		f, m := newFakeRepo(app.User{ID: "u-l", Email: "lock@example.com", Status: "active",
			PasswordHash: mustHashForTest(t, "RightPassword123!")}), &fakeMail{}
		svc := newSessionSvc(f, m)

		for i := 0; i < 10; i++ {
			_, err := svc.LoginWithPassword(context.Background(), "iph", "ua", "lock@example.com", "WrongPass123!")
			var we *webx.Error
			require.ErrorAs(t, err, &we, "第 %d 次", i+1)
			assert.Equal(t, http.StatusUnauthorized, we.Status)
		}

		_, err := svc.LoginWithPassword(context.Background(), "iph", "ua", "lock@example.com", "WrongPass123!")
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusTooManyRequests, we.Status)
		assert.Equal(t, webx.CodeRateLimited, we.Code)
	})

	t.Run("SendCode 达上限 → 429（验证码通道同闸）", func(t *testing.T) {
		f, m := newFakeRepo(), &fakeMail{}
		f.failedAttempts = 10
		svc := newSessionSvc(f, m)
		err := svc.SendCode(context.Background(), "iph", "any@example.com")
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusTooManyRequests, we.Status)
		assert.Equal(t, webx.CodeRateLimited, we.Code)
		assert.Zero(t, f.created, "限流命中不得建挑战")
		assert.Zero(t, f.created, "限流命中不得发信（fakeMail 不记登录码，以挑战数为准）")
	})

	t.Run("正确密码在限额内登录成功并重置不了计数（success 不计入 NOT success）", func(t *testing.T) {
		f, m := newFakeRepo(app.User{ID: "u-ok", Email: "ok@example.com", Status: "active",
			PasswordHash: mustHashForTest(t, "RightPassword123!")}), &fakeMail{}
		svc := newSessionSvc(f, m)
		res, err := svc.LoginWithPassword(context.Background(), "iph", "ua", "ok@example.com", "RightPassword123!")
		require.NoError(t, err)
		assert.Equal(t, "sess-token", res.Token)
		assert.Equal(t, 0, f.failedAttempts, "成功登录不计失败")
	})
}

func mustHashForTest(t *testing.T, pw string) string {
	t.Helper()
	h, err := app.HashPassword(pw)
	require.NoError(t, err)
	return h
}
