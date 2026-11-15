// Package render hosts the river worker driving the video render pipeline.
// The capx-dependent full pipeline (headless Chrome frame capture + ffmpeg)
// lives behind the "capx" build tag (render_pipeline.go); the default build
// compiles stub.go, whose RenderPipeline returns ErrNotConfigured, so the
// worker state machine is testable and green without Chrome/ffmpeg present.
package render

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	videoapp "myproduct/internal/video/app"
	"github.com/haozing/ploykit/platform/ids"
	"github.com/haozing/ploykit/platform/storagex"
)

// WorkerTuning mirrors §4.9.2: dedicated queue, MaxWorkers from env, orphan
// sweep window, and river MaxAttempts semantics.
const (
	QueueName        = videoapp.RenderQueue // "video" — isolated from events/schedule queues
	ProgressEveryN   = 15                   // frames between progress UPDATE + WS push
	OrphanAfter      = 10 * time.Minute     // running rows older than this at boot → failed
	// Lifecycle knobs live at client construction in main.go (river.Config):
	// JobTimeout = CAPX_RENDER_JOB_TIMEOUT (default 15min — river's 1min
	// default killed every >60s render), MaxAttempts = 2 (river's default is
	// 25), SoftStopTimeout = JobTimeout (so drain lets captures finish), and
	// RescueStuckJobsAfter = JobTimeout + 15min. Delivery audit §4 P1.
)

// ErrNotConfigured is returned by the stub pipeline when the capx tag is off
// (or Chrome/ffmpeg missing): the worker marks the render failed with it.
var ErrNotConfigured = errors.New("video render: capx pipeline not compiled in (build tag capx)")

// errSilentFail marks "already failed + audited; do not let river retry".
// Work wraps it in river.JobCancel (the non-retryable path) — a plain error
// would be retried, and every retry re-runs fail() → a second quota release
// (delivery-audit-video-studio §4 P3/P5).
var errSilentFail = errors.New("video render: failed (already audited; no retry)")

// WorkerDeps is the worker's injection surface. Everything is an interface so
// fake implementations drive the state-machine tests without a database.
type WorkerDeps struct {
	Pool         *pgxpool.Pool // nil in pure-fake mode (rows come from FetchRow)
	Store        storagex.Store
	Publish      Publisher
	Audit        Auditor
	QuotaRelease QuotaReleasePort // failed/interrupted compensation
	Log          *slog.Logger
	TmpDir       string

	// store abstracts the SQL layer (pgStore when Pool is wired; fake in
	// tests). Exported for tests only.
	store rowStore
}

// QuotaReleasePort is the failed/interrupted compensation surface.
type QuotaReleasePort interface {
	Release(ctx context.Context, workspaceID, key string, n int64, now time.Time) error
	// ReleasePeriod releases on the EXPLICIT consumption period (audit Â§4 P3):
	// month-boundary safe â releasing "now" would decrement the wrong counter.
	ReleasePeriod(ctx context.Context, workspaceID, key string, n int64, period string) error
}

// Publisher mirrors videoapp.Publisher (same shape, local alias so fakes
// don't import the app package twice).
type Publisher interface {
	BroadcastEvent(ctx context.Context, event string, payload []byte, eventID string) error
}

// Auditor is the worker-side audit surface (non-transactional: the render row
// is updated by the worker itself, not in the same tx).
type Auditor interface {
	Record(ctx context.Context, workspaceID *string, userID string, action, resourceType, resourceID string, meta map[string]any)
}

// pipeline is the capx-isolated step (§4.9.2 steps 3-7). The stub returns
// ErrNotConfigured; the capx build implements the real capture/encode/put.
type pipeline interface {
	Run(ctx context.Context, w *Worker, row renderRow, ir *videoapp.IR, params videoapp.RenderParams, onFrame func(frame int)) (outputKey string, err error)
}

