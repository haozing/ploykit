package renderx

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"
)

type stubRenderer struct {
	routes []RouteSpec
	mu     sync.Mutex
	calls  int
	render func(call int, pageID, location string, props json.RawMessage) (string, *DirectiveSink, error)
}

func newStubRenderer(routes []RouteSpec, render func(int, string, string, json.RawMessage) (string, *DirectiveSink, error)) *stubRenderer {
	return &stubRenderer{routes: routes, render: render}
}

func (f *stubRenderer) Routes(ctx context.Context) ([]RouteSpec, error) { return f.routes, nil }

func (f *stubRenderer) Render(ctx context.Context, pageID, location string, props json.RawMessage) (RenderResult, error) {
	f.mu.Lock()
	f.calls++
	n := f.calls
	f.mu.Unlock()
	html, sink, err := f.render(n, pageID, location, props)
	if err != nil {
		return RenderResult{}, err
	}
	if sink == nil {
		sink = NewSink()
	}
	return RenderResult{HTML: html, Sink: sink}, nil
}

func (f *stubRenderer) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

func titleSink(title string) *DirectiveSink {
	s := NewSink()
	s.Append("head", json.RawMessage(`[{"tag":"title","children":"`+title+`"}]`))
	return s
}

func noTitleSink() *DirectiveSink {
	s := NewSink()
	s.Append("head", json.RawMessage(`[{"tag":"meta","attrs":{"name":"description","content":"x"}}]`))
	return s
}

func handlerTestRoutes() []RouteSpec {
	return []RouteSpec{
		{Path: "/", PageID: "landing", Render: ModeStatic},
		{Path: "/pricing", PageID: "pricing", Render: ModeStatic},
		{Path: "/blog/:slug", PageID: "blog-post", Render: ModeStatic},
	}
}

func newHandlerTestReg() *Registry {
	reg := NewRegistry()
	reg.RegisterLoader("/blog/:slug", func(ctx context.Context, p Params) (any, error) {
		return map[string]string{"slug": p["slug"]}, nil
	})
	return reg
}

type spaStub struct{ hits atomic.Int32 }

func (s *spaStub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.hits.Add(1)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte("SPA-FALLBACK"))
}

func get(t *testing.T, h http.Handler, path string) *http.Response {
	t.Helper()
	return do(t, h, http.MethodGet, path)
}

func do(t *testing.T, h http.Handler, method, path string) *http.Response {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, path, nil))
	return rec.Result()
}

