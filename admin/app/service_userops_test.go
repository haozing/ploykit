package app_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/admin/app"
	"github.com/haozing/ploykit/platform/webx"
)

func (f *fakeRepo) GetUserByID(_ context.Context, userID string) (app.AdminUser, bool, error) {
	for _, u := range f.users {
		if u.ID == userID {
			return u, true, nil
		}
	}
	return app.AdminUser{}, false, nil
}

type fakeUserOps struct {
	user     app.AdminUser
	found    bool
	getErr   error
	sessions []app.UserSession
	pats     []app.AdminPAT

	revokedAll  []string
	revokedSess []string
	revokeErr   error

	resetMails   []string
	verifyMails  [][2]string
	marked       []string
	revokedPATs  [][2]string
	revokePATErr error

	deleted   [][2]string
	deleteErr error
}

func (f *fakeUserOps) GetUser(_ context.Context, _ string) (app.AdminUser, bool, error) {
	return f.user, f.found, f.getErr
}
func (f *fakeUserOps) ListSessions(_ context.Context, _ string) ([]app.UserSession, error) {
	return f.sessions, nil
}
func (f *fakeUserOps) RevokeAllSessions(_ context.Context, userID string) error {
	f.revokedAll = append(f.revokedAll, userID)
	return nil
}
func (f *fakeUserOps) RevokeSessionByID(_ context.Context, _, sessionID string) error {
	f.revokedSess = append(f.revokedSess, sessionID)
	return f.revokeErr
}
func (f *fakeUserOps) SendPasswordReset(_ context.Context, email string) error {
	f.resetMails = append(f.resetMails, email)
	return nil
}
func (f *fakeUserOps) ResendEmailVerification(_ context.Context, userID, email string) error {
	f.verifyMails = append(f.verifyMails, [2]string{userID, email})
	return nil
}
func (f *fakeUserOps) MarkEmailVerified(_ context.Context, userID string) error {
	f.marked = append(f.marked, userID)
	return nil
}
func (f *fakeUserOps) ListPATs(_ context.Context, _ string) ([]app.AdminPAT, error) {
	return f.pats, nil
}
func (f *fakeUserOps) RevokePAT(_ context.Context, userID, patID string) error {
	f.revokedPATs = append(f.revokedPATs, [2]string{userID, patID})
	return f.revokePATErr
}
func (f *fakeUserOps) DeleteAccount(_ context.Context, actorEmail, userID string) error {
	f.deleted = append(f.deleted, [2]string{actorEmail, userID})
	return f.deleteErr
}

type fakeWsLister struct {
	ws  []app.AdminUserWorkspace
	err error
}

func (f *fakeWsLister) ListUserWorkspaces(_ context.Context, _ string) ([]app.AdminUserWorkspace, error) {
	return f.ws, f.err
}

type opsAuditor struct {
	calls []opsAuditCall
}

type opsAuditCall struct {
	wsID                   *string
	action, resType, resID string
	meta                   map[string]any
}

func (a *opsAuditor) Record(_ context.Context, wsID *string, _ *webx.Principal, action, resType, resID string, meta map[string]any) {
	a.calls = append(a.calls, opsAuditCall{wsID: wsID, action: action, resType: resType, resID: resID, meta: meta})
}

var userOpsAdmin = &webx.Principal{UserID: "op", Email: "op@test.local", IsPlatformAdmin: true}

func newUserOpsSvc(users []app.AdminUser, ops app.UserDetailProvider, aud app.Auditor) *app.UserOpsService {
	base := newAdminSvc(&fakeRepo{users: users})
	if aud != nil {
		base = base.WithAuditor(aud)
	}
	return app.NewUserOpsService(base).WithUserOps(ops)
}

func assertWErr(t *testing.T, err error, status int, code string) {
	t.Helper()
	var we *webx.Error
	require.ErrorAs(t, err, &we, "expected webx.Error, got %v", err)
	assert.Equal(t, status, we.Status)
	assert.Equal(t, code, we.Code)
}

func seedUser(id, email string) app.AdminUser {

	return app.AdminUser{ID: id, Email: email, DisplayName: id, Status: "active",
		CreatedAt: time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC)}
}

