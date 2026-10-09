package workers

import (
	"context"
	"time"

	"github.com/haozing/ploykit/quota"
)

type RefreshWorker struct {
	Service *quota.Service

	Every time.Duration
}

func (w *RefreshWorker) Name() string { return "quota_grant_refresh" }

func (w *RefreshWorker) Run(ctx context.Context) error {
	if w.Every <= 0 {
		w.Every = time.Hour
	}
	ticker := time.NewTicker(w.Every)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			_, _ = w.Service.RefreshPeriodicGrants(ctx, time.Now().UTC())
		}
	}
}
