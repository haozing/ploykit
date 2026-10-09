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
