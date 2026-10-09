package dispatchreason

const (
	Queued    = "queued"
	Coalesced = "coalesced"
	Deferred  = "deferred"
	Steered   = "steered"
	Blocked   = "blocked"
)

const (
	InvocationNotAllowed  = "invocation_not_allowed"
	SelfTriggerSuppressed = "self_trigger_suppressed"
	QuotaExceeded         = "quota_exceeded"
	AlreadyActive         = "already_active"
	TargetUnavailable     = "target_unavailable"
	AgentArchived         = "agent_archived"
	TargetInTriage        = "target_in_triage"
	ExecutorNotConfigured = "executor_not_configured"
	DispatcherNotWired    = "dispatcher_not_wired"
)
