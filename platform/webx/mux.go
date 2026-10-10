package webx

import (
	"net/http"
	"slices"
	"strings"
	"sync"
)

// Router is the route-registration surface every framework Mount function
// accepts. *http.ServeMux satisfies it, so products keeping a std mux keep
// compiling unchanged; passing a *Mux additionally records the route set for
// runtime introspection (see Mux).
type Router interface {
	Handle(pattern string, h http.Handler)
	HandleFunc(pattern string, f func(http.ResponseWriter, *http.Request))
}

// The std mux satisfies Router — the compile-time proof that widening Mount
// signatures from *http.ServeMux to Router is source-compatible.
var _ Router = (*http.ServeMux)(nil)

// RouteInfo describes one registered route pattern.
type RouteInfo struct {
	// Method is the leading HTTP method of the pattern ("GET", "POST", ...).
	// It is "" when the pattern carries no method prefix (mounts, catch-alls,
	// subtree handlers) — by convention those are not endpoints.
	Method string
	// Path is the pattern minus the method prefix, kept literal: wildcards
	// like {id} are preserved exactly as registered.
	Path string
	// Pattern is the raw pattern as registered (method prefix included).
	Pattern string
}

// newRouteInfo splits a Go 1.22 ServeMux pattern into its optional leading
// method and the rest. Per the ServeMux pattern syntax ("[METHOD ][HOST]/PATH")
// everything before the first space is the method when a space is present.
func newRouteInfo(pattern string) RouteInfo {
	method, path := "", pattern
	if i := strings.IndexByte(pattern, ' '); i >= 0 {
		method, path = pattern[:i], pattern[i+1:]
	}
	return RouteInfo{Method: method, Path: path, Pattern: pattern}
}

// Mux wraps *http.ServeMux and records every registered pattern, giving
// products route introspection the std mux lacks (the chi.Walk equivalent):
// Routes() returns a sorted, immutable snapshot for diagnostics, route
// listings, and runtime↔OpenAPI contract tests. Serving behavior is the
// delegated std mux, unchanged.
type Mux struct {
	mu       sync.Mutex
	routes   []RouteInfo
	delegate *http.ServeMux
}

var (
	_ Router       = (*Mux)(nil)
	_ http.Handler = (*Mux)(nil)
)

// NewMux returns an empty recording mux.
func NewMux() *Mux {
	return &Mux{delegate: http.NewServeMux()}
}

// Handle records the pattern and delegates to the wrapped *http.ServeMux.
func (m *Mux) Handle(pattern string, h http.Handler) {
	m.record(pattern)
	m.delegate.Handle(pattern, h)
}

// HandleFunc records the pattern and delegates to the wrapped *http.ServeMux.
func (m *Mux) HandleFunc(pattern string, f func(http.ResponseWriter, *http.Request)) {
	m.record(pattern)
	m.delegate.HandleFunc(pattern, f)
}

func (m *Mux) record(pattern string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.routes = append(m.routes, newRouteInfo(pattern))
}

// Routes returns a sorted (by Path, then Method) immutable snapshot of the
// patterns registered on this Mux. Routes registered on a nested sub-mux are
// NOT included: only direct registrations are recorded.
func (m *Mux) Routes() []RouteInfo {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]RouteInfo, len(m.routes))
	copy(out, m.routes)
	slices.SortStableFunc(out, func(a, b RouteInfo) int {
		if c := strings.Compare(a.Path, b.Path); c != 0 {
			return c
		}
		return strings.Compare(a.Method, b.Method)
	})
	return out
}

// ServeHTTP delegates to the wrapped *http.ServeMux.
func (m *Mux) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	m.delegate.ServeHTTP(w, r)
}
