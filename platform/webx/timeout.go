package webx

import (
	"bufio"
	"context"
	"errors"
	"net"
	"net/http"
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
