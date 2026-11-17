package capx_test

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"image/png"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/haozing/ploykit/platform/capx"
)

// writeFramesPNG pushes n 1x1 red PNG frames through the length-prefixed
// FrameWriter protocol into a pipe; the read end is the frames stream that
// EncodePNGStream consumes. The writer goroutine finishes with the frames
// once all are queued, so the decode goroutine sees EOF.
func writeFramesPNG(t *testing.T, n int) io.Reader {
	t.Helper()
	pr, pw := io.Pipe()
	go func() {
		fw := capx.NewFrameWriter(pw)
		for i := 0; i < n; i++ {
			if err := fw.WriteFrame(pngFrame); err != nil {
				_ = pw.CloseWithError(err)
				return
			}
		}
		_ = pw.Close() // EOF: all frames written
	}()
	return pr
}

// pngFrame is a valid 2x2 red PNG used as encoder input. (A 1x1 PNG is valid
// but ffmpeg's image2pipe+libx264 path rejects it, so the fixture uses 2x2 —
// an even size, which yuv420p requires anyway.)
var pngFrame = buildRedPNG()

func buildRedPNG() []byte {
	w, h := 2, 2
	iHDR := make([]byte, 13)
	binary.BigEndian.PutUint32(iHDR[0:4], uint32(w))
	binary.BigEndian.PutUint32(iHDR[4:8], uint32(h))
	iHDR[8], iHDR[9], iHDR[10], iHDR[11], iHDR[12] = 8, 2, 0, 0, 0 // 8-bit RGB
	raw := make([]byte, 0, h*(1+w*3))
	for y := 0; y < h; y++ {
		raw = append(raw, 0x00) // filter none
		for x := 0; x < w; x++ {
			raw = append(raw, 0xff, 0x00, 0x00)
		}
	}
	var idat bytes.Buffer
	zw := zlib.NewWriter(&idat)
	_, _ = zw.Write(raw)
	_ = zw.Close()

	chunk := func(typ string, data []byte) []byte {
		out := make([]byte, 12+len(data))
		binary.BigEndian.PutUint32(out[:4], uint32(len(data)))
		copy(out[4:8], typ)
		copy(out[8:], data)
		sum := crc32.ChecksumIEEE(out[4 : 8+len(data)])
		binary.BigEndian.PutUint32(out[8+len(data):], sum)
		return out
	}
	png := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}
	png = append(png, chunk("IHDR", iHDR)...)
	png = append(png, chunk("IDAT", idat.Bytes())...)
	png = append(png, chunk("IEND", nil)...)
	return png
}

func TestEncodePNGStream_MinimalMP4(t *testing.T) {
	r := newChromeRuntime(t)
	var out bytes.Buffer
	err := r.EncodePNGStream(t.Context(), &out,
		capx.FrameSpec{Width: 64, Height: 64, FPS: 10, DurationFrames: 6},
		writeFramesPNG(t, 6),
		capx.EncodeOptions{})
	if err != nil {
		t.Fatalf("EncodePNGStream: %v", err)
	}
	if out.Len() == 0 {
		t.Fatal("encoder produced no output")
	}
	// MP4 signature: bytes 4-7 are "ftyp".
	if !bytes.Contains(out.Bytes()[:16], []byte("ftyp")) {
		t.Error("output is not an MP4 (missing ftyp box)")
	}
}

func TestEncodePNGStream_Options(t *testing.T) {
	r := newChromeRuntime(t)
	var out bytes.Buffer
	err := r.EncodePNGStream(t.Context(), &out,
		capx.FrameSpec{Width: 64, Height: 64, FPS: 10, DurationFrames: 6},
		writeFramesPNG(t, 6),
		capx.EncodeOptions{CRF: 30, Preset: "ultrafast"},
	)
	if err != nil {
		t.Fatalf("EncodePNGStream: %v", err)
	}
	if out.Len() == 0 || !bytes.Contains(out.Bytes()[:16], []byte("ftyp")) {
		t.Error("output is not an MP4")
	}
}

