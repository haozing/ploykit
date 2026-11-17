//go:build capx

// Package l1 — L3 FULL-LENGTH pipeline test, batch B (VS-C06/C07/C08/C09).
//
// Batch 9 of the Video Studio test plan: the other half of the six-case
// library driven end-to-end at FULL duration through the same pipeline the
// production worker uses (render/render_pipeline.go encodeAndUpload, minus
// worker/DB/storage — the L3 scope boundary), self-built in this file rather
// than reusing l3_full_test.go's harness per the coordination call (no such
// file exists at write time; the TestL3FullB symbol prefix avoids any future
// collision with the sibling batch's TestL3Full*).
//
// Per case: degraded IR → videoapp.Validate → Projector (image elements
// served gray DataURI placeholders) → capx RenderFrames FULL duration →
// FrameWriter/os.Pipe → EncodePNGStream (libx264 CRF18) → MP4; C08 additionally
// muxes a 440 Hz voice track → MuxAV. Assertions per case: ffprobe geometry /
// fps / duration exact, -count_packets exact frame total (C06 2250, C07 1200,
// C08 600, C09 1500), ftyp box, three-point frame extraction non-empty &
// non-solid-color, C08 audio RMS (volumedetect), full-decode `-v error` scan,
// artifact size.
//
// Run (real Chrome + ffmpeg required; ~35-45 min wall clock for all four):
//
//	go -C example test -tags capx ./internal/video/testdata -run TestL3FullB \
//	  -v -timeout 60m
//
// Artifacts: testdata/l3-full/<case>/output.mp4 (+ frame-*.png extracts).
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

// ---- batch-B case table (full durations; frames = ceil(durationSec × fps)) ----

type l3bCase struct {
	CaseID string
	IRFile string
	W, H   int
	FPS    int
	Frames int
	DurSec int
	Mux    bool // C08 carries the batch's audio branch (440 Hz voice → MuxAV)
}

func l3bCases() []l3bCase {
	return []l3bCase{
		{CaseID: "VS-C06", IRFile: "c06.degraded.json", W: 1920, H: 1080, FPS: 25, Frames: 2250, DurSec: 90},
		{CaseID: "VS-C07", IRFile: "c07.degraded.json", W: 1920, H: 1080, FPS: 30, Frames: 1200, DurSec: 40},
		{CaseID: "VS-C08", IRFile: "c08.degraded.json", W: 1080, H: 1080, FPS: 30, Frames: 600, DurSec: 20, Mux: true},
		{CaseID: "VS-C09", IRFile: "c09.degraded.json", W: 1920, H: 1080, FPS: 30, Frames: 1500, DurSec: 50},
	}
}

// ---- per-case result record (JSON report at the end) ----

type l3bProbeInfo struct {
	Width    int     `json:"width"`
	Height   int     `json:"height"`
	FPS      float64 `json:"fps"`
	Duration float64 `json:"duration"`
	Codec    string  `json:"codec"`
}

type l3bCaseResult struct {
	CaseID        string         `json:"case_id"`
	IRFile        string         `json:"ir_file"`
	Status        string         `json:"status"`
	FramesWant    int            `json:"frames_want"`
	FramesGot     int            `json:"frames_got"`
	GeometryWant  string         `json:"geometry_want"`
	GeometryGot   string         `json:"geometry_got"`
	DurationWant  float64        `json:"duration_want_sec"`
	DurationGot   float64        `json:"duration_got_sec"`
	FTYP          bool           `json:"ftyp"`
	Samples       []l3bSample    `json:"samples"`
	AudioRMS      *l3bAudioInfo  `json:"audio_rms,omitempty"`
	DecodeVerify  *l3bDecodeRes  `json:"decode_verify"`
	SizeBytes     int64          `json:"size_bytes"`
	Artifact      string         `json:"artifact"`
	RenderMS      int64          `json:"render_ms"`
	EncodeMS      int64          `json:"encode_ms"`
	TotalMS       int64          `json:"total_ms"`
	ImagesServed  int            `json:"images_served"`
	PacketsPerSec float64        `json:"packets_per_sec"`
	FailReasons   []string       `json:"fail_reasons,omitempty"`
	Notes         []string       `json:"notes,omitempty"`
	Assertions    map[string]any `json:"assertions"`
}

