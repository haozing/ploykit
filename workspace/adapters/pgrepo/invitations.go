package pgrepo

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/workspace/app"
)

const invCols = `id, workspace_id, email, role, status, expires_at, created_at`

func scanInvitation(row pgx.Row) (app.Invitation, error) {
	var inv app.Invitation
	err := row.Scan(&inv.ID, &inv.WorkspaceID, &inv.Email, &inv.Role, &inv.Status, &inv.ExpiresAt, &inv.CreatedAt)
	return inv, err
}

func (r *Repo) CreateInvitation(ctx context.Context, workspaceID, email, role, createdBy string, expiresAt time.Time) (app.Invitation, error) {
	inv, err := scanInvitation(r.pool.QueryRow(ctx, `
		INSERT INTO workspace_invitation (workspace_id, email, role, created_by, expires_at)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING `+invCols, workspaceID, email, role, createdBy, expiresAt))
	if err != nil {
		return app.Invitation{}, mapErr(err)
	}
	return inv, nil
}

func (r *Repo) ListInvitations(ctx context.Context, workspaceID string, page, pageSize int) (app.Page[app.Invitation], error) {
	const filter = `workspace_id = $1 AND status = 'pending' AND expires_at > now()`
	var total int
	if err := r.pool.QueryRow(ctx,
		`SELECT count(*) FROM workspace_invitation WHERE `+filter, workspaceID).Scan(&total); err != nil {
		return app.Page[app.Invitation]{}, mapErr(err)
	}
	rows, err := r.pool.Query(ctx, `
		SELECT `+invCols+` FROM workspace_invitation
		WHERE `+filter+`
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3`, workspaceID, pageSize, (page-1)*pageSize)
	if err != nil {
		return app.Page[app.Invitation]{}, err
	}
	defer rows.Close()
	out := []app.Invitation{}
	for rows.Next() {
		inv, err := scanInvitation(rows)
		if err != nil {
			return app.Page[app.Invitation]{}, err
		}
		out = append(out, inv)
	}
	return app.Page[app.Invitation]{Items: out, Total: total}, rows.Err()
}

func (r *Repo) RevokeInvitation(ctx context.Context, workspaceID, invitationID string, now time.Time) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE workspace_invitation SET status = 'revoked', updated_at = $3
		WHERE id = $2 AND workspace_id = $1 AND status = 'pending'`, workspaceID, invitationID, now)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		return app.ErrNotFound
	}
	return nil
}

func (r *Repo) HasPendingInvitation(ctx context.Context, workspaceID, email string) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM workspace_invitation
			WHERE workspace_id = $1 AND email = $2 AND status = 'pending' AND expires_at > now())`,
		workspaceID, email).Scan(&exists)
	return exists, mapErr(err)
}

func (r *Repo) PendingInvitationsByEmail(ctx context.Context, email string) ([]app.InvitationWithWorkspace, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT i.id, i.workspace_id, i.email, i.role, i.status, i.expires_at, i.created_at, w.name, w.slug
		FROM workspace_invitation i JOIN workspace w ON w.id = i.workspace_id
		WHERE i.email = $1 AND i.status = 'pending' AND i.expires_at > now()
		ORDER BY i.created_at DESC`, email)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []app.InvitationWithWorkspace{}
	for rows.Next() {
		var x app.InvitationWithWorkspace
		if err := rows.Scan(&x.ID, &x.WorkspaceID, &x.Email, &x.Role, &x.Status, &x.ExpiresAt, &x.CreatedAt, &x.WorkspaceName, &x.WorkspaceSlug); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

func (r *Repo) AcceptInvitation(ctx context.Context, invitationID, userID, email string, now time.Time) (app.Workspace, error) {
	var ws app.Workspace
	err := r.RunInTx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		var err error
		ws, err = r.AcceptInvitationTx(ctx, tx, invitationID, userID, email, now)
		return err
	})
	return ws, err
}

func (r *Repo) AcceptInvitationTx(ctx context.Context, tx pgx.Tx, invitationID, userID, email string, now time.Time) (app.Workspace, error) {
	var wsID, role string
	err := tx.QueryRow(ctx, `
		UPDATE workspace_invitation
		SET status = 'accepted', accepted_by = $2, accepted_at = $3, updated_at = $3
		WHERE id = $1 AND email = $4 AND status = 'pending' AND expires_at > $3
		RETURNING workspace_id, role`, invitationID, userID, now, email).Scan(&wsID, &role)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Workspace{}, webx.NewNotFound("invitation not found, expired, or already handled")
	}
	if err != nil {
		return app.Workspace{}, err
	}

	var alreadyMember bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM member WHERE workspace_id = $1 AND user_id = $2 AND removed_at IS NULL)`,
		wsID, userID).Scan(&alreadyMember); err != nil {
		return app.Workspace{}, err
	}
	if !alreadyMember {

		if _, err := tx.Exec(ctx, `
			INSERT INTO member (workspace_id, user_id, role, created_at)
			VALUES ($1, $2, $3, $4)`, wsID, userID, role, now); err != nil {
			return app.Workspace{}, mapErr(err)
		}
	}

	return scanWorkspaceTx(ctx, tx, wsID)
}

