//go:build capx

package l1

// Regression: scaleIn/rotate from-leak at build time（2026-11-18，v2 冷开场）。
//
// GSAP 的 fromTo 默认 immediateRender=true：一个 at>0 的 scaleIn 会在 build 期
// 把 from 值写进元素。v1 的元素窗口都从落件帧才开始，所以"第 0 帧就可见"的
// 贴纸从没被这条路径覆盖。v2 冷开场要求成品房在第 0 帧完整出现——实测所有
// 贴纸在第 0 帧是 matrix(0.0988,...)（build pop 的 from 0.1 泄漏）。
//
// 本测试钉住修复后的语义：元素窗口 startFrame=0，scaleIn 在 f10 才从 0.1 起跳，
// 第 0 帧必须仍是原始 100×100 尺寸（不是 10×10）。
//
// Run:
//
//	go -C example test -tags capx ./internal/video/testdata -run TestScaleFromLeak -v -count=1 -timeout 5m

import (
	"bytes"
	"context"
	"image/png"
	"testing"

	"github.com/haozing/ploykit/platform/capx"
	"github.com/stretchr/testify/require"

	videoapp "myproduct/internal/video/app"
)

func TestScaleFromLeakAtFrameZero(t *testing.T) {
	if testing.Short() {
		t.Skip("real browser render; skipped in -short mode")
	}
	chrome := chromePath(t)
	ffmpeg := ffmpegPath(t)
	ctx := context.Background()

	at := 10
	ir := &videoapp.IR{
		SchemaVersion: videoapp.IRSchemaVersion,
		Meta:          videoapp.Meta{FPS: 30, Width: 360, Height: 360, DurationSec: 0.5},
		Elements: []videoapp.Element{
			{ID: "fl_bg", Type: videoapp.ElementShape, Color: "#000000", X: 0, Y: 0, W: 360, H: 360, Z: 0},
			{
				ID: "fl_box", Type: videoapp.ElementShape, Color: "#ffffff",
				X: 130, Y: 130, W: 100, H: 100, Z: 1,
				StartFrame: tcbIntPtr(0), EndFrame: tcbIntPtr(15),
				Animations: []videoapp.ElementAnimation{{
					ID: "fl_pop", Type: "scaleIn",
					FromValue: tcbF64Ptr(0.1), ToValue: tcbF64Ptr(1),
					DurationFrames: 3, Easing: "linear", AtFrame: tcbIntPtr(at),
				}},
			},
		},
	}
	require.NoError(t, videoapp.Validate(ir))

	proj := videoapp.NewProjector(nil)
	html, err := proj.HTML(ctx, ir, "")
	require.NoError(t, err)

	spec := capx.FrameSpec{Width: 360, Height: 360, FPS: 30, DurationFrames: 15}
	require.NoError(t, spec.Validate())

	enabled := true
	rt, err := capx.New(capx.Config{Enabled: &enabled, ChromePath: chrome, FFMpegPath: ffmpeg, PoolSize: 1})
	require.NoError(t, err)
	defer rt.Close()
	require.True(t, rt.Available())
	rend, err := rt.Renderer()
	require.NoError(t, err)

	var f0 []byte
	require.NoError(t, rend.RenderFrames(ctx,
		capx.Doc{HTML: string(html), TimelineID: "main"}, spec,
		func(_ context.Context, f capx.Frame) error {
			if f.Index == 0 {
				f0 = f.PNG
			}
			return nil
		}))
	require.NotNil(t, f0)

	img, err := png.Decode(bytes.NewReader(f0))
	require.NoError(t, err)
	white := 0
	for y := 0; y < 360; y++ {
		for x := 0; x < 360; x++ {
			r, g, b, _ := img.At(x, y).RGBA()
			if r>>8 > 200 && g>>8 > 200 && b>>8 > 200 {
				white++
			}
		}
	}
	// 100×100 = 10000 px；泄漏态 10×10 = ~100 px。阈值取中间，远离两端。
	require.Greaterf(t, white, 5000,
		"frame 0 must show the element at its static scale 1 (got %d white px — a from-leak would be ~100)", white)
}

// Same leak class for `move`: an element visible before an at>0 move sits at
// the move's `from` after build (disaster format: undo segment's from=scatter
// point appeared above/outside the card at frame 0). Frame 0 must show the
// element at its static (authored) top-left.
func TestMoveFromLeakAtFrameZero(t *testing.T) {
	if testing.Short() {
		t.Skip("real browser render; skipped in -short mode")
	}
	chrome := chromePath(t)
	ffmpeg := ffmpegPath(t)
	ctx := context.Background()

	ir := &videoapp.IR{
		SchemaVersion: videoapp.IRSchemaVersion,
		Meta:          videoapp.Meta{FPS: 30, Width: 360, Height: 360, DurationSec: 0.5},
		Elements: []videoapp.Element{
			{ID: "mv_bg", Type: videoapp.ElementShape, Color: "#000000", X: 0, Y: 0, W: 360, H: 360, Z: 0},
			{
				ID: "mv_box", Type: videoapp.ElementShape, Color: "#ffffff",
				X: 130, Y: 130, W: 100, H: 100, Z: 1,
				StartFrame: tcbIntPtr(0), EndFrame: tcbIntPtr(15),
				Animations: []videoapp.ElementAnimation{{
					ID: "mv_go", Type: "move",
					From: &videoapp.Point{X: 0, Y: 130}, To: &videoapp.Point{X: 130, Y: 130},
					DurationFrames: 3, Easing: "linear", AtFrame: tcbIntPtr(10),
				}},
			},
		},
	}
	require.NoError(t, videoapp.Validate(ir))

	proj := videoapp.NewProjector(nil)
	html, err := proj.HTML(ctx, ir, "")
	require.NoError(t, err)

	spec := capx.FrameSpec{Width: 360, Height: 360, FPS: 30, DurationFrames: 15}
	require.NoError(t, spec.Validate())
	enabled := true
	rt, err := capx.New(capx.Config{Enabled: &enabled, ChromePath: chrome, FFMpegPath: ffmpeg, PoolSize: 1})
	require.NoError(t, err)
	defer rt.Close()
	rend, err := rt.Renderer()
	require.NoError(t, err)

	var f0 []byte
	require.NoError(t, rend.RenderFrames(ctx,
		capx.Doc{HTML: string(html), TimelineID: "main"}, spec,
		func(_ context.Context, f capx.Frame) error {
			if f.Index == 0 {
				f0 = f.PNG
			}
			return nil
		}))
	require.NotNil(t, f0)
	img, err := png.Decode(bytes.NewReader(f0))
	require.NoError(t, err)

	whiteIn := func(x0, x1 int) int {
		n := 0
		for y := 130; y < 230; y++ {
			for x := x0; x < x1; x++ {
				r, g, b, _ := img.At(x, y).RGBA()
				if r>>8 > 200 && g>>8 > 200 && b>>8 > 200 {
					n++
				}
			}
		}
		return n
	}
	leak, static := whiteIn(0, 100), whiteIn(130, 230)
	require.Lessf(t, leak, 50, "frame 0 must not sit at the move's from (got %d white px at x=0..100)", leak)
	require.Greaterf(t, static, 9000, "frame 0 must show the box at its authored x=130 (got %d white px)", static)
}
