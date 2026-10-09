package pgrepo

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"

	"github.com/haozing/ploykit/billing/app"
)

func scanAdminOrder(row pgx.Row) (app.AdminOrderView, error) {
	var v app.AdminOrderView
	var channelRef *string
	var metaRaw []byte
	err := row.Scan(&v.ID, &v.WorkspaceID, &v.UserID, &v.PlanCode, &v.Interval,
		&v.AmountCents, &v.Currency, &v.Channel, &v.Status, &channelRef,
		&v.PaidAt, &v.CanceledAt, &v.RefundedAt, &v.CreatedAt, &metaRaw, &v.WorkspaceName)
	if channelRef != nil {
		v.ChannelRef = *channelRef
	}
	if err == nil && len(metaRaw) > 0 {
		_ = json.Unmarshal(metaRaw, &v.Metadata)
	}
	return v, err
}

const adminOrderWhere = `WHERE (NULLIF($1, '')::uuid IS NULL OR o.workspace_id = NULLIF($1, '')::uuid)
		  AND ($2 = '' OR o.status = $2)`

func (r *Repo) ListAllOrders(ctx context.Context, f app.AdminOrderFilter, limit, offset int) ([]app.AdminOrderView, int, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT o.id, o.workspace_id, o.user_id, o.plan_code, o.interval, o.amount_cents, o.currency,
		       o.channel, o.status, o.channel_ref, o.paid_at, o.canceled_at, o.refunded_at,
		       o.created_at, o.metadata, w.name
		FROM "order" o
		JOIN workspace w ON w.id = o.workspace_id
		`+adminOrderWhere+`
		ORDER BY o.created_at DESC
		LIMIT $3 OFFSET $4`, f.WorkspaceID, f.Status, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []app.AdminOrderView{}
	for rows.Next() {
		v, err := scanAdminOrder(rows)
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
		SELECT count(*) FROM "order" o
		`+adminOrderWhere, f.WorkspaceID, f.Status).Scan(&total); err != nil {
		return nil, 0, err
	}
	return out, total, nil
}

func (r *Repo) ListPaymentEvents(ctx context.Context, f app.PaymentEventFilter, limit, offset int) ([]app.PaymentEventView, int, error) {
	const where = `WHERE (NULLIF($1, '')::uuid IS NULL OR o.workspace_id = NULLIF($1, '')::uuid)`
	rows, err := r.pool.Query(ctx, `
		SELECT pe.id, pe.channel, pe.channel_event_id, pe.event_type,
		       COALESCE(pe.order_id::text, ''), pe.process_status, COALESCE(pe.process_error, ''),
		       pe.processed_at, pe.processed_at IS NOT NULL, pe.created_at
		FROM payment_event pe
		LEFT JOIN "order" o ON o.id = pe.order_id
		`+where+`
		ORDER BY pe.created_at DESC
		LIMIT $2 OFFSET $3`, f.WorkspaceID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []app.PaymentEventView{}
	for rows.Next() {
		var v app.PaymentEventView
		if err := rows.Scan(&v.ID, &v.Channel, &v.ChannelEventID, &v.Type, &v.OrderID,
			&v.ProcessStatus, &v.ProcessError, &v.ProcessedAt, &v.Processed, &v.CreatedAt); err != nil {
			return nil, 0, err
		}
		out = append(out, v)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	var total int
	if err := r.pool.QueryRow(ctx, `
		SELECT count(*) FROM payment_event pe
		LEFT JOIN "order" o ON o.id = pe.order_id
		`+where, f.WorkspaceID).Scan(&total); err != nil {
		return nil, 0, err
	}
	return out, total, nil
}

func (r *Repo) ListPlanCodes(ctx context.Context) ([]string, error) {
	rows, err := r.pool.Query(ctx, `SELECT code FROM plan ORDER BY sort_no`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			return nil, err
		}
		out = append(out, code)
	}
	return out, rows.Err()
}

var _ app.AdminRepo = (*Repo)(nil)
