package renderx

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"
)

func repoRoot(t *testing.T) string {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller 定位仓库根失败")
	}
	root := filepath.Dir(filepath.Dir(filepath.Dir(thisFile)))
	if _, err := os.Stat(filepath.Join(root, "go.mod")); err != nil {
		t.Fatalf("仓库根定位失败（%s 无 go.mod）: %v", root, err)
	}
	return root
}

func buildFixtureBundle(t *testing.T) []byte {
	t.Helper()
	root := repoRoot(t)
	nodeModules := filepath.Join(root, "example", "web", "node_modules")
	if _, err := os.Stat(nodeModules); err != nil {
		t.Skipf("example/web/node_modules 不存在（%s），跳过集成用例: %v", nodeModules, err)
	}
	bundle, err := BuildSSRBundle(BuildOptions{
		EntryPoints:   []string{filepath.Join(root, "platform", "renderx", "testdata", "entry-server.tsx")},
		AbsWorkingDir: root,
		NodePaths:     []string{nodeModules},
	})
	if err != nil {
		t.Fatalf("BuildSSRBundle: %v", err)
	}
	if len(bundle) < 100<<10 {
		t.Errorf("bundle 体积 %d 字节异常（react 全量打包应在数百 KB 量级）", len(bundle))
	}
	return bundle
}

func TestBuildSSRBundleRequiresEntry(t *testing.T) {
	if _, err := BuildSSRBundle(BuildOptions{}); err == nil {
		t.Error("缺 EntryPoints 应报错")
	}
}

func TestDefaultSSRAliases(t *testing.T) {
	webDir := filepath.Join("srv", "example", "web")
	packagesDir := filepath.Join("srv", "packages")
	got := DefaultSSRAliases(webDir, packagesDir)

	nodeModules := filepath.Join(webDir, "node_modules")
	want := map[string]string{
		"react":                 filepath.Join(nodeModules, "react"),
		"react/jsx-runtime":     filepath.Join(nodeModules, "react", "jsx-runtime.js"),
		"react/jsx-dev-runtime": filepath.Join(nodeModules, "react", "jsx-dev-runtime.js"),
		"react-dom":             filepath.Join(nodeModules, "react-dom"),
		"react-router":          filepath.Join(nodeModules, "react-router"),
		"react-router/dom":      filepath.Join(nodeModules, "react-router", "dist", "development", "dom-export.mjs"),
		"react-router-dom":      filepath.Join(nodeModules, "react-router-dom"),
		"@tanstack/react-query": filepath.Join(nodeModules, "@tanstack", "react-query"),
		"@ploykit/ui":           filepath.Join(packagesDir, "ui", "src"),
		"@ploykit/client":       filepath.Join(packagesDir, "client", "src"),
		"@ploykit/runtime":      filepath.Join(packagesDir, "runtime", "src"),
	}

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("别名表与预期不一致:\ngot:  %v\nwant: %v", got, want)
	}

	if got["react"] != filepath.Join(webDir, "node_modules", "react") {
		t.Errorf("react 键 = %q, want %q", got["react"], filepath.Join(webDir, "node_modules", "react"))
	}
	for _, k := range []string{"ui", "client", "runtime"} {
		if got["@ploykit/"+k] != filepath.Join(packagesDir, k, "src") {
			t.Errorf("@ploykit/%s 键 = %q, want %q", k, got["@ploykit/"+k], filepath.Join(packagesDir, k, "src"))
		}
	}
}

func TestIntegrationFixtureEndToEnd(t *testing.T) {
	bundle := buildFixtureBundle(t)

	p, err := NewEnginePool(bundle, PoolOptions{Size: 2, RenderTimeout: 10 * time.Second})
	if err != nil {
		t.Fatalf("NewEnginePool: %v", err)
	}
	defer p.Close()

	routes, err := p.Routes(context.Background())
	if err != nil {
		t.Fatalf("Routes: %v", err)
	}
	wantRoutes := []RouteSpec{
		{Path: "/", PageID: "landing", Render: ModeStatic},
		{Path: "/pricing", PageID: "pricing", Render: ModeStatic},
		{Path: "/blog/:slug", PageID: "blog-post", Render: ModeStatic},
	}
	if len(routes) != len(wantRoutes) {
		t.Fatalf("Routes 返回 %d 条: %+v", len(routes), routes)
	}
	for i, w := range wantRoutes {
		if routes[i] != w {
			t.Errorf("路由[%d] = %+v, want %+v", i, routes[i], w)
		}
	}

	props := json.RawMessage(`{"post":{"title":"Hello Engine Pool","excerpt":"集成测试","content":"rendered by renderx engine pool","cover":"/og/hello.png"}}`)
	res, err := p.Render(context.Background(), "blog-post", "/blog/hello", props)
	if err != nil {
		t.Fatalf("Render(blog-post): %v", err)
	}
	for _, want := range []string{
		`<h1>Hello Engine Pool</h1>`,
		`data-page="blog-post"`,
		`<p data-slug="true">hello</p>`,
		"rendered by renderx engine pool",
	} {
		if !strings.Contains(res.HTML, want) {
			t.Errorf("渲染 html 缺少 %q:\n%s", want, res.HTML)
		}
	}

	entries, err := HeadEntries(res.Sink.Directives())
	if err != nil {
		t.Fatalf("HeadEntries: %v", err)
	}
	var title, desc, og string
	for _, e := range entries {
		switch {
		case e.Tag == "title":
			title = e.Children
		case e.Tag == "meta" && e.Attrs["name"] == "description":
			desc = e.Attrs["content"]
		case e.Tag == "meta" && e.Attrs["property"] == "og:image":
			og = e.Attrs["content"]
		}
	}
	if title != "Hello Engine Pool" || desc != "集成测试" || og != "/og/hello.png" {
		t.Errorf("head 指令不完整: title=%q desc=%q og=%q（entries=%+v）", title, desc, og, entries)
	}

	landing, err := p.Render(context.Background(), "landing", "/", nil)
	if err != nil || !strings.Contains(landing.HTML, "<h1>Ploykit</h1>") {
		t.Errorf("渲染 landing: err=%v html=%q", err, landing.HTML)
	}
	pricing, err := p.Render(context.Background(), "pricing", "/pricing", nil)
	if err != nil || !strings.Contains(pricing.HTML, "<h1>Pricing</h1>") {
		t.Errorf("渲染 pricing: err=%v html=%q", err, pricing.HTML)
	}
}
