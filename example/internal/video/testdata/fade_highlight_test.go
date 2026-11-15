//go:build capx

// T-12 complete-form highlight (text color) + P0-2 element-level fade
// animations — L2 pixel proof (case library §5.12 T-12 proposal, §5.16 P0-2,
// §3.1.4 C01 "逐词高亮" expectation vs current state; delivery round at
// docs/delivery-audit-video-studio-round2-2026-11-15.md).
//
// Two compositions through the real encode chain (Projector.HTML → capx
// RenderFrames → EncodePNGStream → MP4 → ffmpeg frame extraction), one MP4
// per case:
//
//  1. TEXT-HIGHLIGHT (T-12): a dark title text element on a light card;
//     highlight {color:#FFD166} bound to it, anchor word window 1s→3s.
//     Three-point element-region assertion: F-pre (1.0s) = original text
//     color, F-mid (2.0s) = the highlight color, F-post (4.0s) = settled
//     back to the original. A second composition inverts the polarity
//     (light text on a dark card) to prove the tween is polarity-agnostic.
//     Granularity boundary (recorded): the builder paints one text element
//     as ONE node — no per-word spans — so the WHOLE element colors. C01's
//     acceptance semantics hold (three highlights each on a separate card
//     title element); true word-level spans are the T-01 upgrade.
//
//  2. FADE (P0-2): one element entering via fadeIn (startAnchor t=1s,
//     duration 2s) and one exiting via fadeOut (startAnchor t=3s, duration
//     1s) over a solid background. Element-region assertions: before the
//     fadeIn the region equals the background (transparent), mid-fade it is
//     a blend (strictly between the two means), after it the full element
//     color; the fadeOut region mirrors that in reverse. Also proves the
//     P0-1 coordination rule on the fadeIn element: a startFrame time
//     window (element loop sets visibility:hidden pre-window) composed
//     with the fadeIn anchored AT the window start — orthogonal axes, the
//     visible result is exactly the fadeIn curve.
//
// Artifacts (§7.0 retention):
//   testdata/fade-highlight/TEXT-HIGHLIGHT/{output.mp4,frame-*.png}
//   testdata/fade-highlight/TEXT-HIGHLIGHT-DARK/{output.mp4,frame-*.png}
//   testdata/fade-highlight/FADE/{output.mp4,frame-*.png}
//
// Run:
//
//	go test -tags capx ./internal/video/testdata -run TestFadeHighlight -v -timeout 30m
//
// Skips itself when Chrome or ffmpeg is not found (CI without tools).
package l1

import (
	"context"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/haozing/ploykit/platform/capx"

	videoapp "myproduct/internal/video/app"
)

// ---- shared geometry / palette (1920x1080@30, 5s, deterministic colors) ----

const (
	fhW, fhH, fhFPS = 1920, 1080, 30
	fhSeconds       = 5.0
	fhBG            = "#FFF7EE" // cream card (light-polarity background)
	fhBGDark        = "#0F1C2E" // navy card (dark-polarity background)
	fhTextColor     = "#2B2118" // dark ink (light-polarity text)
	fhTextLight     = "#FFFFFF" // white (dark-polarity text)
	fhHighlight     = "#FFD166" // C01's documented highlight color
	fhFadeEl        = "#4DA3FF" // fade element fill

	// thresholds: share of the region within tol of a target color
	fhShareMin = 0.10 // "region is dominated by color X"
	fhShareMax = 0.02 // "region is ~free of color X"
	fhBlendGap = 8.0  // channel-mean gap the mid-fade frame must clear
)

// text element region — the text spans (X,Y,W,H)=(150,380,700,140) in the
// light case; mirrored in the dark case. Region = the element bbox inset a
// little so AA edges of the bbox don't dilute the share.
var (
	fhTextRect     = [4]int{170, 400, 660, 100}
	fhTextRectWide = [4]int{140, 370, 720, 160} // + AA margin for exclusion math

	// fade element regions (fadeIn left, fadeOut right; disjoint)
	fhFadeInRect  = [4]int{200, 600, 240, 200}
	fhFadeOutRect = [4]int{1480, 600, 240, 200}
)

