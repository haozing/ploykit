package webx

import (
	"crypto/rand"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func csrfOk(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

func newCSRFHandler(t *testing.T) http.Handler {
	t.Helper()
	key := make([]byte, 32)
	_, err := rand.Read(key)
	require.NoError(t, err)
	return CSRFConditional(&CSRFConfig{Key: key}, false)(http.HandlerFunc(csrfOk))
}

func TestCSRFRejectionJSONEnvelope(t *testing.T) {
	h := newCSRFHandler(t)

	t.Run("无 token POST → 403 JSON 信封", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodPost, "/api/tasks", strings.NewReader(`{}`))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)

		require.Equal(t, http.StatusForbidden, w.Code)
		assert.Contains(t, w.Header().Get("Content-Type"), "application/json")
		assert.Contains(t, w.Body.String(), "E_FORBIDDEN")
		assert.Contains(t, w.Body.String(), "CSRF token missing or invalid")
	})

	t.Run("错误 token POST → 同一信封", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodPost, "/api/tasks", nil)
		r.Header.Set("X-CSRF-Token", "bogus-token")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)

		require.Equal(t, http.StatusForbidden, w.Code)
		assert.Contains(t, w.Body.String(), "E_FORBIDDEN")
	})

	t.Run("GET 不受 CSRF 保护，正常透传", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodGet, "/api/tasks", nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)

		assert.Equal(t, http.StatusOK, w.Code)
	})
}

func TestCSRFPatExempt_FT21(t *testing.T) {
	key := make([]byte, 32)
	_, err := rand.Read(key)
	require.NoError(t, err)

	var token string
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			token = CSRFMaskedToken(r)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	h := CSRFConditional(&CSRFConfig{Key: key}, false)(next)

	t.Run("PAT 写请求（Bearer tk_）免 CSRF 直接过", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodPost, "/api/tasks", strings.NewReader(`{}`))
		r.Header.Set("Authorization", "Bearer tk_"+strings.Repeat("a", 40))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	})

	t.Run("会话写请求无 token 拒 403（豁免不得外溢）", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodPost, "/api/tasks", strings.NewReader(`{}`))
		r = r.WithContext(WithPrincipal(r.Context(), &Principal{UserID: "u1", Source: SourceSession}))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		require.Equal(t, http.StatusForbidden, w.Code)
		assert.Contains(t, w.Body.String(), "CSRF token missing or invalid")
	})

	t.Run("会话写请求带有效 token 过", func(t *testing.T) {

		g := httptest.NewRequest(http.MethodGet, "/api/tasks", nil)
		gw := httptest.NewRecorder()
		h.ServeHTTP(gw, g)
		require.Equal(t, http.StatusOK, gw.Code)
		var cookie *http.Cookie
		for _, c := range gw.Result().Cookies() {
			if c.Name == "ploykit_csrf" {
				cookie = c
			}
		}
		require.NotNil(t, cookie, "GET 应下发 csrf cookie")
		require.NotEmpty(t, token)

		r := httptest.NewRequest(http.MethodPost, "/api/tasks", strings.NewReader(`{}`))
		r.AddCookie(cookie)
		r.Header.Set("X-CSRF-Token", token)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	})

	t.Run("PAT Principal（csrf 在 Authenticate 内层的装配）同样豁免", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodPost, "/api/tasks", strings.NewReader(`{}`))
		r = r.WithContext(WithPrincipal(r.Context(), &Principal{UserID: "u1", Source: SourcePAT}))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		require.Equal(t, http.StatusOK, w.Code)
	})
}

