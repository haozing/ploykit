package webx

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestAcceptsBrotli(t *testing.T) {
	yes := []string{"br", "gzip, br", "gzip;q=1.0, br;q=0.8", " BR ", "deflate,br;q=0.9"}
	for _, h := range yes {
		if !acceptsBrotli(h) {
			t.Errorf("%q should accept brotli", h)
		}
	}
	no := []string{"", "gzip", "gzip, deflate", "br;q=0", "br;q=0.0, gzip", "*", "identity"}
	for _, h := range no {
		if acceptsBrotli(h) {
			t.Errorf("%q should NOT accept brotli", h)
		}
	}
}

func TestPrecompressedServesSidecar(t *testing.T) {
	fsys := fstest.MapFS{
		"assets/app.js":    {Data: []byte("plain-body")},
		"assets/app.js.br": {Data: []byte("BR-BODY")},
	}
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("plain-body"))
	})
	h := Precompressed(fsys)(next)

	req := httptest.NewRequest(http.MethodGet, "/assets/app.js", nil)
	req.Header.Set("Accept-Encoding", "gzip, br")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Body.String() != "BR-BODY" {
		t.Errorf("body = %q, want the sidecar", rec.Body.String())
	}
	if got := rec.Header().Get("Content-Encoding"); got != "br" {
		t.Errorf("Content-Encoding = %q", got)
	}
	if got := rec.Header().Get("Content-Length"); got != "7" {
		t.Errorf("Content-Length = %q, want 7", got)
	}
	if got := rec.Header().Values("Vary"); len(got) == 0 || !strings.Contains(strings.Join(got, ","), "Accept-Encoding") {
		t.Errorf("Vary must include Accept-Encoding, got %v", got)
	}
	// Regression: the sidecar path answers before the file server, so it must
	// set Content-Type itself. Without it a nosniff policy silently blocks the
	// module (script present, status 200, nothing executes).
	if got := rec.Header().Get("Content-Type"); got != "text/javascript; charset=utf-8" {
		t.Errorf("Content-Type = %q; the sidecar path must supply it", got)
	}
}

func TestContentTypeFor(t *testing.T) {
	cases := map[string]string{
		"a.js":    "text/javascript; charset=utf-8",
		"a.mjs":   "text/javascript; charset=utf-8",
		"a.css":   "text/css; charset=utf-8",
		"a.html":  "text/html; charset=utf-8",
		"a.json":  "application/json",
		"a.svg":   "image/svg+xml",
		"a.map":   "application/json",
		"a.woff2": "application/octet-stream",
		"a.png":   "application/octet-stream",
	}
	for in, want := range cases {
		if got := contentTypeFor(in); got != want {
			t.Errorf("contentTypeFor(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestPrecompressedFallsBackWithoutSidecar(t *testing.T) {
	fsys := fstest.MapFS{"assets/app.js": {Data: []byte("plain-body")}}
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("plain-body"))
	})
	h := Precompressed(fsys)(next)

	req := httptest.NewRequest(http.MethodGet, "/assets/app.js", nil)
	req.Header.Set("Accept-Encoding", "br")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Body.String() != "plain-body" {
		t.Errorf("body = %q, want identity fallback", rec.Body.String())
	}
	if rec.Header().Get("Content-Encoding") != "" {
		t.Errorf("identity response must not claim an encoding")
	}
	// Vary must still be present: the SAME url therefore varies by encoding.
	if !strings.Contains(strings.Join(rec.Header().Values("Vary"), ","), "Accept-Encoding") {
		t.Error("Vary must be set even on the identity path")
	}
}

func TestPrecompressedIgnoresClientWithoutBrotli(t *testing.T) {
	fsys := fstest.MapFS{
		"assets/app.js":    {Data: []byte("plain-body")},
		"assets/app.js.br": {Data: []byte("BR-BODY")},
	}
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("plain-body"))
	})
	h := Precompressed(fsys)(next)

	req := httptest.NewRequest(http.MethodGet, "/assets/app.js", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Body.String() != "plain-body" {
		t.Errorf("a gzip-only client must get identity from this layer, got %q", rec.Body.String())
	}
}

