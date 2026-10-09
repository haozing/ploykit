package authz

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/haozing/ploykit/platform/webx"
)

func TestRequireOwnMiddleware_UTAZ05(t *testing.T) {

	rs := DefaultRoles().Clone()
	rs.Grant(RoleMember, "tasks:write_own")
	rs.Grant(RoleOwner, "tasks:write")
	a := New(nil, rs)

	ownCalls := 0
	handler := RequireOwn(a, "tasks:write", func(_ *http.Request, _ *webx.Principal) bool {
		ownCalls++
		return true
	})(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	rec := httptest.NewRecorder()
	handler(rec, httptest.NewRequest(http.MethodDelete, "/tasks/1", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("unauthenticated: got %d want 401", rec.Code)
	}

	req := httptest.NewRequest(http.MethodDelete, "/tasks/1", nil).
		WithContext(webx.WithPrincipal(context.Background(), principal(RoleMember, "ws1", false)))
	rec = httptest.NewRecorder()
	handler(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("member own: got %d want 200", rec.Code)
	}
	if ownCalls != 1 {
		t.Errorf("isOwn 回调调用次数=%d want 1", ownCalls)
	}

	handler2 := RequireOwn(a, "tasks:write", func(_ *http.Request, _ *webx.Principal) bool { return false })(
		func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	req = httptest.NewRequest(http.MethodDelete, "/tasks/1", nil).
		WithContext(webx.WithPrincipal(context.Background(), principal(RoleMember, "ws1", false)))
	rec = httptest.NewRecorder()
	handler2(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("member not-own: got %d want 403", rec.Code)
	}

	handler3 := RequireOwn(a, "tasks:write", func(_ *http.Request, _ *webx.Principal) bool {
		ownCalls++
		return false
	})(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	req = httptest.NewRequest(http.MethodDelete, "/tasks/1", nil).
		WithContext(webx.WithPrincipal(context.Background(), principal(RoleOwner, "ws1", false)))
	rec = httptest.NewRecorder()
	handler3(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("owner base: got %d want 200", rec.Code)
	}
	if ownCalls != 1 {
		t.Errorf("isOwn 调用次数=%d want 1（base 命中短路，不调 isOwn）", ownCalls)
	}
}

func TestCatalogOps_UTAZ06(t *testing.T) {
	c := NewCatalog("a:read")
	if !c.Has("a:read") || c.Has("a:write") {
		t.Fatal("Has 基本语义失败")
	}
	c.RegisterWithDesc("a:read", "读取 a")
	c.Register("b:write", "b:delete")
	if !c.Has("b:write") || !c.Has("b:delete") {
		t.Error("变参 Register 后应全部已声明")
	}
	list := c.List()
	if len(list) != 3 {
		t.Errorf("List 长度=%d want 3", len(list))
	}
	seen := map[Permission]bool{}
	for _, p := range list {
		seen[p] = true
	}
	if !seen["a:read"] || !seen["b:write"] || !seen["b:delete"] {
		t.Errorf("List 应含全部权限点, got %v", list)
	}
}

func TestRoleSetEdgeCases_UTAZ07(t *testing.T) {
	rs := NewRoleSet()
	rs.Revoke("ghost", "a:b")
	if rs.has("ghost", "a:b") {
		t.Error("未知角色不应有权限")
	}
	rs.Grant("custom", "a:b")
	if !rs.has("custom", "a:b") {
		t.Error("Grant 应自动创建角色")
	}
	rs.Grant("custom", "a:b")
	if len(rs.roles["custom"]) != 1 {
		t.Errorf("重复 Grant 应幂等, got %d", len(rs.roles["custom"]))
	}

	clone := rs.Clone()
	clone.Grant("custom", "c:d")
	if rs.has("custom", "c:d") {
		t.Error("Clone 后写克隆不应影响原集")
	}

	clone.Set("custom", "e:f")
	if clone.has("custom", "a:b") || !clone.has("custom", "e:f") {
		t.Error("Set 应整体覆盖")
	}
}

func TestAuthorizerCacheAndInvalidate_UTAZ08(t *testing.T) {
	calls := map[string]int{}
	prov := wsFakeProvider{fn: func(ws, _, role string) ([]Permission, error) {
		calls[ws+"\x00"+role]++
		switch ws {
		case "ws-c":
			return []Permission{"tasks:write"}, nil
		case "ws-b":
			return []Permission{"billing:manage"}, nil
		}
		return nil, nil
	}}
	a := New(nil, nil, WithProvider(prov), WithCacheTTL(time.Hour))

	p := principal(RoleMember, "ws-c", false)
	for i := 0; i < 3; i++ {
		if !a.Can(p, "tasks:write") {
			t.Fatalf("自定义角色应放行, 第 %d 次", i+1)
		}
	}
	if calls["ws-c\x00member"] != 1 {
		t.Errorf("缓存应命中, provider 实际调用=%d want 1", calls["ws-c\x00member"])
	}

	a.Can(principal(RoleMember, "ws-b", false), "billing:manage")
	nB := calls["ws-b\x00member"]
	a.InvalidateCache("ws-c")
	a.Can(p, "tasks:write")
	if calls["ws-c\x00member"] != 2 {
		t.Errorf("Invalidate 后应重查 provider, got %d", calls["ws-c\x00member"])
	}
	a.Can(principal(RoleMember, "ws-b", false), "billing:manage")
	if calls["ws-b\x00member"] != nB {
		t.Error("其他工作区缓存不应被清除")
	}

	prov2 := wsFakeProvider{fn: func(ws, _, role string) ([]Permission, error) {
		calls[ws+"\x00"+role]++
		return nil, nil
	}}
	b := New(nil, nil, WithProvider(prov2), WithCacheTTL(0))
	pd := principal(RoleMember, "ws-e", false)
	_ = b.Can(pd, "workspace:read")
	_ = b.Can(pd, "workspace:read")
	if calls["ws-e\x00member"] != 2 {
		t.Errorf("TTL=0 应每次查 provider, got %d", calls["ws-e\x00member"])
	}
}

type wsFakeProvider struct {
	fn func(ws, projectID, role string) ([]Permission, error)
}

func (f wsFakeProvider) PermsFor(_ context.Context, key RoleKey) ([]Permission, error) {
	return f.fn(key.WorkspaceID, key.ProjectID, key.Role)
}

func TestInvalidateCacheExactMatch_UTD02(t *testing.T) {
	calls := map[string]int{}
	prov := wsFakeProvider{fn: func(ws, _, role string) ([]Permission, error) {
		calls[ws+"\x00"+role]++
		return []Permission{"tasks:read"}, nil
	}}
	a := New(nil, nil, WithProvider(prov), WithCacheTTL(time.Hour))

	p1 := principal(RoleMember, "ws-1", false)
	p12 := principal(RoleMember, "ws-12", false)
	_ = a.Can(p1, "tasks:read")
	_ = a.Can(p12, "tasks:read")
	if calls["ws-1\x00member"] != 1 || calls["ws-12\x00member"] != 1 {
		t.Fatalf("两次 Can 应各自查一次 provider, got %v", calls)
	}

	a.InvalidateCache("ws-1")
	_ = a.Can(p1, "tasks:read")
	if calls["ws-1\x00member"] != 2 {
		t.Errorf("ws-1 失效后应重查 provider, got %d", calls["ws-1\x00member"])
	}
	_ = a.Can(p12, "tasks:read")
	if calls["ws-12\x00member"] != 1 {
		t.Errorf("ws-12（前缀重叠的无关工作区）缓存不应被清除, got %d", calls["ws-12\x00member"])
	}

	p1Admin := principal("admin", "ws-1", false)
	_ = a.Can(p1Admin, "tasks:read")
	a.InvalidateCache("ws-1")
	_ = a.Can(p1Admin, "tasks:read")
	if calls["ws-1\x00admin"] != 2 {
		t.Errorf("同工作区不同角色的缓存应随 InvalidateCache 一并失效, got %d", calls["ws-1\x00admin"])
	}
}

func TestProviderErrorNotCached_UTAZ08(t *testing.T) {
	fp := &fakeProvider{err: errors.New("db down")}
	a := New(nil, nil, WithProvider(fp), WithCacheTTL(time.Hour))
	p := principal(RoleMember, "ws-x", false)

	if a.Can(p, "tasks:write") {
		t.Fatal("provider 出错应回落内置映射拒绝")
	}

	fp.err = nil
	fp.perms = map[string][]Permission{RoleMember: {"tasks:write"}}
	if !a.Can(p, "tasks:write") {
		t.Fatal("恢复后应重查 provider 并放行（错误结果未被缓存）")
	}
}

func TestOverrideEmptySetDeniesAll_WA2(t *testing.T) {
	perms := []Permission{"tasks:write"}
	prov := wsFakeProvider{fn: func(_, _, _ string) ([]Permission, error) {
		return perms, nil
	}}
	a := New(nil, nil, WithProvider(prov), WithCacheTTL(0))
	p := principal(RoleMember, "ws1", false)

	if !a.Can(p, "tasks:write") {
		t.Fatal("有覆盖行时应按覆盖集放行")
	}
	if a.Can(p, "workspace:read") {
		t.Fatal("覆盖集是显式集合，不含的权限应被拒")
	}

	perms = []Permission{}
	if a.Can(p, "workspace:read") {
		t.Fatal("显式清零后应拒绝一切权限点（不回落内置）")
	}

	perms = nil
	if !a.Can(p, "workspace:read") {
		t.Fatal("删配置行后应回落内置映射（member 的 workspace:read 来自内置）")
	}
	if a.Can(p, "tasks:write") {
		t.Fatal("回落内置后原覆盖集不再生效")
	}

	perms = []Permission{}
	ownerP := principal(RoleOwner, "ws1", false)
	if a.Can(ownerP, "workspace:delete") {
		t.Fatal("显式清零后 owner 的内置 workspace:delete 也必须被拒")
	}
}

func TestNegativeCacheNoOverride_WA5(t *testing.T) {
	calls := 0
	prov := wsFakeProvider{fn: func(_, _, _ string) ([]Permission, error) {
		calls++
		return nil, nil
	}}
	a := New(nil, nil, WithProvider(prov), WithCacheTTL(time.Hour))
	p := principal(RoleMember, "ws-x", false)

	if !a.Can(p, "workspace:read") {
		t.Fatal("无覆盖应回落内置：member 的 workspace:read 来自内置映射")
	}
	_ = a.Can(p, "workspace:read")
	_ = a.Can(p, "workspace:read")
	if calls != 1 {
		t.Fatalf("负缓存应命中, provider 调用=%d want 1", calls)
	}

	a.InvalidateCache("ws-x")
	_ = a.Can(p, "workspace:read")
	if calls != 2 {
		t.Fatalf("失效后应重查, provider 调用=%d want 2", calls)
	}
}

func TestNegativeCacheDisabledWhenCacheOff_WA5(t *testing.T) {
	calls := 0
	prov := wsFakeProvider{fn: func(_, _, _ string) ([]Permission, error) {
		calls++
		return nil, nil
	}}
	a := New(nil, nil, WithProvider(prov), WithCacheTTL(0))
	p := principal(RoleMember, "ws-y", false)
	_ = a.Can(p, "workspace:read")
	_ = a.Can(p, "workspace:read")
	if calls != 2 {
		t.Fatalf("TTL=0 应每次查 provider, got %d", calls)
	}
}
