//go:build capx

package l1

// transformOrigin / clip / mixBlendMode — 端到端像素证明（camera-gap 批，
// 2026-11-17）。11 片复刻的最大结构缺口是"无相机/组变换"：rain-pilot 的
// 运镜缓推只能烘静止末值帧、disaster-pilot 的 zoom punch 是"本片最大的一段
// 近似"、spotdiff 的 hunt drift 只能用假窗口近似、day 的色温只能烘 5 态卡。
// 本测试证明三个新字段各自改变了像素：
//
//  1. CLIP（固定相机窗）：全幅红 shape 带 clip{x:200,y:200,w:400,h:400,
//     radius:30} + scaleIn 2→1 atFrame:0。关键断言 = 任意帧红像素只在
//     [200,600]×[200,600] 窗内（窗外=0）——包括 F0（scale=2 的瞬间）。
//     若 clip 误放在元素节点上（随 transform 缩放），F0 的窗会被放大到
//     [0,1080]，窗外红像素立刻非零——该断言正是为钉住 wrapper 方案而设。
//  2. BLEND（混合模式）：蓝底 + 半亮灰 shape mixBlendMode:screen 常驻。
//     screen(半灰, 蓝) > 蓝（提亮），断言混合区像素均值显著高于纯蓝区。
//     对照：isolation:isolate 保证混合不漏出 #canvas（#stage 黑底不会被
//     提亮——canvas 外无变化）。
//  3. TRANSFORM-ORIGIN：两个同几何红条（同 y），一个 rotate 90° origin
//     "top left"，一个默认 50% 50%。90° 旋转下二者像素分布必然不同：
//     top-left 原点的条转进左侧竖带（元素自身左上角不动），默认原点的条
//     绕自身中心转（原地竖条）。断言两个旋转后帧的红像素分布不同（分区
//     计数不对称），且与未旋转帧也不同。
//
// 采样帧（30fps）：F0/F14（clip 的首尾）+ F29（origin/blend 常驻帧）。
// 像素断言工具照抄 atframe_resize_render_test.go 的 afCountRedBand 模式。
//
// Artifacts: testdata/transform-clip-blend/VS-TCB/frame-F{000,014,029}.png
//
// Run:
//
//	go -C example test -tags capx ./internal/video/testdata -run TestTransformClipBlendRender -v -count=1 -timeout 10m

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
	tcbW, tcbH = 1080, 1080
	tcbFPS     = 30
)

func tcbIntPtr(i int) *int         { return &i }
func tcbF64Ptr(f float64) *float64 { return &f }

func tcbDecodePNG(t *testing.T, b []byte) image.Image {
	t.Helper()
	img, err := png.Decode(bytes.NewReader(b))
	require.NoError(t, err)
	return img
}

// tcbIsRed: red-dominant pixel (#ff0000 on #222222 background).
func tcbIsRed(r, g, b uint32) bool {
	return r > 40000 && g < 20000 && b < 20000
}

// tcbIsGreen: green-dominant pixel — the transform-origin island uses its
// own color so the clip island's red-band assertions stay unpolluted (the
// two islands share the canvas; a second red element would trip the clip
// "outside the window" zero-assertions).
func tcbIsGreen(r, g, b uint32) bool {
	return g > 40000 && r < 20000 && b < 20000
}

// tcbCountBand counts pixels passing pred in rows [y0, y1) across the width.
func tcbCountBand(img image.Image, y0, y1 int, pred func(r, g, b uint32) bool) int {
	n := 0
	b := img.Bounds()
	for y := y0; y < y1; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			r, g, bl, _ := img.At(x, y).RGBA()
			if pred(r, g, bl) {
				n++
			}
		}
	}
	return n
}

// tcbCountBox counts pixels passing pred inside [x0,x1)×[y0,y1).
func tcbCountBox(img image.Image, x0, x1, y0, y1 int, pred func(r, g, b uint32) bool) int {
	n := 0
	for y := y0; y < y1; y++ {
		for x := x0; x < x1; x++ {
			r, g, bl, _ := img.At(x, y).RGBA()
			if pred(r, g, bl) {
				n++
			}
		}
	}
	return n
}

