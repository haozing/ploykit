package webx

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// htmlShellHandler simulates the product SPA shell fallback: sets the
// Content-Type header then writes the body without an explicit WriteHeader
// (the implicit-200 path frontendHandler's fallback takes).
func htmlShellHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte("<!DOCTYPE html><html><body>shell</body></html>"))
}

func TestHTMLNoCacheDecoratesShell(t *testing.T) {
	rec := httptest.NewRecorder()
	HTMLNoCache(http.HandlerFunc(htmlShellHandler)).
		ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/editor", nil))
	if got := rec.Header().Get("Cache-Control"); got != "no-cache" {
		t.Errorf("无策略的 HTML shell 应被补 no-cache, got %q", got)
	}

	// 显式 WriteHeader(200) 路径同样生效
	rec = httptest.NewRecorder()
	HTMLNoCache(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusOK)
	})).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/editor", nil))
	if got := rec.Header().Get("Cache-Control"); got != "no-cache" {
		t.Errorf("显式 200 的 HTML 应被补 no-cache, got %q", got)
	}

	// HEAD 与 GET 同策略
	rec = httptest.NewRecorder()
	HTMLNoCache(http.HandlerFunc(htmlShellHandler)).
		ServeHTTP(rec, httptest.NewRequest(http.MethodHead, "/editor", nil))
	if got := rec.Header().Get("Cache-Control"); got != "no-cache" {
		t.Errorf("HEAD 的 HTML shell 应被补 no-cache, got %q", got)
	}
}

func TestHTMLNoCacheRespectsInnerCacheControl(t *testing.T) {
	// renderx embed 层发 max-age=60, stale-while-revalidate=300——内层显式
	// 策略必须原样保留，本层只是缺省兜底
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "max-age=60, stale-while-revalidate=300")
		w.Write([]byte("marketing"))
	})
	rec := httptest.NewRecorder()
	HTMLNoCache(next).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if got := rec.Header().Get("Cache-Control"); got != "max-age=60, stale-while-revalidate=300" {
		t.Errorf("内层已声明的 Cache-Control 不该被覆盖, got %q", got)
	}
}

func TestHTMLNoCacheLeavesNonHTMLAlone(t *testing.T) {
	// hashed chunk / 图标 / JSON——非 text/html 一律不碰
	for _, ct := range []string{
		"text/javascript; charset=utf-8",
		"image/png",
		"application/json",
		"text/plain; charset=utf-8",
	} {
		next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", ct)
			w.Write([]byte("bytes"))
		})
		rec := httptest.NewRecorder()
		HTMLNoCache(next).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/assets/app-Ab12Cd34.js", nil))
		if got := rec.Header().Get("Cache-Control"); got != "" {
			t.Errorf("Content-Type %s 不该被设置 Cache-Control, got %q", ct, got)
		}
	}
}

func TestHTMLNoCacheSkipsNon2xx(t *testing.T) {
	// 404 shell 降级（renderx UnknownPathNotFound）与 503 错误页不装饰——
	// 与 CachePrefix/AssetCache 同裁定：非 2xx 不由本层决定
	for _, code := range []int{http.StatusNotFound, http.StatusServiceUnavailable, http.StatusNotModified} {
		next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.WriteHeader(code)
		})
		rec := httptest.NewRecorder()
		HTMLNoCache(next).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/gone", nil))
		if got := rec.Header().Get("Cache-Control"); got != "" {
			t.Errorf("%d 响应不该被设置 Cache-Control, got %q", code, got)
		}
	}
}

func TestHTMLNoCacheSkipsNonGetHead(t *testing.T) {
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodDelete} {
		next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write([]byte("shell"))
		})
		rec := httptest.NewRecorder()
		HTMLNoCache(next).ServeHTTP(rec, httptest.NewRequest(method, "/editor", nil))
		if got := rec.Header().Get("Cache-Control"); got != "" {
			t.Errorf("%s 请求不该被设置 Cache-Control, got %q", method, got)
		}
	}
}
