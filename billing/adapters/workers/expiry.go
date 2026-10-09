package workers

import (
	"context"
	"log/slog"
	"time"

	"github.com/haozing/ploykit/billing/app"
)

type ExpiryWorker struct {
	Service *app.BillingService

	Every time.Duration

	Batch int
}

func (w *ExpiryWorker) Name() string { return "billing_expiry" }

func (w *ExpiryWorker) Run(ctx context.Context) error {
	if w.Every <= 0 {
		w.Every = 1 * time.Hour
	}
	if w.Batch <= 0 {
		w.Batch = 100
	}
	ticker := time.NewTicker(w.Every)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:

			if _, err := w.Service.ExpireDueWorkspaces(ctx, time.Now(), w.Batch); err != nil {
				slog.Warn("worker round failed, will retry next tick", "worker", w.Name(), "err", err)
			}
		}
	}
}
