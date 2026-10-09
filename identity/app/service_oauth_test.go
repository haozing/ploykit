package app_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/identity/app"
	"github.com/haozing/ploykit/platform/webx"
)

type fakeOAuthProvider struct {
	name                    string
	id                      app.OAuthIdentity
	exchangeErr             error
	gotCode, gotRedirectURI string
	exchanges               int
}

func (f *fakeOAuthProvider) Name() string { return f.name }

func (f *fakeOAuthProvider) AuthURL(state, redirectURI string) string {
	return "https://" + f.name + ".example/authorize?state=" + state
}

func (f *fakeOAuthProvider) Exchange(_ context.Context, code, redirectURI string) (app.OAuthIdentity, error) {
	f.exchanges++
	f.gotCode, f.gotRedirectURI = code, redirectURI
	return f.id, f.exchangeErr
}

type oauthFakeRepo struct {
	app.Repo
	users map[string]app.User
	byID  map[string]app.User
	links map[string]string

	upserts     int
	setVerified []string
	linkCalls   []linkCall
}

type linkCall struct {
	provider, subject, userID, emailAtLink string
}

func newOAuthFakeRepo(users ...app.User) *oauthFakeRepo {
	f := &oauthFakeRepo{users: map[string]app.User{}, byID: map[string]app.User{}, links: map[string]string{}}
	for _, u := range users {
		f.users[u.Email] = u
		f.byID[u.ID] = u
	}
	return f
}

func (f *oauthFakeRepo) FindOAuthAccount(_ context.Context, provider, subject string) (string, bool, error) {
	uid, ok := f.links[provider+"|"+subject]
	return uid, ok, nil
}

func (f *oauthFakeRepo) LinkOAuthAccount(_ context.Context, provider, subject, userID, emailAtLink string, _ time.Time) error {
	if _, exists := f.links[provider+"|"+subject]; !exists {
		f.links[provider+"|"+subject] = userID
	}
	f.linkCalls = append(f.linkCalls, linkCall{provider, subject, userID, emailAtLink})
	return nil
}

func (f *oauthFakeRepo) GetUserByEmail(_ context.Context, email string) (app.User, bool, error) {
	u, ok := f.users[email]
	return u, ok, nil
}

func (f *oauthFakeRepo) GetUser(_ context.Context, id string) (app.User, error) {
	u, ok := f.byID[id]
	if !ok || u.Status != "active" {
		return app.User{}, app.ErrNotFound
	}
	return u, nil
}

func (f *oauthFakeRepo) UpsertUserByEmail(_ context.Context, email string, _ time.Time) (app.User, error) {
	f.upserts++
	if u, ok := f.users[email]; ok {
		return u, nil
	}
	u := app.User{ID: "new-" + email, Email: email, Status: "active"}
	f.users[email] = u
	f.byID[u.ID] = u
	return u, nil
}

func (f *oauthFakeRepo) SetEmailVerified(_ context.Context, userID string, _ time.Time) error {
	f.setVerified = append(f.setVerified, userID)
	return nil
}

var frozenOAuth = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

func newOAuthSvc(repo app.Repo, providers ...app.OAuthProvider) *app.OAuthService {
	return app.NewOAuthService(repo, providers, func() time.Time { return frozenOAuth })
}

func TestOAuthStart_RedirectAndStateCookie(t *testing.T) {
	p := &fakeOAuthProvider{name: "github"}
	svc := newOAuthSvc(newOAuthFakeRepo(), p)

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/auth/oauth/github/start", nil)
	r.Host = "app.example.com"
	require.NoError(t, svc.Start(w, r, "github"))

	require.Equal(t, http.StatusFound, w.Code)
	loc := w.Header().Get("Location")
	require.Contains(t, loc, "https://github.example/authorize?state=")

	require.Len(t, w.Result().Cookies(), 1)
	ck := w.Result().Cookies()[0]
	assert.Equal(t, "tk_oauth_state", ck.Name)
	assert.True(t, ck.HttpOnly)
	assert.Equal(t, http.SameSiteLaxMode, ck.SameSite)
	assert.Equal(t, 600, ck.MaxAge)
	assert.Equal(t, "/", ck.Path)
	assert.Len(t, ck.Value, 64, "state 为 32 字节 hex")
	assert.Contains(t, loc, "state="+ck.Value, "Location 必须携带同一 state")
}

