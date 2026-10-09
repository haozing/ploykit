package app

import "time"

type SSOProviderRow struct {
	WorkspaceID   string    `json:"workspace_id"`
	WorkspaceSlug string    `json:"workspace_slug"`
	WorkspaceName string    `json:"workspace_name"`
	IssuerURL     string    `json:"issuer_url"`
	ClientID      string    `json:"client_id"`
	Scopes        string    `json:"scopes"`
	SecretSealed  bool      `json:"secret_sealed"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}
