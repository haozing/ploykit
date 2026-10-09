package workers

import (
	"context"
	"log/slog"
	"time"

	"github.com/haozing/ploykit/platform/pgpart"
)

type RetentionWorker struct {
	Table *pgpart.Table

	Every time.Duration
}

func (w *RetentionWorker) Name() string { return "audit_retention" }

func (w *RetentionWorker) Run(ctx context.Context) error {
	every := w.Every
	if every <= 0 {
		every = time.Hour
	}
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			if err := w.round(ctx, time.Now().UTC()); err != nil {
				slog.Warn("worker round failed, will retry next tick", "worker", w.Name(), "err", err)
			}
		}
	}
}

func (w *RetentionWorker) round(ctx context.Context, now time.Time) error {
	r, err := w.Table.Maintain(ctx, now)
	if err != nil {
		return err
	}
	if r.Skipped {
		slog.Debug("partition maintenance lock held elsewhere, skipping round", "worker", w.Name())
		return nil
	}
	if len(r.Created) > 0 || len(r.Dropped) > 0 {
		slog.Info("audit_event partitions maintained",
			"worker", w.Name(), "created", r.Created, "dropped", r.Dropped)
	}
	return nil
}
