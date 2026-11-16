//go:build capx

// Package l1 hosts the Video Studio case-library test harnesses that live
// under testdata/. This file is the L3 full-length tier (docs/plan-agent-
// video-studio-case-library-and-test-plan-2026-11-15.md §7.4): the first
// five cases (C01..C05) each rendered at FULL case duration through the
// REAL pipeline — degraded IR → Validate → Projector.HTML (image elements
// served gray placeholder data-URIs) → capx RenderFrames (real local
// headless Chrome) → FrameWriter/EncodePNGStream (libx264 CRF 18) →
// [C01/C05: MuxAV with a synthesized 440 Hz sine voice track aligned to the
// case duration; C02/C03/C04: direct output] → MP4 at
// testdata/l3-full/<case>/output.mp4.
//
// This is NOT the TestL3Smoke lane: smoke drives the real HTTP server + DB
// with a 5s synthesized IR. L3-full validates the case CONTENT at full
// length (no DB, no worker — the L2 scope boundary held, §7.4 "全时长端到端
// 成片结构" tier).
//
// Frame budget (§7.4 case table):
//
//	C01  450  frames @1080x1920@30  (15s)  voice
//	C02  750  frames @1920x1080@25  (30s)  silent
//	C03  1350 frames @1080x1920@30  (45s)  silent
//	C04  1800 frames @1920x1080@30  (60s)  silent
//	C05  900  frames @1080x1920@30  (30s)  voice
//	≈ 5250 frames, 10-12 minutes of real rendering total.
//
// Assertions per case (§7.4): ftyp box; ffprobe geometry/fps; duration = the
// case spec ±1 frame (video stream, strictly; container duration recorded
// too — voice cases carry mp3 encoder padding into format.duration);
// EXACT frame count via ffprobe -count_packets; THREE sampled frames
// (start/middle/tail, ffmpeg -ss extraction) each verified not-all-black,
// not-all-white, and carrying content ink (luminance stddev) — L3 does NOT
// do per-pixel golden compare, only "structure complete and content present";
// pairwise sample stats are recorded to evidence "content changes over time"
// (degraded IRs have long static stretches — an all-static sample trio is
// recorded as a warning note, a hard fail only when even the KNOWN animated
// anchors produce zero variance); C01/C05 audio mean_volume > -50 dB;
// full-decode re-verification of the shipped bytes (`ffmpeg -v error -i out
// -f null -` — empty stderr = clean); artifact size/bitrate/PNG compression
// calibration data recorded for round-3 ratio estimates.
//
// One test function per case (TestL3FullC01..TestL3FullC05) so a single case
// can be run/re-run on its own within a bounded budget; the shared report
// testdata/l3-full-report.json MERGES per-case entries (keyed by case_id),
// so separate invocations accumulate into one verdict table.
//
// Run (each case renders minutes of real Chrome frames — budget -timeout):
//
//	go -C example test -tags capx ./internal/video/testdata -run 'TestL3Full' -v -timeout 40m
//	go -C example test -tags capx ./internal/video/testdata -run TestL3FullC04 -v -timeout 20m
//
// Skips itself when Chrome or ffmpeg is not found (CI without tools), and in
// -short mode.
package l1

import (
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/haozing/ploykit/platform/capx"

	videoapp "myproduct/internal/video/app"
)

// ---- the five L3-full cases (§7.4 table) ----

type l3Case struct {
	CaseID         string
	IRFile         string // ir/<file>; empty for C01 (degraded IR built in-code, c01IR())
	W, H, FPS      int
	DurationFrames int
	DurationSec    float64
	Voice          bool // C01/C05: mux a synthesized 440 Hz sine voice track
	Images         bool // expectation: case carries image elements (informational)
}

func l3Cases() []l3Case {
	return []l3Case{
		{CaseID: "VS-C01", IRFile: "", W: 1080, H: 1920, FPS: 30, DurationFrames: 450, DurationSec: 15.0, Voice: true},
		{CaseID: "VS-C02", IRFile: "c02.degraded.json", W: 1920, H: 1080, FPS: 25, DurationFrames: 750, DurationSec: 30.0, Images: true},
		{CaseID: "VS-C03", IRFile: "c03.degraded.json", W: 1080, H: 1920, FPS: 30, DurationFrames: 1350, DurationSec: 45.0},
		{CaseID: "VS-C04", IRFile: "c04.degraded.json", W: 1920, H: 1080, FPS: 30, DurationFrames: 1800, DurationSec: 60.0},
		{CaseID: "VS-C05", IRFile: "c05.degraded.json", W: 1080, H: 1920, FPS: 30, DurationFrames: 900, DurationSec: 30.0, Voice: true, Images: true},
	}
}

