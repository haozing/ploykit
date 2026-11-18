package videoapp

// Design-batch-2 write gates: word-level text reveal, gradient text fills and
// the breathing-glow effect (2026-11-18). Same philosophy as the styling layer
// — reject what would silently render "successfully but wrong".

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func revealIR() *IR {
	ir := validIR()
	ir.Meta.DurationSec = 3
	ir.Elements = []Element{
		{ID: "t1", Type: ElementText, Text: "OCEAN WORLD", X: 60, Y: 60, W: 960, H: 160, Z: 2, FontSize: 100},
		{ID: "s1", Type: ElementShape, X: 0, Y: 0, W: 1080, H: 1920, Z: 0},
	}
	return ir
}

func TestValidate_TextReveal(t *testing.T) {
	at := 10
	ir := revealIR()
	ir.Elements[0].TextReveal = &TextReveal{Style: "rise", AtFrame: &at, DurationFrames: 12, StaggerFrames: 3, Easing: "power3.out", Distance: 50}
	require.NoError(t, Validate(ir))

	ir.Elements[0].TextReveal = &TextReveal{Style: "pop"}
	require.NoError(t, Validate(ir), "pop with defaults must pass")

	cases := []struct {
		name    string
		mutate  func(*IR)
		wantSub string
	}{
		{"on shape", func(ir *IR) { ir.Elements[1].TextReveal = &TextReveal{Style: "rise"} }, "only valid on text"},
		{"bad style", func(ir *IR) { ir.Elements[0].TextReveal = &TextReveal{Style: "spin"} }, "rise|pop"},
		{"negative stagger", func(ir *IR) { ir.Elements[0].TextReveal = &TextReveal{Style: "rise", StaggerFrames: -1} }, "staggerFrames"},
		{"huge duration", func(ir *IR) { ir.Elements[0].TextReveal = &TextReveal{Style: "rise", DurationFrames: 500} }, "durationFrames"},
		{"bad easing", func(ir *IR) { ir.Elements[0].TextReveal = &TextReveal{Style: "rise", Easing: "bounce"} }, "easing"},
		{"negative distance", func(ir *IR) { ir.Elements[0].TextReveal = &TextReveal{Style: "rise", Distance: -5} }, "distance"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ir := revealIR()
			tc.mutate(ir)
			err := Validate(ir)
			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.wantSub)
		})
	}
}

func TestValidate_TextGradient(t *testing.T) {
	ir := revealIR()
	ir.Elements[0].TextGradient = &Gradient{Type: "linear", Angle: 180, Stops: []GradientStop{
		{Offset: 0, Color: "#FFF6E5"}, {Offset: 1, Color: "#FFC978"},
	}}
	require.NoError(t, Validate(ir))

	// The browser-verified trap: gradient + stroke hollows the glyphs out.
	ir.Elements[0].StrokeColor = "#052430"
	ir.Elements[0].StrokeWidth = 8
	err := Validate(ir)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "mutually exclusive")

	ir = revealIR()
	ir.Elements[1].TextGradient = &Gradient{Type: "linear", Stops: []GradientStop{
		{Offset: 0, Color: "#fff"}, {Offset: 1, Color: "#000"}}}
	err = Validate(ir)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "only valid on text")

	ir = revealIR()
	ir.Elements[0].TextGradient = &Gradient{Type: "linear", Stops: []GradientStop{{Offset: 0, Color: "#fff"}}}
	err = Validate(ir)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "at least 2 stops")
}

func TestValidate_GroupScale(t *testing.T) {
	one, oneFive := 1.0, 1.5
	ir := revealIR()
	ir.Elements[1].Animations = []ElementAnimation{{
		ID: "gs", Type: "groupScale", FromValue: &one, ToValue: &oneFive,
		Pivot: &Point{X: 540, Y: 460}, DurationFrames: 20, Easing: "power1.out", AtFrame: intPtr(0),
	}}
	require.NoError(t, Validate(ir))

	ir.Elements[1].Animations[0].Pivot = nil
	err := Validate(ir)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "requires a canvas pivot")

	ir.Elements[1].Animations[0].Pivot = &Point{X: 540, Y: 460}
	ir.Elements[1].Animations[0].FromValue = nil
	err = Validate(ir)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "fromValue and toValue")
}

func TestValidate_Tilt(t *testing.T) {
	ir := revealIR()
	ir.Elements[1].Animations = []ElementAnimation{{
		ID: "tilt1", Type: "tilt",
		From: &Point{X: 0, Y: 0}, To: &Point{X: 0, Y: 30},
		Pivot: &Point{X: 540, Y: 460}, DurationFrames: 20, Easing: "power2.inOut",
	}}
	require.NoError(t, Validate(ir))

	ir.Elements[1].Animations[0].To = nil
	err := Validate(ir)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "tilt requires from and to")

	ir.Elements[1].Animations[0].To = &Point{X: 0, Y: 30}
	ir.Elements[1].Animations[0].Pivot = &Point{X: 540, Y: 460}
	require.NoError(t, Validate(ir), "pivot is optional")
}

func TestValidate_GlowEffect(t *testing.T) {
	ir := revealIR()
	ir.Effects = []Effect{{
		ID: "fx_glow", Type: EffectGlow, TargetElementID: "t1",
		AtFrame: intPtr(5),
		Params:  []byte(`{"color":"rgba(46,196,182,0.9)","blurMin":12,"blurMax":40,"periodFrames":60}`),
	}}
	require.NoError(t, Validate(ir))

	// No target: nothing to glow.
	ir.Effects[0].TargetElementID = ""
	err := Validate(ir)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "requires a targetElementId")

	// Unknown param still rejected by the shared params gate.
	ir.Effects[0].TargetElementID = "t1"
	ir.Effects[0].Params = []byte(`{"blurr":12}`)
	err = Validate(ir)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unknown param for effect type glow")
}

func intPtr(i int) *int { return &i }
