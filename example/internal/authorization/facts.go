package authorization

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/haozing/ploykit/authorization"
	"github.com/haozing/ploykit/platform/pg"
	"github.com/haozing/ploykit/platform/webx"
)

// TxFactsProvider is the reference in-transaction FactsProvider (ADR 0005
// acceptance, G3): it reads every fact through the caller's own pgx.Tx — the
// ctx-carried transaction from pg.DB.Within — so an authorization decision
// and the work it gates see the same data state. Membership revoked inside
// the transaction flips the decision to deny in that same transaction (the
// TOCTOU pin in strong_test.go); when no transaction is carried the provider
// reads through the pool.
//
// Assurance derives from the same session columns webx stamps (ADR 0011
// data-source rule): aal2 iff the session carries an MFA proof
// (mfa_confirmed_at), aal1 otherwise; the freshness stamps are the columns
// verbatim (zero time = never proved).
type TxFactsProvider struct {
	db  *pg.DB
	now func() time.Time
}

func NewTxFactsProvider(db *pg.DB) *TxFactsProvider {
	return &TxFactsProvider{db: db, now: time.Now}
}

// Facts implements authorization.FactsProvider. Only session principals
// carry freshness/session facts; other principal kinds return zero facts and
// are denied at the evaluator's authentication stage (auth-method mismatch),
// never by this provider.
func (p *TxFactsProvider) Facts(ctx context.Context, principal authorization.Principal, scope authorization.Scope) (authorization.Facts, error) {
	session, ok := principal.(authorization.SessionPrincipal)
	if !ok {
		return authorization.Facts{}, nil
	}
	facts := authorization.Facts{Assurance: authorization.AssuranceAAL1}

	var status string
	var confirmedAt, mfaConfirmedAt, expiresAt, absoluteExpiresAt *time.Time
	err := p.tx(ctx).QueryRow(ctx, `
		SELECT u.status, s.expires_at, s.absolute_expires_at, s.password_confirmed_at, s.mfa_confirmed_at
		FROM session s
		JOIN "user" u ON u.id = s.user_id
		WHERE s.id = $1::uuid AND s.revoked_at IS NULL`,
		session.SessionID).Scan(&status, &expiresAt, &absoluteExpiresAt, &confirmedAt, &mfaConfirmedAt)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return facts, nil // session gone: ActiveUser/ActiveSession stay false → deny(session_inactive)
	case err != nil:
		return authorization.Facts{}, err
	}
	now := p.now()
	facts.ActiveUser = status == "active"
	facts.ActiveSession = expiresAt != nil && expiresAt.After(now) && absoluteExpiresAt != nil && absoluteExpiresAt.After(now)
	if confirmedAt != nil {
		facts.RecentPasswordAt = *confirmedAt
	}
	if mfaConfirmedAt != nil {
		facts.RecentMFAAt = *mfaConfirmedAt
		facts.Assurance = authorization.AssuranceAAL2
	}

	if wsID, has := scope.Workspace(); has {
		var role string
		err := p.tx(ctx).QueryRow(ctx, `
			SELECT role FROM member
			WHERE workspace_id = $1::uuid AND user_id = $2::uuid AND removed_at IS NULL`,
			wsID, session.SubjectID).Scan(&role)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			// not a member: ActiveWorkspaceMembership stays false
		case err != nil:
			return authorization.Facts{}, err
		default:
			facts.ActiveWorkspaceMembership = true
			facts.WorkspaceRoles = []string{role}
		}
	}
	return facts, nil
}

// SessionPrincipal loads the session row the webx principal points at and
// returns the evaluator-facing principal with its expiry windows filled from
// the same transaction Facts reads — one data state, one decision.
// ok=false when the session no longer exists.
func (p *TxFactsProvider) SessionPrincipal(ctx context.Context, wp *webx.Principal) (authorization.SessionPrincipal, bool, error) {
	var out authorization.SessionPrincipal
	var mfaConfirmedAt *time.Time
	err := p.tx(ctx).QueryRow(ctx, `
		SELECT s.expires_at, s.absolute_expires_at, s.mfa_confirmed_at
		FROM session s
		WHERE s.id = $1::uuid AND s.revoked_at IS NULL AND s.user_id = $2::uuid`,
		wp.SessionID, wp.UserID).Scan(&out.IdleExpiry, &out.AbsoluteExpiry, &mfaConfirmedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, false, nil
	}
	if err != nil {
		return out, false, err
	}
	out.SubjectID = wp.UserID
	out.SessionID = wp.SessionID
	out.Assurance = authorization.AssuranceAAL1
	if mfaConfirmedAt != nil {
		out.Assurance = authorization.AssuranceAAL2
	}
	return out, true, nil
}

func (p *TxFactsProvider) tx(ctx context.Context) pg.DBTX { return p.db.Tx(ctx) }