func TestOAuthStart_ProviderNotConfigured(t *testing.T) {
	svc := newOAuthSvc(newOAuthFakeRepo(), &fakeOAuthProvider{name: "github"})
	err := svc.Start(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/auth/oauth/google/start", nil), "google")
	var we *webx.Error
	require.ErrorAs(t, err, &we)
	assert.Equal(t, http.StatusServiceUnavailable, we.Status)
	assert.Equal(t, webx.CodeUnavailable, we.Code)
}

func TestOAuthService_Names(t *testing.T) {
	svc := newOAuthSvc(newOAuthFakeRepo(),
		&fakeOAuthProvider{name: "github"}, &fakeOAuthProvider{name: "google"})
	assert.Equal(t, []string{"github", "google"}, svc.Names())
}

func oauthCallbackReq(provider string, cookieState, queryState string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/auth/oauth/"+provider+"/callback?code=c1&state="+queryState, nil)
	if cookieState != "" {
		r.AddCookie(&http.Cookie{Name: "tk_oauth_state", Value: cookieState})
	}
	return r
}

func TestOAuthCallback_LinkingBranches(t *testing.T) {
	linked := app.User{ID: "u-linked", Email: "linked@example.com", Status: "active"}
	existing := app.User{ID: "u-existing", Email: "existing@example.com", Status: "active"}
	disabled := app.User{ID: "u-disabled", Email: "disabled@example.com", Status: "disabled"}

	tests := []struct {
		name    string
		repo    *oauthFakeRepo
		id      app.OAuthIdentity
		wantUID string
		check   func(t *testing.T, repo *oauthFakeRepo, p *fakeOAuthProvider)
	}{
		{"分支① 已关联直接登录", func() *oauthFakeRepo {
			f := newOAuthFakeRepo(linked)
			f.links["github|subj-1"] = "u-linked"
			return f
		}(), app.OAuthIdentity{Provider: "github", Subject: "subj-1", Email: "other@example.com", EmailVerified: true},
			"u-linked",
			func(t *testing.T, repo *oauthFakeRepo, _ *fakeOAuthProvider) {
				assert.Zero(t, repo.upserts, "已关联时不得建号")
				assert.Empty(t, repo.linkCalls, "已关联时不得重复 Link")
			}},
		{"分支② 同邮箱既有用户 JIT 关联", newOAuthFakeRepo(existing),
			app.OAuthIdentity{Provider: "github", Subject: "subj-2", Email: "existing@example.com", EmailVerified: true},
			"u-existing",
			func(t *testing.T, repo *oauthFakeRepo, _ *fakeOAuthProvider) {
				require.Len(t, repo.linkCalls, 1)
				assert.Equal(t, linkCall{"github", "subj-2", "u-existing", "existing@example.com"}, repo.linkCalls[0])
				assert.Zero(t, repo.upserts)
			}},
		{"分支③ 全新用户 JIT 建号+验证+关联", newOAuthFakeRepo(),
			app.OAuthIdentity{Provider: "google", Subject: "g-1", Email: "fresh@example.com", EmailVerified: true},
			"new-fresh@example.com",
			func(t *testing.T, repo *oauthFakeRepo, _ *fakeOAuthProvider) {
				assert.Equal(t, 1, repo.upserts)
				assert.Equal(t, []string{"new-fresh@example.com"}, repo.setVerified, "OAuth 邮箱视为已验证")
				require.Len(t, repo.linkCalls, 1)
				assert.Equal(t, "google", repo.linkCalls[0].provider)
				assert.Equal(t, "fresh@example.com", repo.linkCalls[0].emailAtLink)
			}},
		{"分支② 既有用户已禁用 → 403", newOAuthFakeRepo(disabled),
			app.OAuthIdentity{Provider: "github", Subject: "subj-d", Email: "disabled@example.com", EmailVerified: true},
			"", func(t *testing.T, _ *oauthFakeRepo, _ *fakeOAuthProvider) {}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := &fakeOAuthProvider{name: tt.id.Provider, id: tt.id}
			svc := newOAuthSvc(tt.repo, p)
			res, err := svc.Callback(context.Background(), oauthCallbackReq(tt.id.Provider, "st-abc", "st-abc"), tt.id.Provider, "c1", "st-abc", nil)
			if tt.wantUID == "" {
				var we *webx.Error
				require.ErrorAs(t, err, &we)
				assert.Equal(t, http.StatusForbidden, we.Status)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.wantUID, res.UserID)
			assert.Equal(t, tt.id.Email, res.Email, "断言邮箱随结果带回（OnLoginFailed/记账用）")
			assert.Equal(t, "c1", p.gotCode)
			assert.Equal(t, "http://example.com/auth/oauth/"+tt.id.Provider+"/callback", p.gotRedirectURI,
				"redirectURI = 请求 origin + /auth/oauth/{p}/callback")
			tt.check(t, tt.repo, p)
		})
	}
}

