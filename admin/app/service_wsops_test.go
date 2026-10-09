package app_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/admin/app"
	"github.com/haozing/ploykit/platform/webx"
)

type wsRepo struct {
	app.Repo
	rows    []app.AdminWorkspace
	members []app.WsMember
	ssoRows []app.SSOProviderRow
}

func (f *wsRepo) GetWorkspaceByID(_ context.Context, id string) (app.AdminWorkspace, bool, error) {
	for _, w := range f.rows {
		if w.ID == id {
			return w, true, nil
		}
	}
	return app.AdminWorkspace{}, false, nil
}

func (f *wsRepo) ListWorkspaceMembers(_ context.Context, _ string) ([]app.WsMember, error) {
	return f.members, nil
}

func (f *wsRepo) ListWorkspaces(_ context.Context, q string, limit, offset int) ([]app.AdminWorkspace, error) {
	if offset >= len(f.rows) {
		return nil, nil
	}
	end := offset + limit
	if end > len(f.rows) {
		end = len(f.rows)
	}
	return f.rows[offset:end], nil
}

func (f *wsRepo) ListSSOProviders(_ context.Context) ([]app.SSOProviderRow, error) {
	return f.ssoRows, nil
}

type wsAuditor struct {
	events []wsAuditEvent
}

type wsAuditEvent struct {
	workspaceID                 *string
	action, resourceType, resID string
	meta                        map[string]any
}

func (a *wsAuditor) Record(_ context.Context, wsID *string, _ *webx.Principal, action, resourceType, resID string, meta map[string]any) {
	a.events = append(a.events, wsAuditEvent{wsID, action, resourceType, resID, meta})
}

func (a *wsAuditor) find(action string) (wsAuditEvent, bool) {
	for _, e := range a.events {
		if e.action == action {
			return e, true
		}
	}
	return wsAuditEvent{}, false
}

type fakeWsOps struct {
	gotRole    struct{ ws, uid, role, actorID string }
	gotRemove  struct{ ws, uid, actorID string }
	gotDelete  struct{ ws, actorID string }
	gotTranser struct{ ws, toOwner, actorID string }
	calls      []string

	roleErr, removeErr, deleteErr, transferErr error
}

func (f *fakeWsOps) UpdateMemberRole(_ context.Context, actor *webx.Principal, wsID, uid, role string) error {
	f.calls = append(f.calls, "role")
	f.gotRole.ws, f.gotRole.uid, f.gotRole.role, f.gotRole.actorID = wsID, uid, role, actor.UserID
	return f.roleErr
}

func (f *fakeWsOps) RemoveMember(_ context.Context, actor *webx.Principal, wsID, uid string) error {
	f.calls = append(f.calls, "remove")
	f.gotRemove.ws, f.gotRemove.uid, f.gotRemove.actorID = wsID, uid, actor.UserID
	return f.removeErr
}

func (f *fakeWsOps) DeleteWorkspace(_ context.Context, actor *webx.Principal, wsID string) error {
	f.calls = append(f.calls, "delete:"+wsID)
	f.gotDelete.ws, f.gotDelete.actorID = wsID, actor.UserID
	return f.deleteErr
}

func (f *fakeWsOps) TransferOwnership(_ context.Context, actor *webx.Principal, wsID, newOwnerUserID string) error {
	f.calls = append(f.calls, "transfer:"+wsID)
	f.gotTranser.ws, f.gotTranser.toOwner, f.gotTranser.actorID = wsID, newOwnerUserID, actor.UserID
	return f.transferErr
}

type fakeGranter struct {
	calls     int
	gotWs     struct{ ws, key, reason, ref string }
	gotAmount int
	unlocked  bool
	err       error
}

func (f *fakeGranter) Grant(_ context.Context, workspaceID, key, reason, refID string, amount int, _ time.Time) (bool, error) {
	f.calls++
	f.gotWs.ws, f.gotWs.key, f.gotWs.reason, f.gotWs.ref = workspaceID, key, reason, refID
	f.gotAmount = amount
	return f.unlocked, f.err
}

type fakeAnnouncer struct {
	sent    []app.NotifyInput
	ids     []string
	idsErr  error
	failFor map[string]error
}

