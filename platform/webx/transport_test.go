package webx

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// ADR 0013 batch 3 (G4): the operation's declared auth_method is a transport
// contract, enforced from a single classification that Authenticate, the CSRF
// layer, and the matcher all share. A request carrying two credentials is a
// rejection — never resolved by precedence (GitLab #22435 class).

const testPAT = "tk_" + "0123456789abcdef0123456789abcdef01234567"

func transportCfg() *AuthConfig {
	cfg := DefaultAuthConfig()
	cfg.CookieName = "tk_auth"
	return &cfg
}

func TestClassifyTransport(t *testing.T) {
	cfg := transportCfg()
	build := func(f func(r *http.Request)) *http.Request {
		r := httptest.NewRequest("POST", "/api/x", nil)
		f(r)
		return r
	}
	cookie := func(r *http.Request) { r.AddCookie(&http.Cookie{Name: "tk_auth", Value: "sess"}) }
	bearer := func(r *http.Request) { r.Header.Set("Authorization", "Bearer "+testPAT) }

	tests := []struct {
		name string
		req  *http.Request
		want TransportKind
	}{
		{"no credentials", build(func(*http.Request) {}), TransportNone},
		{"one session cookie", build(cookie), TransportSessionCookie},
		{"one bearer", build(bearer), TransportBearer},
		{"cookie + bearer", build(func(r *http.Request) { cookie(r); bearer(r) }), TransportMixed},
		{"duplicate session cookies", build(func(r *http.Request) {
			cookie(r)
			r.AddCookie(&http.Cookie{Name: "tk_auth", Value: "sess2"})
		}), TransportMixed},
		{"duplicate authorization headers", build(func(r *http.Request) {
			r.Header.Add("Authorization", "Bearer "+testPAT)
			r.Header.Add("Authorization", "Bearer "+testPAT)
		}), TransportMixed},
		{"foreign bearer alone is not our credential", build(func(r *http.Request) {
			r.Header.Set("Authorization", "Bearer some-upstream-token")
		}), TransportNone},
		{"empty cookie value counts as nothing", build(func(r *http.Request) {
			r.AddCookie(&http.Cookie{Name: "tk_auth", Value: ""})
		}), TransportNone},
		{"other cookies do not make a session", build(func(r *http.Request) {
			r.AddCookie(&http.Cookie{Name: "ploykit_csrf", Value: "x"})
		}), TransportNone},
		{"foreign bearer + session cookie stays session", build(func(r *http.Request) {
			cookie(r)
			r.Header.Set("Authorization", "Bearer foreign")
		}), TransportSessionCookie},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := cfg.ClassifyTransport(tc.req); got != tc.want {
				t.Fatalf("classify = %q, want %q", got, tc.want)
			}
		})
	}
}

// TestRequireTransportKindMatrix is the transport × requirement matrix: none
// → 401 unauthenticated; mixed → 401 E_AUTH_TRANSPORT_CONFLICT; present but
// not allowed → 403; allowed → passes. The rejection happens before any
// handler logic — the GitLab-shaped guarantee.
func TestRequireTransportKindMatrix(t *testing.T) {
	cfg := transportCfg()
	probe := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	requests := map[TransportKind]*http.Request{
		TransportNone:          httptest.NewRequest("POST", "/api/x", nil),
		TransportSessionCookie: reqWithCookie("tk_auth", "sess"),
		TransportBearer:        withHeader(httptest.NewRequest("POST", "/api/x", nil), "Authorization", "Bearer "+testPAT),
		TransportMixed: withHeader(func() *http.Request {
			r := reqWithCookie("tk_auth", "sess")
			return r
		}(), "Authorization", "Bearer "+testPAT),
	}

	for allowed := range map[TransportKind]bool{TransportSessionCookie: true, TransportBearer: true} {
		gate := RequireTransportKind(cfg, allowed)
		for sent, req := range requests {
			w := httptest.NewRecorder()
			gate(probe).ServeHTTP(w, req)
			var want int
			switch {
			case sent == TransportMixed:
				want = http.StatusUnauthorized
			case sent == TransportNone:
				want = http.StatusUnauthorized
			case sent == allowed:
				want = http.StatusOK
			default:
				want = http.StatusForbidden
			}
			if w.Code != want {
				t.Errorf("allowed=%v sent=%v: got %d, want %d", allowed, sent, w.Code, want)
			}
			if sent == TransportMixed && !strings.Contains(w.Body.String(), CodeAuthTransportConflict) {
				t.Errorf("mixed must carry %s, body: %s", CodeAuthTransportConflict, w.Body.String())
			}
		}
	}
}

