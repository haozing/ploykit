package webx

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"
)

// SessionCreate carries the inputs of SessionStore.CreateSession.
type SessionCreate struct {
	UserID    string
	IPHash    string
	UserAgent string

	// PasswordConfirmed marks a session born right after an explicit password
	// proof (password login, registration, password change). Such sessions
	// start with PasswordConfirmedAt set and satisfy RequireRecentAuth
	// immediately; code/third-party logins stay unconfirmed until the caller
	// completes a step-up (POST /auth/confirm-password).
	PasswordConfirmed bool

	// MFAConfirmed marks a session born from a login that completed the
	// second factor (TOTP / backup code). Such sessions start with
	// MFAConfirmedAt set and satisfy RequireRecentMFA immediately;
	// password-only logins stay MFA-unconfirmed until the caller completes
	// POST /auth/verify-mfa. Password-only and MFA-only births are both
	// expressible — the two stamps are independent facts (ADR 0013 batch 2:
	// a login completing MFA stamps both, a password-only login only the
	// password fact).
	MFAConfirmed bool

	Now time.Time
}

type SessionStore interface {
	CreateSession(ctx context.Context, in SessionCreate) (token string, exp time.Time, err error)

	VerifySession(ctx context.Context, token string, now time.Time) (*Principal, error)

	RenewSession(ctx context.Context, token string, now time.Time) (exp time.Time, renewed bool, err error)

	RevokeSession(ctx context.Context, token string) error
}

type PATLookup interface {
	ResolvePAT(ctx context.Context, token string, now time.Time) (*Principal, error)
}

// DefaultPATPrefix is the canonical PAT token prefix: webx parses the Bearer
// token with it, wsx.DefaultPATPrefix aliases it for WebSocket first-frame
// auth, and identity/domain keeps a mirrored constant (domain purity — pure
// stdlib, no framework import). internal/arch's parity test pins the three
// together; changing the prefix means changing them in lockstep and handling
// already-stored tokens.
const DefaultPATPrefix = "tk_"

type AuthConfig struct {
	CookieName string

	CookieDomain string
	Secure       bool

	SessionTTL  time.Duration
	AbsoluteTTL time.Duration

	IPHashSecret string

	PATPrefix string
}

func (c *AuthConfig) patPrefix() string {
	if c.PATPrefix == "" {
		return DefaultPATPrefix
	}
	return c.PATPrefix
}

// DefaultAuthConfig returns the shared defaults. Secure defaults to **false**:
// a production-true default made every local-HTTP / intranet deployment fail
// login with an opaque CSRF error (the Secure cookie is never sent back over
// plain HTTP — two layers away from the root cause, see aiblog/risk-engine
// field reports). Production deployments must opt in explicitly:
//
//	cfg := webx.DefaultAuthConfig()
//	cfg.Secure = env == "production"
//
// IPHashSecret is deliberately left empty here (local development needs no
// salt) and MUST be set in production: it keys the IP fingerprint used by
// login throttling and step-up re-authentication, and an empty salt makes
// those fingerprints enumerable. HashIP logs a one-time warning when it sees
// an empty salt, but a warning is easy to miss in a busy boot log — wire
// devx.IPHashSaltCheck into the product's doctor so the gap shows up as a
// failed startup diagnostic instead.
//
// example wires it to SECURE_COOKIE / AUTH_IP_HASH_SECRET the same way.
func DefaultAuthConfig() AuthConfig {
	return AuthConfig{
		CookieName:  "tk_auth",
		SessionTTL:  7 * 24 * time.Hour,
		AbsoluteTTL: 30 * 24 * time.Hour,
		Secure:      false,
	}
}

func MintToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func HashToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}

var warnEmptyIPHashSalt sync.Once

func HashIP(ip, secret string) string {
	if secret == "" {
		warnEmptyIPHashSalt.Do(func() {
			slog.Warn("webx: HashIP called with empty IPHashSecret — IP fingerprints are enumerable; set AuthConfig.IPHashSecret for production")
		})
	}
	h := sha256.Sum256([]byte("tk-ip:" + secret + ":" + ip))
	return hex.EncodeToString(h[:])
}

func Authenticate(cfg *AuthConfig, sessions SessionStore, pats PATLookup) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()
			now := time.Now()

			// The transport classification is the single source of truth for
			// which credential this request carries (ADR 0013 batch 3): a
			// mixed request is rejected outright — never resolved by picking
			// one credential while the other silently steers CSRF or
			// authorization gates (GitLab #22435 class).
			switch cfg.ClassifyTransport(r) {
			case TransportBearer:
				token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
				p, err := pats.ResolvePAT(ctx, token, now)
				if err != nil {

					ErrUnavailable(w, "认证服务暂不可用")
					return
				}
				if p == nil {
					ErrUnauthenticated(w, "invalid token")
					return
				}
				fillPrincipalCell(ctx, p)
				next.ServeHTTP(w, r.WithContext(WithPrincipal(ctx, p)))
				return
			case TransportMixed:
				slog.Warn("webx: mixed auth transport rejected", "path", r.URL.Path,
					"method", r.Method)
				WriteError(w, http.StatusUnauthorized, CodeAuthTransportConflict,
					"request carries multiple authentication credentials (session cookie and bearer token); send exactly one", nil)
				return
			case TransportSessionCookie:
				ck, _ := r.Cookie(cfg.CookieName)
				p, err := sessions.VerifySession(ctx, ck.Value, now)
				if err != nil {
					ErrUnavailable(w, "认证服务暂不可用")
					return
				}
				if p == nil {

					next.ServeHTTP(w, r.WithContext(ctx))
					return
				}

				exp, renewed, err := sessions.RenewSession(ctx, ck.Value, now)
				if err == nil && renewed {
					cfg.SetSessionCookie(w, ck.Value, exp)
				}
				fillPrincipalCell(ctx, p)
				next.ServeHTTP(w, r.WithContext(WithPrincipal(ctx, p)))
				return
			default: // TransportNone: fall through unauthenticated
				next.ServeHTTP(w, r.WithContext(ctx))
			}
		})
	}
}

func (c *AuthConfig) SetSessionCookie(w http.ResponseWriter, token string, exp time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name: c.CookieName, Value: token, Path: "/",
		Domain:   c.CookieDomain,
		Expires:  exp,
		HttpOnly: true, Secure: c.Secure, SameSite: http.SameSiteLaxMode,
	})
}

func (c *AuthConfig) ClearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: c.CookieName, Value: "", Path: "/", Domain: c.CookieDomain,
		MaxAge: -1, HttpOnly: true, Secure: c.Secure, SameSite: http.SameSiteLaxMode,
	})
}
