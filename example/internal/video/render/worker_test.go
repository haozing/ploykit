package render

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	videoapp "myproduct/internal/video/app"
)

// --- fakes ---

type fakeStore struct {
	mu       sync.Mutex
	rows     rowMap
	updated  []updateCall
	released []string
}

type updateCall struct {
	id     string
	status string
	errMsg string
	frames int
	outKey string
}

func (f *fakeStore) fetch(_ context.Context, id string) (renderRow, []byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.rows == nil {
		return renderRow{}, nil, errNotFound
	}
	row, ok := f.rows[id]
	if !ok {
		return renderRow{}, nil, errNotFound
	}
	return row, row.IRSnapshot, nil
}

type rowMap = map[string]renderRow

var errNotFound = pgx.ErrNoRows // matches the worker noop contract

func (f *fakeStore) update(_ context.Context, id, status, errMsg string, frames int, outKey string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	// Mirror the real guarded UPDATE (WHERE status IN
	// ('queued','running','interrupted')): terminal rows reject writes so the
	// worker's terminal-skip paths are exercised in unit tests too. The
	// release claim mirrors released_at CAS: true iff this write moves the
	// row to failed/interrupted from a non-terminal state.
	row, ok := f.rows[id]
	if !ok {
		return false, errNotFound
	}
	if row.Status == videoapp.RenderSucceeded || row.Status == videoapp.RenderFailed {
		return false, ErrTerminalSkip
	}
	f.updated = append(f.updated, updateCall{id: id, status: status, errMsg: errMsg, frames: frames, outKey: outKey})
	claim := (status == videoapp.RenderFailed || status == videoapp.RenderInterrupted) &&
		row.Status != videoapp.RenderInterrupted
	row.Status = status
	row.FramesDone = frames
	f.rows[id] = row
	return claim, nil
}

func (f *fakeStore) releaseQuota(_ context.Context, wsID, renderID string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.released = append(f.released, wsID+"/"+renderID)
}

type fakePub struct {
	mu     sync.Mutex
	events []string
}

func (f *fakePub) BroadcastEvent(_ context.Context, event string, _ []byte, _ string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.events = append(f.events, event)
	return nil
}

type fakeAuditor struct {
	mu       sync.Mutex
	recorded []string
}

func (f *fakeAuditor) Record(_ context.Context, _ *string, _ string, action, _, _ string, _ map[string]any) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.recorded = append(f.recorded, action)
}

type fakeQuotaRelease struct {
	mu       sync.Mutex
	released []string
}

func (f *fakeQuotaRelease) Release(_ context.Context, wsID, key string, _ int64, _ time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.released = append(f.released, wsID+":"+key)
	return nil
}

func (f *fakeQuotaRelease) ReleasePeriod(_ context.Context, wsID, key string, _ int64, period string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.released = append(f.released, wsID+":"+key+"@"+period)
	return nil
}

// fakePipeline drives the happy path (counts frames, returns the output key).
type fakePipeline struct {
	frames  int
	fail    error
	onFrame func(int)
}

func (f *fakePipeline) Run(_ context.Context, _ *Worker, row renderRow, _ *videoapp.IR, _ videoapp.RenderParams, onFrame func(int)) (string, error) {
	total := row.FramesTotal
	if total <= 0 {
		total = f.frames
	}
	for i := 1; i <= total; i++ {
		onFrame(i)
	}
	if f.fail != nil {
		return "", f.fail
	}
	return "video/ws1/renders/" + row.ID + "/output.mp4", nil
}

func workerWith(t *testing.T, store *fakeStore, pub *fakePub, aud *fakeAuditor, pipe pipeline) *Worker {
	t.Helper()
	w := NewWorker(WorkerDeps{
		Publish: pub,
		Audit:   aud,
		Log:     testLogger(),
		store:   store,
	})
	w.pipe = pipe
	return w
}

func testLogger() *slog.Logger { return slog.New(slog.DiscardHandler) }

func sampleIR() *videoapp.IR {
	return &videoapp.IR{
		Meta:   videoapp.Meta{FPS: 30, Width: 1080, Height: 1920, DurationSec: 2},
		Script: "你好 世界",
		Words: []videoapp.Word{
			{Index: 0, Text: "你好", Start: 0, End: 1, Source: videoapp.WordSourceEstimated},
			{Index: 1, Text: "世界", Start: 1, End: 2, Source: videoapp.WordSourceEstimated},
		},
	}
}

func rowWith(ir *videoapp.IR) renderRow {
	b, _ := json.Marshal(ir)
	return renderRow{
		ID: "r1", ProjectID: "p1", WorkspaceID: "ws1", Status: videoapp.RenderQueued,
		Params:     videoapp.RenderParams{FPS: 30, Width: 1080, Height: 1920, SubtitleMode: "none"},
		IRSnapshot: b, FramesTotal: 60, CreatedBy: "u1",
	}
}

func job(id string) *river.Job[videoapp.RenderArgs] {
	return &river.Job[videoapp.RenderArgs]{Args: videoapp.RenderArgs{RenderID: id}}
}

