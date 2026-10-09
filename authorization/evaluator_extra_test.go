package authorization

import (
	"testing"
	"time"
)

func TestDerivedUnknownOperationOrScopeFailsClosed(t *testing.T) {
	now := goldenNow()
	if decision := Evaluate(Request{Now: now}); decision.Allowed() ||
		decision.Stage != StagePolicy || decision.ReasonCode != ReasonUnknownOperationOrScope {
		t.Fatalf("empty request decision = %+v", decision)
	}
	operation := goldenOperation(t, goldenCatalog(t), "op.platform.public")
	if decision := Evaluate(Request{Operation: operation, Scope: nil, Now: now}); decision.Allowed() ||
		decision.ReasonCode != ReasonUnknownOperationOrScope {
		t.Fatalf("nil scope decision = %+v", decision)
	}
}

func TestDerivedSessionInactive(t *testing.T) {
	now := goldenNow()
	operation := goldenOperation(t, goldenCatalog(t), "op.project.invoke")
	facts := Facts{
		ActiveUser: true, ActiveSession: true,
		ActiveWorkspaceMembership: true, ActiveProjectMembership: true,
		ProjectRoles: []string{"role_caller"}, Assurance: AssuranceAAL1,
		IdempotencyValid: true,
	}
	cases := map[string]struct {
		principal SessionPrincipal
		facts     Facts
	}{
		"absolute expiry passed": {SessionPrincipal{AbsoluteExpiry: now.Add(-time.Second), IdleExpiry: now.Add(time.Hour)}, facts},
		"idle expiry passed":     {SessionPrincipal{AbsoluteExpiry: now.Add(time.Hour), IdleExpiry: now.Add(-time.Second)}, facts},
		"inactive session fact":  {SessionPrincipal{AbsoluteExpiry: now.Add(time.Hour), IdleExpiry: now.Add(time.Hour)}, func() Facts { f := facts; f.ActiveSession = false; return f }()},
		"inactive user fact":     {SessionPrincipal{AbsoluteExpiry: now.Add(time.Hour), IdleExpiry: now.Add(time.Hour)}, func() Facts { f := facts; f.ActiveUser = false; return f }()},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			c.principal.SubjectID, c.principal.SessionID = "user-1", "session-1"
			decision := Evaluate(Request{
				Operation: operation, Principal: c.principal,
				Scope: ProjectScope{WorkspaceID: "t1", ProjectID: "p1"},
				Facts: c.facts, Now: now,
			})
			if decision.Allowed() || decision.Stage != StageAuthentication || decision.ReasonCode != ReasonSessionInactive {
				t.Fatalf("decision = %+v, want deny(authentication, session_inactive)", decision)
			}
		})
	}
}

func TestDerivedPrincipalRequired(t *testing.T) {
	decision := Evaluate(Request{
		Operation: goldenOperation(t, goldenCatalog(t), "op.project.invoke"),
		Scope:     ProjectScope{WorkspaceID: "t1", ProjectID: "p1"},
		Facts:     Facts{},
		Now:       goldenNow(),
	})
	if decision.Allowed() || decision.Stage != StageAuthentication || decision.ReasonCode != ReasonPrincipalRequired {
		t.Fatalf("decision = %+v, want deny(authentication, principal_required)", decision)
	}
}

