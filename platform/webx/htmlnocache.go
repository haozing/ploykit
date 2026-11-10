package webx

import (
	"net/http"
	"strings"
)

// HTMLNoCache marks HTML documents as must-revalidate: every 2xx response
// whose Content-Type is text/html and that carries no Cache-Control of its
// own gets `Cache-Control: no-cache` appended by this layer.
//
// Why it exists: a release rotates the hashed asset URLs (AssetCache /
// AssetCacheManifest) AND deletes the old chunks from the embed. A shell or
// SPA-fallback document served without a cache policy falls back to browser
// heuristic caching — a visitor whose tab outlives the deploy then holds an
// HTML document whose entry chunk no longer exists, and the first dynamic
// route import dies with "Failed to fetch dynamically imported module" until
// a manual hard refresh (field report: stickerscenemaker 2026-11-11, editor
// deep link after a redeploy). The failure window is exactly the gap between
// "old document" and "old document's assets": closing it requires the
// document to revalidate before it is used, which is what no-cache requests.
//
// Rulings mirrored from CachePrefix / AssetCache:
//
//   - GET/HEAD only — other methods pass through untouched.
//   - 2xx only (206 excluded) — error HTML (404 shell downgrade, 5xx error
//     pages) is left alone: a no-cache on an error page costs nothing but
//     the discipline keeps this layer from deciding about responses it did
//     not produce, same as AssetCache never decorating a 404.
//   - An existing Cache-Control wins — the inner decision (renderx embed
//     tiers set `max-age=60, stale-while-revalidate=300`, products may pin
//     their own policy) is more specific than this default.
//
// Scope note: `no-cache` (store, revalidate before use) — deliberately not
// `no-store`, which would kill 304-friendly caching and back/forward restores
// for zero benefit: the documents this middleware targets are small shells
// whose revalidation is one cheap conditional request.
//
// Wiring: wrap the product's frontend handler (the SPA file-server + shell
// fallback), so both the direct mount and the renderx `SPA` delegation point
// inherit the policy from one place.
func HTMLNoCache(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			next.ServeHTTP(w, r)
			return
		}
		// The header is applied when the downstream status is known, not
		// before the call — the decision has to see the status code and the
		// Content-Type the inner handler declared (see htmlNoCacheWriter).
		cw := &htmlNoCacheWriter{ResponseWriter: w}
		next.ServeHTTP(cw, r)
		// A handler that returns without writing anything gets an implicit
		// 200 from net/http; headers are still mutable here.
		cw.finish()
	})
}

// htmlNoCacheWriter decorates the Cache-Control header once the downstream
// status and Content-Type are known, mirroring cachePrefixWriter: whether the
// value applies depends on data only the inner handler can provide, so it
// cannot be decided before the inner handler runs.
type htmlNoCacheWriter struct {
	http.ResponseWriter
	wroteHeader bool
}

// decorate sets no-cache iff the response is an HTML document without a
// Cache-Control of its own. Content-Type is readable here because handlers
// set headers before their first Write/WriteHeader (net/http contract);
// an undeclared type falls back to body sniffing in the notFoundWriter
// pattern — out of scope here, since a response with no Content-Type is not
// a document this layer claims.
func (w *htmlNoCacheWriter) decorate() {
	h := w.Header()
	if ct := h.Get("Content-Type"); strings.HasPrefix(ct, "text/html") && h.Get("Cache-Control") == "" {
		h.Set("Cache-Control", "no-cache")
	}
}

func (w *htmlNoCacheWriter) WriteHeader(code int) {
	if w.wroteHeader {
		w.ResponseWriter.WriteHeader(code)
		return
	}
	w.wroteHeader = true
	if code >= 200 && code < 300 && code != http.StatusPartialContent {
		w.decorate()
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *htmlNoCacheWriter) Write(b []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(b)
}

// finish applies the decoration for the implicit-200 case (downstream
// returned without calling WriteHeader or Write).
func (w *htmlNoCacheWriter) finish() {
	if w.wroteHeader {
		return
	}
	w.wroteHeader = true
	w.decorate()
}

// Unwrap keeps http.ResponseController (Flush/Hijack/SetDeadline) working
// through this purely header-decorating layer.
func (w *htmlNoCacheWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
