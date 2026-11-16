package render

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/haozing/ploykit/platform/ids"

	videoapp "myproduct/internal/video/app"
)

// ReconcileIntervalDefault is the reconcile period; CAPX_RECONCILE_INTERVAL
// overrides it (time.ParseDuration).
const ReconcileIntervalDefault = 5 * time.Minute

// StaleAfter is the updated_at staleness threshold for the stale-running
// reconcile branch (e2e agent3 Bug-2, HIGH): a hard process kill leaves both
// the video_render row AND its river_job in 'running' forever — river has no
// cross-restart cleanup for a job that died mid-flight, so the old
// discarded/cancelled-only predicate could never match these zombies and the
// quota slot was spent permanently with no tenant self-rescue.
//
// Why 30 minutes (and not OrphanAfter's 10): the branch compares vr.updated_at
// (refreshed by the worker's progress UPDATE every ProgressEveryN frames —
// at most every few seconds for any live render), so a fresh updated_at can
// only go stale when the worker is truly dead or hung. The margin must still
// exceed every legitimate long-running window:
//   - worst legal render (case library §7.8): full L1 batch = 10800 frames;
//     measured steady-state median 103ms / p95 124ms per frame ≈ 18.5–22.3
//     min, at the measured 6.76 frames/s average ≈ 26.6 min;
//   - river's own stuck-job horizon: RescueStuckJobsAfter = JobTimeout + 15min
//     (default 15+15 = 30min) — inside 30min a live river would itself rescue
//     the job, producing a discarded state the original branch already
//     reconciles; beyond it, only a dead river explains a still-running job;
//   - per-attempt ceiling: JobTimeout (default 15min) + MaxAttempts=2 means a
//     row's continuous running stretch cannot legitimately exceed ~15min —
//     a retry between attempts goes through 'interrupted' (excluded here).
//
// Hence StaleAfter = max(OrphanAfter, 30min) = 30min: it never fires before
// river's own rescue window closes, and it cannot fail a render that is
// still making progress.
const StaleAfter = 30 * time.Minute

// staleRunningLabel marks the LastJobState of stale-running rows (the river
// job is NOT terminal here — it is stuck in 'running' past StaleAfter), so
// logs/audit can tell the two reconcile causes apart.
const staleRunningLabel = "running(stale)"

// errReconciled is the error detail stamped on rows the reconciler closes:
// the river job reached a terminal-failure state (discarded / cancelled)
// without the worker's state machine having closed the render row — e.g. the
// job was discarded after MaxAttempts while the process was down, or
// cancelled in a drain window that cut the attempt short (round4 §4 P5).
const errReconciled = "reconciled: river job terminal"

// errReconciledStale is the error detail for the stale-running branch: the
// river job itself is still 'running' (never cleaned by river after a hard
// kill) while the row has had no progress update for StaleAfter — the
// process-died-mid-render signature (agent3 Bug-2 zombie).
const errReconciledStale = "reconciled: river job stale (running without progress over the stale window)"

// reconcilableRow is one drift row found by the JOIN query.
type reconcilableRow struct {
	ID           string
	ProjectID    string
	WorkspaceID  string
	Status       string
	FramesDone   int
	FramesTotal  int
	CreatedBy    string
	QuotaPeriod  string // consumption-time period fixed at submission ('' = legacy row)
	CreatedMonth string // created_at month; legacy-row fallback period
	LastJobState string // river_job.state that triggered the reconcile
}

// Reconciler periodically reconciles river_job ↔ video_render: renders stuck
// in queued/running are failed with a quota release, audit and WS push when
// either (a) their river job has already reached a terminal-failure state
// (discarded/cancelled), or (b) the job itself is still 'running' but the row
// has had no progress update for StaleAfter — the hard-kill zombie signature
// (agent3 Bug-2: river never cleans a job that died mid-flight across a
// restart, so predicate (a) alone left those rows "running" forever with the
// quota still spent). This is round4 §4 P5 plus the e2e-verified zombie tail.
//
// It implements workers.Worker (Name + Run ticker loop) and shares the
// worker's lifecycle: env-default on, registered in main.go's wk.
type Reconciler struct {
	deps     ReconcilerDeps
	interval time.Duration
	now      func() time.Time
}

// ReconcilerDeps mirrors the worker's injection surface; Pool nil = pure-fake
// mode (tests drive reconcileOnce through the reconcileStore directly).
type ReconcilerDeps struct {
	Pool         *pgxpool.Pool
	QuotaRelease QuotaReleasePort
	Publish      Publisher
	Audit        Auditor
	Log          *slog.Logger

	// store abstracts the SQL layer (pgReconcileStore when Pool is wired;
	// fake in tests). Exported for tests only.
	store reconcileStore
}

