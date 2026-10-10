package http_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	httplib "github.com/haozing/ploykit/identity/adapters/http"
	"github.com/haozing/ploykit/identity/app"
	"github.com/haozing/ploykit/identity/domain"
	"github.com/haozing/ploykit/platform/webx"
)

var frozen = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

type fakeRepo struct {
	app.Repo
	users       map[string]app.User
	byID        map[string]app.User
	chals       map[string]*app.Challenge
	byChalID    map[string]*app.Challenge
	consumedIDs map[string]bool

	sessions        []app.SessionInfo
	revokeByIDCalls int
	revokeOKIDs     map[string]bool
	revokeConsumed  bool
	revokeGotUser   string
	softDeleted     bool
	softDeletedID   string

	confirmedSessionID string
	confirmedAt        time.Time
	attempts           int

	updatedProfile [3]string
}

func newFakeRepo(users ...app.User) *fakeRepo {
	f := &fakeRepo{
		users:       map[string]app.User{},
		byID:        map[string]app.User{},
		chals:       map[string]*app.Challenge{},
		byChalID:    map[string]*app.Challenge{},
		consumedIDs: map[string]bool{},
	}
	for _, u := range users {
		f.users[u.Email] = u
		f.byID[u.ID] = u
	}
	return f
}

func (f *fakeRepo) GetUserByEmail(_ context.Context, email string) (app.User, bool, error) {
	u, ok := f.users[email]
	return u, ok, nil
}

func (f *fakeRepo) GetUser(_ context.Context, id string) (app.User, error) {
	u, ok := f.byID[id]
	if !ok {
		return app.User{}, app.ErrNotFound
	}
	return u, nil
}

func (f *fakeRepo) CreateChallenge(_ context.Context, email, kind, secretHash string, expiresAt time.Time) error {
	ch := &app.Challenge{
		ID: "ch-" + kind, Email: email, Kind: kind,
		SecretHash: secretHash, ExpiresAt: expiresAt, CreatedAt: frozen,
	}
	f.chals[email+"|"+kind] = ch
	f.byChalID[ch.ID] = ch
	return nil
}

func (f *fakeRepo) LatestPendingChallenge(_ context.Context, email, kind string) (*app.Challenge, error) {
	ch := f.chals[email+"|"+kind]
	if ch == nil || f.consumedIDs[ch.ID] {
		return nil, nil
	}
	return ch, nil
}

func (f *fakeRepo) IncChallengeAttempts(_ context.Context, id string) error {
	f.byChalID[id].Attempts++
	return nil
}

func (f *fakeRepo) ConsumeChallenge(_ context.Context, id string) error {
	if f.consumedIDs[id] {
		return app.ErrNotFound
	}
	f.consumedIDs[id] = true
	return nil
}

func (f *fakeRepo) SetPasswordHash(_ context.Context, userID, hash string, _ time.Time) error {
	u := f.byID[userID]
	u.PasswordHash = hash
	f.byID[userID] = u
	f.users[u.Email] = u
	return nil
}

func (f *fakeRepo) RevokeAllUserSessions(_ context.Context, _ string) error { return nil }

func (f *fakeRepo) SetEmailVerified(_ context.Context, userID string, _ time.Time) error {
	u := f.byID[userID]
	u.EmailVerified = true
	f.byID[userID] = u
	f.users[u.Email] = u
	return nil
}

type fakeMail struct{}

func (fakeMail) SendLoginCode(context.Context, string, string) error         { return nil }
func (fakeMail) SendInvite(context.Context, string, string, string) error    { return nil }
func (fakeMail) SendPasswordReset(context.Context, string, string) error     { return nil }
func (fakeMail) SendEmailVerification(context.Context, string, string) error { return nil }

func seedChallenge(f *fakeRepo, email, kind, token string) {
	ch := &app.Challenge{
		ID: "ch-seed-" + kind, Email: email, Kind: kind,
		SecretHash: domain.HashSecret("p", token),
		ExpiresAt:  frozen.Add(time.Hour), CreatedAt: frozen,
	}
	f.chals[email+"|"+kind] = ch
	f.byChalID[ch.ID] = ch
}

func newMux(f *fakeRepo) *http.ServeMux {
	svc := app.NewAccountService(f, fakeMail{}, app.AccountConfig{
		SecretPepper: "p", LinkBaseURL: "http://localhost:5173",
	}, func() time.Time { return frozen })
	mux := http.NewServeMux()
	httplib.Mount(mux, httplib.Deps{Account: svc})
	return mux
}

func doJSON(t *testing.T, mux *http.ServeMux, method, path string, body any, p *webx.Principal) *httptest.ResponseRecorder {
	t.Helper()
	var rd *bytes.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		require.NoError(t, err)
		rd = bytes.NewReader(raw)
	} else {
		rd = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, rd)
	req.Header.Set("Content-Type", "application/json")
	if p != nil {
		req = req.WithContext(webx.WithPrincipal(req.Context(), p))
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	return w
}

