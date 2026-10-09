package webx

import (
	"context"
	"net/http"
	"sort"
	"sync"
	"time"
)

type CheckFunc func(ctx context.Context) error

type Health struct {
	mu     sync.RWMutex
	checks map[string]CheckFunc
}

func NewHealth() *Health {
	return &Health{checks: map[string]CheckFunc{}}
}

func (h *Health) AddCheck(name string, fn CheckFunc) *Health {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.checks[name] = fn
	return h
}

func (h *Health) Liveness() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
}

func (h *Health) Readiness() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		h.mu.RLock()
		checks := make(map[string]CheckFunc, len(h.checks))
		for name, fn := range h.checks {
			checks[name] = fn
		}
		h.mu.RUnlock()

		var (
			wg     sync.WaitGroup
			mu     sync.Mutex
			failed []string
		)
		for name, fn := range checks {
			wg.Add(1)
			go func(name string, fn CheckFunc) {
				defer wg.Done()

				errc := make(chan error, 1)
				ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
				go func() { errc <- fn(ctx) }()
				var err error
				select {
				case err = <-errc:
				case <-ctx.Done():
					err = ctx.Err()
				}
				cancel()
				if err != nil {
					mu.Lock()
					failed = append(failed, name)
					mu.Unlock()
				}
			}(name, fn)
		}
		wg.Wait()

		if len(failed) > 0 {
			sort.Strings(failed)
			WriteJSON(w, http.StatusServiceUnavailable, map[string]any{"status": "unavailable", "failed": failed})
			return
		}
		WriteJSON(w, http.StatusOK, map[string]string{"status": "ready"})
	}
}