// l3SamplePoints derives the three §7.4 extraction points. The "tail" point
// is NOT blindly the absolute last frame: element time windows (P0-1) close
// at endFrame for several cases (C03: every window ends ≤F1094 of 1350; the
// designed F1095+ tail is the bare navy background — frames.json documents
// el_caption as an EMPTY-text placeholder for burn-mode subtitles this
// pipeline does not run; C05: F899 IS the shared endFrame where the hide set
// applies exactly, batch-6a finding). The tail sample therefore lands on the
// last frame the IR actually keeps content visible: min(maxEnd-2, total-2)
// when the IR declares element windows, total-2 otherwise. When that differs
// from the absolute tail, the empty-tail fact is recorded — the rendered MP4
// still carries the full duration (asserted separately via count_packets).
func l3SamplePoints(c l3Case, ir *videoapp.IR) ([]struct {
	Label   string
	Frame   int
	TimeSec float64
}, string) {
	type sp = struct {
		Label   string
		Frame   int
		TimeSec float64
	}
	mk := func(label string, frame int) sp {
		return sp{label, frame, float64(frame) / float64(c.FPS)}
	}
	tail := c.DurationFrames - 2
	tailNote := ""
	var maxEnd int
	for i := range ir.Elements {
		if ir.Elements[i].EndFrame != nil && *ir.Elements[i].EndFrame > maxEnd {
			maxEnd = *ir.Elements[i].EndFrame
		}
	}
	if maxEnd > 0 && maxEnd-2 < tail {
		tail = maxEnd - 2
		tailNote = fmt.Sprintf("tail sample placed at F%d (last IR window endFrame=%d minus 2; hide rule [startFrame+1,endFrame] closes content at endFrame exactly — the designed absolute tail F%d is the bare-background end state; MP4 duration/count_packets still assert the full %d frames)", tail, maxEnd, c.DurationFrames-1, c.DurationFrames)
	}
	return []sp{
		mk("start", c.DurationFrames/10),
		mk("middle", c.DurationFrames/2),
		mk("tail", tail),
	}, tailNote
}

// ---- luminance stats for extracted frames (existence-level, no golden) ----

type l3LumStats struct {
	MeanLum     float64 `json:"mean_lum"`      // 0-255
	StdLum      float64 `json:"std_lum"`       // population stddev — the "ink" signal
	DarkRatio   float64 `json:"dark_ratio"`    // lum < 64
	BrightRatio float64 `json:"bright_ratio"`  // lum > 232
	Pixels      int     `json:"pixels"`
}

func l3FrameStats(img image.Image) l3LumStats {
	b := img.Bounds()
	var n int
	var sum, sumSq float64
	var dark, bright int
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			r, g, bl, _ := img.At(x, y).RGBA()
			lum := 0.299*float64(r>>8) + 0.587*float64(g>>8) + 0.114*float64(bl>>8)
			n++
			sum += lum
			sumSq += lum * lum
			if lum < 64 {
				dark++
			}
			if lum > 232 {
				bright++
			}
		}
	}
	st := l3LumStats{Pixels: n}
	if n == 0 {
		return st
	}
	st.MeanLum = sum / float64(n)
	st.DarkRatio = float64(dark) / float64(n)
	st.BrightRatio = float64(bright) / float64(n)
	variance := sumSq/float64(n) - st.MeanLum*st.MeanLum
	if variance > 0 {
		st.StdLum = math.Sqrt(variance)
	}
	return st
}

// l3FrameVerdict applies the §7.4 structure criteria: not all black, not all
// white, and carrying content ink (luminance variance from multiple tones).
func l3FrameVerdict(st l3LumStats) (ok bool, why string) {
	switch {
	case st.MeanLum < 4.0 && st.DarkRatio > 0.995:
		return false, "all-black frame"
	case st.BrightRatio > 0.995 && st.MeanLum > 246:
		return false, "all-white frame"
	case st.StdLum < 2.5:
		return false, fmt.Sprintf("no content ink (std_lum %.2f < 2.5 — flat field)", st.StdLum)
	default:
		return true, ""
	}
}

// ---- frame extraction (ffmpeg -ss decode) ----

func l3ExtractFrame(ctx context.Context, ffmpeg, mp4 string, tSec float64, outPath string) (string, error) {
	arg := fmt.Sprintf("%.3f", tSec)
	// Input-side seek first (frame-accurate in modern ffmpeg); fall back to
	// output-side seek (decode-and-discard — slower but robust on odd
	// fragmented-MP4 seek tables).
	cmd := exec.CommandContext(ctx, ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
		"-ss", arg, "-i", mp4, "-frames:v", "1", outPath)
	if out, err := cmd.CombinedOutput(); err != nil {
		cmd2 := exec.CommandContext(ctx, ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
			"-i", mp4, "-ss", arg, "-frames:v", "1", outPath)
		if out2, err2 := cmd2.CombinedOutput(); err2 != nil {
			return string(out) + " || " + string(out2), fmt.Errorf("extract@%.3fs: input-seek %v, output-seek %v", tSec, err, err2)
		}
	}
	return "", nil
}

