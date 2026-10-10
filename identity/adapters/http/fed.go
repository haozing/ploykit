package http

import (
	"net/http"
	"strings"

	"github.com/haozing/ploykit/identity/app"
	"github.com/haozing/ploykit/platform/webx"
)

func (d Deps) handleFedStart(w http.ResponseWriter, r *http.Request) {
	if d.Fed == nil {
		webx.ErrUnavailable(w, "fed login not configured")
		return
	}
	if err := d.Fed.Start(w, r, r.URL.Query().Get("workspace")); err != nil {
		webx.WriteErr(w, err)
	}
}

func (d Deps) handleFedCallback(w http.ResponseWriter, r *http.Request) {
	if d.Fed == nil {
		webx.ErrUnavailable(w, "fed login not configured")
		return
	}
	appURL := strings.TrimRight(d.OAuthAppURL, "/")
	fail := func() {
		http.Redirect(w, r, appURL+"/login?error=fed", http.StatusFound)
	}

	res, err := d.Fed.Callback(r.Context(), r, r.URL.Query().Get("code"), r.URL.Query().Get("state"),
		d.thirdPartySignupGate())
	clearFedLoginCookie(w)
	if err != nil {
		d.fireThirdPartyFailed(r, res.Email)
		fail()
		return
	}
	if !d.completeThirdPartySession(w, r, res) {
		fail()
		return
	}
	http.Redirect(w, r, appURL+"/app", http.StatusFound)
}

func clearFedLoginCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     app.FedLoginCookie,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func MountFedAdmin(mux webx.Router, d Deps) {
	guard := d.FedAdminGuard
	if guard == nil {
		panic("identity: MountFedAdmin requires Deps.FedAdminGuard (workspace owner/admin closure); nil guard would expose tenant SSO secrets")
	}
	mux.Handle("PUT /api/workspaces/{workspaceId}/sso", guard(http.HandlerFunc(d.putFedSSO)))
	mux.Handle("GET /api/workspaces/{workspaceId}/sso", guard(http.HandlerFunc(d.getFedSSO)))
	mux.Handle("DELETE /api/workspaces/{workspaceId}/sso", guard(http.HandlerFunc(d.deleteFedSSO)))
}

func (d Deps) putFedSSO(w http.ResponseWriter, r *http.Request) {
	if d.Fed == nil {
		webx.ErrUnavailable(w, "fed login not configured")
		return
	}
	var req struct {
		IssuerURL    string `json:"issuer_url"`
		ClientID     string `json:"client_id"`
		ClientSecret string `json:"client_secret"`
		Scopes       string `json:"scopes"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	row, err := d.Fed.UpsertProvider(r.Context(), r.PathValue("workspaceId"),
		req.IssuerURL, req.ClientID, req.ClientSecret, req.Scopes)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, maskFedSecret(row))
}

func (d Deps) getFedSSO(w http.ResponseWriter, r *http.Request) {
	if d.Fed == nil {
		webx.ErrUnavailable(w, "fed login not configured")
		return
	}
	row, ok, err := d.Fed.GetProvider(r.Context(), r.PathValue("workspaceId"))
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	if !ok {
		webx.ErrNotFound(w, "workspace sso not configured")
		return
	}
	webx.WriteJSON(w, http.StatusOK, maskFedSecret(row))
}

func (d Deps) deleteFedSSO(w http.ResponseWriter, r *http.Request) {
	if d.Fed == nil {
		webx.ErrUnavailable(w, "fed login not configured")
		return
	}
	if err := d.Fed.DeleteProvider(r.Context(), r.PathValue("workspaceId")); err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func maskFedSecret(row *app.FedProviderRow) *app.FedProviderRow {
	out := *row
	out.ClientSecret = app.FedSecretMask
	return &out
}
