package app_test

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/identity"
	"github.com/haozing/ploykit/identity/app"
	"github.com/haozing/ploykit/identity/domain"
	"github.com/haozing/ploykit/platform/webx"
)

func (f *fakeRepo) RunInTx(ctx context.Context, fn func(ctx context.Context, tx pgx.Tx) error) error {
	snap := f.snapshot()
	if err := fn(ctx, nil); err != nil {
		f.restore(snap)
		return err
	}
	return nil
}

// fakeTx is a non-nil pgx.Tx stand-in: it is handed to the RunInTx callback
// so tests can prove the transactional hook actually received a tx handle.
// No method is ever called on it in fake land.
type fakeTx struct{ pgx.Tx }

// orderedRepo wraps fakeRepo and records the user-creation lifecycle so
// tests can pin hook ordering against the transaction window (ADR 0016).
type orderedRepo struct {
	*fakeRepo
	events *[]string
}

func (o *orderedRepo) CreateUserWithPasswordTx(ctx context.Context, tx pgx.Tx, email, passwordHash, displayName string) (app.User, error) {
	*o.events = append(*o.events, "create")
	return o.fakeRepo.CreateUserWithPasswordTx(ctx, tx, email, passwordHash, displayName)
}

func (o *orderedRepo) RunInTx(ctx context.Context, fn func(ctx context.Context, tx pgx.Tx) error) error {
	*o.events = append(*o.events, "tx-begin")
	snap := o.fakeRepo.snapshot()
	if err := fn(ctx, fakeTx{}); err != nil {
		o.fakeRepo.restore(snap)
		*o.events = append(*o.events, "tx-rollback")
		return err
	}
	*o.events = append(*o.events, "tx-commit")
	return nil
}

type txSnap struct {
	users       map[string]app.User
	byID        map[string]app.User
	chals       map[string]*app.Challenge
	byChalID    map[string]*app.Challenge
	consumedIDs map[string]bool
}

func (f *fakeRepo) snapshot() txSnap {
	s := txSnap{
		users:       map[string]app.User{},
		byID:        map[string]app.User{},
		chals:       map[string]*app.Challenge{},
		byChalID:    map[string]*app.Challenge{},
		consumedIDs: map[string]bool{},
	}
	for k, v := range f.users {
		s.users[k] = v
	}
	for k, v := range f.byID {
		s.byID[k] = v
	}
	for k, v := range f.chals {
		c := *v
		s.chals[k] = &c
		s.byChalID[v.ID] = &c
	}
	for k, v := range f.consumedIDs {
		s.consumedIDs[k] = v
	}
	return s
}

func (f *fakeRepo) restore(s txSnap) {
	f.users, f.byID = s.users, s.byID
	f.chals, f.byChalID, f.consumedIDs = s.chals, s.byChalID, s.consumedIDs
}

func (f *fakeRepo) CreateUserWithPasswordTx(_ context.Context, _ pgx.Tx, email, passwordHash, displayName string) (app.User, error) {
	if _, dup := f.users[email]; dup {
		return app.User{}, app.ErrDuplicate
	}
	u := app.User{
		ID: "u-" + email, Email: email, DisplayName: displayName,
		PasswordHash: passwordHash, Status: "active", CreatedAt: f.nowFn(),
	}
	f.users[email] = u
	f.byID[u.ID] = u
	return u, nil
}

func (f *fakeRepo) CreateUserWithPassword(ctx context.Context, email, passwordHash, displayName string) (app.User, error) {
	return f.CreateUserWithPasswordTx(ctx, nil, email, passwordHash, displayName)
}

func (f *fakeRepo) CreateSession(_ context.Context, in webx.SessionCreate) (string, time.Time, error) {
	if in.PasswordConfirmed {
		f.confirmedSessions = append(f.confirmedSessions, in.UserID)
	}
	return "sess-token", frozen.Add(time.Hour), nil
}

func (f *fakeRepo) ConfirmSessionPassword(_ context.Context, sessionID string, at time.Time) error {
	if f.confirmNotFound {
		return app.ErrNotFound
	}
	f.confirmedAt = at
	f.confirmedSessionID = sessionID
	return nil
}

func (f *fakeRepo) VerifySession(_ context.Context, _ string, _ time.Time) (*webx.Principal, error) {
	return &webx.Principal{SessionID: "sess-1", Source: webx.SourceSession}, nil
}

