package metrics

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewMount_ZeroConfigDefaultsEnabled(t *testing.T) {
	m := NewMount(Config{})
	assert.NotNil(t, m.Registry())
	assert.Equal(t, "/metrics", m.Path())

	rec := httptest.NewRecorder()
	m.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), "go_goroutines")
}

func TestNewMount_CustomPath(t *testing.T) {
	assert.Equal(t, "/ops/metrics", NewMount(Config{Path: "/ops/metrics"}).Path())
}

func TestNewMount_DisabledIsNoOp(t *testing.T) {
	off := false
	m := NewMount(Config{Enabled: &off})

	assert.Nil(t, m.Registry())
	assert.Equal(t, "/metrics", m.Path())

	rec := httptest.NewRecorder()
	m.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	assert.Equal(t, http.StatusNotFound, rec.Code)

	var hit bool
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { hit = true })
	returned := m.Middleware(next)

	rec2 := httptest.NewRecorder()
	returned.ServeHTTP(rec2, httptest.NewRequest(http.MethodGet, "/api/x", nil))
	assert.True(t, hit)

	assert.Nil(t, m.Registry())
}

func TestNewMount_NilEnabledMeansEnabled(t *testing.T) {
	require.NotNil(t, NewMount(Config{Enabled: nil}).Registry())
	on := true
	require.NotNil(t, NewMount(Config{Enabled: &on}).Registry())
}

func TestNewMount_TokenGateFromConfig(t *testing.T) {
	gated := NewMount(Config{Token: "s3cret"})
	gated.Registry().Incr("task_completed")

	cases := []struct {
		name     string
		req      *http.Request
		wantCode int
	}{
		{"裸请求 404", httptest.NewRequest(http.MethodGet, "/metrics", nil), http.StatusNotFound},
		{"错误 Bearer 404", withAuthReq(httptest.NewRequest(http.MethodGet, "/metrics", nil), "Bearer wrong"), http.StatusNotFound},
		{"正确 Bearer 200", withAuthReq(httptest.NewRequest(http.MethodGet, "/metrics", nil), "Bearer s3cret"), http.StatusOK},
		{"query 凭据 200", httptest.NewRequest(http.MethodGet, "/metrics?token=s3cret", nil), http.StatusOK},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			gated.Handler().ServeHTTP(rec, c.req)
			assert.Equal(t, c.wantCode, rec.Code)
			if c.wantCode == http.StatusOK {
				assert.Contains(t, rec.Body.String(), "task_completed_total 1")
			}
		})
	}

	open := NewMount(Config{})
	rec := httptest.NewRecorder()
	open.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	require.Equal(t, http.StatusOK, rec.Code)
}

func TestNewMount_WithRegistrySharesRegistry(t *testing.T) {
	reg := New()
	reg.Incr("outbox_backlog")

	m := NewMount(Config{}, WithRegistry(reg))
	assert.Same(t, reg, m.Registry())

	h := m.Middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/x/1", nil))

	rec := httptest.NewRecorder()
	m.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	body := rec.Body.String()
	assert.Contains(t, body, "outbox_backlog_total 1")
	assert.Contains(t, body, `ploykit_http_requests_total{method="GET",route="/api/x/{id}"} 1`)
}

func TestNewMount_ExplicitBucketViewWins(t *testing.T) {
	m := NewMount(Config{}, WithHistogramBuckets(MetricHTTPDurationSeconds, []float64{60, 120}))
	h := m.Middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/slow", nil))

	rec := httptest.NewRecorder()
	m.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), `ploykit_http_request_duration_seconds_bucket{method="GET",route="/slow",le="60"} 1`)
}

func withAuthReq(req *http.Request, auth string) *http.Request {
	req.Header.Set("Authorization", auth)
	return req
}
