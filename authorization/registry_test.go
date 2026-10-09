package authorization

import (
	"strings"
	"testing"
)

func TestNewRegistrySeedsBuiltinRules(t *testing.T) {
	registry := NewRegistry()
	if names := registry.RuleNames(); len(names) != 2 ||
		names[0] != RuleNameAssurance || names[1] != RuleNameRecentAuth {
		t.Fatalf("builtin rules = %v, want [assurance recent_auth]", names)
	}
	for _, name := range []string{RuleNameAssurance, RuleNameRecentAuth} {
		rule, ok := registry.Rule(name)
		if !ok || rule.Stage() != StageAuthentication {
			t.Fatalf("builtin %q missing or wrong stage: %+v", name, rule)
		}
		if !registry.IsBuiltin(name) {
			t.Fatalf("IsBuiltin(%q) = false", name)
		}
	}
	if registry.IsBuiltin("maintenance_mode") {
		t.Fatal("IsBuiltin on product name = true")
	}
}

func TestRegistryRegisterValidation(t *testing.T) {
	stageRule := func(name string, stage Stage) Rule { return stubRule{name: name, stage: stage} }
	tests := []struct {
		name    string
		prepare func(*Registry) error
		message string
	}{
		{"nil rule", func(r *Registry) error { return r.Register(nil) }, "nil"},
		{"empty name", func(r *Registry) error { return r.Register(stageRule("", StagePolicy)) }, "empty name"},
		{"wildcard name", func(r *Registry) error { return r.Register(stageRule("op.*", StagePolicy)) }, "wildcard"},
		{"whitespace name", func(r *Registry) error { return r.Register(stageRule("my rule", StagePolicy)) }, "wildcard"},
		{"reserved builtin name", func(r *Registry) error { return r.Register(stageRule(RuleNameAssurance, StagePolicy)) }, "reserved builtin"},
		{"invalid stage", func(r *Registry) error { return r.Register(stageRule("late", StageComplete)) }, "invalid stage"},
		{"duplicate rule", func(r *Registry) error {
			if err := r.Register(stageRule("twice", StagePolicy)); err != nil {
				t.Fatal(err)
			}
			return r.Register(stageRule("twice", StageRole))
		}, "duplicate rule"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := test.prepare(NewRegistry())
			if err == nil || !strings.Contains(err.Error(), test.message) {
				t.Fatalf("err = %v, want containing %q", err, test.message)
			}
		})
	}

	registry := NewRegistry()
	for name, stage := range map[string]Stage{
		"auth_rule": StageAuthentication, "scope_rule": StageScope, "member_rule": StageMembership,
		"role_rule": StageRole, "policy_rule": StagePolicy, "input_rule": StageInput,
	} {
		if err := registry.Register(stubRule{name: name, stage: stage}); err != nil {
			t.Fatalf("Register(%s): %v", name, err)
		}
	}
	if got := len(registry.RuleNames()); got != 8 {
		t.Fatalf("rule count = %d, want 8", got)
	}
}

func TestRegistryFactKeyClosure(t *testing.T) {
	registry := NewRegistry()
	if err := registry.RegisterFact("maintenance"); err != nil {
		t.Fatal(err)
	}
	if err := registry.RegisterFact("maintenance"); err == nil || !strings.Contains(err.Error(), "duplicate") {
		t.Fatalf("duplicate fact accepted: %v", err)
	}
	if err := registry.RegisterFact(""); err == nil {
		t.Fatal("empty fact key accepted")
	}
	if err := registry.RegisterFact("wild * key"); err == nil {
		t.Fatal("wildcard fact key accepted")
	}
	if names := registry.FactNames(); len(names) != 1 || names[0] != "maintenance" {
		t.Fatalf("fact names = %v", names)
	}

	if err := registry.ValidateFacts(Facts{Product: map[string]any{"maintenance": true}}); err != nil {
		t.Fatalf("declared key rejected: %v", err)
	}
	if err := registry.ValidateFacts(Facts{Product: map[string]any{"other": true}}); err == nil {
		t.Fatal("undeclared key accepted")
	}
	if err := registry.ValidateFacts(Facts{}); err != nil {
		t.Fatalf("empty facts rejected: %v", err)
	}
}

func TestRegistryResolve(t *testing.T) {
	registry := NewRegistry()
	if err := registry.Register(maintenanceRule{}); err != nil {
		t.Fatal(err)
	}
	if rules, err := registry.Resolve(nil); err != nil || rules != nil {
		t.Fatalf("Resolve(nil) = %+v, %v", rules, err)
	}
	if rules, err := registry.Resolve([]string{"maintenance_mode"}); err != nil || len(rules) != 1 {
		t.Fatalf("Resolve = %+v, %v", rules, err)
	}
	if _, err := registry.Resolve([]string{"assurance"}); err == nil || !strings.Contains(err.Error(), "builtin") {
		t.Fatalf("Resolve builtin = %v, want builtin rejection", err)
	}
	if _, err := registry.Resolve([]string{"not_registered"}); err == nil {
		t.Fatal("Resolve unknown accepted")
	}
}

type stubRule struct {
	name  string
	stage Stage
}

func (r stubRule) RuleName() string                  { return r.name }
func (r stubRule) Stage() Stage                      { return r.stage }
func (r stubRule) Evaluate(Request) (Decision, bool) { return Decision{}, false }
