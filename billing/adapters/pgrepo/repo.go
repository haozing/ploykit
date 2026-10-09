package pgrepo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/haozing/ploykit/billing/app"
	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/platform/pg"
)

type Repo struct {
	pool *pgxpool.Pool
}

var _ app.Repo = (*Repo)(nil)

func New(pool *pgxpool.Pool) *Repo { return &Repo{pool: pool} }

func mapErr(err error) error {
	return pg.AsDuplicate(err, app.ErrDuplicate)
}

func isNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

const orderCols = `id, workspace_id, user_id, plan_code, interval, amount_cents, currency,
	channel, status, channel_ref, paid_at, canceled_at, refunded_at, created_at, metadata`

func scanOrder(row pgx.Row) (domain.Order, error) {
	var o domain.Order
	var channelRef *string
	var metaRaw []byte
	err := row.Scan(&o.ID, &o.WorkspaceID, &o.UserID, &o.PlanCode, &o.Interval,
		&o.AmountCents, &o.Currency, &o.Channel, &o.Status, &channelRef,
		&o.PaidAt, &o.CanceledAt, &o.RefundedAt, &o.CreatedAt, &metaRaw)
	if channelRef != nil {
		o.ChannelRef = *channelRef
	}
	if err == nil && len(metaRaw) > 0 {
		_ = json.Unmarshal(metaRaw, &o.Metadata)
	}
	return o, err
}

func (r *Repo) CreateOrder(ctx context.Context, o domain.Order) (domain.Order, error) {
	created, err := scanOrder(r.pool.QueryRow(ctx, `
		INSERT INTO "order" (workspace_id, user_id, plan_code, interval, amount_cents, currency, channel, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING `+orderCols,
		o.WorkspaceID, o.UserID, o.PlanCode, o.Interval, o.AmountCents, o.Currency, o.Channel, o.Status))
	return created, mapErr(err)
}

func (r *Repo) GetOrder(ctx context.Context, id string) (domain.Order, bool, error) {
	o, err := scanOrder(r.pool.QueryRow(ctx, `SELECT `+orderCols+` FROM "order" WHERE id = $1`, id))
	if isNoRows(err) {
		return domain.Order{}, false, nil
	}
	if err != nil {
		return domain.Order{}, false, mapErr(err)
	}
	return o, true, nil
}

func (r *Repo) ListOrdersByWorkspace(ctx context.Context, workspaceID string, limit int) ([]domain.Order, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+orderCols+` FROM "order"
		WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2`, workspaceID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Order{}
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func (r *Repo) UpdateOrderStatus(ctx context.Context, id string, from, to domain.OrderStatus, now time.Time) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE "order" SET status = $3, updated_at = $4,
			paid_at = CASE WHEN $3 = 'paid' THEN $4 ELSE paid_at END,
			canceled_at = CASE WHEN $3 = 'canceled' THEN $4 ELSE canceled_at END,
			refunded_at = CASE WHEN $3 = 'refunded' THEN $4 ELSE refunded_at END
		WHERE id = $1 AND status = $2`,
		id, from, to, now)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrStatusConflict
	}
	return nil
}

func (r *Repo) SetOrderChannelRef(ctx context.Context, id, channelRef string) error {
	_, err := r.pool.Exec(ctx, `UPDATE "order" SET channel_ref = $2, updated_at = now() WHERE id = $1`, id, channelRef)
	return mapErr(err)
}

func (r *Repo) FailOrder(ctx context.Context, o domain.Order, e domain.PaymentEvent, emit func(pgx.Tx) error, now time.Time) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx, `
		UPDATE "order" SET status = 'failed', updated_at = $3
		WHERE id = $1 AND status = $2`,
		o.ID, domain.OrderPending, now)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrStatusConflict
	}
	if emit != nil {
		if err := emit(tx); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `
		UPDATE payment_event SET process_status = 'processed', process_error = NULL, processed_at = now()
		WHERE channel = $1 AND channel_event_id = $2`, e.Channel, e.ChannelEventID); err != nil {
		return mapErr(err)
	}
	return tx.Commit(ctx)
}

func (r *Repo) PayOrder(ctx context.Context, id string, emit func(pgx.Tx) error, now time.Time) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx, `
		UPDATE "order" SET status = 'paid', updated_at = $3, paid_at = $3
		WHERE id = $1 AND status = $2`,
		id, domain.OrderPending, now)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrStatusConflict
	}
	if emit != nil {
		if err := emit(tx); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (r *Repo) FindOrderByChannelRef(ctx context.Context, channel, channelRef string) (domain.Order, bool, error) {
	o, err := scanOrder(r.pool.QueryRow(ctx, `
		SELECT `+orderCols+` FROM "order" WHERE channel = $1 AND channel_ref = $2`, channel, channelRef))
	if isNoRows(err) {
		return domain.Order{}, false, nil
	}
	if err != nil {
		return domain.Order{}, false, mapErr(err)
	}
	return o, true, nil
}

func (r *Repo) SetOrderPaymentIntentRef(ctx context.Context, orderID, paymentIntentRef string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE "order"
		SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{payment_intent}', to_jsonb($2::text), true),
		    updated_at = now()
		WHERE id = $1`, orderID, paymentIntentRef)
	return mapErr(err)
}

