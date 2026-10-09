package wsx

import (
	"testing"

	"github.com/haozing/ploykit/internal/contract/wswire"
)

func TestWorkspaceScopeMatchesWswire(t *testing.T) {
	t.Parallel()
	for _, id := range []string{"abc", "ws-001"} {
		if got, want := WorkspaceScope(id), wswire.ScopeKey(wswire.ScopeWorkspace, id); got != want {
			t.Errorf("WorkspaceScope(%q) = %q, want wswire.ScopeKey(ScopeWorkspace, ·) = %q", id, got, want)
		}
	}

	if got := WorkspaceScope("abc"); got != "workspace:abc" {
		t.Errorf(`WorkspaceScope("abc") = %q, want "workspace:abc"`, got)
	}
}

func TestUserScopeMatchesWswire(t *testing.T) {
	t.Parallel()
	for _, id := range []string{"u1", "usr-42"} {
		if got, want := UserScope(id), wswire.ScopeKey(wswire.ScopeUser, id); got != want {
			t.Errorf("UserScope(%q) = %q, want wswire.ScopeKey(ScopeUser, ·) = %q", id, got, want)
		}
	}
	if got := UserScope("u1"); got != "user:u1" {
		t.Errorf(`UserScope("u1") = %q, want "user:u1"`, got)
	}
}