func body(t *testing.T, resp *http.Response) string {
	t.Helper()
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestHandlerLayerOrder(t *testing.T) {
	reg := newHandlerTestReg()
	cache := newMemOnlyCache(t, "b1", 16, 0)
	fr := newStubRenderer(handlerTestRoutes(), func(call int, pageID, location string, props json.RawMessage) (string, *DirectiveSink, error) {
		return "<main>rendered-" + location + "</main>", titleSink("r"), nil
	})
	embed := &fstest.MapFS{
		"index.html":   {Data: []byte("<html>embed-index</html>")},
		"pricing.html": {Data: []byte("<html>embed-pricing</html>")},
		"about.html":   {Data: []byte("<html>embed-about</html>")},
	}
	spa := &spaStub{}
	h := Handler(HandlerDeps{
		PrerenderFS: embed, SPA: spa, Cache: cache, Renderer: fr,
		Routes: handlerTestRoutes(), BuildID: "b1", Registry: reg,
	})
	ctx := context.Background()

	if err := cache.Put(ctx, "/blog/hello", CacheEntry{HTML: []byte("cached-hello")}); err != nil {
		t.Fatal(err)
	}
	if err := cache.Put(ctx, "/pricing", CacheEntry{HTML: []byte("cached-pricing")}); err != nil {
		t.Fatal(err)
	}

	for _, c := range []struct{ path, want string }{
		{"/", "embed-index"},
		{"/pricing", "embed-pricing"},
		{"/about", "embed-about"},
	} {
		if got := body(t, get(t, h, c.path)); !strings.Contains(got, c.want) {
			t.Errorf("GET %s = %q, want 含 %q（embed 层）", c.path, got, c.want)
		}
	}
	if n := fr.count(); n != 0 {
		t.Fatalf("embed 命中不应触发渲染, got %d 次", n)
	}

	if got := body(t, get(t, h, "/blog/hello")); got != "cached-hello" {
		t.Errorf("GET /blog/hello = %q, want 缓存副本 cached-hello", got)
	}
	if n := fr.count(); n != 0 {
		t.Fatalf("缓存命中不应触发渲染, got %d 次", n)
	}

	got := body(t, get(t, h, "/blog/world"))
	if !strings.Contains(got, "rendered-/blog/world") {
		t.Errorf("现场渲染结果不符: %q", got)
	}
	if n := fr.count(); n != 1 {
		t.Fatalf("want 1 次渲染, got %d", n)
	}
	if got := body(t, get(t, h, "/blog/world")); !strings.Contains(got, "rendered-/blog/world") {
		t.Errorf("二次请求应吃缓存: %q", got)
	}
	if n := fr.count(); n != 1 {
		t.Fatalf("二次请求不应再渲染, got %d 次", n)
	}
	if _, ok := cache.Get(ctx, "/blog/world"); !ok {
		t.Error("渲染结果应已写缓存")
	}

	if got := body(t, do(t, h, http.MethodPost, "/pricing")); got != "SPA-FALLBACK" {
		t.Errorf("POST /pricing = %q, want SPA fallback", got)
	}

	before := spa.hits.Load()
	if got := body(t, get(t, h, "/blog/a!b")); got != "SPA-FALLBACK" {
		t.Errorf("GET /blog/a!b = %q, want SPA fallback（白名单外参数）", got)
	}

	if got := body(t, get(t, h, "/app/dashboard")); got != "SPA-FALLBACK" {
		t.Errorf("GET /app/dashboard = %q, want SPA fallback", got)
	}
	if spa.hits.Load()-before < 2 {
		t.Errorf("SPA 命中数异常: before=%d after=%d", before, spa.hits.Load())
	}
}

func TestHandlerCacheControlETag(t *testing.T) {
	reg := newHandlerTestReg()
	cache := newMemOnlyCache(t, "b1", 16, 0)
	fr := newStubRenderer(handlerTestRoutes(), func(call int, pageID, location string, props json.RawMessage) (string, *DirectiveSink, error) {
		return "<main>x</main>", titleSink("x"), nil
	})
	embed := &fstest.MapFS{
		"pricing.html": {Data: []byte("<html>embed-pricing</html>")},
		"render-manifest.json": {Data: []byte(`{"buildId":"b1","generatedAt":"2026-10-06T00:00:00Z","pages":[` +
			`{"path":"/pricing","pageId":"pricing","propsSha256":"embed-etag","buildId":"b1","builtAt":"2026-10-06T00:00:00Z","file":"pricing.html"}]}`)},
	}
	h := Handler(HandlerDeps{
		PrerenderFS: embed, Cache: cache, Renderer: fr,
		Routes: handlerTestRoutes(), BuildID: "b1", Registry: reg,
	})

	wantETag := `"` + scopedETag("b1", PropsSHA256([]byte(`{"slug":"hello"}`))) + `"`
	resp := get(t, h, "/blog/hello")
	if resp.Header.Get("Cache-Control") != DefaultCacheControl {
		t.Errorf("Cache-Control = %q, want %q", resp.Header.Get("Cache-Control"), DefaultCacheControl)
	}
	if resp.Header.Get("ETag") != wantETag {
		t.Errorf("ETag = %q, want %q", resp.Header.Get("ETag"), wantETag)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Errorf("Content-Type = %q", ct)
	}
	resp.Body.Close()

	req := httptest.NewRequest(http.MethodGet, "/blog/hello", nil)
	req.Header.Set("If-None-Match", wantETag)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotModified {
		t.Errorf("304: got %d", rec.Code)
	}
	if rec.Body.Len() != 0 {
		t.Errorf("304 应无 body, got %q", rec.Body.String())
	}

	resp = get(t, h, "/pricing")
	if resp.Header.Get("ETag") != `"`+scopedETag("b1", "embed-etag")+`"` {
		t.Errorf("embed ETag = %q, want BuildID 复合 manifest 指纹", resp.Header.Get("ETag"))
	}
	if resp.Header.Get("Cache-Control") != DefaultCacheControl {
		t.Errorf("embed Cache-Control = %q", resp.Header.Get("Cache-Control"))
	}
	resp.Body.Close()
}

func scopedETag(buildID, fingerprint string) string {
	sum := sha256.Sum256([]byte(buildID + "\x00" + fingerprint))
	return hex.EncodeToString(sum[:])
}

func TestHandlerETagBuildScoped(t *testing.T) {
	newHandler := func(buildID string) http.Handler {
		embed := &fstest.MapFS{
			"pricing.html": {Data: []byte("<html>embed-pricing</html>")},
			"render-manifest.json": {Data: []byte(`{"buildId":"` + buildID + `","pages":[` +
				`{"path":"/pricing","pageId":"pricing","propsSha256":"null","buildId":"` + buildID + `","file":"pricing.html"}]}`)},
		}
		return Handler(HandlerDeps{
			PrerenderFS: embed, Cache: newMemOnlyCache(t, buildID, 16, 0),
			Renderer: newStubRenderer(handlerTestRoutes(), func(int, string, string, json.RawMessage) (string, *DirectiveSink, error) {
				return "<main>x</main>", titleSink("x"), nil
			}),
			Routes: handlerTestRoutes(), BuildID: buildID, Registry: newHandlerTestReg(),
		})
	}

	resp := get(t, newHandler("b1"), "/pricing")
	etagB1 := resp.Header.Get("ETag")
	resp.Body.Close()

	resp = get(t, newHandler("b2"), "/pricing")
	etagB2 := resp.Header.Get("ETag")
	resp.Body.Close()

	if etagB1 == etagB2 {
		t.Fatalf("不同 BuildID 的 ETag 不应相同, got %q", etagB1)
	}

	req := httptest.NewRequest(http.MethodGet, "/pricing", nil)
	req.Header.Set("If-None-Match", etagB1)
	rec := httptest.NewRecorder()
	newHandler("b2").ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("跨构建 If-None-Match 应 200, got %d", rec.Code)
	}
}

