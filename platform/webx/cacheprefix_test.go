package webx

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestCachePrefixSetsHeaderOnMatch(t *testing.T) {
	rules := map[string]string{
		"/shots/":    "public, max-age=604800",
		"/crystals/": "public, max-age=604800",
	}
	for _, p := range []string{"/shots/a.png", "/shots/sub/deep/b.webp", "/crystals/rose.png"} {
		// 下游只 Write 不 WriteHeader（隐式 200）——覆盖 finish 之外的常规路径
		next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte("img"))
		})
		rec := httptest.NewRecorder()
		CachePrefix(rules)(next).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
		if got := rec.Header().Get("Cache-Control"); got != "public, max-age=604800" {
			t.Errorf("%s 应带声明的 Cache-Control, got %q", p, got)
		}
		if rec.Body.String() != "img" {
			t.Errorf("%s 下游应被调用", p)
		}
	}

	// 显式 WriteHeader(200) 与 HEAD 同样生效
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	rec := httptest.NewRecorder()
	CachePrefix(rules)(next).ServeHTTP(rec, httptest.NewRequest(http.MethodHead, "/shots/a.png", nil))
	if got := rec.Header().Get("Cache-Control"); got != "public, max-age=604800" {
		t.Errorf("HEAD 显式 200 应带 Cache-Control, got %q", got)
	}
}

func TestCachePrefixNoMatchLeavesHeaderAlone(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("html"))
	})
	h := CachePrefix(map[string]string{"/shots/": "public, max-age=604800"})(next)
	for _, p := range []string{"/", "/login", "/favicon.png", "/shots-extra/a.png"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
		if got := rec.Header().Get("Cache-Control"); got != "" {
			t.Errorf("%s 不命中前缀，不该被设置 Cache-Control, got %q", p, got)
		}
		if rec.Body.String() != "html" {
			t.Errorf("%s 下游应被调用", p)
		}
	}
}

// 长前缀优先于短前缀：更具体的声明赢。map 迭代序随机，最长匹配是唯一
// 确定性的策略（两个等长且不同的前缀不可能同时匹配同一路径）。
func TestCachePrefixLongestPrefixWins(t *testing.T) {
	rules := map[string]string{
		"/shots/":        "public, max-age=604800",  // 7d
		"/shots/thumbs/": "public, max-age=2592000", // 30d
	}
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("x")) })
	h := CachePrefix(rules)(next)

	cases := map[string]string{
		"/shots/a.png":         "public, max-age=604800",
		"/shots/thumbs/a.png":  "public, max-age=2592000",
		"/shots/thumbs/deep/b": "public, max-age=2592000",
	}
	for p, want := range cases {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
		if got := rec.Header().Get("Cache-Control"); got != want {
			t.Errorf("%s 应取最长前缀的值 %q, got %q", p, want, got)
		}
	}
}

// 空 map / nil map 安全：什么都不装饰，等价于不挂这层。
func TestCachePrefixEmptyMapSafe(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("x")) })
	for _, rules := range []map[string]string{nil, {}} {
		rec := httptest.NewRecorder()
		CachePrefix(rules)(next).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/shots/a.png", nil))
		if got := rec.Header().Get("Cache-Control"); got != "" {
			t.Errorf("空 map 不该设置 Cache-Control, got %q", got)
		}
		if rec.Body.String() != "x" {
			t.Error("下游应被调用")
		}
	}
}

// 已设的 Cache-Control 不被覆盖：内层 handler 的决定比前缀声明更具体，先到先得。
func TestCachePrefixDoesNotOverrideExistingHeader(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "private, no-store")
		w.Write([]byte("x"))
	})
	rec := httptest.NewRecorder()
	CachePrefix(map[string]string{"/shots/": "public, max-age=604800"})(next).ServeHTTP(rec,
		httptest.NewRequest(http.MethodGet, "/shots/a.png", nil))
	if got := rec.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Errorf("下游已设的 Cache-Control 不该被覆盖, got %q", got)
	}
}

// 404 不得被钉缓存：与 AssetCache 同一裁定——命中前缀但下游 404（图片删了、
// 拼错路径）时带上 max-age，浏览器就有权把这个错误响应缓存整个 TTL。
func TestCachePrefixDoesNotCacheErrorResponses(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	})
	rec := httptest.NewRecorder()
	CachePrefix(map[string]string{"/shots/": "public, max-age=604800"})(next).ServeHTTP(rec,
		httptest.NewRequest(http.MethodGet, "/shots/missing.png", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if got := rec.Header().Get("Cache-Control"); got != "" {
		t.Errorf("404 不该带 Cache-Control, got %q", got)
	}
}

// 非 GET/HEAD 原样透传（缓存协商对写操作无意义，与 AssetCache 的安全方法门一致）。
func TestCachePrefixOnlyHandlesSafeMethods(t *testing.T) {
	var sawPost bool
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawPost = r.Method == http.MethodPost
		w.WriteHeader(http.StatusMethodNotAllowed)
	})
	rec := httptest.NewRecorder()
	CachePrefix(map[string]string{"/shots/": "public, max-age=604800"})(next).ServeHTTP(rec,
		httptest.NewRequest(http.MethodPost, "/shots/a.png", nil))
	if !sawPost {
		t.Fatal("POST 应透传到下游")
	}
	if got := rec.Header().Get("Cache-Control"); got != "" {
		t.Errorf("405 不该带 Cache-Control, got %q", got)
	}
}

