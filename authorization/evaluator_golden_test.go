package authorization

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func goldenCatalog(t *testing.T) Catalog {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "golden.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := ParseCatalog(raw, NewRegistry())
	if err != nil {
		t.Fatalf("ParseCatalog(golden.yaml): %v", err)
	}
	return catalog
}

func goldenOperation(t *testing.T, catalog Catalog, operationID string) Operation {
	t.Helper()
	operation, ok := catalog.Operation(operationID)
	if !ok {
		t.Fatalf("golden fixture is missing operation %q", operationID)
	}
	return operation
}

var (
	goldenTenant  = "t1"
	goldenProject = "p1"
)

func goldenNow() time.Time {
	return time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)
}

func goldenSessionPrincipal(now time.Time, assurance Assurance) SessionPrincipal {
	return SessionPrincipal{
		SubjectID:      "user-1",
		SessionID:      "session-1",
		Assurance:      assurance,
		AbsoluteExpiry: now.Add(time.Hour),
		IdleExpiry:     now.Add(time.Hour),
	}
}

func goldenManageFacts(now time.Time) Facts {
	return Facts{
		ActiveUser:                true,
		ActiveSession:             true,
		ActiveWorkspaceMembership: true,
		ActiveProjectMembership:   true,
		ProjectRoles:              []string{"role_manager"},
		Assurance:                 AssuranceAAL2,
		RecentPasswordAt:          now.Add(-time.Minute),
		RecentMFAAt:               now.Add(-time.Minute),
		IdempotencyValid:          true,
	}
}

func TestGoldenG1SessionAllow(t *testing.T) {
	now := goldenNow()
	request := Request{
		Operation: goldenOperation(t, goldenCatalog(t), "op.project.invoke"),
		Principal: goldenSessionPrincipal(now, AssuranceAAL1),
		Scope:     ProjectScope{WorkspaceID: goldenTenant, ProjectID: goldenProject},
		Facts: Facts{
			ActiveUser:                true,
			ActiveSession:             true,
			ActiveWorkspaceMembership: true,
			ActiveProjectMembership:   true,
			ProjectRoles:              []string{"role_caller"},
			Assurance:                 AssuranceAAL1,
			IdempotencyValid:          true,
		},
		Now: now,
	}
	decision := Evaluate(request)
	if !decision.Allowed() || decision.Stage != StageComplete || decision.ReasonCode != ReasonAllowed {
		t.Fatalf("G-1: decision = %+v, want allow", decision)
	}
}

func TestGoldenG2TokenPrincipalAuthMethodDenied(t *testing.T) {
	now := goldenNow()
	request := Request{
		Operation: goldenOperation(t, goldenCatalog(t), "op.project.invoke"),
		Principal: ScopedTokenPrincipal{
			SubjectID: "user-2",
			TokenID:   "token-2",
			Scope:     ProjectScope{WorkspaceID: goldenTenant, ProjectID: goldenProject},
		},
		Scope: ProjectScope{WorkspaceID: goldenTenant, ProjectID: goldenProject},
		Facts: Facts{
			ActiveUser: true, ActiveSession: true,
			ActiveWorkspaceMembership: true, ActiveProjectMembership: true,
			ProjectRoles: []string{"role_caller"}, Assurance: AssuranceAAL1,
			IdempotencyValid: true,
		},
		Now: now,
	}
	decision := Evaluate(request)
	if decision.Allowed() || decision.Stage != StageAuthentication || decision.ReasonCode != ReasonAuthMethodNotAllowed {
		t.Fatalf("G-2: decision = %+v, want deny(authentication, auth_method_not_allowed)", decision)
	}
}

func TestGoldenG3CredentialScopeSubstitutionDenied(t *testing.T) {
	request := Request{
		Operation: goldenOperation(t, goldenCatalog(t), "op.project.token_read"),
		Principal: ScopedTokenPrincipal{
			SubjectID: "user-3",
			TokenID:   "token-3",
			Scope:     ProjectScope{WorkspaceID: goldenTenant, ProjectID: "p2"},
		},
		Scope: ProjectScope{WorkspaceID: goldenTenant, ProjectID: goldenProject},
		Facts: Facts{},
		Now:   goldenNow(),
	}
	decision := Evaluate(request)
	if decision.Allowed() || decision.Stage != StageScope || decision.ReasonCode != ReasonPrincipalScopeMismatch {
		t.Fatalf("G-3: decision = %+v, want deny(scope, principal_scope_mismatch)", decision)
	}
}

