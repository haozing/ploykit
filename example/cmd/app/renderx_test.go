package main

import (
	"io/fs"
	"testing"
	"testing/fstest"

	"github.com/stretchr/testify/assert"

	"github.com/haozing/ploykit/platform/renderx"
)

func TestValidatedBaseURL(t *testing.T) {
	cases := []struct {
		in       string
		want     string
		wantWarn bool
		note     string
	}{
		{"https://example.com", "https://example.com", false, "正例"},
		{"https://example.com/", "https://example.com", false, "尾斜杠剥除"},
		{" http://192.168.1.10:8030 ", "http://192.168.1.10:8030", false, "trim + 带端口"},
		{"", "", false, "未设置不加噪音"},
		{"   ", "", false, "空白视同未设置"},
		{"example.com", "", true, "漏 scheme"},
		{"/foo", "", true, "相对路径"},
		{"ftp://example.com", "", true, "非 http(s)"},
		{"https://", "", true, "缺 host"},
		{"://bad", "", true, "解析失败"},
	}
	for _, c := range cases {
		got, warn := validatedBaseURL(c.in)
		assert.Equal(t, c.want, got, c.note)
		assert.Equal(t, c.wantWarn, warn != "", c.note)
	}
}

// 壳 head 继承接线（F-4/S-1/S-5 族）：内嵌壳里的 favicon/theme-color 被
// 提取、viewport/charset/stylesheet 被排除、html 的 lang 剥离；缺壳降级
// 为零值（渲染照常，只是不继承）。
func TestShellHeadFromFS(t *testing.T) {
	withShell := fstest.MapFS{"index.html": {Data: []byte(`<!doctype html>
<html lang="zh" style="background:#faf8f3">
<head>
  <link rel="icon" type="image/png" href="/favicon.png" />
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#faf8f3" />
  <link rel="stylesheet" href="/assets/index-x.css">
</head>
<body style="background:#faf8f3"><div id="root"></div></body>
</html>`)}}
	shell := shellHeadFromFS(withShell)
	assert.Len(t, shell.HeadTags, 2, "favicon link + theme-color 两条")
	for _, e := range shell.HeadTags {
		blob := e.Tag
		for k, v := range e.Attrs {
			blob += " " + k + "=" + v
		}
		assert.NotContains(t, blob, "viewport")
		assert.NotContains(t, blob, "charset")
		assert.NotContains(t, blob, "stylesheet")
	}
	assert.Equal(t, map[string]string{"style": "background:#faf8f3"}, shell.HTMLAttrs, "lang 剥离后只剩 style")
	assert.Equal(t, map[string]string{"style": "background:#faf8f3"}, shell.BodyAttrs)

	empty := shellHeadFromFS(fstest.MapFS{})
	assert.Equal(t, renderx.ShellHead{}, empty, "缺壳应降级为零值")
}

// compile-time: the embedded FS type matches shellHeadFromFS's contract.
var _ fs.FS = fstest.MapFS{}
