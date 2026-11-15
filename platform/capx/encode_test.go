package capx_test

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"hash/crc32"
	"io"
	"os"
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
	if err := r.MuxAV(t.Context(), &out, path, "", "", 0); err != nil {
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
