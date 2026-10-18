package http

import (
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/google/uuid"

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
	token, exp, err := d.Sessions.CreateSession(r.Context(), webx.SessionCreate{
		UserID: res.UserID, IPHash: d.ipHash(r), UserAgent: r.UserAgent(), Now: time.Now().UTC(),
	})
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
	d.writeSessionEstablished(w, r, res)
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
	d.writeSessionEstablished(w, r, res)
}

// writeSessionEstablished returns the session payload plus the ALREADY
// ROTATED csrf token (aifengkong #2, the ROADMAP item): gorilla rotates
// before the handler runs and stores the NEW masked token in the request
// context — the same value the Set-Cookie on this response carries — so
// clients read csrf_token from the body and skip the re-fetch-/config round
// trip every integration had to hardcode after session establishment.
// The register flags (registered / provisioning_pending, ADR 0016) appear
// only when set — omitting them keeps every existing response byte-compatible.
func (d Deps) writeSessionEstablished(w http.ResponseWriter, r *http.Request, res *app.LoginResult) {
	payload := map[string]any{
		"user":       res.User,
		"expires_at": res.Exp,
		"csrf_token": webx.CSRFMaskedToken(r),
	}
	if res.Registered {
		payload["registered"] = true
	}
	if res.ProvisioningPending {
		payload["provisioning_pending"] = true
	}
	webx.WriteJSON(w, http.StatusOK, payload)
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
	d.writeSessionEstablished(w, r, res)
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
	// PATCH semantics (FP-16): absent fields keep their current values — the
	// old value-type decode zeroed whatever the request omitted, silently
	// wiping the avatar on a display_name-only update. Pointer fields make
	// "absent" distinguishable from "explicitly cleared" ("" clears).
	var req struct {
		DisplayName *string `json:"display_name"`
		AvatarURL   *string `json:"avatar_url"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	if req.DisplayName == nil && req.AvatarURL == nil {
		webx.ErrValidation(w, "nothing to update: provide display_name and/or avatar_url")
		return
	}
	current, err := d.SessionsSvc.Me(r.Context(), p)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	displayName, avatarURL := current.DisplayName, current.AvatarURL
	if req.DisplayName != nil {
		displayName = *req.DisplayName
	}
	if req.AvatarURL != nil {
		avatarURL = *req.AvatarURL
	}
	user, err := d.SessionsSvc.UpdateProfile(r.Context(), p, displayName, avatarURL)
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

// confirmPassword is the second half of the step-up protocol: after a
// 403 E_REAUTH_REQUIRED (webx.RequireRecentAuth) the client re-verifies the
// password here, then retries the original request.
func (d Deps) confirmPassword(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	var req struct {
		Password string `json:"password"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	confirmedAt, err := d.SessionsSvc.ConfirmPassword(r.Context(), d.ipHash(r), p, req.Password)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{"password_confirmed_at": confirmedAt})
}

func (d Deps) listSessions(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	list, err := d.SessionsSvc.ListSessions(r.Context(), p)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	if list == nil {
		list = []app.SessionInfo{}
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
	if list == nil {
		list = []app.PAT{}
	}
	webx.WriteJSON(w, http.StatusOK, list)
}

// maxScopeWorkspaceIDs caps the per-PAT workspace scope list: scope is
// security-boundary data and an unbounded list is a garbage-input magnet.
const maxScopeWorkspaceIDs = 32

// validatePATScope enforces the scope contract on the create face. The
// semantics live in webx.CredentialScope: nil (or a nil list) = unrestricted,
// a NON-NIL EMPTY list = allow nothing. The empty list is therefore an
// ambiguous request — rejected outright instead of minting a 201 token that
// can do nothing (orkome field report: exactly that token shipped silently).
// Workspace ids must be UUIDs — a stray string can never match a workspace
// and turns every later 403 into an unsolvable mystery.
func validatePATScope(scope *webx.CredentialScope) *webx.Error {
	if scope == nil {
		return nil
	}
	if len(scope.WorkspaceIDs) == 0 && scope.WorkspaceIDs != nil {
		return webx.NewValidation("scope.workspace_ids: an empty list means allow-nothing; omit the field for an unrestricted token, or list workspace ids")
	}
	if len(scope.Permissions) == 0 && scope.Permissions != nil {
		return webx.NewValidation("scope.permissions: an empty list means allow-nothing; omit the field for an unrestricted token, or list permissions")
	}
	if len(scope.WorkspaceIDs) > maxScopeWorkspaceIDs {
		return webx.NewValidation(fmt.Sprintf("scope.workspace_ids: %d entries exceeds the limit of %d", len(scope.WorkspaceIDs), maxScopeWorkspaceIDs))
	}
	for _, id := range scope.WorkspaceIDs {
		if _, err := uuid.Parse(id); err != nil {
			return webx.NewValidation(fmt.Sprintf("scope.workspace_ids: %q is not a workspace id (expected a uuid)", id))
		}
	}
	return nil
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
	if err := validatePATScope(req.Scope); err != nil {
		webx.WriteErr(w, err)
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