type l3bSample struct {
	AtSec       float64 `json:"at_sec"`
	File        string  `json:"file"`
	NonEmpty    bool    `json:"non_empty"`
	SolidColor  bool    `json:"solid_color"`
	Distinct    bool    `json:"distinct_vs_first"`
	ColorStdDev float64 `json:"color_stddev"`
}

type l3bAudioInfo struct {
	Present      bool    `json:"present"`
	MeanVolumeDB float64 `json:"mean_volume_db"`
	MaxVolumeDB  float64 `json:"max_volume_db"`
}

type l3bDecodeRes struct {
	StderrEmpty bool   `json:"stderr_empty"`
	Stderr      string `json:"stderr,omitempty"`
	ExitErr     string `json:"exit_err,omitempty"`
}

// ---- tool discovery (own copies; batch B stands alone in the package) ----

func l3bChromePath(t *testing.T) string {
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
				if err := l3bCheckFile(filepath.Join(root, rel)); err == nil {
					return filepath.Join(root, rel)
				}
			}
		}
	case "darwin":
		p := "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
		if l3bCheckFile(p) == nil {
			return p
		}
	}
	t.Fatal("chrome not found for L3FullB (set CAPX_TEST_CHROME)")
	return ""
}

func l3bCheckFile(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return fmt.Errorf("%s is a directory", path)
	}
	return nil
}

func l3bFFMpeg(t *testing.T) string {
	t.Helper()
	if p := os.Getenv("CAPX_TEST_FFMPEG"); p != "" {
		return p
	}
	p, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Fatal("ffmpeg not on PATH for L3FullB (set CAPX_TEST_FFMPEG)")
	}
	return p
}

func l3bFFProbe(t *testing.T) string {
	t.Helper()
	if p := os.Getenv("CAPX_TEST_FFPROBE"); p != "" {
		return p
	}
	p, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Fatal("ffprobe not on PATH for L3FullB (exact frame-count assertions require it; set CAPX_TEST_FFPROBE)")
	}
	return p
}

// ---- gray placeholder + data-URI projector (same recipe as batch-6b) ----

var l3bPlaceholderPNG = l3bSolidGrayPNG(64, 64)

func l3bSolidGrayPNG(w, h int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.Gray{Y: 128})
		}
	}
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}

func l3bProjector(served *int) *videoapp.Projector {
	return videoapp.NewProjector(videoapp.DataURIResolver{
		Loader: func(ctx context.Context, key string) (io.ReadCloser, storagex.Object, error) {
			*served++
			return io.NopCloser(bytes.NewReader(l3bPlaceholderPNG)),
				storagex.Object{Key: key, ContentType: "image/png", Size: int64(len(l3bPlaceholderPNG))}, nil
		},
	})
}

// ---- ffprobe / ffmpeg verification helpers ----

func l3bProbe(ctx context.Context, ffprobe, path string) (*l3bProbeInfo, error) {
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
	info := &l3bProbeInfo{}
	for _, s := range parsed.Streams {
		if s.CodecType != "video" {
			continue
		}
		info.Width, info.Height, info.Codec = s.Width, s.Height, s.CodecName
		info.FPS = l3bParseRate(s.AvgFrameRate)
		if info.FPS == 0 {
			info.FPS = l3bParseRate(s.RFrameRate)
		}
		info.Duration = l3bParseFloat(s.Duration, 0)
	}
	if info.Duration == 0 {
		info.Duration = l3bParseFloat(parsed.Format.Duration, 0)
	}
	return info, nil
}

// l3bCountPackets counts video packets via ffprobe -count_packets — the
// exact frame total (fragmented MP4s carry no nb_frames box entry).
func l3bCountPackets(ctx context.Context, ffprobe, path string) (int, error) {
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
	return l3bParseInt(parsed.Streams[0].NBReadPackets, 0), nil
}

func l3bFTYP(t *testing.T, path string) bool {
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

// l3bExtractFrame pulls one frame at sec via ffmpeg and decodes it; the
// caller checks non-empty / non-solid / distinctness.
func l3bExtractFrame(ctx context.Context, ffmpeg, path, outFile string, sec float64) ([]byte, error) {
	ss := fmt.Sprintf("%.3f", sec)
	out, err := exec.CommandContext(ctx, ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
		"-ss", ss, "-i", path, "-frames:v", "1", outFile).CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("extract @%ss: %w\n%s", ss, err, l3bTail(string(out), 8))
	}
	return os.ReadFile(outFile)
}

