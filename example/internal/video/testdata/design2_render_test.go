//go:build capx

package l1

// Design-batch-2 能力像素证明（2026-11-18，设计批）：逐词成句 / 渐变文字填充 /
// 呼吸辉光 / 共享枢轴 groupScale / tilt 3D 微倾。
//
// 岛屿布局（1080x1000@30，1.0s）：
//   f0..f29  wordReveal "ONE TWO"（rise，stagger 10 帧）——顶部区
//   常驻      渐变 "I"（260px，红→蓝）+ chars pop（span 自持渐变）
//   f0..f29  groupScale 双方块（共享枢轴 540,830，1→1.5）
//   f0..f29  tilt 条（rotateY 0→35°，共享枢轴）
//   常驻      glow "G"（textShadow 2..44px 呼吸，period 12 帧）
//
// Artifacts: testdata/design2/frame-F{000,006,010,029}.png
//
// Run:
//
//	go -C example test -tags capx ./internal/video/testdata -run TestDesign2Render -v -count=1 -timeout 10m

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"github.com/haozing/ploykit/platform/capx"
	"github.com/stretchr/testify/require"

	videoapp "myproduct/internal/video/app"
)

const (
	d2W, d2H = 1080, 1000
	d2FPS    = 30
)

func d2Decode(t *testing.T, b []byte) image.Image {
	t.Helper()
	img, err := png.Decode(bytes.NewReader(b))
	require.NoError(t, err)
	return img
}

// d2Count counts pixels passing pred in [x0,x1)x[y0,y1).
func d2Count(img image.Image, x0, x1, y0, y1 int, pred func(r, g, b int) bool) int {
	n := 0
	for y := y0; y < y1; y++ {
		for x := x0; x < x1; x++ {
			r, g, b, _ := img.At(x, y).RGBA()
			if pred(int(r>>8), int(g>>8), int(b>>8)) {
				n++
			}
		}
	}
	return n
}

