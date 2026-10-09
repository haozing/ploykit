package http_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	httplib "github.com/haozing/ploykit/identity/adapters/http"
	"github.com/haozing/ploykit/identity/app"
	"github.com/haozing/ploykit/platform/webx"
)

type fedHttpProvider struct {
	id          app.OAuthIdentity
	gotVerifier string
}

func (p *fedHttpProvider) Name() string { return "oidc_fed" }

func (p *fedHttpProvider) AuthURL(state, _, verifier string) string {
	p.gotVerifier = verifier
	return "https://idp.example.com/authorize?state=" + state
}

func (p *fedHttpProvider) Exchange(_ context.Context, _, _, verifier string) (app.OAuthIdentity, error) {
	p.gotVerifier = verifier
	return p.id, nil
}

type fedHttpResolver struct{ p *fedHttpProvider }

func (f *fedHttpResolver) Resolve(context.Context, string, string, string, string) (app.FedOIDCProvider, error) {
	return f.p, nil
}

type fedHttpRepo struct {
	app.Repo
	fed     map[string]*app.FedProviderRow
	slug    map[string]string
	secrets map[string]string
	links   []string
	upserts int
}

func newFedHttpRepo() *fedHttpRepo {
	return &fedHttpRepo{fed: map[string]*app.FedProviderRow{}, slug: map[string]string{}, secrets: map[string]string{}}
}

func (f *fedHttpRepo) GetFedProvider(_ context.Context, wsID string) (*app.FedProviderRow, bool, error) {
	row, ok := f.fed[wsID]
	return row, ok, nil
}

func (f *fedHttpRepo) UpsertFedProvider(_ context.Context, row *app.FedProviderRow, _ time.Time) error {
	f.fed[row.WorkspaceID] = row
	f.secrets[row.WorkspaceID] = row.ClientSecret
	return nil
}

func (f *fedHttpRepo) DeleteFedProvider(_ context.Context, wsID string) error {
	if _, ok := f.fed[wsID]; !ok {
		return app.ErrNotFound
	}
	delete(f.fed, wsID)
	return nil
}

func (f *fedHttpRepo) FindOAuthAccount(context.Context, string, string) (string, bool, error) {
	return "", false, nil
}

func (f *fedHttpRepo) LinkOAuthAccount(_ context.Context, provider, _, _, _ string, _ time.Time) error {
	f.links = append(f.links, provider)
	return nil
}

func (f *fedHttpRepo) GetUserByEmail(context.Context, string) (app.User, bool, error) {
	return app.User{}, false, nil
}

func (f *fedHttpRepo) GetUser(_ context.Context, id string) (app.User, error) {
	return app.User{ID: id, Email: "fed-http@example.com", Status: "active"}, nil
}

func (f *fedHttpRepo) UpsertUserByEmail(_ context.Context, email string, _ time.Time) (app.User, error) {
	f.upserts++
	return app.User{ID: "u-fed-http", Email: email, Status: "active"}, nil
}

func (f *fedHttpRepo) SetEmailVerified(context.Context, string, time.Time) error { return nil }

const fedWs = "ws-http-1"

type fedPassSecrets struct{}

func (fedPassSecrets) Seal(p string) (string, error)   { return p, nil }
func (fedPassSecrets) Unseal(s string) (string, error) { return s, nil }

func allowAllGuard(next http.Handler) http.Handler { return next }

func newFedMux(repo *fedHttpRepo, guard func(http.Handler) http.Handler) (*http.ServeMux, *app.FedService) {
	svc := app.NewFedService(repo,
		func(_ context.Context, slug string) (string, bool, error) {
			id, ok := repo.slug[slug]
			return id, ok, nil
		},
		&fedHttpResolver{p: &fedHttpProvider{id: app.OAuthIdentity{
			Provider: "oidc_fed", Subject: "sub-http", Email: "fed-http@example.com", EmailVerified: true,
		}}},
		func() time.Time { return time.Now().UTC() },
		app.WithSecrets(fedPassSecrets{}))
	mux := http.NewServeMux()
	httplib.Mount(mux, httplib.Deps{
		AuthCfg: webx.DefaultAuthConfig(), Sessions: &fakeSessionStore{}, Fed: svc, OAuthAppURL: "http://localhost:5173",
	})
	httplib.MountFedAdmin(mux, httplib.Deps{Fed: svc, FedAdminGuard: guard})
	return mux, svc
}

