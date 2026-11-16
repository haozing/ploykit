package render

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river/rivertype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/migrations"
	"github.com/haozing/ploykit/platform/events"
	"github.com/haozing/ploykit/platform/ids"
	"github.com/haozing/ploykit/platform/pgmigrate"

	videoapp "myproduct/internal/video/app"
)

// --- reconciler fakes (independent of rowStore: the reconciler has its own
// reconcileStore surface — different queries, different CAS shape) ---

type fakeReconcileStore struct {
	mu     sync.Mutex
	rows   []reconcilableRow
	failed map[string]string // id → error msg written
	closed map[string]bool   // ids already terminal (UPDATE guard)

	// hiddenFromDrift models rows that LEAVE the drift SELECT between rounds
	// (e.g. the render worker closed them a moment after the round's SELECT
	// was planned). Distinct from closed: the race test needs a row that the
	// SELECT still returns but the guarded UPDATE then rejects — that is what
	// closeExternal models (SELECT sees it, UPDATE's WHERE misses it).
	hiddenFromDrift map[string]bool
}

func (f *fakeReconcileStore) findDrifted(_ context.Context) ([]reconcilableRow, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []reconcilableRow
	for _, r := range f.rows {
		if !f.hiddenFromDrift[r.ID] {
			out = append(out, r)
		}
	}
	return out, nil
}

func (f *fakeReconcileStore) failWithReleaseClaim(_ context.Context, id, errMsg string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed[id] {
		return false, nil // mirrors the guarded UPDATE: 0 rows affected
	}
	if f.failed == nil {
		f.failed = map[string]string{}
	}
	f.failed[id] = errMsg
	if f.closed == nil {
		f.closed = map[string]bool{}
	}
	f.closed[id] = true
	return true, nil
}

// closeExternal simulates another actor (render worker / orphan sweep)
// closing a row AFTER the drift SELECT returned it but BEFORE the guarded
// UPDATE runs — the exact race window the one-shot release claim exists for.
func (f *fakeReconcileStore) closeExternal(id string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed == nil {
		f.closed = map[string]bool{}
	}
	f.closed[id] = true
}

func (f *fakeReconcileStore) failedMsg(id string) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.failed[id]
}

// reconcileQuotaRelease records ReleasePeriod calls with the target period.
type reconcileQuotaRelease struct {
	mu    sync.Mutex
	calls []string // wsID:key@period
}

func (q *reconcileQuotaRelease) Release(_ context.Context, _, _ string, _ int64, _ time.Time) error {
	return nil
}

func (q *reconcileQuotaRelease) ReleasePeriod(_ context.Context, wsID, key string, _ int64, period string) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.calls = append(q.calls, wsID+":"+key+"@"+period)
	return nil
}

func (q *reconcileQuotaRelease) recorded() []string {
	q.mu.Lock()
	defer q.mu.Unlock()
	return append([]string(nil), q.calls...)
}

// TestReconciler_CrossMonthRelease is F-QTA-01's tail: the consumption
// happened in 2026-10; by the time the reconciler runs, the wall clock has
// moved into 2026-11. The release MUST target the quota_period frozen on
// the row (2026-10), never the current month — a "release now" decrement
// would hit the wrong counter (or match zero rows silently).
func TestReconciler_CrossMonthRelease(t *testing.T) {
	store := &fakeReconcileStore{rows: []reconcilableRow{{
		ID: "r-cross", ProjectID: "p1", WorkspaceID: "ws1", Status: videoapp.RenderRunning,
		FramesTotal: 60, CreatedBy: "u1",
		QuotaPeriod:  "2026-10", // frozen at submission (round3 column)
		CreatedMonth: "2026-10",
		LastJobState: "discarded",
	}}}
	qr := &reconcileQuotaRelease{}
	rc := NewReconciler(ReconcilerDeps{
		store:        store,
		QuotaRelease: qr,
		Publish:      &fakePub{},
		Audit:        &fakeAuditor{},
		Log:          testLogger(),
	}, time.Minute)
	// The wall clock is already in the NEXT month — that is the whole point.
	rc.now = func() time.Time { return time.Date(2026, 11, 2, 9, 0, 0, 0, time.UTC) }

	n, err := rc.reconcileOnce(t.Context())
	require.NoError(t, err)
	assert.Equal(t, 1, n)

	calls := qr.recorded()
	require.Len(t, calls, 1, "exactly one release")
	assert.Equal(t, "ws1:"+videoapp.QuotaKey+"@2026-10", calls[0],
		"release must use the row-frozen quota_period, not the current month")
	assert.Equal(t, errReconciled, store.failedMsg("r-cross"))
}

