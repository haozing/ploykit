package pgrepo

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/haozing/ploykit/identity/app"
)

// user_mfa + user_mfa_backup_code persistence (migration 045). The secret is
// stored sealed (sealx); backup codes are stored as sha256-hex hashes of the
// normalized code.

func (r *Repo) UpsertPendingMFA(ctx context.Context, userID, secretSealed string, now time.Time) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO user_mfa (user_id, secret_sealed, confirmed_at, created_at, updated_at)
		VALUES ($1, $2, NULL, $3, $3)
		ON CONFLICT (user_id) DO UPDATE
		SET secret_sealed = EXCLUDED.secret_sealed, confirmed_at = NULL, updated_at = $3`,
		userID, secretSealed, now)
	return mapErr(err)
}

func (r *Repo) GetMFA(ctx context.Context, userID string) (secretSealed string, confirmedAt *time.Time, ok bool, err error) {
	err = r.pool.QueryRow(ctx, `
		SELECT secret_sealed, confirmed_at FROM user_mfa WHERE user_id = $1`, userID).
		Scan(&secretSealed, &confirmedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil, false, nil
	}
	if err != nil {
		return "", nil, false, mapErr(err)
	}
	return secretSealed, confirmedAt, true, nil
}

func (r *Repo) ConfirmMFA(ctx context.Context, userID string, now time.Time) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE user_mfa SET confirmed_at = $2, updated_at = $2
		WHERE user_id = $1 AND confirmed_at IS NULL`, userID, now)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		return app.ErrNotFound
	}
	return nil
}

func (r *Repo) DeleteMFA(ctx context.Context, userID string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM user_mfa WHERE user_id = $1`, userID)
	return mapErr(err)
}

func (r *Repo) ReplaceBackupCodes(ctx context.Context, userID string, codeHashes []string, now time.Time) error {
	return r.RunInTx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		if _, err := tx.Exec(ctx,
			`DELETE FROM user_mfa_backup_code WHERE user_id = $1`, userID); err != nil {
			return err
		}
		for _, hash := range codeHashes {
			if _, err := tx.Exec(ctx, `
				INSERT INTO user_mfa_backup_code (user_id, code_hash, created_at)
				VALUES ($1, $2, $3)`, userID, hash, now); err != nil {
				return err
			}
		}
		return nil
	})
}

// ConsumeBackupCode marks one pending code consumed in a single conditional
// UPDATE — consume-once under concurrency without an application-level lock.
func (r *Repo) ConsumeBackupCode(ctx context.Context, userID, codeHash string, now time.Time) (bool, error) {
	tag, err := r.pool.Exec(ctx, `
		UPDATE user_mfa_backup_code SET consumed_at = $3
		WHERE user_id = $1 AND code_hash = $2 AND consumed_at IS NULL`,
		userID, codeHash, now)
	if err != nil {
		return false, mapErr(err)
	}
	return tag.RowsAffected() == 1, nil
}

var _ app.MFARepo = (*Repo)(nil)
