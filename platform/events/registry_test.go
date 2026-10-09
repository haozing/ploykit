package events

import (
	"context"
	"errors"
	"log/slog"
	"testing"

	"github.com/google/uuid"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"
	"github.com/stretchr/testify/require"
)

func TestDispatcher_Work_Table(t *testing.T) {
	ws := uuid.MustParse("00000000-0000-0000-0000-0000000000a1")
	other := uuid.MustParse("00000000-0000-0000-0000-0000000000b2")

	type call struct {
		kind string
		ev   Event
	}
	t.Run("registered kinds dispatch with decoded fields", func(t *testing.T) {
		reg := newRegistry()
		var got []call
		reg.subscribe("task.created", func(_ context.Context, ev Event) error {
			got = append(got, call{kind: "task.created", ev: ev})
			return nil
		})
		reg.subscribe("task.completed", func(_ context.Context, ev Event) error {
			got = append(got, call{kind: "task.completed", ev: ev})
			return nil
		})
		d := &dispatcher{reg: reg, log: slog.Default()}

		events := []Event{
			{Kind: "task.created", WorkspaceID: ws, Payload: []byte(`{"task":{"id":"t1"}}`), IDempotencyKey: "k1"},
			{Kind: "task.completed", WorkspaceID: other, Payload: nil},
		}
		for _, ev := range events {
			require.NoError(t, d.Work(context.Background(), &river.Job[eventArgs]{
				Args: eventArgs{
					EventKind:      ev.Kind,
					WorkspaceID:    ev.WorkspaceID,
					Payload:        ev.Payload,
					IDempotencyKey: ev.IDempotencyKey,
				},
			}))
		}

		require.Len(t, got, 2, "each registered kind hits exactly its own handler")
		require.Equal(t, "task.created", got[0].kind)
		require.Equal(t, ws, got[0].ev.WorkspaceID)
		require.Equal(t, "k1", got[0].ev.IDempotencyKey)
		require.JSONEq(t, `{"task":{"id":"t1"}}`, string(got[0].ev.Payload))
		require.Equal(t, "task.completed", got[1].kind)
		require.Equal(t, other, got[1].ev.WorkspaceID)
		require.Empty(t, got[1].ev.Payload, "nil payload stays empty")
	})

	t.Run("unregistered kind is observed and dropped, not an error", func(t *testing.T) {
		reg := newRegistry()
		called := false
		reg.subscribe("task.created", func(context.Context, Event) error { called = true; return nil })
		d := &dispatcher{reg: reg, log: slog.Default()}

		err := d.Work(context.Background(), &river.Job[eventArgs]{
			Args: eventArgs{EventKind: "task.deleted", WorkspaceID: ws},
		})
		require.NoError(t, err, "unregistered kind: Observational semantics — log, complete, no retry")
		require.False(t, called)
	})

	t.Run("handler error propagates verbatim for river retry", func(t *testing.T) {
		reg := newRegistry()
		boom := errors.New("projection down")
		reg.subscribe("task.created", func(context.Context, Event) error { return boom })
		d := &dispatcher{reg: reg, log: slog.Default()}

		err := d.Work(context.Background(), &river.Job[eventArgs]{
			Args: eventArgs{EventKind: "task.created", WorkspaceID: ws},
		})
		require.ErrorIs(t, err, boom, "handler error must reach river unchanged so backoff retry applies")
	})
}

func TestRegistry_SubscribeDiscipline(t *testing.T) {
	h := func(context.Context, Event) error { return nil }

	t.Run("empty kind panics", func(t *testing.T) {
		require.PanicsWithValue(t, "events: Subscribe with empty kind", func() { newRegistry().subscribe("", h) })
	})
	t.Run("nil handler panics", func(t *testing.T) {
		require.PanicsWithValue(t, "events: Subscribe with nil handler for kind a.b",
			func() { newRegistry().subscribe("a.b", nil) })
	})
	t.Run("duplicate kind panics", func(t *testing.T) {
		reg := newRegistry()
		reg.subscribe("a.b", h)
		require.PanicsWithValue(t, "events: duplicate Subscribe for kind a.b",
			func() { reg.subscribe("a.b", h) })
	})
	t.Run("subscribe after freeze panics", func(t *testing.T) {
		reg := newRegistry()
		reg.freeze()
		require.Panics(t, func() { reg.subscribe("a.b", h) })
	})
}

func TestEventArgsKind(t *testing.T) {
	require.Equal(t, "ploykit.event", eventArgs{}.Kind())
}

type errLogHandler struct {
	records []string
}

func (h *errLogHandler) Enabled(_ context.Context, l slog.Level) bool { return l >= slog.LevelError }
func (h *errLogHandler) Handle(_ context.Context, r slog.Record) error {
	h.records = append(h.records, r.Message)
	return nil
}
func (h *errLogHandler) WithAttrs(_ []slog.Attr) slog.Handler { return h }
func (h *errLogHandler) WithGroup(_ string) slog.Handler      { return h }

func TestDispatcher_FinalAttemptErrorLogged(t *testing.T) {
	reg := newRegistry()
	boom := errors.New("boom")
	reg.subscribe("k.dead", func(context.Context, Event) error { return boom })

	t.Run("终次尝试失败 → Error 日志", func(t *testing.T) {
		rec := &errLogHandler{}
		d := &dispatcher{reg: reg, log: slog.New(rec)}
		err := d.Work(context.Background(), &river.Job[eventArgs]{
			JobRow: &rivertype.JobRow{Attempt: 25, MaxAttempts: 25},
			Args:   eventArgs{EventKind: "k.dead", IDempotencyKey: "k9"},
		})
		require.ErrorIs(t, err, boom, "error 原样透传（River 置 discarded）")
		require.Len(t, rec.records, 1)
		require.Contains(t, rec.records[0], "discarded")
	})
	t.Run("非终次失败 → 不升 Error（重试路径保持安静）", func(t *testing.T) {
		rec := &errLogHandler{}
		d := &dispatcher{reg: reg, log: slog.New(rec)}
		err := d.Work(context.Background(), &river.Job[eventArgs]{
			JobRow: &rivertype.JobRow{Attempt: 2, MaxAttempts: 25},
			Args:   eventArgs{EventKind: "k.dead"},
		})
		require.ErrorIs(t, err, boom)
		require.Empty(t, rec.records)
	})
}
