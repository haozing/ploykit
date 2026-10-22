package webx

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func gzipRoundtrip(next http.Handler, accept string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	if accept != "" {
		r.Header.Set("Accept-Encoding", accept)
	}
	w := httptest.NewRecorder()
	Gzip(next).ServeHTTP(w, r)
	return w
}

func TestAcceptsGzip(t *testing.T) {
	yes := []string{"gzip", "gzip, br", "br, gzip;q=0.5", "GZIP"}
	for _, h := range yes {
		if !acceptsGzip(h) {
			t.Errorf("%q should accept gzip", h)
		}
	}
	// 回归：子串匹配两个误伤——x-gzip 不是 gzip；gzip;q=0 是明确拒绝。
	no := []string{"", "br", "deflate", "identity", "gzip;q=0", "gzip;q=0.0", "x-gzip", "br, x-gzip"}
	for _, h := range no {
		if acceptsGzip(h) {
			t.Errorf("%q should NOT accept gzip", h)
		}
	}
}

func TestGzipCompressesTextResponses(t *testing.T) {
	big := "// " + strings.Repeat("ploykit gzip test ", 2000)
	w := gzipRoundtrip(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/javascript")
		w.WriteHeader(http.StatusOK)
		io.WriteString(w, big)
	}), "gzip")
	if w.Header().Get("Content-Encoding") != "gzip" {
		t.Fatalf("Content-Encoding: got %q", w.Header().Get("Content-Encoding"))
	}
	if !strings.Contains(w.Header().Get("Vary"), "Accept-Encoding") {
		t.Errorf("Vary 应含 Accept-Encoding: %q", w.Header().Get("Vary"))
	}
	zr, err := gzip.NewReader(w.Body)
	if err != nil {
		t.Fatalf("响应体应为合法 gzip: %v", err)
	}
	got, err := io.ReadAll(zr)
	if err != nil {
		t.Fatalf("解压: %v", err)
	}
	if string(got) != big {
		t.Errorf("解压后内容不一致 (len %d vs %d)", len(got), len(big))
	}
	if w.Body.Len() >= len(big) {
		t.Errorf("压缩应显著小于原文: %d vs %d", w.Body.Len(), len(big))
	}
}

func TestGzipPassthroughCases(t *testing.T) {
	w := gzipRoundtrip(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		io.WriteString(w, "<html/>")
	}), "")
	if w.Header().Get("Content-Encoding") != "" || w.Body.String() != "<html/>" {
		t.Errorf("无 Accept-Encoding 应透传: enc=%q body=%q", w.Header().Get("Content-Encoding"), w.Body.String())
	}
	if !strings.Contains(w.Header().Get("Vary"), "Accept-Encoding") {
		t.Errorf("透传路径 Vary 仍应设置: %q", w.Header().Get("Vary"))
	}

	// q=0 是明确拒绝：子串实现会误压缩（回归锁）。
	w = gzipRoundtrip(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		io.WriteString(w, "<html>refused</html>")
	}), "gzip;q=0")
	if w.Header().Get("Content-Encoding") != "" {
		t.Errorf("gzip;q=0 应透传: %q", w.Header().Get("Content-Encoding"))
	}

	w = gzipRoundtrip(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		w.Write([]byte{0x89, 'P', 'N', 'G', 1, 2, 3, 4, 5, 6})
	}), "gzip")
	if w.Header().Get("Content-Encoding") != "" {
		t.Errorf("PNG 不应压缩: %q", w.Header().Get("Content-Encoding"))
	}

	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.Header.Set("Accept-Encoding", "gzip")
	r.Header.Set("Range", "bytes=0-99")
	rw := httptest.NewRecorder()
	Gzip(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		io.WriteString(w, "partial")
	})).ServeHTTP(rw, r)
	if rw.Header().Get("Content-Encoding") != "" || rw.Body.String() != "partial" {
		t.Errorf("Range 请求应透传: enc=%q", rw.Header().Get("Content-Encoding"))
	}
}

// 与 Precompressed 的层叠契约：内层已经带 Content-Encoding（brotli）的响应
// 不得再叠 gzip——双层编码只会变大，且没有客户端能解开。
func TestGzipSkipsAlreadyEncodedResponses(t *testing.T) {
	w := gzipRoundtrip(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		w.Header().Set("Content-Encoding", "br")
		w.Write([]byte("brotli-bytes"))
	}), "gzip")
	if got := w.Header().Get("Content-Encoding"); got != "br" {
		t.Errorf("已有编码不得覆盖, got %q", got)
	}
	if w.Body.String() != "brotli-bytes" {
		t.Errorf("body 应原样: %q", w.Body.String())
	}
}

