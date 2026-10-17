package authz

import (
	"net/http"

	"github.com/haozing/ploykit/platform/webx"
)

func Require(a *Authorizer, perm Permission) func(http.HandlerFunc) http.HandlerFunc {
	return func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			p := webx.PrincipalFromRequest(r)
			if p == nil {
				webx.ErrUnauthenticated(w, "authentication required")
				return
			}
			if !a.CanIn(r.Context(), p, perm) {
				if p.Role == "" {
					// Distinct from a real denial: an empty role means the
					// mount never resolved roles (see Authorizer.CanIn) —
					// "insufficient permission" would send the operator
					// chasing grants that cannot fix a wiring bug.
					webx.WriteErr(w, webx.NewError(http.StatusForbidden, "E_ROLE_UNRESOLVED",
						"role unresolved for this principal (empty role): the role middleware is probably not wired on this mount"))
					return
				}
				webx.ErrForbidden(w, "insufficient permission: "+string(perm))
				return
			}
			next(w, r)
		}
	}
}

func RequireOwn(a *Authorizer, base Permission, isOwn func(r *http.Request, p *webx.Principal) bool) func(http.HandlerFunc) http.HandlerFunc {
	return func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			p := webx.PrincipalFromRequest(r)
			if p == nil {
				webx.ErrUnauthenticated(w, "authentication required")
				return
			}

			allowed := a.CanIn(r.Context(), p, base)
			if !allowed && isOwn != nil {
				allowed = isOwn(r, p) && a.CanIn(r.Context(), p, base+"_own")
			}
			if !allowed {
				if p.Role == "" {
					webx.WriteErr(w, webx.NewError(http.StatusForbidden, "E_ROLE_UNRESOLVED",
						"role unresolved for this principal (empty role): the role middleware is probably not wired on this mount"))
					return
				}
				webx.ErrForbidden(w, "insufficient permission: "+string(base))
				return
			}
			next(w, r)
		}
	}
}
