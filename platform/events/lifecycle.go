package events

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"

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