// TestReconciler_StaleRunning_FailAndRelease anchors the e2e agent3 Bug-2
// zombie branch: a render row whose river job is STILL 'running' (river has
// no cross-restart cleanup for a job killed mid-flight) but whose
// updated_at went stale past StaleAfter enters the reconcile set with the
// running(stale) label, is failed with errReconciledStale and releases the
// quota on the row-frozen period — same compensation path as the terminal
// branch.
func TestReconciler_StaleRunning_FailAndRelease(t *testing.T) {
	store := &fakeReconcileStore{rows: []reconcilableRow{{
		ID: "r-stale", ProjectID: "p1", WorkspaceID: "ws1", Status: videoapp.RenderRunning,
		FramesTotal: 300, CreatedBy: "u1",
		QuotaPeriod:  "2026-10",
		CreatedMonth: "2026-10",
		LastJobState: staleRunningLabel, // the stale branch's marker, set by the SQL CASE
	}}}
	qr := &reconcileQuotaRelease{}
	pub := &fakePub{}
	aud := &fakeAuditor{}
	rc := NewReconciler(ReconcilerDeps{
		store: store, QuotaRelease: qr, Publish: pub, Audit: aud, Log: testLogger(),
	}, time.Minute)

	n, err := rc.reconcileOnce(t.Context())
	require.NoError(t, err)
	assert.Equal(t, 1, n)

	assert.Equal(t, errReconciledStale, store.failedMsg("r-stale"),
		"the stale branch carries its own error detail (distinguishable from terminal drift)")
	assert.Equal(t, []string{"ws1:" + videoapp.QuotaKey + "@2026-10"}, qr.recorded(),
		"quota released on the frozen period, same as the terminal branch")
	aud.mu.Lock()
	assert.Contains(t, aud.recorded, videoapp.AuditRenderFailed)
	aud.mu.Unlock()
	pub.mu.Lock()
	assert.Contains(t, pub.events, videoapp.EventRenderUpdated, "WS frame reuses the terminal path")
	pub.mu.Unlock()

	// A terminal-drift row keeps the original error detail — the two causes
	// stay distinguishable in the row's error column.
	terminal := &fakeReconcileStore{rows: []reconcilableRow{{
		ID: "r-term", WorkspaceID: "ws1", QuotaPeriod: "2026-10", LastJobState: "discarded",
	}}}
	rc2 := NewReconciler(ReconcilerDeps{store: terminal, QuotaRelease: qr, Log: testLogger()}, time.Minute)
	_, err = rc2.reconcileOnce(t.Context())
	require.NoError(t, err)
	assert.Equal(t, errReconciled, terminal.failedMsg("r-term"))
}

// TestReconciler_LegacyRow_FallsBackToCreatedMonth: pre-1009 rows carry no
// quota_period; the fallback is the row's creation month — still not "now".
func TestReconciler_LegacyRow_FallsBackToCreatedMonth(t *testing.T) {
	store := &fakeReconcileStore{rows: []reconcilableRow{{
		ID: "r-legacy", ProjectID: "p1", WorkspaceID: "ws1", Status: videoapp.RenderQueued,
		QuotaPeriod:  "",        // legacy row
		CreatedMonth: "2026-09", // created in September
		LastJobState: "cancelled",
	}}}
	qr := &reconcileQuotaRelease{}
	rc := NewReconciler(ReconcilerDeps{
		store: store, QuotaRelease: qr, Log: testLogger(),
	}, time.Minute)
	rc.now = func() time.Time { return time.Date(2026, 11, 2, 9, 0, 0, 0, time.UTC) }

	_, err := rc.reconcileOnce(t.Context())
	require.NoError(t, err)
	assert.Equal(t, []string{"ws1:" + videoapp.QuotaKey + "@2026-09"}, qr.recorded(),
		"legacy fallback releases on the creation month, never today")
}