func TestHandlerTierHeader(t *testing.T) {
	reg := newHandlerTestReg()
	cache := newMemOnlyCache(t, "b1", 16, 0)
	fr := newStubRenderer(handlerTestRoutes(), func(call int, pageID, location string, props json.RawMessage) (string, *DirectiveSink, error) {
		return "<main>rendered</main>", titleSink("x"), nil
	})
	embed := &fstest.MapFS{"pricing.html": {Data: []byte("<html>embed-pricing</html>")}}
	spa := &spaStub{}
	h := Handler(HandlerDeps{
		PrerenderFS: embed, SPA: spa, Cache: cache, Renderer: fr,
		Routes: handlerTestRoutes(), BuildID: "b1", Registry: reg,
	})
	ctx := context.Background()
	if err := cache.Put(ctx, "/blog/hello", CacheEntry{HTML: []byte("cached-hello")}); err != nil {
		t.Fatal(err)
	}

	for _, c := range []struct{ path, want string }{
		{"/pricing", TierEmbed},
		{"/blog/hello", TierCache},
		{"/blog/world", TierRender},
		{"/assets/app.js", TierAsset},
		{"/about", TierSPA},
	} {
		resp := get(t, h, c.path)
		resp.Body.Close()
		if got := resp.Header.Get(HeaderTier); got != c.want {
			t.Errorf("GET %s tier = %q, want %q", c.path, got, c.want)
		}
	}

	// the on-the-spot render wrote the cache: the repeat request is a hit
	resp := get(t, h, "/blog/world")
	resp.Body.Close()
	if got := resp.Header.Get(HeaderTier); got != TierCache {
		t.Errorf("GET /blog/world（二次）tier = %q, want %q", got, TierCache)
	}
}

func TestHandlerTierHeaderNotModifiedAndNonGet(t *testing.T) {
	reg := newHandlerTestReg()
	cache := newMemOnlyCache(t, "b1", 16, 0)
	fr := newStubRenderer(handlerTestRoutes(), func(call int, pageID, location string, props json.RawMessage) (string, *DirectiveSink, error) {
		return "<main>x</main>", titleSink("x"), nil
	})
	embed := &fstest.MapFS{"pricing.html": {Data: []byte("<html>embed-pricing</html>")}}
	h := Handler(HandlerDeps{
		PrerenderFS: embed, SPA: &spaStub{}, Cache: cache, Renderer: fr,
		Routes: handlerTestRoutes(), BuildID: "b1", Registry: reg,
	})

	first := get(t, h, "/pricing")
	first.Body.Close()
	etag := first.Header.Get("ETag")
	if etag == "" {
		t.Fatal("embed 页应带 ETag")
	}

	req := httptest.NewRequest(http.MethodGet, "/pricing", nil)
	req.Header.Set("If-None-Match", etag)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotModified {
		t.Fatalf("If-None-Match 应 304, got %d", rec.Code)
	}
	if tier := rec.Header().Get(HeaderTier); tier != TierEmbed {
		t.Errorf("304 tier = %q, want %q", tier, TierEmbed)
	}

	// 非 GET/HEAD 直接走 SPA 分支，也要带 tier
	resp := do(t, h, http.MethodPost, "/blog/hello")
	resp.Body.Close()
	if tier := resp.Header.Get(HeaderTier); tier != TierSPA {
		t.Errorf("POST tier = %q, want %q", tier, TierSPA)
	}
}

func TestHandlerTierHeaderStaleAndError(t *testing.T) {
	reg := newHandlerTestReg()
	cache := newMemOnlyCache(t, "b1", 16, 40*time.Millisecond)
	fr := newStubRenderer(handlerTestRoutes(), func(call int, pageID, location string, props json.RawMessage) (string, *DirectiveSink, error) {
		return "", nil, errors.New("boom")
	})
	h := Handler(HandlerDeps{Cache: cache, Renderer: fr, Routes: handlerTestRoutes(), BuildID: "b1", Registry: reg})
	ctx := context.Background()
	if err := cache.Put(ctx, "/blog/hello", CacheEntry{HTML: []byte("stale-hello")}); err != nil {
		t.Fatal(err)
	}
	time.Sleep(60 * time.Millisecond)

	resp := get(t, h, "/blog/hello")
	resp.Body.Close()
	if got := resp.Header.Get(HeaderTier); got != TierStale {
		t.Errorf("stale 兜底 tier = %q, want %q", got, TierStale)
	}

	resp = get(t, h, "/blog/world")
	resp.Body.Close()
	if got := resp.Header.Get(HeaderTier); got != TierError {
		t.Errorf("无 stale 错误页 tier = %q, want %q", got, TierError)
	}
}

func TestHandlerTierHeaderNotFoundViaSPA(t *testing.T) {
	reg := notFoundLoaderReg()
	cache := newMemOnlyCache(t, "b1", 16, 0)
	fr := newStubRenderer(handlerTestRoutes(), func(call int, pageID, location string, props json.RawMessage) (string, *DirectiveSink, error) {
		return "<main>ok</main>", titleSink("ok"), nil
	})
	h := Handler(HandlerDeps{SPA: &spaStub{}, Cache: cache, Renderer: fr, Routes: handlerTestRoutes(), BuildID: "b1", Registry: reg})

	resp := get(t, h, "/blog/gone")
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("缺失页应 404, got %d", resp.StatusCode)
	}
	if got := resp.Header.Get(HeaderTier); got != TierSPA {
		t.Errorf("404 SPA 壳 tier = %q, want %q", got, TierSPA)
	}
}

