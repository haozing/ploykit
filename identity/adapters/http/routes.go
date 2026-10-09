package http

import (
	"net"
	"net/http"

	"github.com/haozing/ploykit/identity/app"
	"github.com/haozing/ploykit/platform/webx"
)

type Deps struct {
	AuthCfg     webx.AuthConfig
	Sessions    webx.SessionStore
	PATs        webx.PATLookup
	SessionsSvc *app.SessionService
	Tokens      *app.TokenService

	Account *app.AccountService

	OAuth *app.OAuthService

	Fed *app.FedService

	FedAdminGuard func(http.Handler) http.Handler

	OAuthAppURL string

	TrustedProxies []*net.IPNet
}

func Routes(d Deps) http.Handler {
	mux := http.NewServeMux()
	Mount(mux, d)
	return webx.Authenticate(&d.AuthCfg, d.Sessions, d.PATs)(mux)
}

func Mount(mux *http.ServeMux, d Deps) {

	mux.HandleFunc("POST /auth/send-code", d.handleSendCode)
	mux.HandleFunc("POST /auth/verify-code", d.handleVerifyCode)
	mux.HandleFunc("POST /auth/register", d.handleRegister)
	mux.HandleFunc("POST /auth/login", d.handleLogin)

	mux.HandleFunc("GET /auth/oauth/{provider}/start", d.handleOAuthStart)
	mux.HandleFunc("GET /auth/oauth/{provider}/callback", d.handleOAuthCallback)

	mux.HandleFunc("GET /auth/fed/start", d.handleFedStart)
	mux.HandleFunc("GET /auth/fed/callback", d.handleFedCallback)

	mux.HandleFunc("POST /auth/forgot-password", d.handleForgotPassword)
	mux.HandleFunc("POST /auth/reset-password", d.handleResetPassword)
	mux.HandleFunc("POST /auth/send-verification", webx.RequireHuman(d.handle(d.sendVerification)))
	mux.HandleFunc("POST /auth/verify-email", d.handleVerifyEmail)

	mux.HandleFunc("POST /auth/logout", d.requireAuthFunc(d.logout))
	mux.HandleFunc("GET /auth/me", d.requireAuthFunc(d.me))
	mux.HandleFunc("PATCH /auth/me", d.requireAuthFunc(d.updateMe))
	mux.HandleFunc("DELETE /auth/me", webx.RequireHuman(d.handle(d.deleteMe)))
	mux.HandleFunc("POST /auth/change-password", webx.RequireHuman(d.handle(d.changePassword)))
	mux.HandleFunc("GET /auth/sessions", webx.RequireHuman(d.handle(d.listSessions)))
	mux.HandleFunc("DELETE /auth/sessions", webx.RequireHuman(d.handle(d.revokeAllSessions)))
	mux.HandleFunc("DELETE /auth/sessions/{sessionId}", webx.RequireHuman(d.handle(d.revokeSession)))

	mux.HandleFunc("GET /api/tokens", webx.RequireHuman(d.handle(d.listPATs)))
	mux.HandleFunc("POST /api/tokens", webx.RequireHuman(d.handle(d.createPAT)))
	mux.HandleFunc("DELETE /api/tokens/{id}", webx.RequireHuman(d.handle(d.revokePAT)))
}
