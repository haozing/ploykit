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

	// MaxAge is the CSRF cookie lifetime in seconds, passed through to
	// gorilla/csrf verbatim (orkome pack-rollout addendum). Zero value keeps the framework's
	// historical behavior (gorilla's 12h default); a product whose session
	// TTL exceeds 12h must raise this or long-idle users hit "every write
	// 403s" until the next /config refetch (the cookie dies before the
	// session does) — align it with AuthConfig.SessionTTL. Negative means a
	// session cookie (gorilla semantics). The zero-value-defaults-to-12h
	// reading is deliberate: an unset config must not change existing
	// deployments' cookie behavior.
	MaxAge int

	PATPrefix string

	// SessionCookieName is the auth session cookie's name — the CSRF skip is
	// a clean bearer transport only; a request that also carries this cookie
	// is mixed and falls through to the CSRF check. Wire it to
	// AuthConfig.CookieName (empty = never treat requests as cookie-carrying).
	SessionCookieName string
}

// classifyTransport is the shared transport classifier (transport.go) with
// the CSRF config's own fields — same rule, same place, no drift.
func (c *CSRFConfig) classify(r *http.Request) TransportKind {
	return classifyTransport(c.SessionCookieName, c.patPrefix(), r)
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

				// Machine-readable marker: the API client keys on this to
				// self-heal (re-bootstrap a fresh masked token from /config
				// and retry once) instead of surfacing a dead-end 403.
				"csrf_rejected": true,
			})
		return
	}
	WriteError(w, http.StatusForbidden, CodeForbidden, "CSRF token missing or invalid",
		map[string]any{
			// Same self-heal marker as the origin branch above; reason names
			// the concrete gorilla failure (e.g. ErrNoCookie vs token
			// mismatch) for diagnosis.
			"csrf_rejected": true,
			"reason":        reason.Error(),
		})
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
	protected := func() http.Handler {
		// gorilla applies its 12h default only for NEGATIVE MaxAge (0 = session
		// cookie); an unset framework config must keep the historical 12h
		// cookie, so map 0 → gorilla-default here and pass everything else
		// through verbatim.
		age := cfg.MaxAge
		if age == 0 {
			age = -1
		}
		return csrf.Protect(cfg.Key,
			csrf.CookieName("ploykit_csrf"),
			csrf.Path("/"),
			csrf.Secure(secure), csrf.HttpOnly(true), csrf.SameSite(csrf.SameSiteLaxMode),
			csrf.TrustedOrigins(trusted),
			csrf.MaxAge(age),

			csrf.ErrorHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				writeCSRFError(w, r, trusted)
			})),
		)(inner)
	}()
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			for _, prefix := range cfg.ExemptPrefixes {
				if strings.HasPrefix(r.URL.Path, prefix) {
					next.ServeHTTP(w, r)
					return
				}
			}
			// The CSRF skip is a CLEAN bearer transport only (ADR 0013 batch
			// 3): a request that also carries the session cookie is mixed —
			// it falls through to the CSRF check, so the cookie can never
			// ride a skip keyed off the header credential. (The PAT principal
			// already in the context covers assemblies where the CSRF layer
			// sits inside Authenticate — such a principal can only have come
			// from a resolved bearer credential.)
			if cfg.classify(r) == TransportBearer {
				next.ServeHTTP(w, r)
				return
			}
			if p := PrincipalFrom(r.Context()); p != nil && p.Source == SourcePAT {
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

func CSRFMaskedToken(r *http.Request) string { return csrf.Token(r) }
