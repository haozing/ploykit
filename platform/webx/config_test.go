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

func TestConfigHandler(t *testing.T) {
	t.Run("nil 扩展面：三键齐全且名录为 [] 非 null", func(t *testing.T) {
		h := ConfigHandler(ConfigDeps{})
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

		assert.Equal(t, "[]", strings.TrimSpace(string(raw["oauth_providers"])))
		assert.Equal(t, "[]", strings.TrimSpace(string(raw["billing_channels"])))
	})

	t.Run("扩展面注入：透传名录", func(t *testing.T) {
		h := ConfigHandler(ConfigDeps{
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
		h := ConfigHandler(ConfigDeps{OAuthProviders: func() []string { return nil }})
		r := httptest.NewRequest(http.MethodGet, "/config", nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)

		var raw map[string]json.RawMessage
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &raw))
		assert.Equal(t, "[]", strings.TrimSpace(string(raw["oauth_providers"])))
	})

	t.Run("Extra 注入键出现在响应", func(t *testing.T) {
		h := ConfigHandler(ConfigDeps{
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
		h := ConfigHandler(ConfigDeps{
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
		assert.Len(t, body, 3)
		assert.Contains(t, body, "csrf_token")
		assert.Equal(t, []any{"github"}, body["oauth_providers"])
		assert.Equal(t, []any{"stripe"}, body["billing_channels"])
	})

	t.Run("Extra 返回 nil：同样仅基础三键", func(t *testing.T) {
		h := ConfigHandler(ConfigDeps{Extra: func() map[string]any { return nil }})
		r := httptest.NewRequest(http.MethodGet, "/config", nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)

		var body map[string]any
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		assert.Len(t, body, 3)
	})

	t.Run("Extra 与基础键冲突：以 Extra 为准", func(t *testing.T) {
		h := ConfigHandler(ConfigDeps{
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

	t.Run("csrf_token：未过 CSRF 中间件语境为空串，过中间件后非空", func(t *testing.T) {

		h := ConfigHandler(ConfigDeps{})
		r := httptest.NewRequest(http.MethodGet, "/config", nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		var bare struct {
			CSRFToken string `json:"csrf_token"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &bare))
		assert.Empty(t, bare.CSRFToken)

		key := make([]byte, 32)
		_, err := rand.Read(key)
		require.NoError(t, err)
		chained := CSRFConditional(&CSRFConfig{Key: key}, false)(h)
		r2 := httptest.NewRequest(http.MethodGet, "/config", nil)
		w2 := httptest.NewRecorder()
		chained.ServeHTTP(w2, r2)

		require.Equal(t, http.StatusOK, w2.Code)
		var chainedBody struct {
			CSRFToken string `json:"csrf_token"`
		}
		require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &chainedBody))
		assert.NotEmpty(t, chainedBody.CSRFToken)
	})
}