// ---- voice synthesis (440 Hz sine, duration-aligned mp3) ----

func l3SynthVoice(ctx context.Context, ffmpeg, path string, durSec float64) error {
	out, err := exec.CommandContext(ctx, ffmpeg, "-y", "-hide_banner", "-f", "lavfi",
		"-i", fmt.Sprintf("sine=frequency=440:duration=%g", durSec),
		"-c:a", "libmp3lame", path).CombinedOutput()
	if err != nil {
		return fmt.Errorf("synth voice %gs: %w\n%s", durSec, err, l3Tail(string(out), 12))
	}
	return nil
}

func l3Tail(s string, n int) string {
	lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}

// ---- render+encode with progress logging (full-length renders are minutes
// long; the callback logs every 250 frames so a hung run is visible) ----

func l3RenderEncode(t *testing.T, ctx context.Context, rt *capx.Runtime,
	ir *videoapp.IR, spec capx.FrameSpec, outPath string) (imagesServed int, renderMS int64, err error) {
	t.Helper()

	proj := batch6Projector(&imagesServed) // gray 64×64 placeholder via DataURIResolver (l2 batch-6 pattern)
	html, err := proj.HTML(ctx, ir, "")
	if err != nil {
		return imagesServed, 0, fmt.Errorf("project: %w", err)
	}
	t.Logf("projected HTML bytes=%d", len(html))

	videoOut, err := os.Create(outPath)
	if err != nil {
		return imagesServed, 0, err
	}
	defer videoOut.Close()

	pr, pw, err := os.Pipe()
	if err != nil {
		return imagesServed, 0, err
	}
	fw := capx.NewFrameWriter(pw)
	rend, err := rt.Renderer()
	if err != nil {
		pr.Close()
		pw.Close()
		return imagesServed, 0, err
	}
	encodeDone := make(chan error, 1)
	go func() {
		err := rt.EncodePNGStream(ctx, videoOut, spec, pr, capx.EncodeOptions{CRF: 18, Preset: "medium"})
		pr.Close()
		encodeDone <- err
	}()

	renderStart := time.Now()
	renderErr := rend.RenderFrames(ctx,
		capx.Doc{HTML: string(html), TimelineID: "main"}, spec,
		func(_ context.Context, f capx.Frame) error {
			if f.Index%250 == 0 {
				t.Logf("frame %d/%d rendered (%.1fs elapsed)", f.Index, spec.DurationFrames-1, time.Since(renderStart).Seconds())
			}
			return fw.WriteFrame(f.PNG)
		})
	renderMS = time.Since(renderStart).Milliseconds()
	if cErr := pw.Close(); cErr != nil && renderErr == nil {
		renderErr = cErr
	}
	if eErr := <-encodeDone; eErr != nil && renderErr == nil {
		renderErr = fmt.Errorf("encode: %w", eErr)
	}
	if renderErr != nil {
		return imagesServed, renderMS, fmt.Errorf("render frames: %w", renderErr)
	}
	t.Logf("RENDER DONE: %d frames in %s (%.1f ms/frame)",
		spec.DurationFrames, time.Duration(renderMS)*time.Millisecond,
		float64(renderMS)/float64(spec.DurationFrames))
	return imagesServed, renderMS, nil
}

// ---- report model (§7.10 verdict shape, L3-full fields; MERGED across runs) ----

type l3SampleReport struct {
	Label     string     `json:"label"`
	Frame     int        `json:"frame"`
	TimeSec   float64    `json:"time_sec"`
	PNGBytes  int64      `json:"png_bytes"`
	PNGRatio  float64    `json:"png_compression_ratio"` // png_bytes / (w*h*3)
	Stats     l3LumStats `json:"stats"`
	Verdict   string     `json:"verdict"` // ok | fail
	FailWhy   string     `json:"fail_why,omitempty"`
	ExtractSn string     `json:"extract_stderr,omitempty"`
}

type l3Pairwise struct {
	Pair           string  `json:"pair"` // "start-middle"
	MeanLumDelta   float64 `json:"mean_lum_delta"`
	StdLumDelta    float64 `json:"std_lum_delta"`
}

