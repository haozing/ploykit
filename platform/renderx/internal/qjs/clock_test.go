package quickjs_test

import (
	"encoding/json"
	"strconv"
	"testing"
	"time"

	qjs "github.com/haozing/ploykit/platform/renderx/internal/qjs"
)

// clockProbeResult mirrors the JSON produced by probeJS below.
type clockProbeResult struct {
	Now1       float64 `json:"now1"`
	ISO        string  `json:"iso"`
	Now2       float64 `json:"now2"`
	ParsedYear int     `json:"parsedYear"`
	PerfNow1   float64 `json:"perfNow1"`
	PerfNow2   float64 `json:"perfNow2"`
}

// probeJS reads the sandbox wall clock twice in the same eval round (to
// observe the read-to-read interval), formats one ISO timestamp, verifies
// that date *parsing* is clock-independent, and samples performance.now()
// (monotonic clock) the same way.
const probeJS = `JSON.stringify({
	now1: Date.now(),
	iso: new Date().toISOString(),
	now2: Date.now(),
	parsedYear: new Date('2026-10-25T00:00:00Z').getFullYear(),
	perfNow1: (typeof performance !== 'undefined' && performance.now) ? performance.now() : -1,
	perfNow2: (typeof performance !== 'undefined' && performance.now) ? performance.now() : -1
})`

// TestSandboxWallClockTracksHost is the clock probe for the QuickJS sandbox:
// the sandbox wall clock (Date.now / new Date) must track the host clock that
// is live when the prerender runs. If the WASI clock wiring regresses, wazero
// falls back to its deterministic fake clock (epoch 2022-01-01 UTC, +1ms per
// read) and prerendered HTML silently bakes 2022 into every component that
// reads the current time (field-observed as "© 2022" footers plus React #418
// hydration failures in consuming products).
//
// Hermetic: in-process wasm only; no network, FS or DB.
func TestSandboxWallClockTracksHost(t *testing.T) {
	rt, err := qjs.NewRuntime()
	if err != nil {
		t.Fatalf("NewRuntime: %v", err)
	}
	defer rt.Close()

	jsCtx, err := rt.NewContext()
	if err != nil {
		t.Fatalf("NewContext: %v", err)
	}
	defer jsCtx.Close()

	hostBefore := time.Now().UTC()
	out, err := jsCtx.EvalToString(probeJS, "<clockprobe>")
	if err != nil {
		t.Fatalf("eval clock probe: %v", err)
	}
	hostAfter := time.Now().UTC()

	var probe clockProbeResult
	if err := json.Unmarshal([]byte(out), &probe); err != nil {
		t.Fatalf("parse probe JSON %q: %v", out, err)
	}

	hostMid := hostBefore.Add(hostAfter.Sub(hostBefore) / 2)
	skew := time.UnixMilli(int64(probe.Now1)).Sub(hostMid)
	consecutive := time.Duration(probe.Now2-probe.Now1) * time.Millisecond

	t.Logf("host before/after eval: %s / %s", hostBefore.Format(time.RFC3339Nano), hostAfter.Format(time.RFC3339Nano))
	t.Logf("sandbox Date.now(): now1=%d now2=%d (same-round delta=%s)", int64(probe.Now1), int64(probe.Now2), consecutive)
	t.Logf("sandbox new Date().toISOString(): %s", probe.ISO)
	t.Logf("sandbox skew vs host: %s", skew)
	t.Logf("sandbox performance.now(): %v / %v (delta=%v)", probe.PerfNow1, probe.PerfNow2, probe.PerfNow2-probe.PerfNow1)
	t.Logf("sandbox date parse: new Date('2026-10-25').getFullYear() = %d", probe.ParsedYear)

	if abs := skew; abs < -2*time.Second || abs > 2*time.Second {
		t.Errorf("sandbox wall clock does not track host: skew=%s (sandbox Date.now()=%d, host≈%d); "+
			"expected |skew| < 2s — WASI clock_time_get wiring broken (fake 2022-01-01 clock in use?)",
			skew, int64(probe.Now1), hostMid.UnixMilli())
	}

	if probe.ParsedYear != 2026 {
		t.Errorf("sandbox date parsing regressed: new Date('2026-10-25').getFullYear() = %d, want 2026", probe.ParsedYear)
	}

	if consecutive < 0 || consecutive > 2*time.Second {
		t.Errorf("consecutive Date.now() reads in one round drifted %s; want [0, 2s]", consecutive)
	}

	// A second eval after a real host sleep: the sandbox clock must advance
	// by roughly the slept duration. A fake frozen clock advances by its
	// per-read increment instead (observed: 1-2ms regardless of the sleep).
	time.Sleep(150 * time.Millisecond)
	out2, err := jsCtx.EvalToString("String(Date.now())", "<clockprobe2>")
	if err != nil {
		t.Fatalf("eval clock probe 2: %v", err)
	}
	now3, err := strconv.ParseInt(out2, 10, 64)
	if err != nil {
		t.Fatalf("parse Date.now() %q: %v", out2, err)
	}
	advanced := time.UnixMilli(now3).Sub(time.UnixMilli(int64(probe.Now1)))
	t.Logf("sandbox clock advance across evals separated by 150ms host sleep: %s", advanced)

	if advanced < 80*time.Millisecond {
		t.Errorf("sandbox clock advanced only %s across a 150ms host sleep — clock is frozen/fake, "+
			"prerendered timestamps would be wrong", advanced)
	}
	if advanced > 10*time.Second {
		t.Errorf("sandbox clock advanced %s across a 150ms host sleep — implausible", advanced)
	}

	// performance.now() (monotonic) must be small and positive (ms since
	// module start), not a wall-clock epoch and not stuck at ~0/1ms.
	if probe.PerfNow1 >= 0 {
		if probe.PerfNow2 < probe.PerfNow1 {
			t.Errorf("monotonic clock went backwards: %v then %v", probe.PerfNow1, probe.PerfNow2)
		}
		if probe.PerfNow2 > 60_000 {
			t.Errorf("performance.now() returned %v ms — looks like wall-clock epoch leaked into the monotonic clock", probe.PerfNow2)
		}
	}
}