func errEnvelope(t *testing.T, w *httptest.ResponseRecorder) (code, msg string) {
	t.Helper()
	var body struct {
		Error   string `json:"error"`
		Message string `json:"message"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body), "body: %s", w.Body.String())
	return body.Error, body.Message
}

func TestAccountRoutes(t *testing.T) {
	sessionUser := &webx.Principal{UserID: "u1", Source: webx.SourceSession}
	patUser := &webx.Principal{UserID: "u1", Source: webx.SourcePAT}
	known := app.User{ID: "u1", Email: "u1@example.com", Status: "active"}

	tests := []struct {
		name string
		run  func(t *testing.T)
	}{
		{"forgot-password 未知邮箱 204 防枚举", func(t *testing.T) {
			f := newFakeRepo()
			w := doJSON(t, newMux(f), "POST", "/auth/forgot-password", map[string]string{"email": "nobody@example.com"}, nil)
			assert.Equal(t, http.StatusNoContent, w.Code)
		}},
		{"forgot-password 已知邮箱 204 且重复请求 429 信封 E_RATE_LIMITED", func(t *testing.T) {
			f := newFakeRepo(known)
			mux := newMux(f)
			w := doJSON(t, mux, "POST", "/auth/forgot-password", map[string]string{"email": "u1@example.com"}, nil)
			assert.Equal(t, http.StatusNoContent, w.Code)
			w = doJSON(t, mux, "POST", "/auth/forgot-password", map[string]string{"email": "u1@example.com"}, nil)
			assert.Equal(t, http.StatusTooManyRequests, w.Code)
			code, _ := errEnvelope(t, w)
			assert.Equal(t, "E_RATE_LIMITED", code)
		}},
		{"forgot-password 非法邮箱 400 E_VALIDATION", func(t *testing.T) {
			w := doJSON(t, newMux(newFakeRepo()), "POST", "/auth/forgot-password", map[string]string{"email": "not-an-email"}, nil)
			assert.Equal(t, http.StatusBadRequest, w.Code)
			code, _ := errEnvelope(t, w)
			assert.Equal(t, "E_VALIDATION", code)
		}},
		{"reset-password 正确 token 200 ok=true", func(t *testing.T) {
			f := newFakeRepo(known)
			seedChallenge(f, "u1@example.com", "reset_link", "good-token")
			w := doJSON(t, newMux(f), "POST", "/auth/reset-password",
				map[string]string{"email": "u1@example.com", "token": "good-token", "new_password": "NewStrongPass1!"}, nil)
			require.Equal(t, http.StatusOK, w.Code)
			var body struct {
				OK bool `json:"ok"`
			}
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
			assert.True(t, body.OK)
		}},
		{"reset-password 错误 token 400 信封 E_VALIDATION", func(t *testing.T) {
			f := newFakeRepo(known)
			seedChallenge(f, "u1@example.com", "reset_link", "good-token")
			w := doJSON(t, newMux(f), "POST", "/auth/reset-password",
				map[string]string{"email": "u1@example.com", "token": "bad-token", "new_password": "NewStrongPass1!"}, nil)
			assert.Equal(t, http.StatusBadRequest, w.Code)
			code, _ := errEnvelope(t, w)
			assert.Equal(t, "E_VALIDATION", code)
		}},
		{"reset-password 弱密码 400", func(t *testing.T) {
			f := newFakeRepo(known)
			seedChallenge(f, "u1@example.com", "reset_link", "good-token")
			w := doJSON(t, newMux(f), "POST", "/auth/reset-password",
				map[string]string{"email": "u1@example.com", "token": "good-token", "new_password": "weak"}, nil)
			assert.Equal(t, http.StatusBadRequest, w.Code)
		}},
		{"verify-email 正确 token 200", func(t *testing.T) {
			f := newFakeRepo(known)
			seedChallenge(f, "u1@example.com", "verify_link", "v-token")
			w := doJSON(t, newMux(f), "POST", "/auth/verify-email",
				map[string]string{"email": "u1@example.com", "token": "v-token"}, nil)
			assert.Equal(t, http.StatusOK, w.Code)
		}},
		{"verify-email 错误 token 400 信封 E_VALIDATION", func(t *testing.T) {
			f := newFakeRepo(known)
			seedChallenge(f, "u1@example.com", "verify_link", "v-token")
			w := doJSON(t, newMux(f), "POST", "/auth/verify-email",
				map[string]string{"email": "u1@example.com", "token": "wrong"}, nil)
			assert.Equal(t, http.StatusBadRequest, w.Code)
			code, _ := errEnvelope(t, w)
			assert.Equal(t, "E_VALIDATION", code)
		}},
		{"send-verification 未认证被 RequireHuman 拒 401（API-FT2-12：匿名 401，PAT 仍 403）", func(t *testing.T) {
			w := doJSON(t, newMux(newFakeRepo(known)), "POST", "/auth/send-verification", nil, nil)
			assert.Equal(t, http.StatusUnauthorized, w.Code)
		}},
		{"send-verification PAT 会话被拒 403", func(t *testing.T) {
			w := doJSON(t, newMux(newFakeRepo(known)), "POST", "/auth/send-verification", nil, patUser)
			assert.Equal(t, http.StatusForbidden, w.Code)
		}},
		{"send-verification 浏览器会话 204", func(t *testing.T) {
			w := doJSON(t, newMux(newFakeRepo(known)), "POST", "/auth/send-verification", nil, sessionUser)
			assert.Equal(t, http.StatusNoContent, w.Code)
		}},
		{"send-verification 已验证 409 E_CONFLICT", func(t *testing.T) {
			verified := known
			verified.EmailVerified = true
			w := doJSON(t, newMux(newFakeRepo(verified)), "POST", "/auth/send-verification", nil, sessionUser)
			assert.Equal(t, http.StatusConflict, w.Code)
			code, _ := errEnvelope(t, w)
			assert.Equal(t, "E_CONFLICT", code)
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, tt.run)
	}
}
