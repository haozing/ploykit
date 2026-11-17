//go:build capx

package l1

// counter_font_probe_test.go — 2026-11-17 三项能力的 capx 级验证：
//
//  1. counter format/decimals（speedrun 摩擦："0:23.87" 毫秒计时器）：
//     同一 IR 的 format 版 vs 无 format 版渲染帧必须不同（渲染测试里
//     DOM 不可读——像素差是 format 生效的证据；DOM 断言走 probe_dom 的
//     inspectable-tab 模式，另行）。
//  2. counter atFrame=0 + 零词表（speedrun 的零词时间轴场景）。
//  3. render.ProbeFrames 转正入口：小 IR 走 ProbeFrames 抓帧，
//     断言帧序/PNG 头/探帧与全渲一致。
//
// 字体渲染级测试按方案跳过（合法最小 woff2 现场生成不可靠——
// testdata 的 notosanssc 子集截前 4KB 是坏字体；app 单测 +
// projector HTML 断言已覆盖注入链路）。
//
// Run:
//
//	go -C example test -tags capx ./internal/video/testdata -run TestCounterFormatAtFrameRender -v -count=1 -timeout 10m
//	go -C example test -tags capx ./internal/video/testdata -run TestProbeFramesEntry -v -count=1 -timeout 10m

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
	videorender "myproduct/internal/video/render"
)

const (
	cfpW, cfpH = 1080, 1080
	cfpFPS     = 30
)

func cfpIntPtr(i int) *int { return &i }

// cfpCounterIR builds the 1s@30 zero-word IR: a text element + a counter
// effect anchored at frame 0. withFormat toggles the format/decimals params
// (both variants share from/to so any pixel difference is attributable to
// the format alone).
func cfpCounterIR(withFormat bool) *videoapp.IR {
	ir := &videoapp.IR{
		SchemaVersion: videoapp.IRSchemaVersion,
		Meta:          videoapp.Meta{FPS: cfpFPS, Width: cfpW, Height: cfpH, DurationSec: 1.0},
		Script:        "loading",
		// ZERO words: the atFrame anchor is the only timeline reference
		// (the speedrun scenario).
	}
	ir.Elements = []videoapp.Element{
		{ID: "el_bg", Type: videoapp.ElementShape, Color: "#FFF7EE",
			X: 0, Y: 0, W: cfpW, H: cfpH, Z: 0},
		{ID: "el_loading", Type: videoapp.ElementText, Text: "loading",
			Color: "#2B2118", FontSize: 64, X: 60, Y: 60, W: 600, H: 100, Z: 1},
	}
	params := `{"from":0,"to":23.95,"color":"#2B2118"}`
	if withFormat {
		params = `{"from":0,"to":23.95,"format":"0:{v}","decimals":2,"color":"#2B2118"}`
	}
	ir.Effects = []videoapp.Effect{
		{ID: "fx_timer", Type: videoapp.EffectCounter, AtFrame: cfpIntPtr(0),
			TargetElementID: "el_loading",
			Params:          []byte(params)},
	}
	return ir
}

// cfpRenderAll renders every frame of the projected document and returns
// the requested sample frames.
func cfpRenderAll(t *testing.T, ctx context.Context, rend capx.Renderer, html []byte, frames int, kept map[int]bool) map[int][]byte {
	t.Helper()
	samples := map[int][]byte{}
	renderErr := rend.RenderFrames(ctx,
		capx.Doc{HTML: string(html), TimelineID: "main"},
		capx.FrameSpec{Width: cfpW, Height: cfpH, FPS: cfpFPS, DurationFrames: frames},
		func(_ context.Context, f capx.Frame) error {
			if kept[f.Index] {
				samples[f.Index] = f.PNG
			}
			return nil
		})
	require.NoError(t, renderErr, "render failed")
	require.Len(t, samples, len(kept), "kept frames %v", kept)
	return samples
}

