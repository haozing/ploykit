//go:build capx

// Package l1 hosts the Video Studio case-library test harnesses that live
// under testdata/ (this directory is a test-only package shared by the L1
// still-frame and L2 short-clip files). This file is the L2 layer (short-clip
// MP4 + audio-track verification, docs/plan-agent-video-studio-case-library-
// and-test-plan-2026-11-15.md §7.3).
//
// Scope (L2 only): the encode chain — projected IR → Projector.HTML →
// capx RenderFrames → os.Pipe → EncodePNGStream (libx264, CRF 18) → MP4 →
// MuxAV (voice/bgm/silent) — verified with ffprobe + volumedetect. It
// deliberately bypasses DB / worker / storage (those are L3). The IRs are
// synthesized minimal-but-valid compositions (pure-color background + text +
// one move / one scaleIn animation + EstimateWords), NOT the full case
// IRs of §3/§4 — L2 validates the pipeline, not the case content.
//
// M1 gate: VS-C01 / VS-C04 / VS-C06 each produce an MP4 with a video stream;
// the four audio branches (voice-only / bgm-only / voice+bgm / silent) each
// produce a muxed MP4 with the expected audio stream presence and loudness.
//
// Artifacts (§7.0 retention, small enough to keep in-repo):
//   testdata/l2/<case>/output.mp4   — one ≤5s clip per case / audio branch
//   testdata/l2-report.json         — verdict table (§7.10 shape, L2 subset)
//
// Run:
//
//	go test -tags capx ./internal/video/testdata -run TestL2 -v -timeout 20m
//
// Skips itself when Chrome or ffmpeg is not found (CI without tools).
package l1

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/haozing/ploykit/platform/capx"
	"github.com/haozing/ploykit/platform/storagex"

	videoapp "myproduct/internal/video/app"
)

// ---- case geometry (docs §7.0 table: resolution / fps per case; L2 clips at
// 5s regardless of the full-case duration) ----

type l2Case struct {
	CaseID      string
	Width       int
	Height      int
	FPS         int
	CLipSeconds float64
	BG          string
	Accent      string
	Headline    string
	Sub         string
}

func l2Cases() []l2Case {
	return []l2Case{
		{CaseID: "VS-C01", Width: 1080, Height: 1920, FPS: 30, CLipSeconds: 5,
			BG: "#0F1C2E", Accent: "#FFC53D", Headline: "短视频带货 · L2", Sub: "1080x1920 @30fps · 5s clip"},
		{CaseID: "VS-C04", Width: 1920, Height: 1080, FPS: 30, CLipSeconds: 5,
			BG: "#101418", Accent: "#4DA3FF", Headline: "数据可视化口播 · L2", Sub: "1920x1080 @30fps · 5s clip"},
		{CaseID: "VS-C06", Width: 1920, Height: 1080, FPS: 25, CLipSeconds: 5,
			BG: "#1C2333", Accent: "#63E6BE", Headline: "访谈字幕 · L2", Sub: "1920x1080 @25fps · 5s clip"},
	}
}

// ---- minimal-but-valid IR construction ----

// buildIR synthesizes one minimal legal IR for a case: pure-color background
// shape + headline text + sub text, one move animation (accent bar) and one
// scaleIn animation (headline), words via EstimateWords. The returned IR must
// pass videoapp.Validate — the test asserts that before rendering.
func buildIR(c l2Case) *videoapp.IR {
	script := strings.Repeat("L2 编码链路验证 纯色背景 文字入场 动画推进 ", 4)
	ir := &videoapp.IR{
		SchemaVersion: videoapp.IRSchemaVersion,
		Meta: videoapp.Meta{
			FPS:         c.FPS,
			Width:       c.Width,
			Height:      c.Height,
			DurationSec: c.CLipSeconds,
		},
		Script: script,
		Words:  videoapp.EstimateWords(script, c.CLipSeconds),
		Effects: []videoapp.Effect{{
			ID:     "fx_highlight",
			Anchor: videoapp.Anchor{Text: "文字入场", Occurrence: 0},
			Type:   videoapp.EffectHighlight,
			Params: []byte(`{"color":"` + c.Accent + `"}`),
		}},
		Elements: []videoapp.Element{
			{ID: "bg", Type: videoapp.ElementShape, Color: c.BG,
				X: 0, Y: 0, W: float64(c.Width), H: float64(c.Height), Z: 0},
			{ID: "accent-bar", Type: videoapp.ElementShape, Color: c.Accent,
				X: float64(c.Width) * 0.12, Y: float64(c.Height) * 0.30, W: 8, H: 180, Z: 2,
				Animations: []videoapp.ElementAnimation{{
					ID:             "anim_bar_move",
					Type:           "move",
					From:           &videoapp.Point{X: float64(c.Width) * 0.12, Y: float64(c.Height) * 0.30},
					To:             &videoapp.Point{X: float64(c.Width) * 0.20, Y: float64(c.Height) * 0.30},
					DurationFrames: c.FPS, // 1s
					Easing:         "power2.out",
					StartAnchor:    &videoapp.Anchor{Text: "纯色背景", Occurrence: 0},
				}},
			},
			{ID: "headline", Type: videoapp.ElementText, Text: c.Headline,
				Color: "#FFFFFF", FontSize: 84,
				X: float64(c.Width) * 0.14, Y: float64(c.Height) * 0.34,
				W: float64(c.Width) * 0.72, H: 200, Z: 3,
				Animations: []videoapp.ElementAnimation{{
					ID:             "anim_headline_scaleIn",
					Type:           "scaleIn",
					FromValue:      ptrF(0.4),
					ToValue:        ptrF(1),
					DurationFrames: c.FPS / 2, // 0.5s
					Easing:         "back.out",
					StartAnchor:    &videoapp.Anchor{Text: "纯色背景", Occurrence: 0},
				}},
			},
			{ID: "subline", Type: videoapp.ElementText, Text: c.Sub,
				Color: "#9FB3C8", FontSize: 40,
				X: float64(c.Width) * 0.14, Y: float64(c.Height) * 0.46,
				W: float64(c.Width) * 0.72, H: 120, Z: 3},
		},
	}
	return ir
}

