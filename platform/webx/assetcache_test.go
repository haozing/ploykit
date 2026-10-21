package webx

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestLooksContentAddressed(t *testing.T) {
	hashed := []string{
		"/assets/index-CqMeFOQq.js",
		"/assets/vendor-react-DzNlmBu9.js",
		"/assets/index-oXmUnj1b.css",
		"/assets/geist-latin-wght-normal-BgDaEnEv.woff2",
		"/static/app.4f9a2b1c7d8e.js",
		"/dist/chunk-ABCdef123.js",
		// A Vite hash that happens to be all lowercase but carries digits.
		"/assets/index-7f3a9c21.js",
		// Real names from the example build. Vite hashes are 8 base64url chars,
		// and `-` is part of that alphabet — a separator-splitting rule misses
		// every one of these (7 of 36 assets in that build).
		"/assets/DialogTitle-7-VtvLIt.js",
		"/assets/routes-settings-CQZQEAZD.js",
		"/assets/input-group-CYhS-pAS.js",
		"/assets/SettingsCard-C-pQOpeV.js",
		"/assets/SignInForm-B-WCCgPC.js",
		"/assets/geist-cyrillic-ext-wght-normal-DjL33-gN.woff2",
		"/assets/geist-latin-ext-wght-normal-DC-KSUi6.woff2",
	}
	for _, p := range hashed {
		if !looksContentAddressed(p) {
			t.Errorf("%q 应判定为内容寻址资源", p)
		}
	}

	unhashed := []string{
		"/",
		"/login",
		"/blog/hello-renderx",
		"/favicon.png",
		"/brand/logo-dark.png",
		"/brand/mark.png",
		"/assets/manifest.json",
		"/robots.txt",
		"/sitemap.xml",
		// Regression: a descriptive lowercase name whose final word is long. The
		// old length-only rule treated these as content-addressed and pinned a
		// replaceable file for a year.
		"/assets/hero-image-large.jpg",
		"/assets/default-avatar-placeholder.svg",
		"/uploads/vacation-summer-trip.jpeg",
		// Short ordinary names, and an 8-char all-lowercase word (no signature).
		"/brand/logo-dark.png",
		"/brand/mark.png",
		"/assets/manifest.json",
		"/robots.txt",
		"/sitemap.xml",
	}
	for _, p := range unhashed {
		if looksContentAddressed(p) {
			t.Errorf("%q 不应命中内容寻址规则（不该被强缓存）", p)
		}
	}
}

func TestAssetCacheHashedAssetGetsImmutableHeaders(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("body"))
	})
	rec := httptest.NewRecorder()
	AssetCache(next).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/assets/index-CqMeFOQq.js", nil))

	if got := rec.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Errorf("Cache-Control = %q", got)
	}
	if rec.Header().Get("ETag") == "" {
		t.Error("内容寻址资源应带 ETag")
	}
	if rec.Body.String() != "body" {
		t.Errorf("下游应被调用, body = %q", rec.Body.String())
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d", rec.Code)
	}
}

func TestAssetCacheUnhashedPassesThroughUntouched(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("html"))
	})
	for _, p := range []string{"/", "/login", "/favicon.png", "/assets/hero-image-large.jpg"} {
		rec := httptest.NewRecorder()
		AssetCache(next).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
		if got := rec.Header().Get("Cache-Control"); got != "" {
			t.Errorf("%s 不该被设置 Cache-Control, got %q", p, got)
		}
		if rec.Header().Get("ETag") != "" {
			t.Errorf("%s 不该被设置 ETag", p)
		}
		if rec.Body.String() != "html" {
			t.Errorf("%s 下游应被调用", p)
		}
	}
}

// 404 不得被钉成 immutable：删除的构建产物、拼错的路径、部署窗口里的短暂
// 404 一旦带上一年强缓存，浏览器就有权把这个错误响应缓存一年，重试永远不会
// 发生（与 Content-Type 事故同一类：错误响应被长期固化）。
func TestAssetCacheDoesNotCacheErrorResponses(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	})
	rec := httptest.NewRecorder()
	AssetCache(next).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/assets/index-CqMeFOQq.js", nil))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if got := rec.Header().Get("Cache-Control"); got != "" {
		t.Errorf("404 不该带 Cache-Control, got %q", got)
	}
	if got := rec.Header().Get("ETag"); got != "" {
		t.Errorf("404 不该带 ETag, got %q", got)
	}
}

func TestAssetCacheConditionalRequestReturns304(t *testing.T) {
	called := 0
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called++
		w.Write([]byte("body"))
	})
	h := AssetCache(next)

	// 第一次拿到 ETag
	first := httptest.NewRecorder()
	h.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/assets/index-CqMeFOQq.js", nil))
	tag := first.Header().Get("ETag")
	if tag == "" {
		t.Fatal("首响应应带 ETag")
	}

	// 带 If-None-Match 再请求 → 304，且不触达下游
	req := httptest.NewRequest(http.MethodGet, "/assets/index-CqMeFOQq.js", nil)
	req.Header.Set("If-None-Match", tag)
	second := httptest.NewRecorder()
	h.ServeHTTP(second, req)

	if second.Code != http.StatusNotModified {
		t.Errorf("status = %d, want 304", second.Code)
	}
	if called != 1 {
		t.Errorf("304 不应触达下游, downstream calls = %d", called)
	}
	// 304 也要带 Cache-Control，否则某些代理会丢掉缓存指令
	if second.Header().Get("Cache-Control") == "" {
		t.Error("304 响应应保留 Cache-Control")
	}
}

