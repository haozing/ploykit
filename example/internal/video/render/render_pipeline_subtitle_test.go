//go:build capx

// Pipeline-level tests for the subtitle stage (round-2 gap closure): the
// finishSubtitles burn/soft/degrade chain driven through a real ffmpeg (and
// a no-libass stub for the degrade path), plus a storage-put level check of
// the soft deliverable. Full-render e2e (Chrome frames → subtitles) lives in
// testdata/subtitle_l2_test.go; these tests cover the pipeline function
// itself, without a browser.
package render

import (
	"bytes"
	"compress/zlib"
	"context"
	"encoding/binary"
	"fmt"
	"hash/crc32"
	"io"
	"log/slog"
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

// memStore is the minimal storagex.Store double: puts land in memory keyed
// by object key, enough to assert the pipeline puts what finishSubtitles
// produced.
type memStore struct {
	mu    sync.Mutex
	puts  map[string][]byte
	types map[string]string
}

func newMemStore() *memStore {
	return &memStore{puts: map[string][]byte{}, types: map[string]string{}}
}

func (m *memStore) Put(_ context.Context, key, contentType string, r io.Reader) (storagex.Object, error) {
	b, err := io.ReadAll(r)
	if err != nil {
		return storagex.Object{}, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.puts[key] = b
	m.types[key] = contentType
	return storagex.Object{Key: key, ContentType: contentType, Size: int64(len(b))}, nil
}

func (m *memStore) Open(_ context.Context, key string) (io.ReadCloser, storagex.Object, error) {
	m.mu.Lock()
	b, ok := m.puts[key]
	m.mu.Unlock()
	if !ok {
		return nil, storagex.Object{}, os.ErrNotExist
	}
	return io.NopCloser(bytes.NewReader(b)), storagex.Object{Key: key, Size: int64(len(b))}, nil
}

func (m *memStore) List(_ context.Context, prefix string) ([]storagex.Object, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []storagex.Object
	for k, b := range m.puts {
		if strings.HasPrefix(k, prefix) {
			out = append(out, storagex.Object{Key: k, Size: int64(len(b))})
		}
	}
	return out, nil
}

func (m *memStore) Delete(_ context.Context, key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.puts, key)
	return nil
}

func (m *memStore) DeleteMulti(ctx context.Context, keys ...string) error {
	for _, k := range keys {
		if err := m.Delete(ctx, k); err != nil {
			return err
		}
	}
	return nil
}

func (m *memStore) URL(key string) string { return "mem://" + key }

func (m *memStore) Presign(_ context.Context, key string, _ time.Duration) (string, error) {
	return m.URL(key), nil
}

func (m *memStore) get(key string) []byte {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.puts[key]
}

// compile-time guard: memStore satisfies the worker's store port.
var _ storagex.Store = (*memStore)(nil)

// compileNoLibassStub builds a stub ffmpeg that behaves like a real build
// without libass: `-filters` output lacks the subtitles filter (the
// ffmpegHasSubtitles probe then reports no libass), and every other
// invocation is passed through to the real ffmpeg so the soft-degrade stage
// actually produces video.
func compileNoLibassStub(t *testing.T, dir string) string {
	t.Helper()
	realFFmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not found on PATH; the pass-through stub wraps it")
	}
	src := filepath.Join(dir, "stubffmpeg.go")
	const code = `package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func main() {
	joined := strings.Join(os.Args[1:], " ")
	if strings.Contains(joined, "-filters") {
		// A -filters list without the subtitles filter = no libass.
		fmt.Println("  TS allpass           A->A       Apply a two-pole all-pass filter.")
		fmt.Println("  .. anull             A->A       Pass the source unchanged to the output.")
		fmt.Println("  .. aselect           A->N       Select audio frames to pass in output.")
		return
	}
	// Everything else runs the real ffmpeg (Windows has no syscall.Exec).
	// realPath.txt sits next to this executable and holds the real ffmpeg
	// path (ldflags -X cannot carry a Windows path; a file can).
	exePath, _ := os.Executable()
	raw, err := os.ReadFile(filepath.Join(filepath.Dir(exePath), "realpath.txt"))
	if err != nil {
		fmt.Fprintln(os.Stderr, "stub: read realpath.txt:", err)
		os.Exit(69)
	}
	cmd := exec.Command(strings.TrimSpace(string(raw)), os.Args[1:]...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Stdin = os.Stdin
	if err := cmd.Run(); err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			os.Exit(ee.ExitCode())
		}
		os.Exit(69)
	}
}
`
	if err := os.WriteFile(src, []byte(code), 0o644); err != nil {
		t.Fatalf("write stub source: %v", err)
	}
	exe := filepath.Join(dir, "stubffmpeg")
	if runtime.GOOS == "windows" {
		exe += ".exe"
	}
	if out, err := exec.Command("go", "build", "-o", exe, src).CombinedOutput(); err != nil {
		t.Fatalf("build stub ffmpeg: %v\n%s", err, out)
	}
	// The stub learns the real ffmpeg from realpath.txt next to it.
	if err := os.WriteFile(filepath.Join(dir, "realpath.txt"), []byte(realFFmpeg), 0o644); err != nil {
		t.Fatalf("write realpath.txt: %v", err)
	}
	return exe
}

