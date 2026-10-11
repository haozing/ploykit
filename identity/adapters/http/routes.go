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

	// MFA, when non-nil, mounts the TOTP flows (ADR 0013 batch 2):
	// /auth/mfa/* + POST /auth/verify-mfa. Nil = the capability is absent,
	// not degraded — MFA cannot half-exist.
	MFA *app.MFAService

	// MFAChangeGuard wraps the MFA settings-mutating routes (disable /
	// regenerate-backup-codes) in the product's step-up policy — e.g.
	// webx.RequireRecentAuth(15 * time.Minute), mirroring GitHub's
	// sudo-guarded 2FA settings. The window is product policy (no package
	// default). Nil = no guard (dev convenience; production should set it).
	MFAChangeGuard func(http.Handler) http.Handler

	// PATCreateGuard, when non-nil, wraps POST /api/tokens — the product's
	// gate for PAT creation (GitHub guards token generation behind sudo /
	// AAL2 step-up; the strong-profile road mounts its catalog middleware
	// here, the simple road webx.RequireRecentAuth / RequireRecentMFA).
	// Nil = creation needs only a human session.
	PATCreateGuard func(http.Handler) http.Handler

	OAuthAppURL string

	TrustedProxies []*net.IPNet
}

func Routes(d Deps) http.Handler {
	mux := http.NewServeMux()
	Mount(mux, d)
	return webx.Authenticate(&d.AuthCfg, d.Sessions, d.PATs)(mux)
}

func Mount(mux webx.Router, d Deps) {

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
	mux.HandleFunc("POST /auth/confirm-password", webx.RequireHuman(d.handle(d.confirmPassword)))
	if d.MFA != nil {
		MountMFA(mux, d)
	}
	mux.HandleFunc("GET /auth/sessions", webx.RequireHuman(d.handle(d.listSessions)))
	mux.HandleFunc("DELETE /auth/sessions", webx.RequireHuman(d.handle(d.revokeAllSessions)))
	mux.HandleFunc("DELETE /auth/sessions/{sessionId}", webx.RequireHuman(d.handle(d.revokeSession)))

	mux.HandleFunc("GET /api/tokens", webx.RequireHuman(d.handle(d.listPATs)))
	// PAT creation is the natural AAL2-grade operation (GitHub guards token
	// generation behind sudo): the product may mount its step-up gate via
	// PATCreateGuard (strong-profile middleware or static webx step-up).
	var patCreate http.Handler = webx.RequireHuman(d.handle(d.createPAT))
	if d.PATCreateGuard != nil {
		patCreate = d.PATCreateGuard(patCreate)
	}
	mux.Handle("POST /api/tokens", patCreate)
	mux.HandleFunc("DELETE /api/tokens/{id}", webx.RequireHuman(d.handle(d.revokePAT)))
}
