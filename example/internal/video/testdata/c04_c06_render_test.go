// Package l1 — Video Studio case-library L1 (still single-frame) render
// tests for VS-C04 and VS-C06 (test batch 2). Same harness pattern as
// l1_render_test.go (VS-C01, batch 1): degraded current-IR projection ->
// self-contained player HTML -> full-frame-loop render via a REAL local
// headless Chrome through platform/capx -> keep keyframes -> existence-level
// structural assertions -> golden artifacts + verdict reports.
//
// Batch-2 specifics:
//   - C04: 1800 frames @1920x1080@30 (60s), keyframes from ir/c04.frames.json
//   - C06: 2250 frames @1920x1080@25 (90s), keyframes from ir/c06.frames.json
//   - probe frames (kept in memory, metrics only) pin the exact entry frame of
//     bar22 growth (C04), the name-strip switch onset 224-232 (C06, the doc's
//     only valid frame-diff assertion point), the caption-move/canvas-pulse
//     segment 450-478 (C06) and the highlight windows (C04 F916, C06 F24-51)
//     to prove the occlusion findings numerically.
//   - D-01 status (capx seekTimeline pause arity) is probed at runtime from
//     the framework source and recorded at the top of both reports.
//   - The two hard-prompt assertions from spec-audit-report.json are handled
//     as "degraded_na" (A-C04-04 end-frame blue <=2%, A-C06-01 brightness
//     ratio) — measured and recorded, never counted as fail.
//   - Status vocabulary: ok (structure holds) / mismatch (doc expectation vs
//     rendered reality diverges — M2 planning input, not a defect) / fail
//     (rendered structure broken, e.g. D-01 counter) / degraded_na (assertion
//     not applicable under degradation, measured anyway).
//
// Run:
//
//	go -C example test -run TestL1RenderC04Keyframes -v ./internal/video/testdata -timeout 20m
//	go -C example test -run TestL1RenderC06Keyframes -v ./internal/video/testdata -timeout 20m
package l1

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/haozing/ploykit/platform/capx"
	"github.com/haozing/ploykit/platform/storagex"
	videoapp "myproduct/internal/video/app"
)

// ---- D-01 runtime status probe (read-only look at framework source) ----

type d01Report struct {
	State  string `json:"state"` // "fixed" | "unfixed" | "unknown"
	Detail string `json:"detail"`
	CallLn string `json:"seek_pause_line"`
}

var twoArgPauseRe = regexp.MustCompile(`, false\)`)

func checkD01(t *testing.T) d01Report {
	t.Helper()
	_, thisFile, _, _ := runtime.Caller(0)
	// thisFile = <repo>/example/internal/video/testdata/c04_c06_render_test.go
	// -> dirs: testdata, video, internal, example, <repoRoot>
	repoRoot := filepath.Dir(filepath.Dir(filepath.Dir(filepath.Dir(filepath.Dir(thisFile)))))
	srcPath := filepath.Join(repoRoot, "platform", "capx", "renderer.go")
	b, err := os.ReadFile(srcPath)
	if err != nil {
		return d01Report{State: "unknown", Detail: "renderer.go unreadable: " + err.Error()}
	}
	src := string(b)
	callLn := ""
	for _, ln := range strings.Split(src, "\n") {
		if strings.Contains(ln, "tl.pause(") {
			callLn = strings.TrimSpace(ln)
			break
		}
	}
	// The seek call is a single source line: tl.pause(`<expr>`, false); when
	// fixed — the ", false)" tail lives on the same line as "tl.pause(".
	if callLn != "" && twoArgPauseRe.MatchString(callLn) {
		return d01Report{State: "fixed", Detail: "seekTimeline issues a two-argument pause (suppressEvents=false); counter onUpdate fires during seek renders — digits expected visible on seeked frames", CallLn: callLn}
	}
	return d01Report{
		State:  "unfixed",
		Detail: "capx seekTimeline calls tl.pause(tSec) single-argument; GSAP suppressEvents defaults true so counter onUpdate never runs on seeked frames — all counter digits render empty in this run (D-01 unfixed at render time)",
		CallLn: callLn,
	}
}

// ---- frames.json expectation table ----

type kfExpect struct {
	Frame   int     `json:"frame"`
	TimeSec float64 `json:"time_sec"`
	Expect  string  `json:"expect"`
}

func loadExpects(t *testing.T, baseDir, name string) map[int]kfExpect {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(baseDir, "ir", name))
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	// Two shapes in the wild: batch-2 files are a bare array; batch-5/6
	// files wrap the array in an envelope ({case,fps,frames:[...]}).
	var list []kfExpect
	var env struct {
		Frames []kfExpect `json:"frames"`
	}
	if err := json.Unmarshal(b, &env); err == nil && len(env.Frames) > 0 {
		list = env.Frames
	} else if err := json.Unmarshal(b, &list); err != nil {
		t.Fatalf("unmarshal %s: %v", name, err)
	}
	m := map[int]kfExpect{}
	for _, e := range list {
		m[e.Frame] = e
	}
	return m
}

// ---- case runner plumbing ----

type probeSpec struct {
	Frame int
	Label string
}

type caseCfg struct {
	caseID         string
	irFile         string
	framesFile     string
	goldenSub      string
	reportFile     string
	fps            int
	width          int
	height         int
	durationFrames int
	keyframes      []int
	probes         []probeSpec
	post           func(cx *caseCtx)

	// Assets, when set, backs the projector's image resolution (data-URI
	// injection for headless rendering — the network lock makes any URL
	// reference a hard decode failure). Nil = PreviewResolver default,
	// which only works for cases without image elements.
	Assets func(ctx context.Context, key string) (io.ReadCloser, storagex.Object, error)
}

type sampleRec struct {
	Frame           int            `json:"frame"`
	TimeSec         float64        `json:"time_sec"`
	Status          string         `json:"status"` // ok | fail | mismatch | degraded_na | probe
	ProbeLabel      string         `json:"probe_label,omitempty"`
	Expect          string         `json:"expect,omitempty"`
	Actual          string         `json:"actual,omitempty"`
	StructureChecks map[string]any `json:"structure_checks"`
	DurationMS      int64          `json:"duration_ms"`
	Artifact        string         `json:"artifact,omitempty"`
	Notes           []string       `json:"notes,omitempty"`
}

type caseCtx struct {
	t           *testing.T
	cfg         *caseCfg
	baseDir     string
	runID       string
	ir          *videoapp.IR
	irSHA       string
	htmlLen     int
	resJSON     []map[string]any
	chrome      string
	ffVer       string
	renderTotal time.Duration
	d01         d01Report
	keyRecs     map[int]*sampleRec
	probeRecs   map[int]*sampleRec
	imgs        map[int]image.Image // decoded kept frames (keyframes + probes)
	hardPrompts []map[string]any
}

func newRunID2(prefix string) string {
	b := make([]byte, 2)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%s-%s-%s", prefix, time.Now().Format("20060102-150405"), hex.EncodeToString(b))
}

