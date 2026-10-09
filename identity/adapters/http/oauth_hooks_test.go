package http_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/identity"
	httplib "github.com/haozing/ploykit/identity/adapters/http"
	"github.com/haozing/ploykit/identity/app"
	"github.com/haozing/ploykit/platform/webx"

	"github.com/jackc/pgx/v5"
)

type thirdPartyRepo struct {
	app.Repo
	users    map[string]app.User
	byID     map[string]app.User
	links    map[string]string
	upserts  int
	attempts []bool
}

func newThirdPartyRepo() *thirdPartyRepo {
	return &thirdPartyRepo{users: map[string]app.User{}, byID: map[string]app.User{}, links: map[string]string{}}
}

func (f *thirdPartyRepo) FindOAuthAccount(_ context.Context, p, s string) (string, bool, error) {
	uid, ok := f.links[p+"|"+s]
	return uid, ok, nil
}
func (f *thirdPartyRepo) LinkOAuthAccount(_ context.Context, p, s, uid, _ string, _ time.Time) error {
	f.links[p+"|"+s] = uid
	return nil
}
func (f *thirdPartyRepo) GetUserByEmail(_ context.Context, email string) (app.User, bool, error) {
	u, ok := f.users[email]
	return u, ok, nil
}
func (f *thirdPartyRepo) GetUser(_ context.Context, id string) (app.User, error) {
	u, ok := f.byID[id]
	if !ok {
		return app.User{}, app.ErrNotFound
	}
	return u, nil
}
func (f *thirdPartyRepo) UpsertUserByEmail(_ context.Context, email string, _ time.Time) (app.User, error) {
	f.upserts++
	if u, ok := f.users[email]; ok {
		return u, nil
	}
	u := app.User{ID: "u-" + email, Email: email, Status: "active"}
	f.users[email] = u
	f.byID[u.ID] = u
	return u, nil
}
func (f *thirdPartyRepo) SetEmailVerified(context.Context, string, time.Time) error { return nil }
func (f *thirdPartyRepo) CreateSession(_ context.Context, _, _, _ string, _ time.Time) (string, time.Time, error) {
	return "tp-sess-tok", time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC), nil
}
func (f *thirdPartyRepo) VerifySession(_ context.Context, _ string, _ time.Time) (*webx.Principal, error) {
	return &webx.Principal{SessionID: "tp-sess-1", Source: webx.SourceSession}, nil
}
func (f *thirdPartyRepo) RecordAttempt(_ context.Context, _, _ string, success bool, _ time.Time) error {
	f.attempts = append(f.attempts, success)
	return nil
}

func oauthHooksMux(t *testing.T, repo *thirdPartyRepo, cfg app.SessionConfig) (*http.ServeMux, *hookSpy) {
	t.Helper()
	spy := &hookSpy{}
	sess := app.NewSessionService(repo, nil, cfg, time.Hour, 0, func() time.Time { return time.Now().UTC() }).
		WithHooks(spy.hooks())
	oauth := app.NewOAuthService(repo, []app.OAuthProvider{oauthProviderStub{name: "github"}},
		func() time.Time { return time.Now().UTC() })
	mux := http.NewServeMux()
	httplib.Mount(mux, httplib.Deps{
		AuthCfg:     webx.DefaultAuthConfig(),
		Sessions:    &fakeSessionStore{},
		SessionsSvc: sess,
		OAuth:       oauth,
		OAuthAppURL: "http://localhost:5173",
	})
	return mux, spy
}

type hookSpy struct {
	regUIDs, loginUIDs, failedEmails []string
	loginSess                        []string
	regErr, loginErr, failedErr      error
}

func (s *hookSpy) hooks() identity.IdentityHooks {
	return identity.IdentityHooks{
		AfterRegister: func(_ context.Context, _ pgx.Tx, userID string) error {
			s.regUIDs = append(s.regUIDs, userID)
			return s.regErr
		},
		AfterLogin: func(_ context.Context, userID, sessionID string) error {
			s.loginUIDs = append(s.loginUIDs, userID)
			s.loginSess = append(s.loginSess, sessionID)
			return s.loginErr
		},
		OnLoginFailed: func(_ context.Context, email, _ string) error {
			s.failedEmails = append(s.failedEmails, email)
			return s.failedErr
		},
	}
}

