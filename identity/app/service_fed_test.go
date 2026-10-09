package app_test

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/identity/app"
	"github.com/haozing/ploykit/platform/sealx"
	"github.com/haozing/ploykit/platform/webx"
)

type fakeFedProvider struct {
	id          app.OAuthIdentity
	exchErr     error
	gotState    string
	gotVerifier string
	gotRedirect string
	authURLs    int
	exchanges   int
}

func (p *fakeFedProvider) Name() string { return "oidc_fed" }

func (p *fakeFedProvider) AuthURL(state, redirectURI, verifier string) string {
	p.authURLs++
	p.gotState, p.gotRedirect, p.gotVerifier = state, redirectURI, verifier
	return "https://idp.example.com/authorize?state=" + state
}

func (p *fakeFedProvider) Exchange(_ context.Context, code, redirectURI, verifier string) (app.OAuthIdentity, error) {
	p.exchanges++
	p.gotRedirect, p.gotVerifier = redirectURI, verifier
	if p.exchErr != nil {
		return app.OAuthIdentity{}, p.exchErr
	}
	return p.id, nil
}

type fakeFedResolver struct {
	p           *fakeFedProvider
	err         error
	gotIssuer   string
	gotClientID string
	gotSecret   string
	gotScopes   string
	resolves    int
}

func (f *fakeFedResolver) Resolve(_ context.Context, issuer, clientID, secret, scopes string) (app.FedOIDCProvider, error) {
	f.resolves++
	f.gotIssuer, f.gotClientID, f.gotSecret, f.gotScopes = issuer, clientID, secret, scopes
	if f.err != nil {
		return nil, f.err
	}
	return f.p, nil
}

type fedFakeRepo struct {
	oauthFakeRepo
	fed  map[string]*app.FedProviderRow
	slug map[string]string
}

func newFedFakeRepo(users ...app.User) *fedFakeRepo {
	return &fedFakeRepo{
		oauthFakeRepo: *newOAuthFakeRepo(users...),
		fed:           map[string]*app.FedProviderRow{},
		slug:          map[string]string{},
	}
}

func (f *fedFakeRepo) GetFedProvider(_ context.Context, workspaceID string) (*app.FedProviderRow, bool, error) {
	row, ok := f.fed[workspaceID]
	return row, ok, nil
}

func (f *fedFakeRepo) UpsertFedProvider(_ context.Context, row *app.FedProviderRow, now time.Time) error {
	cp := *row
	cp.UpdatedAt = now
	f.fed[row.WorkspaceID] = &cp
	return nil
}

func (f *fedFakeRepo) DeleteFedProvider(_ context.Context, workspaceID string) error {
	if _, ok := f.fed[workspaceID]; !ok {
		return app.ErrNotFound
	}
	delete(f.fed, workspaceID)
	return nil
}

var frozenFed = time.Date(2026, 2, 2, 0, 0, 0, 0, time.UTC)

const fedWsID = "ws-fed-1"

type passSecrets struct{}

func (passSecrets) Seal(p string) (string, error)   { return p, nil }
func (passSecrets) Unseal(s string) (string, error) { return s, nil }

func newFedSvc(repo *fedFakeRepo, resolver app.FedResolver) *app.FedService {
	return app.NewFedService(repo, repo.slugLookup, resolver,
		func() time.Time { return frozenFed }, app.WithSecrets(passSecrets{}))
}

func (f *fedFakeRepo) slugLookup(_ context.Context, slug string) (string, bool, error) {
	id, ok := f.slug[slug]
	return id, ok, nil
}

func seedFedConfig(repo *fedFakeRepo) {
	repo.slug["acme"] = fedWsID
	repo.fed[fedWsID] = &app.FedProviderRow{
		WorkspaceID: fedWsID, IssuerURL: "https://idp.example.com",
		ClientID: "cid", ClientSecret: "sec", Scopes: "openid email profile",
	}
}

