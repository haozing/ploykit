package authz

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/haozing/ploykit/platform/webx"
)

func principal(role string, wsID string, admin bool) *webx.Principal {
	return &webx.Principal{UserID: "u1", WorkspaceID: wsID, Role: role, IsPlatformAdmin: admin}
}

func TestDefaultRoles(t *testing.T) {
	a := New(nil, nil)
	cases := []struct {
		role string
		perm Permission
		want bool
	}{
		{RoleOwner, "workspace:delete", true},
		{RoleAdmin, "workspace:delete", false},
		{RoleAdmin, "members:invite", true},
		{RoleMember, "members:invite", false},
		{RoleMember, "notifications:read", true},
		{RoleMember, "webhooks:manage", false},
		{"nonexistent", "workspace:read", false},
	}
	for _, c := range cases {
		if got := a.Can(principal(c.role, "ws1", false), c.perm); got != c.want {
			t.Errorf("role=%s perm=%s: got %v want %v", c.role, c.perm, got, c.want)
		}
	}
}

func TestCanEdgeCases(t *testing.T) {
	a := New(nil, nil)
	if a.Can(nil, "workspace:read") {
		t.Error("nil principal should deny")
	}
	if a.Can(principal(RoleOwner, "", false), "workspace:read") {
		t.Error("no workspace context should deny")
	}

	if a.Can(principal(RoleMember, "", true), "workspace:read") {
		t.Error("platform admin without workspace context should deny")
	}
	if !a.Can(principal(RoleMember, "ws1", true), "webhooks:manage") {
		t.Error("platform admin should bypass")
	}
}

func TestWildcard(t *testing.T) {
	rs := NewRoleSet().Set(RoleMember, "tasks:*")
	a := New(nil, rs)
	if !a.Can(principal(RoleMember, "ws1", false), "tasks:write") {
		t.Error("tasks:* should match tasks:write")
	}
	if !a.Can(principal(RoleMember, "ws1", false), "tasks:delete_own") {
		t.Error("tasks:* should match tasks:delete_own")
	}
	if a.Can(principal(RoleMember, "ws1", false), "webhooks:manage") {
		t.Error("tasks:* should not match other domains")
	}
}

func TestCanOwnConvention(t *testing.T) {
	rs := NewRoleSet().Set(RoleMember, "tasks:write_own")
	a := New(nil, rs)
	p := principal(RoleMember, "ws1", false)

	if !a.CanOwn(p, "tasks:write", true) {
		t.Error("own resource should pass via _own")
	}
	if a.CanOwn(p, "tasks:write", false) {
		t.Error("non-own resource should fail without base perm")
	}

	rs2 := NewRoleSet().Set(RoleMember, "tasks:write")
	a2 := New(nil, rs2)
	if !a2.CanOwn(p, "tasks:write", false) {
		t.Error("base perm should pass regardless of ownership")
	}
}

type fakeProvider struct {
	perms map[string][]Permission
	err   error
	calls int
}

func (f *fakeProvider) PermsFor(_ context.Context, key RoleKey) ([]Permission, error) {
	f.calls++
	return f.perms[key.Role], f.err
}

func TestCustomProviderOverride(t *testing.T) {
	fp := &fakeProvider{perms: map[string][]Permission{
		RoleMember: {"workspace:read", "tasks:write"},
	}}
	a := New(nil, nil, WithProvider(fp))
	p := principal(RoleMember, "ws1", false)

	if !a.Can(p, "tasks:write") {
		t.Error("custom override should grant tasks:write")
	}

	if a.Can(p, "notifications:read") {
		t.Error("override replaces builtin set, notifications:read should be gone")
	}

	if !a.Can(principal(RoleOwner, "ws1", false), "workspace:delete") {
		t.Error("role without override should fall back to builtin")
	}

	before := fp.calls
	_ = a.Can(p, "workspace:read")
	if fp.calls != before {
		t.Errorf("expected cached lookup, calls went %d -> %d", before, fp.calls)
	}
}

func TestProviderErrorFallsBackToBuiltin(t *testing.T) {
	fp := &fakeProvider{err: errors.New("db down")}
	a := New(nil, nil, WithProvider(fp))

	if a.Can(principal(RoleMember, "ws1", false), "webhooks:manage") {
		t.Error("provider error should fall back to builtin (deny)")
	}
	if !a.Can(principal(RoleOwner, "ws1", false), "webhooks:manage") {
		t.Error("provider error should fall back to builtin (allow for owner)")
	}
}

func TestRequireMiddleware(t *testing.T) {
	a := New(nil, nil)
	handler := Require(a, "webhooks:manage")(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodPost, "/x", nil)
	rec := httptest.NewRecorder()
	handler(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("unauthenticated: got %d want 401", rec.Code)
	}

	req = req.WithContext(webx.WithPrincipal(context.Background(), principal(RoleMember, "ws1", false)))
	rec = httptest.NewRecorder()
	handler(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("member: got %d want 403", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/x", nil)
	req = req.WithContext(webx.WithPrincipal(context.Background(), principal(RoleOwner, "ws1", false)))
	rec = httptest.NewRecorder()
	handler(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("owner: got %d want 200", rec.Code)
	}
}

func TestRoleSetOps(t *testing.T) {
	rs := DefaultRoles().Clone()
	rs.Revoke(RoleAdmin, "members:remove")
	rs.Grant(RoleMember, "tasks:write")

	a := New(nil, rs)
	if a.Can(principal(RoleAdmin, "ws1", false), "members:remove") {
		t.Error("revoked perm should deny")
	}
	if !a.Can(principal(RoleMember, "ws1", false), "tasks:write") {
		t.Error("granted perm should allow")
	}

	if !New(nil, nil).Can(principal(RoleAdmin, "ws1", false), "members:remove") {
		t.Error("default roles should be unaffected by clone mutation")
	}
}
