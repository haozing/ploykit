package http

import (
	"net/http"
	"strings"

	"github.com/haozing/ploykit/identity/app"
	"github.com/haozing/ploykit/platform/webx"
)

func (d Deps) handleOAuthStart(w http.ResponseWriter, r *http.Request) {
	if d.OAuth == nil {
		webx.ErrUnavailable(w, "oauth not configured")
		return
	}
	if err := d.OAuth.Start(w, r, r.PathValue("provider")); err != nil {
		webx.WriteErr(w, err)
	}
}

func (d Deps) handleOAuthCallback(w http.ResponseWriter, r *http.Request) {
	if d.OAuth == nil {
		webx.ErrUnavailable(w, "oauth not configured")
		return
	}

	appURL := strings.TrimRight(d.OAuthAppURL, "/")
	fail := func() {
		http.Redirect(w, r, appURL+"/login?error=oauth", http.StatusFound)
	}

	res, err := d.OAuth.Callback(r.Context(), r, r.PathValue("provider"),
		r.URL.Query().Get("code"), r.URL.Query().Get("state"), d.thirdPartySignupGate())
	clearOAuthStateCookie(w)
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

func clearOAuthStateCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     app.OAuthStateCookie,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}
