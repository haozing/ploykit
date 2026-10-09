package renderx

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func prerenderTestReg() *Registry {
	reg := NewRegistry()
	reg.RegisterPaths("/blog/:slug", func(ctx context.Context) ([]PagePath, error) {
		return []PagePath{{Params: Params{"slug": "hello"}}, {Params: Params{"slug": "world"}}}, nil
	})
	reg.RegisterLoader("/blog/:slug", func(ctx context.Context, p Params) (any, error) {
		return map[string]string{"title": "t-" + p["slug"]}, nil
	})
	reg.RegisterPaths("/docs/:id", func(ctx context.Context) ([]PagePath, error) {
		return []PagePath{{Params: Params{"id": "a1"}}}, nil
	})
	reg.RegisterLoader("/docs/:id", func(ctx context.Context, p Params) (any, error) {
		return map[string]string{"id": p["id"]}, nil
	})
	return reg
}

func prerenderTestRoutes() []RouteSpec {
	return []RouteSpec{
		{Path: "/", PageID: "landing", Render: ModeStatic},
		{Path: "/pricing", PageID: "pricing", Render: ModeStatic},
		{Path: "/blog/:slug", PageID: "blog-post", Render: ModeStatic},
		{Path: "/docs/:id", PageID: "doc", Render: ModeStatic},
	}
}

func normalPrerenderRender(call int, pageID, location string, props json.RawMessage) (string, *DirectiveSink, error) {
	var p struct {
		Title string `json:"title"`
	}
	_ = json.Unmarshal(props, &p)
	return "<main>" + location + ":" + p.Title + "</main>", titleSink(p.Title), nil
}

func readPrerenderManifest(t *testing.T, outDir string) PrerenderManifest {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(outDir, manifestFileName))
	if err != nil {
		t.Fatalf("读 manifest: %v", err)
	}
	var m PrerenderManifest
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("解析 manifest: %v", err)
	}
	return m
}

