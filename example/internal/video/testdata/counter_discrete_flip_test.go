//go:build capx

package l1

// Discrete counter flip exactness (v0.33.2). The studio live-count chain
// found two failure modes of the v0.33.1 heuristic duration on dense
// chains: overlapping tween onUpdate races (count runs AHEAD — speedrun)
// and the end-stamp landing at at+1.2s (flip LAGS 36 frames — studio,
// compensated with atFrame-36 at the time). v0.33.2 splits the builder:
// from==to segments are a single zero-duration tl.set AT the anchor frame —
// no tween, no overlap, flip exactly on the anchor frame. This test pins
// that: two discrete segments (at f10 → "3/30", at f20 → "7/30") on one
// text host; the flip must be visible AT the anchor frame, not before
// (ahead) and not after (lag).
//
// Run: go -C example test -tags capx ./internal/video/testdata -run TestCounterDiscreteFlipExact -v -count=1

import (
	"context"
	"testing"

	"github.com/haozing/ploykit/platform/capx"
	"github.com/stretchr/testify/require"
	videoapp "myproduct/internal/video/app"
)

func TestCounterDiscreteFlipExact(t *testing.T) {
	if testing.Short() {
		t.Skip("real browser render; skipped in -short mode")
	}
	chrome := chromePath(t)
	ffmpeg := ffmpegPath(t)
	ctx := context.Background()

	ir := &videoapp.IR{
		SchemaVersion: videoapp.IRSchemaVersion,
		Meta:          videoapp.Meta{FPS: cfpFPS, Width: cfpW, Height: cfpH, DurationSec: 1.0},
		Script:        "count",
	}
	// Host static text = the pre-flip value (the documented t=0 caveat: a
	// set at exactly 0 is not applied by seek(0), the element text carries
	// the initial state — same contract as visibility windows).
	ir.Elements = []videoapp.Element{
		{ID: "el_bg", Type: videoapp.ElementShape, Color: "#FFF7EE",
			X: 0, Y: 0, W: cfpW, H: cfpH, Z: 0},
		{ID: "el_cnt", Type: videoapp.ElementText, Text: "0/30",
			Color: "#2B2118", FontSize: 72, X: 60, Y: 60, W: 600, H: 120, Z: 1},
	}
	ir.Effects = []videoapp.Effect{
		{ID: "fx_a", Type: videoapp.EffectCounter, AtFrame: cfpIntPtr(10),
			TargetElementID: "el_cnt",
			Params:          []byte(`{"from":3,"to":3,"format":"{v}/30","color":"#2B2118"}`)},
		{ID: "fx_b", Type: videoapp.EffectCounter, AtFrame: cfpIntPtr(20),
			TargetElementID: "el_cnt",
			Params:          []byte(`{"from":7,"to":7,"format":"{v}/30","color":"#2B2118"}`)},
	}
	require.NoError(t, videoapp.Validate(ir))
	frames := videoapp.DurationFrames(ir, cfpFPS)
	require.Equal(t, 30, frames)

	proj := videoapp.NewProjector(nil)
	html, err := proj.HTML(ctx, ir, "")
	require.NoError(t, err)

	enabled := true
	rt, err := capx.New(capx.Config{Enabled: &enabled, ChromePath: chrome, FFMpegPath: ffmpeg, PoolSize: 1})
	require.NoError(t, err)
	defer rt.Close()
	require.True(t, rt.Available())
	rend, err := rt.Renderer()
	require.NoError(t, err)

	kept := map[int]bool{9: true, 10: true, 19: true, 20: true, 29: true}
	samples := cfpRenderAll(t, ctx, rend, html, frames, kept)
	require.Len(t, samples, 5)

	// Exactness contract, in bytes: the flip frame differs from its
	// predecessor (the value changed) AND equals the following hold frame
	// (no further change, no drift). Applied to both anchors.
	require.NotEqual(t, samples[9], samples[10], "f9 (0/30) vs f10 (3/30): flip must be visible AT the anchor frame")
	require.Equal(t, samples[10], samples[19], "f10..f19 hold: 3/30 unchanged (no overlap drift)")
	require.NotEqual(t, samples[19], samples[20], "f19 (3/30) vs f20 (7/30): second flip at its anchor")
	require.Equal(t, samples[20], samples[29], "f20..f29 hold: 7/30 unchanged")
}