func (f *fakeAnnouncer) Notify(_ context.Context, in app.NotifyInput) error {
	if err, ok := f.failFor[in.UserID]; ok {
		return err
	}
	f.sent = append(f.sent, in)
	return nil
}

func (f *fakeAnnouncer) AllActiveUserIDs(_ context.Context) ([]string, error) {
	return f.ids, f.idsErr
}

var wsOpsNow = func() time.Time { return time.Date(2026, 10, 7, 8, 0, 0, 0, time.UTC) }

var wsOpsAdminP = &webx.Principal{UserID: "op", Email: "op@test.local", IsPlatformAdmin: true}

func newWsOpsSvc(repo app.Repo, aud app.Auditor) *app.WsOpsService {
	base := app.NewAdminService(repo, wsOpsNow)
	if aud != nil {
		base = base.WithAuditor(aud)
	}
	return app.NewWsOpsService(base)
}

func opStatus(t *testing.T, err error) int {
	t.Helper()
	var we *webx.Error
	require.ErrorAs(t, err, &we, "want webx.Error, got %v", err)
	return we.Status
}

func wsRows() []app.AdminWorkspace {
	return []app.AdminWorkspace{
		{ID: "ws-1", Slug: "acme", Name: "Acme", PlanCode: "free", MemberCnt: 2},
		{ID: "ws-2", Slug: "globex", Name: "Globex", PlanCode: "pro", MemberCnt: 5},
	}
}

func TestGetWorkspaceDetail(t *testing.T) {
	members := []app.WsMember{
		{UserID: "alice", Email: "alice@t.co", DisplayName: "Alice", Role: "owner"},
		{UserID: "bob", Email: "bob@t.co", DisplayName: "Bob", Role: "member"},
	}

	t.Run("聚合单行直查 + 成员表单查询", func(t *testing.T) {

		ops := &fakeWsOps{}
		svc := newWsOpsSvc(&wsRepo{rows: wsRows(), members: members}, nil).WithWorkspaceOps(ops)

		det, err := svc.GetWorkspaceDetail(t.Context(), "ws-2")
		require.NoError(t, err)
		assert.Equal(t, "globex", det.Slug)
		assert.Equal(t, "pro", det.PlanCode, "PlanCode 随单行查询带回")
		assert.Equal(t, members, det.Members)
		assert.Empty(t, ops.calls, "成员表不经 wsOps 端口")
	})

	t.Run("不存在 → 404", func(t *testing.T) {
		ops := &fakeWsOps{}
		svc := newWsOpsSvc(&wsRepo{rows: wsRows()}, nil).WithWorkspaceOps(ops)

		_, err := svc.GetWorkspaceDetail(t.Context(), "ws-nope")
		assert.Equal(t, 404, opStatus(t, err))
		assert.Empty(t, ops.calls)
	})

	t.Run("未接线 wsOps → 503", func(t *testing.T) {
		_, err := newWsOpsSvc(&wsRepo{}, nil).GetWorkspaceDetail(t.Context(), "ws-1")
		assert.Equal(t, 503, opStatus(t, err))
	})
}