func fedCookieValue(t *testing.T, s, v, w string) string {
	t.Helper()
	raw, err := json.Marshal(struct {
		S string `json:"s"`
		V string `json:"v"`
		W string `json:"w"`
	}{S: s, V: v, W: w})
	require.NoError(t, err)
	return base64.RawURLEncoding.EncodeToString(raw)
}

func parseFedCookie(t *testing.T, value string) (s, v, w string) {
	t.Helper()
	raw, err := base64.RawURLEncoding.DecodeString(value)
	require.NoError(t, err, "cookie 值必须是 base64url(JSON)")
	var fc struct {
		S string `json:"s"`
		V string `json:"v"`
		W string `json:"w"`
	}
	require.NoError(t, json.Unmarshal(raw, &fc))
	return fc.S, fc.V, fc.W
}

func TestFedStart_RedirectAndCookie(t *testing.T) {
	repo := newFedFakeRepo()
	seedFedConfig(repo)
	fp := &fakeFedProvider{}
	svc := newFedSvc(repo, &fakeFedResolver{p: fp})

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/auth/fed/start?workspace=acme", nil)
	r.Host = "app.example.com"
	require.NoError(t, svc.Start(w, r, "acme"))

	require.Equal(t, http.StatusFound, w.Code)
	loc := w.Header().Get("Location")

	require.Len(t, w.Result().Cookies(), 1)
	ck := w.Result().Cookies()[0]
	assert.Equal(t, "tk_fed_oauth", ck.Name)
	assert.True(t, ck.HttpOnly)
	assert.Equal(t, http.SameSiteLaxMode, ck.SameSite)
	assert.Equal(t, 600, ck.MaxAge)
	assert.Equal(t, "/", ck.Path)

	s, v, ws := parseFedCookie(t, ck.Value)
	assert.Len(t, s, 64, "state 为 32 字节 hex")
	assert.Len(t, v, 64, "verifier 为 64 字符")
	assert.Equal(t, fedWsID, ws, "cookie 携带 workspaceID 供回调查配置")
	assert.Contains(t, loc, "state="+s, "Location 必须携带同一 state")
	assert.Equal(t, v, fp.gotVerifier, "AuthURL 收到同一 verifier（PKCE challenge 派生源）")
	assert.Equal(t, "http://app.example.com/auth/fed/callback", fp.gotRedirect)
}

func TestFedStart_NotFoundBranches(t *testing.T) {
	fp := &fakeFedProvider{}

	t.Run("slug 不存在 → 404 E_NOT_FOUND", func(t *testing.T) {
		repo := newFedFakeRepo()
		svc := newFedSvc(repo, &fakeFedResolver{p: fp})
		err := svc.Start(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/x", nil), "ghost")
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusNotFound, we.Status)
		assert.Equal(t, webx.CodeNotFound, we.Code)
	})
	t.Run("工作区未配置联邦 → 404 E_NOT_FOUND", func(t *testing.T) {
		repo := newFedFakeRepo()
		repo.slug["acme"] = fedWsID
		svc := newFedSvc(repo, &fakeFedResolver{p: fp})
		err := svc.Start(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/x", nil), "acme")
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusNotFound, we.Status)
	})
	t.Run("slug 为空 → 400 E_VALIDATION", func(t *testing.T) {
		repo := newFedFakeRepo()
		svc := newFedSvc(repo, &fakeFedResolver{p: fp})
		err := svc.Start(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/x", nil), "")
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusBadRequest, we.Status)
	})
	t.Run("discovery 失败 → 503 E_UNAVAILABLE", func(t *testing.T) {
		repo := newFedFakeRepo()
		seedFedConfig(repo)
		svc := newFedSvc(repo, &fakeFedResolver{err: assert.AnError})
		err := svc.Start(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/x", nil), "acme")
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusServiceUnavailable, we.Status)
		assert.Equal(t, webx.CodeUnavailable, we.Code)
	})
}

func fedCallbackReq(cookieValue, queryState, code string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/auth/fed/callback?code="+code+"&state="+queryState, nil)
	r.Host = "app.example.com"
	if cookieValue != "" {
		r.AddCookie(&http.Cookie{Name: "tk_fed_oauth", Value: cookieValue})
	}
	return r
}