// Worker is the river.Worker for RenderArgs on the "video" queue.
type Worker struct {
	river.WorkerDefaults[videoapp.RenderArgs]
	deps WorkerDeps
	pipe pipeline
	now  func() time.Time
}

func NewWorker(deps WorkerDeps) *Worker {
	if deps.Log == nil {
		deps.Log = slog.Default()
	}
	if deps.TmpDir == "" {
		deps.TmpDir = os.TempDir()
	}
	return &Worker{deps: deps, pipe: pickPipeline(deps), now: time.Now}
}

// SetClock overrides the time source (tests).
func (w *Worker) SetClock(now func() time.Time) { w.now = now }

func (w *Worker) Kind() string { return "video_render" }

// renderRow is the worker's view of one video_render row.
type renderRow struct {
	ID          string
	ProjectID   string
	WorkspaceID string
	Status      string
	Params      videoapp.RenderParams
	IRSnapshot  []byte
	FramesTotal int
	FramesDone  int
	OutputKey   string
	Error       string
	CreatedBy   string

	// releaseClaim is set by transition: this attempt won the one-shot
	// quota-release CAS (audit Â§4 P3) and may perform the compensation.
	releaseClaim bool
}

// Work runs the state machine (§4.9.1):
//
//	queued → running → succeeded
//	                  └→ failed (error detail)
//	                  └→ interrupted (drain/kill; river retry re-enters running)
//
// failed/interrupted always release the quota (compensation).
func (w *Worker) Work(ctx context.Context, job *river.Job[videoapp.RenderArgs]) error {
	row, ir, err := w.loadRender(ctx, job.Args.RenderID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			w.deps.Log.Info("video render: row gone", "render_id", job.Args.RenderID)
			return nil // deleted mid-queue: nothing to do
		}
		return err
	}

	// Terminal-state short-circuit (at-least-once delivery): a retry after a
	// terminal write (succeeded/failed by an earlier attempt, or failed by a
	// sweep) must not re-run the pipeline, re-put storage, re-release quota,
	// or flip the row back to running (audit §4 P5).
	switch row.Status {
	case videoapp.RenderSucceeded:
		w.deps.Log.Info("video render: already succeeded; stale attempt skipped", "render_id", row.ID)
		return nil
	case videoapp.RenderFailed:
		w.deps.Log.Info("video render: already failed; stale attempt skipped", "render_id", row.ID)
		return nil
	}

	// 1. mark running + WS push. ErrTerminalSkip from the guarded UPDATE
	// means another attempt closed the row concurrently — stop quietly.
	if err := w.transition(ctx, &row, videoapp.RenderRunning, "", 0); err != nil {
		if errors.Is(err, ErrTerminalSkip) {
			return nil
		}
		return err
	}
	w.pushState(ctx, &row, "")

	// 2. IR validation (snapshot may come from an older client): invalid IR
	// fails immediately with E_VIDEO_IR_INVALID.
	if verr := videoapp.Validate(ir); verr != nil {
		return w.fail(ctx, &row, "E_VIDEO_IR_INVALID: "+verr.Error())
	}

	total := row.FramesTotal
	if total <= 0 {
		// Single-source formula (audit Â§4 P8) â persisted rows normally
		// carry frames_total already.
		total = videoapp.DurationFrames(ir, row.Params.FPS)
	}

	onFrame := func(frame int) {
		if frame%ProgressEveryN != 0 && frame != total {
			return
		}
		if err := w.setProgress(ctx, &row, frame); err != nil {
			w.deps.Log.Warn("video render: progress update failed", "render_id", row.ID, "err", err)
		}
		w.pushState(ctx, &row, "")
	}

	// 3-7. pipeline (assets preload → projector → capx frames → subtitles →
	// mux → storage put). Context cancellation (drain) surfaces here.
	outputKey, perr := w.pipe.Run(ctx, w, row, ir, row.Params, onFrame)
	if perr != nil {
		if ctx.Err() != nil {
			// Soft-stop / job-timeout cancellation: the compensation writes
			// MUST run on a context decoupled from the cancelled job ctx —
			// pgx rejects the original ctx immediately (context.Canceled),
			// which used to leave the row stuck in running and the quota
			// still spent (delivery-audit-video-studio §4 P4).
			compCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
			defer cancel()
			if terr := w.transition(compCtx, &row, videoapp.RenderInterrupted, "interrupted: "+ctx.Err().Error(), row.FramesDone); terr != nil && !errors.Is(terr, ErrTerminalSkip) {
				w.deps.Log.Error("video render: interrupted transition failed", "render_id", row.ID, "err", terr)
			}
			if row.releaseClaim {
				w.releaseQuota(compCtx, &row)
			}
			// interrupted is its own audit action (v2.0 Â§13): drain/timeouts
			// are operationally distinct from genuine failures.
			if w.deps.Audit != nil {
				w.deps.Audit.Record(compCtx, &row.WorkspaceID, row.CreatedBy,
					videoapp.AuditRenderInterrupt, "video_render", row.ID,
					map[string]any{"project_id": row.ProjectID, "reason": ctx.Err().Error()})
			}
			w.pushState(compCtx, &row, "interrupted")
			return ctx.Err() // river retries from the deterministic snapshot
		}
		_ = w.fail(ctx, &row, perr.Error())
		// river.JobCancel = non-retryable: the row is terminal and audited;
		// a retry would re-run fail() and release quota a second time.
		return river.JobCancel(errSilentFail)
	}

	// 7. succeeded
	if err := w.transition(ctx, &row, videoapp.RenderSucceeded, "", total, outputKey); err != nil {
		return err
	}
	// 8. audit + terminal WS frame
	if w.deps.Audit != nil {
		w.deps.Audit.Record(ctx, &row.WorkspaceID, row.CreatedBy,
			videoapp.AuditRenderCompleted, "video_render", row.ID,
			map[string]any{"project_id": row.ProjectID, "output_key": outputKey, "frames_total": total})
	}
	w.pushState(ctx, &row, "")
	w.deps.Log.Info("video render completed", "render_id", row.ID, "frames", total)
	return nil
}

