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
		resp.Body.Close()
	}
	if n := fr.count(); n != 1 {
		t.Fatalf("首次应渲染 1 次, got %d", n)
	}

	if resp := get(t, h1, "/blog/hang"); resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("黑名单命中应 500, got %d", resp.StatusCode)
	} else {
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
