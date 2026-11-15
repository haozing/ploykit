//go:build capx

// L3 smoke formalized as a repeatable integration test (round4 §1 / §7
// entry 1): the round4 L3 smoke was a hand-run curl sequence that — on its
// very first execution — caught the F3 wiring gap (CapxRuntime declared but
// never assigned in main.go) precisely BECAUSE it ran the real assembled
// binary (the round1 F-DB-1 lesson: unit fakes stay green while integration
// catches the assembly hole). This file freezes that sequence so it can be
// re-run on demand and regressed against.
//
// What it does differently from every other DB test in this module: it
// BUILDS and STARTS the real example server process (go build -tags capx →
// run → poll /healthz), then drives the full chain over HTTP with a cookie
// jar + CSRF rotation — register → login → workspace → project → IR →
// render submit (Idempotency-Key + replay) → poll terminal → MP4 download →
// Range 206 — and then verifies terminal state + quota accounting + audit
// trail by querying the TEST_DATABASE_URL database directly.
//
// Assertions (round4 §1.2 verdict table, all of them):
//   status=succeeded, frames_total=150 (5s × 30fps), MP4 ftyp header,
//   Range: bytes=0-99 → 206, idempotent replay returns the SAME render_id,
//   DB row status/quota_period/released_at (success does NOT release),
//   quota_counter used=1, audit has video.render.created + completed.
//
// Run (needs TEST_DATABASE_URL pointing at a disposable postgres + Chrome
// and ffmpeg installed — the render runs the real capx pipeline):
//
//	docker run -d --name pk-video-l3t-db -p 5437:5432 \
//	  -e POSTGRES_USER=pk -e POSTGRES_PASSWORD=pk -e POSTGRES_DB=pk postgres:16-alpine
//	go -C example test -tags capx ./internal/video/testdata -run TestL3Smoke \
//	  -v -timeout 8m
//
//   with TEST_DATABASE_URL=postgres://pk:pk@localhost:5437/pk?sslmode=disable
//
// Skips itself when TEST_DATABASE_URL is unset (service_db_test.go gate).
// Skips when Chrome or ffmpeg is missing — the L3 chain is the REAL render;
// without the tools the run cannot produce its assertion targets.
package l1

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"

	videoapp "myproduct/internal/video/app"
)

// l3TestTimeout is the per-test budget; the `go test -timeout` should be at
// least this plus build overhead (round4 smoke: ~20s render + ~5s boot +
// build time).
const l3TestTimeout = 7 * time.Minute

// l3IDemKey is the fixed idempotency key (round4 §1.2 replay assertion).
const l3IDemKey = "l3-smoke-test-001"

// l3SmokeTest bundles the state one TestL3Smoke run shares.
type l3SmokeTest struct {
	t           *testing.T
	baseURL     string
	http        *http.Client
	csrf        string
	workspaceID string // set after GET /api/workspaces; rides X-Workspace-Id
	db          *sql.DB
	logPath     string
}

// ---- HTTP helpers (cookie jar + CSRF rotation, the round4 curl logic) ----

