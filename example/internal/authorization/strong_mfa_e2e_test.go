package authorization

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"crypto/rand"
	"encoding/hex"

	"github.com/haozing/ploykit/authorization"
	identityapp "github.com/haozing/ploykit/identity/app"
	identitydomain "github.com/haozing/ploykit/identity/domain"
	"github.com/haozing/ploykit/platform/sealx"
	"github.com/haozing/ploykit/platform/webx"
)

// TestStrongMFATokenCreateCycle is the batch-2 exit flow (ADR 0013): enroll →
// enable → trigger the AAL2-grade operation → challenge → verify-mfa → retry
// → allow. token.create (PAT creation, GitHub's sudo-guarded token shape) is
// the wired reference op: its catalog rule password_and_mfa needs a fresh
// password AND a fresh MFA proof.
func TestStrongMFATokenCreateCycle(t *testing.T) {
	env := newStrongEnv(t)
	ctx := context.Background()

	// the gate on POST /api/tokens — the identity adapter mounts
	// PATCreateGuard the same way
	recorder := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		env.handlerOK.Add(1)
		w.WriteHeader(http.StatusOK)
	})
	m := webx.NewMux()
	m.Handle("POST /api/tokens", env.strong.Middleware()(recorder))
	env.srv = webx.Authenticate(&env.authCfg, env.repo, env.repo)(m)

	sealKey := []byte("0123456789abcdef0123456789abcdef")
	secrets, err := sealx.NewSecrets(sealKey)
	require.NoError(t, err)
	base := time.Now()
	sessions := identityapp.NewSessionService(env.repo, nil, identityapp.SessionConfig{}, time.Hour, 2*time.Hour, func() time.Time { return base })
	mfa := identityapp.NewMFAService(env.repo, sessions, secrets, "ploykit-e2e", func() time.Time { return base })

	// a password-fresh (born-confirmed), MFA-less session
	token, sessionID := env.session(t, env.owner, true)
	p := &webx.Principal{UserID: env.owner, Email: "owner@example.test",
		Source: webx.SourceSession, SessionID: sessionID}

	// 1. token.create without MFA → challenge with factor=mfa
	w := env.do("POST", "/api/tokens", token)
	require.Equal(t, http.StatusForbidden, w.Code, "body: %s", w.Body.String())
	body := decodeError(t, w)
	require.Equal(t, webx.CodeReauthRequired, body.Code)
	require.Equal(t, "token.create", body.Details["target_operation"])
	require.Equal(t, "aal2", body.Details["required_assurance"])
	require.Equal(t, "mfa", body.Details["factor"])
	require.Zero(t, env.handlerOK.Load())

	// 2. enroll + enable (verify the first code; Enable stamps the session)
	enrollment, err := mfa.StartEnrollment(ctx, p, p.Email)
	require.NoError(t, err)
	secret, err := identityapp.ParseTOTPBase32(enrollment.Secret)
	require.NoError(t, err)
	code := identityapp.TOTPAt(secret, time.Now())
	backupCodes, err := mfa.Enable(ctx, "ip", p, code)
	require.NoError(t, err)
	require.NotEmpty(t, backupCodes)

	// 3. retry → allow (password was born-confirmed, MFA just stamped)
	w = env.do("POST", "/api/tokens", token)
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	require.Equal(t, int32(1), env.handlerOK.Load())

	// 4. a PAT caller still gets the terminal denial, never the challenge
	raw := newE2EPAT(t)
	_, err = env.repo.CreatePAT(ctx, env.owner, "e2e-mfa", identitydomain.HashPAT(raw), webx.DefaultPATPrefix, nil, nil)
	require.NoError(t, err)
	req := httptest.NewRequest("POST", "/api/tokens", nil)
	req.Header.Set("Authorization", "Bearer "+raw)
	w = httptest.NewRecorder()
	env.srv.ServeHTTP(w, req)
	require.Equal(t, http.StatusForbidden, w.Code)
	body = decodeError(t, w)
	require.Equal(t, authorization.DenialCodePermissionDenied, body.Code)
}

// TestStrongMFAFreshnessExpires pins the window on the MFA leg: with the
// mfa_confirmed_at stamp older than the declared 900s window, token.create
// challenges again even though the session once passed.
func TestStrongMFAFreshnessExpires(t *testing.T) {
	env := newStrongEnv(t)

	recorder := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	m := webx.NewMux()
	m.Handle("POST /api/tokens", env.strong.Middleware()(recorder))
	env.srv = webx.Authenticate(&env.authCfg, env.repo, env.repo)(m)

	token, sessionID := env.session(t, env.owner, true)
	// backdate the MFA stamp beyond the window directly (the stamp's producer
	// path is covered by TestStrongMFATokenCreateCycle)
	require.NoError(t, env.repo.ConfirmSessionMFA(context.Background(), sessionID,
		time.Now().Add(-2*time.Hour)))

	w := env.do("POST", "/api/tokens", token)
	require.Equal(t, http.StatusForbidden, w.Code)
	body := decodeError(t, w)
	require.Equal(t, webx.CodeReauthRequired, body.Code)
	require.Equal(t, "mfa", body.Details["factor"])
}

// newE2EPAT mints a format-valid PAT token (tk_ + 40 hex chars).
func newE2EPAT(t *testing.T) string {
	t.Helper()
	raw := make([]byte, 20)
	require.NoError(t, randRead(raw))
	return webx.DefaultPATPrefix + hex.EncodeToString(raw)
}

func randRead(b []byte) error {
	_, err := rand.Read(b)
	return err
}
