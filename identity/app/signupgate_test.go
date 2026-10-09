package app_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/identity/app"
	"github.com/haozing/ploykit/identity/domain"
	"github.com/haozing/ploykit/platform/webx"
)

func newGatedSvc(f *fakeRepo, m *fakeMail, cfg app.SessionConfig) *app.SessionService {
	return app.NewSessionService(f, m, cfg, time.Hour, 0, func() time.Time { return frozen })
}

func assertForbidden(t *testing.T, err error) {
	t.Helper()
	var we *webx.Error
	require.ErrorAs(t, err, &we, "expected webx.Error, got %v", err)
	assert.Equal(t, 403, we.Status)
	assert.Equal(t, webx.CodeForbidden, we.Code)
}

func TestSignupGate_OverridesConfig(t *testing.T) {

	cfg := app.SessionConfig{AllowSignup: true, SecretPepper: "p"}

	t.Run("gate 关闭覆盖 config 开放：陌生域 403", func(t *testing.T) {
		f, m := newFakeRepo(), &fakeMail{}
		svc := newGatedSvc(f, m, cfg).WithSignupGate(func() (bool, []string) {
			return false, []string{"corp.com"}
		})
		_, err := svc.Register(t.Context(), "iph", "ua", "stranger@evil.com", "StrongPass123!", "S")
		assertForbidden(t, err)
		assert.Empty(t, f.users, "被闸门拦截不应建号")
	})

	t.Run("gate 域白名单放行白名单域", func(t *testing.T) {
		f, m := newFakeRepo(), &fakeMail{}
		svc := newGatedSvc(f, m, cfg).WithSignupGate(func() (bool, []string) {
			return false, []string{"corp.com"}
		})
		res, err := svc.Register(t.Context(), "iph", "ua", "new@corp.com", "StrongPass123!", "N")
		require.NoError(t, err)
		assert.Equal(t, "sess-token", res.Token)
	})

	t.Run("gate 开放覆盖 config 关闭", func(t *testing.T) {
		closed := app.SessionConfig{AllowSignup: false, SecretPepper: "p"}
		f, m := newFakeRepo(), &fakeMail{}
		svc := newGatedSvc(f, m, closed).WithSignupGate(func() (bool, []string) {
			return true, nil
		})
		_, err := svc.Register(t.Context(), "iph", "ua", "anyone@example.com", "StrongPass123!", "A")
		require.NoError(t, err)
	})
}

func TestSignupGate_NilGateFallsBackToConfig(t *testing.T) {
	closed := app.SessionConfig{AllowSignup: false, AllowedDomains: []string{"corp.com"}, SecretPepper: "p"}

	t.Run("nil gate：陌生域 403（config 快照判定）", func(t *testing.T) {
		f, m := newFakeRepo(), &fakeMail{}
		svc := newGatedSvc(f, m, closed)
		_, err := svc.Register(t.Context(), "iph", "ua", "stranger@evil.com", "StrongPass123!", "S")
		assertForbidden(t, err)
	})

	t.Run("nil gate：白名单域放行", func(t *testing.T) {
		f, m := newFakeRepo(), &fakeMail{}
		svc := newGatedSvc(f, m, closed)
		_, err := svc.Register(t.Context(), "iph", "ua", "new@corp.com", "StrongPass123!", "N")
		require.NoError(t, err)
	})

	t.Run("nil gate：AllowedEmails 精确白名单仍生效（不属热更面）", func(t *testing.T) {
		cfg := app.SessionConfig{
			AllowSignup: false, AllowedEmails: []string{"vip@corp.com"}, SecretPepper: "p",
		}
		f, m := newFakeRepo(), &fakeMail{}
		svc := newGatedSvc(f, m, cfg).WithSignupGate(func() (bool, []string) {
			return false, []string{"other.com"}
		})
		_, err := svc.Register(t.Context(), "iph", "ua", "vip@corp.com", "StrongPass123!", "V")
		require.NoError(t, err, "AllowedEmails 走 config，命中即放行")
	})
}

func TestSignupGate_DomainsHotChange(t *testing.T) {

	allow, domains := true, []string(nil)
	f, m := newFakeRepo(), &fakeMail{}
	svc := newGatedSvc(f, m, app.SessionConfig{SecretPepper: "p"}).
		WithSignupGate(func() (bool, []string) { return allow, domains })

	_, err := svc.Register(t.Context(), "iph", "ua", "a@example.com", "StrongPass123!", "A")
	require.NoError(t, err, "开放期注册放行")

	allow, domains = false, []string{"corp.com"}
	_, err = svc.Register(t.Context(), "iph", "ua", "b@evil.com", "StrongPass123!", "B")
	assertForbidden(t, err)

	_, err = svc.Register(t.Context(), "iph", "ua", "c@corp.com", "StrongPass123!", "C")
	require.NoError(t, err, "白名单域仍可进")
}

func TestSignupGate_VerifyCodeJITPath(t *testing.T) {
	existing := seedUser("u1", "u1@corp.com", false)
	f, m := newFakeRepo(existing), &fakeMail{}
	svc := newGatedSvc(f, m, app.SessionConfig{SecretPepper: "p"}).
		WithSignupGate(func() (bool, []string) { return false, []string{"corp.com"} })

	require.NoError(t, f.CreateChallenge(t.Context(), "newbie@evil.com", "login_code",
		domain.HashSecret("p", "123456"), frozen.Add(time.Minute)))
	_, err := svc.VerifyCode(t.Context(), "iph", "ua", "newbie@evil.com", "123456")
	assertForbidden(t, err)

	require.NoError(t, f.CreateChallenge(t.Context(), "u1@corp.com", "login_code",
		domain.HashSecret("p", "123456"), frozen.Add(time.Minute)))
	res, err := svc.VerifyCode(t.Context(), "iph", "ua", "u1@corp.com", "123456")
	require.NoError(t, err)
	assert.Equal(t, "u1", res.User.ID)
}