// fail marks the render failed, releases quota (§4.9.1 compensation: every
// terminal non-success releases), audits and pushes.
func (w *Worker) fail(ctx context.Context, row *renderRow, msg string) error {
	if err := w.transition(ctx, row, videoapp.RenderFailed, msg, row.FramesDone); err != nil {
		if errors.Is(err, ErrTerminalSkip) {
			// Already terminal: the losing attempt must NOT release quota
			// again (non-idempotent counter decrement; audit §4 P3).
			w.deps.Log.Info("video render: fail skipped, row already terminal", "render_id", row.ID)
			return nil
		}
		w.deps.Log.Error("video render: failed transition also failed", "render_id", row.ID, "err", err)
	}
	if row.releaseClaim {
		w.releaseQuota(ctx, row)
	}
	if w.deps.Audit != nil {
		w.deps.Audit.Record(ctx, &row.WorkspaceID, row.CreatedBy,
			videoapp.AuditRenderFailed, "video_render", row.ID,
			map[string]any{"project_id": row.ProjectID, "error": msg})
	}
	w.pushState(ctx, row, msg)
	return nil
}

// pushState emits the video.render.updated WS frame (§4.8).
func (w *Worker) pushState(ctx context.Context, row *renderRow, errMsg string) {
	if w.deps.Publish == nil {
		return
	}
	payload, _ := json.Marshal(map[string]any{
		"render_id": row.ID, "project_id": row.ProjectID, "status": row.Status,
		"frames_done": row.FramesDone, "frames_total": row.FramesTotal, "error": errMsg,
	})
	if err := w.deps.Publish.BroadcastEvent(ctx, videoapp.EventRenderUpdated, payload, ids.NewV7().String()); err != nil {
		w.deps.Log.Warn("video render push failed", "render_id", row.ID, "err", err)
	}
}

