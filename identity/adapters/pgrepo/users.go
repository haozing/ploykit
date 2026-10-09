package pgrepo

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/haozing/ploykit/identity/app"
	"github.com/haozing/ploykit/identity/domain"
)

const userCols = `id, email, display_name, avatar_url, password_hash, status, is_platform_admin, email_verified_at, created_at`

func scanUser(row pgx.Row) (app.User, error) {
	var u app.User
	var avatar, passwordHash *string
	var emailVerifiedAt *time.Time
	err := row.Scan(&u.ID, &u.Email, &u.DisplayName, &avatar, &passwordHash, &u.Status, &u.IsPlatformAdmin, &emailVerifiedAt, &u.CreatedAt)
	if err != nil {
		return app.User{}, err
	}
	if avatar != nil {
		u.AvatarURL = *avatar
	}
	if passwordHash != nil {
		u.PasswordHash = *passwordHash
	}
	u.EmailVerified = emailVerifiedAt != nil
	return u, nil
}

func (r *Repo) UpsertUserByEmail(ctx context.Context, email string, now time.Time) (app.User, error) {
	row := r.pool.QueryRow(ctx, `
		INSERT INTO "user" (email, display_name, email_verified_at, created_at, updated_at)
		VALUES ($1, $2, $3, $3, $3)
		ON CONFLICT (email) DO UPDATE SET updated_at = EXCLUDED.updated_at
		RETURNING `+userCols, email, jitDisplayName(email), now)
	u, err := scanUser(row)
	return u, mapErr(err)
}

func (r *Repo) GetUser(ctx context.Context, id string) (app.User, error) {
	u, err := scanUser(r.pool.QueryRow(ctx, `SELECT `+userCols+` FROM "user" WHERE id = $1 AND status = 'active'`, id))
	if isNoRows(err) {
		return app.User{}, app.ErrNotFound
	}
	return u, mapErr(err)
}

func (r *Repo) GetUserByEmail(ctx context.Context, email string) (app.User, bool, error) {
	u, err := scanUser(r.pool.QueryRow(ctx, `SELECT `+userCols+` FROM "user" WHERE email = $1`, email))
	if isNoRows(err) {
		return app.User{}, false, nil
	}
	if err != nil {
		return app.User{}, false, mapErr(err)
	}
	return u, true, nil
}

func (r *Repo) UpdateProfile(ctx context.Context, id, displayName, avatarURL string) (app.User, error) {
	var avatar any
	if avatarURL != "" {
		avatar = avatarURL
	}
	u, err := scanUser(r.pool.QueryRow(ctx, `
		UPDATE "user" SET display_name = $2, avatar_url = $3, updated_at = now()
		WHERE id = $1 AND status = 'active'
		RETURNING `+userCols, id, displayName, avatar))
	if isNoRows(err) {
		return app.User{}, app.ErrNotFound
	}
	return u, mapErr(err)
}

func (r *Repo) CreateUserWithPassword(ctx context.Context, email, passwordHash, displayName string) (app.User, error) {
	name := displayName
	if name == "" {
		name = emailLocalPart(email)
	}
	u, err := scanUser(r.pool.QueryRow(ctx, `
		INSERT INTO "user" (email, display_name, password_hash, created_at, updated_at)
		VALUES ($1, $2, $3, now(), now())
		RETURNING `+userCols, email, name, passwordHash))
	return u, mapErr(err)
}

func (r *Repo) SetPasswordHash(ctx context.Context, userID, passwordHash string, now time.Time) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE "user" SET password_hash = $2, tokens_valid_after = $3, updated_at = $3
		WHERE id = $1`, userID, passwordHash, now)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		return app.ErrNotFound
	}
	return nil
}

func (r *Repo) SetEmailVerified(ctx context.Context, userID string, at time.Time) error {
	_, err := r.pool.Exec(ctx, `UPDATE "user" SET email_verified_at = $2 WHERE id = $1 AND email_verified_at IS NULL`, userID, at)
	return mapErr(err)
}

func emailLocalPart(email string) string {
	for i := 0; i < len(email); i++ {
		if email[i] == '@' {
			return email[:i]
		}
	}
	return email
}

func jitDisplayName(email string) string {
	name, ok := domain.NormalizeDisplayName(emailLocalPart(email))
	if ok {
		return name
	}
	r := []rune(name)
	if len(r) > domain.DisplayNameMaxLen {
		r = r[:domain.DisplayNameMaxLen]
	}
	return string(r)
}
