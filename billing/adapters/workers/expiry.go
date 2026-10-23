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

// OrderExpiryWorker sweeps pending orders whose checkout session expired
// (BC-4 / F15: waffo abandons sessions with zero callbacks — without this
// sweep those orders hang pending forever). Same wiring as ExpiryWorker.
type OrderExpiryWorker struct {
	Service *app.BillingService

	Every time.Duration

	Batch int
}

func (w *OrderExpiryWorker) Name() string { return "billing_order_expiry" }

func (w *OrderExpiryWorker) Run(ctx context.Context) error {
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
			if _, err := w.Service.ExpireStaleOrders(ctx, time.Now(), w.Batch); err != nil {
				slog.Warn("worker round failed, will retry next tick", "worker", w.Name(), "err", err)
			}
		}
	}
}
