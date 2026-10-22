package webx

import (
	"compress/gzip"
	"net/http"
	"strconv"
	"strings"
	"sync"
)

// gzipWriterPool recycles writers across requests; gzip.NewWriter allocates
// ~64KB of window buffers, which per-request would dwarf typical HTML bodies.
var gzipWriterPool = sync.Pool{New: func() any { return gzip.NewWriter(nil) }}

// gzipCompressible reports whether a Content-Type is worth compressing. Text
// formats only: re-compressing an already-compressed body (png, woff2, mp4)
// spends CPU to grow the response, so they pass through untouched.
//
// image/svg+xml and application/wasm are text. application/wasm compresses ~3:1
// and (unlike JS) has no build-time sidecar story, so runtime gzip is its lane.
func gzipCompressible(ct string) bool {
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

// acceptsGzip parses Accept-Encoding for a usable `gzip` token, honouring
// `q=0` as an explicit refusal. Substring matching (as in an earlier
// hand-written version) misfires twice: `x-gzip` is not gzip, and `gzip;q=0`
// is a refusal the substring still "finds".
func acceptsGzip(header string) bool {
	for _, part := range strings.Split(header, ",") {
		token := strings.TrimSpace(part)
		if token == "" {
			continue
		}
		name, params, _ := strings.Cut(token, ";")
		if !strings.EqualFold(strings.TrimSpace(name), "gzip") {
			continue
		}
		for _, p := range strings.Split(params, ";") {
			v, ok := strings.CutPrefix(strings.ToLower(strings.TrimSpace(p)), "q=")
			if !ok {
				continue
			}
			if q, err := strconv.ParseFloat(strings.TrimSpace(v), 64); err == nil && q <= 0 {
				return false
			}
		}
		return true
	}
	return false
}

// Gzip compresses text responses when the client accepts gzip.
//
// The runtime lane of the framework's compression design: brotli is a
// build-time sidecar (webx.Precompressed — Go ships no brotli encoder, and -q
// 11 at build time beats anything runtime could afford), while gzip runs here
// because compress/gzip is stdlib and level-5 CPU cost is microseconds per KB.
// What each layer compresses barely overlaps: Precompressed answers for the
// static asset surface before the file server runs; this layer covers
// everything dynamic (renderx HTML, API JSON, SSE-less streaming responses).
//
// Positioning: OUTERMost of the response-shaping middlewares, wrapping
// Precompressed/AssetCache and the handlers. It skips bodies that already
// carry a Content-Encoding, which is exactly how Precompressed's brotli
// responses pass through untouched.
//
// Deliberate pass-throughs, each with a reason:
//
//   - Range requests: the client asked for specific bytes of the identity
//     body; re-encoding would desynchronize offsets.
//
//   - HEAD: no body to compress, and advertising a Content-Encoding for an
//     empty response misleads caches.
//
//   - Non-compressible Content-Type: see gzipCompressible.
//
//   - Responses that set their own Content-Encoding (Precompressed already did).
//
//     A preset Content-Length is NOT a skip: http.FileServer sets it for every
//     small file, and dropping compression there would gut the middleware's
//     purpose. `start` deletes the header and the compressed length takes over.
//
// Vary: Accept-Encoding is stamped on every response this layer touches,
// compressed or not — a shared cache must never pair an identity variant with
// a gzip-accepting client or vice versa (deduped via hasVaryToken, shared with
// Precompressed).
//
// Content-Type is decided either by the handler's header (WriteHeader path) or
// by sniffing the first Write (http.DetectContentType) when the handler set
// none — same fallback the net/http file server uses.
func Gzip(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// These three bypasses still announce the negotiation: the SAME url can
		// be served compressed to other clients.
		if !acceptsGzip(r.Header.Get("Accept-Encoding")) ||
			r.Header.Get("Range") != "" || r.Method == http.MethodHead {
			if !hasVaryToken(w.Header(), "Accept-Encoding") {
				w.Header().Add("Vary", "Accept-Encoding")
			}
			next.ServeHTTP(w, r)
			return
		}
		gw := &gzipResponseWriter{ResponseWriter: w}
		defer gw.close()
		next.ServeHTTP(gw, r)
	})
}

type gzipResponseWriter struct {
	http.ResponseWriter
	gz      *gzip.Writer
	decided bool
	on      bool
}

func (g *gzipResponseWriter) Header() http.Header { return g.ResponseWriter.Header() }

// decide settles compression using the handler's declared Content-Type.
func (g *gzipResponseWriter) decide() {
	g.decided = true
	if gzipCompressible(g.Header().Get("Content-Type")) {
		g.start()
	}
}

// decideSniff settles compression from the first body chunk when the handler
// did not declare a Content-Type.
func (g *gzipResponseWriter) decideSniff(b []byte) {
	g.decided = true
	if gzipCompressible(http.DetectContentType(b)) {
		g.start()
	}
}

func (g *gzipResponseWriter) start() {
	// An inner layer (webx.Precompressed) already encoded this body; stacking
	// gzip on brotli grows the response and no client can decode the result.
	if g.Header().Get("Content-Encoding") != "" {
		return
	}
	g.on = true
	g.gz = gzipWriterPool.Get().(*gzip.Writer)
	g.gz.Reset(g.ResponseWriter)
	h := g.Header()
	h.Set("Content-Encoding", "gzip")
	h.Del("Content-Length")
	if !hasVaryToken(h, "Accept-Encoding") {
		h.Add("Vary", "Accept-Encoding")
	}
}

func (g *gzipResponseWriter) WriteHeader(code int) {
	if !g.decided {
		g.decide()
	}
	if !g.on && !hasVaryToken(g.Header(), "Accept-Encoding") {
		g.Header().Add("Vary", "Accept-Encoding")
	}
	g.ResponseWriter.WriteHeader(code)
}

func (g *gzipResponseWriter) Write(b []byte) (int, error) {
	if !g.decided {
		g.decideSniff(b)
		if !g.on && !hasVaryToken(g.Header(), "Accept-Encoding") {
			g.Header().Add("Vary", "Accept-Encoding")
		}
	}
	if g.on {
		return g.gz.Write(b)
	}
	return g.ResponseWriter.Write(b)
}

// Flush keeps streaming responses live: flush the compressor first so the
// client sees real bytes, then the underlying connection.
func (g *gzipResponseWriter) Flush() {
	if g.on && g.gz != nil {
		_ = g.gz.Flush()
	}
	if f, ok := g.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (g *gzipResponseWriter) close() {
	if g.on && g.gz != nil {
		_ = g.gz.Close()
		gzipWriterPool.Put(g.gz)
		g.gz = nil
	}
}

// Unwrap keeps http.ResponseController (Hijack/SetDeadline) working through
// this layer — SSE/websocket upgrades initiated below it must not fail.
func (g *gzipResponseWriter) Unwrap() http.ResponseWriter { return g.ResponseWriter }