func TestGetUserDetail(t *testing.T) {
	u1 := seedUser("u1", "u1@x.com")
	ops := &fakeUserOps{
		user:     u1,
		found:    true,
		sessions: []app.UserSession{{ID: "s1", Device: "curl"}},
		pats:     []app.AdminPAT{{ID: "p1", Name: "ci"}},
	}

	t.Run("聚合 资料+会话+PAT+工作区", func(t *testing.T) {
		svc := newUserOpsSvc([]app.AdminUser{u1}, ops, nil).
			WithWorkspaceLister(&fakeWsLister{ws: []app.AdminUserWorkspace{{ID: "w1", Slug: "acme", Role: "owner"}}})
		d, err := svc.GetUserDetail(t.Context(), "u1")
		require.NoError(t, err)
		assert.Equal(t, "u1", d.User.ID)
		require.Len(t, d.Sessions, 1)
		assert.Equal(t, "s1", d.Sessions[0].ID)
		require.Len(t, d.PATs, 1)
		require.Len(t, d.Workspaces, 1)
		assert.Equal(t, "owner", d.Workspaces[0].Role)
	})

	t.Run("WorkspaceLister 未接线 → 工作区为空列表（静默降级）", func(t *testing.T) {
		svc := newUserOpsSvc([]app.AdminUser{u1}, ops, nil)
		d, err := svc.GetUserDetail(t.Context(), "u1")
		require.NoError(t, err)
		assert.Empty(t, d.Workspaces)
	})

	t.Run("目标不存在 → 404", func(t *testing.T) {
		svc := newUserOpsSvc(nil, &fakeUserOps{}, nil)
		_, err := svc.GetUserDetail(t.Context(), "ghost")
		assertWErr(t, err, 404, webx.CodeNotFound)
	})

	t.Run("UserOps 未接线 → 503", func(t *testing.T) {
		svc := newUserOpsSvc([]app.AdminUser{u1}, nil, nil)
		_, err := svc.GetUserDetail(t.Context(), "u1")
		assertWErr(t, err, 503, webx.CodeUnavailable)
	})
}

func TestKickUser(t *testing.T) {
	u1 := seedUser("u1", "u1@x.com")

	t.Run("吊销全部会话 + 审计 admin.user_kick", func(t *testing.T) {
		ops := &fakeUserOps{}
		rec := &opsAuditor{}
		svc := newUserOpsSvc([]app.AdminUser{u1}, ops, rec)
		require.NoError(t, svc.KickUser(t.Context(), userOpsAdmin, "u1"))
		assert.Equal(t, []string{"u1"}, ops.revokedAll)
		require.Len(t, rec.calls, 1)
		assert.Nil(t, rec.calls[0].wsID, "平台级事件 workspaceID=nil")
		assert.Equal(t, "admin.user_kick", rec.calls[0].action)
		assert.Equal(t, "user", rec.calls[0].resType)
		assert.Equal(t, "u1", rec.calls[0].resID)
	})

	t.Run("目标不存在 → 404 且不吊销不留审计", func(t *testing.T) {
		ops := &fakeUserOps{}
		rec := &opsAuditor{}
		svc := newUserOpsSvc(nil, ops, rec)
		assertWErr(t, svc.KickUser(t.Context(), userOpsAdmin, "ghost"), 404, webx.CodeNotFound)
		assert.Empty(t, ops.revokedAll)
		assert.Empty(t, rec.calls)
	})

	t.Run("未接线 → 503", func(t *testing.T) {
		svc := newUserOpsSvc([]app.AdminUser{u1}, nil, nil)
		assertWErr(t, svc.KickUser(t.Context(), userOpsAdmin, "u1"), 503, webx.CodeUnavailable)
	})
}

func TestKickSession(t *testing.T) {
	u1 := seedUser("u1", "u1@x.com")

	t.Run("吊销单会话 + 审计带 session_id", func(t *testing.T) {
		ops := &fakeUserOps{}
		rec := &opsAuditor{}
		svc := newUserOpsSvc([]app.AdminUser{u1}, ops, rec)
		require.NoError(t, svc.KickSession(t.Context(), userOpsAdmin, "u1", "s9"))
		assert.Equal(t, []string{"s9"}, ops.revokedSess)
		require.Len(t, rec.calls, 1)
		assert.Equal(t, "admin.user_session_revoke", rec.calls[0].action)
		assert.Equal(t, map[string]any{"session_id": "s9"}, rec.calls[0].meta)
	})

	t.Run("端口 404（不存在/已吊销）原样透传且不留审计", func(t *testing.T) {
		ops := &fakeUserOps{revokeErr: webx.NewNotFound("session not found")}
		rec := &opsAuditor{}
		svc := newUserOpsSvc([]app.AdminUser{u1}, ops, rec)
		assertWErr(t, svc.KickSession(t.Context(), userOpsAdmin, "u1", "sX"), 404, webx.CodeNotFound)
		assert.Empty(t, rec.calls)
	})
}

