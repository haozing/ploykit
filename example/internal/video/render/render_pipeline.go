//go:build capx

// capxPipeline is the full render pipeline (§4.9.2 steps 3-7), compiled only
// under the "capx" build tag. It imports platform/capx — the ONLY place in
// this domain allowed to — keeping the default build free of the chromedp
// dependency tree.
//
// Steps:
//  3. asset preload: image keys → data URIs (no network in the document,
//     §4.4.5); voice/bgm keys → temp files for ffmpeg (defer cleanup)
//  4. projector.HTML (data-URI resolver) → capx Renderer.RenderFrames (each
//     PNG frame is streamed straight into the encoder; every N frames the
//     worker persists progress + pushes the WS frame)
//  5. subtitles: videoapp.SRT(words); burn|soft|none per params (missing
//     libass degrades soft on the capx side with ErrNoLibass)
//  6. mux: voice + bgm (volume from IR/params override)
//  7. storage put output.mp4 (+ first-frame thumb.jpg), snapshot determinism:
//     same ir_snapshot + params ⇒ same bytes.
package render

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/haozing/ploykit/platform/capx"
	"github.com/haozing/ploykit/platform/storagex"

	videoapp "myproduct/internal/video/app"
)

// capxPipeline drives one render through capx + ffmpeg.
type capxPipeline struct{}

func pickPipeline(deps WorkerDeps) pipeline { return capxPipeline{} }

// CapxRuntime is the assembled capability injected at wiring time (capx.New).
// An inert runtime (Enabled nil/false) fails renders with capx's
// ErrNotConfigured — consistent with the CapAvailable gate at submit.
var CapxRuntime *capx.Runtime

func (capxPipeline) Run(ctx context.Context, w *Worker, row renderRow, ir *videoapp.IR,
	params videoapp.RenderParams, onFrame func(frame int)) (string, string, error) {

	if CapxRuntime == nil {
		return "", "", ErrNotConfigured
	}
	if w.deps.Store == nil {
		return "", "", fmt.Errorf("video render: storage not wired")
	}
	renderer, err := CapxRuntime.Renderer()
	if err != nil {
		return "", "", err
	}

	// 3. asset preload — images inline as data URIs, audio to temp files.
	resolver := videoapp.DataURIResolver{
		Loader: func(ctx context.Context, key string) (io.ReadCloser, storagex.Object, error) {
			return w.deps.Store.Open(ctx, key)
		},
	}
	proj := videoapp.NewProjector(resolver)
	html, err := proj.HTML(ctx, ir, "")
	if err != nil {
		return "", "", fmt.Errorf("project: %w", err)
	}

	fps := params.FPS
	if fps == 0 {
		fps = ir.Meta.FPS
	}
	// Single-source frame formula (delivery audit P8): the same
	// ceil(max(meta, voice) x fps) the service persists with; the row value
	// normally wins and this is only the fallback.
	total := row.FramesTotal
	if total <= 0 {
		total = videoapp.DurationFrames(ir, fps)
	}
	spec := capx.FrameSpec{
		Width: params.Width, Height: params.Height, FPS: fps, DurationFrames: total,
	}
	if err := spec.Validate(); err != nil {
		return "", "", fmt.Errorf("frame spec: %w", err)
	}

	// 4-7. frames → ffmpeg stdin (image2pipe), progress per N frames; the
	// capture loop and EncodePNGStream are coupled through an os.Pipe.
	return w.encodeAndUpload(ctx, row, ir, params, spec, pngSource{html: html, renderer: renderer}, onFrame)
}

// pngSource bundles what the coupled capture→encode step needs.
type pngSource struct {
	html     []byte
	renderer capx.Renderer
}

