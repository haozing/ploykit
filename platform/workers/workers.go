package workers

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

type Worker interface {
	Name() string
	Run(ctx context.Context) error
}

type workerFunc struct {
	name string
	run  func(ctx context.Context) error
}

func (w workerFunc) Name() string                  { return w.name }
func (w workerFunc) Run(ctx context.Context) error { return w.run(ctx) }

type runState struct {
	done   chan struct{}
	err    error
	crash  bool
	finish bool
}

type Workers struct {
	mu      sync.Mutex
	order   []string
	workers map[string]Worker
	states  map[string]*runState
	started bool
	log     *slog.Logger
	// drainBudgets overrides Drain's shared timeout per worker name. Some
	// workers legitimately outlive ops' generic window (an event handler gets
	// 30s+margin; a video render runs for minutes), and a single shared
	// timeout silently truncates the longest one — the process then exits
	// mid-job, which the worker's own SoftStopTimeout was sized to prevent.
	drainBudgets map[string]time.Duration
}

func NewWorkers(log *slog.Logger) *Workers {
	if log == nil {
		log = slog.Default()
	}
	return &Workers{
		workers:      map[string]Worker{},
		states:       map[string]*runState{},
		drainBudgets: map[string]time.Duration{},
		log:          log,
	}
}

func (r *Workers) Add(w Worker) *Workers {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.started {
		panic("workers: no registration after Start " + w.Name())
	}
	if _, dup := r.workers[w.Name()]; dup {
		panic("workers: duplicate registration " + w.Name())
	}
	r.order = append(r.order, w.Name())
	r.workers[w.Name()] = w
	r.states[w.Name()] = &runState{done: make(chan struct{})}
	return r
}

func (r *Workers) AddFunc(name string, run func(ctx context.Context) error) *Workers {
	return r.Add(workerFunc{name: name, run: run})
}

func (r *Workers) Start(ctx context.Context) {
	r.mu.Lock()
	if r.started {
		r.mu.Unlock()
		return
	}
	r.started = true
	names := append([]string(nil), r.order...)
	states := make(map[string]*runState, len(r.states))
	for k, v := range r.states {
		states[k] = v
	}
	r.mu.Unlock()

	for _, name := range names {
		st := states[name]
		w, _ := r.lookup(name)
		if w == nil {
			continue
		}
		go func(w Worker, st *runState) {
			defer func() {
				if p := recover(); p != nil {
					st.crash = true
					r.log.Error("worker panic", "name", w.Name(), "panic", p)
				}
				st.finish = true
				close(st.done)
			}()
			st.err = w.Run(ctx)
			if st.err != nil && ctx.Err() != nil {
				st.err = nil
			}
			if st.err != nil {
				r.log.Error("worker exited", "name", w.Name(), "err", st.err)
			}
		}(w, st)
	}
	r.log.Info("workers started", "count", len(names))
}

func (r *Workers) lookup(name string) (Worker, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	w, ok := r.workers[name]
	return w, ok
}

// SetDrainBudget gives one worker its own drain window. Call before Start.
// Drain uses max(timeout, budget) for that worker, so a global window can
// never truncate a worker that declared it needs longer.
func (r *Workers) SetDrainBudget(name string, budget time.Duration) *Workers {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.drainBudgets == nil {
		r.drainBudgets = map[string]time.Duration{}
	}
	r.drainBudgets[name] = budget
	return r
}

func (r *Workers) Drain(timeout time.Duration) {
	r.mu.Lock()
	started := r.started
	names := append([]string(nil), r.order...)
	states := make(map[string]*runState, len(r.states))
	for k, v := range r.states {
		states[k] = v
	}
	budgets := make(map[string]time.Duration, len(r.drainBudgets))
	for k, v := range r.drainBudgets {
		budgets[k] = v
	}
	r.mu.Unlock()
	if !started {
		return
	}

	for _, name := range names {
		st := states[name]
		if st == nil {
			continue
		}
		window := timeout
		if b, ok := budgets[name]; ok && b > window {
			window = b
		}
		deadline := time.NewTimer(window)
		select {
		case <-st.done:
			deadline.Stop()
		case <-deadline.C:
			r.log.Warn("worker drain timed out, giving up", "name", name, "timeout", window.String())
		}
	}
}

func (r *Workers) AllHealthy() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.started || len(r.states) == 0 {
		return false
	}
	for _, st := range r.states {
		select {
		case <-st.done:
			return false
		default:
			continue
		}
	}
	return true
}

func (r *Workers) AnyCrashed() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, st := range r.states {
		if st.crash {
			return true
		}
	}
	return false
}
