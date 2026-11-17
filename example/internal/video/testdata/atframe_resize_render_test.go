//go:build capx

package l1

// atFrame + resize 端到端像素证明（v1 增量，versus 试点摩擦的修复验证）。
//
// 试点病灶：v1 每条动画必须挂词锚——作者只能造假 "manual" 锚词当时间轴
// （单项目 37 个）；水平进度条无法表达——只能拆 30 个手算静态 shape。
// 修复 = atFrame 显式帧锚（全局帧钟，v2 `at:{frame}` 的平展桥接，spec
// plan-video-studio-ir-v2-spec-2026-11-17 §2.8.1）+ resize 宽高补间（左上
// 角锚定，进度条语义）。
//
// 本测试的编排 ZERO 词锚（words 留空）——正是新能力的验证点：
//   el_bar（红条，无窗口常驻）两条动画：
//     resize {0,40}→{600,40} linear 15 帧 @ atFrame 0   （进度条从 0 长到 600）
//     move   {100,100}→{100,500} linear 15 帧 @ atFrame 15（长满后移到下方）
//
// 采样帧（30fps，t = frame/30）与预期：
//   F0  (t=0.000): resize 进度 0   → 红条宽 0，全图红像素 ≈ 0
//   F7  (t=0.233): 宽 ≈ 280，条仍在上方 y∈[100,140]
//   F14 (t=0.467): 宽 ≈ 560，条仍在上方 y∈[100,140]（move 未开始）
//   F22 (t=0.733): 宽 600（resize 已完成），条移到 y∈[287,327]
//   F29 (t=0.967): 条移到 y∈[473,513]（下方）
//
// 断言用 image/png 解码数红色像素（#ff0000 vs 背景 #222222），条带对比：
// F14 上带红 >> 0 且下带 = 0；F29 下带红 >> 0 且上带 = 0（「红色像素计数
// 反差」），外加 F14/F29 字节不等、F0 与 F14 显著不同。
//
// Artifacts: testdata/atframe/VS-AF/frame-F{000,007,014,022,029}.png
//
// Run:
//
//	go -C example test -tags capx ./internal/video/testdata -run TestAtFrameResizeRender -v -count=1 -timeout 10m

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/haozing/ploykit/platform/capx"
	"github.com/stretchr/testify/require"

	videoapp "myproduct/internal/video/app"
)

const (
	afW, afH = 1080, 1080
	afFPS    = 30
)

func afIntPtr(i int) *int { return &i }

// afDecodePNG decodes an in-memory PNG (the RenderFrames callback hands back
// bytes; the timewindow helper reads from disk instead).
func afDecodePNG(t *testing.T, b []byte) image.Image {
	t.Helper()
	img, err := png.Decode(bytes.NewReader(b))
	require.NoError(t, err)
	return img
}

// afIsRed: red-dominant pixel in 16-bit premultiplied channels. #ff0000 →
// (65535, 0, 0); background #222222 → (~8738 each); antialiased red-on-dark
// edge pixels stay red-dominant and count.
func afIsRed(r, g, b uint32) bool {
	return r > 40000 && g < 20000 && b < 20000
}

// afCountRedBand counts red pixels across the full width inside rows
// [y0, y1).
func afCountRedBand(img image.Image, y0, y1 int) int {
	n := 0
	b := img.Bounds()
	for y := y0; y < y1; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			r, g, bl, _ := img.At(x, y).RGBA()
			if afIsRed(r, g, bl) {
				n++
			}
		}
	}
	return n
}