func (f *fakeRepo) RecordAttempt(_ context.Context, _, _ string, success bool, _ time.Time) error {
	if !success {
		f.failedAttempts++
	}
	f.attemptLog = append(f.attemptLog, success)
	return nil
}

func (f *fakeRepo) CountRecentAttempts(_ context.Context, _, _ string, _ time.Time) (int, error) {
	return f.failedAttempts, nil
}

// EarliestRecentAttempt backs the 429 retry hint: the fake treats the (frozen)
// attempt timestamp as the oldest failure inside the window.
func (f *fakeRepo) EarliestRecentAttempt(_ context.Context, _, _ string, since time.Time) (time.Time, bool, error) {
	if f.failedAttempts == 0 || frozen.Before(since) {
		return time.Time{}, false, nil
	}
	return frozen, true, nil
}

func newSessionSvc(f *fakeRepo, m *fakeMail) *app.SessionService {
	return app.NewSessionService(f, m, app.SessionConfig{AllowSignup: true, SecretPepper: "p"},
		time.Hour, 0, func() time.Time { return frozen })
}

func TestSessionServiceHooks(t *testing.T) {
	t.Run("OnRegisterTx 返回 error 时注册整体失败(用户不存在)", func(t *testing.T) {
		f, m := newFakeRepo(), &fakeMail{}
		var seeded []string
		svc := newSessionSvc(f, m).WithHooks(identity.IdentityHooks{
			OnRegisterTx: func(_ context.Context, _ pgx.Tx, userID string) error {
				seeded = append(seeded, userID)
				return errors.New("seed failed")
			},
		})
		_, err := svc.Register(t.Context(), "iph", "ua", "new@example.com", "StrongPass123!", "Newbie")
		require.Error(t, err)
		_, ok, err := f.GetUserByEmail(t.Context(), "new@example.com")
		require.NoError(t, err)
		assert.False(t, ok, "钩子失败必须回滚用户创建")
		assert.NotEmpty(t, seeded, "钩子应已被调用")
	})

	t.Run("密码注册双钩子按序触发：OnRegisterTx 在事务内，AfterRegister 在提交后（ADR 0016）", func(t *testing.T) {
		events := &[]string{}
		add := func(e string) { *events = append(*events, e) }
		f := &orderedRepo{fakeRepo: newFakeRepo(), events: events}
		var txSeenByHook pgx.Tx
		svc := app.NewSessionService(f, &fakeMail{}, app.SessionConfig{AllowSignup: true, SecretPepper: "p"},
			time.Hour, 0, func() time.Time { return frozen }).WithHooks(identity.IdentityHooks{
			OnRegisterTx: func(_ context.Context, tx pgx.Tx, userID string) error {
				txSeenByHook = tx
				add("onRegisterTx")
				return nil
			},
			AfterRegister: func(_ context.Context, userID string) error {
				add("afterRegister")
				return nil
			},
		})
		res, err := svc.Register(t.Context(), "iph", "ua", "new@example.com", "StrongPass123!", "Newbie")
		require.NoError(t, err)
		assert.Equal(t, []string{"tx-begin", "create", "onRegisterTx", "tx-commit", "afterRegister"}, *events,
			"tx 钩子必须落在建号与提交之间；AfterRegister 必须在提交之后")
		assert.NotNil(t, txSeenByHook, "OnRegisterTx 必须拿到 RunInTx 传入的事务句柄（fakeTx 非 nil）")
		assert.True(t, res.Registered, "密码注册恒为 Registered")
		assert.False(t, res.ProvisioningPending)
	})

	t.Run("AfterRegister 失败：注册仍成功，置 Provisioning 信号（ADR 0016）", func(t *testing.T) {
		f, m := newFakeRepo(), &fakeMail{}
		svc := newSessionSvc(f, m).WithHooks(identity.IdentityHooks{
			AfterRegister: func(context.Context, string) error { return errors.New("workspace upsert failed") },
		})
		res, err := svc.Register(t.Context(), "iph", "ua", "new@example.com", "StrongPass123!", "Newbie")
		require.NoError(t, err, "提交后钩子失败不得回滚注册")
		assert.NotEmpty(t, res.Token)
		assert.True(t, res.Registered)
		assert.True(t, res.ProvisioningPending)
		assert.Equal(t, "workspace upsert failed", res.ProvisioningError)
		_, ok, _ := f.GetUserByEmail(t.Context(), "new@example.com")
		assert.True(t, ok, "提交后钩子失败用户仍在")
	})

	t.Run("AfterLogin 错误不影响登录结果", func(t *testing.T) {
		hash, err := app.HashPassword("StrongPass123!")
		require.NoError(t, err)
		u := seedUser("u1", "u1@example.com", false)
		u.PasswordHash = hash
		f, m := newFakeRepo(u), &fakeMail{}
		var gotSessionID string
		svc := newSessionSvc(f, m).WithHooks(identity.IdentityHooks{
			AfterLogin: func(_ context.Context, _, sessionID string) error {
				gotSessionID = sessionID
				return errors.New("metric sink down")
			},
		})
		res, err := svc.LoginWithPassword(t.Context(), "iph", "ua", "u1@example.com", "StrongPass123!")
		require.NoError(t, err, "Observational 钩子错误不应影响登录")
		require.NotNil(t, res)
		assert.Equal(t, "sess-token", res.Token)
		assert.Equal(t, "sess-1", gotSessionID)
	})

	t.Run("OnLoginFailed 在凭证错误后调用且错误被吞掉", func(t *testing.T) {
		hash, err := app.HashPassword("StrongPass123!")
		require.NoError(t, err)
		u := seedUser("u1", "u1@example.com", false)
		u.PasswordHash = hash
		f, m := newFakeRepo(u), &fakeMail{}
		var failed []string
		svc := newSessionSvc(f, m).WithHooks(identity.IdentityHooks{
			OnLoginFailed: func(_ context.Context, email, _ string) error {
				failed = append(failed, email)
				return errors.New("alert sink down")
			},
		})
		_, err = svc.LoginWithPassword(t.Context(), "iph", "ua", "u1@example.com", "WrongPass123!")
		assert.Error(t, err)
		assert.Equal(t, []string{"u1@example.com"}, failed)
	})

	t.Run("AfterPasswordChange 在改密成功后调用", func(t *testing.T) {
		hash, err := app.HashPassword("StrongPass123!")
		require.NoError(t, err)
		u := seedUser("u1", "u1@example.com", false)
		u.PasswordHash = hash
		f, m := newFakeRepo(u), &fakeMail{}
		var changed []string
		svc := newSessionSvc(f, m).WithHooks(identity.IdentityHooks{
			AfterPasswordChange: func(_ context.Context, userID string) error {
				changed = append(changed, userID)
				return nil
			},
		})
		p := &webx.Principal{UserID: "u1"}
		_, err = svc.ChangePassword(t.Context(), p, "StrongPass123!", "NewStrongPass1!")
		require.NoError(t, err)
		assert.Equal(t, []string{"u1"}, changed)
		assert.Equal(t, 1, f.revoked, "改密应吊销全部旧会话")
	})
}