func TestAssetCacheIfNoneMatchVariants(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("body")) })
	h := AssetCache(next)

	first := httptest.NewRecorder()
	h.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/assets/index-CqMeFOQq.js", nil))
	tag := first.Header().Get("ETag")

	for _, in := range []string{tag, "W/" + tag, `"other", ` + tag, "*"} {
		req := httptest.NewRequest(http.MethodGet, "/assets/index-CqMeFOQq.js", nil)
		req.Header.Set("If-None-Match", in)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotModified {
			t.Errorf("If-None-Match=%q 应得 304, got %d", in, rec.Code)
		}
	}

	req := httptest.NewRequest(http.MethodGet, "/assets/index-CqMeFOQq.js", nil)
	req.Header.Set("If-None-Match", `"stale"`)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("不匹配的 ETag 应得 200, got %d", rec.Code)
	}
}

// 非 GET/HEAD 不参与静态缓存协商（POST 到资源路径应原样落到下游）。
func TestAssetCacheOnlyHandlesSafeMethods(t *testing.T) {
	var sawPost bool
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawPost = r.Method == http.MethodPost
		w.WriteHeader(http.StatusMethodNotAllowed)
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/assets/index-CqMeFOQq.js", nil)
	req.Header.Set("If-None-Match", "*")
	AssetCache(next).ServeHTTP(rec, req)

	if !sawPost {
		t.Fatal("POST 应透传到下游")
	}
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", rec.Code)
	}
	if got := rec.Header().Get("Cache-Control"); got != "" {
		t.Errorf("405 不该带 Cache-Control, got %q", got)
	}
}

func TestAssetCacheWithTTL(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	rec := httptest.NewRecorder()
	AssetCacheWithTTL(next, time.Hour).ServeHTTP(rec,
		httptest.NewRequest(http.MethodGet, "/assets/index-CqMeFOQq.js", nil))
	if got := rec.Header().Get("Cache-Control"); got != "public, max-age=3600, immutable" {
		t.Errorf("Cache-Control = %q", got)
	}

	// ttl <= 0 回落到一年
	rec2 := httptest.NewRecorder()
	AssetCacheWithTTL(next, 0).ServeHTTP(rec2,
		httptest.NewRequest(http.MethodGet, "/assets/index-CqMeFOQq.js", nil))
	if got := rec2.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Errorf("零 TTL 应回落到一年, got %q", got)
	}
}

// AssetCacheManifest 的核心承诺：**零猜测**。清单里的路径强缓存，清单外的
// 一律不碰——包括那些启发式会误判成内容寻址的手写名。这正是引入它的理由：
// 文件名推断无法既接受 `BgDaEnEv` 又拒绝 `Some-Page-Banner`。
func TestAssetCacheManifestIsExact(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("body"))
	})
	files := []string{"assets/index-CqMeFOQq.js", "/assets/app.css"}
	h := AssetCacheManifest(next, files)

	cached := []string{"/assets/index-CqMeFOQq.js", "/assets/app.css"}
	for _, p := range cached {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
		if got := rec.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
			t.Errorf("%s 在清单里应被强缓存, got %q", p, got)
		}
		if rec.Header().Get("ETag") == "" {
			t.Errorf("%s 应带 ETag", p)
		}
	}

	notCached := []string{
		"/",
		"/login",
		"/favicon.png",
		// 启发式会把下面四个判成内容寻址；清单变体不会，因为它们不在构建产物里。
		"/assets/Some-Page-Banner.png",
		"/assets/Hero-Image-Large.jpg",
		"/brand/Logo-Dark.png",
		"/assets/DOWNLOAD.png",
		// 清单里的哈希形状但没被列出的路径同样不缓存（例如另一个构建的残留）。
		"/assets/index-ZZZZZZZZ.js",
	}
	for _, p := range notCached {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
		if got := rec.Header().Get("Cache-Control"); got != "" {
			t.Errorf("%s 不在清单里，不该被强缓存, got %q", p, got)
		}
		if rec.Body.String() != "body" {
			t.Errorf("%s 下游应被调用", p)
		}
	}
}

// 清单变体同样只装饰 2xx；清单命中但下游 404 时不得钉住错误。
func TestAssetCacheManifestDoesNotCacheErrors(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	})
	h := AssetCacheManifest(next, []string{"/assets/index-CqMeFOQq.js"})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/assets/index-CqMeFOQq.js", nil))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d", rec.Code)
	}
	if got := rec.Header().Get("Cache-Control"); got != "" {
		t.Errorf("404 不该带 Cache-Control, got %q", got)
	}
}

// 空清单 / nil：什么都不缓存（而不是退回启发式——那是另一个函数的语义）。
func TestAssetCacheManifestEmptyListCachesNothing(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("x")) })
	for _, files := range [][]string{nil, {}} {
		rec := httptest.NewRecorder()
		AssetCacheManifest(next, files).ServeHTTP(rec,
			httptest.NewRequest(http.MethodGet, "/assets/index-CqMeFOQq.js", nil))
		if got := rec.Header().Get("Cache-Control"); got != "" {
			t.Errorf("空清单不该缓存任何路径, got %q", got)
		}
	}
}

func TestAssetCacheManifestWithTTL(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	rec := httptest.NewRecorder()
	AssetCacheManifestWithTTL(next, []string{"/a-HASH1234.js"}, time.Hour).ServeHTTP(rec,
		httptest.NewRequest(http.MethodGet, "/a-HASH1234.js", nil))
	if got := rec.Header().Get("Cache-Control"); got != "public, max-age=3600, immutable" {
		t.Errorf("Cache-Control = %q", got)
	}
}
