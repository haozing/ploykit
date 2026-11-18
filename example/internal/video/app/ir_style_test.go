package videoapp

// Visual styling layer write-gate tests (2026-11-18, design-pass batch):
// text typography (brand font / weight / tracking / stroke / shadow), shape
// gradients/radius and static opacity. These are the fields the gallery
// showcase batch needed and the 11-clip replication kept baking into PNGs.

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// styleIR builds a minimal valid IR carrying one text + one shape element so
// each test can flip exactly one styling field.
func styleIR() *IR {
	ir := validIR()
	ir.Meta.DurationSec = 2
	ir.Elements = []Element{
		{ID: "t1", Type: ElementText, Text: "OCEAN WORLD", X: 60, Y: 60, W: 960, H: 200, Z: 2, FontSize: 104},
		{ID: "s1", Type: ElementShape, X: 0, Y: 0, W: 1080, H: 1920, Z: 0},
	}
	return ir
}

func TestValidate_Styling_AcceptsFullTextTreatment(t *testing.T) {
	ir := styleIR()
	ir.FontAssets = []FontAsset{{Key: "video/ws-1/assets/f/baloo.woff2", Family: "Baloo 2", Weight: "400 900"}}
	ir.Elements[0].FontFamily = "Baloo 2"
	ir.Elements[0].FontWeight = 800
	ir.Elements[0].LetterSpacing = 2
	ir.Elements[0].LineHeight = 1.05
	ir.Elements[0].TextAlign = "center"
	ir.Elements[0].StrokeColor = "#062b3a"
	ir.Elements[0].StrokeWidth = 10
	ir.Elements[0].TextShadow = &TextShadow{Color: "rgba(46,196,182,0.55)", X: 0, Y: 8, Blur: 42}
	ir.Elements[0].Opacity = 0.9
	require.NoError(t, Validate(ir))

	ir.Elements[1].Gradient = &Gradient{Type: "linear", Angle: 180, Stops: []GradientStop{
		{Offset: 0, Color: "#062a3c"}, {Offset: 1, Color: "#0a1620"},
	}}
	radius := 48.0
	ir.Elements[1].Radius = &radius
	require.NoError(t, Validate(ir), "gradient backdrop + pill radius must pass")
}

