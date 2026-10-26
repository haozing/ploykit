package identity

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// ChainHooks composes several IdentityHooks into the single hook value the
// services accept (WithHooks / WithIdentityHooks take exactly one). It exists
// because the extension points are composition magnets — provisioning takes
// AfterRegister/AfterLogin (ADR 0016), the legal module takes the same pair
// for acceptance evidence — and without a chain one product hook would
// silently shadow the other at the wiring site.
//
// Field semantics follow hooks.go, not a new policy:
//
//   - OnRegisterTx runs in argument order and SHORT-CIRCUITS on the first
//     error: it is the transactional hook, an error rolls the registration
//     back, and later hooks must not run inside a doomed transaction whose
//     earlier hook already failed.
//   - AfterRegister / AfterLogin / OnLoginFailed / AfterPasswordChange are
//     observational: every chained hook runs even when an earlier one fails
//     (one sink being down must not starve the others), errors are joined
//     and returned so the identity caller keeps its existing contract —
//     AfterRegister's joined error still surfaces as
//     LoginResult.ProvisioningPending and re-fires on the next login, the
//     others are logged at WARN and swallowed by the caller. The chain
//     itself never logs: the identity firing sites already do, and the
//     joined error names the failing hook index for attribution.
//
// nil safety: nil arguments and nil hook fields are skipped entirely; a
// field with no surviving contributor stays nil so the firing site's
// fast-path check keeps skipping it.
func ChainHooks(hooks ...IdentityHooks) IdentityHooks {
	var onTx []func(ctx context.Context, tx pgx.Tx, userID string) error
	var afterRegister []func(ctx context.Context, userID string) error
	var afterLogin []func(ctx context.Context, userID, sessionID string) error
	var onLoginFailed []func(ctx context.Context, email, ipHash string) error
	var afterPasswordChange []func(ctx context.Context, userID string) error
	for _, h := range hooks {
		if h.OnRegisterTx != nil {
			onTx = append(onTx, h.OnRegisterTx)
		}
		if h.AfterRegister != nil {
			afterRegister = append(afterRegister, h.AfterRegister)
		}
		if h.AfterLogin != nil {
			afterLogin = append(afterLogin, h.AfterLogin)
		}
		if h.OnLoginFailed != nil {
			onLoginFailed = append(onLoginFailed, h.OnLoginFailed)
		}
		if h.AfterPasswordChange != nil {
			afterPasswordChange = append(afterPasswordChange, h.AfterPasswordChange)
		}
	}

	var chained IdentityHooks
	if len(onTx) > 0 {
		chained.OnRegisterTx = func(ctx context.Context, tx pgx.Tx, userID string) error {
			for _, fn := range onTx {
				if err := fn(ctx, tx, userID); err != nil {
					return err
				}
			}
			return nil
		}
	}
	if len(afterRegister) > 0 {
		chained.AfterRegister = func(ctx context.Context, userID string) error {
			return runObservational("AfterRegister", afterRegister, func(fn func(context.Context, string) error) error {
				return fn(ctx, userID)
			})
		}
	}
	if len(afterLogin) > 0 {
		chained.AfterLogin = func(ctx context.Context, userID, sessionID string) error {
			return runObservational("AfterLogin", afterLogin, func(fn func(context.Context, string, string) error) error {
				return fn(ctx, userID, sessionID)
			})
		}
	}
	if len(onLoginFailed) > 0 {
		chained.OnLoginFailed = func(ctx context.Context, email, ipHash string) error {
			return runObservational("OnLoginFailed", onLoginFailed, func(fn func(context.Context, string, string) error) error {
				return fn(ctx, email, ipHash)
			})
		}
	}
	if len(afterPasswordChange) > 0 {
		chained.AfterPasswordChange = func(ctx context.Context, userID string) error {
			return runObservational("AfterPasswordChange", afterPasswordChange, func(fn func(context.Context, string) error) error {
				return fn(ctx, userID)
			})
		}
	}
	return chained
}

// runObservational runs every hook, joins the failures with per-hook
// attribution, and never short-circuits. nil out when nothing failed so the
// identity firing sites' error paths stay untouched on the happy path.
func runObservational[F any](field string, fns []F, call func(F) error) error {
	var errs []error
	for i, fn := range fns {
		if err := call(fn); err != nil {
			errs = append(errs, fmt.Errorf("identity: chain %s hook[%d]: %w", field, i, err))
		}
	}
	return errors.Join(errs...)
}
