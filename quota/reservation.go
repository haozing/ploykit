package quota

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/haozing/ploykit/platform/ids"
	"github.com/haozing/ploykit/platform/webx"
)

const (
	CodeQuotaExhausted = "E_QUOTA_EXHAUSTED"

	CodeQuotaUnavailable = "E_QUOTA_UNAVAILABLE"
)

const (
	ReservationReserved = "reserved"
	ReservationSettled  = "settled"
	ReservationReleased = "released"
	ReservationExpired  = "expired"
)

const ReservationTTL = 24 * time.Hour

type ReserveOpts struct {
	FailOpen bool

	TTL time.Duration
}

type ReserveResult struct {
	ReservationID string

	Replay bool

	Degraded bool
}

type SettleResult struct {
	Actual int64

	Replay bool
}

type ReleaseResult struct {
	Released int64

	Remaining int64

	Replay bool
}

type Reservation struct {
	ID             string     `json:"id"`
	WorkspaceID    string     `json:"workspace_id"`
	QuotaKey       string     `json:"quota_key"`
	PeriodKey      string     `json:"period_key"`
	Amount         int64      `json:"amount"`
	SettledAmount  int64      `json:"settled_amount"`
	ReleasedAmount int64      `json:"released_amount"`
	Status         string     `json:"status"`
	ExpiresAt      time.Time  `json:"expires_at"`
	CreatedAt      time.Time  `json:"created_at"`
	SettledAt      *time.Time `json:"settled_at,omitempty"`
	ReleasedAt     *time.Time `json:"released_at,omitempty"`
}

func (r Reservation) Outstanding() int64 { return r.Amount - r.ReleasedAmount }

type ReservationBrief struct {
	ID        string    `json:"id"`
	Amount    int64     `json:"amount"`
	Status    string    `json:"status"`
	ExpiresAt time.Time `json:"expires_at"`
}

func errQuotaExhausted(key string, avail, want int64) *webx.Error {
	return webx.NewError(429, CodeQuotaExhausted,
		fmt.Sprintf("quota exhausted for %s: available %d, want %d", key, avail, want))
}

func errQuotaUnavailable() *webx.Error {
	return webx.NewError(503, CodeQuotaUnavailable, "quota store unavailable, reserve failed closed")
}

func (s *Service) Reserve(ctx context.Context, workspaceID, key string, amount int64, idemKey string, opts ReserveOpts) (ReserveResult, error) {
	if amount <= 0 {
		return ReserveResult{}, webx.NewValidation("reserve amount must be > 0")
	}
	if idemKey == "" {
		return ReserveResult{}, webx.NewValidation("reserve idempotency key required")
	}

	id, err := reservationIDByIdemKey(ctx, s.pool, workspaceID, key, idemKey)
	if err == nil {
		return ReserveResult{ReservationID: id, Replay: true}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return s.reserveFailure(workspaceID, key, opts, err)
	}

	res, err := s.reserveTx(ctx, workspaceID, key, amount, idemKey, opts)
	if err != nil {
		return s.reserveFailure(workspaceID, key, opts, err)
	}
	return res, nil
}

func (s *Service) reserveFailure(workspaceID, key string, opts ReserveOpts, err error) (ReserveResult, error) {
	var we *webx.Error
	if errors.As(err, &we) {
		return ReserveResult{}, err
	}
	if opts.FailOpen {
		slog.Warn("quota reserve fail-open: storage unavailable, admitted without reservation",
			"workspace", workspaceID, "key", key, "err", err)
		return ReserveResult{Degraded: true}, nil
	}
	return ReserveResult{}, errQuotaUnavailable()
}

func reservationIDByIdemKey(ctx context.Context, q rowQuerier, workspaceID, key, idemKey string) (string, error) {
	var id string
	err := q.QueryRow(ctx,
		`SELECT id FROM quota_reservation WHERE workspace_id=$1 AND quota_key=$2 AND idempotency_key=$3`,
		workspaceID, key, idemKey).Scan(&id)
	return id, err
}