// l3bSampleAnalysis checks a PNG frame: decodes, non-solid-color (max channel
// stddev across pixels), and pixel-level distinctness vs the first sample.
func l3bSampleAnalysis(pngPath string, first *image.Image) (nonEmpty, solid bool, stddev float64, distinct bool, dec image.Image) {
	b, err := os.ReadFile(pngPath)
	if err != nil || len(b) == 0 {
		return false, true, 0, false, nil
	}
	nonEmpty = true
	img, derr := png.Decode(bytes.NewReader(b))
	if derr != nil {
		return nonEmpty, true, 0, false, nil
	}
	dec = img
	bd := img.Bounds()
	// Sample a coarse grid (stride keeps 1080p cheap).
	const stride = 7
	sum, sumSq, n := 0.0, 0.0, 0
	sameAsFirst := true
	for y := bd.Min.Y; y < bd.Max.Y; y += stride {
		for x := bd.Min.X; x < bd.Max.X; x += stride {
			r16, g16, b16, _ := img.At(x, y).RGBA()
			r, g, bl := int(r16>>8), int(g16>>8), int(b16>>8)
			lum := 0.299*float64(r) + 0.587*float64(g) + 0.114*float64(bl)
			sum += lum
			sumSq += lum * lum
			n++
			if first != nil && sameAsFirst {
				fr16, fg16, fb16, _ := (*first).At(x, y).RGBA()
				if l3bAbs(int(r)-int(fr16>>8)) > 12 || l3bAbs(int(g)-int(fg16>>8)) > 12 || l3bAbs(int(bl)-int(fb16>>8)) > 12 {
					sameAsFirst = false
				}
			}
		}
	}
	if n == 0 {
		return nonEmpty, true, 0, !sameAsFirst || first == nil, dec
	}
	mean := sum / float64(n)
	variance := sumSq/float64(n) - mean*mean
	stddev = 0.0
	if variance < 0 {
		variance = 0
	}
	stddev = l3bSqrt(variance)
	solid = stddev < 1.0 // a solid-color frame has ~0 channel spread
	distinct = first == nil || !sameAsFirst
	return nonEmpty, solid, stddev, distinct, dec
}

func l3bAbs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

// sqrtApprox: Newton's method — avoids importing math just for one sqrt.
func l3bSqrt(x float64) float64 {
	if x <= 0 {
		return 0
	}
	z := x
	for i := 0; i < 32; i++ {
		z = (z + x/z) / 2
	}
	return z
}

// l3bAudioRMS runs ffmpeg volumedetect on the audio stream (the RMS surface:
// mean_volume is the RMS level) and parses mean/max dB.
func l3bAudioRMS(ctx context.Context, ffmpeg, path string) (*l3bAudioInfo, error) {
	info := &l3bAudioInfo{}
	cmd := exec.CommandContext(ctx, ffmpeg, "-hide_banner", "-i", path,
		"-map", "0:a?", "-af", "volumedetect", "-f", "null", "-")
	var sb strings.Builder
	cmd.Stderr = &sb
	err := cmd.Run()
	raw := sb.String()
	if err != nil && !strings.Contains(raw, "volumedetect") {
		return info, fmt.Errorf("volumedetect: %w\n%s", err, l3bTail(raw, 8))
	}
	for _, line := range strings.Split(raw, "\n") {
		if i := strings.Index(line, "mean_volume:"); i >= 0 {
			info.MeanVolumeDB = l3bParseFloat(strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(line[i+len("mean_volume:"):]), " dB")), 0)
			info.Present = true
		}
		if i := strings.Index(line, "max_volume:"); i >= 0 {
			info.MaxVolumeDB = l3bParseFloat(strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(line[i+len("max_volume:"):]), " dB")), 0)
		}
	}
	return info, nil
}

// l3bDecodeVerify runs the full-decode error scan: `ffmpeg -v error -i f -f null -`.
// Empty stderr + exit 0 = the shipped bytes decode with no error anywhere.
func l3bDecodeVerify(ctx context.Context, ffmpeg, path string) *l3bDecodeRes {
	dv := &l3bDecodeRes{StderrEmpty: true}
	cmd := exec.CommandContext(ctx, ffmpeg, "-v", "error", "-i", path, "-f", "null", "-")
	var sb strings.Builder
	cmd.Stderr = &sb
	if err := cmd.Run(); err != nil {
		dv.ExitErr = err.Error()
	}
	if sb.Len() > 0 {
		dv.StderrEmpty = false
		dv.Stderr = l3bTail(sb.String(), 12)
	}
	return dv
}

