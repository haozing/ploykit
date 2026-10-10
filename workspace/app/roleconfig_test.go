package app

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/haozing/ploykit/authz"
	"github.com/haozing/ploykit/platform/webx"
)

// The fake doubles as authz.Provider over the same override map, so cache
// invalidation can be asserted behaviorally: without InvalidateCache the
// 30s authorizer cache would keep serving the stale permission set.
func (f *fake) ListRoleOverrides(_ context.Context, workspaceID string) (map[string][]authz.Permission, error) {
	out := map[string][]authz.Permission{}
	prefix := workspaceID + "\x00"
	for k, v := range f.roleOverrides {
		if role, ok := strings.CutPrefix(k, prefix); ok {
			out[role] = v
		}
	}
	return out, nil
}

func (f *fake) UpsertRolePerms(_ context.Context, workspaceID, role string, perms []authz.Permission, _ time.Time) error {
	f.roleOverrides[workspaceID+"\x00"+role] = perms
	return nil
}

func (f *fake) DeleteRolePerms(_ context.Context, workspaceID, role string) error {
	delete(f.roleOverrides, workspaceID+"\x00"+role)
	return nil
}

func (f *fake) PermsFor(_ context.Context, key authz.RoleKey) ([]authz.Permission, error) {
	if perms, ok := f.roleOverrides[key.WorkspaceID+"\x00"+key.Role]; ok {
		return perms, nil
	}
	return nil, nil
}

func newRoleSvc(f *fake, a *fakeAuditor) *WorkspaceService {
	az := authz.New(nil, nil, authz.WithProvider(f))
	return NewWorkspaceService(f, az, nil, a, WorkspaceConfig{MaxPerUser: -1}, testNow)
}

func memberIn(wsID string) *webx.Principal {
	return &webx.Principal{UserID: "bob", WorkspaceID: wsID, Role: authz.RoleMember}
}

func TestSetRolePerms_WriteBoundaryValidation(t *testing.T) {
	f, ws := seedWS(t)
	a := &fakeAuditor{}
	svc := newRoleSvc(f, a)
	owner := ownerP("alice")

	t.Run("未知权限被拒（写入边界即漂移防护, ADR 0012）", func(t *testing.T) {
		_, err := svc.SetRolePerms(context.Background(), owner, ws.ID, "member",
			[]authz.Permission{"workspace:read", "does:not:exist"})
		if errStatus(t, err) != 400 {
			t.Fatalf("status = %d, want 400", errStatus(t, err))
		}
		if _, ok := f.roleOverrides[ws.ID+"\x00"+"member"]; ok {
			t.Fatal("被拒的写入不得落库")
		}
	})

	t.Run("owner 角色不可配置（防自锁）", func(t *testing.T) {
		_, err := svc.SetRolePerms(context.Background(), owner, ws.ID, "owner",
			[]authz.Permission{"workspace:read"})
		if errStatus(t, err) != 400 {
			t.Fatalf("status = %d, want 400", errStatus(t, err))
		}
	})

	t.Run("非成员 403", func(t *testing.T) {
		_, err := svc.SetRolePerms(context.Background(), &webx.Principal{UserID: "eve"}, ws.ID, "member",
			[]authz.Permission{"workspace:read"})
		if errStatus(t, err) != 403 {
			t.Fatalf("status = %d, want 403", errStatus(t, err))
		}
	})

	t.Run("合法写入：去重排序、审计、立即生效（缓存失效）", func(t *testing.T) {
		az := svc.authz
		p := memberIn(ws.ID)
		if az.CanIn(context.Background(), p, "billing:manage") {
			t.Fatal("默认 member 不应有 billing:manage")
		}
		cfg, err := svc.SetRolePerms(context.Background(), owner, ws.ID, "member",
			[]authz.Permission{"billing:manage", "workspace:read", "billing:manage"})
		if err != nil {
			t.Fatalf("set: %v", err)
		}
		want := []authz.Permission{"billing:manage", "workspace:read"}
		if len(cfg.Perms) != 2 || cfg.Perms[0] != want[0] || cfg.Perms[1] != want[1] {
			t.Fatalf("perms = %v, want %v (deduped+sorted)", cfg.Perms, want)
		}
		if !cfg.Overridden {
			t.Fatal("set 后必须标记 overridden")
		}
		if !az.CanIn(context.Background(), p, "billing:manage") {
			t.Fatal("写入后立即生效失败——InvalidateCache 未被调用（30s 缓存会供应旧权限集）")
		}
		if az.CanIn(context.Background(), p, "members:read") {
			t.Fatal("覆盖是替换不是合并：默认 members:read 应随覆盖消失")
		}
		if len(a.actions) == 0 || a.actions[len(a.actions)-1] != "role_perms.set" {
			t.Fatalf("audit actions = %v, want role_perms.set last", a.actions)
		}
	})
}

func TestResetRolePerms(t *testing.T) {
	f, ws := seedWS(t)
	a := &fakeAuditor{}
	svc := newRoleSvc(f, a)
	owner := ownerP("alice")
	if _, err := svc.SetRolePerms(context.Background(), owner, ws.ID, "admin",
		[]authz.Permission{"workspace:read"}); err != nil {
		t.Fatalf("set: %v", err)
	}

	t.Run("重置后回退默认并立即生效", func(t *testing.T) {
		p := &webx.Principal{UserID: "carol", WorkspaceID: ws.ID, Role: authz.RoleAdmin}
		if svc.authz.CanIn(context.Background(), p, "members:write") {
			t.Fatal("覆盖后 admin 不应再有 members:write")
		}
		if err := svc.ResetRolePerms(context.Background(), owner, ws.ID, "admin"); err != nil {
			t.Fatalf("reset: %v", err)
		}
		if !svc.authz.CanIn(context.Background(), p, "members:write") {
			t.Fatal("重置后未回到默认权限集")
		}
		if a.actions[len(a.actions)-1] != "role_perms.reset" {
			t.Fatalf("audit actions = %v", a.actions)
		}
	})

	t.Run("重置不存在的覆盖幂等成功", func(t *testing.T) {
		if err := svc.ResetRolePerms(context.Background(), owner, ws.ID, "member"); err != nil {
			t.Fatalf("idempotent reset: %v", err)
		}
	})
}

func TestListRoleConfigs(t *testing.T) {
	f, ws := seedWS(t)
	a := &fakeAuditor{}
	svc := newRoleSvc(f, a)
	owner := ownerP("alice")
	if _, err := svc.SetRolePerms(context.Background(), owner, ws.ID, "member",
		[]authz.Permission{"workspace:read"}); err != nil {
		t.Fatalf("set: %v", err)
	}

	roles, catalog, err := svc.ListRoleConfigs(context.Background(), owner, ws.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(roles) != 2 || roles[0].Role != authz.RoleAdmin || roles[1].Role != authz.RoleMember {
		t.Fatalf("roles = %+v", roles)
	}
	if roles[0].Overridden {
		t.Fatalf("admin（本次未配置）不该被覆盖：%+v", roles[0])
	}
	if !roles[1].Overridden || roles[1].Perms[0] != "workspace:read" {
		t.Fatalf("member 应为 overridden 且 perms 来自覆盖：%+v", roles[1])
	}
	found := false
	for _, p := range catalog {
		if p == "roles:manage" {
			found = true
		}
	}
	if !found {
		t.Fatalf("catalog 必须包含 roles:manage，got %v", catalog)
	}
}
