package main

import (
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/renderx"
)

func TestPrerenderBaseURL(t *testing.T) {
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	cases := []struct {
		in   string
		want string
		note string
	}{
		{"", "", "未设置 = no-op"},
		{"   ", "", "空白 = no-op"},
		{"https://example.test", "https://example.test", "正例"},
		{"https://example.test/", "https://example.test", "尾斜杠剥除"},
		{" http://127.0.0.1:8030 ", "http://127.0.0.1:8030", "trim + 端口"},
		{"example.test", "", "漏 scheme = no-op（带告警）"},
		{"/foo", "", "相对路径 = no-op"},
	}
	for _, c := range cases {
		assert.Equal(t, c.want, prerenderBaseURL(c.in, log), c.note)
	}
}

// 接线守卫：web/dist 的真实壳能被 ParseShellHead 提取出 favicon link，且
// viewport/charset 被排除（兜底与 charset 行由框架负责）。dist 未构建时
// skip——产物级断言由构建后的预渲染产物 grep 承担。
func TestShellParsedFromRealDist(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "web", "dist", "index.html"))
	if err != nil {
		t.Skip("web/dist 未构建，真实壳提取由构建链验证")
	}
	shell := renderx.ParseShellHead(string(data))
	require.NotEmpty(t, shell.HeadTags, "真实壳应至少提取出 favicon link")

	var icons int
	for _, e := range shell.HeadTags {
		blob := e.Tag
		for k, v := range e.Attrs {
			blob += " " + k + "=" + v
		}
		if strings.Contains(blob, "rel=icon") {
			icons++
		}
		if strings.Contains(blob, "viewport") || strings.Contains(blob, "charset") {
			t.Errorf("viewport/charset 应由排除规则拦下: %+v", e)
		}
	}
	assert.GreaterOrEqual(t, icons, 1, "example 壳应带 favicon link（web/index.html）")
}