func TestDerivedCredentialMembershipInactive(t *testing.T) {
	now := goldenNow()
	base := Facts{ActiveUser: true, ActiveWorkspaceMembership: true, ActiveProjectMembership: true, ProjectRoles: []string{"role_caller"}}
	for name, facts := range map[string]Facts{
		"user inactive":      func() Facts { f := base; f.ActiveUser = false; return f }(),
		"workspace inactive": func() Facts { f := base; f.ActiveWorkspaceMembership = false; return f }(),
		"project inactive":   func() Facts { f := base; f.ActiveProjectMembership = false; return f }(),
	} {
		t.Run(name, func(t *testing.T) {
			decision := Evaluate(Request{
				Operation: goldenOperation(t, goldenCatalog(t), "op.project.token_read"),
				Principal: ScopedTokenPrincipal{
					SubjectID: "user-9", TokenID: "token-9",
					Scope: ProjectScope{WorkspaceID: "t1", ProjectID: "p1"},
				},
				Scope: ProjectScope{WorkspaceID: "t1", ProjectID: "p1"},
				Facts: facts, Now: now,
			})
			if decision.Allowed() || decision.Stage != StageMembership || decision.ReasonCode != ReasonCredentialMembershipInactive {
				t.Fatalf("decision = %+v, want deny(membership, credential_membership_inactive)", decision)
			}
		})
	}

	decision := Evaluate(Request{
		Operation: goldenOperation(t, goldenCatalog(t), "op.project.token_read"),
		Principal: ScopedTokenPrincipal{
			SubjectID: "user-9", TokenID: "token-9",
			Scope: ProjectScope{WorkspaceID: "t1", ProjectID: "p1"},
		},
		Scope: ProjectScope{WorkspaceID: "t1", ProjectID: "p1"},
		Facts: base, Now: now,
	})
	if !decision.Allowed() {
		t.Fatalf("active credential denied: %+v", decision)
	}
}

func TestDerivedMachineCredentialWindow(t *testing.T) {
	now := goldenNow()
	operation := goldenOperation(t, goldenCatalog(t), "op.project.machine_run")
	grantFacts := Facts{CredentialGrantActive: true}
	principal := func(notBefore, expiresAt time.Time) MachineCredentialPrincipal {
		return MachineCredentialPrincipal{
			CredentialID: "cred-1",
			Scope:        ProjectScope{WorkspaceID: "t1", ProjectID: "p1"},
			NotBefore:    notBefore,
			ExpiresAt:    expiresAt,
		}
	}
	cases := map[string]struct {
		p     MachineCredentialPrincipal
		facts Facts
	}{
		"not before in future": {principal(now.Add(time.Minute), time.Time{}), grantFacts},
		"expired":              {principal(now.Add(-time.Hour), now.Add(-time.Second)), grantFacts},
		"grant revoked":        {principal(now.Add(-time.Hour), time.Time{}), Facts{}},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			decision := Evaluate(Request{
				Operation: operation, Principal: c.p,
				Scope: ProjectScope{WorkspaceID: "t1", ProjectID: "p1"},
				Facts: c.facts, Now: now,
			})
			if decision.Allowed() || decision.Stage != StageAuthentication || decision.ReasonCode != ReasonCredentialInactive {
				t.Fatalf("decision = %+v, want deny(authentication, credential_inactive)", decision)
			}
		})
	}

	if decision := Evaluate(Request{
		Operation: operation,
		Principal: principal(now, now.Add(time.Hour)),
		Scope:     ProjectScope{WorkspaceID: "t1", ProjectID: "p1"},
		Facts:     grantFacts, Now: now,
	}); !decision.Allowed() {
		t.Fatalf("valid machine credential denied: %+v", decision)
	}
}

func TestDerivedWorkspaceMembershipAndRole(t *testing.T) {
	now := goldenNow()
	operation := goldenOperation(t, goldenCatalog(t), "op.workspace.admin")
	principal := goldenSessionPrincipal(now, AssuranceAAL1)
	scope := WorkspaceScope{WorkspaceID: "t1"}

	facts := Facts{ActiveUser: true, ActiveSession: true, ActiveWorkspaceMembership: false, WorkspaceRoles: []string{"role_ws_a"}}
	if decision := Evaluate(Request{Operation: operation, Principal: principal, Scope: scope, Facts: facts, Now: now}); decision.Allowed() ||
		decision.Stage != StageMembership || decision.ReasonCode != ReasonWorkspaceMembershipInactive {
		t.Fatalf("decision = %+v, want deny(membership, workspace_membership_inactive)", decision)
	}

	facts.ActiveWorkspaceMembership = true
	facts.WorkspaceRoles = []string{"role_ws_b"}
	if decision := Evaluate(Request{Operation: operation, Principal: principal, Scope: scope, Facts: facts, Now: now}); decision.Allowed() ||
		decision.Stage != StageRole || decision.ReasonCode != ReasonWorkspaceRoleNotAllowed {
		t.Fatalf("decision = %+v, want deny(role, workspace_role_not_allowed)", decision)
	}

	facts.WorkspaceRoles = []string{"role_ws_b", "role_ws_a"}
	if decision := Evaluate(Request{Operation: operation, Principal: principal, Scope: scope, Facts: facts, Now: now}); !decision.Allowed() {
		t.Fatalf("workspace role allow side denied: %+v", decision)
	}
}

