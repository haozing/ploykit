package capx

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/chromedp/chromedp"
)

// browserInstance is one warm headless browser process. Renders check it out
// of the runtime pool, run their whole job on a fresh tab, and hand it back;
// frames never start processes.
//
// ctx is the chromedp context that HOLDS the browser (it carries the Browser
// value after the launcher's first Run). Every render tab derives from it, so
// tabs reuse the warm process instead of silently spawning their own Chrome —
// deriving from a bare allocator context makes every NewContext start a new
// browser, and the launch-deadline ctx would kill the warm instance 20s after
// it entered the pool (delivery-audit-video-studio §4 P9).
type browserInstance struct {
	ctx    context.Context // browser-holding chromedp context; cancel stops the process
	cancel context.CancelFunc
	mu     sync.Mutex // serializes jobs on this instance
}

// close terminates the browser process. Idempotent.
func (b *browserInstance) close() {
	if b == nil || b.cancel == nil {
		return
	}
	b.cancel()
}

// defaultLauncher starts one headless Chrome-family instance with chromedp's
// ExecAllocator and waits until the browser is up (first Run forces
// allocation, bounded by cfg.LaunchTimeout).
//
// Lifecycle split (audit §4 P9): the launch timeout bounds ONLY the startup
// Run. The instance lives on a deadline-free chain — a warm instance must
// not die sitting in the pool, and a minutes-long render must not inherit
// the launch deadline.
func defaultLauncher(rt *Runtime) (*browserInstance, error) {
	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.ExecPath(rt.chromePath),
		// Determinism-relevant flags beyond chromedp's defaults:
		// fixed color profile and a fresh temporary profile per instance
		// (already chromedp default) keep rasterization reproducible.
		chromedp.Flag("force-color-profile", "srgb"),
		chromedp.Flag("disable-gpu", true),
	)
	allocCtx, allocCancel := chromedp.NewExecAllocator(context.Background(), opts...)

	// Browser-holding context: after the first Run it carries the Browser
	// value; render tabs derive from THIS and reuse the process.
	browserCtx, _ := chromedp.NewContext(allocCtx)

	// Launch deadline wraps only the startup probe: the probe runs on the
	// deadline-free browser context inside a goroutine; the caller's launch
	// timeout decides when to give up (and tear the instance down).
	launchCdp, _ := chromedp.NewContext(browserCtx)
	launchDone := make(chan error, 1)
	go func() {
		_, err := chromedp.Run(launchCdp, chromedp.Func(func(_ context.Context, _ *chromedp.Target) error {
			return nil
		}))
		launchDone <- err
	}()
	select {
	case runErr := <-launchDone:
		if runErr != nil {
			allocCancel()
			return nil, fmt.Errorf("capx: launch chrome: %w", runErr)
		}
	case <-time.After(rt.cfg.LaunchTimeout):
		allocCancel() // kill the half-started process
		return nil, fmt.Errorf("capx: launch chrome: not ready within %s", rt.cfg.LaunchTimeout)
	}

	return &browserInstance{ctx: browserCtx, cancel: allocCancel}, nil
}

// alive reports whether the browser behind this instance is still usable.
// chromedp cancels the browser-holding context when the process dies, so a
// cancelled ctx is the signal that this instance must not be handed to
// another job. Nil-safe (a zero instance reads as dead).
func (b *browserInstance) alive() bool {
	if b == nil || b.ctx == nil {
		return false
	}
	return b.ctx.Err() == nil
}
