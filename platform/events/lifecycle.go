package events

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/riverqueue/river/rivermigrate"

	"github.com/haozing/ploykit/platform/workers"
)

const workerName = "river_events"

const QueueEvents = "events"

const (
	defaultQueueWorkers = 10

	defaultSoftStop = 30 * time.Second

	stopWaitMargin = 15 * time.Second
)

type Option func(*river.Config)

// Migrate brings the river job tables (river_job etc.) up to date (idempotent).
// Deliberately NOT part of ploykit migrations (001-999): the river schema
// follows the river library's own version sequence, managed adaptively by its
// official migrator - embedding it would pin us to one river version. Call it
// once in the product boot sequence after events.New and before
// workers.Start; deployments with their own migration pipeline may call it
// from there instead.
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	migrator, err := rivermigrate.New(riverpgxv5.New(pool), nil)
	if err != nil {
		return fmt.Errorf("events: river migrator: %w", err)
	}
	if _, err := migrator.Migrate(ctx, rivermigrate.DirectionUp, nil); err != nil {
		return fmt.Errorf("events: river schema migrate: %w", err)
	}
	return nil
}

func New(pool *pgxpool.Pool, wks *workers.Workers, opts ...Option) (*Emitter, error) {
	cfg := buildConfig(opts...)

	client, err := river.NewClient(riverpgxv5.New(pool), cfg)
	if err != nil {
		return nil, err
	}

	e := &Emitter{
		client:   client,
		stopWait: cfg.SoftStopTimeout + stopWaitMargin,
	}
	if wks != nil {
		wks.AddFunc(workerName, e.run)
	}
	return e, nil
}

func buildConfig(opts ...Option) *river.Config {
	logger := slog.Default()

	rw := river.NewWorkers()
	river.AddWorker(rw, &dispatcher{reg: defaultRegistry, log: logger})

	cfg := &river.Config{
		Queues: map[string]river.QueueConfig{
			QueueEvents: {MaxWorkers: defaultQueueWorkers},
		},
		Workers:         rw,
		Logger:          logger,
		SoftStopTimeout: defaultSoftStop,
	}
	for _, o := range opts {
		if o != nil {
			o(cfg)
		}
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	return cfg
}

func (e *Emitter) run(ctx context.Context) error {

	defaultRegistry.freeze()

	if err := e.client.Start(ctx); err != nil {
		return err
	}
	<-ctx.Done()

	stopCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), e.stopWait)
	defer cancel()
	return e.client.Stop(stopCtx)
}