func TestCSRF_PATPrefixConfigurable_I2(t *testing.T) {
	key := make([]byte, 32)
	_, err := rand.Read(key)
	require.NoError(t, err)

	t.Run("自定义前缀 pk_ 的 PAT 写请求免 CSRF", func(t *testing.T) {
		h := CSRFConditional(&CSRFConfig{Key: key, PATPrefix: "pk_"}, false)(http.HandlerFunc(csrfOk))
		r := httptest.NewRequest(http.MethodPost, "/api/tasks", strings.NewReader(`{}`))
		r.Header.Set("Authorization", "Bearer pk_"+strings.Repeat("a", 40))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	})

	t.Run("配置 pk_ 后默认前缀 tk_ 不再豁免（单一真源）", func(t *testing.T) {
		h := CSRFConditional(&CSRFConfig{Key: key, PATPrefix: "pk_"}, false)(http.HandlerFunc(csrfOk))
		r := httptest.NewRequest(http.MethodPost, "/api/tasks", strings.NewReader(`{}`))
		r.Header.Set("Authorization", "Bearer tk_"+strings.Repeat("a", 40))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		require.Equal(t, http.StatusForbidden, w.Code, "配置自定义前缀后 tk_ 头不构成 PAT 特征，必须走 CSRF")
	})

	t.Run("零配置默认前缀 tk_ 回归不变", func(t *testing.T) {
		h := CSRFConditional(&CSRFConfig{Key: key}, false)(http.HandlerFunc(csrfOk))
		r := httptest.NewRequest(http.MethodPost, "/api/tasks", strings.NewReader(`{}`))
		r.Header.Set("Authorization", "Bearer tk_"+strings.Repeat("a", 40))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	})
}

func TestCSRFExemptPrefixes_F1(t *testing.T) {
	key := make([]byte, 32)
	_, err := rand.Read(key)
	require.NoError(t, err)
	h := CSRFConditional(&CSRFConfig{
		Key:            key,
		ExemptPrefixes: []string{"/webhooks/billing/"},
	}, false)(http.HandlerFunc(csrfOk))

	cases := []struct {
		name     string
		method   string
		path     string
		bearer   bool
		wantCode int
		wantBody string
	}{
		{
			name:     "豁免前缀 POST 无 token → 透传 200（handler 可达）",
			method:   http.MethodPost,
			path:     "/webhooks/billing/stripe",
			wantCode: http.StatusOK,
		},
		{
			name:     "非豁免路径 POST 无 token → 403 信封 E_FORBIDDEN",
			method:   http.MethodPost,
			path:     "/api/tasks",
			wantCode: http.StatusForbidden,
			wantBody: "E_FORBIDDEN",
		},
		{
			name:     "PAT 请求（Bearer tk_）豁免不受影响",
			method:   http.MethodPost,
			path:     "/api/tasks",
			bearer:   true,
			wantCode: http.StatusOK,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(tc.method, tc.path, strings.NewReader(`{}`))
			if tc.bearer {
				r.Header.Set("Authorization", "Bearer tk_"+strings.Repeat("a", 40))
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)

			require.Equal(t, tc.wantCode, w.Code, w.Body.String())
			if tc.wantBody != "" {
				assert.Contains(t, w.Body.String(), tc.wantBody)
			}
		})
	}
}

