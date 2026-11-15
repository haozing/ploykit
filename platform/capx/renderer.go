package capx

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/chromedp/chromedp"
	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/cdproto/page"
)

// Renderer is the single capture contract of the package (design §3.2): it
// turns a self-contained document plus a frame spec into a stream of PNG
// frames. The document is produced by the caller (the video domain's
// projection layer); capx owns only the browser mechanics.
//
// Implementations must be deterministic per the package contract: the frame
// at index i depends only on (doc.HTML, doc.TimelineID, i, spec) — same
// machine, same inputs, byte-identical PNGs.
type Renderer interface {
	// RenderFrames renders spec.DurationFrames frames of doc at
	// spec.Width x spec.Height, spec.FPS frames per second, calling onFrame
	// once per frame in index order (0 .. DurationFrames-1). An error from
	// onFrame aborts the render and is returned wrapped with the frame
	// number; a failed capture or seek likewise. Canceling ctx aborts the
	// loop between frames (in-flight protocol calls return on their own).
	RenderFrames(ctx context.Context, doc Doc, spec FrameSpec, onFrame FrameFunc) error
}

// Doc is one self-contained projected document.
type Doc struct {
	// HTML is the complete document (inline gsap + player + IR JSON). It is
	// injected with Page.setDocumentContent — no HTTP serving involved: no
	// auth, no network jitter, determinism by construction.
	HTML string
	// TimelineID is the composition id the projected player registered under
	// window.__timelines. RenderFrames seeks exactly that timeline.
	TimelineID string
}

// FrameSpec fixes the output geometry and timing.
type FrameSpec struct {
	// Width and Height are the output resolution; they become the browser
	// viewport exactly (deviceScaleFactor 1, no scrollbars).
	Width, Height int
	// FPS is the frames-per-second rate of the timeline seek grid.
	FPS int
	// DurationFrames is the total frame count (= ceil(duration * fps)).
	DurationFrames int
}

// Frame is one rendered frame handed to the FrameFunc callback.
type Frame struct {
	// Index is the 0-based frame number.
	Index int
	// Time is Index/FPS in seconds — the exact seek position used.
	Time float64
	// PNG is the captured screenshot bytes.
	PNG []byte
}

// FrameFunc consumes one frame. Returning an error aborts the render and the
// error is surfaced (wrapped with the frame number) by RenderFrames.
type FrameFunc func(ctx context.Context, f Frame) error

// Validate sanity-checks a spec for rendering or encoding.
func (s FrameSpec) Validate() error {
	switch {
	case s.Width <= 0 || s.Height <= 0:
		return errors.New("capx: FrameSpec.Width/Height must be positive")
	case s.FPS <= 0:
		return errors.New("capx: FrameSpec.FPS must be positive")
	case s.DurationFrames <= 0:
		return errors.New("capx: FrameSpec.DurationFrames must be positive")
	}
	return nil
}

// Renderer returns the Renderer view of the runtime (LocalChrome). On an
// inert runtime it returns ErrNotConfigured.
func (r *Runtime) Renderer() (Renderer, error) {
	if !r.Available() {
		return nil, ErrNotConfigured
	}
	return &LocalChromeRenderer{Runtime: r}, nil
}

// LocalChromeRenderer is the local headless-Chrome Renderer implementation
// over warm browser instances owned by its Runtime. Construct it via
// Runtime.Renderer (which enforces the gating contract); the exported type
// exists so the Renderer slot is a concrete, swappable value (the future
// RemoteHTTP implements the same interface).
type LocalChromeRenderer struct {
	Runtime *Runtime
}

// readyTimeout bounds the window.__player.ready wait. Generous by default:
// font/image decode of large projected documents can be slow on CI-class
// machines, and a false timeout is worse than a slow render.
const readyTimeout = 60 * time.Second

// RenderFrames implements the per-frame capture flow of design §3.3:
// fresh tab -> setDocumentContent -> wait player ready -> for each frame:
// pause(t) -> double rAF flush -> Page.captureScreenshot -> onFrame.
func (l *LocalChromeRenderer) RenderFrames(ctx context.Context, doc Doc, spec FrameSpec, onFrame FrameFunc) error {
	if !l.Runtime.Available() {
		return ErrNotConfigured
	}
	if err := spec.Validate(); err != nil {
		return err
	}
	if doc.HTML == "" {
		return errors.New("capx: Doc.HTML is empty")
	}
	if doc.TimelineID == "" {
		return errors.New("capx: Doc.TimelineID is empty")
	}

	inst, release, err := l.Runtime.acquire(ctx)
	if err != nil {
		return err
	}
	defer release()
	return inst.render(ctx, doc, spec, onFrame)
}

