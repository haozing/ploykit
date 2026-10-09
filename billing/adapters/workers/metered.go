package workers

import (
	"context"
	"log/slog"
	"time"

	"github.com/haozing/ploykit/billing/app"
)

type UsageReader func(ctx context.Context, workspaceID, key, period string) (used, granted int64, err error)

type MeteredOverageWorker struct {
	Billing *app.BillingService

	Usage UsageReader

	Every time.Duration

	Batch int
}

func (w *MeteredOverageWorker) Name() string { return "billing_metered" }

func (w *MeteredOverageWorker) Run(ctx context.Context) error {
	if w.Every <= 0 {
		w.Every = 1 * time.Hour
	}
	if w.Batch <= 0 {
		w.Batch = 50
	}
	ticker := time.NewTicker(w.Every)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			if w.Usage == nil || w.Billing == nil {
				continue
			}

			if _, err := w.Billing.MeterDueOverages(ctx, time.Now().UTC(), w.Usage, w.Batch); err != nil {
				slog.Warn("worker round failed, will retry next tick", "worker", w.Name(), "err", err)
			}
		}
	}
}
