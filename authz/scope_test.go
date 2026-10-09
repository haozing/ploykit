package authz

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/haozing/ploykit/platform/webx"
)

func resetScopeShapes(t *testing.T) {
	t.Helper()
	scopeMu.Lock()
	scopeShapes = nil
	scopeMu.Unlock()
	t.Cleanup(func() {
		scopeMu.Lock()
		scopeShapes = nil
		scopeMu.Unlock()
	})
}

func TestRegisterAndParseScopeShape(t *testing.T) {
	resetScopeShapes(t)
	if err := RegisterScopeShape("/tenants/{t}/projects/{p}"); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name  string
		path  string
		want  ScopePath
		match bool
	}{
		{"两层路径", "/tenants/t1/projects/p9", ScopePath{WorkspaceID: "t1", ProjectID: "p9"}, true},
		{"缺 project 段不命中", "/tenants/t1", ScopePath{}, false},
		{"尾段缺失不命中", "/tenants/t1/projects", ScopePath{}, false},
		{"字面量不匹配", "/orgs/t1/projects/p9", ScopePath{}, false},
		{"多余尾段不命中", "/tenants/t1/projects/p9/x", ScopePath{}, false},
		{"非 / 开头不命中", "tenants/t1/projects/p9", ScopePath{}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := ParseScopePath(tc.path)
			if ok != tc.match {
				t.Fatalf("match = %v want %v", ok, tc.match)
			}
			if ok && got != tc.want {
				t.Fatalf("got %+v want %+v", got, tc.want)
			}
		})
	}
}

func TestScopeShapeSingleLayerAndSpecificity(t *testing.T) {
	resetScopeShapes(t)

	if err := RegisterScopeShape("/orgs/{o}"); err != nil {
		t.Fatal(err)
	}
	sp, ok := ParseScopePath("/orgs/acme")
	if !ok || sp != (ScopePath{WorkspaceID: "acme"}) {
		t.Fatalf("单层形状解析: %+v ok=%v", sp, ok)
	}
	if _, ok := ParseScopePath("/orgs/acme/extra"); ok {
		t.Fatal("多一段不应命中单变量形状")
	}

	if err := RegisterScopeShape("/{a}/{b}"); err != nil {
		t.Fatal(err)
	}
	if err := RegisterScopeShape("/x/{p}"); err != nil {
		t.Fatal(err)
	}
	sp, ok = ParseScopePath("/x/9")
	if !ok || sp != (ScopePath{WorkspaceID: "9"}) {
		t.Fatalf("最具体形状应胜出: %+v ok=%v", sp, ok)
	}
}

func TestRegisterScopeShapeValidation(t *testing.T) {
	resetScopeShapes(t)
	for _, bad := range []string{
		"tenants/{t}",
		"/tenants",
		"/a/{x}/b/{y}/c/{z}",
		"/tenants/{}",
		"/tenants//projects/{p}",
	} {
		if err := RegisterScopeShape(bad); err == nil {
			t.Errorf("非法形状 %q 应报错", bad)
		}
	}

	for i := 0; i < 2; i++ {
		if err := RegisterScopeShape("/tenants/{t}/projects/{p}"); err != nil {
			t.Fatalf("第 %d 次注册: %v", i+1, err)
		}
	}
}

type twoLayerProvider struct {
	got  []RoleKey
	sets map[string][]Permission
}

func (p *twoLayerProvider) PermsFor(_ context.Context, key RoleKey) ([]Permission, error) {
	p.got = append(p.got, key)
	if perms, ok := p.sets[key.ProjectID+"\x00"+key.Role]; ok {
		return perms, nil
	}
	return nil, nil
}

func TestTwoLayerProjectRole(t *testing.T) {
	prov := &twoLayerProvider{sets: map[string][]Permission{
		"p1\x00editor": {"tasks:write"},
	}}
	a := New(nil, nil, WithProvider(prov))

	p := principal(RoleMember, "ws1", false)
	p.Project = &webx.ProjectScope{ID: "p1", Role: "editor"}
	if !a.Can(p, "tasks:write") {
		t.Fatal("project 层 editor 应经 project 级覆盖放行")
	}

	if len(prov.got) == 0 || prov.got[0] != (RoleKey{WorkspaceID: "ws1", ProjectID: "p1", Role: "editor"}) {
		t.Fatalf("provider 应收到两层键, got %+v", prov.got)
	}

	p.Project = nil
	if a.Can(p, "tasks:write") {
		t.Fatal("单层 member 不应有 tasks:write")
	}

	p.Project = &webx.ProjectScope{ID: "p1", Role: "ghost"}
	if a.Can(p, "workspace:read") {
		t.Fatal("未知 project 角色应全拒（不求并集、不回落 workspace 角色）")
	}

	p.Project = &webx.ProjectScope{ID: "p1"}
	if a.Can(p, "workspace:read") {
		t.Fatal("project 无角色应拒")
	}
}

