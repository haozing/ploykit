package capx_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"testing"

	"github.com/haozing/ploykit/platform/capx"
)

// testDoc returns the minimal self-contained projected document used by the
// opt-in render tests. It implements the player contract by hand: a stub
// window.__player that signals ready immediately, and window.__timelines
// holding one fake timeline whose pause(t) just records the seek time into
// the DOM (so each frame's pixels provably differ when the seek differs).
//
// The color at frame i is derived from i, which makes the determinism check
// meaningful: byte-identical PNGs across two runs require the whole pipeline
// (seek, rAF flush, screenshot) to be stable.
func testDoc(timelineID string) string {
	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; overflow: hidden; }
  #stage { width: 100vw; height: 100vh; }
  /* Contract: no CSS animations/transitions — all motion is timeline-driven. */
</style>
</head>
<body>
<div id="stage"><div id="seek-label"></div></div>
<script>
  (function () {
    var seeks = [];
    window.__player = { ready: true }; // stub player: ready immediately
    window.__timelines = {};
    window.__timelines[` + quoteJS(timelineID) + `] = {
      pause: function (t) {
        seeks.push(t);
        var i = Math.round(t * 10); // fps=10 in tests
        document.getElementById('stage').style.backgroundColor =
          'rgb(' + (i * 7 % 256) + ',' + (i * 13 % 256) + ',' + (i * 29 % 256) + ')';
        document.getElementById('seek-label').textContent = String(i);
      }
    };
  })();
</script>
</body>
</html>`
}

// quoteJS renders a Go string as a JS string literal for the test document.
func quoteJS(s string) string {
	return `"` + s + `"`
}

func newChromeRuntime(t *testing.T) *capx.Runtime {
	t.Helper()
	r, err := capx.New(capx.Config{
		Enabled:    boolPtr(true),
		ChromePath: chromeTestPath(t),
		FFMpegPath: ffmpegTestPath(t),
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })
	return r
}

func TestRenderFrames_ThreeFrames(t *testing.T) {
	r := newChromeRuntime(t)
	rend, err := r.Renderer()
	if err != nil {
		t.Fatalf("Renderer: %v", err)
	}

	spec := capx.FrameSpec{Width: 320, Height: 180, FPS: 10, DurationFrames: 3}
	got := []capx.Frame{}
	err = rend.RenderFrames(t.Context(), capx.Doc{HTML: testDoc("main"), TimelineID: "main"}, spec,
		func(ctx context.Context, f capx.Frame) error {
			got = append(got, f)
			return nil
		})
	if err != nil {
		t.Fatalf("RenderFrames: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("got %d frames, want 3", len(got))
	}
	for i, f := range got {
		if f.Index != i {
			t.Errorf("frame %d: Index = %d", i, f.Index)
		}
		wantTime := float64(i) / float64(spec.FPS)
		if f.Time != wantTime {
			t.Errorf("frame %d: Time = %v, want %v", i, f.Time, wantTime)
		}
		if len(f.PNG) == 0 {
			t.Errorf("frame %d: empty PNG", i)
		}
		if !bytes.HasPrefix(f.PNG, []byte{0x89, 'P', 'N', 'G'}) {
			t.Errorf("frame %d: not a PNG payload", i)
		}
	}
}

func TestRenderFrames_Deterministic(t *testing.T) {
	r := newChromeRuntime(t)
	rend, err := r.Renderer()
	if err != nil {
		t.Fatalf("Renderer: %v", err)
	}
	spec := capx.FrameSpec{Width: 320, Height: 180, FPS: 10, DurationFrames: 3}
	doc := capx.Doc{HTML: testDoc("main"), TimelineID: "main"}

	digests := func() []string {
		out := []string{}
		err := rend.RenderFrames(t.Context(), doc, spec, func(ctx context.Context, f capx.Frame) error {
			sum := sha256.Sum256(f.PNG)
			out = append(out, hex.EncodeToString(sum[:]))
			return nil
		})
		if err != nil {
			t.Fatalf("RenderFrames: %v", err)
		}
		return out
	}

	first := digests()
	second := digests()
	for i := range first {
		if first[i] != second[i] {
			t.Errorf("frame %d not deterministic: %s vs %s", i, first[i], second[i])
		}
	}
}

func TestRenderFrames_OnFrameErrorAborts(t *testing.T) {
	r := newChromeRuntime(t)
	rend, err := r.Renderer()
	if err != nil {
		t.Fatalf("Renderer: %v", err)
	}
	spec := capx.FrameSpec{Width: 160, Height: 120, FPS: 10, DurationFrames: 5}
	called := 0
	err = rend.RenderFrames(t.Context(), capx.Doc{HTML: testDoc("main"), TimelineID: "main"}, spec,
		func(ctx context.Context, f capx.Frame) error {
			called++
			if f.Index == 2 {
				return fmt.Errorf("boom")
			}
			return nil
		})
	if err == nil {
		t.Fatal("expected abort error from onFrame")
	}
	if called != 3 {
		t.Errorf("onFrame called %d times, want 3 (frames 0,1,2)", called)
	}
	if !bytes.Contains([]byte(err.Error()), []byte("frame 2")) {
		t.Errorf("abort error must name the frame: %v", err)
	}
}

func TestRenderFrames_UnknownTimelineFails(t *testing.T) {
	r := newChromeRuntime(t)
	rend, err := r.Renderer()
	if err != nil {
		t.Fatalf("Renderer: %v", err)
	}
	spec := capx.FrameSpec{Width: 160, Height: 120, FPS: 10, DurationFrames: 1}
	err = rend.RenderFrames(t.Context(), capx.Doc{HTML: testDoc("main"), TimelineID: "nope"}, spec,
		func(ctx context.Context, f capx.Frame) error { return nil })
	if err == nil {
		t.Fatal("expected error for unregistered timeline")
	}
}

func TestRenderFrames_InvalidSpec(t *testing.T) {
	r := newChromeRuntime(t)
	rend, err := r.Renderer()
	if err != nil {
		t.Fatalf("Renderer: %v", err)
	}
	err = rend.RenderFrames(t.Context(), capx.Doc{HTML: testDoc("main"), TimelineID: "main"},
		capx.FrameSpec{Width: 0, Height: 0, FPS: 10, DurationFrames: 1},
		func(ctx context.Context, f capx.Frame) error { return nil })
	if err == nil {
		t.Fatal("expected validation error for zero-size spec")
	}
}