func runCase(t *testing.T, cfg *caseCfg) {
	if testing.Short() {
		t.Skip("L1 drives a real headless Chrome; skipped in -short mode")
	}
	_, thisFile, _, _ := runtime.Caller(0)
	baseDir := filepath.Dir(thisFile)
	goldenDir := filepath.Join(baseDir, "golden", cfg.goldenSub)
	if err := os.MkdirAll(goldenDir, 0o755); err != nil {
		t.Fatalf("mkdir golden dir: %v", err)
	}

	cx := &caseCtx{
		t:         t,
		cfg:       cfg,
		baseDir:   baseDir,
		runID:     newRunID2("l1-" + strings.ToLower(strings.TrimPrefix(cfg.caseID, "VS-C"))),
		keyRecs:   map[int]*sampleRec{},
		probeRecs: map[int]*sampleRec{},
		imgs:      map[int]image.Image{},
	}
	cx.d01 = checkD01(t)
	t.Logf("D-01 status at render time: %s (%s)", cx.d01.State, cx.d01.CallLn)

	// -- 1. degraded IR: load, validate, resolve anchors --
	irBytes, err := os.ReadFile(filepath.Join(baseDir, "ir", cfg.irFile))
	if err != nil {
		t.Fatalf("read %s: %v", cfg.irFile, err)
	}
	ir := &videoapp.IR{}
	if err := json.Unmarshal(irBytes, ir); err != nil {
		t.Fatalf("unmarshal %s: %v", cfg.irFile, err)
	}
	if err := videoapp.Validate(ir); err != nil {
		t.Fatalf("degraded IR failed Validate: %v", err)
	}
	frames := videoapp.DurationFrames(ir, ir.Meta.FPS)
	if frames != cfg.durationFrames {
		t.Fatalf("DurationFrames=%d, expected %d", frames, cfg.durationFrames)
	}
	cx.ir = ir
	resolutions := videoapp.ResolveAll(ir, nil)
	for _, r := range resolutions {
		start := 0.0
		if r.WordIndex >= 0 && r.WordIndex < len(ir.Words) {
			start = ir.Words[r.WordIndex].Start
		}
		cx.resJSON = append(cx.resJSON, map[string]any{
			"owner": r.Owner, "owner_id": r.OwnerID, "anchor_text": r.AnchorText,
			"word_index": r.WordIndex, "reason": r.Reason,
			"word_start_sec": start, "anchor_frame_at_fps": start * float64(cfg.fps),
		})
		t.Logf("anchor %s(%s) %q -> word[%d] reason=%s start=%.2fs frame=%.0f",
			r.OwnerID, r.Owner, r.AnchorText, r.WordIndex, r.Reason, start, start*float64(cfg.fps))
	}
	msha, err := json.Marshal(ir)
	if err != nil {
		t.Fatalf("marshal IR: %v", err)
	}
	cx.irSHA = fmt.Sprintf("%x", sha256.Sum256(msha))

	// -- 2. project to player HTML --
	var proj *videoapp.Projector
	if cfg.Assets != nil {
		proj = videoapp.NewProjector(videoapp.DataURIResolver{Loader: cfg.Assets})
	} else {
		proj = videoapp.NewProjector(nil)
	}
	html, err := proj.HTML(context.Background(), ir, "")
	if err != nil {
		t.Fatalf("project HTML: %v", err)
	}
	cx.htmlLen = len(html)
	t.Logf("projected HTML bytes=%d", len(html))

	// -- 3. capx runtime with REAL local chrome --
	chromePath, err := capx.ProbeChrome("")
	if err != nil {
		t.Fatalf("chrome probe failed: %v", err)
	}
	cx.chrome = chromePath
	t.Logf("chrome: %s", chromePath)
	enabled := true
	rt, err := capx.New(capx.Config{Enabled: &enabled})
	if err != nil {
		t.Fatalf("capx.New: %v", err)
	}
	defer rt.Close()
	if !rt.Available() {
		t.Fatalf("capx runtime not available")
	}
	rend, err := rt.Renderer()
	if err != nil {
		t.Fatalf("capx Renderer: %v", err)
	}
	cx.ffVer = ffmpegVersion(t)

	// -- 4. full-frame-loop render, keep keyframes + probes --
	kept := map[int]bool{}
	for _, f := range cfg.keyframes {
		kept[f] = true
	}
	for _, p := range cfg.probes {
		kept[p.Frame] = true
	}
	pngs := map[int][]byte{}
	cum := map[int]int64{}
	renderStart := time.Now()
	err = rend.RenderFrames(t.Context(),
		capx.Doc{HTML: string(html), TimelineID: timelineID},
		capx.FrameSpec{Width: cfg.width, Height: cfg.height, FPS: cfg.fps, DurationFrames: cfg.durationFrames},
		func(_ context.Context, f capx.Frame) error {
			if kept[f.Index] {
				pngs[f.Index] = f.PNG
				cum[f.Index] = time.Since(renderStart).Milliseconds()
			}
			if f.Index%200 == 0 {
				t.Logf("frame %d/%d rendered (%.1fs elapsed)", f.Index, cfg.durationFrames-1, time.Since(renderStart).Seconds())
			}
			return nil
		})
	cx.renderTotal = time.Since(renderStart)
	if err != nil {
		t.Fatalf("RenderFrames failed after %s: %v", cx.renderTotal, err)
	}
	t.Logf("RENDER DONE: %d frames in %s (%.1f ms/frame avg, real chrome=%s)",
		cfg.durationFrames, cx.renderTotal.Round(time.Millisecond),
		float64(cx.renderTotal.Milliseconds())/float64(cfg.durationFrames), chromePath)

	// -- 5. hard structural checks + decode + golden artifacts --
	for _, f := range cfg.keyframes {
		pngB := pngs[f]
		checks := map[string]any{}
		checks["png_magic_ok"] = bytes.HasPrefix(pngB, pngMagic)
		img, derr := png.Decode(bytes.NewReader(pngB))
		checks["png_decoded"] = derr == nil
		dimOK := derr == nil && img.Bounds().Dx() == cfg.width && img.Bounds().Dy() == cfg.height
		checks["dimensions"] = fmt.Sprintf("%dx%d", cfg.width, cfg.height)
		checks["dimensions_ok"] = dimOK
		if !checks["png_magic_ok"].(bool) || derr != nil || !dimOK {
			t.Fatalf("frame %d failed hard PNG checks", f)
		}
		cx.imgs[f] = img
		rec := &sampleRec{
			Frame: f, TimeSec: float64(f) / float64(cfg.fps),
			StructureChecks: checks, DurationMS: cum[f],
			Artifact: filepath.ToSlash(filepath.Join("example", "internal", "video", "testdata", "golden", cfg.goldenSub, fmt.Sprintf("frame-%03d.png", f))),
		}
		if e, ok := loadExpects(t, baseDir, cfg.framesFile)[f]; ok {
			rec.Expect = e.Expect
		}
		if werr := os.WriteFile(filepath.Join(goldenDir, fmt.Sprintf("frame-%03d.png", f)), pngB, 0o644); werr != nil {
			t.Fatalf("write golden frame %d: %v", f, werr)
		}
		cx.keyRecs[f] = rec
	}
	for _, p := range cfg.probes {
		img, derr := png.Decode(bytes.NewReader(pngs[p.Frame]))
		if derr != nil {
			t.Fatalf("probe frame %d decode: %v", p.Frame, derr)
		}
		cx.imgs[p.Frame] = img
		cx.probeRecs[p.Frame] = &sampleRec{
			Frame: p.Frame, TimeSec: float64(p.Frame) / float64(cfg.fps),
			Status: "probe", ProbeLabel: p.Label,
			StructureChecks: map[string]any{"png_decoded": true, "dimensions_ok": true},
			DurationMS:      cum[p.Frame],
		}
	}

	// -- 6. case-specific assertions --
	cfg.post(cx)

	// -- 7. write meta.json + report --
	meta := map[string]any{
		"case":                cfg.caseID,
		"layer":               "L1",
		"run_id":              cx.runID,
		"fps":                 cfg.fps,
		"duration_frames":     cfg.durationFrames,
		"width":               cfg.width,
		"height":              cfg.height,
		"keyframes":           cfg.keyframes,
		"probe_frames":        probeFrameList(cfg),
		"frame_basis":         fmt.Sprintf("ceil(durationSec*fps), videoapp.DurationFrames = %d", cfg.durationFrames),
		"generated_at":        time.Now().Format(time.RFC3339),
		"chrome":              chromePath,
		"ffmpeg":              cx.ffVer,
		"go":                  runtime.Version(),
		"ir_source_file":      "example/internal/video/testdata/ir/" + cfg.irFile,
		"ir_sha256":           cx.irSHA,
		"ir_sha256_algorithm": "sha256(json.Marshal(videoapp.IR) after file-load + ResolveAll, before projection)",
		"render_total_ms":     cx.renderTotal.Milliseconds(),
		"render_mode":         fmt.Sprintf("full %d-frame loop; keyframes + probes kept", cfg.durationFrames),
		"d01_status":          cx.d01.State,
		"notes":               "first baseline run for this case — no golden compare; structural existence assertions only",
	}
	metaBytes, _ := json.MarshalIndent(meta, "", "  ")
	if err := os.WriteFile(filepath.Join(goldenDir, "meta.json"), metaBytes, 0o644); err != nil {
		t.Fatalf("write meta.json: %v", err)
	}

	report := cx.buildReport(cfg)
	repBytes, _ := json.MarshalIndent(report, "", "  ")
	reportPath := filepath.Join(baseDir, cfg.reportFile)
	if err := os.WriteFile(reportPath, repBytes, 0o644); err != nil {
		t.Fatalf("write report: %v", err)
	}

	var fails, mismatches int
	for _, r := range cx.keyRecs {
		switch r.Status {
		case "fail":
			fails++
		case "mismatch":
			mismatches++
		}
	}
	t.Logf("VERDICT: ok=%d mismatch=%d fail=%d degraded_na=%d (report: %s)",
		countStatus(cx, "ok"), mismatches, fails, countStatus(cx, "degraded_na"), cfg.reportFile)
	if fails > 0 {
		t.Errorf("L1 structural checks: %d/%d keyframes failed (see %s)", fails, len(cx.keyRecs), cfg.reportFile)
	}
}

// ---- generic pixel helpers (case-agnostic; regionStats lives in l1_render_test.go) ----

