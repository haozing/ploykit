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
		INSERT INTO notification (user_id, type, title, body, link, dedup_key, once_per_month, created_at)
		VALUES ($1, $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''), $7, $8)`,
		n.UserID, n.Type, n.Title, n.Body, n.Link, n.DedupKey, n.OncePerMonth, now)
	if err != nil {

		if pg.IsUniqueViolation(err, "uq_notification_dedup") ||
			pg.IsUniqueViolation(err, "uq_notification_month") {
			return false, nil
		}
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func (r *Repo) ListInbox(ctx context.Context, userID string, limit int) ([]app.Notification, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, type, title, body, link, count, read_at, created_at
		FROM notification
		WHERE user_id = $1 AND archived_at IS NULL
		ORDER BY (read_at IS NULL) DESC, created_at DESC
		LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []app.Notification{}
	for rows.Next() {
		var n app.Notification
		var link *string
		if err := rows.Scan(&n.ID, &n.Type, &n.Title, &n.Body, &link, &n.Count, &n.ReadAt, &n.CreatedAt); err != nil {
			return nil, err
		}
		if link != nil {
			n.Link = *link
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func (r *Repo) UnreadCount(ctx context.Context, userID string) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx, `
		SELECT count(*) FROM notification
		WHERE user_id = $1 AND read_at IS NULL AND archived_at IS NULL`, userID).Scan(&n)
	return n, err
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
