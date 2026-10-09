package pgrepo

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/haozing/ploykit/identity/app"
	"github.com/haozing/ploykit/identity/domain"
	"github.com/haozing/ploykit/platform/webx"
)

func (r *Repo) CreatePAT(ctx context.Context, userID, name, tokenHash, prefix string, expiresAt *time.Time, scope *webx.CredentialScope) (app.PAT, error) {
	var ws, perms []string
	if scope != nil {
		ws, perms = scope.WorkspaceIDs, scope.Permissions
	}
	var p app.PAT
	var wsOut, permsOut []string
	err := r.pool.QueryRow(ctx, `
		INSERT INTO personal_access_token
			(user_id, name, token_hash, prefix, expires_at, scope_workspaces, scope_permissions)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, name, prefix, expires_at, last_used_at, created_at, scope_workspaces, scope_permissions`,
		userID, name, tokenHash, prefix, expiresAt, ws, perms).
		Scan(&p.ID, &p.Name, &p.Prefix, &p.ExpiresAt, &p.LastUsedAt, &p.CreatedAt, &wsOut, &permsOut)
	p.Scope = credentialScope(wsOut, permsOut)
	return p, mapErr(err)
}

func credentialScope(ws, perms []string) *webx.CredentialScope {
	if ws == nil && perms == nil {
		return nil
	}
	return &webx.CredentialScope{WorkspaceIDs: ws, Permissions: perms}
}

func (r *Repo) ResolvePAT(ctx context.Context, token string, now time.Time) (*webx.Principal, error) {
	if !domain.IsPATFormat(r.cfg.PATPrefix, token) {
		return nil, nil
	}
	var p webx.Principal
	var patID string
	var ws, perms []string
	err := r.pool.QueryRow(ctx, `
		UPDATE personal_access_token t
		SET last_used_at = $2
		FROM "user" u
		WHERE u.id = t.user_id
		  AND t.token_hash = $1
		  AND t.revoked_at IS NULL
		  AND (t.expires_at IS NULL OR t.expires_at > $2)
		  AND u.status = 'active'
		RETURNING t.id, u.id, u.email, u.display_name, u.is_platform_admin,
		          t.scope_workspaces, t.scope_permissions`,
		domain.HashPAT(token), now).
		Scan(&patID, &p.UserID, &p.Email, &p.Name, &p.IsPlatformAdmin, &ws, &perms)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("resolve pat: %w", err)
	}
	p.Source = webx.SourcePAT
	p.PATID = patID
	p.Scope = credentialScope(ws, perms)
	return &p, nil
}

func (r *Repo) ListPATs(ctx context.Context, userID string) ([]app.PAT, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, name, prefix, expires_at, last_used_at, created_at,
		       scope_workspaces, scope_permissions
		FROM personal_access_token
		WHERE user_id = $1 AND revoked_at IS NULL
		ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []app.PAT{}
	for rows.Next() {
		var p app.PAT
		var ws, perms []string
		if err := rows.Scan(&p.ID, &p.Name, &p.Prefix, &p.ExpiresAt, &p.LastUsedAt, &p.CreatedAt, &ws, &perms); err != nil {
			return nil, err
		}
		p.Scope = credentialScope(ws, perms)
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *Repo) RevokePAT(ctx context.Context, userID, patID string, now time.Time) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE personal_access_token SET revoked_at = $3
		WHERE id = $2 AND user_id = $1 AND revoked_at IS NULL`, userID, patID, now)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		return app.ErrNotFound
	}
	return nil
}