func TestValidate_Styling_Rejections(t *testing.T) {
	cases := []struct {
		name    string
		mutate  func(*IR)
		wantSub string
	}{
		{"unregistered family", func(ir *IR) { ir.Elements[0].FontFamily = "Comic Sans" }, "fontAssets"},
		{"builtin family ok", func(ir *IR) { ir.Elements[0].FontFamily = "Noto Sans SC Sub" }, ""},
		{"weight out of range", func(ir *IR) { ir.Elements[0].FontWeight = 1000 }, "100-900"},
		{"negative line height", func(ir *IR) { ir.Elements[0].LineHeight = -1 }, "> 0"},
		{"bad text align", func(ir *IR) { ir.Elements[0].TextAlign = "justify" }, "left|center|right"},
		{"stroke color without width", func(ir *IR) { ir.Elements[0].StrokeColor = "#fff" }, "set together"},
		{"stroke width without color", func(ir *IR) { ir.Elements[0].StrokeWidth = 4 }, "set together"},
		{"stroke color injection", func(ir *IR) {
			ir.Elements[0].StrokeColor = "red;position:fixed"
			ir.Elements[0].StrokeWidth = 4
		}, "strokeColor"},
		{"shadow negative blur", func(ir *IR) {
			ir.Elements[0].TextShadow = &TextShadow{Blur: -3}
		}, "blur"},
		{"shadow color injection", func(ir *IR) {
			ir.Elements[0].TextShadow = &TextShadow{Color: "url(javascript:1)"}
		}, "textShadow.color"},
		{"opacity above 1", func(ir *IR) { ir.Elements[1].Opacity = 1.5 }, "0..1"},
		{"negative radius", func(ir *IR) { r := -1.0; ir.Elements[1].Radius = &r }, ">= 0"},
		{"radius past half", func(ir *IR) {
			ir.Elements[1].W, ir.Elements[1].H = 200, 100
			r := 60.0
			ir.Elements[1].Radius = &r
		}, "min(w,h)/2"},
		{"gradient one stop", func(ir *IR) {
			ir.Elements[1].Gradient = &Gradient{Type: "linear", Stops: []GradientStop{{Offset: 0, Color: "#fff"}}}
		}, "at least 2 stops"},
		{"gradient bad type", func(ir *IR) {
			ir.Elements[1].Gradient = &Gradient{Type: "conic", Stops: []GradientStop{
				{Offset: 0, Color: "#fff"}, {Offset: 1, Color: "#000"}}}
		}, "linear|radial"},
		{"gradient decreasing offsets", func(ir *IR) {
			ir.Elements[1].Gradient = &Gradient{Type: "linear", Stops: []GradientStop{
				{Offset: 0.8, Color: "#fff"}, {Offset: 0.2, Color: "#000"}}}
		}, "non-decreasing"},
		{"gradient color injection", func(ir *IR) {
			ir.Elements[1].Gradient = &Gradient{Type: "linear", Stops: []GradientStop{
				{Offset: 0, Color: "red);}body{display:none"}, {Offset: 1, Color: "#000"}}}
		}, "stops[0].color"},
		{"radial center out of range", func(ir *IR) {
			ir.Elements[1].Gradient = &Gradient{Type: "radial", AtX: 140, Stops: []GradientStop{
				{Offset: 0, Color: "#fff"}, {Offset: 1, Color: "#000"}}}
		}, "atX/atY"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ir := styleIR()
			tc.mutate(ir)
			err := Validate(ir)
			if tc.wantSub == "" {
				require.NoError(t, err)
				return
			}
			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.wantSub)
		})
	}
}

func TestElementMap_StylingPassthroughOnlyWhenSet(t *testing.T) {
	// Legacy element: no styling keys in the builder payload (byte-identical
	// projection rule).
	plain := elementMap(Element{ID: "e", Type: ElementShape, X: 0, Y: 0, W: 10, H: 10})
	for _, k := range []string{"fontFamily", "fontWeight", "letterSpacing", "lineHeight",
		"textAlign", "strokeColor", "strokeWidth", "textShadow", "opacity", "radius", "gradient"} {
		_, has := plain[k]
		assert.Falsef(t, has, "legacy element must not project %q", k)
	}

	fam := "Baloo 2"
	rad := 32.0
	styled := elementMap(Element{
		ID: "e", Type: ElementText, Text: "x", X: 0, Y: 0, W: 10, H: 10,
		FontFamily: fam, FontWeight: 800, LetterSpacing: 2, LineHeight: 1.05,
		TextAlign: "center", StrokeColor: "#000", StrokeWidth: 8,
		TextShadow: &TextShadow{Blur: 20}, Opacity: 0.5, Radius: &rad,
		Gradient: &Gradient{Type: "radial", AtX: 50, AtY: 30, Stops: []GradientStop{
			{Offset: 0, Color: "#fff"}, {Offset: 1, Color: "#000"}}},
	})
	assert.Equal(t, fam, styled["fontFamily"])
	assert.Equal(t, 800.0, styled["fontWeight"])
	assert.Equal(t, 2.0, styled["letterSpacing"])
	assert.Equal(t, 1.05, styled["lineHeight"])
	assert.Equal(t, "center", styled["textAlign"])
	assert.Equal(t, "#000", styled["strokeColor"])
	assert.Equal(t, 8.0, styled["strokeWidth"])
	assert.Equal(t, 0.5, styled["opacity"])
	assert.Equal(t, 32.0, styled["radius"])
	_, hasShadow := styled["textShadow"]
	assert.True(t, hasShadow)
	_, hasGrad := styled["gradient"]
	assert.True(t, hasGrad)
}
