package http

import (
	"net/http"
	"strconv"
	"time"

	"github.com/haozing/ploykit/platform/webx"
)

func (d Deps) listMine(w http.ResponseWriter, r *http.Request) {
	p := webx.PrincipalFromRequest(r)
	if p == nil {
		webx.ErrUnauthenticated(w, "authentication required")
		return
	}
	list, err := d.Svc.ListMine(r.Context(), p)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, list)
}

func (d Deps) create(w http.ResponseWriter, r *http.Request) {
	p := webx.PrincipalFromRequest(r)
	if p == nil {
		webx.ErrUnauthenticated(w, "authentication required")
		return
	}
	var req struct {
		Slug string `json:"slug"`
		Name string `json:"name"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	ws, err := d.Svc.Create(r.Context(), p, req.Slug, req.Name)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusCreated, ws)
}

func pageQuery(r *http.Request) (page, pageSize int) {
	page, _ = strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ = strconv.Atoi(r.URL.Query().Get("page_size"))
	return
}

func (d Deps) listMembers(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	page, pageSize := pageQuery(r)
	list, err := d.Svc.ListMembers(r.Context(), p.WorkspaceID, page, pageSize)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, list)
}

func (d Deps) renameWorkspace(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	var req struct {
		Name string `json:"name"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	ws, err := d.Svc.RenameWorkspace(r.Context(), p, p.WorkspaceID, req.Name)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, ws)
}

func (d Deps) deleteWorkspace(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if err := d.Svc.DeleteWorkspace(r.Context(), p, p.WorkspaceID); err != nil {
		webx.WriteErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (d Deps) updateMember(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	var req struct {
		Role string `json:"role"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	if err := d.Svc.UpdateMemberRole(r.Context(), p, p.WorkspaceID, r.PathValue("userId"), req.Role); err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (d Deps) removeMember(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if err := d.Svc.RemoveMember(r.Context(), p, p.WorkspaceID, r.PathValue("userId")); err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (d Deps) transferOwnership(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	var req struct {
		UserID string `json:"user_id"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	if err := d.Svc.TransferOwnership(r.Context(), p, p.WorkspaceID, req.UserID); err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (d Deps) leaveWorkspace(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if err := d.Svc.Leave(r.Context(), p, p.WorkspaceID); err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (d Deps) listInvitations(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	page, pageSize := pageQuery(r)
	list, err := d.Svc.ListInvitations(r.Context(), p, p.WorkspaceID, page, pageSize)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, list)
}

func (d Deps) createInvitation(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	var req struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	inv, err := d.Svc.Invite(r.Context(), p, p.WorkspaceID, req.Email, req.Role)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusCreated, inv)
}

func (d Deps) revokeInvitation(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if err := d.Svc.RevokeInvitation(r.Context(), p, p.WorkspaceID, r.PathValue("invId")); err != nil {
		webx.WriteErr(w, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (d Deps) myInvitations(w http.ResponseWriter, r *http.Request) {
	p := webx.PrincipalFromRequest(r)
	if p == nil {
		webx.ErrUnauthenticated(w, "authentication required")
		return
	}
	list, err := d.Svc.MyInvitations(r.Context(), p)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, list)
}

func (d Deps) acceptInvitation(w http.ResponseWriter, r *http.Request) {
	p := webx.PrincipalFromRequest(r)
	if p == nil {
		webx.ErrUnauthenticated(w, "authentication required")
		return
	}
	ws, err := d.Svc.AcceptInvitation(r.Context(), p, r.PathValue("id"))
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, ws)
}

func (d Deps) declineInvitation(w http.ResponseWriter, r *http.Request) {
	p := webx.PrincipalFromRequest(r)
	if p == nil {
		webx.ErrUnauthenticated(w, "authentication required")
		return
	}
	if err := d.Svc.DeclineInvitation(r.Context(), p, r.PathValue("id")); err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (d Deps) listShareLinks(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	page, pageSize := pageQuery(r)
	list, err := d.Svc.ListShareLinks(r.Context(), p, p.WorkspaceID, page, pageSize)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, list)
}

func (d Deps) createShareLink(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	var req struct {
		Role     string `json:"role"`
		MaxUses  int    `json:"max_uses"`
		TTLHours int    `json:"ttl_hours"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	ttl := time.Duration(req.TTLHours) * time.Hour
	link, code, err := d.Svc.CreateShareLink(r.Context(), p, p.WorkspaceID, req.Role, req.MaxUses, ttl)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusCreated, map[string]any{"link": link, "code": code})
}

func (d Deps) revokeShareLink(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if err := d.Svc.RevokeShareLink(r.Context(), p, p.WorkspaceID, r.PathValue("linkId")); err != nil {
		webx.WriteErr(w, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (d Deps) redeemShareLink(w http.ResponseWriter, r *http.Request) {
	p := webx.PrincipalFromRequest(r)
	if p == nil {
		webx.ErrUnauthenticated(w, "authentication required")
		return
	}
	var req struct {
		Code string `json:"code"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	ws, err := d.Svc.RedeemShareLink(r.Context(), p, req.Code)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, ws)
}
