package workers

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type waitWorker struct {
	name    string
	started chan struct{}
	release chan struct{}
	err     error
}

func (w *waitWorker) Name() string { return w.name }
func (w *waitWorker) Run(ctx context.Context) error {
	close(w.started)
	select {
	case <-w.release:
		return w.err
	case <-ctx.Done():
		return w.err
	}
}

func newWaitWorkers(t *testing.T, names ...string) (*Workers, map[string]*waitWorker) {
	t.Helper()
	r := NewWorkers(nil)
	ws := map[string]*waitWorker{}
	for _, n := range names {
		w := &waitWorker{name: n, started: make(chan struct{}), release: make(chan struct{})}
		ws[n] = w
		r.Add(w)
	}
	return r, ws
}

func TestAllHealthyMatrix(t *testing.T) {
	t.Run("运行中→健康", func(t *testing.T) {
		r, ws := newWaitWorkers(t, "a", "b")
		require.False(t, r.AllHealthy(), "未 Start 恒不健康")
		r.Start(context.Background())
		for _, w := range ws {
			<-w.started
		}
		assert.True(t, r.AllHealthy())
	})

	t.Run("正常退出→不健康（P1-1）", func(t *testing.T) {
		r, ws := newWaitWorkers(t, "ok")
		r.Start(context.Background())
		<-ws["ok"].started
		close(ws["ok"].release)
		assert.Eventually(t, func() bool { return !r.AllHealthy() },
			2*time.Second, 10*time.Millisecond,
			"Run 返回 nil 的 worker 已停止，AllHealthy 必须摘绿（探针契约）")
	})

	t.Run("异常退出→不健康", func(t *testing.T) {
		r, ws := newWaitWorkers(t, "bad")
		ws["bad"].err = errors.New("boom")
		r.Start(context.Background())
		<-ws["bad"].started
		close(ws["bad"].release)
		assert.Eventually(t, func() bool { return !r.AllHealthy() },
			2*time.Second, 10*time.Millisecond)
	})

	t.Run("panic→不健康（完整隔离断言见 TestPanicIsolation）", func(t *testing.T) {
		r := NewWorkers(nil)
		r.AddFunc("crazy", func(context.Context) error { panic("kaboom") })
		r.Start(context.Background())
		assert.Eventually(t, func() bool { return !r.AllHealthy() },
			2*time.Second, 10*time.Millisecond,
			"panic 的 worker 终态必须计入不健康")
	})
}

func TestPanicIsolation(t *testing.T) {
	r := NewWorkers(nil)
	var ran atomic.Bool
	block := make(chan struct{})
	r.AddFunc("boom", func(context.Context) error { panic("kaboom") })
	r.AddFunc("sane", func(ctx context.Context) error {
		ran.Store(true)
		<-block
		return nil
	})
	r.Start(context.Background())

	assert.Eventually(t, func() bool { return !r.AllHealthy() }, 2*time.Second, 10*time.Millisecond,
		"panic 的 worker 不健康")

	assert.Eventually(t, func() bool { return ran.Load() }, 2*time.Second, 10*time.Millisecond,
		"其余 worker 必须照常运行（panic 隔离）")
	close(block)
	assert.Eventually(t, func() bool { return !r.AllHealthy() }, 2*time.Second, 10*time.Millisecond)
}

func TestNilLogNoSecondPanic(t *testing.T) {
	r := NewWorkers(nil)
	assert.NotNil(t, r.log, "nil log 应回退 slog.Default()")
	r.AddFunc("boom", func(context.Context) error { panic("again") })
	r.Start(context.Background())
	assert.Eventually(t, func() bool { return !r.AllHealthy() }, 2*time.Second, 10*time.Millisecond,
		"nil-log 编排器下 panic 也必须被隔离并计入不健康")
}

func TestStartAddDiscipline(t *testing.T) {
	t.Run("Start 后 Add panic", func(t *testing.T) {
		r := NewWorkers(nil)
		r.Start(context.Background())
		assert.Panics(t, func() { r.AddFunc("late", func(context.Context) error { return nil }) })
	})

	t.Run("重复注册 panic", func(t *testing.T) {
		r := NewWorkers(nil)
		r.AddFunc("dup", func(context.Context) error { return nil })
		assert.Panics(t, func() { r.AddFunc("dup", func(context.Context) error { return nil }) })
	})

	t.Run("Start 幂等", func(t *testing.T) {
		r, ws := newWaitWorkers(t, "a")
		r.Start(context.Background())
		r.Start(context.Background())
		<-ws["a"].started
		close(ws["a"].release)
		assert.Eventually(t, func() bool { return !r.AllHealthy() }, 2*time.Second, 10*time.Millisecond)
	})
}

func TestDrain(t *testing.T) {
	t.Run("全部结束→Drain 立即返回", func(t *testing.T) {
		r, ws := newWaitWorkers(t, "a", "b")
		r.Start(context.Background())
		<-ws["a"].started
		<-ws["b"].started
		close(ws["a"].release)
		close(ws["b"].release)
		r.Drain(50 * time.Millisecond)
	})

	t.Run("卡死的 worker 到点放弃", func(t *testing.T) {
		r, ws := newWaitWorkers(t, "stuck")
		r.Start(context.Background())
		<-ws["stuck"].started
		start := time.Now()
		r.Drain(80 * time.Millisecond)
		assert.GreaterOrEqual(t, time.Since(start), 80*time.Millisecond, "卡死 worker 必须吃满各自 timeout")
		close(ws["stuck"].release)
	})

	t.Run("未 Start 即 Drain 不空等（P3-71）", func(t *testing.T) {
		r, _ := newWaitWorkers(t, "a")
		start := time.Now()
		r.Drain(500 * time.Millisecond)
		assert.Less(t, time.Since(start), 200*time.Millisecond, "未 Start 没有 goroutine 可等，不得空等满 timeout")
	})
}

func TestShutdownErrorNoiseSuppressed(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	r := NewWorkers(nil)
	block := make(chan struct{})
	r.AddFunc("noisy", func(ctx context.Context) error {
		<-block
		<-ctx.Done()
		return ctx.Err()
	})
	r.Start(ctx)
	close(block)
	cancel()
	assert.Eventually(t, func() bool { return !r.AllHealthy() }, 2*time.Second, 10*time.Millisecond)
}