// TestReconciler_LostRace_NoDoubleRelease: another actor closed the row
// between findDrifted and the guarded UPDATE — the winner owns the
// compensation, the reconciler must not release a second time (audit §4 P3).
func TestReconciler_LostRace_NoDoubleRelease(t *testing.T) {
	store := &fakeReconcileStore{rows: []reconcilableRow{{
		ID: "r-race", ProjectID: "p1", WorkspaceID: "ws1", Status: videoapp.RenderRunning,
		QuotaPeriod: "2026-10", LastJobState: "discarded",
	}}}
	qr := &reconcileQuotaRelease{}
	rc := NewReconciler(ReconcilerDeps{
		store: store, QuotaRelease: qr, Log: testLogger(),
	}, time.Minute)

	// findDrifted returns the row, but the UPDATE loses (already closed).
	store.closeExternal("r-race")
	n, err := rc.reconcileOnce(t.Context())
	require.NoError(t, err)
	assert.Equal(t, 1, n, "the row WAS drifted when the round drained it")
	assert.Empty(t, qr.recorded(), "the loser must not release quota")
	assert.Empty(t, store.failedMsg("r-race"), "the loser must not overwrite the winner")
}

// TestReconciler_WorkerLifecycle: Name/Run/ctx-cancellation contract with
// the workers.Worker shape (Run returns nil on ctx.Done, no hang, no leak).
func TestReconciler_WorkerLifecycle(t *testing.T) {
	rc := NewReconciler(ReconcilerDeps{store: &fakeReconcileStore{}, Log: testLogger()}, 50*time.Millisecond)
	assert.Equal(t, "video_render_reconciler", rc.Name())

	ctx, cancel := context.WithTimeout(t.Context(), 150*time.Millisecond)
	defer cancel()
	done := make(chan error, 1)
	start := time.Now()
	go func() { done <- rc.Run(ctx) }()
	select {
	case err := <-done:
		require.NoError(t, err)
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not exit on ctx.Done")
	}
	assert.Less(t, time.Since(start), 5*time.Second)
}

// TestReconciler_NilStoreNilPool returns ErrNoStore instead of panicking.
func TestReconciler_NilStoreNilPool(t *testing.T) {
	rc := NewReconciler(ReconcilerDeps{Log: testLogger()}, time.Minute)
	_, err := rc.reconcileOnce(t.Context())
	assert.ErrorIs(t, err, ErrNoStore)
}

// compile-time guards: the reconciler satisfies the workers.Worker shape
// (structurally here — main.go's wk.Add enforces the real interface).
type workersWorkerShape interface {
	Name() string
	Run(ctx context.Context) error
}

var (
	_ workersWorkerShape = (*Reconciler)(nil)
	_ reconcileStore     = (*fakeReconcileStore)(nil)
	_ QuotaReleasePort   = (*reconcileQuotaRelease)(nil)
)

// rivertype is imported to pin the terminal-state vocabulary the reconciler
// implements in SQL (discarded/cancelled): an upstream rename must surface
// here, not silently drift.
var _ = rivertype.JobStateDiscarded

// --- DB-gated integration (TEST_DATABASE_URL): the real JOIN + guarded
// UPDATE against migrated schema. Bootstrap mirrors service_db_test.go:
// framework migration chain + product migrations + events.Migrate (the
// river schema lives outside migrations 001-999/1001+). ---

var prodMigrationRe = regexp.MustCompile(`^(\d{3,})_[a-z0-9_]+\.up\.sql$`)

