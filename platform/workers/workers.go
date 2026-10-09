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
}

func NewWorkers(log *slog.Logger) *Workers {
	if log == nil {
		log = slog.Default()
	}
	return &Workers{workers: map[string]Worker{}, states: map[string]*runState{}, log: log}
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

func (r *Workers) Drain(timeout time.Duration) {
	r.mu.Lock()
	started := r.started
	names := append([]string(nil), r.order...)
	states := make(map[string]*runState, len(r.states))
	for k, v := range r.states {
		states[k] = v
	}
	r.mu.Unlock()
	if !started {
		return
	}

	for _, name := range names {
		st := states[name]
		deadline := time.NewTimer(timeout)
		select {
		case <-st.done:
			deadline.Stop()
		case <-deadline.C:
			r.log.Warn("worker drain timed out, giving up", "name", name, "timeout", timeout.String())
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