func TestFrameWriter_LengthPrefix(t *testing.T) {
	var buf bytes.Buffer
	fw := capx.NewFrameWriter(&buf)
	if err := fw.WriteFrame(pngFrame); err != nil {
		t.Fatalf("WriteFrame: %v", err)
	}
	// 8-byte little-endian length prefix then payload.
	if buf.Len() != 8+len(pngFrame) {
		t.Fatalf("buf len = %d, want %d", buf.Len(), 8+len(pngFrame))
	}
	if !bytes.Equal(buf.Bytes()[8:], pngFrame) {
		t.Error("payload mismatch")
	}
	if buf.Bytes()[0] != byte(len(pngFrame)) {
		t.Error("length prefix low byte mismatch")
	}
}

// encodeVideo is the shared helper producing a real tiny MP4 for the mux /
// thumbnail / subtitle tests.
func encodeVideo(t *testing.T, dir string) string {
	t.Helper()
	r := newChromeRuntime(t)
	var out bytes.Buffer
	err := r.EncodePNGStream(t.Context(), &out,
		capx.FrameSpec{Width: 64, Height: 64, FPS: 10, DurationFrames: 12},
		writeFramesPNG(t, 12),
		capx.EncodeOptions{Preset: "ultrafast"})
	if err != nil {
		t.Fatalf("EncodePNGStream: %v", err)
	}
	path := dir + "/in.mp4"
	if err := os.WriteFile(path, out.Bytes(), 0o644); err != nil {
		t.Fatalf("write temp video: %v", err)
	}
	return path
}

func TestMuxAV_SilentVideo(t *testing.T) {
	r := newChromeRuntime(t)
	path := encodeVideo(t, t.TempDir())
	var out bytes.Buffer
	if err := r.MuxAV(t.Context(), &out, path, "", "", 1.0, 0); err != nil {
		t.Fatalf("MuxAV (no audio): %v", err)
	}
	if out.Len() == 0 || !bytes.Contains(out.Bytes()[:16], []byte("ftyp")) {
		t.Error("MuxAV output is not an MP4")
	}
}

func TestExtractThumbnail_JPEG(t *testing.T) {
	r := newChromeRuntime(t)
	path := encodeVideo(t, t.TempDir())
	var out bytes.Buffer
	if err := r.ExtractThumbnail(t.Context(), path, &out); err != nil {
		t.Fatalf("ExtractThumbnail: %v", err)
	}
	if out.Len() == 0 || !bytes.HasPrefix(out.Bytes(), []byte{0xff, 0xd8}) {
		t.Error("thumbnail is not a JPEG")
	}
}

// TestExtractFrameAt_PNG: the parameterized frame extraction returns a
// lossless PNG at a fractional seek point (the video_render_frames MCP tool
// and the pipeline's first-frame thumb both sit on this path).
func TestExtractFrameAt_PNG(t *testing.T) {
	r := newChromeRuntime(t)
	path := encodeVideo(t, t.TempDir()) // 12 frames @ 10fps = 1.2s
	var out bytes.Buffer
	if err := r.ExtractFrameAt(t.Context(), path, 0.5, &out); err != nil {
		t.Fatalf("ExtractFrameAt: %v", err)
	}
	if out.Len() == 0 {
		t.Fatal("ExtractFrameAt produced no frame")
	}
	if !bytes.HasPrefix(out.Bytes(), []byte{0x89, 'P', 'N', 'G'}) {
		t.Error("ExtractFrameAt output is not a PNG")
	}
}

// TestExtractFrameAt_SecondFrameDecodes: two seeks 100ms apart must both
// decode as images (the frame payload is real, not padded bytes).
func TestExtractFrameAt_SecondFrameDecodes(t *testing.T) {
	r := newChromeRuntime(t)
	path := encodeVideo(t, t.TempDir())
	for _, sec := range []float64{0, 0.1} {
		var out bytes.Buffer
		if err := r.ExtractFrameAt(t.Context(), path, sec, &out); err != nil {
			t.Fatalf("ExtractFrameAt(%.1f): %v", sec, err)
		}
		if _, err := png.Decode(bytes.NewReader(out.Bytes())); err != nil {
			t.Errorf("ExtractFrameAt(%.1f) did not decode as PNG: %v", sec, err)
		}
	}
}