func TestTwoLayerCacheNoCollision(t *testing.T) {
	prov := &twoLayerProvider{sets: map[string][]Permission{
		"p1\x00editor": {"tasks:write"},
		"\x00editor":   {"tasks:read"},
	}}
	a := New(nil, nil, WithProvider(prov), WithCacheTTL(0))
	base := principal("editor", "ws1", false)

	pProj := *base
	pProj.Project = &webx.ProjectScope{ID: "p1", Role: "editor"}
	if !a.Can(&pProj, "tasks:write") {
		t.Fatal("project 层覆盖应放行 tasks:write")
	}
	if a.Can(&pProj, "tasks:read") {
		t.Fatal("project 层覆盖是显式集合，不含 tasks:read")
	}
	if a.Can(base, "tasks:write") {
		t.Fatal("workspace 层 editor 只有 tasks:read")
	}
	if !a.Can(base, "tasks:read") {
		t.Fatal("workspace 层 editor 应有 tasks:read")
	}
	wantKeys := []RoleKey{
		{WorkspaceID: "ws1", ProjectID: "p1", Role: "editor"},
		{WorkspaceID: "ws1", ProjectID: "p1", Role: "editor"},
		{WorkspaceID: "ws1", Role: "editor"},
		{WorkspaceID: "ws1", Role: "editor"},
	}
	if len(prov.got) != len(wantKeys) {
		t.Fatalf("provider 调用 %d 次, got %+v", len(prov.got), prov.got)
	}
	for i, k := range wantKeys {
		if prov.got[i] != k {
			t.Errorf("第 %d 次键 = %+v want %+v", i, prov.got[i], k)
		}
	}
}

func TestCredentialScopeEnforcement_C3(t *testing.T) {

	a := scopedAuthorizer()
	cases := []struct {
		name string
		p    *webx.Principal
		perm Permission
		want bool
	}{
		{"无约束（nil Scope）owner 放行",
			principal(RoleOwner, "ws1", false), "webhooks:manage", true},
		{"权限子集内放行",
			scopedPrincipal(RoleOwner, "ws1", &webx.CredentialScope{Permissions: []string{"tasks:read"}}),
			"tasks:read", true},
		{"权限子集外拒绝（owner 也拒）",
			scopedPrincipal(RoleOwner, "ws1", &webx.CredentialScope{Permissions: []string{"tasks:read"}}),
			"webhooks:manage", false},
		{"权限子集通配 tasks:* 命中 *_own 变体",
			scopedPrincipal(RoleOwner, "ws1", &webx.CredentialScope{Permissions: []string{"tasks:*"}}),
			"tasks:delete_own", true},
		{"权限空集全拒",
			scopedPrincipal(RoleOwner, "ws1", &webx.CredentialScope{Permissions: []string{}}),
			"workspace:read", false},
		{"工作区子集内放行",
			scopedPrincipal(RoleOwner, "ws1", &webx.CredentialScope{WorkspaceIDs: []string{"ws1", "ws2"}}),
			"workspace:read", true},
		{"工作区子集外拒绝",
			scopedPrincipal(RoleOwner, "ws9", &webx.CredentialScope{WorkspaceIDs: []string{"ws1", "ws2"}}),
			"workspace:read", false},
		{"工作区空集全拒",
			scopedPrincipal(RoleOwner, "ws1", &webx.CredentialScope{WorkspaceIDs: []string{}}),
			"workspace:read", false},
		{"平台管理员不豁免约束型凭据",
			withScope(principal(RoleMember, "ws1", true), &webx.CredentialScope{Permissions: []string{"tasks:read"}}),
			"webhooks:manage", false},
		{"平台管理员子集内仍旁路角色",
			withScope(principal(RoleMember, "ws1", true), &webx.CredentialScope{Permissions: []string{"webhooks:manage"}}),
			"webhooks:manage", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := a.Can(tc.p, tc.perm); got != tc.want {
				t.Fatalf("Can = %v want %v", got, tc.want)
			}
		})
	}
}

func scopedAuthorizer() *Authorizer {
	rs := DefaultRoles().Clone()
	rs.Grant(RoleOwner, "tasks:read", "tasks:delete_own")
	return New(nil, rs)
}

func scopedPrincipal(role, wsID string, scope *webx.CredentialScope) *webx.Principal {
	return withScope(principal(role, wsID, false), scope)
}

func withScope(p *webx.Principal, scope *webx.CredentialScope) *webx.Principal {
	p.Scope = scope
	return p
}

func TestRequireMiddlewareCredentialScope_C3(t *testing.T) {
	a := scopedAuthorizer()
	p := principal(RoleOwner, "ws1", false)
	p.Source = webx.SourcePAT
	p.Scope = &webx.CredentialScope{Permissions: []string{"tasks:read"}}
	req := httptest.NewRequest(http.MethodPost, "/api/tasks", nil).
		WithContext(webx.WithPrincipal(context.Background(), p))

	rec := httptest.NewRecorder()
	Require(a, "webhooks:manage")(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("子集外: got %d want 403", rec.Code)
	}
	var body struct {
		Code string `json:"error"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil || body.Code != "E_FORBIDDEN" {
		t.Fatalf("code = %q err=%v (body %s)", body.Code, err, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	Require(a, "tasks:read")(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("子集内: got %d want 200", rec.Code)
	}
}
