package eventsdemo

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/notify/app"
	"github.com/haozing/ploykit/platform/events"

	task "myproduct/internal/task"
)

type fakeHub struct {
	calls []struct {
		scope, event string
		payload      []byte
	}
	err error
}

func (f *fakeHub) BroadcastEvent(_ context.Context, scope, event string, payload []byte, _ string) error {
	if f.err != nil {
		return f.err
	}
	f.calls = append(f.calls, struct {
		scope, event string
		payload      []byte
	}{scope, event, payload})
	return nil
}

type fakeNotify struct {
	inputs []app.NotifyInput
	err    error
}

func (f *fakeNotify) Notify(_ context.Context, in app.NotifyInput) error {
	if f.err != nil {
		return f.err
	}
	f.inputs = append(f.inputs, in)
	return nil
}

func TestHandlers_TaskCreated(t *testing.T) {
	ws := uuid.MustParse("00000000-0000-0000-0000-00000000c0de")
	payload := []byte(`{"workspace_id":"` + ws.String() + `","actor_id":"u1","task":{"id":"t9","number":3,"title":"买牛奶"}}`)
	ev := events.Event{Kind: task.KindTaskCreated, WorkspaceID: ws, Payload: payload, IDempotencyKey: "task:t9"}

	t.Run("broadcast + notify happy path", func(t *testing.T) {
		hub, notify := &fakeHub{}, &fakeNotify{}
		require.NoError(t, Handlers(notify, hub)(context.Background(), ev))

		require.Len(t, hub.calls, 1)
		require.Equal(t, "workspace:"+ws.String(), hub.calls[0].scope)
		require.Equal(t, "task.created", hub.calls[0].event)
		require.Equal(t, payload, hub.calls[0].payload, "WS 帧载荷原样转发")

		require.Len(t, notify.inputs, 1)
		in := notify.inputs[0]
		require.Equal(t, "u1", in.UserID)
		require.Equal(t, "t9", in.DedupKey, "幂等键 = task id（重放不双发 bell）")
		require.Contains(t, in.Body, "买牛奶")
	})

	t.Run("nil ports degrade, not fail", func(t *testing.T) {
		require.NoError(t, Handlers(nil, nil)(context.Background(), ev))
	})

	t.Run("bad payload is swallowed, not retried", func(t *testing.T) {
		hub, notify := &fakeHub{}, &fakeNotify{}
		require.NoError(t, Handlers(notify, hub)(context.Background(),
			events.Event{Kind: task.KindTaskCreated, WorkspaceID: ws, Payload: []byte(`{oops`)}))
		require.Empty(t, hub.calls)
		require.Empty(t, notify.inputs)
	})

	t.Run("downstream errors propagate for river retry", func(t *testing.T) {
		boom := errors.New("hub down")
		require.ErrorIs(t, Handlers(&fakeNotify{}, &fakeHub{err: boom})(context.Background(), ev), boom)
	})

	t.Run("replay is a no-op duplicate for notify dedup", func(t *testing.T) {
		notify := &fakeNotify{}
		h := Handlers(notify, &fakeHub{})
		require.NoError(t, h(context.Background(), ev))
		require.NoError(t, h(context.Background(), ev))
		require.Len(t, notify.inputs, 2, "订阅方收到两次投递（at-least-once）")

		require.Equal(t, notify.inputs[0].DedupKey, notify.inputs[1].DedupKey)
	})
}
