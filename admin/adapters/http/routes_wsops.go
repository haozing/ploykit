package http

import (
	"net/http"
	"strconv"

	"github.com/haozing/ploykit/admin/app"
	"github.com/haozing/ploykit/platform/webx"
)

type WsOpsDeps struct {
	Svc *app.WsOpsService
}

func (d WsOpsDeps) mounted(next func(w http.ResponseWriter, r *http.Request, p *webx.Principal)) func(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if d.Svc != nil {
		return next
	}
	return func(w http.ResponseWriter, _ *http.Request, _ *webx.Principal) {
		webx.ErrUnavailable(w, "ws ops not wired")
	}
}

func MountWsOps(mux webx.Router, d WsOpsDeps) {
	admin := (&Deps{}).requireAdmin
	mux.Handle("GET /api/admin/workspaces/{id}", admin(d.mounted(d.wsDetail)))
	mux.Handle("PATCH /api/admin/workspaces/{id}/members/{uid}", admin(d.mounted(d.wsMemberRole)))
	mux.Handle("DELETE /api/admin/workspaces/{id}/members/{uid}", admin(d.mounted(d.wsMemberRemove)))
	mux.Handle("DELETE /api/admin/workspaces/{id}", admin(d.mounted(d.wsDelete)))
	mux.Handle("POST /api/admin/workspaces/{id}/quota/grant", admin(d.mounted(d.wsQuotaGrant)))
	mux.Handle("POST /api/admin/workspaces/{id}/transfer-ownership", admin(d.mounted(d.wsTransferOwnership)))
	mux.Handle("POST /api/admin/notify", admin(d.mounted(d.wsNotify)))
	mux.Handle("GET /api/admin/sso", admin(d.mounted(d.ssoList)))
	mux.Handle("GET /api/admin/analytics/recent", admin(d.mounted(d.analyticsRecent)))
}

func (d WsOpsDeps) wsDetail(w http.ResponseWriter, r *http.Request, _ *webx.Principal) {
	det, err := d.Svc.GetWorkspaceDetail(r.Context(), r.PathValue("id"))
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, det)
}

func (d WsOpsDeps) wsMemberRole(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	var req struct {
		Role string `json:"role"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	if err := d.Svc.AdminUpdateMemberRole(r.Context(), p, r.PathValue("id"), r.PathValue("uid"), req.Role); err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (d WsOpsDeps) wsMemberRemove(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if err := d.Svc.AdminRemoveMember(r.Context(), p, r.PathValue("id"), r.PathValue("uid")); err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (d WsOpsDeps) wsDelete(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if err := d.Svc.AdminDeleteWorkspace(r.Context(), p, r.PathValue("id"), r.URL.Query().Get("confirm")); err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (d WsOpsDeps) wsQuotaGrant(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	var req struct {
		Key    string `json:"key"`
		Reason string `json:"reason"`
		Ref    string `json:"ref"`
		Amount int    `json:"amount"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	if err := d.Svc.GrantQuota(r.Context(), p, r.PathValue("id"), req.Key, req.Reason, req.Ref, req.Amount); err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (d WsOpsDeps) wsTransferOwnership(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	var req struct {
		UserID string `json:"user_id"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	if err := d.Svc.AdminTransferOwnership(r.Context(), p, r.PathValue("id"), req.UserID); err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (d WsOpsDeps) ssoList(w http.ResponseWriter, r *http.Request, _ *webx.Principal) {
	rows, err := d.Svc.ListSSOProviders(r.Context())
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, rows)
}

func (d WsOpsDeps) analyticsRecent(w http.ResponseWriter, r *http.Request, _ *webx.Principal) {
	limit := 20
	if v := r.URL.Query().Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 || n > 100 {
			webx.ErrValidation(w, "limit must be an integer between 1 and 100")
			return
		}
		limit = n
	}
	rows, err := d.Svc.RecentEvents(r.Context(), r.URL.Query().Get("type"), limit)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, rows)
}

func (d WsOpsDeps) wsNotify(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	var req app.AnnouncementRequest
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	res, err := d.Svc.SendAnnouncement(r.Context(), p, req)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, res)
}
