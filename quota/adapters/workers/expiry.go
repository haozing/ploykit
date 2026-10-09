package workers

import (
	"context"
	"time"

	"github.com/haozing/ploykit/quota"
)

type ExpiryWorker struct {
	Service *quota.Service

	Every time.Duration

	Batch int
}

func (w *ExpiryWorker) Name() string { return "quota_reservation_expiry" }

func (w *ExpiryWorker) Run(ctx context.Context) error {
	if w.Every <= 0 {
		w.Every = 5 * time.Minute
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
			_, _ = w.Service.ExpireDueReservations(ctx, time.Now().UTC(), w.Batch)
		}
	}
}
