package quota

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/haozing/ploykit/platform/webx"
)

type Service struct {
	pool  *pgxpool.Pool
	hooks QuotaHooks
}

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

func (s *Service) WithHooks(h QuotaHooks) *Service {
	s.hooks = h
	return s
}

func Period(now time.Time) string { return now.UTC().Format("2006-01") }

type Limits map[string]int64

func isQuotaDimKey(k string) bool {
	if strings.HasPrefix(k, "price_") || strings.HasPrefix(k, "metered_") {
		return false
	}
	return k != "trial_days" && k != "limit_mode"
}

const (
	LimitModeSoft = "soft"
	LimitModeHard = "hard"
)

func parseLimits(raw []byte) (Limits, string, error) {
	var all map[string]json.RawMessage
	if err := json.Unmarshal(raw, &all); err != nil {
		return nil, "", err
	}
	mode := LimitModeHard
	if m, ok := all["limit_mode"]; ok {
		var s string
		if err := json.Unmarshal(m, &s); err == nil && s == LimitModeSoft {
			mode = LimitModeSoft
		}
	}
	l := make(Limits, len(all))
	for k, v := range all {
		if !isQuotaDimKey(k) {
			continue
		}
		var n int64
		if err := json.Unmarshal(v, &n); err != nil {
			return nil, "", err
		}
		l[k] = n
	}
	return l, mode, nil
}

func quotaDims(l Limits) Limits {
	out := make(Limits, len(l))
	for k, v := range l {
		if isQuotaDimKey(k) {
			out[k] = v
		}
	}
	return out
}

func (s *Service) LimitsFor(ctx context.Context, workspaceID string) (Limits, string, error) {
	l, code, _, err := planLimitsFor(ctx, s.pool, workspaceID)
	return l, code, err
}

type rowQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func planLimitsFor(ctx context.Context, q rowQuerier, workspaceID string) (Limits, string, string, error) {
	var raw []byte
	var code string
	err := q.QueryRow(ctx,
		`SELECT p.limits, p.code FROM plan p JOIN workspace w ON w.plan_code = p.code WHERE w.id = $1`,
		workspaceID).Scan(&raw, &code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Limits{}, "free", LimitModeHard, nil
		}
		return nil, "", "", err
	}
	l, mode, err := parseLimits(raw)
	if err != nil {
		return nil, "", "", err
	}
	return l, code, mode, nil
}

func (s *Service) Usage(ctx context.Context, workspaceID, key, period string) (int64, int64, error) {
	used, granted, _, err := s.usageOf(ctx, workspaceID, key, period)
	return used, granted, err
}

func (s *Service) usageOf(ctx context.Context, workspaceID, key, period string) (used, granted, reserved int64, err error) {
	err = s.pool.QueryRow(ctx,
		`SELECT COALESCE((SELECT used FROM quota_counter WHERE workspace_id=$1 AND period=$2 AND counter_key=$3), 0),
		        COALESCE((SELECT sum(amount) FROM quota_grant WHERE workspace_id=$1 AND period=$2 AND counter_key=$3), 0),
		        COALESCE((SELECT reserved FROM quota_counter WHERE workspace_id=$1 AND period=$2 AND counter_key=$3), 0)`,
		workspaceID, period, key).Scan(&used, &granted, &reserved)
	return used, granted, reserved, err
}

type Status struct {
	Key     string `json:"key"`
	Limit   int64  `json:"limit"`
	Used    int64  `json:"used"`
	Granted int64  `json:"granted"`

	Reserved int64 `json:"reserved"`

	Reservations []ReservationBrief `json:"reservations,omitempty"`
	Period       string             `json:"period"`
}

func (st Status) Exceeded() bool {
	return st.Limit >= 0 && st.Used >= st.Limit+st.Granted
}

func (s *Service) Check(ctx context.Context, workspaceID, key string, now time.Time) (Status, error) {
	limits, _, err := s.LimitsFor(ctx, workspaceID)
	if err != nil {
		return Status{}, err
	}
	period := Period(now)
	used, granted, reserved, err := s.usageOf(ctx, workspaceID, key, period)
	if err != nil {
		return Status{}, err
	}
	return Status{Key: key, Limit: limits[key], Used: used, Granted: granted, Reserved: reserved, Period: period}, nil
}

func (s *Service) Release(ctx context.Context, workspaceID, key string, n int64, now time.Time) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE quota_counter SET used = GREATEST(0, used - $4), updated_at = now()
		WHERE workspace_id = $1 AND period = $2 AND counter_key = $3`,
		workspaceID, Period(now), key, n)
	return err
}

func (s *Service) Grant(ctx context.Context, workspaceID, key, reason, refID string, amount int, now time.Time) (bool, error) {
	if strings.TrimSpace(refID) == "" {
		return false, webx.NewValidation("refID required: Grant is idempotent on (workspace,key,reason,ref)")
	}
	tag, err := s.pool.Exec(ctx, `
		INSERT INTO quota_grant (workspace_id, period, counter_key, amount, reason, ref_id)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT DO NOTHING`,
		workspaceID, Period(now), key, amount, reason, refID)
	if err != nil {
		return false, err
	}
	unlocked := tag.RowsAffected() > 0

	if unlocked && s.hooks.OnGrant != nil {
		if err := s.hooks.OnGrant(ctx, workspaceID, key, reason, refID, amount); err != nil {
			slog.Warn("quota OnGrant hook failed", "workspace", workspaceID, "key", key, "err", err)
		}
	}
	return unlocked, nil
}
