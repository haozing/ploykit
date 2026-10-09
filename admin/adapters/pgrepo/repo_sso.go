package pgrepo

import (
	"context"

	"github.com/haozing/ploykit/admin/app"
	"github.com/haozing/ploykit/platform/sealx"
)

func (r *Repo) ListSSOProviders(ctx context.Context) ([]app.SSOProviderRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT p.workspace_id, w.slug, w.name, p.issuer_url, p.client_id, p.scopes,
		       p.client_secret LIKE '`+sealx.SealedPrefix+`%',
		       p.created_at, p.updated_at
		FROM workspace_oidc_provider p
		JOIN workspace w ON w.id = p.workspace_id
		ORDER BY p.created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []app.SSOProviderRow{}
	for rows.Next() {
		var s app.SSOProviderRow
		if err := rows.Scan(&s.WorkspaceID, &s.WorkspaceSlug, &s.WorkspaceName,
			&s.IssuerURL, &s.ClientID, &s.Scopes, &s.SecretSealed, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}
