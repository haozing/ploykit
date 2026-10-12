// Package devtools registers the example's product-specific MCP tools — the
// reference integration for "a product extends the agent control plane with
// its own intent-level tools". Framework tools (devx) cover logs, jobs and
// doctor; anything product-shaped (this repo's dev tenant, domain-specific
// diagnostics) registers here, in the product, never in the framework.
package devtools

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"myproduct/internal/devtenant"
)

// Server aliases the SDK server type so the composition root can pass the
// mcpx mount's server without importing the SDK itself.
type Server = mcp.Server

// RegisterProductTools installs the example's tools on the MCP server. It is
// called from the composition root (cmd/app/main.go) inside the mcpx register
// callback — the framework cannot import product code, so this direction is
// the only one available (A1).
func RegisterProductTools(s *Server, pool *pgxpool.Pool, log *slog.Logger) {
	type provisionIn struct {
		Email string `json:"email,omitempty" jsonschema:"login email for the dev tenant user (default dev@tenant.local)"`
	}
	mcp.AddTool(s, &mcp.Tool{
		Name:        "provision_dev_tenant",
		Description: "Idempotently provision a local dev tenant (user + owned workspace) so workspace-scoped API calls have something to reference. Dev-environment tool: harmless on a scratch database, do not expose in production wiring.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in provisionIn) (*mcp.CallToolResult, any, error) {
		res, err := devtenant.Ensure(ctx, pool, log, &devtenant.Options{Email: in.Email})
		if err != nil {
			return nil, nil, err
		}
		out := map[string]any{
			"user_id":      res.UserID,
			"email":        res.Email,
			"workspace_id": res.WorkspaceID,
			"workspace":    res.WorkspaceSlug,
		}
		b, _ := json.Marshal(out)
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: string(b)}}}, nil, nil
	})
}
