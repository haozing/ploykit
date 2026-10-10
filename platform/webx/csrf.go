package webx

import (
	"crypto/sha256"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/gorilla/csrf"
)

type CSRFConfig struct {
	Key []byte

	// TrustedOrigins lists host[:port] entries gorilla/csrf accepts as
	// cross-origin submitters. Matching is exact, port included.
	TrustedOrigins []string

	// TrustLocalhostAnyPort is a development convenience: when set, the
	// loopback family (localhost, 127.0.0.1, [::1]) is trusted on ANY port,
	// so a dev server drifting off its default port (vite 5173 -> 5176 when
	// 5173 is taken) does not turn every write into an opaque 403. Leave it
	// off in production; production must enumerate exact origins.
	TrustLocalhostAnyPort bool

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

// loopbackBareOrigins are the portless hosts registered in gorilla/csrf's
// exact-match list when TrustLocalhostAnyPort is set. Request origins from
// the loopback family are port-stripped to one of these before the check,
// which is how "any port" is expressed against exact host[:port] matching.
var loopbackBareOrigins = []string{"localhost", "127.0.0.1", "[::1]"}

func isLoopbackHostPort(hostport string) bool {
	host := hostport
	if h, _, err := net.SplitHostPort(hostport); err == nil {
		host = h
	}
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

// normalizeLoopbackOrigin strips the port from a loopback-family origin or
// referer value. Returns ok=false for non-loopback hosts and unparsable
// values, which must reach the CSRF check untouched.
func normalizeLoopbackOrigin(value string) (string, bool) {
	if value == "" {
		return "", false
	}
	u, err := url.Parse(value)
	if err != nil || u.Host == "" || !isLoopbackHostPort(u.Host) {
		return "", false
	}
	if h := u.Hostname(); strings.Contains(h, ":") {
		u.Host = "[" + h + "]" // url.URL.Host keeps IPv6 brackets
	} else {
		u.Host = h
	}
	return u.String(), true
}

func withLoopbackOriginNormalized(r *http.Request) *http.Request {
	origin, originOK := normalizeLoopbackOrigin(r.Header.Get("Origin"))
	referer, refererOK := normalizeLoopbackOrigin(r.Header.Get("Referer"))
	if !originOK && !refererOK {
		return r
	}
	r = r.Clone(r.Context())
	if originOK {
		r.Header.Set("Origin", origin)
	}
	if refererOK {
		r.Header.Set("Referer", referer)
	}
	return r
}

func writeCSRFError(w http.ResponseWriter, r *http.Request, trusted []string) {
	reason := csrf.FailureReason(r)
	if errors.Is(reason, csrf.ErrBadOrigin) || errors.Is(reason, csrf.ErrNoReferer) || errors.Is(reason, csrf.ErrBadReferer) {
		// "login works, reads work, every write 403s" is almost always an
		// Origin/TrustedOrigins port mismatch; make the 403 name it instead
		// of hiding behind "token invalid".
		WriteError(w, http.StatusForbidden, CodeForbidden,
			"CSRF origin check failed: request Origin is not in the trusted origins list",
			map[string]any{
				"origin_check":    "failed",
				"request_origin":  r.Header.Get("Origin"),
				"request_referer": r.Referer(),
				"trusted_origins": trusted,
				"reason":          reason.Error(),
			})
		return
	}
	WriteError(w, http.StatusForbidden, CodeForbidden, "CSRF token missing or invalid", nil)
}

func CSRFConditional(cfg *CSRFConfig, secure bool) func(http.Handler) http.Handler {
	trusted := cfg.TrustedOrigins
	if cfg.TrustLocalhostAnyPort {
		trusted = append(append([]string{}, cfg.TrustedOrigins...), loopbackBareOrigins...)
	}
	return func(next http.Handler) http.Handler {
		var inner http.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r)
		})
		protected := csrf.Protect(cfg.Key,
			csrf.CookieName("ploykit_csrf"),
			csrf.Path("/"),
			csrf.Secure(secure), csrf.HttpOnly(true), csrf.SameSite(csrf.SameSiteLaxMode),
			csrf.TrustedOrigins(trusted),

			csrf.ErrorHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				writeCSRFError(w, r, trusted)
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
			if cfg.TrustLocalhostAnyPort {
				r = withLoopbackOriginNormalized(r)
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
