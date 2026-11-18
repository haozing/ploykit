package videoapp

// Beat-grid temporal model tests (2026-11-18, hypit-inspired): a composition
// carries its musical grid + named moments, layers anchor by name, and the
// projector resolves everything to flat frames.

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func beatIR() *IR {
	ir := validIR()
	ir.Meta.FPS = 30
	ir.Meta.DurationSec = 8
	ir.Beats = &BeatGrid{
		BPM: 120, PhaseFrame: 0, Bars: 4,
		Moments: []BeatMoment{
			{ID: "title-hit", Bar: 2, Beat: 0},
			{ID: "half-beat", Bar: 0, Beat: 3.5},
		},
	}
	ir.Elements = []Element{
		{ID: "t1", Type: ElementText, Text: "WORD", X: 0, Y: 0, W: 400, H: 80, Z: 1, FontSize: 40},
	}
	return ir
}

func TestBeatFrame_Math(t *testing.T) {
	g := &BeatGrid{BPM: 120, PhaseFrame: 0, Bars: 4,
		Moments: []BeatMoment{{ID: "m", Bar: 2, Beat: 0}}}

	bar0beat3 := 3.0
	f, err := BeatFrame(irWithGrid(g), &BeatRef{Bar: intPtr(0), Beat: &bar0beat3})
	require.NoError(t, err)
	assert.Equal(t, 45, f, "120bpm@30fps: 1 beat = 15 frames, beat 3 = frame 45")

	f, err = BeatFrame(irWithGrid(g), &BeatRef{Moment: "m"})
	require.NoError(t, err)
	assert.Equal(t, 120, f, "bar 2 beat 0 = 8 beats = frame 120")

	// Fractional beat (the "and" of 3): 3.5 * 15 = 52.5 → 53.
	half := 3.5
	f, err = BeatFrame(irWithGrid(g), &BeatRef{Bar: intPtr(0), Beat: &half})
	require.NoError(t, err)
	assert.Equal(t, 53, f, "half-beat rounds to the nearest frame")

	// Phase + offset.
	g.PhaseFrame = 10
	f, err = BeatFrame(irWithGrid(g), &BeatRef{Moment: "m", OffsetFrames: -5})
	require.NoError(t, err)
	assert.Equal(t, 125, f)

	_, err = BeatFrame(irWithGrid(g), &BeatRef{Moment: "nope"})
	require.Error(t, err)
}

// TestBeatGrid_ShowcaseParity pins the JS mirror in tool-site's
// web/scripts/showcase-grid.mjs: the showcase's 10 sticker pops must resolve to
// exactly these frames. If the Go formula changes, this test and the JS helper
// must be updated together (the IR's windows are frame numbers written by JS).
func TestBeatGrid_ShowcaseParity(t *testing.T) {
	g := &BeatGrid{BPM: 120, PhaseFrame: 0, Bars: 4}
	pops := [][2]float64{{0, 3}, {0, 3.5}, {1, 0}, {1, 0.5}, {1, 1}, {1, 1.5}, {1, 2}, {1, 2.5}, {1, 3}, {1, 3.5}}
	want := []int{45, 53, 60, 68, 75, 83, 90, 98, 105, 113}
	got := make([]int, 0, len(pops))
	for _, p := range pops {
		bar, beat := int(p[0]), p[1]
		f, err := BeatFrame(irWithGrid(g), &BeatRef{Bar: &bar, Beat: &beat})
		require.NoError(t, err)
		got = append(got, f)
	}
	assert.Equal(t, want, got)
}

func TestBeatMoment_WordAnchor(t *testing.T) {
	ir := beatIR()
	ir.Words = []Word{
		{Index: 0, Text: "Ocean", Start: 4.0, End: 4.3, Source: WordSourceManual},
		{Index: 1, Text: "World", Start: 4.3, End: 4.6, Source: WordSourceManual},
	}
	ir.Beats.Moments = []BeatMoment{
		{ID: "title-hit", Word: &Anchor{Text: "Ocean"}},
		{ID: "second", Word: &Anchor{Text: "World"}},
	}
	ir.Beats.Bars = 4
	ir.Elements[0].Animations = []ElementAnimation{{
		ID: "a1", Type: "scaleIn", FromValue: f64Ptr(0.5), ToValue: f64Ptr(1),
		DurationFrames: 10, AtBeat: &BeatRef{Moment: "title-hit"},
	}}
	require.NoError(t, Validate(ir))
	require.NoError(t, ResolveBeats(ir))
	assert.Equal(t, 120, *ir.Elements[0].Animations[0].AtFrame, "word Ocean at 4.0s = frame 120")

	f, err := BeatFrame(ir, &BeatRef{Moment: "second"})
	require.NoError(t, err)
	assert.Equal(t, 129, f, "word World at 4.3s = frame 129")

	// Word missing from the script: rejected at write time.
	ir.Beats.Moments[0].Word = &Anchor{Text: "Ghost"}
	err = Validate(ir)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not found in words")
}

