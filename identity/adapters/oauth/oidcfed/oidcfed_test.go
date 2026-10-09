package oidcfed

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/identity/app"
)

type fakeIdP struct {
	srv *httptest.Server

	discoveryHits int
	authorizeSeen url.Values
	tokenSeen     url.Values
	userinfoSeen  string

	discoveryStatus int
	discoveryBody   map[string]any
	tokenStatus     int
	tokenBody       map[string]string
	userinfoBody    map[string]any
}

func newFakeIdP(t *testing.T) *fakeIdP {
	t.Helper()
	idp := &fakeIdP{
		discoveryBody: map[string]any{

			"issuer":                 "PLACEHOLDER",
			"authorization_endpoint": "PLACEHOLDER/authorize",
			"token_endpoint":         "PLACEHOLDER/token",
			"userinfo_endpoint":      "PLACEHOLDER/userinfo",
		},
		tokenStatus: http.StatusOK,
		tokenBody:   map[string]string{"access_token": "at-1"},
		userinfoBody: map[string]any{
			"sub": "sub-42", "email": "fed@example.com",
			"email_verified": true, "name": "Fed User",
		},
	}
	mux := http.NewServeMux()
	writeJSON := func(w http.ResponseWriter, v any) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(v)
	}
	mux.HandleFunc("GET /.well-known/openid-configuration", func(w http.ResponseWriter, r *http.Request) {
		idp.discoveryHits++
		if idp.discoveryStatus != 0 {
			w.WriteHeader(idp.discoveryStatus)
			return
		}
		body := map[string]any{}
		for k, v := range idp.discoveryBody {
			if s, ok := v.(string); ok && strings.HasPrefix(s, "PLACEHOLDER") {
				v = idp.srv.URL + strings.TrimPrefix(s, "PLACEHOLDER")
			}
			body[k] = v
		}
		writeJSON(w, body)
	})
	mux.HandleFunc("GET /authorize", func(w http.ResponseWriter, r *http.Request) {
		idp.authorizeSeen = r.URL.Query()
		http.Redirect(w, r, "/authorized?code=fake-code", http.StatusFound)
	})
	mux.HandleFunc("POST /token", func(w http.ResponseWriter, r *http.Request) {
		require.NoError(t, r.ParseForm())
		idp.tokenSeen = r.PostForm
		if idp.tokenStatus != http.StatusOK {
			w.WriteHeader(idp.tokenStatus)
			return
		}
		writeJSON(w, idp.tokenBody)
	})
	mux.HandleFunc("GET /userinfo", func(w http.ResponseWriter, r *http.Request) {
		idp.userinfoSeen = r.Header.Get("Authorization")
		writeJSON(w, idp.userinfoBody)
	})
	idp.srv = httptest.NewServer(mux)
	t.Cleanup(idp.srv.Close)
	return idp
}

func newTestResolver(t *testing.T, now func() time.Time) *Resolver {
	t.Helper()
	t.Setenv(EnvAllowPrivateIDP, "1")
	r := NewResolver()
	r.now = now
	return r
}

func TestResolve_DiscoveryIssuerMismatch_P3_3(t *testing.T) {
	idp := newFakeIdP(t)
	idp.discoveryBody["issuer"] = "https://evil.example.com"
	r := NewResolver().WithHTTPClient(idp.srv.Client())
	_, err := r.Resolve(context.Background(), idp.srv.URL, "cid", "sec", "openid")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "issuer mismatch")

	delete(idp.discoveryBody, "issuer")
	_, err = r.Resolve(context.Background(), idp.srv.URL, "cid", "sec", "openid")
	require.NoError(t, err)
}

func TestResolve_DiscoveryCache(t *testing.T) {
	idp := newFakeIdP(t)
	now := time.Now()
	r := newTestResolver(t, func() time.Time { return now })
	ctx := context.Background()

	p1, err := r.Resolve(ctx, idp.srv.URL, "cid", "sec", "openid email profile")
	require.NoError(t, err)
	require.NotNil(t, p1)
	assert.Equal(t, 1, idp.discoveryHits)

	_, err = r.Resolve(ctx, idp.srv.URL, "cid", "sec", "openid email profile")
	require.NoError(t, err)
	assert.Equal(t, 1, idp.discoveryHits, "TTL 内必须命中缓存")

	_, err = r.Resolve(ctx, idp.srv.URL+"/", "cid", "sec", "openid email profile")
	require.NoError(t, err)
	assert.Equal(t, 1, idp.discoveryHits, "尾斜杠 issuer 应归一为同一缓存键")

	now = now.Add(time.Hour + time.Minute)
	_, err = r.Resolve(ctx, idp.srv.URL, "cid", "sec", "openid email profile")
	require.NoError(t, err)
	assert.Equal(t, 2, idp.discoveryHits, "TTL 过期后必须重新 discovery")
}

func TestResolve_ConcurrentSafe(t *testing.T) {
	idp := newFakeIdP(t)
	r := newTestResolver(t, time.Now)
	ctx := context.Background()

	var wg sync.WaitGroup
	errs := make(chan error, 32)
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := r.Resolve(ctx, idp.srv.URL, "cid", "sec", "openid email profile"); err != nil {
				errs <- err
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Errorf("concurrent Resolve: %v", err)
	}
}