// encodeAndUpload runs the capture loop with its stdin plumbed into
// EncodePNGStream, then subtitles → mux → storage put.
func (w *Worker) encodeAndUpload(ctx context.Context, row renderRow, ir *videoapp.IR,
	params videoapp.RenderParams, spec capx.FrameSpec, src pngSource, onFrame func(frame int)) (string, string, error) {

	// 5. subtitles sidecar (burn/soft need an .srt on disk for ffmpeg).
	srtPath := ""
	if params.SubtitleMode == "burn" || params.SubtitleMode == "soft" {
		srt := videoapp.SRT(ir.Words)
		if srt != "" {
			f, err := os.CreateTemp(w.deps.TmpDir, "video-srt-*.srt")
			if err == nil {
				_, werr := f.WriteString(srt)
				f.Close()
				if werr == nil {
					srtPath = f.Name()
				}
			}
			if srtPath != "" {
				defer os.Remove(srtPath)
			}
		}
	}

	// audio temp files (voice/bgm), cleaned when the pipeline returns.
	//
	// FAIL-CLOSED: an audio track declared in the IR that cannot be loaded is
	// a hard error, not a silent downgrade. The old code discarded the error
	// and rendered a successful MP4 with no voice/BGM while charging quota
	// (delivery audit P1: "无声出片当成功"). Image assets already fail closed
	// in the projector; audio now matches.
	voicePath, bgmPath := "", ""
	voiceVolume, bgmVolume := videoapp.ResolveAudioVolumes(ir)
	if ir.Audio != nil {
		if ir.Audio.Voice != nil && ir.Audio.Voice.Key != "" {
			f, ferr := w.tempFile(ctx, ir.Audio.Voice.Key)
			if ferr != nil {
				return "", "", fmt.Errorf("stage audio voice %q: %w", ir.Audio.Voice.Key, ferr)
			}
			voicePath = f
			defer os.Remove(f)
		}
		if ir.Audio.BGM != nil && ir.Audio.BGM.Key != "" {
			f, ferr := w.tempFile(ctx, ir.Audio.BGM.Key)
			if ferr != nil {
				return "", "", fmt.Errorf("stage audio bgm %q: %w", ir.Audio.BGM.Key, ferr)
			}
			bgmPath = f
			defer os.Remove(f)
		}
	}
	if params.BGMVolume > 0 {
		bgmVolume = params.BGMVolume
	}

	workDir := w.deps.TmpDir
	videoPath := filepath.Join(workDir, fmt.Sprintf("video-frames-%s.mp4", row.ID))
	defer os.Remove(videoPath)
	videoOut, err := os.Create(videoPath)
	if err != nil {
		return "", "", fmt.Errorf("stage video create: %w", err)
	}

	// capture → encoder via os.Pipe: RenderFrames writes length-prefixed PNG
	// frames (capx.NewFrameWriter), the encoder goroutine drains them into the
	// h264 file (EncodePNGStream consumes the framed reader).
	pr, pw, err := os.Pipe()
	if err != nil {
		return "", "", fmt.Errorf("pipe: %w", err)
	}
	fw := capx.NewFrameWriter(pw)
	encodeDone := make(chan error, 1)
	go func() {
		// river only recovers panics inside its own executor goroutine, so a
		// panic here would kill the whole API+worker process (taking every
		// in-flight render, WS session and lease with it). Convert it to an
		// error instead.
		defer func() {
			if rec := recover(); rec != nil {
				pr.Close()
				videoOut.Close()
				encodeDone <- fmt.Errorf("encoder panic: %v", rec)
			}
		}()
		err := CapxRuntime.EncodePNGStream(ctx, videoOut, spec, pr, capx.EncodeOptions{})
		pr.Close()
		videoOut.Close()
		encodeDone <- err
	}()

	renderErr := src.renderer.RenderFrames(ctx,
		capx.Doc{HTML: string(src.html), TimelineID: "main"}, spec,
		func(_ context.Context, f capx.Frame) error {
			if err := fw.WriteFrame(f.PNG); err != nil {
				return err
			}
			onFrame(f.Index + 1)
			return nil
		})
	if cErr := pw.Close(); cErr != nil && renderErr == nil {
		renderErr = cErr
	}
	if rerr := <-encodeDone; rerr != nil && renderErr == nil {
		renderErr = fmt.Errorf("encode: %w", rerr)
	}
	if renderErr != nil {
		if renderErr.Error() != ErrNotConfigured.Error() {
			renderErr = fmt.Errorf("render frames: %w", renderErr)
		}
		return "", "", renderErr
	}
	videoOut.Close()

	// 6. mux voice/bgm when present.
	finalPath := videoPath
	if voicePath != "" || bgmPath != "" {
		muxPath := filepath.Join(workDir, fmt.Sprintf("video-mux-%s.mp4", row.ID))
		mf, err := os.Create(muxPath)
		if err != nil {
			return "", "", err
		}
		if merr := CapxRuntime.MuxAV(ctx, mf, videoPath, voicePath, bgmPath, voiceVolume, bgmVolume); merr != nil {
			mf.Close()
			return "", "", fmt.Errorf("mux: %w", merr)
		}
		mf.Close()
		defer os.Remove(muxPath)
		finalPath = muxPath
	}

	// 5b. subtitles: burn (libass) or soft (mov_text track). ErrNoLibass on
	// the burn path degrades to soft automatically so a deployment without
	// libass delivers soft-subtitled video instead of failing every burn
	// render (design §3.4 / F-C06-01). The degradation fact is returned as a
	// non-fatal note for the worker to surface via logs + WS state.
	origFinal := finalPath
	finalPath, subNote, err := w.finishSubtitles(ctx, row, params, workDir, finalPath, srtPath)
	if err != nil {
		return "", "", err
	}
	if finalPath != origFinal {
		// finishSubtitles produced a new stage file; the pipeline owns its
		// lifetime (removed after the storage put below returns).
		defer os.Remove(finalPath)
	}

	// 7. storage put output.mp4 + first-frame thumb.jpg.
	vf, err := os.Open(finalPath)
	if err != nil {
		return "", "", err
	}
	defer vf.Close()
	outputKey := fmt.Sprintf("video/%s/renders/%s/output.mp4", row.WorkspaceID, row.ID)
	if _, err := w.deps.Store.Put(ctx, outputKey, "video/mp4", vf); err != nil {
		return "", "", fmt.Errorf("put output: %w", err)
	}
	if subNote != "" {
		// Degradation facts are log/WS-level notes only: the succeeded row's
		// error column stays empty (its semantics remain "failure detail" —
		// the UI renders error only on failed/interrupted rows).
		w.deps.Log.Warn("video render: subtitle degraded, delivered as soft subs",
			"render_id", row.ID, "note", subNote)
	}

	thumbKey := fmt.Sprintf("video/%s/renders/%s/thumb.png", row.WorkspaceID, row.ID)
	if thumb, terr := firstThumb(ctx, w, finalPath); terr == nil && thumb != nil {
		if _, err := w.deps.Store.Put(ctx, thumbKey, "image/png", bytes.NewReader(thumb)); err != nil {
			w.deps.Log.Warn("thumb put failed (non-fatal)", "render_id", row.ID, "err", err)
		}
	}
	return outputKey, subNote, nil
}

