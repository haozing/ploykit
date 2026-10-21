package webx

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"
)

// looksContentAddressed reports whether the filename embeds a content
// fingerprint as emitted by Vite/Rollup: `index-CqMeFOQq.js`,
// `vendor-react-DzNlmBu9.js`, `geist-latin-wght-normal-BgDaEnEv.woff2`,
// `app.4f9a2b1c7d8e.js`.
//
// **Prefer AssetCacheManifest over this heuristic.** This function infers the
// answer from the name alone, and that inference cannot be made exact: a
// hand-written name can be shaped exactly like a hash (`Some-Page-Banner.png`,
// `Hero-Image-Large.jpg`, `DOWNLOAD.png` all pass), and tightening the rule to
// reject those also rejects real hashes (`CYhS-pAS`, `B-WCCgPC`, `C-pQOpeV` are
// valid Vite hashes with a separator and no digit). The build's manifest is the
// authoritative list; this predicate exists for products that do not have one
// wired yet.
//
// Shape when it is used: a hash is a run of base64url characters ([A-Za-z0-9_-])
// ending right before the extension, 8..16 chars long, preceded by a separator
// (`-`, `_`, `.`) or the start of the name. 8 is Vite's default; the window
// accommodates custom hash lengths without letting ordinary words qualify.
//
// Two things make it work on real filenames:
//
//   - **The hash itself may contain `-` and `_`.** Splitting on separators and
//     reading the last token silently missed 7 of 36 assets in the example
//     build (`DialogTitle-7-VtvLIt`, `routes-settings-CQZQEAZD`,
//     `input-group-CYhS-pAS`, …): the hash is 8 base64url chars, so a `-`
//     inside it looks like another separator. Hence the sliding suffix.
//   - **Length alone is not a fingerprint.** `hero-image-large.jpg` and
//     `default-avatar-placeholder.svg` end in long lowercase words; pinning
//     those for a year breaks in-place replacement. The candidate must also
//     carry a signature — a digit or an uppercase letter.
//
// Known false positives (a reason to move to AssetCacheManifest): any
// mixed-case or shouting filename, e.g. `Some-Page-Banner.png`,
// `Hero-Image-Large.jpg`, `Logo-Dark.png`, `DOWNLOAD.png`.
func looksContentAddressed(p string) bool {
	base := path.Base(p)
	if base == "" || base == "." || base == "/" {
		return false
	}
	stem := strings.TrimSuffix(base, path.Ext(base))
	if stem == "" {
		return false
	}
	const minLen, maxLen = 8, 16
	for n := minLen; n <= maxLen && n <= len(stem); n++ {
		start := len(stem) - n
		if start > 0 && !isHashBoundary(stem[start-1]) {
			continue
		}
		if isFingerprint(stem[start:]) {
			return true
		}
	}
	return false
}

// isHashBoundary reports whether c separates a hash from the rest of the name.
func isHashBoundary(c byte) bool {
	return c == '-' || c == '_' || c == '.'
}

// isFingerprint applies the signature test to a candidate hash: base64url
// characters only, alphanumeric at both ends, and at least one digit or
// uppercase letter.
//
// Why "digit or uppercase" and not "mixed case": Vite's hash is random
// base64url, so an all-uppercase hash is legal and does occur (`CQZQEAZD` in
// the example build). Ordinary human-written names are all-lowercase words
// (`manifest`, `placeholder`, `large`, `settings`) — requiring either a digit
// or an uppercase letter separates the two populations without rejecting real
// hashes. The one false positive left is a shouty filename (`DOWNLOAD.png`),
// which is rare and whose replacement is still a one-line product decision.
func isFingerprint(s string) bool {
	if s == "" {
		return false
	}
	if !isAlnum(s[0]) || !isAlnum(s[len(s)-1]) {
		return false
	}
	var digit, upper bool
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= '0' && c <= '9':
			digit = true
		case c >= 'A' && c <= 'Z':
			upper = true
		case c >= 'a' && c <= 'z':
			// lowercase letters are the filler of a hash and of ordinary words
		case c == '-' || c == '_':
			// base64url filler inside the hash
		default:
			return false
		}
	}
	return digit || upper
}

