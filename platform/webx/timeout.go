package webx

import (
	"bufio"
	"context"
	"errors"
	"net"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

func Timeout(d time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			serveWithTimeout(w, r, next, d)
		})
	}
}

// TimeoutExcept applies d to every path except the given prefixes. A matching
// prefix is FULLY exempt: the request context gets no deadline at all, so the
// handler owns its own time budget entirely (mounting pitfall #5 — exempted
// endpoints need their own statement-level guard). For per-route timeout
// values see Timeouts.
func TimeoutExcept(d time.Duration, exemptPrefixes ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			for _, prefix := range exemptPrefixes {
				if strings.HasPrefix(r.URL.Path, prefix) {
					next.ServeHTTP(w, r)
					return
				}
			}
			serveWithTimeout(w, r, next, d)
		})
	}
}

// Timeouts is the multi-tier form of TimeoutExcept: paths are matched against
// the override prefixes with the LONGEST matching prefix winning (so
// "/api": 5s, "/api/plans": 30s, "/api/plans/negotiate": 0 nests correctly),
// and a zero override exempts that prefix entirely — no context deadline, the
// handler manages its own budget (the form TimeoutExcept only expresses by
// nesting two middleware layers, where the outer cap can kill a handler that
// still had its own internal deadline to honor). Paths matching no prefix get
// base. Prefix matching is HasPrefix, same as TimeoutExcept: "/ws" also
// matches "/wsroom". Fails fast (panic) at wiring time on a non-positive base
// (which would instantly 504 every unmatched path) or a negative override
// (zero is the documented exempt value).
func Timeouts(base time.Duration, overrides map[string]time.Duration) func(http.Handler) http.Handler {
	if base <= 0 {
		panic("webx: Timeouts base must be > 0 (use a 0 override to exempt a prefix)")
	}
	// Map iteration order is random; sort prefixes by length descending so the
	// most specific match deterministically wins.
	prefixes := make([]string, 0, len(overrides))
	for p, d := range overrides {
		if d < 0 {
			panic("webx: Timeouts override for " + p + " must be >= 0 (0 = exempt)")
		}
		prefixes = append(prefixes, p)
	}
	sort.Slice(prefixes, func(i, j int) bool { return len(prefixes[i]) > len(prefixes[j]) })
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			for _, p := range prefixes {
				if strings.HasPrefix(r.URL.Path, p) {
					if d := overrides[p]; d > 0 {
						serveWithTimeout(w, r, next, d)
					} else {
						next.ServeHTTP(w, r)
					}
					return
				}
			}
			serveWithTimeout(w, r, next, base)
		})
	}
}

func serveWithTimeout(w http.ResponseWriter, r *http.Request, next http.Handler, d time.Duration) {
	ctx, cancel := context.WithTimeout(r.Context(), d)
	defer cancel()
	r = r.WithContext(ctx)

	tw := &timeoutWriter{ResponseWriter: w}
	done := make(chan struct{})
	panicChan := make(chan any, 1)
	go func() {
		defer func() {
			if p := recover(); p != nil {
				panicChan <- p
			}
		}()
		next.ServeHTTP(tw, r)
		close(done)
	}()

	select {
	case p := <-panicChan:

		panic(p)
	case <-done:
	case <-ctx.Done():

		select {
		case p := <-panicChan:
			panic(p)
		case <-done:
			return
		default:
		}
		tw.mu.Lock()
		alreadyWrote := tw.wrote
		tw.timedOut = true
		tw.mu.Unlock()
		if !alreadyWrote {
			WriteError(w, http.StatusGatewayTimeout, CodeTimeout, "request timeout", nil)
		}
	}
}

type timeoutWriter struct {
	http.ResponseWriter
	mu       sync.Mutex
	wrote    bool
	timedOut bool
}

func (t *timeoutWriter) WriteHeader(code int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.timedOut {
		return
	}
	t.wrote = true
	t.ResponseWriter.WriteHeader(code)
}

func (t *timeoutWriter) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.timedOut {
		return 0, http.ErrHandlerTimeout
	}
	t.wrote = true
	return t.ResponseWriter.Write(p)
}

func (t *timeoutWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := t.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("webx: underlying ResponseWriter does not implement http.Hijacker")
	}
	return h.Hijack()
}

func (t *timeoutWriter) Unwrap() http.ResponseWriter { return t.ResponseWriter }
