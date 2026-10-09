package dispatchreason

import (
	"regexp"
	"testing"

	"github.com/stretchr/testify/assert"
)

func allValues() map[string]string {
	return map[string]string{
		"Queued":                Queued,
		"Coalesced":             Coalesced,
		"Deferred":              Deferred,
		"Steered":               Steered,
		"Blocked":               Blocked,
		"InvocationNotAllowed":  InvocationNotAllowed,
		"SelfTriggerSuppressed": SelfTriggerSuppressed,
		"QuotaExceeded":         QuotaExceeded,
		"AlreadyActive":         AlreadyActive,
		"TargetUnavailable":     TargetUnavailable,
		"AgentArchived":         AgentArchived,
		"TargetInTriage":        TargetInTriage,
		"ExecutorNotConfigured": ExecutorNotConfigured,
		"DispatcherNotWired":    DispatcherNotWired,
	}
}

func TestOutcomeValues(t *testing.T) {
	cases := []struct {
		name string
		got  string
		want string
	}{
		{"Queued", Queued, "queued"},
		{"Coalesced", Coalesced, "coalesced"},
		{"Deferred", Deferred, "deferred"},
		{"Steered", Steered, "steered"},
		{"Blocked", Blocked, "blocked"},
	}
	for _, c := range cases {
		assert.Equal(t, c.want, c.got, "调度结果 %s 的传输值应为五值闭集之一", c.name)
	}
}

func TestBlockReasonValues(t *testing.T) {
	cases := []struct {
		name string
		got  string
		want string
	}{
		{"InvocationNotAllowed", InvocationNotAllowed, "invocation_not_allowed"},
		{"SelfTriggerSuppressed", SelfTriggerSuppressed, "self_trigger_suppressed"},
		{"QuotaExceeded", QuotaExceeded, "quota_exceeded"},
		{"AlreadyActive", AlreadyActive, "already_active"},
		{"TargetUnavailable", TargetUnavailable, "target_unavailable"},
		{"AgentArchived", AgentArchived, "agent_archived"},
		{"TargetInTriage", TargetInTriage, "target_in_triage"},
		{"ExecutorNotConfigured", ExecutorNotConfigured, "executor_not_configured"},
		{"DispatcherNotWired", DispatcherNotWired, "dispatcher_not_wired"},
	}
	for _, c := range cases {
		assert.Equal(t, c.want, c.got, "拦截原因码 %s 的传输值", c.name)
	}
}

func TestValuesUnique(t *testing.T) {
	values := allValues()
	seen := make(map[string]string, len(values))
	for name, v := range values {
		if prev, dup := seen[v]; dup {
			t.Errorf("常量 %s 与 %s 的传输值重复（%q）：结果值与原因码共用同一字符串空间，值必须唯一", name, prev, v)
		}
		seen[v] = name
	}
}

func TestValuesWireFormat(t *testing.T) {
	snake := regexp.MustCompile(`^[a-z][a-z0-9_]*$`)
	for name, v := range allValues() {
		assert.Regexp(t, snake, v, "常量 %s 的传输值应为小写 snake_case（持久契约，只增不改）", name)
	}
}
