package pgrepo

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/haozing/ploykit/identity/app"
	"github.com/haozing/ploykit/platform/webx"
)

func (r *Repo) CreateSession(ctx context.Context, in webx.SessionCreate) (string, time.Time, error) {
	return r.insertSession(ctx, in, "")
}

func (r *Repo) CreateImpersonatedSession(ctx context.Context, userID, impersonatedBy, ipHash, userAgent string, now time.Time) (string, time.Time, error) {
	return r.insertSession(ctx, webx.SessionCreate{
		UserID: userID, IPHash: ipHash, UserAgent: userAgent, Now: now,
	}, impersonatedBy)
}

func (r *Repo) insertSession(ctx context.Context, in webx.SessionCreate, impersonatedBy string) (string, time.Time, error) {
	token, err := webx.MintToken()
	if err != nil {
		return "", time.Time{}, err
	}
	exp := in.Now.Add(r.cfg.SessionTTL)
	abs := in.Now.Add(r.cfg.AbsoluteTTL)
	var confirmedAt any
	if in.PasswordConfirmed {
		confirmedAt = in.Now
	}
	_, err = r.pool.Exec(ctx, `
		INSERT INTO session (user_id, token_hash, ip_hash, user_agent, expires_at, absolute_expires_at, created_at, last_seen_at, impersonated_by, password_confirmed_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9)`,
		in.UserID, webx.HashToken(token), nullIfEmpty(in.IPHash), nullIfEmpty(in.UserAgent), exp, abs, in.Now, nullIfEmpty(impersonatedBy), confirmedAt)
	if err != nil {
		return "", time.Time{}, mapErr(err)
	}
	return token, exp, nil
}

func (r *Repo) VerifySession(ctx context.Context, token string, now time.Time) (*webx.Principal, error) {
	var p webx.Principal
	var sessionID string
	var confirmedAt *time.Time
	err := r.pool.QueryRow(ctx, `
		SELECT s.id, u.id, u.email, u.display_name, u.is_platform_admin, COALESCE(s.impersonated_by::text, ''), s.password_confirmed_at
		FROM session s
		JOIN "user" u ON u.id = s.user_id
		WHERE s.token_hash = $1
		  AND s.revoked_at IS NULL
		  AND s.expires_at > $2
		  AND s.absolute_expires_at > $2
		  AND u.status = 'active'
		  AND u.tokens_valid_after < s.created_at`,
		webx.HashToken(token), now).
		Scan(&sessionID, &p.UserID, &p.Email, &p.Name, &p.IsPlatformAdmin, &p.ImpersonatedBy, &confirmedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}

		return nil, fmt.Errorf("verify session: %w", err)
	}
	p.Source = webx.SourceSession
	p.SessionID = sessionID
	if confirmedAt != nil {
		p.PasswordConfirmedAt = *confirmedAt
	}
	return &p, nil
}

func (r *Repo) ConfirmSessionPassword(ctx context.Context, sessionID string, now time.Time) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE session SET password_confirmed_at = $2
		WHERE id = $1 AND revoked_at IS NULL AND expires_at > $2`,
		sessionID, now)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		return app.ErrNotFound
	}
	return nil
}

func (r *Repo) RenewSession(ctx context.Context, token string, now time.Time) (time.Time, bool, error) {
	var exp time.Time

	err := r.pool.QueryRow(ctx, `
		UPDATE session
		SET expires_at = LEAST($2::timestamptz + $3::interval, absolute_expires_at), last_seen_at = $2::timestamptz
		WHERE token_hash = $1 AND revoked_at IS NULL
		  AND expires_at < $2::timestamptz + make_interval(secs => $4 / 2.0)
		RETURNING expires_at`,
		webx.HashToken(token), now, r.cfg.SessionTTL.String(), r.cfg.SessionTTL.Seconds()).
		Scan(&exp)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return time.Time{}, false, nil
		}
		return time.Time{}, false, fmt.Errorf("renew session: %w", err)
	}
	return exp, true, nil
}

func (r *Repo) RevokeSession(ctx context.Context, token string) error {
	_, err := r.pool.Exec(ctx, `UPDATE session SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, webx.HashToken(token))
	return mapErr(err)
}

func (r *Repo) RevokeAllUserSessions(ctx context.Context, userID string) error {
	_, err := r.pool.Exec(ctx, `UPDATE session SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, userID)
	return mapErr(err)
}

func (r *Repo) RevokeUserSessionByID(ctx context.Context, userID, sessionID string, now time.Time) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE session SET revoked_at = $3
		WHERE id = $2 AND user_id = $1 AND revoked_at IS NULL`, userID, sessionID, now)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		return app.ErrNotFound
	}
	return nil
}

func (r *Repo) ListUserSessions(ctx context.Context, userID string) ([]app.SessionInfo, error) {

	rows, err := r.pool.Query(ctx, `
		SELECT id, COALESCE(ip_hash,''), COALESCE(user_agent,''), last_seen_at, expires_at, created_at,
		       COALESCE(impersonated_by::text,'')
		FROM session WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []app.SessionInfo{}
	for rows.Next() {
		var si app.SessionInfo
		if err := rows.Scan(&si.ID, &si.IPHash, &si.UserAgent, &si.LastSeenAt, &si.ExpiresAt, &si.CreatedAt, &si.ImpersonatedBy); err != nil {
			return nil, err
		}
		out = append(out, si)
	}
	return out, rows.Err()
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