func TestResolve_Errors(t *testing.T) {
	ctx := context.Background()

	t.Run("discovery 非 2xx", func(t *testing.T) {
		idp := newFakeIdP(t)
		idp.discoveryStatus = http.StatusInternalServerError
		_, err := newTestResolver(t, time.Now).Resolve(ctx, idp.srv.URL, "cid", "sec", "openid email")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "discovery")
	})
	t.Run("discovery 缺 token 端点", func(t *testing.T) {
		idp := newFakeIdP(t)
		delete(idp.discoveryBody, "token_endpoint")
		_, err := newTestResolver(t, time.Now).Resolve(ctx, idp.srv.URL, "cid", "sec", "openid email")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "token_endpoint")
	})
	t.Run("不可达 issuer", func(t *testing.T) {
		_, err := newTestResolver(t, time.Now).Resolve(ctx, "http://127.0.0.1:1", "cid", "sec", "openid email")
		require.Error(t, err)
	})
}

func TestAuthURL_PKCE(t *testing.T) {
	idp := newFakeIdP(t)
	ctx := context.Background()
	p, err := newTestResolver(t, time.Now).Resolve(ctx, idp.srv.URL, "cid-1", "sec-1", "openid email profile")
	require.NoError(t, err)

	assert.Equal(t, "oidc_fed", p.Name())

	verifier := strings.Repeat("v", 64)
	raw := p.AuthURL("st-9", "http://app.example.com/auth/fed/callback", verifier)

	u, err := url.Parse(raw)
	require.NoError(t, err)
	assert.Equal(t, idp.srv.URL+"/authorize", u.Scheme+"://"+u.Host+u.Path)
	q := u.Query()
	assert.Equal(t, "code", q.Get("response_type"))
	assert.Equal(t, "openid email profile", q.Get("scope"))
	assert.Equal(t, "cid-1", q.Get("client_id"))
	assert.Equal(t, "http://app.example.com/auth/fed/callback", q.Get("redirect_uri"))
	assert.Equal(t, "st-9", q.Get("state"))
	assert.Equal(t, "S256", q.Get("code_challenge_method"))
	sum := sha256.Sum256([]byte(verifier))
	assert.Equal(t, base64.RawURLEncoding.EncodeToString(sum[:]), q.Get("code_challenge"))

	noRedirect := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}
	resp, err := noRedirect.Get(raw)
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, http.StatusFound, resp.StatusCode)
	for k, want := range map[string]string{
		"response_type": "code", "scope": "openid email profile",
		"client_id": "cid-1", "state": "st-9",
		"code_challenge_method": "S256", "code_challenge": q.Get("code_challenge"),
	} {
		assert.Equal(t, want, idp.authorizeSeen.Get(k), "authorize 端点收到的 %s", k)
	}
}

func TestExchange_TokenThenUserinfo(t *testing.T) {
	idp := newFakeIdP(t)
	ctx := context.Background()
	p, err := newTestResolver(t, time.Now).Resolve(ctx, idp.srv.URL, "cid-1", "sec-1", "openid email profile")
	require.NoError(t, err)

	verifier := strings.Repeat("v", 64)
	id, err := p.Exchange(ctx, "code-7", "http://app.example.com/auth/fed/callback", verifier)
	require.NoError(t, err)

	assert.Equal(t, "authorization_code", idp.tokenSeen.Get("grant_type"))
	assert.Equal(t, "code-7", idp.tokenSeen.Get("code"))
	assert.Equal(t, verifier, idp.tokenSeen.Get("code_verifier"))
	assert.Equal(t, "cid-1", idp.tokenSeen.Get("client_id"))
	assert.Equal(t, "sec-1", idp.tokenSeen.Get("client_secret"))
	assert.Equal(t, "http://app.example.com/auth/fed/callback", idp.tokenSeen.Get("redirect_uri"))

	assert.Equal(t, "Bearer at-1", idp.userinfoSeen)

	assert.Equal(t, app.OAuthIdentity{
		Provider: "oidc_fed", Subject: "sub-42",
		Email: "fed@example.com", Name: "Fed User", EmailVerified: true,
	}, id)
}

func TestExchange_Errors(t *testing.T) {
	ctx := context.Background()
	verifier := strings.Repeat("v", 64)

	t.Run("token 非 2xx", func(t *testing.T) {
		idp := newFakeIdP(t)
		idp.tokenStatus = http.StatusBadRequest
		p, err := newTestResolver(t, time.Now).Resolve(ctx, idp.srv.URL, "cid", "sec", "openid email")
		require.NoError(t, err)
		_, err = p.Exchange(ctx, "c", "http://cb", verifier)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "exchange token")
	})
	t.Run("token 返回空 access_token", func(t *testing.T) {
		idp := newFakeIdP(t)
		idp.tokenBody = map[string]string{}
		p, err := newTestResolver(t, time.Now).Resolve(ctx, idp.srv.URL, "cid", "sec", "openid email")
		require.NoError(t, err)
		_, err = p.Exchange(ctx, "c", "http://cb", verifier)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "access token")
	})
	t.Run("userinfo 缺 sub", func(t *testing.T) {
		idp := newFakeIdP(t)
		idp.userinfoBody = map[string]any{"email": "x@example.com"}
		p, err := newTestResolver(t, time.Now).Resolve(ctx, idp.srv.URL, "cid", "sec", "openid email")
		require.NoError(t, err)
		_, err = p.Exchange(ctx, "c", "http://cb", verifier)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "sub")
	})
	t.Run("userinfo 缺 email", func(t *testing.T) {
		idp := newFakeIdP(t)
		idp.userinfoBody = map[string]any{"sub": "s-1"}
		p, err := newTestResolver(t, time.Now).Resolve(ctx, idp.srv.URL, "cid", "sec", "openid email")
		require.NoError(t, err)
		_, err = p.Exchange(ctx, "c", "http://cb", verifier)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "email")
	})
}