func isAlnum(c byte) bool {
	return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}

// AssetCache adds strong caching to content-addressed static assets and passes
// every other request through untouched.
//
// Why it is needed: `http.FileServer` sets no Cache-Control / ETag / Last-
// Modified at all, leaving the browser to heuristic caching. Measured
// consequence: every in-site navigation re-downloaded the entry chunk — the
// same 178KB (gzip) file was fetched twice across a single /login -> /register
// navigation. The bytes saved on first load were paid back on every click.
//
// Why immutable is safe: Vite derives the file name from the content hash, so
// content changes rotate the URL. The bytes behind a given URL never change,
// which means "one year + immutable" cannot serve stale code; a release simply
// stops referencing the old URL and the cache entry becomes unreachable. This
// mirrors what renderx already does by mixing buildID into its cache keys.
//
// Why HTML and unhashed files are left alone: HTML must revalidate, or a
// release strands users on an old document that references deleted assets.
// Paths without a fingerprint (`/favicon.png`, `/brand/logo.png`) can be
// replaced in place, so any policy for them belongs to the product.
func AssetCache(next http.Handler) http.Handler {
	return AssetCacheWithTTL(next, 365*24*time.Hour)
}

// AssetCacheWithTTL is the configurable variant; ttl <= 0 falls back to a year.
//
// Content addressing is inferred from the filename (see
// looksContentAddressed). When the build's manifest is available, use
// AssetCacheManifest instead: the inference has false positives that no name
// rule can eliminate.
func AssetCacheWithTTL(next http.Handler, ttl time.Duration) http.Handler {
	return assetCache(next, ttl, nil, looksContentAddressed)
}

// AssetCacheManifest is the exact variant: `files` is the set of paths the
// build actually emitted (leading slash optional), typically extracted from
// Vite's `manifest.json`.
//
// Why it exists: every other form of this middleware has to GUESS whether a URL
// is content-addressed, and the guess has a false-positive class that breaks
// in-place replacement — a hand-written `Some-Page-Banner.png` looks exactly
// like a fingerprint, gets `immutable, max-age=1y`, and then keeps serving old
// bytes to returning visitors after the product replaces the file. The manifest
// removes the guess: a path is immutable iff the build listed it.
//
// Wiring: build the set once at startup (it is read-only afterwards) and mount
// this instead of AssetCache. Products that cannot reach their manifest keep
// using AssetCache and accept the documented false positives.
//
// `files` keys are matched against r.URL.Path after prepending "/" when absent,
// so both `assets/app-abc123.js` and `/assets/app-abc123.js` are accepted.
// Non-content-addressed files (HTML, favicons, uploads) must simply be left out
// of the set — anything absent passes through untouched.
func AssetCacheManifest(next http.Handler, files []string) http.Handler {
	return AssetCacheManifestWithTTL(next, files, 365*24*time.Hour)
}

// AssetCacheManifestWithTTL is the configurable-TTL variant.
func AssetCacheManifestWithTTL(next http.Handler, files []string, ttl time.Duration) http.Handler {
	set := make(map[string]struct{}, len(files))
	for _, f := range files {
		if f == "" {
			continue
		}
		if !strings.HasPrefix(f, "/") {
			f = "/" + f
		}
		set[f] = struct{}{}
	}
	return assetCache(next, ttl, func(p string) bool {
		_, ok := set[p]
		return ok
	}, nil)
}

