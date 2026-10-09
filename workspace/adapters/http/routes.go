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
}

func (d Deps) guard(perm authz.Permission, fn func(w http.ResponseWriter, r *http.Request, p *webx.Principal)) http.HandlerFunc {
	return authz.Require(d.Authz, perm)(webx.P(fn))
}

func Mount(mux *http.ServeMux, d Deps) {
	mux.HandleFunc("GET /api/workspaces", d.listMine)
	mux.HandleFunc("POST /api/workspaces", d.create)

	wsCtx := d.workspaceCtx
	mux.Handle("PATCH /api/workspaces/{workspaceId}", wsCtx(http.HandlerFunc(d.guard("workspace:update", d.renameWorkspace))))
	mux.Handle("DELETE /api/workspaces/{workspaceId}", wsCtx(http.HandlerFunc(d.guard("workspace:delete", d.deleteWorkspace))))

	mux.Handle("/api/workspaces/{workspaceId}/", d.workspaceCtx(http.StripPrefix("/api/workspaces", workspaceSubroutes(d))))

	mux.HandleFunc("GET /api/invitations/mine", d.myInvitations)
	mux.HandleFunc("POST /api/invitations/{id}/accept", d.acceptInvitation)
	mux.HandleFunc("POST /api/invitations/{id}/decline", d.declineInvitation)
	mux.HandleFunc("POST /api/share-links/redeem", d.redeemShareLink)
}

func workspaceSubroutes(d Deps) http.Handler {
	sub := http.NewServeMux()
	sub.HandleFunc("GET /{id}/members", d.guard("members:read", d.listMembers))
	sub.HandleFunc("PATCH /{id}/members/{userId}", d.guard("members:write", d.updateMember))
	sub.HandleFunc("DELETE /{id}/members/{userId}", d.guard("members:remove", d.removeMember))

	sub.HandleFunc("POST /{id}/transfer-ownership", d.guard("workspace:read", d.transferOwnership))

	sub.HandleFunc("POST /{id}/leave", d.guard("workspace:read", d.leaveWorkspace))
	sub.HandleFunc("GET /{id}/invitations", d.guard("invites:read", d.listInvitations))
	sub.HandleFunc("POST /{id}/invitations", d.guard("members:invite", d.createInvitation))
	sub.HandleFunc("DELETE /{id}/invitations/{invId}", d.guard("members:invite", d.revokeInvitation))
	sub.HandleFunc("GET /{id}/share-links", d.guard("invites:read", d.listShareLinks))
	sub.HandleFunc("POST /{id}/share-links", d.guard("members:invite", d.createShareLink))
	sub.HandleFunc("DELETE /{id}/share-links/{linkId}", d.guard("members:invite", d.revokeShareLink))
	return sub
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