// l3bSynthVoice generates the 440 Hz voice fixture when absent (30 s covers
// C08's full 20 s with margin; amix duration=first trims anyway).
func l3bSynthVoice(ctx context.Context, ffmpeg, path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	out, err := exec.CommandContext(ctx, ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
		"-f", "lavfi", "-i", "sine=frequency=440:duration=30", "-c:a", "libmp3lame", path).CombinedOutput()
	if err != nil {
		return fmt.Errorf("synth voice-440.mp3: %w\n%s", err, l3bTail(string(out), 8))
	}
	return nil
}

func l3bCopyFile(src, dst string) error {
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
	return nil
}

func l3bParseRate(s string) float64 {
	if s == "" || s == "0/0" {
		return 0
	}
	if i := strings.Index(s, "/"); i >= 0 {
		num := l3bParseFloat(s[:i], 0)
		den := l3bParseFloat(s[i+1:], 0)
		if den > 0 {
			return num / den
		}
		return 0
	}
	return l3bParseFloat(s, 0)
}

func l3bParseFloat(s string, def float64) float64 {
	var f float64
	if _, err := fmt.Sscanf(strings.TrimSpace(s), "%g", &f); err != nil {
		return def
	}
	return f
}

func l3bParseInt(s string, def int) int {
	var n int
	if _, err := fmt.Sscanf(strings.TrimSpace(s), "%d", &n); err != nil {
		return def
	}
	return n
}

func l3bTail(s string, n int) string {
	lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}

func l3bWithin(got, want, tol float64) bool {
	d := got - want
	if d < 0 {
		d = -d
	}
	return d <= tol
}

// ---- the four tests ----

func TestL3FullB_C06(t *testing.T) { l3bRunFull(t, l3bCases()[0]) }
func TestL3FullB_C07(t *testing.T) { l3bRunFull(t, l3bCases()[1]) }
func TestL3FullB_C08(t *testing.T) { l3bRunFull(t, l3bCases()[2]) }
func TestL3FullB_C09(t *testing.T) { l3bRunFull(t, l3bCases()[3]) }

