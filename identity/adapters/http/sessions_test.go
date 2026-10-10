package http_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	httplib "github.com/haozing/ploykit/identity/adapters/http"
	"github.com/haozing/ploykit/identity/app"
	"github.com/haozing/ploykit/platform/webx"
)

func (f *fakeRepo) ListUserSessions(_ context.Context, _ string) ([]app.SessionInfo, error) {
	return f.sessions, nil
}

func (f *fakeRepo) RevokeUserSessionByID(_ context.Context, userID, sessionID string, _ time.Time) error {
	f.revokeByIDCalls++
	f.revokeGotUser = userID
	if f.revokeOKIDs[sessionID] && !f.revokeConsumed {
		f.revokeConsumed = true
		return nil
	}
	return app.ErrNotFound
}

func (f *fakeRepo) RunInTx(ctx context.Context, fn func(ctx context.Context, tx pgx.Tx) error) error {
	return fn(ctx, nil)
}

func (f *fakeRepo) SoftDeleteUserTx(_ context.Context, _ pgx.Tx, userID string, _ time.Time) error {
	if f.softDeleted {
		return app.ErrNotFound
	}
	f.softDeleted = true
	f.softDeletedID = userID
	return nil
}

func (f *fakeRepo) UpdateProfile(_ context.Context, id, displayName, avatarURL string) (app.User, error) {
	f.updatedProfile = [3]string{id, displayName, avatarURL}
	return app.User{ID: id, Email: "u1@example.com", DisplayName: displayName, AvatarURL: avatarURL, Status: "active"}, nil
}

func (f *fakeRepo) CountRecentAttempts(_ context.Context, _, _ string, _ time.Time) (int, error) {
	return f.attempts, nil
}

func (f *fakeRepo) RecordAttempt(_ context.Context, _, _ string, success bool, _ time.Time) error {
	f.attempts++
	_ = success
	return nil
}

func (f *fakeRepo) ConfirmSessionPassword(_ context.Context, sessionID string, at time.Time) error {
	f.confirmedSessionID = sessionID
	f.confirmedAt = at
	return nil
}

func newSessionMux(f *fakeRepo) *http.ServeMux {
	clock := func() time.Time { return frozen }
	sessions := app.NewSessionService(f, fakeMail{}, app.SessionConfig{AllowSignup: true, SecretPepper: "p"}, time.Hour, 0, clock)
	account := app.NewAccountService(f, fakeMail{}, app.AccountConfig{SecretPepper: "p", LinkBaseURL: "http://localhost:5173"}, clock)
	mux := http.NewServeMux()
	httplib.Mount(mux, httplib.Deps{Account: account, SessionsSvc: sessions, AuthCfg: webx.DefaultAuthConfig()})
	return mux
}

func TestSessions_CurrentFlag(t *testing.T) {
	f := newFakeRepo(app.User{ID: "u1", Email: "u1@example.com", Status: "active"})
	f.sessions = []app.SessionInfo{
		{ID: "s-cur", UserAgent: "current browser"},
		{ID: "s-other", UserAgent: "other device"},
	}
	p := &webx.Principal{UserID: "u1", SessionID: "s-cur", Source: webx.SourceSession}
	w := doJSON(t, newSessionMux(f), http.MethodGet, "/auth/sessions", nil, p)
	require.Equal(t, http.StatusOK, w.Code)
	var list []app.SessionInfo
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &list))
	require.Len(t, list, 2)
	assert.True(t, list[0].Current, "当前会话应标注 current=true")
	assert.False(t, list[1].Current)
}

