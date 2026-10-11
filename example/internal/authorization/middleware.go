package authorization

import (
	"context"
	"net/http"
	"time"

	"github.com/haozing/ploykit/authorization"
	"github.com/haozing/ploykit/platform/webx"
)

// sessionFactsProvider is what the gate needs from the data layer: facts and
// the evaluator-facing session principal, both read through the caller's
// transaction (see TxFactsProvider).
type sessionFactsProvider interface {
	authorization.FactsProvider
	SessionPrincipal(ctx context.Context, wp *webx.Principal) (authorization.SessionPrincipal, bool, error)
}

// transportKindFor is the composition-root mapping ADR 0013 batch 3 names:
// the catalog's auth_method → the webx transport kind. Five lines on purpose
// — webx stays neutral (no authorization/ import), the catalog stays the
// policy source.
func transportKindFor(m authorization.AuthMethod) webx.TransportKind {
	switch m {
	case authorization.AuthMethodSession:
		return webx.TransportSessionCookie
	case authorization.AuthMethodScopedToken, authorization.AuthMethodMachineCredential:
		return webx.TransportBearer
	default:
		return webx.TransportNone
	}
}

// Middleware returns the strong-profile gate for example's protected
// operations (workspace delete / transfer ownership — the pair ADR 0005
// names; token.create — the AAL2-grade op ADR 0013 batch 2 adds).
// Composition, in order:
//
//  1. route resolution — method+path → operation ID, fail-closed on unknown
//     shapes (the closed-set discipline, enforced at the composition root);
//  2. transport matching — the request's transport (one classification, the
//     same one Authenticate resolves credentials through) must match the
//     operation's declared auth_method; mixed transports are rejected with
//     401 E_AUTH_TRANSPORT_CONFLICT before anything else opines;
//  3. in-transaction evaluation — facts and decision read through one
//     pgx.Tx (TxFactsProvider), and the handler runs inside that same
//     transaction so ctx-tx-aware repos share the authorized data state;
//  4. decision projection — allow passes, deny becomes a 403
//     PERMISSION_DENIED envelope carrying stage+reason, challenge becomes
//     403 E_REAUTH_REQUIRED with the target-operation hint, glued onto the
//     existing webx reauthentication flow (POST /auth/confirm-password or
//     POST /auth/verify-mfa → retry).
//
// ADR 0011's composition order is preserved in computed form: when the
// evaluator's freshness rules answer "challenge" but a terminal stage
// (membership / role) would deny anyway, the terminal denial wins — a
// role-denied principal is never coaxed through reauthentication for an
// action they can never perform (composition-order pin in strong_test.go).
// The permission check stays outermost in the route assembly
// (workspace.Deps.destructive), so simple-profile role denials terminate
// before this middleware runs.
func (s *Strong) Middleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			opID, wsID, ok := s.resolver.Resolve(r.Method, r.URL.Path)
			if !ok {
				s.projectDeny(w, r, nil, authorization.StagePolicy,
					authorization.ReasonUnknownOperationOrScope)
				return
			}
			// transport match against the catalog's declared auth_method
			op, declared := s.eval.Catalog().Operation(opID)
			if !declared { // unreachable while resolver.Bind holds; fail closed
				s.projectDeny(w, r, nil, authorization.StagePolicy,
					authorization.ReasonUnknownOperationOrScope)
				return
			}
			kind := s.cfg.ClassifyTransport(r)
			switch {
			case kind == webx.TransportMixed:
				s.log.Warn("strong-profile mixed transport rejected", "op", opID,
					"path", r.URL.Path)
				webx.WriteError(w, http.StatusUnauthorized, webx.CodeAuthTransportConflict,
					"request carries multiple authentication credentials; send exactly one", nil)
				return
			case kind == webx.TransportNone:
				webx.ErrUnauthenticated(w, "authentication required")
				return
			case kind != transportKindFor(op.AuthMethod):
				// authenticated on a transport the operation does not accept
				// (e.g. a bearer credential on a session-only operation) —
				// terminal, never a challenge
				s.projectDeny(w, r, webx.PrincipalFromRequest(r),
					authorization.StageAuthentication,
					authorization.ReasonAuthMethodNotAllowed)
				return
			}
			p := webx.PrincipalFromRequest(r)
			if p == nil {
				// a credential-shaped request whose credential did not
				// resolve (expired/revoked session cookie)
				webx.ErrUnauthenticated(w, "authentication required")
				return
			}

			err := s.db.Within(r.Context(), func(ctx context.Context) error {
				principal, alive, err := s.provider.SessionPrincipal(ctx, p)
				if err != nil {
					return err
				}
				scope := authorization.WorkspaceScope{WorkspaceID: wsID}
				if !alive {
					s.projectDeny(w, r, p, authorization.StageAuthentication,
						authorization.ReasonSessionInactive)
					return nil
				}
				facts, err := s.provider.Facts(ctx, principal, scope)
				if err != nil {
					return err
				}
				now := s.now()
				decision, err := s.evaluate(opID, principal, scope, facts, now)
				if err != nil {
					return err
				}
				if decision.Outcome == authorization.OutcomeChallenge {
					// Terminal check before projecting the challenge: a
					// membership/role denial behind the freshness challenge
					// is the real answer (ADR 0011 composition order).
					terminal, err := s.evaluate(opID, principal, scope,
						forcedFreshFacts(facts, now), now)
					if err != nil {
						return err
					}
					if terminal.Outcome == authorization.OutcomeDeny {
						decision = terminal
					}
				}
				switch decision.Outcome {
				case authorization.OutcomeAllow:
					next.ServeHTTP(w, r.WithContext(ctx))
				case authorization.OutcomeChallenge:
					s.projectChallenge(w, r, p, decision)
				default:
					s.projectDeny(w, r, p, decision.Stage, decision.ReasonCode)
				}
				return nil
			})
			if err != nil {
				s.log.Error("strong-profile authorization failed", "op", opID,
					"user", p.UserID, "err", err)
				webx.ErrInternal(w)
			}
		})
	}
}

