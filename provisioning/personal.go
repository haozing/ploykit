// Package provisioning is the framework's sanctioned composition layer for
// registration-time provisioning (ADR 0016): identity + workspace + quota
// composed into one wiring line. It is a top-level package — NOT inside
// identity — because composing sibling business domains inside one of them
// would violate the lateral-import rule (same shape as
// admin/adapters/bridge, docs/adr/0004).
//
// PersonalWorkspace returns identity hooks that ensure every user ends up
// with exactly one personal workspace, the owner membership, and the
// configured onboarding credits. Idempotency is a database invariant (the
// partial unique index uq_workspace_personal), not code discipline, and
// every login re-ensures (one indexed workspace lookup, plus one
// credit-ledger probe when Credits is configured) so half-provisioned
// accounts — JIT failures, crashes mid-provision, lost races — converge on
// the next login without a retry table or a pending-flag column.
package provisioning

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/haozing/ploykit/identity"
	"github.com/haozing/ploykit/platform/pg"
	"github.com/haozing/ploykit/quota"
	workspaceapp "github.com/haozing/ploykit/workspace/app"
)

// Credit is one onboarding quota grant, applied inside the provisioning
// transaction via quota.Service.GrantTx.
type Credit struct {
	Key    string
	Amount int
}

// PersonalConfig wires the dependencies PersonalWorkspace needs. Workspaces
// is the workspace domain's app.Repo port (pass the pgrepo adapter). Quota
// is required IFF Credits is non-empty — products running their own credit
// ledger leave Credits (and Quota) empty and provision the workspace +
// membership only. Adoption with pre-existing users: migration 048 marks
// every legacy workspace 'team', so ensure would provision a NEW personal
// workspace for existing users — classify legacy personal workspaces via a
// product migration (UPDATE … SET kind='personal' WHERE <product
// predicate>) BEFORE wiring the factory, or accept the second workspace
// deliberately (see ADR 0016, "Adoption with existing users").
type PersonalConfig struct {
	Pool       *pgxpool.Pool
	Workspaces workspaceapp.Repo
	Quota      *quota.Service // required iff Credits is non-empty
	Credits    []Credit       // onboarding grants; optional
	Log        *slog.Logger
}

func (c PersonalConfig) logger() *slog.Logger {
	if c.Log != nil {
		return c.Log
	}
	return slog.Default()
}

// PersonalWorkspace builds the ADR 0016 hooks. OnRegisterTx stays nil on
// purpose: the personal workspace is NOT must-succeed-with-the-user state —
// a failed workspace insert must never roll a registration back, so
// provisioning runs post-commit and converges at the next login instead.
func PersonalWorkspace(cfg PersonalConfig) identity.IdentityHooks {
	return identity.IdentityHooks{
		AfterRegister: func(ctx context.Context, userID string) error {
			return cfg.ensure(ctx, userID)
		},
		// AfterLogin is the convergence mechanism: registration ensures
		// once, and every subsequent login re-ensures with one indexed
		// lookup on the fast path. Observational by identity's contract —
		// an error never blocks the login.
		AfterLogin: func(ctx context.Context, userID, _sessionID string) error {
			return cfg.ensure(ctx, userID)
		},
	}
}

