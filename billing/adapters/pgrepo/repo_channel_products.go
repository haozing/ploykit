package pgrepo

import (
	"context"

	"github.com/haozing/ploykit/billing/domain"
)

// billing_channel_products (BC-7, migration 050): the catalog mapping for
// catalog-based channels. PK (channel, plan_code, interval) is the upsert
// identity; synced_at is NULL until a registration or price sync stamps it.

const channelProductCols = `channel, plan_code, interval, channel_product_id, synced_price_cents, synced_at`

func (r *Repo) GetChannelProduct(ctx context.Context, channel, planCode string, interval domain.BillingInterval) (domain.ChannelProduct, bool, error) {
	var p domain.ChannelProduct
	err := r.pool.QueryRow(ctx, `
		SELECT `+channelProductCols+` FROM billing_channel_products
		WHERE channel = $1 AND plan_code = $2 AND interval = $3`,
		channel, planCode, string(interval)).
		Scan(&p.Channel, &p.PlanCode, &p.Interval, &p.ChannelProductID, &p.SyncedPriceCents, &p.SyncedAt)
	if isNoRows(err) {
		return domain.ChannelProduct{}, false, nil
	}
	if err != nil {
		return domain.ChannelProduct{}, false, mapErr(err)
	}
	return p, true, nil
}

func (r *Repo) UpsertChannelProduct(ctx context.Context, p domain.ChannelProduct) error {
	var syncedAt any
	if p.SyncedAt != nil {
		syncedAt = *p.SyncedAt
	}
	_, err := r.pool.Exec(ctx, `
		INSERT INTO billing_channel_products
			(channel, plan_code, interval, channel_product_id, synced_price_cents, synced_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (channel, plan_code, interval) DO UPDATE SET
			channel_product_id = EXCLUDED.channel_product_id,
			synced_price_cents = EXCLUDED.synced_price_cents,
			synced_at          = EXCLUDED.synced_at,
			updated_at         = now()`,
		p.Channel, p.PlanCode, string(p.Interval), p.ChannelProductID, p.SyncedPriceCents, syncedAt)
	return mapErr(err)
}

func (r *Repo) ListChannelProducts(ctx context.Context) ([]domain.ChannelProduct, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+channelProductCols+` FROM billing_channel_products
		ORDER BY channel, plan_code, interval`)
	if err != nil {
		return nil, mapErr(err)
	}
	defer rows.Close()
	out := []domain.ChannelProduct{}
	for rows.Next() {
		var p domain.ChannelProduct
		if err := rows.Scan(&p.Channel, &p.PlanCode, &p.Interval, &p.ChannelProductID, &p.SyncedPriceCents, &p.SyncedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