func TestChangePasswordB3B4(t *testing.T) {
	hash, err := app.HashPassword("StrongPass123!")
	require.NoError(t, err)
	u := seedUser("u1", "u1@example.com", false)
	u.PasswordHash = hash
	f, m := newFakeRepo(u), &fakeMail{}
	svc := newSessionSvc(f, m)
	p := &webx.Principal{UserID: "u1"}

	t.Run("B3 旧密码错误 → 401 中文 message", func(t *testing.T) {
		_, err := svc.ChangePassword(t.Context(), p, "WrongPass123!", "NewStrongPass1!")
		assertErrCode(t, err, 401, webx.CodeUnauthenticated)
		var we *webx.Error
		require.True(t, errors.As(err, &we))
		assert.Equal(t, "current password is incorrect", we.Message)
		assert.Equal(t, 0, f.revoked, "旧密码错误不得吊销会话")
		assert.Equal(t, 0, f.setPW, "旧密码错误不得改写哈希")
	})

	t.Run("B4 新旧密码相同 → 400 且零副作用", func(t *testing.T) {
		_, err := svc.ChangePassword(t.Context(), p, "StrongPass123!", "StrongPass123!")
		assertErrCode(t, err, 400, webx.CodeValidation)
		var we *webx.Error
		require.True(t, errors.As(err, &we))
		assert.Equal(t, "new password must differ from the current password", we.Message)
		assert.Equal(t, 0, f.revoked, "相同密码不得吊销任何会话")
		assert.Equal(t, 0, f.setPW, "相同密码不得改写哈希")
		assert.Equal(t, hash, f.byID["u1"].PasswordHash, "原哈希应保持不变")
	})

	t.Run("对照：新旧不同且新密码合规 → 成功", func(t *testing.T) {
		_, err := svc.ChangePassword(t.Context(), p, "StrongPass123!", "NewStrongPass1!")
		require.NoError(t, err)
		assert.Equal(t, 1, f.revoked, "真实改密应吊销全部旧会话")
		assert.Equal(t, 1, f.setPW)
	})
}