func withHeader(r *http.Request, key, value string) *http.Request {
	r.Header.Set(key, value)
	return r
}

// TestAuthenticateRejectsMixedTransport pins the GitLab-#22435-shaped
// regression at the resolution layer: cookie + bearer on one request is
// rejected outright — the session store is never consulted with a bearer
// header present and vice versa.
func TestAuthenticateRejectsMixedTransport(t *testing.T) {
	cfg := transportCfg()
	sessions := &fakeSessions{p: &Principal{UserID: "u-session", Source: SourceSession}}
	pats := &fakePATs{p: &Principal{UserID: "u-pat", Source: SourcePAT}}

	mixed := reqWithCookie("tk_auth", "sess")
	mixed.Header.Set("Authorization", "Bearer "+testPAT)
	w, reached := doAuthCfg(t, cfg, sessions, pats, mixed)
	if reached {
		t.Fatal("mixed request must never reach the handler")
	}
	if w.Code != http.StatusUnauthorized || !strings.Contains(w.Body.String(), CodeAuthTransportConflict) {
		t.Fatalf("mixed: %d %s, want 401 %s", w.Code, w.Body.String(), CodeAuthTransportConflict)
	}
	if pats.called {
		t.Fatal("PAT resolution must not run for a mixed request")
	}

	// clean bearer resolves the PAT principal
	clean := httptest.NewRequest("GET", "/", nil)
	clean.Header.Set("Authorization", "Bearer "+testPAT)
	w, reached = doAuthCfg(t, cfg, sessions, pats, clean)
	if !reached || w.Code != http.StatusOK {
		t.Fatalf("clean bearer: reached=%v code=%d", reached, w.Code)
	}

	// clean cookie resolves the session principal
	w, reached = doAuthCfg(t, cfg, sessions, pats, reqWithCookie("tk_auth", "sess"))
	if !reached || w.Code != http.StatusOK {
		t.Fatalf("clean cookie: reached=%v code=%d", reached, w.Code)
	}

	// unauthenticated requests still fall through anonymously
	w, reached = doAuthCfg(t, cfg, sessions, pats, httptest.NewRequest("GET", "/", nil))
	if !reached || w.Code != http.StatusOK {
		t.Fatalf("anonymous: reached=%v code=%d", reached, w.Code)
	}
}

// TestCSRFSessionEnforcedBearerExempt pins the CSRF side of the transport
// contract: the session path enforces CSRF, the clean bearer path is exempt,
// and — the batch-3 fix — a request carrying BOTH never rides the bearer
// exemption.
func TestCSRFSessionEnforcedBearerExempt(t *testing.T) {
	key := make([]byte, 32)
	cfg := &CSRFConfig{
		Key:               key,
		SessionCookieName: "tk_auth",
	}
	h := CSRFConditional(cfg, false)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// clean bearer write: exempt
	r := httptest.NewRequest("POST", "/api/x", strings.NewReader(`{}`))
	r.Header.Set("Authorization", "Bearer "+testPAT)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("clean bearer write must be CSRF-exempt: %d %s", w.Code, w.Body.String())
	}

	// mixed write: the cookie drags it into the CSRF check
	mixed := reqWithCookie("tk_auth", "sess")
	mixed.Method = "POST"
	mixed.Header.Set("Authorization", "Bearer "+testPAT)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, mixed)
	if w.Code != http.StatusForbidden {
		t.Fatalf("mixed write must hit the CSRF check, not ride the bearer skip: %d", w.Code)
	}

	// session write without token: enforced (unchanged)
	sess := reqWithCookie("tk_auth", "sess")
	sess.Method = "POST"
	w = httptest.NewRecorder()
	h.ServeHTTP(w, sess)
	if w.Code != http.StatusForbidden {
		t.Fatalf("session write without CSRF token must be rejected: %d", w.Code)
	}
}
