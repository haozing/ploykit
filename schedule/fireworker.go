package schedule

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
)

type KindHandler func(ctx context.Context, plan SchedulePlan, scheduledFor time.Time) error

var kindHandlers = map[string]KindHandler{}

func RegisterKind(kind string, h KindHandler) {
	if _, dup := kindHandlers[kind]; dup {
		panic("schedule: duplicate kind registration: " + kind)
	}
	kindHandlers[kind] = h
}

type FireWorker struct {
	river.WorkerDefaults[FireArgs]
	pool *pgxpool.Pool
	log  *slog.Logger

	lookup func(ctx context.Context, id string) (SchedulePlan, error)
}

func NewFireWorker(pool *pgxpool.Pool, log *slog.Logger) *FireWorker {
	return &FireWorker{pool: pool, log: log}
}

func (w *FireWorker) Kind() string { return JobKind }

func (w *FireWorker) Work(ctx context.Context, job *river.Job[FireArgs]) error {
	plan, err := w.fetchPlan(ctx, job.Args.PlanID)
	if errors.Is(err, pgx.ErrNoRows) {

		w.log.Info("schedule fire: plan gone", "plan_id", job.Args.PlanID,
			"scheduled_for", job.Args.ScheduledFor)
		return nil
	}
	if err != nil {
		return err
	}
	h, ok := kindHandlers[plan.Kind]
	if !ok {
		w.log.Info("schedule fire: no-op kind", "kind", plan.Kind, "plan_id", plan.ID,
			"scheduled_for", job.Args.ScheduledFor)
		return nil
	}
	return h(ctx, plan, job.Args.ScheduledFor)
}

func (w *FireWorker) fetchPlan(ctx context.Context, id string) (SchedulePlan, error) {
	if w.lookup != nil {
		return w.lookup(ctx, id)
	}
	return w.planByID(ctx, id)
}

func (w *FireWorker) planByID(ctx context.Context, id string) (SchedulePlan, error) {
	return scanPlan(w.pool.QueryRow(ctx, `SELECT id, workspace_id, kind, cron_expr, timezone,
	    next_fire_at, misfire, last_fired_at, created_at, enabled
	    FROM schedule_plan WHERE id = $1`, id))
}

const fireStopWait = 45 * time.Second

type FireRunner struct {
	client *river.Client[pgx.Tx]

	StopWait time.Duration
}

func NewFireRunner(client *river.Client[pgx.Tx]) *FireRunner {
	return &FireRunner{client: client}
}

func (r *FireRunner) Name() string { return "schedule_fire" }

func (r *FireRunner) stopWaitDuration() time.Duration {
	if r.StopWait > 0 {
		return r.StopWait
	}
	return fireStopWait
}

func (r *FireRunner) Run(ctx context.Context) error {
	if err := r.client.Start(ctx); err != nil {
		return err
	}
	<-ctx.Done()
	stopCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), r.stopWaitDuration())
	defer cancel()
	return r.client.Stop(stopCtx)
}