func fedGet(mux *http.ServeMux, path string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodGet, path, nil)
	for _, c := range cookies {
		r.AddCookie(c)
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	return w
}

func fedRoleGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Header.Get("X-Role") {
		case "owner", "admin":
			next.ServeHTTP(w, r)
		default:
			webx.ErrForbidden(w, "workspace admin required")
		}
	})
}

func TestFedRoutes_NilService(t *testing.T) {
	mux := http.NewServeMux()
	httplib.Mount(mux, httplib.Deps{})
	httplib.MountFedAdmin(mux, httplib.Deps{FedAdminGuard: allowAllGuard})

	for _, path := range []string{"/auth/fed/start?workspace=acme", "/auth/fed/callback?code=c&state=s"} {
		w := fedGet(mux, path)
		assert.Equal(t, http.StatusServiceUnavailable, w.Code, path)
		code, _ := errEnvelope(t, w)
		assert.Equal(t, "E_UNAVAILABLE", code, path)
	}
	w := fedGet(mux, "/api/workspaces/w1/sso")
	assert.Equal(t, http.StatusServiceUnavailable, w.Code, "FedAdmin 在 Fed=nil 时 503")
}

func TestFedStartRoute(t *testing.T) {
	repo := newFedHttpRepo()
	repo.slug["acme"] = fedWs
	repo.fed[fedWs] = &app.FedProviderRow{
		WorkspaceID: fedWs, IssuerURL: "https://idp.example.com",
		ClientID: "cid", ClientSecret: "sec", Scopes: "openid email profile",
	}
	mux, _ := newFedMux(repo, allowAllGuard)

	t.Run("成功 302 IdP + 种 tk_fed_oauth", func(t *testing.T) {
		w := fedGet(mux, "/auth/fed/start?workspace=acme")
		require.Equal(t, http.StatusFound, w.Code)
		assert.Contains(t, w.Header().Get("Location"), "https://idp.example.com/authorize?state=")
		cookies := w.Result().Cookies()
		require.NotEmpty(t, cookies, "start 必须种 state+verifier cookie")
		var fed *http.Cookie
		for _, c := range cookies {
			if c.Name == "tk_fed_oauth" {
				fed = c
			}
		}
		require.NotNil(t, fed, "必须种 tk_fed_oauth")
		assert.True(t, fed.HttpOnly)
		assert.Equal(t, http.SameSiteLaxMode, fed.SameSite)
	})

	t.Run("缺 workspace 参数 → 400 E_VALIDATION", func(t *testing.T) {
		w := fedGet(mux, "/auth/fed/start")
		require.Equal(t, http.StatusBadRequest, w.Code)
		code, _ := errEnvelope(t, w)
		assert.Equal(t, "E_VALIDATION", code)
	})

	t.Run("未知 slug → 404 E_NOT_FOUND", func(t *testing.T) {
		w := fedGet(mux, "/auth/fed/start?workspace=ghost")
		require.Equal(t, http.StatusNotFound, w.Code)
		code, _ := errEnvelope(t, w)
		assert.Equal(t, "E_NOT_FOUND", code)
	})
}

