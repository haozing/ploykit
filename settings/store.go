package settings

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/haozing/ploykit/platform/sealx"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	pool *pgxpool.Pool
	env  func(string) string
	// sealer encrypts sensitive keys (IsSensitive) at rest; nil = writes of
	// sensitive keys are rejected (fail-closed). See seal.go / WithSealer.
	sealer *sealx.Secrets
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

func (s *Store) Get(ctx context.Context, key string) (value string, found bool, err error) {
	var v string
	err = s.pool.QueryRow(ctx, `SELECT value FROM site_settings WHERE key = $1`, key).Scan(&v)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return v, true, nil
}

func (s *Store) Set(ctx context.Context, key, value, actor string) error {
	value, err := s.sealValue(key, value)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO site_settings (key, value, updated_at, updated_by)
		VALUES ($1, $2, now(), $3)
		ON CONFLICT (key) DO UPDATE
		SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
		key, value, actor)
	return err
}

func (s *Store) All(ctx context.Context) (map[string]string, error) {
	rows, err := s.pool.Query(ctx, `SELECT key, value FROM site_settings`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, rows.Err()
}

// BillingChannelFields returns every billing_channel.<name>.<field> row with
// values unsealed, grouped by channel name (BC-5 hot-read; same shape as
// SMTPConfig). Rows outside the prefix and malformed keys are skipped; a row
// that fails to unseal errors the whole read — fail-closed, no plaintext
// fallback, no partial secret leakage. A channel with no rows is absent from
// the map. This is the source the hot-reload channel registry polls.
func (s *Store) BillingChannelFields(ctx context.Context) (map[string]map[string]string, error) {
	all, err := s.All(ctx)
	if err != nil {
		return nil, err
	}
	out := map[string]map[string]string{}
	for k, v := range all {
		rest, ok := strings.CutPrefix(k, BillingChannelKeyPrefix)
		if !ok {
			continue
		}
		name, field, ok := strings.Cut(rest, ".")
		if !ok || name == "" || field == "" || strings.Contains(field, ".") {
			continue
		}
		if IsSensitive(k) {
			plain, err := s.sealer.Unseal(v) // nil-receiver safe: errors when no sealer
			if err != nil {
				return nil, fmt.Errorf("settings: read billing channel key %s: %w", k, err)
			}
			v = plain
		}
		if out[name] == nil {
			out[name] = map[string]string{}
		}
		out[name][field] = v
	}
	return out, nil
}
