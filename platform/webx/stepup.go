package webx

import (
	"net/http"
	"time"
)

// RequireRecentAuth guards sensitive operations behind a fresh password
// confirmation (step-up / sudo mode, the Laravel password.confirm /
// GitHub sudo-mode pattern). Mount it after Authenticate. Only interactive
// sessions pass: a session whose PasswordConfirmedAt is older than maxAge —
// or never set — fails with the two-phase reauthentication protocol
// (403 E_REAUTH_REQUIRED + details.max_age_seconds): the client re-verifies
// the password via POST /auth/confirm-password and retries the original
// request (docs/api-conventions.md §step-up). Machine callers (PAT / system)
// can never satisfy step-up and get a plain 403 — they cannot reauthenticate
// interactively, so a scoped PAT must not reach actions reserved for a
// present human.
//
// The window is a product policy decision (GitHub uses 2h, Laravel 3h
// defaults): pick it per mount site, there is deliberately no package default.
//
// This is the static, route-level policy path. authorization/'s Challenge
// outcome covers the computed, catalog-driven escalation for strong-profile
// consumers — do not mount both on the same operation (see the step-up
// section of authorization/README.md).
func RequireRecentAuth(maxAge time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p := PrincipalFromRequest(r)
			if p == nil {
				ErrUnauthenticated(w, "authentication required")
				return
			}
			if p.Source != SourceSession {
				ErrForbidden(w, "step-up requires an interactive session")
				return
			}
			if !p.PasswordConfirmedWithin(maxAge, time.Now()) {
				ErrReauthRequired(w, maxAge, p.PasswordConfirmedAt)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// ErrReauthRequired writes the step-up challenge: RFC 9470's
// insufficient_user_authentication semantics adapted to ploykit's cookie +
// error-envelope shape. 403 (not 401): the caller IS authenticated, only the
// assurance is stale, and a 401 would wrongly steer SPAs to full re-login.
func ErrReauthRequired(w http.ResponseWriter, maxAge time.Duration, confirmedAt time.Time) {
	ErrReauthRequiredFactor(w, maxAge, confirmedAt, FactorPassword)
}

// Factor names the stale step-up fact, so clients know which confirmation
// endpoint clears the challenge (confirm-password vs verify-mfa).
type Factor string

const (
	FactorPassword Factor = "password"
	FactorMFA      Factor = "mfa"
)

// ErrReauthRequiredFactor is ErrReauthRequired with the stale factor named in
// the details: same 403 E_REAUTH_REQUIRED envelope, details.factor tells the
// client which proof to present.
func ErrReauthRequiredFactor(w http.ResponseWriter, maxAge time.Duration, confirmedAt time.Time, factor Factor) {
	details := map[string]any{
		"max_age_seconds": int(maxAge.Seconds()),
		"factor":          string(factor),
	}
	if !confirmedAt.IsZero() {
		details["confirmed_at"] = confirmedAt.UTC().Format(time.RFC3339)
	}
	WriteError(w, http.StatusForbidden, CodeReauthRequired, "step-up authentication required", details)
}

// RequireRecentMFA is RequireRecentAuth's second-factor twin: it guards
// AAL2-grade operations behind a fresh MFA proof (TOTP / backup code via
// POST /auth/verify-mfa). Mount it after Authenticate. Only interactive
// sessions pass: a session whose MFAConfirmedAt is older than maxAge — or
// never set — fails with the two-phase challenge (403 E_REAUTH_REQUIRED +
// details.max_age_seconds + details.factor="mfa"); machine callers (PAT /
// system) get a plain 403 — they can never complete an interactive MFA
// proof (ADR 0011 semantics extended to MFA, ADR 0013 batch 2).
//
// The window is product policy — pick it per mount site, there is no package
// default. This is the static road; the computed, catalog-driven form is
// authorization/'s recent_auth: password_and_mfa — do not mount both on the
// same operation.
func RequireRecentMFA(maxAge time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p := PrincipalFromRequest(r)
			if p == nil {
				ErrUnauthenticated(w, "authentication required")
				return
			}
			if p.Source != SourceSession {
				ErrForbidden(w, "step-up requires an interactive session")
				return
			}
			if !p.MFAConfirmedWithin(maxAge, time.Now()) {
				ErrReauthRequiredFactor(w, maxAge, p.MFAConfirmedAt, FactorMFA)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
