package webx

import (
	"crypto/sha256"
	"net/http"
	"strings"

	"github.com/gorilla/csrf"
)

type CSRFConfig struct {
	Key []byte

	TrustedOrigins []string

	ExemptPrefixes []string

	PATPrefix string
}

func (c *CSRFConfig) patPrefix() string {
	if c.PATPrefix == "" {
		return DefaultPATPrefix
	}
	return c.PATPrefix
}

func DeriveCSRFKey(signingSecret []byte) []byte {
	prefix := []byte("ploykit-csrf-v1:")
	buf := make([]byte, 0, len(prefix)+len(signingSecret))
	buf = append(buf, prefix...)
	buf = append(buf, signingSecret...)
	h := sha256.Sum256(buf)
	return h[:]
}

func CSRFConditional(cfg *CSRFConfig, secure bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		var inner http.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r)
		})
		protected := csrf.Protect(cfg.Key,
			csrf.CookieName("ploykit_csrf"),
			csrf.Path("/"),
			csrf.Secure(secure), csrf.HttpOnly(true), csrf.SameSite(csrf.SameSiteLaxMode),
			csrf.TrustedOrigins(cfg.TrustedOrigins),

			csrf.ErrorHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				WriteError(w, http.StatusForbidden, CodeForbidden, "CSRF token missing or invalid", nil)
			})),
		)(inner)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			for _, prefix := range cfg.ExemptPrefixes {
				if strings.HasPrefix(r.URL.Path, prefix) {
					next.ServeHTTP(w, r)
					return
				}
			}
			if isPATRequest(r, cfg.patPrefix()) {
				next.ServeHTTP(w, r)
				return
			}
			if !secure {
				r = csrf.PlaintextHTTPRequest(r)
			}
			protected.ServeHTTP(w, r)
		})
	}
}

func isPATRequest(r *http.Request, patPrefix string) bool {
	if p := PrincipalFrom(r.Context()); p != nil && p.Source == SourcePAT {
		return true
	}
	return strings.HasPrefix(r.Header.Get("Authorization"), "Bearer "+patPrefix)
}

func CSRFMaskedToken(r *http.Request) string { return csrf.Token(r) }
