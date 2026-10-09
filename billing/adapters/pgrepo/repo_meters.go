package pgrepo

import (
	"context"

	"github.com/haozing/ploykit/billing/app"
)

var _ app.MeterRegistry = (*Repo)(nil)

func (r *Repo) RegisterMeter(ctx context.Context, m app.Meter) error {
	tag, err := r.pool.Exec(ctx, `
		INSERT INTO billing_meter (slug, display_name, agg_type, unit)
		VALUES ($1, $2, $3, NULLIF($4, ''))
		ON CONFLICT (slug) DO NOTHING`,
		m.Slug, m.DisplayName, m.AggType, m.Unit)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() > 0 {
		return nil
	}
	var agg string
	if err := r.pool.QueryRow(ctx,
		`SELECT agg_type FROM billing_meter WHERE slug = $1`, m.Slug).Scan(&agg); err != nil {
		return mapErr(err)
	}
	if agg != m.AggType {
		return app.ErrMeterImmutable
	}

	_, err = r.pool.Exec(ctx, `
		UPDATE billing_meter SET display_name = $2, unit = NULLIF($3, '') WHERE slug = $1`,
		m.Slug, m.DisplayName, m.Unit)
	return mapErr(err)
}

func (r *Repo) ListMeters(ctx context.Context) ([]app.Meter, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT slug, display_name, agg_type, COALESCE(unit, ''), created_at
		FROM billing_meter ORDER BY slug`)
	if err != nil {
		return nil, mapErr(err)
	}
	defer rows.Close()
	out := []app.Meter{}
	for rows.Next() {
		var m app.Meter
		if err := rows.Scan(&m.Slug, &m.DisplayName, &m.AggType, &m.Unit, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (r *Repo) GetMeter(ctx context.Context, slug string) (app.Meter, bool, error) {
	var m app.Meter
	err := r.pool.QueryRow(ctx, `
		SELECT slug, display_name, agg_type, COALESCE(unit, ''), created_at
		FROM billing_meter WHERE slug = $1`, slug).
		Scan(&m.Slug, &m.DisplayName, &m.AggType, &m.Unit, &m.CreatedAt)
	if isNoRows(err) {
		return app.Meter{}, false, nil
	}
	if err != nil {
		return app.Meter{}, false, mapErr(err)
	}
	return m, true, nil
}
