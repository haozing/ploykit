package pgrepo

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/haozing/ploykit/notify/app"
)

var _ app.PrefGate = (*Repo)(nil)

func (r *Repo) List(ctx context.Context, userID string) ([]app.Preference, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT notification_type, email_enabled, in_app_enabled, updated_at
		FROM notification_preference
		WHERE user_id = $1
		ORDER BY notification_type`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []app.Preference{}
	for rows.Next() {
		var p app.Preference
		if err := rows.Scan(&p.NotificationType, &p.EmailEnabled, &p.InAppEnabled, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *Repo) Upsert(ctx context.Context, userID, typ string, email, inApp *bool) (app.Preference, error) {
	var p app.Preference
	err := r.pool.QueryRow(ctx, `
		INSERT INTO notification_preference (user_id, notification_type, email_enabled, in_app_enabled, updated_at)
		VALUES ($1, $2, COALESCE($3, true), COALESCE($4, true), now())
		ON CONFLICT (user_id, notification_type) DO UPDATE
		SET email_enabled  = COALESCE($3, notification_preference.email_enabled),
		    in_app_enabled = COALESCE($4, notification_preference.in_app_enabled),
		    updated_at     = now()
		RETURNING notification_type, email_enabled, in_app_enabled, updated_at`,
		userID, typ, email, inApp).
		Scan(&p.NotificationType, &p.EmailEnabled, &p.InAppEnabled, &p.UpdatedAt)
	return p, err
}

func (r *Repo) Allowed(ctx context.Context, userID, typ string) (bool, error) {
	var inApp bool
	err := r.pool.QueryRow(ctx, `
		SELECT in_app_enabled FROM notification_preference
		WHERE user_id = $1 AND notification_type = $2`, userID, typ).Scan(&inApp)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return true, nil
		}
		return false, err
	}
	return inApp, nil
}

func (r *Repo) EmailAllowed(ctx context.Context, userID, typ string) (bool, error) {
	var email bool
	err := r.pool.QueryRow(ctx, `
		SELECT email_enabled FROM notification_preference
		WHERE user_id = $1 AND notification_type = $2`, userID, typ).Scan(&email)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return true, nil
		}
		return false, err
	}
	return email, nil
}