func TestAdminResetPassword(t *testing.T) {
	u1 := seedUser("u1", "u1@x.com")

	t.Run("按目标邮箱发重置 + 审计 admin.user_password_reset", func(t *testing.T) {
		ops := &fakeUserOps{}
		rec := &opsAuditor{}
		svc := newUserOpsSvc([]app.AdminUser{u1}, ops, rec)
		require.NoError(t, svc.AdminResetPassword(t.Context(), userOpsAdmin, "u1"))
		assert.Equal(t, []string{"u1@x.com"}, ops.resetMails)
		require.Len(t, rec.calls, 1)
		assert.Equal(t, "admin.user_password_reset", rec.calls[0].action)
		assert.Equal(t, map[string]any{"target_email": "u1@x.com"}, rec.calls[0].meta)
	})

	t.Run("目标不存在 → 404", func(t *testing.T) {
		svc := newUserOpsSvc(nil, &fakeUserOps{}, nil)
		assertWErr(t, svc.AdminResetPassword(t.Context(), userOpsAdmin, "ghost"), 404, webx.CodeNotFound)
	})
}

func TestResendVerification(t *testing.T) {
	unverified := seedUser("u1", "u1@x.com")
	verified := seedUser("v1", "v1@x.com")
	verified.EmailVerified = true

	t.Run("未验证 → 补发 + 审计", func(t *testing.T) {
		ops := &fakeUserOps{}
		rec := &opsAuditor{}
		svc := newUserOpsSvc([]app.AdminUser{unverified}, ops, rec)
		require.NoError(t, svc.ResendVerification(t.Context(), userOpsAdmin, "u1"))
		assert.Equal(t, [][2]string{{"u1", "u1@x.com"}}, ops.verifyMails)
		require.Len(t, rec.calls, 1)
		assert.Equal(t, "admin.user_verification_resend", rec.calls[0].action)
	})

	t.Run("已验证 → 409 且不发信不留审计", func(t *testing.T) {
		ops := &fakeUserOps{}
		rec := &opsAuditor{}
		svc := newUserOpsSvc([]app.AdminUser{verified}, ops, rec)
		assertWErr(t, svc.ResendVerification(t.Context(), userOpsAdmin, "v1"), 409, webx.CodeConflict)
		assert.Empty(t, ops.verifyMails)
		assert.Empty(t, rec.calls)
	})
}

func TestMarkVerified(t *testing.T) {
	unverified := seedUser("u1", "u1@x.com")
	verified := seedUser("v1", "v1@x.com")
	verified.EmailVerified = true

	t.Run("未验证 → 标记 + 审计", func(t *testing.T) {
		ops := &fakeUserOps{}
		rec := &opsAuditor{}
		svc := newUserOpsSvc([]app.AdminUser{unverified}, ops, rec)
		require.NoError(t, svc.MarkVerified(t.Context(), userOpsAdmin, "u1"))
		assert.Equal(t, []string{"u1"}, ops.marked)
		require.Len(t, rec.calls, 1)
		assert.Equal(t, "admin.user_mark_verified", rec.calls[0].action)
	})

	t.Run("已验证 → 幂等成功：不触端口不留审计", func(t *testing.T) {
		ops := &fakeUserOps{}
		rec := &opsAuditor{}
		svc := newUserOpsSvc([]app.AdminUser{verified}, ops, rec)
		require.NoError(t, svc.MarkVerified(t.Context(), userOpsAdmin, "v1"))
		assert.Empty(t, ops.marked)
		assert.Empty(t, rec.calls)
	})
}

