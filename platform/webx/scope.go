package webx

import (
	"net/http"
	"strings"
)

// RequireScope closes the PAT scope-enforcement gap on endpoints that do NOT
// go through authz (machine-to-machine mounts such as MCP tools, OpenAPI
// servers, webhook receivers). authz.CanIn already enforces
// CredentialScope.Permissions when the product calls it; this middleware is
// the equivalent default for handlers that build their own actor straight
// from the Principal — without it, any PAT passes regardless of its declared
// scope (field report: risk-engine-server issue #12, a scoped PAT invoking an
// unrestricted MCP tool succeeded where it should have been rejected).
//
// Semantics:
//   - Non-PAT principals (sessions) pass untouched — browser sessions are not
//     scope-bounded; authorization stays with authz/role checks.
//   - PATs whose scope carries no Permissions list are unrestricted by design
//     (AllowsPermission: nil = allow-all) and pass.
//   - A PAT with a Permissions list passes only if some declared permission
//     shares the domain of at least one required permission
//     (permDomain: "post:submit" and "post:*" both cover domain "post").
//
// Mount it right after Authenticate on machine-facing routes:
//
//	mux.Handle("POST /mcp", Authenticate(...)(RequireScope("post:submit", "post:publish")(h)))
//
// Workspace bounding (Scope.WorkspaceIDs) is checked by
// RequireWorkspaceScope when the workspace id is known at mount time; for
// request-derived workspace ids keep using authz.CanIn inside the handler.
func RequireScope(required ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if p := PrincipalFrom(r.Context()); p != nil && p.Source == SourcePAT && !p.Scope.Allows(required...) {
				ErrForbidden(w, "PAT scope 不包含所需权限")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireWorkspaceScope bounds a PAT to its declared workspace list when the
// endpoint serves exactly one fixed workspace context (request-derived
// contexts belong in the handler via authz.CanIn, which also checks
// WorkspaceIDs). Non-PAT principals pass untouched.
func RequireWorkspaceScope() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if p := PrincipalFrom(r.Context()); p != nil && p.Source == SourcePAT {
				ws := p.WorkspaceID
				if ws == "" {
					ws = strings.TrimPrefix(r.Header.Get("X-Workspace-Id"), "")
				}
				if !p.Scope.AllowsWorkspace(ws) {
					ErrForbidden(w, "PAT scope 不包含目标工作区")
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}
