package pgrepo

import (
	"context"
	"time"
)

func (r *Repo) FindOAuthAccount(ctx context.Context, provider, subject string) (string, bool, error) {
	var userID string
	err := r.pool.QueryRow(ctx,
		`SELECT user_id FROM oauth_account WHERE provider = $1 AND subject = $2`, provider, subject).Scan(&userID)
	if isNoRows(err) {
		return "", false, nil
	}
	if err != nil {
		return "", false, mapErr(err)
	}
	return userID, true, nil
}

func (r *Repo) LinkOAuthAccount(ctx context.Context, provider, subject, userID, emailAtLink string, now time.Time) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO oauth_account (provider, subject, user_id, email_at_link, created_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (provider, subject) DO NOTHING`, provider, subject, userID, emailAtLink, now)
	return mapErr(err)
}
