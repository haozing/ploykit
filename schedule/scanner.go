package schedule

import (
	"context"
	"log/slog"
	"time"
)

func PlanFires(misfire string, due, now time.Time, grace time.Duration) []time.Time {
	if now.After(due.Add(grace)) && misfire != MisfireOnce {
		return nil
	}
	return []time.Time{due}
}

type ScannerWorker struct {
	Repo Repo

	Fire func(ctx context.Context, plan SchedulePlan, scheduledFor time.Time) error

	Every time.Duration

	Batch int

	Grace time.Duration

	Now func() time.Time
}

func (w *ScannerWorker) Name() string { return "schedule_scanner" }

func (w *ScannerWorker) now() time.Time {
	if w.Now != nil {
		return w.Now()
	}
	return time.Now().UTC()
}

func (w *ScannerWorker) every() time.Duration {
	if w.Every <= 0 {
		return 5 * time.Second
	}
	return w.Every
}
func (w *ScannerWorker) batch() int {
	if w.Batch <= 0 {
		return 100
	}
	return w.Batch
}
func (w *ScannerWorker) grace() time.Duration {
	if w.Grace <= 0 {
		return Grace
	}
	return w.Grace
}

func (w *ScannerWorker) Run(ctx context.Context) error {
	ticker := time.NewTicker(w.every())
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			if fired, err := w.ScanOnce(ctx); err != nil {

				slog.Error("schedule scan failed", "fired", fired, "err", err)
			}
		}
	}
}

func (w *ScannerWorker) ScanOnce(ctx context.Context) (int, error) {
	now := w.now()
	claimed, err := w.Repo.ClaimDue(ctx, now, w.batch())
	fired := w.fireClaimed(ctx, claimed, now)
	return fired, err
}

func (w *ScannerWorker) fireClaimed(ctx context.Context, claimed []Claimed, now time.Time) int {
	fired := 0
	for _, c := range claimed {
		for _, at := range PlanFires(c.Plan.Misfire, c.Due, now, w.grace()) {
			if w.Fire == nil {
				continue
			}
			if err := w.Fire(ctx, c.Plan, at); err != nil {
				slog.Warn("schedule fire failed",
					"plan_id", c.Plan.ID, "kind", c.Plan.Kind, "scheduled_for", at, "err", err)
				continue
			}
			fired++
		}
	}
	return fired
}
