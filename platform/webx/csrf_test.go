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
