package app_test

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/identity/app"
	"github.com/haozing/ploykit/platform/webx"
)

func (f *fakeRepo) UpsertUserByEmail(_ context.Context, email string, _ time.Time) (app.User, error) {
	if u, ok := f.users[email]; ok {
		return u, nil
	}
	u := app.User{ID: "jit-" + email, Email: email, Status: "active", CreatedAt: f.nowFn()}
	f.users[email] = u
	f.byID[u.ID] = u
	return u, nil
}

func (f *fakeRepo) RevokeUserSessionByID(_ context.Context, _, sessionID string, _ time.Time) error {
	f.revokeByIDCalls++
	if sessionID == f.revokeOKID {
		return nil
	}
	return app.ErrNotFound
}

func (f *fakeRepo) SoftDeleteUserTx(_ context.Context, _ pgx.Tx, userID string, _ time.Time) error {
	f.softDeleted = append(f.softDeleted, userID)
	if f.softDeleteErr != nil {
		return f.softDeleteErr
	}
	return nil
}

type fakeAuditor struct {
	actions []string
}

func (a *fakeAuditor) Record(_ context.Context, _ *string, _ *webx.Principal, action, _, _ string, _ map[string]any) {
	a.actions = append(a.actions, action)
}

func TestRevokeSessionByID(t *testing.T) {
	p := &webx.Principal{UserID: "u1", Source: webx.SourceSession}

	t.Run("存在且未吊销 → nil", func(t *testing.T) {
		f := newFakeRepo(seedUser("u1", "u1@example.com", false))
		f.revokeOKID = "s1"
		svc := newSessionSvc(f, &fakeMail{})
		require.NoError(t, svc.RevokeSessionByID(t.Context(), p, "s1"))
		assert.Equal(t, 1, f.revokeByIDCalls)
	})

	t.Run("不存在/已吊销 → 404 E_NOT_FOUND（幂等二调）", func(t *testing.T) {
		f := newFakeRepo(seedUser("u1", "u1@example.com", false))
		svc := newSessionSvc(f, &fakeMail{})
		err := svc.RevokeSessionByID(t.Context(), p, "missing")
		assertErrCode(t, err, 404, webx.CodeNotFound)
	})
}

func TestDeleteAccount(t *testing.T) {
	p := &webx.Principal{UserID: "u1", Source: webx.SourceSession}

	t.Run("未登录 → 401", func(t *testing.T) {
		f := newFakeRepo(seedUser("u1", "u1@example.com", false))
		svc := newAccountSvc(f, &fakeMail{})
		assertErrCode(t, svc.DeleteAccount(t.Context(), nil), 401, webx.CodeUnauthenticated)
		assert.Empty(t, f.softDeleted)
	})

	t.Run("成功：走 RunInTx 软删除 + 审计 account.deleted", func(t *testing.T) {
		f := newFakeRepo(seedUser("u1", "u1@example.com", false))
		aud := &fakeAuditor{}
		svc := newAccountSvc(f, &fakeMail{}).WithAuditor(aud)
		require.NoError(t, svc.DeleteAccount(t.Context(), p))
		assert.Equal(t, []string{"u1"}, f.softDeleted)
		assert.Equal(t, []string{"account.deleted"}, aud.actions)
	})

	t.Run("用户不存在/已注销 → 404（幂等二调）", func(t *testing.T) {
		f := newFakeRepo(seedUser("u1", "u1@example.com", false))
		f.softDeleteErr = app.ErrNotFound
		aud := &fakeAuditor{}
		svc := newAccountSvc(f, &fakeMail{}).WithAuditor(aud)
		assertErrCode(t, svc.DeleteAccount(t.Context(), p), 404, webx.CodeNotFound)
		assert.Empty(t, aud.actions, "失败不应记审计")
	})

	t.Run("审计器未挂载(nil)时空操作不 panic", func(t *testing.T) {
		f := newFakeRepo(seedUser("u1", "u1@example.com", false))
		svc := newAccountSvc(f, &fakeMail{})
		require.NoError(t, svc.DeleteAccount(t.Context(), p))
	})
}

func TestDeletedUserLoginRejected(t *testing.T) {
	deleted := seedUser("u1", "u1@example.com", false)
	deleted.Status = "deleted"
	hash, err := app.HashPassword("StrongPass123!")
	require.NoError(t, err)
	deleted.PasswordHash = hash

	t.Run("密码登录 deleted → 401", func(t *testing.T) {
		f := newFakeRepo(deleted)
		svc := newSessionSvc(f, &fakeMail{})
		_, err := svc.LoginWithPassword(t.Context(), "iph", "ua", "u1@example.com", "StrongPass123!")
		assertErrCode(t, err, 401, webx.CodeUnauthenticated)
	})

	t.Run("验证码登录 deleted → 403（DevCode 通道跳过挑战，仍被 status 拦截）", func(t *testing.T) {
		f := newFakeRepo(deleted)
		cfg := app.SessionConfig{AllowSignup: true, SecretPepper: "p", DevCode: "000000"}
		svc := app.NewSessionService(f, &fakeMail{}, cfg, time.Hour, 0, func() time.Time { return frozen })
		_, err := svc.VerifyCode(t.Context(), "iph", "ua", "u1@example.com", "000000")
		assertErrCode(t, err, 403, webx.CodeForbidden)
	})
}
