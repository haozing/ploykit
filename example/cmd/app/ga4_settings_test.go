package main

// GA4 Measurement ID 设置键（docs/visitor-analytics.md Route 1 的 example
// 接线）：spec 必须接受空值（= 统计停用）、拒绝畸形 ID，且保持非敏感——ID
// 配置后本就会随页面加载出现在 HTML 里，是公开标识不是凭据，非敏感它才能
// 搭公开 /config 顺风车下发给前端 GA4Boot。无库测试：注册与 Validate 不碰
// 连接池；注册键的完整 DB 环路由 TestRegisteredKeysFullLoop 泛型覆盖。

import (
	"testing"

	"github.com/haozing/ploykit/settings"
)

func TestGA4KeySpec(t *testing.T) {
	s := settings.NewStore(nil)
	if err := s.RegisterKeys(ga4KeySpec()); err != nil {
		t.Fatalf("注册 ga4 键: %v", err)
	}

	cases := []struct {
		name  string
		value string
		ok    bool
	}{
		{"真实形态的 ID", "G-ABC123DEFG", true},
		{"空 = 停用统计", "", true},
		{"短横杠后太短", "G-abc", false},
		{"缺 G 前缀", "ABC123DEFG", false},
		{"小写 g 前缀", "g-abc123defg", false},
		{"含非法字符", "G-abc123!", false},
		{"带前后空白：校验内部剪裁", "  G-ABC123DEFG  ", true},
		{"Universal Analytics 旧格式", "UA-123456-1", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// 真实次序同管理台 PUT（settings/adapters/http/http.go）：
			// Validate(原始值) 在前，Normalize 在后——校验闭包必须自己容
			// 忍空白，测试因此对原始值调用 Validate。
			err := s.Validate("ga4_measurement_id", tc.value)
			if tc.ok && err != nil {
				t.Fatalf("应接受 %q: %v", tc.value, err)
			}
			if !tc.ok && err == nil {
				t.Fatalf("应拒绝 %q", tc.value)
			}
		})
	}
	t.Run("Normalize 剪裁后落库", func(t *testing.T) {
		if got := s.Normalize("ga4_measurement_id", "  G-ABC123DEFG  "); got != "G-ABC123DEFG" {
			t.Fatalf("Normalize 应剪空白，实际 %q", got)
		}
	})

	t.Run("非敏感 → 随公开 /config 下发", func(t *testing.T) {
		if s.IsSensitive("ga4_measurement_id") {
			t.Fatal("ga4_measurement_id 是公开标识，Sensitive 会让它从 /config 消失、前端 GA4Boot 拿不到")
		}
	})

	t.Run("env 兜底与默认值", func(t *testing.T) {
		spec := ga4KeySpec()
		if spec.Env != "GA4_MEASUREMENT_ID" {
			t.Fatalf("env 兜底应为 GA4_MEASUREMENT_ID，实际 %q", spec.Env)
		}
		if spec.Default != "" {
			t.Fatalf("默认值应为空（未配置 = 不统计），实际 %q", spec.Default)
		}
	})
}
