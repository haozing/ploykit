package authorization

import "time"

var builtinRules = []Rule{builtinAssuranceRule{}, builtinRecentAuthRule{}}

type builtinAssuranceRule struct{}

func (builtinAssuranceRule) RuleName() string { return RuleNameAssurance }
func (builtinAssuranceRule) Stage() Stage     { return StageAuthentication }
func (builtinAssuranceRule) Evaluate(req Request) (Decision, bool) {
	if req.Operation.Assurance != AssuranceAAL2 || req.Facts.Assurance == AssuranceAAL2 {
		return Decision{}, false
	}
	decision := NewChallenge(req.Operation)
	decision.ReasonCode = ReasonAssuranceRequired
	return decision, true
}

type builtinRecentAuthRule struct{}

func (builtinRecentAuthRule) RuleName() string { return RuleNameRecentAuth }
func (builtinRecentAuthRule) Stage() Stage     { return StageAuthentication }
func (builtinRecentAuthRule) Evaluate(req Request) (Decision, bool) {
	recent := func(at time.Time) bool {
		return !at.IsZero() && !at.After(req.Now) && !at.Before(req.Now.Add(-RecentAuthWindow))
	}
	insufficient := true
	switch req.Operation.RecentAuth {
	case RecentAuthNone:
		return Decision{}, false
	case RecentAuthPassword:
		insufficient = !recent(req.Facts.RecentPasswordAt)
	case RecentAuthPasswordAndMFA:
		insufficient = !recent(req.Facts.RecentPasswordAt) || !recent(req.Facts.RecentMFAAt)
	default:

		insufficient = true
	}
	if !insufficient {
		return Decision{}, false
	}
	decision := NewChallenge(req.Operation)
	decision.ReasonCode = ReasonRecentAuthRequired
	return decision, true
}

func NewChallenge(op Operation) Decision {
	required := AssuranceAAL2
	if op.RecentAuth == RecentAuthPassword && op.Assurance == AssuranceAAL1 {
		required = AssuranceAAL1
	}
	return Decision{
		Outcome: OutcomeChallenge,
		Stage:   StageAuthentication,
		Challenge: &Challenge{
			TargetOperationID: op.OperationID,
			RequiredAssurance: required,
			MaxAge:            RecentAuthWindow,
		},
	}
}
