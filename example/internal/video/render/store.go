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

func (s pgStore) update(ctx context.Context, id string, status, errMsg string, framesDone int, outputKey string) error {
	tag, err := s.w.deps.Pool.Exec(ctx, `
		UPDATE video_render SET status=$2, error=$3, frames_done=$4, output_key=$5,
		  updated_at=now(),
		  finished_at = CASE WHEN $2 IN ('succeeded','failed') THEN now() ELSE finished_at END
		WHERE id=$1
		  AND status IN ('queued','running','interrupted')`, id, status, errMsg, framesDone, outputKey)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		// The row is already terminal — a stale river attempt re-entered a
		// finished render, or a concurrent attempt closed it. Overwriting a
		// terminal state would resurrect finished renders (at-least-once
		// delivery makes stale attempts normal; audit §4 P5). Callers treat
		// ErrTerminalSkip as a no-op skip, not a failure.
		return ErrTerminalSkip
	}
	return nil
}

func (s pgStore) releaseQuota(ctx context.Context, wsID, renderID string) {
	// Quota release lives behind the app service in v1 wiring; the worker
	// calls it through the QuotaReleaser injected on WorkerDeps (nil-safe).
	if s.w.deps.QuotaRelease != nil {
		if err := s.w.deps.QuotaRelease.Release(ctx, wsID, videoappQuotaKey, 1, s.w.now()); err != nil {
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
