package pgrepo

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/haozing/ploykit/notify/app"
	"github.com/haozing/ploykit/platform/pg"
)

type Repo struct {
	pool *pgxpool.Pool
}

var _ app.Repo = (*Repo)(nil)

func New(pool *pgxpool.Pool) *Repo { return &Repo{pool: pool} }

func (r *Repo) Insert(ctx context.Context, n app.NotifyInput, now time.Time) (bool, error) {
	tag, err := r.pool.Exec(ctx, `
		INSERT INTO notification (user_id, workspace_id, type, title, body, link, dedup_key, once_per_month, created_at)
		VALUES ($1, NULLIF($2, '')::uuid, $3, $4, $5, NULLIF($6, ''), NULLIF($7, ''), $8, $9)`,
		n.UserID, n.Workspace, n.Type, n.Title, n.Body, n.Link, n.DedupKey, n.OncePerMonth, now)
	if err != nil {

		if pg.IsUniqueViolation(err, "uq_notification_dedup") ||
			pg.IsUniqueViolation(err, "uq_notification_month") {
			return false, nil
		}
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func (r *Repo) ListInbox(ctx context.Context, userID, workspaceID string, limit int) ([]app.Notification, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, type, title, body, link, COALESCE(workspace_id::text, ''), count, read_at, created_at
		FROM notification
		WHERE user_id = $1 AND archived_at IS NULL
		  AND ($2::uuid IS NULL OR workspace_id = $2::uuid)
		ORDER BY (read_at IS NULL) DESC, created_at DESC
		LIMIT $3`, userID, nilIfEmpty(workspaceID), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []app.Notification{}
	for rows.Next() {
		var n app.Notification
		var link *string
		if err := rows.Scan(&n.ID, &n.Type, &n.Title, &n.Body, &link, &n.Workspace, &n.Count, &n.ReadAt, &n.CreatedAt); err != nil {
			return nil, err
		}
		if link != nil {
			n.Link = *link
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func (r *Repo) UnreadCount(ctx context.Context, userID, workspaceID string) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx, `
		SELECT count(*) FROM notification
		WHERE user_id = $1 AND read_at IS NULL AND archived_at IS NULL
		  AND ($2::uuid IS NULL OR workspace_id = $2::uuid)`, userID, nilIfEmpty(workspaceID)).Scan(&n)
	return n, err
}

// nilIfEmpty maps the Go-level "no filter" empty string to a SQL NULL for the
// ($n::uuid IS NULL OR ...) idiom.
func nilIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (r *Repo) MarkRead(ctx context.Context, userID, notificationID string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE notification SET read_at = now()
		WHERE id = $2 AND user_id = $1 AND read_at IS NULL`, userID, notificationID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		return nil
	}

	var exists bool
	if err := r.pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM notification WHERE id = $2 AND user_id = $1)`,
		userID, notificationID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return app.ErrNotFound
	}
	return nil
}

func (r *Repo) MarkAllRead(ctx context.Context, userID string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE notification SET read_at = now()
		WHERE user_id = $1 AND read_at IS NULL`, userID)
	return err
}

func (r *Repo) Archive(ctx context.Context, userID, notificationID string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE notification SET archived_at = now(), read_at = COALESCE(read_at, now())
		WHERE id = $2 AND user_id = $1`, userID, notificationID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		return nil
	}
	return app.ErrNotFound
}

// DeleteAged prunes expired notifications in batches (F8-4): archived rows
// older than archivedTTL and read-but-not-archived rows older than readTTL.
// Unread rows are never deleted — they are still the user's pending signal.
// Returns the number of rows deleted (batch-capped; run to a zero return or
// on the next tick to drain a large backlog).
func (r *Repo) DeleteAged(ctx context.Context, archivedTTL, readTTL time.Duration, batch int) (int64, error) {
	tag, err := r.pool.Exec(ctx, `
		DELETE FROM notification
		WHERE id IN (
			SELECT id FROM notification
			WHERE (archived_at IS NOT NULL AND archived_at < now() - make_interval(secs => $1))
			   OR (archived_at IS NULL AND read_at IS NOT NULL AND read_at < now() - make_interval(secs => $2))
			LIMIT $3
		)`, archivedTTL.Seconds(), readTTL.Seconds(), batch)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
