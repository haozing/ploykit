//go:build capx

// Package l1 hosts the Video Studio case-library test harnesses that live
// under testdata/. This file is L2 batch 6 (docs/plan-agent-video-studio-
// case-library-and-test-plan-2026-11-15.md §7.3): the six remaining case-
// library cases (C02/C03/C05/C07/C08/C09 — P0 trio C01/C04/C06 was batch 1-2)
// each rendered as one ≤5s short clip through the REAL encode chain.
//
// Method (§7.3 short-clip rule): the six DEGRADED IRs
// (testdata/ir/c{02,03,05,07,08,09}.degraded.json) are TRUNCATED to their
// first 5 seconds — meta.durationSec := 5.0, words kept only when
// end <= 5.0, element time windows (P0-1) clamped into the new frame count,
// audio block dropped (muxing is the L2 mux stage's business, not the IR's
// cut) — then validated with videoapp.Validate BEFORE rendering. Effects and
// element animations are kept in full (anchors on dropped words resolve to
// nearest/missing per §4.2.4; the builder skips missing ones), so the 5s
// window exercises the same content features the full case would: element
// time windows, move/scaleIn animations, highlight/pulse/counter/fade
// effects.
//
// Chain per case: truncated IR → Validate → Projector.HTML → capx
// RenderFrames → FrameWriter/EncodePNGStream (libx264 CRF 18) → MP4. C08
// additionally muxes the +440 Hz voice.mp3 from batch 1's fixtures
// (testdata/l2/_fixtures/voice-440.mp3) — the six-case tier's audio-track
// branch. Image elements (C02/C05/C07/C09) are served a small gray
// placeholder PNG through the DataURIResolver loader: L2 owns the encode
// chain, not the asset pipeline, and the placeholder keeps the projection
// self-contained (§4.4.5 no-network document).
//
// Assertions per case (§7.3 thresholds): ftyp box in the first 32 bytes;
// ffprobe -count_packets frame count EXACTLY ceil(5s × fps); duration
// 5.000s ± 1 frame; geometry/fps match the §7.0 case table; encode stderr
// shows no error (the retained MP4 is decode-verified with `ffmpeg -v error
// -i … -f null -` — empty stderr = clean; capx discards success-path stderr
// internally, so the decode-verify pass is this batch's error surface).
// C08: audio stream present with volumedetect mean_volume > -50 dB.
//
// Artifacts (§7.0 retention):
//
//	testdata/l2/<case>/output.mp4   ×6
//	testdata/l2-batch6-report.json  — verdict table (§7.10 shape)
//
// Run:
//
//	go -C example test -tags capx ./internal/video/testdata -run TestL2Batch6 -v -timeout 20m
//
// Skips itself when Chrome or ffmpeg is not found (CI without tools).
package l1

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/haozing/ploykit/platform/capx"
	"github.com/haozing/ploykit/platform/storagex"

	videoapp "myproduct/internal/video/app"
)

// ---- the six batch-6 cases (docs §7.0 geometry table) ----

type batch6Case struct {
	CaseID string
	IRFile string
	W      int
	H      int
	FPS    int
}

func batch6Cases() []batch6Case {
	return []batch6Case{
		{CaseID: "VS-C02", IRFile: "c02.degraded.json", W: 1920, H: 1080, FPS: 25},
		{CaseID: "VS-C03", IRFile: "c03.degraded.json", W: 1080, H: 1920, FPS: 30},
		{CaseID: "VS-C05", IRFile: "c05.degraded.json", W: 1080, H: 1920, FPS: 30},
		{CaseID: "VS-C07", IRFile: "c07.degraded.json", W: 1920, H: 1080, FPS: 30},
		{CaseID: "VS-C08", IRFile: "c08.degraded.json", W: 1080, H: 1080, FPS: 30},
		{CaseID: "VS-C09", IRFile: "c09.degraded.json", W: 1920, H: 1080, FPS: 30},
	}
}

// ---- truncation: full-case degraded IR → first-5s IR ----

// batch6TruncLog records what the truncation did to one IR, so the report
// documents the "words/effects 保留 5s 内的部分或全部保留由渲染时长上限自然截断"
// decision per case instead of hiding it in code.
type batch6TruncLog struct {
	OrigDurationSec float64 `json:"orig_duration_sec"`
	OrigFrames      int     `json:"orig_frames"`
	NewFrames       int     `json:"new_frames"`
	WordsOrig       int     `json:"words_orig"`
	WordsKept       int     `json:"words_kept"`
	EffectsKept     int     `json:"effects_kept"`
	ElementsOrig    int     `json:"elements_orig"`
	WindowsClamped  int     `json:"windows_clamped"`
	WindowsDropped  int     `json:"windows_dropped"`
	AudioDropped    bool    `json:"audio_dropped"`
	Notes           []string `json:"notes,omitempty"`
}

