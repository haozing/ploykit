package http

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/haozing/ploykit/admin/app"
	"github.com/haozing/ploykit/platform/webx"
)

type UserOpsDeps struct {
	Deps
	Ops *app.UserOpsService
}

func MountUserOps(mux webx.Router, d UserOpsDeps) {
	admin := d.requireAdmin

	mux.Handle("GET /api/admin/users/{id}", admin(d.userDetail))
	mux.Handle("GET /api/admin/users/{id}/export", admin(d.exportUserdata))
	mux.Handle("POST /api/admin/users/{id}/kick", admin(d.kickUser))
	mux.Handle("POST /api/admin/users/{id}/sessions/{sid}/revoke", admin(d.revokeUserSession))
	mux.Handle("POST /api/admin/users/{id}/password-reset", admin(d.adminResetPassword))
	mux.Handle("POST /api/admin/users/{id}/resend-verification", admin(d.resendVerification))
	mux.Handle("POST /api/admin/users/{id}/mark-verified", admin(d.markVerified))
	mux.Handle("GET /api/admin/users/{id}/pats", admin(d.listUserPATs))
	mux.Handle("POST /api/admin/users/{id}/pats/{patID}/revoke", admin(d.revokeUserPAT))
	mux.Handle("DELETE /api/admin/users/{id}", admin(d.adminDeleteUser))
}

func opsNotWired(w http.ResponseWriter) {
	webx.ErrUnavailable(w, "user ops not wired")
}

func (d UserOpsDeps) userDetail(w http.ResponseWriter, r *http.Request, _ *webx.Principal) {
	if d.Ops == nil {
		opsNotWired(w)
		return
	}
	detail, err := d.Ops.GetUserDetail(r.Context(), r.PathValue("id"))
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, detail)
}

func (d UserOpsDeps) exportUserdata(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if d.Ops == nil {
		opsNotWired(w)
		return
	}
	id := r.PathValue("id")
	data, err := d.Ops.ExportUserdata(r.Context(), p, id)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="userdata-`+id+`.json"`)
	webx.WriteJSON(w, http.StatusOK, data)
}

func (d UserOpsDeps) kickUser(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if d.Ops == nil {
		opsNotWired(w)
		return
	}
	if err := d.Ops.KickUser(r.Context(), p, r.PathValue("id")); err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (d UserOpsDeps) revokeUserSession(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if d.Ops == nil {
		opsNotWired(w)
		return
	}
	if err := d.Ops.KickSession(r.Context(), p, r.PathValue("id"), r.PathValue("sid")); err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (d UserOpsDeps) adminResetPassword(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if d.Ops == nil {
		opsNotWired(w)
		return
	}
	if err := d.Ops.AdminResetPassword(r.Context(), p, r.PathValue("id")); err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (d UserOpsDeps) resendVerification(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if d.Ops == nil {
		opsNotWired(w)
		return
	}
	if err := d.Ops.ResendVerification(r.Context(), p, r.PathValue("id")); err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (d UserOpsDeps) markVerified(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if d.Ops == nil {
		opsNotWired(w)
		return
	}
	if err := d.Ops.MarkVerified(r.Context(), p, r.PathValue("id")); err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (d UserOpsDeps) listUserPATs(w http.ResponseWriter, r *http.Request, _ *webx.Principal) {
	if d.Ops == nil {
		opsNotWired(w)
		return
	}
	pats, err := d.Ops.ListUserPATs(r.Context(), r.PathValue("id"))
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{"items": pats, "total": len(pats)})
}

func (d UserOpsDeps) revokeUserPAT(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if d.Ops == nil {
		opsNotWired(w)
		return
	}
	if err := d.Ops.RevokeUserPAT(r.Context(), p, r.PathValue("id"), r.PathValue("patID")); err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (d UserOpsDeps) adminDeleteUser(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if d.Ops == nil {
		opsNotWired(w)
		return
	}
	confirm := r.URL.Query().Get("confirm")
	if confirm == "" {

		body, _ := io.ReadAll(io.LimitReader(r.Body, 8192))
		if len(body) > 0 {
			var req struct {
				Confirm string `json:"confirm"`
			}
			if err := json.Unmarshal(body, &req); err != nil || req.Confirm == "" {
				webx.ErrValidation(w, `confirm required: pass ?confirm=<target email> or body {"confirm": "<target email>"}`)
				return
			}
			confirm = req.Confirm
		}
	}
	if confirm == "" {
		webx.ErrValidation(w, `confirm required: pass ?confirm=<target email> or body {"confirm": "<target email>"}`)
		return
	}
	if err := d.Ops.AdminDeleteUser(r.Context(), p, r.PathValue("id"), confirm); err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
