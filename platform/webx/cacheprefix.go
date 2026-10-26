package webx

import (
	"net/http"
	"strconv"
	"strings"
	"time"
)

// CachePrefix returns middleware that sets Cache-Control on responses whose
// URL path starts with one of the declared prefixes — for the non-hashed
// static files AssetCache deliberately leaves alone.
//
// Why it exists: AssetCache/AssetCacheManifest cache only content-addressed
// files, and the ruling there is that files which can be replaced in place
// (`/favicon.png`, `/brand/logo.png`, product image directories like
// `/shots/*`) get their policy from the product. The practical outcome of
// that ruling was consumers hand-writing per-prefix
// `Set("Cache-Control", ...)` branches inside their SPA handler, with the
// failure a hand-written whitelist invites: one missing prefix silently
// serves a whole image directory with zero cache headers (product field
// report: 838 KiB re-downloaded per returning visit). This helper lets the
// product declare the prefixes instead of implementing the branch.
//
// Matching semantics:
//
//   - **Longest prefix wins.** A map has no iteration order, so "first
//     match" would be non-deterministic; longest match is deterministic and
//     makes the more specific declaration win (`/shots/thumbs/` over
//     `/shots/`).
//   - Prefixes match with strings.HasPrefix against r.URL.Path, the same
//     convention as TimeoutExcept/BodyLimitExcept. Directory prefixes should
//     end in "/": `/shots` also matches `/shots-extra/` — usually not what a
//     directory declaration means.
//   - A missing leading slash is prepended at construction (`shots/` behaves
//     like `/shots/`); an empty prefix or an empty value is ignored (an
//     empty value would set an empty header).
//   - GET/HEAD only; other methods pass through untouched.
//   - No prefix matches → the request passes through with no header, keeping
//     the caller's default.
//   - A matched response carries the declared value only when it is a 2xx
//     (206 excluded) and Cache-Control is not already set. Error responses
//     are never decorated — same ruling as AssetCache: a 404 under a cached
//     prefix must not be pinned, or the browser is entitled to cache the
//     error for the full max-age. A Cache-Control set by the inner handler
//     wins: the inner decision is more specific than a prefix declaration.
//
// Values are used verbatim; the caller controls public/private,
// must-revalidate and friends. For a plain shared-cache TTL see
// CachePrefixTTL.
func CachePrefix(rules map[string]string) func(http.Handler) http.Handler {
	normalized := make(map[string]string, len(rules))
	for prefix, value := range rules {
		if prefix == "" || value == "" {
			continue
		}
		if !strings.HasPrefix(prefix, "/") {
			prefix = "/" + prefix
		}
		normalized[prefix] = value
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodGet && r.Method != http.MethodHead {
				next.ServeHTTP(w, r)
				return
			}
			// Longest-match scan. Two distinct prefixes of equal length can
			// never both match the same path, so map iteration order never
			// decides the winner.
			value, best := "", 0
			for prefix, v := range normalized {
				if len(prefix) > best && strings.HasPrefix(r.URL.Path, prefix) {
					value, best = v, len(prefix)
				}
			}
			if value == "" {
				next.ServeHTTP(w, r)
				return
			}
			// The header is applied when the downstream status is known, not
			// before the call — the decision has to see the status code (see
			// cachePrefixWriter).
			cw := &cachePrefixWriter{ResponseWriter: w, cacheControl: value}
			next.ServeHTTP(cw, r)
			// A handler that returns without writing anything gets an
			// implicit 200 from net/http; headers are still mutable here.
			cw.finish()
		})
	}
}

// CachePrefixTTL is the convenience form of CachePrefix: one shared-cache TTL
// (`public, max-age=<seconds>`) for every listed prefix.
//
// Deliberately NO `immutable`: these files are exactly the ones that can be
// replaced in place, which is why AssetCache excludes them. `immutable` on a
// replaceable file strands returning visitors on old bytes until the max-age
// expires — declare a TTL short enough to tolerate replacement instead. ttl
// is truncated to whole seconds; ttl <= 0 yields `max-age=0` (revalidate
// every time), never a silently longer fallback.
func CachePrefixTTL(paths []string, ttl time.Duration) func(http.Handler) http.Handler {
	seconds := int64(ttl / time.Second)
	if seconds < 0 {
		seconds = 0 // a negative TTL must not emit an invalid negative max-age
	}
	value := "public, max-age=" + strconv.FormatInt(seconds, 10)
	rules := make(map[string]string, len(paths))
	for _, p := range paths {
		rules[p] = value
	}
	return CachePrefix(rules)
}

// cachePrefixWriter decorates the Cache-Control header once the downstream
// status is known, mirroring assetCacheWriter: whether the value applies
// depends on the status code, so it cannot be decided before the inner
// handler runs.
type cachePrefixWriter struct {
	http.ResponseWriter
	cacheControl string
	wroteHeader  bool
}

func (w *cachePrefixWriter) WriteHeader(code int) {
	if w.wroteHeader {
		w.ResponseWriter.WriteHeader(code)
		return
	}
	w.wroteHeader = true
	// 2xx only, and not 206: a partial response is not the whole entity
	// (same exclusion as AssetCache).
	if code >= 200 && code < 300 && code != http.StatusPartialContent {
		w.setHeaderIfAbsent()
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *cachePrefixWriter) Write(b []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(b)
}

// finish applies the header for the implicit-200 case (downstream returned
// without calling WriteHeader or Write).
func (w *cachePrefixWriter) finish() {
	if w.wroteHeader {
		return
	}
	w.wroteHeader = true
	w.setHeaderIfAbsent()
}

// setHeaderIfAbsent fills in the declared value only when nothing more
// specific already set one.
func (w *cachePrefixWriter) setHeaderIfAbsent() {
	if w.Header().Get("Cache-Control") == "" {
		w.Header().Set("Cache-Control", w.cacheControl)
	}
}

// Unwrap keeps http.ResponseController (Flush/Hijack/SetDeadline) working
// through this purely header-decorating layer.
func (w *cachePrefixWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
