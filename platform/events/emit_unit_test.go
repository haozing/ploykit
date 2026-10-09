package events

import (
	"context"
	"testing"
	"time"

	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResolveInsertOpts_Matrix(t *testing.T) {
	t.Run("无 opts 无幂等键 → events 队列，零值 UniqueOpts", func(t *testing.T) {
		got := resolveInsertOpts(Event{Kind: "k"}, nil)
		assert.Equal(t, QueueEvents, got.Queue, "缺省必须隔离到 events 队列（BUG-2）")
		assert.Zero(t, got.UniqueOpts)
	})

	t.Run("幂等键 → UniqueOpts.ByArgs 且队列仍隔离", func(t *testing.T) {
		got := resolveInsertOpts(Event{Kind: "k", IDempotencyKey: "idem-1"}, nil)
		assert.True(t, got.UniqueOpts.ByArgs, "幂等键开启 ByArgs 去重")
		assert.Equal(t, QueueEvents, got.Queue)
	})

	t.Run("多 opts 取首个生效，其余忽略", func(t *testing.T) {
		opts := []river.InsertOpts{
			{MaxAttempts: 7},
			{MaxAttempts: 99, Queue: "other"},
		}
		got := resolveInsertOpts(Event{Kind: "k"}, opts)
		assert.Equal(t, 7, got.MaxAttempts, "多传取第一个")
		assert.Equal(t, QueueEvents, got.Queue, "首个 opts 未指定 Queue 仍隔离到 events")
		assert.NotEqual(t, 99, got.MaxAttempts)
	})

	t.Run("调用方显式 Queue 被尊重（逃生口）", func(t *testing.T) {
		got := resolveInsertOpts(Event{Kind: "k"}, []river.InsertOpts{{Queue: "default"}})
		assert.Equal(t, "default", got.Queue, "显式指定队列时不改写")
	})

	t.Run("幂等键整体覆盖调用方 UniqueOpts（含队列定制的 opts 其余字段保留）", func(t *testing.T) {
		got := resolveInsertOpts(
			Event{Kind: "k", IDempotencyKey: "idem-2"},
			[]river.InsertOpts{{Queue: "default", MaxAttempts: 3, UniqueOpts: river.UniqueOpts{ByState: []rivertype.JobState{rivertype.JobStateRunning}}}},
		)
		assert.True(t, got.UniqueOpts.ByArgs)
		assert.Empty(t, got.UniqueOpts.ByState, "幂等键优先：ByState 等定制被整体替换")
		assert.Equal(t, 3, got.MaxAttempts, "opts 其余字段原样保留")
		assert.Equal(t, "default", got.Queue, "调用方显式 Queue 不因幂等键丢失")
	})

	t.Run("无幂等键但调用方显式 UniqueOpts → 完全尊重", func(t *testing.T) {
		custom := river.UniqueOpts{ByState: []rivertype.JobState{rivertype.JobStateRunning}}
		got := resolveInsertOpts(Event{Kind: "k"}, []river.InsertOpts{{UniqueOpts: custom}})
		assert.Equal(t, custom, got.UniqueOpts, "无幂等键时不覆盖调用方 UniqueOpts")
		assert.Equal(t, QueueEvents, got.Queue)
	})

	t.Run("不改写调用方传入的 opts 切片", func(t *testing.T) {
		opts := []river.InsertOpts{{Queue: "default"}}
		_ = resolveInsertOpts(Event{Kind: "k", IDempotencyKey: "x"}, opts)
		assert.Empty(t, opts[0].UniqueOpts.ByArgs, "调用方 opts 值不被原地改写")
		assert.Equal(t, "default", opts[0].Queue)
	})
}

func TestEmit_NilEmitter(t *testing.T) {
	var em *Emitter
	err := em.Emit(context.Background(), nil, Event{Kind: "k"})
	require.ErrorContains(t, err, "not constructed via New")

	em = &Emitter{}
	err = em.Emit(context.Background(), nil, Event{Kind: "k"})
	require.ErrorContains(t, err, "not constructed via New")
}

func TestEmit_EmptyKindBeforeClientCheck(t *testing.T) {
	var em *Emitter
	err := em.Emit(context.Background(), nil, Event{})
	require.ErrorContains(t, err, "empty kind")
}

func TestBuildConfig_OptDiscipline(t *testing.T) {
	cfg := buildConfig(nil)
	require.NotNil(t, cfg.Logger, "缺省 Logger 非 nil")
	assert.Equal(t, defaultSoftStop, cfg.SoftStopTimeout)
	assert.Equal(t, defaultQueueWorkers, cfg.Queues[QueueEvents].MaxWorkers, "events 队列并发缺省 10")
	assert.Equal(t, defaultSoftStop+stopWaitMargin, cfg.SoftStopTimeout+stopWaitMargin, "stopWait=软停+余量")

	cfg = buildConfig(
		func(c *river.Config) { c.Logger = nil },
		func(c *river.Config) { c.SoftStopTimeout = 0 },
		nil,
	)
	require.NotNil(t, cfg.Logger, "opt 置空 Logger 后必须回填（river 要求非 nil）")
	assert.Equal(t, time.Duration(0), cfg.SoftStopTimeout, "显式 0 = 接受硬停语义，不被回填覆盖")
	assert.Equal(t, stopWaitMargin, cfg.SoftStopTimeout+stopWaitMargin, "软停 0 时 stopWait 退化为纯收尾余量")
}
