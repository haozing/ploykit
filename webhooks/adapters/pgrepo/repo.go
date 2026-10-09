package pgrepo

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/haozing/ploykit/webhooks/app"
)

type Repo struct {
	pool *pgxpool.Pool
}

var _ app.Repo = (*Repo)(nil)

func New(pool *pgxpool.Pool) *Repo { return &Repo{pool: pool} }

func (r *Repo) CreateSubscription(ctx context.Context, sub app.Subscription, secret string) (app.Subscription, error) {
	types, err := json.Marshal(sub.EventTypes)
	if err != nil {
		return app.Subscription{}, err
	}
	err = r.pool.QueryRow(ctx, `
		INSERT INTO webhook_subscription (workspace_id, event_types, url, secret, description, is_active)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, created_at`,
		sub.WorkspaceID, types, sub.URL, secret, sub.Description, sub.IsActive).
		Scan(&sub.ID, &sub.CreatedAt)
	return sub, err
}

func (r *Repo) ListSubscriptions(ctx context.Context, workspaceID string) ([]app.Subscription, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, workspace_id, event_types, url, description, is_active, created_at
		FROM webhook_subscription
		WHERE workspace_id = $1
		ORDER BY created_at DESC`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []app.Subscription{}
	for rows.Next() {
		var sub app.Subscription
		var types []byte
		if err := rows.Scan(&sub.ID, &sub.WorkspaceID, &types, &sub.URL, &sub.Description, &sub.IsActive, &sub.CreatedAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(types, &sub.EventTypes); err != nil {
			return nil, err
		}
		out = append(out, sub)
	}
	return out, rows.Err()
}

func (r *Repo) DeleteSubscription(ctx context.Context, workspaceID, id string) error {
	tag, err := r.pool.Exec(ctx, `
		DELETE FROM webhook_subscription WHERE id = $1 AND workspace_id = $2`, id, workspaceID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return app.ErrNotFound
	}
	return nil
}

func (r *Repo) GetSubscription(ctx context.Context, workspaceID, id string) (app.Subscription, bool, error) {
	var sub app.Subscription
	var types []byte
	err := r.pool.QueryRow(ctx, `
		SELECT id, workspace_id, event_types, url, description, is_active, created_at
		FROM webhook_subscription
		WHERE id = $2 AND workspace_id = $1`, workspaceID, id).
		Scan(&sub.ID, &sub.WorkspaceID, &types, &sub.URL, &sub.Description, &sub.IsActive, &sub.CreatedAt)
	if err == pgx.ErrNoRows {
		return app.Subscription{}, false, nil
	}
	if err != nil {
		return app.Subscription{}, false, err
	}
	if err := json.Unmarshal(types, &sub.EventTypes); err != nil {
		return app.Subscription{}, false, err
	}
	return sub, true, nil
}

func (r *Repo) SetSubscriptionActive(ctx context.Context, workspaceID, id string, active bool, now time.Time) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE webhook_subscription SET is_active = $3, updated_at = $4
		WHERE id = $2 AND workspace_id = $1`, workspaceID, id, active, now)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return app.ErrNotFound
	}
	return nil
}