func TestHandlerStaleOnError(t *testing.T) {
	reg := newHandlerTestReg()
	cache := newMemOnlyCache(t, "b1", 16, 40*time.Millisecond)
	fr := newStubRenderer(handlerTestRoutes(), func(call int, pageID, location string, props json.RawMessage) (string, *DirectiveSink, error) {
		return "", nil, errors.New("loader 数据坏导致渲染挂")
	})
	h := Handler(HandlerDeps{Cache: cache, Renderer: fr, Routes: handlerTestRoutes(), BuildID: "b1", Registry: reg})
	ctx := context.Background()

	if err := cache.Put(ctx, "/blog/hello", CacheEntry{HTML: []byte("stale-hello"), PropsSHA256: "old"}); err != nil {
		t.Fatal(err)
	}
	time.Sleep(60 * time.Millisecond)

	resp := get(t, h, "/blog/hello")
	if resp.StatusCode != http.StatusOK {
		t.Errorf("stale 兜底应 200, got %d", resp.StatusCode)
	}
	if got := body(t, resp); got != "stale-hello" {
		t.Errorf("stale body = %q, want stale-hello", got)
	}
	if cc := resp.Header.Get("Cache-Control"); cc != "no-cache" {
		t.Errorf("stale Cache-Control = %q, want no-cache", cc)
	}

	resp = get(t, h, "/blog/world")
	if resp.StatusCode != http.StatusInternalServerError {
		t.Errorf("无 stale 应 500, got %d", resp.StatusCode)
	}
	if got := body(t, resp); !strings.Contains(got, "页面渲染失败") {
		t.Errorf("缺省错误页 = %q", got)
	}
	if _, ok := cache.Get(ctx, "/blog/world"); ok {
		t.Error("渲染失败不应写缓存")
	}
	if n := fr.count(); n != 2 {
		t.Errorf("渲染计数 = %d, want 2（两页各一次）", n)
	}
}

func TestHandlerNoStaleFailureLogsWarn(t *testing.T) {
	reg := newHandlerTestReg()
	cache := newMemOnlyCache(t, "b1", 16, 0)
	fr := newStubRenderer(handlerTestRoutes(), func(call int, pageID, location string, props json.RawMessage) (string, *DirectiveSink, error) {
		return "", nil, errors.New("Maximum call stack size exceeded（深树 wasm 溢出）")
	})
	var warns []string
	h := Handler(HandlerDeps{
		Cache: cache, Renderer: fr, Routes: handlerTestRoutes(), BuildID: "b1", Registry: reg,
		Warn: func(format string, args ...any) {
			warns = append(warns, fmt.Sprintf(format, args...))
		},
	})

	resp := get(t, h, "/blog/world")
	resp.Body.Close()
	if resp.StatusCode != http.StatusInternalServerError {
		t.Errorf("无 stale 渲染失败应 500, got %d", resp.StatusCode)
	}

	joined := strings.Join(warns, "\n")
	if !strings.Contains(joined, "/blog/world") || !strings.Contains(joined, "Maximum call stack size exceeded") {
		t.Errorf("渲染失败且无过期副本应发 Warn（含路径与底层错误文本）, got %q", warns)
	}
}

func TestHandlerPoisonBlacklist(t *testing.T) {
	reg := newHandlerTestReg()
	root := t.TempDir()

	cache1 := newCacheOn(t, "b1", root, 4, 0)
	fr := newStubRenderer(handlerTestRoutes(), func(call int, pageID, location string, props json.RawMessage) (string, *DirectiveSink, error) {
		if location == "/blog/hang" {
			return "", nil, fmt.Errorf("%w: /blog/hang 超过 %s", ErrRenderTimeout, time.Second)
		}
		return "<main>ok</main>", titleSink("ok"), nil
	})
	newHandler := func(c *LayeredCache) http.Handler {
		return Handler(HandlerDeps{Cache: c, Renderer: fr, Routes: handlerTestRoutes(), BuildID: "b1", Registry: reg})
	}
	h1 := newHandler(cache1)

	if resp := get(t, h1, "/blog/hang"); resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("首次超时应 500, got %d", resp.StatusCode)
	} else {
		if tier := resp.Header.Get(HeaderTier); tier != TierError {
			t.Errorf("超时错误页 tier = %q, want %q", tier, TierError)
		}
		resp.Body.Close()
	}
	if n := fr.count(); n != 1 {
		t.Fatalf("首次应渲染 1 次, got %d", n)
	}

	if resp := get(t, h1, "/blog/hang"); resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("黑名单命中应 500, got %d", resp.StatusCode)
	} else {
		if tier := resp.Header.Get(HeaderTier); tier != TierError {
			t.Errorf("黑名单命中 tier = %q, want %q", tier, TierError)
		}
		resp.Body.Close()
	}
	if n := fr.count(); n != 1 {
		t.Fatalf("黑名单命中不应再渲染, got %d 次", n)
	}

	cache2 := newCacheOn(t, "b1", root, 4, 0)
	h2 := newHandler(cache2)
	if resp := get(t, h2, "/blog/hang"); resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("重启后黑名单应仍生效, got %d", resp.StatusCode)
	} else {
		resp.Body.Close()
	}
	if n := fr.count(); n != 1 {
		t.Fatalf("重启后也不应再渲染毒页, got %d 次", n)
	}

	if resp := get(t, h1, "/blog/ok"); resp.StatusCode != http.StatusOK {
		t.Errorf("/blog/ok 应正常渲染, got %d", resp.StatusCode)
		resp.Body.Close()
	}
}

func notFoundLoaderReg() *Registry {
	reg := NewRegistry()
	reg.RegisterLoader("/blog/:slug", func(ctx context.Context, p Params) (any, error) {
		switch p["slug"] {
		case "gone", "deleted":
			return nil, fmt.Errorf("blog: %q: %w", p["slug"], ErrPageNotFound)
		case "boom":
			return nil, errors.New("db: connection refused")
		default:
			return map[string]string{"slug": p["slug"]}, nil
		}
	})
	return reg
}