// NewReconciler builds the reconciler. interval <= 0 falls back to
// CAPX_RECONCILE_INTERVAL (default 5 minutes).
func NewReconciler(deps ReconcilerDeps, interval time.Duration) *Reconciler {
	if deps.Log == nil {
		deps.Log = slog.Default()
	}
	if interval <= 0 {
		interval = ReconcileIntervalDefault
		if v := os.Getenv("CAPX_RECONCILE_INTERVAL"); v != "" {
			if d, err := time.ParseDuration(v); err == nil && d > 0 {
				interval = d
			}
		}
	}
	return &Reconciler{deps: deps, interval: interval, now: time.Now}
}

// Name satisfies workers.Worker.
func (r *Reconciler) Name() string { return "video_render_reconciler" }

// Run ticks until ctx is done; each tick runs one reconcile round. Errors
// are logged (the round is retried next tick), never fatal — a transient DB
// outage must not take the whole worker pool down.
func (r *Reconciler) Run(ctx context.Context) error {
	ticker := time.NewTicker(r.interval)
	defer ticker.Stop()
	r.deps.Log.Info("video render reconciler started", "interval", r.interval)
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			if _, err := r.reconcileOnce(ctx); err != nil {
				r.deps.Log.Warn("video render reconcile round failed, will retry next tick",
					"worker", r.Name(), "err", err)
			}
		}
	}
}

// reconcileOnce performs one round and returns the number of rows reconciled.
func (r *Reconciler) reconcileOnce(ctx context.Context) (int, error) {
	st := r.deps.store
	if st == nil {
		if r.deps.Pool == nil {
			return 0, ErrNoStore
		}
		st = pgReconcileStore{pool: r.deps.Pool}
	}
	rows, err := st.findDrifted(ctx)
	if err != nil {
		return 0, err
	}
	for _, row := range rows {
		r.reconcileRow(ctx, st, row)
	}
	if len(rows) > 0 {
		r.deps.Log.Info("video render reconcile round", "reconciled", len(rows))
	}
	return len(rows), nil
}

// reconcileRow closes one drifted row: guarded UPDATE to failed with the
// released_at CAS (the pgStore.update pattern), then — only when this call
// won the one-shot release claim — the period-fixed quota release, audit and
// WS frame. The error detail distinguishes the two drift causes: a terminal
// river job (discarded/cancelled) vs a stale running one (StaleAfter window).
func (r *Reconciler) reconcileRow(ctx context.Context, st reconcileStore, row reconcilableRow) {
	msg := errReconciled
	if row.LastJobState == staleRunningLabel {
		msg = errReconciledStale
	}
	claim, err := st.failWithReleaseClaim(ctx, row.ID, msg)
	if err != nil {
		r.deps.Log.Warn("video render reconcile update failed", "render_id", row.ID, "err", err)
		return
	}
	if !claim {
		// Lost the race (the render worker's state machine, the boot orphan
		// sweep or a prior round closed the row first): the winner owns the
		// compensation; releasing here would double-decrement the counter.
		return
	}
	r.release(ctx, row)
	if r.deps.Audit != nil {
		r.deps.Audit.Record(ctx, &row.WorkspaceID, row.CreatedBy,
			videoapp.AuditRenderFailed, "video_render", row.ID,
			map[string]any{
				"project_id":  row.ProjectID,
				"error":       msg,
				"river_state": row.LastJobState,
			})
	}
	if r.deps.Publish != nil {
		payload, _ := json.Marshal(map[string]any{
			"render_id": row.ID, "project_id": row.ProjectID, "status": videoapp.RenderFailed,
			"frames_done": row.FramesDone, "frames_total": row.FramesTotal, "error": msg,
		})
		if err := r.deps.Publish.BroadcastEvent(ctx, videoapp.EventRenderUpdated, payload, ids.NewV7().String()); err != nil {
			r.deps.Log.Warn("video render reconcile push failed", "render_id", row.ID, "err", err)
		}
	}
}

// release performs the compensation with the SAME period rule as the
// worker's pgStore.releaseQuota: the consumption-time quota_period fixed on
// the row at submission — never "now" (the rows this reconciler exists for
// have by definition aged across at least one reconcile interval, frequently
// across a month boundary; audit §4 P3 / F-QTA-01). Delegates to the shared
// releaseRenderQuota helper (also used by the boot orphan sweep).
func (r *Reconciler) release(ctx context.Context, row reconcilableRow) {
	releaseRenderQuota(ctx, r.deps.QuotaRelease, r.deps.Log, row.ID,
		row.WorkspaceID, row.QuotaPeriod, row.CreatedMonth)
}