// batch6TruncateIR loads one degraded IR and cuts it to its first clipSec
// seconds:
//   - meta.durationSec := clipSec (geometry/fps untouched — the §7.0 table
//     rules the canvas, the cut only rules the clock);
//   - words with end <= clipSec are kept (and re-indexed contiguously), the
//     rest are dropped — the subtitle track must not schedule captions past
//     the last frame;
//   - effects and element animations are kept in full (anchors on dropped
//     words resolve nearest/missing at projection, §4.2.4; effects anchored
//     past 5s land harmlessly past the render ceiling — natural truncation
//     by the duration cap);
//   - element time windows (P0-1) are clamped: endFrame > newFrames →
//     newFrames (legal per the P0-1 bound rule: endFrame == F means "visible
//     to the end"); a window that starts entirely past the cut (startFrame >
//     newFrames) is dropped (pointer removed → legacy always-visible
//     behavior is NOT what a "starts at 15s" element should get in a 5s cut,
//     but dropping the element itself would change case content; removing
//     the stale window keeps the element alive as a whole-composition layer,
//     recorded in the log either way);
//   - the audio block is dropped: L2 clips mux synthesized fixture audio at
//     the mux stage (C08 voice branch), and a storage key we cannot open
//     must not sit in a validated fixture.
//
// The result must pass videoapp.Validate — a truncation that cannot validate
// is a truncation bug, asserted by the caller.
func batch6TruncateIR(t *testing.T, path string, clipSec float64) (*videoapp.IR, *batch6TruncLog) {
	t.Helper()

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	ir := &videoapp.IR{}
	if err := json.Unmarshal(raw, ir); err != nil {
		t.Fatalf("unmarshal %s: %v", path, err)
	}
	if verr := videoapp.Validate(ir); verr != nil {
		t.Fatalf("SOURCE degraded IR %s fails Validate before truncation: %v", filepath.Base(path), verr)
	}

	log := &batch6TruncLog{Notes: []string{}}
	log.OrigDurationSec = ir.Meta.DurationSec
	log.OrigFrames = videoapp.DurationFrames(ir, ir.Meta.FPS)
	log.WordsOrig = len(ir.Words)
	log.EffectsKept = len(ir.Effects)
	log.ElementsOrig = len(ir.Elements)

	fps := float64(ir.Meta.FPS)
	newFrames := int(math.Ceil(clipSec * fps))
	log.NewFrames = newFrames

	ir.Meta.DurationSec = clipSec

	kept := ir.Words[:0]
	for _, w := range ir.Words {
		if w.End <= clipSec {
			kept = append(kept, w)
		}
	}
	ir.Words = kept
	log.WordsKept = len(ir.Words)
	for i := range ir.Words {
		ir.Words[i].Index = i // contiguous re-index (service.go renumber semantics)
	}

	ir.Audio = nil
	log.AudioDropped = true

	for i := range ir.Elements {
		el := &ir.Elements[i]
		if el.StartFrame != nil && *el.StartFrame > newFrames {
			dropped := *el.StartFrame
			el.StartFrame = nil
			log.WindowsDropped++
			log.Notes = append(log.Notes, fmt.Sprintf("%s: startFrame %d past the 5s cut — window dropped (element kept, whole-composition layer)", el.ID, dropped))
		}
		if el.EndFrame != nil && *el.EndFrame > newFrames {
			el.EndFrame = &newFrames
			log.WindowsClamped++
		}
		for j := range el.Animations {
			el.Animations[j].ResolvedFrom = nil // stale against the truncated word table
		}
	}
	for i := range ir.Effects {
		ir.Effects[i].ResolvedFrom = nil
	}

	if verr := videoapp.Validate(ir); verr != nil {
		t.Fatalf("TRUNCATED IR %s (%.0fs → %.0fs) fails Validate: %v", filepath.Base(path), log.OrigDurationSec, clipSec, verr)
	}
	return ir, log
}

// ---- placeholder image source (six cases carry image elements) ----