func TestRevokeSessionRoute(t *testing.T) {
	sessionUser := &webx.Principal{UserID: "u1", SessionID: "s-cur", Source: webx.SourceSession}
	patUser := &webx.Principal{UserID: "u1", Source: webx.SourcePAT}

	tests := []struct {
		name       string
		p          *webx.Principal
		sessionID  string
		wantStatus int
		wantErr    string
	}{
		{"未认证 401(RequireHuman, API-FT2-12 修复后与 PAT 403 区分)", nil, "s1", http.StatusUnauthorized, webx.CodeUnauthenticated},
		{"PAT 调用 403", patUser, "s1", http.StatusForbidden, webx.CodeForbidden},
		{"本人会话 204", sessionUser, "s1", http.StatusNoContent, ""},
		{"吊销当前会话 204(等价登出,不特判)", sessionUser, "s-cur", http.StatusNoContent, ""},
		{"不存在 404", sessionUser, "missing", http.StatusNotFound, webx.CodeNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newFakeRepo(app.User{ID: "u1", Email: "u1@example.com", Status: "active"})
			f.revokeOKIDs = map[string]bool{"s1": true, "s-cur": true}
			f.sessions = []app.SessionInfo{{ID: "s-cur"}}
			w := doJSON(t, newSessionMux(f), http.MethodDelete, "/auth/sessions/"+tt.sessionID, nil, tt.p)
			require.Equal(t, tt.wantStatus, w.Code)
			if tt.wantErr != "" {
				code, _ := errEnvelope(t, w)
				assert.Equal(t, tt.wantErr, code)
			}
		})
	}

	t.Run("重复吊销第二次 404(幂等)", func(t *testing.T) {
		f := newFakeRepo(app.User{ID: "u1", Email: "u1@example.com", Status: "active"})
		f.revokeOKIDs = map[string]bool{"s1": true}
		mux := newSessionMux(f)
		w := doJSON(t, mux, http.MethodDelete, "/auth/sessions/s1", nil, sessionUser)
		require.Equal(t, http.StatusNoContent, w.Code)
		w = doJSON(t, mux, http.MethodDelete, "/auth/sessions/s1", nil, sessionUser)
		require.Equal(t, http.StatusNotFound, w.Code)
		code, _ := errEnvelope(t, w)
		assert.Equal(t, webx.CodeNotFound, code)
	})

	t.Run("吊销限定本人(userID 透传)", func(t *testing.T) {
		f := newFakeRepo(app.User{ID: "u1", Email: "u1@example.com", Status: "active"})
		f.revokeOKIDs = map[string]bool{"s1": true}
		w := doJSON(t, newSessionMux(f), http.MethodDelete, "/auth/sessions/s1", nil, sessionUser)
		require.Equal(t, http.StatusNoContent, w.Code)
		assert.Equal(t, "u1", f.revokeGotUser)
	})
}

