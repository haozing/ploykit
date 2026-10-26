package renderx

import (
	"strings"
	"testing"
)

// Fixture modeled on the example's real web/dist/index.html (Vite output):
// favicon link, charset, viewport, title, module script and stylesheet in the
// head; plus the shapes real products add (modulepreload, theme-color,
// <html>/<body> style attributes).
const shellFixture = `<!DOCTYPE html>
<html lang="zh" style="background:#faf8f3">
  <head>
    <link rel="icon" type="image/png" href="/favicon.png" />
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#faf8f3" />
    <title>My Product</title>
    <link rel="modulepreload" href="/assets/chunk-BRV0JX8Z.js">
    <link rel="modulepreload" href="/assets/chunk-DZ67U9_P.js">
    <script type="module" crossorigin src="/assets/index-CRTSBTL4.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-9Xc8nwuT.css">
  </head>
  <body style="background:#faf8f3">
    <div id="root"></div>
  </body>
</html>
`

func TestParseShellHeadKeepsLinkAndMeta(t *testing.T) {
	got := ParseShellHead(shellFixture)

	wantTags := []HeadEntry{
		{Tag: "link", Attrs: map[string]string{"rel": "icon", "type": "image/png", "href": "/favicon.png"}},
		{Tag: "meta", Attrs: map[string]string{"name": "theme-color", "content": "#faf8f3"}},
		{Tag: "link", Attrs: map[string]string{"rel": "modulepreload", "href": "/assets/chunk-BRV0JX8Z.js"}},
		{Tag: "link", Attrs: map[string]string{"rel": "modulepreload", "href": "/assets/chunk-DZ67U9_P.js"}},
	}
	if len(got.HeadTags) != len(wantTags) {
		t.Fatalf("want %d head tags, got %d: %+v", len(wantTags), len(got.HeadTags), got.HeadTags)
	}
	for i, w := range wantTags {
		g := got.HeadTags[i]
		if g.Tag != w.Tag {
			t.Errorf("tag[%d] = %q, want %q", i, g.Tag, w.Tag)
		}
		if len(g.Attrs) != len(w.Attrs) {
			t.Errorf("tag[%d] attrs = %v, want %v", i, g.Attrs, w.Attrs)
			continue
		}
		for k, v := range w.Attrs {
			if g.Attrs[k] != v {
				t.Errorf("tag[%d] attrs[%q] = %q, want %q", i, k, g.Attrs[k], v)
			}
		}
	}
	// 整壳排除项逐个确认：stylesheet link、charset/viewport meta、
	// title、module script 都不在提取结果里。
	for _, e := range got.HeadTags {
		blob := e.Tag
		for k, v := range e.Attrs {
			blob += " " + k + "=" + v
		}
		for _, banned := range []string{"stylesheet", "viewport", "charset", "title", "index-CRTSBTL4"} {
			if strings.Contains(blob, banned) {
				t.Errorf("排除项 %q 混入提取结果: %+v", banned, e)
			}
		}
	}
}

// 排除清单逐项验证：stylesheet link、meta charset、meta viewport、
// title/script（非 link/meta 一律不取）。上面的整壳 fixture 已经隐式覆盖
// 大半，这里补边界形态（无引号属性值、单引号、大写标签名、rel 多 token）。
func TestParseShellHeadExclusionsAndShapes(t *testing.T) {
	shell := `<!doctype html>
<HTML LANG="zh">
<HEAD>
<link rel=preload as=font href='/f.woff2'>
<link rel='Stylesheet' href='/x.css'>
<link rel="preload stylesheet" href="/both.css">
<meta name=viewport content='width=device-width'>
<meta http-equiv="refresh" content="0;url=/go">
<meta name="description" content="d">
</HEAD>
<BODY CLASS='warm'>
`
	got := ParseShellHead(shell)
	var rels, names []string
	for _, e := range got.HeadTags {
		switch e.Tag {
		case "link":
			rels = append(rels, e.Attrs["rel"])
		case "meta":
			names = append(names, e.Attrs["name"])
		}
	}
	// stylesheet（含多 token rel 与大小写）与 http-equiv meta 整条排除；
	// preload 与 description 保留（preload 不是 stylesheet）。
	if strings.Join(rels, "|") != "preload" {
		t.Errorf("link rel 提取 = %q, want 只有 preload（stylesheet 变体全排除）", strings.Join(rels, "|"))
	}
	if strings.Join(names, "|") != "description" {
		t.Errorf("meta name 提取 = %q, want 只有 description（viewport/http-equiv 排除）", strings.Join(names, "|"))
	}
	if got.BodyAttrs["class"] != "warm" {
		t.Errorf("大写 <BODY CLASS=…> 属性应提取: %+v", got.BodyAttrs)
	}
	if len(got.HTMLAttrs) != 0 {
		t.Errorf("<HTML LANG=zh> 剥离 lang 后应为空: %+v", got.HTMLAttrs)
	}
}

