package pgrepo

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/haozing/ploykit/admin/app"
	"github.com/haozing/ploykit/audit"
)

type Repo struct {
	pool *pgxpool.Pool

	audit *audit.Recorder
}

var _ app.Repo = (*Repo)(nil)

func New(pool *pgxpool.Pool) *Repo {
	return &Repo{pool: pool, audit: audit.NewRecorder(pool, nil)}
}

func (r *Repo) GetStats(ctx context.Context) (*app.PlatformStats, error) {
	var s app.PlatformStats
	err := r.pool.QueryRow(ctx, `
		SELECT
			(SELECT count(*) FROM "user"),
			(SELECT count(*) FROM "user" WHERE status = 'active'),
			(SELECT count(*) FROM workspace),
			(SELECT count(*) FROM workspace WHERE plan_code != 'free'),
			(SELECT count(*) FROM "user" WHERE created_at >= now() - interval '7 days'),
			(SELECT count(*) FROM "user" WHERE created_at >= now() - interval '30 days')
	`).Scan(&s.TotalUsers, &s.ActiveUsers, &s.TotalWorkspaces, &s.PaidWorkspaces, &s.NewUsers7d, &s.NewUsers30d)
	return &s, err
}

func (r *Repo) ListUsers(ctx context.Context, q, status string, limit, offset int) ([]app.AdminUser, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT u.id, u.email, u.display_name, u.status, u.is_platform_admin,
		       u.email_verified_at IS NOT NULL, u.created_at,
		       (SELECT max(s.last_seen_at) FROM session s WHERE s.user_id = u.id AND s.revoked_at IS NULL)
		FROM "user" u
		WHERE ($1 = '' OR u.email ILIKE $1 || '%' OR u.display_name ILIKE '%' || $1 || '%')
		  AND ($2 = '' OR u.status = $2)
		ORDER BY u.created_at DESC
		LIMIT $3 OFFSET $4`, q, status, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []app.AdminUser
	for rows.Next() {
		var u app.AdminUser
		if err := rows.Scan(&u.ID, &u.Email, &u.DisplayName, &u.Status, &u.IsPlatformAdmin,
			&u.EmailVerified, &u.CreatedAt, &u.LastLoginAt); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func (r *Repo) CountUsers(ctx context.Context, q, status string) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx, `
		SELECT count(*) FROM "user" u
		WHERE ($1 = '' OR u.email ILIKE $1 || '%' OR u.display_name ILIKE '%' || $1 || '%')
		  AND ($2 = '' OR u.status = $2)`, q, status).Scan(&n)
	return n, err
}

func (r *Repo) SetUserStatus(ctx context.Context, userID, status string) error {
	tag, err := r.pool.Exec(ctx, `UPDATE "user" SET status = $2, updated_at = now() WHERE id = $1`, userID, status)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return app.ErrNotFound
	}
	return nil
}

func (r *Repo) SetPlatformAdmin(ctx context.Context, userID string, isAdmin bool) error {
	tag, err := r.pool.Exec(ctx, `UPDATE "user" SET is_platform_admin = $2 WHERE id = $1`, userID, isAdmin)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return app.ErrNotFound
	}
	return nil
}

func (r *Repo) GetUserByID(ctx context.Context, userID string) (app.AdminUser, bool, error) {
	var u app.AdminUser
	err := r.pool.QueryRow(ctx, `
		SELECT id, email, display_name, status, is_platform_admin,
		       email_verified_at IS NOT NULL, created_at, NULL::timestamptz
		FROM "user" WHERE id = $1`, userID).
		Scan(&u.ID, &u.Email, &u.DisplayName, &u.Status, &u.IsPlatformAdmin,
			&u.EmailVerified, &u.CreatedAt, &u.LastLoginAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.AdminUser{}, false, nil
	}
	if err != nil {
		return app.AdminUser{}, false, err
	}
	return u, true, nil
}

func (r *Repo) ListUserWorkspaces(ctx context.Context, userID string) ([]app.AdminUserWorkspace, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT w.id, w.slug, w.name, m.role, m.created_at
		FROM member m JOIN workspace w ON w.id = m.workspace_id
		WHERE m.user_id = $1 ORDER BY m.created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []app.AdminUserWorkspace
	for rows.Next() {
		var x app.AdminUserWorkspace
		if err := rows.Scan(&x.ID, &x.Slug, &x.Name, &x.Role, &x.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

func (r *Repo) AllActiveUserIDs(ctx context.Context) ([]string, error) {
	rows, err := r.pool.Query(ctx, `SELECT id FROM "user" WHERE status = 'active' ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (r *Repo) ListWorkspaces(ctx context.Context, q string, limit, offset int) ([]app.AdminWorkspace, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT w.id, w.slug, w.name, w.plan_code, w.created_at,
		       (SELECT count(*) FROM member m WHERE m.workspace_id = w.id AND m.removed_at IS NULL),
		       (SELECT u.email FROM member m JOIN "user" u ON u.id = m.user_id
		         WHERE m.workspace_id = w.id AND m.role = 'owner' AND m.removed_at IS NULL LIMIT 1)
		FROM workspace w
		WHERE ($1 = '' OR w.name ILIKE '%' || $1 || '%' OR w.slug ILIKE $1 || '%')
		ORDER BY w.created_at DESC
		LIMIT $2 OFFSET $3`, q, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []app.AdminWorkspace{}
	for rows.Next() {
		var w app.AdminWorkspace
		if err := rows.Scan(&w.ID, &w.Slug, &w.Name, &w.PlanCode, &w.CreatedAt, &w.MemberCnt, &w.OwnerEmail); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

func (r *Repo) GetWorkspaceByID(ctx context.Context, id string) (app.AdminWorkspace, bool, error) {
	var w app.AdminWorkspace
	err := r.pool.QueryRow(ctx, `
		SELECT w.id, w.slug, w.name, w.plan_code, w.created_at,
		       (SELECT count(*) FROM member m WHERE m.workspace_id = w.id AND m.removed_at IS NULL),
		       (SELECT u.email FROM member m JOIN "user" u ON u.id = m.user_id
		         WHERE m.workspace_id = w.id AND m.role = 'owner' AND m.removed_at IS NULL LIMIT 1)
		FROM workspace w WHERE w.id = $1`, id).
		Scan(&w.ID, &w.Slug, &w.Name, &w.PlanCode, &w.CreatedAt, &w.MemberCnt, &w.OwnerEmail)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.AdminWorkspace{}, false, nil
	}
	if err != nil {
		return app.AdminWorkspace{}, false, err
	}
	return w, true, nil
}

func (r *Repo) ListWorkspaceMembers(ctx context.Context, workspaceID string) ([]app.WsMember, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT m.user_id, u.email, u.display_name, m.role, m.created_at
		FROM member m JOIN "user" u ON u.id = m.user_id
		WHERE m.workspace_id = $1 AND m.removed_at IS NULL
		ORDER BY m.created_at ASC`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []app.WsMember{}
	for rows.Next() {
		var m app.WsMember
		if err := rows.Scan(&m.UserID, &m.Email, &m.DisplayName, &m.Role, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (r *Repo) CountWorkspaces(ctx context.Context, q string) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx, `
		SELECT count(*) FROM workspace w
		WHERE ($1 = '' OR w.name ILIKE '%' || $1 || '%' OR w.slug ILIKE $1 || '%')`, q).Scan(&n)
	return n, err
}

func (r *Repo) ChangePlan(ctx context.Context, workspaceID, toPlan, actor, reason string, now time.Time) (string, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	var from string
	if err := tx.QueryRow(ctx, `SELECT plan_code FROM workspace WHERE id = $1 FOR UPDATE`, workspaceID).Scan(&from); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `UPDATE workspace SET plan_code = $2, updated_at = $3 WHERE id = $1`,
		workspaceID, toPlan, now); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO subscription_event (workspace_id, from_plan, to_plan, reason, actor)
		VALUES ($1, $2, $3, $4, $5)`, workspaceID, from, toPlan, reason, actor); err != nil {
		return "", err
	}
	return from, tx.Commit(ctx)
}

func (r *Repo) ListAudit(ctx context.Context, workspaceID string, limit int) ([]app.AuditEntry, error) {
	var rows interface {
		Next() bool
		Scan(...any) error
		Err() error
		Close()
	}
	var err error

	if workspaceID != "" {
		rows, err = r.pool.Query(ctx, `
			SELECT id, COALESCE(workspace_id::text,''), actor_type, actor_snapshot,
			       action, resource_type, COALESCE(resource_id,''), metadata, created_at
			FROM audit_event WHERE workspace_id = $1::uuid
			ORDER BY created_at DESC LIMIT $2`, workspaceID, limit)
	} else {
		rows, err = r.pool.Query(ctx, `
			SELECT id, COALESCE(workspace_id::text,''), actor_type, actor_snapshot,
			       action, resource_type, COALESCE(resource_id,''), metadata, created_at
			FROM audit_event
			ORDER BY created_at DESC LIMIT $1`, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []app.AuditEntry{}
	for rows.Next() {
		var e app.AuditEntry
		if err := rows.Scan(&e.ID, &e.WorkspaceID, &e.ActorType, &e.ActorSnapshot,
			&e.Action, &e.ResourceType, &e.ResourceID, &e.Metadata, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (r *Repo) QueryAudit(ctx context.Context, q audit.ListQuery) ([]app.AuditEntry, int, error) {
	items, total, err := r.audit.Query(ctx, q)
	if err != nil {
		return nil, 0, err
	}
	out := make([]app.AuditEntry, 0, len(items))
	for _, it := range items {
		out = append(out, app.AuditEntry{
			ID:            asString(it["id"]),
			WorkspaceID:   asString(it["workspace_id"]),
			ActorType:     asString(it["actor_type"]),
			ActorID:       asString(it["actor_id"]),
			ActorSnapshot: asMap(it["actor_snapshot"]),
			Action:        asString(it["action"]),
			ResourceType:  asString(it["resource_type"]),
			ResourceID:    asString(it["resource_id"]),
			Metadata:      asMap(it["metadata"]),
			CreatedAt:     asTime(it["created_at"]),
		})
	}
	return out, total, nil
}

func (r *Repo) AnalyticsSummary(ctx context.Context, since time.Time) ([]app.AnalyticsSummary, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT event_type, count(*), max(created_at)
		FROM analytics_event
		WHERE created_at >= $1
		GROUP BY event_type
		ORDER BY count(*) DESC`, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []app.AnalyticsSummary{}
	for rows.Next() {
		var s app.AnalyticsSummary
		if err := rows.Scan(&s.EventType, &s.Count, &s.LastAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func asString(v any) string {
	s, _ := v.(string)
	return s
}

func asMap(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}

func asTime(v any) time.Time {
	t, _ := v.(time.Time)
	return t
}

func (r *Repo) PlanExists(ctx context.Context, code string) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM plan WHERE code = $1)`, code).Scan(&exists)
	return exists, err
}