func TestVerifyCodeHooks_I4(t *testing.T) {
	newCodeSvc := func(f *fakeRepo, hooks identity.IdentityHooks) *app.SessionService {
		return newSessionSvc(f, &fakeMail{}).WithHooks(hooks)
	}

	t.Run("码登录成功触发 AfterLogin（sessionID 反查）", func(t *testing.T) {
		f := newFakeRepo(seedUser("u1", "u1@example.com", false))
		seedChallenge(f, "u1@example.com", "login_code", "123456", time.Minute, domain.CodeTTL)
		var gotUser, gotSession string
		svc := newCodeSvc(f, identity.IdentityHooks{
			AfterLogin: func(_ context.Context, userID, sessionID string) error {
				gotUser, gotSession = userID, sessionID
				return nil
			},
		})
		res, err := svc.VerifyCode(t.Context(), "iph", "ua", "u1@example.com", "123456")
		require.NoError(t, err)
		require.NotNil(t, res)
		assert.Equal(t, "u1", gotUser)
		assert.Equal(t, "sess-1", gotSession, "与 LoginWithPassword 同源：sessionIDOf 反查刚签发会话")
	})

	t.Run("码不匹配触发 OnLoginFailed", func(t *testing.T) {
		f := newFakeRepo(seedUser("u1", "u1@example.com", false))
		seedChallenge(f, "u1@example.com", "login_code", "123456", time.Minute, domain.CodeTTL)
		var failed []string
		svc := newCodeSvc(f, identity.IdentityHooks{
			OnLoginFailed: func(_ context.Context, email, _ string) error {
				failed = append(failed, email)
				return nil
			},
		})
		_, err := svc.VerifyCode(t.Context(), "iph", "ua", "u1@example.com", "654321")
		assertErrCode(t, err, 401, webx.CodeUnauthenticated)
		assert.Equal(t, []string{"u1@example.com"}, failed)
	})

	t.Run("码过期/不存在触发 OnLoginFailed", func(t *testing.T) {
		var failed int
		svc := newCodeSvc(newFakeRepo(seedUser("u1", "u1@example.com", false)), identity.IdentityHooks{
			OnLoginFailed: func(_ context.Context, _, _ string) error { failed++; return nil },
		})

		_, err := svc.VerifyCode(t.Context(), "iph", "ua", "u1@example.com", "123456")
		assertErrCode(t, err, 401, webx.CodeUnauthenticated)

		f := newFakeRepo(seedUser("u2", "u2@example.com", false))
		seedChallenge(f, "u2@example.com", "login_code", "123456", 2*time.Hour, domain.CodeTTL)
		svc2 := newCodeSvc(f, identity.IdentityHooks{
			OnLoginFailed: func(_ context.Context, _, _ string) error { failed++; return nil },
		})
		_, err = svc2.VerifyCode(t.Context(), "iph", "ua", "u2@example.com", "123456")
		assertErrCode(t, err, 401, webx.CodeUnauthenticated)
		assert.Equal(t, 2, failed)
	})

	t.Run("次数超限触发 OnLoginFailed", func(t *testing.T) {
		f := newFakeRepo(seedUser("u1", "u1@example.com", false))
		ch := &app.Challenge{
			ID: "ch-max", Email: "u1@example.com", Kind: "login_code",
			SecretHash: domain.HashSecret("p", "123456"), Attempts: domain.CodeMaxTries,
			ExpiresAt: frozen.Add(time.Minute), CreatedAt: frozen.Add(-time.Minute),
		}
		f.chals["u1@example.com|login_code"] = ch
		f.byChalID[ch.ID] = ch
		var failed int
		svc := newCodeSvc(f, identity.IdentityHooks{
			OnLoginFailed: func(_ context.Context, _, _ string) error { failed++; return nil },
		})
		_, err := svc.VerifyCode(t.Context(), "iph", "ua", "u1@example.com", "123456")
		assertErrCode(t, err, 401, webx.CodeUnauthenticated)
		assert.Equal(t, 1, failed)
	})

	t.Run("新邮箱 JIT 建号触发 AfterRegister（提交后、无事务参数）", func(t *testing.T) {
		f := newFakeRepo()
		seedChallenge(f, "fresh@example.com", "login_code", "123456", time.Minute, domain.CodeTTL)
		var registered []string
		svc := newCodeSvc(f, identity.IdentityHooks{
			AfterRegister: func(_ context.Context, userID string) error {
				registered = append(registered, userID)
				return nil
			},
		})
		res, err := svc.VerifyCode(t.Context(), "iph", "ua", "fresh@example.com", "123456")
		require.NoError(t, err)
		assert.Equal(t, "jit-fresh@example.com", res.User.ID)
		assert.Equal(t, []string{"jit-fresh@example.com"}, registered, "JIT 建号必须触发 AfterRegister")
		assert.True(t, res.Registered, "JIT 建号必须置 Registered")
		assert.False(t, res.ProvisioningPending)
		_, ok, _ := f.GetUserByEmail(t.Context(), "fresh@example.com")
		assert.True(t, ok)
	})

	t.Run("JIT AfterRegister 失败 → 登录仍成功 + Provisioning 信号（ADR 0016）", func(t *testing.T) {
		f := newFakeRepo()
		seedChallenge(f, "fresh@example.com", "login_code", "123456", time.Minute, domain.CodeTTL)
		svc := newCodeSvc(f, identity.IdentityHooks{
			AfterRegister: func(context.Context, string) error { return assert.AnError },
		})
		res, err := svc.VerifyCode(t.Context(), "iph", "ua", "fresh@example.com", "123456")
		require.NoError(t, err, "提交后钩子失败不得阻断登录")
		assert.NotEmpty(t, res.Token)
		assert.True(t, res.Registered)
		assert.True(t, res.ProvisioningPending)
		assert.NotEmpty(t, res.ProvisioningError)
		_, ok, _ := f.GetUserByEmail(t.Context(), "fresh@example.com")
		assert.True(t, ok)
	})

	t.Run("老邮箱登录不触发 AfterRegister", func(t *testing.T) {
		f := newFakeRepo(seedUser("u1", "u1@example.com", false))
		seedChallenge(f, "u1@example.com", "login_code", "123456", time.Minute, domain.CodeTTL)
		var registered int
		svc := newCodeSvc(f, identity.IdentityHooks{
			AfterRegister: func(context.Context, string) error { registered++; return nil },
		})
		res, err := svc.VerifyCode(t.Context(), "iph", "ua", "u1@example.com", "123456")
		require.NoError(t, err)
		assert.Zero(t, registered, "存量用户登录不得再触发 AfterRegister")
		assert.False(t, res.Registered, "存量用户登录 Registered=false")
	})
}