// 优雅降级：缺 head / 缺 html、body 开标签 / 空输入一律空结果，绝不报错。
func TestParseShellHeadGraceful(t *testing.T) {
	for name, in := range map[string]string{
		"空输入":        "",
		"无 head":     `<html><body><div id="root"></div></body></html>`,
		"只有 doctype": `<!doctype html>`,
		"head 空":     `<!doctype html><html><head></head><body></body></html>`,
	} {
		got := ParseShellHead(in)
		if len(got.HeadTags) != 0 || got.HTMLAttrs != nil || got.BodyAttrs != nil {
			t.Errorf("%s: 应降级为空结果, got %+v", name, got)
		}
	}
}

// lang 剥离 + 多属性保留 + 与 RenderDocument 的端到端组合（壳继承的
// 集成面：ParseShellHead 的产物能直接作为 InheritHead/HTMLAttrs/BodyAttrs）。
func TestParseShellHeadToDocument(t *testing.T) {
	shell := ParseShellHead(shellFixture)
	if shell.HTMLAttrs["style"] != "background:#faf8f3" || len(shell.HTMLAttrs) != 1 {
		t.Errorf("html 属性应只剩 style（lang 剥离）: %+v", shell.HTMLAttrs)
	}
	if shell.BodyAttrs["style"] != "background:#faf8f3" {
		t.Errorf("body 属性应提取: %+v", shell.BodyAttrs)
	}
	doc, err := RenderDocument(Document{
		Lang:          "zh-CN",
		Head:          []HeadEntry{{Tag: "title", Children: "页面"}},
		InheritHead:   shell.HeadTags,
		HTMLAttrs:     shell.HTMLAttrs,
		BodyAttrs:     shell.BodyAttrs,
		CSS:           []string{"/assets/index-9Xc8nwuT.css"},
		BodyHTML:      "<p>x</p>",
		HydrateScript: `<script type="module" src="/assets/index-CRTSBTL4.js"></script>`,
	})
	if err != nil {
		t.Fatal(err)
	}
	html := string(doc)
	for _, want := range []string{
		`<html lang="zh-CN" style="background:#faf8f3">`,
		`<body style="background:#faf8f3">`,
		`rel="icon"`,
		`name="theme-color"`,
		`rel="modulepreload"`,
		`name="viewport"`,
	} {
		if !strings.Contains(html, want) {
			t.Errorf("端到端产物应含 %q:\n%s", want, html)
		}
	}
	// viewport 兜底抑制（壳 viewport 被排除后由兜底补位，恰好一条）
	if n := strings.Count(html, `name="viewport"`); n != 1 {
		t.Errorf("viewport 应恰好 1 条（兜底）, got %d:\n%s", n, html)
	}
	// modulepreload 在 CSS 之前
	if strings.Index(html, `rel="modulepreload"`) > strings.Index(html, `rel="stylesheet"`) {
		t.Errorf("modulepreload 应在 stylesheet 之前:\n%s", html)
	}
}

// 审计回归（2026-10-26）：被注释掉的 link/meta 必须保持死亡——注释剥离
// 之前的扫描会把 <!-- <link rel=icon …> --> 复活成真实继承条目。
func TestParseShellHeadCommentedTagsStayDead(t *testing.T) {
	shell := `<html lang="zh"><head>` +
		`<!-- legacy icon: <link rel="icon" href="/old.ico"> -->` +
		`<link rel="icon" type="image/png" href="/favicon.png">` +
		`</head><body></body></html>`
	out := ParseShellHead(shell)
	var hrefs []string
	for _, e := range out.HeadTags {
		if e.Attrs["rel"] == "icon" {
			hrefs = append(hrefs, e.Attrs["href"])
		}
	}
	if len(hrefs) != 1 || hrefs[0] != "/favicon.png" {
		t.Errorf("注释内的 icon 不得复活, got %v", hrefs)
	}
}
