package schedule

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/haozing/ploykit/platform/cronx"
)

type Repo interface {
	Create(ctx context.Context, p *SchedulePlan) error
	Get(ctx context.Context, workspaceID, id string) (SchedulePlan, error)
	ListByWorkspace(ctx context.Context, workspaceID string) ([]SchedulePlan, error)
	Update(ctx context.Context, p *SchedulePlan) error

	ClaimDue(ctx context.Context, now time.Time, limit int) ([]Claimed, error)

	Delete(ctx context.Context, workspaceID, id string) error
}

type PGRepo struct {
	pool *pgxpool.Pool
}

func NewPGRepo(pool *pgxpool.Pool) *PGRepo { return &PGRepo{pool: pool} }

const planCols = `id, workspace_id, kind, cron_expr, timezone, next_fire_at, misfire, last_fired_at, created_at, enabled`

func scanPlan(row pgx.Row) (SchedulePlan, error) {
	var p SchedulePlan
	err := row.Scan(&p.ID, &p.WorkspaceID, &p.Kind, &p.CronExpr, &p.Timezone,
		&p.NextFireAt, &p.Misfire, &p.LastFiredAt, &p.CreatedAt, &p.Enabled)
	return p, err
}

func (r *PGRepo) Create(ctx context.Context, p *SchedulePlan) error {
	return r.pool.QueryRow(ctx, `
		INSERT INTO schedule_plan (workspace_id, id, kind, cron_expr, timezone, next_fire_at, misfire, enabled)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING last_fired_at, created_at`,
		p.WorkspaceID, p.ID, p.Kind, p.CronExpr, p.Timezone, p.NextFireAt, p.Misfire, p.Enabled).
		Scan(&p.LastFiredAt, &p.CreatedAt)
}

func (r *PGRepo) Get(ctx context.Context, workspaceID, id string) (SchedulePlan, error) {
	p, err := scanPlan(r.pool.QueryRow(ctx,
		`SELECT `+planCols+` FROM schedule_plan WHERE workspace_id = $1 AND id = $2`, workspaceID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return SchedulePlan{}, ErrNotFound
	}
	if err != nil {
		return SchedulePlan{}, err
	}
	return p, nil
}

func (r *PGRepo) ListByWorkspace(ctx context.Context, workspaceID string) ([]SchedulePlan, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+planCols+` FROM schedule_plan
		WHERE workspace_id = $1 ORDER BY next_fire_at, created_at LIMIT 200`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SchedulePlan{}
	for rows.Next() {
		p, err := scanPlan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *PGRepo) Update(ctx context.Context, p *SchedulePlan) error {
	err := r.pool.QueryRow(ctx, `
		UPDATE schedule_plan SET
			kind = $3, cron_expr = $4, timezone = $5, next_fire_at = $6, misfire = $7, enabled = $8
		WHERE workspace_id = $1 AND id = $2
		RETURNING last_fired_at, created_at`,
		p.WorkspaceID, p.ID, p.Kind, p.CronExpr, p.Timezone, p.NextFireAt, p.Misfire, p.Enabled).
		Scan(&p.LastFiredAt, &p.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func (r *PGRepo) Delete(ctx context.Context, workspaceID, id string) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM schedule_plan WHERE workspace_id = $1 AND id = $2`, workspaceID, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

const poisonRetry = 6 * time.Hour

func (r *PGRepo) ClaimDue(ctx context.Context, now time.Time, limit int) ([]Claimed, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := r.pool.Query(ctx, `
		SELECT `+planCols+` FROM schedule_plan
		WHERE enabled AND next_fire_at <= $1
		ORDER BY next_fire_at LIMIT $2`, now, limit)
	if err != nil {
		return nil, err
	}
	var candidates []SchedulePlan
	for rows.Next() {
		p, err := scanPlan(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		candidates = append(candidates, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := []Claimed{}
	for _, p := range candidates {
		next, err := cronx.Next(p.CronExpr, p.Timezone, now)
		if err != nil {

			penalty := now.Add(poisonRetry)
			if _, uerr := r.pool.Exec(ctx, `
				UPDATE schedule_plan SET next_fire_at = $3
				WHERE workspace_id = $1 AND id = $2 AND next_fire_at <= $4 AND enabled`,
				p.WorkspaceID, p.ID, penalty, now); uerr != nil {
				slog.Warn("schedule: poison plan penalty-advance failed",
					"plan_id", p.ID, "err", uerr)
			}
			slog.Warn("schedule: plan has invalid cron/tz in db; pushed to penalty window",
				"plan_id", p.ID, "cron", p.CronExpr, "tz", p.Timezone,
				"retry_after", poisonRetry.String(), "err", err)
			continue
		}
		claimed, err := scanPlan(r.pool.QueryRow(ctx, `
			UPDATE schedule_plan
			SET next_fire_at = $3, last_fired_at = $2
			WHERE workspace_id = $1 AND id = $4 AND next_fire_at <= $2 AND enabled
			RETURNING `+planCols,
			p.WorkspaceID, now, next, p.ID))
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return out, err
		}
		out = append(out, Claimed{Plan: claimed, Due: p.NextFireAt})
	}
	return out, nil
}
