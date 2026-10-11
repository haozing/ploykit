package webx

import (
	"log/slog"
	"net/http"
	"strings"
)

// TransportKind is the authentication transport a request arrived on — the
// per-operation transport contract of ADR 0013 batch 3 (G4): the operation's
// declared auth_method is only as strong as the transport it accepts, and a
// request carrying TWO credentials must never be resolved by picking one
// silently (GitLab #22435 class: CSRF decisions keyed off one credential
// while the other authenticates).
//
// The kinds are deliberately neutral — webx never imports authorization/
// (arch A6 cuts both ways); the catalog auth_method → kind mapping is five
// lines at the composition root.
type TransportKind string

const (
	// TransportNone: no credential on the wire.
	TransportNone TransportKind = "none"
	// TransportSessionCookie: exactly one session cookie, no bearer header.
	TransportSessionCookie TransportKind = "session_cookie"
	// TransportBearer: exactly one well-formed Authorization: Bearer header,
	// no session cookie.
	TransportBearer TransportKind = "bearer"
	// TransportMixed: both credentials (or an ambiguous duplicate of one) on
	// the same request — always a rejection, never resolved by precedence.
	TransportMixed TransportKind = "mixed"
)

// ClassifyTransport inspects the raw request (no store lookups) and names
// its auth transport. Strictness is the point:
//
//   - exactly one session cookie → session_cookie; more than one cookie with
//     the configured name (domain/path shadowing) is ambiguous → mixed;
//   - exactly one `Authorization: Bearer <prefix…>` header (the configured
//     PAT prefix — foreign bearer schemes are not our credentials) → bearer;
//     several Authorization headers → mixed;
//   - cookie AND bearer present → mixed.
//
// Authenticate resolves sessions and PATs through this single
// classification, so "which credential authenticated" and "which transport
// the gate saw" can never diverge.
func (c *AuthConfig) ClassifyTransport(r *http.Request) TransportKind {
	return classifyTransport(c.CookieName, c.patPrefix(), r)
}

func classifyTransport(cookieName, patPrefix string, r *http.Request) TransportKind {
	sessionCookies := 0
	for _, ck := range r.Cookies() {
		if ck.Name == cookieName && ck.Value != "" {
			sessionCookies++
		}
	}
	ours := "Bearer " + patPrefix
	bearerCount := 0
	auths := r.Header.Values("Authorization")
	for _, h := range auths {
		if strings.HasPrefix(h, ours) {
			bearerCount++
		}
	}
	switch {
	case len(auths) > 1: // duplicate Authorization headers: ambiguous → mixed
		return TransportMixed
	case sessionCookies > 1:
		return TransportMixed
	case sessionCookies == 1 && bearerCount > 0:
		return TransportMixed
	case sessionCookies == 1:
		return TransportSessionCookie
	case bearerCount > 0:
		return TransportBearer
	default:
		return TransportNone
	}
}

// RequireTransportKind rejects requests whose transport is not one of kinds.
// Mount it before any handler logic runs — a transport violation terminates
// the request before authentication, authorization, or CSRF can form an
// opinion on the "wrong" credential (that ordering is the GitLab-#22435
// lesson).
//
//   - mixed transport → 401 E_AUTH_TRANSPORT_CONFLICT always (a security
//     signal worth its own log line, never silently disambiguated);
//   - no credential → 401 E_UNAUTHENTICATED;
//   - a present-but-not-allowed transport → 403 E_FORBIDDEN (the caller
//     authenticated, this transport may not perform the operation).
//
// Typical mount: RequireTransportKind(&cfg, TransportBearer) in front of a
// machine-only endpoint. Session-only and multi-transport routes keep their
// ordinary auth middleware — this matcher is opt-in per operation class.
func RequireTransportKind(cfg *AuthConfig, kinds ...TransportKind) func(http.Handler) http.Handler {
	allowed := make(map[TransportKind]bool, len(kinds))
	for _, k := range kinds {
		allowed[k] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch kind := cfg.ClassifyTransport(r); {
			case kind == TransportMixed:
				// a security signal worth its own log line (ADR 0013 batch 3):
				// two credentials on one request is rarely an accident
				slog.Warn("webx: mixed auth transport rejected", "path", r.URL.Path,
					"method", r.Method)
				WriteError(w, http.StatusUnauthorized, CodeAuthTransportConflict,
					"request carries multiple authentication credentials (session cookie and bearer token); send exactly one", nil)
			case kind == TransportNone:
				ErrUnauthenticated(w, "authentication required")
			case !allowed[kind]:
				ErrForbidden(w, "operation requires transport "+string(kind))
			default:
				next.ServeHTTP(w, r)
			}
		})
	}
}