func TestUserPATs(t *testing.T) {
	u1 := seedUser("u1", "u1@x.com")

	t.Run("列表透传（只读不留审计）", func(t *testing.T) {
		ops := &fakeUserOps{pats: []app.AdminPAT{{ID: "p1"}, {ID: "p2"}}}
		rec := &opsAuditor{}
		svc := newUserOpsSvc([]app.AdminUser{u1}, ops, rec)
		pats, err := svc.ListUserPATs(t.Context(), "u1")
		require.NoError(t, err)
		assert.Len(t, pats, 2)
		assert.Empty(t, rec.calls)
	})

	t.Run("吊销 + 审计 admin.user_pat_revoke 带 pat_id", func(t *testing.T) {
		ops := &fakeUserOps{}
		rec := &opsAuditor{}
		svc := newUserOpsSvc([]app.AdminUser{u1}, ops, rec)
		require.NoError(t, svc.RevokeUserPAT(t.Context(), userOpsAdmin, "u1", "p1"))
		assert.Equal(t, [][2]string{{"u1", "p1"}}, ops.revokedPATs)
		require.Len(t, rec.calls, 1)
		assert.Equal(t, "admin.user_pat_revoke", rec.calls[0].action)
		assert.Equal(t, map[string]any{"pat_id": "p1"}, rec.calls[0].meta)
	})

	t.Run("端口 404 透传", func(t *testing.T) {
		ops := &fakeUserOps{revokePATErr: webx.NewNotFound("token not found")}
		svc := newUserOpsSvc([]app.AdminUser{u1}, ops, nil)
		assertWErr(t, svc.RevokeUserPAT(t.Context(), userOpsAdmin, "u1", "px"), 404, webx.CodeNotFound)
	})
}

func TestAdminDeleteUser(t *testing.T) {
	u1 := seedUser("u1", "u1@x.com")
	admin2 := seedUser("a2", "a2@x.com")
	admin2.IsPlatformAdmin = true

	t.Run("确认匹配 → 软删 + 审计 admin.user_delete", func(t *testing.T) {
		ops := &fakeUserOps{}
		rec := &opsAuditor{}
		svc := newUserOpsSvc([]app.AdminUser{u1}, ops, rec)
		require.NoError(t, svc.AdminDeleteUser(t.Context(), userOpsAdmin, "u1", "u1@x.com"))
		assert.Equal(t, [][2]string{{userOpsAdmin.Email, "u1"}}, ops.deleted)
		require.Len(t, rec.calls, 1)
		assert.Equal(t, "admin.user_delete", rec.calls[0].action)
		assert.Equal(t, map[string]any{"target_email": "u1@x.com"}, rec.calls[0].meta)
	})

	t.Run("确认邮箱不匹配 → 400 且不删", func(t *testing.T) {
		ops := &fakeUserOps{}
		svc := newUserOpsSvc([]app.AdminUser{u1}, ops, nil)
		assertWErr(t, svc.AdminDeleteUser(t.Context(), userOpsAdmin, "u1", "wrong@x.com"), 400, webx.CodeValidation)
		assert.Empty(t, ops.deleted)
	})

	t.Run("确认邮箱大小写/空白宽容", func(t *testing.T) {
		ops := &fakeUserOps{}
		svc := newUserOpsSvc([]app.AdminUser{u1}, ops, nil)
		require.NoError(t, svc.AdminDeleteUser(t.Context(), userOpsAdmin, "u1", "  U1@X.COM "))
		assert.Len(t, ops.deleted, 1)
	})

	t.Run("自我删除 → 400", func(t *testing.T) {
		ops := &fakeUserOps{}
		svc := newUserOpsSvc([]app.AdminUser{u1}, ops, nil)
		self := &webx.Principal{UserID: "u1", Email: "u1@x.com", IsPlatformAdmin: true}
		assertWErr(t, svc.AdminDeleteUser(t.Context(), self, "u1", "u1@x.com"), 400, webx.CodeValidation)
		assert.Empty(t, ops.deleted)
	})

	t.Run("删除另一平台管理员 → 403", func(t *testing.T) {
		ops := &fakeUserOps{}
		svc := newUserOpsSvc([]app.AdminUser{admin2}, ops, nil)
		assertWErr(t, svc.AdminDeleteUser(t.Context(), userOpsAdmin, "a2", "a2@x.com"), 403, webx.CodeForbidden)
		assert.Empty(t, ops.deleted)
	})

	t.Run("目标不存在 → 404；端口失败透传不留审计", func(t *testing.T) {
		svc := newUserOpsSvc(nil, &fakeUserOps{}, nil)
		assertWErr(t, svc.AdminDeleteUser(t.Context(), userOpsAdmin, "ghost", "ghost@x.com"), 404, webx.CodeNotFound)

		rec := &opsAuditor{}
		ops := &fakeUserOps{deleteErr: assert.AnError}
		svc = newUserOpsSvc([]app.AdminUser{u1}, ops, rec)
		require.Error(t, svc.AdminDeleteUser(t.Context(), userOpsAdmin, "u1", "u1@x.com"))
		assert.Empty(t, rec.calls, "失败不应记审计")
	})
}

