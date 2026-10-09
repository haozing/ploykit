package pgrepo

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/haozing/ploykit/authz"
)

type Repo struct {
	pool *pgxpool.Pool
}

var _ authz.Provider = (*Repo)(nil)

func New(pool *pgxpool.Pool) *Repo { return &Repo{pool: pool} }

func (r *Repo) PermsFor(ctx context.Context, key authz.RoleKey) ([]authz.Permission, error) {
	if key.ProjectID != "" {
		return nil, nil
	}
	var perms []authz.Permission
	err := r.pool.QueryRow(ctx, `
		SELECT perms FROM workspace_role
		WHERE workspace_id = $1 AND role = $2`, key.WorkspaceID, key.Role).Scan(&perms)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return perms, nil
}