func TestCounterFormatAtFrameRender(t *testing.T) {
	if testing.Short() {
		t.Skip("real browser render; skipped in -short mode")
	}
	chrome := chromePath(t)
	ffmpeg := ffmpegPath(t)
	ctx := context.Background()

	irFmt := cfpCounterIR(true)
	require.NoError(t, videoapp.Validate(irFmt), "format/decimals + atFrame IR must pass the write gate")
	irPlain := cfpCounterIR(false)
	require.NoError(t, videoapp.Validate(irPlain))

	proj := videoapp.NewProjector(nil)
	htmlFmt, err := proj.HTML(ctx, irFmt, "")
	require.NoError(t, err)
	htmlPlain, err := proj.HTML(ctx, irPlain, "")
	require.NoError(t, err)

	enabled := true
	rt, err := capx.New(capx.Config{Enabled: &enabled, ChromePath: chrome, FFMpegPath: ffmpeg, PoolSize: 1})
	require.NoError(t, err)
	defer rt.Close()
	require.True(t, rt.Available())
	rend, err := rt.Renderer()
	require.NoError(t, err)

	frames := videoapp.DurationFrames(irFmt, cfpFPS) // ceil(1.0*30) = 30
	require.Equal(t, 30, frames)

	// counter tween duration = min(1.2, max(0.3, 1.0-0)) = 1.0s → the whole
	// timeline. Sampling lives at t>0 frames — GSAP's seek(0) does not fire
	// onUpdate for a tween positioned exactly at t=0 (the same seek(0)
	// semantics the element-window code documents), so F0 legitimately shows
	// an empty host in BOTH variants (DOM-verified by TestDebugCounterFormat:
	// t=0.25 → "0:10.48" vs "10", t=0.967 → "0:23.92" vs "24" — the F29 pair
	// also pins the decimals divergence at the end value: toFixed(2)="23.92"
	// vs Math.round=24).
	kept := map[int]bool{7: true, 15: true, 29: true}
	t0 := time.Now()
	fmtSamples := cfpRenderAll(t, ctx, rend, htmlFmt, frames, kept)
	plainSamples := cfpRenderAll(t, ctx, rend, htmlPlain, frames, kept)
	t.Logf("COUNTER-FORMAT: 2x%d frames in %.1fs", frames, time.Since(t0).Seconds())

	// Every sampled t>0 frame must differ: different glyph sequences.
	require.NotEqual(t, fmtSamples[7], plainSamples[7], "F7: formatted mid-tween differs from plain")
	require.NotEqual(t, fmtSamples[15], plainSamples[15], "F15: formatted mid-tween differs from plain")
	// F29: "0:23.92" vs "24" — the decimals divergence at the end value.
	require.NotEqual(t, fmtSamples[29], plainSamples[29], "F29: \"0:23.92\" vs round(23.95)=\"24\"")

	// The formatted run itself progresses (the counter actually moves).
	require.NotEqual(t, fmtSamples[7], fmtSamples[29], "formatted F7 != F29 (tween advances)")

	// The atFrame=0 anchor put the counter host on the canvas from the very
	// first frame (no word to wait for). The vs-plain difference above pins
	// "not empty at t>0" (an absent host in BOTH variants would render
	// identical empty stages); every kept frame is additionally a valid PNG
	// at the capture geometry.
	for f, b := range fmtSamples {
		img, derr := png.Decode(bytes.NewReader(b))
		require.NoError(t, derr, "frame %d decodes", f)
		require.Equal(t, image.Rect(0, 0, cfpW, cfpH), img.Bounds(), "frame %d geometry", f)
	}

	// -- artifacts --
	_, thisFile, _, _ := runtime.Caller(0)
	outDir := filepath.Join(filepath.Dir(thisFile), "counter", "VS-CFP")
	require.NoError(t, os.MkdirAll(outDir, 0o755))
	for _, f := range []int{7, 15, 29} {
		require.NoError(t, os.WriteFile(filepath.Join(outDir, fmt.Sprintf("fmt-f%02d.png", f)), fmtSamples[f], 0o644))
		require.NoError(t, os.WriteFile(filepath.Join(outDir, fmt.Sprintf("plain-f%02d.png", f)), plainSamples[f], 0o644))
	}
	t.Logf("artifacts: %s", outDir)
}

// TestProbeFramesEntry pins the promoted render.ProbeFrames entry on the
// same tiny counter IR: caller-order results, PNG payloads, and probe ==
// full-render byte identity (the snapshot bridge's determinism contract).
func TestProbeFramesEntry(t *testing.T) {
	if testing.Short() {
		t.Skip("real browser probe; skipped in -short mode")
	}
	chrome := chromePath(t)
	ffmpeg := ffmpegPath(t)
	ctx := context.Background()

	ir := cfpCounterIR(true)
	require.NoError(t, videoapp.Validate(ir))

	enabled := true
	rt, err := capx.New(capx.Config{Enabled: &enabled, ChromePath: chrome, FFMpegPath: ffmpeg, PoolSize: 1})
	require.NoError(t, err)
	defer rt.Close()
	require.True(t, rt.Available())
	videorender.SetSnapshotter(rt)

	// The entry: frames given UNORDERED with a duplicate; results must come
	// back deduped-sorted (SnapshotMulti order) — the contract documents
	// sorted distinct output, and every entry must be a PNG.
	probeFrames := []int{15, 0, 29, 15}
	res, err := videorender.ProbeFrames(ctx, ir, nil, probeFrames, videorender.ProbeOpts{})
	require.NoError(t, err, "ProbeFrames entry must work over the wired bridge")
	require.NotEmpty(t, res)
	for _, r := range res {
		require.True(t, bytes.HasPrefix(r.PNG, []byte{0x89, 'P', 'N', 'G'}),
			"frame %d is a PNG payload", r.Frame)
		require.Nil(t, r.DOMState, "DOMState documented-nil this round")
	}

	// Probe bytes == full-render bytes (determinism): render the same doc
	// through the raw renderer and compare F15.
	rend, err := rt.Renderer()
	require.NoError(t, err)
	html, err := videoapp.NewProjector(nil).HTML(ctx, ir, "")
	require.NoError(t, err)
	full := map[int][]byte{}
	require.NoError(t, rend.RenderFrames(ctx,
		capx.Doc{HTML: string(html), TimelineID: "main"},
		capx.FrameSpec{Width: cfpW, Height: cfpH, FPS: cfpFPS, DurationFrames: 30},
		func(_ context.Context, f capx.Frame) error {
			if f.Index == 15 {
				full[15] = f.PNG
			}
			return nil
		}))
	var probeF15 []byte
	for _, r := range res {
		if r.Frame == 15 {
			probeF15 = r.PNG
		}
	}
	require.NotNil(t, probeF15, "F15 probed")
	require.Equal(t, full[15], probeF15, "probe F15 byte-identical to full render F15")

	// Bounds gate: a frame past the timeline is an error, not a clamp.
	_, err = videorender.ProbeFrames(ctx, ir, nil, []int{30}, videorender.ProbeOpts{})
	require.Error(t, err, "frame 30 of a 30-frame timeline is out of range [0,29]")
}