// finishSubtitles applies the subtitle stage to finalPath (steps 5b). burn
// re-encodes with libass; soft embeds a mov_text track over a stream copy.
// burn falling back to soft on ErrNoLibass is the documented degradation
// (F-C06-01): the returned note ("" = no degradation) flows to the worker for
// logging/WS, so the fact is observable without abusing the error column.
// The returned file is the caller's to remove — this function only cleans up
// its own intermediates (the burned output abandoned by a degrade).
func (w *Worker) finishSubtitles(ctx context.Context, row renderRow, params videoapp.RenderParams,
	workDir, finalPath, srtPath string) (path, note string, err error) {

	if srtPath == "" || (params.SubtitleMode != "burn" && params.SubtitleMode != "soft") {
		return finalPath, "", nil
	}
	// burn first (the requested mode), degrading to soft only on ErrNoLibass.
	if params.SubtitleMode == "burn" {
		burnPath := filepath.Join(workDir, fmt.Sprintf("video-burn-%s.mp4", row.ID))
		bf, ferr := os.Create(burnPath)
		if ferr != nil {
			return "", "", ferr
		}
		berr := CapxRuntime.BurnSubtitles(ctx, finalPath, srtPath, bf)
		bf.Close()
		if berr == nil {
			return burnPath, "", nil
		}
		if !errors.Is(berr, capx.ErrNoLibass) {
			os.Remove(burnPath)
			return "", "", fmt.Errorf("burn subtitles: %w", berr)
		}
		// No libass on this deployment: degrade to soft (mov_text) so the
		// render still delivers captions instead of failing terminally. The
		// abandoned burned output (empty or partial) is an intermediate here.
		defer os.Remove(burnPath)
		note = "subtitle degraded: burn→soft (no libass)"
	}
	softPath := filepath.Join(workDir, fmt.Sprintf("video-soft-%s.mp4", row.ID))
	sf, ferr := os.Create(softPath)
	if ferr != nil {
		return "", "", ferr
	}
	serr := CapxRuntime.SoftSubtitles(ctx, finalPath, srtPath, sf)
	sf.Close()
	if serr != nil {
		os.Remove(softPath)
		return "", "", fmt.Errorf("soft subtitles: %w", serr)
	}
	return softPath, note, nil
}

// tempFile materializes one storage object into the worker temp dir.
func (w *Worker) tempFile(ctx context.Context, key string) (string, error) {
	body, _, err := w.deps.Store.Open(ctx, key)
	if err != nil {
		return "", err
	}
	defer body.Close()
	f, err := os.CreateTemp(w.deps.TmpDir, "video-audio-*")
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(f, body); err != nil {
		f.Close()
		return "", err
	}
	return f.Name(), f.Close()
}

// firstThumb extracts the deliverable's first frame (sec 0) as PNG via the
// parameterized capx.ExtractFrameAt — the encoded frame, not a re-render,
// so the thumb is pixel-faithful to what the player will show (burned subs
// included when mode=burn). deriveURLs promises /thumb.png next to
// output.mp4; the stub-era jpg name never landed, so the key aligns with
// deriveURLs and the promise stops being a permanent 404. Best-effort: a
// failed extraction is a logged warning (the render stays succeeded), the
// caller treats nil as "no thumb".
func firstThumb(ctx context.Context, w *Worker, finalPath string) ([]byte, error) {
	return runtimeFrameExtractor{rt: CapxRuntime}.ExtractFrame(ctx, finalPath, 0)
}

func copyFile(dst string, r io.Reader) error {
	f, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, r); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

// SetCapxRuntime assigns the pipeline's runtime from the composition root
// (main.go). Named setter rather than a direct var write so the call site
// is tag-portable: the default build's stub declares the same signature.
func SetCapxRuntime(rt *capx.Runtime) { CapxRuntime = rt }