func TestHandlerPageNotFound(t *testing.T) {
	reg := notFoundLoaderReg()

	cache := newMemOnlyCache(t, "b1", 16, 40*time.Millisecond)
	fr := newStubRenderer(handlerTestRoutes(), func(call int, pageID, location string, props json.RawMessage) (string, *DirectiveSink, error) {
		return "<main>ok</main>", titleSink("ok"), nil
	})
	spa := &spaStub{}
	h := Handler(HandlerDeps{SPA: spa, Cache: cache, Renderer: fr, Routes: handlerTestRoutes(), BuildID: "b1", Registry: reg})
	ctx := context.Background()

	resp := get(t, h, "/blog/gone")
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("缺失页应 404, got %d", resp.StatusCode)
	}
	if got := body(t, resp); got != "SPA-FALLBACK" {
		t.Errorf("缺失页 body = %q, want SPA fallback 形态", got)
	}
	if _, ok := cache.Get(ctx, "/blog/gone"); ok {
		t.Error("缺失页不应写缓存（页面可能稍后创建）")
	}
	if n := fr.count(); n != 0 {
		t.Errorf("取数即失败不应触发渲染, got %d 次", n)
	}

	if err := cache.Put(ctx, "/blog/deleted", CacheEntry{HTML: []byte("stale-deleted")}); err != nil {
		t.Fatal(err)
	}
	time.Sleep(60 * time.Millisecond)
	resp = get(t, h, "/blog/deleted")
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("已删除页应 404, got %d", resp.StatusCode)
	}
	if got := body(t, resp); got != "SPA-FALLBACK" {
		t.Errorf("已删除页不应发 stale 旧页, got %q", got)
	}
}

func TestHandlerLoaderErrorStays500(t *testing.T) {
	reg := notFoundLoaderReg()
	cache := newMemOnlyCache(t, "b1", 16, 0)
	fr := newStubRenderer(handlerTestRoutes(), func(call int, pageID, location string, props json.RawMessage) (string, *DirectiveSink, error) {
		return "<main>ok</main>", titleSink("ok"), nil
	})
	h := Handler(HandlerDeps{Cache: cache, Renderer: fr, Routes: handlerTestRoutes(), BuildID: "b1", Registry: reg})

	resp := get(t, h, "/blog/boom")
	if resp.StatusCode != http.StatusInternalServerError {
		t.Errorf("DB 故障应 500, got %d", resp.StatusCode)
	}
	if got := body(t, resp); !strings.Contains(got, "页面渲染失败") {
		t.Errorf("缺省错误页 = %q", got)
	}

	if resp := get(t, h, "/blog/ok"); resp.StatusCode != http.StatusOK {
		t.Errorf("/blog/ok 应 200, got %d", resp.StatusCode)
	} else {
		resp.Body.Close()
	}
}

func TestHandlerAssertA2A3(t *testing.T) {
	reg := newHandlerTestReg()
	cache := newMemOnlyCache(t, "b1", 16, 0)
	fr := newStubRenderer(handlerTestRoutes(), func(call int, pageID, location string, props json.RawMessage) (string, *DirectiveSink, error) {
		switch location {
		case "/blog/empty":
			return "", nil, nil
		case "/blog/notitle":
			return "<main>x</main>", noTitleSink(), nil
		default:
			return "<main>ok</main>", titleSink("ok"), nil
		}
	})
	h := Handler(HandlerDeps{Cache: cache, Renderer: fr, Routes: handlerTestRoutes(), BuildID: "b1", Registry: reg})
	ctx := context.Background()

	for _, path := range []string{"/blog/empty", "/blog/notitle"} {
		resp := get(t, h, path)
		if resp.StatusCode != http.StatusInternalServerError {
			t.Errorf("%s 应被断言拦截为 500, got %d", path, resp.StatusCode)
		}
		resp.Body.Close()
		if _, ok := cache.Get(ctx, path); ok {
			t.Errorf("%s 断言失败后不应写缓存", path)
		}

		resp = get(t, h, path)
		resp.Body.Close()
	}

	if resp := get(t, h, "/blog/ok"); resp.StatusCode != http.StatusOK {
		t.Fatalf("/blog/ok 应 200, got %d", resp.StatusCode)
	} else {
		resp.Body.Close()
	}
	if _, ok := cache.Get(ctx, "/blog/ok"); !ok {
		t.Error("/blog/ok 应已写缓存")
	}
}