func TestMeRoute(t *testing.T) {
	sessionUser := &webx.Principal{UserID: "u-admin", SessionID: "s1", Source: webx.SourceSession}

	tests := []struct {
		name      string
		user      app.User
		wantAdmin bool
	}{
		{"平台管理员 is_platform_admin=true", app.User{ID: "u-admin", Email: "a@example.com", Status: "active", IsPlatformAdmin: true}, true},
		{"普通用户 is_platform_admin=false", app.User{ID: "u-admin", Email: "a@example.com", Status: "active"}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newFakeRepo(tt.user)
			w := doJSON(t, newSessionMux(f), http.MethodGet, "/auth/me", nil, sessionUser)
			require.Equal(t, http.StatusOK, w.Code)
			var body app.User
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body), "body: %s", w.Body.String())
			assert.Equal(t, "u-admin", body.ID)
			assert.Equal(t, tt.wantAdmin, body.IsPlatformAdmin, "is_platform_admin 应来自用户行（DB 事实源）")

			assert.Equal(t, "a@example.com", body.Email)
			assert.Equal(t, "active", body.Status)
		})
	}

	t.Run("模拟会话透出 impersonated_by（AD6-v2 / ADR 0008）", func(t *testing.T) {
		f := newFakeRepo(app.User{ID: "u-target", Email: "t@example.com", Status: "active"})
		impP := &webx.Principal{UserID: "u-target", SessionID: "s2", Source: webx.SourceSession, ImpersonatedBy: "u-admin-1"}
		w := doJSON(t, newSessionMux(f), http.MethodGet, "/auth/me", nil, impP)
		require.Equal(t, http.StatusOK, w.Code)
		var body struct {
			app.User
			ImpersonatedBy string `json:"impersonated_by"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body), "body: %s", w.Body.String())
		assert.Equal(t, "u-target", body.ID)
		assert.Equal(t, "u-admin-1", body.ImpersonatedBy, "模拟会话的 me 必须带发起管理员 ID")
	})

	t.Run("普通会话省略 impersonated_by（字节级兼容）", func(t *testing.T) {
		f := newFakeRepo(app.User{ID: "u-admin", Email: "a@example.com", Status: "active"})
		w := doJSON(t, newSessionMux(f), http.MethodGet, "/auth/me", nil, sessionUser)
		require.Equal(t, http.StatusOK, w.Code)
		assert.NotContains(t, w.Body.String(), "impersonated_by", "普通会话不得出现模拟标记字段")
	})
}

func TestDeleteMeRoute(t *testing.T) {
	sessionUser := &webx.Principal{UserID: "u1", SessionID: "s-cur", Source: webx.SourceSession}
	patUser := &webx.Principal{UserID: "u1", Source: webx.SourcePAT}

	t.Run("未认证 401(RequireHuman, API-FT2-12)", func(t *testing.T) {
		f := newFakeRepo(app.User{ID: "u1", Email: "u1@example.com", Status: "active"})
		w := doJSON(t, newSessionMux(f), http.MethodDelete, "/auth/me", nil, nil)
		assert.Equal(t, http.StatusUnauthorized, w.Code)
		assert.False(t, f.softDeleted)
	})

	t.Run("PAT 调用 403", func(t *testing.T) {
		f := newFakeRepo(app.User{ID: "u1", Email: "u1@example.com", Status: "active"})
		w := doJSON(t, newSessionMux(f), http.MethodDelete, "/auth/me", nil, patUser)
		assert.Equal(t, http.StatusForbidden, w.Code)
		assert.False(t, f.softDeleted)
	})

	t.Run("浏览器会话 204 + 软删除本人 + 清 cookie", func(t *testing.T) {
		f := newFakeRepo(app.User{ID: "u1", Email: "u1@example.com", Status: "active"})
		w := doJSON(t, newSessionMux(f), http.MethodDelete, "/auth/me", nil, sessionUser)
		require.Equal(t, http.StatusNoContent, w.Code)
		assert.True(t, f.softDeleted)
		assert.Equal(t, "u1", f.softDeletedID)
		assert.Contains(t, w.Header().Get("Set-Cookie"), webx.DefaultAuthConfig().CookieName,
			"注销后应清会话 cookie")
	})

	t.Run("用户不存在 404", func(t *testing.T) {
		f := newFakeRepo(app.User{ID: "u1", Email: "u1@example.com", Status: "active"})
		f.softDeleted = true
		w := doJSON(t, newSessionMux(f), http.MethodDelete, "/auth/me", nil, sessionUser)
		require.Equal(t, http.StatusNotFound, w.Code)
		code, _ := errEnvelope(t, w)
		assert.Equal(t, webx.CodeNotFound, code)
	})

	t.Run("Account 未接线 500", func(t *testing.T) {
		mux := http.NewServeMux()
		httplib.Mount(mux, httplib.Deps{AuthCfg: webx.DefaultAuthConfig()})
		w := doJSON(t, mux, http.MethodDelete, "/auth/me", nil, sessionUser)
		assert.Equal(t, http.StatusInternalServerError, w.Code)
	})
}

func TestDisplayNameLimit_FT28(t *testing.T) {
	sessionUser := &webx.Principal{UserID: "u1", Source: webx.SourceSession}

	register := func(t *testing.T, mux *http.ServeMux, displayName string) *httptest.ResponseRecorder {
		t.Helper()
		return doJSON(t, mux, http.MethodPost, "/auth/register", map[string]string{
			"email": "ft28@example.com", "password": "StrongPass123!", "display_name": displayName,
		}, nil)
	}
	patchMe := func(t *testing.T, mux *http.ServeMux, displayName string) *httptest.ResponseRecorder {
		t.Helper()
		return doJSON(t, mux, http.MethodPatch, "/auth/me", map[string]string{
			"display_name": displayName, "avatar_url": "https://cdn.example.com/a.png",
		}, sessionUser)
	}

	t.Run("注册 1.2MB display_name → 400 E_VALIDATION", func(t *testing.T) {
		f := newFakeRepo(app.User{ID: "u1", Email: "u1@example.com", Status: "active"})
		w := register(t, newSessionMux(f), strings.Repeat("x", 1_200_000))
		require.Equal(t, http.StatusBadRequest, w.Code)
		code, msg := errEnvelope(t, w)
		assert.Equal(t, webx.CodeValidation, code)
		assert.Contains(t, msg, "display_name")
	})

	t.Run("注册纯空白 display_name → 400", func(t *testing.T) {
		f := newFakeRepo(app.User{ID: "u1", Email: "u1@example.com", Status: "active"})
		w := register(t, newSessionMux(f), "   ")
		assert.Equal(t, http.StatusBadRequest, w.Code)
		code, msg := errEnvelope(t, w)
		assert.Equal(t, webx.CodeValidation, code)
		assert.Contains(t, msg, "display_name")
	})

	t.Run("PATCH 101 rune → 400 且不触达仓储", func(t *testing.T) {
		f := newFakeRepo(app.User{ID: "u1", Email: "u1@example.com", Status: "active"})
		w := patchMe(t, newSessionMux(f), strings.Repeat("a", 101))
		require.Equal(t, http.StatusBadRequest, w.Code)
		code, msg := errEnvelope(t, w)
		assert.Equal(t, webx.CodeValidation, code)
		assert.Contains(t, msg, "display_name")
		assert.Equal(t, [3]string{}, f.updatedProfile)
	})

	t.Run("PATCH 100 rune 边界 → 200 且 trim 归一落库", func(t *testing.T) {
		f := newFakeRepo(app.User{ID: "u1", Email: "u1@example.com", Status: "active"})
		dn := "  " + strings.Repeat("名", 100) + "  "
		w := patchMe(t, newSessionMux(f), dn)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		assert.Equal(t, [3]string{"u1", strings.Repeat("名", 100), "https://cdn.example.com/a.png"}, f.updatedProfile)
	})
}

func TestConfirmPasswordRoute(t *testing.T) {
	hash, err := app.HashPassword("correct horse battery")
	require.NoError(t, err)
	sessionUser := &webx.Principal{UserID: "u1", SessionID: "s-cur", Source: webx.SourceSession}

	newRepo := func() *fakeRepo {
		return newFakeRepo(app.User{ID: "u1", Email: "u1@example.com", Status: "active", PasswordHash: hash})
	}

	t.Run("密码正确 → 200 并盖戳当前会话", func(t *testing.T) {
		f := newRepo()
		w := doJSON(t, newSessionMux(f), http.MethodPost, "/auth/confirm-password",
			map[string]string{"password": "correct horse battery"}, sessionUser)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		assert.Equal(t, "s-cur", f.confirmedSessionID)
		assert.False(t, f.confirmedAt.IsZero())
		var body struct {
			PasswordConfirmedAt time.Time `json:"password_confirmed_at"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		assert.False(t, body.PasswordConfirmedAt.IsZero())
	})

	t.Run("密码错误 → 401 且不盖戳", func(t *testing.T) {
		f := newRepo()
		w := doJSON(t, newSessionMux(f), http.MethodPost, "/auth/confirm-password",
			map[string]string{"password": "wrong"}, sessionUser)
		require.Equal(t, http.StatusUnauthorized, w.Code)
		code, _ := errEnvelope(t, w)
		assert.Equal(t, webx.CodeUnauthenticated, code)
		assert.Empty(t, f.confirmedSessionID)
	})

	t.Run("PAT 调用 → 403（step-up 只属于交互会话）", func(t *testing.T) {
		f := newRepo()
		w := doJSON(t, newSessionMux(f), http.MethodPost, "/auth/confirm-password",
			map[string]string{"password": "correct horse battery"},
			&webx.Principal{UserID: "u1", Source: webx.SourcePAT})
		require.Equal(t, http.StatusForbidden, w.Code)
		assert.Empty(t, f.confirmedSessionID)
	})

	t.Run("未认证 → 401", func(t *testing.T) {
		f := newRepo()
		w := doJSON(t, newSessionMux(f), http.MethodPost, "/auth/confirm-password",
			map[string]string{"password": "correct horse battery"}, nil)
		require.Equal(t, http.StatusUnauthorized, w.Code)
	})
}
