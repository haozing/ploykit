package workers

import (
	"context"
	"time"

	pgrepo "github.com/haozing/ploykit/notify/adapters/bell"
)

// RetentionWorker prunes aged notifications (F8-4, orkome): webhooks had a
// delivery sweeper from day one, notifications had none — the table grows
// unboundedly. Default retention: archived rows live 30 days, read rows 90,
// unread rows are never touched (they are still the user's pending signal).
type RetentionWorker struct {
	Repo *pgrepo.Repo

	Every time.Duration

	ArchivedTTL time.Duration
	ReadTTL     time.Duration

	Batch int
}

func (w *RetentionWorker) Name() string { return "notification_retention" }

func (w *RetentionWorker) Run(ctx context.Context) error {
	if w.Every <= 0 {
		w.Every = time.Hour
	}
	if w.ArchivedTTL <= 0 {
		w.ArchivedTTL = 30 * 24 * time.Hour
	}
	if w.ReadTTL <= 0 {
		w.ReadTTL = 90 * 24 * time.Hour
	}
	if w.Batch <= 0 {
		w.Batch = 1000
	}
	ticker := time.NewTicker(w.Every)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			if _, err := w.Repo.DeleteAged(ctx, w.ArchivedTTL, w.ReadTTL, w.Batch); err != nil {
				// best-effort sweep: log and retry on the next tick
				continue
			}
		}
	}
}