// hydrate=none 必须在**服务链路上**成立，而不只是 RenderOnce 的单测结论：
// 路由投影里的 hydrate 要一路传到 handler 的渲染调用，产物不带 props 脚本与
// 客户端入口，但 CSS 照发（样式属于终态 HTML）。这条同时守住"投影字段没人
// 消费"这类静默断线——字段加了却没接进 handler，单测全绿、线上照发 JS。
func TestHandlerRespectsHydrateNone(t *testing.T) {
	routes := []RouteSpec{
		{Path: "/pricing", PageID: "pricing", Render: ModeStatic, Hydrate: HydrateNone},
		{Path: "/blog/:slug", PageID: "blog-post", Render: ModeStatic, Hydrate: HydrateLoad},
	}
	fr := newStubRenderer(routes, func(call int, pageID, location string, props json.RawMessage) (string, *DirectiveSink, error) {
		return "<main>" + location + "</main>", titleSink("t"), nil
	})
	h := Handler(HandlerDeps{
		SPA:      &spaStub{},
		Cache:    newMemOnlyCache(t, "b1", 16, 0),
		Renderer: fr,
		Routes:   routes,
		BuildID:  "b1",
		Registry: newHandlerTestReg(),
		Assets:   ViteAssets{JS: []string{"/assets/app.js"}, CSS: []string{"/assets/app.css"}},
	})

	zeroJS := body(t, get(t, h, "/pricing"))
	if strings.Contains(zeroJS, "__PLOYKIT_PROPS__") {
		t.Errorf("hydrate=none 页不该带 props 脚本:\n%s", zeroJS)
	}
	if strings.Contains(zeroJS, "/assets/app.js") {
		t.Errorf("hydrate=none 页不该注入客户端入口:\n%s", zeroJS)
	}
	if !strings.Contains(zeroJS, "/assets/app.css") {
		t.Errorf("hydrate=none 页仍应带 CSS:\n%s", zeroJS)
	}

	hydrated := body(t, get(t, h, "/blog/hello"))
	if !strings.Contains(hydrated, "__PLOYKIT_PROPS__") || !strings.Contains(hydrated, "/assets/app.js") {
		t.Errorf("hydrate=load 页应带 props 脚本与入口:\n%s", hydrated)
	}
}

// 未匹配路径的策略开关：默认（零值）保持 v0.15.0 的 SPA 壳 200（消费方的
// CSR 路由靠它）；显式 not-found 后壳内容保留给人类用户、状态变 404。
// loader 返回 ErrPageNotFound 的既有 404 行为在 TestHandlerPageNotFound 里
// 单独守住，不受该开关影响。
func TestHandlerUnknownPathPolicy(t *testing.T) {
	newHandler := func(policy UnknownPathPolicy) http.Handler {
		return Handler(HandlerDeps{
			SPA:   &spaStub{},
			Cache: newMemOnlyCache(t, "b1", 16, 0),
			Renderer: newStubRenderer(handlerTestRoutes(), func(int, string, string, json.RawMessage) (string, *DirectiveSink, error) {
				return "<main>x</main>", titleSink("x"), nil
			}),
			Routes:      handlerTestRoutes(),
			BuildID:     "b1",
			Registry:    newHandlerTestReg(),
			UnknownPath: policy,
		})
	}

	resp := get(t, newHandler(""), "/app/dashboard")
	if resp.StatusCode != http.StatusOK {
		t.Errorf("默认策略：未匹配路径应仍 200 壳（v0.15.0 兼容）, got %d", resp.StatusCode)
	}
	if got := body(t, resp); got != "SPA-FALLBACK" {
		t.Errorf("默认策略 body = %q, want SPA-FALLBACK", got)
	}

	resp = get(t, newHandler(UnknownPathSPAShell), "/random-page")
	if resp.StatusCode != http.StatusOK {
		t.Errorf("显式 spa-shell：应 200 壳, got %d", resp.StatusCode)
	}
	resp.Body.Close()

	resp = get(t, newHandler(UnknownPathNotFound), "/random-page")
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("not-found 策略：未匹配路径应 404, got %d", resp.StatusCode)
	}
	if got := body(t, resp); got != "SPA-FALLBACK" {
		t.Errorf("not-found 策略 body = %q, want 壳内容保留（SPA-FALLBACK）", got)
	}
	if tier := resp.Header.Get(HeaderTier); tier != TierSPA {
		t.Errorf("not-found 策略 tier = %q, want %q", tier, TierSPA)
	}

	// 资产形路径（末段带扩展名）在 not-found 策略下同样 404；tier 沿用 404 壳
	// 既有语义（serveNotFound 固定 TierSPA，见 TestHandlerTierHeaderNotFoundViaSPA）
	resp = get(t, newHandler(UnknownPathNotFound), "/nope.js")
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("资产形未匹配路径在 not-found 策略下应 404, got %d", resp.StatusCode)
	}
	resp.Body.Close()
	if tier := resp.Header.Get(HeaderTier); tier != TierSPA {
		t.Errorf("404 壳 tier = %q, want %q（既有语义）", tier, TierSPA)
	}

	// 非 GET/HEAD 不经策略门（维持既有方法闸行为）
	resp = do(t, newHandler(UnknownPathNotFound), http.MethodPost, "/random-page")
	if resp.StatusCode != http.StatusOK {
		t.Errorf("POST 未匹配路径维持 spa 200, got %d", resp.StatusCode)
	}
	resp.Body.Close()

	defer func() {
		if recover() == nil {
			t.Error("未知策略取值应在构造期 panic")
		}
	}()
	Handler(HandlerDeps{
		SPA:   &spaStub{},
		Cache: newMemOnlyCache(t, "b1", 16, 0),
		Renderer: newStubRenderer(handlerTestRoutes(), func(int, string, string, json.RawMessage) (string, *DirectiveSink, error) {
			return "x", titleSink("x"), nil
		}),
		Routes:      handlerTestRoutes(),
		BuildID:     "b1",
		Registry:    newHandlerTestReg(),
		UnknownPath: "typo",
	})
}

