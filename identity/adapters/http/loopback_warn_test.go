package http

// Mount 期 OAuthAppURL loopback 警告的判定测试（shuijing 2026-10-31 现场：
// 生产启用 OAuth 而未配 APP_URL，首次登录成功 302 到死链 localhost:5173）。
// 只钉 isLoopbackURL 的分类边界 + 警告触发条件（OAuth 非 nil 且 loopback）；
// slog 输出本身不在此断言（标准 handler，行为面即警告条件）。

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIsLoopbackURL(t *testing.T) {
	cases := []struct {
		raw  string
		want bool
	}{
		{"http://localhost:5173", true},            // dev 默认（事故现场）
		{"http://LOCALHOST:8080", true},            // 大小写不敏感
		{"http://app.localhost", true},             // .localhost 保留后缀
		{"http://127.0.0.1:8030", true},            // IPv4 loopback
		{"http://[::1]:8030", true},                // IPv6 loopback
		{"http://[::ffff:127.0.0.1]:8030", true},   // IPv4-mapped loopback
		{"https://braceletmakeronline.com", false}, // 生产正确形态
		{"http://10.0.0.1:8060", false},            // 内网非 loopback 不误报
		{"", false},                                // 空（未配 OAuth 时无所谓）
		{"not a url", false},                       // 怪串不触发
		{"http://", false},                         // 无 host 不触发
		{"//localhost", true},                      // 协议无关型仍解析出 loopback host
	}
	for _, tc := range cases {
		assert.Equal(t, tc.want, isLoopbackURL(tc.raw), "isLoopbackURL(%q)", tc.raw)
	}
}