func TestPrecompressedHeadHasNoBody(t *testing.T) {
	fsys := fstest.MapFS{
		"assets/app.js":    {Data: []byte("plain-body")},
		"assets/app.js.br": {Data: []byte("BR-BODY")},
	}
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	h := Precompressed(fsys)(next)

	req := httptest.NewRequest(http.MethodHead, "/assets/app.js", nil)
	req.Header.Set("Accept-Encoding", "br")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Body.Len() != 0 {
		t.Errorf("HEAD must not write a body, got %q", rec.Body.String())
	}
	if got := rec.Header().Get("Content-Length"); got != "7" {
		t.Errorf("HEAD should still advertise the encoded length, got %q", got)
	}
}

func TestPrecompressedRejectsTraversal(t *testing.T) {
	fsys := fstest.MapFS{"secret.br": {Data: []byte("nope")}}
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("fallback")) })
	h := Precompressed(fsys)(next)

	req := httptest.NewRequest(http.MethodGet, "/../secret", nil)
	req.Header.Set("Accept-Encoding", "br")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Body.String() != "fallback" {
		t.Errorf("traversal must not escape the root, got %q", rec.Body.String())
	}
}

// 非 GET/HEAD 与 Range 请求必须交给文件服务器：本层只会返回 200 + 整体编码体，
// 对 Range 来说这是错误语义（客户端要的是 206）。
func TestPrecompressedDefersUnsupportedRequestShapes(t *testing.T) {
	fsys := fstest.MapFS{
		"assets/app.js":    {Data: []byte("plain-body")},
		"assets/app.js.br": {Data: []byte("BR-BODY")},
	}
	var seenMethod, seenRange string
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenMethod, seenRange = r.Method, r.Header.Get("Range")
		w.WriteHeader(http.StatusPartialContent)
	})
	h := Precompressed(fsys)(next)

	post := httptest.NewRequest(http.MethodPost, "/assets/app.js", nil)
	post.Header.Set("Accept-Encoding", "br")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, post)
	if seenMethod != http.MethodPost || rec.Body.String() != "" {
		t.Errorf("POST 应透传（method=%q body=%q）", seenMethod, rec.Body.String())
	}

	ranged := httptest.NewRequest(http.MethodGet, "/assets/app.js", nil)
	ranged.Header.Set("Accept-Encoding", "br")
	ranged.Header.Set("Range", "bytes=0-3")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, ranged)
	if seenRange != "bytes=0-3" {
		t.Fatalf("Range 请求应透传给下游, range=%q", seenRange)
	}
	if rec.Code != http.StatusPartialContent {
		t.Errorf("Range 请求应由下游决定状态, got %d", rec.Code)
	}
}

// Windows: backslash is a separator for the OS filesystem but a literal
// character for io/fs. A sidecar lookup must not reinterpret such a URL.
func TestPrecompressedRejectsBackslashNames(t *testing.T) {
	fsys := fstest.MapFS{"a/secret.br": {Data: []byte("nope")}}
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("fallback")) })
	h := Precompressed(fsys)(next)

	req := httptest.NewRequest(http.MethodGet, "/a%5Csecret", nil)
	req.Header.Set("Accept-Encoding", "br")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Body.String() != "fallback" {
		t.Errorf("反斜杠路径不应进入 sidecar 查找, got %q", rec.Body.String())
	}
}

// sidecar 是"同一实体的编码表示"：identity 文件不存在时它不该顶替 404。
// 场景：dist 目录半拷贝、手工清理只删了原件——本层若仍回 200，浏览器会拿到
// 一个没有任何引用指向的响应，而真正的问题（缺文件）被掩盖。
func TestPrecompressedRequiresIdentityFile(t *testing.T) {
	fsys := fstest.MapFS{"assets/orphan.js.br": {Data: []byte("BR-BODY")}}
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	})
	h := Precompressed(fsys)(next)

	req := httptest.NewRequest(http.MethodGet, "/assets/orphan.js", nil)
	req.Header.Set("Accept-Encoding", "br")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("仅有 sidecar 时应落到下游 404, got %d", rec.Code)
	}
	if rec.Header().Get("Content-Encoding") != "" {
		t.Errorf("404 不该声称 br 编码")
	}
}