func TestAdminMemberOpsPassthrough(t *testing.T) {
	ctx := t.Context()

	t.Run("改角色：透传 actor/ws/uid/role + 审计 admin.ws_member_role", func(t *testing.T) {
		ops := &fakeWsOps{}
		aud := &wsAuditor{}
		svc := newWsOpsSvc(&wsRepo{}, aud).WithWorkspaceOps(ops)

		require.NoError(t, svc.AdminUpdateMemberRole(ctx, wsOpsAdminP, "ws-1", "bob", "member"))

		assert.Equal(t, "ws-1", ops.gotRole.ws)
		assert.Equal(t, "bob", ops.gotRole.uid)
		assert.Equal(t, "member", ops.gotRole.role)
		assert.Equal(t, "op", ops.gotRole.actorID, "透传的 actor 是平台管理员本人")
		e, ok := aud.find("admin.ws_member_role")
		require.True(t, ok, "审计缺失: %v", aud.events)
		require.NotNil(t, e.workspaceID)
		assert.Equal(t, "ws-1", *e.workspaceID)
		assert.Equal(t, "bob", e.resID)
		assert.Equal(t, "member", e.meta["to"])
	})

	t.Run("移除成员：透传 + 审计 admin.ws_member_remove", func(t *testing.T) {
		ops := &fakeWsOps{}
		aud := &wsAuditor{}
		svc := newWsOpsSvc(&wsRepo{}, aud).WithWorkspaceOps(ops)

		require.NoError(t, svc.AdminRemoveMember(ctx, wsOpsAdminP, "ws-1", "carol"))

		assert.Equal(t, "ws-1", ops.gotRemove.ws)
		assert.Equal(t, "carol", ops.gotRemove.uid)
		assert.Equal(t, "op", ops.gotRemove.actorID)
		e, ok := aud.find("admin.ws_member_remove")
		require.True(t, ok, "审计缺失: %v", aud.events)
		assert.Equal(t, "carol", e.resID)
	})

	t.Run("底层拒绝（业务保护）→ 错误透传且不写审计（表驱动）", func(t *testing.T) {
		cases := []struct {
			name    string
			wsOpErr error
			wantSt  int
			run     func(svc *app.WsOpsService) error
		}{
			{"改角色 409（last-owner 保护）", webx.NewConflict("cannot demote the last owner"), 409,
				func(svc *app.WsOpsService) error {
					return svc.AdminUpdateMemberRole(ctx, wsOpsAdminP, "ws-1", "dave", "member")
				}},
			{"移除 409（last-owner 保护）", webx.NewConflict("cannot remove the last owner"), 409,
				func(svc *app.WsOpsService) error {
					return svc.AdminRemoveMember(ctx, wsOpsAdminP, "ws-1", "dave")
				}},
			{"改角色 400（角色枚举）", webx.NewValidation("role not assignable"), 400,
				func(svc *app.WsOpsService) error {
					return svc.AdminUpdateMemberRole(ctx, wsOpsAdminP, "ws-1", "bob", "owner")
				}},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				ops := &fakeWsOps{roleErr: tc.wsOpErr, removeErr: tc.wsOpErr}
				aud := &wsAuditor{}
				svc := newWsOpsSvc(&wsRepo{}, aud).WithWorkspaceOps(ops)

				err := tc.run(svc)
				require.Error(t, err)
				assert.Equal(t, tc.wantSt, opStatus(t, err))
				assert.Empty(t, aud.events, "失败不写审计")
			})
		}
	})

	t.Run("未接线 → 503", func(t *testing.T) {
		svc := newWsOpsSvc(&wsRepo{}, nil)
		assert.Equal(t, 503, opStatus(t, svc.AdminUpdateMemberRole(ctx, wsOpsAdminP, "ws-1", "bob", "member")))
		assert.Equal(t, 503, opStatus(t, svc.AdminRemoveMember(ctx, wsOpsAdminP, "ws-1", "bob")))
	})
}

