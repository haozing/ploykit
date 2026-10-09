package renderx

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
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