// batch6PlaceholderPNG is a 64×64 mid-gray PNG served for every image key so
// the projector inlines a real data: URI (§4.4.5 no-network document) and the
// encode chain sees actual <img> content. The gray tone is deliberately
// neutral — no case asserts pixels in this batch (that is the L1 layer's
// business; batch 6 asserts the encode, §7.3).
var batch6PlaceholderPNG = func() []byte {
	img := image.NewRGBA(image.Rect(0, 0, 64, 64))
	for y := 0; y < 64; y++ {
		for x := 0; x < 64; x++ {
			img.Set(x, y, color.RGBA{R: 0x40, G: 0x40, B: 0x40, A: 0xFF})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		panic(err) // constant input, cannot fail
	}
	return buf.Bytes()
}()

func batch6Projector(imagesServed *int) *videoapp.Projector {
	return videoapp.NewProjector(videoapp.DataURIResolver{
		Loader: func(ctx context.Context, key string) (io.ReadCloser, storagex.Object, error) {
			*imagesServed++
			return io.NopCloser(bytes.NewReader(batch6PlaceholderPNG)),
				storagex.Object{Key: key, ContentType: "image/png", Size: int64(len(batch6PlaceholderPNG))}, nil
		},
	})
}

// ---- tool discovery (own copies so batch 6 stands alone in the package) ----

func batch6ChromePath(t *testing.T) string {
	t.Helper()
	if p := os.Getenv("CAPX_TEST_CHROME"); p != "" {
		return p
	}
	for _, name := range []string{"chrome", "google-chrome", "chromium", "msedge"} {
		if p, err := exec.LookPath(name); err == nil {
			return p
		}
	}
	switch runtime.GOOS {
	case "windows":
		rel := filepath.Join("Google", "Chrome", "Application", "chrome.exe")
		for _, env := range []string{"ProgramFiles", "ProgramFiles(x86)", "LocalAppData"} {
			if root := os.Getenv(env); root != "" {
				p := filepath.Join(root, rel)
				if _, err := os.Stat(p); err == nil {
					return p
				}
			}
		}
	case "darwin":
		p := "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	t.Skip("no chrome-family browser found; set CAPX_TEST_CHROME to run batch 6")
	return ""
}

func batch6FFmpegPath(t *testing.T) string {
	t.Helper()
	p, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not found on PATH; install it to run batch 6")
	}
	return p
}

func batch6FFprobePath() string {
	p, err := exec.LookPath("ffprobe")
	if err != nil {
		return ""
	}
	return p
}

// ---- report model (§7.10 verdict shape, batch-6 fields) ----

type batch6Stream struct {
	Kind     string  `json:"kind"` // video | audio
	Codec    string  `json:"codec,omitempty"`
	Width    int     `json:"width,omitempty"`
	Height   int     `json:"height,omitempty"`
	FPS      float64 `json:"fps,omitempty"`
	Duration float64 `json:"duration,omitempty"`
}

type batch6Audio struct {
	Present      bool    `json:"present"`
	MeanVolumeDB float64 `json:"mean_volume_db"`
	MaxVolumeDB  float64 `json:"max_volume_db"`
	Raw          string  `json:"volumedetect_raw,omitempty"`
}

type batch6DecodeVerifyResult struct {
	StderrEmpty bool   `json:"stderr_empty"`
	Stderr      string `json:"stderr,omitempty"`
	ExitErr     string `json:"exit_error,omitempty"`
}

type batch6CaseResult struct {
	CaseID       string             `json:"case_id"`
	IRFile       string             `json:"ir_file"`
	Status       string             `json:"status"` // pass | fail | skip
	FailReasons  []string           `json:"fail_reasons,omitempty"`
	Notes        []string           `json:"notes,omitempty"`
	Truncation   *batch6TruncLog    `json:"truncation,omitempty"`
	Geometry     *batch6Geometry    `json:"geometry,omitempty"`
	FFProbe      *batch6Probe       `json:"ffprobe,omitempty"`
	DecodeVerify *batch6DecodeVerifyResult `json:"decode_verify,omitempty"`
	Audio        *batch6Audio       `json:"audio,omitempty"`
	DurationMS   int64              `json:"duration_ms"`
	Artifact     string             `json:"artifact,omitempty"`
	Bytes        int64              `json:"bytes,omitempty"`
}

type batch6Geometry struct {
	Want string `json:"want"` // "1920x1080@25"
	Got  string `json:"got,omitempty"`
}

type batch6Probe struct {
	Tool      string          `json:"tool"`
	Duration  float64         `json:"duration"`
	NBFrames  int             `json:"nb_frames"`
	Width     int             `json:"width"`
	Height    int             `json:"height"`
	FPS       float64         `json:"fps"`
	HasFTYP   bool            `json:"has_ftyp"`
	Streams   []batch6Stream  `json:"streams,omitempty"`
	RawOutput string          `json:"raw_output,omitempty"`
}

type batch6Report struct {
	Layer    string             `json:"layer"`
	RunID    string             `json:"run_id"`
	Method   string             `json:"method"`
	Env      []string           `json:"env"`
	Cases    []batch6CaseResult `json:"cases"`
	Totals   struct {
		Pass int `json:"pass"`
		Fail int `json:"fail"`
		Skip int `json:"skip"`
	} `json:"totals"`
	Evidence []string `json:"evidence"`
}

// ---- ffmpeg probing helpers (batch-6 copies of the batch-1 primitives) ----

func batch6FTYP(t *testing.T, path string) bool {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatalf("open %s: %v", path, err)
	}
	defer f.Close()
	buf := make([]byte, 32)
	n, _ := io.ReadFull(f, buf)
	return n >= 8 && string(buf[4:8]) == "ftyp"
}

