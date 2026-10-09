package http

import (
	"net/http"

	"github.com/haozing/ploykit/platform/webx"
)

func (d Deps) handleForgotPassword(w http.ResponseWriter, r *http.Request) {
	if d.Account == nil {
		webx.ErrInternal(w)
		return
	}
	var req struct {
		Email string `json:"email"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	if err := d.Account.RequestPasswordReset(r.Context(), req.Email); err != nil {
		webx.WriteErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (d Deps) handleResetPassword(w http.ResponseWriter, r *http.Request) {
	if d.Account == nil {
		webx.ErrInternal(w)
		return
	}
	var req struct {
		Email       string `json:"email"`
		Token       string `json:"token"`
		NewPassword string `json:"new_password"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	if err := d.Account.ResetPassword(r.Context(), req.Email, req.Token, req.NewPassword); err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (d Deps) sendVerification(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if d.Account == nil {
		webx.ErrInternal(w)
		return
	}
	if err := d.Account.SendVerification(r.Context(), p); err != nil {
		webx.WriteErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (d Deps) handleVerifyEmail(w http.ResponseWriter, r *http.Request) {
	if d.Account == nil {
		webx.ErrInternal(w)
		return
	}
	var req struct {
		Email string `json:"email"`
		Token string `json:"token"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	if err := d.Account.VerifyEmail(r.Context(), req.Email, req.Token); err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
