package render

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// pgStore is the SQL-backed rowStore (used when Pool is wired).
type pgStore struct {
	w *Worker
}

func (s pgStore) fetch(ctx context.Context, id string) (renderRow, []byte, error) {
	var row renderRow
	var paramsRaw []byte
	err := s.w.deps.Pool.QueryRow(ctx, `
		SELECT id, project_id, workspace_id, status, params, ir_snapshot, frames_total, output_key, error, created_by
		FROM video_render WHERE id=$1`, id).
		Scan(&row.ID, &row.ProjectID, &row.WorkspaceID, &row.Status, &paramsRaw, &row.IRSnapshot,
			&row.FramesTotal, &row.OutputKey, &row.Error, &row.CreatedBy)
	if err != nil {
		return renderRow{}, nil, err
	}
	if len(paramsRaw) > 0 {
		if uerr := jsonUnmarshal(paramsRaw, &row.Params); uerr != nil {
			return renderRow{}, nil, fmt.Errorf("params unreadable: %w", uerr)
		}
	}
	return row, row.IRSnapshot, nil
}

// update transitions the row in one guarded statement. The bool result is
// the one-shot release claim (audit §4 P3): it is true iff THIS statement is
// the one that must perform the quota compensation.
//
// The claim is decided from the PRE-update row state inside the same
// statement (CTE + FOR UPDATE). The previous version read the row back after
// the UPDATE and asked `released_at IS NULL OR status <> 'interrupted'` —
// but the interrupted transition has already stamped released_at and set
// status='interrupted', so the expression was false for exactly the case that
// needs compensation. Every drain/timeout therefore left the quota spent, and
// the boot sweep/reconciler both trusted the (wrong) invariant that
// "interrupted already released" (delivery audit P0).
//
// Rules encoded here:
//   - charging states (queued/running) never own a claim — progress writes
//     must not arm a future release;
//   - the claim is granted when the row is NOT already released and the new
//     state is a terminal non-success (failed/interrupted);
//   - a row that already released (failed-after-interrupted) is recognised by
//     released_at, so a retry can never double-release.
func (s pgStore) update(ctx context.Context, id string, status, errMsg string, framesDone int, outputKey string) (bool, error) {
	var claimed bool
	err := s.w.deps.Pool.QueryRow(ctx, `
		WITH prev AS (
			SELECT id, released_at FROM video_render
			WHERE id=$1 AND status IN ('queued','running','interrupted')
			FOR UPDATE
		), upd AS (
			UPDATE video_render vr SET status=$2, error=$3, frames_done=$4, output_key=$5,
			  updated_at=now(),
			  finished_at = CASE WHEN $2 IN ('succeeded','failed') THEN now() ELSE finished_at END,
			  released_at = CASE WHEN $2 IN ('failed','interrupted') AND vr.released_at IS NULL THEN now() ELSE vr.released_at END
			FROM prev
			WHERE vr.id = prev.id
			RETURNING (prev.released_at IS NOT NULL) AS was_released
		)
		SELECT CASE
		  WHEN $2 IN ('failed','interrupted') AND NOT was_released THEN true
		  ELSE false
		END
		FROM upd`, id, status, errMsg, framesDone, outputKey).Scan(&claimed)
	if errors.Is(err, pgx.ErrNoRows) {
		// Already terminal — a stale attempt re-entered a finished render.
		// Overwriting would resurrect finished renders (audit §4 P5).
		return false, ErrTerminalSkip
	}
	if err != nil {
		return false, err
	}
	return claimed, nil
}

// releaseQuota performs the period-fixed compensation (audit §4 P3): the
// release targets the consumption-time quota_period — releasing with
// today's period across a month boundary decrements the wrong counter or
// matches zero rows silently.
func (s pgStore) releaseQuota(ctx context.Context, wsID, renderID string) {
	var period *string
	err := s.w.deps.Pool.QueryRow(ctx,
		`SELECT quota_period FROM video_render WHERE id=$1`, renderID).
		Scan(&period)
	if err != nil {
		s.w.deps.Log.Warn("video render release period read failed", "render_id", renderID, "err", err)
		return
	}
	p := s.w.now().UTC().Format("2006-01")
	if period != nil && *period != "" {
		p = *period
	}
	if s.w.deps.QuotaRelease != nil {
		if err := s.w.deps.QuotaRelease.ReleasePeriod(ctx, wsID, videoappQuotaKey, 1, p); err != nil {
			s.w.deps.Log.Warn("video render quota release failed", "render_id", renderID, "err", err)
		}
	}
}

// ErrNoStore is returned by the nil-store fake mode when SQL is required.
var ErrNoStore = errors.New("video render: no store wired")

// ErrTerminalSkip is returned by update when the row is already in a
// terminal state — the stale attempt is a no-op (river at-least-once).
var ErrTerminalSkip = errors.New("video render: row already terminal; stale attempt skipped")

// videoappQuotaKey aliases the quota key without importing videoapp twice.
const videoappQuotaKey = quotaKeyAlias
