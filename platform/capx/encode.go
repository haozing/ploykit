package capx

import (
	"bufio"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// EncodeOptions tunes the libx264 encode.
type EncodeOptions struct {
	// CRF is the x264 constant rate factor (0-51, lower = better quality).
	// Zero means the default (18) — visually lossless for motion graphics
	// at a sane bitrate.
	CRF int
	// Preset is the x264 speed preset (ultrafast..veryslow). Empty = the
	// default "medium".
	Preset string
}

// EncodePNGStream encodes a PNG frame stream into an MP4 written to w.
//
// The frames come from the caller through the returned FrameFunc-style sink:
// this method returns an error only for the encode itself; the frames are
// pushed by the caller via FrameWriter, whose writer end must be supplied.
//
// Concretely, the caller passes frames through an intermediate pipe it owns
// and passes that pipe's READER to this method as frames — the reader must
// carry the length-prefixed frame protocol written with FrameWriter
// (8-byte LE length + PNG payload per frame). The protocol is decoded here
// and the raw PNG bytes are fed to ffmpeg on stdin via image2pipe, so there
// is no intermediate disk file:
//
//	ffmpeg -f image2pipe -framerate <fps> -i - -c:v libx264 \
//	    -pix_fmt yuv420p -crf <crf> -preset <preset> \
//	    -movflags frag_keyframe+empty_moov+default_base_moof -f mp4 -
//
// A typical wiring pairs this with RenderFrames: the onFrame callback writes
// each captured PNG through a FrameWriter, and the reading end of that pipe
// is handed to EncodePNGStream — a fully streaming render-to-encode pipeline.
//
// The ffmpeg process is killed when ctx is canceled. Stderr is captured and
// reported (tail) on failure; on success it is discarded.
func (r *Runtime) EncodePNGStream(ctx context.Context, w io.Writer, spec FrameSpec, frames io.Reader, opts EncodeOptions) error {
	if !r.Available() {
		return ErrNotConfigured
	}
	if err := spec.Validate(); err != nil {
		return err
	}
	if frames == nil {
		return errors.New("capx: EncodePNGStream requires a frame stream (write frames with FrameWriter)")
	}
	if opts.CRF <= 0 {
		opts.CRF = DefaultEncodeCRF
	}
	if opts.Preset == "" {
		opts.Preset = DefaultEncodePreset
	}
	ffmpeg := r.encoderPath()
	args := []string{
		"-y",
		"-f", "image2pipe",
		"-framerate", strconv.Itoa(spec.FPS),
		"-i", "-",
		"-c:v", "libx264",
		"-pix_fmt", "yuv420p",
		// Belt-and-braces for odd dimensions (audit Â§4 P10): libx264
		// yuv420p requires even width/height; FrameSpec.Validate rejects
		// odd specs upstream, but raw encode entry points (tests, future
		// callers) get trunc-to-even instead of a cryptic ffmpeg failure.
		"-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
		"-crf", strconv.Itoa(opts.CRF),
		"-preset", opts.Preset,
		// Pipe-safe MP4: the output here is always a stream (w is an
		// io.Writer), and +faststart requires a seekable output to move the
		// moov box (it fails on pipes). Fragmented MP4 with an empty moov at
		// the head is the streaming equivalent and plays identically in
		// browsers. Documented deviation from design §3.4's faststart line,
		// which presumes a file output.
		"-movflags", "frag_keyframe+empty_moov+default_base_moof",
		"-f", "mp4",
		"-",
	}
	// Decode the length-prefixed protocol into a raw PNG byte stream for
	// ffmpeg's stdin.
	pr, pw := io.Pipe()
	go func() {
		err := decodeFrameStreamTo(frames, pw)
		_ = pw.CloseWithError(err) // EOF on success -> clean close
	}()
	return runFFMpeg(ctx, ffmpeg, args, w, pr)
}

// decodeFrameStreamTo reads the length-prefixed protocol from pr and writes
// raw PNG frames to dst.
func decodeFrameStreamTo(pr io.Reader, dst io.Writer) error {
	var header [8]byte
	for {
		if _, err := io.ReadFull(pr, header[:]); err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
		n := binary.LittleEndian.Uint64(header[:])
		if n == 0 || n > 64<<20 {
			return fmt.Errorf("capx: invalid frame length %d", n)
		}
		if _, err := io.CopyN(dst, pr, int64(n)); err != nil {
			return err
		}
	}
}

// FrameWriter turns per-frame PNG writes into the length-prefixed stream
// EncodePNGStream consumes on stdin. Not safe for concurrent use.
type FrameWriter struct {
	w   io.Writer
	buf [8]byte
}

// NewFrameWriter wraps w.
func NewFrameWriter(w io.Writer) *FrameWriter { return &FrameWriter{w: w} }

// WriteFrame writes one PNG frame (length prefix + payload).
func (f *FrameWriter) WriteFrame(png []byte) error {
	binary.LittleEndian.PutUint64(f.buf[:], uint64(len(png)))
	if _, err := f.w.Write(f.buf[:]); err != nil {
		return err
	}
	_, err := f.w.Write(png)
	return err
}

// MuxAV muxes a video file with optional voice-over and background music into
// out. voicePath or bgmPath may be empty; bgmVolume scales the music track
// (before mixing). Video is stream-copied, audio is mixed with amix:
//
//	-i video -i voice -i bgm \
//	-filter_complex "[1:a]volume=<vv>[voice];[2:a]volume=<bv>[bgm];
//	                 [voice][bgm]amix=inputs=2:duration=first:normalize=0,apad[a]" \
//	-map 0:v -map "[a]" -c:v copy out.mp4
//
// Voice-only / bgm-only / silent variants drop the missing inputs from the
// graph. Design §3.4.
//
// voiceVolume is applied (it used to be ignored — IR validated the field but
// the mix never consumed it, so "voice_volume: 0" still produced audible
// narration; delivery audit P1). normalize=0 keeps the declared gains intact:
// ffmpeg's amix default divides by the input count, which silently halved
// both tracks.
func (r *Runtime) MuxAV(ctx context.Context, out io.Writer, videoPath, voicePath, bgmPath string, voiceVolume, bgmVolume float64) error {
	if !r.Available() {
		return ErrNotConfigured
	}
	if videoPath == "" {
		return errors.New("capx: MuxAV requires videoPath")
	}
	ffmpeg := r.encoderPath()

	args := []string{"-y", "-i", videoPath}
	var filter strings.Builder
	switch {
	case voicePath != "" && bgmPath != "":
		args = append(args, "-i", voicePath, "-i", bgmPath)
		fmt.Fprintf(&filter, "[1:a]volume=%s[voice];[2:a]volume=%s[bgm];[voice][bgm]amix=inputs=2:duration=first:normalize=0,apad[a]",
			strconv.FormatFloat(voiceVolume, 'f', -1, 64),
			strconv.FormatFloat(bgmVolume, 'f', -1, 64))
		args = append(args,
			"-filter_complex", filter.String(),
			"-map", "0:v", "-map", "[a]", "-c:v", "copy")
	case voicePath != "":
		args = append(args, "-i", voicePath)
		fmt.Fprintf(&filter, "[1:a]volume=%s,apad[a]",
			strconv.FormatFloat(voiceVolume, 'f', -1, 64))
		args = append(args,
			"-filter_complex", filter.String(),
			"-map", "0:v", "-map", "[a]", "-c:v", "copy")
	case bgmPath != "":
		args = append(args, "-i", bgmPath)
		fmt.Fprintf(&filter, "[1:a]volume=%s,apad[a]",
			strconv.FormatFloat(bgmVolume, 'f', -1, 64))
		args = append(args,
			"-filter_complex", filter.String(),
			"-map", "0:v", "-map", "[a]", "-c:v", "copy")
	default:
		args = append(args, "-map", "0:v", "-c:v", "copy")
	}
	// Cap the output at the VIDEO length. apad pads the mixed audio with
	// silence to infinity, so -shortest ends exactly when the video ends: a
	// 30s BGM under a 20s film no longer stretches the output (F-AUD-01), and
	// a 5s voice track no longer truncates the video (which bare -shortest
	// would do — the audio side is the one that must be padded, not cut).
	args = append(args, "-shortest")
	// Pipe-safe fragmented MP4 (same rationale as EncodePNGStream).
	args = append(args, "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "-")

	return runFFMpegPipe(ctx, ffmpeg, args, out)
}

// ErrNoLibass is returned by BurnSubtitles when the local ffmpeg build has no
// libass support (the subtitles filter is absent). Callers degrade to soft
// subtitle packaging (mov_text) and note it in render.error (design §3.4).
var ErrNoLibass = errors.New("capx: ffmpeg has no libass support (subtitles filter missing); degrade to soft subs (mov_text)")

// escapeFilterPath makes a filesystem path safe inside an ffmpeg filter
// argument (subtitles=...). Windows drive letters contain a colon, which the
// filter parser treats as an option separator; the ffmpeg convention is to
// escape it with a backslash and normalize slashes.
func escapeFilterPath(path string) string {
	p := filepath.ToSlash(path)
	p = strings.ReplaceAll(p, ":", `\\:`)
	return p
}

// BurnSubtitles burns an SRT file into videoPath and writes the result to w.
// Requires an ffmpeg build with libass; otherwise returns ErrNoLibass so the
// caller can fall back. Video is stream-copied besides the subtitle filter:
//
//	ffmpeg -i video -vf subtitles=<srt> -c:v libx264 -crf <default> \
//	    -pix_fmt yuv420p -c:a copy out.mp4
func (r *Runtime) BurnSubtitles(ctx context.Context, videoPath, srtPath string, w io.Writer) error {
	if !r.Available() {
		return ErrNotConfigured
	}
	if videoPath == "" || srtPath == "" {
		return errors.New("capx: BurnSubtitles requires videoPath and srtPath")
	}
	ffmpeg := r.encoderPath()
	ok, err := ffmpegHasSubtitles(ctx, ffmpeg)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNoLibass
	}
	args := []string{
		"-y",
		"-i", videoPath,
		"-vf", "subtitles=" + escapeFilterPath(srtPath),
		"-c:v", "libx264",
		"-crf", strconv.Itoa(DefaultEncodeCRF),
		"-pix_fmt", "yuv420p",
		"-c:a", "copy",
		// Pipe-safe fragmented MP4 (same rationale as EncodePNGStream).
		"-movflags", "frag_keyframe+empty_moov+default_base_moof",
		"-f", "mp4",
		"-",
	}
	return runFFMpegPipe(ctx, ffmpeg, args, w)
}

// SoftSubtitles packages an SRT file as an embedded mov_text subtitle track
// inside the MP4 written to w. The video stream is copied without re-encoding
// (the deliverable keeps the already-encoded picture; players show the track
// as toggleable captions instead of burned-in pixels):
//
//	ffmpeg -i video -i srt -map 0:v -map 1:s \
//	    -c:v copy -c:s mov_text -f mp4 -
//
// This is the no-libass degradation target for BurnSubtitles (design §3.4)
// and the native implementation of subtitle_mode=soft.
func (r *Runtime) SoftSubtitles(ctx context.Context, videoPath, srtPath string, w io.Writer) error {
	if !r.Available() {
		return ErrNotConfigured
	}
	if videoPath == "" || srtPath == "" {
		return errors.New("capx: SoftSubtitles requires videoPath and srtPath")
	}
	ffmpeg := r.encoderPath()
	args := []string{
		"-y",
		"-i", videoPath,
		"-i", srtPath,
		"-map", "0:v",
		"-map", "1:s",
		"-c:v", "copy",
		"-c:s", "mov_text",
		// Pipe-safe fragmented MP4 (same rationale as EncodePNGStream).
		"-movflags", "frag_keyframe+empty_moov+default_base_moof",
		"-f", "mp4",
		"-",
	}
	return runFFMpegPipe(ctx, ffmpeg, args, w)
}

// ExtractThumbnail writes a single JPEG frame taken early in videoPath to w:
//
//	ffmpeg -i video -ss 00:00:01 -frames:v 1 -q:v 2 -f image2 -
func (r *Runtime) ExtractThumbnail(ctx context.Context, videoPath string, w io.Writer) error {
	if !r.Available() {
		return ErrNotConfigured
	}
	if videoPath == "" {
		return errors.New("capx: ExtractThumbnail requires videoPath")
	}
	ffmpeg := r.encoderPath()
	args := []string{
		"-y",
		"-i", videoPath,
		"-ss", "00:00:01",
		"-frames:v", "1",
		"-q:v", "2",
		"-f", "image2",
		"-",
	}
	return runFFMpegPipe(ctx, ffmpeg, args, w)
}

// ExtractFrameAt writes the single video frame at sec seconds into w as PNG:
//
//	ffmpeg -ss <sec> -i video -frames:v 1 -c:v png -f image2 -
//
// sec may be fractional; input seeking (-ss before -i) is fast and
// frame-accurate on every supported ffmpeg release. The output codec is PNG
// so callers get a lossless frame with a deterministic content type —
// ExtractThumbnail above keeps its legacy fixed-1s JPEG behavior untouched.
// The PNG bytes are streamed to w (stdout pipe); nothing touches disk. A sec
// past the end of the stream makes ffmpeg produce zero frames: the call
// succeeds with an empty write, and callers should treat that as "no frame
// at that time". The ffmpeg process is killed when ctx is canceled.
func (r *Runtime) ExtractFrameAt(ctx context.Context, videoPath string, sec float64, w io.Writer) error {
	if !r.Available() {
		return ErrNotConfigured
	}
	if videoPath == "" {
		return errors.New("capx: ExtractFrameAt requires videoPath")
	}
	if sec < 0 {
		return errors.New("capx: ExtractFrameAt requires sec >= 0")
	}
	ffmpeg := r.encoderPath()
	args := []string{
		"-y",
		"-ss", strconv.FormatFloat(sec, 'f', -1, 64),
		"-i", videoPath,
		"-frames:v", "1",
		"-c:v", "png",
		"-f", "image2",
		"-",
	}
	return runFFMpegPipe(ctx, ffmpeg, args, w)
}

// ffmpegHasSubtitles reports whether the ffmpeg build exposes the subtitles
// filter (i.e. was compiled with libass).
func ffmpegHasSubtitles(ctx context.Context, ffmpeg string) (bool, error) {
	cmd := exec.CommandContext(ctx, ffmpeg, "-hide_banner", "-filters")
	out, err := cmd.Output()
	if err != nil {
		return false, fmt.Errorf("capx: ffmpeg -filters: %w", err)
	}
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 2 && fields[1] == "subtitles" {
			return true, nil
		}
	}
	return false, nil
}

