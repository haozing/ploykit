package quota

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/haozing/ploykit/platform/webx"
)

type execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

type ConsumeOpts struct {
	IdemKey string
}

type ConsumeResult struct {
	Replay bool
}

func (s *Service) Consume(ctx context.Context, workspaceID, key string, n int64, now time.Time) error {
	_, err := s.consume(ctx, workspaceID, key, n, now, ConsumeOpts{})
	return err
}

func (s *Service) ConsumeWith(ctx context.Context, workspaceID, key string, n int64, now time.Time, opts ConsumeOpts) (ConsumeResult, error) {
	return s.consume(ctx, workspaceID, key, n, now, opts)
}

func (s *Service) consume(ctx context.Context, workspaceID, key string, n int64, now time.Time, opts ConsumeOpts) (ConsumeResult, error) {

	if n <= 0 {
		return ConsumeResult{}, webx.NewValidation("consume amount must be > 0")
	}
	limits, _, mode, err := planLimitsFor(ctx, s.pool, workspaceID)
	if err != nil {
		return ConsumeResult{}, err
	}
	limit := limits[key]
	if limit < 0 {
		limit = 1 << 62
	}
	period := Period(now)
	soft := mode == LimitModeSoft

	if idem := strings.TrimSpace(opts.IdemKey); idem == "" {

		applied, err := s.consumeOnce(ctx, s.pool, workspaceID, key, n, period, limit, soft)
		if err != nil {
			return ConsumeResult{}, err
		}
		if !applied {
			return ConsumeResult{}, s.exceeded(ctx, workspaceID, key)
		}
		s.nearLimit(ctx, workspaceID, key, now)
		return ConsumeResult{}, nil
	} else {
		return s.consumeIdem(ctx, workspaceID, key, n, period, limit, soft, idem, now)
	}
}

func (s *Service) consumeIdem(ctx context.Context, workspaceID, key string, n int64, period string, limit int64, soft bool, idem string, now time.Time) (ConsumeResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ConsumeResult{}, err
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx, `
		INSERT INTO quota_consume_idem (workspace_id, counter_key, idem_key, period, amount)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT DO NOTHING`,
		workspaceID, key, idem, period, n)
	if err != nil {
		return ConsumeResult{}, err
	}
	if tag.RowsAffected() == 0 {

		return ConsumeResult{Replay: true}, nil
	}

	applied, err := s.consumeOnce(ctx, tx, workspaceID, key, n, period, limit, soft)
	if err != nil {
		return ConsumeResult{}, err
	}
	if !applied {

		if err := tx.Rollback(ctx); err != nil {
			return ConsumeResult{}, err
		}
		return ConsumeResult{}, s.exceeded(ctx, workspaceID, key)
	}
	if err := tx.Commit(ctx); err != nil {
		return ConsumeResult{}, err
	}
	s.nearLimit(ctx, workspaceID, key, now)
	return ConsumeResult{}, nil
}

func (s *Service) consumeOnce(ctx context.Context, q execer, workspaceID, key string, n int64, period string, limit int64, soft bool) (bool, error) {
	var (
		tag pgconn.CommandTag
		err error
	)
	if soft {
		tag, err = q.Exec(ctx, `
			INSERT INTO quota_counter (workspace_id, period, counter_key, used, updated_at)
			VALUES ($1, $2, $3, $4, now())
			ON CONFLICT (workspace_id, period, counter_key)
			DO UPDATE SET used = quota_counter.used + $4, updated_at = now()`,
			workspaceID, period, key, n)
	} else {

		tag, err = q.Exec(ctx, `
			INSERT INTO quota_counter (workspace_id, period, counter_key, used, updated_at)
			SELECT $1, $2, $3, $4, now()
			WHERE $4 <= $5 + COALESCE((SELECT sum(amount) FROM quota_grant g
				WHERE g.workspace_id = $1 AND g.period = $2 AND g.counter_key = $3), 0)
			ON CONFLICT (workspace_id, period, counter_key)
			DO UPDATE SET used = quota_counter.used + $4, updated_at = now()
			WHERE quota_counter.used + $4 + quota_counter.reserved
			      <= $5 + COALESCE((SELECT sum(amount) FROM quota_grant g
			                         WHERE g.workspace_id = $1 AND g.period = $2 AND g.counter_key = $3), 0)`,
			workspaceID, period, key, n, limit)
	}
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func (s *Service) exceeded(ctx context.Context, workspaceID, key string) error {
	if s.hooks.OnExhausted != nil {
		if err := s.hooks.OnExhausted(ctx, workspaceID, key); err != nil {
			slog.Warn("quota OnExhausted hook failed", "workspace", workspaceID, "key", key, "err", err)
		}
	}
	return webx.NewQuotaExceeded("quota exceeded for " + key)
}

func (s *Service) nearLimit(ctx context.Context, workspaceID, key string, now time.Time) {
	if s.hooks.OnNearLimit == nil {
		return
	}
	st, err := s.Check(ctx, workspaceID, key, now)
	if err != nil {
		slog.Warn("quota near-limit check failed", "workspace", workspaceID, "key", key, "err", err)
		return
	}

	if st.Limit > 0 && st.Used*10 >= st.Limit*8 {
		if err := s.hooks.OnNearLimit(ctx, workspaceID, key, st.Used, st.Limit); err != nil {
			slog.Warn("quota OnNearLimit hook failed", "workspace", workspaceID, "key", key, "err", err)
		}
	}
}