// 漂移端口（vite 5173 被占顺延到 5176）曾造成"登录正常、读正常、全站写 403"：
// gorilla/csrf 对 TrustedOrigins 是含端口的精确字符串匹配，单值 localhost:5173
// 永远配不上漂移后的 Origin。
func TestCSRFTrustLocalhostAnyPort(t *testing.T) {
	key := make([]byte, 32)
	_, err := rand.Read(key)
	require.NoError(t, err)

	// newHandler 返回的中间件包装了一个捕获 GET 期 masked token 的 next，
	// 因为有效 token 只能由同一 key 的 Protect 实例签发。
	newHandler := func(anyPort bool) (http.Handler, *string) {
		token := ""
		next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodGet {
				token = CSRFMaskedToken(r)
			}
			csrfOk(w, r)
		})
		h := CSRFConditional(&CSRFConfig{
			Key:                   key,
			TrustedOrigins:        []string{"localhost:5173"},
			TrustLocalhostAnyPort: anyPort,
		}, false)(next)
		return h, &token
	}
	harvest := func(t *testing.T, h http.Handler, token *string) *http.Cookie {
		t.Helper()
		g := httptest.NewRequest(http.MethodGet, "/api/tasks", nil)
		gw := httptest.NewRecorder()
		h.ServeHTTP(gw, g)
		require.Equal(t, http.StatusOK, gw.Code, gw.Body.String())
		var cookie *http.Cookie
		for _, c := range gw.Result().Cookies() {
			if c.Name == "ploykit_csrf" {
				cookie = c
			}
		}
		require.NotNil(t, cookie, "GET 应下发 csrf cookie")
		require.NotEmpty(t, *token)
		return cookie
	}
	driftedPOST := func(cookie *http.Cookie, token, origin string) *http.Request {
		r := httptest.NewRequest(http.MethodPost, "/api/tasks", strings.NewReader(`{}`))
		r.Host = "localhost:8080"
		r.AddCookie(cookie)
		r.Header.Set("X-CSRF-Token", token)
		r.Header.Set("Origin", origin)
		return r
	}

	t.Run("开启后漂移端口 5176 的会话写请求过", func(t *testing.T) {
		h, token := newHandler(true)
		cookie := harvest(t, h, token)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, driftedPOST(cookie, *token, "http://localhost:5176"))
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	})

	t.Run("未开启时同一请求 403，且错误带 origin 诊断而非笼统 token 文案", func(t *testing.T) {
		h, token := newHandler(false)
		cookie := harvest(t, h, token)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, driftedPOST(cookie, *token, "http://localhost:5176"))

		require.Equal(t, http.StatusForbidden, w.Code)
		body := w.Body.String()
		assert.Contains(t, body, "origin check failed")
		assert.Contains(t, body, "http://localhost:5176")
		assert.Contains(t, body, "localhost:5173")
		assert.NotContains(t, body, "CSRF token missing or invalid")
	})

	t.Run("开启也不放行非回环主机（evil.com:5173）", func(t *testing.T) {
		h, token := newHandler(true)
		cookie := harvest(t, h, token)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, driftedPOST(cookie, *token, "http://evil.com:5173"))

		require.Equal(t, http.StatusForbidden, w.Code)
		assert.Contains(t, w.Body.String(), "evil.com")
	})

	t.Run("HTTPS 无 Origin 时漂移端口的 Referer 也归一（token 类失败而非 origin 类）", func(t *testing.T) {
		// secure=true 才走 gorilla 的 TLS Referer 闸
		h := CSRFConditional(&CSRFConfig{
			Key:                   key,
			TrustedOrigins:        []string{"localhost:5173"},
			TrustLocalhostAnyPort: true,
		}, true)(http.HandlerFunc(csrfOk))
		r := httptest.NewRequest(http.MethodPost, "https://localhost:8443/api/tasks", strings.NewReader(`{}`))
		r.Header.Set("Referer", "https://localhost:5199/")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)

		// origin/referer 闸已过（否则文案是 origin check failed），死在缺 token
		require.Equal(t, http.StatusForbidden, w.Code)
		assert.Contains(t, w.Body.String(), "CSRF token missing or invalid")
	})
}

func TestNormalizeLoopbackOrigin(t *testing.T) {
	cases := []struct {
		in   string
		want string
		ok   bool
	}{
		{"http://localhost:5176", "http://localhost", true},
		{"https://localhost:5173", "https://localhost", true},
		{"http://127.0.0.1:3000", "http://127.0.0.1", true},
		{"http://[::1]:5174", "http://[::1]", true},
		{"http://localhost", "http://localhost", true},
		{"http://evil.com:5176", "", false},
		{"http://192.168.1.10:5176", "", false},
		{"", "", false},
		{":::not-a-url", "", false},
	}
	for _, tc := range cases {
		got, ok := normalizeLoopbackOrigin(tc.in)
		require.Equal(t, tc.ok, ok, "input %q", tc.in)
		if tc.ok {
			assert.Equal(t, tc.want, got, "input %q", tc.in)
		}
	}
}
