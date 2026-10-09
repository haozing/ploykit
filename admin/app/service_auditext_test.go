package app_test

import (
	"context"
	"errors"
	"io"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/admin/app"
	"github.com/haozing/ploykit/audit"
)

type auditExtRepo struct {
	app.Repo

	gotQuery    audit.ListQuery
	gotExtQuery audit.ListQuery
	gotExtIDs   []string
	gotPrefix   string
	gotPrefixN  int
	gotExport   struct {
		q       audit.ListQuery
		ids     []string
		maxRows int
	}
	rows        []app.AuditEntry
	total       int
	prefixIDs   []string
	prefixErr   error
	extErr      error
	exportTrunc bool
	exportErr   error
}

func (f *auditExtRepo) QueryAudit(_ context.Context, q audit.ListQuery) ([]app.AuditEntry, int, error) {
	f.gotQuery = q
	return f.rows, f.total, nil
}

func (f *auditExtRepo) QueryAuditExt(_ context.Context, q audit.ListQuery, ids []string) ([]app.AuditEntry, int, error) {
	f.gotExtQuery, f.gotExtIDs = q, ids
	return f.rows, f.total, f.extErr
}

func (f *auditExtRepo) UserIDsByEmailPrefix(_ context.Context, prefix string, limit int) ([]string, error) {
	f.gotPrefix, f.gotPrefixN = prefix, limit
	if f.prefixIDs == nil {
		return []string{}, f.prefixErr
	}
	return f.prefixIDs, f.prefixErr
}

func (f *auditExtRepo) ExportAuditCSV(_ context.Context, q audit.ListQuery, ids []string, maxRows int, _ io.Writer) (bool, error) {
	f.gotExport.q, f.gotExport.ids, f.gotExport.maxRows = q, ids, maxRows
	return f.exportTrunc, f.exportErr
}

const actorUUID = "11111111-2222-3333-4444-555555555555"

func TestQueryAudit_ActorSearch(t *testing.T) {
	t.Run("无 actor：透传 repo.QueryAudit（既有行为不变）", func(t *testing.T) {
		f := &auditExtRepo{rows: []app.AuditEntry{{ID: "e1"}}, total: 1}
		svc := newAdminSvc(f)
		items, total, err := svc.QueryAudit(t.Context(), audit.ListQuery{Action: "a"}, "")
		require.NoError(t, err)
		assert.Equal(t, 1, total)
		require.Len(t, items, 1)
		assert.Equal(t, "a", f.gotQuery.Action)
		assert.Nil(t, f.gotExtIDs, "不应触扩展查询")
	})

	t.Run("actor 为 uuid：写回 ActorID 直配", func(t *testing.T) {
		f := &auditExtRepo{}
		svc := newAdminSvc(f)
		_, _, err := svc.QueryAudit(t.Context(), audit.ListQuery{}, actorUUID)
		require.NoError(t, err)
		assert.Equal(t, actorUUID, f.gotQuery.ActorID)
		assert.Nil(t, f.gotExtIDs)
	})

	t.Run("actor 为邮箱前缀：解析 id 集合转 QueryAuditExt（≤50）", func(t *testing.T) {
		f := &auditExtRepo{prefixIDs: []string{"u1", "u2"}, rows: []app.AuditEntry{{ID: "e1"}, {ID: "e2"}}, total: 9}
		svc := newAdminSvc(f)
		items, total, err := svc.QueryAudit(t.Context(), audit.ListQuery{}, " alice@CORP ")
		require.NoError(t, err)
		assert.Equal(t, 9, total)
		require.Len(t, items, 2)
		assert.Equal(t, "alice@CORP", f.gotPrefix, "前缀原样传递（trim 后），大小写由 ILIKE 兜底")
		assert.Equal(t, 50, f.gotPrefixN)
		assert.Equal(t, []string{"u1", "u2"}, f.gotExtIDs)
		assert.Empty(t, f.gotExtQuery.ActorID, "IN 集合与 ActorID 直配不叠加")
	})

	t.Run("邮箱前缀零匹配：短路空结果，不打审计表", func(t *testing.T) {
		f := &auditExtRepo{prefixIDs: []string{}}
		svc := newAdminSvc(f)
		items, total, err := svc.QueryAudit(t.Context(), audit.ListQuery{Action: "a"}, "ghost@nowhere")
		require.NoError(t, err)
		assert.Empty(t, items)
		assert.Zero(t, total)
		assert.Equal(t, "ghost@nowhere", f.gotPrefix)
		assert.Nil(t, f.gotExtIDs, "零匹配不应触 QueryAuditExt")
		assert.Empty(t, f.gotQuery.Action, "也不应触 QueryAudit")
	})

	t.Run("actor_id 参数优先：actor 被忽略", func(t *testing.T) {
		f := &auditExtRepo{prefixIDs: []string{"u1"}}
		svc := newAdminSvc(f)
		_, _, err := svc.QueryAudit(t.Context(), audit.ListQuery{ActorID: "u-direct"}, actorUUID)
		require.NoError(t, err)
		assert.Equal(t, "u-direct", f.gotQuery.ActorID)
		assert.Empty(t, f.gotPrefix, "actor 参数不应触发邮箱解析")
	})
}