// 构造期归一：缺前导斜杠补齐；空前缀与空值忽略（空值会 Set 出一个空头）。
func TestCachePrefixNormalizesAndIgnores(t *testing.T) {
	rules := map[string]string{
		"shots/":          "public, max-age=60", // 补前导斜杠
		"/crystals/":      "",                   // 空值忽略
		"":                "public, max-age=1",  // 空前缀忽略
		"/brand/logo.png": "public, max-age=86400",
	}
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("x")) })
	h := CachePrefix(rules)(next)

	cases := map[string]string{
		"/shots/a.png":    "public, max-age=60",
		"/brand/logo.png": "public, max-age=86400",
		"/crystals/a.png": "", // 空值被忽略 → 不设头
	}
	for p, want := range cases {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
		if got := rec.Header().Get("Cache-Control"); got != want {
			t.Errorf("%s Cache-Control = %q, want %q", p, got, want)
		}
	}
}

// 文档化语义锁定：纯 HasPrefix（与 TimeoutExcept/BodyLimitExcept 同约定），
// `/shots` 不带斜杠也会匹配 `/shots-extra/`——目录声明应以 "/" 结尾。
func TestCachePrefixPlainHasPrefixSegmentCaveat(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("x")) })
	h := CachePrefix(map[string]string{"/shots": "public, max-age=60"})(next)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/shots-extra/a.png", nil))
	if got := rec.Header().Get("Cache-Control"); got != "public, max-age=60" {
		t.Errorf("纯前缀匹配语义变化：/shots 应命中 /shots-extra/, got %q", got)
	}
}

func TestCachePrefixTTL(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("x")) })

	// 常规 TTL → public, max-age=<秒>，无 immutable（可原地覆写的文件正是
	// AssetCache 排除它们的原因）
	rec := httptest.NewRecorder()
	CachePrefixTTL([]string{"/shots/", "/crystals/"}, 7*24*time.Hour)(next).ServeHTTP(rec,
		httptest.NewRequest(http.MethodGet, "/shots/a.png", nil))
	if got := rec.Header().Get("Cache-Control"); got != "public, max-age=604800" {
		t.Errorf("Cache-Control = %q, want public, max-age=604800", got)
	}
	rec = httptest.NewRecorder()
	CachePrefixTTL([]string{"/shots/"}, 7*24*time.Hour)(next).ServeHTTP(rec,
		httptest.NewRequest(http.MethodGet, "/crystals/a.png", nil))
	if got := rec.Header().Get("Cache-Control"); got != "" {
		t.Errorf("未列出的前缀不该被设置, got %q", got)
	}

	// 亚秒截断到 0；<=0 → max-age=0（每次重验证），绝不静默回落到更长的 TTL
	for _, ttl := range []time.Duration{500 * time.Millisecond, 0, -time.Hour} {
		rec = httptest.NewRecorder()
		CachePrefixTTL([]string{"/shots/"}, ttl)(next).ServeHTTP(rec,
			httptest.NewRequest(http.MethodGet, "/shots/a.png", nil))
		if got := rec.Header().Get("Cache-Control"); got != "public, max-age=0" {
			t.Errorf("ttl=%v 应得 max-age=0, got %q", ttl, got)
		}
	}

	// nil 路径列表：什么都不缓存
	rec = httptest.NewRecorder()
	CachePrefixTTL(nil, time.Hour)(next).ServeHTTP(rec,
		httptest.NewRequest(http.MethodGet, "/shots/a.png", nil))
	if got := rec.Header().Get("Cache-Control"); got != "" {
		t.Errorf("nil 路径列表不该缓存任何路径, got %q", got)
	}
}

// 下游什么都不写（无 WriteHeader 也无 Write）→ net/http 隐式 200，
// finish() 兜底仍应设头。
func TestCachePrefixImplicit200StillDecorated(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	rec := httptest.NewRecorder()
	CachePrefix(map[string]string{"/shots/": "public, max-age=604800"})(next).ServeHTTP(rec,
		httptest.NewRequest(http.MethodGet, "/shots/a.png", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got := rec.Header().Get("Cache-Control"); got != "public, max-age=604800" {
		t.Errorf("隐式 200 也应带 Cache-Control, got %q", got)
	}
}
