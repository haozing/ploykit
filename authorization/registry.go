package authorization

import (
	"errors"
	"fmt"
	"slices"
	"sync"
)

const (
	RuleNameAssurance  = "assurance"
	RuleNameRecentAuth = "recent_auth"
)

type Rule interface {
	RuleName() string

	Stage() Stage

	Evaluate(Request) (Decision, bool)
}

type Registry struct {
	mu    sync.RWMutex
	rules map[string]Rule
	facts map[string]struct{}
}

func NewRegistry() *Registry {
	return &Registry{
		rules: map[string]Rule{
			RuleNameAssurance:  builtinAssuranceRule{},
			RuleNameRecentAuth: builtinRecentAuthRule{},
		},
		facts: map[string]struct{}{},
	}
}

func (r *Registry) Register(rule Rule) error {
	if rule == nil {
		return errors.New("authorization: register rule: rule is nil")
	}
	name := rule.RuleName()
	if err := validateClosedName("register rule", name); err != nil {
		return err
	}
	if !stageValid(rule.Stage()) {
		return fmt.Errorf("authorization: register rule %q: invalid stage %q", name, rule.Stage())
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.IsBuiltin(name) {
		return fmt.Errorf("authorization: register rule: %q is a reserved builtin rule name", name)
	}
	if _, duplicate := r.rules[name]; duplicate {
		return fmt.Errorf("authorization: register rule: duplicate rule %q", name)
	}
	r.rules[name] = rule
	return nil
}

func (r *Registry) RegisterFact(name string) error {
	if err := validateClosedName("register fact", name); err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, duplicate := r.facts[name]; duplicate {
		return fmt.Errorf("authorization: register fact: duplicate fact %q", name)
	}
	r.facts[name] = struct{}{}
	return nil
}

func (r *Registry) Rule(name string) (Rule, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	rule, ok := r.rules[name]
	return rule, ok
}

func (r *Registry) RuleNames() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	names := make([]string, 0, len(r.rules))
	for name := range r.rules {
		names = append(names, name)
	}
	slices.Sort(names)
	return names
}

func (r *Registry) FactNames() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	names := make([]string, 0, len(r.facts))
	for name := range r.facts {
		names = append(names, name)
	}
	slices.Sort(names)
	return names
}

func (r *Registry) IsBuiltin(name string) bool {
	return name == RuleNameAssurance || name == RuleNameRecentAuth
}

func (r *Registry) Resolve(names []string) ([]Rule, error) {
	if len(names) == 0 {
		return nil, nil
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	resolved := make([]Rule, 0, len(names))
	for _, name := range names {
		if r.IsBuiltin(name) {
			return nil, fmt.Errorf("authorization: resolve rules: %q is a builtin rule (referenced implicitly)", name)
		}
		rule, ok := r.rules[name]
		if !ok {
			return nil, fmt.Errorf("authorization: resolve rules: %q is not registered", name)
		}
		resolved = append(resolved, rule)
	}
	return resolved, nil
}

func (r *Registry) ValidateFacts(facts Facts) error {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for key := range facts.Product {
		if _, ok := r.facts[key]; !ok {
			return fmt.Errorf("authorization: fact key %q is not registered", key)
		}
	}
	return nil
}

func stageValid(stage Stage) bool {
	switch stage {
	case StageAuthentication, StageScope, StageMembership, StageRole, StagePolicy, StageInput:
		return true
	default:
		return false
	}
}
