package failuretax

const (
	RuntimeRecovery       = "runtime_recovery"
	Timeout               = "timeout"
	InterruptTimeout      = "interrupt_timeout"
	QueuedExpired         = "queued_expired"
	Cancelled             = "cancelled"
	ExecutorNotConfigured = "executor_not_configured"
	DependencyUnavailable = "dependency_unavailable"
)

const (
	ExecutorContextOverflow = "executor_error.context_overflow"
	ExecutorStateOversized  = "executor_error.state_oversized"
	ExecutorIterationLimit  = "executor_error.iteration_limit"
	ExecutorToolFailed      = "executor_error.tool_failed"
)

const (
	ProviderNetwork    = "provider.network"
	ProviderOverload   = "provider.overload"
	ProviderAuth       = "provider.auth"
	ProviderBadRequest = "provider.bad_request"
)

var RetryWhitelist = map[string]bool{
	RuntimeRecovery:       true,
	Timeout:               true,
	ProviderNetwork:       true,
	ProviderOverload:      true,
	DependencyUnavailable: true,
}

func Retryable(reason string) bool { return RetryWhitelist[reason] }

var ResumeUnsafe = map[string]bool{
	ExecutorContextOverflow: true,
	ExecutorStateOversized:  true,
}
