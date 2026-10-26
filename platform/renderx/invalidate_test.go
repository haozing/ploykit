package renderx

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

func TestInvalidateGraphEviction(t *testing.T) {
	reg := NewRegistry()
	reg.RegisterDep("/", "/blog/:slug")
	reg.RegisterLoader("/blog/:slug", func(ctx context.Context, p Params) (any, error) {
		return map[string]string{"slug": p["slug"]}, nil
	})
	cache := newMemOnlyCache(t, "b1", 16, 0)
	ctx := context.Background()
	for _, p := range []string{"/blog/hello", "/blog/world", "/", "/pricing"} {
		if err := cache.Put(ctx, p, CacheEntry{HTML: []byte("v-" + p)}); err != nil {
			t.Fatal(err)
		}
	}

	svc := &Service{Cache: cache, Renderer: newStubRenderer(handlerTestRoutes(), nil), Routes: handlerTestRoutes(), Registry: reg}
	if err := svc.Invalidate(ctx, "/blog/:slug", Params{"slug": "hello"}); err != nil {
		t.Fatal(err)
	}

	if _, ok := cache.Get(ctx, "/blog/hello"); ok {
		t.Error("/blog/hello 应被逐出（失效起点）")
	}
	if _, ok := cache.Get(ctx, "/blog/world"); !ok {
		t.Error("/blog/world 不应被误伤（点失效语义）")
	}
	if _, ok := cache.Get(ctx, "/"); ok {
		t.Error("/ 应被逐出（失效图反向依赖）")
	}
	if _, ok := cache.Get(ctx, "/pricing"); !ok {
		t.Error("/pricing 不应被误伤")
	}
}

func TestInvalidatePatternWide(t *testing.T) {
	reg := NewRegistry()
	root := t.TempDir()
	cache1 := newCacheOn(t, "b1", root, 4, 0)
	ctx := context.Background()
	for _, p := range []string{"/blog/a", "/blog/b", "/other"} {
		if err := cache1.Put(ctx, p, CacheEntry{HTML: []byte(p)}); err != nil {
			t.Fatal(err)
		}
	}

	svc := &Service{Cache: cache1, Registry: reg}
	if err := svc.Invalidate(ctx, "/blog/:slug", nil); err != nil {
		t.Fatal(err)
	}

	cache2 := newCacheOn(t, "b1", root, 4, 0)
	for _, p := range []string{"/blog/a", "/blog/b"} {
		if _, ok := cache2.Get(ctx, p); ok {
			t.Errorf("%s 的磁盘层条目应被清", p)
		}
	}
	if _, ok := cache2.Get(ctx, "/other"); !ok {
		t.Error("/other 不应被逐出")
	}
}

func TestRefreshAsync(t *testing.T) {
	reg := NewRegistry()
	reg.RegisterDep("/", "/blog/:slug")
	reg.RegisterLoader("/blog/:slug", func(ctx context.Context, p Params) (any, error) {
		return map[string]string{"title": p["slug"]}, nil
	})
	cache := newMemOnlyCache(t, "b1", 16, 0)
	ctx := context.Background()
	if err := cache.Put(ctx, "/blog/hello", CacheEntry{HTML: []byte("old-hello")}); err != nil {
		t.Fatal(err)
	}

	fr := newStubRenderer(handlerTestRoutes(), func(call int, pageID, location string, props json.RawMessage) (string, *DirectiveSink, error) {
		return "<main>fresh:" + location + "</main>", titleSink("t"), nil
	})
	svc := &Service{Cache: cache, Renderer: fr, Routes: handlerTestRoutes(), BuildID: "b1", Registry: reg}
	if err := svc.Refresh(ctx, "/blog/:slug", Params{"slug": "hello"}); err != nil {
		t.Fatal(err)
	}

	if _, ok := cache.Get(ctx, "/blog/hello"); ok {
		t.Fatal("Refresh 同步段应先失效旧副本")
	}

	deadline := time.Now().Add(3 * time.Second)
	for {
		if ent, ok := cache.Get(ctx, "/blog/hello"); ok && strings.Contains(string(ent.HTML), "fresh:/blog/hello") {
			if ent2, ok2 := cache.Get(ctx, "/"); ok2 && strings.Contains(string(ent2.HTML), "fresh:/") {
				break
			}
		}
		if time.Now().After(deadline) {
			t.Fatal("Refresh 异步重渲染未在期限内写缓存")
		}
		time.Sleep(20 * time.Millisecond)
	}

	if ent, ok := cache.Get(ctx, "/blog/hello"); !ok || ent.BuildID != "b1" {
		t.Errorf("Refresh 写入的条目应带 buildId: %+v", ent)
	}
	if n := fr.count(); n < 2 {
		t.Errorf("应至少重渲染 2 页（blog + 反向依赖首页）, got %d", n)
	}
}

