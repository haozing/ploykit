package renderx

import (
	"bytes"
	"errors"
	"strings"
	"testing"
)

func TestRenderDocumentGolden(t *testing.T) {
	got, err := RenderDocument(Document{
		Lang: "zh-CN",
		Head: []HeadEntry{
			{Tag: "title", Children: "Hello 世界"},
			{Tag: "meta", Attrs: map[string]string{"name": "description", "content": "首篇"}},
			{Tag: "meta", Attrs: map[string]string{"property": "og:image", "content": "/og.png"}},
			{Tag: "link", Attrs: map[string]string{"rel": "canonical", "href": "/blog/hello"}},
		},
		CSS:           []string{"/assets/entry-abc123.css"},
		BodyHTML:      "<h1>Hello</h1><p>world</p>",
		PropsJSON:     []byte(`{"title":"Hello"}`),
		HydrateScript: `<script type="module" src="/assets/entry-abc123.js"></script>`,
	})
	if err != nil {
		t.Fatal(err)
	}
	want := `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Hello 世界</title>
  <meta content="首篇" name="description">
  <meta content="/og.png" property="og:image">
  <link href="/blog/hello" rel="canonical">
  <link rel="stylesheet" href="/assets/entry-abc123.css">
</head>
<body>
  <div id="root"><h1>Hello</h1><p>world</p></div>
  <script type="application/json" id="__PLOYKIT_PROPS__">{"title":"Hello"}</script>
  <script type="module" src="/assets/entry-abc123.js"></script>
</body>
</html>
`
	if string(got) != want {
		t.Errorf("golden 不符：\n--- got ---\n%s--- want ---\n%s", got, want)
	}
}

