package webx

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

// renderx-walk #6: the in-process limiter must enforce perMinute within the
// window, hand out a retry-after, and let slots reopen as the window slides.
func TestMemoryLimiter_Window(t *testing.T) {
	m := NewMemoryLimiter()
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		ok, retry := m.Allow(ctx, "rl:t:1", 3)
		assert.True(t, ok, "hit %d inside the window must pass", i+1)
		assert.Zero(t, retry)
	}

	ok, retry := m.Allow(ctx, "rl:t:1", 3)
	assert.False(t, ok, "4th hit within the window must be denied")
	assert.True(t, retry > 0 && retry <= time.Minute, "retry-after points at the oldest hit exiting the window, got %v", retry)

	// a different key has its own window
	ok, _ = m.Allow(ctx, "rl:t:2", 3)
	assert.True(t, ok)

	// non-positive limit = unlimited (guard against zero-value configs
	// turning into a global DoS on themselves)
	ok, _ = m.Allow(ctx, "rl:t:3", 0)
	assert.True(t, ok)
}

func TestMemoryLimiter_SweepDropsColdKeys(t *testing.T) {
	m := NewMemoryLimiter()
	ctx := context.Background()
	m.Allow(ctx, "rl:cold:1", 5)
	// age the hit beyond the window (a real scanner's key sits cold for
	// minutes before the next sweep — simulate instead of sleeping)
	m.mu.Lock()
	m.windows["rl:cold:1"] = []time.Time{time.Now().Add(-5 * time.Minute)}
	m.lastSweep = time.Now().Add(-2 * time.Minute) // force a sweep on next Allow
	m.mu.Unlock()
	m.Allow(ctx, "rl:live:1", 5)
	m.mu.Lock()
	_, cold := m.windows["rl:cold:1"]
	m.mu.Unlock()
	assert.False(t, cold, "one-off keys must not accumulate forever")
}
