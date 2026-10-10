package http

import (
	"net/http"

	"github.com/haozing/ploykit/authz"
	"github.com/haozing/ploykit/platform/webx"
)

// Role-config management surface. GET is guarded by roles:manage only; the
// mutating routes go through d.sensitive (permission check + product
// step-up) — re-shaping who can do what inside a workspace is exactly the
// sensitive-operation class.

func (d Deps) listRoles(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	roles, catalog, err := d.Svc.ListRoleConfigs(r.Context(), p, r.PathValue("id"))
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{
		"items":   roles,
		"catalog": catalog,
	})
}

func (d Deps) setRolePerms(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	var req struct {
		Perms []authz.Permission `json:"perms"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	cfg, err := d.Svc.SetRolePerms(r.Context(), p, r.PathValue("id"), r.PathValue("role"), req.Perms)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, cfg)
}

func (d Deps) resetRolePerms(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if err := d.Svc.ResetRolePerms(r.Context(), p, r.PathValue("id"), r.PathValue("role")); err != nil {
		webx.WriteErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