func TestGoldenG4ProjectMembershipDenied(t *testing.T) {
	now := goldenNow()
	facts := goldenManageFacts(now)
	facts.ActiveProjectMembership = false
	request := Request{
		Operation: goldenOperation(t, goldenCatalog(t), "op.project.manage"),
		Principal: goldenSessionPrincipal(now, AssuranceAAL2),
		Scope:     ProjectScope{WorkspaceID: goldenTenant, ProjectID: goldenProject},
		Facts:     facts,
		Now:       now,
	}
	decision := Evaluate(request)
	if decision.Allowed() || decision.Stage != StageMembership || decision.ReasonCode != ReasonProjectMembershipInactive {
		t.Fatalf("G-4: decision = %+v, want deny(membership, project_membership_inactive)", decision)
	}
}

func TestGoldenG5ProjectRoleDenied(t *testing.T) {
	now := goldenNow()
	facts := goldenManageFacts(now)
	facts.ProjectRoles = []string{"role_caller"}
	request := Request{
		Operation: goldenOperation(t, goldenCatalog(t), "op.project.manage"),
		Principal: goldenSessionPrincipal(now, AssuranceAAL2),
		Scope:     ProjectScope{WorkspaceID: goldenTenant, ProjectID: goldenProject},
		Facts:     facts,
		Now:       now,
	}
	decision := Evaluate(request)
	if decision.Allowed() || decision.Stage != StageRole || decision.ReasonCode != ReasonProjectRoleNotAllowed {
		t.Fatalf("G-5: decision = %+v, want deny(role, project_role_not_allowed)", decision)
	}
}

func TestGoldenG6PublicOperationAllowsAnonymous(t *testing.T) {
	request := Request{
		Operation: goldenOperation(t, goldenCatalog(t), "op.platform.public"),
		Principal: nil,
		Scope:     PlatformScope{},
		Facts:     Facts{},
		Now:       goldenNow(),
	}
	decision := Evaluate(request)
	if !decision.Allowed() {
		t.Fatalf("G-6: decision = %+v, want allow", decision)
	}
}

func TestGoldenG7PublicOperationRejectsPrincipal(t *testing.T) {
	now := goldenNow()
	request := Request{
		Operation: goldenOperation(t, goldenCatalog(t), "op.platform.public"),
		Principal: goldenSessionPrincipal(now, AssuranceAAL2),
		Scope:     PlatformScope{},
		Facts:     Facts{},
		Now:       now,
	}
	decision := Evaluate(request)
	if decision.Allowed() || decision.Stage != StageAuthentication || decision.ReasonCode != ReasonAuthMethodNotAllowed {
		t.Fatalf("G-7: decision = %+v, want deny(authentication, auth_method_not_allowed)", decision)
	}
}

func assertChallenge(t *testing.T, decision Decision, wantAssurance Assurance, id string) {
	t.Helper()
	if decision.Outcome != OutcomeChallenge {
		t.Fatalf("decision = %+v, want challenge", decision)
	}
	if decision.Challenge == nil {
		t.Fatalf("challenge decision without Challenge payload: %+v", decision)
	}
	if decision.Challenge.TargetOperationID != id {
		t.Errorf("challenge target = %q, want %q", decision.Challenge.TargetOperationID, id)
	}
	if decision.Challenge.RequiredAssurance != wantAssurance {
		t.Errorf("challenge required assurance = %q, want %q", decision.Challenge.RequiredAssurance, wantAssurance)
	}

	if decision.Challenge.MaxAge != 600*time.Second {
		t.Errorf("challenge max-age = %s, want 600s", decision.Challenge.MaxAge)
	}
	if decision.Challenge.MaxAge != RecentAuthWindow {
		t.Errorf("challenge max-age = %s, want recent-auth window %s (同源)", decision.Challenge.MaxAge, RecentAuthWindow)
	}
}

