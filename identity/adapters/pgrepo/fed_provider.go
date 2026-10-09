package pgrepo

import (
	"context"
	"time"

	"github.com/haozing/ploykit/identity/app"
)

func (r *Repo) GetFedProvider(ctx context.Context, workspaceID string) (*app.FedProviderRow, bool, error) {
	var row app.FedProviderRow
	err := r.pool.QueryRow(ctx, `
		SELECT workspace_id, issuer_url, client_id, client_secret, scopes, updated_at
		FROM workspace_oidc_provider WHERE workspace_id = $1`, workspaceID).
		Scan(&row.WorkspaceID, &row.IssuerURL, &row.ClientID, &row.ClientSecret, &row.Scopes, &row.UpdatedAt)
	if isNoRows(err) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, mapErr(err)
	}
	return &row, true, nil
}

func (r *Repo) UpsertFedProvider(ctx context.Context, row *app.FedProviderRow, now time.Time) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO workspace_oidc_provider (workspace_id, issuer_url, client_id, client_secret, scopes, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $6)
		ON CONFLICT (workspace_id) DO UPDATE SET
			issuer_url    = EXCLUDED.issuer_url,
			client_id     = EXCLUDED.client_id,
			client_secret = EXCLUDED.client_secret,
			scopes        = EXCLUDED.scopes,
			updated_at    = EXCLUDED.updated_at`,
		row.WorkspaceID, row.IssuerURL, row.ClientID, row.ClientSecret, row.Scopes, now)
	return mapErr(err)
}

func (r *Repo) DeleteFedProvider(ctx context.Context, workspaceID string) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM workspace_oidc_provider WHERE workspace_id = $1`, workspaceID)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		return app.ErrNotFound
	}
	return nil
}
