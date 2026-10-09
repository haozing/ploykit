package task

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTaskEventFor(t *testing.T) {
	tk := Task{ID: "t-1", Number: 7, Title: "写周报"}

	t.Run("create → task.created（payload 含 id/number/title）", func(t *testing.T) {
		ev, ok := taskEventFor(opCreate, tk)
		require.True(t, ok)
		assert.Equal(t, "task.created", ev.Type)
		assert.Equal(t, "t-1", ev.Payload["task_id"])
		assert.EqualValues(t, 7, ev.Payload["number"])
		assert.Equal(t, "写周报", ev.Payload["title"])
	})

	t.Run("complete → task.completed（payload 同形）", func(t *testing.T) {
		ev, ok := taskEventFor(opComplete, tk)
		require.True(t, ok)
		assert.Equal(t, "task.completed", ev.Type)
		assert.Equal(t, "t-1", ev.Payload["task_id"])
		assert.EqualValues(t, 7, ev.Payload["number"])
		assert.Equal(t, "写周报", ev.Payload["title"])
	})

	t.Run("未知操作不发事件", func(t *testing.T) {
		_, ok := taskEventFor("delete", tk)
		assert.False(t, ok)
	})
}

func TestEmitWebhookNilService(t *testing.T) {
	d := Deps{}
	assert.NotPanics(t, func() {
		d.emitWebhook(t.Context(), "ws-1", opCreate, Task{ID: "t-1", Number: 1, Title: "x"})
	})
}