func TestFedCallbackRoute(t *testing.T) {
	repo := newFedHttpRepo()
	repo.slug["acme"] = fedWs
	repo.fed[fedWs] = &app.FedProviderRow{
		WorkspaceID: fedWs, IssuerURL: "https://idp.example.com",
		ClientID: "cid", ClientSecret: "sec", Scopes: "openid email profile",
	}
	sessions := &fakeSessionStore{}
	svc := app.NewFedService(repo,
		func(_ context.Context, slug string) (string, bool, error) {
			id, ok := repo.slug[slug]
			return id, ok, nil
		},
		&fedHttpResolver{p: &fedHttpProvider{id: app.OAuthIdentity{
			Provider: "oidc_fed", Subject: "sub-http", Email: "fed-http@example.com", EmailVerified: true,
		}}},
		func() time.Time { return time.Now().UTC() }, app.WithSecrets(fedPassSecrets{}))
	mux := http.NewServeMux()
	httplib.Mount(mux, httplib.Deps{
		AuthCfg: webx.DefaultAuthConfig(), Sessions: sessions, Fed: svc, OAuthAppURL: "http://localhost:5173",
	})

	wStart := fedGet(mux, "/auth/fed/start?workspace=acme")
	require.Equal(t, http.StatusFound, wStart.Code)
	var ck *http.Cookie
	for _, c := range wStart.Result().Cookies() {
		if c.Name == "tk_fed_oauth" {
			ck = c
		}
	}
	require.NotNil(t, ck)
	loc := wStart.Header().Get("Location")
	state := strings.TrimPrefix(loc, "https://idp.example.com/authorize?state=")

	w := fedGet(mux, "/auth/fed/callback?code=c-1&state="+state, ck)
	require.Equal(t, http.StatusFound, w.Code)
	assert.Equal(t, "http://localhost:5173/app", w.Header().Get("Location"))
	assert.Equal(t, 1, sessions.calls, "成功回调必须签发一次会话")
	assert.Equal(t, "u-fed-http", sessions.lastUserID)
	assert.Equal(t, []string{"oidc_fed:" + fedWs}, repo.links, "关联 key 必须带工作区")

	var cleared *http.Cookie
	for _, c := range w.Result().Cookies() {
		if c.Name == "tk_fed_oauth" {
			cleared = c
		}
	}
	require.NotNil(t, cleared, "回调后必须作废 tk_fed_oauth")
	assert.Equal(t, -1, cleared.MaxAge)
}

func TestFedCallbackRoute_FailureRedirect(t *testing.T) {
	repo := newFedHttpRepo()
	repo.slug["acme"] = fedWs
	repo.fed[fedWs] = &app.FedProviderRow{WorkspaceID: fedWs, IssuerURL: "https://idp.example.com"}
	sessions := &fakeSessionStore{}
	svc := app.NewFedService(repo,
		func(_ context.Context, slug string) (string, bool, error) {
			id, ok := repo.slug[slug]
			return id, ok, nil
		},
		&fedHttpResolver{p: &fedHttpProvider{}},
		func() time.Time { return time.Now().UTC() }, app.WithSecrets(fedPassSecrets{}))
	mux := http.NewServeMux()
	httplib.Mount(mux, httplib.Deps{
		AuthCfg: webx.DefaultAuthConfig(), Sessions: sessions, Fed: svc, OAuthAppURL: "http://localhost:5173",
	})

	wStart := fedGet(mux, "/auth/fed/start?workspace=acme")
	var ck *http.Cookie
	for _, c := range wStart.Result().Cookies() {
		if c.Name == "tk_fed_oauth" {
			ck = c
		}
	}
	require.NotNil(t, ck)
	w := fedGet(mux, "/auth/fed/callback?code=c&state=forged", ck)
	require.Equal(t, http.StatusFound, w.Code)
	assert.Equal(t, "http://localhost:5173/login?error=fed", w.Header().Get("Location"))
	assert.Zero(t, sessions.calls)
	for _, c := range w.Result().Cookies() {
		if c.Name == "tk_fed_oauth" {
			assert.Equal(t, -1, c.MaxAge, "失败也必须作废 cookie")
		}
	}
}