func (s *Service) reserveTx(ctx context.Context, workspaceID, key string, amount int64, idemKey string, opts ReserveOpts) (ReserveResult, error) {
	now := time.Now().UTC()
	period := Period(now)
	ttl := opts.TTL
	if ttl <= 0 {
		ttl = ReservationTTL
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ReserveResult{}, err
	}
	defer tx.Rollback(ctx)

	var used, reserved int64
	if err := tx.QueryRow(ctx, `
		INSERT INTO quota_counter (workspace_id, period, counter_key, used, reserved, updated_at)
		VALUES ($1, $2, $3, 0, 0, now())
		ON CONFLICT (workspace_id, period, counter_key)
		DO UPDATE SET updated_at = now()
		RETURNING used, reserved`, workspaceID, period, key).Scan(&used, &reserved); err != nil {
		return ReserveResult{}, err
	}

	if id, err := reservationIDByIdemKey(ctx, tx, workspaceID, key, idemKey); err == nil {
		return ReserveResult{ReservationID: id, Replay: true}, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return ReserveResult{}, err
	}

	limits, _, _, err := planLimitsFor(ctx, tx, workspaceID)
	if err != nil {
		return ReserveResult{}, err
	}
	limit := limits[key]
	if limit < 0 {
		limit = 1 << 62
	}
	var grants int64
	if err := tx.QueryRow(ctx,
		`SELECT COALESCE(sum(amount), 0) FROM quota_grant WHERE workspace_id=$1 AND period=$2 AND counter_key=$3`,
		workspaceID, period, key).Scan(&grants); err != nil {
		return ReserveResult{}, err
	}
	if avail := limit + grants - used - reserved; avail < amount {

		if s.hooks.OnExhausted != nil {
			if herr := s.hooks.OnExhausted(ctx, workspaceID, key); herr != nil {
				slog.Warn("quota OnExhausted hook failed", "workspace", workspaceID, "key", key, "err", herr)
			}
		}
		return ReserveResult{}, errQuotaExhausted(key, avail, amount)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE quota_counter SET reserved = reserved + $4, updated_at = now()
		WHERE workspace_id=$1 AND period=$2 AND counter_key=$3`,
		workspaceID, period, key, amount); err != nil {
		return ReserveResult{}, err
	}
	id := ids.NewV7().String()
	tag, err := tx.Exec(ctx, `
		INSERT INTO quota_reservation (id, workspace_id, quota_key, period_key, amount, idempotency_key, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(secs => $7))
		ON CONFLICT (workspace_id, quota_key, idempotency_key) DO NOTHING`,
		id, workspaceID, key, period, amount, idemKey, ttl.Seconds())
	if err != nil {
		return ReserveResult{}, err
	}
	if tag.RowsAffected() == 0 {

		var existID string
		if err := tx.QueryRow(ctx,
			`SELECT id FROM quota_reservation WHERE workspace_id=$1 AND quota_key=$2 AND idempotency_key=$3`,
			workspaceID, key, idemKey).Scan(&existID); err != nil {
			return ReserveResult{}, err
		}
		return ReserveResult{ReservationID: existID, Replay: true}, nil
	}
	if err := tx.Commit(ctx); err != nil {
		return ReserveResult{}, err
	}
	return ReserveResult{ReservationID: id}, nil
}

func (s *Service) Settle(ctx context.Context, reservationID string, actual int64, idemKey string) (SettleResult, error) {
	if actual < 0 {
		return SettleResult{}, webx.NewValidation("settle actual must be >= 0")
	}
	if idemKey == "" {
		return SettleResult{}, webx.NewValidation("settle idempotency key required")
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return SettleResult{}, err
	}
	defer tx.Rollback(ctx)

	var r Reservation
	var settleKey *string
	if err := tx.QueryRow(ctx, `
		SELECT id, workspace_id, quota_key, period_key, amount, settled_amount, released_amount, status, settle_idempotency_key
		FROM quota_reservation WHERE id = $1 FOR UPDATE`, reservationID).
		Scan(&r.ID, &r.WorkspaceID, &r.QuotaKey, &r.PeriodKey, &r.Amount, &r.SettledAmount,
			&r.ReleasedAmount, &r.Status, &settleKey); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return SettleResult{}, webx.NewNotFound("reservation not found")
		}
		return SettleResult{}, err
	}

	switch r.Status {
	case ReservationSettled:
		if settleKey != nil && *settleKey == idemKey {
			return SettleResult{Actual: r.SettledAmount, Replay: true}, nil
		}
		return SettleResult{}, webx.NewConflict("reservation already settled")
	case ReservationReleased:
		return SettleResult{}, webx.NewConflict("reservation already released")
	case ReservationExpired:
		return SettleResult{}, webx.NewConflict("reservation expired, no capacity left to settle")
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO quota_counter (workspace_id, period, counter_key, used, reserved, updated_at)
		VALUES ($1, $2, $3, $4, 0, now())
		ON CONFLICT (workspace_id, period, counter_key)
		DO UPDATE SET used = quota_counter.used + $4,
		              reserved = GREATEST(0, quota_counter.reserved - $5),
		              updated_at = now()`,
		r.WorkspaceID, r.PeriodKey, r.QuotaKey, actual, r.Outstanding()); err != nil {
		return SettleResult{}, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE quota_reservation
		SET status = 'settled', settled_amount = $2, settle_idempotency_key = $3, settled_at = now()
		WHERE id = $1 AND status = 'reserved'`,
		reservationID, actual, idemKey); err != nil {
		return SettleResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return SettleResult{}, err
	}
	return SettleResult{Actual: actual}, nil
}

func (s *Service) ReleaseReservation(ctx context.Context, reservationID string, amount int64, idemKey string) (ReleaseResult, error) {
	if idemKey == "" {
		return ReleaseResult{}, webx.NewValidation("release idempotency key required")
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ReleaseResult{}, err
	}
	defer tx.Rollback(ctx)

	var r Reservation
	var releaseKeys []string
	if err := tx.QueryRow(ctx, `
		SELECT id, workspace_id, quota_key, period_key, amount, settled_amount, released_amount, status, release_idempotency_keys
		FROM quota_reservation WHERE id = $1 FOR UPDATE`, reservationID).
		Scan(&r.ID, &r.WorkspaceID, &r.QuotaKey, &r.PeriodKey, &r.Amount, &r.SettledAmount,
			&r.ReleasedAmount, &r.Status, &releaseKeys); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ReleaseResult{}, webx.NewNotFound("reservation not found")
		}
		return ReleaseResult{}, err
	}

	if slices.Contains(releaseKeys, idemKey) {
		return ReleaseResult{Remaining: r.Outstanding(), Replay: true}, nil
	}
	if r.Status != ReservationReserved {
		return ReleaseResult{}, webx.NewConflict("reservation already " + r.Status)
	}

	amt := amount
	if amt <= 0 {
		amt = r.Outstanding()
	}
	if amt > r.Outstanding() {
		amt = r.Outstanding()
	}

	if _, err := tx.Exec(ctx, `
		UPDATE quota_counter SET reserved = GREATEST(0, reserved - $4), updated_at = now()
		WHERE workspace_id=$1 AND period=$2 AND counter_key=$3`,
		r.WorkspaceID, r.PeriodKey, r.QuotaKey, amt); err != nil {
		return ReleaseResult{}, err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE quota_reservation
		SET released_amount = released_amount + $2,
		    release_idempotency_keys = array_append(release_idempotency_keys, $3),
		    status = CASE WHEN released_amount + $2 >= amount THEN 'released' ELSE status END,
		    released_at = CASE WHEN released_amount + $2 >= amount THEN now() ELSE released_at END
		WHERE id = $1 AND status = 'reserved'`,
		reservationID, amt, idemKey); err != nil {
		return ReleaseResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ReleaseResult{}, err
	}
	return ReleaseResult{Released: amt, Remaining: r.Outstanding() - amt}, nil
}

