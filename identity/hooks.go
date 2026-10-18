package identity

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// IdentityHooks is the identity domain's extension surface. The register
// hooks are split by lifecycle, not by transport (ADR 0016):
//
//   - OnRegisterTx covers state that must succeed WITH the user (role
//     binding, tenant rows) — it shares the creation transaction's atomicity.
//   - AfterRegister covers post-commit provisioning (personal workspace,
//     welcome email, onboarding credits) — it must be idempotent because a
//     failure never rolls the user back and is re-fired on the next login
//     by consumers using the provisioning factory.
//
// The nil-tx trap of the pre-split single AfterRegister (one signature
// serving in-transaction and post-commit paths; a hook written for the
// transactional path panicked on OAuth/code JIT) is structurally gone: the
// post-commit hook has no transaction parameter.
type IdentityHooks struct {
	// OnRegisterTx fires INSIDE the user-creation transaction; only paths
	// that create a user in one transaction (password register, admin
	// create) fire it. An error rolls the registration back. Bind roles and
	// other must-succeed-with-the-user state here. It never fires on the
	// JIT paths (OAuth / verification code) — those users come to life
	// outside any caller-owned transaction.
	OnRegisterTx func(ctx context.Context, tx pgx.Tx, userID string) error

	// AfterRegister fires AFTER COMMIT on every registration path (password,
	// admin create, OAuth JIT, code JIT) with tx intentionally absent — the
	// nil-tx trap is structurally gone. MUST be idempotent: failures are
	// logged at ERROR, surfaced as LoginResult.ProvisioningPending, and the
	// account's next login re-fires it (consumers using the provisioning
	// factory get login-time convergence for free). Never fails the
	// registration or the login that triggered it.
	AfterRegister func(ctx context.Context, userID string) error

	// AfterLogin fires after a session has been established on every
	// successful login (password, verification code, third-party
	// completion); sessionID identifies the session just created.
	// Observational: an error is logged at WARN and never blocks the login.
	AfterLogin func(ctx context.Context, userID, sessionID string) error

	// OnLoginFailed fires on every rejected authentication (wrong password,
	// bad/expired verification code, too many attempts, signup-gate block),
	// keyed by the attempted email and a hashed source IP. Observational:
	// an error is logged at WARN and swallowed — a down risk sink must not
	// turn a failed login into a 5xx.
	OnLoginFailed func(ctx context.Context, email, ipHash string) error

	// AfterPasswordChange fires after the user's own ChangePassword
	// succeeds (new hash stored, all previous sessions revoked, a fresh
	// session issued). It does not fire on admin resets or reset-link
	// flows. Observational: an error is logged at WARN only.
	AfterPasswordChange func(ctx context.Context, userID string) error
}
