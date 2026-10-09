package http_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	httplib "github.com/haozing/ploykit/identity/adapters/http"
	"github.com/haozing/ploykit/identity/app"
	"github.com/haozing/ploykit/platform/webx"
)

type oauthProviderStub struct {
	name string
}

func (o oauthProviderStub) Name() string { return o.name }

func (o oauthProviderStub) AuthURL(state, _ string) string {
	return "https://" + o.name + ".example/authorize?state=" + state
}

func (o oauthProviderStub) Exchange(_ context.Context, _, _ string) (app.OAuthIdentity, error) {
	return app.OAuthIdentity{
		Provider: o.name, Subject: "subj-1",
		Email: "oauth-http@example.com", Name: "O Auth", EmailVerified: true,
	}, nil
}

type oauthRepoStub struct {
	app.Repo
	upsertedEmail string
	linked        bool
}

func (f *oauthRepoStub) FindOAuthAccount(context.Context, string, string) (string, bool, error) {
	return "", false, nil
}

func (f *oauthRepoStub) LinkOAuthAccount(_ context.Context, _, _, _, _ string, _ time.Time) error {
	f.linked = true
	return nil
}

func (f *oauthRepoStub) GetUserByEmail(context.Context, string) (app.User, bool, error) {
	return app.User{}, false, nil
}

func (f *oauthRepoStub) GetUser(_ context.Context, id string) (app.User, error) {
	return app.User{ID: id, Email: "oauth-http@example.com", Status: "active"}, nil
}

func (f *oauthRepoStub) UpsertUserByEmail(_ context.Context, email string, _ time.Time) (app.User, error) {
	f.upsertedEmail = email
	return app.User{ID: "u-oauth-http", Email: email, Status: "active"}, nil
}

func (f *oauthRepoStub) SetEmailVerified(context.Context, string, time.Time) error { return nil }

type fakeSessionStore struct {
	webx.SessionStore
	calls      int
	lastUserID string
}

func (f *fakeSessionStore) CreateSession(_ context.Context, userID, _, _ string, _ time.Time) (string, time.Time, error) {
	f.calls++
	f.lastUserID = userID
	return "sess-tok-1", time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC), nil
}

func oauthMux(sessions webx.SessionStore, oauth *app.OAuthService) *http.ServeMux {
	mux := http.NewServeMux()
	httplib.Mount(mux, httplib.Deps{
		AuthCfg:     webx.DefaultAuthConfig(),
		Sessions:    sessions,
		OAuth:       oauth,
		OAuthAppURL: "http://localhost:5173",
	})
	return mux
}

func oauthGet(mux *http.ServeMux, path string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodGet, path, nil)
	for _, c := range cookies {
		r.AddCookie(c)
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	return w
}

func TestOAuthRoutes_NilService(t *testing.T) {
	mux := oauthMux(&fakeSessionStore{}, nil)
	for _, path := range []string{"/auth/oauth/github/start", "/auth/oauth/github/callback?code=c&state=s"} {
		w := oauthGet(mux, path)
		assert.Equal(t, http.StatusServiceUnavailable, w.Code, path)
		code, _ := errEnvelope(t, w)
		assert.Equal(t, "E_UNAVAILABLE", code, path)
	}
}

func TestOAuthStart_Redirect(t *testing.T) {
	oauth := app.NewOAuthService(&oauthRepoStub{}, []app.OAuthProvider{oauthProviderStub{name: "github"}},
		func() time.Time { return time.Now().UTC() })
	w := oauthGet(oauthMux(&fakeSessionStore{}, oauth), "/auth/oauth/github/start")

	require.Equal(t, http.StatusFound, w.Code)
	loc := w.Header().Get("Location")
	assert.Contains(t, loc, "https://github.example/authorize?state=")
	assert.NotEmpty(t, w.Result().Cookies(), "start 必须种 state cookie")
}

func TestOAuthCallback_Success(t *testing.T) {
	repo := &oauthRepoStub{}
	oauth := app.NewOAuthService(repo, []app.OAuthProvider{oauthProviderStub{name: "github"}},
		func() time.Time { return time.Now().UTC() })
	sessions := &fakeSessionStore{}
	w := oauthGet(oauthMux(sessions, oauth), "/auth/oauth/github/callback?code=c&state=st1",
		&http.Cookie{Name: "tk_oauth_state", Value: "st1"})

	require.Equal(t, http.StatusFound, w.Code)
	assert.Equal(t, "http://localhost:5173/app", w.Header().Get("Location"))
	assert.Equal(t, 1, sessions.calls, "成功回调必须签发一次会话")
	assert.Equal(t, "u-oauth-http", sessions.lastUserID)
	assert.True(t, repo.linked, "全新身份必须落关联行")

	var auth, state *http.Cookie
	for _, c := range w.Result().Cookies() {
		switch c.Name {
		case "tk_auth":
			auth = c
		case "tk_oauth_state":
			state = c
		}
	}
	require.NotNil(t, auth, "必须写会话 cookie")
	assert.Equal(t, "sess-tok-1", auth.Value)
	require.NotNil(t, state, "必须清除 state cookie")
	assert.Equal(t, -1, state.MaxAge)
}

func TestOAuthCallback_FailureRedirectsToLogin(t *testing.T) {
	oauth := app.NewOAuthService(&oauthRepoStub{}, []app.OAuthProvider{oauthProviderStub{name: "github"}},
		func() time.Time { return time.Now().UTC() })
	sessions := &fakeSessionStore{}

	w := oauthGet(oauthMux(sessions, oauth), "/auth/oauth/github/callback?code=c&state=st-forged",
		&http.Cookie{Name: "tk_oauth_state", Value: "st-real"})
	require.Equal(t, http.StatusFound, w.Code)
	assert.Equal(t, "http://localhost:5173/login?error=oauth", w.Header().Get("Location"))
	assert.Zero(t, sessions.calls)

	w = oauthGet(oauthMux(sessions, oauth), "/auth/oauth/github/callback?code=c&state=st")
	require.Equal(t, http.StatusFound, w.Code)
	assert.Equal(t, "http://localhost:5173/login?error=oauth", w.Header().Get("Location"))
	assert.Zero(t, sessions.calls)
}