func (r *Repo) FindOrderByPaymentIntent(ctx context.Context, paymentIntentRef string) (domain.Order, bool, error) {
	o, err := scanOrder(r.pool.QueryRow(ctx, `
		SELECT `+orderCols+` FROM "order"
		WHERE metadata->>'payment_intent' = $1
		ORDER BY created_at DESC
		LIMIT 1`, paymentIntentRef))
	if isNoRows(err) {
		return domain.Order{}, false, nil
	}
	if err != nil {
		return domain.Order{}, false, mapErr(err)
	}
	return o, true, nil
}

func (r *Repo) InsertPaymentEvent(ctx context.Context, e domain.PaymentEvent) (bool, error) {

	tag, err := r.pool.Exec(ctx, `
		INSERT INTO payment_event (channel, channel_event_id, event_type, order_id, payload)
		VALUES ($1, $2, $3, NULLIF($4, '')::uuid, COALESCE($5, '{}'::jsonb))
		ON CONFLICT (channel, channel_event_id)
		DO UPDATE SET process_status = 'received', process_error = NULL, processed_at = NULL
		WHERE payment_event.process_status = 'error'`,
		e.Channel, e.ChannelEventID, e.Type, e.OrderID, e.Payload)
	if err != nil {
		return false, mapErr(err)
	}
	return tag.RowsAffected() > 0, nil
}

func (r *Repo) MarkEventProcessed(ctx context.Context, channel, channelEventID string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE payment_event SET process_status = 'processed', process_error = NULL, processed_at = now()
		WHERE channel = $1 AND channel_event_id = $2`, channel, channelEventID)
	return mapErr(err)
}

func (r *Repo) MarkEventError(ctx context.Context, channel, channelEventID, processErr string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE payment_event SET process_status = 'error', process_error = $3, processed_at = NULL
		WHERE channel = $1 AND channel_event_id = $2`, channel, channelEventID, processErr)
	return mapErr(err)
}

