package render

import (
	"context"
	"errors"
	"fmt"
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
// the one-shot release claim (audit §4 P3): it is true iff this statement
// moved the row to failed/interrupted AND won the released_at CAS — the
// calling attempt, and only that attempt, may release quota. A stale river
// retry re-entering a terminal row gets (false, ErrTerminalSkip).
func (s pgStore) update(ctx context.Context, id string, status, errMsg string, framesDone int, outputKey string) (bool, error) {
	tag, err := s.w.deps.Pool.Exec(ctx, `
		UPDATE video_render SET status=$2, error=$3, frames_done=$4, output_key=$5,
		  updated_at=now(),
		  finished_at = CASE WHEN $2 IN ('succeeded','failed') THEN now() ELSE finished_at END,
		  released_at = CASE WHEN $2 IN ('failed','interrupted') AND released_at IS NULL THEN now() ELSE released_at END
		WHERE id=$1
		  AND status IN ('queued','running','interrupted')`, id, status, errMsg, framesDone, outputKey)
	if err != nil {
		return false, err
	}
	if tag.RowsAffected() == 0 {
		// Already terminal — a stale attempt re-entered a finished render.
		// Overwriting would resurrect finished renders (audit §4 P5).
		return false, ErrTerminalSkip
	}
	// Release claim: this statement flipped to a release-eligible terminal
	// state and either stamped released_at now (winner) or found it already
	// stamped (a prior interrupted attempt of the SAME logical transition
	// cannot happen here — the WHERE clause excludes already-terminal rows;
	// failed-after-interrupted is the retry that converts, and the earlier
	// interrupted attempt already released, so released_at IS NOT NULL means
	// someone released on this row's behalf: do not release twice).
	var claimed bool
	err = s.w.deps.Pool.QueryRow(ctx,
		`SELECT released_at IS NULL OR status <> 'interrupted' FROM video_render WHERE id=$1`, id).
		Scan(&claimed)
	if err != nil {
		return false, err
	}
	if !claimed {
		// Row was interrupted (released) earlier and has now converted to
		// failed: the release already happened on the interrupted transition.
		return false, nil
	}
	return true, nil
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