func TestDerivedInputAndScopeShape(t *testing.T) {
	now := goldenNow()
	catalog := goldenCatalog(t)
	invoke := goldenOperation(t, catalog, "op.project.invoke")
	principal := goldenSessionPrincipal(now, AssuranceAAL1)
	satisfied := Facts{
		ActiveUser: true, ActiveSession: true,
		ActiveWorkspaceMembership: true, ActiveProjectMembership: true,
		ProjectRoles: []string{"role_caller"}, Assurance: AssuranceAAL1,
		IdempotencyValid: true,
	}

	broken := satisfied
	broken.IdempotencyValid = false
	if decision := Evaluate(Request{
		Operation: invoke, Principal: principal,
		Scope: ProjectScope{WorkspaceID: "t1", ProjectID: "p1"},
		Facts: broken, Now: now,
	}); decision.Allowed() || decision.Stage != StageInput || decision.ReasonCode != ReasonIdempotencyInvalid {
		t.Fatalf("decision = %+v, want deny(input, idempotency_invalid)", decision)
	}

	if decision := Evaluate(Request{
		Operation: invoke, Principal: principal,
		Scope: WorkspaceScope{WorkspaceID: "t1"},
		Facts: satisfied, Now: now,
	}); decision.Allowed() || decision.Stage != StageScope || decision.ReasonCode != ReasonScopeMismatch {
		t.Fatalf("decision = %+v, want deny(scope, scope_mismatch)", decision)
	}
}

func TestDerivedStagePriorityWithMultipleGates(t *testing.T) {
	now := goldenNow()
	catalog := goldenCatalog(t)
	manage := goldenOperation(t, catalog, "op.project.manage")
	session := goldenSessionPrincipal(now, AssuranceAAL2)
	projectScope := ProjectScope{WorkspaceID: "t1", ProjectID: "p1"}

	t.Run("authentication precedes scope", func(t *testing.T) {

		if decision := Evaluate(Request{
			Operation: manage,
			Principal: ScopedTokenPrincipal{Scope: projectScope},
			Scope:     WorkspaceScope{WorkspaceID: "t1"},
			Facts:     Facts{}, Now: now,
		}); decision.Stage != StageAuthentication {
			t.Fatalf("decision = %+v, want authentication stage", decision)
		}
	})
	t.Run("scope precedes membership", func(t *testing.T) {

		if decision := Evaluate(Request{
			Operation: manage, Principal: session,
			Scope: WorkspaceScope{WorkspaceID: "t1"},
			Facts: Facts{ActiveUser: true, ActiveSession: true, Assurance: AssuranceAAL2,
				RecentPasswordAt: now.Add(-time.Minute), RecentMFAAt: now.Add(-time.Minute)},
			Now: now,
		}); decision.Stage != StageScope {
			t.Fatalf("decision = %+v, want scope stage", decision)
		}
	})
	t.Run("membership precedes role", func(t *testing.T) {

		facts := goldenManageFacts(now)
		facts.ActiveProjectMembership = false
		facts.ProjectRoles = nil
		if decision := Evaluate(Request{
			Operation: manage, Principal: session, Scope: projectScope,
			Facts: facts, Now: now,
		}); decision.Stage != StageMembership {
			t.Fatalf("decision = %+v, want membership stage", decision)
		}
	})
	t.Run("authentication challenge precedes role deny", func(t *testing.T) {

		facts := goldenManageFacts(now)
		facts.Assurance = AssuranceAAL1
		facts.ProjectRoles = []string{"role_caller"}
		if decision := Evaluate(Request{
			Operation: manage, Principal: goldenSessionPrincipal(now, AssuranceAAL1),
			Scope: projectScope, Facts: facts, Now: now,
		}); decision.Outcome != OutcomeChallenge || decision.Stage != StageAuthentication {
			t.Fatalf("decision = %+v, want authentication challenge", decision)
		}
	})
	t.Run("role precedes policy rules", func(t *testing.T) {

		facts := goldenManageFacts(now)
		facts.ProjectRoles = []string{"role_caller"}
		facts.Product = map[string]any{"maintenance": true}
		if decision := Evaluate(Request{
			Operation: manage, Principal: session, Scope: projectScope,
			Facts: facts, Now: now,
			Rules: []Rule{maintenanceRule{}},
		}); decision.Stage != StageRole {
			t.Fatalf("decision = %+v, want role stage", decision)
		}
	})
	t.Run("policy rules precede input", func(t *testing.T) {

		facts := goldenManageFacts(now)
		facts.IdempotencyValid = false
		facts.Product = map[string]any{"maintenance": true}
		if decision := Evaluate(Request{
			Operation: manage, Principal: session, Scope: projectScope,
			Facts: facts, Now: now,
			Rules: []Rule{maintenanceRule{}},
		}); decision.Stage != StagePolicy || decision.ReasonCode != "maintenance_mode_active" {
			t.Fatalf("decision = %+v, want policy stage with product reason code", decision)
		}
	})
}

