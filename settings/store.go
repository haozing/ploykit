package settings

import (
	"context"
	"errors"
	"log/slog"
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

// SetMany writes multiple keys in ONE transaction (billing fix #11,
// 2026-10-24): the admin channel-fields save submits a whole card and used to
// loop Set() per key — a mid-loop failure left a half-saved channel for the
// hot-reload registry to pick up. Sealing of sensitive keys happens up front
// so a rejected seal never opens (or partially commits) the transaction. An
// empty map is a no-op.
func (s *Store) SetMany(ctx context.Context, kv map[string]string, actor string) error {
	if len(kv) == 0 {
		return nil
	}
	sealed := make(map[string]string, len(kv))
	for k, v := range kv {
		sv, err := s.sealValue(k, v)
		if err != nil {
			return err
		}
		sealed[k] = sv
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	for k, v := range sealed {
		if _, err := tx.Exec(ctx, `
			INSERT INTO site_settings (key, value, updated_at, updated_by)
			VALUES ($1, $2, now(), $3)
			ON CONFLICT (key) DO UPDATE
			SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
			k, v, actor); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
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
// SMTPConfig). Rows outside the prefix and malformed keys are skipped. A row
// that fails to unseal is SKIPPED with a warn log naming the key — the read
// still returns a partial map and nil error (billing fix #5, 2026-10-24):
// one poisoned row (legacy plaintext, rotated seal key) used to error the
// whole read and take EVERY channel down with it; now it only leaves that one
// channel unconfigured until the credential is re-saved. The sealx fail-closed
// discipline is unchanged for the row itself: the unreadable value is never
// returned, never fallen back to plaintext — skipping is a refusal, not a
// degradation. A channel with no rows is absent from the map. This is the
// source the hot-reload channel registry polls.
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
				slog.Default().Warn("settings: skip unreadable billing channel credential row (channel stays unconfigured until re-saved)",
					"key", k, "err", err)
				continue
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
