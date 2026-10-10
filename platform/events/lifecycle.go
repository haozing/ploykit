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

// Migrate 把 river 作业表（river_job 等）迁移到最新（幂等，重复执行安全）。
// 故意不并入 ploykit migrations（001–999）：river schema 归属 river 库自身的
// 版本序列，由其官方迁移器自适应管理，嵌入会钉死在特定 river 版本。
// 产品启动序列中于 events.New 之后、workers.Start 之前调用一次即可；
// 已有自身迁移管线的部署可改在自己流程里调这一函数。
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