type maintenanceRule struct{}

func (maintenanceRule) RuleName() string { return "maintenance_mode" }
func (maintenanceRule) Stage() Stage     { return StagePolicy }
func (maintenanceRule) Evaluate(req Request) (Decision, bool) {
	locked, _ := req.Facts.Product["maintenance"].(bool)
	if !locked {
		return Decision{}, false
	}
	return Decision{Outcome: OutcomeDeny, ReasonCode: "maintenance_mode_active"}, true
}

func TestProductRuleRegistryEndToEnd(t *testing.T) {
	registry := NewRegistry()
	if err := registry.RegisterFact("maintenance"); err != nil {
		t.Fatal(err)
	}
	if err := registry.Register(maintenanceRule{}); err != nil {
		t.Fatal(err)
	}
	raw := []byte(`
catalog_schema_version: 1
roles:
  project: [role_caller]
operations:
  - operation_id: op.project.read
    auth_method: session
    scope: project_path
    allowed_project_roles: [role_caller]
    assurance: aal1
    recent_auth: none
    idempotency: none
    rules: [maintenance_mode]
`)
	catalog, err := ParseCatalog(raw, registry)
	if err != nil {
		t.Fatalf("ParseCatalog with registered rule: %v", err)
	}
	operation, _ := catalog.Operation("op.project.read")
	now := goldenNow()
	principal := goldenSessionPrincipal(now, AssuranceAAL1)
	scope := ProjectScope{WorkspaceID: "t1", ProjectID: "p1"}
	satisfied := Facts{
		ActiveUser: true, ActiveSession: true,
		ActiveWorkspaceMembership: true, ActiveProjectMembership: true,
		ProjectRoles: []string{"role_caller"}, Assurance: AssuranceAAL1,
		Product: map[string]any{"maintenance": false},
	}
	rules, err := registry.Resolve(operation.Rules)
	if err != nil {
		t.Fatal(err)
	}

	if decision := Evaluate(Request{Operation: operation, Principal: principal, Scope: scope, Facts: satisfied, Now: now, Rules: rules}); !decision.Allowed() {
		t.Fatalf("decision = %+v, want allow", decision)
	}

	locked := satisfied
	locked.Product = map[string]any{"maintenance": true}
	decision := Evaluate(Request{Operation: operation, Principal: principal, Scope: scope, Facts: locked, Now: now, Rules: rules})
	if decision.Allowed() || decision.Stage != StagePolicy || decision.ReasonCode != "maintenance_mode_active" {
		t.Fatalf("decision = %+v, want deny(policy, maintenance_mode_active)", decision)
	}

	if err := registry.ValidateFacts(Facts{Product: map[string]any{"undeclared": 1}}); err == nil {
		t.Fatal("undeclared fact key accepted")
	}
}
