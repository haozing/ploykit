package schedule

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func quietLog() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func mkFireJob(planID string, at time.Time) *river.Job[FireArgs] {
	return &river.Job[FireArgs]{JobRow: &rivertype.JobRow{}, Args: FireArgs{PlanID: planID, ScheduledFor: at}}
}

func TestFireWorkerKind(t *testing.T) {
	w := NewFireWorker(nil, quietLog())
	assert.Equal(t, JobKind, w.Kind())
	assert.Equal(t, "ploykit.schedule.fire", w.Kind(), "框架命名空间前缀，防与产品 job 冲突")
}

func TestFireWorkerPlanGone(t *testing.T) {
	w := NewFireWorker(nil, quietLog())
	w.lookup = func(context.Context, string) (SchedulePlan, error) {
		return SchedulePlan{}, pgx.ErrNoRows
	}
	require.NoError(t, w.Work(context.Background(), mkFireJob("gone", fixedNow)))
}

func TestFireWorkerDispatch(t *testing.T) {
	const kind = "test.fire.dispatch"
	RegisterKind(kind, func(_ context.Context, p SchedulePlan, at time.Time) error {
		assert.Equal(t, "p1", p.ID)
		assert.True(t, at.Equal(fixedNow), "scheduled_for 应原样透传给执行器")
		return nil
	})
	w := NewFireWorker(nil, quietLog())
	w.lookup = func(_ context.Context, id string) (SchedulePlan, error) {
		return SchedulePlan{ID: id, WorkspaceID: "ws-1", Kind: kind}, nil
	}
	require.NoError(t, w.Work(context.Background(), mkFireJob("p1", fixedNow)))
}

func TestFireWorkerNoopKind(t *testing.T) {
	w := NewFireWorker(nil, quietLog())
	w.lookup = func(_ context.Context, id string) (SchedulePlan, error) {
		return SchedulePlan{ID: id, Kind: "never.registered"}, nil
	}
	require.NoError(t, w.Work(context.Background(), mkFireJob("p1", fixedNow)))
}

func TestFireWorkerHandlerError(t *testing.T) {
	const kind = "test.fire.handler.err"
	wantErr := errors.New("boom")
	RegisterKind(kind, func(context.Context, SchedulePlan, time.Time) error { return wantErr })
	w := NewFireWorker(nil, quietLog())
	w.lookup = func(_ context.Context, id string) (SchedulePlan, error) {
		return SchedulePlan{ID: id, Kind: kind}, nil
	}
	assert.ErrorIs(t, w.Work(context.Background(), mkFireJob("p1", fixedNow)), wantErr)
}

func TestFireWorkerLookupError(t *testing.T) {
	dbErr := errors.New("db down")
	w := NewFireWorker(nil, quietLog())
	w.lookup = func(context.Context, string) (SchedulePlan, error) { return SchedulePlan{}, dbErr }
	assert.ErrorIs(t, w.Work(context.Background(), mkFireJob("p1", fixedNow)), dbErr)
}

func TestRegisterKindDuplicatePanics(t *testing.T) {
	const kind = "test.fire.dup"
	RegisterKind(kind, func(context.Context, SchedulePlan, time.Time) error { return nil })
	assert.Panics(t, func() { RegisterKind(kind, func(context.Context, SchedulePlan, time.Time) error { return nil }) })
}

func TestFireRunnerBasics(t *testing.T) {
	r := &FireRunner{}
	assert.Equal(t, "schedule_fire", r.Name())
	assert.Equal(t, fireStopWait, r.stopWaitDuration(), "缺省等待上限 45s")
	custom := 10 * time.Second
	r.StopWait = custom
	assert.Equal(t, custom, r.stopWaitDuration(), "StopWait 覆盖生效")
	r.StopWait = -time.Second
	assert.Equal(t, fireStopWait, r.stopWaitDuration())
}
