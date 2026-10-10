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

type SessionStore interface {
	CreateSession(ctx context.Context, userID, ipHash, userAgent string, now time.Time) (token string, exp time.Time, err error)

	VerifySession(ctx context.Context, token string, now time.Time) (*Principal, error)

	RenewSession(ctx context.Context, token string, now time.Time) (exp time.Time, renewed bool, err error)

	RevokeSession(ctx context.Context, token string) error
}

type PATLookup interface {
	ResolvePAT(ctx context.Context, token string, now time.Time) (*Principal, error)
}

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
// example wires it to SECURE_COOKIE the same way.
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

			if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer "+cfg.patPrefix()) {
				token := strings.TrimPrefix(h, "Bearer ")
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
			}

			ck, err := r.Cookie(cfg.CookieName)
			if err != nil || ck.Value == "" {
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}
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