func TestLoginWithPassword_UnknownEmailEqualized_I8(t *testing.T) {
	f := newFakeRepo()
	var failed []string
	svc := newSessionSvc(f, &fakeMail{}).WithHooks(identity.IdentityHooks{
		OnLoginFailed: func(_ context.Context, email, _ string) error {
			failed = append(failed, email)
			return nil
		},
	})
	_, err := svc.LoginWithPassword(t.Context(), "iph", "ua", "ghost@example.com", "StrongPass123!")
	assertErrCode(t, err, 401, webx.CodeUnauthenticated)
	assert.Equal(t, []string{"ghost@example.com"}, failed)
}

func TestMe_MissingUserUnauthenticated(t *testing.T) {
	t.Run("用户不存在 → 401 session no longer valid", func(t *testing.T) {
		svc := newSessionSvc(newFakeRepo(), &fakeMail{})
		p := &webx.Principal{UserID: "u-gone", Source: webx.SourceSession}
		_, err := svc.Me(t.Context(), p)
		require.Error(t, err)
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, 401, we.Status)
		assert.Equal(t, "E_UNAUTHENTICATED", we.Code)
		assert.Equal(t, "session no longer valid", we.Message)
	})

	t.Run("用户存在 → 返回用户", func(t *testing.T) {
		svc := newSessionSvc(newFakeRepo(seedUser("u1", "u1@example.com", false)), &fakeMail{})
		p := &webx.Principal{UserID: "u1", Source: webx.SourceSession}
		u, err := svc.Me(t.Context(), p)
		require.NoError(t, err)
		assert.Equal(t, "u1", u.ID)
	})
}