// releaseRenderQuota is the period-fixed compensation shared by the
// reconciler and the boot orphan sweep (audit §4 P3 / F-QTA-01): release
// against the quota_period frozen on the row at submission; legacy rows
// (pre-1009, no quota_period) fall back to the creation month — never today.
// port nil = compensation not wired (no-op).
func releaseRenderQuota(ctx context.Context, port QuotaReleasePort, log *slog.Logger,
	renderID, wsID, quotaPeriod, createdMonth string) {
	if port == nil {
		return
	}
	period := quotaPeriod
	if period == "" {
		period = createdMonth
	}
	if err := port.ReleasePeriod(ctx, wsID, videoapp.QuotaKey, 1, period); err != nil {
		log.Warn("video render quota release failed", "render_id", renderID, "err", err)
	}
}

// reconcileStore abstracts the reconciler's SQL so tests run against fakes.
type reconcileStore interface {
	// findDrifted returns render rows still non-terminal that drifted from
	// their river job: the job reached a terminal-failure state
	// (discarded/cancelled), OR it is stuck in 'running' while the row has
	// had no progress update for StaleAfter (the hard-kill zombie;
	// kind='video_render' only — no cross-queue misfires).
	findDrifted(ctx context.Context) ([]reconcilableRow, error)
	// failWithReleaseClaim flips one row to failed under the released_at
	// CAS (pgStore.update pattern): returns (true, nil) iff this call won
	// the one-shot release claim; (false, nil) when the row was already
	// terminal (another actor closed it first).
	failWithReleaseClaim(ctx context.Context, id, errMsg string) (bool, error)
}

// pgReconcileStore is the SQL-backed reconcileStore.
type pgReconcileStore struct {
	pool *pgxpool.Pool
}

// findDrifted joins the drift surface: non-terminal renders whose video
// river job ended discarded/cancelled, OR whose job is still 'running' but
// the row's updated_at went stale past StaleAfter (hard-kill zombie — river
// has no cross-restart cleanup for a job that died mid-flight, so the
// terminal-state predicate alone never matched those rows; agent3 Bug-2).
// The JOIN key is the render_id inside the river args payload (river stores
// RenderArgs as {"render_id": "..."}), kind-pinned so events/schedule jobs
// can never match. The stale branch is parameterized with StaleAfter (secs)
// so the SQL can never drift from the constant. The LIMIT bounds one round;
// the next tick re-drains the rest.
const findDriftedSQL = `
	SELECT vr.id, vr.project_id, vr.workspace_id, vr.status, vr.frames_done, vr.frames_total,
	       vr.created_by, vr.quota_period, to_char(vr.created_at, 'YYYY-MM'),
	       CASE WHEN rj.state = 'running' THEN $2 ELSE rj.state::text END
	FROM video_render vr
	JOIN river_job rj
	  ON rj.kind = 'video_render'
	 AND rj.args->>'render_id' = vr.id::text
	 AND (rj.state IN ('discarded','cancelled')
	      OR (rj.state = 'running' AND vr.updated_at < now() - make_interval(secs => $1)))
	WHERE vr.status IN ('queued','running')
	ORDER BY vr.created_at
	LIMIT 500`

func (s pgReconcileStore) findDrifted(ctx context.Context) ([]reconcilableRow, error) {
	rows, err := s.pool.Query(ctx, findDriftedSQL,
		int32(StaleAfter/time.Second), staleRunningLabel)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []reconcilableRow
	for rows.Next() {
		var r reconcilableRow
		if err := rows.Scan(&r.ID, &r.ProjectID, &r.WorkspaceID, &r.Status, &r.FramesDone,
			&r.FramesTotal, &r.CreatedBy, &r.QuotaPeriod, &r.CreatedMonth, &r.LastJobState); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// failWithReleaseClaim closes the row in ONE guarded statement (the same
// CAS contract as pgStore.update): the WHERE clause rejects already-terminal
// rows (a stale actor must not resurrect a finished render, audit §4 P5) and
// released_at is stamped only when still NULL — the winner, and only the
// winner, may release quota. A unique-ish race resolves to (false, nil).
func (s pgReconcileStore) failWithReleaseClaim(ctx context.Context, id, errMsg string) (bool, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE video_render SET status='failed', error=$2,
		  finished_at=now(), updated_at=now(),
		  released_at = CASE WHEN released_at IS NULL THEN now() ELSE released_at END
		WHERE id=$1 AND status IN ('queued','running','interrupted')`, id, errMsg)
	if err != nil {
		return false, err
	}
	if tag.RowsAffected() == 0 {
		return false, nil // already terminal: someone else closed it
	}
	return true, nil
}