// word table (manual timestamps, source=manual): the highlight anchor sits on
// word "爆款" 1s→3s — a wide window so the three probe frames are unambiguous.
func fhWords() []videoapp.Word {
	return []videoapp.Word{
		{Index: 0, Text: "新品", Start: 0.0, End: 1.0, Source: videoapp.WordSourceManual},
		{Index: 1, Text: "爆款", Start: 1.0, End: 3.0, Source: videoapp.WordSourceManual},
		{Index: 2, Text: "收官", Start: 3.0, End: 5.0, Source: videoapp.WordSourceManual},
	}
}

func fhBaseIR(bg string) *videoapp.IR {
	return &videoapp.IR{
		SchemaVersion: videoapp.IRSchemaVersion,
		Meta: videoapp.Meta{
			FPS: fhFPS, Width: fhW, Height: fhH, DurationSec: fhSeconds,
		},
		Script: "新品 爆款 收官",
		Words:  fhWords(),
		Elements: []videoapp.Element{
			{ID: "bg", Type: videoapp.ElementShape, Color: bg,
				X: 0, Y: 0, W: fhW, H: fhH, Z: 0},
		},
	}
}

// fhTextHighlightIR: light polarity — dark text on a cream card.
func fhTextHighlightIR(t *testing.T) *videoapp.IR {
	t.Helper()
	ir := fhBaseIR(fhBG)
	ir.Elements = append(ir.Elements,
		videoapp.Element{ID: "title", Type: videoapp.ElementText, Text: "爆款推荐",
			Color: fhTextColor, FontSize: 96,
			X: 150, Y: 380, W: 700, H: 140, Z: 3})
	ir.Effects = []videoapp.Effect{{
		ID:              "fx_hl_text",
		Anchor:          videoapp.Anchor{Text: "爆款", Occurrence: 0},
		Type:            videoapp.EffectHighlight,
		TargetElementID: "title",
		Params:          []byte(`{"color":"` + fhHighlight + `"}`),
	}}
	fhResolveHL(t, ir)
	return ir
}

// fhTextHighlightDarkIR: dark polarity — white text on a navy card.
func fhTextHighlightDarkIR(t *testing.T) *videoapp.IR {
	t.Helper()
	ir := fhBaseIR(fhBGDark)
	ir.Elements = append(ir.Elements,
		videoapp.Element{ID: "title", Type: videoapp.ElementText, Text: "爆款推荐",
			Color: fhTextLight, FontSize: 96,
			X: 150, Y: 380, W: 700, H: 140, Z: 3})
	ir.Effects = []videoapp.Effect{{
		ID:              "fx_hl_text",
		Anchor:          videoapp.Anchor{Text: "爆款", Occurrence: 0},
		Type:            videoapp.EffectHighlight,
		TargetElementID: "title",
		Params:          []byte(`{"color":"` + fhHighlight + `"}`),
	}}
	fhResolveHL(t, ir)
	return ir
}

// fhFadeIR: P0-2 — fadeIn element (window-composed) + fadeOut element.
func fhFadeIR(t *testing.T) *videoapp.IR {
	t.Helper()
	ir := fhBaseIR(fhBG)
	ir.Elements = append(ir.Elements,
		// fadeIn + P0-1 window starting at the same frame (t=1s → frame 30):
		// the documented combination — window owns visibility, fadeIn owns
		// opacity, orthogonal axes.
		videoapp.Element{ID: "el_in", Type: videoapp.ElementShape, Color: fhFadeEl,
			X: 200, Y: 600, W: 240, H: 200, Z: 3,
			StartFrame: fhIntPtr(30),
			Animations: []videoapp.ElementAnimation{{
				ID: "an_fadein", Type: "fadeIn", DurationFrames: 2 * fhFPS,
				StartAnchor: &videoapp.Anchor{Text: "爆款", Occurrence: 0},
				ResolvedFrom: &videoapp.ResolvedFrom{WordIndex: 1, Reason: videoapp.AnchorExact},
			}}},
		videoapp.Element{ID: "el_out", Type: videoapp.ElementShape, Color: fhFadeEl,
			X: 1480, Y: 600, W: 240, H: 200, Z: 3,
			Animations: []videoapp.ElementAnimation{{
				ID: "an_fadeout", Type: "fadeOut", DurationFrames: 1 * fhFPS,
				StartAnchor: &videoapp.Anchor{Text: "收官", Occurrence: 0},
				ResolvedFrom: &videoapp.ResolvedFrom{WordIndex: 2, Reason: videoapp.AnchorExact},
			}}},
	)
	// the fade IR carries no effects — anchors resolve through the animations'
	// fixed ResolvedFrom values above (write-time resolution is the service's
	// job; here the fixture pins them directly).
	return ir
}

