package domain

import "testing"

func TestLastOwnerProtected(t *testing.T) {
	cases := []struct {
		role      string
		lastOwner bool
		action    RoleAction
		want      bool
	}{
		{RoleOwner, true, ActionRemove, true},
		{RoleOwner, true, ActionDemote, true},
		{RoleOwner, true, ActionPromote, false},
		{RoleOwner, false, ActionRemove, false},
		{RoleAdmin, true, ActionRemove, false},
	}
	for _, c := range cases {
		if got := LastOwnerProtected(c.role, c.lastOwner, c.action); got != c.want {
			t.Errorf("LastOwnerProtected(%s,%v,%d)=%v want %v", c.role, c.lastOwner, c.action, got, c.want)
		}
	}
}

func TestAssignableRoleExcludesOwner(t *testing.T) {
	if !AssignableRole(RoleAdmin) || !AssignableRole(RoleMember) {
		t.Error("admin/member should be assignable")
	}
	if AssignableRole(RoleOwner) {
		t.Error("owner must never be assignable")
	}
}

func TestSlugRules(t *testing.T) {
	for _, ok := range []string{"abcd", "a-b-c", "team-01"} {
		if !SlugOK(ok) {
			t.Errorf("%q should be valid", ok)
		}
	}
	for _, bad := range []string{"ab", "abc", "-abc", "abc-", "ABC", "a_b"} {
		if SlugOK(bad) {
			t.Errorf("%q should be invalid", bad)
		}
	}
	if !SlugReserved("api") || SlugReserved("team-01") {
		t.Error("reserved slug check broken")
	}
}

func TestShareCode(t *testing.T) {
	code, err := MintShareCode()
	if err != nil || !ShareCodeOK(code) {
		t.Fatalf("MintShareCode -> %q err=%v", code, err)
	}
}