func TestRegisterDisplayNameLimit_FT28(t *testing.T) {
	f := newFakeRepo()
	svc := newSessionSvc(f, &fakeMail{})

	for name, dn := range map[string]string{
		"101 rune 越界": strings.Repeat("a", 101),
		"1.2MB 超大值":   strings.Repeat("x", 1_200_000),
		"纯空白":         "   \t ",
	} {
		_, err := svc.Register(t.Context(), "iph", "ua", "ft28@example.com", "StrongPass123!", dn)
		var we *webx.Error
		require.ErrorAs(t, err, &we, "%s: got %v", name, err)
		assert.Equal(t, 400, we.Status, name)
		assert.Equal(t, webx.CodeValidation, we.Code, name)
		assert.Contains(t, we.Message, "display_name", name)
	}
	assert.Empty(t, f.users, "越界请求不应触达建号")

	dn := "  " + strings.Repeat("世", 100) + "  "
	res, err := svc.Register(t.Context(), "iph", "ua", "ft28-ok@example.com", "StrongPass123!", dn)
	require.NoError(t, err)
	assert.Equal(t, strings.Repeat("世", 100), res.User.DisplayName, "100 rune 边界放行且 trim 归一")
}

func TestConfirmPasswordStepUp(t *testing.T) {
	hash, err := app.HashPassword("StrongPass123!")
	require.NoError(t, err)
	u := seedUser("u1", "u1@example.com", false)
	u.PasswordHash = hash

	t.Run("密码正确 → 盖戳当前会话并返回确认时间", func(t *testing.T) {
		f, m := newFakeRepo(u), &fakeMail{}
		svc := newSessionSvc(f, m)
		p := &webx.Principal{UserID: "u1", SessionID: "sess-9", Source: webx.SourceSession}
		at, err := svc.ConfirmPassword(t.Context(), "iph", p, "StrongPass123!")
		require.NoError(t, err)
		assert.False(t, at.IsZero())
		assert.Equal(t, "sess-9", f.confirmedSessionID)
		assert.Equal(t, frozen, f.confirmedAt)
	})

	t.Run("密码错误 → 401 且不盖戳、记失败尝试", func(t *testing.T) {
		f, m := newFakeRepo(u), &fakeMail{}
		svc := newSessionSvc(f, m)
		p := &webx.Principal{UserID: "u1", SessionID: "sess-9", Source: webx.SourceSession}
		_, err := svc.ConfirmPassword(t.Context(), "iph", p, "WrongPass123!")
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusUnauthorized, we.Status)
		assert.Empty(t, f.confirmedSessionID)
	})

	t.Run("会话已失效(NotFound) → 401", func(t *testing.T) {
		f, m := newFakeRepo(u), &fakeMail{}
		f.confirmNotFound = true
		svc := newSessionSvc(f, m)
		p := &webx.Principal{UserID: "u1", SessionID: "sess-dead", Source: webx.SourceSession}
		_, err := svc.ConfirmPassword(t.Context(), "iph", p, "StrongPass123!")
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusUnauthorized, we.Status)
	})
}

func TestSessionBornConfirmed(t *testing.T) {
	hash, err := app.HashPassword("StrongPass123!")
	require.NoError(t, err)
	u := seedUser("u1", "u1@example.com", false)
	u.PasswordHash = hash

	t.Run("密码登录/注册/改密的会话天生已确认", func(t *testing.T) {
		f, m := newFakeRepo(u), &fakeMail{}
		svc := newSessionSvc(f, m)
		_, err := svc.LoginWithPassword(t.Context(), "iph", "ua", "u1@example.com", "StrongPass123!")
		require.NoError(t, err)
		assert.Equal(t, []string{"u1"}, f.confirmedSessions)
	})

	t.Run("验证码登录的会话不确认", func(t *testing.T) {
		f, m := newFakeRepo(u), &fakeMail{}
		svc := newSessionSvc(f, m)
		_, err := svc.CompleteThirdPartyLogin(t.Context(), "u1", false, "iph", "ua")
		require.NoError(t, err)
		assert.Empty(t, f.confirmedSessions, "第三方/验证码登录没有密码证明，不得天生确认")
	})
}