func fhIntPtr(i int) *int { return &i }

// fhResolveHL resolves the highlight anchor exactly the way production does.
func fhResolveHL(t *testing.T, ir *videoapp.IR) {
	t.Helper()
	fx := &ir.Effects[0]
	idx, reason, ok := videoapp.ResolveAnchors(fx.Anchor, ir.Words, -1)
	if !ok || idx != 1 || reason != videoapp.AnchorExact {
		t.Fatalf("anchor %q did not resolve to word 1/exact: idx=%d reason=%s ok=%v",
			fx.Anchor.Text, idx, reason, ok)
	}
	fx.ResolvedFrom = &videoapp.ResolvedFrom{WordIndex: idx, Reason: reason}
}

// ---- pixel analysis (local helpers; x4's are file-local to x4_effects_test.go) ----

// fhNearShare = share of pixels in rect within tol of the target RGB.
func fhNearShare(img image.Image, rect [4]int, tr, tg, tb uint8, tol int) float64 {
	x0, y0 := rect[0], rect[1]
	x1, y1 := rect[0]+rect[2], rect[1]+rect[3]
	var n, hit int
	for y := y0; y < y1; y++ {
		for x := x0; x < x1; x++ {
			r, g, b, _ := img.At(x, y).RGBA()
			n++
			r8, g8, b8 := int(r>>8), int(g>>8), int(b>>8)
			d := 0
			if dr := r8 - int(tr); dr < 0 {
				d -= dr
			} else {
				d += dr
			}
			if dg := g8 - int(tg); dg < 0 {
				d -= dg
			} else {
				d += dg
			}
			if db := b8 - int(tb); db < 0 {
				d -= db
			} else {
				d += db
			}
			if d <= tol {
				hit++
			}
		}
	}
	if n == 0 {
		return 0
	}
	return float64(hit) / float64(n)
}

// fhMeanMean = mean of per-pixel channel means over a rect (0-255).
func fhMeanMean(img image.Image, rect [4]int) float64 {
	x0, y0 := rect[0], rect[1]
	x1, y1 := rect[0]+rect[2], rect[1]+rect[3]
	var sum, n int64
	for y := y0; y < y1; y++ {
		for x := x0; x < x1; x++ {
			r, g, b, _ := img.At(x, y).RGBA()
			sum += int64(int(r>>8)+int(g>>8)+int(b>>8)) / 3
			n++
		}
	}
	if n == 0 {
		return 0
	}
	return float64(sum) / float64(n)
}

func fhHex(h string) (uint8, uint8, uint8) {
	var r, g, b int
	fmt.Sscanf(h, "#%02x%02x%02x", &r, &g, &b)
	return uint8(r), uint8(g), uint8(b)
}

func fhDecode(t *testing.T, path string) image.Image {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatalf("open %s: %v", path, err)
	}
	defer f.Close()
	img, err := png.Decode(f)
	if err != nil {
		t.Fatalf("decode %s: %v", path, err)
	}
	return img
}

// ---- the test ----

