package authorization

import (
	"context"
	"errors"
	"fmt"
	"time"
)

type Facts struct {
	ActiveUser            bool
	ActiveSession         bool
	CredentialGrantActive bool

	ActiveWorkspaceMembership bool
	ActiveProjectMembership   bool

	WorkspaceRoles []string
	ProjectRoles   []string

	Assurance        Assurance
	RecentPasswordAt time.Time
	RecentMFAAt      time.Time

	IdempotencyValid bool

	Product map[string]any
}

type FactsProvider interface {
	Facts(ctx context.Context, principal Principal, scope Scope) (Facts, error)
}

type Evaluator struct {
	catalog  Catalog
	registry *Registry
	provider FactsProvider
}

func NewEvaluator(catalog Catalog, registry *Registry, provider FactsProvider) (*Evaluator, error) {
	if registry == nil {
		registry = NewRegistry()
	}
	if provider == nil {
		return nil, errors.New("authorization: facts provider is required")
	}
	if err := catalog.Validate(registry); err != nil {
		return nil, err
	}
	return &Evaluator{catalog: catalog, registry: registry, provider: provider}, nil
}

func (e *Evaluator) Catalog() Catalog { return e.catalog }

func (e *Evaluator) Registry() *Registry { return e.registry }

func (e *Evaluator) Authorize(ctx context.Context, operationID string, principal Principal, scope Scope, now time.Time) (Decision, error) {
	operation, ok := e.catalog.Operation(operationID)
	if !ok {
		return deny(StagePolicy, ReasonUnknownOperationOrScope), nil
	}
	facts, err := e.provider.Facts(ctx, principal, scope)
	if err != nil {
		return Decision{}, fmt.Errorf("authorization: load facts for %q: %w", operationID, err)
	}
	if err := e.registry.ValidateFacts(facts); err != nil {
		return Decision{}, err
	}
	rules, err := e.registry.Resolve(operation.Rules)
	if err != nil {
		return Decision{}, err
	}
	return Evaluate(Request{
		Operation: operation,
		Principal: principal,
		Scope:     scope,
		Facts:     facts,
		Now:       now,
		Rules:     rules,
	}), nil
}