func TestFedCallback_LinkingBranches(t *testing.T) {
	linked := app.User{ID: "u-linked", Email: "linked@example.com", Status: "active"}
	existing := app.User{ID: "u-existing", Email: "existing@example.com", Status: "active"}
	disabled := app.User{ID: "u-disabled", Email: "disabled@example.com", Status: "disabled"}

	tests := []struct {
		name    string
		repo    *fedFakeRepo
		subj    string
		email   string
		wantUID string
		wantJIT bool
		forbid  bool
		check   func(t *testing.T, repo *fedFakeRepo, fp *fakeFedProvider)
	}{
		{"分支① 已关联（本工作区 key）直接登录", func() *fedFakeRepo {
			f := newFedFakeRepo(linked)
			f.links["oidc_fed:"+fedWsID+"|sub-fed-1"] = "u-linked"
			return f
		}(), "sub-fed-1", "other@example.com", "u-linked", false, false,
			func(t *testing.T, repo *fedFakeRepo, _ *fakeFedProvider) {
				assert.Empty(t, repo.linkCalls, "已关联时不得重复 Link")
				assert.Zero(t, repo.upserts)
			}},
		{"分支② 同邮箱既有用户 JIT 关联（key 带工作区）", newFedFakeRepo(existing),
			"sub-fed-2", "existing@example.com", "u-existing", false, false,
			func(t *testing.T, repo *fedFakeRepo, _ *fakeFedProvider) {
				require.Len(t, repo.linkCalls, 1)
				assert.Equal(t, "oidc_fed:"+fedWsID, repo.linkCalls[0].provider, "provider key 必须是 oidc_fed:workspaceID")
				assert.Equal(t, "sub-fed-2", repo.linkCalls[0].subject)
				assert.Zero(t, repo.upserts)
			}},
		{"分支③ 全新用户 JIT 建号+邮箱直接置为已验证+关联", newFedFakeRepo(),
			"sub-fed-3", "fresh@example.com", "new-fresh@example.com", true, false,
			func(t *testing.T, repo *fedFakeRepo, _ *fakeFedProvider) {
				assert.Equal(t, 1, repo.upserts)
				assert.Equal(t, []string{"new-fresh@example.com"}, repo.setVerified, "联邦邮箱视为已验证（P2 语义）")
				require.Len(t, repo.linkCalls, 1)
				assert.Equal(t, "oidc_fed:"+fedWsID, repo.linkCalls[0].provider)
			}},
		{"分支② 既有用户已禁用 → 403", newFedFakeRepo(disabled),
			"sub-fed-4", "disabled@example.com", "", false, true, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			seedFedConfig(tt.repo)
			fp := &fakeFedProvider{id: app.OAuthIdentity{
				Provider: "oidc_fed", Subject: tt.subj, Email: tt.email, EmailVerified: true,
			}}
			svc := newFedSvc(tt.repo, &fakeFedResolver{p: fp})

			cookie := fedCookieValue(t, "st-real", strings.Repeat("v", 64), fedWsID)
			res, err := svc.Callback(context.Background(), fedCallbackReq(cookie, "st-real", "c-1"), "c-1", "st-real", nil)

			if tt.forbid {
				var we *webx.Error
				require.ErrorAs(t, err, &we)
				assert.Equal(t, http.StatusForbidden, we.Status)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.wantUID, res.UserID)
			assert.Equal(t, tt.wantJIT, res.JITNew, "JIT 标记决定 AfterRegister 触发（P1-2）")
			assert.Equal(t, strings.Repeat("v", 64), fp.gotVerifier, "Exchange 必须收到 cookie 里的 PKCE verifier")
			assert.Equal(t, "http://app.example.com/auth/fed/callback", fp.gotRedirect)
			if tt.check != nil {
				tt.check(t, tt.repo, fp)
			}
		})
	}
}

