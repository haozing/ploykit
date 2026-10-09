package pgrepo

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/haozing/ploykit/workspace/app"
)

const wsCols = `id, slug, name, plan_code, created_at`

func scanWorkspace(row pgx.Row) (app.Workspace, error) {
	var ws app.Workspace
	err := row.Scan(&ws.ID, &ws.Slug, &ws.Name, &ws.PlanCode, &ws.CreatedAt)
	return ws, err
}

func (r *Repo) CreateWorkspaceWithOwner(ctx context.Context, slug, name, ownerUserID string, now time.Time) (app.Workspace, error) {
	var ws app.Workspace
	err := r.RunInTx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		var err error
		ws, err = r.CreateWorkspaceWithOwnerTx(ctx, tx, slug, name, ownerUserID, now)
		return err
	})
	return ws, err
}

func (r *Repo) CreateWorkspaceWithOwnerTx(ctx context.Context, tx pgx.Tx, slug, name, ownerUserID string, now time.Time) (app.Workspace, error) {
	ws, err := scanWorkspace(tx.QueryRow(ctx, `
		INSERT INTO workspace (slug, name, created_by, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $4)
		RETURNING `+wsCols, slug, name, ownerUserID, now))
	if err != nil {
		return app.Workspace{}, mapErr(err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO member (workspace_id, user_id, role, created_by, created_at)
		VALUES ($1, $2, 'owner', $2, $3)`, ws.ID, ownerUserID, now); err != nil {
		return app.Workspace{}, mapErr(err)
	}
	return ws, nil
}

func (r *Repo) ListWorkspacesByUser(ctx context.Context, userID string) ([]app.WorkspaceMembership, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT w.id, w.slug, w.name, w.plan_code, w.created_at, m.role
		FROM member m JOIN workspace w ON w.id = m.workspace_id
		WHERE m.user_id = $1 AND m.removed_at IS NULL
		ORDER BY w.created_at ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []app.WorkspaceMembership{}
	for rows.Next() {
		var m app.WorkspaceMembership
		if err := rows.Scan(&m.ID, &m.Slug, &m.Name, &m.PlanCode, &m.CreatedAt, &m.Role); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (r *Repo) GetWorkspace(ctx context.Context, id string) (app.Workspace, bool, error) {
	ws, err := scanWorkspace(r.pool.QueryRow(ctx, `SELECT `+wsCols+` FROM workspace WHERE id = $1`, id))
	if isNoRows(err) {
		return app.Workspace{}, false, nil
	}
	if err != nil {
		return app.Workspace{}, false, mapErr(err)
	}
	return ws, true, nil
}

func (r *Repo) FindWorkspaceIDBySlug(ctx context.Context, slug string) (string, bool, error) {
	var id string
	err := r.pool.QueryRow(ctx, `SELECT id FROM workspace WHERE slug = $1`, slug).Scan(&id)
	if isNoRows(err) {
		return "", false, nil
	}
	if err != nil {
		return "", false, mapErr(err)
	}
	return id, true, nil
}

func (r *Repo) CountWorkspacesByUser(ctx context.Context, userID string) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx, `
		SELECT count(DISTINCT m.workspace_id) FROM member m
		JOIN workspace w ON w.id = m.workspace_id
		WHERE m.user_id = $1 AND m.removed_at IS NULL`, userID).Scan(&n)
	return n, err
}

const wsCreateLockClass = 70217

func (r *Repo) CountWorkspacesByUserForCreateTx(ctx context.Context, tx pgx.Tx, userID string) (int, error) {
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1, hashtext($2))`, wsCreateLockClass, userID); err != nil {
		return 0, mapErr(err)
	}
	var n int
	err := tx.QueryRow(ctx, `
		SELECT count(DISTINCT m.workspace_id) FROM member m
		JOIN workspace w ON w.id = m.workspace_id
		WHERE m.user_id = $1 AND m.removed_at IS NULL`, userID).Scan(&n)
	return n, mapErr(err)
}

const memberCols = `m.user_id, u.email, u.display_name, m.role, m.created_at`

func (r *Repo) GetMember(ctx context.Context, workspaceID, userID string) (app.Member, bool, error) {
	var m app.Member
	err := r.pool.QueryRow(ctx, `
		SELECT `+memberCols+` FROM member m JOIN "user" u ON u.id = m.user_id
		WHERE m.workspace_id = $1 AND m.user_id = $2 AND m.removed_at IS NULL`,
		workspaceID, userID).Scan(&m.UserID, &m.Email, &m.DisplayName, &m.Role, &m.CreatedAt)
	if isNoRows(err) {
		return app.Member{}, false, nil
	}
	if err != nil {
		return app.Member{}, false, mapErr(err)
	}
	return m, true, nil
}

func (r *Repo) IsMemberByEmail(ctx context.Context, workspaceID, email string) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM member m JOIN "user" u ON u.id = m.user_id
			WHERE m.workspace_id = $1 AND u.email = $2 AND m.removed_at IS NULL)`,
		workspaceID, email).Scan(&exists)
	return exists, mapErr(err)
}

func (r *Repo) ListMembers(ctx context.Context, workspaceID string, page, pageSize int) (app.Page[app.Member], error) {
	var total int
	if err := r.pool.QueryRow(ctx, `
		SELECT count(*) FROM member WHERE workspace_id = $1 AND removed_at IS NULL`,
		workspaceID).Scan(&total); err != nil {
		return app.Page[app.Member]{}, mapErr(err)
	}
	rows, err := r.pool.Query(ctx, `
		SELECT `+memberCols+` FROM member m JOIN "user" u ON u.id = m.user_id
		WHERE m.workspace_id = $1 AND m.removed_at IS NULL
		ORDER BY m.created_at ASC
		LIMIT $2 OFFSET $3`, workspaceID, pageSize, (page-1)*pageSize)
	if err != nil {
		return app.Page[app.Member]{}, err
	}
	defer rows.Close()
	out := []app.Member{}
	for rows.Next() {
		var m app.Member
		if err := rows.Scan(&m.UserID, &m.Email, &m.DisplayName, &m.Role, &m.CreatedAt); err != nil {
			return app.Page[app.Member]{}, err
		}
		out = append(out, m)
	}
	return app.Page[app.Member]{Items: out, Total: total}, rows.Err()
}

func (r *Repo) CountActiveOwners(ctx context.Context, workspaceID string) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx, `
		SELECT count(*) FROM member
		WHERE workspace_id = $1 AND role = 'owner' AND removed_at IS NULL`, workspaceID).Scan(&n)
	return n, mapErr(err)
}

const lastOwnerGuardSQL = ` AND (
	  m.role <> 'owner'
	  OR (SELECT count(*) FROM member o
	      WHERE o.workspace_id = m.workspace_id AND o.role = 'owner'
	        AND o.removed_at IS NULL AND o.user_id <> m.user_id) > 0)`

func (r *Repo) memberActive(ctx context.Context, workspaceID, userID string) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM member
		WHERE workspace_id = $1 AND user_id = $2 AND removed_at IS NULL)`,
		workspaceID, userID).Scan(&exists)
	return exists, mapErr(err)
}

