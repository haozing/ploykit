package pgrepo

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/haozing/ploykit/webhooks/app"
)

const adminDeliveryWhere = `WHERE (NULLIF($1, '')::uuid IS NULL OR d.workspace_id = NULLIF($1, '')::uuid)
		  AND ($2 = '' OR d.status = $2)`

const adminDeliveryCols = `d.id, COALESCE(d.subscription_id::text, ''), d.event_id, d.event_type, d.status,
		       d.attempts, COALESCE(d.last_status_code, 0), COALESCE(d.last_error, ''),
		       d.delivered_at, d.created_at,
		       d.workspace_id::text, COALESCE(s.url, '')`

func (r *Repo) ListAllDeliveries(ctx context.Context, f app.DeliveryFilter, limit, offset int) ([]app.AdminDeliveryView, int, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+adminDeliveryCols+`
		FROM webhook_delivery d
		LEFT JOIN webhook_subscription s ON s.id = d.subscription_id
		`+adminDeliveryWhere+`
		ORDER BY d.created_at DESC
		LIMIT $3 OFFSET $4`, f.WorkspaceID, f.Status, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []app.AdminDeliveryView{}
	for rows.Next() {
		v, err := scanAdminDelivery(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, v)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	var total int
	if err := r.pool.QueryRow(ctx, `
		SELECT count(*) FROM webhook_delivery d
		LEFT JOIN webhook_subscription s ON s.id = d.subscription_id
		`+adminDeliveryWhere, f.WorkspaceID, f.Status).Scan(&total); err != nil {
		return nil, 0, err
	}
	return out, total, nil
}

func scanAdminDelivery(row pgx.Row) (app.AdminDeliveryView, error) {
	var v app.AdminDeliveryView
	err := row.Scan(&v.ID, &v.SubscriptionID, &v.EventID, &v.EventType, &v.Status,
		&v.Attempts, &v.LastStatusCode, &v.LastError, &v.DeliveredAt, &v.CreatedAt,
		&v.WorkspaceID, &v.URL)
	return v, err
}

func (r *Repo) AdminRedeliver(ctx context.Context, deliveryID string) (app.AdminDeliveryView, error) {
	for i := 0; i < 2; i++ {
		v, err := scanAdminDelivery(r.pool.QueryRow(ctx, `
			WITH ins AS (
				INSERT INTO webhook_delivery (subscription_id, workspace_id, event_id, event_type, payload)
				SELECT src.subscription_id, src.workspace_id, src.event_id, src.event_type, src.payload
				FROM webhook_delivery src
				WHERE src.id = $1
				ON CONFLICT (subscription_id, event_id) WHERE status = 'pending' DO NOTHING
				RETURNING id, subscription_id, workspace_id, event_id, event_type, status,
				          attempts, last_status_code, last_error, delivered_at, created_at
			)
			SELECT ins.id, COALESCE(ins.subscription_id::text, ''), ins.event_id, ins.event_type, ins.status,
			       ins.attempts, COALESCE(ins.last_status_code, 0), COALESCE(ins.last_error, ''),
			       ins.delivered_at, ins.created_at,
			       ins.workspace_id::text, COALESCE(s.url, '')
			FROM ins LEFT JOIN webhook_subscription s ON s.id = ins.subscription_id`,
			deliveryID))
		if err == nil {
			return v, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return app.AdminDeliveryView{}, err
		}

		var subID, eventID string
		err = r.pool.QueryRow(ctx,
			`SELECT subscription_id, event_id FROM webhook_delivery WHERE id = $1`, deliveryID).
			Scan(&subID, &eventID)
		if errors.Is(err, pgx.ErrNoRows) {
			return app.AdminDeliveryView{}, app.ErrNotFound
		}
		if err != nil {
			return app.AdminDeliveryView{}, err
		}
		v, err = scanAdminDelivery(r.pool.QueryRow(ctx, `
			SELECT `+adminDeliveryCols+`
			FROM webhook_delivery d
			LEFT JOIN webhook_subscription s ON s.id = d.subscription_id
			WHERE d.subscription_id = $1 AND d.event_id = $2 AND d.status = 'pending'`,
			subID, eventID))
		if err == nil {
			return v, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return app.AdminDeliveryView{}, err
		}

	}
	return app.AdminDeliveryView{}, app.ErrNotFound
}

var _ app.AdminRepo = (*Repo)(nil)