func (r *Repo) RotateSecret(ctx context.Context, workspaceID, subscriptionID, newSealed string, oldExpiresAt, now time.Time) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE webhook_subscription
		SET old_secret = secret, old_secret_expires_at = $4,
		    secret = $3, updated_at = $5
		WHERE id = $2 AND workspace_id = $1`,
		workspaceID, subscriptionID, newSealed, oldExpiresAt, now)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return app.ErrNotFound
	}
	return nil
}

func (r *Repo) FirstFailureAt(ctx context.Context, subscriptionID string) (*time.Time, error) {
	var ff *time.Time
	err := r.pool.QueryRow(ctx,
		`SELECT first_failure_at FROM webhook_subscription WHERE id = $1`, subscriptionID).Scan(&ff)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, app.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return ff, nil
}

func (r *Repo) EmitForEvent(ctx context.Context, workspaceID string, event app.OutboundEvent) (int, error) {
	payload, err := json.Marshal(event.Payload)
	if err != nil {
		return 0, err
	}
	tag, err := r.pool.Exec(ctx, `
		INSERT INTO webhook_delivery (subscription_id, workspace_id, event_id, event_type, payload)
		SELECT s.id, s.workspace_id, $2, $3, $4
		FROM webhook_subscription s
		WHERE s.workspace_id = $1 AND s.is_active AND s.event_types ? $3
		ON CONFLICT (subscription_id, event_id) WHERE status = 'pending' DO NOTHING`,
		workspaceID, event.ID, event.Type, payload)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

func (r *Repo) ClaimPending(ctx context.Context, batchSize int) ([]app.PendingDelivery, error) {
	if _, err := r.pool.Exec(ctx, `
		UPDATE webhook_delivery d
		SET status = 'dead', last_error = 'orphaned: subscription deleted', last_attempt_at = now()
		WHERE d.status = 'pending' AND NOT EXISTS (
			SELECT 1 FROM webhook_subscription s WHERE s.id = d.subscription_id)`); err != nil {
		return nil, err
	}
	rows, err := r.pool.Query(ctx, `
		UPDATE webhook_delivery d
		SET attempts = d.attempts + 1, last_attempt_at = now()
		WHERE d.id IN (
			SELECT w.id FROM webhook_delivery w
			WHERE w.status = 'pending' AND w.next_attempt_at <= now()
			  AND EXISTS (
				SELECT 1 FROM webhook_subscription s
				WHERE s.id = w.subscription_id AND s.is_active
			  )
			ORDER BY w.next_attempt_at
			LIMIT $1
			FOR UPDATE SKIP LOCKED
		)
		RETURNING d.id, d.subscription_id, d.event_id, d.event_type, d.payload, d.attempts,
			(SELECT workspace_id FROM webhook_subscription s WHERE s.id = d.subscription_id),
			(SELECT url FROM webhook_subscription s WHERE s.id = d.subscription_id),
			(SELECT secret FROM webhook_subscription s WHERE s.id = d.subscription_id),
			COALESCE((SELECT s.old_secret FROM webhook_subscription s WHERE s.id = d.subscription_id), ''),
			(SELECT s.old_secret_expires_at FROM webhook_subscription s WHERE s.id = d.subscription_id)`,
		batchSize)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []app.PendingDelivery{}
	for rows.Next() {
		var p app.PendingDelivery
		if err := rows.Scan(&p.DeliveryID, &p.SubscriptionID, &p.EventID, &p.EventType,
			&p.Payload, &p.Attempts, &p.WorkspaceID, &p.URL, &p.Secret,
			&p.OldSealed, &p.OldExpiresAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *Repo) MarkDelivered(ctx context.Context, deliveryID string, statusCode int, now time.Time) error {
	if _, err := r.pool.Exec(ctx, `
		UPDATE webhook_delivery
		SET status = 'delivered', delivered_at = $2, last_status_code = $3, last_attempt_at = $2
		WHERE id = $1`, deliveryID, now, statusCode); err != nil {
		return err
	}
	_, err := r.pool.Exec(ctx, `
		UPDATE webhook_subscription s SET first_failure_at = NULL
		FROM webhook_delivery d
		WHERE d.id = $1 AND d.subscription_id = s.id AND s.first_failure_at IS NOT NULL`, deliveryID)
	return err
}

func (r *Repo) MarkRetry(ctx context.Context, deliveryID string, statusCode int, errMsg string, nextAt time.Time, dead bool) error {
	if _, err := r.pool.Exec(ctx, `
		UPDATE webhook_delivery
		SET status = CASE WHEN $5 THEN 'dead' ELSE 'pending' END,
		    next_attempt_at = $4, last_status_code = $2, last_error = $3, last_attempt_at = now()
		WHERE id = $1`, deliveryID, statusCode, errMsg, nextAt, dead); err != nil {
		return err
	}
	_, err := r.pool.Exec(ctx, `
		UPDATE webhook_subscription s SET first_failure_at = now()
		FROM webhook_delivery d
		WHERE d.id = $1 AND d.subscription_id = s.id AND s.first_failure_at IS NULL`, deliveryID)
	return err
}

func (r *Repo) ListDeliveries(ctx context.Context, workspaceID string, limit int) ([]app.Delivery, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := r.pool.Query(ctx, `
		SELECT d.id, COALESCE(d.subscription_id::text, ''), d.event_id, d.event_type, d.status,
		       d.attempts, COALESCE(d.last_status_code, 0), COALESCE(d.last_error, ''),
		       d.delivered_at, d.created_at
		FROM webhook_delivery d
		WHERE d.workspace_id = $1
		ORDER BY d.created_at DESC
		LIMIT $2`, workspaceID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []app.Delivery{}
	for rows.Next() {
		var d app.Delivery
		if err := rows.Scan(&d.ID, &d.SubscriptionID, &d.EventID, &d.EventType, &d.Status,
			&d.Attempts, &d.LastStatusCode, &d.LastError, &d.DeliveredAt, &d.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func scanDelivery(row pgx.Row) (app.Delivery, error) {
	var d app.Delivery
	err := row.Scan(&d.ID, &d.SubscriptionID, &d.EventID, &d.EventType, &d.Status,
		&d.Attempts, &d.LastStatusCode, &d.LastError, &d.DeliveredAt, &d.CreatedAt)
	return d, err
}

func (r *Repo) Redeliver(ctx context.Context, workspaceID, deliveryID string) (app.Delivery, error) {
	for i := 0; i < 2; i++ {
		d, err := scanDelivery(r.pool.QueryRow(ctx, `
			INSERT INTO webhook_delivery (subscription_id, workspace_id, event_id, event_type, payload)
			SELECT src.subscription_id, src.workspace_id, src.event_id, src.event_type, src.payload
			FROM webhook_delivery src
			JOIN webhook_subscription s ON s.id = src.subscription_id
			WHERE src.id = $1 AND s.workspace_id = $2
			ON CONFLICT (subscription_id, event_id) WHERE status = 'pending' DO NOTHING
			RETURNING id, subscription_id, event_id, event_type, status,
			          attempts, COALESCE(last_status_code, 0), COALESCE(last_error, ''),
			          delivered_at, created_at`,
			deliveryID, workspaceID))
		if err == nil {
			return d, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return app.Delivery{}, err
		}

		var subID, eventID string
		err = r.pool.QueryRow(ctx, `
			SELECT src.subscription_id, src.event_id
			FROM webhook_delivery src
			JOIN webhook_subscription s ON s.id = src.subscription_id
			WHERE src.id = $1 AND s.workspace_id = $2`,
			deliveryID, workspaceID).Scan(&subID, &eventID)
		if errors.Is(err, pgx.ErrNoRows) {
			return app.Delivery{}, app.ErrNotFound
		}
		if err != nil {
			return app.Delivery{}, err
		}
		d, err = scanDelivery(r.pool.QueryRow(ctx, `
			SELECT id, subscription_id, event_id, event_type, status,
			       attempts, COALESCE(last_status_code, 0), COALESCE(last_error, ''),
			       delivered_at, created_at
			FROM webhook_delivery
			WHERE subscription_id = $1 AND event_id = $2 AND status = 'pending'`,
			subID, eventID))
		if err == nil {
			return d, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return app.Delivery{}, err
		}

	}
	return app.Delivery{}, app.ErrNotFound
}

func (r *Repo) EnqueuePing(ctx context.Context, workspaceID, subscriptionID string) error {
	tag, err := r.pool.Exec(ctx, `
		INSERT INTO webhook_delivery (subscription_id, workspace_id, event_id, event_type, payload)
		SELECT s.id, s.workspace_id, $3, 'ping', '{"message":"webhooks.ping"}'::jsonb
		FROM webhook_subscription s
		WHERE s.id = $2 AND s.workspace_id = $1 AND s.is_active`,
		workspaceID, subscriptionID, mintEventID())
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return app.ErrNotFound
	}
	return nil
}

func mintEventID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {

		return "ping-" + strconv.FormatInt(time.Now().UnixNano(), 10)
	}
	return "ping-" + hex.EncodeToString(b)
}