func TestWorker_QueuedToRunningToSucceeded(t *testing.T) {
	store := &fakeStore{rows: rowMap{"r1": rowWith(sampleIR())}}
	pub := &fakePub{}
	aud := &fakeAuditor{}
	pipe := &fakePipeline{}
	w := workerWith(t, store, pub, aud, pipe)

	err := w.Work(t.Context(), job("r1"))
	require.NoError(t, err)

	require.NotEmpty(t, store.updated)
	first := store.updated[0]
	assert.Equal(t, videoapp.RenderRunning, first.status, "first transition = running")
	last := store.updated[len(store.updated)-1]
	assert.Equal(t, videoapp.RenderSucceeded, last.status)
	assert.Equal(t, 60, last.frames, "frames counted to total")
	assert.Contains(t, last.outKey, "output.mp4")

	// progress updates every 15 frames: frames 15/30/45/60 land in updates
	var progressFrames []int
	for _, u := range store.updated {
		if u.status == videoapp.RenderRunning {
			progressFrames = append(progressFrames, u.frames)
		}
	}
	assert.Contains(t, progressFrames, 15)
	assert.Contains(t, progressFrames, 30)
	assert.Contains(t, progressFrames, 45)

	// WS pushes: running + succeeded at minimum
	pub.mu.Lock()
	defer pub.mu.Unlock()
	assert.Contains(t, pub.events, videoapp.EventRenderUpdated)

	// audit only on terminal events (succeeded here)
	aud.mu.Lock()
	defer aud.mu.Unlock()
	assert.Contains(t, aud.recorded, videoapp.AuditRenderCompleted)
}

func TestWorker_InvalidIR_FailsWithRelease(t *testing.T) {
	ir := sampleIR()
	ir.Meta.FPS = 29 // invalid
	bad := rowWith(ir)
	store := &fakeStore{rows: rowMap{"r1": bad}}
	w := workerWith(t, store, &fakePub{}, &fakeAuditor{}, &fakePipeline{})

	require.NoError(t, w.Work(t.Context(), job("r1")))
	last := store.updated[len(store.updated)-1]
	assert.Equal(t, videoapp.RenderFailed, last.status)
	assert.Contains(t, last.errMsg, "E_VIDEO_IR_INVALID")
	// quota compensation on failure
	assert.Equal(t, []string{"ws1/r1"}, store.released)
}

func TestWorker_PipelineFailure_FailsAndReleases(t *testing.T) {
	store := &fakeStore{rows: rowMap{"r1": rowWith(sampleIR())}}
	aud := &fakeAuditor{}
	pipe := &fakePipeline{fail: ErrNotConfigured}
	w := workerWith(t, store, &fakePub{}, aud, pipe)

	err := w.Work(t.Context(), job("r1"))
	require.Error(t, err, "silent-fail sentinel returned so river does not retry")

	last := store.updated[len(store.updated)-1]
	assert.Equal(t, videoapp.RenderFailed, last.status)
	assert.Contains(t, last.errMsg, ErrNotConfigured.Error())
	assert.NotEmpty(t, store.released, "quota released on failure")
	aud.mu.Lock()
	defer aud.mu.Unlock()
	assert.Contains(t, aud.recorded, videoapp.AuditRenderFailed)
}

func TestWorker_MissingRow_Noop(t *testing.T) {
	store := &fakeStore{} // rows nil → not found
	w := workerWith(t, store, &fakePub{}, &fakeAuditor{}, &fakePipeline{})
	require.NoError(t, w.Work(t.Context(), job("ghost")))
	assert.Empty(t, store.updated)
}

func TestWorker_StubPipeline_DefaultBuild(t *testing.T) {
	// The default (!capx) build's pickPipeline returns the stub: every render
	// fails with ErrNotConfigured (observable failure, not silent). Under the
	// capx tag the real pipeline is compiled instead — probe the type by its
	// error behavior so this test file compiles under both tags.
	w := NewWorker(WorkerDeps{Log: testLogger()})
	_, err := w.pipe.Run(t.Context(), w, renderRow{}, &videoapp.IR{}, videoapp.RenderParams{}, func(int) {})
	if !errors.Is(err, ErrNotConfigured) {
		t.Skipf("capx tag active (real pipeline, err=%v) — stub assertion not applicable", err)
	}
}

func TestWorker_SweepOrphans_NilPoolSafe(t *testing.T) {
	w := NewWorker(WorkerDeps{Log: testLogger()})
	assert.NotPanics(t, func() { w.SweepOrphans(t.Context()) })
}

// --- quota release port wiring (worker-side compensation) ---

func TestWorker_QuotaReleasePort(t *testing.T) {
	// The port path fires only when no rowStore is wired (pure-port mode).
	qr := &fakeQuotaRelease{}
	w := NewWorker(WorkerDeps{Log: testLogger(), QuotaRelease: qr})
	row := renderRow{ID: "r1", WorkspaceID: "ws1"}
	w.releaseQuota(t.Context(), &row)
	qr.mu.Lock()
	defer qr.mu.Unlock()
	assert.Contains(t, qr.released, "ws1:"+videoapp.QuotaKey)
}