func TestFedCallback_StateAndConfigErrors(t *testing.T) {
	id := app.OAuthIdentity{Provider: "oidc_fed", Subject: "s", Email: "a@example.com", EmailVerified: true}
	asValidation := func(t *testing.T, err error) {
		t.Helper()
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusBadRequest, we.Status)
		assert.Equal(t, webx.CodeValidation, we.Code)
	}

	t.Run("cookie 缺失 → E_VALIDATION", func(t *testing.T) {
		repo := newFedFakeRepo()
		seedFedConfig(repo)
		svc := newFedSvc(repo, &fakeFedResolver{p: &fakeFedProvider{id: id}})
		_, err := svc.Callback(context.Background(), fedCallbackReq("", "st", "c"), "c", "st", nil)
		asValidation(t, err)
	})
	t.Run("state 不匹配 → E_VALIDATION", func(t *testing.T) {
		repo := newFedFakeRepo()
		seedFedConfig(repo)
		svc := newFedSvc(repo, &fakeFedResolver{p: &fakeFedProvider{id: id}})
		cookie := fedCookieValue(t, "st-real", strings.Repeat("v", 64), fedWsID)
		_, err := svc.Callback(context.Background(), fedCallbackReq(cookie, "st-forged", "c"), "c", "st-forged", nil)
		asValidation(t, err)
	})
	t.Run("cookie 值损坏 → E_VALIDATION", func(t *testing.T) {
		repo := newFedFakeRepo()
		seedFedConfig(repo)
		svc := newFedSvc(repo, &fakeFedResolver{p: &fakeFedProvider{id: id}})
		_, err := svc.Callback(context.Background(), fedCallbackReq("!!!not-base64!!!", "st", "c"), "c", "st", nil)
		asValidation(t, err)
	})
	t.Run("code 为空 → E_VALIDATION", func(t *testing.T) {
		repo := newFedFakeRepo()
		seedFedConfig(repo)
		svc := newFedSvc(repo, &fakeFedResolver{p: &fakeFedProvider{id: id}})
		cookie := fedCookieValue(t, "st", strings.Repeat("v", 64), fedWsID)
		_, err := svc.Callback(context.Background(), fedCallbackReq(cookie, "st", ""), "", "st", nil)
		asValidation(t, err)
	})
	t.Run("配置中途删除 → 404", func(t *testing.T) {
		repo := newFedFakeRepo()
		repo.slug["acme"] = fedWsID
		svc := newFedSvc(repo, &fakeFedResolver{p: &fakeFedProvider{id: id}})
		cookie := fedCookieValue(t, "st", strings.Repeat("v", 64), fedWsID)
		_, err := svc.Callback(context.Background(), fedCallbackReq(cookie, "st", "c"), "c", "st", nil)
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusNotFound, we.Status)
	})
	t.Run("Exchange 失败透传", func(t *testing.T) {
		repo := newFedFakeRepo()
		seedFedConfig(repo)
		svc := newFedSvc(repo, &fakeFedResolver{p: &fakeFedProvider{exchErr: assert.AnError}})
		cookie := fedCookieValue(t, "st", strings.Repeat("v", 64), fedWsID)
		_, err := svc.Callback(context.Background(), fedCallbackReq(cookie, "st", "c"), "c", "st", nil)
		require.ErrorIs(t, err, assert.AnError)
	})
}

func TestFedStart_SecureCookieFlag_I5(t *testing.T) {
	repo := newFedFakeRepo()
	seedFedConfig(repo)
	res := &fakeFedResolver{p: &fakeFedProvider{}}

	svc := newFedSvc(repo, res).WithSecureCookie(true)
	w := httptest.NewRecorder()
	require.NoError(t, svc.Start(w, httptest.NewRequest(http.MethodGet, "/x", nil), "acme"))
	ck := w.Result().Cookies()[0]
	assert.Equal(t, "tk_fed_oauth", ck.Name)
	assert.True(t, ck.Secure, "HTTPS 部署下含 PKCE verifier 的 cookie 必须带 Secure")

	svc = newFedSvc(repo, res)
	w = httptest.NewRecorder()
	require.NoError(t, svc.Start(w, httptest.NewRequest(http.MethodGet, "/x", nil), "acme"))
	ck = w.Result().Cookies()[0]
	assert.False(t, ck.Secure, "默认不注入 = 保持现状（false）")
}