func TestAdminDeleteWorkspace(t *testing.T) {
	ctx := t.Context()

	t.Run("confirm 不等于 slug → 400 且不删", func(t *testing.T) {
		ops := &fakeWsOps{}
		svc := newWsOpsSvc(&wsRepo{rows: wsRows()}, nil).WithWorkspaceOps(ops)

		err := svc.AdminDeleteWorkspace(ctx, wsOpsAdminP, "ws-1", "wrong-slug")
		assert.Equal(t, 400, opStatus(t, err))
		assert.NotContains(t, ops.calls, "delete:ws-1", "确认失败不得触发删除（详情预取的 list 调用除外）")
	})

	t.Run("confirm=slug → 透传删除 + 审计 admin.ws_delete（快照进 meta）", func(t *testing.T) {
		ops := &fakeWsOps{}
		aud := &wsAuditor{}
		svc := newWsOpsSvc(&wsRepo{rows: wsRows()}, aud).WithWorkspaceOps(ops)

		require.NoError(t, svc.AdminDeleteWorkspace(ctx, wsOpsAdminP, "ws-1", "acme"))

		assert.Equal(t, "ws-1", ops.gotDelete.ws)
		assert.Equal(t, "op", ops.gotDelete.actorID)
		e, ok := aud.find("admin.ws_delete")
		require.True(t, ok, "审计缺失: %v", aud.events)
		assert.Nil(t, e.workspaceID, "工作区行已级联删除，workspaceID 传 nil")
		assert.Equal(t, "workspace", e.resourceType)
		assert.Equal(t, "acme", e.meta["slug"])
		assert.Equal(t, "Acme", e.meta["name"])
	})

	t.Run("工作区不存在 → 404", func(t *testing.T) {
		svc := newWsOpsSvc(&wsRepo{rows: wsRows()}, nil).WithWorkspaceOps(&fakeWsOps{})
		err := svc.AdminDeleteWorkspace(ctx, wsOpsAdminP, "ws-nope", "acme")
		assert.Equal(t, 404, opStatus(t, err))
	})

	t.Run("底层 BeforeDelete 拦截 → 409 透传且不写审计", func(t *testing.T) {
		ops := &fakeWsOps{deleteErr: webx.NewConflict("workspace cannot be deleted: unpaid orders")}
		aud := &wsAuditor{}
		svc := newWsOpsSvc(&wsRepo{rows: wsRows()}, aud).WithWorkspaceOps(ops)

		err := svc.AdminDeleteWorkspace(ctx, wsOpsAdminP, "ws-1", "acme")
		assert.Equal(t, 409, opStatus(t, err))
		assert.Empty(t, aud.events)
	})
}

