package app

import (
	"context"
	"testing"

	"github.com/haozing/ploykit/authz"
	"github.com/haozing/ploykit/workspace/domain"
)

type staticProvider struct{ perms []authz.Permission }

func (p staticProvider) PermsFor(context.Context, authz.RoleKey) ([]authz.Permission, error) {
	return p.perms, nil
}

func svcWithProvider(f Repo, perms []authz.Permission) *WorkspaceService {
	az := authz.New(nil, nil, authz.WithProvider(staticProvider{perms: perms}), authz.WithCacheTTL(0))
	return NewWorkspaceService(f, az, nil, nil, WorkspaceConfig{MaxPerUser: -1}, testNow)
}

func TestCustomRoleOverrideWorksAtServiceLayer_WA4(t *testing.T) {
	ctx := context.Background()

	t.Run("member 获 members:invite 覆盖 → Invite 放行", func(t *testing.T) {
		f, ws := seedWS(t)
		svc := svcWithProvider(f, []authz.Permission{"members:invite"})
		f.members[memberKeyOf(ws.ID, "carol")] = fakeMember{m: Member{UserID: "carol", Email: "carol@test.local", Role: "member"}}
		if _, err := svc.Invite(ctx, memberP("carol"), ws.ID, "new@y.co", "member"); err != nil {
			t.Fatalf("自定义角色授 members:invite 后应放行: %v", err)
		}
	})

	t.Run("member 获 workspace:update 覆盖 → Rename 放行", func(t *testing.T) {
		f, ws := seedWS(t)
		svc := svcWithProvider(f, []authz.Permission{"workspace:update"})
		f.members[memberKeyOf(ws.ID, "carol")] = fakeMember{m: Member{UserID: "carol", Email: "carol@test.local", Role: "member"}}
		if _, err := svc.RenameWorkspace(ctx, memberP("carol"), ws.ID, "新名字"); err != nil {
			t.Fatalf("自定义角色授 workspace:update 后应放行: %v", err)
		}
	})

	t.Run("member 获 members:remove（不含 invite）→ RemoveMember 放行、Invite 仍拒", func(t *testing.T) {
		f, ws := seedWS(t)
		svc := svcWithProvider(f, []authz.Permission{"members:remove"})
		f.members[memberKeyOf(ws.ID, "carol")] = fakeMember{m: Member{UserID: "carol", Email: "carol@test.local", Role: "member"}}
		f.members[memberKeyOf(ws.ID, "bob")] = fakeMember{m: Member{UserID: "bob", Email: "bob@test.local", Role: "member"}}
		if err := svc.RemoveMember(ctx, memberP("carol"), ws.ID, "bob"); err != nil {
			t.Fatalf("自定义角色授 members:remove 后应放行: %v", err)
		}
		if _, err := svc.Invite(ctx, memberP("carol"), ws.ID, "new@y.co", "member"); errStatus(t, err) != 403 {
			t.Errorf("覆盖集是显式集合：未授予 members:invite 应仍 403, got %v", err)
		}
	})

	t.Run("覆盖集显式清零 → owner 也被拒（与 WA2 语义连锁）", func(t *testing.T) {
		f, ws := seedWS(t)
		svc := svcWithProvider(f, []authz.Permission{})
		f.members[memberKeyOf(ws.ID, "bob")] = fakeMember{m: Member{UserID: "bob", Email: "bob@test.local", Role: "member"}}
		if err := svc.RemoveMember(ctx, ownerP("alice"), ws.ID, "bob"); errStatus(t, err) != 403 {
			t.Errorf("清零后 owner 的内置 members:remove 也应被拒, got %v", err)
		}
	})
}

func TestBuiltinRoleRegression_WA4(t *testing.T) {
	ctx := context.Background()

	t.Run("member 写路径全 403 / admin+owner 放行", func(t *testing.T) {
		_, ws, svc, _ := seedMembers(t)

		if _, err := svc.Invite(ctx, memberP("carol"), ws.ID, "new@y.co", "member"); errStatus(t, err) != 403 {
			t.Errorf("member invite: got %v", err)
		}
		if err := svc.UpdateMemberRole(ctx, memberP("carol"), ws.ID, "bob", "member"); errStatus(t, err) != 403 {
			t.Errorf("member update role: got %v", err)
		}
		if err := svc.RemoveMember(ctx, memberP("carol"), ws.ID, "bob"); errStatus(t, err) != 403 {
			t.Errorf("member remove: got %v", err)
		}
		if _, err := svc.RenameWorkspace(ctx, memberP("carol"), ws.ID, "x"); errStatus(t, err) != 403 {
			t.Errorf("member rename: got %v", err)
		}
		if _, _, err := svc.CreateShareLink(ctx, memberP("carol"), ws.ID, "member", 10, domain.InviteTTL); errStatus(t, err) != 403 {
			t.Errorf("member share link: got %v", err)
		}

		if _, err := svc.Invite(ctx, ownerP("bob"), ws.ID, "new@y.co", "member"); err != nil {
			t.Errorf("admin invite: %v", err)
		}
		if err := svc.UpdateMemberRole(ctx, ownerP("bob"), ws.ID, "carol", "admin"); err != nil {
			t.Errorf("admin update role: %v", err)
		}
		if _, err := svc.RenameWorkspace(ctx, ownerP("bob"), ws.ID, "Admin 改名"); err != nil {
			t.Errorf("admin rename: %v", err)
		}
	})

	t.Run("owner 不变量保留在 domain（不经 authz 放宽）", func(t *testing.T) {
		_, ws, svc, _ := seedMembers(t)

		fakeAdmin := ownerP("bob")
		fakeAdmin.Role = "admin"
		if err := svc.DeleteWorkspace(ctx, fakeAdmin, ws.ID); errStatus(t, err) != 403 {
			t.Errorf("admin delete: got %v", err)
		}

		if err := svc.UpdateMemberRole(ctx, fakeAdmin, ws.ID, "dave", "admin"); errStatus(t, err) != 403 {
			t.Errorf("admin demote owner: got %v", err)
		}
	})

	t.Run("非成员直调写路径 403（principalIn fail-closed）", func(t *testing.T) {
		_, ws, svc, _ := seedMembers(t)
		if _, err := svc.Invite(ctx, memberP("stranger"), ws.ID, "new@y.co", "member"); errStatus(t, err) != 403 {
			t.Errorf("stranger invite: got %v", err)
		}
	})
}

func TestListPaginationNormalize_WA8(t *testing.T) {
	ctx := context.Background()
	f, ws := seedWS(t)
	svc := newSvc(f, nil)

	pg, err := svc.ListMembers(ctx, ws.ID, 0, 0)
	if err != nil || pg.Total != 1 {
		t.Fatalf("default: %v, %+v", err, pg)
	}

	pg, err = svc.ListMembers(ctx, ws.ID, 99, 50)
	if err != nil || len(pg.Items) != 0 || pg.Total != 1 {
		t.Errorf("beyond last page: %v, %+v", err, pg)
	}

	for _, tc := range []struct{ page, pageSize, wantPage, wantSize int }{
		{0, 0, 1, 50},
		{-3, -1, 1, 50},
		{2, 500, 2, 200},
		{1, 1, 1, 1},
	} {
		p, s := normalizePage(tc.page, tc.pageSize)
		if p != tc.wantPage || s != tc.wantSize {
			t.Errorf("normalizePage(%d,%d) = (%d,%d), want (%d,%d)",
				tc.page, tc.pageSize, p, s, tc.wantPage, tc.wantSize)
		}
	}
}