func (r *Repo) DeclineInvitation(ctx context.Context, invitationID, email string, now time.Time) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE workspace_invitation SET status = 'declined', updated_at = $3
		WHERE id = $1 AND email = $2 AND status = 'pending'`, invitationID, email, now)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		return app.ErrNotFound
	}
	return nil
}

const linkCols = `id, code_prefix, role, max_uses, uses, expires_at, created_at`

func (r *Repo) CreateShareLink(ctx context.Context, workspaceID, codeHash, codePrefix, role, createdBy string, maxUses int, expiresAt time.Time) (app.ShareLink, error) {
	var l app.ShareLink
	err := r.pool.QueryRow(ctx, `
		INSERT INTO workspace_share_link (workspace_id, code_hash, code_prefix, role, max_uses, expires_at, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING `+linkCols, workspaceID, codeHash, codePrefix, role, maxUses, expiresAt, createdBy).
		Scan(&l.ID, &l.CodePrefix, &l.Role, &l.MaxUses, &l.Uses, &l.ExpiresAt, &l.CreatedAt)
	return l, mapErr(err)
}

func (r *Repo) ListShareLinks(ctx context.Context, workspaceID string, page, pageSize int) (app.Page[app.ShareLink], error) {
	const filter = `workspace_id = $1 AND revoked_at IS NULL AND expires_at > now()`
	var total int
	if err := r.pool.QueryRow(ctx,
		`SELECT count(*) FROM workspace_share_link WHERE `+filter, workspaceID).Scan(&total); err != nil {
		return app.Page[app.ShareLink]{}, mapErr(err)
	}
	rows, err := r.pool.Query(ctx, `
		SELECT `+linkCols+` FROM workspace_share_link
		WHERE `+filter+`
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3`, workspaceID, pageSize, (page-1)*pageSize)
	if err != nil {
		return app.Page[app.ShareLink]{}, err
	}
	defer rows.Close()
	out := []app.ShareLink{}
	for rows.Next() {
		var l app.ShareLink
		if err := rows.Scan(&l.ID, &l.CodePrefix, &l.Role, &l.MaxUses, &l.Uses, &l.ExpiresAt, &l.CreatedAt); err != nil {
			return app.Page[app.ShareLink]{}, err
		}
		out = append(out, l)
	}
	return app.Page[app.ShareLink]{Items: out, Total: total}, rows.Err()
}

func (r *Repo) RevokeShareLink(ctx context.Context, workspaceID, linkID string, now time.Time) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE workspace_share_link SET revoked_at = $3
		WHERE id = $2 AND workspace_id = $1 AND revoked_at IS NULL`, workspaceID, linkID, now)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		return app.ErrNotFound
	}
	return nil
}

func (r *Repo) RedeemShareLink(ctx context.Context, codeHash, userID string, now time.Time) (app.Workspace, error) {
	var ws app.Workspace
	err := r.RunInTx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		var err error
		ws, err = r.RedeemShareLinkTx(ctx, tx, codeHash, userID, now)
		return err
	})
	return ws, err
}

func (r *Repo) RedeemShareLinkTx(ctx context.Context, tx pgx.Tx, codeHash, userID string, now time.Time) (app.Workspace, error) {
	var wsID, role string
	err := tx.QueryRow(ctx, `
		SELECT workspace_id, role FROM workspace_share_link
		WHERE code_hash = $1 AND revoked_at IS NULL AND expires_at > $2 AND uses < max_uses
		FOR UPDATE`, codeHash, now).Scan(&wsID, &role)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return app.Workspace{}, webx.NewNotFound("share link invalid or exhausted")
		}
		return app.Workspace{}, err
	}
	var alreadyMember bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM member WHERE workspace_id = $1 AND user_id = $2 AND removed_at IS NULL)`,
		wsID, userID).Scan(&alreadyMember); err != nil {
		return app.Workspace{}, err
	}
	if !alreadyMember {
		if _, err := tx.Exec(ctx, `UPDATE workspace_share_link SET uses = uses + 1 WHERE code_hash = $1`, codeHash); err != nil {
			return app.Workspace{}, err
		}

		if _, err := tx.Exec(ctx, `
			INSERT INTO member (workspace_id, user_id, role, created_at)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT DO NOTHING`, wsID, userID, role, now); err != nil {
			return app.Workspace{}, mapErr(err)
		}
	}
	return scanWorkspaceTx(ctx, tx, wsID)
}

func scanWorkspaceTx(ctx context.Context, tx pgx.Tx, id string) (app.Workspace, error) {
	return scanWorkspace(tx.QueryRow(ctx, `SELECT `+wsCols+` FROM workspace WHERE id = $1`, id))
}
