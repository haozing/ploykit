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

// 扩展名命中即加保底头：嵌套目录、大写扩展名、无点声明、HEAD 显式 200 都算；
// 未命中的扩展名与无扩展名路径原样透传。
func TestCachePrefixDefaultSetsHeaderOnExtensionMatch(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("img")) })
	h := CachePrefixDefault([]string{".png", "webp", ".WOFF2"}, 7*24*time.Hour)(next)

	for _, p := range []string{"/shots/a.png", "/brand/sub/logo.png", "/shots/b.PNG", "/x/y.WebP", "/fonts/inter.woff2"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
		if got := rec.Header().Get("Cache-Control"); got != "public, max-age=604800" {
			t.Errorf("%s 扩展名命中应带保底 Cache-Control, got %q", p, got)
		}
		if rec.Body.String() != "img" {
			t.Errorf("%s 下游应被调用", p)
		}
	}

	// 显式 WriteHeader(200) 与 HEAD 同样生效
	head := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	rec := httptest.NewRecorder()
	CachePrefixDefault([]string{".png"}, time.Hour)(head).ServeHTTP(rec,
		httptest.NewRequest(http.MethodHead, "/logo.png", nil))
	if got := rec.Header().Get("Cache-Control"); got != "public, max-age=3600" {
		t.Errorf("HEAD 显式 200 应带保底 Cache-Control, got %q", got)
	}

	// 未声明的扩展名 / 无扩展名：不设头
	for _, p := range []string{"/brand/a.jpg", "/shots/noext", "/"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
		if got := rec.Header().Get("Cache-Control"); got != "" {
			t.Errorf("%s 不该被保底规则命中, got %q", p, got)
		}
	}

	// ttl <= 0 → max-age=0（与 CachePrefixTTL 同口径：截断到秒，绝不回落更长 TTL）
	for _, ttl := range []time.Duration{500 * time.Millisecond, 0, -time.Hour} {
		rec = httptest.NewRecorder()
		CachePrefixDefault([]string{".png"}, ttl)(next).ServeHTTP(rec,
			httptest.NewRequest(http.MethodGet, "/a.png", nil))
		if got := rec.Header().Get("Cache-Control"); got != "public, max-age=0" {
			t.Errorf("ttl=%v 应得 max-age=0, got %q", ttl, got)
		}
	}
}

// 内层已设的 Cache-Control 不被覆盖：handler 的具体决策比扩展名兜底更优先。
func TestCachePrefixDefaultDoesNotOverrideExistingHeader(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "private, no-store")
		w.Write([]byte("x"))
	})
	rec := httptest.NewRecorder()
	CachePrefixDefault([]string{".png"}, time.Hour)(next).ServeHTTP(rec,
		httptest.NewRequest(http.MethodGet, "/a.png", nil))
	if got := rec.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Errorf("下游已设的 Cache-Control 不该被覆盖, got %q", got)
	}
}

// 错误响应绝不装饰：404（文件删了/拼错）与 500 带上 max-age 后，浏览器有权
// 把错误缓存整个 TTL；206 是部分实体，同样排除。
func TestCachePrefixDefaultDoesNotCacheErrorResponses(t *testing.T) {
	cases := []struct {
		name   string
		status int
	}{
		{"404", http.StatusNotFound},
		{"500", http.StatusInternalServerError},
		{"206", http.StatusPartialContent},
	}
	for _, tc := range cases {
		next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(tc.status)
		})
		rec := httptest.NewRecorder()
		CachePrefixDefault([]string{".png"}, time.Hour)(next).ServeHTTP(rec,
			httptest.NewRequest(http.MethodGet, "/missing.png", nil))
		if rec.Code != tc.status {
			t.Fatalf("%s status = %d, want %d", tc.name, rec.Code, tc.status)
		}
		if got := rec.Header().Get("Cache-Control"); got != "" {
			t.Errorf("%s 不该带 Cache-Control, got %q", tc.name, got)
		}
	}

	// http.NotFound 路径（真实 404 写法）同样不加
	rec := httptest.NewRecorder()
	CachePrefixDefault([]string{".png"}, time.Hour)(http.HandlerFunc(http.NotFound)).ServeHTTP(rec,
		httptest.NewRequest(http.MethodGet, "/gone.png", nil))
	if got := rec.Header().Get("Cache-Control"); got != "" {
		t.Errorf("http.NotFound 的 404 不该带 Cache-Control, got %q", got)
	}
}

// 非 GET/HEAD 原样透传（与 CachePrefix / AssetCache 的安全方法门一致）。
func TestCachePrefixDefaultOnlyHandlesSafeMethods(t *testing.T) {
	var sawPost bool
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawPost = r.Method == http.MethodPost
		w.WriteHeader(http.StatusMethodNotAllowed)
	})
	rec := httptest.NewRecorder()
	CachePrefixDefault([]string{".png"}, time.Hour)(next).ServeHTTP(rec,
		httptest.NewRequest(http.MethodPost, "/upload.png", nil))
	if !sawPost {
		t.Fatal("POST 应透传到下游")
	}
	if got := rec.Header().Get("Cache-Control"); got != "" {
		t.Errorf("POST 不该带 Cache-Control, got %q", got)
	}
}

// 构造期归一：无点补点、大小写折叠、空白裁掉、空条目忽略；全部忽略时等价于
// 不挂这层（不 panic，不设头）。
func TestCachePrefixDefaultNormalizesExtensions(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("x")) })
	h := CachePrefixDefault([]string{"PNG", " .WebP ", "", "  "}, time.Hour)(next)

	cases := map[string]string{
		"/a.png":  "public, max-age=3600",
		"/a.PNG":  "public, max-age=3600",
		"/b.webp": "public, max-age=3600",
		"/b.txt":  "",
		"/no-ext": "",
	}
	for p, want := range cases {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
		if got := rec.Header().Get("Cache-Control"); got != want {
			t.Errorf("%s Cache-Control = %q, want %q", p, got, want)
		}
	}

	// 全空列表：什么都不装饰
	for _, exts := range [][]string{nil, {"", " "}} {
		rec := httptest.NewRecorder()
		CachePrefixDefault(exts, time.Hour)(next).ServeHTTP(rec,
			httptest.NewRequest(http.MethodGet, "/a.png", nil))
		if got := rec.Header().Get("Cache-Control"); got != "" {
			t.Errorf("空扩展名列表不该设置 Cache-Control, got %q", got)
		}
	}
}

// 推荐组合（文档里写死的接线顺序）：默认层在外、显式前缀在内——前缀层先写
// 出目录策略，默认层看到已有 Cache-Control 就让位。显式前缀赢。
func TestCachePrefixDefaultCombinedWithPrefix(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("x")) })
	h := CachePrefixDefault([]string{".png"}, time.Hour)(
		CachePrefixTTL([]string{"/shots/"}, 7*24*time.Hour)(next))

	cases := map[string]string{
		"/shots/a.png":    "public, max-age=604800", // 显式目录声明赢
		"/brand/logo.png": "public, max-age=3600",   // 默认兜底
		"/brand/logo.txt": "",                       // 两者都不命中
	}
	for p, want := range cases {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
		if got := rec.Header().Get("Cache-Control"); got != want {
			t.Errorf("%s Cache-Control = %q, want %q", p, got, want)
		}
	}
}
