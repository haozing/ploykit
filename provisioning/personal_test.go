package provisioning

import (
	"context"
	"regexp"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// The workspace slug CHECK is '^[a-z0-9][a-z0-9-]{2,38}[a-z0-9]$'
// (migrations/003_workspace.up.sql). The derived slug must satisfy it for
// every uuid-shaped user id, or provisioning fails on the insert.
var workspaceSlugRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{2,38}[a-z0-9]$`)

func TestPersonalSlug(t *testing.T) {
	const uid = "6ba7b810-9dad-11d1-80b4-00c04fd430c8" // 36 chars with dashes
	got := personalSlug(uid)
	const want = "my-6ba7b8109dad11d180b400c04fd430c8"
	if got != want {
		t.Fatalf("personalSlug(%q) = %q, want %q", uid, got, want)
	}
	if len(got) != 35 { // "my-" + 32 hex chars
		t.Fatalf("slug length = %d, want 35", len(got))
	}
	if !workspaceSlugRe.MatchString(got) {
		t.Fatalf("slug %q violates the workspace slug CHECK", got)
	}

	// Defensive: an uppercase caller id still yields a CHECK-valid slug.
	if upper := personalSlug("6BA7B810-9DAD-11D1-80B4-00C04FD430C8"); !workspaceSlugRe.MatchString(upper) {
		t.Fatalf("uppercased id produced CHECK-invalid slug %q", upper)
	}

	// Deterministic: a replay derives the same slug (the idempotency anchor).
	if personalSlug(uid) != personalSlug(uid) {
		t.Fatal("personalSlug is not deterministic")
	}
}

func TestPersonalWorkspaceHookShape(t *testing.T) {
	hooks := PersonalWorkspace(PersonalConfig{})
	if hooks.OnRegisterTx != nil {
		t.Fatal("OnRegisterTx must stay nil: provisioning is post-commit, never must-succeed-with-the-user state (ADR 0016)")
	}
	if hooks.AfterRegister == nil || hooks.AfterLogin == nil {
		t.Fatal("AfterRegister and AfterLogin must both be wired — login-time re-ensure is the convergence mechanism")
	}
	if err := hooks.AfterLogin(context.Background(), "u", "s"); err == nil {
		// nil Pool + nil deps must surface as an error, never a silent
		// success claiming "provisioned" — and never a panic (the hooks run
		// inside login request paths where identity logs failures).
		t.Fatal("ensure with nil Pool must fail loudly")
	} else if !strings.Contains(err.Error(), "misconfigured") {
		t.Fatalf("nil-deps ensure error should name the misconfiguration, got: %v", err)
	}
}

// Quota is required IFF Credits is non-empty: products running their own
// credit ledger provision with Credits/Quota empty, and that configuration
// must not be rejected as misconfigured (field report #26 from the product
// that keeps its own ledger).
func TestPersonalEnsureQuotaOptionalWithoutCredits(t *testing.T) {
	// Credits non-empty + nil Quota → misconfigured, named at the guard.
	hooks := PersonalWorkspace(PersonalConfig{
		Pool:    &pgxpool.Pool{},
		Credits: []Credit{{Key: "welcome", Amount: 5}},
	})
	err := hooks.AfterRegister(context.Background(), "u")
	if err == nil || !strings.Contains(err.Error(), "Quota is required when Credits is non-empty") {
		t.Fatalf("credits-without-quota must name the misconfiguration, got: %v", err)
	}

	// A non-nil (unconnected) pool with Credits/Quota empty passes the
	// misconfiguration guard — the failure mode for an unconnected pool is a
	// query error, not a config error; assert the guard specifically.
	hooks2 := PersonalWorkspace(PersonalConfig{Pool: &pgxpool.Pool{}, Workspaces: nil})
	err2 := hooks2.AfterRegister(context.Background(), "u")
	if err2 == nil || !strings.Contains(err2.Error(), "Workspaces is required") {
		t.Fatalf("nil Workspaces must still be named, got: %v", err2)
	}
}
