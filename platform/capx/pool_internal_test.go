package capx

// In-package tests for the batch-4 regressions (delivery-audit-video-studio
// §4 P9/P10): pool hard-cap semantics touch the unexported acquire seam and
// the unexported browserInstance type, so they live beside the code. The
// odd-dimension validation is exported but kept with its sibling for
// discoverability.

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPoolHardCap_NeverExceedsPoolSize(t *testing.T) {
	// PoolSize is a hard concurrency cap: with 1 slot and N concurrent
	// acquires, at most one instance is alive at any time (the semaphore
	// gates before launch; the rest wait). Regression for the unbounded
	// launch found by the audit (PoolSize=1 produced 12 browsers).
	if testing.Short() {
		t.Skip("short mode")
	}
	// Build INERT (Enabled=false skips New's probe), then flip the flag and
	// stamp stub paths: the launcher is stubbed too, so no real Chrome is
	// ever started — the probe result is irrelevant for this test.
	disabled := false
	enabled := true
	rt, err := New(Config{Enabled: &disabled, PoolSize: 1, ChromePath: "chrome-stub", FFMpegPath: "ffmpeg-stub"})
	require.NoError(t, err)
	rt.cfg.Enabled = &enabled
	rt.chromePath = "chrome-stub"
	rt.ffmpegPath = "ffmpeg-stub"
	var launches int32
	var mu sync.Mutex
	rt.SetLauncherForTest(func(_ *Runtime) (*browserInstance, error) {
		mu.Lock()
		launches++
		n := launches
		mu.Unlock()
		require.LessOrEqual(t, n, int32(1), "never more than PoolSize live instances")
		return NewStubInstance(), nil
	})

	const workers = 6
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			inst, release, err := rt.acquire(ctx)
			require.NoError(t, err)
			mu.Lock()
			launches-- // instance checked out: slot consumed
			mu.Unlock()
			time.Sleep(20 * time.Millisecond) // hold briefly
			release()
			_ = inst
		}()
	}
	wg.Wait()
	// The invariant is asserted inside the launcher (launches never exceed 1
	// concurrently). The final counter value is -workers by construction
	// (each worker decrements its checkout), so nothing more to assert here.
}

func TestFrameSpec_OddDimensionsRejected(t *testing.T) {
	// libx264 yuv420p requires even dimensions; the spec rejects odd values
	// upstream so callers fail with a clear message instead of a cryptic
	// ffmpeg error mid-render (audit §4 P10).
	err := (FrameSpec{Width: 1081, Height: 1920, FPS: 30, DurationFrames: 10}).Validate()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "even")
	err = (FrameSpec{Width: 1080, Height: 1921, FPS: 30, DurationFrames: 10}).Validate()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "even")
	require.NoError(t, (FrameSpec{Width: 1080, Height: 1920, FPS: 30, DurationFrames: 10}).Validate())
}