// evaluate runs one catalog evaluation against the given facts. Facts are
// loaded by the caller so the challenge-path terminal re-check can reuse the
// same snapshot with freshness forced (forcedFreshFacts).
func (s *Strong) evaluate(opID string, principal authorization.Principal, scope authorization.Scope, facts authorization.Facts, now time.Time) (authorization.Decision, error) {
	op, ok := s.eval.Catalog().Operation(opID)
	if !ok {
		// Unreachable while resolver.Bind holds (every route names a catalog
		// operation); kept fail-closed anyway.
		return authorization.Decision{Outcome: authorization.OutcomeDeny,
			Stage: authorization.StagePolicy, ReasonCode: authorization.ReasonUnknownOperationOrScope}, nil
	}
	rules, err := s.eval.Registry().Resolve(op.Rules)
	if err != nil {
		return authorization.Decision{}, err
	}
	return authorization.Evaluate(authorization.Request{
		Operation: op,
		Principal: principal,
		Scope:     scope,
		Facts:     facts,
		Now:       now,
		Rules:     rules,
	}), nil
}

// forcedFreshFacts copies facts with every freshness stamp satisfied, so the
// terminal re-check can see what the remaining stages (scope / membership /
// role / policy / input) say on their own. Product rules see the
// forced-fresh facts on this pass — example ships an empty product registry;
// products with policy-stage rules should re-check this helper when adopting
// the strong profile.
func forcedFreshFacts(facts authorization.Facts, now time.Time) authorization.Facts {
	facts.Assurance = authorization.AssuranceAAL2
	facts.RecentPasswordAt = now
	facts.RecentMFAAt = now
	return facts
}

func (s *Strong) projectChallenge(w http.ResponseWriter, r *http.Request, p *webx.Principal, decision authorization.Decision) {
	if decision.Challenge == nil {
		webx.ErrInternal(w)
		return
	}
	s.log.Warn("strong-profile challenge", "op", decision.Challenge.TargetOperationID,
		"user", p.UserID, "path", r.URL.Path,
		"required_assurance", decision.Challenge.RequiredAssurance)
	// factor hint follows the required assurance: aal1 challenges clear with
	// a password confirmation, aal2 with an MFA proof (POST /auth/verify-mfa).
	// A password_and_mfa op with BOTH stamps stale challenges twice — the
	// first retry surfaces the remaining one.
	factor := webx.FactorPassword
	if decision.Challenge.RequiredAssurance == authorization.AssuranceAAL2 {
		factor = webx.FactorMFA
	}
	webx.WriteError(w, http.StatusForbidden, webx.CodeReauthRequired,
		"reauthentication required", map[string]any{
			"target_operation":   decision.Challenge.TargetOperationID,
			"required_assurance": string(decision.Challenge.RequiredAssurance),
			"max_age_seconds":    int(decision.Challenge.MaxAge.Seconds()),
			"factor":             string(factor),
		})
}

func (s *Strong) projectDeny(w http.ResponseWriter, r *http.Request, p *webx.Principal, stage authorization.Stage, reason string) {
	var subject string
	if p != nil {
		subject = p.UserID
	}
	s.log.Warn("strong-profile denial", "user", subject, "path", r.URL.Path,
		"stage", stage, "reason", reason)
	webx.WriteError(w, http.StatusForbidden, authorization.DenialCodePermissionDenied,
		"permission denied", map[string]any{
			"stage":  string(stage),
			"reason": reason,
		})
}