func TestGrantQuota(t *testing.T) {
	ctx := t.Context()

	t.Run("校验面（表驱动）：key/reason/amount 非法 → 400 且不触达 granter", func(t *testing.T) {
		cases := []struct {
			name        string
			key, reason string
			amount      int
		}{
			{"key 空", "", "compensation", 10},
			{"reason 空", "ai_tokens", "  ", 10},
			{"amount=0", "ai_tokens", "compensation", 0},
			{"amount 负数", "ai_tokens", "compensation", -5},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				g := &fakeGranter{unlocked: true}
				svc := newWsOpsSvc(&wsRepo{}, nil).WithQuotaGranter(g)

				err := svc.GrantQuota(ctx, wsOpsAdminP, "ws-1", tc.key, tc.reason, "", tc.amount)
				assert.Equal(t, 400, opStatus(t, err))
				assert.Zero(t, g.calls)
			})
		}
	})

	t.Run("成功：透传 + 审计 admin.quota_grant（meta 含生效 ref）", func(t *testing.T) {
		g := &fakeGranter{unlocked: true}
		aud := &wsAuditor{}
		svc := newWsOpsSvc(&wsRepo{}, aud).WithQuotaGranter(g)

		require.NoError(t, svc.GrantQuota(ctx, wsOpsAdminP, "ws-1", "ai_tokens", "manual comp", "ref-9", 500))

		assert.Equal(t, 1, g.calls)
		assert.Equal(t, "ws-1", g.gotWs.ws)
		assert.Equal(t, "ai_tokens", g.gotWs.key)
		assert.Equal(t, "manual comp", g.gotWs.reason)
		assert.Equal(t, "ref-9", g.gotWs.ref)
		assert.Equal(t, 500, g.gotAmount)
		e, ok := aud.find("admin.quota_grant")
		require.True(t, ok, "审计缺失: %v", aud.events)
		require.NotNil(t, e.workspaceID)
		assert.Equal(t, "ws-1", *e.workspaceID)
		assert.Equal(t, 500, e.meta["amount"])
		assert.Equal(t, "ref-9", e.meta["ref"], "审计 meta 记录生效 ref")
	})

	t.Run("ref 留空/纯空白 → 合成唯一 manual: ref（BQ11-C/AD2）", func(t *testing.T) {
		g := &fakeGranter{unlocked: true}
		aud := &wsAuditor{}
		svc := newWsOpsSvc(&wsRepo{}, aud).WithQuotaGranter(g)

		require.NoError(t, svc.GrantQuota(ctx, wsOpsAdminP, "ws-1", "ai_tokens", "manual comp", "", 100))
		ref1 := g.gotWs.ref
		require.NoError(t, svc.GrantQuota(ctx, wsOpsAdminP, "ws-1", "ai_tokens", "manual comp", "   ", 100))
		ref2 := g.gotWs.ref

		assert.True(t, strings.HasPrefix(ref1, "manual:"), "空 ref 应合成 manual: 前缀，got %q", ref1)
		assert.True(t, strings.HasPrefix(ref2, "manual:"))
		assert.NotEqual(t, ref1, ref2, "两次独立调额的合成 ref 必须互异——保留“每次都生效”语义，不被幂等键误伤")
		require.Len(t, aud.events, 2, "两次调额各落一条审计")
		assert.Equal(t, ref1, aud.events[0].meta["ref"])
		assert.Equal(t, ref2, aud.events[1].meta["ref"], "合成 ref 进审计 meta（落库/审计可对账）")
	})

	t.Run("ref 前后空白规整后透传", func(t *testing.T) {
		g := &fakeGranter{unlocked: true}
		svc := newWsOpsSvc(&wsRepo{}, nil).WithQuotaGranter(g)

		require.NoError(t, svc.GrantQuota(ctx, wsOpsAdminP, "ws-1", "ai_tokens", "comp", " ref-7 ", 10))
		assert.Equal(t, "ref-7", g.gotWs.ref, "非空 ref 原样语义透传（仅去空白）")
	})

	t.Run("quota 去重命中（unlocked=false）→ 409 且不写审计", func(t *testing.T) {
		g := &fakeGranter{unlocked: false}
		aud := &wsAuditor{}
		svc := newWsOpsSvc(&wsRepo{}, aud).WithQuotaGranter(g)

		err := svc.GrantQuota(ctx, wsOpsAdminP, "ws-1", "ai_tokens", "manual comp", "", 100)
		assert.Equal(t, 409, opStatus(t, err))
		assert.Empty(t, aud.events)
	})

	t.Run("granter 报错透传且不写审计", func(t *testing.T) {
		g := &fakeGranter{unlocked: true, err: assert.AnError}
		aud := &wsAuditor{}
		svc := newWsOpsSvc(&wsRepo{}, aud).WithQuotaGranter(g)

		require.ErrorIs(t, svc.GrantQuota(ctx, wsOpsAdminP, "ws-1", "k", "r", "", 1), assert.AnError)
		assert.Empty(t, aud.events)
	})

	t.Run("未接线 granter → 503", func(t *testing.T) {
		err := newWsOpsSvc(&wsRepo{}, nil).GrantQuota(ctx, wsOpsAdminP, "ws-1", "k", "r", "", 1)
		assert.Equal(t, 503, opStatus(t, err))
	})
}