func TestCountAudit_MatchesQueryAudit(t *testing.T) {
	t.Run("无 actor：total 来自 QueryAudit（limit 收敛为 1）", func(t *testing.T) {
		f := &auditExtRepo{total: 42}
		svc := newAdminSvc(f)
		total, err := svc.CountAudit(t.Context(), audit.ListQuery{Limit: 100}, "")
		require.NoError(t, err)
		assert.Equal(t, 42, total)
		assert.Equal(t, 1, f.gotQuery.Limit)
		assert.Zero(t, f.gotQuery.Offset)
	})

	t.Run("邮箱零匹配：total=0", func(t *testing.T) {
		f := &auditExtRepo{}
		svc := newAdminSvc(f)
		total, err := svc.CountAudit(t.Context(), audit.ListQuery{}, "ghost@x")
		require.NoError(t, err)
		assert.Zero(t, total)
	})

	t.Run("邮箱多账号：total 来自 QueryAuditExt", func(t *testing.T) {
		f := &auditExtRepo{prefixIDs: []string{"u1", "u2"}, total: 7}
		svc := newAdminSvc(f)
		total, err := svc.CountAudit(t.Context(), audit.ListQuery{}, "a@b")
		require.NoError(t, err)
		assert.Equal(t, 7, total)
		assert.Equal(t, 1, f.gotExtQuery.Limit)
	})
}

func TestExportAuditCSV_ServiceWiring(t *testing.T) {
	t.Run("透传 maxRows 与解析出的 ids；返回 repo 的 truncated", func(t *testing.T) {
		f := &auditExtRepo{prefixIDs: []string{"u1"}, exportTrunc: true}
		svc := newAdminSvc(f)
		trunc, err := svc.ExportAuditCSV(t.Context(), audit.ListQuery{Action: "a"}, "alice@", 50000, nil)
		require.NoError(t, err)
		assert.True(t, trunc)
		assert.Equal(t, 50000, f.gotExport.maxRows)
		assert.Equal(t, []string{"u1"}, f.gotExport.ids)
		assert.Equal(t, "a", f.gotExport.q.Action)
	})

	t.Run("邮箱零匹配：nil ids 下传（repo 侧表头语义）", func(t *testing.T) {
		f := &auditExtRepo{}
		svc := newAdminSvc(f)
		_, err := svc.ExportAuditCSV(t.Context(), audit.ListQuery{}, "ghost@x", 50000, nil)
		require.NoError(t, err)
		require.NotNil(t, f.gotExport.ids)
		assert.Empty(t, f.gotExport.ids)
	})

	t.Run("repo 失败透传", func(t *testing.T) {
		f := &auditExtRepo{exportErr: errors.New("boom")}
		svc := newAdminSvc(f)
		_, err := svc.ExportAuditCSV(t.Context(), audit.ListQuery{}, "", 50000, nil)
		require.Error(t, err)
	})
}

type exportRepo struct {
	*fakeRepo
	exported []string
	data     map[string]any
	err      error
}

func (f *exportRepo) ExportUserdata(_ context.Context, userID string) (map[string]any, error) {
	f.exported = append(f.exported, userID)
	return f.data, f.err
}

func TestExportUserdata(t *testing.T) {
	u1 := seedUser("u1", "u1@x.com")
	data := map[string]any{"user": u1, "sessions": []any{}}

	t.Run("聚合透传：不留审计、不依赖 UserOps 端口", func(t *testing.T) {
		repo := &exportRepo{fakeRepo: &fakeRepo{users: []app.AdminUser{u1}}, data: data}
		rec := &opsAuditor{}
		svc := app.NewUserOpsService(newAdminSvc(repo).WithAuditor(rec))
		out, err := svc.ExportUserdata(t.Context(), userOpsAdmin, "u1")
		require.NoError(t, err)
		assert.Equal(t, data, out)
		assert.Equal(t, []string{"u1"}, repo.exported)
		assert.Empty(t, rec.calls, "查询类导出不审计")
	})

	t.Run("目标不存在 → 404 且不触 repo 导出", func(t *testing.T) {
		repo := &exportRepo{fakeRepo: &fakeRepo{}}
		svc := app.NewUserOpsService(newAdminSvc(repo))
		_, err := svc.ExportUserdata(t.Context(), userOpsAdmin, "ghost")
		assertWErr(t, err, 404, "E_NOT_FOUND")
		assert.Empty(t, repo.exported)
	})

	t.Run("repo 失败透传", func(t *testing.T) {
		repo := &exportRepo{fakeRepo: &fakeRepo{users: []app.AdminUser{u1}}, err: errors.New("db down")}
		svc := app.NewUserOpsService(newAdminSvc(repo))
		_, err := svc.ExportUserdata(t.Context(), userOpsAdmin, "u1")
		require.EqualError(t, err, "db down")
	})
}
