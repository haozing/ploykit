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

// 平台管理员即使不是工作区成员也可管理角色权限集（运营跨工作区运维；
// owner 不可变与漂移守卫对平台管理员同样生效）。
func TestRolePerms_PlatformAdminWithoutMembership(t *testing.T) {
	f, ws := seedWS(t)
	a := &fakeAuditor{}
	svc := newRoleSvc(f, a)
	pa := &webx.Principal{UserID: "ops", IsPlatformAdmin: true} // 非成员

	t.Run("列出角色配置", func(t *testing.T) {
		configs, catalog, err := svc.ListRoleConfigs(context.Background(), pa, ws.ID)
		if err != nil {
			t.Fatalf("platform admin should list role configs: %v", err)
		}
		if len(configs) == 0 || len(catalog) == 0 {
			t.Fatal("expected configs and catalog")
		}
	})

	t.Run("设置角色权限集", func(t *testing.T) {
		cfg, err := svc.SetRolePerms(context.Background(), pa, ws.ID, "member",
			[]authz.Permission{authz.Permission("workspace:read"), authz.Permission("usage:read")})
		if err != nil {
			t.Fatalf("platform admin should set role perms: %v", err)
		}
		if !cfg.Overridden {
			t.Fatal("expected override row after platform admin set")
		}
	})

	t.Run("owner 不可变对平台管理员同样生效", func(t *testing.T) {
		if _, err := svc.SetRolePerms(context.Background(), pa, ws.ID, "owner",
			[]authz.Permission{authz.Permission("workspace:read")}); err == nil {
			t.Fatal("owner set must stay immutable even for platform admin")
		}
	})

	t.Run("重置回内置默认", func(t *testing.T) {
		if err := svc.ResetRolePerms(context.Background(), pa, ws.ID, "member"); err != nil {
			t.Fatalf("platform admin should reset role perms: %v", err)
		}
		if _, overridden := f.roleOverrides[ws.ID+"\x00member"]; overridden {
			t.Fatal("override row should be gone after reset")
		}
	})
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

func TestEffectivePerms(t *testing.T) {
	f, ws := seedWS(t)
	a := &fakeAuditor{}
	svc := newRoleSvc(f, a)
	if _, err := svc.SetRolePerms(context.Background(), ownerP("alice"), ws.ID, "member",
		[]authz.Permission{"workspace:read", "workspace:read"}); err != nil {
		t.Fatalf("set: %v", err)
	}

	permHas := func(perms []authz.Permission, want authz.Permission) bool {
		for _, p := range perms {
			if p == want {
				return true
			}
		}
		return false
	}

	cases := []struct {
		name string
		role string
		want func(t *testing.T, got []authz.Permission)
	}{
		{"owner → 全量目录", authz.RoleOwner, func(t *testing.T, got []authz.Permission) {
			catalog := svc.authz.Catalog().List()
			if len(got) != len(catalog) {
				t.Fatalf("owner perms len = %d, want catalog len %d", len(got), len(catalog))
			}
			for i := range catalog {
				if got[i] != catalog[i] {
					t.Fatalf("owner perms[%d] = %s, want %s（目录本身有序）", i, got[i], catalog[i])
				}
			}
			if !permHas(got, "roles:manage") {
				t.Fatalf("owner 目录必须含 roles:manage: %v", got)
			}
		}},
		{"member 有覆盖 → 覆盖替换默认（normalize）", authz.RoleMember, func(t *testing.T, got []authz.Permission) {
			if len(got) != 1 || got[0] != "workspace:read" {
				t.Fatalf("member perms = %v, want [workspace:read]", got)
			}
		}},
		{"admin 无覆盖 → 内置默认", authz.RoleAdmin, func(t *testing.T, got []authz.Permission) {
			def := svc.authz.BuiltinPerms(authz.RoleAdmin)
			if len(got) != len(def) {
				t.Fatalf("admin perms len = %d, want builtin len %d", len(got), len(def))
			}
			for i := range def {
				if got[i] != def[i] {
					t.Fatalf("admin perms[%d] = %s, want %s", i, got[i], def[i])
				}
			}
			if permHas(got, "roles:manage") || permHas(got, "workspace:delete") {
				t.Fatalf("admin 默认集不应含 owner 专属权限: %v", got)
			}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := svc.EffectivePerms(context.Background(), ws.ID, tc.role)
			if err != nil {
				t.Fatalf("EffectivePerms(%s): %v", tc.role, err)
			}
			tc.want(t, got)
		})
	}

	t.Run("重置覆盖后 member 回退内置默认", func(t *testing.T) {
		if err := svc.ResetRolePerms(context.Background(), ownerP("alice"), ws.ID, "member"); err != nil {
			t.Fatalf("reset: %v", err)
		}
		got, err := svc.EffectivePerms(context.Background(), ws.ID, authz.RoleMember)
		if err != nil {
			t.Fatalf("EffectivePerms: %v", err)
		}
		def := svc.authz.BuiltinPerms(authz.RoleMember)
		if len(got) != len(def) {
			t.Fatalf("member perms = %v, want builtin %v", got, def)
		}
		for i := range def {
			if got[i] != def[i] {
				t.Fatalf("member perms[%d] = %s, want %s", i, got[i], def[i])
			}
		}
		if permHas(got, "billing:manage") {
			t.Fatalf("member 默认集不应含 billing:manage: %v", got)
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