// tcbMeanChannel averages one channel over a box (blend assertion: screen
// brightens the blue base; means compare quantitatively without pinning the
// exact composite formula).
func tcbMeanChannel(img image.Image, x0, x1, y0, y1 int, pick func(r, g, b uint32) uint32) float64 {
	sum, n := 0.0, 0
	for y := y0; y < y1; y++ {
		for x := x0; x < x1; x++ {
			r, g, b, _ := img.At(x, y).RGBA()
			sum += float64(pick(r, g, b))
			n++
		}
	}
	if n == 0 {
		return 0
	}
	return sum / float64(n)
}

func blue(b uint32) uint32 { return b }

func TestTransformClipBlendRender(t *testing.T) {
	if testing.Short() {
		t.Skip("real browser render; skipped in -short mode")
	}
	chrome := chromePath(t)
	ffmpeg := ffmpegPath(t)
	ctx := context.Background()

	// -- 1. IR: three feature islands on one 1080x1080@30 1.0s canvas --
	ir := &videoapp.IR{
		SchemaVersion: videoapp.IRSchemaVersion,
		Meta:          videoapp.Meta{FPS: tcbFPS, Width: tcbW, Height: tcbH, DurationSec: 1.0},
	}
	ir.Elements = []videoapp.Element{
		// dark background so red/blue reads cleanly
		{ID: "el_bg", Type: videoapp.ElementShape, Color: "#222222",
			X: 0, Y: 0, W: tcbW, H: tcbH, Z: 0},

		// (1) CLIP: full-canvas red shape in a fixed 400x400 camera window at
		// (200,200), scaling 2→1 INSIDE the window across 15 frames.
		{ID: "el_clip", Type: videoapp.ElementShape, Color: "#ff0000",
			X: 0, Y: 0, W: tcbW, H: tcbH, Z: 1,
			Clip: &videoapp.Clip{X: 200, Y: 200, W: 400, H: 400, Radius: 30},
			Animations: []videoapp.ElementAnimation{
				{ID: "an_cin", Type: "scaleIn", FromValue: tcbF64Ptr(2), ToValue: tcbF64Ptr(1),
					DurationFrames: 15, Easing: "linear", AtFrame: tcbIntPtr(0)}}},

		// (2) BLEND: blue plate (left-bottom quadrant) + half-gray overlay with
		// screen blend, both static. screen(gray 0x80, blue) > blue.
		{ID: "el_blue", Type: videoapp.ElementShape, Color: "#0000ff",
			X: 60, Y: 780, W: 300, H: 240, Z: 2},
		{ID: "el_screen", Type: videoapp.ElementShape, Color: "#808080",
			X: 60, Y: 780, W: 300, H: 240, Z: 3, MixBlendMode: "screen"},

		// (3) TRANSFORM-ORIGIN: two identical GREEN bars at the same x; one
		// rotates 90° about "top left", one about the default 50% 50%.
		// Both rotate across the whole 30 frames (duration 30 = full clip)
		// so every sampled frame shows the settled distribution difference.
		// Green (not red): the islands must not pollute each other's pixel
		// predicates (the clip island's red assertions span the full canvas).
		{ID: "el_rot_tl", Type: videoapp.ElementShape, Color: "#00ff00",
			X: 760, Y: 100, W: 240, H: 60, Z: 4, TransformOrigin: "top left",
			Animations: []videoapp.ElementAnimation{
				{ID: "an_rotl", Type: "rotate", FromValue: tcbF64Ptr(0), ToValue: tcbF64Ptr(90),
					DurationFrames: 30, Easing: "linear", AtFrame: tcbIntPtr(0)}}},
		{ID: "el_rot_c", Type: videoapp.ElementShape, Color: "#00ff00",
			X: 760, Y: 300, W: 240, H: 60, Z: 4,
			Animations: []videoapp.ElementAnimation{
				{ID: "an_rotc", Type: "rotate", FromValue: tcbF64Ptr(0), ToValue: tcbF64Ptr(90),
					DurationFrames: 30, Easing: "linear", AtFrame: tcbIntPtr(0)}}},
	}
	require.NoError(t, videoapp.Validate(ir), "camera-fields IR must pass the write gate")
	frames := videoapp.DurationFrames(ir, tcbFPS)
	require.Equal(t, 30, frames)

	// -- 2. project + render all 30 frames, keep F0/F14/F29 --
	proj := videoapp.NewProjector(nil)
	html, err := proj.HTML(ctx, ir, "")
	require.NoError(t, err)

	spec := capx.FrameSpec{Width: tcbW, Height: tcbH, FPS: tcbFPS, DurationFrames: frames}
	require.NoError(t, spec.Validate())

	enabled := true
	rt, err := capx.New(capx.Config{Enabled: &enabled, ChromePath: chrome, FFMpegPath: ffmpeg, PoolSize: 1})
	require.NoError(t, err)
	defer rt.Close()
	require.True(t, rt.Available())
	rend, err := rt.Renderer()
	require.NoError(t, err)

	kept := map[int]bool{0: true, 14: true, 29: true}
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
	require.Len(t, samples, 3, "kept frames 0/14/29")
	t.Logf("TRANSFORM/CLIP/BLEND: %d frames rendered in %.1fs", frames, time.Since(t0).Seconds())

	f0, f14, f29 := tcbDecodePNG(t, samples[0]), tcbDecodePNG(t, samples[14]), tcbDecodePNG(t, samples[29])

	// -- 3. CLIP verdicts: red only inside [200,600]x[200,600], every frame --
	// In-window floor: scale=2 at F0 still fills the whole 400x400 window
	// (a 2160px-wide scaled rect covers it entirely); at F14 scale=1 the
	// full-canvas rect also covers it. Corner radius 30 trims ~4*900=3600px²
	// total, so >150k leaves generous margin. Outside must be EXACTLY 0 —
	// the wrapper makes the window transform-proof; a node-attached clip
	// would show ~big red area at F0 (scaled window).
	inWin := func(img image.Image) int { return tcbCountBox(img, 200, 600, 200, 600, tcbIsRed) }
	outAbove := func(img image.Image) int { return tcbCountBox(img, 0, 1080, 0, 200, tcbIsRed) }
	outBelow := func(img image.Image) int { return tcbCountBox(img, 0, 1080, 600, 1080, tcbIsRed) }
	outLeft := func(img image.Image) int { return tcbCountBox(img, 0, 200, 200, 600, tcbIsRed) }
	outRight := func(img image.Image) int { return tcbCountBox(img, 600, 1080, 200, 600, tcbIsRed) }

	for name, img := range map[string]image.Image{"F0": f0, "F14": f14, "F29": f29} {
		require.Greaterf(t, inWin(img), 150000, "%s: clip window filled with red (got %d px)", name, inWin(img))
		require.Zerof(t, outAbove(img), "%s: no red ABOVE the clip window", name)
		require.Zerof(t, outBelow(img), "%s: no red BELOW the clip window", name)
		require.Zerof(t, outLeft(img), "%s: no red LEFT of the clip window", name)
		require.Zerof(t, outRight(img), "%s: no red RIGHT of the clip window", name)
	}

	// -- 4. BLEND verdicts (F29 static composition) --
	// screen(0x808080 gray, #0000ff blue): result channel =
	// 255-(255-src)*(255-dst)/255 per channel; blue channel rises from 255→
	// 255 (already max), red/green rise from 0 → ~128. So the blended plate
	// is much brighter than the pure blue base → mean pixel value (all
	// channels) of the plate region must exceed a no-blend control by a
	// wide margin. Control = the blue plate WITHOUT the overlay does not
	// exist separately, so the assertion compares the blended plate against
	// the pure blue corner of ITSELF is impossible — instead assert the
	// blended plate's mean brightness is far above what pure #0000ff gives
	// (mean over 16-bit channels for pure blue = (0+0+65535)/3 ≈ 21845;
	// screen lifts red+green to ~32896 each → mean ≈ 43762).
	meanAll := func(img image.Image) float64 {
		return tcbMeanChannel(img, 60, 360, 780, 1020, func(r, g, b uint32) uint32 { return r + g + b })
	}
	blendSum := meanAll(f29)
	require.Greaterf(t, blendSum, 98300.0*0.8, // 0.8*(3*32768): screen-gray on blue lifts sum/channel well past pure blue (3*21845≈65535)
		"F29: screen blend brightens the blue plate (sum-of-channels mean %.0f; pure blue would be ~65535)", blendSum)
	// red channel specifically: pure blue has r=0; screen(gray) lifts r≈32896.
	redMean := tcbMeanChannel(f29, 60, 360, 780, 1020, func(r, g, b uint32) uint32 { return r })
	require.Greaterf(t, redMean, 20000.0,
		"F29: screen blend injects red into the blue plate (red mean %.0f; pure blue = 0)", redMean)

	// -- 5. TRANSFORM-ORIGIN verdicts (F29, both bars rotated 90°) --
	// bar TL: x∈[760,1000] y∈[100,160], origin (760,100) → rotates into
	//   x∈[700,760] y∈[100,340] (vertical strip LEFT of its original left edge)
	// bar C: same geometry at y∈[300,360], origin center (880,330) → stays
	//   around x∈[850,910] y∈[300,540] (in-place vertical bar)
	tlStrip := func(img image.Image) int { return tcbCountBox(img, 660, 760, 80, 380, tcbIsGreen) }
	tlOldBox := func(img image.Image) int { return tcbCountBox(img, 780, 1010, 90, 170, tcbIsGreen) }
	// center-bar flanks: at F0 the horizontal bar fills x∈[760,1000] at
	// y∈[300,360]; after a 90° CENTER rotation it collapses to the narrow
	// vertical strip x∈[850,910] — both flanks must empty out (a center
	// rotation keeps the bar crossing its own center, so "old box empty"
	// does NOT hold here; the collapse is the observable).
	cLeftFlank := func(img image.Image) int { return tcbCountBox(img, 770, 840, 300, 360, tcbIsGreen) }
	cRightFlank := func(img image.Image) int { return tcbCountBox(img, 920, 1000, 300, 360, tcbIsGreen) }
	cStrip := func(img image.Image) int { return tcbCountBox(img, 840, 920, 290, 570, tcbIsGreen) }

	require.Greaterf(t, tlStrip(f29), 8000, "F29 TL bar: rotated INTO the left vertical strip (got %d px)", tlStrip(f29))
	require.Zerof(t, tlOldBox(f29), "F29 TL bar: original horizontal box empty after 90° top-left rotation")
	require.Greaterf(t, cStrip(f29), 8000, "F29 center bar: in-place vertical bar after 90° center rotation (got %d px)", cStrip(f29))
	// AA tolerance 500: the rotated bar's ends brush the flank boxes' edges
	// (~49 AA px measured); a FULL flank is ~6600 px, so <500 proves collapse.
	require.Lessf(t, cLeftFlank(f29), 500, "F29 center bar: LEFT flank collapsed by the 90° center rotation (got %d px)", cLeftFlank(f29))
	require.Lessf(t, cRightFlank(f29), 500, "F29 center bar: RIGHT flank collapsed by the 90° center rotation (got %d px)", cRightFlank(f29))
	// The two distributions are structurally different (the whole point):
	// TL moved ~100px LEFT of its box; center collapsed INSIDE its box span.
	require.Zerof(t, tcbCountBox(f29, 660, 760, 420, 570, tcbIsGreen), "the two rotated bars live in disjoint bands")

	// F0 sanity: bars unrotated (rotation 0), green in their original boxes.
	require.Greaterf(t, tcbCountBox(f0, 760, 1010, 90, 170, tcbIsGreen), 10000, "F0 TL bar unrotated in its box")
	require.Greaterf(t, tcbCountBox(f0, 760, 1010, 290, 370, tcbIsGreen), 10000, "F0 center bar unrotated in its box")
	require.Greaterf(t, cLeftFlank(f0), 4000, "F0 center bar's left flank full before rotation starts")
	require.Zerof(t, tlStrip(f0), "F0: left strip empty before rotation starts")

	// -- 6. artifacts --
	_, thisFile, _, _ := runtime.Caller(0)
	outDir := filepath.Join(filepath.Dir(thisFile), "transform-clip-blend", "VS-TCB")
	require.NoError(t, os.MkdirAll(outDir, 0o755))
	for fr, pngBytes := range samples {
		p := filepath.Join(outDir, fmt.Sprintf("frame-F%03d.png", fr))
		require.NoError(t, os.WriteFile(p, pngBytes, 0o644))
	}
	t.Logf("artifacts: %s (3 sample PNGs)", outDir)
}