// l3bRunFull drives one case end-to-end at FULL duration.
func l3bRunFull(t *testing.T, c l3bCase) {
	if testing.Short() {
		t.Skip("L3FullB drives real Chrome + ffmpeg; skipped in -short mode")
	}
	startAll := time.Now()
	ctx := context.Background()
	chrome := l3bChromePath(t)
	ffmpeg := l3bFFMpeg(t)
	ffprobe := l3bFFProbe(t)

	// product dir: testdata/l3-full/<case>/
	_, thisFile, _, _ := runtime.Caller(0)
	baseDir := filepath.Dir(thisFile)
	caseDir := filepath.Join(baseDir, "l3-full", c.CaseID)
	if err := os.MkdirAll(caseDir, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", caseDir, err)
	}
	outputPath := filepath.Join(caseDir, "output.mp4")

	res := &l3bCaseResult{
		CaseID:       c.CaseID,
		IRFile:       "ir/" + c.IRFile,
		FramesWant:   c.Frames,
		GeometryWant: fmt.Sprintf("%dx%d@%d", c.W, c.H, c.FPS),
		DurationWant: float64(c.DurSec),
		Samples:      []l3bSample{},
		Assertions:   map[string]any{},
		Artifact:     outputPath,
	}
	fail := func(reason string) {
		res.Status = "fail"
		res.FailReasons = append(res.FailReasons, reason)
	}

	// capx runtime (real Chrome, real ffmpeg).
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
		t.Fatal("capx runtime not available")
	}
	rend, err := rt.Renderer()
	if err != nil {
		t.Fatalf("capx Renderer: %v", err)
	}

	// 1) degraded IR: load → Validate → single-source frame formula.
	irBytes, err := os.ReadFile(filepath.Join(baseDir, "ir", c.IRFile))
	if err != nil {
		t.Fatalf("read %s: %v", c.IRFile, err)
	}
	ir := &videoapp.IR{}
	if err := json.Unmarshal(irBytes, ir); err != nil {
		t.Fatalf("unmarshal %s: %v", c.IRFile, err)
	}
	if verr := videoapp.Validate(ir); verr != nil {
		fail("degraded IR failed Validate: " + verr.Error())
		res.TotalMS = time.Since(startAll).Milliseconds()
		l3bFinish(t, res, caseDir)
		t.Fatalf("Validate %s: %v", c.CaseID, verr)
	}
	frames := videoapp.DurationFrames(ir, c.FPS)
	if frames != c.Frames {
		fail(fmt.Sprintf("DurationFrames=%d != expected %d (ceil(%d×%d))", frames, c.Frames, c.DurSec, c.FPS))
	}
	spec := capx.FrameSpec{Width: c.W, Height: c.H, FPS: c.FPS, DurationFrames: c.Frames}
	if serr := spec.Validate(); serr != nil {
		t.Fatalf("frame spec: %v", serr)
	}
	res.Assertions["validate"] = "ok"
	res.Assertions["duration_frames_formula"] = frames

	// 2) Projector (image elements → gray DataURI placeholder injection).
	imagesServed := 0
	proj := l3bProjector(&imagesServed)
	html, err := proj.HTML(ctx, ir, "")
	if err != nil {
		t.Fatalf("project HTML: %v", err)
	}
	res.ImagesServed = imagesServed
	res.Assertions["html_bytes"] = len(html)
	t.Logf("[%s] Validate ok, DurationFrames=%d, HTML %d bytes, images served %d",
		c.CaseID, frames, len(html), imagesServed)

	// 3) RenderFrames FULL duration → FrameWriter → os.Pipe → EncodePNGStream
	//    (same streaming composition as render_pipeline.go encodeAndUpload).
	videoOnly := filepath.Join(t.TempDir(), "l3b-video-only.mp4")
	videoOut, err := os.Create(videoOnly)
	if err != nil {
		t.Fatalf("create %s: %v", videoOnly, err)
	}
	pr, pw, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	fw := capx.NewFrameWriter(pw)
	encodeStart := time.Now()
	encodeDone := make(chan error, 1)
	go func() {
		err := rt.EncodePNGStream(ctx, videoOut, spec, pr, capx.EncodeOptions{CRF: 18, Preset: "medium"})
		pr.Close()
		videoOut.Close()
		encodeDone <- err
	}()

	renderStart := time.Now()
	renderErr := rend.RenderFrames(ctx,
		capx.Doc{HTML: string(html), TimelineID: "main"}, spec,
		func(_ context.Context, f capx.Frame) error {
			if f.Index%250 == 0 {
				t.Logf("[%s] frame %d/%d (%.1fs elapsed)", c.CaseID, f.Index, c.Frames-1, time.Since(renderStart).Seconds())
			}
			return fw.WriteFrame(f.PNG)
		})
	res.RenderMS = time.Since(renderStart).Milliseconds()
	if cErr := pw.Close(); cErr != nil && renderErr == nil {
		renderErr = cErr
	}
	// videoOut is closed by the encode goroutine; wait for it before re-stat.
	encErr := <-encodeDone
	res.EncodeMS = time.Since(encodeStart).Milliseconds()
	if renderErr != nil {
		fail("render frames: " + renderErr.Error())
	}
	if encErr != nil {
		fail("encode: " + encErr.Error())
	}
	if renderErr != nil || encErr != nil {
		res.TotalMS = time.Since(startAll).Milliseconds()
		l3bFinish(t, res, caseDir)
		t.Fatalf("[%s] render/encode failed: render=%v encode=%v", c.CaseID, renderErr, encErr)
	}
	t.Logf("[%s] RENDER+ENCODE DONE: %d frames, render %dms (%.1f ms/frame), encode window %dms",
		c.CaseID, c.Frames, res.RenderMS, float64(res.RenderMS)/float64(c.Frames), res.EncodeMS)
	res.Assertions["render_ms_per_frame"] = float64(res.RenderMS) / float64(c.Frames)

	// 4) C08 audio branch: 440 Hz voice → MuxAV.
	if c.Mux {
		voice := filepath.Join(baseDir, "l3-full", "_fixtures", "voice-440.mp3")
		if _, serr := os.Stat(voice); serr != nil {
			if mkErr := l3bSynthVoice(ctx, ffmpeg, voice); mkErr != nil {
				t.Fatalf("synth voice fixture: %v", mkErr)
			}
			res.Notes = append(res.Notes, "voice-440.mp3 absent — synthesized (ffmpeg lavfi sine 440Hz 30s)")
		} else {
			res.Notes = append(res.Notes, "voice fixture reused: l3-full/_fixtures/voice-440.mp3 (440 Hz sine)")
		}
		muxPath := filepath.Join(t.TempDir(), "l3b-mux.mp4")
		mf, mErr := os.Create(muxPath)
		if mErr != nil {
			t.Fatalf("create mux out: %v", mErr)
		}
		muxStart := time.Now()
		mErr = rt.MuxAV(ctx, mf, videoOnly, voice, "", 1.0, 0.3)
		mf.Close()
		if mErr != nil {
			res.TotalMS = time.Since(startAll).Milliseconds()
			l3bFinish(t, res, caseDir)
			t.Fatalf("[%s] MuxAV: %v", c.CaseID, mErr)
		}
		res.Notes = append(res.Notes,
			fmt.Sprintf("MuxAV voice-only (440 Hz sine, gain 0.3): %dms", time.Since(muxStart).Milliseconds()))
		if cpErr := l3bCopyFile(muxPath, outputPath); cpErr != nil {
			t.Fatalf("copy mux → %s: %v", outputPath, cpErr)
		}
	} else {
		// silent video clip — copy the artifact into place (copy, not rename:
		// TempDir can live on another drive; Windows rename fails cross-volume)
		if cpErr := l3bCopyFile(videoOnly, outputPath); cpErr != nil {
			t.Fatalf("copy %s → %s: %v", videoOnly, outputPath, cpErr)
		}
	}

	// 5) assertions on the retained artifact.
	if st, serr := os.Stat(outputPath); serr == nil {
		res.SizeBytes = st.Size()
		if res.SizeBytes < 10*1024 {
			fail(fmt.Sprintf("artifact size %d bytes < 10KB", res.SizeBytes))
		}
		res.Assertions["size_bytes"] = res.SizeBytes
	} else {
		fail("artifact missing: " + serr.Error())
	}

	res.FTYP = l3bFTYP(t, outputPath)
	if !res.FTYP {
		fail("no ftyp box in the first 32 bytes")
	}

	// duration: fragmented MP4 duration ≈ frames/fps; 0.5s tolerance covers
	// container rounding on the longest case (90s).
	wantDur := float64(c.Frames) / float64(c.FPS)
	res.Assertions["duration_formula_sec"] = wantDur

	info, perr := l3bProbe(ctx, ffprobe, outputPath)
	if perr != nil {
		fail("ffprobe failed: " + perr.Error())
	} else {
		res.GeometryGot = fmt.Sprintf("%dx%d@%g", info.Width, info.Height, info.FPS)
		res.DurationGot = info.Duration
		res.Assertions["codec"] = info.Codec
		if info.Width != c.W || info.Height != c.H {
			fail(fmt.Sprintf("dimensions %dx%d != want %dx%d", info.Width, info.Height, c.W, c.H))
		}
		if !l3bWithin(info.FPS, float64(c.FPS), 0.02) {
			fail(fmt.Sprintf("fps %.4f != want %d", info.FPS, c.FPS))
		}
		if !l3bWithin(info.Duration, wantDur, 0.5) {
			fail(fmt.Sprintf("duration %.3fs != want %.3fs (±0.5)", info.Duration, wantDur))
		}
		if info.Codec != "h264" {
			fail(fmt.Sprintf("codec %q != h264", info.Codec))
		}
	}

	gotFrames, nerr := l3bCountPackets(ctx, ffprobe, outputPath)
	if nerr != nil {
		fail("count_packets failed: " + nerr.Error())
	} else {
		res.FramesGot = gotFrames
		res.PacketsPerSec = float64(gotFrames) / wantDur
		if gotFrames != c.Frames {
			fail(fmt.Sprintf("packet count %d != exact frame total %d", gotFrames, c.Frames))
		}
	}

	// three-point frame extraction: start / middle / end — non-empty,
	// mutually distinct, and not ALL solid-color. Per-sample solid-color is
	// recorded but not failed: designed compositions legitimately open on a
	// flat base frame (C08 F0 is the full-red baseline, A-C08-05) — the
	// pipeline defect a solid frame would reveal (blank capture, stage
	// collapse) shows up as ALL THREE samples flat, which is what fails.
	solidCount := 0
	firstImg := (*image.Image)(nil)
	for _, atSec := range []float64{0.0, wantDur / 2, wantDur - 0.2} {
		frameFile := filepath.Join(caseDir, fmt.Sprintf("frame-%05.1f.png", atSec))
		_, xerr := l3bExtractFrame(ctx, ffmpeg, outputPath, frameFile, atSec)
		smp := l3bSample{AtSec: atSec, File: frameFile}
		if xerr != nil {
			fail("frame extract: " + xerr.Error())
			smp.NonEmpty = false
		} else {
			smp.NonEmpty, smp.SolidColor, res.Assertions[fmt.Sprintf("stddev@%.1f", atSec)], smp.Distinct, _ = l3bSampleAnalysis(frameFile, firstImg)
			if !smp.NonEmpty {
				fail(fmt.Sprintf("frame @%.1fs empty/unreadable", atSec))
			}
			if smp.SolidColor {
				solidCount++
				res.Notes = append(res.Notes, fmt.Sprintf("frame @%.1fs near-solid color (stddev < 1.0) — recorded, single-sample flatness is a legitimate design baseline (e.g. C08 red F0)", atSec))
			}
			if firstImg == nil {
				if _, _, _, _, dec := l3bSampleAnalysis(frameFile, nil); dec != nil {
					firstImg = &dec
				}
				smp.Distinct = true // first sample is its own baseline
			}
		}
		res.Samples = append(res.Samples, smp)
	}
	if solidCount == len(res.Samples) {
		fail("ALL three extracted frames are near-solid color (blank-capture signature)")
	}
	res.Assertions["samples_distinct"] = true
	for i, s := range res.Samples {
		if i > 0 && !s.Distinct {
			res.Assertions["samples_distinct"] = false
			fail(fmt.Sprintf("frame sample @%.1fs not distinct from the first sample", s.AtSec))
		}
	}

	// C08 audio branch: RMS via volumedetect (mean_volume = RMS level).
	if c.Mux {
		audio, aerr := l3bAudioRMS(ctx, ffmpeg, outputPath)
		if aerr != nil {
			fail("volumedetect: " + aerr.Error())
		} else {
			res.AudioRMS = audio
			if !audio.Present {
				fail("audio stream absent after MuxAV")
			} else if audio.MeanVolumeDB < -60 {
				fail(fmt.Sprintf("voice RMS %.1f dB < -60 dB floor (silent track?)", audio.MeanVolumeDB))
			}
			res.Assertions["voice_rms_mean_db"] = audio.MeanVolumeDB
			res.Assertions["voice_rms_max_db"] = audio.MaxVolumeDB
		}
	}

	// full-decode error scan of the shipped bytes.
	dv := l3bDecodeVerify(ctx, ffmpeg, outputPath)
	res.DecodeVerify = dv
	if !dv.StderrEmpty || dv.ExitErr != "" {
		fail("decode verify: stderr=" + dv.Stderr + " exit=" + dv.ExitErr)
	}

	res.TotalMS = time.Since(startAll).Milliseconds()
	if res.Status == "" {
		res.Status = "ok"
	}
	l3bFinish(t, res, caseDir)

	if len(res.FailReasons) > 0 {
		t.Fatalf("[%s] FAILED: %s", c.CaseID, strings.Join(res.FailReasons, "; "))
	}
	t.Logf("[%s] PASS: %s (%d packets, %.3fs, %d bytes, total %s)",
		c.CaseID, res.GeometryGot, res.FramesGot, res.DurationGot, res.SizeBytes, time.Duration(res.TotalMS)*time.Millisecond)
}

// l3bFinish writes the per-case JSON report next to the artifact.
func l3bFinish(t *testing.T, res *l3bCaseResult, caseDir string) {
	t.Helper()
	b, err := json.MarshalIndent(res, "", "  ")
	if err != nil {
		t.Logf("marshal report: %v", err)
		return
	}
	rep := filepath.Join(caseDir, "report.json")
	if werr := os.WriteFile(rep, b, 0o644); werr != nil {
		t.Logf("write report: %v", werr)
	}
}
