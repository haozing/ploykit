package pgrepo

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/haozing/ploykit/analytics/app"
)

type Repo struct {
	pool *pgxpool.Pool
	log  *slog.Logger
}

var _ app.Repo = (*Repo)(nil)

func New(pool *pgxpool.Pool, log *slog.Logger) *Repo {
	if log == nil {
		log = slog.Default()
	}
	return &Repo{pool: pool, log: log}
}

func (r *Repo) Track(ctx context.Context, e app.Event, now time.Time) {
	var wsID, userID, entityType, entityID any
	if e.WorkspaceID != "" {
		wsID = e.WorkspaceID
	}
	if e.UserID != "" {
		userID = e.UserID
	}
	if e.EntityType != "" {
		entityType = e.EntityType
	}
	if e.EntityID != "" {
		entityID = e.EntityID
	}

	payload := map[string]any{}
	if len(e.Payload) > 0 {
		payload = e.Payload
	}
	_, err := r.pool.Exec(ctx, `
		INSERT INTO analytics_event (workspace_id, user_id, event_type, entity_type, entity_id, payload, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		wsID, userID, e.Type, entityType, entityID, payload, now)
	if err != nil {
		r.log.Warn("analytics track failed (non-blocking)", "event", e.Type, "err", err)
	}
}

func (r *Repo) RecentByType(ctx context.Context, eventType string, limit int) ([]app.EventRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, COALESCE(workspace_id::text,''), COALESCE(user_id::text,''),
		       event_type, COALESCE(entity_type,''), COALESCE(entity_id,''),
		       payload, created_at
		FROM analytics_event
		WHERE event_type = $1
		ORDER BY created_at DESC LIMIT $2`, eventType, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []app.EventRow{}
	for rows.Next() {
		var e app.EventRow
		if err := rows.Scan(&e.ID, &e.WorkspaceID, &e.UserID, &e.Type, &e.EntityType, &e.EntityID, &e.Payload, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (r *Repo) Recent(ctx context.Context, since time.Time, limit int) ([]app.EventRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, COALESCE(workspace_id::text,''), COALESCE(user_id::text,''),
		       event_type, COALESCE(entity_type,''), COALESCE(entity_id,''),
		       payload, created_at
		FROM analytics_event
		WHERE created_at >= $1
		ORDER BY created_at DESC LIMIT $2`, since, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []app.EventRow{}
	for rows.Next() {
		var e app.EventRow
		if err := rows.Scan(&e.ID, &e.WorkspaceID, &e.UserID, &e.Type, &e.EntityType, &e.EntityID, &e.Payload, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (r *Repo) CountByType(ctx context.Context, eventType string, since time.Time) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx, `
		SELECT count(*) FROM analytics_event
		WHERE event_type = $1 AND created_at >= $2`, eventType, since).Scan(&n)
	return n, err
}

func (r *Repo) CountByTypeInWorkspace(ctx context.Context, workspaceID, eventType string, since time.Time) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx, `
		SELECT count(*) FROM analytics_event
		WHERE event_type = $1 AND created_at >= $2 AND workspace_id = $3`, eventType, since, workspaceID).Scan(&n)
	return n, err
}