func TestUserOpsNilAuditorNoPanic(t *testing.T) {
	u1 := seedUser("u1", "u1@x.com")
	svc := newUserOpsSvc([]app.AdminUser{u1}, &fakeUserOps{}, nil)
	assert.NotPanics(t, func() {
		require.NoError(t, svc.KickUser(t.Context(), userOpsAdmin, "u1"))
		require.NoError(t, svc.AdminDeleteUser(t.Context(), userOpsAdmin, "u1", "u1@x.com"))
	})
}

func TestSetUserStatusSetAdmin_TargetNotFound_P3_19(t *testing.T) {
	repo := &fakeRepo{statusErr: app.ErrNotFound, users: nil}

	svc := newAdminSvc(repo)
	err := svc.DisableUser(t.Context(), userOpsAdmin, "ghost")
	assertWErr(t, err, 404, webx.CodeNotFound)
	err = svc.EnableUser(t.Context(), userOpsAdmin, "ghost")
	assertWErr(t, err, 404, webx.CodeNotFound)
}

func TestAccessDisruptingOps_RejectAdminTarget_P3_20(t *testing.T) {
	admin2 := seedUser("admin2", "admin2@x.com")
	admin2.IsPlatformAdmin = true

	self := &webx.Principal{UserID: "admin2", Email: "admin2@x.com", IsPlatformAdmin: true}

	t.Run("Kick 另一管理员 → 403", func(t *testing.T) {
		ops := &fakeUserOps{}
		svc := newUserOpsSvc([]app.AdminUser{admin2}, ops, nil)
		err := svc.KickUser(t.Context(), userOpsAdmin, "admin2")
		assertWErr(t, err, 403, webx.CodeForbidden)
		assert.Empty(t, ops.revokedAll, "拒绝路径不得吊销会话")
	})
	t.Run("KickSession 另一管理员 → 403", func(t *testing.T) {
		ops := &fakeUserOps{}
		svc := newUserOpsSvc([]app.AdminUser{admin2}, ops, nil)
		err := svc.KickSession(t.Context(), userOpsAdmin, "admin2", "s1")
		assertWErr(t, err, 403, webx.CodeForbidden)
		assert.Empty(t, ops.revokedSess)
	})
	t.Run("ResetPassword 另一管理员 → 403", func(t *testing.T) {
		ops := &fakeUserOps{}
		svc := newUserOpsSvc([]app.AdminUser{admin2}, ops, nil)
		err := svc.AdminResetPassword(t.Context(), userOpsAdmin, "admin2")
		assertWErr(t, err, 403, webx.CodeForbidden)
		assert.Empty(t, ops.resetMails)
	})
	t.Run("RevokePAT 另一管理员 → 403", func(t *testing.T) {
		ops := &fakeUserOps{}
		svc := newUserOpsSvc([]app.AdminUser{admin2}, ops, nil)
		err := svc.RevokeUserPAT(t.Context(), userOpsAdmin, "admin2", "pat-1")
		assertWErr(t, err, 403, webx.CodeForbidden)
		assert.Empty(t, ops.revokedPATs)
	})
	t.Run("Kick 自己（自助登出全部设备）仍放行", func(t *testing.T) {
		ops := &fakeUserOps{}
		svc := newUserOpsSvc([]app.AdminUser{admin2}, ops, nil)
		require.NoError(t, svc.KickUser(t.Context(), self, "admin2"))
		assert.Equal(t, []string{"admin2"}, ops.revokedAll)
	})
	t.Run("普通用户目标不受影响", func(t *testing.T) {
		u1 := seedUser("u1", "u1@x.com")
		ops := &fakeUserOps{}
		svc := newUserOpsSvc([]app.AdminUser{u1}, ops, nil)
		require.NoError(t, svc.KickUser(t.Context(), userOpsAdmin, "u1"))
		require.NoError(t, svc.AdminResetPassword(t.Context(), userOpsAdmin, "u1"))
		assert.Equal(t, []string{"u1@x.com"}, ops.resetMails)
	})
}
