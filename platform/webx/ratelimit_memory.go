package webx

import (
	"context"
	"sync"
	"time"
)

// MemoryLimiter is an in-process sliding-window Limiter (renderx-walk #6):
// single-binary deployments without Redis previously fell back to
// FailOpenLimiter — rate limiting silently off, brute-force surfaces wide
// open. This implementation is standard-library only and per-process (each
// replica limits independently), which is the correct trade for small
// deployments; multi-instance products move to redisx.NewGCRALimiter.
type MemoryLimiter struct {
	mu sync.Mutex
	// windows maps key -> ring of recent allowance timestamps. A key with no
	// activity for a full window is lazily garbage-collected on sweep.
	windows map[string][]time.Time
	// lastSweep bounds the map's growth from one-off keys (scanners, retired
	// IPs); a sweep runs at most once per window.
	lastSweep time.Time
}

// NewMemoryLimiter returns an in-process sliding-window limiter. The window
// is one minute (the Limiter contract's perMinute semantics).
func NewMemoryLimiter() *MemoryLimiter {
	return &MemoryLimiter{windows: map[string][]time.Time{}}
}

func (m *MemoryLimiter) Allow(_ context.Context, key string, perMinute int) (bool, time.Duration) {
	if perMinute <= 0 {
		return true, 0
	}
	now := time.Now()
	windowStart := now.Add(-time.Minute)

	m.mu.Lock()
	defer m.mu.Unlock()

	if now.Sub(m.lastSweep) > time.Minute {
		m.sweepLocked(windowStart)
		m.lastSweep = now
	}

	hits := m.windows[key]
	keep := 0
	for _, t := range hits {
		if t.After(windowStart) {
			hits[keep] = t
			keep++
		}
	}
	hits = hits[:keep]

	if len(hits) >= perMinute {
		// oldest hit exits the window then; that is when the next slot opens
		retry := time.Minute - now.Sub(hits[0])
		if retry < 0 {
			retry = 0
		}
		m.windows[key] = hits
		return false, retry
	}
	m.windows[key] = append(hits, now)
	return true, 0
}

// sweepLocked drops keys whose windows went fully cold (no hit inside the
// current window). Callers hold m.mu.
func (m *MemoryLimiter) sweepLocked(windowStart time.Time) {
	for k, hits := range m.windows {
		cold := true
		for _, t := range hits {
			if t.After(windowStart) {
				cold = false
				break
			}
		}
		if cold {
			delete(m.windows, k)
		}
	}
}
