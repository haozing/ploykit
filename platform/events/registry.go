package events

import (
	"context"
	"fmt"
	"log/slog"
	"sync"

	"github.com/riverqueue/river"
)

type Handler func(ctx context.Context, ev Event) error

type registry struct {
	mu       sync.RWMutex
	handlers map[string]Handler
	frozen   bool
}

func newRegistry() *registry {
	return &registry{handlers: map[string]Handler{}}
}

func (r *registry) subscribe(kind string, h Handler) {
	if kind == "" {
		panic("events: Subscribe with empty kind")
	}
	if h == nil {
		panic("events: Subscribe with nil handler for kind " + kind)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.frozen {
		panic("events: Subscribe after the events worker started (register handlers during wiring, before workers.Start)")
	}
	if _, dup := r.handlers[kind]; dup {
		panic("events: duplicate Subscribe for kind " + kind)
	}
	r.handlers[kind] = h
}

func (r *registry) lookup(kind string) (Handler, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	h, ok := r.handlers[kind]
	return h, ok
}

func (r *registry) freeze() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.frozen = true
}

var defaultRegistry = newRegistry()

func Subscribe(kind string, h Handler) {
	defaultRegistry.subscribe(kind, h)
}

type dispatcher struct {
	river.WorkerDefaults[eventArgs]
	reg *registry
	log *slog.Logger
}

func (d *dispatcher) Work(ctx context.Context, job *river.Job[eventArgs]) error {
	a := job.Args
	h, ok := d.reg.lookup(a.EventKind)
	if !ok {
		d.log.Warn("events: no subscriber for kind, dropped",
			"kind", a.EventKind, "workspace_id", a.WorkspaceID)
		return nil
	}
	ev := Event{
		Kind:           a.EventKind,
		WorkspaceID:    a.WorkspaceID,
		Payload:        []byte(a.Payload),
		IDempotencyKey: a.IDempotencyKey,
	}
	if err := h(ctx, ev); err != nil {

		if job.JobRow != nil && job.Attempt >= job.MaxAttempts {
			d.log.Error("events: handler exhausted retries, job discarded",
				"kind", a.EventKind, "workspace_id", a.WorkspaceID,
				"idempotency_key", a.IDempotencyKey,
				"attempts", job.Attempt, "err", err)
		}
		return err
	}
	return nil
}

var _ river.Worker[eventArgs] = (*dispatcher)(nil)

func (r *registry) String() string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return fmt.Sprintf("registry(%d kinds)", len(r.handlers))
}
