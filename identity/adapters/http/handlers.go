package http

import (
	"net"
	"net/http"
	"time"

	"github.com/haozing/ploykit/identity/app"
	"github.com/haozing/ploykit/platform/webx"
)

func (d Deps) handle(fn func(w http.ResponseWriter, r *http.Request, p *webx.Principal)) http.HandlerFunc {
	return d.requireAuthFunc(fn)
}

func (d Deps) requireAuthFunc(fn func(w http.ResponseWriter, r *http.Request, p *webx.Principal)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		p := webx.PrincipalFromRequest(r)
		if p == nil {
			webx.ErrUnauthenticated(w, "authentication required")
			return
		}
		fn(w, r, p)
	}
}

func realIP(r *http.Request, trustedProxies []*net.IPNet) string {
	return webx.ClientIP(r, trustedProxies...)
}

func (d Deps) ipHash(r *http.Request) string {
	return webx.HashIP(realIP(r, d.TrustedProxies), d.AuthCfg.IPHashSecret)
}

func (d Deps) thirdPartySignupGate() app.SignupGateCheck {
	if d.SessionsSvc == nil {
		return nil
	}
	return d.SessionsSvc.SignupBlocked
}

func (d Deps) fireThirdPartyFailed(r *http.Request, email string) {
	if d.SessionsSvc != nil {
		d.SessionsSvc.FireOnLoginFailed(r.Context(), email, d.ipHash(r))
	}
}

func (d Deps) completeThirdPartySession(w http.ResponseWriter, r *http.Request, res app.ThirdPartyLinkResult) bool {
	if d.SessionsSvc != nil {
		login, err := d.SessionsSvc.CompleteThirdPartyLogin(r.Context(), res.UserID, res.JITNew, d.ipHash(r), r.UserAgent())
		if err != nil {
			return false
		}
		d.AuthCfg.SetSessionCookie(w, login.Token, login.Exp)
		return true
	}
	token, exp, err := d.Sessions.CreateSession(r.Context(), res.UserID, d.ipHash(r), r.UserAgent(), time.Now().UTC())
	if err != nil {
		return false
	}
	d.AuthCfg.SetSessionCookie(w, token, exp)
	return true
}

func sessionToken(d Deps, r *http.Request) string {
	ck, err := r.Cookie(d.AuthCfg.CookieName)
	if err != nil {
		return ""
	}
	return ck.Value
}

func (d Deps) handleSendCode(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string `json:"email"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	if err := d.SessionsSvc.SendCode(r.Context(), d.ipHash(r), req.Email); err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]string{"status": "sent"})
}

func (d Deps) handleVerifyCode(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string `json:"email"`
		Code  string `json:"code"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	res, err := d.SessionsSvc.VerifyCode(r.Context(), d.ipHash(r), r.UserAgent(), req.Email, req.Code)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	d.AuthCfg.SetSessionCookie(w, res.Token, res.Exp)
	webx.WriteJSON(w, http.StatusOK, map[string]any{"user": res.User, "expires_at": res.Exp})
}

func (d Deps) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email       string `json:"email"`
		Password    string `json:"password"`
		DisplayName string `json:"display_name"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	res, err := d.SessionsSvc.Register(r.Context(), d.ipHash(r), r.UserAgent(), req.Email, req.Password, req.DisplayName)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	d.AuthCfg.SetSessionCookie(w, res.Token, res.Exp)
	webx.WriteJSON(w, http.StatusOK, map[string]any{"user": res.User, "expires_at": res.Exp})
}

func (d Deps) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	res, err := d.SessionsSvc.LoginWithPassword(r.Context(), d.ipHash(r), r.UserAgent(), req.Email, req.Password)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	d.AuthCfg.SetSessionCookie(w, res.Token, res.Exp)
	webx.WriteJSON(w, http.StatusOK, map[string]any{"user": res.User, "expires_at": res.Exp})
}

func (d Deps) logout(w http.ResponseWriter, r *http.Request, _ *webx.Principal) {
	if token := sessionToken(d, r); token != "" {
		_ = d.SessionsSvc.Logout(r.Context(), token)
	}
	d.AuthCfg.ClearSessionCookie(w)
	webx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

type meResponse struct {
	app.User
	ImpersonatedBy string `json:"impersonated_by,omitempty"`
}

func (d Deps) me(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	res, err := d.SessionsSvc.Me(r.Context(), p)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, meResponse{User: res, ImpersonatedBy: p.ImpersonatedBy})
}

func (d Deps) updateMe(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	var req struct {
		DisplayName string `json:"display_name"`
		AvatarURL   string `json:"avatar_url"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	user, err := d.SessionsSvc.UpdateProfile(r.Context(), p, req.DisplayName, req.AvatarURL)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, user)
}

func (d Deps) changePassword(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	var req struct {
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	res, err := d.SessionsSvc.ChangePassword(r.Context(), p, req.OldPassword, req.NewPassword)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	d.AuthCfg.SetSessionCookie(w, res.Token, res.Exp)
	webx.WriteJSON(w, http.StatusOK, map[string]any{"expires_at": res.Exp})
}

func (d Deps) listSessions(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	list, err := d.SessionsSvc.ListSessions(r.Context(), p)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}

	for i := range list {
		list[i].Current = list[i].ID == p.SessionID
	}
	webx.WriteJSON(w, http.StatusOK, list)
}

func (d Deps) revokeSession(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if err := d.SessionsSvc.RevokeSessionByID(r.Context(), p, r.PathValue("sessionId")); err != nil {
		webx.WriteErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (d Deps) revokeAllSessions(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if err := d.SessionsSvc.RevokeAllSessions(r.Context(), p); err != nil {
		webx.WriteErr(w, err)
		return
	}
	d.AuthCfg.ClearSessionCookie(w)
	webx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (d Deps) deleteMe(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if d.Account == nil {
		webx.ErrInternal(w)
		return
	}
	if err := d.Account.DeleteAccount(r.Context(), p); err != nil {
		webx.WriteErr(w, err)
		return
	}
	d.AuthCfg.ClearSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

func (d Deps) listPATs(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	list, err := d.Tokens.ListPATs(r.Context(), p)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, list)
}

func (d Deps) createPAT(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	var req struct {
		Name     string `json:"name"`
		TTLHours int    `json:"ttl_hours"`

		Scope *webx.CredentialScope `json:"scope"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	var ttl time.Duration
	if req.TTLHours > 0 {
		ttl = time.Duration(req.TTLHours) * time.Hour
	}
	pat, token, err := d.Tokens.CreatePAT(r.Context(), p, req.Name, ttl, req.Scope)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusCreated, map[string]any{"pat": pat, "token": token})
}

func (d Deps) revokePAT(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if err := d.Tokens.RevokePAT(r.Context(), p, r.PathValue("id")); err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
