package quota

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/haozing/ploykit/platform/webx"
)

// ErrIdemReplay is returned by ConsumeWithTx when the caller's idempotency
// key was already recorded (a replayed submission): no charge was made and
// the caller should treat the operation as already-done.
var ErrIdemReplay = errors.New("quota: idempotency key replayed")

// ConsumeWithTx charges n units of key inside the CALLER's transaction
// (callerCommit semantics, audit §4 P2): the charge becomes atomic with
// whatever business row the caller writes in the same tx — no crash window
// between "quota spent" and "row exists".
//
// Contract:
//   - tx must be a pgx.Tx (it satisfies execer); the caller owns Commit /
//     Rollback. A charge that fails quota returns E_QUOTA_EXCEEDED and the
//     caller rolls back — the idem insert (if any) rolls back with it, so a
//     later retry with the same key is NOT treated as a replay.
//   - With opts.IdemKey set, the key is recorded in quota_consume_idem in
//     this same tx; replay detection (RowsAffected==0) returns
//     ErrIdemReplay without touching the counter.
//   - The near-limit hook is NOT fired here (it reads via the pool and
//     would escape the tx); call (*Service).Consume after Commit if the
//     product wants that signal — the video domain does not.
//
// plan limits are read through the same tx so hard/soft mode and limit see
// a consistent snapshot with the caller's writes.
func (s *Service) ConsumeWithTx(ctx context.Context, tx pgx.Tx, workspaceID, key string, n int64, now time.Time, opts ConsumeOpts) (ConsumeResult, error) {
	if n <= 0 {
		return ConsumeResult{}, webx.NewValidation("consume amount must be > 0")
	}
	limits, _, mode, err := planLimitsFor(ctx, tx, workspaceID)
	if err != nil {
		return ConsumeResult{}, err
	}
	limit := limits[key]
	if limit < 0 {
		limit = 1 << 62
	}
	period := Period(now)
	soft := mode == LimitModeSoft

	if idem := strings.TrimSpace(opts.IdemKey); idem != "" {
		tag, err := tx.Exec(ctx, `
			INSERT INTO quota_consume_idem (workspace_id, counter_key, idem_key, period, amount)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT DO NOTHING`,
			workspaceID, key, idem, period, n)
		if err != nil {
			return ConsumeResult{}, err
		}
		if tag.RowsAffected() == 0 {
			return ConsumeResult{}, ErrIdemReplay
		}
	}
	applied, err := s.consumeOnce(ctx, tx, workspaceID, key, n, period, limit, soft)
	if err != nil {
		return ConsumeResult{}, err
	}
	if !applied {
		return ConsumeResult{}, s.exceeded(ctx, workspaceID, key)
	}
	return ConsumeResult{}, nil
}

// ReleaseTx releases n units on the EXPLICIT period inside the caller's
// transaction (audit §4 P3): the release becomes atomic with the caller's
// terminal state write (e.g. video_render → failed), and the period is the
// one fixed at consumption time — releasing "now" at a month boundary would
// decrement the wrong counter or silently match zero rows.
func (s *Service) ReleaseTx(ctx context.Context, tx pgx.Tx, workspaceID, key string, n int64, period string) error {
	_, err := tx.Exec(ctx, `
		UPDATE quota_counter SET used = GREATEST(0, used - $4), updated_at = now()
		WHERE workspace_id = $1 AND period = $2 AND counter_key = $3`,
		workspaceID, period, key, n)
	return err
}

// ReleasePeriod releases n units on the EXPLICIT period using the service
// pool (non-transactional). This is the period-fixed counterpart of Release:
// callers that cannot run inside the caller's tx (background compensation
// like the video render worker) must still target the consumption-time
// period — releasing "now" across a month boundary decrements the wrong
// counter or matches zero rows silently.
func (s *Service) ReleasePeriod(ctx context.Context, workspaceID, key string, n int64, period string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE quota_counter SET used = GREATEST(0, used - $4), updated_at = now()
		WHERE workspace_id = $1 AND period = $2 AND counter_key = $3`,
		workspaceID, period, key, n)
	return err
}
