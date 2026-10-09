package pgrepo

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/haozing/ploykit/identity/app"
	"github.com/haozing/ploykit/platform/pg"
)

type Config struct {
	SessionTTL  time.Duration
	AbsoluteTTL time.Duration

	PATPrefix string
}

type Repo struct {
	pool *pgxpool.Pool
	cfg  Config
}

var _ app.Repo = (*Repo)(nil)

func New(pool *pgxpool.Pool, cfg Config) *Repo {
	if cfg.SessionTTL == 0 {
		cfg.SessionTTL = 7 * 24 * time.Hour
	}
	if cfg.AbsoluteTTL == 0 {
		cfg.AbsoluteTTL = 30 * 24 * time.Hour
	}
	return &Repo{pool: pool, cfg: cfg}
}

func mapErr(err error) error {
	if err == nil {
		return nil
	}
	return pg.AsDuplicate(err, app.ErrDuplicate)
}

func isNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

func (r *Repo) RunInTx(ctx context.Context, fn func(ctx context.Context, tx pgx.Tx) error) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	if err := fn(ctx, tx); err != nil {
		_ = tx.Rollback(ctx)
		return err
	}
	return tx.Commit(ctx)
}

func (r *Repo) CreateUserWithPasswordTx(ctx context.Context, tx pgx.Tx, email, passwordHash, displayName string) (app.User, error) {
	name := displayName
	if name == "" {
		name = emailLocalPart(email)
	}
	u, err := scanUser(tx.QueryRow(ctx, `
		INSERT INTO "user" (email, display_name, password_hash, created_at, updated_at)
		VALUES ($1, $2, $3, now(), now())
		RETURNING `+userCols, email, name, passwordHash))
	return u, mapErr(err)
}