// SweepOrphans implements the boot cleanup (§4.9.2): running rows whose
// updated_at is older than OrphanAfter belong to a dead process; mark them
// failed. Best-effort: errors are logged, not fatal.
func (w *Worker) SweepOrphans(ctx context.Context) {
	if w.deps.Pool == nil {
		return
	}
	cutoff := w.now().Add(-OrphanAfter)
	tag, err := w.deps.Pool.Exec(ctx, `
		UPDATE video_render SET status='failed',
		  error='interrupted: process restarted', finished_at=now()
		WHERE status='running' AND updated_at < $1`, cutoff)
	if err != nil {
		w.deps.Log.Warn("video render orphan sweep failed", "err", err)
		return
	}
	if n := tag.RowsAffected(); n > 0 {
		w.deps.Log.Warn("video render orphan sweep", "reclaimed", n)
	}
}

// rowStore abstracts the SQL behind loadRender/transition/setProgress so the
// state machine tests run against fakes.
type rowStore interface {
	fetch(ctx context.Context, id string) (renderRow, []byte, error)
	update(ctx context.Context, id string, status, errMsg string, framesDone int, outputKey string) (releaseClaim bool, err error)
	releaseQuota(ctx context.Context, wsID, renderID string)
}

// loadRender fetches the row + decodes the ir_snapshot.
func (w *Worker) loadRender(ctx context.Context, id string) (renderRow, *videoapp.IR, error) {
	if w.deps.store == nil {
		if w.deps.Pool == nil {
			return renderRow{}, nil, ErrNoStore
		}
		w.deps.store = pgStore{w: w}
	}
	row, snap, err := w.deps.store.fetch(ctx, id)
	if err != nil {
		return renderRow{}, nil, err
	}
	ir := &videoapp.IR{}
	if len(snap) > 0 {
		if uerr := json.Unmarshal(snap, ir); uerr != nil {
			return renderRow{}, nil, fmt.Errorf("ir_snapshot unreadable: %w", uerr)
		}
	}
	return row, ir, nil
}

// transition persists one status move (status, error, optional output key).
func (w *Worker) transition(ctx context.Context, row *renderRow, status, errMsg string, framesDone int, outputKey ...string) error {
	if w.deps.store == nil {
		if w.deps.Pool == nil {
			return ErrNoStore
		}
		w.deps.store = pgStore{w: w}
	}
	key := ""
	if len(outputKey) > 0 {
		key = outputKey[0]
	}
	row.Status = status
	row.Error = errMsg
	if key != "" {
		row.OutputKey = key
	}
	claim, err := w.deps.store.update(ctx, row.ID, status, errMsg, framesDone, key)
	if errors.Is(err, pgx.ErrNoRows) {
		// The old pgStore mapped "0 rows affected" to pgx.ErrNoRows; keep
		// that shape distinguishable from a truly missing row at call sites.
		return ErrTerminalSkip
	}
	if err != nil {
		return err
	}
	row.releaseClaim = claim
	return nil
}

// setProgress persists the frame counter (every ProgressEveryN frames).
func (w *Worker) setProgress(ctx context.Context, row *renderRow, frame int) error {
	row.FramesDone = frame
	return w.transition(ctx, row, row.Status, "", frame)
}

// releaseQuota is the failed/interrupted compensation (§4.9.3: the spend was
// made with the render id as idempotency key; release on non-success).
func (w *Worker) releaseQuota(ctx context.Context, row *renderRow) {
	if w.deps.store != nil {
		w.deps.store.releaseQuota(ctx, row.WorkspaceID, row.ID)
		return
	}
	if w.deps.QuotaRelease != nil {
		if err := w.deps.QuotaRelease.Release(ctx, row.WorkspaceID, videoapp.QuotaKey, 1, w.now()); err != nil {
			w.deps.Log.Warn("video render quota release failed", "render_id", row.ID, "err", err)
		}
	}
}
