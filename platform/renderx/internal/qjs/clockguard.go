package quickjs

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// clockGuardJS is evaluated in a throwaway sandbox to read the wall clock the
// engine would see during a render.
const clockGuardJS = "String(Date.now())"

// ClockSkew measures how far the QuickJS sandbox wall clock (Date.now(),
// evaluated in a throwaway runtime) drifts from the host clock. Positive means
// the sandbox is ahead of the host.
//
// Motivation (issue "QuickJS prerender sandbox wall clock frozen at
// 2022-01-01T00:00:00Z"): wazero's default ModuleConfig serves a deterministic
// fake clock (epoch 2022-01-01 UTC, +1ms per read); bridge.New wires the real
// host clock via WithSysWalltime/WithSysNanotime. If that wiring ever regresses
// (wazero upgrade, refactored instantiation), prerenders silently bake stale
// timestamps into HTML that then fail hydration in the browser. This check
// turns that silent failure into a construction-time signal.
//
// Cost: one wasm instantiation against the shared compilation cache (no
// recompile), a single eval, then teardown.
func ClockSkew(ctx context.Context) (time.Duration, error) {
	skew, _, _, err := clockReadings(ctx)
	return skew, err
}

// VerifyClock asserts the sandbox wall clock tracks the host clock within
// maxSkew. Engine-pool construction or prerender builds should call this once
// up front (e.g. maxSkew = time.Minute) and fail fast — or log the returned
// error through the caller's structured logger — so a fake sandbox clock is
// exposed at build time instead of as wrong years in shipped HTML.
//
// Returns nil when the sandbox clock is within maxSkew of the host.
func VerifyClock(ctx context.Context, maxSkew time.Duration) error {
	_, sandboxMs, hostMs, err := clockReadings(ctx)
	if err != nil {
		return err
	}
	return VerifyClockErrorFor(time.UnixMilli(sandboxMs), time.UnixMilli(hostMs), maxSkew)
}

// VerifyClockErrorFor is the pure decision core of VerifyClock on already
// captured readings (exported so the failure branch is testable without
// faking an engine). sandbox/host are the two clock samples to compare.
func VerifyClockErrorFor(sandbox, host time.Time, maxSkew time.Duration) error {
	skew := sandbox.Sub(host)
	if skew < -maxSkew || skew > maxSkew {
		return fmt.Errorf("quickjs: sandbox wall clock skewed %s from host (sandbox Date.now()=%d → %s, host=%d → %s): "+
			"prerender would bake wrong timestamps — WASI clock_time_get wiring broken "+
			"(wazero default fake clock has epoch 2022-01-01T00:00:00Z)",
			skew.Round(time.Millisecond), sandbox.UnixMilli(), sandbox.UTC().Format(time.RFC3339),
			host.UnixMilli(), host.UTC().Format(time.RFC3339))
	}
	return nil
}

// clockReadings evaluates Date.now() in a throwaway sandbox and compares it
// with the host clock taken around the eval.
func clockReadings(ctx context.Context) (skew time.Duration, sandboxMs, hostMs int64, err error) {
	rt, err := NewRuntimeWithContext(ctx)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("quickjs: clock guard: %w", err)
	}
	defer rt.Close()

	jsCtx, err := rt.NewContext()
	if err != nil {
		return 0, 0, 0, fmt.Errorf("quickjs: clock guard: new context: %w", err)
	}
	defer jsCtx.Close()

	out, err := jsCtx.EvalToString(clockGuardJS, "<clockguard>")
	if err != nil {
		return 0, 0, 0, fmt.Errorf("quickjs: clock guard: eval Date.now(): %w", err)
	}

	sandboxMs, err = strconv.ParseInt(strings.TrimSpace(out), 10, 64)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("quickjs: clock guard: parse %q: %w", out, err)
	}
	hostMs = time.Now().UnixMilli()

	return time.UnixMilli(sandboxMs).Sub(time.UnixMilli(hostMs)), sandboxMs, hostMs, nil
}