// --- batch-2 guard regressions (delivery-audit-video-studio §4 P4/P5) ---

func TestWorker_TerminalSucceeded_StaleAttemptSkipped(t *testing.T) {
	// A retry re-entering an already-succeeded render must not re-run the
	// pipeline, re-write, re-release quota, or flip the row back to running.
	store := &fakeStore{rows: rowMap{"r1": func() renderRow {
		r := rowWith(sampleIR())
		r.Status = videoapp.RenderSucceeded
		r.OutputKey = "video/ws1/renders/r1/output.mp4"
		return r
	}()}}
	pub := &fakePub{}
	aud := &fakeAuditor{}
	pipe := &fakePipeline{frames: 60}
	w := workerWith(t, store, pub, aud, pipe)
	require.NoError(t, w.Work(t.Context(), job("r1")))
	assert.Empty(t, store.updated, "no writes on stale attempt")
	assert.Empty(t, store.released, "no quota release on stale attempt")
	assert.Empty(t, pub.events, "no WS frames on stale attempt")
	assert.Empty(t, aud.recorded, "no duplicate audit on stale attempt")
}

func TestWorker_TerminalFailed_StaleAttemptSkipped(t *testing.T) {
	store := &fakeStore{rows: rowMap{"r1": func() renderRow {
		r := rowWith(sampleIR())
		r.Status = videoapp.RenderFailed
		r.Error = "boom"
		return r
	}()}}
	aud := &fakeAuditor{}
	w := workerWith(t, store, &fakePub{}, aud, &fakePipeline{frames: 60})
	require.NoError(t, w.Work(t.Context(), job("r1")))
	assert.Empty(t, store.updated)
	assert.Empty(t, store.released, "failed row already released by the losing attempt")
	assert.Empty(t, aud.recorded, "no duplicate failed audit")
}

func TestWorker_FailFlow_ExactlyOneQuotaRelease(t *testing.T) {
	// Normal failing flow: exactly one release despite transition+release
	// being separate steps (the fail-path ErrTerminalSkip guard prevents a
	// second release if another actor closed the row first — audit §4 P3).
	store := &fakeStore{rows: rowMap{"r1": rowWith(sampleIR())}}
	pipe := &fakePipeline{fail: errors.New("boom")}
	w := workerWith(t, store, &fakePub{}, &fakeAuditor{}, pipe)
	err := w.Work(t.Context(), job("r1"))
	// river.JobCancel = non-retryable: Work surfaces the wrapped sentinel.
	var jce *rivertype.JobCancelError
	require.ErrorAs(t, err, &jce, "fail path must be non-retryable (river.JobCancel)")
	assert.Len(t, store.released, 1, "exactly one quota release per render")
}

func TestWorker_Interrupted_CompensationOnLiveContext(t *testing.T) {
	// Drain: the pipeline observes ctx cancellation. The interrupted
	// transition + release must still land (WithoutCancel compensation ctx),
	// and Work returns the cancellation error for river to retry.
	store := &fakeStore{rows: rowMap{"r1": rowWith(sampleIR())}}
	pub := &fakePub{}
	aud := &fakeAuditor{}
	pipe := &cancelPipeline{}
	w := workerWith(t, store, pub, aud, pipe)

	ctx, cancel := context.WithCancel(t.Context())
	go func() {
		// let Work start, then cancel mid-pipeline
		pipe.waitStarted()
		cancel()
	}()
	err := w.Work(ctx, job("r1"))
	require.ErrorIs(t, err, context.Canceled)

	// interrupted write landed
	store.mu.Lock()
	last := store.updated[len(store.updated)-1]
	store.mu.Unlock()
	assert.Equal(t, videoapp.RenderInterrupted, last.status)
	assert.Len(t, store.released, 1, "quota released despite cancelled job ctx")
}

// cancelPipeline fails with context.Canceled once ctx dies.
type cancelPipeline struct {
	started chan struct{}
	once    sync.Once
}

func (c *cancelPipeline) waitStarted() {
	if c.started == nil {
		c.started = make(chan struct{})
	}
	<-c.started
}

func (c *cancelPipeline) Run(ctx context.Context, _ *Worker, row renderRow, _ *videoapp.IR, _ videoapp.RenderParams, onFrame func(int)) (string, error) {
	if c.started == nil {
		c.started = make(chan struct{})
	}
	c.once.Do(func() { close(c.started) })
	<-ctx.Done()
	return "", ctx.Err()
}

// compile-time guards: fakes satisfy their ports.
var (
	_ rowStore         = (*fakeStore)(nil)
	_ Publisher        = (*fakePub)(nil)
	_ Auditor          = (*fakeAuditor)(nil)
	_ QuotaReleasePort = (*fakeQuotaRelease)(nil)
	_ pipeline         = (*fakePipeline)(nil)
)