// render runs one whole render job on the instance: it allocates a fresh tab
// (so no state leaks between documents), configures it, runs the frame
// loop, and closes the tab on the way out.
func (inst *browserInstance) render(ctx context.Context, doc Doc, spec FrameSpec, onFrame FrameFunc) error {
	inst.mu.Lock()
	defer inst.mu.Unlock()

	tabCtx, tabCancel := chromedp.NewContext(inst.ctx)
	defer tabCancel()

	// Eagerly create the target so configuration failures surface here
	// rather than mid-loop, and configure viewport + network lock in the
	// same protocol session.
	cdpCtx := chromedp.FromContext(tabCtx)
	if _, err := chromedp.Run(tabCtx, chromedp.EmulateViewport(int64(spec.Width), int64(spec.Height))); err != nil {
		return fmt.Errorf("capx: viewport: %w", err)
	}
	// Network lock: block every scheme/host/port/path so any accidental
	// remote reference in a projected document is a hard failure instead of
	// a nondeterministic fetch (design §4.4.5). Patterns use the URLPattern
	// constructor syntax, which requires an explicit scheme.
	if _, err := cdp.Call(tabCtx, cdpCtx.Target, network.SetBlockedURLs, network.SetBlockedURLsParams{
		URLPatterns: []*network.BlockPattern{{
			URLPattern: "*://*:*/*",
			Block:      true,
		}},
	}); err != nil {
		return fmt.Errorf("capx: network lock: %w", err)
	}

	// setDocumentContent: the projected document enters the page without
	// any network round trip.
	tree, err := cdp.Call(tabCtx, cdpCtx.Target, page.GetFrameTree, cdp.Empty{})
	if err != nil {
		return fmt.Errorf("capx: frame tree: %w", err)
	}
	if _, err := cdp.Call(tabCtx, cdpCtx.Target, page.SetDocumentContent, page.SetDocumentContentParams{
		FrameID: tree.FrameTree.Frame.ID,
		HTML:    doc.HTML,
	}); err != nil {
		return fmt.Errorf("capx: set document: %w", err)
	}

	// Wait for the player's readiness signal (document.fonts.ready +
	// img.decode() all settled, per the projection contract).
	if err := awaitReady(tabCtx, readyTimeout); err != nil {
		return err
	}

	for i := 0; i < spec.DurationFrames; i++ {
		// Cancellation breaks the loop between frames.
		if err := tabCtx.Err(); err != nil {
			return fmt.Errorf("capx: render canceled at frame %d: %w", i, err)
		}
		tSec := float64(i) / float64(spec.FPS)
		if err := seekTimeline(tabCtx, doc.TimelineID, tSec); err != nil {
			return fmt.Errorf("capx: frame %d: %w", i, err)
		}
		res, err := cdp.Call(tabCtx, cdpCtx.Target, page.CaptureScreenshot, page.CaptureScreenshotParams{
			Format:      page.CaptureScreenshotFormatPng,
			FromSurface: boolPtr(true),
		})
		if err != nil {
			return fmt.Errorf("capx: frame %d: capture: %w", i, err)
		}
		if len(res.Data) == 0 {
			return fmt.Errorf("capx: frame %d: capture returned empty PNG", i)
		}
		if err := onFrame(ctx, Frame{Index: i, Time: tSec, PNG: res.Data}); err != nil {
			return fmt.Errorf("capx: frame %d: onFrame: %w", i, err)
		}
	}
	return nil
}

// awaitReady polls window.__player.ready === true until it flips or the
// timeout expires. The projected player sets it after document.fonts.ready
// and every img.decode() resolved (determinism checklist §3.3).
func awaitReady(ctx context.Context, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for {
		ready, err := chromedp.Run(ctx,
			chromedp.Evaluate[bool]("window.__player && window.__player.ready === true"))
		if err == nil && ready {
			return nil
		}
		if time.Now().After(deadline) {
			if err != nil {
				return fmt.Errorf("capx: player ready probe failed: %w", err)
			}
			return fmt.Errorf("capx: player did not become ready within %s (broken or missing player script?)", timeout)
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("capx: render canceled while waiting for player ready: %w", ctx.Err())
		case <-time.After(50 * time.Millisecond):
		}
	}
}

// seekTimeline pauses the registered timeline at tSec seconds and flushes
// exactly two requestAnimationFrame ticks, as one awaited promise. The double
// rAF guarantees the compositor has presented the seeked state before the
// screenshot (design §3.3).
func seekTimeline(ctx context.Context, timelineID string, tSec float64) error {
	expr := `(function(){
  var tl = window.__timelines && window.__timelines["` + jsEscape(timelineID) + `"];
  if (!tl) { throw new Error("timeline not registered under window.__timelines"); }
  tl.pause(` + strconv.FormatFloat(tSec, 'f', -1, 64) + `);
  return new Promise(function(resolve){
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){ resolve(true); });
    });
  });
})()`
	if _, err := chromedp.Run(ctx,
		chromedp.Evaluate[bool](expr, chromedp.EvalAwaitPromise)); err != nil {
		return fmt.Errorf("capx: seek %q@%.4fs: %w", timelineID, tSec, err)
	}
	return nil
}

// jsEscape makes a Go string safe inside a double-quoted JS string literal.
// The projected TimelineID is caller-supplied; this keeps the generated
// expression well-formed for any id.
func jsEscape(s string) string {
	buf := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch c {
		case '"':
			buf = append(buf, '\\', '"')
		case '\\':
			buf = append(buf, '\\', '\\')
		case '\n':
			buf = append(buf, '\\', 'n')
		case '\r':
			buf = append(buf, '\\', 'r')
		case '\t':
			buf = append(buf, '\\', 't')
		default:
			buf = append(buf, c)
		}
	}
	return string(buf)
}

func boolPtr(b bool) *bool { return &b }