// ensure brings the user's personal provisioning to the desired state,
// idempotently. Fast path: one indexed workspace lookup; when Credits is
// configured, one credit-ledger probe on top that backfills onboarding grants
// for keys declared AFTER the workspace was provisioned (audit §3.1). Slow
// path: one service transaction that re-checks (two logins can race the fast
// path), inserts workspace + owner membership + credits, and treats the
// unique-index violations as "already provisioned".
func (c PersonalConfig) ensure(ctx context.Context, userID string) error {
	if c.Pool == nil {
		return errors.New("provisioning: PersonalConfig misconfigured: Pool is required")
	}
	if len(c.Credits) > 0 && c.Quota == nil {
		return errors.New("provisioning: PersonalConfig misconfigured: Quota is required when Credits is non-empty (or drop Credits to run your own credit ledger)")
	}
	if c.Workspaces == nil {
		return errors.New("provisioning: PersonalConfig misconfigured: Workspaces is required")
	}
	log := c.logger()

	wsID, err := c.personalWorkspaceTx(ctx, c.Pool, userID)
	if err != nil {
		return err
	}
	if wsID != "" {
		// Products running their own credit ledger (Credits empty) stop
		// here — zero queries beyond the workspace probe, same as before
		// the backfill existed.
		if len(c.Credits) == 0 {
			return nil
		}
		return c.backfillOnboardingCredits(ctx, userID, wsID)
	}

	err = pg.WithService(ctx, c.Pool, func(ctx context.Context, tx pgx.Tx) error {
		// Re-check inside the transaction: the fast path can race a
		// concurrent provisioning for the same user.
		wsID, err := c.personalWorkspaceTx(ctx, tx, userID)
		if err != nil {
			return err
		}
		if wsID != "" {
			// Lost race. The winner inserted workspace AND its credits
			// atomically, so under this binary nothing is missing; if the
			// winner was an older binary with a shorter Credits list, the
			// next login's fast path backfills. No work here.
			return nil
		}
		now := time.Now().UTC()
		ws, err := c.Workspaces.CreatePersonalWorkspaceTx(ctx, tx, personalSlug(userID), userID, now)
		if err != nil {
			return err
		}
		for _, credit := range c.Credits {
			// refID binds the grant to (this workspace, this credit) —
			// GrantTx is idempotent on it, so a retried provisioning never
			// double-grants.
			if _, err := c.Quota.GrantTx(ctx, tx, ws.ID, credit.Key, "onboarding", ws.ID+":"+credit.Key, credit.Amount, now); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		if alreadyProvisioned(err) {
			log.Warn("personal workspace already provisioned (lost race or replay)",
				"user", userID)
			return nil
		}
		return err
	}
	log.Info("personal workspace provisioned", "user", userID)
	return nil
}

// backfillOnboardingCredits grants the configured onboarding credits a
// provisioned workspace is still missing — the keys that were declared in
// PersonalConfig only AFTER the workspace was first provisioned. The
// create-time grant fires exactly once per workspace, so without this
// backfill a key added in a later release (field report: tool-site
// themes_monthly, audit §3.1) never reaches existing workspaces and their
// users hit E_QUOTA_EXHAUSTED on first use of the capability.
//
// Semantics are deliberately the SAME one-time onboarding grant as first
// provisioning — reason "onboarding", refID ws.ID+":"+key, via GrantTx — so a
// backfilled workspace is indistinguishable from one provisioned with the
// full key list. This is NOT quota.GrantPeriodic: the onboarding grant is a
// one-shot allowance landing in the current period, not a monthly cycle;
// products wanting recurring allowances compose GrantPeriodic separately.
// Like the create-time grant it goes through GrantTx, which by contract does
// not fire the OnGrant hook (the caller may still roll back).
//
// Cost: this runs on the login hot path for every provisioned user when
// Credits is configured. The steady state (nothing missing) costs exactly one
// round trip — a single SELECT of the workspace's onboarding grants for the
// configured refIDs, then a local diff; a write transaction opens only when a
// backfill is actually due. Concurrent logins racing the backfill converge on
// the uq_quota_grant_dedup unique index: GrantTx is ON CONFLICT DO NOTHING on
// the same refID, so the loser inserts nothing and no error surfaces.
func (c PersonalConfig) backfillOnboardingCredits(ctx context.Context, userID, wsID string) error {
	if len(c.Credits) == 0 {
		return nil
	}
	refIDs := make([]string, len(c.Credits))
	for i, credit := range c.Credits {
		refIDs[i] = wsID + ":" + credit.Key
	}
	rows, err := c.Pool.Query(ctx, `
		SELECT counter_key FROM quota_grant
		WHERE workspace_id = $1 AND reason = 'onboarding' AND ref_id = ANY($2)`,
		wsID, refIDs)
	if err != nil {
		return err
	}
	granted := make(map[string]struct{}, len(c.Credits))
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			rows.Close()
			return err
		}
		granted[key] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	var missing []Credit
	for _, credit := range c.Credits {
		if _, ok := granted[credit.Key]; !ok {
			missing = append(missing, credit)
		}
	}
	if len(missing) == 0 {
		return nil
	}
	now := time.Now().UTC()
	err = pg.WithService(ctx, c.Pool, func(ctx context.Context, tx pgx.Tx) error {
		for _, credit := range missing {
			// Same refID as the create-time grant: uq_quota_grant_dedup
			// makes the insert idempotent, so a concurrent backfill (or a
			// replay of this one) is a silent no-op.
			if _, err := c.Quota.GrantTx(ctx, tx, wsID, credit.Key, "onboarding", wsID+":"+credit.Key, credit.Amount, now); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	keys := make([]string, len(missing))
	for i, credit := range missing {
		keys[i] = credit.Key
	}
	c.logger().Info("onboarding credits backfilled (key declared after provisioning)",
		"user", userID, "workspace", wsID, "keys", keys)
	return nil
}

// personalWorkspaceSQL resolves the user's personal workspace id. The partial
// unique index uq_workspace_personal guarantees at most one row per user, so
// this stays the one indexed lookup the fast path always was — it now also
// carries the id the onboarding backfill needs.
const personalWorkspaceSQL = `SELECT id FROM workspace
	WHERE created_by = $1 AND kind = 'personal'`

type rowQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func (c PersonalConfig) personalWorkspaceTx(ctx context.Context, q rowQuerier, userID string) (string, error) {
	var wsID string
	err := q.QueryRow(ctx, personalWorkspaceSQL, userID).Scan(&wsID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return wsID, err
}

// alreadyProvisioned reports whether err is the unique-index invariant
// firing: the partial index uq_workspace_personal, the workspace slug unique
// (the deterministic slug collides because the personal workspace already
// exists), or the active-membership unique. The workspace repo maps all of
// these to workspace app.ErrDuplicate via pg.AsDuplicate; the explicit
// constraint names keep the semantics honest even if a caller passes a repo
// implementation that does not map them.
func alreadyProvisioned(err error) bool {
	return errors.Is(err, workspaceapp.ErrDuplicate) ||
		pg.IsUniqueViolation(err, "uq_workspace_personal") ||
		pg.IsUniqueViolation(err, "workspace_slug_key") ||
		pg.IsUniqueViolation(err, "uq_member_active")
}

// personalSlug derives the deterministic workspace slug from the user id:
// a uuid string without dashes is 32 lowercase hex chars, so the slug is
// "my-<32hex>" — 35 chars, matching the workspace slug CHECK
// '^[a-z0-9][a-z0-9-]{2,38}[a-z0-9]$'. Deterministic means a replay after a
// half-provisioned attempt hits the same slug — and therefore the same
// unique constraint — instead of leaking one workspace per retry.
func personalSlug(userID string) string {
	return "my-" + strings.ReplaceAll(strings.ToLower(userID), "-", "")
}