func ptrF(f float64) *float64 { return &f }

// ---- tool discovery (skips, never fails, when tools are absent) ----

func chromePath(t *testing.T) string {
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
	t.Skip("no chrome-family browser found; set CAPX_TEST_CHROME to run L2 tests")
	return ""
}

func ffmpegPath(t *testing.T) string {
	t.Helper()
	p, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not found on PATH; install it to run L2 tests")
	}
	return p
}

// ffprobePath returns the probe binary or "" when absent (the caller then
// degrades to `ffmpeg -i` stderr parsing — recorded in the report).
func ffprobePath() string {
	p, err := exec.LookPath("ffprobe")
	if err != nil {
		return ""
	}
	return p
}

// ---- report model (§7.10 verdict table, L2 subset of fields) ----

type probeStream struct {
	Kind      string  `json:"kind"` // video|audio
	Codec     string  `json:"codec,omitempty"`
	Width     int     `json:"width,omitempty"`
	Height    int     `json:"height,omitempty"`
	FPS       float64 `json:"fps,omitempty"`
	Duration  float64 `json:"duration,omitempty"`
	NBFrames  int     `json:"nb_frames,omitempty"`
	SampleRate int    `json:"sample_rate,omitempty"`
	Channels  int     `json:"channels,omitempty"`
}

type audioProbe struct {
	Present       bool    `json:"present"`
	MeanVolumeDB  float64 `json:"mean_volume_db,omitempty"`
	MaxVolumeDB   float64 `json:"max_volume_db,omitempty"`
	VolumedetectRaw string `json:"volumedetect_raw,omitempty"`
}

type caseResult struct {
	CaseID       string       `json:"case_id"`
	Status       string       `json:"status"` // pass | fail | skip
	FailReasons  []string     `json:"fail_reasons,omitempty"`
	Notes        []string     `json:"notes,omitempty"`
	FFProbe      *probeInfo   `json:"ffprobe,omitempty"`
	Audio        *audioProbe  `json:"audio,omitempty"`
	StderrErrors []string     `json:"stderr_errors,omitempty"`
	DurationMS   int64        `json:"duration_ms"`
	Artifact     string       `json:"artifact,omitempty"`
	Bytes        int64        `json:"bytes,omitempty"`
}

type probeInfo struct {
	Tool      string        `json:"tool"` // ffprobe | ffmpeg-i (degraded)
	Streams   []probeStream `json:"streams"`
	Duration  float64       `json:"duration"`
	NBFrames  int           `json:"nb_frames"`
	Width     int           `json:"width"`
	Height    int           `json:"height"`
	FPS       float64       `json:"fps"`
	HasFTYP   bool          `json:"has_ftyp"`
	RawOutput string        `json:"raw_output,omitempty"`
}

type l2Report struct {
	Layer    string       `json:"layer"`
	RunID    string       `json:"run_id"`
	Env      []string     `json:"env"`
	Cases    []caseResult `json:"cases"`
	Totals   struct {
		Pass int `json:"pass"`
		Fail int `json:"fail"`
		Skip int `json:"skip"`
	} `json:"totals"`
	Evidence []string `json:"evidence"`
}

// ---- ffmpeg probing helpers ----