func (s *Service) ExpireDueReservations(ctx context.Context, now time.Time, limit int) ([]Reservation, error) {
	if limit <= 0 {
		limit = 100
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	rows, err := tx.Query(ctx, `
		UPDATE quota_reservation SET status = 'expired'
		WHERE id IN (SELECT id FROM quota_reservation
		             WHERE status = 'reserved' AND expires_at <= $1
		             ORDER BY expires_at, id
		             LIMIT $2
		             FOR UPDATE SKIP LOCKED)
		RETURNING id, workspace_id, quota_key, period_key, amount, settled_amount, released_amount, status, expires_at, created_at`,
		now, limit)
	if err != nil {
		return nil, err
	}
	expired, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Reservation, error) {
		var r Reservation
		err := row.Scan(&r.ID, &r.WorkspaceID, &r.QuotaKey, &r.PeriodKey, &r.Amount,
			&r.SettledAmount, &r.ReleasedAmount, &r.Status, &r.ExpiresAt, &r.CreatedAt)
		return r, err
	})
	if err != nil {
		return nil, err
	}
	if len(expired) == 0 {
		return expired, tx.Commit(ctx)
	}

	ws := make([]string, len(expired))
	periods := make([]string, len(expired))
	keys := make([]string, len(expired))
	outstanding := make([]int64, len(expired))
	for i, r := range expired {
		ws[i], periods[i], keys[i], outstanding[i] = r.WorkspaceID, r.PeriodKey, r.QuotaKey, r.Outstanding()
	}
	if _, err := tx.Exec(ctx, `
		UPDATE quota_counter c
		SET reserved = GREATEST(0, c.reserved - v.outstanding), updated_at = now()
		FROM (SELECT t.ws, t.period, t.ckey, sum(t.outstanding) AS outstanding
		      FROM unnest($1::uuid[], $2::text[], $3::text[], $4::bigint[]) AS t(ws, period, ckey, outstanding)
		      GROUP BY t.ws, t.period, t.ckey) v
		WHERE c.workspace_id = v.ws AND c.period = v.period AND c.counter_key = v.ckey`,
		ws, periods, keys, outstanding); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	for _, r := range expired {
		if s.hooks.OnReservationExpired != nil {
			if herr := s.hooks.OnReservationExpired(ctx, r.ID, r.WorkspaceID, r.QuotaKey, r.Outstanding()); herr != nil {
				slog.Warn("quota OnReservationExpired hook failed", "reservation", r.ID, "err", herr)
			}
		}
	}
	return expired, nil
}

func (s *Service) ActiveReservations(ctx context.Context, workspaceID, period string) (map[string][]ReservationBrief, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, quota_key, amount, expires_at FROM quota_reservation
		WHERE workspace_id=$1 AND period_key=$2 AND status='reserved'
		ORDER BY expires_at`, workspaceID, period)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]ReservationBrief{}
	for rows.Next() {
		var b ReservationBrief
		var key string
		if err := rows.Scan(&b.ID, &key, &b.Amount, &b.ExpiresAt); err != nil {
			return nil, err
		}
		b.Status = ReservationReserved
		out[key] = append(out[key], b)
	}
	return out, rows.Err()
}