// assetCache is the shared implementation. Exactly one of `exact` / `heuristic`
// is non-nil; keeping them separate makes it impossible to accidentally fall
// back to the heuristic in the exact variant.
func assetCache(
	next http.Handler,
	ttl time.Duration,
	exact func(path string) bool,
	heuristic func(path string) bool,
) http.Handler {
	if ttl <= 0 {
		ttl = 365 * 24 * time.Hour
	}
	isImmutable := exact
	if isImmutable == nil {
		isImmutable = heuristic
	}
	cacheControl := "public, max-age=" + strconv.FormatInt(int64(ttl/time.Second), 10) + ", immutable"
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			next.ServeHTTP(w, r)
			return
		}
		if !isImmutable(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		// The entity tag is a digest of the URL: under content addressing the URL
		// stands in for the content fingerprint, and this avoids reading the file
		// first. Some intermediaries ignore `immutable` but still honour ETag, so
		// this layer exists for them.
		sum := sha256.Sum256([]byte(r.URL.Path))
		tag := `"` + hex.EncodeToString(sum[:16]) + `"`
		if matchETag(r, tag) {
			h := w.Header()
			h.Set("Cache-Control", cacheControl)
			h.Set("ETag", tag)
			// A 304 never reaches the inner compression layer, so it would
			// otherwise be the one response for this URL without a Vary — a
			// shared cache could then pair the 304 with the wrong stored variant.
			if !hasVaryToken(h, "Accept-Encoding") {
				h.Add("Vary", "Accept-Encoding")
			}
			w.WriteHeader(http.StatusNotModified)
			return
		}
		// Headers are applied when the downstream status is known, NOT before the
		// call: a fingerprint path that 404s (deleted asset, typo, transient
		// deploy mismatch) must not come back with `immutable, max-age=1y` — a
		// browser is then entitled to pin the error response for a year, and the
		// retry that would have succeeded never happens.
		cw := &assetCacheWriter{
			ResponseWriter: w,
			cacheControl:   cacheControl,
			etag:           tag,
		}
		next.ServeHTTP(cw, r)
		// A handler that returns without writing anything gets an implicit 200
		// from net/http; the headers are still mutable at this point.
		cw.finish()
	})
}

type assetCacheWriter struct {
	http.ResponseWriter
	cacheControl string
	etag         string
	wroteHeader  bool
}

func (w *assetCacheWriter) WriteHeader(code int) {
	if w.wroteHeader {
		w.ResponseWriter.WriteHeader(code)
		return
	}
	w.wroteHeader = true
	// 2xx only, and not 206: a partial response is not the whole immutable
	// entity and some caches treat it differently.
	if code >= 200 && code < 300 && code != http.StatusPartialContent {
		h := w.ResponseWriter.Header()
		h.Set("Cache-Control", w.cacheControl)
		h.Set("ETag", w.etag)
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *assetCacheWriter) Write(b []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(b)
}

// finish applies the headers for the implicit-200 case (downstream returned
// without calling WriteHeader or Write).
func (w *assetCacheWriter) finish() {
	if w.wroteHeader {
		return
	}
	w.wroteHeader = true
	h := w.ResponseWriter.Header()
	h.Set("Cache-Control", w.cacheControl)
	h.Set("ETag", w.etag)
}

// Unwrap keeps http.ResponseController (Flush/Hijack/SetDeadline) working
// through this purely header-decorating layer.
func (w *assetCacheWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// matchETag handles If-None-Match: `*`, comma-separated lists and the weak
// `W/` prefix. The comparison is weak on both sides (the prefix is stripped
// from the request's value and from ours alike), so a proxy or client that
// downgrades the tag to `W/"..."` still gets its 304.
func matchETag(r *http.Request, tag string) bool {
	in := strings.TrimSpace(r.Header.Get("If-None-Match"))
	if in == "" {
		return false
	}
	if in == "*" {
		return true
	}
	want := strings.TrimPrefix(tag, "W/")
	for _, part := range strings.Split(in, ",") {
		if strings.TrimPrefix(strings.TrimSpace(part), "W/") == want {
			return true
		}
	}
	return false
}
