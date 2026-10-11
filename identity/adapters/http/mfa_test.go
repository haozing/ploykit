package http_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	httplib "github.com/haozing/ploykit/identity/adapters/http"
	"github.com/haozing/ploykit/identity/app"
	"github.com/haozing/ploykit/platform/webx"
)

// The MFA mount (ADR 0013 batch 2): settings-mutating routes sit behind the
// product's MFAChangeGuard — a session without a fresh password confirmation
// is challenged, a machine principal gets a plain 403 (it can never complete
// an interactive proof).

type fakeMFARepo struct {
	app.MFARepo
}

func newMFAGuardedRoutes(t *testing.T) http.Handler {
	t.Helper()
	repo := &fakeRepo{}
	sessions := app.NewSessionService(repo, nil, app.SessionConfig{}, time.Hour, 2*time.Hour, time.Now)
	mfa := app.NewMFAService(&fakeMFARepo{}, sessions, nil, "ploykit-test", time.Now)
	return httplib.Routes(httplib.Deps{
		AuthCfg:        webx.DefaultAuthConfig(),
		Sessions:       &mfaFakeSessions{p: mfaSessionPrincipal(false)},
		PATs:           &mfaFakePATs{p: mfaPATPrincipal()},
		SessionsSvc:    sessions,
		MFA:            mfa,
		MFAChangeGuard: webx.RequireRecentAuth(15 * time.Minute),
	})
}

func mfaSessionPrincipal(fresh bool) *webx.Principal {
	p := &webx.Principal{
		UserID: "u-1", Email: "u@example.test", Source: webx.SourceSession, SessionID: "s-1",
	}
	if fresh {
		p.PasswordConfirmedAt = time.Now()
	}
	return p
}

func mfaPATPrincipal() *webx.Principal {
	return &webx.Principal{UserID: "u-1", Source: webx.SourcePAT, PATID: "pat-1"}
}

type mfaFakeSessions struct{ p *webx.Principal }

func (f *mfaFakeSessions) CreateSession(context.Context, webx.SessionCreate) (string, time.Time, error) {
	return "token", time.Now().Add(time.Hour), nil
}
func (f *mfaFakeSessions) VerifySession(context.Context, string, time.Time) (*webx.Principal, error) {
	return f.p, nil
}
func (f *mfaFakeSessions) RenewSession(context.Context, string, time.Time) (time.Time, bool, error) {
	return time.Now().Add(time.Hour), false, nil
}
func (f *mfaFakeSessions) RevokeSession(context.Context, string) error { return nil }

type mfaFakePATs struct{ p *webx.Principal }

func (f *mfaFakePATs) ResolvePAT(context.Context, string, time.Time) (*webx.Principal, error) {
	return f.p, nil
}

func postMFA(t *testing.T, h http.Handler, path, auth string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequest("POST", path, nil)
	if auth == "session" {
		req.AddCookie(&http.Cookie{Name: "tk_auth", Value: "token"})
	} else if auth == "pat" {
		req.Header.Set("Authorization", "Bearer tk_"+mfaTestToken)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	return w.Code, body
}

const mfaTestToken = "0123456789abcdef0123456789abcdef01234567"

func TestMFADisableChallengedWithoutRecentAuth(t *testing.T) {
	h := newMFAGuardedRoutes(t)

	// session with a never-confirmed password → step-up challenge, not a
	// permission denial
	code, body := postMFA(t, h, "/auth/mfa/disable", "session")
	require.Equal(t, http.StatusForbidden, code)
	require.Equal(t, webx.CodeReauthRequired, body["error"])
	details := body["details"].(map[string]any)
	require.Equal(t, "password", details["factor"])

	code, body = postMFA(t, h, "/auth/mfa/regenerate-backup-codes", "session")
	require.Equal(t, http.StatusForbidden, code)
	require.Equal(t, webx.CodeReauthRequired, body["error"])

	// anonymous → 401 at the guard
	code, _ = postMFA(t, h, "/auth/mfa/disable", "anon")
	require.Equal(t, http.StatusUnauthorized, code)
}

func TestMFAMachinePrincipalPlainForbidden(t *testing.T) {
	h := newMFAGuardedRoutes(t)

	// PAT callers get a plain 403 — machines cannot reauthenticate
	// interactively, so they must never be coaxed through a challenge
	code, body := postMFA(t, h, "/auth/mfa/disable", "pat")
	require.Equal(t, http.StatusForbidden, code)
	require.NotEqual(t, webx.CodeReauthRequired, body["error"])
}
