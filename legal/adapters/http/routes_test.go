package legalhttp

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/legal"
	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/settings"
)

// Hermetic tests: the re-acceptance decode/validation paths and the admin
// guard/fail-fast wiring never touch the pool (validation fires before the
// repo), so zero-value services and a lazy (never-dialed) pool are enough —
// same discipline as billing/adapters/http routes_cancel_test.go.

// fakeSettings is the minimal SettingsStore for a hermetic Wire: register
// accepts everything, effective values come from the map.
type fakeSettings struct {
	eff map[string]string
}

func (f *fakeSettings) RegisterKeys(...settings.KeySpec) error { return nil }
func (f *fakeSettings) Effective(context.Context) (map[string]string, error) {
	if f.eff == nil {
		return map[string]string{}, nil
	}
	return f.eff, nil
}
func (f *fakeSettings) EffectiveKey(_ context.Context, key string) (string, error) {
	return f.eff[key], nil
}

// lazyPool builds a pool that never connects (pgx pools dial on first
// acquire): Wire only stores the handle for the repo it builds.
func lazyPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool, err := pgxpool.New(context.Background(), "host=127.0.0.1 port=1 user=legalhttp_heredic dbname=legalhttp_heredic sslmode=disable")
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	return pool
}

func wiredModule(t *testing.T) *legal.Module {
	t.Helper()
	m, err := legal.Wire(legal.Config{Pool: lazyPool(t), Store: &fakeSettings{}})
	require.NoError(t, err)
	return m
}

func doReaccept(t *testing.T, mux *webx.Mux, principal *webx.Principal, body string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, "/api/legal/acceptances", strings.NewReader(body))
	if principal != nil {
		r = r.WithContext(webx.WithPrincipal(r.Context(), principal))
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	return w
}

func TestMount_FailFastNilSvc(t *testing.T) {
	assert.PanicsWithValue(t,
		"legalhttp: Deps.Svc is required (legal.Wire(...).Service())",
		func() { Mount(webx.NewMux(), Deps{}) },
		"nil Svc 必须挂载期 panic，而不是首个请求才炸（与 MountAdmin 的 Guard 纪律同款）")
}

func TestReacceptRoute(t *testing.T) {
	newMux := func(svc *legal.Service) *webx.Mux {
		if svc == nil {
			svc = &legal.Service{}
		}
		mux := webx.NewMux()
		Mount(mux, Deps{Svc: svc})
		return mux
	}

	t.Run("匿名 → 401", func(t *testing.T) {
		w := doReaccept(t, newMux(nil), nil, `{"doc_key":"tos"}`)
		assert.Equal(t, http.StatusUnauthorized, w.Code)
	})

	t.Run("坏 JSON → 400 E_BAD_JSON（解码先于服务层）", func(t *testing.T) {
		p := &webx.Principal{UserID: "u-1"}
		w := doReaccept(t, newMux(nil), p, `{not-json`)
		assert.Equal(t, http.StatusBadRequest, w.Code)
		assert.Contains(t, w.Body.String(), "E_BAD_JSON")
	})

	t.Run("未知文档键 → 400（校验先于 repo，hermetic 无库）", func(t *testing.T) {
		// The doc registry in this test binary is empty, so every key is
		// unknown — exactly the validation-first path under test.
		p := &webx.Principal{UserID: "u-1"}
		w := doReaccept(t, newMux(nil), p, `{"doc_key":"ghost-doc"}`)
		assert.Equal(t, http.StatusBadRequest, w.Code, w.Body.String())
	})
}

func TestMountAdmin_FailFastNilGuard(t *testing.T) {
	assert.Panics(t, func() {
		MountAdmin(webx.NewMux(), AdminDeps{Mod: wiredModule(t)})
	}, "nil Guard = 未设防的 admin 路由，必须挂载期 panic")
}

func TestAdminRoutes(t *testing.T) {
	allowAll := func(next http.Handler) http.Handler { return next }
	rejectAll := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			webx.ErrForbidden(w, "platform admin required")
		})
	}
	mod := wiredModule(t)
	newMux := func(guard func(http.Handler) http.Handler) *webx.Mux {
		mux := webx.NewMux()
		MountAdmin(mux, AdminDeps{Mod: mod, Svc: mod.Service(), Guard: guard})
		return mux
	}

	t.Run("守卫拒绝 → 403（守卫包裹整个 admin 面）", func(t *testing.T) {
		w := httptest.NewRecorder()
		newMux(rejectAll).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/admin/legal/compliance", nil))
		assert.Equal(t, http.StatusForbidden, w.Code)
	})

	t.Run("compliance → 200 信封三字段（AdminComplianceCard 契约）", func(t *testing.T) {
		w := httptest.NewRecorder()
		newMux(allowAll).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/admin/legal/compliance", nil))
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		assert.Contains(t, w.Body.String(), `"missing_keys"`)
		assert.Contains(t, w.Body.String(), `"legal_config"`)
		assert.Contains(t, w.Body.String(), `"checks"`)
	})

	t.Run("acceptances 非法 UUID → 400（校验先于 repo）", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodGet, "/api/admin/legal/acceptances", nil)
		q := r.URL.Query()
		q.Set("user_id", "not-a-uuid")
		r.URL.RawQuery = q.Encode()
		w := httptest.NewRecorder()
		newMux(allowAll).ServeHTTP(w, r)
		assert.Equal(t, http.StatusBadRequest, w.Code, w.Body.String())
	})
}
