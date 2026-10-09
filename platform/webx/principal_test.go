package webx

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPrincipalAgentIDContextRoundTrip(t *testing.T) {
	p := &Principal{UserID: "u1", Source: SourcePAT, PATID: "pat-1", AgentID: "agent-9"}
	r := httptest.NewRequest(http.MethodGet, "/api/tasks", nil)
	r = r.WithContext(WithPrincipal(r.Context(), p))

	got := PrincipalFromRequest(r)
	if got == nil || got.AgentID != "agent-9" {
		t.Fatalf("AgentID lost in context round-trip: %+v", got)
	}

	if zero := (&Principal{}).AgentID; zero != "" {
		t.Fatalf("zero-value AgentID must be empty, got %q", zero)
	}
}

func TestCredentialScopeThreeStates(t *testing.T) {
	var nilScope *CredentialScope
	if !nilScope.AllowsWorkspace("ws-1") || !nilScope.AllowsPermission("tasks:write") {
		t.Fatal("nil 接收者（无约束凭据）应恒放行")
	}

	empty := &CredentialScope{}
	if !empty.AllowsWorkspace("ws-1") || !empty.AllowsPermission("tasks:write") {
		t.Fatal("零值集合（nil 切片）应视为无约束而非全拒")
	}

	denyAllWs := &CredentialScope{WorkspaceIDs: []string{}}
	if denyAllWs.AllowsWorkspace("ws-1") {
		t.Fatal("工作区空集应全拒")
	}
	denyAllPerm := &CredentialScope{Permissions: []string{}}
	if denyAllPerm.AllowsPermission("tasks:read") {
		t.Fatal("权限空集应全拒")
	}

	ws := &CredentialScope{WorkspaceIDs: []string{"ws-1", "ws-2"}}
	if !ws.AllowsWorkspace("ws-1") || ws.AllowsWorkspace("ws-3") {
		t.Fatal("工作区子集内放行、子集外拒绝")
	}

	perm := &CredentialScope{Permissions: []string{"tasks:read", "billing:*"}}
	if !perm.AllowsPermission("tasks:read") {
		t.Fatal("精确命中应放行")
	}
	if perm.AllowsPermission("tasks:write") {
		t.Fatal("子集外应拒绝")
	}
	if !perm.AllowsPermission("billing:manage") || !perm.AllowsPermission("billing:read_own") {
		t.Fatal("域通配 billing:* 应命中同域权限点（含 *_own）")
	}
	if perm.AllowsPermission("workspace:read") {
		t.Fatal("域通配不应跨域")
	}
}

func TestPrincipalProjectScopeRoundTrip(t *testing.T) {
	p := &Principal{
		UserID: "u1", Source: SourcePAT, PATID: "pat-1",
		WorkspaceID: "ws-1", Role: "member",
		Project:         &ProjectScope{ID: "p-9", Role: "editor"},
		Scope:           &CredentialScope{WorkspaceIDs: []string{"ws-1"}},
		IsPlatformAdmin: false,
	}
	r := httptest.NewRequest(http.MethodGet, "/api/tasks", nil)
	r = r.WithContext(WithPrincipal(r.Context(), p))

	got := PrincipalFromRequest(r)
	if got == nil || got.Project == nil || got.Project.ID != "p-9" || got.Project.Role != "editor" {
		t.Fatalf("Project 丢失或变形: %+v", got)
	}
	if got.Scope == nil || !got.Scope.AllowsWorkspace("ws-1") {
		t.Fatalf("Scope 丢失或变形: %+v", got)
	}

	if (&Principal{}).Project != nil {
		t.Fatal("零值 Project 必须为 nil（单层语义）")
	}
}

func TestRequireHumanStatusCodes_FT212(t *testing.T) {
	ok := func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }
	h := RequireHuman(ok)

	cases := []struct {
		name string
		p    *Principal
		want int
	}{
		{"匿名 401", nil, http.StatusUnauthorized},
		{"PAT 403", &Principal{UserID: "u1", Source: SourcePAT}, http.StatusForbidden},
		{"系统来源 403", &Principal{UserID: "sys", Source: SourceSystem}, http.StatusForbidden},
		{"会话 200", &Principal{UserID: "u1", Source: SourceSession}, http.StatusOK},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPost, "/auth/change-password", nil)
			if tc.p != nil {
				r = r.WithContext(WithPrincipal(r.Context(), tc.p))
			} else {
				r = r.WithContext(context.Background())
			}
			w := httptest.NewRecorder()
			h(w, r)
			if w.Code != tc.want {
				t.Fatalf("got %d want %d (body %q)", w.Code, tc.want, w.Body.String())
			}
		})
	}
}
