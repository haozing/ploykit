package workers

import (
	"context"
	"time"

	"github.com/haozing/ploykit/webhooks/app"
)

type DeliveryWorker struct {
	Service *app.WebhookService

	Every time.Duration

	Batch int
}

func (w *DeliveryWorker) Name() string { return "webhook_delivery" }

func (w *DeliveryWorker) Run(ctx context.Context) error {
	if w.Every <= 0 {
		w.Every = 5 * time.Second
	}
	if w.Batch <= 0 {
		w.Batch = 20
	}
	ticker := time.NewTicker(w.Every)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			w.Service.DeliverPending(ctx, w.Batch)
		}
	}
}
