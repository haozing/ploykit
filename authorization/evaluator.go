package authorization

import "time"

type Request struct {
	Operation Operation

	Principal Principal
	Scope     Scope
	Facts     Facts

	Now time.Time

	Rules []Rule
}

func Evaluate(request Request) Decision {
	if request.Now.IsZero() {
		request.Now = time.Now().UTC()
	}
	if request.Operation.OperationID == "" || request.Scope == nil {
		return deny(StagePolicy, ReasonUnknownOperationOrScope)
	}
	for _, stage := range []Stage{
		StageAuthentication, StageScope, StageMembership, StageRole, StagePolicy, StageInput,
	} {
		if decision, ok := evaluateStage(request, stage); !ok {
			return decision
		}
	}
	return allow()
}

func evaluateStage(request Request, stage Stage) (Decision, bool) {
	switch stage {
	case StageAuthentication:
		return evaluateAuthentication(request)
	case StageScope:
		return evaluateScope(request)
	case StageMembership:
		return evaluateMembership(request)
	case StageRole:
		return evaluateRole(request)
	case StagePolicy:

		return runProductRules(request, StagePolicy)
	default:
		return evaluateInput(request)
	}
}

func evaluateAuthentication(req Request) (Decision, bool) {
	op, principal, facts := req.Operation, req.Principal, req.Facts

	if op.AuthMethod == AuthMethodUnauthenticated {
		if principal != nil {
			return deny(StageAuthentication, ReasonAuthMethodNotAllowed), false
		}
		return pass()
	}
	if principal == nil {
		return deny(StageAuthentication, ReasonPrincipalRequired), false
	}
	if principal.AuthMethod() != op.AuthMethod {

		return deny(StageAuthentication, ReasonAuthMethodNotAllowed), false
	}
	if session, ok := principal.(SessionPrincipal); ok {
		if !facts.ActiveUser || !facts.ActiveSession ||
			session.AbsoluteExpiry.Before(req.Now) || session.IdleExpiry.Before(req.Now) {
			return deny(StageAuthentication, ReasonSessionInactive), false
		}
	}
	if machine, ok := principal.(MachineCredentialPrincipal); ok {
		if !facts.CredentialGrantActive || machine.NotBefore.After(req.Now) ||
			(!machine.ExpiresAt.IsZero() && !machine.ExpiresAt.After(req.Now)) {
			return deny(StageAuthentication, ReasonCredentialInactive), false
		}
	}

	for _, rule := range builtinRules {
		if decision, ruled := rule.Evaluate(req); ruled {
			return decision, false
		}
	}
	return runProductRules(req, StageAuthentication)
}

func evaluateScope(req Request) (Decision, bool) {
	if !scopeMatches(req.Operation.Scope, req.Scope) {
		return deny(StageScope, ReasonScopeMismatch), false
	}

	if binding, bound := principalScopeBinding(req.Principal); bound {
		workspace, hasWorkspace := req.Scope.Workspace()
		project, hasProject := req.Scope.Project()
		if !hasWorkspace || !hasProject ||
			binding.WorkspaceID != workspace || binding.ProjectID != project {
			return deny(StageScope, ReasonPrincipalScopeMismatch), false
		}
	}
	return runProductRules(req, StageScope)
}

func evaluateMembership(req Request) (Decision, bool) {
	op, facts := req.Operation, req.Facts

	if op.AuthMethod == AuthMethodScopedToken {
		if !facts.ActiveUser || !facts.ActiveWorkspaceMembership || !facts.ActiveProjectMembership {
			return deny(StageMembership, ReasonCredentialMembershipInactive), false
		}
	}

	switch op.Scope {
	case ScopeKindWorkspacePath, ScopeKindProjectPath, ScopeKindProjectGovernance:
		if !facts.ActiveWorkspaceMembership {
			return deny(StageMembership, ReasonWorkspaceMembershipInactive), false
		}
	}
	if op.Scope == ScopeKindProjectPath && !facts.ActiveProjectMembership {
		return deny(StageMembership, ReasonProjectMembershipInactive), false
	}
	return runProductRules(req, StageMembership)
}

func evaluateRole(req Request) (Decision, bool) {
	op, facts := req.Operation, req.Facts

	switch op.Scope {
	case ScopeKindWorkspacePath, ScopeKindProjectGovernance:
		if !intersects(facts.WorkspaceRoles, op.AllowedWorkspaceRoles) {
			return deny(StageRole, ReasonWorkspaceRoleNotAllowed), false
		}
	case ScopeKindProjectPath:
		if !intersects(facts.ProjectRoles, op.AllowedProjectRoles) {
			return deny(StageRole, ReasonProjectRoleNotAllowed), false
		}
	case ScopeKindProjectCredential:

		if op.AuthMethod == AuthMethodScopedToken && !intersects(facts.ProjectRoles, op.AllowedProjectRoles) {
			return deny(StageRole, ReasonProjectRoleNotAllowed), false
		}
	}
	return runProductRules(req, StageRole)
}

func evaluateInput(req Request) (Decision, bool) {

	if req.Operation.Idempotency == IdempotencyRequired && !req.Facts.IdempotencyValid {
		return deny(StageInput, ReasonIdempotencyInvalid), false
	}
	return runProductRules(req, StageInput)
}

func runProductRules(req Request, stage Stage) (Decision, bool) {
	for _, rule := range req.Rules {
		if rule == nil || rule.Stage() != stage {
			continue
		}
		decision, ruled := rule.Evaluate(req)
		if !ruled || decision.Outcome == OutcomeAllow {
			continue
		}
		decision.Stage = stage
		return decision, false
	}
	return pass()
}

func scopeMatches(expected ScopeKind, scope Scope) bool {
	workspace, hasWorkspace := scope.Workspace()
	project, hasProject := scope.Project()
	nonEmptyWorkspace := hasWorkspace && workspace != ""
	nonEmptyProject := hasProject && project != ""
	switch expected {
	case ScopeKindPlatform:
		return !hasWorkspace && !hasProject
	case ScopeKindWorkspacePath:
		return nonEmptyWorkspace && !hasProject
	case ScopeKindProjectPath, ScopeKindProjectGovernance, ScopeKindProjectCredential:
		return nonEmptyWorkspace && nonEmptyProject
	default:
		return false
	}
}

func intersects(actual, allowed []string) bool {
	set := nameSet(actual)
	for _, candidate := range allowed {
		if _, ok := set[candidate]; ok {
			return true
		}
	}
	return false
}

func allow() Decision {
	return Decision{Outcome: OutcomeAllow, Stage: StageComplete, ReasonCode: ReasonAllowed}
}

func deny(stage Stage, reason string) Decision {
	return Decision{Outcome: OutcomeDeny, Stage: stage, ReasonCode: reason}
}

func pass() (Decision, bool) { return Decision{}, true }
