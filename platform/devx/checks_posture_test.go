package devx

import (
	"context"
	"testing"
)

func runPostureCheck(t *testing.T, c Check) Result {
	t.Helper()
	return c.Run(context.Background())
}

func TestDevCodeCheck(t *testing.T) {
	// Outside production a dev code is expected and only reported, never failed.
	got := runPostureCheck(t, DevCodeCheck("000000", false))
	if !got.Pass {
		t.Fatalf("dev code outside production must pass, got %+v", got)
	}
	if got.Detail == "" || !contains(got.Detail, "ENABLED") {
		t.Errorf("detail should announce the enabled code, got %q", got.Detail)
	}

	// Not configured at all.
	if got := runPostureCheck(t, DevCodeCheck("", false)); !got.Pass {
		t.Errorf("empty dev code must pass: %+v", got)
	}
	if got := runPostureCheck(t, DevCodeCheck("", true)); !got.Pass {
		t.Errorf("empty dev code in production must pass: %+v", got)
	}

	// Production + dev code: unreachable through the session service (it panics
	// at boot), but the check must still report failure if it can be observed.
	if got := runPostureCheck(t, DevCodeCheck("000000", true)); got.Pass {
		t.Errorf("production with dev code must fail: %+v", got)
	}
}

func TestIPHashSaltCheck(t *testing.T) {
	if got := runPostureCheck(t, IPHashSaltCheck("", true)); got.Pass {
		t.Error("empty salt in production must fail")
	}
	if got := runPostureCheck(t, IPHashSaltCheck("s3cret", true)); !got.Pass {
		t.Error("non-empty salt in production must pass")
	}
	// Empty salt outside production is the normal development shape.
	if got := runPostureCheck(t, IPHashSaltCheck("", false)); !got.Pass {
		t.Error("empty salt outside production must pass")
	}
}

func TestAuthSecretCheck(t *testing.T) {
	const devDefault = "dev-pepper-change-me"

	cases := []struct {
		name       string
		secret     string
		production bool
		wantPass   bool
	}{
		{"production + dev default", devDefault, true, false},
		{"production + empty", "", true, false},
		{"production + rotated", "9f2c-rotated-secret", true, true},
		{"dev + dev default", devDefault, false, true},
		{"dev + empty", "", false, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := runPostureCheck(t, AuthSecretCheck(c.secret, devDefault, c.production))
			if got.Pass != c.wantPass {
				t.Errorf("pass=%v want %v (detail=%q)", got.Pass, c.wantPass, got.Detail)
			}
			if !got.Pass && got.FixHint == "" {
				t.Error("failing check must carry a fix hint")
			}
		})
	}

	// An empty devDefault must not turn "any secret" into a false positive.
	if got := runPostureCheck(t, AuthSecretCheck("anything", "", true)); !got.Pass {
		t.Errorf("no default marker means no default comparison: %+v", got)
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
