package quota

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"github.com/haozing/ploykit/platform/webx"
)

const GrantCycleMonthly = "monthly"

type GrantIssued struct {
	WorkspaceID string
	Key         string
	Reason      string

	RefID  string
	Amount int
	Period string
}

func (s *Service) GrantPeriodic(ctx context.Context, workspaceID, key, reason, refID string, amount int, cycle string, now time.Time) (bool, error) {
	if strings.TrimSpace(refID) == "" {
		return false, webx.NewValidation("refID required: GrantPeriodic is idempotent on (workspace,key,reason,ref)")
	}
	if cycle != GrantCycleMonthly {
		return false, webx.NewValidation("unsupported grant cycle " + cycle + ": only 'monthly' is supported")
	}
	tag, err := s.pool.Exec(ctx, `
		INSERT INTO quota_grant (workspace_id, period, counter_key, amount, reason, ref_id, period_cycle)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT DO NOTHING`,
		workspaceID, Period(now), key, amount, reason, refID, cycle)
	if err != nil {
		return false, err
	}
	unlocked := tag.RowsAffected() > 0
	if unlocked && s.hooks.OnGrant != nil {
		if err := s.hooks.OnGrant(ctx, workspaceID, key, reason, refID, amount); err != nil {
			slog.Warn("quota OnGrant hook failed", "workspace", workspaceID, "key", key, "err", err)
		}
	}
	return unlocked, nil
}

func (s *Service) RefreshPeriodicGrants(ctx context.Context, now time.Time) ([]GrantIssued, error) {
	period := Period(now)
	rows, err := s.pool.Query(ctx, `
		INSERT INTO quota_grant (workspace_id, period, counter_key, amount, reason, ref_id)
		SELECT t.workspace_id, $1, t.counter_key, t.amount, t.reason, t.ref_id || '#' || $1
		FROM quota_grant t
		WHERE t.period_cycle = $2 AND t.period <> $1
		ON CONFLICT DO NOTHING
		RETURNING workspace_id, counter_key, reason, ref_id, amount`,
		period, GrantCycleMonthly)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []GrantIssued{}
	for rows.Next() {
		var g GrantIssued
		if err := rows.Scan(&g.WorkspaceID, &g.Key, &g.Reason, &g.RefID, &g.Amount); err != nil {
			return nil, err
		}
		g.Period = period
		out = append(out, g)
	}
	return out, rows.Err()
}