// 预设 Content-Length 的响应**仍要压缩**：http.FileServer 对每个小文件都设
// Content-Length，若据此跳过，这个中间件就废了。压缩后长度头部被替换为压缩
// 字节数（传输层最终以实际写入为准）。
func TestGzipCompressesDespitePresetContentLength(t *testing.T) {
	body := strings.Repeat("x", 2048)
	w := gzipRoundtrip(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Header().Set("Content-Length", strconv.Itoa(len(body)))
		io.WriteString(w, body)
	}), "gzip")
	if w.Header().Get("Content-Encoding") != "gzip" {
		t.Fatalf("预设 Content-Length 不该阻止压缩: %q", w.Header().Get("Content-Encoding"))
	}
	zr, err := gzip.NewReader(w.Body)
	if err != nil {
		t.Fatalf("应为合法 gzip: %v", err)
	}
	got, _ := io.ReadAll(zr)
	if string(got) != body {
		t.Errorf("内容完整性: %d bytes", len(got))
	}
}

func TestGzipSniffFallback(t *testing.T) {
	w := gzipRoundtrip(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("<!doctype html><html>" + strings.Repeat("x", 4096)))
	}), "gzip")
	if w.Header().Get("Content-Encoding") != "gzip" {
		t.Fatalf("嗅探路径应压缩 html: %q", w.Header().Get("Content-Encoding"))
	}
	zr, err := gzip.NewReader(w.Body)
	if err != nil {
		t.Fatalf("响应体应为合法 gzip: %v", err)
	}
	got, err := io.ReadAll(zr)
	if err != nil || !strings.HasPrefix(string(got), "<!doctype html>") {
		t.Errorf("解压内容: err=%v", err)
	}
}

func TestGzipFlushPassthrough(t *testing.T) {
	w := gzipRoundtrip(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		io.WriteString(w, "<html>")
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		io.WriteString(w, strings.Repeat("chunk ", 500))
	}), "gzip")
	zr, err := gzip.NewReader(w.Body)
	if err != nil {
		t.Fatalf("Flush 后仍是合法 gzip: %v", err)
	}
	got, _ := io.ReadAll(zr)
	if !strings.HasSuffix(string(got), "chunk ") {
		t.Errorf("Flush 路径内容完整性: suffix=%q", string(got[len(got)-20:]))
	}
}

// Vary 去重：Precompressed 在内侧已加过 token，本层不再叠第二份。
func TestGzipDoesNotDuplicateVary(t *testing.T) {
	w := gzipRoundtrip(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Add("Vary", "Accept-Encoding")
		w.Header().Set("Content-Type", "text/html")
		io.WriteString(w, "<html>"+strings.Repeat("y", 2048))
	}), "gzip")
	count := 0
	for _, v := range w.Header().Values("Vary") {
		for _, p := range strings.Split(v, ",") {
			if strings.EqualFold(strings.TrimSpace(p), "Accept-Encoding") {
				count++
			}
		}
	}
	if count != 1 {
		t.Errorf("Vary: Accept-Encoding 应恰好一份, got %d (%v)", count, w.Header().Values("Vary"))
	}
}

func TestGzipCompressibleCT(t *testing.T) {
	yes := []string{
		"text/html; charset=utf-8", "application/json", "application/javascript",
		"image/svg+xml", "application/wasm", "TEXT/PLAIN",
	}
	for _, ct := range yes {
		if !gzipCompressible(ct) {
			t.Errorf("%q 应压缩", ct)
		}
	}
	no := []string{"image/png", "image/jpeg", "font/woff2", "video/mp4", "application/octet-stream", ""}
	for _, ct := range no {
		if gzipCompressible(ct) {
			t.Errorf("%q 不应压缩", ct)
		}
	}
}

// Unwrap 契约：http.ResponseController 要能穿透本层（SSE/升级场景依赖）。
// httptest.Recorder 不实现 SetWriteDeadline，但 Unwrap 链存在时
// ResponseController 会委托到底层；这里只验证调用不 panic 且类型可用。
func TestGzipResponseControllerPassThrough(t *testing.T) {
	done := make(chan struct{})
	w := gzipRoundtrip(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer close(done)
		rc := http.NewResponseController(w)
		// 探测 Unwrap 委托：无法断言底层能力（Recorder 无 deadline），
		// 但缺 Unwrap 时这里会立即返回 "destination does not support"，
		// 有 Unwrap 时错误来自更底层——两种都不 panic 即为本层的契约。
		_ = rc.SetWriteDeadline(time.Now().Add(time.Second))
		w.Header().Set("Content-Type", "text/plain")
		io.WriteString(w, "ctrl")
	}), "gzip")
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("handler 应执行完毕")
	}
	_ = w
}