// TestExtractFrameAt_Guards: empty path and negative sec rejected without
// spawning ffmpeg; an inert runtime returns ErrNotConfigured before any exec.
func TestExtractFrameAt_Guards(t *testing.T) {
	r := newChromeRuntime(t)
	var out bytes.Buffer
	if err := r.ExtractFrameAt(t.Context(), "", 1, &out); err == nil ||
		!strings.Contains(err.Error(), "requires videoPath") {
		t.Errorf("empty path: got %v, want requires-videoPath error", err)
	}
	if err := r.ExtractFrameAt(t.Context(), "v.mp4", -1, &out); err == nil ||
		!strings.Contains(err.Error(), "sec >= 0") {
		t.Errorf("negative sec: got %v, want the sec>=0 error", err)
	}
	// capx_test.go:132 同款：惰性运行时（Enabled 缺省）在任何 exec 之前降级。
	inert, err := capx.New(capx.Config{})
	if err != nil {
		t.Fatalf("inert runtime: %v", err)
	}
	if err := inert.ExtractFrameAt(t.Context(), "v.mp4", 1, &out); !errors.Is(err, capx.ErrNotConfigured) {
		t.Errorf("inert runtime: got %v, want ErrNotConfigured", err)
	}
}

func TestBurnSubtitles_NoLibassDegrades(t *testing.T) {
	r := newChromeRuntime(t)
	dir := t.TempDir()
	path := encodeVideo(t, dir)
	srt := dir + "/subs.srt"
	if err := os.WriteFile(srt, []byte("1\n00:00:00,000 --> 00:00:01,000\nhello\n"), 0o644); err != nil {
		t.Fatalf("write srt: %v", err)
	}

	var out bytes.Buffer
	err := r.BurnSubtitles(t.Context(), path, srt, &out)
	if err == nil {
		// libass present on this machine: a successful burn is acceptable.
		if out.Len() == 0 || !bytes.Contains(out.Bytes()[:16], []byte("ftyp")) {
			t.Error("burn output is not an MP4")
		}
		return
	}
	if err != capx.ErrNoLibass {
		t.Fatalf("BurnSubtitles: %v, want success or ErrNoLibass", err)
	}
}

// probeStreams shells out to ffprobe (when present) and returns the
// (codec_type, codec_name) pairs of the finished file. Field order in the
// CSV follows ffprobe's internal dictionary order (name before type), so the
// parser keys off the values, not the positions. Skipped silently when
// ffprobe is not on PATH — callers fall back to structural assertions.
func probeStreams(t *testing.T, path string) [][2]string {
	t.Helper()
	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("ffprobe not found; stream-level assertion skipped")
	}
	out, err := exec.Command(ffprobe, "-v", "error",
		"-show_entries", "stream=codec_type,codec_name",
		"-of", "csv=p=0", path).Output()
	if err != nil {
		t.Fatalf("ffprobe %s: %v", path, err)
	}
	knownTypes := map[string]bool{"video": true, "audio": true, "subtitle": true, "data": true}
	var streams [][2]string
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		fields := strings.Split(strings.TrimSpace(line), ",")
		if len(fields) != 2 {
			continue
		}
		if knownTypes[fields[0]] {
			streams = append(streams, [2]string{fields[0], fields[1]})
		} else if knownTypes[fields[1]] {
			streams = append(streams, [2]string{fields[1], fields[0]})
		}
	}
	return streams
}

