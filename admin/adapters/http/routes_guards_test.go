package http

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/haozing/ploykit/admin/app"
	"github.com/haozing/ploykit/platform/webx"
)

func mountedAdminReq(mux *http.ServeMux, p *webx.Principal, method, path string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, nil)
	if p != nil {
		r = r.WithContext(webx.WithPrincipal(r.Context(), p))
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	return w
}

func guardMatrix(t *testing.T, mux *http.ServeMux, cases []struct{ method, path string }) {
	t.Helper()
	adminP := &webx.Principal{UserID: "op", IsPlatformAdmin: true, Source: webx.SourceSession}
	for _, c := range cases {

		w := mountedAdminReq(mux, nil, c.method, c.path)
		assert.Equal(t, http.StatusUnauthorized, w.Code, "%s %s 无 Principal 应 401", c.method, c.path)

		w = mountedAdminReq(mux, &webx.Principal{UserID: "u1", IsPlatformAdmin: false}, c.method, c.path)
		assert.Equal(t, http.StatusForbidden, w.Code, "%s %s 非管理员应 403", c.method, c.path)

		w = mountedAdminReq(mux, &webx.Principal{UserID: "op", IsPlatformAdmin: true, Source: webx.SourcePAT}, c.method, c.path)
		assert.Equal(t, http.StatusForbidden, w.Code, "%s %s 管理员 PAT 应 403（P3-17）", c.method, c.path)

		w = mountedAdminReq(mux, &webx.Principal{UserID: "u1", IsPlatformAdmin: true, Source: webx.SourceSession, ImpersonatedBy: "op"}, c.method, c.path)
		assert.Equal(t, http.StatusForbidden, w.Code, "%s %s 模拟会话应 403（P2-9）", c.method, c.path)

		w = mountedAdminReq(mux, adminP, c.method, c.path)
		assert.NotEqual(t, http.StatusUnauthorized, w.Code, "%s %s 管理员会话不应 401", c.method, c.path)
		assert.NotEqual(t, http.StatusForbidden, w.Code, "%s %s 管理员会话不应 403", c.method, c.path)
	}
}

func TestWsOpsMountGuards(t *testing.T) {

	mux := http.NewServeMux()
	MountWsOps(mux, WsOpsDeps{})
	guardMatrix(t, mux, []struct{ method, path string }{
		{http.MethodGet, "/api/admin/workspaces/ws-1"},
		{http.MethodDelete, "/api/admin/workspaces/ws-1"},
		{http.MethodPost, "/api/admin/notify"},
		{http.MethodGet, "/api/admin/sso"},
		{http.MethodGet, "/api/admin/analytics/recent"},
	})
	adminP := &webx.Principal{UserID: "op", IsPlatformAdmin: true, Source: webx.SourceSession}
	for _, c := range []struct{ method, path string }{
		{http.MethodGet, "/api/admin/workspaces/ws-1"},
		{http.MethodPost, "/api/admin/notify"},
		{http.MethodGet, "/api/admin/sso"},
	} {
		w := mountedAdminReq(mux, adminP, c.method, c.path)
		assert.Equal(t, http.StatusServiceUnavailable, w.Code,
			"%s %s nil Svc 应 503 而非 panic（P3-21）", c.method, c.path)
	}
}

func TestBillingOpsMountGuards(t *testing.T) {
	mux := http.NewServeMux()
	MountBillingOps(mux, BillingOpsDeps{})
	guardMatrix(t, mux, []struct{ method, path string }{
		{http.MethodGet, "/api/admin/plans"},
		{http.MethodGet, "/api/admin/orders"},
		{http.MethodGet, "/api/admin/webhook-deliveries"},
		{http.MethodPost, "/api/admin/billing/test-connection"},
	})
	adminP := &webx.Principal{UserID: "op", IsPlatformAdmin: true, Source: webx.SourceSession}
	for _, c := range []struct{ method, path string }{
		{http.MethodGet, "/api/admin/plans"},
		{http.MethodGet, "/api/admin/orders"},
	} {
		w := mountedAdminReq(mux, adminP, c.method, c.path)
		assert.Equal(t, http.StatusServiceUnavailable, w.Code,
			"%s %s nil Svc 应 503 而非 panic（P3-21）", c.method, c.path)
	}
}

func TestUserOpsMountGuards(t *testing.T) {
	mux := http.NewServeMux()
	MountUserOps(mux, UserOpsDeps{Deps: Deps{Svc: app.NewAdminService(nil, nil)}})
	guardMatrix(t, mux, []struct{ method, path string }{
		{http.MethodGet, "/api/admin/users/u-1"},
		{http.MethodPost, "/api/admin/users/u-1/kick"},
		{http.MethodDelete, "/api/admin/users/u-1"},
	})
	adminP := &webx.Principal{UserID: "op", IsPlatformAdmin: true, Source: webx.SourceSession}
	w := mountedAdminReq(mux, adminP, http.MethodGet, "/api/admin/users/u-1")
	assert.Equal(t, http.StatusServiceUnavailable, w.Code, "nil Ops 应 503")
}