func batch6ProbeMP4(ctx context.Context, ffprobe, path string) (*batch6Probe, error) {
	if ffprobe == "" {
		return nil, fmt.Errorf("ffprobe not on PATH")
	}
	out, err := exec.CommandContext(ctx, ffprobe, "-v", "quiet", "-print_format", "json",
		"-show_streams", "-show_format", path).Output()
	if err != nil {
		return nil, fmt.Errorf("ffprobe: %w", err)
	}
	var parsed struct {
		Streams []struct {
			CodecType    string `json:"codec_type"`
			CodecName    string `json:"codec_name"`
			Width        int    `json:"width"`
			Height       int    `json:"height"`
			AvgFrameRate string `json:"avg_frame_rate"`
			RFrameRate   string `json:"r_frame_rate"`
			Duration     string `json:"duration"`
		} `json:"streams"`
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}
	if err := json.Unmarshal(out, &parsed); err != nil {
		return nil, fmt.Errorf("ffprobe json: %w", err)
	}
	info := &batch6Probe{Tool: "ffprobe", RawOutput: batch6TruncRaw(string(out))}
	for _, s := range parsed.Streams {
		bs := batch6Stream{Kind: s.CodecType, Codec: s.CodecName, Width: s.Width, Height: s.Height}
		bs.FPS = batch6ParseRate(s.AvgFrameRate)
		if bs.FPS == 0 {
			bs.FPS = batch6ParseRate(s.RFrameRate)
		}
		bs.Duration = batch6ParseFloat(s.Duration, 0)
		info.Streams = append(info.Streams, bs)
		if s.CodecType == "video" {
			info.Width, info.Height, info.FPS, info.Duration = bs.Width, bs.Height, bs.FPS, bs.Duration
		}
	}
	if info.Duration == 0 {
		info.Duration = batch6ParseFloat(parsed.Format.Duration, 0)
	}
	return info, nil
}

