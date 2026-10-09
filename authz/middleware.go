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
				webx.ErrForbidden(w, "insufficient permission: "+string(base))
				return
			}
			next(w, r)
		}
	}
}
