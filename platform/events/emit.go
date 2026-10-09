package events

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
)

const jobKind = "ploykit.event"

type Event struct {
	Kind string

	WorkspaceID uuid.UUID

	Payload []byte

	IDempotencyKey string
}

type eventArgs struct {
	EventKind      string          `json:"kind" river:"unique"`
	WorkspaceID    uuid.UUID       `json:"workspace_id" river:"unique"`
	Payload        json.RawMessage `json:"payload,omitempty"`
	IDempotencyKey string          `json:"idempotency_key,omitempty" river:"unique"`
}

func (eventArgs) Kind() string { return jobKind }

type Emitter struct {
	client *river.Client[pgx.Tx]

	stopWait time.Duration
}

func (e *Emitter) Emit(ctx context.Context, tx pgx.Tx, ev Event, opts ...river.InsertOpts) error {
	if ev.Kind == "" {
		return fmt.Errorf("events: emit: empty kind")
	}
	if e == nil || e.client == nil {
		return fmt.Errorf("events: emitter not constructed via New")
	}

	args := eventArgs{
		EventKind:      ev.Kind,
		WorkspaceID:    ev.WorkspaceID,
		Payload:        json.RawMessage(ev.Payload),
		IDempotencyKey: ev.IDempotencyKey,
	}

	insertOpts := resolveInsertOpts(ev, opts)

	if _, err := e.client.InsertTx(ctx, tx, args, insertOpts); err != nil {
		return fmt.Errorf("events: emit %s: %w", ev.Kind, err)
	}
	return nil
}

func resolveInsertOpts(ev Event, opts []river.InsertOpts) *river.InsertOpts {
	var insertOpts *river.InsertOpts
	if len(opts) > 0 {
		insertOpts = &opts[0]
	}
	if ev.IDempotencyKey != "" {
		if insertOpts != nil {
			cp := *insertOpts
			insertOpts = &cp
		} else {
			insertOpts = &river.InsertOpts{}
		}
		insertOpts.UniqueOpts = river.UniqueOpts{ByArgs: true}
	}
	if insertOpts == nil {
		insertOpts = &river.InsertOpts{Queue: QueueEvents}
	} else if insertOpts.Queue == "" {
		cp := *insertOpts
		insertOpts = &cp
		insertOpts.Queue = QueueEvents
	}
	return insertOpts
}