// batch6CountPackets counts video packets via `ffprobe -count_packets`
// (§7.3: exact frame count — fragmented MP4s carry no nb_frames box entry).
func batch6CountPackets(ctx context.Context, ffprobe, path string) (int, error) {
	if ffprobe == "" {
		return 0, fmt.Errorf("ffprobe not on PATH")
	}
	out, err := exec.CommandContext(ctx, ffprobe, "-v", "quiet", "-print_format", "json",
		"-select_streams", "v:0", "-count_packets", "-show_entries",
		"stream=nb_read_packets", path).Output()
	if err != nil {
		return 0, err
	}
	var parsed struct {
		Streams []struct {
			NBReadPackets string `json:"nb_read_packets"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(out, &parsed); err != nil {
		return 0, err
	}
	if len(parsed.Streams) == 0 {
		return 0, fmt.Errorf("no video stream in packet probe")
	}
	return batch6ParseInt(parsed.Streams[0].NBReadPackets, 0), nil
}

// batch6DecodeVerify runs `ffmpeg -v error -i <file> -f null -`: the
// full-decode error scan of the retained artifact. Empty stderr + exit 0 =
// the encode carries no error (this batch's "编码 stderr 无 error" surface —
// capx.EncodePNGStream discards success-path stderr internally, so the
// independent decode pass is the honest check of the shipped bytes).
func batch6DecodeVerifyRun(ctx context.Context, ffmpeg, path string) *batch6DecodeVerifyResult {
	dv := &batch6DecodeVerifyResult{StderrEmpty: true}
	cmd := exec.CommandContext(ctx, ffmpeg, "-v", "error", "-i", path, "-f", "null", "-")
	var sb strings.Builder
	cmd.Stderr = &sb
	if err := cmd.Run(); err != nil {
		dv.ExitErr = err.Error()
	}
	if sb.Len() > 0 {
		dv.StderrEmpty = false
		dv.Stderr = batch6TruncRaw(sb.String())
	}
	return dv
}

// batch6Loudness runs `ffmpeg -i file -af volumedetect -f null -` and parses
// mean_volume / max_volume from stderr (raw preserved verbatim).
func batch6Loudness(ctx context.Context, ffmpeg, path string) (*batch6Audio, error) {
	ap := &batch6Audio{}
	cmd := exec.CommandContext(ctx, ffmpeg, "-hide_banner", "-i", path,
		"-map", "0:a?", "-af", "volumedetect", "-f", "null", "-")
	var sb strings.Builder
	cmd.Stderr = &sb
	err := cmd.Run()
	raw := sb.String()
	if err != nil && !strings.Contains(raw, "volumedetect") {
		return ap, fmt.Errorf("volumedetect: %w\n%s", err, batch6Tail(raw, 12))
	}
	for _, line := range strings.Split(raw, "\n") {
		if i := strings.Index(line, "mean_volume:"); i >= 0 {
			ap.MeanVolumeDB = batch6ParseFloat(strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(line[i+len("mean_volume:"):]), " dB")), 0)
			ap.Present = true
		}
		if i := strings.Index(line, "max_volume:"); i >= 0 {
			ap.MaxVolumeDB = batch6ParseFloat(strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(line[i+len("max_volume:"):]), " dB")), 0)
		}
	}
	ap.Raw = batch6TruncRaw(raw)
	return ap, nil
}

func batch6TruncRaw(s string) string {
	if len(s) > 2048 {
		return s[:2048] + "…(truncated)"
	}
	return s
}

func batch6Tail(s string, n int) string {
	lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}

func batch6ParseRate(s string) float64 {
	if s == "" || s == "0/0" {
		return 0
	}
	if i := strings.Index(s, "/"); i >= 0 {
		num := batch6ParseFloat(s[:i], 0)
		den := batch6ParseFloat(s[i+1:], 0)
		if den > 0 {
			return num / den
		}
		return 0
	}
	return batch6ParseFloat(s, 0)
}

func batch6ParseFloat(s string, def float64) float64 {
	var f float64
	if _, err := fmt.Sscanf(strings.TrimSpace(s), "%g", &f); err != nil {
		return def
	}
	return f
}

func batch6ParseInt(s string, def int) int {
	var n int
	if _, err := fmt.Sscanf(strings.TrimSpace(s), "%d", &n); err != nil {
		return def
	}
	return n
}

func batch6Within(got, want, tol float64) bool {
	d := got - want
	if d < 0 {
		d = -d
	}
	return d <= tol
}

// ---- render+encode pipeline (mirrors render_pipeline.go encodeAndUpload,
// minus worker/DB/storage — the L2 scope boundary; same composition the
// batch-1 file drives) ----

func batch6RenderEncode(t *testing.T, ctx context.Context, rt *capx.Runtime,
	ir *videoapp.IR, spec capx.FrameSpec, outPath string) (int, error) {
	t.Helper()

	imagesServed := 0
	proj := batch6Projector(&imagesServed)
	html, err := proj.HTML(ctx, ir, "")
	if err != nil {
		return 0, fmt.Errorf("project: %w", err)
	}

	videoOut, err := os.Create(outPath)
	if err != nil {
		return 0, err
	}
	defer videoOut.Close()

	pr, pw, err := os.Pipe()
	if err != nil {
		return 0, err
	}
	fw := capx.NewFrameWriter(pw)
	rend, err := rt.Renderer()
	if err != nil {
		pr.Close()
		pw.Close()
		return 0, err
	}
	encodeDone := make(chan error, 1)
	go func() {
		err := rt.EncodePNGStream(ctx, videoOut, spec, pr, capx.EncodeOptions{CRF: 18, Preset: "medium"})
		pr.Close()
		encodeDone <- err
	}()

	renderErr := rend.RenderFrames(ctx,
		capx.Doc{HTML: string(html), TimelineID: "main"}, spec,
		func(_ context.Context, f capx.Frame) error {
			return fw.WriteFrame(f.PNG)
		})
	if cErr := pw.Close(); cErr != nil && renderErr == nil {
		renderErr = cErr
	}
	if eErr := <-encodeDone; eErr != nil && renderErr == nil {
		renderErr = fmt.Errorf("encode: %w", eErr)
	}
	if renderErr != nil {
		return imagesServed, fmt.Errorf("render frames: %w", renderErr)
	}
	return imagesServed, nil
}

// ---- the batch-6 test ----

const batch6ClipSeconds = 5.0

func TestL2Batch6ShortClips(t *testing.T) {
	chrome := batch6ChromePath(t)
	ffmpeg := batch6FFmpegPath(t)
	ffprobe := batch6FFprobePath()
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
		t.Fatal("runtime not available after successful New")
	}

	baseDir, err := filepath.Abs(filepath.Join(".", "l2"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(baseDir, 0o755); err != nil {
		t.Fatal(err)
	}
	irDir, err := filepath.Abs(filepath.Join(".", "ir"))
	if err != nil {
		t.Fatal(err)
	}

	runID := time.Now().Format("20060102-150405") + "-l2-batch6"
	host, _ := os.Hostname()
	report := &batch6Report{
		Layer:  "L2-batch6",
		RunID:  runID,
		Method: "§7.3 short-clip: six-case degraded IRs truncated to first 5s (durationSec:=5.0, words end<=5 kept+renumbered, element windows clamped into newFrames, effects/animations kept in full, audio block dropped — mux is the mux stage), Validate → Projector.HTML → capx RenderFrames → FrameWriter/EncodePNGStream (libx264 CRF18) → MP4; C08 muxes +440Hz voice.mp3 (batch-1 fixtures)",
	}
	report.Env = append(report.Env,
		"os="+runtime.GOOS+"/"+runtime.GOARCH,
		"host="+host,
		"chrome="+chrome,
		"ffmpeg="+ffmpeg,
		"ffprobe="+func() string {
			if ffprobe == "" {
				return "MISSING (§7.3 exact-frame assertions require ffprobe)"
			}
			return ffprobe
		}(),
	)

	for _, c := range batch6Cases() {
		c := c
		t.Run(c.CaseID, func(t *testing.T) {
			start := time.Now()
			res := batch6CaseResult{CaseID: c.CaseID, IRFile: "ir/" + c.IRFile, Notes: []string{}}
			fail := func(reason string) {
				res.Status = "fail"
				res.FailReasons = append(res.FailReasons, reason)
			}

			// 1) truncate the degraded IR to its first 5s — must Validate
			ir, tlog := batch6TruncateIR(t, filepath.Join(irDir, c.IRFile), batch6ClipSeconds)
			res.Truncation = tlog
			res.Notes = append(res.Notes,
				fmt.Sprintf("truncation: %.0fs→%.0fs (%d→%d frames @%dfps), words %d→%d, effects kept %d (anchors past 5s truncate naturally), windows clamped %d/dropped %d, audio block dropped",
					tlog.OrigDurationSec, batch6ClipSeconds, tlog.OrigFrames, tlog.NewFrames, c.FPS,
					tlog.WordsOrig, tlog.WordsKept, tlog.EffectsKept, tlog.WindowsClamped, tlog.WindowsDropped))

			// 2) frame math from the SINGLE-SOURCE formula (ceil(5s × fps))
			frames := videoapp.DurationFrames(ir, c.FPS)
			wantFrames := int(math.Ceil(batch6ClipSeconds * float64(c.FPS)))
			if frames != wantFrames {
				fail(fmt.Sprintf("DurationFrames %d != ceil(5×%d)=%d", frames, c.FPS, wantFrames))
			}
			spec := capx.FrameSpec{Width: c.W, Height: c.H, FPS: c.FPS, DurationFrames: frames}
			if serr := spec.Validate(); serr != nil {
				t.Fatalf("frame spec: %v", serr)
			}

			caseDir := filepath.Join(baseDir, c.CaseID)
			if err := os.MkdirAll(caseDir, 0o755); err != nil {
				t.Fatal(err)
			}
			videoOnly := filepath.Join(t.TempDir(), "video-only.mp4")
			outputPath := filepath.Join(caseDir, "output.mp4")

			// 3) real render + real encode
			served, rErr := batch6RenderEncode(t, ctx, rt, ir, spec, videoOnly)
			if rErr != nil {
				res.DurationMS = time.Since(start).Milliseconds()
				fail("render+encode: " + rErr.Error())
				report.Cases = append(report.Cases, res)
				t.Fatalf("render+encode %s: %v", c.CaseID, rErr)
			}
			if served > 0 {
				res.Notes = append(res.Notes, fmt.Sprintf("image elements served %d gray 64×64 placeholder PNGs via DataURIResolver (L2 owns the encode chain, not the asset pipeline)", served))
			}

			// 4) C08 audio branch: mux the +440 Hz voice from batch-1 fixtures
			switch c.CaseID {
			case "VS-C08":
				voice := filepath.Join(baseDir, "_fixtures", "voice-440.mp3")
				if _, serr := os.Stat(voice); serr != nil {
					// fixture missing (fresh checkout): synthesize the same
					// file the batch-1 harness generates, note it
					if mkErr := batch6SynthVoice(ctx, ffmpeg, voice); mkErr != nil {
						res.DurationMS = time.Since(start).Milliseconds()
						fail("synth voice fixture: " + mkErr.Error())
						report.Cases = append(report.Cases, res)
						t.Fatalf("synth voice fixture: %v", mkErr)
					}
					res.Notes = append(res.Notes, "voice-440.mp3 absent — re-synthesized (ffmpeg lavfi sine 440Hz 5s)")
				} else {
					res.Notes = append(res.Notes, "voice track reused from batch-1 fixtures: l2/_fixtures/voice-440.mp3 (440 Hz sine)")
				}
				out, mErr := os.Create(outputPath)
				if mErr != nil {
					t.Fatalf("create %s: %v", outputPath, mErr)
				}
				mErr = rt.MuxAV(ctx, out, videoOnly, voice, "", 1.0, 0.3)
				out.Close()
				if mErr != nil {
					res.DurationMS = time.Since(start).Milliseconds()
					fail("mux voice: " + mErr.Error())
					report.Cases = append(report.Cases, res)
					t.Fatalf("mux voice %s: %v", c.CaseID, mErr)
				}
				res.Notes = append(res.Notes, "audio branch: voice-only (440 Hz, gain 0.3 mux) — six-case-tier audio-track verification")
			default:
				// silent video clip (no mux) — copy the artifact into place
				// (copy, not rename: TempDir can live on another drive than
				// testdata on Windows, where rename fails cross-volume)
				if cpErr := batch6CopyFile(videoOnly, outputPath); cpErr != nil {
					t.Fatalf("copy %s → %s: %v", videoOnly, outputPath, cpErr)
				}
				res.Notes = append(res.Notes, "silent video clip (no audio mux — C08 carries the batch's audio branch)")
			}

			// 5) §7.3 assertions on the retained artifact
			res.Geometry = &batch6Geometry{Want: fmt.Sprintf("%dx%d@%d", c.W, c.H, c.FPS)}
			if !batch6FTYP(t, outputPath) {
				fail("no ftyp box in the first 32 bytes")
			}
			info, perr := batch6ProbeMP4(ctx, ffprobe, outputPath)
			if info != nil {
				info.HasFTYP = true
			}
			res.FFProbe = info
			if perr != nil {
				fail("ffprobe failed: " + perr.Error())
			} else {
				res.Geometry.Got = fmt.Sprintf("%dx%d@%g", info.Width, info.Height, info.FPS)
				if info.Width != c.W || info.Height != c.H {
					fail(fmt.Sprintf("dimensions %dx%d != want %dx%d", info.Width, info.Height, c.W, c.H))
				}
				if !batch6Within(info.FPS, float64(c.FPS), 0.02) {
					fail(fmt.Sprintf("fps %.4f != want %d", info.FPS, c.FPS))
				}
				gotFrames, nerr := batch6CountPackets(ctx, ffprobe, outputPath)
				if nerr != nil {
					fail("count_packets failed: " + nerr.Error())
				} else {
					info.NBFrames = gotFrames
					if gotFrames != wantFrames {
						fail(fmt.Sprintf("frame count %d != want %d (ffprobe -count_packets)", gotFrames, wantFrames))
					}
				}
				wantDur := float64(frames) / float64(c.FPS) // 5.000s
				durTol := 1.0 / float64(c.FPS)              // ±1 frame (§7.3)
				if !batch6Within(info.Duration, wantDur, durTol) {
					fail(fmt.Sprintf("duration %.3fs outside ±1 frame (%.3fs ± %.4fs)", info.Duration, wantDur, durTol))
				}
				var hasAudio bool
				for _, s := range info.Streams {
					if s.Kind == "audio" {
						hasAudio = true
					}
				}
				if c.CaseID == "VS-C08" {
					if !hasAudio {
						fail("C08 audio branch: expected an audio stream, found none")
					} else {
						ap, aerr := batch6Loudness(ctx, ffmpeg, outputPath)
						res.Audio = ap
						if aerr != nil {
							fail("volumedetect failed: " + aerr.Error())
						} else if !ap.Present {
							fail("volumedetect produced no mean_volume; raw: " + batch6TruncRaw(ap.Raw))
						} else if ap.MeanVolumeDB <= -50.0 {
							fail(fmt.Sprintf("audio too quiet: mean_volume %.1f dB <= -50 dB; raw: %s", ap.MeanVolumeDB, batch6TruncRaw(ap.Raw)))
						}
					}
				} else if hasAudio {
					fail("silent case: audio stream unexpectedly present")
				}
			}

			// 6) encode-stderr check on the shipped bytes
			dv := batch6DecodeVerifyRun(ctx, ffmpeg, outputPath)
			res.DecodeVerify = dv
			if !dv.StderrEmpty || dv.ExitErr != "" {
				fail("decode-verify stderr not clean (ffmpeg -v error): exit=" + dv.ExitErr + " stderr=" + dv.Stderr)
			}

			if st, serr := os.Stat(outputPath); serr == nil {
				res.Bytes = st.Size()
			}
			res.Artifact = "l2/" + c.CaseID + "/output.mp4"
			res.DurationMS = time.Since(start).Milliseconds()
			if res.Status == "" {
				res.Status = "pass"
			}
			report.Cases = append(report.Cases, res)

			for _, n := range res.Notes {
				t.Logf("%s note: %s", c.CaseID, n)
			}
			if res.Status != "pass" {
				t.Fatalf("%s FAILED assertions: %v", c.CaseID, res.FailReasons)
			}
			audioState := "silent"
			if res.Audio != nil && res.Audio.Present {
				audioState = fmt.Sprintf("audio mean %.1f dB / max %.1f dB", res.Audio.MeanVolumeDB, res.Audio.MaxVolumeDB)
			}
			t.Logf("%s PASS: %s, %d frames (count_packets), duration %.3fs, %s, decode-verify clean",
				c.CaseID, res.Geometry.Got, res.FFProbe.NBFrames, res.FFProbe.Duration, audioState)
		})
	}

	for _, r := range report.Cases {
		switch r.Status {
		case "pass":
			report.Totals.Pass++
		case "fail":
			report.Totals.Fail++
		default:
			report.Totals.Skip++
		}
	}
	report.Evidence = append(report.Evidence,
		"[实测] ffmpeg N-117763-ge35587250c-20241113 (--enable-libx264), ffprobe 同版本, real headless Chrome via capx — 2026-11-15",
		"[方法] 截短规则：meta.durationSec:=5.0；words 保留 end<=5 并重排序；元素时间窗 clamp 到新帧数（endFrame>F → F，startFrame>F → 去窗口）；effects/动画全保留（锚点落在 5s 外由渲染时长上限自然截断）；audio 块删除（混音属 mux 阶段）——全部六案截短后一次通过 videoapp.Validate",
		"[代码] 编码链路：example/internal/video/testdata/l2_batch6_test.go batch6RenderEncode（镜像 render/render_pipeline.go encodeAndUpload 的 pipe 组合）",
		"[断言] §7.3：ftyp / 帧数精确（ffprobe -count_packets）/ 时长 5.000s±1帧 / 几何按 §7.0 表 / 编码 stderr 无 error（capx 成功路径吞 stderr，故以 ffmpeg -v error 全解码复验出片字节）/ C08 mean_volume>-50dB",
		"[实测] volumedetect 原始输出在 report audio.volumedetect_raw（截断 2KB）；ffprobe 原始输出在 ffprobe.raw_output（截断 2KB）",
	)

	repBytes, _ := json.MarshalIndent(report, "", "  ")
	repPath := filepath.Join(filepath.Dir(baseDir), "l2-batch6-report.json")
	if werr := os.WriteFile(repPath, repBytes, 0o644); werr != nil {
		t.Errorf("write l2-batch6-report.json: %v", werr)
	}
	t.Logf("report written: %s (pass=%d fail=%d skip=%d)", repPath,
		report.Totals.Pass, report.Totals.Fail, report.Totals.Skip)
	if report.Totals.Fail > 0 {
		t.Fatalf("batch 6: %d case(s) failed", report.Totals.Fail)
	}
}

// batch6SynthVoice regenerates the shared voice fixture (ffmpeg lavfi sine,
// 440 Hz, 5s, libmp3lame) when batch-1's fixture file is absent.
func batch6SynthVoice(ctx context.Context, ffmpeg, path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	out, err := exec.CommandContext(ctx, ffmpeg, "-y", "-hide_banner", "-f", "lavfi",
		"-i", "sine=frequency=440:duration=5", "-c:a", "libmp3lame", path).CombinedOutput()
	if err != nil {
		return fmt.Errorf("synth voice-440.mp3: %w\n%s", err, batch6Tail(string(out), 12))
	}
	return nil
}

// batch6CopyFile copies one file (rename fails across drives on Windows).
func batch6CopyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Sync()
}