func TestSendAnnouncement(t *testing.T) {
	ctx := t.Context()

	t.Run("target=user：单发 + type/DedupKey + 审计", func(t *testing.T) {
		an := &fakeAnnouncer{}
		aud := &wsAuditor{}
		svc := newWsOpsSvc(&wsRepo{}, aud).WithAnnouncer(an)

		res, err := svc.SendAnnouncement(ctx, wsOpsAdminP, app.AnnouncementRequest{
			Target: "user", UserID: "u-1", Title: "维护公告", Body: "今晚 22:00 停机", Link: "/blog/maint",
		})
		require.NoError(t, err)
		assert.Equal(t, &app.AnnouncementResult{Target: "user", Sent: 1}, res, "B12：响应携带计数")

		require.Len(t, an.sent, 1)
		in := an.sent[0]
		assert.Equal(t, "u-1", in.UserID)
		assert.Equal(t, "announcement", in.Type)
		assert.Equal(t, "维护公告", in.Title)
		assert.Equal(t, "/blog/maint", in.Link)

		sum := sha256.Sum256([]byte("今晚 22:00 停机"))
		wantDedup := "announcement:维护公告:" + hex.EncodeToString(sum[:6]) + ":2026-10-07"
		assert.Equal(t, wantDedup, in.DedupKey, "同题同文同日去重键")
		e, ok := aud.find("admin.announcement")
		require.True(t, ok, "审计缺失: %v", aud.events)
		assert.Equal(t, "u-1", e.resID)
		assert.Equal(t, 1, e.meta["sent"])
	})

	t.Run("target=all：全体 active 用户循环 + sent 汇总进审计", func(t *testing.T) {
		an := &fakeAnnouncer{ids: []string{"u-1", "u-2", "u-3"}}
		aud := &wsAuditor{}
		svc := newWsOpsSvc(&wsRepo{}, aud).WithAnnouncer(an)

		res, err := svc.SendAnnouncement(ctx, wsOpsAdminP, app.AnnouncementRequest{
			Target: "all", Title: "新功能", Body: "上线了",
		})
		require.NoError(t, err)
		assert.Equal(t, &app.AnnouncementResult{Target: "all", Sent: 3, Failed: 0}, res)

		require.Len(t, an.sent, 3)
		for i, in := range an.sent {
			assert.Equal(t, "u-"+string(rune('1'+i)), in.UserID)
			assert.Equal(t, "announcement", in.Type)
		}
		e, ok := aud.find("admin.announcement")
		require.True(t, ok)
		assert.Equal(t, "all", e.resID)
		assert.Equal(t, 3, e.meta["sent"])
		assert.Equal(t, 0, e.meta["failed"])
	})

	t.Run("all 超上限（>1000）→ 400 提示分批且不发送", func(t *testing.T) {
		ids := make([]string, 1001)
		for i := range ids {
			ids[i] = "u"
		}
		an := &fakeAnnouncer{ids: ids}
		svc := newWsOpsSvc(&wsRepo{}, nil).WithAnnouncer(an)

		res, err := svc.SendAnnouncement(ctx, wsOpsAdminP, app.AnnouncementRequest{Target: "all", Title: "t", Body: "b"})
		assert.Equal(t, 400, opStatus(t, err))
		assert.Nil(t, res)
		assert.Empty(t, an.sent)
	})

	t.Run("all 单项失败不阻断整轮，failed 汇总进审计", func(t *testing.T) {
		an := &fakeAnnouncer{ids: []string{"u-1", "u-2"}, failFor: map[string]error{"u-2": errors.New("insert failed")}}
		aud := &wsAuditor{}
		svc := newWsOpsSvc(&wsRepo{}, aud).WithAnnouncer(an)

		res, err := svc.SendAnnouncement(ctx, wsOpsAdminP, app.AnnouncementRequest{Target: "all", Title: "t", Body: "b"})
		require.NoError(t, err)
		assert.Equal(t, &app.AnnouncementResult{Target: "all", Sent: 1, Failed: 1}, res)
		require.Len(t, an.sent, 1)
		e, ok := aud.find("admin.announcement")
		require.True(t, ok)
		assert.Equal(t, 1, e.meta["sent"])
		assert.Equal(t, 1, e.meta["failed"])
	})

	t.Run("user 模式投递失败 → 错误上抛", func(t *testing.T) {
		an := &fakeAnnouncer{failFor: map[string]error{"u-1": errors.New("boom")}}
		svc := newWsOpsSvc(&wsRepo{}, nil).WithAnnouncer(an)

		_, err := svc.SendAnnouncement(ctx, wsOpsAdminP, app.AnnouncementRequest{Target: "user", UserID: "u-1", Title: "t", Body: "b"})
		require.Error(t, err)
	})

	t.Run("校验面（表驱动）", func(t *testing.T) {
		cases := []struct {
			name string
			req  app.AnnouncementRequest
		}{
			{"target 非法", app.AnnouncementRequest{Target: "admins", Title: "t", Body: "b"}},
			{"user 模式缺 user_id", app.AnnouncementRequest{Target: "user", Title: "t", Body: "b"}},
			{"title 空", app.AnnouncementRequest{Target: "all", Title: " ", Body: "b"}},
			{"body 空", app.AnnouncementRequest{Target: "all", Title: "t", Body: ""}},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				an := &fakeAnnouncer{}
				svc := newWsOpsSvc(&wsRepo{}, nil).WithAnnouncer(an)
				res, err := svc.SendAnnouncement(ctx, wsOpsAdminP, tc.req)
				assert.Equal(t, 400, opStatus(t, err))
				assert.Nil(t, res)
				assert.Empty(t, an.sent)
			})
		}
	})

	t.Run("未接线 announcer → 503", func(t *testing.T) {
		_, err := newWsOpsSvc(&wsRepo{}, nil).SendAnnouncement(ctx, wsOpsAdminP, app.AnnouncementRequest{Target: "all", Title: "t", Body: "b"})
		assert.Equal(t, 503, opStatus(t, err))
	})
}

