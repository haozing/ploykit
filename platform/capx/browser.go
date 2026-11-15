package capx

import (
	"context"
	"fmt"
	"sync"

	"github.com/chromedp/chromedp"
)

// browserInstance is one warm headless browser process. Renders check it out
// of the runtime pool, run their whole job on a fresh tab, and hand it back;
// frames never start processes.
type browserInstance struct {
	ctx    context.Context // allocator/browser context; cancel stops the process
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

	browserCtx, browserCancel := context.WithTimeout(allocCtx, rt.cfg.LaunchTimeout)
	cdpCtx, _ := chromedp.NewContext(browserCtx)
	// Force the browser process to start now; the first target would be
	// created lazily otherwise, hiding launch failures from acquire.
	if _, err := chromedp.Run(cdpCtx, chromedp.Func(func(_ context.Context, _ *chromedp.Target) error {
		return nil
	})); err != nil {
		browserCancel()
		allocCancel()
		return nil, fmt.Errorf("capx: launch chrome: %w", err)
	}

	inst := &browserInstance{ctx: allocCtx, cancel: allocCancel}
	// The instance outlives the launch deadline: swap the cancel func for
	// one that also releases the launch-timeout cancel.
	inst.cancel = func() {
		browserCancel()
		allocCancel()
	}
	return inst, nil
}