func TestAtFrameResizeRender(t *testing.T) {
	if testing.Short() {
		t.Skip("real browser render; skipped in -short mode")
	}
	chrome := chromePath(t)
	ffmpeg := ffmpegPath(t) // capx.New probes it even though this test never encodes
	ctx := context.Background()

	// -- 1. minimal IR: 1080x1080@30, 1.0s, ZERO words (the whole point) --
	ir := &videoapp.IR{
		SchemaVersion: videoapp.IRSchemaVersion,
		Meta:          videoapp.Meta{FPS: afFPS, Width: afW, Height: afH, DurationSec: 1.0},
	}
	ir.Elements = []videoapp.Element{
		{ID: "el_bg", Type: videoapp.ElementShape, Color: "#222222",
			X: 0, Y: 0, W: afW, H: afH, Z: 0},
		{ID: "el_bar", Type: videoapp.ElementShape, Color: "#ff0000",
			X: 100, Y: 100, W: 600, H: 40, Z: 1,
			Animations: []videoapp.ElementAnimation{
				{ID: "an_grow", Type: "resize",
					From: &videoapp.Point{X: 0, Y: 40}, To: &videoapp.Point{X: 600, Y: 40},
					DurationFrames: 15, Easing: "linear", AtFrame: afIntPtr(0)},
				{ID: "an_drop", Type: "move",
					From: &videoapp.Point{X: 100, Y: 100}, To: &videoapp.Point{X: 100, Y: 500},
					DurationFrames: 15, Easing: "linear", AtFrame: afIntPtr(15)},
			}},
	}
	require.NoError(t, videoapp.Validate(ir), "atFrame+resize IR must pass the write gate")
	frames := videoapp.DurationFrames(ir, afFPS) // ceil(1.0*30) = 30
	require.Equal(t, 30, frames)
	// no ResolveAll pass: zero word anchors exist to resolve — atFrame only.

	// -- 2. project (NewProjector(nil): no image assets, preview resolver) --
	proj := videoapp.NewProjector(nil)
	html, err := proj.HTML(ctx, ir, "")
	require.NoError(t, err)

	// -- 3. render all 30 frames, keep F0/F7/F14/F22/F29 --
	spec := capx.FrameSpec{Width: afW, Height: afH, FPS: afFPS, DurationFrames: frames}
	require.NoError(t, spec.Validate())

	enabled := true
	rt, err := capx.New(capx.Config{Enabled: &enabled, ChromePath: chrome, FFMpegPath: ffmpeg, PoolSize: 1})
	require.NoError(t, err)
	defer rt.Close()
	require.True(t, rt.Available())
	rend, err := rt.Renderer()
	require.NoError(t, err)

	kept := map[int]bool{0: true, 7: true, 14: true, 22: true, 29: true}
	samples := map[int][]byte{}
	t0 := time.Now()
	renderErr := rend.RenderFrames(ctx,
		capx.Doc{HTML: string(html), TimelineID: "main"}, spec,
		func(_ context.Context, f capx.Frame) error {
			if kept[f.Index] {
				samples[f.Index] = f.PNG
			}
			return nil
		})
	require.NoError(t, renderErr, "render failed")
	require.Len(t, samples, 5, "kept frames 0/7/14/22/29")
	t.Logf("ATFRAME/RESIZE: %d frames rendered in %.1fs", frames, time.Since(t0).Seconds())

	// -- 4. pixel verdicts --
	// bands keyed to the geometry: bar is 40px tall; upper position y∈[100,140]
	// (before move), mid y∈[287,327] @F22, lower end y∈[473,513] @F29. Bands
	// are padded ±5px; assertions use conservative thresholds (bar area is
	// 22400-24000 px; >15000 leaves room for border-radius corners + AA).
	f0, f7, f14, f22, f29 := afDecodePNG(t, samples[0]), afDecodePNG(t, samples[7]),
		afDecodePNG(t, samples[14]), afDecodePNG(t, samples[22]), afDecodePNG(t, samples[29])
	upper := func(img image.Image) int { return afCountRedBand(img, 95, 150) }
	mid := func(img image.Image) int { return afCountRedBand(img, 275, 340) }
	lower := func(img image.Image) int { return afCountRedBand(img, 465, 525) }
	total := func(img image.Image) int { return afCountRedBand(img, 0, img.Bounds().Dy()) }

	// F0: resize progress 0 → width 0 → no red anywhere.
	require.Less(t, total(f0), 100, "F0: bar width 0, red pixels ≈ 0 (got %d)", total(f0))
	// F14 vs F0: significantly different (bytes AND pixels).
	require.NotEqual(t, samples[0], samples[14], "F0 != F14 bytes")
	require.Greater(t, upper(f14), 15000, "F14: bar on TOP, width ≈ 560 (got %d red px in upper band)", upper(f14))
	require.Equal(t, 0, lower(f14), "F14: nothing in the lower band yet (move starts at F15)")
	// F7: growth is real (≈ half of F14's area).
	f7u := upper(f7)
	require.Greater(t, f7u, 7000, "F7: bar ≈ 280 wide (got %d red px)", f7u)
	require.Less(t, f7u, upper(f14), "F7 narrower than F14 (linear growth)")
	// F22: resize done (600 wide), move roughly halfway → mid band.
	require.Greater(t, mid(f22), 15000, "F22: bar in the MIDDLE band (got %d red px)", mid(f22))
	require.Equal(t, 0, upper(f22), "F22: bar has left the upper band")
	// F29: bar at the bottom — the upper/lower red-count reversal.
	require.Greater(t, lower(f29), 15000, "F29: bar moved DOWN (got %d red px in lower band)", lower(f29))
	require.Equal(t, 0, upper(f29), "F29: upper band empty (reversal vs F14)")
	require.NotEqual(t, samples[14], samples[29], "F14 != F29 bytes")

	// -- 5. artifacts --
	_, thisFile, _, _ := runtime.Caller(0)
	outDir := filepath.Join(filepath.Dir(thisFile), "atframe", "VS-AF")
	require.NoError(t, os.MkdirAll(outDir, 0o755))
	for fr, pngBytes := range samples {
		p := filepath.Join(outDir, fmt.Sprintf("frame-F%03d.png", fr))
		require.NoError(t, os.WriteFile(p, pngBytes, 0o644))
	}
	t.Logf("artifacts: %s (5 sample PNGs)", outDir)
}
