package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
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
