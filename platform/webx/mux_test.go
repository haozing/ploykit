package webx

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Compile-time: the std mux satisfies Router, so every Mount(mux webx.Router)
// keeps accepting a plain http.NewServeMux() — existing product wiring and
// domain tests stay source-compatible.
var _ Router = (*http.ServeMux)(nil)

func TestMux_RecordsMethodAndMountPatterns(t *testing.T) {
	m := NewMux()
	m.HandleFunc("GET /api/things", func(http.ResponseWriter, *http.Request) {})
	m.HandleFunc("DELETE /api/things/{id}", func(http.ResponseWriter, *http.Request) {})
	m.Handle("POST /api/things/{id}/done", http.NotFoundHandler())
	m.Handle("/api/things/", http.NotFoundHandler()) // subtree mount, no method
	m.Handle("/", http.NotFoundHandler())            // root fallback, no method

	routes := m.Routes()
	require.Len(t, routes, 5, "每个注册模式恰好记录一条")

	byPattern := make(map[string]RouteInfo, len(routes))
	for _, ri := range routes {
		byPattern[ri.Pattern] = ri
	}

	get := byPattern["GET /api/things"]
	assert.Equal(t, "GET", get.Method)
	assert.Equal(t, "/api/things", get.Path)

	del := byPattern["DELETE /api/things/{id}"]
	assert.Equal(t, "DELETE", del.Method)
	assert.Equal(t, "/api/things/{id}", del.Path, "通配符保持字面量，不做归一化")

	mount := byPattern["/api/things/"]
	assert.Equal(t, "", mount.Method, "无方法前缀的挂载 Mode 应为空（非端点约定）")
	assert.Equal(t, "/api/things/", mount.Path)
	assert.Equal(t, "/api/things/", mount.Pattern)

	root := byPattern["/"]
	assert.Equal(t, "", root.Method)
}

func TestMux_RoutesSnapshotSortedAndImmutable(t *testing.T) {
	m := NewMux()
	m.HandleFunc("POST /b", func(http.ResponseWriter, *http.Request) {})
	m.HandleFunc("GET /a", func(http.ResponseWriter, *http.Request) {})
	m.Handle("DELETE /a", http.NotFoundHandler())
	m.Handle("PUT /a", http.NotFoundHandler())

	snap := m.Routes()

	// sorted by Path then Method
	var got []string
	for _, ri := range snap {
		got = append(got, ri.Method+" "+ri.Path)
	}
	assert.Equal(t, []string{"DELETE /a", "GET /a", "PUT /a", "POST /b"}, got)

	// mutating the snapshot must not leak into the mux's records
	snap[0].Method = "PATCH"
	snap[0].Path = "/mutated"
	snap = append(snap[:0], RouteInfo{Method: "GET", Path: "/clobbered"})

	again := m.Routes()
	require.Len(t, again, 4)
	assert.Equal(t, "DELETE", again[0].Method)
	assert.Equal(t, "/a", again[0].Path)
	assert.Equal(t, "/b", again[3].Path)
}

func TestMux_ConcurrentRegistrationIsSafe(t *testing.T) {
	m := NewMux()
	const workers, perWorker = 8, 50

	var wg sync.WaitGroup
	for w := range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range perWorker {
				m.HandleFunc(fmt.Sprintf("GET /w%d/%d", w, i), func(http.ResponseWriter, *http.Request) {})
			}
		}()
	}
	wg.Wait()

	routes := m.Routes()
	require.Len(t, routes, workers*perWorker, "并发注册不允许丢条目或数据竞争（-race 下跑）")

	// snapshot stays sorted: every neighbor pair is non-decreasing
	for i := 1; i < len(routes); i++ {
		prev, cur := routes[i-1], routes[i]
		if prev.Path == cur.Path {
			require.LessOrEqual(t, prev.Method, cur.Method)
		} else {
			require.Less(t, prev.Path, cur.Path)
		}
	}
}

func TestMux_DelegatesServingToStdMux(t *testing.T) {
	m := NewMux()
	m.HandleFunc("GET /api/ping", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
		_, _ = w.Write([]byte("pong"))
	})

	rec := httptest.NewRecorder()
	m.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/ping", nil))
	assert.Equal(t, http.StatusTeapot, rec.Code)
	assert.Equal(t, "pong", rec.Body.String())

	// method mismatch still follows std mux semantics (405), proving delegation
	rec = httptest.NewRecorder()
	m.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/ping", nil))
	assert.Equal(t, http.StatusMethodNotAllowed, rec.Code)
}
