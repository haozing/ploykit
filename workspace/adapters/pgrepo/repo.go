package pgrepo

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/haozing/ploykit/platform/pg"
	"github.com/haozing/ploykit/workspace/app"
)

type Repo struct {
	pool *pgxpool.Pool
}

var _ app.Repo = (*Repo)(nil)

func New(pool *pgxpool.Pool) *Repo {
	return &Repo{pool: pool}
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

func (r *Repo) UpdateWorkspaceName(ctx context.Context, id, name string, now time.Time) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE workspace SET name = $2, updated_at = $3 WHERE id = $1`, id, name, now)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		return app.ErrNotFound
	}
	return nil
}

func (r *Repo) DeleteWorkspaceCascade(ctx context.Context, tx pgx.Tx, workspaceID string) error {
	tag, err := tx.Exec(ctx, `DELETE FROM workspace WHERE id = $1`, workspaceID)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		return app.ErrNotFound
	}
	return nil
}
