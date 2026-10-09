package authorization

import (
	"errors"
	"fmt"
	"time"
)

type Outcome uint8

const (
	OutcomeDeny Outcome = iota
	OutcomeAllow
	OutcomeChallenge
)

type Stage string

const (
	StageAuthentication Stage = "authentication"
	StageScope          Stage = "scope"
	StageMembership     Stage = "membership"
	StageRole           Stage = "role"
	StagePolicy         Stage = "policy"
	StageInput          Stage = "input"

	StageComplete Stage = "complete"
)

const (
	ReasonAllowed                      = "allowed"
	ReasonUnknownOperationOrScope      = "unknown_operation_or_scope"
	ReasonAuthMethodNotAllowed         = "auth_method_not_allowed"
	ReasonPrincipalRequired            = "principal_required"
	ReasonSessionInactive              = "session_inactive"
	ReasonCredentialInactive           = "credential_inactive"
	ReasonAssuranceRequired            = "assurance_required"
	ReasonRecentAuthRequired           = "recent_auth_required"
	ReasonScopeMismatch                = "scope_mismatch"
	ReasonPrincipalScopeMismatch       = "principal_scope_mismatch"
	ReasonCredentialMembershipInactive = "credential_membership_inactive"
	ReasonWorkspaceMembershipInactive  = "workspace_membership_inactive"
	ReasonProjectMembershipInactive    = "project_membership_inactive"
	ReasonWorkspaceRoleNotAllowed      = "workspace_role_not_allowed"
	ReasonProjectRoleNotAllowed        = "project_role_not_allowed"
	ReasonIdempotencyInvalid           = "idempotency_invalid"
)

const RecentAuthWindow = 600 * time.Second

type Challenge struct {
	TargetOperationID string
	RequiredAssurance Assurance
	MaxAge            time.Duration
}

type Decision struct {
	Outcome    Outcome
	Stage      Stage
	ReasonCode string
	Challenge  *Challenge
}

func (d Decision) Allowed() bool { return d.Outcome == OutcomeAllow }

var (
	ErrDenied = errors.New("authorization: denied")

	ErrReauthenticationRequired = errors.New("authorization: reauthentication required")
)

const (
	DenialCodePermissionDenied = "PERMISSION_DENIED"
	DenialCodeReauthRequired   = "REAUTH_REQUIRED"
)

type DenialError struct {
	Decision   Decision
	Code       string
	ReauthHint *Challenge
}

func (e *DenialError) Error() string {
	if e.ReauthHint != nil {
		return fmt.Sprintf("authorization: reauthentication required (operation=%s assurance=%s max_age=%s)",
			e.ReauthHint.TargetOperationID, e.ReauthHint.RequiredAssurance, e.ReauthHint.MaxAge)
	}
	return "authorization: denied: " + e.Decision.ReasonCode
}

func (e *DenialError) Is(target error) bool {
	switch target {
	case ErrDenied:
		return e.Code == DenialCodePermissionDenied
	case ErrReauthenticationRequired:
		return e.Code == DenialCodeReauthRequired
	default:
		return false
	}
}

func (d Decision) Err() error {
	switch d.Outcome {
	case OutcomeAllow:
		return nil
	case OutcomeChallenge:
		return &DenialError{Decision: d, Code: DenialCodeReauthRequired, ReauthHint: d.Challenge}
	default:
		return &DenialError{Decision: d, Code: DenialCodePermissionDenied}
	}
}