func TestGoldenCH1AssuranceChallenge(t *testing.T) {
	now := goldenNow()
	facts := goldenManageFacts(now)
	facts.Assurance = AssuranceAAL1
	request := Request{
		Operation: goldenOperation(t, goldenCatalog(t), "op.project.manage"),
		Principal: goldenSessionPrincipal(now, AssuranceAAL1),
		Scope:     ProjectScope{WorkspaceID: goldenTenant, ProjectID: goldenProject},
		Facts:     facts,
		Now:       now,
	}
	decision := Evaluate(request)
	assertChallenge(t, decision, AssuranceAAL2, "op.project.manage")
	if decision.ReasonCode != ReasonAssuranceRequired {
		t.Errorf("challenge reason = %q, want %q", decision.ReasonCode, ReasonAssuranceRequired)
	}
}

func TestGoldenCH2RecentAuthChallenge(t *testing.T) {
	now := goldenNow()
	facts := goldenManageFacts(now)
	facts.RecentMFAAt = now.Add(-11 * time.Minute)
	request := Request{
		Operation: goldenOperation(t, goldenCatalog(t), "op.project.manage"),
		Principal: goldenSessionPrincipal(now, AssuranceAAL2),
		Scope:     ProjectScope{WorkspaceID: goldenTenant, ProjectID: goldenProject},
		Facts:     facts,
		Now:       now,
	}
	decision := Evaluate(request)
	assertChallenge(t, decision, AssuranceAAL2, "op.project.manage")
	if decision.ReasonCode != ReasonRecentAuthRequired {
		t.Errorf("challenge reason = %q, want %q", decision.ReasonCode, ReasonRecentAuthRequired)
	}
}

func TestGoldenCH3ChallengeProjectionStable(t *testing.T) {
	now := goldenNow()
	facts := goldenManageFacts(now)
	facts.Assurance = AssuranceAAL1
	decision := Evaluate(Request{
		Operation: goldenOperation(t, goldenCatalog(t), "op.project.manage"),
		Principal: goldenSessionPrincipal(now, AssuranceAAL1),
		Scope:     ProjectScope{WorkspaceID: goldenTenant, ProjectID: goldenProject},
		Facts:     facts,
		Now:       now,
	})
	err := decision.Err()
	if err == nil {
		t.Fatal("challenge decision projected to nil error")
	}
	if !errors.Is(err, ErrReauthenticationRequired) {
		t.Fatalf("errors.Is(err, ErrReauthenticationRequired) = false: %v", err)
	}

	if errors.Is(err, ErrDenied) {
		t.Fatalf("challenge downgraded to permission-class denial: %v", err)
	}
	var denial *DenialError
	if !errors.As(err, &denial) {
		t.Fatalf("projection is not a *DenialError: %T", err)
	}
	if denial.Code != DenialCodeReauthRequired {
		t.Errorf("stable code = %q, want %q", denial.Code, DenialCodeReauthRequired)
	}
	if denial.ReauthHint == nil ||
		denial.ReauthHint.TargetOperationID != "op.project.manage" ||
		denial.ReauthHint.RequiredAssurance != AssuranceAAL2 ||
		denial.ReauthHint.MaxAge != 600*time.Second {
		t.Errorf("reauth hint payload incomplete: %+v", denial.ReauthHint)
	}

	denyDecision := Evaluate(Request{
		Operation: goldenOperation(t, goldenCatalog(t), "op.project.manage"),
		Principal: goldenSessionPrincipal(now, AssuranceAAL2),
		Scope:     ProjectScope{WorkspaceID: goldenTenant, ProjectID: goldenProject},
		Facts:     Facts{},
		Now:       now,
	})
	denyErr := denyDecision.Err()
	if !errors.Is(denyErr, ErrDenied) {
		t.Fatalf("plain deny is not permission-class: %v", denyErr)
	}
	if errors.Is(denyErr, ErrReauthenticationRequired) {
		t.Fatalf("plain deny misclassified as reauth-class: %v", denyErr)
	}
}

