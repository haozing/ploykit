package http

import (
	"context"
	"net/http"

	"github.com/haozing/ploykit/authz"
	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/workspace/app"
)

type MemberChecker interface {
	GetMember(ctx context.Context, workspaceID, userID string) (app.Member, bool, error)
}

type Deps struct {
	Svc     *app.WorkspaceService
	Members MemberChecker

	Authz *authz.Authorizer

	// StepUp, when non-nil, wraps the domain's destructive operations (delete
	// workspace, transfer ownership). Products mount
	// webx.RequireRecentAuth(maxAge) here — requiring a fresh password
	// confirmation for destructive actions is a product policy, the domain
	// only marks which operations are destructive. Nil = no step-up.
	StepUp func(http.Handler) http.Handler
}

func (d Deps) guard(perm authz.Permission, fn func(w http.ResponseWriter, r *http.Request, p *webx.Principal)) http.HandlerFunc {
	return authz.Require(d.Authz, perm)(webx.P(fn))
}

// sensitive guards a destructive operation. The permission check is outermost
// (a role denial is terminal), the step-up challenge inner (recoverable:
// confirm password, retry) — an unauthorized member must not be teased
// through a reauthentication for an action they can never perform.
func (d Deps) sensitive(perm authz.Permission, fn func(w http.ResponseWriter, r *http.Request, p *webx.Principal)) http.HandlerFunc {
	var h http.Handler = webx.P(fn)
	if d.StepUp != nil {
		h = d.StepUp(h)
	}
	return authz.Require(d.Authz, perm)(http.HandlerFunc(h.ServeHTTP))
}

// subroutePrefix is the URL prefix Mount strips before delegating to the
// workspace sub-mux. Mount keeps the literal string inside StripPrefix
// (tools/check_api.py stitches the sub-mux's relative routes back to absolute
// paths by matching that literal); this constant exists so SubrouteInfos
// applies exactly the same prefix — keep the two in lockstep.
const subroutePrefix = "/api/workspaces"

func Mount(mux webx.Router, d Deps) {
	mux.HandleFunc("GET /api/workspaces", d.listMine)
	mux.HandleFunc("POST /api/workspaces", d.create)

	wsCtx := d.workspaceCtx
	mux.Handle("PATCH /api/workspaces/{workspaceId}", wsCtx(http.HandlerFunc(d.guard("workspace:update", d.renameWorkspace))))
	mux.Handle("DELETE /api/workspaces/{workspaceId}", wsCtx(d.sensitive("workspace:delete", d.deleteWorkspace)))

	// The StripPrefix literal below is subroutePrefix — kept inline because
	// tools/check_api.py reconstructs the sub-mux's absolute paths from it.
	mux.Handle("/api/workspaces/{workspaceId}/", d.workspaceCtx(http.StripPrefix("/api/workspaces", workspaceSubroutes(d))))

	mux.HandleFunc("GET /api/invitations/mine", d.myInvitations)
	mux.HandleFunc("POST /api/invitations/{id}/accept", d.acceptInvitation)
	mux.HandleFunc("POST /api/invitations/{id}/decline", d.declineInvitation)
	mux.HandleFunc("POST /api/share-links/redeem", d.redeemShareLink)
}

// workspaceSubroutes builds the recording sub-mux of workspace-scoped routes.
// Patterns are relative (/{id}/...): the caller strips subroutePrefix before
// delegating, and SubrouteInfos stitches the prefix back for enumeration.
func workspaceSubroutes(d Deps) *webx.Mux {
	sub := webx.NewMux()
	sub.HandleFunc("GET /{id}/members", d.guard("members:read", d.listMembers))
	sub.HandleFunc("PATCH /{id}/members/{userId}", d.guard("members:write", d.updateMember))
	sub.HandleFunc("DELETE /{id}/members/{userId}", d.guard("members:remove", d.removeMember))

	sub.HandleFunc("GET /{id}/roles", d.guard("roles:manage", d.listRoles))
	sub.Handle("PUT /{id}/roles/{role}", d.sensitive("roles:manage", d.setRolePerms))
	sub.Handle("DELETE /{id}/roles/{role}", d.sensitive("roles:manage", d.resetRolePerms))

	sub.Handle("POST /{id}/transfer-ownership", d.sensitive("workspace:read", d.transferOwnership))

	sub.HandleFunc("POST /{id}/leave", d.guard("workspace:read", d.leaveWorkspace))
	sub.HandleFunc("GET /{id}/invitations", d.guard("invites:read", d.listInvitations))
	sub.HandleFunc("POST /{id}/invitations", d.guard("members:invite", d.createInvitation))
	sub.HandleFunc("DELETE /{id}/invitations/{invId}", d.guard("members:invite", d.revokeInvitation))
	sub.HandleFunc("GET /{id}/share-links", d.guard("invites:read", d.listShareLinks))
	sub.HandleFunc("POST /{id}/share-links", d.guard("members:invite", d.createShareLink))
	sub.HandleFunc("DELETE /{id}/share-links/{linkId}", d.guard("members:invite", d.revokeShareLink))
	return sub
}

// SubrouteInfos returns the absolute routes the sub-mux serves once Mount
// mounts it under "/api/workspaces/{workspaceId}/": subroutePrefix applied to
// each recorded sub-mux pattern. The root router records only the subtree
// mount (no method prefix — not an endpoint), so runtime route enumeration —
// e.g. a contract test comparing mounted routes against the OpenAPI spec —
// must consult this list in addition to the root Mux.Routes(). It shares the
// registration with the serving path (workspaceSubroutes), so the two cannot
// drift; the zero-value Deps only produce handler closures that are never
// invoked here.
func SubrouteInfos() []webx.RouteInfo {
	infos := workspaceSubroutes(Deps{}).Routes()
	for i := range infos {
		infos[i].Path = subroutePrefix + infos[i].Path
		infos[i].Pattern = subroutePrefix + infos[i].Pattern
	}
	return infos
}

func (d Deps) workspaceCtx(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := webx.PrincipalFromRequest(r)
		if p == nil {
			webx.ErrUnauthenticated(w, "authentication required")
			return
		}
		wsID := r.PathValue("workspaceId")

		m, ok, err := d.Members.GetMember(r.Context(), wsID, p.UserID)
		if err != nil {
			webx.ErrInternal(w)
			return
		}
		if !ok {
			webx.ErrNotFound(w, "workspace not found")
			return
		}
		p.WorkspaceID = wsID
		p.Role = m.Role
		next.ServeHTTP(w, r)
	})
}

func WorkspaceHeaderCtx(members MemberChecker) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p := webx.PrincipalFromRequest(r)
			if p == nil {
				webx.ErrUnauthenticated(w, "authentication required")
				return
			}
			wsID := r.Header.Get("X-Workspace-Id")
			if wsID == "" {
				webx.ErrValidation(w, "X-Workspace-Id header required")
				return
			}

			if !p.Scope.AllowsWorkspace(wsID) {
				webx.ErrForbidden(w, "workspace not in credential scope")
				return
			}
			m, ok, err := members.GetMember(r.Context(), wsID, p.UserID)
			if err != nil {
				webx.ErrInternal(w)
				return
			}
			if !ok {
				webx.ErrForbidden(w, "not a workspace member")
				return
			}
			p.WorkspaceID = wsID
			p.Role = m.Role
			next.ServeHTTP(w, r)
		})
	}
}