// 尾斜杠归一：无扩展名路径的带斜杠形态 301 到去斜杠版（与 cacheKey 拒绝尾
// 斜杠、validPattern 禁尾斜杠的既有语义对齐——斜杠形态本来就进不了任何层，
// 不归一就落 SPA 壳成为真页的薄壳孪生）。GET/HEAD only。
func TestHandlerTrailingSlashRedirect(t *testing.T) {
	h := Handler(HandlerDeps{
		PrerenderFS: &fstest.MapFS{"pricing.html": {Data: []byte("<html>embed-pricing</html>")}},
		SPA:         &spaStub{},
		Cache:       newMemOnlyCache(t, "b1", 16, 0),
		Renderer: newStubRenderer(handlerTestRoutes(), func(int, string, string, json.RawMessage) (string, *DirectiveSink, error) {
			return "<main>x</main>", titleSink("x"), nil
		}),
		Routes:   handlerTestRoutes(),
		BuildID:  "b1",
		Registry: newHandlerTestReg(),
	})

	// /foo/ → 301 /foo；query 保留
	resp := get(t, h, "/calculator/?ref=x")
	if resp.StatusCode != http.StatusMovedPermanently {
		t.Fatalf("GET /calculator/?ref=x = %d, want 301", resp.StatusCode)
	}
	if loc := resp.Header.Get("Location"); loc != "/calculator?ref=x" {
		t.Errorf("Location = %q, want /calculator?ref=x", loc)
	}
	resp.Body.Close()

	// 多余斜杠一跳归一（目标不再带斜杠 → 不会循环重定向）
	resp = get(t, h, "/calculator//")
	if resp.StatusCode != http.StatusMovedPermanently {
		t.Fatalf("GET /calculator// = %d, want 301", resp.StatusCode)
	}
	if loc := resp.Header.Get("Location"); loc != "/calculator" {
		t.Errorf("Location = %q, want /calculator（一跳）", loc)
	}
	resp.Body.Close()

	// 已是规范形态：不重定向（/foo 落默认 SPA 壳 200）
	resp = get(t, h, "/calculator")
	if resp.StatusCode != http.StatusOK {
		t.Errorf("GET /calculator = %d, want 200（无重定向）", resp.StatusCode)
	}
	if loc := resp.Header.Get("Location"); loc != "" {
		t.Errorf("/calculator 不应带 Location, got %q", loc)
	}
	resp.Body.Close()

	// 根路径 "/" 是唯一带斜杠的规范形态，绝不重定向（否则就是自环）
	resp = get(t, h, "/")
	if resp.StatusCode == http.StatusMovedPermanently {
		t.Error("GET / 不应重定向")
	}
	resp.Body.Close()

	// 有 embed 快照的路径同样先归一（斜杠形态进不了 embed/cacheKey，301 到真页）
	resp = get(t, h, "/pricing/")
	if resp.StatusCode != http.StatusMovedPermanently {
		t.Fatalf("GET /pricing/ = %d, want 301", resp.StatusCode)
	}
	resp.Body.Close()

	// 带扩展名的路径不受影响（无论有无斜杠）
	for _, p := range []string{"/assets/app.js", "/logo.png"} {
		resp = get(t, h, p)
		if resp.StatusCode == http.StatusMovedPermanently {
			t.Errorf("GET %s 不应重定向", p)
		}
		if loc := resp.Header.Get("Location"); loc != "" {
			t.Errorf("GET %s 不应带 Location, got %q", p, loc)
		}
		resp.Body.Close()
	}

	// 非 GET/HEAD 不归一（维持既有方法闸）
	resp = do(t, h, http.MethodPost, "/calculator/")
	if resp.StatusCode == http.StatusMovedPermanently {
		t.Error("POST /calculator/ 不应重定向")
	}
	resp.Body.Close()

	// HEAD 也归一
	resp = do(t, h, http.MethodHead, "/calculator/")
	if resp.StatusCode != http.StatusMovedPermanently {
		t.Errorf("HEAD /calculator/ = %d, want 301", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestTrailingSlashRedirectUnits(t *testing.T) {
	cases := []struct {
		path, query, wantTarget string
		want                    bool
	}{
		{"/", "", "", false},         // 根是规范形态
		{"/foo", "", "", false},      // 无尾斜杠
		{"/foo/", "", "/foo", true},  // 基本形态
		{"/foo//", "", "/foo", true}, // 多斜杠一跳
		// query 不属于 path：真实入口传 r.URL.Path / r.URL.RawQuery 两个参数
		{"/foo/?a=1&b=2", "", "", false},
		{"/foo/", "a=1&b=2", "/foo?a=1&b=2", true},
		{"/logo.png/", "", "", false},  // 末段带扩展名（资产形）不归一
		{"/blog/v1.2/", "", "", false}, // 带点末段视作资产形（与 spaTier 启发式同边界）
		{"/works/my-bracelet/", "", "/works/my-bracelet", true},
	}
	for _, c := range cases {
		got, ok := trailingSlashRedirect(c.path, c.query)
		if ok != c.want || got != c.wantTarget {
			t.Errorf("trailingSlashRedirect(%q, %q) = (%q, %v), want (%q, %v)", c.path, c.query, got, ok, c.wantTarget, c.want)
		}
	}
}

// htmlShellStub 模拟消费方的 SPA 壳 handler：按给定分片写出 body，可配置
// Content-Type / Content-Encoding。
type htmlShellStub struct {
	chunks []string
	ctype  string
	enc    string
}

func (s *htmlShellStub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if s.ctype != "" {
		w.Header().Set("Content-Type", s.ctype)
	}
	if s.enc != "" {
		w.Header().Set("Content-Encoding", s.enc)
	}
	for _, c := range s.chunks {
		_, _ = w.Write([]byte(c))
	}
}

// 壳层 meta 注入：ShellMeta 配置后注入进壳 HTML 的 head（SPA 200 壳与 404
// 壳都算）；未配置时壳字节逐字节不变。
func TestHandlerShellMeta(t *testing.T) {
	shell := `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>shell</title></head><body><div id="root"></div><script src="/assets/app.js"></script></body></html>`
	robotsMeta := `<meta content="noindex, follow" name="robots">`
	metaDeps := func(spa http.Handler) HandlerDeps {
		return HandlerDeps{
			SPA:   spa,
			Cache: newMemOnlyCache(t, "b1", 16, 0),
			Renderer: newStubRenderer(handlerTestRoutes(), func(int, string, string, json.RawMessage) (string, *DirectiveSink, error) {
				return "<main>x</main>", titleSink("x"), nil
			}),
			Routes:   handlerTestRoutes(),
			BuildID:  "b1",
			Registry: newHandlerTestReg(),
			ShellMeta: []HeadEntry{{
				Tag:   "meta",
				Attrs: map[string]string{"name": "robots", "content": "noindex, follow"},
			}},
		}
	}

	// 配置后：meta 进 head（</head> 之前），body 其余部分原样
	h := Handler(metaDeps(&htmlShellStub{chunks: []string{shell}, ctype: "text/html; charset=utf-8"}))
	resp := get(t, h, "/login")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("壳页应 200, got %d", resp.StatusCode)
	}
	got := body(t, resp)
	headPart := got[:strings.Index(got, "</head>")]
	if !strings.Contains(headPart, robotsMeta) {
		t.Errorf("meta 应注入 </head> 之前:\n%s", got)
	}
	if strings.Count(got, robotsMeta) != 1 {
		t.Errorf("meta 只注入一次:\n%s", got)
	}
	if !strings.HasSuffix(got, "</body></html>") {
		t.Errorf("壳尾应原样保留:\n%s", got)
	}

	// 404 壳同样注入（UnknownPath=not-found 的未匹配路径走 serveNotFound）
	deps404 := metaDeps(&htmlShellStub{chunks: []string{shell}, ctype: "text/html; charset=utf-8"})
	deps404.UnknownPath = UnknownPathNotFound
	h404 := Handler(deps404)
	resp = get(t, h404, "/random-page")
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("404 壳应 404, got %d", resp.StatusCode)
	}
	if got := body(t, resp); !strings.Contains(got[:strings.Index(got, "</head>")], robotsMeta) {
		t.Errorf("404 壳同样应注入 meta:\n%s", got)
	}

	// 分片写出、</head> 跨分片：注入仍成立
	chunky := &htmlShellStub{chunks: []string{`<!doctype html><html><head><title>t</`, `title></head><body>x</body></html>`}, ctype: "text/html"}
	resp = get(t, Handler(metaDeps(chunky)), "/login")
	if got := body(t, resp); !strings.Contains(got, `</head>`) || strings.Count(got, "name=\"robots\"") != 1 {
		t.Errorf("跨分片 </head> 注入失败:\n%s", got)
	} else if i := strings.Index(got, `name="robots"`); i > strings.Index(got, "</head>") {
		t.Errorf("meta 应在 </head> 之前:\n%s", got)
	}

	// 缺 </head> 的极小壳：兜底插到 <html> 开标签之后
	noHead := &htmlShellStub{chunks: []string{`<html><body>tiny shell</body></html>`}, ctype: "text/html"}
	resp = get(t, Handler(metaDeps(noHead)), "/login")
	if got := body(t, resp); !strings.Contains(got, robotsMeta) {
		t.Errorf("无 </head> 壳应走兜底注入:\n%s", got)
	} else if i := strings.Index(got, robotsMeta); i > strings.Index(got, "<body>") {
		t.Errorf("兜底注入位置应在 body 开始前:\n%s", got)
	}

	// 非 HTML 响应（SPA 兜底也接资产）：逐字节透传，不注入
	assetShell := &htmlShellStub{chunks: []string{`console.log("</head>");`}, ctype: "text/javascript"}
	resp = get(t, Handler(metaDeps(assetShell)), "/assets/app.js")
	if got := body(t, resp); got != `console.log("</head>");` {
		t.Errorf("非 HTML 响应必须逐字节透传, got %q", got)
	}

	// 自带 Content-Encoding 的响应：不解码不注入，透传
	encShell := &htmlShellStub{chunks: []string{"\x1f\x8b-garbage-</head>"}, ctype: "text/html", enc: "gzip"}
	resp = get(t, Handler(metaDeps(encShell)), "/login")
	if got := body(t, resp); strings.Contains(got, "robots") {
		t.Errorf("压缩响应注入会损坏字节流, got %q", got)
	}

	// 未配置：产物逐字节等于壳 handler 的输出
	plainDeps := metaDeps(&htmlShellStub{chunks: []string{shell}, ctype: "text/html; charset=utf-8"})
	plainDeps.ShellMeta = nil
	hPlain := Handler(plainDeps)
	resp = get(t, hPlain, "/login")
	if got := body(t, resp); got != shell {
		t.Errorf("未配置 ShellMeta 时壳应逐字节不变:\n got %q\nwant %q", got, shell)
	}

	// 非法条目构造期 panic（同 RobotsHandler 的"坏配置当场炸"契约）
	defer func() {
		if recover() == nil {
			t.Error("ShellMeta 含 script 条目应在构造期 panic")
		}
	}()
	bad := metaDeps(&htmlShellStub{chunks: []string{shell}})
	bad.ShellMeta = []HeadEntry{{Tag: "script", Children: "x"}}
	Handler(bad)
}
