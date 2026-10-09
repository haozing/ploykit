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

type fakeRepo struct {
	app.Repo

	gotChangePlan struct {
		workspaceID, toPlan, actor, reason string
	}
	changePlanFrom string
	changePlanErr  error

	gotStatus struct{ userID, status string }
	statusErr error

	users      []app.AdminUser
	wsTotal    int
	userTotal  int
	workspaces []app.AdminWorkspace

	gotWsQ      string
	gotWsCountQ string
}

func (f *fakeRepo) ChangePlan(_ context.Context, workspaceID, toPlan, actor, reason string, _ time.Time) (string, error) {
	f.gotChangePlan.workspaceID, f.gotChangePlan.toPlan = workspaceID, toPlan
	f.gotChangePlan.actor, f.gotChangePlan.reason = actor, reason
	return f.changePlanFrom, f.changePlanErr
}

func (f *fakeRepo) ListUsers(_ context.Context, q, status string, limit, offset int) ([]app.AdminUser, error) {
	return f.users, nil
}

func (f *fakeRepo) CountUsers(_ context.Context, q, status string) (int, error) {
	return f.userTotal, nil
}

func (f *fakeRepo) PlanExists(_ context.Context, code string) (bool, error) {
	return code == "free" || code == "pro", nil
}

func (f *fakeRepo) ListWorkspaces(_ context.Context, q string, limit, offset int) ([]app.AdminWorkspace, error) {
	f.gotWsQ = q
	return f.workspaces, nil
}

func (f *fakeRepo) CountWorkspaces(_ context.Context, q string) (int, error) {
	f.gotWsCountQ = q
	return f.wsTotal, nil
}

func (f *fakeRepo) SetUserStatus(_ context.Context, userID, status string) error {
	f.gotStatus.userID, f.gotStatus.status = userID, status
	return f.statusErr
}

type fakeAuditor struct {
	calls          int
	gotWorkspaceID *string
	gotP           *webx.Principal
	gotAction      string
	gotResType     string
	gotResID       string
	gotMeta        map[string]any
}

func (f *fakeAuditor) Record(_ context.Context, workspaceID *string, p *webx.Principal, action, resourceType, resourceID string, meta map[string]any) {
	f.calls++
	f.gotWorkspaceID, f.gotP = workspaceID, p
	f.gotAction, f.gotResType, f.gotResID, f.gotMeta = action, resourceType, resourceID, meta
}

type fakeRevoker struct{ err error }

func (f *fakeRevoker) RevokeAllUserSessions(_ context.Context, _ string) error { return f.err }

func newAdminSvc(repo app.Repo) *app.AdminService {
	return app.NewAdminService(repo, func() time.Time { return time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC) })
}

func TestChangePlan_RecordsAudit(t *testing.T) {
	adminP := &webx.Principal{UserID: "op", Email: "op@test.local", IsPlatformAdmin: true}

	t.Run("成功 → 审计 admin.plan_change（meta 含 from/to）", func(t *testing.T) {
		repo := &fakeRepo{changePlanFrom: "free"}
		rec := &fakeAuditor{}
		svc := newAdminSvc(repo).WithAuditor(rec)

		require.NoError(t, svc.ChangePlan(t.Context(), adminP, "ws-1", "pro"))

		assert.Equal(t, "ws-1", repo.gotChangePlan.workspaceID)
		assert.Equal(t, "pro", repo.gotChangePlan.toPlan)
		assert.Equal(t, adminP.Email, repo.gotChangePlan.actor)
		assert.Equal(t, "admin manual", repo.gotChangePlan.reason)

		require.Equal(t, 1, rec.calls)
		require.NotNil(t, rec.gotWorkspaceID)
		assert.Equal(t, "ws-1", *rec.gotWorkspaceID)
		require.NotNil(t, rec.gotP)
		assert.Equal(t, "op", rec.gotP.UserID, "审计 actor 是平台管理员本人")
		assert.Equal(t, "admin.plan_change", rec.gotAction)
		assert.Equal(t, "workspace", rec.gotResType)
		assert.Equal(t, "ws-1", rec.gotResID)
		assert.Equal(t, map[string]any{"from": "free", "to": "pro"}, rec.gotMeta)
	})

	t.Run("变更失败不写审计", func(t *testing.T) {
		repo := &fakeRepo{changePlanErr: assert.AnError}
		rec := &fakeAuditor{}
		svc := newAdminSvc(repo).WithAuditor(rec)

		require.Error(t, svc.ChangePlan(t.Context(), adminP, "ws-1", "pro"))
		assert.Zero(t, rec.calls)
	})

	t.Run("未接线 Auditor（nil）不 panic", func(t *testing.T) {
		svc := newAdminSvc(&fakeRepo{changePlanFrom: "free"})
		assert.NotPanics(t, func() {
			require.NoError(t, svc.ChangePlan(t.Context(), adminP, "ws-1", "pro"))
		})
	})
}