func TestValidate_BeatRefs(t *testing.T) {
	bar, beat := 1, 2.0

	// Happy path: bar/beat anchor resolves and validates.
	ir := beatIR()
	ir.Elements[0].Animations = []ElementAnimation{{
		ID: "a1", Type: "scaleIn", FromValue: f64Ptr(0.5), ToValue: f64Ptr(1),
		DurationFrames: 10, AtBeat: &BeatRef{Bar: &bar, Beat: &beat},
	}}
	require.NoError(t, Validate(ir))

	// atBeat + startAnchor: rejected.
	ir.Elements[0].Animations[0].StartAnchor = &Anchor{Text: "word"}
	err := Validate(ir)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "mutually exclusive")
	ir.Elements[0].Animations[0].StartAnchor = nil

	// Unknown moment.
	ir.Elements[0].Animations[0].AtBeat = &BeatRef{Moment: "ghost"}
	err = Validate(ir)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unknown beat moment")

	// Bar out of the declared bar count.
	badBar := 9
	ir.Elements[0].Animations[0].AtBeat = &BeatRef{Bar: &badBar, Beat: &beat}
	err = Validate(ir)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "bar must be within")

	// atFrame disagreeing with the grid.
	ir = beatIR()
	ir.Elements[0].Animations = []ElementAnimation{{
		ID: "a1", Type: "scaleIn", FromValue: f64Ptr(0.5), ToValue: f64Ptr(1),
		DurationFrames: 10, AtFrame: intPtr(99), AtBeat: &BeatRef{Bar: &bar, Beat: &beat},
	}}
	err = Validate(ir)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "disagrees with the beat grid")

	// Beat anchor without a grid.
	ir = beatIR()
	ir.Beats = nil
	ir.Elements[0].Animations = []ElementAnimation{{
		ID: "a1", Type: "scaleIn", FromValue: f64Ptr(0.5), ToValue: f64Ptr(1),
		DurationFrames: 10, AtBeat: &BeatRef{Bar: &bar, Beat: &beat},
	}}
	err = Validate(ir)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "requires a beats grid")
}

func TestResolveBeats_Idempotent(t *testing.T) {
	ir := beatIR()
	ir.Elements[0].Animations = []ElementAnimation{{
		ID: "a1", Type: "scaleIn", FromValue: f64Ptr(0.5), ToValue: f64Ptr(1),
		DurationFrames: 10, AtBeat: &BeatRef{Moment: "title-hit"},
	}}
	require.NoError(t, Validate(ir))
	require.NoError(t, ResolveBeats(ir))
	require.NotNil(t, ir.Elements[0].Animations[0].AtFrame)
	assert.Equal(t, 120, *ir.Elements[0].Animations[0].AtFrame)
	// Re-resolve + re-validate: agreement rule keeps it clean.
	require.NoError(t, ResolveBeats(ir))
	require.NoError(t, Validate(ir))
}

func TestProjector_BeatAnchorsBecomeFrames(t *testing.T) {
	ir := beatIR()
	ir.Elements[0].Animations = []ElementAnimation{{
		ID: "a1", Type: "scaleIn", FromValue: f64Ptr(0.5), ToValue: f64Ptr(1),
		DurationFrames: 10, AtBeat: &BeatRef{Moment: "title-hit"},
	}}
	require.NoError(t, Validate(ir))
	html, err := NewProjector(nil).HTML(context.Background(), ir, "")
	require.NoError(t, err)

	marker := "id=\"ploykit-ir\">"
	start := strings.Index(string(html), marker) + len(marker)
	end := strings.Index(string(html)[start:], "</script>")
	var payload map[string]any
	require.NoError(t, json.Unmarshal([]byte(string(html)[start:start+end]), &payload))

	els := payload["elements"].([]any)
	anims := els[0].(map[string]any)["animations"].([]any)
	an := anims[0].(map[string]any)
	assert.EqualValues(t, 120, an["atFrame"], "beat anchor projected as a flat frame")
	_, hasBeat := an["atBeat"]
	assert.False(t, hasBeat, "atBeat stays out of the builder payload")
}

func f64Ptr(f float64) *float64 { return &f }

// irWithGrid wraps a grid into a minimal IR for BeatFrame calls.
func irWithGrid(g *BeatGrid) *IR {
	return &IR{Meta: Meta{FPS: 30}, Beats: g}
}