func TestFedAdmin_UpsertValidation(t *testing.T) {
	repo := newFedFakeRepo()
	svc := newFedSvc(repo, &fakeFedResolver{p: &fakeFedProvider{}})
	ctx := context.Background()

	okCases := []struct {
		name, issuerIn, issuerWant, scopesIn, scopesWant string
	}{
		{"尾斜杠 issuer 归一", "https://idp.example.com/", "https://idp.example.com", "", "openid email profile"},
		{"自定义 scopes 保留", "https://idp.example.com", "https://idp.example.com", "openid email", "openid email"},
	}
	for _, tc := range okCases {
		t.Run(tc.name, func(t *testing.T) {
			row, err := svc.UpsertProvider(ctx, fedWsID, tc.issuerIn, "cid", "sec", tc.scopesIn)
			require.NoError(t, err)
			assert.Equal(t, tc.issuerWant, row.IssuerURL)
			assert.Equal(t, tc.scopesWant, row.Scopes)
			assert.Equal(t, frozenFed, row.UpdatedAt)
		})
	}

	for _, tc := range []struct{ name, issuer, cid, sec string }{
		{"issuer 为空", "", "cid", "sec"},
		{"issuer 非绝对 URL", "idp.example.com", "cid", "sec"},
		{"issuer 非 http(s)", "ftp://idp.example.com", "cid", "sec"},
		{"client_id 为空", "https://idp.example.com", "  ", "sec"},
		{"client_secret 为空", "https://idp.example.com", "cid", ""},
	} {
		t.Run(tc.name+" → 400 E_VALIDATION", func(t *testing.T) {
			_, err := svc.UpsertProvider(ctx, fedWsID, tc.issuer, tc.cid, tc.sec, "")
			var we *webx.Error
			require.ErrorAs(t, err, &we)
			assert.Equal(t, http.StatusBadRequest, we.Status)
			assert.Equal(t, webx.CodeValidation, we.Code)
		})
	}
}

func TestFedAdmin_GetDelete(t *testing.T) {
	repo := newFedFakeRepo()
	svc := newFedSvc(repo, &fakeFedResolver{p: &fakeFedProvider{}})
	ctx := context.Background()

	_, ok, err := svc.GetProvider(ctx, fedWsID)
	require.NoError(t, err)
	assert.False(t, ok, "未配置时 ok=false")

	_, err = svc.UpsertProvider(ctx, fedWsID, "https://idp.example.com", "cid", "sec", "")
	require.NoError(t, err)
	row, ok, err := svc.GetProvider(ctx, fedWsID)
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, "sec", row.ClientSecret)

	require.NoError(t, svc.DeleteProvider(ctx, fedWsID))
	_, ok, err = svc.GetProvider(ctx, fedWsID)
	require.NoError(t, err)
	assert.False(t, ok)

	err = svc.DeleteProvider(ctx, fedWsID)
	var we *webx.Error
	require.ErrorAs(t, err, &we)
	assert.Equal(t, http.StatusNotFound, we.Status)
}