// runFFMpegPipe starts ffmpeg with args, streams its stdout into w (no
// stdin), and waits. On failure the collected stderr tail is included in the
// error; ctx cancellation kills the process.
func runFFMpegPipe(ctx context.Context, ffmpeg string, args []string, w io.Writer) error {
	return runFFMpeg(ctx, ffmpeg, args, w, nil)
}

// runFFMpeg is the shared exec plumbing for all ffmpeg invocations. When
// stdin is non-nil it is fed to the process on a goroutine (the writer is
// closed when done, signaling EOF); ctx cancellation kills the process.
func runFFMpeg(ctx context.Context, ffmpeg string, args []string, w io.Writer, stdin io.Reader) error {
	cmd := exec.CommandContext(ctx, ffmpeg, args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("capx: ffmpeg stdout pipe: %w", err)
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("capx: ffmpeg stderr pipe: %w", err)
	}
	// Feed stdin concurrently with output draining; the copy goroutine
	// closes the pipe when done so image2pipe sees EOF.
	var cmdStdin io.WriteCloser
	if stdin != nil {
		cmdStdin, err = cmd.StdinPipe()
		if err != nil {
			return fmt.Errorf("capx: ffmpeg stdin pipe: %w", err)
		}
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("capx: start ffmpeg: %w", err)
	}
	if cmdStdin != nil {
		go func() {
			_, _ = io.Copy(cmdStdin, stdin)
			_ = cmdStdin.Close()
		}()
	}

	// Collect stderr in the background; only the tail matters for errors.
	errBuf := &strings.Builder{}
	go func() {
		sc := bufio.NewScanner(stderrPipe)
		sc.Buffer(make([]byte, 0, 64*1024), 64*1024)
		lines := make([]string, 0, 16)
		for sc.Scan() {
			lines = append(lines, sc.Text())
			if len(lines) > 12 {
				lines = lines[1:]
			}
		}
		errBuf.WriteString(strings.Join(lines, "\n"))
	}()

	if _, err := io.Copy(w, stdout); err != nil {
		// Copy errors can be downstream write failures; kill ffmpeg so the
		// wait below returns promptly.
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		return fmt.Errorf("capx: writing output: %w", err)
	}
	if err := cmd.Wait(); err != nil {
		if ctx.Err() != nil {
			return fmt.Errorf("capx: ffmpeg canceled: %w (stderr tail: %s)", ctx.Err(), errBuf.String())
		}
		return fmt.Errorf("capx: ffmpeg failed: %w (stderr tail: %s)", err, errBuf.String())
	}
	return nil
}
