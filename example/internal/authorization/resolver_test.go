package authorization

import (
	"strings"
	"testing"
)

func TestResolverResolvesCatalogRoutes(t *testing.T) {
	r := NewResolver()
	tests := []struct {
		name   string
		method string
		path   string
		wantOp string
		wantWS string
		wantOK bool
	}{
		{"delete absolute", "DELETE", "/api/workspaces/7b2e", "workspace.delete", "7b2e", true},
		{"transfer absolute", "POST", "/api/workspaces/7b2e/transfer-ownership", "workspace.transfer_ownership", "7b2e", true},
		{"transfer subroute-relative", "POST", "/7b2e/transfer-ownership", "workspace.transfer_ownership", "7b2e", true},
		{"wrong method", "GET", "/api/workspaces/7b2e", "", "", false},
		{"unknown subpath", "DELETE", "/api/workspaces/7b2e/members", "", "", false},
		{"missing workspace", "DELETE", "/api/workspaces/", "", "", false},
		{"extra segment", "DELETE", "/api/workspaces/7b2e/extra", "", "", false},
		{"root shape", "DELETE", "/", "", "", false},
		{"transfer wrong method", "PUT", "/api/workspaces/7b2e/transfer-ownership", "", "", false},
		{"prefix lookalike", "DELETE", "/api/workspaces/7b2e/transfer-ownership-extra", "", "", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			op, ws, ok := r.Resolve(tc.method, tc.path)
			if ok != tc.wantOK || op != tc.wantOp || ws != tc.wantWS {
				t.Fatalf("Resolve(%s %s) = (%q, %q, %v), want (%q, %q, %v)",
					tc.method, tc.path, op, ws, ok, tc.wantOp, tc.wantWS, tc.wantOK)
			}
		})
	}
}

// Bind against the real embedded catalog: every operation reachable, every
// route declared — the startup drift guard.
func TestResolverBindsEmbeddedCatalog(t *testing.T) {
	strong := newTestStrong(t)
	// New already ran Bind; a second explicit bind must stay green.
	if err := strong.resolver.Bind(strong.eval.Catalog()); err != nil {
		t.Fatalf("Bind(embedded catalog): %v", err)
	}
}

func TestResolverBindRejectsDrift(t *testing.T) {
	twoOps := `
catalog_schema_version: 1
roles:
  workspace: [owner]
  project: []
operations:
  - operation_id: workspace.delete
    auth_method: session
    scope: workspace_path
    allowed_workspace_roles: [owner]
    assurance: aal1
    recent_auth: password
    recent_auth_window_seconds: 900
    idempotency: none
  - operation_id: workspace.transfer_ownership
    auth_method: session
    scope: workspace_path
    allowed_workspace_roles: [owner]
    assurance: aal1
    recent_auth: none
    idempotency: none
  - operation_id: token.create
    auth_method: session
    scope: platform
    assurance: aal2
    recent_auth: password_and_mfa
    recent_auth_window_seconds: 900
    idempotency: none
`
	// (a) a catalog operation no route reaches: the routed operations are
	// declared (so the route side is clean), plus an unrouted orphan.
	orphan := twoOps + `  - operation_id: workspace.orphan
    auth_method: session
    scope: workspace_path
    allowed_workspace_roles: [owner]
    assurance: aal1
    recent_auth: none
    idempotency: none
`
	err := NewResolver().Bind(mustParseCatalog(t, orphan))
	if err == nil || !strings.Contains(err.Error(), "has no resolver route") {
		t.Fatalf("Bind = %v, want operation-without-route error", err)
	}

	// (b) a resolver route naming an undeclared operation: the two-route
	// resolver against a delete-only catalog leaves transfer_ownership
	// undeclared.
	deleteOnly := strings.SplitN(twoOps, "  - operation_id: workspace.transfer_ownership", 2)[0]
	err = NewResolver().Bind(mustParseCatalog(t, deleteOnly))
	if err == nil || !strings.Contains(err.Error(), "undeclared operation") {
		t.Fatalf("Bind = %v, want route-without-operation error", err)
	}
}
