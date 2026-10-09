package webx

import (
	"bufio"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"runtime/debug"
	"sync/atomic"
	"time"
)

func Recover(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
			defer func() {
				if p := recover(); p != nil {

					log.Error("panic recovered", "path", r.URL.Path, "panic", p,
						"stack", string(debug.Stack()))
					if !rec.wrote.Load() {
						WriteError(w, http.StatusInternalServerError, "E_INTERNAL", "internal error", nil)
					}
				}
			}()
			next.ServeHTTP(rec, r)
		})
	}
}

type statusRecorder struct {
	http.ResponseWriter
	status int
	wrote  atomic.Bool
}

func (r *statusRecorder) WriteHeader(code int) {
	r.wrote.Store(true)
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func (r *statusRecorder) Write(p []byte) (int, error) {
	r.wrote.Store(true)
	return r.ResponseWriter.Write(p)
}

func (r *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := r.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("webx: underlying ResponseWriter does not implement http.Hijacker")
	}
	return h.Hijack()
}

func (r *statusRecorder) Unwrap() http.ResponseWriter { return r.ResponseWriter }

func AccessLog(log *slog.Logger, trustedProxies ...*net.IPNet) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(rec, r)
			level := slog.LevelInfo
			switch {
			case rec.status >= 500:
				level = slog.LevelError
			case rec.status >= 400:
				level = slog.LevelWarn
			}

			user := ""
			if cell := principalCellFrom(r.Context()); cell != nil {
				if p := cell.Get(); p != nil {
					user = p.UserID
				}
			} else if p := PrincipalFrom(r.Context()); p != nil {
				user = p.UserID
			}
			clientPlatform, clientVersion, clientOS := ClientMetadataFrom(r.Context())

			log.Log(r.Context(), level, "http",
				"method", r.Method, "path", r.URL.Path, "status", rec.status,
				"ms", time.Since(start).Milliseconds(), "ip", ClientIP(r, trustedProxies...), "user_id", user,
				"request_id", RequestIDFromCtx(r.Context()),
				"client_platform", clientPlatform, "client_version", clientVersion, "client_os", clientOS)
		})
	}
}

func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		next.ServeHTTP(w, r)
	})
}