func absI(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

func nearRGB(r, g, b uint8, tr, tg, tb uint8, tol int) bool {
	return absI(int(r)-int(tr)) <= tol && absI(int(g)-int(tg)) <= tol && absI(int(b)-int(tb)) <= tol
}

// shareNear = ratio of pixels in rect within tol of target RGB per channel.
func shareNear(img image.Image, rect [4]int, tr, tg, tb uint8, tol int) float64 {
	x0, y0 := rect[0], rect[1]
	x1, y1 := rect[0]+rect[2], rect[1]+rect[3]
	b := img.Bounds()
	x0, y0 = max(x0, b.Min.X), max(y0, b.Min.Y)
	x1, y1 = min(x1, b.Max.X), min(y1, b.Max.Y)
	var n, hit int
	for y := y0; y < y1; y++ {
		for x := x0; x < x1; x++ {
			r, g, bl, _ := img.At(x, y).RGBA()
			n++
			if nearRGB(uint8(r>>8), uint8(g>>8), uint8(bl>>8), tr, tg, tb, tol) {
				hit++
			}
		}
	}
	if n == 0 {
		return 0
	}
	return round4(float64(hit) / float64(n))
}

// shareNearOutside = shareNear over the full frame, EXCLUDING all exclusion
// rects (used when a figure element shares the flash color with the effect
// under test — e.g. the C04 ring is also #F5A623).
func shareNearOutside(img image.Image, full [4]int, tr, tg, tb uint8, tol int, excl ...[4]int) float64 {
	b := img.Bounds()
	x0, y0 := max(full[0], b.Min.X), max(full[1], b.Min.Y)
	x1, y1 := min(full[0]+full[2], b.Max.X), min(full[1]+full[3], b.Max.Y)
	inExcl := func(x, y int) bool {
		for _, r := range excl {
			if x >= r[0] && x < r[0]+r[2] && y >= r[1] && y < r[1]+r[3] {
				return true
			}
		}
		return false
	}
	var n, hit int
	for y := y0; y < y1; y++ {
		for x := x0; x < x1; x++ {
			if inExcl(x, y) {
				continue
			}
			r, g, bl, _ := img.At(x, y).RGBA()
			n++
			if nearRGB(uint8(r>>8), uint8(g>>8), uint8(bl>>8), tr, tg, tb, tol) {
				hit++
			}
		}
	}
	if n == 0 {
		return 0
	}
	return round4(float64(hit) / float64(n))
}

func rectStats(img image.Image, name string, rect [4]int) map[string]any {
	return regionStats(img, name, rect[0], rect[1], rect[2], rect[3])
}

// maeRect = mean absolute luminance difference between two images in rect.
func maeRect(a, b image.Image, rect [4]int) float64 {
	x0, y0 := rect[0], rect[1]
	x1, y1 := rect[0]+rect[2], rect[1]+rect[3]
	bb := a.Bounds()
	x0, y0 = max(x0, bb.Min.X), max(y0, bb.Min.Y)
	x1, y1 = min(x1, bb.Max.X), min(y1, bb.Max.Y)
	var n int
	var sum float64
	for y := y0; y < y1; y++ {
		for x := x0; x < x1; x++ {
			ar, ag, ab, _ := a.At(x, y).RGBA()
			br, bg, bb2, _ := b.At(x, y).RGBA()
			la := 0.299*float64(ar>>8) + 0.587*float64(ag>>8) + 0.114*float64(ab>>8)
			lb := 0.299*float64(br>>8) + 0.587*float64(bg>>8) + 0.114*float64(bb2>>8)
			d := la - lb
			if d < 0 {
				d = -d
			}
			sum += d
			n++
		}
	}
	if n == 0 {
		return 0
	}
	return round4(sum / float64(n))
}

// colorRowSpan finds the topmost and bottommost rows in rect whose share of
// matched pixels across the row is >= thresh (used for the C04 bar extent).
func colorRowSpan(img image.Image, rect [4]int, tr, tg, tb uint8, tol int, thresh float64) (top, bottom int, found bool) {
	for y := rect[1]; y < rect[1]+rect[3]; y++ {
		if y >= img.Bounds().Max.Y {
			break
		}
		var n, hit int
		for x := rect[0]; x < rect[0]+rect[2]; x++ {
			if x >= img.Bounds().Max.X {
				continue
			}
			r, g, bl, _ := img.At(x, y).RGBA()
			n++
			if nearRGB(uint8(r>>8), uint8(g>>8), uint8(bl>>8), tr, tg, tb, tol) {
				hit++
			}
		}
		if n > 0 && float64(hit)/float64(n) >= thresh {
			if !found {
				top, found = y, true
			}
			bottom = y
		}
	}
	return
}

// whiteCentroidX = centroid x of near-white pixels in rect + their ratio.
func whiteCentroidX(img image.Image, rect [4]int) (cx float64, ink float64) {
	var n, sumX, hits int
	for y := rect[1]; y < rect[1]+rect[3]; y++ {
		for x := rect[0]; x < rect[0]+rect[2]; x++ {
			r, g, bl, _ := img.At(x, y).RGBA()
			n++
			if uint8(r>>8) >= 200 && uint8(g>>8) >= 200 && uint8(bl>>8) >= 200 {
				sumX += x
				hits++
			}
		}
	}
	if n == 0 || hits == 0 {
		return 0, 0
	}
	return round2(float64(sumX) / float64(hits)), round4(float64(hits) / float64(n))
}

// inkRowBands counts contiguous bands of rows (within rect) whose near-white
// pixel share >= thresh — a cheap proxy for "how many text lines". A gap of
// up to gapRows consecutive non-hitting rows is bridged (CJK glyph lines have
// sparse rows between ascender/descender strokes), so one text line is not
// split into multiple bands.
func inkRowBands(img image.Image, rect [4]int, thresh float64) int {
	return inkRowBandsGap(img, rect, thresh, 6)
}

func inkRowBandsGap(img image.Image, rect [4]int, thresh float64, gapRows int) int {
	bands, inBand := 0, false
	gap := 0
	for y := rect[1]; y < rect[1]+rect[3]; y++ {
		var n, hit int
		for x := rect[0]; x < rect[0]+rect[2]; x++ {
			r, g, bl, _ := img.At(x, y).RGBA()
			n++
			if uint8(r>>8) >= 200 && uint8(g>>8) >= 200 && uint8(bl>>8) >= 200 {
				hit++
			}
		}
		rowHit := n > 0 && float64(hit)/float64(n) >= thresh
		if rowHit {
			if !inBand {
				bands++
				inBand = true
			}
			gap = 0
		} else if inBand {
			gap++
			if gap > gapRows {
				inBand = false
				gap = 0
			}
		}
	}
	return bands
}

func countStatus(cx *caseCtx, status string) int {
	n := 0
	for _, r := range cx.keyRecs {
		if r.Status == status {
			n++
		}
	}
	return n
}

func probeFrameList(cfg *caseCfg) []int {
	out := make([]int, 0, len(cfg.probes))
	for _, p := range cfg.probes {
		out = append(out, p.Frame)
	}
	return out
}

func (cx *caseCtx) buildReport(cfg *caseCfg) map[string]any {
	var samples, probes []sampleRec
	for _, f := range cfg.keyframes {
		samples = append(samples, *cx.keyRecs[f])
	}
	for _, p := range cfg.probes {
		probes = append(probes, *cx.probeRecs[p.Frame])
	}
	var degradations []string
	seen := map[string]bool{}
	for _, k := range cfg.keyframes {
		for _, n := range cx.keyRecs[k].Notes {
			if !seen[n] {
				seen[n] = true
				degradations = append(degradations, fmt.Sprintf("[F%03d] %s", k, n))
			}
		}
	}
	return map[string]any{
		"d01_status": map[string]any{
			"state":           cx.d01.State,
			"detail":          cx.d01.Detail,
			"checked_at":      time.Now().Format(time.RFC3339),
			"seek_pause_line": cx.d01.CallLn,
			"impact":          map[string]string{"fixed": "fixed => counter digits render on seeked frames in this run; counter expectations were asserted against the FIXED renderer", "unfixed": "unfixed => counter digits render empty on every seeked frame in this run; all counter-related keyframe expectations recorded as fail(D-01) or noted"}[cx.d01.State],
		},
		"layer":  "L1",
		"run_id": cx.runID,
		"case":   cfg.caseID,
		"env": map[string]any{
			"chrome":   cx.chrome,
			"ffmpeg":   cx.ffVer,
			"go":       runtime.Version(),
			"os":       runtime.GOOS + "/" + runtime.GOARCH,
			"capx":     "github.com/haozing/ploykit/platform/capx (local headless chrome, pool=1)",
			"chromedp": "real browser process — frame loop via CDP Page.captureScreenshot",
		},
		"recipe": map[string]any{
			"ir_source_file":  "example/internal/video/testdata/ir/" + cfg.irFile,
			"ir_sha256":       cx.irSHA,
			"width":           cfg.width,
			"height":          cfg.height,
			"fps":             cfg.fps,
			"duration_frames": cfg.durationFrames,
			"frame_formula":   "ceil(durationSec*fps), videoapp.DurationFrames + timeline-builder.js Math.ceil",
		},
		"hard_prompt_assertions": cx.hardPrompts,
		"samples":                samples,
		"probes":                 probes,
		"degradations":           degradations,
		"conversions_ref":        "example/internal/video/testdata/spec-audit-report.json (cases[].degradations + cross_cutting_findings X-3/X-4) — conversion rules not duplicated here; this report records RENDER-OBSERVED deltas only",
		"totals": map[string]any{
			"frames_planned":       cfg.durationFrames,
			"frames_rendered":      cfg.durationFrames,
			"keyframes_kept":       len(cfg.keyframes),
			"probe_frames_kept":    len(cfg.probes),
			"samples_ok":           countStatus(cx, "ok"),
			"samples_mismatch":     countStatus(cx, "mismatch"),
			"samples_fail":         countStatus(cx, "fail"),
			"samples_degraded_na":  countStatus(cx, "degraded_na"),
			"render_total_ms":      cx.renderTotal.Milliseconds(),
			"render_ms_per_frame":  round2(float64(cx.renderTotal.Milliseconds()) / float64(cfg.durationFrames)),
			"render_wall_clock":    cx.renderTotal.Round(time.Second).String(),
			"full_loop_under_8min": cx.renderTotal < 8*time.Minute,
		},
		"evidence": map[string]any{
			"golden_dir":         "example/internal/video/testdata/golden/" + cfg.goldenSub + "/",
			"meta_json":          "example/internal/video/testdata/golden/" + cfg.goldenSub + "/meta.json",
			"report_json":        "example/internal/video/testdata/" + cfg.reportFile,
			"ir_sha256":          cx.irSHA,
			"anchor_resolutions": cx.resJSON,
			"html_bytes":         cx.htmlLen,
			"timeline_id":        timelineID,
			"chrome_real_render": fmt.Sprintf("chrome=%s rendered %d frames in %s", cx.chrome, cfg.durationFrames, cx.renderTotal.Round(time.Millisecond)),
			"frames_table":       "example/internal/video/testdata/ir/" + cfg.framesFile,
			"spec_audit":         "example/internal/video/testdata/spec-audit-report.json",
			"plan_doc":           "docs/plan-agent-video-studio-case-library-and-test-plan-2026-11-15.md §4.2/§4.4/§7.0/§7.2",
			"delivery_audit":     "docs/delivery-audit-video-studio-round1-2026-11-15.md §1.2/§2.1",
		},
	}
}

// setStatus helper on keyframe records.
func (cx *caseCtx) set(frame int, status, actual string, notes ...string) {
	rec := cx.keyRecs[frame]
	rec.Status = status
	rec.Actual = actual
	rec.Notes = notes
	cx.t.Logf("F%-4d status=%s actual=%s", frame, status, actual)
	for _, n := range notes {
		cx.t.Logf("       note: %s", n)
	}
}

// =====================================================================
// VS-C04 — 数据可视化口播（1920x1080@30, 1800 frames）
// =====================================================================

var (
	c4RTitle   = [4]int{960, 180, 840, 80}
	c4RBarZone = [4]int{100, 440, 560, 370}
	c4RBar22   = [4]int{180, 440, 120, 370}
	c4RBar23   = [4]int{360, 440, 120, 370}
	c4RBar24   = [4]int{540, 440, 120, 370}
	c4RLine    = [4]int{800, 360, 440, 300}
	c4RRing    = [4]int{1380, 380, 280, 280}
	c4RRingNum = [4]int{1460, 500, 160, 60}
	c4RNote    = [4]int{80, 830, 900, 40}
	c4RCounter = [4]int{0, 0, 400, 150}
	c4RCaption = [4]int{660, 980, 600, 60}
	c4RFull    = [4]int{0, 0, 1920, 1080}
)

func TestL1RenderC04Keyframes(t *testing.T) {
	runCase(t, &caseCfg{
		caseID:         "VS-C04",
		irFile:         "c04.degraded.json",
		framesFile:     "c04.frames.json",
		goldenSub:      "c04",
		reportFile:     "l1-c04-report.json",
		fps:            30,
		width:          1920,
		height:         1080,
		durationFrames: 1800,
		keyframes:      []int{0, 24, 180, 216, 540, 720, 900, 960, 1260, 1620, 1799},
		probes: []probeSpec{
			{196, "bar22-entry-pre"}, {198, "bar22-entry-series"}, {200, "bar22-growing"},
			{204, "bar22-growing"}, {210, "bar22-growing"}, {916, "highlight-peak-occlusion-proof"},
		},
		post: c04Post,
	})
}

func c04Post(cx *caseCtx) {
	t := cx.t
	blue := func(img image.Image, r [4]int) float64 { return shareNear(img, r, 46, 134, 222, 22) }
	amber := func(img image.Image, r [4]int) float64 { return shareNear(img, r, 245, 166, 35, 22) }
	navy := func(img image.Image, r [4]int) float64 { return shareNear(img, r, 31, 58, 95, 34) }
	gray := func(img image.Image, r [4]int) float64 { return shareNear(img, r, 91, 107, 127, 30) }
	cream := func(img image.Image, r [4]int) float64 { return shareNear(img, r, 242, 245, 249, 12) }
	img := func(f int) image.Image { return cx.imgs[f] }

	// ---- probe: bar22 entry series (frames.json claims grow begins 186±2;
	//      actual IR anchor 二零二二@6.6s => 198) ----
	entrySeries := []int{180, 196, 198, 200, 204, 210, 216}
	entry := cx.probeRecs[198]
	bar22Entry := -1
	for i := 1; i < len(entrySeries); i++ {
		fPrev, f := entrySeries[i-1], entrySeries[i]
		sh := blue(img(f), c4RBar22)
		entry.StructureChecks[fmt.Sprintf("f%d_blue_share", f)] = sh
		entry.StructureChecks[fmt.Sprintf("f%d_mae_vs_prev", f)] = maeRect(img(fPrev), img(f), c4RBar22)
		if bar22Entry < 0 && sh > 0.02 {
			bar22Entry = f
		}
	}
	entry.StructureChecks["bar22_first_visible_frame"] = bar22Entry
	entry.StructureChecks["frames_json_claimed_entry"] = "186±2"
	t.Logf("probe: bar22 first visible frame = %d (frames.json claimed 186±2)", bar22Entry)

	// ---- probe: highlight peak occlusion proof (canvas bg flash would be
	//      FULL amber if visible; el_bg occludes; ring excluded — it is the
	//      same #F5A623 and legitimately visible from F939) ----
	hp := cx.probeRecs[916]
	amberOutsideRing := shareNearOutside(img(916), c4RFull, 245, 166, 35, 22, c4RRing, c4RRingNum)
	hp.StructureChecks["full_frame_amber_share_at_peak_excl_ring"] = amberOutsideRing
	hp.StructureChecks["ring_amber_share_at_peak"] = amber(img(916), c4RRing)
	hp.StructureChecks["window_math"] = "ef_hl_growth 锚 产业@30.3s→F909；上冲 0.25s(7.5f)→峰值 ≈F916.5；回落至 ≈F934。环自身从 F909 scaleIn（同为 #F5A623），全帧统计须排除环矩形"
	if amberOutsideRing < 0.005 {
		hp.StructureChecks["verdict"] = "occluded (amber ~0 outside ring at mathematical peak 916 — canvas flash invisible behind el_bg)"
	} else {
		hp.StructureChecks["verdict"] = "VISIBLE-OUTSIDE-RING"
	}
	t.Logf("probe: F916 amber excl-ring = %v -> %v", hp.StructureChecks["full_frame_amber_share_at_peak_excl_ring"], hp.StructureChecks["verdict"])

	// ---- keyframes ----
	// F0
	f0 := img(0)
	c0 := cx.keyRecs[0].StructureChecks
	c0["title_navy_share"] = navy(f0, c4RTitle)
	c0["bar22_blue_share"] = blue(f0, c4RBar22)
	c0["bar23_blue_share"] = blue(f0, c4RBar23)
	c0["bar24_blue_share"] = blue(f0, c4RBar24)
	c0["line_blue_share"] = blue(f0, c4RLine)
	c0["ring_amber_share"] = amber(f0, c4RRing)
	c0["note_gray_share"] = gray(f0, c4RNote)
	c0["counter_origin_ink_share"] = round4(1 - cream(f0, c4RCounter))
	c0["caption_ink_share"] = gray(f0, c4RCaption)
	ok0 := c0["title_navy_share"].(float64) < 0.05 &&
		c0["bar22_blue_share"].(float64) < 0.01 &&
		c0["line_blue_share"].(float64) < 0.01 &&
		c0["ring_amber_share"].(float64) < 0.01
	if ok0 {
		cx.set(0, "ok", "标题卡 scale=0 未显示；柱/线/环/说明全部未显示（fromTo immediateRender 使各 scaleIn 元素在锚点前保持 from 态 scale=0）；counter host 空文本（D-01）；画面仅 el_bg #F2F5F9——符合降级预期",
			"全部元素已挂载 DOM（C04-D6 无显隐区间），最早锚点 6.2s→F186")
	} else {
		cx.set(0, "fail", "F0 出现了不应存在的前景内容", fmt.Sprintf("checks=%v", c0))
	}

	// F24
	f24 := img(24)
	c24 := cx.keyRecs[24].StructureChecks
	c24["title_navy_share"] = navy(f24, c4RTitle)
	if c24["title_navy_share"].(float64) >= 0.01 {
		cx.set(24, "ok", fmt.Sprintf("标题 scaleIn 落定（24/24 帧），墨水占比 %.1f%%（A-C04-01 视觉断言前置）", c24["title_navy_share"].(float64)*100))
	} else {
		cx.set(24, "fail", "标题墨水缺失", fmt.Sprintf("navy=%.4f", c24["title_navy_share"].(float64)))
	}

	// F180
	f180 := img(180)
	c180 := cx.keyRecs[180].StructureChecks
	c180["bar22_blue_share"] = blue(f180, c4RBar22)
	c180["bar_zone_blue_share"] = blue(f180, c4RBarZone)
	c180["bar22_first_visible_frame_probe"] = bar22Entry
	if bar22Entry > 0 && (bar22Entry < 184 || bar22Entry > 188) {
		cx.set(180, "mismatch",
			fmt.Sprintf("F180 柱区无蓝色（bar22 share=%.4f）——帧表称 bar22 生长在 186±2 帧开始，实际 first-visible=帧 %d", c180["bar22_blue_share"], bar22Entry),
			"期望 vs 实际：帧表把生长锚写成 w05'总量'第2次出现≈6.2s→186；降级 IR 实际生长锚是'二零二二'(w05, 6.6s)→F198。锚词标注与 IR 不一致，M2 需统一口径（相机 pan 锚'总量'occ1=6.2s→F186 才与帧表一致）")
	} else if bar22Entry > 0 {
		cx.set(180, "ok", fmt.Sprintf("bar22 于帧 %d 进入（窗口内）", bar22Entry))
	} else {
		cx.set(180, "fail", "bar22 全程未出现（探针系列无蓝色）")
	}

	// F216
	f216 := img(216)
	c216 := cx.keyRecs[216].StructureChecks
	c216["bar22_blue_share"] = blue(f216, c4RBar22)
	c216["bar23_blue_share"] = blue(f216, c4RBar23)
	c216["bar24_blue_share"] = blue(f216, c4RBar24)
	top, bottom, found := colorRowSpan(f216, c4RBar22, 46, 134, 222, 22, 0.05)
	if found {
		c216["bar22_top_row"] = top
		c216["bar22_bottom_row"] = bottom
		c216["bar22_final_baseline_row"] = 800 // y620+h180
		c216["bar22_baseline_gap_px"] = 800 - bottom
	}
	b22 := c216["bar22_blue_share"].(float64)
	b23 := c216["bar23_blue_share"].(float64)
	b24 := c216["bar24_blue_share"].(float64)
	if b22 > 0.05 && b23 < 0.01 && b24 < 0.01 {
		notes := []string{
			fmt.Sprintf("期望 vs 实际：帧表称 F216 三柱全可见（柱高比例 180:240:330）；实际仅 bar22 可见（share=%.2f，b23=%.3f b24=%.3f）——bar23 生长锚 8.7s→F261、bar24 锚 10.1s→F303 都未到；三柱最早同屏 ≈F327（10.9s，bar24 落定）", b22, b23, b24),
		}
		if found && 800-bottom > 2 {
			notes = append(notes, fmt.Sprintf("T-11 降级实证：整柱中心 scaleIn（transformOrigin 50%% 50%%）——F216 生长进行中（198+24 帧的 75%%），柱底悬空 %dpx（bottom_row=%d vs 最终基线 800）；'自底部立起'与'柱顶 y≈620±10'检查在入场帧均不可评", 800-bottom, bottom))
		} else {
			notes = append(notes, "T-11 降级实证：柱为整柱中心 scaleIn，非底部基线生长")
		}
		notes = append(notes, "counter 数字不贴柱顶（T-10 降级）：ef_bar24_cnt 自建 div 固定画布左上 (0,0)，柱顶金额标签省略")
		cx.set(216, "mismatch", fmt.Sprintf("1/3 柱可见（bar22 share=%.2f），柱底悬空=%vpx（中心缩放）", b22, c216["bar22_baseline_gap_px"]), notes...)
	} else {
		cx.set(216, "fail", fmt.Sprintf("柱可见性不符合单柱预期 b22=%.3f b23=%.3f b24=%.3f", b22, b23, b24))
	}

	// F540
	f540 := img(540)
	c540 := cx.keyRecs[540].StructureChecks
	c540["line_blue_share"] = blue(f540, c4RLine)
	c540["bar_zone_blue_share"] = blue(f540, c4RBarZone)
	c540["ring_amber_share"] = amber(f540, c4RRing)
	c540["counter_origin_ink_share"] = round4(1 - cream(f540, c4RCounter))
	ls := c540["line_blue_share"].(float64)
	cntInk540 := c540["counter_origin_ink_share"].(float64)
	if ls < 0.01 {
		notes := []string{
			"三柱此时全部立起；camera pan（186→546，末端 -60px）进行至 98%，柱位偏左 ≈59px",
			"期望 vs 实际：'首点 3.0% 应在左下'不成立——9 帧后出现的也只是一块 440×300 实心蓝矩形（C04-D1 降级，无三点几何、无逐段描线），标签与纵轴刻度静态文本兜底未配置",
			fmt.Sprintf("counter ef_bar24_cnt 窗口 303–339 已过：F540 为窗口后定格态。ink=%.4f（%.0f%%）——D-01 已修（pause 双参）时这是 onUpdate 停更后的最终值定格（to=1349084 亿元 滚动完的静态尾值）；D-01 未修时应为 0", cntInk540, cntInk540*100),
		}
		cx.set(540, "mismatch",
			fmt.Sprintf("F540 折线区无蓝色（share=%.4f）——帧表称折线区 18.0s 出现；实际 IR 锚'增速'occ1=18.3s→F549（差 9 帧）", ls),
			notes...)
	} else {
		cx.set(540, "ok", fmt.Sprintf("折线区蓝色 %.2f（早于预期出现）", ls))
	}

	// F720
	f720 := img(720)
	c720 := cx.keyRecs[720].StructureChecks
	c720["line_blue_share"] = blue(f720, c4RLine)
	ls = c720["line_blue_share"].(float64)
	if ls >= 0.9 {
		cx.set(720, "ok", fmt.Sprintf("折线区蓝色占比 %.2f——整块实心矩形可见（draw 于 F549 起 60 帧，F609 落定）", ls),
			"降级（重要）：el_line 是 440×300 实心矩形 shape，非折线——三点几何完全丢失，A-C04-03 '点2(5.2%) y 高于点1/点3' 降级不适用（区域几何无点可判）",
			"整线 scaleIn 后无逐段生长动画（C04-D1）：'先点后线'节奏与口播 S4 不同步")
	} else {
		cx.set(720, "fail", fmt.Sprintf("折线区蓝色 %.2f < 0.9（实心矩形应近满）", ls))
	}

	// F900
	f900 := img(900)
	c900 := cx.keyRecs[900].StructureChecks
	c900["ring_amber_share"] = amber(f900, c4RRing)
	c900["ring_num_navy_share"] = navy(f900, c4RRingNum)
	c900["full_frame_amber_share"] = amber(f900, c4RFull)
	rs := c900["ring_amber_share"].(float64)
	if rs < 0.01 {
		cx.set(900, "mismatch",
			fmt.Sprintf("F900（文档封面候选帧）环区无橙色（share=%.4f）——IR 锚'产业'=30.3s→F909，环 scaleIn 30 帧至 F939 落定；封面候选帧不含主图", rs),
			"期望 vs 实际：文档选 900 为封面候选，但锚点使环 F909 才入场——封面帧取 900 得到的是'标题+三柱+实心矩形'无环画面；M2 若要环入封面需改锚词或取 F939+",
			"highlight 窗口 909→934 此刻也未开始")
	} else {
		cx.set(900, "ok", fmt.Sprintf("环可见 amber=%.2f", rs))
	}

	// F960 — counter window is 957–975 (anchor 31.9s, dur min(1.2, 60-31.9)=1.2s);
	// with D-01 FIXED the digits roll on seeked frames; white 96px text on
	// cream bg is still the T-10 contrast defect.
	f960 := img(960)
	c960 := cx.keyRecs[960].StructureChecks
	c960["ring_amber_share"] = amber(f960, c4RRing)
	c960["ring_num_navy_share"] = navy(f960, c4RRingNum)
	c960["counter_origin_ink_share"] = round4(1 - cream(f960, c4RCounter))
	ringOK := c960["ring_amber_share"].(float64) >= 0.5
	numOK := c960["ring_num_navy_share"].(float64) >= 0.01
	cnt := c960["counter_origin_ink_share"].(float64)
	switch {
	case ringOK && numOK && cnt >= 0.005:
		cx.set(960, "ok",
			fmt.Sprintf("环可见（amber=%.2f，实为 280×280 圆角方块非圆环）、静态 56.7%% 环心数字可见（navy=%.3f）、counter 数字可见（origin ink=%.4f）——D-01 修复已在像素层证实", c960["ring_amber_share"], c960["ring_num_navy_share"], cnt),
			"D-01 状态：seekTimeline pause(t,false) 双参已落地（渲染前由并行 agent 修入）——counter onUpdate 在 seek 中触发，数字滚动可见",
			"降级遗留 ①：counter div 仍堆在画布 (0,0) 而非环心（T-10 定位缺陷，帧表'counter 在画布左上'预判被证实）",
			"降级遗留 ②：counter 96px/700 白字（projector.go .el-text.counter 默认 color:#fff）在 #F2F5F9 浅底上不可读——数字'可见'但不可'可读'（M2 需配色）",
			"降级遗留 ③：环形状退化为圆角方块（C04-D7）：border-radius 8px，无 56.7/43.3 扇区划分")
	case ringOK && numOK:
		cx.set(960, "fail",
			fmt.Sprintf("环与静态数字可见，但 counter 数字缺失（origin ink=%.4f）——D-01 未修状态", cnt),
			"KNOWN DEFECT D-01：ef_ring_cnt 锚 31.9s→F957，F960 在窗口内但 seekTimeline 单参 pause 抑制 onUpdate——textContent 恒空")
	default:
		cx.set(960, "fail", fmt.Sprintf("环或环心数字缺失 ring=%.3f num=%.4f", c960["ring_amber_share"], c960["ring_num_navy_share"]))
	}

	// F1260
	f1260 := img(1260)
	c1260 := cx.keyRecs[1260].StructureChecks
	c1260["bar22_blue_share"] = blue(f1260, c4RBar22)
	c1260["bar23_blue_share"] = blue(f1260, c4RBar23)
	c1260["bar24_blue_share"] = blue(f1260, c4RBar24)
	c1260["line_blue_share"] = blue(f1260, c4RLine)
	c1260["ring_amber_share"] = amber(f1260, c4RRing)
	c1260["full_frame_amber_share_excl_ring"] = shareNearOutside(f1260, c4RFull, 245, 166, 35, 22, c4RRing, c4RRingNum)
	c1260["highlight_probe_f916_verdict"] = hp.StructureChecks["verdict"]
	threeUp := c1260["bar22_blue_share"].(float64) > 0.05 && c1260["bar23_blue_share"].(float64) > 0.05 && c1260["bar24_blue_share"].(float64) > 0.05 &&
		c1260["line_blue_share"].(float64) > 0.5 && c1260["ring_amber_share"].(float64) > 0.5
	if threeUp && c1260["full_frame_amber_share_excl_ring"].(float64) < 0.005 {
		cx.set(1260, "mismatch",
			"三图同屏原尺寸（镜5 60% 缩略未实现，符合降级预期）；但帧表称本帧'ef_hl_growth 高亮触发'不成立——高亮锚'产业'=30.3s→F909，窗口 909–934，F1260 早已结束",
			"期望 vs 实际（更强）：高亮在其窗口内也不可见——作用目标为 #canvas 整层（timeline-builder.js target=canvas），被全画布 el_bg #F2F5F9 完全遮挡；F916 探针证明峰值帧除环外全画布 amber≈0（C04-D8 实测强于文档'整屏闪现'——闪现根本穿不透）",
			"camera pan 已于 F546 结束，三柱静止在最终位 x=120/300/480（-60px 平移完成）")
	} else {
		cx.set(1260, "fail", fmt.Sprintf("三图或无高亮预期不成立 checks=%v", c1260))
	}

	// F1620 — A-C04-04 hard prompt: degraded_na
	f1620 := img(1620)
	c1620 := cx.keyRecs[1620].StructureChecks
	c1620["bar_zone_blue_share"] = blue(f1620, c4RBarZone)
	c1620["note_gray_share"] = gray(f1620, c4RNote)
	c1620["doc_assertion"] = "A-C04-04 柱图区蓝色像素 ≤2%"
	cx.hardPrompts = append(cx.hardPrompts, map[string]any{
		"id": "A-C04-04", "frame": 1620,
		"verdict":  "degraded_na",
		"measured": fmt.Sprintf("bar_zone_blue_share=%.4f (%.1f%%)", c1620["bar_zone_blue_share"], c1620["bar_zone_blue_share"].(float64)*100),
		"reason":   "无元素卸载（C04-D6）：三图常驻 DOM 至片尾，蓝色像素必然 ≫2%；断言按 spec-audit 指示标记降级不适用，实测值留档",
	})
	cx.set(1620, "degraded_na",
		fmt.Sprintf("柱图区蓝色 %.1f%%（≫2%% 阈值）——'片尾说明卡覆盖'不成立：el_note 只是一条 900×40 灰字注释行（y830, z=10），不遮挡任何图（柱 z=5 只被更高 z 覆盖其自身矩形）", c1620["bar_zone_blue_share"].(float64)*100),
		"A-C04-04 降级不适用（hard prompt #1）；说明卡灰色文字可见", fmt.Sprintf("gray=%.4f", c1620["note_gray_share"].(float64)))

	// F1799
	f1799 := img(1799)
	c1799 := cx.keyRecs[1799].StructureChecks
	c1799["note_gray_share"] = gray(f1799, c4RNote)
	c1799["bar_zone_blue_share"] = blue(f1799, c4RBarZone)
	c1799["duration_frames_rendered"] = 1800
	if c1799["note_gray_share"].(float64) >= 0.005 && c1799["bar_zone_blue_share"].(float64) >= 0.05 {
		cx.set(1799, "ok", "尾帧：说明卡保持、三图保持（无淡出）；DurationFrames=1800（ceil 单源）帧循环完整渲染",
			"BGM 淡出/loudnorm/amix 截断不属本链路（L1 still 无音轨；L2 已单独覆盖）")
	} else {
		cx.set(1799, "fail", fmt.Sprintf("尾帧内容缺失 note=%.4f bars=%.3f", c1799["note_gray_share"], c1799["bar_zone_blue_share"]))
	}
}

// =====================================================================
// VS-C06 — 双人对谈/字幕（1920x1080@25, 2250 frames）
// =====================================================================

var (
	c6RShotA      = [4]int{40, 40, 880, 700} // upper shotA zone (excludes name strip)
	c6RShotAFull  = [4]int{0, 0, 960, 1080}
	c6RShotB      = [4]int{1000, 40, 880, 700}
	c6RShotBFull  = [4]int{960, 0, 960, 1080}
	c6RDivider    = [4]int{956, 0, 8, 1080}
	c6RNameA      = [4]int{60, 860, 440, 50}
	c6RNameAStrip = [4]int{50, 850, 460, 70}
	c6RNameB      = [4]int{1020, 860, 420, 50}
	c6RNameBStrip = [4]int{1010, 850, 440, 70}
	c6RCaption    = [4]int{600, 950, 900, 130}
	c6RCapWide    = [4]int{440, 950, 1140, 140} // covers x 480..1580 (both caption resting positions)
	c6REndline    = [4]int{660, 760, 600, 50}
	c6RBorderL    = [4]int{0, 0, 30, 1080}
)

func TestL1RenderC06Keyframes(t *testing.T) {
	runCase(t, &caseCfg{
		caseID:         "VS-C06",
		irFile:         "c06.degraded.json",
		framesFile:     "c06.frames.json",
		goldenSub:      "c06",
		reportFile:     "l1-c06-report.json",
		fps:            25,
		width:          1920,
		height:         1080,
		durationFrames: 2250,
		keyframes:      []int{0, 20, 225, 450, 675, 900, 1125, 1350, 1800, 2025, 2249},
		probes: []probeSpec{
			// name-strip switch segment (the doc's ONLY valid frame-diff point)
			{224, "switch-pre"}, {226, "switch-pre"}, {227, "switch-pre"}, {228, "switch-pre"},
			{229, "switch-pre"}, {230, "name-strip-switch-onset"}, {231, "switch-post"}, {232, "switch-post"},
			// caption move + canvas pulse segment
			{450, "pulse-base"}, {460, "pulse-pre"}, {462, "pulse-pre"}, {464, "caption-move-canvas-pulse-series"},
			{466, "pulse-rise"}, {468, "pulse-peak"}, {470, "pulse-fall"}, {472, "pulse-fall"},
			{474, "pulse-end"}, {476, "pulse-after"}, {478, "pulse-after"},
			// highlight window occlusion proof (anchor 团队#0 0.95s => F24, peak ~F28, gone by ~F51)
			{24, "hl-rise"}, {28, "hl-peak"}, {32, "highlight-occlusion-series"}, {38, "hl-hold-end"}, {46, "hl-fade"},
		},
		post: c06Post,
	})
}

func c06Post(cx *caseCtx) {
	t := cx.t
	navyA := func(img image.Image, r [4]int) float64 { return shareNear(img, r, 30, 37, 48, 16) }
	navyB := func(img image.Image, r [4]int) float64 { return shareNear(img, r, 37, 30, 48, 16) }
	divC := func(img image.Image, r [4]int) float64 { return shareNear(img, r, 42, 49, 59, 16) }
	blueT := func(img image.Image, r [4]int) float64 { return shareNear(img, r, 46, 134, 222, 28) }
	purpleT := func(img image.Image, r [4]int) float64 { return shareNear(img, r, 126, 87, 194, 28) }
	white := func(img image.Image, r [4]int) float64 { return rectStats(img, "w", r)["white_ratio"].(float64) }
	img := func(f int) image.Image { return cx.imgs[f] }

	// ---- probe: name-strip switch onset 224-232 (doc's 唯一有效帧差断言点) ----
	switchSeries := []int{224, 225, 226, 227, 228, 229, 230, 231, 232}
	so := cx.probeRecs[230]
	onset := -1
	for i := 1; i < len(switchSeries); i++ {
		fPrev, f := switchSeries[i-1], switchSeries[i]
		mae := maeRect(img(fPrev), img(f), c6RNameBStrip)
		sh := purpleT(img(f), c6RNameB)
		so.StructureChecks[fmt.Sprintf("f%d_strip_mae_vs_prev", f)] = mae
		so.StructureChecks[fmt.Sprintf("f%d_purple_share", f)] = sh
		if onset < 0 && (mae > 0.1 || sh > 0.002) {
			onset = f
		}
	}
	so.StructureChecks["onset_frame"] = onset
	so.StructureChecks["doc_window"] = "230±2 (w05 窄场景#2 @9.2s)"
	so.StructureChecks["verdict"] = map[bool]string{true: "in-window", false: "OUT-OF-WINDOW"}[onset >= 228 && onset <= 232]
	t.Logf("probe: nameB switch onset = frame %d (window 228-232) verdict=%s", onset, so.StructureChecks["verdict"])

	// ---- probe: caption move + canvas pulse 450-478 ----
	pulseSeries := []int{450, 460, 462, 464, 466, 468, 470, 472, 474, 476, 478}
	pb := cx.probeRecs[464]
	captionMoveAt := -1
	pulseOn := -1
	pulseOff := -1
	for i := 1; i < len(pulseSeries); i++ {
		fPrev, f := pulseSeries[i-1], pulseSeries[i]
		cxp, _ := whiteCentroidX(img(f), c6RCapWide)
		border := maeRect(img(fPrev), img(f), c6RBorderL)
		pb.StructureChecks[fmt.Sprintf("f%d_caption_centroid_x", f)] = cxp
		pb.StructureChecks[fmt.Sprintf("f%d_border_mae_vs_prev", f)] = border
		if captionMoveAt < 0 && cxp > 1000 {
			captionMoveAt = f
		}
		if pulseOn < 0 && border > 0.05 {
			pulseOn = f
		}
		if pulseOn > 0 && pulseOff < 0 && border <= 0.05 && f > pulseOn+1 {
			pulseOff = f
		}
	}
	pb.StructureChecks["caption_first_moved_frame"] = captionMoveAt
	pb.StructureChecks["canvas_pulse_on_frame"] = pulseOn
	pb.StructureChecks["canvas_pulse_off_frame"] = pulseOff
	pb.StructureChecks["x4_verdict"] = "pulse 目标为 #canvas 整层（X-4）：border MAE 在 464-476 窗口非零即整画布 1.06 缩放的直接证据"
	t.Logf("probe: caption first moved frame=%d, canvas pulse on=%d off=%d (X-4: pulse targets whole canvas)", captionMoveAt, pulseOn, pulseOff)

	// ---- probe: highlight window occlusion 24-46 ----
	hlSeries := []int{20, 24, 28, 32, 38, 46}
	hl := cx.probeRecs[32]
	hlMaxBlue := 0.0
	for _, f := range hlSeries {
		shA := blueT(img(f), c6RShotA)
		shB := blueT(img(f), c6RShotB)
		hl.StructureChecks[fmt.Sprintf("f%d_shotA_blue_share", f)] = shA
		hl.StructureChecks[fmt.Sprintf("f%d_shotB_blue_share", f)] = shB
		if shA > hlMaxBlue {
			hlMaxBlue = shA
		}
	}
	hl.StructureChecks["max_shotA_blue_share_in_window"] = hlMaxBlue
	hl.StructureChecks["verdict"] = map[bool]string{true: "occluded (双 shot 全覆盖 canvas，蓝色分量无抬升)", false: "VISIBLE"}[hlMaxBlue < 0.01]
	hl.StructureChecks["window_math"] = "ef_hl_turn 锚 团队#0=0.95s→F24；上冲 0.18s→峰值 ≈F28；hold 至 F36；回落至 ≈F51——窗口在本系列内，但被遮挡"
	t.Logf("probe: highlight window max shotA blue = %.4f -> %s", hlMaxBlue, hl.StructureChecks["verdict"])

	// ---- keyframes ----
	// F0
	f0 := img(0)
	c0 := cx.keyRecs[0].StructureChecks
	c0["shotA_navy_share"] = navyA(f0, c6RShotA)
	c0["shotB_navy_share"] = navyB(f0, c6RShotB)
	st0 := rectStats(f0, "shotA", c6RShotA)
	c0["shotA_mean_lum"] = st0["mean_lum"]
	c0["divider_share"] = divC(f0, c6RDivider)
	c0["nameA_blue_share"] = blueT(f0, c6RNameA)
	c0["caption_white_ratio"] = white(f0, c6RCaption)
	c0["caption_centroid_x"], _ = whiteCentroidX(f0, c6RCapWide)
	if c0["shotA_navy_share"].(float64) < 0.05 && c0["shotB_navy_share"].(float64) < 0.05 &&
		c0["divider_share"].(float64) >= 0.40 && c0["nameA_blue_share"].(float64) < 0.005 {
		cx.set(0, "ok", "双机位 shape scale=0（scaleIn 从 t=0）→ 画面全黑（#stage #000），中线可见，姓名条未亮起",
			"降级注记（C06-D1）：双机位素材为两块纯色 shape，无肖像画面；'亮起/压暗'只有 scaleIn 可用（C06-D4 无 opacity 动画）",
			"渲染发现（immediateRender）：el_captionZh 的 move fromTo 在构建时立即施加 from 态——字幕自 F0 起就位于 x=480（布局 x=660 从未呈现）", fmt.Sprintf("质心 x≈%v", c0["caption_centroid_x"]))
	} else {
		cx.set(0, "fail", fmt.Sprintf("F0 画面不符合全黑预期 checks=%v", c0))
	}

	// F20
	f20 := img(20)
	c20 := cx.keyRecs[20].StructureChecks
	c20["shotA_navy_share"] = navyA(f20, c6RShotA)
	c20["shotB_navy_share"] = navyB(f20, c6RShotB)
	c20["nameA_blue_share"] = blueT(f20, c6RNameA)
	c20["caption_white_ratio"] = white(f20, c6RCaption)
	c20["caption_row_bands"] = inkRowBands(f20, c6RCaption, 0.01)
	c20["caption_centroid_x"], _ = whiteCentroidX(f20, c6RCapWide)
	if c20["shotA_navy_share"].(float64) >= 0.9 && c20["shotB_navy_share"].(float64) >= 0.9 && c20["nameA_blue_share"].(float64) >= 0.005 {
		cx.set(20, "ok", fmt.Sprintf("两侧画面落定（navy %.2f/%.2f）；姓名条 A 亮起；字幕 cue1 静态文本可见（white=%.4f，%d 个文本行带，质心 x≈%v 即 x=480 起始位）",
			c20["shotA_navy_share"], c20["shotB_navy_share"], c20["caption_white_ratio"], c20["caption_row_bands"], c20["caption_centroid_x"]),
			"字幕为 IR 手填静态 text（非 BuildCues 动态分组）——此后整片 90s 字幕不再轮换")
	} else {
		cx.set(20, "fail", fmt.Sprintf("F20 落定态不成立 checks=%v", c20))
	}

	// F225 — A-C06-01 hard prompt: degraded_na + valid frame-diff assertion
	f225 := img(225)
	c225 := cx.keyRecs[225].StructureChecks
	stA := rectStats(f225, "lumA", c6RShotAFull)
	stB := rectStats(f225, "lumB", c6RShotBFull)
	c225["left_mean_lum"] = stA["mean_lum"]
	c225["right_mean_lum"] = stB["mean_lum"]
	lA := c225["left_mean_lum"].(float64)
	lB := c225["right_mean_lum"].(float64)
	ratio := 0.0
	if lA > 0 {
		ratio = round2(lB / lA)
	}
	c225["brightness_ratio_right_over_left"] = ratio
	c225["nameB_purple_share"] = purpleT(f225, c6RNameB)
	c225["switch_onset_frame_probe"] = onset
	c225["doc_assertion"] = "A-C06-01 右/左亮度比 ≥1.15"
	cx.hardPrompts = append(cx.hardPrompts, map[string]any{
		"id": "A-C06-01", "frame": 225,
		"verdict":  "degraded_na",
		"measured": fmt.Sprintf("right/left mean_lum = %.2f/%.2f ratio=%.2f（静态纯色双 shot，无压暗机制）", lA, lB, ratio),
		"reason":   "无 opacity 动画类型（C06-D4），fade effect 作用整个 #canvas 会压暗全画面（X-4），降级 IR 不挂 fade——断言在降级渲染下不可判定，实测比值 ≈1.0 留档",
	})
	if onset >= 228 && onset <= 232 && c225["nameB_purple_share"].(float64) < 0.005 {
		cx.set(225, "ok",
			fmt.Sprintf("F225 姓名条 B 未亮起（purple=%.4f）——切换于帧 %d 开始（doc 窗口 230±2 内）；本帧左右亮度比 %.2f（静态，无压暗）",
				c225["nameB_purple_share"], onset, ratio),
			"文档唯一有效帧差断言点：224-232 连续帧差序列见 probes（229→230 起 strip MAE 抬升，之前全零）",
			"A-C06-01 降级不适用（hard prompt #2）")
	} else if onset < 228 || onset > 232 {
		cx.set(225, "fail", fmt.Sprintf("切换 onset=帧%d 超出 228-232 窗口", onset))
	} else {
		cx.set(225, "fail", fmt.Sprintf("F225 nameB 已可见 purple=%.4f（早于 onset=%d）", c225["nameB_purple_share"], onset))
	}

	// F450
	f450 := img(450)
	c450 := cx.keyRecs[450].StructureChecks
	cxp450, _ := whiteCentroidX(f450, c6RCapWide)
	c450["caption_ink_centroid_x"] = cxp450
	c450["nameA_blue_share"] = blueT(f450, c6RNameA)
	c450["nameB_purple_share"] = purpleT(f450, c6RNameB)
	c450["caption_first_moved_frame_probe"] = captionMoveAt
	c450["canvas_pulse_on_frame_probe"] = pulseOn
	if cxp450 > 0 && cxp450 < 1000 && pulseOn >= 464 {
		cx.set(450, "ok",
			fmt.Sprintf("F450 字幕在 x≈480 待移位（质心 ≈%v <1000），pulse 未开始（on=帧%d）——与帧表'450 切回 A，464 起 10 帧移动'的节拍一致", cxp450, pulseOn),
			"渲染发现（immediateRender）：move fromTo 立即施加 from 态——字幕自 F0 起就位于 x=480，el_captionZh 布局 x=660 在整条时间线上从未呈现；F464-474 只是 480→960 的移动（M2：按 480/960 两态记录字幕位置，放弃'自然位 660'口径）",
			"渲染发现（X-4 实证）：ef_pulse_nameA 期望脉冲姓名 div（元素级），实际 pulse 无目标概念、作用于 #canvas 整层——464-476 全画布 1.06 缩放（左边界带 MAE 序列为证），姓名条本身无任何变化（M2 依据：pulse 需元素级目标能力）")
	} else {
		cx.set(450, "fail", fmt.Sprintf("pulse/caption 探针结果异常 centroid=%.2f pulseOn=%d captionMoveAt=%d", cxp450, pulseOn, captionMoveAt))
	}

	// F675
	f675 := img(675)
	c675 := cx.keyRecs[675].StructureChecks
	c675["nameA_blue_share"] = blueT(f675, c6RNameA)
	c675["nameB_purple_share"] = purpleT(f675, c6RNameB)
	cxp675, _ := whiteCentroidX(f675, c6RCapWide)
	c675["caption_ink_centroid_x"] = cxp675
	if c675["nameB_purple_share"].(float64) >= 0.005 && c675["nameA_blue_share"].(float64) >= 0.005 && cxp675 > 1000 {
		cx.set(675, "ok", fmt.Sprintf("B 提问帧：双姓名条保持（降级 IR 无后续切换驱动，C06-D5——帧表同口径）；字幕已停在 x=960 位（质心 ≈%v，474 帧移动完成后再未移动）", cxp675),
			"镜 4/6/8 的说话人切换无锚点动画（fade 已移除）——画面保持镜3 状态，与帧表降级差异声明一致")
	} else {
		cx.set(675, "fail", fmt.Sprintf("姓名条或字幕位缺失 checks=%v", c675))
	}

	// F900
	f900 := img(900)
	c900 := cx.keyRecs[900].StructureChecks
	c900["caption_white_ratio"] = white(f900, c6RCaption)
	c900["caption_row_bands"] = inkRowBands(f900, c6RCaption, 0.01)
	bands := c900["caption_row_bands"].(int)
	if c900["caption_white_ratio"].(float64) >= 0.005 && bands <= 2 {
		cx.set(900, "mismatch",
			fmt.Sprintf("A-C06-02 期望 S5 长句'我们按一周内能否完整交付来卡…'——实际字幕区仍是 S1 静态文本（white=%.4f，%d 行带）：IR 层无 cue 轮换，90s 只有一句字幕", c900["caption_white_ratio"], bands),
			"断行（T-01 DOM 层记录）：36px 文本 pre-wrap 按容器宽度折行——本帧 %d 行带 ≤2 行达标仅因文本短；注意 SRT 层（subtitle.go layoutUnits）已于 round-3 落地 kinsoku + 词完整性换行，但本链路（Player still 渲染）不经过它，DOM 折行风险独立存在",
			"M2 依据：字幕动态轮换（BuildCues→元素）是字幕链路在 IR/Player 侧的缺口")
	} else {
		cx.set(900, "fail", fmt.Sprintf("字幕区异常 white=%.4f bands=%d", c900["caption_white_ratio"], bands))
	}

	// F1125
	f1125 := img(1125)
	c1125 := cx.keyRecs[1125].StructureChecks
	c1125["nameB_purple_share"] = purpleT(f1125, c6RNameB)
	c1125["nameA_blue_share"] = blueT(f1125, c6RNameA)
	if c1125["nameB_purple_share"].(float64) >= 0.005 {
		cx.set(1125, "ok", "B 提问镜6：无驱动切换（C06-D5），画面保持；与帧表降级差异声明一致",
			"L1 帧差断言对这些无驱动镜头按单镜头切片口径执行（帧表已声明会失败，不计 fail）")
	} else {
		cx.set(1125, "fail", "姓名条 B 缺失")
	}

	// F1350 — X-4 FIX (2026-11-15): ef_hl_turn's no-target highlight now
	// paints the VISIBLE z-10000 overlay, so the F24-46 window probe reads
	// max shotA blue = 1 (was ≈0 pre-fix: occluded by the full-cover shots).
	// The pre-fix "occluded-contradiction needs human review" fail branch is
	// obsolete; the frame-table claim "keyword highlight at F1350" is still
	// false — but on timing (window F24-51 long closed), not occlusion.
	f1350 := img(1350)
	c1350 := cx.keyRecs[1350].StructureChecks
	c1350["nameA_blue_share"] = blueT(f1350, c6RNameA)
	c1350["highlight_window_max_shotA_blue_probe"] = hlMaxBlue
	c1350["highlight_probe_verdict"] = hl.StructureChecks["verdict"]
	cx.set(1350, "mismatch",
		"帧表期望本帧'自己加功能'关键词高亮——不成立：ef_hl_turn 锚 团队#0=0.95s→F24（窗口 F24-51），F1350 早已结束",
		fmt.Sprintf("高亮在窗口内 NOW VISIBLE（X-4 修复实证）：F24-46 探针序列 max shotA blue=%.4f——pre-fix ≈0（被全覆盖双 shot 遮挡），修复后 overlay z-10000 全画布可见", hlMaxBlue),
		"本帧实际画面：镜3 状态静止（双姓名条 + S1 静态字幕在 x=960 位）")

	// F1800
	f1800 := img(1800)
	c1800 := cx.keyRecs[1800].StructureChecks
	c1800["caption_white_ratio"] = white(f1800, c6RCaption)
	c1800["caption_row_bands"] = inkRowBands(f1800, c6RCaption, 0.01)
	c1800["english_soft_track_rendered"] = false
	if c1800["caption_white_ratio"].(float64) >= 0.005 {
		cx.set(1800, "mismatch",
			fmt.Sprintf("T-01 重点帧：S9 长句双语——实际仍为 S1 静态文本（%d 行带）；英文软字幕轨完全不渲染（C06-D2）：Player 时间轴无软字幕轨对象，'burn+soft' 双语双轨模式不存在（SubtitleMode ∈ burn|soft|none，service.go:73）", c1800["caption_row_bands"]),
			"本链路（Player still 渲染）根本不经过 burn 路径——SubtitleMode=burn 只在 encode 管线（render_pipeline.go:107-122）生效；本帧字幕区内容 = IR 静态 text，如实记录（验证点成立：渲染输出里字幕区只有 IR 静态文本，无动态字幕）")
	} else {
		cx.set(1800, "fail", "字幕区无内容")
	}

	// F2025
	f2025 := img(2025)
	c2025 := cx.keyRecs[2025].StructureChecks
	c2025["endline_white_ratio"] = white(f2025, c6REndline)
	if c2025["endline_white_ratio"].(float64) < 0.005 {
		cx.set(2025, "mismatch",
			fmt.Sprintf("帧表期望结论句 scaleIn（2025@81s）——实际未出现（white=%.4f）：IR 锚'返工'=85.2s→F2130，比帧表晚 105 帧（M-C06-07 文档内部矛盾被渲染证实：'返工'在句尾，入场必然推迟）", c2025["endline_white_ratio"]),
			"M2 依据：二选一——改锚词（'先'/'一件'入词表）或改帧表至 2130")
	} else {
		cx.set(2025, "fail", "结论句提前出现（与锚点推算矛盾）")
	}

	// F2249
	f2249 := img(2249)
	c2249 := cx.keyRecs[2249].StructureChecks
	c2249["endline_white_ratio"] = white(f2249, c6REndline)
	c2249["nameA_blue_share"] = blueT(f2249, c6RNameA)
	c2249["nameB_purple_share"] = purpleT(f2249, c6RNameB)
	c2249["duration_frames_rendered"] = 2250
	if c2249["endline_white_ratio"].(float64) >= 0.005 && c2249["nameA_blue_share"].(float64) >= 0.005 && c2249["nameB_purple_share"].(float64) >= 0.005 {
		cx.set(2249, "ok", "尾帧：结论句可见（2130+20 帧落定）、双姓名条保持；DurationFrames=2250 帧循环完整渲染",
			"音频项（≥89.9s、SRT cue 数、最短时长 ≥1.2s 校验缺失 C06-D8）不属本链路，L2/L0 口径")
	} else {
		cx.set(2249, "fail", fmt.Sprintf("尾帧内容缺失 checks=%v", c2249))
	}
}
