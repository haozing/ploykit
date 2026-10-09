package quota

import (
	"context"
	"testing"
	"time"
)

func TestStatusExceeded_GrantedBoundary_UTQT02(t *testing.T) {
	cases := []struct {
		name string
		st   Status
		want bool
	}{
		{"used 恰等于 limit+granted（到达总容量即超）", Status{Limit: 100, Used: 110, Granted: 10}, true},
		{"used 差 1 到总容量不超", Status{Limit: 100, Used: 109, Granted: 10}, false},
		{"limit=-1 不限即便用量巨大", Status{Limit: -1, Used: 1 << 62, Granted: 0}, false},
		{"granted 扩容后 used 在新容量内不超", Status{Limit: 10, Used: 15, Granted: 11}, false},
		{"granted 扩容后超新容量仍超", Status{Limit: 10, Used: 22, Granted: 11}, true},
		{"limit=0（未定义维度）仅有解锁额度可用", Status{Limit: 0, Used: 0, Granted: 5}, false},
		{"limit=0 解锁额度耗尽即超", Status{Limit: 0, Used: 5, Granted: 5}, true},
	}
	for _, c := range cases {
		if got := c.st.Exceeded(); got != c.want {
			t.Errorf("%s: Exceeded(L=%d,U=%d,G=%d)=%v want %v",
				c.name, c.st.Limit, c.st.Used, c.st.Granted, got, c.want)
		}
	}
}

func TestNewServiceWithHooks_UTQT03(t *testing.T) {
	s := NewService(nil)
	if s.hooks.OnExhausted != nil || s.hooks.OnNearLimit != nil || s.hooks.OnGrant != nil {
		t.Fatal("默认构造 hooks 应全空")
	}
	got := s.WithHooks(QuotaHooks{
		OnExhausted: func(_ context.Context, _, _ string) error { return nil },
	})
	if got != s {
		t.Error("WithHooks 应链式返回同一实例")
	}
	if s.hooks.OnExhausted == nil {
		t.Error("hooks 未注入")
	}

	if Period(time.Date(2026, 10, 6, 0, 0, 0, 0, time.UTC)) != "2026-10" {
		t.Error("Period 回归失败")
	}
}