func TestFedAdminRoutes(t *testing.T) {
	repo := newFedHttpRepo()
	mux, _ := newFedMux(repo, fedRoleGuard)

	do := func(method, path, body string, role string) *httptest.ResponseRecorder {
		var rd *strings.Reader
		if body == "" {
			rd = strings.NewReader("")
		} else {
			rd = strings.NewReader(body)
		}
		r := httptest.NewRequest(method, path, rd)
		if body != "" {
			r.Header.Set("Content-Type", "application/json")
		}
		if role != "" {
			r.Header.Set("X-Role", role)
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}

	t.Run("Guard 拦截：member/匿名 → 403 且不触仓储", func(t *testing.T) {
		for _, role := range []string{"", "member"} {
			w := do(http.MethodPut, "/api/workspaces/w1/sso",
				`{"issuer_url":"https://idp.example.com","client_id":"c","client_secret":"s"}`, role)
			assert.Equal(t, http.StatusForbidden, w.Code, "role=%q", role)
		}
		assert.Empty(t, repo.fed, "被拒请求不得落库")
	})

	t.Run("PUT owner：落库真实 secret，响应脱敏 ***", func(t *testing.T) {
		w := do(http.MethodPut, "/api/workspaces/"+fedWs+"/sso",
			`{"issuer_url":"https://idp.example.com/","client_id":"cid-1","client_secret":"sec-1","scopes":"openid email"}`, "owner")
		require.Equal(t, http.StatusOK, w.Code)
		var body struct {
			IssuerURL    string `json:"issuer_url"`
			ClientID     string `json:"client_id"`
			ClientSecret string `json:"client_secret"`
			Scopes       string `json:"scopes"`
			WorkspaceID  string `json:"workspace_id"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		assert.Equal(t, "***", body.ClientSecret, "响应必须脱敏")
		assert.Equal(t, "https://idp.example.com", body.IssuerURL, "尾斜杠已归一")
		assert.Equal(t, "openid email", body.Scopes)
		assert.Equal(t, fedWs, body.WorkspaceID)
		require.Len(t, repo.secrets, 1)
		assert.Equal(t, "sec-1", repo.secrets[fedWs], "落库必须是真实 secret")
	})

	t.Run("PUT 非法 issuer → 400 E_VALIDATION", func(t *testing.T) {
		w := do(http.MethodPut, "/api/workspaces/"+fedWs+"/sso",
			`{"issuer_url":"not-a-url","client_id":"c","client_secret":"s"}`, "admin")
		assert.Equal(t, http.StatusBadRequest, w.Code)
		code, _ := errEnvelope(t, w)
		assert.Equal(t, "E_VALIDATION", code)
	})

	t.Run("GET admin：读回脱敏", func(t *testing.T) {
		w := do(http.MethodGet, "/api/workspaces/"+fedWs+"/sso", "", "admin")
		require.Equal(t, http.StatusOK, w.Code)
		assert.Contains(t, w.Body.String(), `"client_secret":"***"`)
		assert.NotContains(t, w.Body.String(), "sec-1")
	})

	t.Run("GET 未配置 → 404 E_NOT_FOUND", func(t *testing.T) {
		w := do(http.MethodGet, "/api/workspaces/none/sso", "", "owner")
		assert.Equal(t, http.StatusNotFound, w.Code)
		code, _ := errEnvelope(t, w)
		assert.Equal(t, "E_NOT_FOUND", code)
	})

	t.Run("DELETE → 200 ok；再删 → 404", func(t *testing.T) {
		w := do(http.MethodDelete, "/api/workspaces/"+fedWs+"/sso", "", "owner")
		require.Equal(t, http.StatusOK, w.Code)
		assert.Contains(t, w.Body.String(), `"status":"ok"`)
		w = do(http.MethodDelete, "/api/workspaces/"+fedWs+"/sso", "", "owner")
		assert.Equal(t, http.StatusNotFound, w.Code)
	})
}

func TestMountFedAdminRequiresGuard_P2_11(t *testing.T) {
	assert.PanicsWithValue(t,
		"identity: MountFedAdmin requires Deps.FedAdminGuard (workspace owner/admin closure); nil guard would expose tenant SSO secrets",
		func() { httplib.MountFedAdmin(http.NewServeMux(), httplib.Deps{Fed: nil}) },
		"Guard 缺失必须在装配期 panic（租户 SSO 密钥面不可静默失守）")
}