func TestPrerenderOutput(t *testing.T) {
	reg := prerenderTestReg()
	outDir := filepath.Join(t.TempDir(), "out")

	if err := os.MkdirAll(filepath.Join(outDir, "blog"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, junk := range []string{"junk.html", filepath.Join("blog", "old.html")} {
		if err := os.WriteFile(filepath.Join(outDir, junk), []byte("stale"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	fr := newStubRenderer(prerenderTestRoutes(), normalPrerenderRender)
	manifest, err := Prerender(context.Background(), PrerenderDeps{
		Renderer: fr,
		OutDir:   outDir,
		Routes:   prerenderTestRoutes(),
		Warm:     []string{"/blog/:slug"},
		BuildID:  "b-20261006",
		ViteAssets: ViteAssets{
			CSS: []string{"/assets/entry-a.css"},
			JS:  []string{"/assets/entry-b.js"},
		},
		Lang:     "zh-CN",
		Registry: reg,
	})
	if err != nil {
		t.Fatal(err)
	}

	for _, junk := range []string{"junk.html", filepath.Join("blog", "old.html")} {
		if _, err := os.Stat(filepath.Join(outDir, junk)); !os.IsNotExist(err) {
			t.Errorf("陈旧产物 %s 应被清空", junk)
		}
	}

	for _, f := range []string{"index.html", "pricing.html", filepath.Join("blog", "hello.html"), filepath.Join("blog", "world.html")} {
		if _, err := os.Stat(filepath.Join(outDir, f)); err != nil {
			t.Errorf("产物 %s 应存在: %v", f, err)
		}
	}
	if _, err := os.Stat(filepath.Join(outDir, "docs", "a1.html")); !os.IsNotExist(err) {
		t.Error("未 Warm 的 Loader 路由不应预热产物")
	}

	hello, err := os.ReadFile(filepath.Join(outDir, "blog", "hello.html"))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"<title>t-hello</title>",
		`<div id="root"><main>/blog/hello:t-hello</main></div>`,
		`<script type="application/json" id="__PLOYKIT_PROPS__" data-page-id="blog-post">{"title":"t-hello"}</script>`,
		`<link rel="stylesheet" href="/assets/entry-a.css">`,
		`<script type="module" src="/assets/entry-b.js"></script>`,
		`<html lang="zh-CN">`,
	} {
		if !strings.Contains(string(hello), want) {
			t.Errorf("blog/hello.html 缺少 %q:\n%s", want, hello)
		}
	}

	if len(manifest.Pages) != 4 {
		t.Fatalf("manifest 页数 = %d, want 4: %+v", len(manifest.Pages), manifest.Pages)
	}
	wantPaths := []string{"/", "/blog/hello", "/blog/world", "/pricing"}
	for i, e := range manifest.Pages {
		if e.Path != wantPaths[i] {
			t.Errorf("manifest[%d].Path = %q, want %q（排序确定）", i, e.Path, wantPaths[i])
		}
		if e.BuildID != "b-20261006" || e.PropsSHA256 == "" || e.BuiltAt.IsZero() || e.PageID == "" {
			t.Errorf("manifest 条目 A4 字段不全: %+v", e)
		}
	}

	wantSHA := PropsSHA256([]byte(`{"title":"t-hello"}`))
	if manifest.Pages[1].PropsSHA256 != wantSHA {
		t.Errorf("propsSha256 = %q, want %q", manifest.Pages[1].PropsSHA256, wantSHA)
	}

	if manifest.Pages[0].PropsSHA256 != PropsSHA256([]byte("{}")) {
		t.Errorf("无 Loader 页 propsSha256 应为 {} 指纹, got %q", manifest.Pages[0].PropsSHA256)
	}

	disk := readPrerenderManifest(t, outDir)
	if len(disk.Pages) != len(manifest.Pages) || disk.BuildID != manifest.BuildID {
		t.Errorf("磁盘 manifest 与返回值不符: %+v", disk)
	}
}

func TestPrerenderErrorMentionsPage(t *testing.T) {
	fr := newStubRenderer(prerenderTestRoutes(), func(call int, pageID, location string, props json.RawMessage) (string, *DirectiveSink, error) {
		if location == "/pricing" {
			return "", nil, errors.New("boom: 摸了 window")
		}
		return "<main>x</main>", titleSink("x"), nil
	})
	outDir := filepath.Join(t.TempDir(), "out")
	_, err := Prerender(context.Background(), PrerenderDeps{
		Renderer: fr, OutDir: outDir, Routes: prerenderTestRoutes(),
		BuildID: "b", Registry: prerenderTestReg(),
	})
	if err == nil || !strings.Contains(err.Error(), "/pricing") {
		t.Fatalf("错误应带页面路径: %v", err)
	}
	if _, statErr := os.Stat(filepath.Join(outDir, manifestFileName)); !os.IsNotExist(statErr) {
		t.Error("失败的构建不应落 manifest")
	}
}

func TestPrerenderAssertions(t *testing.T) {
	cases := []struct {
		name    string
		path    string
		breakAt func(location string) (string, *DirectiveSink, error)
		wantErr error
	}{
		{"A2 空 html", "/pricing", func(string) (string, *DirectiveSink, error) {
			return "", nil, nil
		}, ErrEmptyRenderOutput},
		{"A3 缺 title", "/pricing", func(string) (string, *DirectiveSink, error) {
			return "<main>x</main>", noTitleSink(), nil
		}, ErrMissingTitle},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			breakAt := c.breakAt
			bad := c.path
			fr := newStubRenderer(prerenderTestRoutes(), func(call int, pageID, location string, props json.RawMessage) (string, *DirectiveSink, error) {
				if location == bad {
					return breakAt(location)
				}
				return "<main>x</main>", titleSink("x"), nil
			})
			_, err := Prerender(context.Background(), PrerenderDeps{
				Renderer: fr, OutDir: filepath.Join(t.TempDir(), "out"),
				Routes: prerenderTestRoutes(), BuildID: "b", Registry: prerenderTestReg(),
			})
			if !errors.Is(err, c.wantErr) {
				t.Fatalf("want %v, got %v", c.wantErr, err)
			}
			if err != nil && !strings.Contains(err.Error(), c.path) {
				t.Errorf("错误应带页面路径 %s: %v", c.path, err)
			}
		})
	}
}

func TestPrerenderFailFastOnTimeout(t *testing.T) {
	fr := newStubRenderer(prerenderTestRoutes(), func(call int, pageID, location string, props json.RawMessage) (string, *DirectiveSink, error) {
		switch location {
		case "/":
			return "", nil, fmt.Errorf("%w: / 超过 10s", ErrRenderTimeout)
		case "/pricing":
			time.Sleep(50 * time.Millisecond)
			return "", nil, errors.New("另一个错误")
		default:
			return "<main>x</main>", titleSink("x"), nil
		}
	})
	_, err := Prerender(context.Background(), PrerenderDeps{
		Renderer: fr, OutDir: filepath.Join(t.TempDir(), "out"),
		Routes: prerenderTestRoutes(), Warm: []string{"/blog/:slug"},
		BuildID: "b", Registry: prerenderTestReg(), Concurrency: 2,
	})
	if !errors.Is(err, ErrRenderTimeout) {
		t.Fatalf("超时应优先返回（R12① fail-fast）, got %v", err)
	}
	if err == nil || !strings.Contains(err.Error(), "页面 /") {
		t.Errorf("超时错误应带页面路径: %v", err)
	}
}

func TestPrerenderMissingPaths(t *testing.T) {
	routes := []RouteSpec{{Path: "/tag/:name", PageID: "tag", Render: ModeStatic}}
	_, err := Prerender(context.Background(), PrerenderDeps{
		Renderer: newStubRenderer(routes, normalPrerenderRender),
		OutDir:   filepath.Join(t.TempDir(), "out"),
		Routes:   routes, BuildID: "b", Registry: NewRegistry(),
	})
	if !errors.Is(err, ErrMissingPaths) {
		t.Fatalf("want ErrMissingPaths, got %v", err)
	}
}

func TestPrerenderBuiltAtUTC(t *testing.T) {
	fr := newStubRenderer(prerenderTestRoutes(), normalPrerenderRender)
	m, err := Prerender(context.Background(), PrerenderDeps{
		Renderer: fr, OutDir: filepath.Join(t.TempDir(), "out"),
		Routes: prerenderTestRoutes(), BuildID: "b", Registry: prerenderTestReg(),
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range m.Pages {
		if e.BuiltAt.Location() != time.UTC {
			t.Errorf("BuiltAt 应为 UTC: %+v", e.BuiltAt)
		}
	}
}