func TestPackageLevelConvenience(t *testing.T) {

	RegisterService(nil)
	if err := Invalidate(context.Background(), "/blog/:slug", nil); err == nil {
		t.Fatal("未注册全局服务应报错")
	}

	reg := NewRegistry()
	reg.RegisterDep("/", "/blog/:slug")
	cache := newMemOnlyCache(t, "b1", 16, 0)
	ctx := context.Background()
	for _, p := range []string{"/blog/x", "/"} {
		if err := cache.Put(ctx, p, CacheEntry{HTML: []byte(p)}); err != nil {
			t.Fatal(err)
		}
	}
	svc := &Service{Cache: cache, Registry: reg}
	RegisterService(svc)

	if err := Invalidate(ctx, "/blog/:slug", Params{"slug": "x"}); err != nil {
		t.Fatal(err)
	}
	if _, ok := cache.Get(ctx, "/blog/x"); ok {
		t.Error("包级 Invalidate 应逐出缓存键")
	}
	if _, ok := cache.Get(ctx, "/"); ok {
		t.Error("包级 Invalidate 应波及失效图反向依赖页")
	}

	RegisterService(nil)
}

// Invalidate 必须打穿 embed 层：go:embed 快照只读，v0.15.0 里 handler 的
// embedPage 命中即 return，DB 已删资源以完整预渲染内容 200 服务到下次构建
// （生产实测僵尸页 X-Renderx-Tier: embed）。墓碑集让命中过墓碑的 embed 路径
// 视为 miss 走后续层：带参数形态（/works/:slug + params）与字面路径都要正确
// 映射到墓碑键；sitemap/Paths 枚举不受运行期失效影响。
func TestInvalidatePunchesEmbedLayer(t *testing.T) {
	routes := []RouteSpec{
		{Path: "/", PageID: "home", Render: ModeStatic},
		{Path: "/works/:slug", PageID: "work", Render: ModeStatic},
	}
	reg := NewRegistry()
	reg.RegisterPaths("/works/:slug", func(ctx context.Context) ([]PagePath, error) {
		return []PagePath{{Params: Params{"slug": "my-bracelet"}}, {Params: Params{"slug": "other"}}}, nil
	})
	reg.RegisterLoader("/works/:slug", func(ctx context.Context, p Params) (any, error) {
		if p["slug"] == "my-bracelet" {
			return nil, fmt.Errorf("work %q: %w", p["slug"], ErrPageNotFound)
		}
		return map[string]string{"slug": p["slug"]}, nil
	})
	reg.RegisterDep("/", "/works/:slug")

	embedFS := &fstest.MapFS{
		"index.html":             {Data: []byte("<html>embed-home</html>")},
		"works/my-bracelet.html": {Data: []byte("<html>embed-my-bracelet</html>")},
		"works/other.html":       {Data: []byte("<html>embed-other</html>")},
	}
	fr := newStubRenderer(routes, func(call int, pageID, location string, props json.RawMessage) (string, *DirectiveSink, error) {
		return "<main>rendered:" + location + "</main>", titleSink("t"), nil
	})
	h := Handler(HandlerDeps{
		PrerenderFS: embedFS,
		SPA:         &spaStub{},
		Cache:       newMemOnlyCache(t, "b1", 16, 0),
		Renderer:    fr,
		Routes:      routes,
		BuildID:     "b1",
		Registry:    reg,
	})
	ctx := context.Background()

	// 改前：embed 层 200
	resp := get(t, h, "/works/my-bracelet")
	if resp.StatusCode != http.StatusOK || resp.Header.Get(HeaderTier) != TierEmbed {
		t.Fatalf("改前 /works/my-bracelet 应 200 embed, got %d tier=%q", resp.StatusCode, resp.Header.Get(HeaderTier))
	}
	resp.Body.Close()

	// 带参数失效（消费方 deleteWork 的调用形态）
	if err := Invalidate(ctx, "/works/:slug", Params{"slug": "my-bracelet"}); err != nil {
		t.Fatal(err)
	}

	// 墓碑命中：embed 视为 miss → 走 static 路由 → loader 报 ErrPageNotFound → 404 壳
	resp = get(t, h, "/works/my-bracelet")
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("失效后 /works/my-bracelet 应 404, got %d（僵尸页回归）", resp.StatusCode)
	}
	if got := body(t, resp); got != "SPA-FALLBACK" {
		t.Errorf("404 body = %q, want SPA 壳", got)
	}

	// 点失效不误伤同模式的兄弟页（仍 embed）
	resp = get(t, h, "/works/other")
	if resp.StatusCode != http.StatusOK || resp.Header.Get(HeaderTier) != TierEmbed {
		t.Fatalf("/works/other 应仍 200 embed, got %d tier=%q", resp.StatusCode, resp.Header.Get(HeaderTier))
	}
	resp.Body.Close()

	// 失效图反向依赖把首页也打下 embed 层：首页快照还含死链，继续发就是旧内容
	resp = get(t, h, "/")
	if resp.Header.Get(HeaderTier) == TierEmbed {
		t.Fatalf("失效图波及 / 后首页不应再命中 embed, tier=%q", resp.Header.Get(HeaderTier))
	}
	if got := body(t, resp); !strings.Contains(got, "rendered:/") {
		t.Errorf("首页应落到现场渲染层, got %q", got)
	}

	// 字面路径失效（消费方同样会调 Invalidate("/", nil) 这类无参形态）
	if err := Invalidate(ctx, "/", nil); err != nil {
		t.Fatal(err)
	}
	resp = get(t, h, "/")
	if resp.Header.Get(HeaderTier) == TierEmbed {
		t.Fatalf("字面路径失效后 / 不应再命中 embed, tier=%q", resp.Header.Get(HeaderTier))
	}
	resp.Body.Close()

	// 模式整体失效（params=nil 走宽失效）：/works/* 全部下 embed 层
	if err := Invalidate(ctx, "/works/:slug", nil); err != nil {
		t.Fatal(err)
	}
	resp = get(t, h, "/works/other")
	if resp.Header.Get(HeaderTier) == TierEmbed {
		t.Fatalf("模式宽失效后 /works/other 不应再命中 embed, tier=%q", resp.Header.Get(HeaderTier))
	}
	if resp.StatusCode != http.StatusOK || !strings.Contains(body(t, resp), "rendered:/works/other") {
		t.Errorf("仍存在的作品应落到渲染层 200, got %d", resp.StatusCode)
	}

	// sitemap / Paths 枚举不受运行期失效影响（收录来源与页面服务解耦）
	sm := SitemapHandler(routes, "https://example.com", SitemapOptions{Registry: reg})
	before := smServe(t, sm)
	if !strings.Contains(before, "https://example.com/works/my-bracelet") {
		t.Errorf("sitemap 应含枚举实例:\n%s", before)
	}
	if after := smServe(t, sm); after != before {
		t.Errorf("Invalidate 不应改变 sitemap 产物")
	}
}

func smServe(t *testing.T, h http.Handler) string {
	t.Helper()
	resp := get(t, h, "/sitemap.xml")
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// 墓碑单元：字面路径与模式两类键、同键幂等、nil 接收者安全。
func TestEmbedTombstoneUnits(t *testing.T) {
	var nilTomb *embedTombstone
	nilTomb.add("/x") // nil 不 panic、不生效
	if nilTomb.has("/x") {
		t.Error("nil 墓碑不应命中")
	}

	tomb := newEmbedTombstone()
	tomb.add("/works/my-bracelet")
	tomb.add("/works/:slug")
	tomb.add("/works/:slug") // 幂等
	tomb.add("/")

	for path, want := range map[string]bool{
		"/works/my-bracelet": true,
		"/works/other":       true, // 模式键覆盖
		"/":                  true,
		"/works":             false, // 段数不同不匹配
		"/pricing":           false,
	} {
		if got := tomb.has(path); got != want {
			t.Errorf("tomb.has(%q) = %v, want %v", path, got, want)
		}
	}
}
