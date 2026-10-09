package pgrepo

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/haozing/ploykit/identity/app"
)

func (r *Repo) SoftDeleteUserTx(ctx context.Context, tx pgx.Tx, userID string, now time.Time) error {
	tag, err := tx.Exec(ctx, `
		UPDATE "user" SET
			status              = 'deleted',
			email               = 'deleted+' || id || '@invalid',
			display_name        = '',
			avatar_url          = NULL,
			password_hash       = NULL,
			tokens_valid_after  = $2,
			updated_at          = $2
		WHERE id = $1 AND status = 'active'`, userID, now)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		return app.ErrNotFound
	}
	if _, err := tx.Exec(ctx, `
		UPDATE personal_access_token SET revoked_at = $2
		WHERE user_id = $1 AND revoked_at IS NULL`, userID, now); err != nil {
		return mapErr(err)
	}
	_, err = tx.Exec(ctx, `DELETE FROM oauth_account WHERE user_id = $1`, userID)
	return mapErr(err)
}