func applyProductMigrationsRecon(ctx context.Context, t *testing.T, pool *pgxpool.Pool) error {
	t.Helper()
	const dir = "../../../cmd/app/migrations"
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("read %s: %w", dir, err)
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && prodMigrationRe.MatchString(e.Name()) {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	for _, name := range names {
		version := prodMigrationRe.FindStringSubmatch(name)[1]
		var applied bool
		if err := pool.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)`, version).Scan(&applied); err != nil {
			return err
		}
		if applied {
			continue
		}
		body, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			return fmt.Errorf("read %s: %w", name, err)
		}
		script := fmt.Sprintf("BEGIN;\n%s\nINSERT INTO schema_migrations(version) VALUES ('%s');\nCOMMIT;", string(body), version)
		conn, err := pool.Acquire(ctx)
		if err != nil {
			return err
		}
		_, execErr := conn.Conn().PgConn().Exec(ctx, script).ReadAll()
		conn.Release()
		if execErr != nil {
			return fmt.Errorf("apply %s: %w", name, execErr)
		}
	}
	return nil
}

func newReconcileEnv(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	require.NoError(t, pgmigrate.Up(ctx, pool, migrations.FS, "."), "framework migration chain")
	require.NoError(t, applyProductMigrationsRecon(ctx, t, pool), "product migration chain 1001+")
	require.NoError(t, events.Migrate(ctx, pool), "river schema (events.Migrate)")
	return pool
}

// mustExec runs a setup statement and fails the test on error.
func mustExec(t *testing.T, pool *pgxpool.Pool, query string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), query, args...); err != nil {
		t.Fatalf("setup exec failed: %v", err)
	}
}

// TestReconciler_DBIntegration: insert a running render + a discarded
// river_job carrying its render_id -> run one round -> row failed +
// released_at stamped + quota released on the frozen period. A healthy
// control row (job still running) and a cross-kind control row must remain
// untouched; a second round must reconcile nothing and release nothing
// (idempotency).
func TestReconciler_DBIntegration(t *testing.T) {
	pool := newReconcileEnv(t)
	ctx := context.Background()

	uniq := time.Now().UnixNano()
	var uid, wsID, projID string
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO "user" (email, display_name) VALUES ($1, 'reconcile test') RETURNING id`,
		fmt.Sprintf("recon-%d@test.local", uniq)).Scan(&uid))
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO workspace (slug, name, created_by) VALUES ($1, $2, $3) RETURNING id`,
		fmt.Sprintf("recon-%d", uniq), "reconcile", uid).Scan(&wsID))
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO video_project (id, workspace_id, title, created_by) VALUES ($1,$2,$3,$4) RETURNING id`,
		ids.NewV7(), wsID, "reconcile proj", uid).Scan(&projID))

	// The drifted row: running render whose river job went terminal WITHOUT
	// the worker closing it — kind-pinned, args carries the render_id,
	// state discarded, finalized.
	renderID := ids.NewV7()
	mustExec(t, pool, `
		INSERT INTO video_render (id, project_id, workspace_id, status, ir_snapshot, frames_total, created_by, quota_period)
		VALUES ($1,$2,$3,'running','{}'::jsonb,60,$4,'2026-10')`,
		renderID, projID, wsID, uid)
	mustExec(t, pool, `
		INSERT INTO river_job (kind, args, state, queue, max_attempts, finalized_at)
		VALUES ('video_render', $1::jsonb, 'discarded', 'video', 2, now())`,
		fmt.Sprintf(`{"render_id":%q}`, renderID))

	// Healthy control row: the drift query must NOT match a job still running.
	healthyID := ids.NewV7()
	mustExec(t, pool, `
		INSERT INTO video_render (id, project_id, workspace_id, status, ir_snapshot, frames_total, created_by, quota_period)
		VALUES ($1,$2,$3,'running','{}'::jsonb,60,$4,'2026-10')`,
		healthyID, projID, wsID, uid)
	mustExec(t, pool, `
		INSERT INTO river_job (kind, args, state, queue, max_attempts)
		VALUES ('video_render', $1::jsonb, 'running', 'video', 2)`,
		fmt.Sprintf(`{"render_id":%q}`, healthyID))

	// Cross-kind control: a DIFFERENT queue's discarded job whose args happen
	// to carry the same render_id string must NOT match (kind='video_render'
	// pin — the cross-queue misfire guard).
	crossKindID := ids.NewV7()
	mustExec(t, pool, `
		INSERT INTO video_render (id, project_id, workspace_id, status, ir_snapshot, frames_total, created_by, quota_period)
		VALUES ($1,$2,$3,'running','{}'::jsonb,60,$4,'2026-10')`,
		crossKindID, projID, wsID, uid)
	mustExec(t, pool, `
		INSERT INTO river_job (kind, args, state, queue, max_attempts, finalized_at)
		VALUES ('some_other_kind', $1::jsonb, 'discarded', 'default', 2, now())`,
		fmt.Sprintf(`{"render_id":%q}`, crossKindID))

	qr := &reconcileQuotaRelease{}
	rc := NewReconciler(ReconcilerDeps{
		Pool: pool, QuotaRelease: qr,
		Publish: &fakePub{}, Audit: &fakeAuditor{}, Log: testLogger(),
	}, time.Minute)

	n, err := rc.reconcileOnce(ctx)
	require.NoError(t, err)
	assert.Equal(t, 1, n, "exactly the kind-matched drifted row reconciled")

	var status, errMsg string
	var releasedAt *time.Time
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT status, error, released_at FROM video_render WHERE id=$1`, renderID).
		Scan(&status, &errMsg, &releasedAt))
	assert.Equal(t, videoapp.RenderFailed, status)
	assert.Equal(t, errReconciled, errMsg)
	require.NotNil(t, releasedAt, "released_at CAS must be stamped")

	// Control rows untouched.
	var ctrlStatus string
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT status FROM video_render WHERE id=$1`, healthyID).Scan(&ctrlStatus))
	assert.Equal(t, videoapp.RenderRunning, ctrlStatus, "running-job control must stay running")
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT status FROM video_render WHERE id=$1`, crossKindID).Scan(&ctrlStatus))
	assert.Equal(t, videoapp.RenderRunning, ctrlStatus, "cross-kind control must stay running")

	assert.Equal(t,
		[]string{wsID + ":" + videoapp.QuotaKey + "@2026-10"}, qr.recorded(),
		"release on the frozen quota_period (2026-10)")

	// Idempotency: the second round reconciles nothing and releases nothing.
	callsAfterRound1 := len(qr.recorded())
	n2, err := rc.reconcileOnce(ctx)
	require.NoError(t, err)
	assert.Equal(t, 0, n2)
	assert.Len(t, qr.recorded(), callsAfterRound1, "no double release on the second round")

	// Cleanup (best effort; FK cascade handles the renders).
	_, _ = pool.Exec(ctx, `DELETE FROM river_job WHERE args->>'render_id' IN ($1,$2,$3)`, renderID, healthyID, crossKindID)
	_, _ = pool.Exec(ctx, `DELETE FROM video_render WHERE project_id=$1`, projID)
	_, _ = pool.Exec(ctx, `DELETE FROM video_project WHERE id=$1`, projID)
	_, _ = pool.Exec(ctx, `DELETE FROM workspace WHERE id=$1`, wsID)
	_, _ = pool.Exec(ctx, `DELETE FROM "user" WHERE id=$1`, uid)
}

// TestReconciler_DBIntegration_StaleRunning anchors the e2e agent3 Bug-2
// zombie signature against the real JOIN: a running render row with a STALE
// updated_at (2h without progress) and a river_job STILL in 'running' (river
// never cleaned it across the process kill) is reconciled — failed with
// errReconciledStale, released_at stamped, quota released on the frozen
// period — while a running row with FRESH updated_at (a healthy render mid-
// flight) is left untouched.
func TestReconciler_DBIntegration_StaleRunning(t *testing.T) {
	pool := newReconcileEnv(t)
	ctx := context.Background()

	uniq := time.Now().UnixNano()
	var uid, wsID, projID string
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO "user" (email, display_name) VALUES ($1, 'reconcile stale test') RETURNING id`,
		fmt.Sprintf("recon-stale-%d@test.local", uniq)).Scan(&uid))
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO workspace (slug, name, created_by) VALUES ($1, $2, $3) RETURNING id`,
		fmt.Sprintf("recon-stale-%d", uniq), "reconcile-stale", uid).Scan(&wsID))
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO video_project (id, workspace_id, title, created_by) VALUES ($1,$2,$3,$4) RETURNING id`,
		ids.NewV7(), wsID, "reconcile stale proj", uid).Scan(&projID))

	// The zombie: running render, no progress update for 2h (> StaleAfter),
	// river job still 'running' — the hard-kill signature.
	zombieID := ids.NewV7()
	mustExec(t, pool, `
		INSERT INTO video_render (id, project_id, workspace_id, status, ir_snapshot, frames_total, created_by, quota_period, updated_at)
		VALUES ($1,$2,$3,'running','{}'::jsonb,300,$4,'2026-10', now() - interval '2 hours')`,
		zombieID, projID, wsID, uid)
	mustExec(t, pool, `
		INSERT INTO river_job (kind, args, state, queue, max_attempts)
		VALUES ('video_render', $1::jsonb, 'running', 'video', 2)`,
		fmt.Sprintf(`{"render_id":%q}`, zombieID))

	// Healthy control: running row with fresh updated_at + running job must
	// NOT match the stale branch (progress updates keep updated_at fresh).
	healthyID := ids.NewV7()
	mustExec(t, pool, `
		INSERT INTO video_render (id, project_id, workspace_id, status, ir_snapshot, frames_total, created_by, quota_period)
		VALUES ($1,$2,$3,'running','{}'::jsonb,300,$4,'2026-10')`,
		healthyID, projID, wsID, uid)
	mustExec(t, pool, `
		INSERT INTO river_job (kind, args, state, queue, max_attempts)
		VALUES ('video_render', $1::jsonb, 'running', 'video', 2)`,
		fmt.Sprintf(`{"render_id":%q}`, healthyID))

	qr := &reconcileQuotaRelease{}
	rc := NewReconciler(ReconcilerDeps{
		Pool: pool, QuotaRelease: qr,
		Publish: &fakePub{}, Audit: &fakeAuditor{}, Log: testLogger(),
	}, time.Minute)

	n, err := rc.reconcileOnce(ctx)
	require.NoError(t, err)
	assert.Equal(t, 1, n, "exactly the stale-running zombie reconciled")

	var status, errMsg string
	var releasedAt *time.Time
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT status, error, released_at FROM video_render WHERE id=$1`, zombieID).
		Scan(&status, &errMsg, &releasedAt))
	assert.Equal(t, videoapp.RenderFailed, status)
	assert.Equal(t, errReconciledStale, errMsg)
	require.NotNil(t, releasedAt, "released_at CAS must be stamped")

	var ctrlStatus string
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT status FROM video_render WHERE id=$1`, healthyID).Scan(&ctrlStatus))
	assert.Equal(t, videoapp.RenderRunning, ctrlStatus, "fresh running row must stay running")

	assert.Equal(t, []string{wsID + ":" + videoapp.QuotaKey + "@2026-10"}, qr.recorded())

	// Idempotency: the second round reconciles nothing further.
	n2, err := rc.reconcileOnce(ctx)
	require.NoError(t, err)
	assert.Equal(t, 0, n2, "the failed zombie left the drift surface")
	assert.Empty(t, qr.recorded()[1:], "no double release")

	_, _ = pool.Exec(ctx, `DELETE FROM river_job WHERE args->>'render_id' IN ($1,$2)`, zombieID, healthyID)
	_, _ = pool.Exec(ctx, `DELETE FROM video_render WHERE project_id=$1`, projID)
	_, _ = pool.Exec(ctx, `DELETE FROM video_project WHERE id=$1`, projID)
	_, _ = pool.Exec(ctx, `DELETE FROM workspace WHERE id=$1`, wsID)
	_, _ = pool.Exec(ctx, `DELETE FROM "user" WHERE id=$1`, uid)
}
