package renderx

import (
	"context"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/haozing/ploykit/platform/storagex"
)

func newCacheOn(t *testing.T, buildID, root string, memPages int, ttl time.Duration) *LayeredCache {
	t.Helper()
	disk, err := storagex.NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	c, err := NewLayeredCache(CacheConfig{BuildID: buildID, MemPages: memPages, TTL: ttl, Disk: disk})
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func newDiskCache(t *testing.T, buildID string) (*LayeredCache, string) {
	t.Helper()
	root := t.TempDir()
	return newCacheOn(t, buildID, root, 0, 0), root
}

func newMemOnlyCache(t *testing.T, buildID string, memPages int, ttl time.Duration) *LayeredCache {
	t.Helper()
	c, err := NewLayeredCache(CacheConfig{BuildID: buildID, MemPages: memPages, TTL: ttl})
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestCachePutGetRoundtrip(t *testing.T) {
	c1, root := newDiskCache(t, "b1")
	ctx := context.Background()
	ent := CacheEntry{HTML: []byte("<html>hello</html>"), PropsSHA256: "abc123"}
	if err := c1.Put(ctx, "/blog/hello", ent); err != nil {
		t.Fatal(err)
	}
	got, ok := c1.Get(ctx, "/blog/hello")
	if !ok || string(got.HTML) != "<html>hello</html>" || got.PropsSHA256 != "abc123" {
		t.Fatalf("内存层命中失败： ok=%v got=%+v", ok, got)
	}
	if got.BuildID != "b1" || got.BuiltAt.IsZero() {
		t.Fatalf("Put 应补盖 buildId/builtAt：%+v", got)
	}

	c2 := newCacheOn(t, "b1", root, 0, 0)
	got2, ok := c2.Get(ctx, "/blog/hello")
	if !ok || string(got2.HTML) != "<html>hello</html>" {
		t.Fatalf("磁盘层命中失败： ok=%v got=%+v", ok, got2)
	}

	if err := c2.Delete(ctx, "/blog/hello"); err != nil {
		t.Fatal(err)
	}
	if _, ok := c2.Get(ctx, "/blog/hello"); ok {
		t.Fatal("Delete 后不应命中")
	}
	c3 := newCacheOn(t, "b1", root, 0, 0)
	if _, ok := c3.Get(ctx, "/blog/hello"); ok {
		t.Fatal("磁盘上的条目也应已删除")
	}
}

func TestCacheBuildIDVersioning(t *testing.T) {
	c1, root := newDiskCache(t, "build-aaa")
	ctx := context.Background()
	if err := c1.Put(ctx, "/blog/hello", CacheEntry{HTML: []byte("v1")}); err != nil {
		t.Fatal(err)
	}

	c2 := newCacheOn(t, "build-bbb", root, 0, 0)
	if _, ok := c2.Get(ctx, "/blog/hello"); ok {
		t.Fatal("异代 buildId 的条目必须视为未命中")
	}

	err := c2.Put(ctx, "/blog/hello", CacheEntry{HTML: []byte("x"), BuildID: "build-aaa"})
	if !errors.Is(err, ErrBuildIDMismatch) {
		t.Fatalf("want ErrBuildIDMismatch, got %v", err)
	}

	if _, err := NewLayeredCache(CacheConfig{}); err == nil {
		t.Fatal("空 BuildID 应构造失败")
	}
}

func TestCacheLRUEviction(t *testing.T) {
	c := newMemOnlyCache(t, "b", 2, 0)
	ctx := context.Background()
	for _, p := range []string{"/a", "/b"} {
		if err := c.Put(ctx, p, CacheEntry{HTML: []byte(p)}); err != nil {
			t.Fatal(err)
		}
	}
	if _, ok := c.Get(ctx, "/a"); !ok {
		t.Fatal("/a 应命中")
	}
	if err := c.Put(ctx, "/c", CacheEntry{HTML: []byte("c")}); err != nil {
		t.Fatal(err)
	}
	if _, ok := c.Get(ctx, "/b"); ok {
		t.Fatal("/b 应被逐出")
	}
	for _, p := range []string{"/a", "/c"} {
		if _, ok := c.Get(ctx, p); !ok {
			t.Fatalf("%s 应保留", p)
		}
	}
}

func TestCacheTTLExpiry(t *testing.T) {
	c1, root := newDiskCache(t, "b1")
	ctx := context.Background()
	stale := CacheEntry{HTML: []byte("old"), BuiltAt: time.Now().Add(-2 * time.Hour)}
	if err := c1.Put(ctx, "/blog/stale", stale); err != nil {
		t.Fatal(err)
	}
	if err := c1.Put(ctx, "/blog/fresh", CacheEntry{HTML: []byte("new")}); err != nil {
		t.Fatal(err)
	}
	if _, ok := c1.Get(ctx, "/blog/stale"); ok {
		t.Fatal("过期条目应视为 miss")
	}
	if _, ok := c1.Get(ctx, "/blog/fresh"); !ok {
		t.Fatal("新鲜条目应命中")
	}

	c2 := newCacheOn(t, "b1", root, 0, 0)
	if _, ok := c2.Get(ctx, "/blog/stale"); ok {
		t.Fatal("磁盘层的过期条目也应 miss")
	}
}

func TestCacheSingleflight(t *testing.T) {
	c, _ := newDiskCache(t, "b1")
	ctx := context.Background()
	const n = 16

	started := make(chan struct{})
	release := make(chan struct{})
	var calls atomic.Int32
	load := func(context.Context) (CacheEntry, error) {
		calls.Add(1)
		close(started)
		<-release
		return CacheEntry{HTML: []byte("rendered-once"), PropsSHA256: "s"}, nil
	}

	var wg sync.WaitGroup
	results := make([]CacheEntry, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			ent, err := c.GetOrLoad(ctx, "/blog/hello", load)
			if err != nil {
				t.Error(err)
			}
			results[i] = ent
		}(i)
	}

	<-started
	time.Sleep(20 * time.Millisecond)
	close(release)
	wg.Wait()

	if got := calls.Load(); got != 1 {
		t.Fatalf("loader 执行 %d 次, want 1", got)
	}
	for i, ent := range results {
		if string(ent.HTML) != "rendered-once" {
			t.Fatalf("results[%d] = %q", i, ent.HTML)
		}
	}
	if _, ok := c.Get(ctx, "/blog/hello"); !ok {
		t.Fatal("单飞结果应已写缓存")
	}
}

func TestCachePurgeForeign(t *testing.T) {
	ctx := context.Background()
	c1, root := newDiskCache(t, "b1")
	if err := c1.PurgeForeign(ctx, "b1"); err != nil {
		t.Fatal(err)
	}
	if err := c1.Put(ctx, "/blog/hello", CacheEntry{HTML: []byte("v1")}); err != nil {
		t.Fatal(err)
	}

	c1Again := newCacheOn(t, "b1", root, 0, 0)
	if err := c1Again.PurgeForeign(ctx, "b1"); err != nil {
		t.Fatal(err)
	}
	if _, ok := c1Again.Get(ctx, "/blog/hello"); !ok {
		t.Fatal("同代 PurgeForeign 不应清掉热页")
	}

	c2 := newCacheOn(t, "b2", root, 0, 0)
	if err := c2.PurgeForeign(ctx, "b2"); err != nil {
		t.Fatal(err)
	}
	if _, ok := c2.Get(ctx, "/blog/hello"); ok {
		t.Fatal("异代条目应被整目录清掉")
	}
	if err := c2.Put(ctx, "/blog/hello", CacheEntry{HTML: []byte("v2")}); err != nil {
		t.Fatal(err)
	}
	if err := c2.PurgeForeign(ctx, "b2"); err != nil {
		t.Fatal(err)
	}
	if _, ok := c2.Get(ctx, "/blog/hello"); !ok {
		t.Fatal("同代标记下二次 Purge 应保留新条目")
	}

	if err := c2.PurgeForeign(ctx, "b3"); err == nil {
		t.Fatal("buildID 与构造代号不符应报错")
	}
}

func TestCacheKey(t *testing.T) {
	cases := []struct {
		path    string
		wantKey string
		wantErr bool
	}{
		{"/", "index.html", false},
		{"/blog/hello", "blog/hello", false},
		{"/blog/my-post_1", "blog/my-post_1", false},
		{"", "", true},
		{"blog/hello", "", true},
		{"/blog/", "", true},
		{"/blog//hello", "", true},
		{"/blog/../etc", "", true},
		{"/blog/%2e%2e", "", true},
		{"/blog/a.b", "", true},
		{"/blog/a b", "", true},
		{"/blog/hello?x=1", "", true},
	}
	for _, c := range cases {
		key, err := cacheKey(c.path)
		if c.wantErr {
			if err == nil || !errors.Is(err, ErrInvalidCacheKey) {
				t.Errorf("cacheKey(%q) err = %v, want ErrInvalidCacheKey", c.path, err)
			}
			continue
		}
		if err != nil {
			t.Errorf("cacheKey(%q) err = %v", c.path, err)
			continue
		}
		if key != c.wantKey {
			t.Errorf("cacheKey(%q) = %q, want %q", c.path, key, c.wantKey)
		}
	}
}

func TestCacheInvalidKey(t *testing.T) {
	c := newMemOnlyCache(t, "b", 2, 0)
	ctx := context.Background()
	if _, ok := c.Get(ctx, "/blog/../etc"); ok {
		t.Fatal("非法键应 miss")
	}
	if err := c.Put(ctx, "/blog/../etc", CacheEntry{HTML: []byte("x")}); !errors.Is(err, ErrInvalidCacheKey) {
		t.Fatalf("Put 非法键应报 ErrInvalidCacheKey, got %v", err)
	}
	_, err := c.GetOrLoad(ctx, "/blog/a b", func(context.Context) (CacheEntry, error) {
		return CacheEntry{HTML: []byte("x")}, nil
	})
	if !errors.Is(err, ErrInvalidCacheKey) {
		t.Fatalf("GetOrLoad 非法键应在渲染前拒绝, got %v", err)
	}
}

func TestPropsSHA256(t *testing.T) {
	a, b := PropsSHA256([]byte(`{"x":1}`)), PropsSHA256([]byte(`{"x":1}`))
	if a != b || len(a) != 64 || strings.ContainsAny(a, "ghijklmnopqrstuvwxyz") {
		t.Fatalf("指纹不稳定或非 hex： %q vs %q", a, b)
	}
}