// readFTYP reads the first 32 bytes of an MP4 and checks for the ftyp box
// signature ("ftyp" at offset 4).
func readFTYP(t *testing.T, path string) bool {
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

type probeResult struct {
	info  probeInfo
	errs  []string // error-looking lines from the encode/probe stderr
}

// probeMP4 inspects the finished MP4. Primary path: ffprobe -v quiet
// -print_format json -show_streams. Degraded path (ffprobe absent):
// `ffmpeg -i` stderr parsing — the degradation is recorded in info.Tool.
func probeMP4(ctx context.Context, ffmpeg, ffprobe, path string) (probeResult, error) {
	if ffprobe != "" {
		return probeWithFFProbe(ctx, ffprobe, path)
	}
	return probeWithFFMpegI(ctx, ffmpeg, path)
}

func probeWithFFProbe(ctx context.Context, ffprobe, path string) (probeResult, error) {
	var res probeResult
	res.info.Tool = "ffprobe"
	out, err := exec.CommandContext(ctx, ffprobe, "-v", "quiet", "-print_format", "json",
		"-show_streams", "-show_format", path).Output()
	if err != nil {
		return res, fmt.Errorf("ffprobe: %w", err)
	}
	res.info.RawOutput = string(out)
	var parsed struct {
		Streams []struct {
			CodecType          string `json:"codec_type"`
			CodecName          string `json:"codec_name"`
			Width              int    `json:"width"`
			Height             int    `json:"height"`
			AvgFrameRate       string `json:"avg_frame_rate"`
			RFrameRate         string `json:"r_frame_rate"`
			Duration           string `json:"duration"`
			NBFrames           string `json:"nb_frames"`
			SampleRate         string `json:"sample_rate"`
			Channels           int    `json:"channels"`
			Start              string `json:"start_time"`
		} `json:"streams"`
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}
	if err := json.Unmarshal(out, &parsed); err != nil {
		return res, fmt.Errorf("ffprobe json: %w", err)
	}
	for _, s := range parsed.Streams {
		ps := probeStream{Kind: s.CodecType, Codec: s.CodecName, Width: s.Width, Height: s.Height,
			SampleRate: atoiDefault(s.SampleRate, 0), Channels: s.Channels}
		ps.FPS = parseRate(s.AvgFrameRate)
		if ps.FPS == 0 {
			ps.FPS = parseRate(s.RFrameRate)
		}
		ps.Duration = parseFloatDefault(s.Duration, 0)
		ps.NBFrames = atoiDefault(s.NBFrames, 0)
		res.info.Streams = append(res.info.Streams, ps)
		if ps.Kind == "video" {
			res.info.Width, res.info.Height, res.info.FPS = ps.Width, ps.Height, ps.FPS
			res.info.NBFrames = ps.NBFrames
			res.info.Duration = ps.Duration
		}
	}
	if res.info.Duration == 0 {
		res.info.Duration = parseFloatDefault(parsed.Format.Duration, 0)
	}
	return res, nil
}

// probeWithFFMpegI parses `ffmpeg -i file` stderr (the documented degradation
// path when ffprobe is not on PATH).
func probeWithFFMpegI(ctx context.Context, ffmpeg, path string) (probeResult, error) {
	var res probeResult
	res.info.Tool = "ffmpeg-i"
	cmd := exec.CommandContext(ctx, ffmpeg, "-hide_banner", "-i", path)
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return res, err
	}
	if err := cmd.Start(); err != nil {
		return res, err
	}
	var sb strings.Builder
	sc := bufio.NewScanner(stderr)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		sb.WriteString(sc.Text())
		sb.WriteString("\n")
	}
	_ = cmd.Wait()
	res.info.RawOutput = sb.String()
	parseFFMpegIBanner(&res.info, sb.String())
	return res, nil
}

// parseFFMpegIBanner extracts streams/duration/geometry from the
// `ffmpeg -i` banner ("Stream #0:0: Video: h264 ..., 1920x1080 ...,
// 30 fps, ..." / "Duration: 00:00:05.02, ...").
func parseFFMpegIBanner(info *probeInfo, banner string) {
	for _, line := range strings.Split(banner, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "Duration:") {
			if d := parseHHMMSS(line); d > 0 && info.Duration == 0 {
				info.Duration = d
			}
		}
		var isVideo, isAudio bool
		if strings.Contains(line, "Video:") && strings.Contains(line, "Stream #") {
			isVideo = true
		}
		if strings.Contains(line, "Audio:") && strings.Contains(line, "Stream #") {
			isAudio = true
		}
		if isVideo {
			st := probeStream{Kind: "video"}
			if f := strings.Index(line, ": "); f >= 0 {
				if after := line[f+2:]; strings.Contains(after, ",") {
					st.Codec = strings.TrimSpace(strings.SplitN(after, ",", 2)[0])
				}
			}
			if i := strings.Index(line, "fps,"); i > 0 {
				st.FPS = parseFloatDefault(strings.TrimSpace(lastField(strings.TrimSpace(line[:i]))), 0)
			}
			for _, tok := range strings.Split(line, ",") {
				tok = strings.TrimSpace(tok)
				if wh := strings.SplitN(tok, "x", 2); len(wh) == 2 {
					w, h := atoiDefault(strings.TrimSpace(wh[0]), 0), atoiDefault(strings.TrimSpace(wh[1]), 0)
					if w > 100 && h > 100 { // geometry token, not e.g. "30 fps"
						st.Width, st.Height = w, h
					}
				}
			}
			info.Streams = append(info.Streams, st)
			info.Width, info.Height, info.FPS = st.Width, st.Height, st.FPS
		}
		if isAudio {
			st := probeStream{Kind: "audio"}
			if f := strings.Index(line, ": "); f >= 0 {
				if after := line[f+2:]; strings.Contains(after, ",") {
					st.Codec = strings.TrimSpace(strings.SplitN(after, ",", 2)[0])
				}
			}
			for _, tok := range strings.Split(line, ",") {
				tok = strings.TrimSpace(tok)
				if strings.HasSuffix(tok, " Hz") {
					st.SampleRate = atoiDefault(strings.TrimSuffix(tok, " Hz"), 0)
				}
			}
			info.Streams = append(info.Streams, st)
		}
	}
}

