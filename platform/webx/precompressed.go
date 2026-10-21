package webx

import (
	"io"
	"io/fs"
	"net/http"
	"path"
	"strconv"
	"strings"
)

// Precompressed serves a brotli sidecar file (`app.js.br`) when the client
// accepts it and the sidecar exists, falling back to the identity file
// otherwise.
//
// Why precompressed instead of compressing on the fly: Go's standard library
// ships a brotli *decoder* but no encoder, so runtime brotli would mean a third
// party dependency plus per-request CPU. The build already knows the bytes and
// can afford `-q 11`, which is ~14% smaller than gzip -9 on the framework chunk
// (measured: 171KB → 144KB for the example's entry bundle). Lazy route chunks
// are a few KB, where the difference is noise — this pays on the entry bundle
// and on CSS.
//
// Wiring contract: the caller must mount whatever produces `.br` files into the
// same fs.FS as the originals, and must set `Vary: Accept-Encoding` on every
// response that could differ — including the identity one, or a shared cache
// will hand a brotli body to a client that never advertised support.
func Precompressed(fsys fs.FS) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Always announce the negotiation, even when no sidecar exists. Set
			// rather than Add: the outer gzip layer adds the same token, and two
			// identical Vary lines are noise (some proxies treat duplicates as a
			// sign of a misconfigured chain).
			if !hasVaryToken(w.Header(), "Accept-Encoding") {
				w.Header().Add("Vary", "Accept-Encoding")
			}

			// Only safe methods, and no range requests: a sidecar is served as the
			// whole encoded entity, so a `Range` request would silently receive
			// 200 + full body instead of the 206 the client asked for (and the
			// outer gzip layer already bypasses ranged requests for the same
			// reason). Let the file server handle both cases.
			if (r.Method != http.MethodGet && r.Method != http.MethodHead) || r.Header.Get("Range") != "" {
				next.ServeHTTP(w, r)
				return
			}
			if !acceptsBrotli(r.Header.Get("Accept-Encoding")) {
				next.ServeHTTP(w, r)
				return
			}
			// A request that only resolves inside the root after cleaning (`..`,
			// duplicate slashes) must not reach the sidecar lookup at all: the
			// cleaned name would otherwise open a file the raw path never
			// addressed (regression caught by TestPrecompressedRejectsTraversal).
			cleaned := path.Clean("/" + r.URL.Path)
			if cleaned != "/"+strings.TrimPrefix(r.URL.Path, "/") {
				next.ServeHTTP(w, r)
				return
			}
			name := strings.TrimPrefix(cleaned, "/")
			// Backslash is a path separator on Windows and a literal character in
			// io/fs semantics; a name carrying one means the two layers disagree
			// about what the URL addresses. Refuse rather than guess.
			if name == "" || name == "." || strings.HasSuffix(name, "/") || strings.Contains(name, `\`) {
				next.ServeHTTP(w, r)
				return
			}
			f, err := fsys.Open(name + ".br")
			if err != nil {
				next.ServeHTTP(w, r)
				return
			}
			defer f.Close()
			st, err := f.Stat()
			if err != nil || st.IsDir() {
				next.ServeHTTP(w, r)
				return
			}
			// The identity file must exist too. A sidecar is a representation OF
			// something; serving one for a URL whose unencoded form is gone turns a
			// would-be 404 into a 200 with bytes nothing references (half-copied
			// dist directory, manual cleanup). The file server owns existence — this
			// layer only owns the encoding decision.
			if _, err := fs.Stat(fsys, name); err != nil {
				next.ServeHTTP(w, r)
				return
			}
			// The sidecar is authoritative for this URL: serve it as the
			// encoded representation of the same entity.
			//
			// Content-Type is mandatory here. This layer answers BEFORE the file
			// server runs, so whatever type the file server would have sniffed
			// from the extension never gets set — and the product's
			// X-Content-Type-Options: nosniff then makes the browser refuse to
			// execute the module (symptom: the <script> is present, network 200,
			// and nothing runs; no console error worth reading).
			h := w.Header()
			h.Set("Content-Type", contentTypeFor(name))
			h.Set("Content-Encoding", "br")
			// Content-Length must describe the encoded body; the gzip layer
			// downstream removes it anyway when it re-encodes, and that is why
			// Precompressed must sit INSIDE the gzip middleware (see the
			// composition note on the middleware).
			h.Set("Content-Length", strconv.FormatInt(st.Size(), 10))
			w.WriteHeader(http.StatusOK)
			if r.Method != http.MethodHead {
				_, _ = io.Copy(w, f)
			}
		})
	}
}

// acceptsBrotli parses Accept-Encoding for a usable `br` token, honouring
// `q=0` as an explicit refusal. `*` is intentionally NOT treated as accepting
// brotli: a client that says `*` has no brotli support in practice, and
// guessing wrong hands it undecodable bytes.
func acceptsBrotli(header string) bool {
	for _, part := range strings.Split(header, ",") {
		token := strings.TrimSpace(part)
		if token == "" {
			continue
		}
		name, params, _ := strings.Cut(token, ";")
		if !strings.EqualFold(strings.TrimSpace(name), "br") {
			continue
		}
		// Any `q=` that parses to zero is an explicit refusal. `0`, `0.` and
		// `0.0` are all legal spellings of the same weight.
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

// hasVaryToken reports whether Accept-Encoding already appears among the Vary
// header values, so layers can avoid emitting the same token twice.
func hasVaryToken(h http.Header, token string) bool {
	for _, v := range h.Values("Vary") {
		for _, part := range strings.Split(v, ",") {
			if strings.EqualFold(strings.TrimSpace(part), token) {
				return true
			}
		}
	}
	return false
}

// contentTypeFor maps an asset extension to the MIME type the file server would
// have produced. Kept deliberately small: it exists so Precompressed can answer
// before the file server without stripping Content-Type.
func contentTypeFor(name string) string {
	switch strings.ToLower(path.Ext(name)) {
	case ".js", ".mjs":
		return "text/javascript; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".html", ".htm":
		return "text/html; charset=utf-8"
	case ".json":
		return "application/json"
	case ".svg":
		return "image/svg+xml"
	case ".xml":
		return "application/xml"
	case ".txt":
		return "text/plain; charset=utf-8"
	case ".map":
		return "application/json"
	default:
		return "application/octet-stream"
	}
}
