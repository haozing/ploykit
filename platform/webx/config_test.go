package webx

import (
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// F20: every realistic wiring serves /config behind CSRFConditional, so the
// tests exercise the chained shape. The bare handler (CSRF middleware missing
// from the chain) is a wiring error and now fails loudly — see the last subtest.
func chainedConfig(t *testing.T, d ConfigDeps) http.Handler {
	t.Helper()
	key := make([]byte, 32)
	_, err := rand.Read(key)
	require.NoError(t, err)
	return CSRFConditional(&CSRFConfig{Key: key}, false)(ConfigHandler(d))
}

func TestConfigHandler(t *testing.T) {
	t.Run("nil 扩展面：三键齐全且名录为 [] 非 null", func(t *testing.T) {
		h := chainedConfig(t, ConfigDeps{})
		r := httptest.NewRequest(http.MethodGet, "/config", nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)

		require.Equal(t, http.StatusOK, w.Code)
		assert.Contains(t, w.Header().Get("Content-Type"), "application/json")

		var raw map[string]json.RawMessage
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &raw))
		require.Contains(t, raw, "csrf_token")
		require.Contains(t, raw, "oauth_providers")
		require.Contains(t, raw, "billing_channels")
		require.Contains(t, raw, "framework_version")

		assert.Equal(t, "[]", strings.TrimSpace(string(raw["oauth_providers"])))
		assert.Equal(t, "[]", strings.TrimSpace(string(raw["billing_channels"])))
	})

	t.Run("扩展面注入：透传名录", func(t *testing.T) {
		h := chainedConfig(t, ConfigDeps{
			OAuthProviders:  func() []string { return []string{"github", "google"} },
			BillingChannels: func() []string { return []string{"stripe"} },
		})
		r := httptest.NewRequest(http.MethodGet, "/config", nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)

		require.Equal(t, http.StatusOK, w.Code)
		var body struct {
			CSRFToken       string   `json:"csrf_token"`
			OAuthProviders  []string `json:"oauth_providers"`
			BillingChannels []string `json:"billing_channels"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		assert.Equal(t, []string{"github", "google"}, body.OAuthProviders)
		assert.Equal(t, []string{"stripe"}, body.BillingChannels)
	})

	t.Run("扩展面返回 nil 切片：仍输出 [] 非 null", func(t *testing.T) {
		h := chainedConfig(t, ConfigDeps{OAuthProviders: func() []string { return nil }})
		r := httptest.NewRequest(http.MethodGet, "/config", nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)

		var raw map[string]json.RawMessage
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &raw))
		assert.Equal(t, "[]", strings.TrimSpace(string(raw["oauth_providers"])))
	})

	t.Run("Extra 注入键出现在响应", func(t *testing.T) {
		h := chainedConfig(t, ConfigDeps{
			Extra: func() map[string]any {
				return map[string]any{
					"banner_text":      "系统维护公告",
					"banner_kind":      "info",
					"maintenance_mode": "off",
				}
			},
		})
		r := httptest.NewRequest(http.MethodGet, "/config", nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)

		require.Equal(t, http.StatusOK, w.Code)
		var body map[string]any
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))

		assert.Equal(t, "系统维护公告", body["banner_text"])
		assert.Equal(t, "info", body["banner_kind"])
		assert.Equal(t, "off", body["maintenance_mode"])

		assert.Contains(t, body, "csrf_token")
		assert.Equal(t, []any{}, body["oauth_providers"])
	})

	t.Run("Extra 为 nil：行为不变，仅基础三键", func(t *testing.T) {
		h := chainedConfig(t, ConfigDeps{
			OAuthProviders:  func() []string { return []string{"github"} },
			BillingChannels: func() []string { return []string{"stripe"} },
			Extra:           nil,
		})
		r := httptest.NewRequest(http.MethodGet, "/config", nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)

		require.Equal(t, http.StatusOK, w.Code)
		var body map[string]any
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		assert.Len(t, body, 4)
		assert.Contains(t, body, "csrf_token")
		assert.Equal(t, []any{"github"}, body["oauth_providers"])
		assert.Equal(t, []any{"stripe"}, body["billing_channels"])
	})

	t.Run("Extra 返回 nil：同样仅基础三键", func(t *testing.T) {
		h := chainedConfig(t, ConfigDeps{Extra: func() map[string]any { return nil }})
		r := httptest.NewRequest(http.MethodGet, "/config", nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)

		var body map[string]any
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		assert.Len(t, body, 4)
	})

	t.Run("Extra 与基础键冲突：以 Extra 为准", func(t *testing.T) {
		h := chainedConfig(t, ConfigDeps{
			OAuthProviders: func() []string { return []string{"github"} },
			Extra: func() map[string]any {
				return map[string]any{"oauth_providers": []string{"google", "oidc"}}
			},
		})
		r := httptest.NewRequest(http.MethodGet, "/config", nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)

		var body map[string]any
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		assert.Equal(t, []any{"google", "oidc"}, body["oauth_providers"])
	})

	t.Run("F20：链上无 CSRF 中间件 → 500 点名缺失，不再静默空 token", func(t *testing.T) {
		h := ConfigHandler(ConfigDeps{})
		r := httptest.NewRequest(http.MethodGet, "/config", nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)

		require.Equal(t, http.StatusInternalServerError, w.Code)
		var body ErrorBody
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		assert.Equal(t, CodeInternal, body.Code)
		assert.Contains(t, body.Message, "csrf middleware missing")
	})

	t.Run("F20 回归：过 CSRF 中间件后 token 非空（200）", func(t *testing.T) {
		h := chainedConfig(t, ConfigDeps{})
		r := httptest.NewRequest(http.MethodGet, "/config", nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)

		require.Equal(t, http.StatusOK, w.Code)
		var body struct {
			CSRFToken string `json:"csrf_token"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		assert.NotEmpty(t, body.CSRFToken)
	})
}