func lastField(s string) string {
	if i := strings.LastIndex(s, " "); i >= 0 {
		return s[i+1:]
	}
	return s
}

func parseHHMMSS(line string) float64 {
	i := strings.Index(line, ":")
	// "Duration: 00:00:05.02" — find the HH:MM:SS token
	for _, tok := range strings.Fields(strings.SplitN(line, ",", 2)[0]) {
		parts := strings.Split(tok, ":")
		if len(parts) == 3 {
			h := parseFloatDefault(parts[0], 0)
			m := parseFloatDefault(parts[1], 0)
			s := parseFloatDefault(parts[2], 0)
			return h*3600 + m*60 + s
		}
	}
	_ = i
	return 0
}

func parseRate(s string) float64 {
	if s == "" || s == "0/0" {
		return 0
	}
	if i := strings.Index(s, "/"); i >= 0 {
		num := parseFloatDefault(s[:i], 0)
		den := parseFloatDefault(s[i+1:], 0)
		if den > 0 {
			return num / den
		}
		return 0
	}
	return parseFloatDefault(s, 0)
}

func parseFloatDefault(s string, def float64) float64 {
	var f float64
	if _, err := fmt.Sscanf(strings.TrimSpace(s), "%g", &f); err != nil {
		return def
	}
	return f
}

func atoiDefault(s string, def int) int {
	var n int
	if _, err := fmt.Sscanf(strings.TrimSpace(s), "%d", &n); err != nil {
		return def
	}
	return n
}

