package metrics

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHandler_ExposesBridgedAndRuntimeMetrics(t *testing.T) {
	r := New()
	r.Incr("task_completed")
	r.IncrAttrs("sweep_hits", map[string]string{"kind": "runtime_recovery"})
	r.Gauge("ws_connections", 3)
	r.Observe("wait_seconds", 0.42)

	rec := httptest.NewRecorder()
	r.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	require.Equal(t, http.StatusOK, rec.Code)

	body := rec.Body.String()
	assert.Contains(t, body, "task_completed_total 1")
	assert.Contains(t, body, `sweep_hits_total{kind="runtime_recovery"}`)
	assert.Contains(t, body, "ws_connections 3")
	assert.Contains(t, body, "wait_seconds_count 1")
	assert.Contains(t, body, "go_goroutines")
}

func TestHandlerWithToken_Gate(t *testing.T) {
	r := New()
	r.Incr("task_completed")
	h := r.HandlerWithToken("s3cret")

	cases := []struct {
		name        string
		req         *http.Request
		wantCode    int
		wantBodyHas string
	}{
		{"未带任何凭据：404", httptest.NewRequest(http.MethodGet, "/metrics", nil), http.StatusNotFound, "404 page not found"},
		{"错误 Bearer：404", withAuth(httptest.NewRequest(http.MethodGet, "/metrics", nil), "Bearer wrong"), http.StatusNotFound, ""},
		{"非 Bearer 头不参与校验：404", withAuth(httptest.NewRequest(http.MethodGet, "/metrics", nil), "Basic s3cret"), http.StatusNotFound, ""},
		{"只有 Bearer 前缀空值：404", withAuth(httptest.NewRequest(http.MethodGet, "/metrics", nil), "Bearer "), http.StatusNotFound, ""},
		{"正确 Bearer：200 且吐指标", withAuth(httptest.NewRequest(http.MethodGet, "/metrics", nil), "Bearer s3cret"), http.StatusOK, "task_completed_total 1"},
		{"query 参数凭据：200", httptest.NewRequest(http.MethodGet, "/metrics?token=s3cret", nil), http.StatusOK, "task_completed_total 1"},
		{"query 参数错误值：404", httptest.NewRequest(http.MethodGet, "/metrics?token=wrong", nil), http.StatusNotFound, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, tc.req)

			assert.Equal(t, tc.wantCode, rec.Code)
			if tc.wantBodyHas != "" {
				assert.Contains(t, rec.Body.String(), tc.wantBodyHas)
			}
		})
	}
}

func TestHandlerWithToken_EmptyTokenDisablesGate(t *testing.T) {
	r := New()
	r.Incr("task_completed")

	rec := httptest.NewRecorder()
	r.HandlerWithToken("").ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), "task_completed_total 1")
}

func withAuth(req *http.Request, auth string) *http.Request {
	req.Header.Set("Authorization", auth)
	return req
}