func TestOAuthCallback_HooksAndGate_Wired_P1(t *testing.T) {
	t.Run("开放注册：JIT 建号 + AfterRegister/AfterLogin 扇出", func(t *testing.T) {
		repo := newThirdPartyRepo()
		mux, spy := oauthHooksMux(t, repo, app.SessionConfig{AllowSignup: true, SecretPepper: "p"})

		w := oauthGet(mux, "/auth/oauth/github/callback?code=c&state=st1",
			&http.Cookie{Name: "tk_oauth_state", Value: "st1"})
		require.Equal(t, http.StatusFound, w.Code)
		assert.Equal(t, "http://localhost:5173/app", w.Header().Get("Location"))
		assert.Equal(t, 1, repo.upserts, "分支③ JIT 建号")

		require.Len(t, spy.regUIDs, 1, "JIT 新用户必须触发 AfterRegister（P1-2）")
		require.Len(t, spy.loginUIDs, 1, "登录成功必须触发 AfterLogin（P1-2）")
		assert.Equal(t, spy.regUIDs[0], spy.loginUIDs[0])
		assert.Equal(t, "tp-sess-1", spy.loginSess[0], "AfterLogin 携带会话 ID")
		assert.Equal(t, []bool{true}, repo.attempts, "成功登录记账")
		assert.Empty(t, spy.failedEmails)

		var auth *http.Cookie
		for _, c := range w.Result().Cookies() {
			if c.Name == "tk_auth" {
				auth = c
			}
		}
		require.NotNil(t, auth)
		assert.Equal(t, "tp-sess-tok", auth.Value)
	})

	t.Run("allow_signup=0：陌生邮箱 JIT 被闸门拦截 → 回登录页 + OnLoginFailed（P1-1）", func(t *testing.T) {
		repo := newThirdPartyRepo()

		mux, spy := oauthHooksMux(t, repo, app.SessionConfig{AllowSignup: false,
			AllowedDomains: []string{"corp.example"}, SecretPepper: "p"})

		w := oauthGet(mux, "/auth/oauth/github/callback?code=c&state=st1",
			&http.Cookie{Name: "tk_oauth_state", Value: "st1"})
		require.Equal(t, http.StatusFound, w.Code)
		assert.Equal(t, "http://localhost:5173/login?error=oauth", w.Header().Get("Location"))
		assert.Zero(t, repo.upserts, "闸门拦截不得建号")
		assert.Empty(t, spy.regUIDs)
		assert.Empty(t, spy.loginUIDs)
		require.Len(t, spy.failedEmails, 1, "失败必须进 OnLoginFailed（P1-2）")
		assert.Equal(t, "oauth-http@example.com", spy.failedEmails[0], "风控钩子应拿到断言邮箱")
	})

	t.Run("allow_signup=0：同邮箱既有用户不受闸门影响", func(t *testing.T) {
		repo := newThirdPartyRepo()
		repo.users["oauth-http@example.com"] = app.User{ID: "u-old", Email: "oauth-http@example.com", Status: "active"}
		repo.byID["u-old"] = repo.users["oauth-http@example.com"]
		mux, spy := oauthHooksMux(t, repo, app.SessionConfig{AllowSignup: false,
			AllowedDomains: []string{"corp.example"}, SecretPepper: "p"})

		w := oauthGet(mux, "/auth/oauth/github/callback?code=c&state=st1",
			&http.Cookie{Name: "tk_oauth_state", Value: "st1"})
		require.Equal(t, http.StatusFound, w.Code)
		assert.Equal(t, "http://localhost:5173/app", w.Header().Get("Location"))
		assert.Zero(t, repo.upserts, "老用户登录不建号")
		assert.Empty(t, spy.regUIDs, "非 JIT 不触发 AfterRegister")
		require.Len(t, spy.loginUIDs, 1)
	})
}
