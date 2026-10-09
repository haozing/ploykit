package failuretax

import (
	"regexp"
	"testing"

	"github.com/stretchr/testify/assert"
)

func allReasons() []struct{ name, value string } {
	return []struct{ name, value string }{
		{"RuntimeRecovery", RuntimeRecovery},
		{"Timeout", Timeout},
		{"InterruptTimeout", InterruptTimeout},
		{"QueuedExpired", QueuedExpired},
		{"Cancelled", Cancelled},
		{"ExecutorNotConfigured", ExecutorNotConfigured},
		{"DependencyUnavailable", DependencyUnavailable},
		{"ExecutorContextOverflow", ExecutorContextOverflow},
		{"ExecutorStateOversized", ExecutorStateOversized},
		{"ExecutorIterationLimit", ExecutorIterationLimit},
		{"ExecutorToolFailed", ExecutorToolFailed},
		{"ProviderNetwork", ProviderNetwork},
		{"ProviderOverload", ProviderOverload},
		{"ProviderAuth", ProviderAuth},
		{"ProviderBadRequest", ProviderBadRequest},
	}
}

func reasonSet() map[string]struct{} {
	set := make(map[string]struct{}, len(allReasons()))
	for _, r := range allReasons() {
		set[r.value] = struct{}{}
	}
	return set
}

func TestTerminalReasonValues(t *testing.T) {
	cases := []struct {
		name string
		got  string
		want string
	}{
		{"RuntimeRecovery", RuntimeRecovery, "runtime_recovery"},
		{"Timeout", Timeout, "timeout"},
		{"InterruptTimeout", InterruptTimeout, "interrupt_timeout"},
		{"QueuedExpired", QueuedExpired, "queued_expired"},
		{"Cancelled", Cancelled, "cancelled"},
		{"ExecutorNotConfigured", ExecutorNotConfigured, "executor_not_configured"},
		{"DependencyUnavailable", DependencyUnavailable, "dependency_unavailable"},
	}
	for _, c := range cases {
		assert.Equal(t, c.want, c.got, "终态失败原因 %s 的传输值", c.name)
	}
}

func TestExecutorCodeNamespace(t *testing.T) {
	cases := []struct {
		name string
		got  string
		want string
	}{
		{"ExecutorContextOverflow", ExecutorContextOverflow, "executor_error.context_overflow"},
		{"ExecutorStateOversized", ExecutorStateOversized, "executor_error.state_oversized"},
		{"ExecutorIterationLimit", ExecutorIterationLimit, "executor_error.iteration_limit"},
		{"ExecutorToolFailed", ExecutorToolFailed, "executor_error.tool_failed"},
	}
	for _, c := range cases {
		assert.Equal(t, c.want, c.got, "执行器失败码 %s 应挂在 executor_error 命名空间下", c.name)
	}
}

func TestProviderCodeNamespace(t *testing.T) {
	cases := []struct {
		name string
		got  string
		want string
	}{
		{"ProviderNetwork", ProviderNetwork, "provider.network"},
		{"ProviderOverload", ProviderOverload, "provider.overload"},
		{"ProviderAuth", ProviderAuth, "provider.auth"},
		{"ProviderBadRequest", ProviderBadRequest, "provider.bad_request"},
	}
	for _, c := range cases {
		assert.Equal(t, c.want, c.got, "提供方失败码 %s 应挂在 provider 命名空间下", c.name)
	}
}

func TestRetryable(t *testing.T) {
	cases := []struct {
		reason string
		want   bool
	}{
		{RuntimeRecovery, true},
		{Timeout, true},
		{ProviderNetwork, true},
		{ProviderOverload, true},
		{DependencyUnavailable, true},
		{InterruptTimeout, false},
		{QueuedExpired, false},
		{Cancelled, false},
		{ExecutorNotConfigured, false},
		{ExecutorContextOverflow, false},
		{ExecutorStateOversized, false},
		{ExecutorIterationLimit, false},
		{ExecutorToolFailed, false},
		{ProviderAuth, false},
		{ProviderBadRequest, false},
		{"", false},
		{"never_declared", false},
	}
	for _, c := range cases {
		assert.Equal(t, c.want, Retryable(c.reason), "Retryable(%q)", c.reason)
	}
}

func TestRetryWhitelistWithinVocabulary(t *testing.T) {
	vocab := reasonSet()
	for reason := range RetryWhitelist {
		assert.Contains(t, vocab, reason,
			"RetryWhitelist 含未声明码 %q：白名单必须 ⊆ 已声明词表", reason)
	}
}

func TestResumeUnsafeWithinVocabulary(t *testing.T) {
	vocab := reasonSet()
	for reason := range ResumeUnsafe {
		assert.Contains(t, vocab, reason,
			"ResumeUnsafe 含未声明码 %q：集合必须 ⊆ 已声明词表", reason)
	}
}

func TestValuesUniqueAndWireFormat(t *testing.T) {
	format := regexp.MustCompile(`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$`)
	seen := make(map[string]string, len(allReasons()))
	for _, r := range allReasons() {
		assert.Regexp(t, format, r.value,
			"码 %s 的值 %q 应为小写 snake_case（失败码可带一级点分命名空间），且一经发布只增不改", r.name, r.value)
		if prev, dup := seen[r.value]; dup {
			t.Errorf("码 %s 与 %s 的值重复（%q）：码值随运行记录落库，必须唯一", r.name, prev, r.value)
		}
		seen[r.value] = r.name
	}
}
