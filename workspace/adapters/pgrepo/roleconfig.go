package pgrepo

import (
	"context"
	"time"

	"github.com/haozing/ploykit/authz"
)

// Role-config write side of the workspace_role table (migration 026). The
// read side is authz/adapters/pgrepo.PermsFor; both stay thin over the same
// table — authz owns evaluation, workspace owns the management surface.

func (r *Repo) ListRoleOverrides(ctx context.Context, workspaceID string) (map[string][]authz.Permission, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT role, perms FROM workspace_role WHERE workspace_id = $1`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]authz.Permission{}
	for rows.Next() {
		var role string
		var perms []authz.Permission
		if err := rows.Scan(&role, &perms); err != nil {
			return nil, err
		}
		out[role] = perms
	}
	return out, rows.Err()
}

func (r *Repo) UpsertRolePerms(ctx context.Context, workspaceID, role string, perms []authz.Permission, now time.Time) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO workspace_role (workspace_id, role, perms, updated_at)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (workspace_id, role) DO UPDATE SET perms = $3, updated_at = $4`,
		workspaceID, role, perms, now)
	return mapErr(err)
}

func (r *Repo) DeleteRolePerms(ctx context.Context, workspaceID, role string) error {
	_, err := r.pool.Exec(ctx,
		`DELETE FROM workspace_role WHERE workspace_id = $1 AND role = $2`, workspaceID, role)
	return mapErr(err) // idempotent by design: deleting a non-existent override succeeds
}
