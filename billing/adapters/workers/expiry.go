package workers

import (
	"context"
	"log/slog"
	"time"

	"github.com/haozing/ploykit/billing/app"
)

// orderSweepGrace is the abandoned-checkout sweep's grace window (billing fix
// #1): the worker passes cutoff = now-24h to ExpireStaleOrders instead of a
// bare now. A checkout session that just expired may still have a payment in
// flight — the channel's webhook can legitimately lag (retry backoff, deploy
// windows, async settlement), and the sweeper used to zero out that window,
// racing the late paid event into a canceled terminal state. 24h covers the
// longest channel retry schedules; repo semantics stay `expires_at <= cutoff`.
const orderSweepGrace = 24 * time.Hour

// maxBatchesPerTick caps the chase loop below (billing fix #14): a burst
// backlog larger than 10 full batches is chased across ticks instead of
// starving the worker loop (and its ctx.Done check) in one tick.
const maxBatchesPerTick = 10

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

			if _, err := w.sweepOnce(ctx); err != nil {
				slog.Warn("worker round failed, will retry next tick", "worker", w.Name(), "err", err)
			}
		}
	}
}

// sweepOnce drains the due-workspace backlog within one tick (billing fix
// #14): a full batch means more rows are probably waiting, so it keeps
// sweeping — up to maxBatchesPerTick full batches per tick so a huge backlog
// cannot starve the worker loop.
func (w *ExpiryWorker) sweepOnce(ctx context.Context) (int, error) {
	total := 0
	for i := 0; i < maxBatchesPerTick; i++ {
		expired, err := w.Service.ExpireDueWorkspaces(ctx, time.Now(), w.Batch)
		if err != nil {
			return total, err
		}
		total += len(expired)
		if len(expired) < w.Batch {
			break // backlog drained (or empty): nothing left to chase this tick
		}
	}
	return total, nil
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
			if _, err := w.sweepOnce(ctx); err != nil {
				slog.Warn("worker round failed, will retry next tick", "worker", w.Name(), "err", err)
			}
		}
	}
}

// sweepOnce drains the stale-order backlog within one tick (billing fix #14):
// a full batch means more rows are probably waiting, so it keeps sweeping —
// up to maxBatchesPerTick full batches per tick so a huge backlog cannot
// starve the worker loop. The cutoff carries orderSweepGrace (fix #1): only
// sessions that expired more than 24h ago are swept, leaving in-flight
// webhook retries a window to win the race.
func (w *OrderExpiryWorker) sweepOnce(ctx context.Context) (int, error) {
	total := 0
	for i := 0; i < maxBatchesPerTick; i++ {
		ids, err := w.Service.ExpireStaleOrders(ctx, time.Now().UTC().Add(-orderSweepGrace), w.Batch)
		if err != nil {
			return total, err
		}
		total += len(ids)
		if len(ids) < w.Batch {
			break // backlog drained (or empty): nothing left to chase this tick
		}
	}
	return total, nil
}
