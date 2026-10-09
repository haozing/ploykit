package pgrepo

import (
	"context"
	"time"

	"github.com/haozing/ploykit/identity/app"
)

func (r *Repo) CreateChallenge(ctx context.Context, email, kind, secretHash string, expiresAt time.Time) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO auth_challenge (email, kind, secret_hash, expires_at)
		VALUES ($1, $2, $3, $4)`, email, kind, secretHash, expiresAt)
	return mapErr(err)
}

func (r *Repo) LatestPendingChallenge(ctx context.Context, email, kind string) (*app.Challenge, error) {
	var ch app.Challenge

	err := r.pool.QueryRow(ctx, `
		SELECT id, email, kind, secret_hash, attempts, expires_at, created_at
		FROM auth_challenge
		WHERE email = $1 AND kind = $2 AND consumed_at IS NULL
		ORDER BY created_at DESC LIMIT 1`, email, kind).
		Scan(&ch.ID, &ch.Email, &ch.Kind, &ch.SecretHash, &ch.Attempts, &ch.ExpiresAt, &ch.CreatedAt)
	if isNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, mapErr(err)
	}
	return &ch, nil
}

func (r *Repo) IncChallengeAttempts(ctx context.Context, id string) error {
	_, err := r.pool.Exec(ctx, `UPDATE auth_challenge SET attempts = attempts + 1 WHERE id = $1`, id)
	return mapErr(err)
}

func (r *Repo) ConsumeChallenge(ctx context.Context, id string) error {
	tag, err := r.pool.Exec(ctx, `UPDATE auth_challenge SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL`, id)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		return app.ErrNotFound
	}
	return nil
}

func (r *Repo) CountRecentAttempts(ctx context.Context, ipHash, identity string, since time.Time) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx, `
		SELECT count(*) FROM login_attempt
		WHERE ip_hash = $1 AND identity = $2 AND created_at >= $3 AND NOT success`,
		ipHash, identity, since).Scan(&n)
	return n, err
}

func (r *Repo) RecordAttempt(ctx context.Context, ipHash, identity string, success bool, at time.Time) error {
	_, err := r.pool.Exec(ctx, `INSERT INTO login_attempt (ip_hash, identity, success, created_at) VALUES ($1, $2, $3, $4)`,
		ipHash, identity, success, at)
	return mapErr(err)
}

func (r *Repo) CleanupAttempts(ctx context.Context, before time.Time) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM login_attempt WHERE created_at < $1`, before)
	return err
}
