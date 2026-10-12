package devx

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"time"
)

// Check is one named self-diagnostic. A check answers a question the agent
// would otherwise have to reverse-engineer from a confusing failure ("is the
// river schema even migrated?"); it returns Pass with a human-readable detail,
// or Fail with the symptom AND the fix.
type Check struct {
	// Name is a stable machine identifier (e.g. "river_schema").
	Name string
	// Summary is a one-line description of what the check verifies.
	Summary string
	// Run executes the check. Timeout is enforced by the registry; a check
	// that outlives it reports Fail with a timeout symptom.
	Run func(ctx context.Context) Result
}

// Result is the outcome of one check.
type Result struct {
	Pass    bool   `json:"pass"`
	Detail  string `json:"detail"`
	FixHint string `json:"fix_hint,omitempty"`
}

// doctorResult is the aggregate /dev/doctor response.
type doctorResult struct {
	OK       bool          `json:"ok"`
	Duration time.Duration `json:"duration_ms"`
	Checks   []checkOut    `json:"checks"`
}

type checkOut struct {
	Name    string `json:"name"`
	Summary string `json:"summary"`
	Result
}

// Doctor is the check registry. Products register framework checks via the
// constructor helpers plus their own domain-specific ones; RunDoctor executes
// all of them concurrently with a per-check timeout.
type Doctor struct {
	mu     sync.Mutex
	checks []Check
}

// NewDoctor returns an empty registry.
func NewDoctor() *Doctor { return &Doctor{} }

// Register adds a check. Duplicate names panic — a duplicated check name is a
// wiring bug, and silent overwrite would hide one of the two diagnostics.
func (d *Doctor) Register(c Check) {
	d.mu.Lock()
	defer d.mu.Unlock()
	for _, existing := range d.checks {
		if existing.Name == c.Name {
			panic(fmt.Sprintf("devx: duplicate doctor check %q", c.Name))
		}
	}
	d.checks = append(d.checks, c)
}

// RunDoctor executes every registered check concurrently (per-check timeout,
// results sorted by name for stable output) and aggregates.
func (d *Doctor) RunDoctor(ctx context.Context, perCheckTimeout time.Duration) doctorResult {
	d.mu.Lock()
	checks := append([]Check{}, d.checks...)
	d.mu.Unlock()
	sort.Slice(checks, func(i, j int) bool { return checks[i].Name < checks[j].Name })

	if perCheckTimeout <= 0 {
		perCheckTimeout = 5 * time.Second
	}
	out := doctorResult{OK: true, Checks: make([]checkOut, 0, len(checks))}
	var wg sync.WaitGroup
	var mu sync.Mutex
	started := time.Now()
	for _, c := range checks {
		c := c
		wg.Add(1)
		go func() {
			defer wg.Done()
			cctx, cancel := context.WithTimeout(ctx, perCheckTimeout)
			defer cancel()
			res := runCheck(c, cctx, perCheckTimeout)
			mu.Lock()
			out.Checks = append(out.Checks, checkOut{Name: c.Name, Summary: c.Summary, Result: res})
			if !res.Pass {
				out.OK = false
			}
			mu.Unlock()
		}()
	}
	wg.Wait()
	out.Duration = time.Since(started)
	return out
}

func runCheck(c Check, ctx context.Context, timeout time.Duration) Result {
	done := make(chan Result, 1)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				done <- Result{Pass: false, Detail: fmt.Sprintf("check panicked: %v", r), FixHint: "the check implementation is broken; report it to the product author"}
			}
		}()
		done <- c.Run(ctx)
	}()
	select {
	case res := <-done:
		return res
	case <-ctx.Done():
		return Result{Pass: false, Detail: fmt.Sprintf("check timed out after %s", timeout), FixHint: "the check is hanging on a dead dependency; inspect that dependency"}
	}
}