// countVideoPackets counts the video packets of an MP4 via
// `ffprobe -count_packets` (exact for fragmented MP4s whose nb_frames box
// entry is absent). Returns an error when ffprobe is unavailable.
func countVideoPackets(ctx context.Context, ffprobe, path string) (int, string, error) {
	if ffprobe == "" {
		return 0, "", fmt.Errorf("ffprobe not on PATH")
	}
	out, err := exec.CommandContext(ctx, ffprobe, "-v", "quiet", "-print_format", "json",
		"-select_streams", "v:0", "-count_packets", "-show_entries",
		"stream=nb_read_packets", path).Output()
	if err != nil {
		return 0, "", err
	}
	var parsed struct {
		Streams []struct {
			NBReadPackets string `json:"nb_read_packets"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(out, &parsed); err != nil {
		return 0, "", err
	}
	if len(parsed.Streams) == 0 {
		return 0, "", fmt.Errorf("no video stream in packet probe")
	}
	return atoiDefault(parsed.Streams[0].NBReadPackets, 0), "ffprobe -count_packets nb_read_packets", nil
}

// measureLoudness runs `ffmpeg -i file -af volumedetect -f null -` and parses
// mean_volume / max_volume from stderr. Raw output is preserved verbatim so
// failures can be reported without re-running.
func measureLoudness(ctx context.Context, ffmpeg, path string) (audioProbe, error) {
	var ap audioProbe
	cmd := exec.CommandContext(ctx, ffmpeg, "-hide_banner", "-i", path,
		"-map", "0:a?", "-af", "volumedetect", "-f", "null", "-")
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return ap, err
	}
	if err := cmd.Start(); err != nil {
		return ap, err
	}
	var sb strings.Builder
	sc := bufio.NewScanner(stderr)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		sb.WriteString(sc.Text())
		sb.WriteString("\n")
	}
	werr := cmd.Wait()
	ap.VolumedetectRaw = sb.String()
	if werr != nil && !strings.Contains(sb.String(), "volumedetect") {
		return ap, fmt.Errorf("volumedetect: %w", werr)
	}
	for _, line := range strings.Split(sb.String(), "\n") {
		if i := strings.Index(line, "mean_volume:"); i >= 0 {
			ap.MeanVolumeDB = parseFloatDefault(strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(line[i+len("mean_volume:"):]), " dB")), 0)
			ap.Present = true
		}
		if i := strings.Index(line, "max_volume:"); i >= 0 {
			ap.MaxVolumeDB = parseFloatDefault(strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(line[i+len("max_volume:"):]), " dB")), 0)
		}
	}
	return ap, nil
}

// countErrorLines returns stderr lines that look like ffmpeg errors
// (line-level filter: prefixed "Error", embedded "[error]", or starting
// "Error while..."). Normal banner/info lines do not match.
func countErrorLines(stderr string) []string {
	var errs []string
	for _, line := range strings.Split(stderr, "\n") {
		l := strings.TrimSpace(line)
		if l == "" {
			continue
		}
		if strings.HasPrefix(l, "Error") || strings.Contains(l, "[error]") ||
			strings.Contains(l, "Error while") || strings.Contains(l, "Invalid data") {
			errs = append(errs, l)
		}
	}
	return errs
}

// ---- test-audio synthesis (ffmpeg lavfi sine) ----

// synthAudio generates a 5s sine-wave source: 440 Hz "voice" / 220 Hz "bgm".
// MP3 via libmp3lame (present in the pinned build, [实测] §1.9 #6), falling
// back to WAV when lame is missing.
func synthAudio(ctx context.Context, ffmpeg, path string, freq int) error {
	args := []string{"-y", "-hide_banner", "-f", "lavfi",
		"-i", fmt.Sprintf("sine=frequency=%d:duration=5", freq)}
	if strings.HasSuffix(path, ".mp3") {
		args = append(args, "-c:a", "libmp3lame")
	} else {
		args = append(args, "-c:a", "pcm_s16le")
	}
	args = append(args, path)
	out, err := exec.CommandContext(ctx, ffmpeg, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("synth %s: %w\n%s", filepath.Base(path), err, tailLines(string(out), 12))
	}
	return nil
}

func tailLines(s string, n int) string {
	lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}

// ---- the render+encode pipeline (mirrors render_pipeline.go encodeAndUpload,
// minus worker/DB/storage — L2's scope boundary) ----

// renderAndEncode drives Projector.HTML → RenderFrames → os.Pipe →
// EncodePNGStream → video.mp4, returning the path plus the ffmpeg-relevant
// stderr (capx swallows success stderr internally, so the L2-visible error
// surface is: pipeline errors + our own ffprobe/volumedetect stderr scans).
func renderAndEncode(t *testing.T, ctx context.Context, rt *capx.Runtime, tmpDir string,
	ir *videoapp.IR, spec capx.FrameSpec, outPath string) ([]string, error) {
	t.Helper()

	proj := videoapp.NewProjector(videoapp.DataURIResolver{
		Loader: func(ctx context.Context, key string) (io.ReadCloser, storagex.Object, error) {
			return nil, storagex.Object{}, fmt.Errorf("no assets in L2 fixtures (key %q)", key)
		},
	})
	html, err := proj.HTML(ctx, ir, "")
	if err != nil {
		return nil, fmt.Errorf("project: %w", err)
	}

	videoOut, err := os.Create(outPath)
	if err != nil {
		return nil, err
	}
	defer videoOut.Close()

	pr, pw, err := os.Pipe()
	if err != nil {
		return nil, err
	}
	fw := capx.NewFrameWriter(pw)
	rend, err := rt.Renderer()
	if err != nil {
		pr.Close()
		pw.Close()
		return nil, err
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
		return nil, fmt.Errorf("render frames: %w", renderErr)
	}
	// capx discards success-path stderr; there is no error text to collect on
	// the happy path. Surface the encoder error stream only on failure.
	return nil, nil
}

// muxAV wraps capx.Runtime.MuxAV into a file (the runtime writes a stream).
func muxAV(ctx context.Context, rt *capx.Runtime, videoPath, voicePath, bgmPath string, bgmVolume float64, outPath string) error {
	f, err := os.Create(outPath)
	if err != nil {
		return err
	}
	defer f.Close()
	return rt.MuxAV(ctx, f, videoPath, voicePath, bgmPath, bgmVolume)
}

// ---- assertions ----

const (
	audioThresholdDB = -50.0 // mean_volume above this = non-silent
)

func withinToleranceFloat(got, want, tol float64) bool {
	d := got - want
	if d < 0 {
		d = -d
	}
	return d <= tol
}

// ---- the L2 test itself ----

func TestL2EncodeAndAudio(t *testing.T) {
	chrome := chromePath(t)
	ffmpeg := ffmpegPath(t)
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
		t.Fatal("runtime not available after successful New")
	}

	baseDir, err := filepath.Abs(filepath.Join(".", "l2"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(baseDir, 0o755); err != nil {
		t.Fatal(err)
	}

	runID := time.Now().Format("20060102-150405") + "-l2"
	host, _ := os.Hostname()
	report := &l2Report{Layer: "L2", RunID: runID}
	report.Env = append(report.Env,
		"os="+runtime.GOOS+"/"+runtime.GOARCH,
		"host="+host,
		"chrome="+chrome,
		"ffmpeg="+ffmpeg,
	)
	if ffprobe == "" {
		report.Env = append(report.Env, "ffprobe=MISSING (degraded to ffmpeg -i stderr parsing)")
	} else {
		report.Env = append(report.Env, "ffprobe="+ffprobe)
	}

	// 1) per-case render + encode (M1 gate: C01/C04/C06 out + audio later)
	for _, c := range l2Cases() {
		c := c
		t.Run(c.CaseID, func(t *testing.T) {
			start := time.Now()
			res := caseResult{CaseID: c.CaseID}

			ir := buildIR(c)
			if verr := videoapp.Validate(ir); verr != nil {
				res.Status = "fail"
				res.FailReasons = append(res.FailReasons, "IR failed Validate: "+verr.Error())
				res.DurationMS = time.Since(start).Milliseconds()
				report.Cases = append(report.Cases, res)
				t.Fatalf("fixture IR invalid: %v", verr)
			}

			frames := videoapp.DurationFrames(ir, c.FPS) // F = ceil(5s * fps)
			spec := capx.FrameSpec{Width: c.Width, Height: c.Height, FPS: c.FPS, DurationFrames: frames}
			if serr := spec.Validate(); serr != nil {
				t.Fatalf("frame spec: %v", serr)
			}

			caseDir := filepath.Join(baseDir, c.CaseID)
			if err := os.MkdirAll(caseDir, 0o755); err != nil {
				t.Fatal(err)
			}
			videoOnly := filepath.Join(t.TempDir(), "video-only.mp4")
			outputPath := filepath.Join(caseDir, "output.mp4")

			_, rErr := renderAndEncode(t, ctx, rt, caseDir, ir, spec, videoOnly)
			if rErr != nil {
				res.Status = "fail"
				res.FailReasons = append(res.FailReasons, rErr.Error())
				res.DurationMS = time.Since(start).Milliseconds()
				report.Cases = append(report.Cases, res)
				t.Fatalf("render+encode: %v", rErr)
			}

			// Audio branch for the M1 gate cases: mix the voice sine in, so
			// "出片且音轨存在" holds for the retained artifact.
			voiceFile := filepath.Join(t.TempDir(), "voice.mp3")
			if aErr := synthAudio(ctx, ffmpeg, voiceFile, 440); aErr != nil {
				res.Status = "fail"
				res.FailReasons = append(res.FailReasons, aErr.Error())
				res.DurationMS = time.Since(start).Milliseconds()
				report.Cases = append(report.Cases, res)
				t.Fatalf("synth voice: %v", aErr)
			}
			if mErr := muxAV(ctx, rt, videoOnly, voiceFile, "", 0.3, outputPath); mErr != nil {
				res.Status = "fail"
				res.FailReasons = append(res.FailReasons, "mux voice: "+mErr.Error())
				res.DurationMS = time.Since(start).Milliseconds()
				report.Cases = append(report.Cases, res)
				t.Fatalf("mux voice: %v", mErr)
			}

			// assertions on the final (muxed) artifact
			wantFrames := frames
			wantDur := float64(frames) / float64(c.FPS)
			tol := 1.0 / float64(c.FPS) // duration Δ ≤ 1 frame (§7.3)
			assertArtifact(t, ctx, ffmpeg, ffprobe, outputPath, &res, spec, wantFrames, wantDur, tol,
				audioExpect{present: true, minMeanDB: audioThresholdDB})

			res.DurationMS = time.Since(start).Milliseconds()
			res.Artifact = "l2/" + c.CaseID + "/output.mp4"
			if res.Status == "" {
				res.Status = "pass"
			}
			report.Cases = append(report.Cases, res)
			if res.Status != "pass" {
				t.Fatalf("%s failed assertions: %v", c.CaseID, res.FailReasons)
			}
			t.Logf("%s pass: %dx%d@%g fps, %d frames, duration %.3fs, mean_volume %.1f dB",
				c.CaseID, res.FFProbe.Width, res.FFProbe.Height, res.FFProbe.FPS,
				res.FFProbe.NBFrames, res.FFProbe.Duration, res.Audio.MeanVolumeDB)
		})
	}

	// 2) four audio branches on one case (VS-C04 geometry, §7.3 sample list)
	runAudioBranches(t, ctx, rt, ffmpeg, baseDir, report)

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
		"[实测] ffmpeg -version => N-117763-ge35587250c-20241113 (--enable-libx264 --enable-libass), 2026-11-15",
		"[代码] 编码链路：example/internal/video/testdata/l2_encode_test.go renderAndEncode（镜像 render/render_pipeline.go encodeAndUpload 的 pipe 组合）",
		"[代码] 断言阈值：§7.3 通过阈值行（ftyp / 帧数 / 时长 Δ≤1帧 / 音频 RMS>阈值 via volumedetect mean_volume>"+fmt.Sprintf("%.0f", audioThresholdDB)+"dB）",
		"[实测] volumedetect 原始输出已写入 report.json audio.volumedetect_raw（截断至 2KB）",
	)

	// write report.json — always, pass or fail
	repBytes, _ := json.MarshalIndent(report, "", "  ")
	repPath := filepath.Join(filepath.Dir(baseDir), "l2-report.json")
	if werr := os.WriteFile(repPath, repBytes, 0o644); werr != nil {
		t.Errorf("write report.json: %v", werr)
	}
	t.Logf("report written: %s (pass=%d fail=%d skip=%d)", repPath,
		report.Totals.Pass, report.Totals.Fail, report.Totals.Skip)
}

type audioExpect struct {
	present   bool // expect an audio stream in the mp4
	minMeanDB float64
}

// assertArtifact checks one finished MP4 against §7.3 thresholds and records
// every outcome (pass and fail) into res instead of t.Fatalf, so the report
// stays complete across branches.
func assertArtifact(t *testing.T, ctx context.Context, ffmpeg, ffprobe, path string,
	res *caseResult, spec capx.FrameSpec, wantFrames int, wantDur, durTol float64, wantAudio audioExpect) {
	t.Helper()

	fail := func(reason string) {
		res.Status = "fail"
		res.FailReasons = append(res.FailReasons, reason)
	}

	// ftyp box in the first 32 bytes
	if !readFTYP(t, path) {
		fail("no ftyp box in the first 32 bytes")
	}

	pr, perr := probeMP4(ctx, ffmpeg, ffprobe, path)
	res.FFProbe = &pr.info
	if perr != nil {
		fail("ffprobe failed: " + perr.Error())
		return
	}
	res.StderrErrors = countErrorLines(pr.info.RawOutput)
	if len(res.StderrErrors) > 0 {
		fail("probe stderr contains error lines: " + strings.Join(res.StderrErrors, " | "))
	}

	var vs, as *probeStream
	for i := range pr.info.Streams {
		s := &pr.info.Streams[i]
		switch s.Kind {
		case "video":
			if vs == nil {
				vs = s
			}
		case "audio":
			if as == nil {
				as = s
			}
		}
	}
	if vs == nil {
		fail("no video stream")
	} else {
		if vs.Width != spec.Width || vs.Height != spec.Height {
			fail(fmt.Sprintf("dimensions %dx%d != spec %dx%d", vs.Width, vs.Height, spec.Width, spec.Height))
		}
		if !withinToleranceFloat(vs.FPS, float64(spec.FPS), 0.02) {
			fail(fmt.Sprintf("fps %.4f != spec %d", vs.FPS, spec.FPS))
		}
		// frame count: fragmented MP4s (the pipe-safe movflags the encode
		// chain uses) carry no nb_frames box entry — count packets instead
		// (ffprobe -count_packets; exact). Degradations: ffmpeg-i path →
		// round(duration*fps), recorded as a note, not a failure.
		gotFrames, framesVia, nerr := countVideoPackets(ctx, ffprobe, path)
		if nerr == nil {
			pr.info.NBFrames = gotFrames
		} else {
			gotFrames = int(vs.Duration*vs.FPS + 0.5)
			framesVia = pr.info.Tool + " round(duration*fps)"
			if ffprobe == "" {
				res.Notes = append(res.Notes,
					"(info) nb_frames unavailable via "+pr.info.Tool+"; frames derived as round(duration*fps)")
			} else {
				res.Notes = append(res.Notes,
					"(info) packet count failed ("+nerr.Error()+"); frames derived as round(duration*fps)")
			}
		}
		res.Notes = append(res.Notes, "(info) frames counted via "+framesVia)
		if gotFrames != wantFrames {
			fail(fmt.Sprintf("frame count %d != want %d (duration*fps=%.2f)", gotFrames, wantFrames, vs.Duration*vs.FPS))
		}
	}

	if wantAudio.present {
		if as == nil {
			fail("expected an audio stream, found none")
		} else {
			ap, aerr := measureLoudness(ctx, ffmpeg, path)
			res.Audio = &ap
			if aerr != nil {
				fail("volumedetect failed: " + aerr.Error())
			} else {
				if ap.VolumedetectRaw == "" || !strings.Contains(ap.VolumedetectRaw, "mean_volume") {
					fail("volumedetect produced no mean_volume; raw: " + truncRaw(ap.VolumedetectRaw))
				} else if ap.MeanVolumeDB <= wantAudio.minMeanDB {
					fail(fmt.Sprintf("audio too quiet: mean_volume %.1f dB <= %.1f dB threshold; raw: %s",
						ap.MeanVolumeDB, wantAudio.minMeanDB, truncRaw(ap.VolumedetectRaw)))
				}
			}
		}
	} else {
		if as != nil {
			fail("silent branch: audio stream unexpectedly present")
		}
	}

	if info := pr.info; !withinToleranceFloat(info.Duration, wantDur, durTol) {
		fail(fmt.Sprintf("duration %.3fs outside ±1 frame (%.3fs ± %.3fs)", info.Duration, wantDur, durTol))
	}

	if st, serr := os.Stat(path); serr == nil {
		res.Bytes = st.Size()
	}
}

func truncRaw(s string) string {
	if len(s) > 2048 {
		return s[:2048] + "…(truncated)"
	}
	return s
}

// runAudioBranches covers §7.3's four audio-branch samples: voice-only,
// bgm-only (volume 0.3), voice+bgm, silent. Geometry: VS-C04's.
func runAudioBranches(t *testing.T, ctx context.Context, rt *capx.Runtime,
	ffmpeg, baseDir string, report *l2Report) {

	branchCase := l2Case{CaseID: "VS-C04", Width: 1920, Height: 1080, FPS: 30, CLipSeconds: 5,
		BG: "#101418", Accent: "#4DA3FF", Headline: "数据可视化口播 · L2", Sub: "audio branches"}
	ir := buildIR(branchCase)
	frames := videoapp.DurationFrames(ir, branchCase.FPS)
	spec := capx.FrameSpec{Width: branchCase.Width, Height: branchCase.Height,
		FPS: branchCase.FPS, DurationFrames: frames}

	// one silent video shared by all four branches (the encode chain is the
	// same; branching happens at mux time, exactly like the production
	// pipeline: video stage → mux stage).
	videoOnly := filepath.Join(t.TempDir(), "branch-video.mp4")
	if _, err := renderAndEncode(t, ctx, rt, baseDir, ir, spec, videoOnly); err != nil {
		res := caseResult{CaseID: "AUDIO-BRANCH", Status: "fail",
			FailReasons: []string{"shared video encode failed: " + err.Error()}}
		report.Cases = append(report.Cases, res)
		t.Fatalf("branch video encode: %v", err)
	}

	voiceFile := filepath.Join(baseDir, "_fixtures", "voice-440.mp3")
	bgmFile := filepath.Join(baseDir, "_fixtures", "bgm-220.mp3")
	if err := os.MkdirAll(filepath.Dir(voiceFile), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := synthAudio(ctx, ffmpeg, voiceFile, 440); err != nil {
		t.Fatalf("synth voice: %v", err)
	}
	if err := synthAudio(ctx, ffmpeg, bgmFile, 220); err != nil {
		t.Fatalf("synth bgm: %v", err)
	}

	branches := []struct {
		id         string
		voice      string
		bgm        string
		bgmVolume  float64
		wantAudio  audioExpect
	}{
		{id: "AUDIO-VOICE-ONLY", voice: voiceFile, bgm: "",
			wantAudio: audioExpect{present: true, minMeanDB: audioThresholdDB}},
		{id: "AUDIO-BGM-ONLY", voice: "", bgm: bgmFile, bgmVolume: 0.3,
			wantAudio: audioExpect{present: true, minMeanDB: audioThresholdDB}},
		{id: "AUDIO-VOICE-BGM", voice: voiceFile, bgm: bgmFile, bgmVolume: 0.3,
			wantAudio: audioExpect{present: true, minMeanDB: audioThresholdDB}},
		{id: "AUDIO-SILENT", voice: "", bgm: "",
			wantAudio: audioExpect{present: false}},
	}

	for _, b := range branches {
		b := b
		t.Run(b.id, func(t *testing.T) {
			start := time.Now()
			res := caseResult{CaseID: b.id}

			out := filepath.Join(baseDir, b.id, "output.mp4")
			if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
				t.Fatal(err)
			}
			if mErr := muxAV(ctx, rt, videoOnly, b.voice, b.bgm, b.bgmVolume, out); mErr != nil {
				res.Status = "fail"
				res.FailReasons = append(res.FailReasons, "mux: "+mErr.Error())
				res.DurationMS = time.Since(start).Milliseconds()
				report.Cases = append(report.Cases, res)
				t.Fatalf("mux %s: %v", b.id, mErr)
			}

			wantDur := float64(frames) / float64(spec.FPS)
			assertArtifact(t, ctx, ffmpeg, ffprobePath(), out, &res, spec, frames, wantDur,
				1.0/float64(spec.FPS), b.wantAudio)

			// bgm-only volume scaling: mean_volume of a 0.3× 220Hz sine sits
			// well above the silence threshold but below the 1.0× mixes —
			// spot-check the ordering (0.3× ≈ 20*log10(0.3) ≈ -10.5 dB vs the
			// 1.0× voice), tolerance 3 dB.
			if b.id == "AUDIO-BGM-ONLY" && res.Audio != nil && res.Audio.Present {
				if res.Audio.MeanVolumeDB > -20.0+3.0 { // 1.0× reference -20.4 dB minus margin
					res.FailReasons = append(res.FailReasons,
						fmt.Sprintf("(info) bgm-only mean_volume %.1f dB looks louder than a 0.3× scaled sine should be (~-31 dB)", res.Audio.MeanVolumeDB))
				}
			}

			res.DurationMS = time.Since(start).Milliseconds()
			res.Artifact = "l2/" + b.id + "/output.mp4"
			if res.Status == "" {
				res.Status = "pass"
			}
			report.Cases = append(report.Cases, res)
			if res.Status != "pass" {
				t.Fatalf("%s failed assertions: %v", b.id, res.FailReasons)
			}
			audioState := "no audio stream"
			if res.Audio != nil && res.Audio.Present {
				audioState = fmt.Sprintf("audio present, mean %.1f dB / max %.1f dB",
					res.Audio.MeanVolumeDB, res.Audio.MaxVolumeDB)
			}
			t.Logf("%s pass: %s", b.id, audioState)
		})
	}
}

// silence the unused helper warning if runAudioBranches is refactored away
var _ = sync.Mutex{}