func TestOAuthCallback_UnverifiedEmailForbidden_I1(t *testing.T) {
	tests := []struct {
		name string
		repo *oauthFakeRepo
		id   app.OAuthIdentity
	}{
		{"分支② 未验证邮箱指向既有用户 → 403 不关联", newOAuthFakeRepo(
			app.User{ID: "u-victim", Email: "victim@corp.com", Status: "active"}),
			app.OAuthIdentity{Provider: "github", Subject: "atk-1", Email: "victim@corp.com", EmailVerified: false}},
		{"分支③ 未验证邮箱全新用户 → 403 不建号", newOAuthFakeRepo(),
			app.OAuthIdentity{Provider: "google", Subject: "atk-2", Email: "fresh@corp.com", EmailVerified: false}},
		{"分支① 已关联但本次断言未验证 → 403（入口闸门不分分支）", func() *oauthFakeRepo {
			f := newOAuthFakeRepo(app.User{ID: "u-x", Email: "x@corp.com", Status: "active"})
			f.links["github|atk-3"] = "u-x"
			return f
		}(),
			app.OAuthIdentity{Provider: "github", Subject: "atk-3", Email: "x@corp.com", EmailVerified: false}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := &fakeOAuthProvider{name: tt.id.Provider, id: tt.id}
			svc := newOAuthSvc(tt.repo, p)
			_, err := svc.Callback(context.Background(), oauthCallbackReq(tt.id.Provider, "st", "st"), tt.id.Provider, "c1", "st", nil)
			var we *webx.Error
			require.ErrorAs(t, err, &we)
			assert.Equal(t, http.StatusForbidden, we.Status)
			assert.Empty(t, tt.repo.linkCalls, "未验证邮箱不得产生 LinkOAuthAccount 调用")
			assert.Zero(t, tt.repo.upserts, "未验证邮箱不得 JIT 建号")
		})
	}

}

func TestOAuthStart_SecureCookieFlag_I5(t *testing.T) {
	p := &fakeOAuthProvider{name: "github"}

	svc := newOAuthSvc(newOAuthFakeRepo(), p).WithSecureCookie(true)
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/auth/oauth/github/start", nil)
	require.NoError(t, svc.Start(w, r, "github"))
	ck := w.Result().Cookies()[0]
	assert.True(t, ck.Secure, "HTTPS 部署下 state cookie 必须带 Secure")

	svc = newOAuthSvc(newOAuthFakeRepo(), p)
	w = httptest.NewRecorder()
	require.NoError(t, svc.Start(w, r, "github"))
	ck = w.Result().Cookies()[0]
	assert.False(t, ck.Secure, "默认不注入 = 保持现状（false）")
}

func TestOAuthCallback_StateAndProviderErrors(t *testing.T) {
	id := app.OAuthIdentity{Provider: "github", Subject: "s", Email: "a@example.com", EmailVerified: true}

	t.Run("state cookie 缺失 → E_VALIDATION", func(t *testing.T) {
		svc := newOAuthSvc(newOAuthFakeRepo(), &fakeOAuthProvider{name: "github", id: id})
		_, err := svc.Callback(context.Background(), oauthCallbackReq("github", "", "st-abc"), "github", "c", "st-abc", nil)
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusBadRequest, we.Status)
		assert.Equal(t, webx.CodeValidation, we.Code)
	})

	t.Run("state 不匹配 → E_VALIDATION", func(t *testing.T) {
		svc := newOAuthSvc(newOAuthFakeRepo(), &fakeOAuthProvider{name: "github", id: id})
		_, err := svc.Callback(context.Background(), oauthCallbackReq("github", "st-real", "st-forged"), "github", "c", "st-forged", nil)
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, webx.CodeValidation, we.Code)
	})

	t.Run("provider 未配置 → 503 E_UNAVAILABLE", func(t *testing.T) {
		svc := newOAuthSvc(newOAuthFakeRepo(), &fakeOAuthProvider{name: "github", id: id})
		_, err := svc.Callback(context.Background(), oauthCallbackReq("google", "st", "st"), "google", "c", "st", nil)
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusServiceUnavailable, we.Status)
		assert.Equal(t, webx.CodeUnavailable, we.Code)
	})

	t.Run("提供商邮箱非法 → E_VALIDATION", func(t *testing.T) {
		svc := newOAuthSvc(newOAuthFakeRepo(), &fakeOAuthProvider{name: "github",
			id: app.OAuthIdentity{Provider: "github", Subject: "s", Email: "not-an-email"}})
		_, err := svc.Callback(context.Background(), oauthCallbackReq("github", "st", "st"), "github", "c", "st", nil)
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, webx.CodeValidation, we.Code)
	})

	t.Run("Exchange 失败透传", func(t *testing.T) {
		svc := newOAuthSvc(newOAuthFakeRepo(), &fakeOAuthProvider{name: "github", exchangeErr: assert.AnError})
		_, err := svc.Callback(context.Background(), oauthCallbackReq("github", "st", "st"), "github", "c", "st", nil)
		require.ErrorIs(t, err, assert.AnError)
	})
}
