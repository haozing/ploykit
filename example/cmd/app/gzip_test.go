package main

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func gzipAccept(next http.Handler, accept string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	if accept != "" {
		r.Header.Set("Accept-Encoding", accept)
	}
	w := httptest.NewRecorder()
	gzipMW(next).ServeHTTP(w, r)
	return w
}

func TestGzipMW_CompressesTextResponses(t *testing.T) {

	big := "// " + strings.Repeat("ploykit gzip test ", 2000)
	w := gzipAccept(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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

func TestGzipMW_PassthroughCases(t *testing.T) {

	w := gzipAccept(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		io.WriteString(w, "<html/>")
	}), "")
	if w.Header().Get("Content-Encoding") != "" || w.Body.String() != "<html/>" {
		t.Errorf("无 Accept-Encoding 应透传: enc=%q body=%q", w.Header().Get("Content-Encoding"), w.Body.String())
	}
	if !strings.Contains(w.Header().Get("Vary"), "Accept-Encoding") {
		t.Errorf("透传路径 Vary 仍应设置: %q", w.Header().Get("Vary"))
	}

	w = gzipAccept(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
	gzipMW(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		io.WriteString(w, "partial")
	})).ServeHTTP(rw, r)
	if rw.Header().Get("Content-Encoding") != "" || rw.Body.String() != "partial" {
		t.Errorf("Range 请求应透传: enc=%q", rw.Header().Get("Content-Encoding"))
	}
}

func TestGzipMW_SniffFallback(t *testing.T) {

	w := gzipAccept(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("<!doctype html><html>" + strings.Repeat("x", 4096)))
	}), "gzip")
	if w.Header().Get("Content-Encoding") != "gzip" {
		t.Fatalf("嗅探路径应压缩 html: enc=%q", w.Header().Get("Content-Encoding"))
	}
	zr, err := gzip.NewReader(w.Body)
	if err != nil {
		t.Fatalf("响应体应为合法 gzip: %v", err)
	}
	if got, err := io.ReadAll(zr); err != nil || !strings.HasPrefix(string(got), "<!doctype html>") {
		t.Errorf("解压内容: err=%v prefix=%q", err, string(got[:20]))
	}
}

func TestGzipMW_FlushPassthrough(t *testing.T) {

	w := gzipAccept(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