func TestDesign2Render(t *testing.T) {
	if testing.Short() {
		t.Skip("real browser render; skipped in -short mode")
	}
	chrome := chromePath(t)
	ffmpeg := ffmpegPath(t)
	ctx := context.Background()

	at := 2
	ir := &videoapp.IR{
		SchemaVersion: videoapp.IRSchemaVersion,
		Meta:          videoapp.Meta{FPS: d2FPS, Width: d2W, Height: d2H, DurationSec: 1.0},
	}
	ir.Elements = []videoapp.Element{
		{ID: "el_bg", Type: videoapp.ElementShape, Color: "#000000", X: 0, Y: 0, W: d2W, H: d2H, Z: 0},
		{
			ID: "el_reveal", Type: videoapp.ElementText, Text: "ONE TWO",
			Color: "#ffffff", FontSize: 110, X: 40, Y: 40, W: 700, H: 160, Z: 2,
			TextReveal: &videoapp.TextReveal{
				Style: "rise", AtFrame: &at, DurationFrames: 6, StaggerFrames: 10,
				Easing: "power2.out", Distance: 60,
			},
		},
		{
			ID: "el_grad", Type: videoapp.ElementText, Text: "I",
			FontSize: 260, X: 760, Y: 30, W: 140, H: 320, Z: 2,
			TextGradient: &videoapp.Gradient{Type: "linear", Angle: 180, Stops: []videoapp.GradientStop{
				{Offset: 0, Color: "#ff0000"}, {Offset: 1, Color: "#0000ff"},
			}},
			// 逐字 pop + 渐变：渐变由 span 自持（父级 clip 会被 span transform
			// 打碎——2026-11-18 实测），f29 时已完全落入终态。
			TextReveal: &videoapp.TextReveal{Style: "pop", Split: "chars", AtFrame: tcbIntPtr(0), DurationFrames: 6, StaggerFrames: 1},
		},
		// groupScale pair: two squares scaling about the SAME canvas pivot —
		// the shared-pivot proof (they must spread apart, not zoom in place).
		{ID: "gs_a", Type: videoapp.ElementShape, Color: "#ffffff", X: 200, Y: 800, W: 60, H: 60, Z: 3,
			Animations: []videoapp.ElementAnimation{{ID: "gs_a1", Type: "groupScale",
				FromValue: tcbF64Ptr(1), ToValue: tcbF64Ptr(1.5), Pivot: &videoapp.Point{X: 540, Y: 830},
				DurationFrames: 20, Easing: "linear", AtFrame: tcbIntPtr(0)}}},
		{ID: "gs_b", Type: videoapp.ElementShape, Color: "#ffffff", X: 800, Y: 800, W: 60, H: 60, Z: 3,
			Animations: []videoapp.ElementAnimation{{ID: "gs_b1", Type: "groupScale",
				FromValue: tcbF64Ptr(1), ToValue: tcbF64Ptr(1.5), Pivot: &videoapp.Point{X: 540, Y: 830},
				DurationFrames: 20, Easing: "linear", AtFrame: tcbIntPtr(0)}}},
		// tilt bar: rotates about the shared pivot — its painted horizontal
		// extent must shrink under rotationY (3D + perspective).
		{ID: "tilt_bar", Type: videoapp.ElementShape, Color: "#00ffff", X: 240, Y: 860, W: 520, H: 70, Z: 4,
			Animations: []videoapp.ElementAnimation{{ID: "tilt1", Type: "tilt",
				From: &videoapp.Point{X: 0, Y: 0}, To: &videoapp.Point{X: 0, Y: 35},
				Pivot: &videoapp.Point{X: 540, Y: 830}, DurationFrames: 20, Easing: "linear",
				AtFrame: tcbIntPtr(0)}}},
		{
			ID: "el_glow", Type: videoapp.ElementText, Text: "G",
			Color: "#ffffff", FontSize: 180, X: 520, Y: 500, W: 220, H: 240, Z: 2,
			TextShadow: &videoapp.TextShadow{Color: "rgba(255,255,255,0.9)", Blur: 2},
		},
	}
	zero := 0
	ir.Effects = []videoapp.Effect{{
		ID: "fx_glow", Type: videoapp.EffectGlow, TargetElementID: "el_glow",
		AtFrame: &zero,
		Params:  []byte(`{"color":"rgba(255,255,255,0.9)","blurMin":2,"blurMax":44,"periodFrames":12}`),
	}}
	require.NoError(t, videoapp.Validate(ir), "styling IR must pass the write gate")

	frames := videoapp.DurationFrames(ir, d2FPS)
	require.Equal(t, 30, frames)

	proj := videoapp.NewProjector(nil)
	html, err := proj.HTML(ctx, ir, "")
	require.NoError(t, err)

	spec := capx.FrameSpec{Width: d2W, Height: d2H, FPS: d2FPS, DurationFrames: frames}
	require.NoError(t, spec.Validate())

	enabled := true
	rt, err := capx.New(capx.Config{Enabled: &enabled, ChromePath: chrome, FFMpegPath: ffmpeg, PoolSize: 1})
	require.NoError(t, err)
	defer rt.Close()
	require.True(t, rt.Available())
	rend, err := rt.Renderer()
	require.NoError(t, err)

	kept := map[int]bool{0: true, 6: true, 10: true, 29: true}
	samples := map[int][]byte{}
	require.NoError(t, rend.RenderFrames(ctx,
		capx.Doc{HTML: string(html), TimelineID: "main"}, spec,
		func(_ context.Context, f capx.Frame) error {
			if kept[f.Index] {
				samples[f.Index] = f.PNG
			}
			return nil
		}), "render failed")
	require.Len(t, samples, 4)

	artifactDir := filepath.Join("design2")
	require.NoError(t, os.MkdirAll(artifactDir, 0o755))
	for fr, pngBytes := range samples {
		require.NoError(t, os.WriteFile(filepath.Join(artifactDir, fmt.Sprintf("frame-F%03d.png", fr)), pngBytes, 0o644))
	}

	f0, f6, f10, f29 := d2Decode(t, samples[0]), d2Decode(t, samples[6]), d2Decode(t, samples[10]), d2Decode(t, samples[29])

	// ---- 1. word reveal ----
	whiteish := func(r, g, b int) bool { return r > 170 && g > 170 && b > 170 }
	revealBox := func(img image.Image) int { return d2Count(img, 20, 760, 30, 280, whiteish) }
	c0, c10, c29 := revealBox(f0), revealBox(f10), revealBox(f29)
	t.Logf("reveal counts: f0=%d f10=%d f29=%d", c0, c10, c29)
	require.Lessf(t, c0, 50, "f0: both words hidden (inline start state), got %d px", c0)
	require.Greaterf(t, c10, 800, "f10: first word visible, got %d px", c10)
	require.Greaterf(t, c29, 4000, "f29: both words visible, got %d px", c29)
	require.Lessf(t, c10, int(float64(c29)*0.75), "f10: second word still hidden (first=%d, both=%d)", c10, c29)

	// ---- 2. gradient text (relative: red only top, blue only bottom) ----
	redish := func(r, g, b int) bool { return r > 140 && b < 90 }
	blueish := func(r, g, b int) bool { return b > 140 && r < 90 }
	topRed := d2Count(f29, 740, 920, 130, 190, redish)
	bottomRed := d2Count(f29, 740, 920, 270, 330, redish)
	topBlue := d2Count(f29, 740, 920, 130, 190, blueish)
	bottomBlue := d2Count(f29, 740, 920, 270, 330, blueish)
	t.Logf("gradient: topRed=%d bottomRed=%d topBlue=%d bottomBlue=%d", topRed, bottomRed, topBlue, bottomBlue)
	require.Greaterf(t, topRed, 150, "gradient top carries red (got %d px)", topRed)
	require.Lessf(t, bottomRed, topRed/3, "red fades out by the bottom (top=%d bottom=%d)", topRed, bottomRed)
	require.Greaterf(t, bottomBlue, 600, "gradient bottom carries blue (got %d px)", bottomBlue)
	require.Lessf(t, topBlue, bottomBlue/3, "blue fades in only toward the bottom (top=%d bottom=%d)", topBlue, bottomBlue)

	// ---- 2b. groupScale: shared pivot spreads both squares apart ----
	boxCount := func(img image.Image, x0, x1, y0, y1 int) int {
		return d2Count(img, x0, x1, y0, y1, whiteish)
	}
	aOrig := boxCount(f0, 195, 265, 795, 865)
	aNew := boxCount(f29, 25, 125, 780, 880)
	bNew := boxCount(f29, 925, 1025, 780, 880)
	aAfter := boxCount(f29, 195, 265, 795, 865)
	t.Logf("groupScale: f0.A=%d f29.Anew=%d f29.Bnew=%d f29.Aorig=%d", aOrig, aNew, bNew, aAfter)
	require.Greaterf(t, aOrig, 2500, "f0: square A at its authored spot (got %d px)", aOrig)
	require.Greaterf(t, aNew, 6500, "f29: A scaled outward about the shared pivot (got %d px)", aNew)
	require.Greaterf(t, bNew, 6500, "f29: B scaled outward about the shared pivot (got %d px)", bNew)
	require.Lessf(t, aAfter, 50, "f29: A left its authored spot (got %d px)", aAfter)

	// ---- 2c. tilt: the bar's painted width shrinks under rotationY 35° ----
	cyan := func(r, g, b int) bool { return r < 90 && g > 150 && b > 150 }
	barSpan := func(img image.Image) (int, int, int) {
		minX, maxX, n := 1<<30, -1, 0
		for y := 830; y < 930; y++ {
			for x := 0; x < 1080; x++ {
				r, g, b, _ := img.At(x, y).RGBA()
				if cyan(int(r>>8), int(g>>8), int(b>>8)) {
					n++
					if x < minX {
						minX = x
					}
					if x > maxX {
						maxX = x
					}
				}
			}
		}
		if maxX < 0 {
			return 0, 0, 0
		}
		return minX, maxX, n
	}
	m0, x0, n0 := barSpan(f0)
	m29, x29, n29 := barSpan(f29)
	w0, w29 := x0-m0, x29-m29
	t.Logf("tilt: f0 width=%d px=%d | f29 width=%d px=%d", w0, n0, w29, n29)
	require.Greaterf(t, n0, 20000, "f0: bar fully visible (got %d px)", n0)
	require.Lessf(t, w29, int(float64(w0)*0.94), "f29: rotationY 35° shrinks the painted width (f0=%d f29=%d)", w0, w29)
	require.Greaterf(t, w29, int(float64(w0)*0.55), "f29: still recognisably the same bar (f0=%d f29=%d)", w0, w29)

	// ---- 3. glow breathing ----
	halo := func(r, g, b int) bool {
		lum := (r + g + b) / 3
		return lum > 25 && lum < 150
	}
	glowBox := func(img image.Image) int { return d2Count(img, 480, 780, 460, 760, halo) }
	g0, g6 := glowBox(f0), glowBox(f6)
	t.Logf("glow halo: f0=%d f6=%d", g0, g6)
	require.Greaterf(t, g6, g0*2, "glow brightest frame spreads a wider halo (f6=%d vs f0=%d)", g6, g0)
}