func TestRenderDocumentXSS(t *testing.T) {
	got, err := RenderDocument(Document{
		Lang: `zh"><script>alert(0)</script>`,
		Head: []HeadEntry{
			{Tag: "meta", Attrs: map[string]string{"content": `"><script>alert(1)</script>`}},
			{Tag: "title", Children: `</title><script>alert(2)</script>`},
		},
		PropsJSON: []byte(`{"evil":"</script><script>alert(3)</script>"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	html := string(got)
	if strings.Contains(html, "<script>alert") {
		t.Errorf("出现未转义 script 注入：\n%s", html)
	}

	wantAttr := `content="&#34;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"`
	if !strings.Contains(html, wantAttr) {
		t.Errorf("属性值未按预期转义，want 子串 %q，got：\n%s", wantAttr, html)
	}

	if !strings.Contains(html, "&lt;/title&gt;&lt;script&gt;alert(2)&lt;/script&gt;") {
		t.Errorf("title children 未按预期转义：\n%s", html)
	}

	if strings.Contains(html, "</script><") || strings.Contains(html, `"evil":"<`) {
		t.Errorf("props JSON 存在未变换的 <：\n%s", html)
	}
	if !strings.Contains(html, `"evil":"\u003c/script>\u003cscript>alert(3)\u003c/script>"`) {
		t.Errorf("props 未按预期做 < → \\u003c 变换：\n%s", html)
	}
}

func TestRenderDocumentEmptyProps(t *testing.T) {
	got, err := RenderDocument(Document{BodyHTML: "<p>x</p>"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(got), `id="__PLOYKIT_PROPS__">{}</script>`) {
		t.Errorf("空 props 应落 {}：\n%s", got)
	}
	if strings.Count(string(got), "<link") != 0 {
		t.Errorf("无 CSS 不应有 link 行：\n%s", got)
	}
}

func TestRenderDocumentPageID(t *testing.T) {
	got, err := RenderDocument(Document{BodyHTML: "<p>x</p>", PageID: "blog-post"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(got), `id="__PLOYKIT_PROPS__" data-page-id="blog-post">`) {
		t.Errorf("props script 应带 data-page-id：\n%s", got)
	}

	got2, err := RenderDocument(Document{BodyHTML: "<p>x</p>"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(got2), "data-page-id") {
		t.Errorf("空 PageID 不应输出 data-page-id：\n%s", got2)
	}
}

func TestRenderDocumentRejectsUnsafe(t *testing.T) {
	cases := []struct {
		name    string
		doc     Document
		wantErr error
	}{
		{"标签名注入", Document{Head: []HeadEntry{{Tag: "meta><script"}}}, ErrInvalidHeadTag},
		{"标签名带空格", Document{Head: []HeadEntry{{Tag: "meta onload"}}}, ErrInvalidHeadTag},
		{"属性名注入", Document{Head: []HeadEntry{{Tag: "meta", Attrs: map[string]string{"x onmouseover": "y"}}}}, ErrInvalidHeadTag},
		{"属性名带斜杠", Document{Head: []HeadEntry{{Tag: "meta", Attrs: map[string]string{"a/b": "y"}}}}, ErrInvalidHeadTag},
		{"props 超限", Document{PropsJSON: bytes.Repeat([]byte("a"), MaxPropsBytes+1)}, ErrPropsTooLarge},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := RenderDocument(c.doc)
			if !errors.Is(err, c.wantErr) {
				t.Fatalf("want %v, got %v", c.wantErr, err)
			}
		})
	}
}

// React 19 float 把非 lazy <img> 的 <link rel="preload"> 产在 body 里（#root
// 内部）；文档组装必须把紧跟 #root 开标签的前导 preload 连续段提升进 <head>，
// 且不惊动其后的 `<!--$-->` 悬念边界标记与正常元素（水合期两者都是载荷）。
func TestRenderDocumentHoistsLeadingFloatPreloads(t *testing.T) {
	bodyIn := `<link rel="preload" as="image" href="/hero.png" fetchpriority="high">` +
		`<link rel="preload" as="image" href="/bead-1.png">` +
		`<!--$--><main><img src="/hero.png" alt="hero"><p>x</p></main><!--/$-->`
	got, err := RenderDocument(Document{
		Lang:          "en",
		Head:          []HeadEntry{{Tag: "title", Children: "T"}},
		CSS:           []string{"/assets/entry.css"},
		BodyHTML:      bodyIn,
		HydrateScript: `<script type="module" src="/assets/entry.js"></script>`,
	})
	if err != nil {
		t.Fatal(err)
	}
	html := string(got)
	headPart := html[:strings.Index(html, "</head>")]
	bodyPart := html[strings.Index(html, `<div id="root">`):]

	for _, want := range []string{
		`<link rel="preload" as="image" href="/hero.png" fetchpriority="high">`,
		`<link rel="preload" as="image" href="/bead-1.png">`,
	} {
		if !strings.Contains(headPart, want) {
			t.Errorf("提升后 head 应含 %q:\n%s", want, headPart)
		}
		if strings.Contains(bodyPart, want) {
			t.Errorf("body #root 内不应再含 %q:\n%s", want, bodyPart)
		}
	}
	// preload 在 CSS link 之前（提前量是这个修复的全部意义）
	if strings.Index(headPart, `rel="preload"`) > strings.Index(headPart, `rel="stylesheet"`) {
		t.Errorf("preload 应排在 CSS link 之前:\n%s", headPart)
	}
	// `<!--$-->` 悬念标记与正常元素原样保留在 body
	for _, keep := range []string{`<!--$-->`, `<!--/$-->`, `<main>`, `<img src="/hero.png"`, `</main>`} {
		if !strings.Contains(bodyPart, keep) {
			t.Errorf("body 应原样保留 %q:\n%s", keep, bodyPart)
		}
	}
}

// 保守边界：只动紧跟 #root 的前导段——正文中间的 preload、前导的非 preload
// link、以及 link 段之前的任何字节（注释/空白/文本）都不算，产物逐字节不变。
func TestRenderDocumentPreloadHoistConservative(t *testing.T) {
	cases := []struct {
		name     string
		bodyHTML string
		want     string // 完整期望产物（body 原样）
	}{
		{
			name:     "正文中间的 preload 不动",
			bodyHTML: `<main><link rel="preload" as="image" href="/mid.png"><p>x</p></main>`,
			want: `<!doctype html>
<html lang="">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
  <div id="root"><main><link rel="preload" as="image" href="/mid.png"><p>x</p></main></div>
  <script type="application/json" id="__PLOYKIT_PROPS__">{}</script>
</body>
</html>
`,
		},
		{
			name:     "前导 stylesheet link 不提升",
			bodyHTML: `<link rel="stylesheet" href="/x.css"><p>x</p>`,
			want: `<!doctype html>
<html lang="">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
  <div id="root"><link rel="stylesheet" href="/x.css"><p>x</p></div>
  <script type="application/json" id="__PLOYKIT_PROPS__">{}</script>
</body>
</html>
`,
		},
		{
			name:     "悬念标记在前 preload 在后——整段不动",
			bodyHTML: `<!--$--><link rel="preload" as="image" href="/after.png"><p>x</p>`,
			want: `<!doctype html>
<html lang="">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
  <div id="root"><!--$--><link rel="preload" as="image" href="/after.png"><p>x</p></div>
  <script type="application/json" id="__PLOYKIT_PROPS__">{}</script>
</body>
</html>
`,
		},
		{
			name:     "无 preload 时产物逐字节不变",
			bodyHTML: `<h1>Hello</h1><p>world</p>`,
			want: `<!doctype html>
<html lang="">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
  <div id="root"><h1>Hello</h1><p>world</p></div>
  <script type="application/json" id="__PLOYKIT_PROPS__">{}</script>
</body>
</html>
`,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := RenderDocument(Document{BodyHTML: c.bodyHTML})
			if err != nil {
				t.Fatal(err)
			}
			if string(got) != c.want {
				t.Errorf("产物不符（保守边界内应逐字节不变）：\n--- got ---\n%s--- want ---\n%s", got, c.want)
			}
		})
	}
}

// 单元级：rel 值按 token 列表识别（rel="preload stylesheet" 也算），属性顺序
// 无关；未闭合的 link 不吞。
func TestHoistLeadingPreloadsUnits(t *testing.T) {
	tags, rest := hoistLeadingPreloads(`<link href="/b.png" as="image" rel="preload"><link rel="preload alternate" href="/a.png"><p/>`)
	if len(tags) != 2 {
		t.Fatalf("want 2 hoisted tags, got %d (%v)", len(tags), tags)
	}
	if rest != `<p/>` {
		t.Errorf("rest = %q, want %q", rest, `<p/>`)
	}

	tags, rest = hoistLeadingPreloads(`<link rel="preload" href="/x.png"`)
	if tags != nil || rest != `<link rel="preload" href="/x.png"` {
		t.Errorf("未闭合 link 不应吞: tags=%v rest=%q", tags, rest)
	}

	tags, rest = hoistLeadingPreloads("")
	if tags != nil || rest != "" {
		t.Errorf("空 body: tags=%v rest=%q", tags, rest)
	}
}

// F-1 兜底可被页面覆盖：页面 head 自发 meta[name=viewport]（如编辑器页的
// user-scalable=no）时不重复输出兜底版。
func TestRenderDocumentViewportFallbackOverridden(t *testing.T) {
	got, err := RenderDocument(Document{
		Head: []HeadEntry{{Tag: "meta", Attrs: map[string]string{
			"name": "viewport", "content": "width=device-width, user-scalable=no",
		}}},
		BodyHTML: "<p>x</p>",
	})
	if err != nil {
		t.Fatal(err)
	}
	if n := strings.Count(string(got), `name="viewport"`); n != 1 {
		t.Errorf("自发 viewport 时应只输出页面版，got %d 处:\n%s", n, got)
	}
	if !strings.Contains(string(got), `content="width=device-width, user-scalable=no"`) {
		t.Errorf("页面版 viewport 应保留原 content:\n%s", got)
	}
	if strings.Contains(string(got), viewportFallback) {
		t.Errorf("兜底版不应出现:\n%s", got)
	}
}

// F-1 兜底也要被继承集里的 viewport 抑制（ParseShellHead 会排除壳 viewport，
// 这里直接构造，守 RenderDocument 自身的判据）。
func TestRenderDocumentViewportFallbackSuppressedByInherit(t *testing.T) {
	got, err := RenderDocument(Document{
		InheritHead: []HeadEntry{{Tag: "meta", Attrs: map[string]string{
			"name": "viewport", "content": "width=1024",
		}}},
		BodyHTML: "<p>x</p>",
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(got), viewportFallback) {
		t.Errorf("继承集已有 viewport 时兜底不应出现:\n%s", got)
	}
	if !strings.Contains(string(got), `content="width=1024"`) {
		t.Errorf("继承版 viewport 应保留:\n%s", got)
	}
}

// 壳继承：顺序（viewport 兜底 → 继承集 → 页面 head → preload → CSS）、
// 去重（页面赢）、html/body 属性透传（lang 归 Lang 所有）。
func TestRenderDocumentInheritsShellHead(t *testing.T) {
	got, err := RenderDocument(Document{
		Lang: "zh-CN",
		Head: []HeadEntry{
			{Tag: "title", Children: "页面标题"},
			{Tag: "meta", Attrs: map[string]string{"name": "theme-color", "content": "#111111"}},
		},
		InheritHead: []HeadEntry{
			{Tag: "link", Attrs: map[string]string{"rel": "icon", "type": "image/png", "href": "/favicon.png"}},
			{Tag: "meta", Attrs: map[string]string{"name": "theme-color", "content": "#faf8f3"}},
			{Tag: "link", Attrs: map[string]string{"rel": "modulepreload", "href": "/assets/chunk-1.js"}},
		},
		HTMLAttrs: map[string]string{"style": "background:#faf8f3"},
		BodyAttrs: map[string]string{"class": "warm"},
		CSS:       []string{"/assets/entry.css"},
		BodyHTML:  "<p>x</p>",
	})
	if err != nil {
		t.Fatal(err)
	}
	html := string(got)

	// 去重：页面 theme-color 赢，壳 theme-color 被跳过
	if strings.Contains(html, "#faf8f3\"></meta>") || strings.Contains(html, `content="#faf8f3"`) {
		t.Errorf("壳 theme-color 应被页面版去重:\n%s", html)
	}
	if !strings.Contains(html, `content="#111111"`) {
		t.Errorf("页面 theme-color 应保留:\n%s", html)
	}
	// favicon 与 modulepreload 继承
	if !strings.Contains(html, `rel="icon"`) || !strings.Contains(html, `href="/favicon.png"`) {
		t.Errorf("壳 favicon link 应继承:\n%s", html)
	}
	if !strings.Contains(html, `rel="modulepreload"`) {
		t.Errorf("壳 modulepreload 应继承:\n%s", html)
	}
	// 顺序：viewport 兜底 < 继承的 icon < 页面 title < modulepreload < stylesheet
	idx := func(sub string) int { return strings.Index(html, sub) }
	for _, pair := range [][2]string{
		{`name="viewport"`, `rel="icon"`},
		{`rel="icon"`, `<title>`},
		{`rel="modulepreload"`, `<title>`},
		{`<title>`, `rel="stylesheet"`},
	} {
		if idx(pair[0]) < 0 || idx(pair[1]) < 0 || idx(pair[0]) > idx(pair[1]) {
			t.Errorf("顺序不符：%q 应在 %q 之前:\n%s", pair[0], pair[1], html)
		}
	}
	// html/body 属性
	if !strings.Contains(html, `<html lang="zh-CN" style="background:#faf8f3">`) {
		t.Errorf("html 属性应透传在 lang 之后:\n%s", html)
	}
	if !strings.Contains(html, `<body class="warm">`) {
		t.Errorf("body 属性应透传:\n%s", html)
	}
}

// F-2：og:image / twitter:image / og:url 绝对化；canonical 与其它 meta 不动；
// 已绝对/协议相对不动；BaseURL 空或非法 = no-op。
func TestRenderDocumentAbsolutizesSocialMeta(t *testing.T) {
	head := func() []HeadEntry {
		return []HeadEntry{
			{Tag: "meta", Attrs: map[string]string{"property": "og:image", "content": "/shots/a.jpg"}},
			{Tag: "meta", Attrs: map[string]string{"name": "twitter:image", "content": "shots/b.jpg"}},
			{Tag: "meta", Attrs: map[string]string{"property": "og:url", "content": "/about"}},
			{Tag: "meta", Attrs: map[string]string{"property": "og:image:secure_url", "content": "/keep.jpg"}},
			{Tag: "link", Attrs: map[string]string{"rel": "canonical", "href": "/about"}},
		}
	}
	cases := []struct {
		name    string
		baseURL string
		want    []string
		notWant []string
	}{
		{
			name:    "BaseURL 设置：相对值绝对化",
			baseURL: "https://example.test",
			want: []string{
				`content="https://example.test/shots/a.jpg" property="og:image"`,
				`content="https://example.test/shots/b.jpg"`,
				`content="https://example.test/about" property="og:url"`,
			},
			notWant: []string{`content="/shots/a.jpg"`, `content="shots/b.jpg"`, `content="/about"`},
		},
		{
			name:    "BaseURL 为空：完全 no-op",
			baseURL: "",
			want:    []string{`content="/shots/a.jpg"`, `content="shots/b.jpg"`},
			notWant: []string{"example.test"},
		},
		{
			name:    "BaseURL 非法：视同未设置",
			baseURL: "not-a-url",
			want:    []string{`content="/shots/a.jpg"`},
			notWant: []string{"not-a-url"},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := RenderDocument(Document{Head: head(), BodyHTML: "<p>x</p>", BaseURL: c.baseURL})
			if err != nil {
				t.Fatal(err)
			}
			for _, w := range c.want {
				if !strings.Contains(string(got), w) {
					t.Errorf("应含 %q:\n%s", w, got)
				}
			}
			for _, w := range c.notWant {
				if strings.Contains(string(got), w) {
					t.Errorf("不应含 %q:\n%s", w, got)
				}
			}
		})
	}

	// 已绝对 / 协议相对不动
	got, err := RenderDocument(Document{
		Head: []HeadEntry{
			{Tag: "meta", Attrs: map[string]string{"property": "og:image", "content": "https://cdn.example/x.jpg"}},
			{Tag: "meta", Attrs: map[string]string{"property": "og:image", "content": "//cdn.example/y.jpg"}},
		},
		BodyHTML: "<p>x</p>", BaseURL: "https://example.test",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(got), `content="https://cdn.example/x.jpg"`) ||
		!strings.Contains(string(got), `content="//cdn.example/y.jpg"`) {
		t.Errorf("已绝对/协议相对的 og:image 不应改写:\n%s", got)
	}

	// 绝对化不能改调用方的 Attrs（copy-on-write）
	entries := head()
	_, _ = RenderDocument(Document{Head: entries, BodyHTML: "<p>x</p>", BaseURL: "https://example.test"})
	if entries[0].Attrs["content"] != "/shots/a.jpg" {
		t.Errorf("输入 HeadEntry 被原地改写: %v", entries[0].Attrs)
	}
}

// html/body 属性走与 head 条目同一白名单：非法属性名报 ErrInvalidHeadTag。
func TestRenderDocumentRejectsUnsafeTagAttrs(t *testing.T) {
	for _, attrs := range []map[string]string{
		{"a/b": "y"}, {"x onmouseover": "z"}, {"http-equiv": "refresh"},
	} {
		if _, err := RenderDocument(Document{BodyHTML: "<p>x</p>", HTMLAttrs: attrs}); !errors.Is(err, ErrInvalidHeadTag) {
			t.Errorf("HTMLAttrs %v 应报 ErrInvalidHeadTag, got %v", attrs, err)
		}
		if _, err := RenderDocument(Document{BodyHTML: "<p>x</p>", BodyAttrs: attrs}); !errors.Is(err, ErrInvalidHeadTag) {
			t.Errorf("BodyAttrs %v 应报 ErrInvalidHeadTag, got %v", attrs, err)
		}
	}
}

// 审计回归（2026-10-26）：on* 事件属性与大小写变体的 http-equiv 一律拒绝
//（Head 指令通道与 HTMLAttrs/BodyAttrs 同一白名单）；style 合法透传。
func TestDenyAttrEventHandlers(t *testing.T) {
	for _, name := range []string{"onload", "onerror", "ONCLICK", "onMouseOver"} {
		if !denyAttr(name) {
			t.Errorf("denyAttr(%q) 应拒绝 on* 事件属性", name)
		}
	}
	for _, name := range []string{"http-equiv", "HTTP-EQUIV"} {
		if !denyAttr(name) {
			t.Errorf("denyAttr(%q) 应大小写不敏感地拒绝", name)
		}
	}
	for _, name := range []string{"style", "class", "data-x", "content"} {
		if denyAttr(name) {
			t.Errorf("denyAttr(%q) 不应误伤合法属性", name)
		}
	}

	_, err := RenderDocument(Document{
		Lang: "zh",
		Head: []HeadEntry{{Tag: "meta", Attrs: map[string]string{"name": "x", "onload": "alert(1)"}}},
	})
	if err == nil {
		t.Error("Head 指令携带 onload 必须整条拒绝")
	}
	_, err = RenderDocument(Document{
		Lang:      "zh",
		HTMLAttrs: map[string]string{"ONLOAD": "alert(1)"},
	})
	if err == nil {
		t.Error("HTMLAttrs 携带大写 ONLOAD 必须拒绝")
	}
	html, err := RenderDocument(Document{
		Lang:      "zh",
		HTMLAttrs: map[string]string{"style": "background:#fff"},
	})
	if err != nil || !strings.Contains(string(html), `style="background:#fff"`) {
		t.Errorf("style 应合法透传, err=%v:\n%s", err, html)
	}
}

// 审计回归（2026-10-26）：link 去重键含 href——页面同 rel 不同 href 的
// preload 不得挤掉壳的 preload/modulepreload 提示。
func TestInheritDedupeKeepsSiblingLinks(t *testing.T) {
	doc := Document{
		Lang: "zh",
		InheritHead: []HeadEntry{
			{Tag: "link", Attrs: map[string]string{"rel": "preload", "as": "image", "href": "/hero.png"}},
			{Tag: "link", Attrs: map[string]string{"rel": "modulepreload", "href": "/vendor.js"}},
			{Tag: "link", Attrs: map[string]string{"rel": "icon", "href": "/favicon.png"}},
		},
		Head: []HeadEntry{
			{Tag: "link", Attrs: map[string]string{"rel": "preload", "as": "font", "href": "/font.woff2"}},
			{Tag: "link", Attrs: map[string]string{"rel": "icon", "href": "/page-icon.png"}},
		},
	}
	html, err := RenderDocument(doc)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"/hero.png", "/vendor.js", "/font.woff2"} {
		if !strings.Contains(string(html), want) {
			t.Errorf("同 rel 不同 href 的提示应共存，缺 %q:\n%s", want, html)
		}
	}
	if strings.Contains(string(html), "/favicon.png") {
		t.Errorf("页面同 href 键的 icon 应淘汰壳版本:\n%s", html)
	}
	if !strings.Contains(string(html), "/page-icon.png") {
		t.Errorf("页面 icon 应保留:\n%s", html)
	}
}