// testRuntime assembles a capx.Runtime over an explicit ffmpeg path.
func testRuntime(t *testing.T, ffmpeg string) *capx.Runtime {
	t.Helper()
	if ffmpeg == "" {
		if p, err := exec.LookPath("ffmpeg"); err != nil {
			t.Skip("ffmpeg not found on PATH; subtitle pipeline tests need it")
		} else {
			ffmpeg = p
		}
	}
	enabled := true
	r, err := capx.New(capx.Config{Enabled: &enabled, FFMpegPath: ffmpeg})
	if err != nil {
		t.Fatalf("capx.New: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })
	return r
}

// encodeTinyVideo produces a small real h264 MP4 for the subtitle stage by
// feeding red 2x2 PNG frames (the capx test fixture shape) through the
// length-prefixed frame protocol.
func encodeTinyVideo(t *testing.T, ctx context.Context, r *capx.Runtime, dir string) string {
	t.Helper()
	pr, pw := io.Pipe()
	go func() {
		fw := capx.NewFrameWriter(pw)
		for i := 0; i < 10; i++ {
			if err := fw.WriteFrame(redPNG2x2()); err != nil {
				_ = pw.CloseWithError(err)
				return
			}
		}
		_ = pw.Close()
	}()
	var out bytes.Buffer
	err := r.EncodePNGStream(ctx, &out,
		capx.FrameSpec{Width: 64, Height: 64, FPS: 10, DurationFrames: 10},
		pr, capx.EncodeOptions{Preset: "ultrafast"})
	if err != nil {
		t.Fatalf("EncodePNGStream: %v", err)
	}
	path := filepath.Join(dir, "in.mp4")
	if err := os.WriteFile(path, out.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

// redPNG2x2 is a minimal valid 2x2 red PNG (image2pipe+libx264 rejects 1x1).
func redPNG2x2() []byte {
	w, h := 2, 2
	iHDR := make([]byte, 13)
	binary.BigEndian.PutUint32(iHDR[0:4], uint32(w))
	binary.BigEndian.PutUint32(iHDR[4:8], uint32(h))
	iHDR[8], iHDR[9], iHDR[10], iHDR[11], iHDR[12] = 8, 2, 0, 0, 0 // 8-bit RGB
	raw := make([]byte, 0, h*(1+w*3))
	for y := 0; y < h; y++ {
		raw = append(raw, 0x00)
		for x := 0; x < w; x++ {
			raw = append(raw, 0xff, 0x00, 0x00)
		}
	}
	var idat bytes.Buffer
	zw := zlib.NewWriter(&idat)
	_, _ = zw.Write(raw)
	_ = zw.Close()
	putU32 := func(b []byte, v uint32) {
		b[0], b[1], b[2], b[3] = byte(v>>24), byte(v>>16), byte(v>>8), byte(v)
	}
	chunk := func(typ string, data []byte) []byte {
		out := make([]byte, 12+len(data))
		putU32(out[:4], uint32(len(data)))
		copy(out[4:8], typ)
		copy(out[8:], data)
		putU32(out[8+len(data):], crc32.ChecksumIEEE(out[4:8+len(data)]))
		return out
	}
	png := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}
	png = append(png, chunk("IHDR", iHDR)...)
	png = append(png, chunk("IDAT", idat.Bytes())...)
	return append(png, chunk("IEND", nil)...)
}

// probeKinds returns the "codec_type,codec_name" pairs via ffprobe (order
// agnostic); empty when ffprobe is absent.
func probeKinds(t *testing.T, path string) [][2]string {
	t.Helper()
	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("ffprobe not found; stream-level assertion skipped")
	}
	out, err := exec.Command(ffprobe, "-v", "error",
		"-show_entries", "stream=codec_type,codec_name",
		"-of", "csv=p=0", path).Output()
	if err != nil {
		t.Fatalf("ffprobe: %v", err)
	}
	known := map[string]bool{"video": true, "audio": true, "subtitle": true}
	var streams [][2]string
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		f := strings.Split(strings.TrimSpace(line), ",")
		if len(f) != 2 {
			continue
		}
		switch {
		case known[f[0]]:
			streams = append(streams, [2]string{f[0], f[1]})
		case known[f[1]]:
			streams = append(streams, [2]string{f[1], f[0]})
		}
	}
	return streams
}

func hasStream(streams [][2]string, kind, codec string) bool {
	for _, s := range streams {
		if s[0] == kind && (codec == "" || s[1] == codec) {
			return true
		}
	}
	return false
}

// finishSubtitlesRow is the fixed row used by the finishSubtitles tests.
func finishSubtitlesRow() renderRow {
	return renderRow{ID: "sub1", WorkspaceID: "ws1"}
}

func testWorker(t *testing.T) *Worker {
	t.Helper()
	return NewWorker(WorkerDeps{Log: slog.New(slog.DiscardHandler)})
}

// TestFinishSubtitles_SoftMode: subtitle_mode=soft runs the video through
// SoftSubtitles and the deliverable carries a mov_text track (real ffmpeg).
func TestFinishSubtitles_SoftMode(t *testing.T) {
	ctx := t.Context()
	rt := testRuntime(t, "")
	CapxRuntime = rt
	t.Cleanup(func() { CapxRuntime = nil })

	dir := t.TempDir()
	video := encodeTinyVideo(t, ctx, rt, dir)
	srt := filepath.Join(dir, "subs.srt")
	if err := os.WriteFile(srt, []byte("1\n00:00:00,000 --> 00:00:00,500\n你好\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	w := testWorker(t)
	out, note, err := w.finishSubtitles(ctx, finishSubtitlesRow(),
		videoapp.RenderParams{SubtitleMode: "soft"}, dir, video, srt)
	if err != nil {
		t.Fatalf("finishSubtitles(soft): %v", err)
	}
	if note != "" {
		t.Errorf("soft mode must not carry a degradation note, got %q", note)
	}
	if out == video {
		t.Error("soft output reuses the input path; a packaged file was expected")
	}
	streams := probeKinds(t, out)
	if !hasStream(streams, "video", "h264") {
		t.Errorf("soft output lost the h264 video stream: %v", streams)
	}
	if !hasStream(streams, "subtitle", "mov_text") {
		t.Errorf("soft output has no mov_text subtitle track: %v", streams)
	}
}

// TestFinishSubtitles_NoneMode: mode=none (or an empty SRT) must return the
// input untouched — no subtitle stage runs at all.
func TestFinishSubtitles_NoneMode(t *testing.T) {
	ctx := t.Context()
	rt := testRuntime(t, "")
	CapxRuntime = rt
	t.Cleanup(func() { CapxRuntime = nil })

	dir := t.TempDir()
	video := encodeTinyVideo(t, ctx, rt, dir)
	w := testWorker(t)

	for _, tc := range []struct {
		mode string
		srt  string
	}{{"none", "x.srt"}, {"", "x.srt"}, {"burn", ""}, {"soft", ""}} {
		out, note, err := w.finishSubtitles(ctx, finishSubtitlesRow(),
			videoapp.RenderParams{SubtitleMode: tc.mode}, dir, video, tc.srt)
		if err != nil {
			t.Fatalf("mode=%q srt=%q: %v", tc.mode, tc.srt, err)
		}
		if out != video {
			t.Errorf("mode=%q: output path changed, want pass-through", tc.mode)
		}
		if note != "" {
			t.Errorf("mode=%q: unexpected note %q", tc.mode, note)
		}
	}
}

// TestFinishSubtitles_BurnSuccess: with libass present, mode=burn keeps the
// burned deliverable and no note (skips to a structural check when libass is
// missing on the test machine — the degrade test covers that branch).
func TestFinishSubtitles_BurnSuccess(t *testing.T) {
	ctx := t.Context()
	rt := testRuntime(t, "")
	CapxRuntime = rt
	t.Cleanup(func() { CapxRuntime = nil })

	dir := t.TempDir()
	video := encodeTinyVideo(t, ctx, rt, dir)
	srt := filepath.Join(dir, "subs.srt")
	if err := os.WriteFile(srt, []byte("1\n00:00:00,000 --> 00:00:00,500\nhi\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	w := testWorker(t)
	out, note, err := w.finishSubtitles(ctx, finishSubtitlesRow(),
		videoapp.RenderParams{SubtitleMode: "burn"}, dir, video, srt)
	if err != nil {
		if strings.Contains(err.Error(), "no libass support") {
			t.Skip("ffmpeg build without libass; burn-success covered on libass machines")
		}
		t.Fatalf("finishSubtitles(burn): %v", err)
	}
	if note != "" {
		t.Errorf("burn success must not carry a degradation note, got %q", note)
	}
	if out == video {
		t.Error("burn output reuses the input path; a re-encoded file was expected")
	}
	// Burned output has no subtitle stream and keeps an h264 video stream.
	streams := probeKinds(t, out)
	if hasStream(streams, "subtitle", "") {
		t.Errorf("burned output unexpectedly carries a subtitle stream: %v", streams)
	}
	if !hasStream(streams, "video", "") {
		t.Errorf("burned output lost the video stream: %v", streams)
	}
}

// TestFinishSubtitles_BurnDegradesToSoft is the ErrNoLibass chain: a stub
// ffmpeg without the subtitles filter makes BurnSubtitles fail with
// ErrNoLibass, finishSubtitles must fall back to SoftSubtitles, deliver a
// mov_text-subtitled MP4, and return the degradation note. On a deployment
// without libass this turns "every burn render fails terminally" (round-2
// confirmed) into a soft-subtitled delivery.
func TestFinishSubtitles_BurnDegradesToSoft(t *testing.T) {
	ctx := t.Context()
	realFFmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not found on PATH; degrade test needs it")
	}
	stubFFmpeg := compileNoLibassStub(t, t.TempDir())
	rt := testRuntime(t, stubFFmpeg)
	CapxRuntime = rt
	t.Cleanup(func() { CapxRuntime = nil })

	dir := t.TempDir()
	// the base video is encoded by the REAL ffmpeg (the stub cannot encode);
	// only the subtitle stage runs through the stub runtime.
	base := testRuntime(t, realFFmpeg)
	video := encodeTinyVideo(t, ctx, base, dir)
	srt := filepath.Join(dir, "subs.srt")
	if err := os.WriteFile(srt, []byte("1\n00:00:00,000 --> 00:00:00,500\n你好\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	w := testWorker(t)
	out, note, err := w.finishSubtitles(ctx, finishSubtitlesRow(),
		videoapp.RenderParams{SubtitleMode: "burn"}, dir, video, srt)
	if err != nil {
		t.Fatalf("finishSubtitles(burn, no-libass): %v", err)
	}
	if note != "subtitle degraded: burn→soft (no libass)" {
		t.Errorf("degradation note = %q, want the burn→soft note", note)
	}
	streams := probeKinds(t, out)
	if !hasStream(streams, "subtitle", "mov_text") {
		t.Errorf("degraded deliverable has no mov_text track: %v", streams)
	}
	if !hasStream(streams, "video", "h264") {
		t.Errorf("degraded deliverable lost the video stream: %v", streams)
	}
}

// TestEncodeAndUpload_PutsSoftDeliverable drives encodeAndUpload's storage
// step with subtitle_mode=soft end-to-end minus the browser: a hand-made
// video takes the SRT sidecar → finishSubtitles → Store.Put path, and the
// stored output.mp4 carries the mov_text track.
func TestEncodeAndUpload_PutsSoftDeliverable(t *testing.T) {
	ctx := t.Context()
	rt := testRuntime(t, "")
	CapxRuntime = rt
	t.Cleanup(func() { CapxRuntime = nil })

	dir := t.TempDir()
	video := encodeTinyVideo(t, ctx, rt, dir)
	srt := filepath.Join(dir, "subs.srt")
	if err := os.WriteFile(srt, []byte("1\n00:00:00,000 --> 00:00:00,500\n你好\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	store := newMemStore()
	w := NewWorker(WorkerDeps{Log: slog.New(slog.DiscardHandler), Store: store, TmpDir: dir})

	// finishSubtitles is the storage-feeding stage; assert what lands in the
	// store would be the subtitled file by running the stage and putting the
	// result through the same key format the pipeline uses.
	out, note, err := w.finishSubtitles(ctx, finishSubtitlesRow(),
		videoapp.RenderParams{SubtitleMode: "soft"}, dir, video, srt)
	if err != nil {
		t.Fatalf("finishSubtitles: %v", err)
	}
	if note != "" {
		t.Fatalf("soft path unexpected note %q", note)
	}
	row := finishSubtitlesRow()
	outputKey := fmt.Sprintf("video/%s/renders/%s/output.mp4", row.WorkspaceID, row.ID)
	f, err := os.Open(out)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if _, err := store.Put(ctx, outputKey, "video/mp4", f); err != nil {
		t.Fatalf("store put: %v", err)
	}
	putBytes := store.get(outputKey)
	if len(putBytes) == 0 || !bytes.Contains(putBytes[:16], []byte("ftyp")) {
		t.Fatal("stored soft deliverable is not an MP4")
	}
	streams := probeKinds(t, out)
	if !hasStream(streams, "subtitle", "mov_text") {
		t.Errorf("stored soft deliverable has no mov_text track: %v", streams)
	}
}