func (r *Repo) ListPlans(ctx context.Context) ([]domain.Plan, error) {
	rows, err := r.pool.Query(ctx, `SELECT code, name, limits, sort_no, currency FROM plan ORDER BY sort_no`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Plan{}
	for rows.Next() {
		var p domain.Plan
		var limitsRaw []byte
		if err := rows.Scan(&p.Code, &p.Name, &limitsRaw, &p.SortNo, &p.Currency); err != nil {
			return nil, err
		}
		p.Limits = make(map[string]int)
		if err := json.Unmarshal(limitsRaw, &p.Limits); err != nil {

			var raw map[string]json.Number
			if json.Unmarshal(limitsRaw, &raw) == nil {
				for k, v := range raw {
					if n, err := v.Int64(); err == nil {
						p.Limits[k] = int(n)
					}
				}
			}
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *Repo) GetPlan(ctx context.Context, code string) (domain.Plan, bool, error) {
	var p domain.Plan
	var limitsRaw []byte
	err := r.pool.QueryRow(ctx, `SELECT code, name, limits, sort_no, currency FROM plan WHERE code = $1`, code).
		Scan(&p.Code, &p.Name, &limitsRaw, &p.SortNo, &p.Currency)
	if isNoRows(err) {
		return domain.Plan{}, false, nil
	}
	if err != nil {
		return domain.Plan{}, false, mapErr(err)
	}
	p.Limits = make(map[string]int)
	_ = json.Unmarshal(limitsRaw, &p.Limits)
	return p, true, nil
}

func (r *Repo) ChangeWorkspacePlan(ctx context.Context, workspaceID, toPlan, actor, reason string, now time.Time, inTx func(pgx.Tx, string) error) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var from string
	if err := tx.QueryRow(ctx, `SELECT plan_code FROM workspace WHERE id = $1 FOR UPDATE`, workspaceID).Scan(&from); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE workspace SET plan_code = $2, updated_at = $3 WHERE id = $1`,
		workspaceID, toPlan, now); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO subscription_event (workspace_id, from_plan, to_plan, reason, actor)
		VALUES ($1, $2, $3, $4, $5)`, workspaceID, from, toPlan, reason, actor); err != nil {
		return err
	}
	if inTx != nil {
		if err := inTx(tx, from); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (r *Repo) GetWorkspacePlan(ctx context.Context, workspaceID string) (string, error) {
	var plan string
	err := r.pool.QueryRow(ctx, `SELECT plan_code FROM workspace WHERE id = $1`, workspaceID).Scan(&plan)
	if isNoRows(err) {
		return "free", nil
	}
	if err != nil {

		return "", mapErr(err)
	}
	return plan, nil
}

func (r *Repo) SetWorkspaceSubscription(ctx context.Context, workspaceID, subscriptionRef string, expiresAt, now time.Time) error {
	var exp any
	if subscriptionRef != "" {
		exp = expiresAt
	}
	tag, err := r.pool.Exec(ctx, `
		UPDATE workspace
		SET subscription_ref = NULLIF($2, ''), plan_expires_at = $3, updated_at = $4
		WHERE id = $1`,
		workspaceID, subscriptionRef, exp, now)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("set workspace subscription: workspace not found: %s", workspaceID)
	}
	return nil
}

func (r *Repo) GetWorkspaceSubscription(ctx context.Context, workspaceID string) (string, bool, error) {
	var ref *string
	err := r.pool.QueryRow(ctx,
		`SELECT subscription_ref FROM workspace WHERE id = $1`, workspaceID).Scan(&ref)
	if isNoRows(err) {
		return "", false, nil
	}
	if err != nil {
		return "", false, mapErr(err)
	}
	if ref == nil {
		return "", true, nil
	}
	return *ref, true, nil
}

func (r *Repo) FindWorkspaceBySubscription(ctx context.Context, subscriptionRef string) (string, string, bool, error) {
	var wsID, planCode string
	err := r.pool.QueryRow(ctx,
		`SELECT id, plan_code FROM workspace WHERE subscription_ref = $1`, subscriptionRef).Scan(&wsID, &planCode)
	if isNoRows(err) {
		return "", "", false, nil
	}
	if err != nil {
		return "", "", false, mapErr(err)
	}
	return wsID, planCode, true, nil
}

func (r *Repo) LatestPaidOrderInterval(ctx context.Context, workspaceID string) (string, bool, error) {
	var interval string
	err := r.pool.QueryRow(ctx, `
		SELECT interval FROM "order"
		WHERE workspace_id = $1 AND status = 'paid' AND interval <> 'one_time'
		ORDER BY paid_at DESC NULLS LAST, created_at DESC
		LIMIT 1`, workspaceID).Scan(&interval)
	if isNoRows(err) {
		return "", false, nil
	}
	if err != nil {
		return "", false, mapErr(err)
	}
	return interval, true, nil
}

func (r *Repo) ExpireDueWorkspaces(ctx context.Context, now time.Time, limit int) ([]app.ExpiredWorkspace, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	rows, err := tx.Query(ctx, `
		SELECT id, plan_code FROM workspace
		WHERE plan_expires_at IS NOT NULL AND plan_expires_at <= $1
		ORDER BY plan_expires_at
		LIMIT $2
		FOR UPDATE SKIP LOCKED`, now, limit)
	if err != nil {
		return nil, err
	}
	out := []app.ExpiredWorkspace{}
	for rows.Next() {
		var e app.ExpiredWorkspace
		if err := rows.Scan(&e.WorkspaceID, &e.FromPlan); err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, e)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	for _, e := range out {

		if _, err := tx.Exec(ctx, `
			UPDATE workspace
			SET plan_code = 'free', plan_expires_at = NULL, updated_at = $2
			WHERE id = $1`, e.WorkspaceID, now); err != nil {
			return nil, err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO subscription_event (workspace_id, from_plan, to_plan, reason, actor)
			VALUES ($1, $2, 'free', 'plan_expired', 'system:expiry_worker')`,
			e.WorkspaceID, e.FromPlan); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return out, nil
}

func (r *Repo) InsertOverageOrder(ctx context.Context, o domain.Order) (domain.Order, bool, error) {
	meta := o.Metadata
	if meta == nil {
		meta = map[string]any{}
	}
	created, err := scanOrder(r.pool.QueryRow(ctx, `
		INSERT INTO "order" (workspace_id, user_id, plan_code, interval, amount_cents, currency, channel, status, metadata)
		VALUES ($1,
		        (SELECT created_by FROM workspace WHERE id = $1),
		        (SELECT plan_code FROM workspace WHERE id = $1),
		        $2, $3, $4, $5, $6, $7)
		ON CONFLICT (workspace_id, (metadata->>'overage_period'))
		  WHERE metadata->>'overage_period' IS NOT NULL
		DO NOTHING
		RETURNING `+orderCols,
		o.WorkspaceID, o.Interval, o.AmountCents, o.Currency, o.Channel, o.Status, meta))
	if isNoRows(err) {
		return domain.Order{}, false, nil
	}
	if err != nil {
		return domain.Order{}, false, mapErr(err)
	}
	return created, true, nil
}

func (r *Repo) ListMeteredWorkspaces(ctx context.Context, limit int) ([]app.MeteredWorkspace, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT w.id, w.plan_code, p.limits, w.plan_expires_at
		FROM workspace w JOIN plan p ON p.code = w.plan_code
		WHERE w.plan_code <> 'free'
		  AND EXISTS (SELECT 1 FROM jsonb_object_keys(p.limits) AS k
		              WHERE k LIKE 'metered\_%\_unit\_cents')
		ORDER BY w.created_at
		LIMIT $1`, limit)
	if err != nil {
		return nil, mapErr(err)
	}
	defer rows.Close()
	out := []app.MeteredWorkspace{}
	for rows.Next() {
		var m app.MeteredWorkspace
		var limitsRaw []byte
		if err := rows.Scan(&m.WorkspaceID, &m.PlanCode, &limitsRaw, &m.PlanExpiresAt); err != nil {
			return nil, err
		}
		m.Limits = make(map[string]int)
		if err := json.Unmarshal(limitsRaw, &m.Limits); err != nil {

			var raw map[string]json.Number
			if json.Unmarshal(limitsRaw, &raw) == nil {
				for k, v := range raw {
					if n, err := v.Int64(); err == nil {
						m.Limits[k] = int(n)
					}
				}
			}
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