func TestAdminTransferOwnership(t *testing.T) {
	ctx := t.Context()

	t.Run("透传 actor/ws/新 owner + 审计 admin.ws_owner_transfer", func(t *testing.T) {
		ops := &fakeWsOps{}
		aud := &wsAuditor{}
		svc := newWsOpsSvc(&wsRepo{}, aud).WithWorkspaceOps(ops)

		require.NoError(t, svc.AdminTransferOwnership(ctx, wsOpsAdminP, "ws-1", "bob"))

		assert.Equal(t, "ws-1", ops.gotTranser.ws)
		assert.Equal(t, "bob", ops.gotTranser.toOwner)
		assert.Equal(t, "op", ops.gotTranser.actorID, "透传的 actor 是平台管理员本人（workspace 侧走 A1 豁免）")
		e, ok := aud.find("admin.ws_owner_transfer")
		require.True(t, ok, "审计缺失: %v", aud.events)
		require.NotNil(t, e.workspaceID)
		assert.Equal(t, "ws-1", *e.workspaceID)
		assert.Equal(t, "workspace", e.resourceType)
		assert.Equal(t, "bob", e.meta["new_owner"])
	})

	t.Run("底层拒绝（workspace 域业务保护）→ 错误透传且不写审计（表驱动）", func(t *testing.T) {
		cases := []struct {
			name string
			err  error
			want int
		}{
			{"409（目标非成员）", webx.NewNotFound("member not found"), 404},
			{"409（目标已是 owner）", webx.NewConflict("target is already an owner"), 409},
			{"409（目标账号 disabled）", webx.NewConflict("cannot transfer ownership to a disabled user"), 409},
			{"403（发起方非 owner）", webx.NewForbidden("owner required to transfer ownership"), 403},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				ops := &fakeWsOps{transferErr: tc.err}
				aud := &wsAuditor{}
				svc := newWsOpsSvc(&wsRepo{}, aud).WithWorkspaceOps(ops)

				err := svc.AdminTransferOwnership(ctx, wsOpsAdminP, "ws-1", "bob")
				require.Error(t, err)
				assert.Equal(t, tc.want, opStatus(t, err))
				assert.Empty(t, aud.events, "失败不写审计")
			})
		}
	})

	t.Run("未接线 wsOps → 503", func(t *testing.T) {
		err := newWsOpsSvc(&wsRepo{}, nil).AdminTransferOwnership(ctx, wsOpsAdminP, "ws-1", "bob")
		assert.Equal(t, 503, opStatus(t, err))
	})
}

func TestListSSOProviders(t *testing.T) {
	t.Run("repo 透传（行含密封状态位，无 secret 值面）", func(t *testing.T) {
		rows := []app.SSOProviderRow{{
			WorkspaceID: "ws-1", WorkspaceSlug: "acme", WorkspaceName: "Acme",
			IssuerURL: "https://idp.corp.example", ClientID: "cid", Scopes: "openid email profile",
			SecretSealed: true, CreatedAt: wsOpsNow(), UpdatedAt: wsOpsNow(),
		}}
		svc := newWsOpsSvc(&wsRepo{ssoRows: rows}, nil)

		got, err := svc.ListSSOProviders(t.Context())
		require.NoError(t, err)
		require.Len(t, got, 1)
		assert.Equal(t, "acme", got[0].WorkspaceSlug)
		assert.True(t, got[0].SecretSealed)
	})

	t.Run("空列表（无工作区配置联邦 SSO）", func(t *testing.T) {
		got, err := newWsOpsSvc(&wsRepo{}, nil).ListSSOProviders(t.Context())
		require.NoError(t, err)
		assert.Empty(t, got)
	})
}