func TestFadeHighlight(t *testing.T) {
	chrome := chromePath(t)
	ffmpeg := ffmpegPath(t)
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

	_, thisFile, _, _ := runtime.Caller(0)
	baseDir := filepath.Join(filepath.Dir(thisFile), "fade-highlight")
	if err := os.MkdirAll(baseDir, 0o755); err != nil {
		t.Fatal(err)
	}

	hR, hG, hB := fhHex(fhHighlight)
	txR, txG, txB := fhHex(fhTextColor)
	ltR, ltG, ltB := fhHex(fhTextLight)
	bgR, bgG, bgB := fhHex(fhBG)
	elR, elG, elB := fhHex(fhFadeEl)

	cases := []struct {
		id   string
		ir   func(*testing.T) *videoapp.IR
		post func(*testing.T, map[string]image.Image)
	}{
		{"TEXT-HIGHLIGHT", fhTextHighlightIR, func(t *testing.T, imgs map[string]image.Image) {
			// three-point region assertion on the text element bbox:
			// pre (t=1.0, window not yet started) = original ink;
			// mid (t=2.0, inside the 1-3s window, past the 0.25s rise) =
			// highlight; post (t=4.0, settled after the ~1.1s fall) = original.
			pre := imgs["frame-pre.png"]
			mid := imgs["frame-mid.png"]
			post := imgs["frame-post.png"]

			preInk := fhNearShare(pre, fhTextRect, txR, txG, txB, 60)
			midHL := fhNearShare(mid, fhTextRect, hR, hG, hB, 60)
			postInk := fhNearShare(post, fhTextRect, txR, txG, txB, 60)
			if preInk < fhShareMin {
				t.Errorf("text pre-window: original-ink share %.4f < %.2f — baseline frame wrong", preInk, fhShareMin)
			}
			if midHL < fhShareMin {
				t.Errorf("text mid-window: highlight share %.4f < %.2f — text did NOT take the highlight color (T-12)", midHL, fhShareMin)
			}
			if postInk < fhShareMin {
				t.Errorf("text post-window: original-ink share %.4f < %.2f — color did not settle back", postInk, fhShareMin)
			}
			// mid frame must be highlight, not ink (guard against a no-op tween)
			if midInk := fhNearShare(mid, fhTextRect, txR, txG, txB, 60); midInk > fhShareMax {
				t.Errorf("text mid-window: original-ink share %.4f > %.2f — element still at original color at peak", midInk, fhShareMax)
			}
			// background bleed: the cream bg must NOT carry the highlight at mid
			if bleed := fhNearShare(mid, [4]int{900, 200, 400, 200}, hR, hG, hB, 60); bleed > fhShareMax {
				t.Errorf("text highlight leaked to background: %.4f > %.2f", bleed, fhShareMax)
			}
			t.Logf("TEXT-HIGHLIGHT shares: ink pre=%.4f mid=%.4f post=%.4f, highlight mid=%.4f",
				preInk, fhNearShare(mid, fhTextRect, txR, txG, txB, 60), postInk, midHL)
		}},
		{"TEXT-HIGHLIGHT-DARK", fhTextHighlightDarkIR, func(t *testing.T, imgs map[string]image.Image) {
			pre := imgs["frame-pre.png"]
			mid := imgs["frame-mid.png"]
			post := imgs["frame-post.png"]
			preInk := fhNearShare(pre, fhTextRect, ltR, ltG, ltB, 60)
			midHL := fhNearShare(mid, fhTextRect, hR, hG, hB, 60)
			postInk := fhNearShare(post, fhTextRect, ltR, ltG, ltB, 60)
			if preInk < fhShareMin {
				t.Errorf("dark text pre-window: white share %.4f < %.2f", preInk, fhShareMin)
			}
			if midHL < fhShareMin {
				t.Errorf("dark text mid-window: highlight share %.4f < %.2f — polarity-inverted text did not color", midHL, fhShareMin)
			}
			if postInk < fhShareMin {
				t.Errorf("dark text post-window: white share %.4f < %.2f — did not settle back", postInk, fhShareMin)
			}
			t.Logf("TEXT-HIGHLIGHT-DARK shares: white pre=%.4f, highlight mid=%.4f, white post=%.4f",
				preInk, midHL, postInk)
		}},
		{"FADE", fhFadeIR, func(t *testing.T, imgs map[string]image.Image) {
			// fadeIn region: pre-window (t=0.5, before startFrame 30) the
			// region IS the background (element hidden/transparent); mid-fade
			// (t=2.0, progress .5 on power2.out ≈ 0.75 — well past halfway) is
			// a blend strictly between bg and element means; post (t=4.5) is
			// the full element color.
			f0 := imgs["frame-f0.png"]  // t=0.5
			f1 := imgs["frame-f1.png"]  // t=2.0
			f2 := imgs["frame-f2.png"]  // t=4.5
			preBG := fhNearShare(f0, fhFadeInRect, bgR, bgG, bgB, 20)
			postEl := fhNearShare(f2, fhFadeInRect, elR, elG, elB, 60)
			if preBG < 0.95 {
				t.Errorf("fadeIn pre-window: background share %.4f < 0.95 — element visible before its window (P0-1 composition broken?)", preBG)
			}
			if postEl < fhShareMin {
				t.Errorf("fadeIn post: element share %.4f < %.2f — element did not reach full opacity", postEl, fhShareMin)
			}
			m0 := fhMeanMean(f0, fhFadeInRect)
			m1 := fhMeanMean(f1, fhFadeInRect)
			m2 := fhMeanMean(f2, fhFadeInRect)
			// blend: m1 strictly between m0 (bg ≈ 245) and m2 (blue ≈ 141),
			// and clearly off both ends
			if !(m1 > m2+fhBlendGap && m1 < m0-fhBlendGap) {
				t.Errorf("fadeIn mid: mean %.1f not between element %.1f and background %.1f (±%.1f) — opacity tween did not render", m1, m2, m0, fhBlendGap)
			}
			// fadeOut region: before t=3.0 fully opaque, after t=4.0 back to bg.
			o0 := fhMeanMean(f0, fhFadeOutRect)
			o2bg := fhNearShare(f2, fhFadeOutRect, bgR, bgG, bgB, 20)
			if o2bg < 0.95 {
				t.Errorf("fadeOut post: background share %.4f < 0.95 — element did not fade out", o2bg)
			}
			if o0 < fhShareMin*100/100 && o0 < 100 {
				t.Errorf("fadeOut pre: region mean %.1f — element not present before its fade window", o0)
			}
			t.Logf("FADE: fadeIn mean pre=%.1f mid=%.1f post=%.1f; fadeOut bg-share post=%.4f",
				m0, m1, m2, o2bg)
		}},
	}

	// probe timestamps per case (name → seconds)
	textSamples := []struct {
		name string
		at   float64
	}{{"frame-pre.png", 1.0}, {"frame-mid.png", 2.0}, {"frame-post.png", 4.0}}
	fadeSamples := []struct {
		name string
		at   float64
	}{{"frame-f0.png", 0.5}, {"frame-f1.png", 2.0}, {"frame-f2.png", 4.5}}

	for _, c := range cases {
		c := c
		t.Run(c.id, func(t *testing.T) {
			ir := c.ir(t)
			if verr := videoapp.Validate(ir); verr != nil {
				t.Fatalf("fixture IR invalid: %v", verr)
			}

			frames := videoapp.DurationFrames(ir, fhFPS) // 150
			spec := capx.FrameSpec{Width: fhW, Height: fhH, FPS: fhFPS, DurationFrames: frames}
			if serr := spec.Validate(); serr != nil {
				t.Fatalf("frame spec: %v", serr)
			}

			caseDir := filepath.Join(baseDir, c.id)
			if err := os.MkdirAll(caseDir, 0o755); err != nil {
				t.Fatal(err)
			}
			outputPath := filepath.Join(caseDir, "output.mp4")
			if _, rErr := renderAndEncode(t, ctx, rt, caseDir, ir, spec, outputPath); rErr != nil {
				t.Fatalf("render+encode: %v", rErr)
			}

			samples := fadeSamples
			if c.id != "FADE" {
				samples = textSamples
			}
			imgs := map[string]image.Image{}
			for _, s := range samples {
				p := filepath.Join(caseDir, s.name)
				if err := extractFrame(ctx, ffmpeg, outputPath, p, s.at); err != nil {
					t.Fatalf("extract @%.2fs: %v", s.at, err)
				}
				imgs[s.name] = fhDecode(t, p)
			}
			c.post(t, imgs)
		})
	}
}