func TestCountUsersAndWorkspaces(t *testing.T) {
	repo := &fakeRepo{userTotal: 42, wsTotal: 7}
	svc := newAdminSvc(repo)

	n, err := svc.CountUsers(t.Context(), "", "")
	require.NoError(t, err)
	assert.Equal(t, 42, n)

	n, err = svc.CountWorkspaces(t.Context(), "")
	require.NoError(t, err)
	assert.Equal(t, 7, n)
}

func TestListWorkspaces_QPassthrough(t *testing.T) {
	repo := &fakeRepo{}
	svc := newAdminSvc(repo)

	_, err := svc.ListWorkspaces(t.Context(), "  acme  ", 1, 20)
	require.NoError(t, err)
	assert.Equal(t, "acme", repo.gotWsQ, "q 应 trim 后透传")

	_, err = svc.CountWorkspaces(t.Context(), " acme ")
	require.NoError(t, err)
	assert.Equal(t, "acme", repo.gotWsCountQ, "Count 与 List 过滤口径一致")
}

func TestUserDisableEnable_Audit(t *testing.T) {
	adminP := &webx.Principal{UserID: "op", Email: "op@test.local", IsPlatformAdmin: true}

	t.Run("封禁成功 → 审计 admin.user_disable（actor=管理员，目标进 resource/meta）", func(t *testing.T) {
		repo := &fakeRepo{}
		rec := &fakeAuditor{}
		svc := newAdminSvc(repo).WithAuditor(rec).WithSessionRevoker(&fakeRevoker{})

		require.NoError(t, svc.DisableUser(t.Context(), adminP, "u-42"))

		assert.Equal(t, "u-42", repo.gotStatus.userID)
		assert.Equal(t, "disabled", repo.gotStatus.status)
		require.Equal(t, 1, rec.calls)
		assert.Nil(t, rec.gotWorkspaceID, "平台级事件（与 user_role_change 同款）")
		require.NotNil(t, rec.gotP)
		assert.Equal(t, "op", rec.gotP.UserID, "审计 actor 是管理员本人")
		assert.Equal(t, "admin.user_disable", rec.gotAction)
		assert.Equal(t, "user", rec.gotResType)
		assert.Equal(t, "u-42", rec.gotResID)
		assert.Equal(t, "u-42", rec.gotMeta["user_id"])
	})

	t.Run("解禁成功 → 审计 admin.user_enable", func(t *testing.T) {
		repo := &fakeRepo{}
		rec := &fakeAuditor{}
		svc := newAdminSvc(repo).WithAuditor(rec)

		require.NoError(t, svc.EnableUser(t.Context(), adminP, "u-42"))

		assert.Equal(t, "active", repo.gotStatus.status)
		require.Equal(t, 1, rec.calls)
		assert.Equal(t, "admin.user_enable", rec.gotAction)
		assert.Equal(t, "u-42", rec.gotResID)
		assert.Equal(t, "u-42", rec.gotMeta["user_id"])
	})

	t.Run("自封 400 且不写审计", func(t *testing.T) {
		repo := &fakeRepo{}
		rec := &fakeAuditor{}
		svc := newAdminSvc(repo).WithAuditor(rec)

		err := svc.DisableUser(t.Context(), adminP, "op")
		assert.Equal(t, 400, statusOf(t, err))
		assert.Zero(t, rec.calls)
		assert.Empty(t, repo.gotStatus.userID, "校验拒绝不得触达 repo")
	})

	t.Run("SetUserStatus 失败不写审计", func(t *testing.T) {
		rec := &fakeAuditor{}
		svc := newAdminSvc(&fakeRepo{statusErr: assert.AnError}).WithAuditor(rec)

		require.ErrorIs(t, svc.DisableUser(t.Context(), adminP, "u-42"), assert.AnError)
		require.ErrorIs(t, svc.EnableUser(t.Context(), adminP, "u-42"), assert.AnError)
		assert.Zero(t, rec.calls)
	})

	t.Run("封禁后吊销失败不写审计（操作未完成）", func(t *testing.T) {
		rec := &fakeAuditor{}
		svc := newAdminSvc(&fakeRepo{}).WithAuditor(rec).
			WithSessionRevoker(&fakeRevoker{err: assert.AnError})

		require.ErrorIs(t, svc.DisableUser(t.Context(), adminP, "u-42"), assert.AnError)
		assert.Zero(t, rec.calls)
	})

	t.Run("审计未接线（nil）不 panic（Observational）", func(t *testing.T) {
		svc := newAdminSvc(&fakeRepo{}).WithSessionRevoker(&fakeRevoker{})
		assert.NotPanics(t, func() {
			require.NoError(t, svc.DisableUser(t.Context(), adminP, "u-42"))
		})
		assert.NotPanics(t, func() {
			require.NoError(t, svc.EnableUser(t.Context(), adminP, "u-42"))
		})
	})
}

func statusOf(t *testing.T, err error) int {
	t.Helper()
	var we *webx.Error
	require.ErrorAs(t, err, &we)
	return we.Status
}
