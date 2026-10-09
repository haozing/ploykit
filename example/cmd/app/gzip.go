package main

import (
	"compress/gzip"
	"net/http"
	"strings"
	"sync"
)

var gzipPool = sync.Pool{New: func() any { return gzip.NewWriter(nil) }}

func compressibleCT(ct string) bool {
	ct = strings.ToLower(strings.TrimSpace(ct))
	if i := strings.IndexByte(ct, ';'); i >= 0 {
		ct = strings.TrimSpace(ct[:i])
	}
	if strings.HasPrefix(ct, "text/") {
		return true
	}
	switch ct {
	case "application/json", "application/javascript", "application/xml",
		"application/xhtml+xml", "image/svg+xml", "application/wasm":
		return true
	}
	return false
}

type gzipResponseWriter struct {
	w       http.ResponseWriter
	gz      *gzip.Writer
	decided bool
	on      bool
}

func (g *gzipResponseWriter) Header() http.Header { return g.w.Header() }

func (g *gzipResponseWriter) decide() {
	g.decided = true
	if compressibleCT(g.w.Header().Get("Content-Type")) {
		g.start()
	}
}

func (g *gzipResponseWriter) decideSniff(b []byte) {
	g.decided = true
	if compressibleCT(http.DetectContentType(b)) {
		g.start()
	}
}

func (g *gzipResponseWriter) start() {
	if g.w.Header().Get("Content-Encoding") != "" {
		return
	}
	g.on = true
	g.gz = gzipPool.Get().(*gzip.Writer)
	g.gz.Reset(g.w)
	h := g.w.Header()
	h.Set("Content-Encoding", "gzip")
	h.Del("Content-Length")
	h.Add("Vary", "Accept-Encoding")
}

func (g *gzipResponseWriter) WriteHeader(code int) {
	if !g.decided {
		g.decide()
	}
	if !g.on {

		g.w.Header().Add("Vary", "Accept-Encoding")
	}
	g.w.WriteHeader(code)
}

func (g *gzipResponseWriter) Write(b []byte) (int, error) {
	if !g.decided {
		g.decideSniff(b)
		if !g.on {
			g.w.Header().Add("Vary", "Accept-Encoding")
		}
	}
	if g.on {
		return g.gz.Write(b)
	}
	return g.w.Write(b)
}

func (g *gzipResponseWriter) Flush() {
	if g.on && g.gz != nil {
		_ = g.gz.Flush()
	}
	if f, ok := g.w.(http.Flusher); ok {
		f.Flush()
	}
}

func (g *gzipResponseWriter) Close() {
	if g.on && g.gz != nil {
		_ = g.gz.Close()
		gzipPool.Put(g.gz)
		g.gz = nil
	}
}

func gzipMW(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") ||
			r.Header.Get("Range") != "" || r.Method == http.MethodHead {

			w.Header().Add("Vary", "Accept-Encoding")
			next.ServeHTTP(w, r)
			return
		}
		gw := &gzipResponseWriter{w: w}
		defer gw.Close()
		next.ServeHTTP(gw, r)
	})
}
