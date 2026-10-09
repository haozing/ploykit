package authorization

import (
	"context"
	"errors"
	"strings"
	"testing"
)

type txKey struct{}

type recordingProvider struct {
	calls  int
	gotCtx context.Context
	facts  Facts
	err    error
}

func (p *recordingProvider) Facts(ctx context.Context, principal Principal, scope Scope) (Facts, error) {
	p.calls++
	p.gotCtx = ctx
	return p.facts, p.err
}

func txAwareEvaluator(t *testing.T, provider FactsProvider) *Evaluator {
	t.Helper()
	catalog := goldenCatalog(t)
	evaluator, err := NewEvaluator(catalog, NewRegistry(), provider)
	if err != nil {
		t.Fatalf("NewEvaluator: %v", err)
	}
	return evaluator
}

func TestEvaluatorAuthorizesWithinCallerContext(t *testing.T) {
	now := goldenNow()
	provider := &recordingProvider{facts: Facts{
		ActiveUser: true, ActiveSession: true,
		ActiveWorkspaceMembership: true, ActiveProjectMembership: true,
		ProjectRoles: []string{"role_caller"}, Assurance: AssuranceAAL1,
		IdempotencyValid: true,
	}}
	evaluator := txAwareEvaluator(t, provider)

	ctx := context.WithValue(context.Background(), txKey{}, "caller-tx-handle")
	decision, err := evaluator.Authorize(ctx, "op.project.invoke",
		goldenSessionPrincipal(now, AssuranceAAL1),
		ProjectScope{WorkspaceID: "t1", ProjectID: "p1"}, now)
	if err != nil {
		t.Fatalf("Authorize: %v", err)
	}
	if !decision.Allowed() {
		t.Fatalf("decision = %+v, want allow", decision)
	}
	if provider.calls != 1 {
		t.Fatalf("provider calls = %d, want 1", provider.calls)
	}
	if got, _ := provider.gotCtx.Value(txKey{}).(string); got != "caller-tx-handle" {
		t.Fatalf("provider ctx did not carry caller transaction: %v", provider.gotCtx)
	}
}

func TestEvaluatorFailsClosedOnUnknownOperation(t *testing.T) {
	provider := &recordingProvider{}
	evaluator := txAwareEvaluator(t, provider)
	decision, err := evaluator.Authorize(context.Background(), "op.nope", nil, PlatformScope{}, goldenNow())
	if err != nil {
		t.Fatalf("Authorize: %v", err)
	}
	if decision.Allowed() || decision.Stage != StagePolicy || decision.ReasonCode != ReasonUnknownOperationOrScope {
		t.Fatalf("decision = %+v, want deny(policy, unknown_operation_or_scope)", decision)
	}
	if provider.calls != 0 {
		t.Fatalf("provider called %d times for unknown operation, want 0", provider.calls)
	}
}

func TestEvaluatorProviderErrorPropagates(t *testing.T) {
	provider := &recordingProvider{err: errors.New("tx aborted")}
	evaluator := txAwareEvaluator(t, provider)
	decision, err := evaluator.Authorize(context.Background(), "op.project.invoke",
		goldenSessionPrincipal(goldenNow(), AssuranceAAL1),
		ProjectScope{WorkspaceID: "t1", ProjectID: "p1"}, goldenNow())
	if err == nil {
		t.Fatalf("Authorize succeeded despite provider error: %+v", decision)
	}
	if decision.Allowed() {
		t.Fatal("provider error must not produce an allow decision")
	}
}

func TestEvaluatorDoesNotCacheFacts(t *testing.T) {
	now := goldenNow()
	provider := &recordingProvider{facts: Facts{
		ActiveUser: true, ActiveSession: true,
		ActiveWorkspaceMembership: true, ActiveProjectMembership: true,
		ProjectRoles: []string{"role_caller"}, Assurance: AssuranceAAL1,
		IdempotencyValid: true,
	}}
	evaluator := txAwareEvaluator(t, provider)
	scope := ProjectScope{WorkspaceID: "t1", ProjectID: "p1"}
	principal := goldenSessionPrincipal(now, AssuranceAAL1)
	for i := 0; i < 3; i++ {
		decision, err := evaluator.Authorize(context.Background(), "op.project.invoke", principal, scope, now)
		if err != nil || !decision.Allowed() {
			t.Fatalf("Authorize #%d = %+v, %v", i, decision, err)
		}
	}
	if provider.calls != 3 {
		t.Fatalf("provider calls = %d, want 3（无缓存：每次评估都取事实）", provider.calls)
	}
}

func TestEvaluatorValidatesFactKeyClosure(t *testing.T) {
	provider := &recordingProvider{facts: Facts{Product: map[string]any{"undeclared": true}}}
	evaluator := txAwareEvaluator(t, provider)
	if names := evaluator.Registry().FactNames(); len(names) != 0 {
		t.Fatalf("empty registry should declare no fact keys, got %v", names)
	}
	_, err := evaluator.Authorize(context.Background(), "op.project.invoke",
		goldenSessionPrincipal(goldenNow(), AssuranceAAL1),
		ProjectScope{WorkspaceID: "t1", ProjectID: "p1"}, goldenNow())
	if err == nil || !strings.Contains(err.Error(), "undeclared") && !strings.Contains(err.Error(), "not registered") {
		t.Fatalf("undeclared fact key accepted: %v", err)
	}
}

func TestNewEvaluatorRejectsInvalidInputs(t *testing.T) {
	if _, err := NewEvaluator(goldenCatalog(t), NewRegistry(), nil); err == nil {
		t.Fatal("nil provider accepted")
	}
	registry := NewRegistry()
	if err := registry.Register(maintenanceRule{}); err != nil {
		t.Fatal(err)
	}
	raw := "catalog_schema_version: 1\nroles:\n  project: [role_caller]\noperations:\n  - operation_id: op.project.read\n    auth_method: scoped_token\n    scope: project_credential\n    allowed_project_roles: [role_caller]\n    rules: [maintenance_mode]\n"
	catalog, err := ParseCatalog([]byte(raw), registry)
	if err != nil {
		t.Fatalf("ParseCatalog with registered rule: %v", err)
	}
	if _, err := NewEvaluator(catalog, NewRegistry(), &recordingProvider{}); err == nil {
		t.Fatal("catalog with unregistered rule reference accepted by NewEvaluator")
	}
}
