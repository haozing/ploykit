//go:build capx

package l1

// Visual styling layer — 端到端像素证明（2026-11-18，设计批）。
//
// 三个能力岛同画布（1080x1080@30，1.0s），各钉一类像素事实：
//
//  1. GRADIENT + RADIUS：400x400 圆角矩形，linear-gradient 180deg 红→蓝。
//  2. STROKE + PAINT-ORDER：220px 白色文字 + 24px 绿描边。
//  3. OPACITY：白色矩形 opacity 0.5 叠在深底上 → 中灰。
//
// Artifacts: testdata/style-layer/frame-F000.png
//
// Run:
//
//	go -C example test -tags capx ./internal/video/testdata -run TestStyleLayerRender -v -count=1 -timeout 10m

import (
	"bytes"
	"context"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/haozing/ploykit/platform/capx"
	"github.com/stretchr/testify/require"

	videoapp "myproduct/internal/video/app"
)

const (
	styW, styH = 1080, 1080
	styFPS     = 30
)

func styDecode(t *testing.T, b []byte) image.Image {
	t.Helper()
	img, err := png.Decode(bytes.NewReader(b))
	require.NoError(t, err)
	return img
}

func styAt(img image.Image, x, y int) (int, int, int) {
	r, g, b, _ := img.At(x, y).RGBA()
	return int(r >> 8), int(g >> 8), int(b >> 8)
}

func styCountBox(img image.Image, x0, x1, y0, y1 int, pred func(r, g, b int) bool) int {
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

func TestStyleLayerRender(t *testing.T) {
	if testing.Short() {
		t.Skip("real browser render; skipped in -short mode")
	}
	chrome := chromePath(t)
	ffmpeg := ffmpegPath(t)
	ctx := context.Background()

	ir := &videoapp.IR{
		SchemaVersion: videoapp.IRSchemaVersion,
		Meta:          videoapp.Meta{FPS: styFPS, Width: styW, Height: styH, DurationSec: 1.0},
	}
	radius := 40.0
	ir.Elements = []videoapp.Element{
		{ID: "el_bg", Type: videoapp.ElementShape, Color: "#101010", X: 0, Y: 0, W: styW, H: styH, Z: 0},

		// (1) gradient + radius
		{ID: "el_grad", Type: videoapp.ElementShape, X: 80, Y: 80, W: 400, H: 400, Z: 1,
			Radius: &radius,
			Gradient: &videoapp.Gradient{Type: "linear", Angle: 180, Stops: []videoapp.GradientStop{
				{Offset: 0, Color: "#ff0000"}, {Offset: 1, Color: "#0000ff"},
			}}},

		// (2) stroked display text
		{ID: "el_txt", Type: videoapp.ElementText, Text: "W",
			FontSize: 220, Color: "#ffffff", StrokeColor: "#00ff00", StrokeWidth: 24,
			X: 560, Y: 60, W: 460, H: 320, Z: 2},

		// (3) static opacity
		{ID: "el_op", Type: videoapp.ElementShape, Color: "#ffffff", Opacity: 0.5,
			X: 560, Y: 700, W: 300, H: 200, Z: 2},
	}
	require.NoError(t, videoapp.Validate(ir), "styling IR must pass the write gate")

	frames := videoapp.DurationFrames(ir, styFPS)
	require.Equal(t, 30, frames)

	proj := videoapp.NewProjector(nil)
	html, err := proj.HTML(ctx, ir, "")
	require.NoError(t, err)

	spec := capx.FrameSpec{Width: styW, Height: styH, FPS: styFPS, DurationFrames: frames}
	require.NoError(t, spec.Validate())

	enabled := true
	rt, err := capx.New(capx.Config{Enabled: &enabled, ChromePath: chrome, FFMpegPath: ffmpeg, PoolSize: 1})
	require.NoError(t, err)
	defer rt.Close()
	require.True(t, rt.Available())
	rend, err := rt.Renderer()
	require.NoError(t, err)

	var f0 []byte
	renderErr := rend.RenderFrames(ctx,
		capx.Doc{HTML: string(html), TimelineID: "main"}, spec,
		func(_ context.Context, f capx.Frame) error {
			if f.Index == 0 {
				f0 = f.PNG
			}
			return nil
		})
	require.NoError(t, renderErr, "render failed")
	require.NotNil(t, f0)
	img := styDecode(t, f0)
	artifactDir := filepath.Join("style-layer")
	require.NoError(t, os.MkdirAll(artifactDir, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(artifactDir, "frame-F000.png"), f0, 0o644))

	// -- 1. gradient: red at the top, blue at the bottom --
	tr, tg, tb := styAt(img, 280, 140)
	require.Greaterf(t, tr, 150, "gradient top is red-dominant (got %d,%d,%d)", tr, tg, tb)
	require.Lessf(t, tb, 110, "gradient top has little blue (got %d,%d,%d)", tr, tg, tb)
	br, bg, bb := styAt(img, 280, 420)
	require.Greaterf(t, bb, 150, "gradient bottom is blue-dominant (got %d,%d,%d)", br, bg, bb)
	require.Lessf(t, br, 110, "gradient bottom has little red (got %d,%d,%d)", br, bg, bb)
	mr, _, mb := styAt(img, 120, 280)
	require.Greaterf(t, mr, 60, "gradient mid painted red channel (got %d)", mr)
	require.Greaterf(t, mb, 60, "gradient mid painted blue channel (got %d)", mb)

	// -- 1b. radius: the very corner outside the rounded rect stays background --
	cr, cg, cb := styAt(img, 82, 82)
	require.Lessf(t, cr+cg+cb, 120, "rounded corner is background (got %d,%d,%d)", cr, cg, cb)

	// -- 2. stroke: green outline + white fill both substantial --
	green := styCountBox(img, 560, 1020, 60, 380, func(r, g, b int) bool { return g > 140 && r < 110 && b < 110 })
	white := styCountBox(img, 560, 1020, 60, 380, func(r, g, b int) bool { return r > 200 && g > 200 && b > 200 })
	require.Greaterf(t, green, 3000, "painted green stroke (got %d px)", green)
	require.Greaterf(t, white, 6000, "glyph fill survives the stroke (paint-order) (got %d px)", white)

	// -- 3. opacity: 0.5 white over #101010 ≈ mid gray --
	r, g, b := styAt(img, 710, 800)
	avg := (r + g + b) / 3
	require.Greaterf(t, avg, 100, "opacity 0.5 white blends to mid gray (got %d,%d,%d)", r, g, b)
	require.Lessf(t, avg, 160, "opacity 0.5 white does not render opaque (got %d,%d,%d)", r, g, b)

	t.Logf("STYLE LAYER: gradient/radius/stroke/opacity all pixel-verified (%s)", runtime.GOOS)
}