func TestGoldenCH4ChallengeAssuranceDowngradeRule(t *testing.T) {
	now := goldenNow()
	catalog := goldenCatalog(t)

	facts := Facts{
		ActiveUser: true, ActiveSession: true,
		ActiveWorkspaceMembership: true, ActiveProjectMembership: true,
		ProjectRoles: []string{"role_caller"},
		Assurance:    AssuranceAAL1,
	}
	decision := Evaluate(Request{
		Operation: goldenOperation(t, catalog, "op.project.password_recent"),
		Principal: goldenSessionPrincipal(now, AssuranceAAL1),
		Scope:     ProjectScope{WorkspaceID: goldenTenant, ProjectID: goldenProject},
		Facts:     facts,
		Now:       now,
	})
	assertChallenge(t, decision, AssuranceAAL1, "op.project.password_recent")

	fresh := facts
	fresh.RecentPasswordAt = now.Add(-time.Minute)
	if decision := Evaluate(Request{
		Operation: goldenOperation(t, catalog, "op.project.password_recent"),
		Principal: goldenSessionPrincipal(now, AssuranceAAL1),
		Scope:     ProjectScope{WorkspaceID: goldenTenant, ProjectID: goldenProject},
		Facts:     fresh,
		Now:       now,
	}); !decision.Allowed() {
		t.Fatalf("password_recent with fresh password denied: %+v", decision)
	}

	manageFacts := goldenManageFacts(now)
	manageFacts.Assurance = AssuranceAAL1
	decision = Evaluate(Request{
		Operation: goldenOperation(t, catalog, "op.project.manage"),
		Principal: goldenSessionPrincipal(now, AssuranceAAL1),
		Scope:     ProjectScope{WorkspaceID: goldenTenant, ProjectID: goldenProject},
		Facts:     manageFacts,
		Now:       now,
	})
	assertChallenge(t, decision, AssuranceAAL2, "op.project.manage")
}

func TestGoldenCH5RecentAuthWindowSemantics(t *testing.T) {
	now := goldenNow()
	catalog := goldenCatalog(t)
	passwordOp := goldenOperation(t, catalog, "op.project.password_recent")
	baseFacts := Facts{
		ActiveUser: true, ActiveSession: true,
		ActiveWorkspaceMembership: true, ActiveProjectMembership: true,
		ProjectRoles: []string{"role_caller"},
		Assurance:    AssuranceAAL1,
	}
	cases := []struct {
		name     string
		at       time.Time
		wantPass bool
	}{
		{"zero timestamp", time.Time{}, false},
		{"future timestamp", now.Add(time.Minute), false},
		{"outside window (601s)", now.Add(-601 * time.Second), false},
		{"window edge (600s, in-window)", now.Add(-600 * time.Second), true},
		{"inside window (30s)", now.Add(-30 * time.Second), true},
		{"now itself", now, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			facts := baseFacts
			facts.RecentPasswordAt = c.at
			decision := Evaluate(Request{
				Operation: passwordOp,
				Principal: goldenSessionPrincipal(now, AssuranceAAL1),
				Scope:     ProjectScope{WorkspaceID: goldenTenant, ProjectID: goldenProject},
				Facts:     facts,
				Now:       now,
			})
			if c.wantPass {
				if !decision.Allowed() {
					t.Fatalf("recent-auth should pass: %+v", decision)
				}
				return
			}
			assertChallenge(t, decision, AssuranceAAL1, "op.project.password_recent")
			if decision.ReasonCode != ReasonRecentAuthRequired {
				t.Errorf("challenge reason = %q, want %q", decision.ReasonCode, ReasonRecentAuthRequired)
			}
		})
	}

	manageOp := goldenOperation(t, catalog, "op.project.manage")
	for name, mfaAt := range map[string]time.Time{
		"mfa zero":      time.Time{},
		"mfa 11m stale": now.Add(-11 * time.Minute),
	} {
		facts := goldenManageFacts(now)
		facts.RecentMFAAt = mfaAt
		decision := Evaluate(Request{
			Operation: manageOp,
			Principal: goldenSessionPrincipal(now, AssuranceAAL2),
			Scope:     ProjectScope{WorkspaceID: goldenTenant, ProjectID: goldenProject},
			Facts:     facts,
			Now:       now,
		})
		if decision.Outcome != OutcomeChallenge {
			t.Errorf("%s: decision = %+v, want challenge", name, decision)
		}
	}
}