type l3CaseReport struct {
	CaseID          string                    `json:"case_id"`
	IRFile          string                    `json:"ir_file"`
	RecordedAt      string                    `json:"recorded_at"`
	Status          string                    `json:"status"` // pass | fail
	FailReasons     []string                  `json:"fail_reasons,omitempty"`
	Notes           []string                  `json:"notes,omitempty"`
	Spec            map[string]any            `json:"spec"`
	DurationFrames  int                       `json:"duration_frames_planned"`
	FFProbe         *batch6Probe              `json:"ffprobe,omitempty"`
	CountPackets    int                       `json:"nb_read_packets,omitempty"`
	Audio           *audioProbe               `json:"audio,omitempty"`
	DecodeVerify    *batch6DecodeVerifyResult `json:"decode_verify,omitempty"`
	Samples         []l3SampleReport          `json:"samples"`
	Pairwise        []l3Pairwise              `json:"pairwise_deltas"`
	RenderMS        int64                     `json:"render_ms"`
	MSPerFrame      float64                   `json:"render_ms_per_frame"`
	TotalMS         int64                     `json:"total_ms"`
	MP4Bytes        int64                     `json:"mp4_bytes"`
	VideoOnlyBytes  int64                     `json:"video_only_bytes,omitempty"`
	VoiceBytes      int64                     `json:"voice_bytes,omitempty"`
	BitrateKbps     float64                   `json:"mp4_bitrate_kbps"`
	ImagesServed    int                       `json:"images_served"`
	Artifact        string                    `json:"artifact,omitempty"`
}

type l3FullReport struct {
	Layer  string          `json:"layer"`
	RunID  string          `json:"run_id"`
	Method string          `json:"method"`
	Env    []string        `json:"env"`
	Cases  []l3CaseReport  `json:"cases"`
	Totals struct {
		Pass int `json:"pass"`
		Fail int `json:"fail"`
	} `json:"totals"`
	Evidence []string `json:"evidence"`
}

// l3LoadReport reads the shared merged report (missing/corrupt = fresh).
func l3LoadReport(path string) *l3FullReport {
	rep := &l3FullReport{Layer: "L3-full", Cases: []l3CaseReport{}}
	b, err := os.ReadFile(path)
	if err != nil {
		return rep
	}
	var old l3FullReport
	if json.Unmarshal(b, &old) != nil || old.Layer != "L3-full" {
		return rep
	}
	return &old
}

func l3WriteReport(t *testing.T, path string, rep *l3FullReport) {
	t.Helper()
	rep.Totals.Pass, rep.Totals.Fail = 0, 0
	for _, c := range rep.Cases {
		if c.Status == "pass" {
			rep.Totals.Pass++
		} else {
			rep.Totals.Fail++
		}
	}
	b, err := json.MarshalIndent(rep, "", "  ")
	if err != nil {
		t.Errorf("marshal l3-full-report: %v", err)
		return
	}
	if err := os.WriteFile(path, b, 0o644); err != nil {
		t.Errorf("write %s: %v", path, err)
	}
}

func l3UpsertCase(rep *l3FullReport, entry l3CaseReport) {
	for i := range rep.Cases {
		if rep.Cases[i].CaseID == entry.CaseID {
			rep.Cases[i] = entry
			return
		}
	}
	rep.Cases = append(rep.Cases, entry)
}

// ---- the shared per-case runner ----

