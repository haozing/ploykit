package app_test

import (
	"context"
	"fmt"
	"net/url"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/identity/app"
	"github.com/haozing/ploykit/identity/domain"
	"github.com/haozing/ploykit/platform/webx"
)

type fakeRepo struct {
	app.Repo
	users       map[string]app.User
	byID        map[string]app.User
	chals       map[string]*app.Challenge
	byChalID    map[string]*app.Challenge
	consumedIDs map[string]bool
	nowFn       func() time.Time

	created  int
	consumed int
	incAtt   int
	setPW    int
	revoked  int
	verified int

	revokeByIDCalls int
	revokeOKID      string
	softDeleted     []string
	softDeleteErr   error

	confirmedSessions  []string
	confirmedAt        time.Time
	confirmedSessionID string
	confirmNotFound    bool

	failedAttempts int
	attemptLog     []bool
}

func newFakeRepo(users ...app.User) *fakeRepo {
	f := &fakeRepo{
		users:       map[string]app.User{},
		byID:        map[string]app.User{},
		chals:       map[string]*app.Challenge{},
		byChalID:    map[string]*app.Challenge{},
		consumedIDs: map[string]bool{},
		nowFn:       func() time.Time { return time.Now().UTC() },
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

var challengeSeq atomic.Int64

func (f *fakeRepo) CreateChallenge(_ context.Context, email, kind, secretHash string, expiresAt time.Time) error {
	f.created++
	ch := &app.Challenge{
		ID:         fmt.Sprintf("ch-%s-%d", kind, challengeSeq.Add(1)),
		Email:      email,
		Kind:       kind,
		SecretHash: secretHash,
		ExpiresAt:  expiresAt,
		CreatedAt:  f.nowFn(),
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
	f.incAtt++
	f.byChalID[id].Attempts++
	return nil
}

func (f *fakeRepo) ConsumeChallenge(_ context.Context, id string) error {
	ch := f.byChalID[id]
	if ch == nil || f.consumedIDs[id] {
		return app.ErrNotFound
	}
	f.consumed++
	f.consumedIDs[id] = true
	return nil
}

func (f *fakeRepo) SetPasswordHash(_ context.Context, userID, passwordHash string, _ time.Time) error {
	f.setPW++
	u := f.byID[userID]
	u.PasswordHash = passwordHash
	f.byID[userID] = u
	f.users[u.Email] = u
	return nil
}

func (f *fakeRepo) RevokeAllUserSessions(_ context.Context, _ string) error {
	f.revoked++
	return nil
}

func (f *fakeRepo) SetEmailVerified(_ context.Context, userID string, _ time.Time) error {
	f.verified++
	u := f.byID[userID]
	u.EmailVerified = true
	f.byID[userID] = u
	f.users[u.Email] = u
	return nil
}

type fakeMail struct {
	reset, verify []string
}

func (m *fakeMail) SendLoginCode(_ context.Context, _, _ string) error { return nil }
func (m *fakeMail) SendInvite(_ context.Context, _, _, _ string) error { return nil }
func (m *fakeMail) SendPasswordReset(_ context.Context, _, link string) error {
	m.reset = append(m.reset, link)
	return nil
}
func (m *fakeMail) SendEmailVerification(_ context.Context, _, link string) error {
	m.verify = append(m.verify, link)
	return nil
}

var frozen = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

func newAccountSvc(f *fakeRepo, m *fakeMail) *app.AccountService {
	return app.NewAccountService(f, m, app.AccountConfig{
		SecretPepper: "p",
		LinkBaseURL:  "http://localhost:5173",
	}, func() time.Time { return frozen })
}

func seedUser(id, email string, verified bool) app.User {
	return app.User{ID: id, Email: email, Status: "active", EmailVerified: verified}
}

func seedChallenge(f *fakeRepo, email, kind, token string, createdAgo, ttl time.Duration) {
	ch := &app.Challenge{
		ID:         "ch-seed-" + kind,
		Email:      email,
		Kind:       kind,
		SecretHash: domain.HashSecret("p", token),
		ExpiresAt:  frozen.Add(ttl - createdAgo),
		CreatedAt:  frozen.Add(-createdAgo),
	}
	f.chals[email+"|"+kind] = ch
	f.byChalID[ch.ID] = ch
}

func assertErrCode(t *testing.T, err error, status int, code string) {
	t.Helper()
	var we *webx.Error
	require.ErrorAs(t, err, &we, "expected webx.Error, got %v", err)
	assert.Equal(t, status, we.Status)
	assert.Equal(t, code, we.Code)
}

func linkToken(t *testing.T, link, path string) (email, token string) {
	t.Helper()
	u, err := url.Parse(link)
	require.NoError(t, err)
	require.Equal(t, path, u.Path)
	q := u.Query()
	return q.Get("email"), q.Get("token")
}

func TestAccountService(t *testing.T) {
	tests := []struct {
		name string
		run  func(t *testing.T)
	}{
		{"RequestPasswordReset 未知邮箱静默成功且不发信", func(t *testing.T) {
			f, m := newFakeRepo(), &fakeMail{}
			svc := newAccountSvc(f, m)
			require.NoError(t, svc.RequestPasswordReset(t.Context(), "stranger@example.com"))
			assert.Zero(t, f.created)
			assert.Empty(t, m.reset)
		}},
		{"RequestPasswordReset 已知邮箱创建 reset_link 挑战并发信", func(t *testing.T) {
			f, m := newFakeRepo(seedUser("u1", "u1@example.com", false)), &fakeMail{}
			f.nowFn = func() time.Time { return frozen }
			svc := newAccountSvc(f, m)
			require.NoError(t, svc.RequestPasswordReset(t.Context(), "U1@Example.com"))
			assert.Equal(t, 1, f.created)
			require.Len(t, m.reset, 1)
			email, token := linkToken(t, m.reset[0], "/reset-password")
			assert.Equal(t, "u1@example.com", email)
			require.Len(t, token, 64)
			ch := f.chals["u1@example.com|reset_link"]
			require.NotNil(t, ch)
			assert.Equal(t, domain.HashSecret("p", token), ch.SecretHash)
			assert.Equal(t, frozen.Add(domain.ResetLinkTTL), ch.ExpiresAt)
		}},
		{"RequestPasswordReset 1 分钟内重复请求返回 E_RATE_LIMITED", func(t *testing.T) {
			f, m := newFakeRepo(seedUser("u1", "u1@example.com", false)), &fakeMail{}
			f.nowFn = func() time.Time { return frozen }
			svc := newAccountSvc(f, m)
			require.NoError(t, svc.RequestPasswordReset(t.Context(), "u1@example.com"))
			err := svc.RequestPasswordReset(t.Context(), "u1@example.com")
			assertErrCode(t, err, 429, webx.CodeRateLimited)
		}},
		{"ResetPassword 正确 token 改密+吊销全部会话+消费挑战", func(t *testing.T) {
			f, m := newFakeRepo(seedUser("u1", "u1@example.com", false)), &fakeMail{}
			seedChallenge(f, "u1@example.com", "reset_link", "good-token", 5*time.Minute, domain.ResetLinkTTL)
			svc := newAccountSvc(f, m)
			require.NoError(t, svc.ResetPassword(t.Context(), "u1@example.com", "good-token", "NewStrongPass1!"))
			assert.Equal(t, 1, f.consumed)
			assert.Equal(t, 1, f.setPW)
			assert.Equal(t, 1, f.revoked)
			assert.True(t, app.VerifyPassword("NewStrongPass1!", f.users["u1@example.com"].PasswordHash))

			assertErrCode(t, svc.ResetPassword(t.Context(), "u1@example.com", "good-token", "AnotherStrong1!"), 400, webx.CodeValidation)
		}},
		{"ResetPassword 错误 token 返回 E_VALIDATION 且 attempts+1", func(t *testing.T) {
			f, m := newFakeRepo(seedUser("u1", "u1@example.com", false)), &fakeMail{}
			seedChallenge(f, "u1@example.com", "reset_link", "good-token", 5*time.Minute, domain.ResetLinkTTL)
			svc := newAccountSvc(f, m)
			assertErrCode(t, svc.ResetPassword(t.Context(), "u1@example.com", "bad-token", "NewStrongPass1!"), 400, webx.CodeValidation)
			assert.Equal(t, 1, f.incAtt)
			assert.Equal(t, 1, f.chals["u1@example.com|reset_link"].Attempts)
			assert.Zero(t, f.setPW)
		}},
		{"ResetPassword 过期 token 返回 E_VALIDATION", func(t *testing.T) {
			f, m := newFakeRepo(seedUser("u1", "u1@example.com", false)), &fakeMail{}
			seedChallenge(f, "u1@example.com", "reset_link", "good-token", 2*time.Hour, domain.ResetLinkTTL)
			svc := newAccountSvc(f, m)
			assertErrCode(t, svc.ResetPassword(t.Context(), "u1@example.com", "good-token", "NewStrongPass1!"), 400, webx.CodeValidation)
			assert.Zero(t, f.setPW)
			assert.Zero(t, f.consumed)
		}},
		{"ResetPassword 弱密码返回 E_VALIDATION", func(t *testing.T) {
			f, m := newFakeRepo(seedUser("u1", "u1@example.com", false)), &fakeMail{}
			seedChallenge(f, "u1@example.com", "reset_link", "good-token", 5*time.Minute, domain.ResetLinkTTL)
			svc := newAccountSvc(f, m)
			assertErrCode(t, svc.ResetPassword(t.Context(), "u1@example.com", "good-token", "weak"), 400, webx.CodeValidation)
			assert.Zero(t, f.setPW)
		}},
		{"SendVerification 已验证用户返回 E_CONFLICT", func(t *testing.T) {
			f, m := newFakeRepo(seedUser("u1", "u1@example.com", true)), &fakeMail{}
			svc := newAccountSvc(f, m)
			err := svc.SendVerification(t.Context(), &webx.Principal{UserID: "u1", Source: webx.SourceSession})
			assertErrCode(t, err, 409, webx.CodeConflict)
			assert.Zero(t, f.created)
		}},
		{"SendVerification 未验证用户创建 verify_link 挑战并发信", func(t *testing.T) {
			f, m := newFakeRepo(seedUser("u1", "u1@example.com", false)), &fakeMail{}
			f.nowFn = func() time.Time { return frozen }
			svc := newAccountSvc(f, m)
			require.NoError(t, svc.SendVerification(t.Context(), &webx.Principal{UserID: "u1", Source: webx.SourceSession}))
			assert.Equal(t, 1, f.created)
			email, token := linkToken(t, m.verify[0], "/verify-email")
			assert.Equal(t, "u1@example.com", email)
			assert.Len(t, token, 64)
			assert.Equal(t, frozen.Add(domain.VerifyLinkTTL), f.chals["u1@example.com|verify_link"].ExpiresAt)
		}},
		{"SendVerification 未登录返回 E_UNAUTHENTICATED", func(t *testing.T) {
			f, m := newFakeRepo(seedUser("u1", "u1@example.com", false)), &fakeMail{}
			svc := newAccountSvc(f, m)
			assertErrCode(t, svc.SendVerification(t.Context(), nil), 401, webx.CodeUnauthenticated)
		}},
		{"SendVerification 1 分钟内重复请求返回 E_RATE_LIMITED", func(t *testing.T) {
			f, m := newFakeRepo(seedUser("u1", "u1@example.com", false)), &fakeMail{}
			f.nowFn = func() time.Time { return frozen }
			svc := newAccountSvc(f, m)
			p := &webx.Principal{UserID: "u1", Source: webx.SourceSession}
			require.NoError(t, svc.SendVerification(t.Context(), p))
			assertErrCode(t, svc.SendVerification(t.Context(), p), 429, webx.CodeRateLimited)
		}},
		{"VerifyEmail 正确 token 置 email_verified", func(t *testing.T) {
			f, m := newFakeRepo(seedUser("u1", "u1@example.com", false)), &fakeMail{}
			seedChallenge(f, "u1@example.com", "verify_link", "v-token", time.Minute, domain.VerifyLinkTTL)
			svc := newAccountSvc(f, m)
			require.NoError(t, svc.VerifyEmail(t.Context(), "u1@example.com", "v-token"))
			assert.Equal(t, 1, f.verified)
			assert.True(t, f.users["u1@example.com"].EmailVerified)
			assert.Equal(t, 1, f.consumed)
		}},
		{"VerifyEmail 错误 token 返回 E_VALIDATION 且 attempts+1", func(t *testing.T) {
			f, m := newFakeRepo(seedUser("u1", "u1@example.com", false)), &fakeMail{}
			seedChallenge(f, "u1@example.com", "verify_link", "v-token", time.Minute, domain.VerifyLinkTTL)
			svc := newAccountSvc(f, m)
			assertErrCode(t, svc.VerifyEmail(t.Context(), "u1@example.com", "wrong"), 400, webx.CodeValidation)
			assert.Equal(t, 1, f.incAtt)
			assert.Zero(t, f.verified)
		}},
		{"VerifyEmail 邮箱格式无效返回 E_VALIDATION", func(t *testing.T) {
			f, m := newFakeRepo(), &fakeMail{}
			svc := newAccountSvc(f, m)
			assertErrCode(t, svc.VerifyEmail(t.Context(), "not-an-email", "t"), 400, webx.CodeValidation)
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, tt.run)
	}
}
