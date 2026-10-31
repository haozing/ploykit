package http

import (
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"

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

	// BotGuard, when non-nil, wraps the bot-facing auth routes (register /
	// send-code / forgot-password / send-verification) in the product's
	// human verification — e.g. webx.Turnstile (Cloudflare). On
	// send-verification it sits OUTSIDE RequireHuman: a bot must be judged
	// before it can elicit a session-verdict. login / verify-code /
	// reset-password stay unguarded (per-IP rate limiting is their defense;
	// adding the guard there is product policy, one line away). Nil = the
	// capability is absent, behavior unchanged.
	BotGuard func(http.Handler) http.Handler

	// OAuthAppURL is where OAuth success/failure 302s land (the product's
	// public origin). When OAuth is wired and this still points at loopback,
	// Mount logs a warning — the shuijing 2026-10-31 deployment enabled
	// Google login in production without setting it, sending successful
	// logins to a dead localhost:5173 (the dev default had never been
	// exercised because OAuth had never been enabled before).
	OAuthAppURL string

	TrustedProxies []*net.IPNet
}

func Routes(d Deps) http.Handler {
	mux := http.NewServeMux()
	Mount(mux, d)
	return webx.Authenticate(&d.AuthCfg, d.Sessions, d.PATs)(mux)
}

// botGuard applies d.BotGuard when the capability is present; nil passes the
// handler through untouched — products that mount no human verification must
// observe zero difference (the framework compatibility floor).
func (d Deps) botGuard(h http.Handler) http.Handler {
	if d.BotGuard == nil {
		return h
	}
	return d.BotGuard(h)
}

// isLoopbackURL reports whether the given absolute URL targets the local
// machine (localhost / 127.x / ::1 host). Unparseable or hostless input is
// NOT loopback — the warning is for the specific "dev default survived"
// misconfiguration, and a strange URL should not trip it.
func isLoopbackURL(raw string) bool {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return false
	}
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" {
		return false
	}
	h := strings.ToLower(strings.Trim(u.Hostname(), "[]"))
	if h == "localhost" || strings.HasSuffix(h, ".localhost") {
		return true
	}
	if ip := net.ParseIP(h); ip != nil {
		return ip.IsLoopback()
	}
	return false
}

func Mount(mux webx.Router, d Deps) {
	// Boot-time sanity check (shuijing field report 2026-10-31): OAuth wired
	// but the 302 landing URL is still loopback is almost always the dev
	// default surviving into a real deployment — the FIRST OAuth login would
	// silently redirect to a dead localhost. One warning per boot; local dev
	// with OAuth credentials configured also sees it (harmless, and a fair
	// reminder of where callbacks land). Deliberately not tied to
	// OAuth.Names(): with a provider source the boot-time name list can be
	// empty and fill in 30s later, so names would under-report.
	if d.OAuth != nil && isLoopbackURL(d.OAuthAppURL) {
		slog.Warn("identity: OAuth is enabled but OAuthAppURL points at loopback — "+
			"OAuth success/failure will redirect there; if this is a production "+
			"deployment set APP_URL to the public origin (dev: safe to ignore)",
			"oauth_app_url", d.OAuthAppURL)
	}

	// Bot-facing entry points (register / send-code / forgot-password /
	// send-verification) take the product's human-verification guard via
	// Deps.BotGuard — OUTERMOST on send-verification (a bot is judged before
	// it can elicit a session verdict). Pattern literals stay inline: the
	// check_api route scanner greps them off these calls.
	mux.Handle("POST /auth/send-code", d.botGuard(http.HandlerFunc(d.handleSendCode)))
	mux.HandleFunc("POST /auth/verify-code", d.handleVerifyCode)
	mux.Handle("POST /auth/register", d.botGuard(http.HandlerFunc(d.handleRegister)))
	mux.HandleFunc("POST /auth/login", d.handleLogin)

	mux.HandleFunc("GET /auth/oauth/{provider}/start", d.handleOAuthStart)
	mux.HandleFunc("GET /auth/oauth/{provider}/callback", d.handleOAuthCallback)

	mux.HandleFunc("GET /auth/fed/start", d.handleFedStart)
	mux.HandleFunc("GET /auth/fed/callback", d.handleFedCallback)

	mux.Handle("POST /auth/forgot-password", d.botGuard(http.HandlerFunc(d.handleForgotPassword)))
	mux.HandleFunc("POST /auth/reset-password", d.handleResetPassword)
	mux.Handle("POST /auth/send-verification", d.botGuard(webx.RequireHuman(d.handle(d.sendVerification))))
	mux.HandleFunc("POST /auth/verify-email", d.handleVerifyEmail)

	mux.HandleFunc("POST /auth/logout", d.requireAuthFunc(d.logout))
	// GET /auth/me 走 meOptional：匿名 200 {authenticated:false}（见
	// meOptional 注释）；变更类端点（PATCH/DELETE /auth/me）保持 401。
	mux.HandleFunc("GET /auth/me", d.meOptional)
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
