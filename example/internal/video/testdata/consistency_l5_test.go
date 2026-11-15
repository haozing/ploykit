//go:build capx

// L5 consistency sampling segment (docs/plan-agent-video-studio-case-library-
// and-test-plan-2026-11-15.md §7.6 item (a), §7.0 thresholds): render the same
// synthesized 30-frame document 100 times and require ALL frame digests to
// match the first run byte-for-byte.
//
// Threshold (§7.6): 同镜像 100 次逐帧 PNG SHA-256 全部相等.
// Any single-frame digest mismatch is a determinism break: the run, frame,
// and both digests are recorded and the batch CONTINUES (no silent retries)
// so the full evidence lands in the report; the test fails.
//
// Isolation: every run is one capx.RenderFrames call. LocalChromeRenderer
// allocates a fresh tab per call (renderer.go render(): chromedp.NewContext),
// injects the document via setDocumentContent, awaits window.__player.ready,
// then seeks/screenshots frame by frame — no document state carries between
// runs. The warm browser PROCESS is reused (PoolSize=1), which is the
// production shape the contract covers ("same machine, same inputs").
//
// Fixture: minimal-but-valid IR (videoapp.Validate passes): solid background
// shape + one text element carrying one linear `move` animation across the
// full 1s — every one of the 30 seeks produces a distinct glyph position, so
// each frame digest is seek-sensitive (covers the seek path, non-static).
//
// Perf backfill (§7.6/§7.8): per-run wall time, per-frame duration
// distribution (all frames + steady-state excluding each run's frame 0,
// which carries tab setup + ready wait), PNG size average and the
// compression ratio vs raw RGB (1080*1920*3 = 6,220,800 B/frame).
//
// Artifacts (§7.0 retention):
//
//	testdata/consistency-l5-report.json        — this run's report
//	testdata/consistency/digests-100.txt       — 100 groups × 30 sha256 lines,
//	                                             blank line between groups
//
// Run:
//
//	go -C example test -tags capx ./internal/video/testdata -run TestL5Consistency -v -timeout 30m
//
// Skips itself when Chrome or ffmpeg is not found (CI without tools).
package l1

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/haozing/ploykit/platform/capx"
	videoapp "myproduct/internal/video/app"
)

// ---- L5 sampling-segment geometry (§7.6: 30-frame segment, standard even
// resolution; synthesized segment per this batch's task definition:
// 1080x1920@30, 1s, text element + move animation) ----

const (
	l5W            = 1080
	l5H            = 1920
	l5FPS          = 30
	l5DurationSec  = 1.0
	l5Frames       = 30 // ceil(1.0*30), videoapp.DurationFrames
	l5TargetRuns   = 100
	l5DegradeRuns  = 50 // §7.6 allows shrinking; batch task: degrade if >15min projected
	l5BudgetWindow = 15 * time.Minute
)

func l5RunID() string {
	b := make([]byte, 2)
	_, _ = rand.Read(b)
	return fmt.Sprintf("l5-consistency-%s-%s", time.Now().Format("20060102-150405"), hex.EncodeToString(b))
}

// l5IR builds the minimal legal fixture IR. The move animation runs the full
// 30 frames with linear easing, so frame i has a distinct glyph x-offset —
// every digest is sensitive to its seek position (determinism check would be
// vacuous on a static frame).
func l5IR() *videoapp.IR {
	script := "L5 一致性采样段 纯色背景 文字移动 逐帧定位 确定性验证"
	return &videoapp.IR{
		SchemaVersion: videoapp.IRSchemaVersion,
		Meta: videoapp.Meta{
			FPS:         l5FPS,
			Width:       l5W,
			Height:      l5H,
			DurationSec: l5DurationSec,
		},
		Script: script,
		Words:  videoapp.EstimateWords(script, l5DurationSec),
		Elements: []videoapp.Element{
			{ID: "l5-bg", Type: videoapp.ElementShape, Color: "#0F1C2E",
				X: 0, Y: 0, W: l5W, H: l5H, Z: 0},
			{ID: "l5-headline", Type: videoapp.ElementText, Text: "L5 一致性采样段",
				Color: "#FFFFFF", FontSize: 72,
				X: 108, Y: 384, W: 864, H: 200, Z: 3,
				Animations: []videoapp.ElementAnimation{{
					ID:             "l5-anim-move",
					Type:           "move",
					From:           &videoapp.Point{X: 108, Y: 384},
					To:             &videoapp.Point{X: 540, Y: 384},
					DurationFrames: l5Frames, // the full 1s: all 30 frames differ
					Easing:         "linear",
					StartAnchor:    &videoapp.Anchor{Text: "纯色背景", Occurrence: 0},
				}},
			},
		},
	}
}