// l3GetCSRF fetches a fresh masked token from GET /config. Every write
// request re-fetches (the token rotates on session-establishing responses
// and the masked token is single-session state; re-fetching per write is
// what the round4 smoke learned to do the hard way — its §1.4 note).
func (s *l3SmokeTest) l3GetCSRF() string {
	s.t.Helper()
	resp, err := s.http.Get(s.baseURL + "/config")
	if err != nil {
		s.t.Fatalf("GET /config: %v", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		s.t.Fatalf("GET /config: status %d body %.200s", resp.StatusCode, body)
	}
	var cfg struct {
		CSRFToken string `json:"csrf_token"`
	}
	if err := json.Unmarshal(body, &cfg); err != nil {
		s.t.Fatalf("GET /config: bad JSON: %v (%.200s)", err, body)
	}
	if cfg.CSRFToken == "" {
		s.t.Fatalf("GET /config: empty csrf_token (CSRF middleware not on the chain?)")
	}
	s.csrf = cfg.CSRFToken
	return s.csrf
}

// l3Do issues one HTTP request with the CSRF header + JSON content type.
// When s.workspaceID is set, X-Workspace-Id rides every request (video
// routes resolve tenancy from it via wsMW; sending it on non-video routes
// is harmless). Non-2xx → fatal with the error body inline (a bare status
// makes field debugging needlessly hard).
func (s *l3SmokeTest) l3Do(method, path string, payload any, wantStatus int) []byte {
	s.t.Helper()
	var body io.Reader
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil {
			s.t.Fatalf("marshal %s %s: %v", method, path, err)
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, s.baseURL+path, body)
	if err != nil {
		s.t.Fatalf("build %s %s: %v", method, path, err)
	}
	if s.workspaceID != "" {
		req.Header.Set("X-Workspace-Id", s.workspaceID)
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if method != http.MethodGet && method != http.MethodHead {
		req.Header.Set("X-CSRF-Token", s.l3GetCSRF())
	}
	resp, err := s.http.Do(req)
	if err != nil {
		s.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	respBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if resp.StatusCode != wantStatus {
		s.t.Fatalf("%s %s: status %d (want %d) body %.400s", method, path, resp.StatusCode, wantStatus, respBytes)
	}
	// Session-establishing responses rotate the CSRF token (docs/api-conventions.md);
	// pick the new one up so the next write does not 403 on a stale token.
	var rotated struct {
		CSRFToken string `json:"csrf_token"`
	}
	if len(respBytes) > 0 && respBytes[0] == '{' {
		if json.Unmarshal(respBytes, &rotated) == nil && rotated.CSRFToken != "" {
			s.csrf = rotated.CSRFToken
		}
	}
	return respBytes
}

// ---- environment prep ----

// l3freePort picks a test-specific port (8039 + random tail, round4 used
// :8039) so parallel runs and other dev servers on :8030 don't collide.
func l3freePort(t *testing.T) int {
	t.Helper()
	addr, err := net.ResolveTCPAddr("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("resolve tcp addr: %v", err)
	}
	ln, err := net.ListenTCP("tcp", addr)
	if err != nil {
		t.Fatalf("listen :0: %v", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	ln.Close()
	return port
}

// l3cleanDB wipes prior video_* residue so re-runs are repeatable: render
// + project rows, the video quota counter for ANY workspace, and the video
// audit events. DELETE (not TRUNCATE) keeps FKs orderly and works through
// the partitioned audit table. On a FRESH database the server applies the
// migration chain itself at boot, so missing-table errors (42P01) here are
// "nothing to clean", not failures.
func l3cleanDB(ctx context.Context, t *testing.T, db *sql.DB) {
	t.Helper()
	for _, stmt := range []string{
		`DELETE FROM video_render`,
		`DELETE FROM video_project`,
		`DELETE FROM quota_counter WHERE counter_key = 'video_renders_monthly'`,
		`DELETE FROM quota_consume_idem WHERE counter_key = 'video_renders_monthly'`,
		`DELETE FROM audit_event WHERE action LIKE 'video.%'`,
	} {
		if _, err := db.ExecContext(ctx, stmt); err != nil {
			var pgErr interface{ SQLState() string }
			if errors.As(err, &pgErr) && pgErr.SQLState() == "42P01" {
				continue // fresh DB — nothing to clean yet
			}
			t.Fatalf("clean DB (%s): %v", stmt, err)
		}
	}
}

// ---- the test ----

// TestL3Smoke drives the REAL example binary end to end (round4 §1.2
// verdict table) against TEST_DATABASE_URL.
func TestL3Smoke(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	// The L3 chain IS the real render — without Chrome/ffmpeg the server
	// boots degraded (capx runtime inert) and every render fails
	// E_NOT_CONFIGURED, which would fail the test for an environment
	// reason. L2 covers the encode chain standalone with the same skip.
	chromeBin := chromePath(t)
	ffmpegBin := ffmpegPath(t)

	ctx, cancel := context.WithTimeout(context.Background(), l3TestTimeout)
	defer cancel()

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("open TEST_DATABASE_URL: %v", err)
	}
	defer db.Close()
	l3cleanDB(ctx, t, db)

	// ---- build the real binary (the whole point: test the real assembly,
	// not a testdouble wiring — F3 was invisible to every fake) ----
	tmpDir := t.TempDir()
	exePath := filepath.Join(tmpDir, "ploykit-l3-smoke.exe")
	// example module root: testdata → video → internal → example
	exampleRoot, err := filepath.Abs(filepath.Join("..", "..", ".."))
	if err != nil {
		t.Fatalf("resolve example root: %v", err)
	}
	build := exec.CommandContext(ctx, "go", "build", "-tags", "capx", "-o", exePath, "./cmd/app")
	build.Dir = exampleRoot
	buildOut, err := build.CombinedOutput()
	if err != nil {
		t.Fatalf("go build -tags capx ./cmd/app failed: %v\n%s", err, buildOut)
	}

	// ---- start the server on a dedicated port ----
	port := l3freePort(t)
	logPath := filepath.Join(tmpDir, "server.log")
	logFile, err := os.Create(logPath)
	if err != nil {
		t.Fatalf("create server log: %v", err)
	}
	dataDir := filepath.Join(tmpDir, "videodata")
	cmd := exec.CommandContext(ctx, exePath)
	cmd.Dir = tmpDir // storage roots land inside the temp dir, never in-repo
	cmd.Env = append(os.Environ(),
		"DATABASE_URL="+dsn,
		fmt.Sprintf("ADDR=:%d", port),
		"PLOYKIT_MCP_ENABLED=1", // the capx gate (round4 §1.4): =0 renders 503
		"CAPX_CHROME_PATH="+chromeBin,
		"CAPX_FFMPEG_PATH="+ffmpegBin,
		"VIDEO_DATA_DIR="+dataDir,
		"UPLOADS_DIR="+filepath.Join(tmpDir, "uploads"),
		"RENDERX_CACHE_DIR="+filepath.Join(tmpDir, "renderx-cache"),
	)
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	if err := cmd.Start(); err != nil {
		logFile.Close()
		t.Fatalf("start server: %v", err)
	}
	logTail := func() string {
		b, _ := os.ReadFile(logPath)
		if len(b) > 4000 {
			return "\n...[server.log tail]\n" + string(b[len(b)-4000:])
		}
		return "\n[server.log]\n" + string(b)
	}
	stopped := false
	stopServer := func() {
		if stopped {
			return
		}
		stopped = true
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
		logFile.Close()
	}
	t.Cleanup(stopServer)

	// ---- poll /healthz (liveness only; the LB-facing contract) ----
	s := &l3SmokeTest{
		t:       t,
		baseURL: fmt.Sprintf("http://127.0.0.1:%d", port),
		db:      db,
		logPath: logPath,
	}
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("cookie jar: %v", err)
	}
	s.http = &http.Client{Jar: jar, Timeout: 30 * time.Second}

	healthDeadline := time.Now().Add(30 * time.Second)
	for {
		resp, herr := s.http.Get(s.baseURL + "/healthz")
		if herr == nil {
			io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<12))
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				break
			}
		}
		if time.Now().After(healthDeadline) {
			t.Fatalf("server did not become healthy in 30s%s", logTail())
		}
		// Boot failure exits the process — fail fast with the log instead of
		// burning the whole 30s budget on a dead process.
		if cmd.ProcessState != nil && cmd.ProcessState.Exited() {
			t.Fatalf("server process exited during startup%s", logTail())
		}
		select {
		case <-ctx.Done():
			t.Fatalf("context expired while waiting for /healthz%s", logTail())
		case <-time.After(500 * time.Millisecond):
		}
	}

	// ---- full chain ----
	email := fmt.Sprintf("l3-smoke-%d@test.local", time.Now().UnixNano())
	password := "L3Smoke!2026x" // ≥10 chars, 3+ kinds (identity PasswordOK)
	s.l3Do(http.MethodPost, "/auth/register", map[string]string{
		"email": email, "password": password, "display_name": "L3 Smoke",
	}, http.StatusOK)
	s.l3Do(http.MethodPost, "/auth/login", map[string]string{
		"email": email, "password": password,
	}, http.StatusOK)

	wsBytes := s.l3Do(http.MethodGet, "/api/workspaces", nil, http.StatusOK)
	var memberships []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(wsBytes, &memberships); err != nil || len(memberships) == 0 {
		t.Fatalf("GET /api/workspaces: %v (%.400s)", err, wsBytes)
	}
	// X-Workspace-Id is mandatory on video routes (wsMW): without it every
	// request dies at membership (round4 smoke note N2). From here on every
	// request rides the header (l3Do attaches it when set).
	s.workspaceID = memberships[0].ID

	projBytes := s.l3Do(http.MethodPost, "/api/video/projects",
		map[string]string{"title": "L3 Smoke"}, http.StatusCreated)
	var proj struct {
		ID      string `json:"id"`
		Version int    `json:"version"`
	}
	if err := json.Unmarshal(projBytes, &proj); err != nil {
		t.Fatalf("POST /api/video/projects: %v (%.400s)", err, projBytes)
	}

	// Synthesized 5s IR (round4 smoke shape): background + headline, words
	// via EstimateWords, one counter + one highlight anchored at word 0.
	ir := l3SmokeIR()
	putBytes := s.l3Do(http.MethodPut, fmt.Sprintf("/api/video/projects/%s/ir", proj.ID),
		map[string]any{"ir": ir, "expected_version": proj.Version}, http.StatusOK)
	var putRes struct {
		Version     int `json:"version"`
		Resolutions []struct {
			OwnerID   string `json:"ownerId"`
			WordIndex int    `json:"wordIndex"`
			Reason    string `json:"reason"`
		} `json:"resolutions"`
	}
	if err := json.Unmarshal(putBytes, &putRes); err != nil {
		t.Fatalf("PUT /ir: %v (%.400s)", err, putBytes)
	}
	for _, r := range putRes.Resolutions {
		if r.Reason == videoapp.AnchorMissing {
			t.Fatalf("PUT /ir: anchor %s unresolved (reason=missing)", r.OwnerID)
		}
	}

	// Submit with a fixed Idempotency-Key; then replay the SAME key and
	// require the SAME render_id (round4 §1.2: idempotency closure, no
	// second row, no double charge). The submission pins the IR via the
	// current row version server-side; the PUT above returned it (putRes.Version).
	submit := func() string {
		req, err := http.NewRequest(http.MethodPost,
			fmt.Sprintf("%s/api/video/projects/%s/renders", s.baseURL, proj.ID),
			bytes.NewReader([]byte(`{"params":{"fps":30}}`)))
		if err != nil {
			t.Fatalf("build render submit: %v", err)
		}
		req.Header.Set("X-Workspace-Id", s.workspaceID)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", l3IDemKey)
		req.Header.Set("X-CSRF-Token", s.l3GetCSRF())
		resp, err := s.http.Do(req)
		if err != nil {
			t.Fatalf("POST renders: %v", err)
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("POST renders: status %d body %.400s%s", resp.StatusCode, body, logTail())
		}
		var r struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(body, &r); err != nil || r.ID == "" {
			t.Fatalf("POST renders: bad body %v (%.400s)", err, body)
		}
		return r.ID
	}
	renderID := submit()
	renderIDReplay := submit()
	if renderIDReplay != renderID {
		t.Fatalf("idempotent replay returned different render_id: first=%s replay=%s", renderID, renderIDReplay)
	}

	// ---- poll to terminal (round4: ~20s render; 3min cap) ----
	var final struct {
		ID          string `json:"id"`
		Status      string `json:"status"`
		FramesDone  int    `json:"frames_done"`
		FramesTotal int    `json:"frames_total"`
		OutputKey   string `json:"output_key"`
		Error       string `json:"error"`
	}
	pollDeadline := time.Now().Add(3 * time.Minute)
	for {
		pollBytes := s.l3Do(http.MethodGet, fmt.Sprintf("/api/video/renders/%s", renderID), nil, http.StatusOK)
		if err := json.Unmarshal(pollBytes, &final); err != nil {
			t.Fatalf("GET renders/{id}: %v (%.400s)", err, pollBytes)
		}
		switch final.Status {
		case videoapp.RenderSucceeded, videoapp.RenderFailed, videoapp.RenderInterrupted:
		default: // queued | running — keep polling
			if time.Now().After(pollDeadline) {
				t.Fatalf("render %s did not reach a terminal state in 3m (last status=%s)%s", renderID, final.Status, logTail())
			}
			select {
			case <-ctx.Done():
				t.Fatalf("context expired while polling render%s", logTail())
			case <-time.After(2 * time.Second):
			}
			continue
		}
		break
	}
	if final.Status != videoapp.RenderSucceeded {
		t.Fatalf("render terminal status = %s (want succeeded) error=%q frames=%d/%d%s",
			final.Status, final.Error, final.FramesDone, final.FramesTotal, logTail())
	}
	if final.FramesTotal != 150 {
		t.Fatalf("frames_total = %d (want 150: 5s x 30fps)", final.FramesTotal)
	}
	if final.FramesDone != final.FramesTotal {
		t.Fatalf("frames_done = %d, want %d", final.FramesDone, final.FramesTotal)
	}
	if final.OutputKey == "" {
		t.Fatalf("succeeded render has empty output_key%s", logTail())
	}

	// ---- MP4 download: ftyp header + non-empty; then Range 206 ----
	fileResp := func(rangeHeader string) *http.Response {
		req, err := http.NewRequest(http.MethodGet,
			fmt.Sprintf("%s/api/video/files/%s", s.baseURL, final.OutputKey), nil)
		if err != nil {
			t.Fatalf("build file request: %v", err)
		}
		req.Header.Set("X-Workspace-Id", s.workspaceID)
		if rangeHeader != "" {
			req.Header.Set("Range", rangeHeader)
		}
		resp, err := s.http.Do(req)
		if err != nil {
			t.Fatalf("GET file: %v", err)
		}
		return resp
	}
	resp := fileResp("")
	mp4, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	resp.Body.Close()
	if err != nil {
		t.Fatalf("read MP4: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("MP4 download status %d (want 200)", resp.StatusCode)
	}
	if len(mp4) == 0 {
		t.Fatalf("MP4 download is empty")
	}
	if len(mp4) < 12 || !bytes.Equal(mp4[4:8], []byte("ftyp")) {
		head := mp4
		if len(head) > 16 {
			head = head[:16]
		}
		t.Fatalf("MP4 ftyp header missing: first bytes %.16q", head)
	}

	rresp := fileResp("bytes=0-99")
	rangeBytes, err := io.ReadAll(io.LimitReader(rresp.Body, 4096))
	rresp.Body.Close()
	if err != nil {
		t.Fatalf("read Range body: %v", err)
	}
	if rresp.StatusCode != http.StatusPartialContent {
		t.Fatalf("Range request status %d (want 206)", rresp.StatusCode)
	}
	if len(rangeBytes) != 100 {
		t.Fatalf("Range bytes=0-99 returned %d bytes (want 100)", len(rangeBytes))
	}

	// ---- DB direct checks (round4 §1.2 DB row + quota + audit) ----
	var (
		rowStatus    string
		quotaPeriod  string
		releasedAt   sql.NullString
		submissionKy string
	)
	err = db.QueryRowContext(ctx,
		`SELECT status, quota_period, released_at::text, submission_key FROM video_render WHERE id = $1`, renderID).
		Scan(&rowStatus, &quotaPeriod, &releasedAt, &submissionKy)
	if err != nil {
		t.Fatalf("query video_render row: %v", err)
	}
	if rowStatus != "succeeded" {
		t.Fatalf("DB video_render.status = %s (want succeeded)", rowStatus)
	}
	if quotaPeriod == "" {
		t.Fatalf("DB video_render.quota_period is empty (want the fixed period)")
	}
	if !releasedAt.Valid || releasedAt.String == "" {
		// released_at::text of NULL scans as !Valid — correct on success:
		// success must NOT release quota.
		_ = releasedAt
	} else {
		t.Fatalf("DB video_render.released_at set on success (%s) — success must NOT release quota", releasedAt.String)
	}
	if submissionKy != l3IDemKey {
		t.Fatalf("DB video_render.submission_key = %q (want %q)", submissionKy, l3IDemKey)
	}

	var used int64
	if err := db.QueryRowContext(ctx,
		`SELECT used FROM quota_counter WHERE workspace_id = $1 AND counter_key = 'video_renders_monthly'`, s.workspaceID).
		Scan(&used); err != nil {
		t.Fatalf("query quota_counter: %v", err)
	}
	if used != 1 {
		t.Fatalf("quota_counter.used = %d (want 1: one successful render, replay must not double charge)", used)
	}

	var auditCount int
	if err := db.QueryRowContext(ctx,
		`SELECT count(*) FROM audit_event WHERE action IN ('video.render.created','video.render.completed')
		 AND resource_id = $1`, renderID).Scan(&auditCount); err != nil {
		t.Fatalf("query audit_event: %v", err)
	}
	if auditCount != 2 {
		t.Fatalf("audit events for render %s: got %d (want 2: video.render.created + video.render.completed)", renderID, auditCount)
	}
}

// l3SmokeIR synthesizes the minimal-but-valid 5s composition the smoke
// asserts against (150 frames at 30fps): cream background, one headline
// text, words via EstimateWords, counter + highlight anchored at word 0.
// Mirrors the x4 test IR shape (element-level targets validated at write).
func l3SmokeIR() *videoapp.IR {
	script := "L3 smoke counter test"
	ir := &videoapp.IR{
		SchemaVersion: videoapp.IRSchemaVersion,
		Meta: videoapp.Meta{
			FPS:         30,
			Width:       1080,
			Height:      1920,
			DurationSec: 5.0,
		},
		Script: script,
		Words:  videoapp.EstimateWords(script, 5.0),
		Effects: []videoapp.Effect{
			{
				ID:     "fx_counter",
				Anchor: videoapp.Anchor{Text: "L3", Occurrence: 0},
				Type:   videoapp.EffectCounter,
				Params: []byte(`{"from":0,"to":99}`),
			},
			{
				ID:     "fx_highlight",
				Anchor: videoapp.Anchor{Text: "smoke", Occurrence: 0},
				Type:   videoapp.EffectHighlight,
				Params: []byte(`{"color":"#F5A623"}`),
			},
		},
		Elements: []videoapp.Element{
			{ID: "bg", Type: videoapp.ElementShape, Color: "#FFF7EE",
				X: 0, Y: 0, W: 1080, H: 1920, Z: 0},
			{ID: "headline", Type: videoapp.ElementText, Text: "L3 Smoke",
				Color: "#2B2118", FontSize: 72,
				X: 240, Y: 600, W: 600, H: 120, Z: 3},
		},
	}
	return ir
}