func TestFedResolver_ReceivesWorkspaceConfig(t *testing.T) {
	repo := newFedFakeRepo()
	seedFedConfig(repo)
	repo.fed[fedWsID].Scopes = "openid email"
	res := &fakeFedResolver{p: &fakeFedProvider{}}
	svc := newFedSvc(repo, res)

	require.NoError(t, svc.Start(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/x", nil), "acme"))
	assert.Equal(t, "https://idp.example.com", res.gotIssuer)
	assert.Equal(t, "cid", res.gotClientID)
	assert.Equal(t, "sec", res.gotSecret)
	assert.Equal(t, "openid email", res.gotScopes)
}

func fedSealKey(seed byte) []byte {
	k := make([]byte, 32)
	for i := range k {
		k[i] = seed
	}
	return k
}

func fedSvcWithSecrets(repo *fedFakeRepo, resolver app.FedResolver, secrets app.Secrets) *app.FedService {
	return app.NewFedService(repo, repo.slugLookup, resolver,
		func() time.Time { return frozenFed }, app.WithSecrets(secrets))
}

func TestFedSecrets_SealOnUpsertAndUnsealOnRead(t *testing.T) {
	repo := newFedFakeRepo()
	repo.slug["acme"] = fedWsID
	res := &fakeFedResolver{p: &fakeFedProvider{}}
	secrets, err := sealx.NewSecrets(fedSealKey(1))
	require.NoError(t, err)
	svc := fedSvcWithSecrets(repo, res, secrets)

	row, err := svc.UpsertProvider(context.Background(), fedWsID, "https://idp.example.com", "cid", "sec", "")
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(row.ClientSecret, "sealed:v1:"), "返回行携带密文（对外由 http 层脱敏）")
	stored := repo.fed[fedWsID]
	require.NotNil(t, stored)
	assert.True(t, strings.HasPrefix(stored.ClientSecret, "sealed:v1:"), "落库必须密文")
	assert.NotContains(t, stored.ClientSecret, "sec=", "密文不得含明文")

	require.NoError(t, svc.Start(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/x", nil), "acme"))
	assert.Equal(t, "sec", res.gotSecret, "读取处 Unseal 还原明文供 resolver")
}

func TestFedSecrets_NoneRefusesWriteAndPlaintext(t *testing.T) {
	repo := newFedFakeRepo()
	repo.slug["acme"] = fedWsID
	res := &fakeFedResolver{p: &fakeFedProvider{}}
	svc := app.NewFedService(repo, repo.slugLookup, res, func() time.Time { return frozenFed })

	_, err := svc.UpsertProvider(context.Background(), fedWsID, "https://idp.example.com", "cid", "sec", "")
	var we *webx.Error
	require.ErrorAs(t, err, &we)
	assert.Equal(t, http.StatusInternalServerError, we.Status)
	assert.Equal(t, app.CodeSealKeyMissing, we.Code)
	assert.Empty(t, repo.fed, "拒写时不得落库（杜绝静默明文）")

	seedFedConfig(repo)
	err = svc.Start(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/x", nil), "acme")
	require.ErrorAs(t, err, &we)
	assert.Equal(t, http.StatusInternalServerError, we.Status)
	assert.Equal(t, app.CodeSealFailed, we.Code, "明文行必须报 E_SEAL_FAILED（提示重配凭据）")
	assert.Zero(t, res.resolves, "明文行不得透传触达 resolver")
}

func TestFedSecrets_UnsealFailureIsStructuredError(t *testing.T) {
	other, err := sealx.NewSecrets(fedSealKey(2))
	require.NoError(t, err)
	wrongSealed, err := other.Seal("sec")
	require.NoError(t, err)

	repo := newFedFakeRepo()
	repo.slug["acme"] = fedWsID
	repo.fed[fedWsID] = &app.FedProviderRow{
		WorkspaceID: fedWsID, IssuerURL: "https://idp.example.com",
		ClientID: "cid", ClientSecret: wrongSealed, Scopes: "openid email profile",
	}
	res := &fakeFedResolver{p: &fakeFedProvider{}}
	secrets, err := sealx.NewSecrets(fedSealKey(1))
	require.NoError(t, err)
	svc := fedSvcWithSecrets(repo, res, secrets)

	err = svc.Start(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/x", nil), "acme")
	var we *webx.Error
	require.ErrorAs(t, err, &we)
	assert.Equal(t, http.StatusInternalServerError, we.Status)
	assert.Equal(t, app.CodeSealFailed, we.Code)
	assert.Zero(t, res.resolves, "解密失败不得触达 resolver")
}