// l5Stats is the min/median/p95/max summary over one duration sample set.
type l5Stats struct {
	Min    float64 `json:"min"`
	Median float64 `json:"median"`
	P95    float64 `json:"p95"`
	Max    float64 `json:"max"`
}

func l5Summarize(ms []float64) l5Stats {
	s := append([]float64(nil), ms...)
	sort.Float64s(s)
	pct := func(p float64) float64 {
		n := len(s)
		if n == 0 {
			return 0
		}
		idx := int(math.Ceil(p*float64(n))) - 1
		if idx < 0 {
			idx = 0
		}
		if idx >= n {
			idx = n - 1
		}
		return l5Round2(s[idx])
	}
	return l5Stats{Min: l5Round2(s[0]), Median: pct(0.50), P95: pct(0.95), Max: l5Round2(s[len(s)-1])}
}

func l5Round2(f float64) float64 { return float64(int64(f*100+0.5)) / 100 }

// TestL5Consistency100Runs is the §7.6 (a) batch: 100 independent renders of
// one fixed document, per-frame SHA-256, all runs equal to the first.
func TestL5Consistency100Runs(t *testing.T) {
	if testing.Short() {
		t.Skip("L5 drives a real headless Chrome for several minutes; skipped in -short mode")
	}
	chrome := chromePath(t)
	ffmpeg := ffmpegPath(t)

	baseDir, err := filepath.Abs(".")
	if err != nil {
		t.Fatal(err)
	}
	digestsDir := filepath.Join(baseDir, "consistency")
	if err := os.MkdirAll(digestsDir, 0o755); err != nil {
		t.Fatalf("mkdir consistency dir: %v", err)
	}
	runID := l5RunID()

	// -- fixture IR: validate, resolve anchors, project once (doc is FIXED
	//    across runs; only the renderer varies) --
	ir := l5IR()
	if verr := videoapp.Validate(ir); verr != nil {
		t.Fatalf("fixture IR failed Validate: %v", verr)
	}
	resolutions := videoapp.ResolveAll(ir, nil)
	for _, r := range resolutions {
		t.Logf("anchor %s(%s) %q -> word[%d] reason=%s", r.OwnerID, r.Owner, r.AnchorText, r.WordIndex, r.Reason)
	}
	irBytes, _ := json.Marshal(ir)
	irSHA := fmt.Sprintf("%x", sha256.Sum256(irBytes))

	proj := videoapp.NewProjector(nil)
	html, err := proj.HTML(context.Background(), ir, "")
	if err != nil {
		t.Fatalf("project HTML: %v", err)
	}
	t.Logf("fixture: ir_sha256=%s html_bytes=%d frames=%d (ceil(%.1f*%d))",
		irSHA[:16]+"...", len(html), l5Frames, l5DurationSec, l5FPS)

	// -- capx runtime, real local chrome --
	enabled := true
	rt, err := capx.New(capx.Config{Enabled: &enabled, ChromePath: chrome, FFMpegPath: ffmpeg, PoolSize: 1})
	if err != nil {
		t.Fatalf("capx.New: %v", err)
	}
	defer rt.Close()
	if !rt.Available() {
		t.Fatal("capx runtime not available (chrome/ffmpeg probe failed)")
	}
	rend, err := rt.Renderer()
	if err != nil {
		t.Fatalf("capx Renderer: %v", err)
	}

	spec := capx.FrameSpec{Width: l5W, Height: l5H, FPS: l5FPS, DurationFrames: l5Frames}
	doc := capx.Doc{HTML: string(html), TimelineID: "main"}

	// -- the batch --
	target := l5TargetRuns
	degraded := false
	degradeReason := ""
	allDigests := make([][]string, 0, l5TargetRuns) // one 30-entry group per run
	var perFrameAll []float64                       // ms, includes each run's frame 0 (tab setup + ready wait)
	var perFrameSteady []float64                    // ms, frames 1..29 only (pure seek+rAF+capture)
	var runTotals []float64                         // per-run wall ms
	var pngBytes int64
	pngMin, pngMax := int64(math.MaxInt64), int64(0)
	var mismatches []map[string]any
	allMatch := true

	batchStart := time.Now()
	for run := 0; run < target; run++ {
		runStart := time.Now()
		lastMark := runStart
		digests := make([]string, 0, l5Frames)
		err := rend.RenderFrames(t.Context(), doc, spec, func(_ context.Context, f capx.Frame) error {
			now := time.Now()
			perFrameAll = append(perFrameAll, now.Sub(lastMark).Seconds()*1000)
			lastMark = now
			if f.Index > 0 {
				perFrameSteady = append(perFrameSteady, perFrameAll[len(perFrameAll)-1])
			}
			if !bytes.HasPrefix(f.PNG, pngMagic) {
				return fmt.Errorf("frame %d: payload is not a PNG", f.Index)
			}
			n := int64(len(f.PNG))
			pngBytes += n
			if n < pngMin {
				pngMin = n
			}
			if n > pngMax {
				pngMax = n
			}
			sum := sha256.Sum256(f.PNG)
			digests = append(digests, hex.EncodeToString(sum[:]))
			return nil
		})
		if err != nil {
			t.Fatalf("run %d: RenderFrames failed after %s: %v", run, time.Since(runStart).Round(time.Second), err)
		}
		if len(digests) != l5Frames {
			t.Fatalf("run %d: got %d digests, want %d", run, len(digests), l5Frames)
		}
		runTotals = append(runTotals, time.Since(runStart).Seconds()*1000)

		if run == 0 {
			allDigests = append(allDigests, digests)
		} else {
			for i := 0; i < l5Frames; i++ {
				if digests[i] != allDigests[0][i] {
					allMatch = false
					mismatches = append(mismatches, map[string]any{
						"run":       run,
						"frame":     i,
						"first_run": allDigests[0][i],
						"this_run":  digests[i],
					})
					// keep collecting evidence; never a silent retry
					t.Errorf("DETERMINISM BREAK run %d frame %d: %s vs %s", run, i, allDigests[0][i], digests[i])
				}
			}
			allDigests = append(allDigests, digests)
		}

		if (run+1)%10 == 0 || run+1 == target {
			elapsed := time.Since(batchStart).Seconds()
			t.Logf("run %d/%d done | elapsed %.1fs | avg run %.2fs | last run %.2fs",
				run+1, target, elapsed, elapsed/float64(run+1), runTotals[len(runTotals)-1]/1000)
		}

		// §7.6 cost guard: if the projected total blows the 15-minute budget,
		// degrade to 50 runs (recorded in the report — never silently).
		if !degraded && target == l5TargetRuns && run+1 < l5TargetRuns {
			elapsed := time.Since(batchStart)
			projected := time.Duration(float64(elapsed) / float64(run+1) * float64(l5TargetRuns))
			absOver := elapsed > l5BudgetWindow
			if projected > l5BudgetWindow || absOver {
				target = l5DegradeRuns
				degraded = true
				if absOver {
					degradeReason = fmt.Sprintf("absolute elapsed %s exceeded %s budget", elapsed.Round(time.Second), l5BudgetWindow)
				} else {
					degradeReason = fmt.Sprintf("projected total %s exceeded %s budget", projected.Round(time.Second), l5BudgetWindow)
				}
				t.Logf("DEGRADED to %d runs: %s", l5DegradeRuns, degradeReason)
			}
		}
	}
	totalTime := time.Since(batchStart)

	// -- digest file: <target> groups × 30 lines, blank line between groups --
	var sb strings.Builder
	for gi, group := range allDigests {
		if gi > 0 {
			sb.WriteString("\n")
		}
		sb.WriteString(strings.Join(group, "\n"))
		sb.WriteString("\n")
	}
	digestsPath := filepath.Join(digestsDir, "digests-100.txt")
	if werr := os.WriteFile(digestsPath, []byte(sb.String()), 0o644); werr != nil {
		t.Fatalf("write digests file: %v", werr)
	}

	// -- aggregates --
	agg := sha256.Sum256([]byte(strings.Join(allDigests[0], "\n")))
	aggHex := hex.EncodeToString(agg[:])
	avgPNG := float64(pngBytes) / float64(len(allDigests)*l5Frames)
	rawRGB := float64(l5W * l5H * 3) // 6,220,800 B/frame at 1080x1920

	host, _ := os.Hostname()
	report := map[string]any{
		"run_id": runID,
		"layer":  "L5",
		"case":   "L5-consistency-sampling (synthesized 30-frame segment, 1080x1920@30, 1s, text + move)",
		"samples": map[string]any{
			"runs":           len(allDigests),
			"frames_per_run": l5Frames,
			"total_frames":   len(allDigests) * l5Frames,
		},
		"digest_all_match":                  allMatch,
		"first_run_digest_sha256":           aggHex,
		"first_run_digest_sha256_algorithm": `sha256 over strings.Join(first-run digest[0..29], "\n")`,
		"perf": map[string]any{
			"per_frame_ms":        l5Summarize(perFrameAll),    // all frames incl. per-run warmup (tab+ready)
			"per_frame_steady_ms": l5Summarize(perFrameSteady), // frames 1..29: pure seek+rAF+capture
			"total_ms":            totalTime.Milliseconds(),
			"total_wall_clock":    totalTime.Round(time.Second).String(),
			"per_run_ms":          l5Summarize(runTotals),
			"avg_frames_per_sec":  l5Round2(float64(len(allDigests)*l5Frames) / totalTime.Seconds()),
		},
		"png": map[string]any{
			"avg_bytes":               int64(avgPNG),
			"min_bytes":               pngMin,
			"max_bytes":               pngMax,
			"raw_rgb_bytes_per_frame": int64(rawRGB),
			"compression_ratio_avg":   l5Round2(rawRGB / avgPNG),
			"note":                    "minimal composition (solid bg + moving white text): ratio is an upper bound, NOT representative of case-content PNGs (§7.8 3-8x estimate refers to typical motion graphics); cross-check against L1 golden frames recorded in evidence",
		},
		"threshold":        "all runs identical (same machine, per-frame PNG SHA-256)",
		"threshold_source": "docs/plan-agent-video-studio-case-library-and-test-plan-2026-11-15.md §7.6",
		"degraded":         degraded,
		"degrade_reason":   degradeReason,
		"mismatches":       mismatches,
		"env": map[string]any{
			"os":        runtime.GOOS + "/" + runtime.GOARCH,
			"host":      host,
			"go":        runtime.Version(),
			"chrome":    chrome,
			"ffmpeg":    ffmpegVersion(t),
			"capx":      "github.com/haozing/ploykit/platform/capx (local headless chrome, pool=1)",
			"tab_model": "one fresh tab per RenderFrames call (chromedp.NewContext in renderer.go render()); no document state shared between runs; warm browser process reused (production shape)",
		},
		"recipe": map[string]any{
			"ir_sha256":       irSHA,
			"ir_sha256_basis": "sha256(json.Marshal(videoapp.IR) after ResolveAll, before projection)",
			"width":           l5W,
			"height":          l5H,
			"fps":             l5FPS,
			"duration_sec":    l5DurationSec,
			"duration_frames": l5Frames,
			"frame_formula":   "ceil(durationSec*fps), videoapp.DurationFrames + timeline-builder.js Math.ceil",
			"html_bytes":      len(html),
			"timeline_id":     "main",
		},
		"evidence": map[string]any{
			"digests_file":          "example/internal/video/testdata/consistency/digests-100.txt",
			"digest_groups_written": len(allDigests),
			"report_json":           "example/internal/video/testdata/consistency-l5-report.json",
			"command":               "go -C example test -tags capx ./internal/video/testdata -run TestL5Consistency -v -timeout 30m",
			"plan_doc":              "docs/plan-agent-video-studio-case-library-and-test-plan-2026-11-15.md §7.0 §7.6 §7.8",
			"isolation":             "capx LocalChromeRenderer.render(): fresh tab + Page.setDocumentContent + __player.ready wait + per-frame pause(t,false)/double-rAF/Page.captureScreenshot",
		},
	}
	repBytes, _ := json.MarshalIndent(report, "", "  ")
	reportPath := filepath.Join(baseDir, "consistency-l5-report.json")
	if werr := os.WriteFile(reportPath, repBytes, 0o644); werr != nil {
		t.Fatalf("write report: %v", werr)
	}

	t.Logf("L5 consistency: %d runs x %d frames in %s | all_match=%v | steady %.1fms/frame (p95 %.1f) | PNG avg %.0fB (ratio %.1fx)",
		len(allDigests), l5Frames, totalTime.Round(time.Second), allMatch,
		l5Summarize(perFrameSteady).Median, l5Summarize(perFrameSteady).P95, avgPNG, rawRGB/avgPNG)

	if !allMatch {
		t.Errorf("L5 determinism broken: %d frame digest mismatches across %d runs (see report mismatches[])", len(mismatches), len(allDigests))
	}
}
