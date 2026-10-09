package http

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/admin/app"
	"github.com/haozing/ploykit/platform/webx"
)

type httpFakeAnalytics struct {
	got struct {
		eventType string
		limit     int
	}
	rows []app.AnalyticsEventRow
}

func (f *httpFakeAnalytics) Recent(_ context.Context, eventType string, limit int) ([]app.AnalyticsEventRow, error) {
	f.got.eventType, f.got.limit = eventType, limit
	return f.rows, nil
}

func newAnalyticsMux(port app.AnalyticsRecentEvents) *http.ServeMux {
	svc := app.NewWsOpsService(app.NewAdminService(&fakeRepo{}, time.Now)).WithAnalyticsEvents(port)
	mux := http.NewServeMux()
	MountWsOps(mux, WsOpsDeps{Svc: svc})
	return mux
}

func analyticsReq(mux *http.ServeMux, admin bool, path string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodGet, path, nil)
	r = r.WithContext(webx.WithPrincipal(r.Context(), &webx.Principal{UserID: "op", IsPlatformAdmin: admin}))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	return w
}

func TestAnalyticsRecent_Auth(t *testing.T) {
	mux := newAnalyticsMux(&httpFakeAnalytics{})

	t.Run("未认证 401", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodGet, "/api/admin/analytics/recent", nil)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		assert.Equal(t, http.StatusUnauthorized, w.Code)
	})
	t.Run("非平台管理员 403", func(t *testing.T) {
		w := analyticsReq(mux, false, "/api/admin/analytics/recent")
		assert.Equal(t, http.StatusForbidden, w.Code)
		assert.Contains(t, w.Body.String(), "E_FORBIDDEN")
	})
}

func TestAnalyticsRecent_Query(t *testing.T) {
	t.Run("缺省：limit=20、type 空（全类型）", func(t *testing.T) {
		port := &httpFakeAnalytics{rows: []app.AnalyticsEventRow{{ID: 3, Type: "user_registered"}}}
		w := analyticsReq(newAnalyticsMux(port), true, "/api/admin/analytics/recent")
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		assert.Equal(t, 20, port.got.limit)
		assert.Empty(t, port.got.eventType)

		var rows []app.AnalyticsEventRow
		require.NoError(t, json.NewDecoder(w.Body).Decode(&rows))
		require.Len(t, rows, 1)
		assert.Equal(t, "user_registered", rows[0].Type)
	})

	t.Run("type 过滤与合法 limit 透传（边界 1/100）", func(t *testing.T) {
		port := &httpFakeAnalytics{}
		w := analyticsReq(newAnalyticsMux(port), true, "/api/admin/analytics/recent?type=checkout_started&limit=1")
		require.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, "checkout_started", port.got.eventType)
		assert.Equal(t, 1, port.got.limit)

		port2 := &httpFakeAnalytics{}
		w2 := analyticsReq(newAnalyticsMux(port2), true, "/api/admin/analytics/recent?limit=100")
		require.Equal(t, http.StatusOK, w2.Code)
		assert.Equal(t, 100, port2.got.limit)
	})

	for _, tc := range []struct {
		q, why string
	}{
		{q: "limit=0", why: "零"},
		{q: "limit=-3", why: "负数"},
		{q: "limit=101", why: "超上限"},
		{q: "limit=abc", why: "非整数"},
	} {
		t.Run("非法 limit 400："+tc.why, func(t *testing.T) {
			port := &httpFakeAnalytics{}
			w := analyticsReq(newAnalyticsMux(port), true, "/api/admin/analytics/recent?"+tc.q)
			assert.Equal(t, http.StatusBadRequest, w.Code)
			assert.Contains(t, w.Body.String(), "E_VALIDATION")
			assert.Contains(t, w.Body.String(), "limit must be an integer between 1 and 100")
			assert.Zero(t, port.got.limit, "非法请求不得触达端口")
		})
	}

	t.Run("未接线端口 → 503 E_UNAVAILABLE", func(t *testing.T) {
		w := analyticsReq(newAnalyticsMux(nil), true, "/api/admin/analytics/recent")
		assert.Equal(t, http.StatusServiceUnavailable, w.Code)
		assert.Contains(t, w.Body.String(), "E_UNAVAILABLE")
	})
}
