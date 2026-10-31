package http

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/webx"
)

// TestPlatformAdminGuard pins the exported guard's four defenses and their
// exact response copy — products wire this guard into surfaces the framework
// does not mount (settingshttp.AdminDeps.Guard), so the messages are contract.
func TestPlatformAdminGuard(t *testing.T) {
	cases := []struct {
		name       string
		principal  *webx.Principal
		wantStatus int
		wantMsg    string // empty = downstream must be reached
	}{
		{"匿名 401", nil, http.StatusUnauthorized, "authentication required"},
		{"非管理员会话 403", &webx.Principal{UserID: "u1", Source: webx.SourceSession},
			http.StatusForbidden, "platform admin required"},
		{"仿登录管理员会话 403", &webx.Principal{UserID: "u1", IsPlatformAdmin: true,
			Source: webx.SourceSession, ImpersonatedBy: "op"},
			http.StatusForbidden, "admin API is not available to impersonated sessions"},
		{"平台管理员 PAT 403", &webx.Principal{UserID: "op", IsPlatformAdmin: true, Source: webx.SourcePAT},
			http.StatusForbidden, "personal access tokens are not accepted on the admin API; use a browser session"},
		{"平台管理员会话放行", &webx.Principal{UserID: "op", IsPlatformAdmin: true, Source: webx.SourceSession},
			http.StatusOK, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var reached bool
			h := PlatformAdminGuard()(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				reached = true
				w.WriteHeader(http.StatusOK)
			}))
			r := httptest.NewRequest(http.MethodGet, "/api/admin/stats", nil)
			if tc.principal != nil {
				r = r.WithContext(webx.WithPrincipal(r.Context(), tc.principal))
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)

			assert.Equal(t, tc.wantStatus, w.Code)
			assert.Equal(t, tc.wantMsg == "", reached, "downstream reached mismatch")
			if tc.wantMsg != "" {
				var body struct {
					Error   string `json:"error"`
					Message string `json:"message"`
				}
				require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
				assert.Equal(t, tc.wantMsg, body.Message, "guard copy must stay in lockstep with requireAdmin")
			}
		})
	}
}

// TestRequireAdmin_MatchesExportedGuard proves the internal route wrapper and
// the exported guard are the same check sequence (UP-3 refactor: zero drift).
func TestRequireAdmin_MatchesExportedGuard(t *testing.T) {
	d := Deps{}
	adminP := &webx.Principal{UserID: "op", IsPlatformAdmin: true, Source: webx.SourceSession}

	t.Run("管理员通过且 handler 拿到同一 Principal", func(t *testing.T) {
		var got *webx.Principal
		h := d.requireAdmin(func(_ http.ResponseWriter, _ *http.Request, p *webx.Principal) { got = p })
		r := httptest.NewRequest(http.MethodGet, "/api/admin/stats", nil)
		r = r.WithContext(webx.WithPrincipal(r.Context(), adminP))
		w := httptest.NewRecorder()
		h(w, r)

		assert.Equal(t, http.StatusOK, w.Code)
		require.NotNil(t, got)
		assert.Equal(t, "op", got.UserID)
	})

	t.Run("拒绝分支与 PlatformAdminGuard 文案逐字一致", func(t *testing.T) {
		cases := []struct {
			name    string
			p       *webx.Principal
			status  int
			message string
		}{
			{"匿名", nil, http.StatusUnauthorized, "authentication required"},
			{"非管理员", &webx.Principal{UserID: "u1"}, http.StatusForbidden, "platform admin required"},
			{"仿登录", &webx.Principal{UserID: "u1", IsPlatformAdmin: true, ImpersonatedBy: "op"},
				http.StatusForbidden, "admin API is not available to impersonated sessions"},
			{"PAT", &webx.Principal{UserID: "op", IsPlatformAdmin: true, Source: webx.SourcePAT},
				http.StatusForbidden, "personal access tokens are not accepted on the admin API; use a browser session"},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				h := d.requireAdmin(func(http.ResponseWriter, *http.Request, *webx.Principal) {
					t.Fatal("downstream must not be reached")
				})
				r := httptest.NewRequest(http.MethodGet, "/api/admin/stats", nil)
				if tc.p != nil {
					r = r.WithContext(webx.WithPrincipal(r.Context(), tc.p))
				}
				w := httptest.NewRecorder()
				h(w, r)

				assert.Equal(t, tc.status, w.Code)
				var body struct {
					Message string `json:"message"`
				}
				require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
				assert.Equal(t, tc.message, body.Message)
			})
		}
	})
}
