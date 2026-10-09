package metrics

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalizePath(t *testing.T) {
	cases := []struct{ in, want string }{
		{"/", "/"},
		{"", "/"},
		{"/api/tasks", "/api/tasks"},
		{"/api/tasks/123", "/api/tasks/{id}"},
		{"/api/tasks/123/comments/456", "/api/tasks/{id}/comments/{id}"},
		{"/api/users/550e8400-e29b-41d4-a716-446655440000/posts", "/api/users/{id}/posts"},
		{"/files/1A2B3C4D5E", "/files/{id}"},
		{"/files/deadbeef1234", "/files/{id}"},
		{"/a/AbCdEf1234567890Xy", "/a/{id}"},
		{"/api/v1/sessions", "/api/v1/sessions"},
		{"/api/users/alice", "/api/users/alice"},
		{"/static/logo.png", "/static/logo.png"},
		{"/api//x///y", "/api/x/y"},
		{"/api/tasks/", "/api/tasks"},
	}
	for _, c := range cases {
		assert.Equal(t, c.want, normalizePath(c.in), "normalizePath(%q)", c.in)
	}
}

func TestLooksLikeValue(t *testing.T) {
	assert.True(t, looksLikeValue("123"))
	assert.True(t, looksLikeValue("550e8400-e29b-41d4-a716-446655440000"))
	assert.True(t, looksLikeValue("550e8400e29b41d4a716446655440000"))
	assert.True(t, looksLikeValue("deadbeef1234"))
	assert.True(t, looksLikeValue("01ARZ3NDEKTSV4RRFFQ69G5FAV"))
	assert.False(t, looksLikeValue("tasks"))
	assert.False(t, looksLikeValue("v1"))
	assert.False(t, looksLikeValue("logo.png"))
	assert.False(t, looksLikeValue("0x1A2B"))
}

func TestMiddleware_CountsByMethodAndFoldedRoute(t *testing.T) {
	m := NewMount(Config{})
	var hits int
	h := m.Middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits++
		w.WriteHeader(http.StatusOK)
	}))

	for _, p := range []string{"/api/tasks/123", "/api/tasks/456", "/api/tasks/789"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
		require.Equal(t, http.StatusOK, rec.Code)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/tasks/123", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, 4, hits)

	snap := m.Registry().Snapshot()
	assert.Equal(t, int64(3), snap[`ploykit_http_requests{method=GET,route=/api/tasks/{id}}`])
	assert.Equal(t, int64(1), snap[`ploykit_http_requests{method=POST,route=/api/tasks/{id}}`])
}

func TestMiddleware_PrefersServeMuxPattern(t *testing.T) {
	m := NewMount(Config{})
	mux := http.NewServeMux()
	mux.Handle("/api/tasks/{id}", m.Middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})))

	for _, p := range []string{"/api/tasks/1", "/api/tasks/xyz"} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
		require.Equal(t, http.StatusOK, rec.Code)
	}

	assert.Equal(t, int64(2), m.Registry().Snapshot()[`ploykit_http_requests{method=GET,route=/api/tasks/{id}}`])
}

func TestMiddleware_DurationHistogramExported(t *testing.T) {
	m := NewMount(Config{})
	h := m.Middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/users/alice", nil))

	out := httptest.NewRecorder()
	m.Handler().ServeHTTP(out, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	require.Equal(t, http.StatusOK, out.Code)
	body := out.Body.String()
	assert.Contains(t, body, `ploykit_http_requests_total{method="GET",route="/api/users/alice"} 1`)
	assert.Contains(t, body, `ploykit_http_request_duration_seconds_count{method="GET",route="/api/users/alice"} 1`)

	assert.Contains(t, body, `ploykit_http_request_duration_seconds_bucket{method="GET",route="/api/users/alice",le="0.5"} 1`)
}

func TestMiddleware_RouteCardinalityCapFallsBackToOther(t *testing.T) {
	m := NewMount(Config{})
	m.seenMu.Lock()
	m.seen = make(map[string]struct{}, maxRoutes)
	for i := 0; i < maxRoutes; i++ {
		m.seen["/seen/route"+strconv.Itoa(i)] = struct{}{}
	}
	m.seenMu.Unlock()

	h := m.Middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/brand/new/route", nil))
	require.Equal(t, http.StatusOK, rec.Code)

	assert.Equal(t, int64(1), m.Registry().Snapshot()[`ploykit_http_requests{method=GET,route=other}`])

	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, httptest.NewRequest(http.MethodGet, "/seen/route0", nil))
	assert.Equal(t, int64(1), m.Registry().Snapshot()[`ploykit_http_requests{method=GET,route=/seen/route0}`])
}
