package quickjs_test

import (
	"context"
	"strings"
	"testing"
	"time"

	qjs "github.com/haozing/ploykit/platform/renderx/internal/qjs"
)

// TestVerifyClockPassesWithRealClock pins the happy path end to end: with the
// bridge wiring the host clock (bridge.go WithSysWalltime), a generous
// threshold passes. Hermetic: in-process wasm only.
func TestVerifyClockPassesWithRealClock(t *testing.T) {
	if err := qjs.VerifyClock(context.Background(), time.Minute); err != nil {
		t.Fatalf("VerifyClock(1m) = %v, want nil (sandbox clock must track host clock)", err)
	}
}

// TestClockSkewSmall pins the measured skew directly, with a threshold loose
// enough for CI scheduling jitter.
func TestClockSkewSmall(t *testing.T) {
	skew, err := qjs.ClockSkew(context.Background())
	if err != nil {
		t.Fatalf("ClockSkew: %v", err)
	}
	if skew < -10*time.Second || skew > 10*time.Second {
		t.Fatalf("ClockSkew = %s, want |skew| <= 10s", skew)
	}
	t.Logf("sandbox↔host skew: %s", skew)
}

// TestVerifyClockErrorMentionsFrozenEpoch pins the failure branch message:
// when the sandbox clock is the wazero fake clock (frozen 2022-01-01 epoch),
// the error must say so, name both timestamps and point at the wiring. The
// branch is exercised with synthetic readings so it cannot flake on real
// timing.
func TestVerifyClockErrorMentionsFrozenEpoch(t *testing.T) {
	err := qjs.VerifyClockErrorFor(time.UnixMilli(1640995200001), time.UnixMilli(1792942881464), time.Minute)
	if err == nil {
		t.Fatal("VerifyClockErrorFor(frozen 2022 clock) = nil, want error")
	}
	msg := err.Error()
	for _, want := range []string{"2022-01-01", "1640995200001", "1792942881464", "clock_time_get"} {
		if !strings.Contains(msg, want) {
			t.Errorf("error message %q missing %q", msg, want)
		}
	}
}

// TestVerifyClockErrorNilNearZero pins that sub-threshold synthetic skew is
// accepted.
func TestVerifyClockErrorNilNearZero(t *testing.T) {
	now := time.UnixMilli(1792942881464)
	if err := qjs.VerifyClockErrorFor(now.Add(-2*time.Second), now, time.Minute); err != nil {
		t.Fatalf("VerifyClockErrorFor(2s skew, 1m threshold) = %v, want nil", err)
	}
}
