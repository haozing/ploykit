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

func TestSSRDefineMerge(t *testing.T) {
	// 不传 Define：与历史行为逐字节一致（只含 NODE_ENV 的注入）。
	define, err := ssrDefine(nil)
	if err != nil {
		t.Fatalf("ssrDefine(nil): %v", err)
	}
	want := map[string]string{nodeEnvDefine: `"production"`}
	if !reflect.DeepEqual(define, want) {
		t.Fatalf("ssrDefine(nil) = %v, want %v", define, want)
	}

	// 传产品键：合并，产品键原样保留，NODE_ENV 仍为框架注入值。
	define, err = ssrDefine(map[string]string{"__BUILD_DATE__": `"2026-11-13"`})
	if err != nil {
		t.Fatalf("ssrDefine(产品键): %v", err)
	}
	want = map[string]string{
		"__BUILD_DATE__": `"2026-11-13"`,
		nodeEnvDefine:    `"production"`,
	}
	if !reflect.DeepEqual(define, want) {
		t.Fatalf("ssrDefine(产品键) = %v, want %v", define, want)
	}

	// 冲突：产品键试图覆盖 NODE_ENV → 报错，不静默任选一侧。
	if _, err := ssrDefine(map[string]string{nodeEnvDefine: `"development"`}); err == nil {
		t.Fatal("产品键覆盖 process.env.NODE_ENV 应报错")
	}
}

func TestBuildSSRBundleDefinesIdentifiers(t *testing.T) {
	root := repoRoot(t)
	nodeModules := filepath.Join(root, "example", "web", "node_modules")
	if _, err := os.Stat(nodeModules); err != nil {
		t.Skipf("example/web/node_modules 不存在（%s），跳过集成用例: %v", nodeModules, err)
	}

	// 最小入口：裸标识符经 define 替换后变成字符串字面量，eval 时作为
	// 表达式求值并 JSON 序列化回来——替换没生效就是 ReferenceError。
	entry := filepath.Join(t.TempDir(), "entry.mjs")
	src := `
globalThis.__ploykit_routes__ = function () {
  return JSON.stringify([{ path: "/", pageId: "d", render: "csr" }])
}
globalThis.__ploykit_render__ = function () {
  return JSON.stringify({ html: String(__BUILD_DATE__), directives: [] })
}
`
	if err := os.WriteFile(entry, []byte(src), 0o644); err != nil {
		t.Fatal(err)
	}
	bundle, err := BuildSSRBundle(BuildOptions{
		EntryPoints:   []string{entry},
		AbsWorkingDir: filepath.Dir(entry),
		Define:        map[string]string{"__BUILD_DATE__": `"2026-11-13"`},
	})
	if err != nil {
		t.Fatalf("BuildSSRBundle(Define): %v", err)
	}
	// 最直接的断言：替换发生 = 产物 contains 引号包裹的字面量文本；
	// 未替换的裸标识符会被 esbuild 原样保留为标识符（不带引号）。
	if !strings.Contains(string(bundle), `"2026-11-13"`) {
		t.Errorf("bundle 缺 define 替换产物 %q（裸标识符未被替换？）", `"2026-11-13"`)
	}

	// 对照：同一入口不带 Define 构建——断言裸标识符确实存活于产物，
	// 证明上面的 contains 是 define 在起作用，而非巧合文本。
	bare, err := BuildSSRBundle(BuildOptions{
		EntryPoints:   []string{entry},
		AbsWorkingDir: filepath.Dir(entry),
	})
	if err != nil {
		t.Fatalf("BuildSSRBundle(不带 Define): %v", err)
	}
	if !strings.Contains(string(bare), "__BUILD_DATE__") {
		t.Error("对照产物应仍含裸标识符 __BUILD_DATE__（define 未注入时的现状）")
	}

	// 冲突在 BuildSSRBundle 入口同样拦截。
	if _, err := BuildSSRBundle(BuildOptions{
		EntryPoints:   []string{entry},
		AbsWorkingDir: filepath.Dir(entry),
		Define:        map[string]string{"process.env.NODE_ENV": `"development"`},
	}); err == nil || !strings.Contains(err.Error(), "process.env.NODE_ENV") {
		t.Fatalf("Define 覆盖 NODE_ENV 应报错，got %v", err)
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