func (r *Repo) UpdateMemberRole(ctx context.Context, workspaceID, userID, newRole string, now time.Time) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE member AS m SET role = $3
		WHERE m.workspace_id = $1 AND m.user_id = $2 AND m.removed_at IS NULL`+lastOwnerGuardSQL,
		workspaceID, userID, newRole)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		if exists, qerr := r.memberActive(ctx, workspaceID, userID); qerr == nil && exists {
			return app.ErrLastOwner
		}
		return app.ErrNotFound
	}
	return nil
}

func (r *Repo) SoftRemoveMember(ctx context.Context, workspaceID, userID, removedBy string, now time.Time) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE member AS m SET removed_at = $3, removed_by = NULLIF($4::text, '')::uuid
		WHERE m.workspace_id = $1 AND m.user_id = $2 AND m.removed_at IS NULL`+lastOwnerGuardSQL,
		workspaceID, userID, now, removedBy)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		if exists, qerr := r.memberActive(ctx, workspaceID, userID); qerr == nil && exists {
			return app.ErrLastOwner
		}
		return app.ErrNotFound
	}
	return nil
}

func (r *Repo) GetMemberUserStatus(ctx context.Context, workspaceID, userID string) (app.Member, string, bool, error) {
	var m app.Member
	var status string
	err := r.pool.QueryRow(ctx, `
		SELECT `+memberCols+`, u.status
		FROM member m JOIN "user" u ON u.id = m.user_id
		WHERE m.workspace_id = $1 AND m.user_id = $2 AND m.removed_at IS NULL`,
		workspaceID, userID).Scan(&m.UserID, &m.Email, &m.DisplayName, &m.Role, &m.CreatedAt, &status)
	if isNoRows(err) {
		return app.Member{}, "", false, nil
	}
	if err != nil {
		return app.Member{}, "", false, mapErr(err)
	}
	return m, status, true, nil
}

func (r *Repo) OldestActiveOwner(ctx context.Context, workspaceID string) (app.Member, bool, error) {
	var m app.Member
	err := r.pool.QueryRow(ctx, `
		SELECT `+memberCols+`
		FROM member m JOIN "user" u ON u.id = m.user_id
		WHERE m.workspace_id = $1 AND m.role = 'owner' AND m.removed_at IS NULL
		ORDER BY m.created_at ASC LIMIT 1`, workspaceID).
		Scan(&m.UserID, &m.Email, &m.DisplayName, &m.Role, &m.CreatedAt)
	if isNoRows(err) {
		return app.Member{}, false, nil
	}
	if err != nil {
		return app.Member{}, false, mapErr(err)
	}
	return m, true, nil
}

func (r *Repo) TransferOwnershipTx(ctx context.Context, tx pgx.Tx, workspaceID, fromUserID, toUserID string) error {
	promote, err := tx.Exec(ctx, `
		UPDATE member AS m SET role = 'owner'
		FROM "user" u
		WHERE m.workspace_id = $1 AND m.user_id = $2 AND m.removed_at IS NULL
		  AND m.role IN ('admin', 'member') AND u.id = m.user_id AND u.status = 'active'`,
		workspaceID, toUserID)
	if err != nil {
		return mapErr(err)
	}
	if promote.RowsAffected() == 0 {
		return app.ErrNotFound
	}
	demote, err := tx.Exec(ctx, `
		UPDATE member SET role = 'member'
		WHERE workspace_id = $1 AND user_id = $2 AND removed_at IS NULL AND role = 'owner'`,
		workspaceID, fromUserID)
	if err != nil {
		return mapErr(err)
	}
	if demote.RowsAffected() == 0 {
		return app.ErrNotFound
	}
	return nil
}