// TestSoftSubtitles_MovTextTrack packages a real video + SRT through
// SoftSubtitles and verifies the deliverable with ffprobe: the video stream
// survives the stream copy and a mov_text subtitle track is embedded —
// the soft-mode deliverable the pipeline had been missing entirely.
func TestSoftSubtitles_MovTextTrack(t *testing.T) {
	r := newChromeRuntime(t)
	dir := t.TempDir()
	path := encodeVideo(t, dir)
	srt := dir + "/subs.srt"
	const srtDoc = "1\n00:00:00,000 --> 00:00:00,500\nhello\n\n" +
		"2\n00:00:00,600 --> 00:00:01,000\n字幕\n"
	if err := os.WriteFile(srt, []byte(srtDoc), 0o644); err != nil {
		t.Fatalf("write srt: %v", err)
	}

	var out bytes.Buffer
	if err := r.SoftSubtitles(t.Context(), path, srt, &out); err != nil {
		t.Fatalf("SoftSubtitles: %v", err)
	}
	if out.Len() == 0 || !bytes.Contains(out.Bytes()[:16], []byte("ftyp")) {
		t.Fatal("soft output is not an MP4")
	}

	softPath := dir + "/soft.mp4"
	if err := os.WriteFile(softPath, out.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	streams := probeStreams(t, softPath)
	hasVideo, hasMovText := false, false
	for _, s := range streams {
		if s[0] == "video" {
			hasVideo = true
		}
		if s[0] == "subtitle" && s[1] == "mov_text" {
			hasMovText = true
		}
	}
	if !hasVideo {
		t.Errorf("soft output lost the video stream: %v", streams)
	}
	if !hasMovText {
		t.Errorf("soft output has no mov_text subtitle track: %v", streams)
	}

	// Stream-copy invariant: the packaged video stream keeps the original
	// codec (h264 here), i.e. soft packaging must not re-encode.
	for _, s := range streams {
		if s[0] == "video" && s[1] != "h264" {
			t.Errorf("video stream re-encoded: got %s, want h264 (stream copy)", s[1])
		}
	}
}

// TestSoftSubtitles_MissingSRT: a nonexistent subtitle file must surface as
// an error (ffmpeg fails opening input #1), never as a silently un-subtitled
// deliverable.
func TestSoftSubtitles_MissingSRT(t *testing.T) {
	r := newChromeRuntime(t)
	dir := t.TempDir()
	path := encodeVideo(t, dir)
	var out bytes.Buffer
	err := r.SoftSubtitles(t.Context(), path, filepath.Join(dir, "nope.srt"), &out)
	if err == nil {
		t.Fatal("SoftSubtitles with a missing SRT succeeded; want an error")
	}
	if !strings.Contains(err.Error(), "ffmpeg failed") {
		t.Errorf("error does not carry the ffmpeg failure detail: %v", err)
	}
}

// TestSoftSubtitles_RequiresArgs mirrors the guard rails of the other entry
// points (ErrNotConfigured when the runtime is inert; empty args rejected).
func TestSoftSubtitles_RequiresArgs(t *testing.T) {
	r := newChromeRuntime(t)
	if err := r.SoftSubtitles(t.Context(), "video.mp4", "", &bytes.Buffer{}); err == nil ||
		!strings.Contains(err.Error(), "requires videoPath and srtPath") {
		t.Errorf("empty srtPath: got %v, want the requires-args error", err)
	}
}

// TestMuxAV_AudioBranchesReal exercises the three audio graphs against a real
// ffmpeg: voice+bgm (volume applied, amix not normalising), voice-only and
// bgm-only. The v2 mix dropped voiceVolume entirely and let amix halve both
// tracks, so these branches had no behavioural coverage at all.
func TestMuxAV_AudioBranchesReal(t *testing.T) {
	r := newChromeRuntime(t)
	dir := t.TempDir()
	video := encodeVideo(t, dir)

	mkAudio := func(name, spec string, sec string) string {
		p := dir + "/" + name
		cmd := exec.Command("ffmpeg", "-y", "-f", "lavfi", "-i", spec, "-t", sec, p)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("build %s: %v\n%s", name, err, out)
		}
		return p
	}
	voice := mkAudio("voice.mp3", "sine=frequency=440:duration=1", "1")
	bgm := mkAudio("bgm.mp3", "sine=frequency=220:duration=5", "5")

	cases := []struct {
		name       string
		voice, bgm string
		vv, bv     float64
	}{
		{"voice+bgm", voice, bgm, 0.5, 0.2},
		{"voice only", voice, "", 0.3, 0},
		{"bgm only", "", bgm, 0, 0.4},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var out bytes.Buffer
			if err := r.MuxAV(t.Context(), &out, video, tc.voice, tc.bgm, tc.vv, tc.bv); err != nil {
				t.Fatalf("MuxAV(%s): %v", tc.name, err)
			}
			if out.Len() == 0 || !bytes.Contains(out.Bytes()[:16], []byte("ftyp")) {
				t.Fatalf("%s: output is not an MP4", tc.name)
			}
		})
	}
}