func l3RunCase(t *testing.T, c l3Case) {
	t.Helper()
	if testing.Short() {
		t.Skip("L3-full drives real full-length Chrome renders; skipped in -short mode")
	}
	chrome := chromePath(t)   // skips when no chrome-family browser (l2_encode_test.go helper)
	ffmpeg := ffmpegPath(t)   // skips when ffmpeg missing
	ffprobe := ffprobePath()
	ctx := context.Background()

	enabled := true
	rt, err := capx.New(capx.Config{
		Enabled:    &enabled,
		ChromePath: chrome,
		FFMpegPath: ffmpeg,
		PoolSize:   1,
	})
	if err != nil {
		t.Fatalf("capx.New: %v", err)
	}
	defer rt.Close()
	if !rt.Available() {
		t.Fatal("capx runtime not available after successful New")
	}

	_, thisFile, _, _ := runtime.Caller(0)
	baseDir := filepath.Dir(thisFile)
	outDir := filepath.Join(baseDir, "l3-full", c.CaseID)
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", outDir, err)
	}
	reportPath := filepath.Join(baseDir, "l3-full-report.json")

	rep := l3LoadReport(reportPath)
	if rep.RunID == "" {
		rep.RunID = time.Now().Format("20060102-150405") + "-l3-full"
	}
	if len(rep.Env) == 0 {
		host, _ := os.Hostname()
		rep.Env = append(rep.Env,
			"os="+runtime.GOOS+"/"+runtime.GOARCH,
			"host="+host,
			"chrome="+chrome,
			"ffmpeg="+ffmpeg,
			"go="+runtime.Version(),
			"ffprobe="+func() string {
				if ffprobe == "" {
					return "MISSING (exact-frame assertions require ffprobe)"
				}
				return ffprobe
			}(),
		)
		rep.Method = "§7.4 full-length: degraded IR (C01 built in-code c01IR(), C02-C05 ir/c0X.degraded.json) → Validate → Projector.HTML (image elements = gray 64×64 placeholder data-URIs via DataURIResolver) → capx RenderFrames FULL duration (real headless Chrome) → FrameWriter/EncodePNGStream (libx264 CRF18 medium) → C01/C05 MuxAV +440Hz sine voice (duration-aligned mp3) / C02-C04 direct → l3-full/<case>/output.mp4; assertions: ftyp, geometry/fps, video-stream duration ±1 frame, -count_packets exact frames, 3-point frame extraction (not black / not white / has ink), C01/C05 mean_volume>-50dB, ffmpeg -v error full decode re-verify, size/bitrate calibration records"
		if len(rep.Evidence) == 0 {
			rep.Evidence = append(rep.Evidence,
				"[方法] L3 不做逐像素 golden 比较——只断言成片结构完整（每案 3 个时间点抽帧非黑非白且有墨迹）；样本对间统计差记录为『内容随时间变化』证据，降级 IR 的长静态段如实记 note",
				"[报告] cases[] 按 case_id 合并——每个案可单独重跑（go test -run TestL3FullC0X），报告增量更新",
				"[校准] round3 数据对齐：mp4_bytes / mp4_bitrate_kbps / 抽帧 png_bytes + png_compression_ratio（png_bytes ÷ w×h×3 裸像素字节）")
		}
	}

	entry := l3CaseReport{
		CaseID:     c.CaseID,
		IRFile:     func() string { if c.IRFile == "" { return "(in-code c01IR() — l1_render_test.go degraded projection; el_product image removed, recorded conversion)" }; return "ir/" + c.IRFile }(),
		RecordedAt: time.Now().Format(time.RFC3339),
		Spec: map[string]any{
			"width": c.W, "height": c.H, "fps": c.FPS,
			"duration_frames": c.DurationFrames, "duration_sec": c.DurationSec,
			"voice": c.Voice, "expects_image_elements": c.Images,
		},
		DurationFrames: c.DurationFrames,
		Artifact:       "l3-full/" + c.CaseID + "/output.mp4",
		Notes:          []string{},
	}
	fail := func(reason string) {
		entry.Status = "fail"
		entry.FailReasons = append(entry.FailReasons, reason)
	}
	start := time.Now()

	// -- 1. IR: load (file or in-code), validate, pin frame math --
	var ir *videoapp.IR
	if c.IRFile == "" {
		ir = c01IR() // degraded C01 projection built by the L1 harness (same package)
	} else {
		raw, rerr := os.ReadFile(filepath.Join(baseDir, "ir", c.IRFile))
		if rerr != nil {
			l3UpsertCase(rep, entry)
			l3WriteReport(t, reportPath, rep)
			t.Fatalf("read %s: %v", c.IRFile, rerr)
		}
		ir = &videoapp.IR{}
		if jerr := json.Unmarshal(raw, ir); jerr != nil {
			l3UpsertCase(rep, entry)
			l3WriteReport(t, reportPath, rep)
			t.Fatalf("unmarshal %s: %v", c.IRFile, jerr)
		}
	}
	if verr := videoapp.Validate(ir); verr != nil {
		l3UpsertCase(rep, entry)
		l3WriteReport(t, reportPath, rep)
		t.Fatalf("degraded IR failed Validate: %v", verr)
	}
	// ResolveAll MUST run before Projector.HTML: the projector serializes
	// effects[].resolvedFrom into the data block, and the builder anchors
	// every effect at anchorTime(resolvedFrom) — without the pass,
	// resolvedFrom is nil and anchorTime(undefined) returns 0, collapsing the
	// whole anchor choreography to t=0 (L3 C01 first-run finding: highlight
	// flashes landed at F0-F25 instead of their word windows; counter digits
	// frozen at the end value from frame 0). Same order as the L1 harness
	// (runCase step 1.5) and the production write path (service.go SetIR).
	for _, r := range videoapp.ResolveAll(ir, nil) {
		start := 0.0
		if r.WordIndex >= 0 && r.WordIndex < len(ir.Words) {
			start = ir.Words[r.WordIndex].Start
		}
		t.Logf("anchor %s(%s) %q -> word[%d] reason=%s start=%.2fs frame=%.0f",
			r.OwnerID, r.Owner, r.AnchorText, r.WordIndex, r.Reason, start, start*float64(c.FPS))
	}
	frames := videoapp.DurationFrames(ir, c.FPS)
	if frames != c.DurationFrames {
		fail(fmt.Sprintf("DurationFrames=%d != case spec %d (single-source formula ceil(duration*fps))", frames, c.DurationFrames))
	}
	spec := capx.FrameSpec{Width: c.W, Height: c.H, FPS: c.FPS, DurationFrames: frames}
	if serr := spec.Validate(); serr != nil {
		l3UpsertCase(rep, entry)
		l3WriteReport(t, reportPath, rep)
		t.Fatalf("frame spec: %v", serr)
	}
	entry.Notes = append(entry.Notes, fmt.Sprintf("DurationFrames=%d (ceil(%gx%d)), silent-degradation audio block kept as-is (full length, no truncation — voice duration drives DurationFrames when longer)", frames, c.DurationSec, c.FPS))

	// -- 2. render + encode (real chrome, full loop) --
	videoOnly := filepath.Join(t.TempDir(), "video-only.mp4")
	served, renderMS, rErr := l3RenderEncode(t, ctx, rt, ir, spec, videoOnly)
	entry.ImagesServed = served
	entry.RenderMS = renderMS
	entry.MSPerFrame = float64(renderMS) / float64(frames)
	if served > 0 {
		entry.Notes = append(entry.Notes, fmt.Sprintf("image elements served %d gray 64×64 placeholder PNGs via DataURIResolver (no-network document, §4.4.5)", served))
	} else if c.Images {
		fail("case expected image elements but the resolver served 0 assets")
	}
	if rErr != nil {
		entry.TotalMS = time.Since(start).Milliseconds()
		fail("render+encode: " + rErr.Error())
		l3UpsertCase(rep, entry)
		l3WriteReport(t, reportPath, rep)
		t.Fatalf("render+encode %s failed after %d ms: %v", c.CaseID, renderMS, rErr)
	}
	if st, serr := os.Stat(videoOnly); serr == nil {
		entry.VideoOnlyBytes = st.Size()
	}

	// -- 3. voice branch (C01/C05) or direct output --
	outputPath := filepath.Join(outDir, "output.mp4")
	if c.Voice {
		voicePath := filepath.Join(t.TempDir(), "voice-440.mp3")
		if verr := l3SynthVoice(ctx, ffmpeg, voicePath, c.DurationSec); verr != nil {
			entry.TotalMS = time.Since(start).Milliseconds()
			fail("synth voice: " + verr.Error())
			l3UpsertCase(rep, entry)
			l3WriteReport(t, reportPath, rep)
			t.Fatalf("synth voice: %v", verr)
		}
		if st, serr := os.Stat(voicePath); serr == nil {
			entry.VoiceBytes = st.Size()
		}
		out, oerr := os.Create(outputPath)
		if oerr != nil {
			t.Fatalf("create %s: %v", outputPath, oerr)
		}
		merr := rt.MuxAV(ctx, out, videoOnly, voicePath, "", 0.3)
		out.Close()
		if merr != nil {
			entry.TotalMS = time.Since(start).Milliseconds()
			fail("mux voice: " + merr.Error())
			l3UpsertCase(rep, entry)
			l3WriteReport(t, reportPath, rep)
			t.Fatalf("mux voice %s: %v", c.CaseID, merr)
		}
		entry.Notes = append(entry.Notes, fmt.Sprintf("voice branch: 440 Hz sine mp3 %.0fs (duration-aligned), voice-only mux (capx MuxAV, video stream-copied)", c.DurationSec))
	} else {
		// silent: copy (rename fails cross-volume on Windows)
		if cpErr := batch6CopyFile(videoOnly, outputPath); cpErr != nil {
			t.Fatalf("copy %s → %s: %v", videoOnly, outputPath, cpErr)
		}
		entry.Notes = append(entry.Notes, "silent clip (no audio mux — C01/C05 carry this batch's audio branch)")
	}
	if st, serr := os.Stat(outputPath); serr == nil {
		entry.MP4Bytes = st.Size()
	}

	// -- 4. container/geometry assertions --
	ftypOK := readFTYP(t, outputPath)
	if !ftypOK {
		fail("no ftyp box in the first 32 bytes")
	}
	info, perr := batch6ProbeMP4(ctx, ffprobe, outputPath)
	if info != nil {
		info.HasFTYP = ftypOK
	}
	entry.FFProbe = info
	if perr != nil {
		fail("ffprobe failed: " + perr.Error())
	} else {
		if info.Width != c.W || info.Height != c.H {
			fail(fmt.Sprintf("dimensions %dx%d != want %dx%d", info.Width, info.Height, c.W, c.H))
		}
		if !batch6Within(info.FPS, float64(c.FPS), 0.02) {
			fail(fmt.Sprintf("fps %.4f != want %d", info.FPS, c.FPS))
		}
		// video-stream duration strictly ±1 frame (format.duration may carry
		// mp3 encoder padding on voice cases — recorded, tolerated ±2 frames
		// with a note instead)
		videoStreamDur := -1.0
		var hasAudio bool
		for _, s := range info.Streams {
			if s.Kind == "video" {
				videoStreamDur = s.Duration
			}
			if s.Kind == "audio" {
				hasAudio = true
			}
		}
		wantDur := float64(frames) / float64(c.FPS)
		frameTol := 1.0 / float64(c.FPS)
		if videoStreamDur < 0 {
			// some containers only carry duration at format level
			videoStreamDur = info.Duration
			entry.Notes = append(entry.Notes, "video stream carried no duration — fell back to format.duration for the ±1 frame check")
		}
		if !batch6Within(videoStreamDur, wantDur, frameTol) {
			fail(fmt.Sprintf("video duration %.4fs outside ±1 frame (want %.4fs ± %.4fs)", videoStreamDur, wantDur, frameTol))
		}
		if c.Voice {
			if !hasAudio {
				fail("voice case: expected an audio stream, found none")
			} else {
				ap, aerr := measureLoudness(ctx, ffmpeg, outputPath)
				entry.Audio = &ap
				if aerr != nil {
					fail("volumedetect failed: " + aerr.Error())
				} else if !ap.Present {
					fail("volumedetect produced no mean_volume; raw: " + l3Tail(ap.VolumedetectRaw, 12))
				} else if ap.MeanVolumeDB <= -50.0 {
					fail(fmt.Sprintf("audio too quiet: mean_volume %.1f dB <= -50 dB; raw: %s", ap.MeanVolumeDB, l3Tail(ap.VolumedetectRaw, 12)))
				}
			}
			if info.Duration > 0 && !batch6Within(info.Duration, wantDur, 2*frameTol) {
				entry.Notes = append(entry.Notes, fmt.Sprintf("container duration %.4fs differs from video %.4fs by >2 frames (mp3 encoder padding) — video stream itself is within tolerance", info.Duration, videoStreamDur))
			}
		} else if hasAudio {
			fail("silent case: audio stream unexpectedly present")
		}
		// exact frame count (fragmented MP4 carries no nb_frames box)
		gotFrames, _, nerr := countVideoPackets(ctx, ffprobe, outputPath)
		entry.CountPackets = gotFrames
		if nerr != nil {
			fail("count_packets failed: " + nerr.Error())
		} else if gotFrames != frames {
			fail(fmt.Sprintf("frame count %d != want %d (ffprobe -count_packets)", gotFrames, frames))
		}
		if entry.MP4Bytes > 0 && info.Duration > 0 {
			entry.BitrateKbps = float64(entry.MP4Bytes) * 8 / 1000 / info.Duration
		}
	}

	// -- 5. three-point frame extraction (structure, no golden) --
	type samp struct {
		label   string
		frame   int
		timeSec float64
		stats   l3LumStats
	}
	var samples []samp
	samplePts, tailNote := l3SamplePoints(c, ir)
	if tailNote != "" {
		entry.Notes = append(entry.Notes, tailNote)
	}
	for _, sp := range samplePts {
		sr := l3SampleReport{Label: sp.Label, Frame: sp.Frame, TimeSec: sp.TimeSec}
		pngPath := filepath.Join(outDir, fmt.Sprintf("sample-%s-f%04d.png", sp.Label, sp.Frame))
		if sn, xerr := l3ExtractFrame(ctx, ffmpeg, outputPath, sp.TimeSec, pngPath); xerr != nil {
			sr.Verdict = "fail"
			sr.ExtractSn = sn
			fail(fmt.Sprintf("extract %s@%.3fs: %v", sp.Label, sp.TimeSec, xerr))
		} else {
			if st, serr := os.Stat(pngPath); serr == nil {
				sr.PNGBytes = st.Size()
				sr.PNGRatio = float64(st.Size()) / float64(c.W*c.H*3)
			}
			b, derr := os.ReadFile(pngPath)
			var img image.Image
			if derr == nil {
				img, derr = png.Decode(strings.NewReader(string(b)))
			}
			if derr != nil {
				sr.Verdict = "fail"
				sr.FailWhy = "png decode: " + derr.Error()
				fail(fmt.Sprintf("sample %s (F%d): png decode failed: %v", sp.Label, sp.Frame, derr))
			} else {
				sr.Stats = l3FrameStats(img)
				ok, why := l3FrameVerdict(sr.Stats)
				if ok {
					sr.Verdict = "ok"
				} else {
					sr.Verdict = "fail"
					sr.FailWhy = why
					fail(fmt.Sprintf("sample %s (F%d, %.3fs): %s [stats: mean=%.2f std=%.2f dark=%.4f bright=%.4f]",
						sp.Label, sp.Frame, sp.TimeSec, why, sr.Stats.MeanLum, sr.Stats.StdLum, sr.Stats.DarkRatio, sr.Stats.BrightRatio))
				}
			}
		}
		entry.Samples = append(entry.Samples, sr)
		if sr.Stats.Pixels > 0 {
			samples = append(samples, samp{sp.Label, sp.Frame, sp.TimeSec, sr.Stats})
		}
		t.Logf("sample %s F%d@%.3fs: verdict=%s mean=%.2f std=%.2f dark=%.4f bright=%.4f png=%dB",
			sp.Label, sp.Frame, sp.TimeSec, sr.Verdict, sr.Stats.MeanLum, sr.Stats.StdLum, sr.Stats.DarkRatio, sr.Stats.BrightRatio, sr.PNGBytes)
	}
	// pairwise deltas: evidence of content changing over time
	for i := 1; i < len(samples); i++ {
		a, b := samples[i-1], samples[i]
		pw := l3Pairwise{
			Pair:         a.label + "-" + b.label,
			MeanLumDelta: math.Abs(a.stats.MeanLum - b.stats.MeanLum),
			StdLumDelta:  math.Abs(a.stats.StdLum - b.stats.StdLum),
		}
		entry.Pairwise = append(entry.Pairwise, pw)
	}
	if len(samples) == len(samplePts) {
		maxMean, maxStd := 0.0, 0.0
		for _, pw := range entry.Pairwise {
			if pw.MeanLumDelta > maxMean {
				maxMean = pw.MeanLumDelta
			}
			if pw.StdLumDelta > maxStd {
				maxStd = pw.StdLumDelta
			}
		}
		if maxMean < 0.05 && maxStd < 0.05 {
			fail(fmt.Sprintf("all three sampled frames statistically identical (max meanΔ=%.4f stdΔ=%.4f) — timeline produced a static video", maxMean, maxStd))
		} else if maxMean < 0.3 && maxStd < 0.3 {
			entry.Notes = append(entry.Notes, fmt.Sprintf("sampled frames nearly identical (max meanΔ=%.3f stdΔ=%.3f) — consistent with the degraded IR's long static stretches (recorded, not failed; e.g. C01 between the entrance block and the counter anchor)", maxMean, maxStd))
		}
	}

	// -- 6. full-decode re-verification of the shipped bytes --
	dv := batch6DecodeVerifyRun(ctx, ffmpeg, outputPath)
	entry.DecodeVerify = dv
	if !dv.StderrEmpty || dv.ExitErr != "" {
		fail("decode-verify stderr not clean (ffmpeg -v error): exit=" + dv.ExitErr + " stderr=" + dv.Stderr)
	}

	// -- 7. verdict + merged report --
	entry.TotalMS = time.Since(start).Milliseconds()
	if entry.Status == "" {
		entry.Status = "pass" // fail() set "fail" above; clean run = pass
	}
	status := entry.Status
	l3UpsertCase(rep, entry)
	l3WriteReport(t, reportPath, rep)

	for _, n := range entry.Notes {
		t.Logf("%s note: %s", c.CaseID, n)
	}
	if status != "pass" {
		t.Fatalf("%s FAILED assertions (%d):\n  %s", c.CaseID, len(entry.FailReasons), strings.Join(entry.FailReasons, "\n  "))
	}
	audioState := "silent"
	if entry.Audio != nil && entry.Audio.Present {
		audioState = fmt.Sprintf("audio mean %.1f dB / max %.1f dB", entry.Audio.MeanVolumeDB, entry.Audio.MaxVolumeDB)
	}
	t.Logf("%s PASS: %dx%d@%g, %d frames (count_packets), video duration %.4fs, %s, decode-verify clean, %d bytes (%.0f kbps), render %d ms (%.1f ms/frame)",
		c.CaseID, info.Width, info.Height, info.FPS, entry.CountPackets, info.Duration, audioState,
		entry.MP4Bytes, entry.BitrateKbps, entry.RenderMS, entry.MSPerFrame)
}

// ---- the five per-case tests (runnable individually) ----

func TestL3FullC01(t *testing.T) { l3RunCase(t, l3Cases()[0]) }
func TestL3FullC02(t *testing.T) { l3RunCase(t, l3Cases()[1]) }
func TestL3FullC03(t *testing.T) { l3RunCase(t, l3Cases()[2]) }
func TestL3FullC04(t *testing.T) { l3RunCase(t, l3Cases()[3]) }
func TestL3FullC05(t *testing.T) { l3RunCase(t, l3Cases()[4]) }
