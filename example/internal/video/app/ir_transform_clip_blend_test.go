package videoapp

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"math"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// transformOrigin / clip / mixBlendMode — the three element fields from the
// camera-gap batch (2026-11-17, 11-clip replication friction: rain-pilot
// 运镜缓推 + disaster-pilot zoom punch had "no camera/group transform",
// day-pilot 色温 wanted multiply overlays, spotdiff hunt-drift wanted a
// fixed camera window). Same package, same Validate surface as
// ir_animation_atframe_test.go; own file to avoid colliding with parallel
// edits to ir_test.go.

func tcbBaseIR() *IR {
	return &IR{
		SchemaVersion: IRSchemaVersion,
		Meta:          Meta{FPS: 30, Width: 1080, Height: 1080, DurationSec: 1.0},
		Script:        "相机窗口演示",
	}
}

func tcbWith(el Element) *IR {
	ir := tcbBaseIR()
	ir.Elements = []Element{el}
	return ir
}

// ---- transformOrigin ----

func TestValidate_TransformOrigin(t *testing.T) {
	base := Element{ID: "e1", Type: ElementShape, X: 0, Y: 0, W: 100, H: 100}

	t.Run("valid keyword pairs", func(t *testing.T) {
		for _, v := range []string{"top left", "top center", "bottom right", "center center"} {
			require.NoError(t, Validate(tcbWith(base)), "sanity")
			el := base
			el.TransformOrigin = v
			assert.NoErrorf(t, Validate(tcbWith(el)), "transformOrigin %q must pass", v)
		}
	})
	t.Run("valid numeric axes", func(t *testing.T) {
		for _, v := range []string{"50% 0", "0px 100%", "12.5% 87.5%", "10px 20px"} {
			el := base
			el.TransformOrigin = v
			assert.NoErrorf(t, Validate(tcbWith(el)), "transformOrigin %q must pass", v)
		}
	})
	t.Run("bare center shorthand", func(t *testing.T) {
		el := base
		el.TransformOrigin = "center"
		assert.NoError(t, Validate(tcbWith(el)))
	})
	t.Run("empty = default (back-compat)", func(t *testing.T) {
		el := base
		el.TransformOrigin = ""
		assert.NoError(t, Validate(tcbWith(el)))
	})
	t.Run("invalid: unknown keyword rejected with examples", func(t *testing.T) {
		el := base
		el.TransformOrigin = "middle left"
		err := Validate(tcbWith(el))
		require.Error(t, err)
		var ve *ValidationError
		require.True(t, errors.As(err, &ve), "error is ValidationError: %v", err)
		assert.Equal(t, "elements[0].transformOrigin", ve.Field)
		assert.Contains(t, ve.Msg, "top left")
		assert.Contains(t, ve.Msg, "50% 0")
	})
	t.Run("invalid: trailing junk rejected", func(t *testing.T) {
		el := base
		el.TransformOrigin = "top left extra"
		err := Validate(tcbWith(el))
		require.Error(t, err)
		var ve *ValidationError
		require.True(t, errors.As(err, &ve))
		assert.Equal(t, "elements[0].transformOrigin", ve.Field)
	})
	t.Run("invalid: single non-center value rejected", func(t *testing.T) {
		el := base
		el.TransformOrigin = "top"
		err := Validate(tcbWith(el))
		require.Error(t, err)
		var ve *ValidationError
		require.True(t, errors.As(err, &ve))
		assert.Equal(t, "elements[0].transformOrigin", ve.Field)
	})
	t.Run("invalid: CSS metacharacter injection rejected", func(t *testing.T) {
		el := base
		el.TransformOrigin = "center;} body{x(" // would break out of a style splice
		require.Error(t, Validate(tcbWith(el)))
	})
}

// ---- clip ----

func TestValidate_Clip(t *testing.T) {
	base := Element{ID: "e1", Type: ElementShape, X: 0, Y: 0, W: 1080, H: 1080}

	t.Run("valid camera window", func(t *testing.T) {
		el := base
		el.Clip = &Clip{X: 200, Y: 200, W: 400, H: 400, Radius: 30}
		assert.NoError(t, Validate(tcbWith(el)))
	})
	t.Run("valid zero radius (square window)", func(t *testing.T) {
		el := base
		el.Clip = &Clip{X: 0, Y: 0, W: 320, H: 240, Radius: 0}
		assert.NoError(t, Validate(tcbWith(el)))
	})
	t.Run("radius at the physical bound is legal (min(w,h)/2 = 120)", func(t *testing.T) {
		el := base
		el.Clip = &Clip{X: 0, Y: 0, W: 240, H: 320, Radius: 120}
		assert.NoError(t, Validate(tcbWith(el)))
	})
	t.Run("radius beyond min(w,h)/2 rejected", func(t *testing.T) {
		el := base
		el.Clip = &Clip{X: 0, Y: 0, W: 240, H: 320, Radius: 121}
		err := Validate(tcbWith(el))
		require.Error(t, err)
		var ve *ValidationError
		require.True(t, errors.As(err, &ve), "error is ValidationError: %v", err)
		assert.Equal(t, "elements[0].clip.radius", ve.Field)
		assert.Contains(t, ve.Msg, "min(w,h)/2")
	})
	t.Run("negative radius rejected", func(t *testing.T) {
		el := base
		el.Clip = &Clip{X: 0, Y: 0, W: 240, H: 320, Radius: -1}
		err := Validate(tcbWith(el))
		require.Error(t, err)
		var ve *ValidationError
		require.True(t, errors.As(err, &ve))
		assert.Equal(t, "elements[0].clip.radius", ve.Field)
	})
	t.Run("non-positive w rejected", func(t *testing.T) {
		el := base
		el.Clip = &Clip{X: 0, Y: 0, W: 0, H: 320}
		err := Validate(tcbWith(el))
		require.Error(t, err)
		var ve *ValidationError
		require.True(t, errors.As(err, &ve))
		assert.Equal(t, "elements[0].clip.w", ve.Field)
	})
	t.Run("negative h rejected", func(t *testing.T) {
		el := base
		el.Clip = &Clip{X: 0, Y: 0, W: 240, H: -5}
		err := Validate(tcbWith(el))
		require.Error(t, err)
		var ve *ValidationError
		require.True(t, errors.As(err, &ve))
		assert.Equal(t, "elements[0].clip.w", ve.Field) // shared w/h message
	})
	t.Run("non-finite geometry rejected", func(t *testing.T) {
		el := base
		el.Clip = &Clip{X: nan(), Y: 0, W: 100, H: 100}
		err := Validate(tcbWith(el))
		require.Error(t, err)
		var ve *ValidationError
		require.True(t, errors.As(err, &ve))
		assert.Equal(t, "elements[0].clip", ve.Field)
	})
}

// ---- mixBlendMode ----

func TestValidate_MixBlendMode(t *testing.T) {
	base := Element{ID: "e1", Type: ElementShape, X: 0, Y: 0, W: 100, H: 100}

	t.Run("whitelist accepted", func(t *testing.T) {
		for _, v := range []string{"multiply", "screen", "overlay", "soft-light", "hard-light",
			"color-dodge", "color-burn", "darken", "lighten", "difference", "exclusion",
			"hue", "saturation", "color", "luminosity"} {
			el := base
			el.MixBlendMode = v
			assert.NoErrorf(t, Validate(tcbWith(el)), "mixBlendMode %q must pass", v)
		}
	})
	t.Run("blacklist rejected with the full enum", func(t *testing.T) {
		for _, v := range []string{"plus-lighter", "normal", "MULTIPLY", "multiply screen", ""} {
			if v == "" {
				continue // empty = absent = legacy behavior, tested below
			}
			el := base
			el.MixBlendMode = v
			err := Validate(tcbWith(el))
			require.Errorf(t, err, "mixBlendMode %q must be rejected", v)
			var ve *ValidationError
			require.True(t, errors.As(err, &ve))
			assert.Equal(t, "elements[0].mixBlendMode", ve.Field)
			assert.Contains(t, ve.Msg, "multiply|screen|overlay")
		}
	})
	t.Run("empty = absent (back-compat)", func(t *testing.T) {
		el := base
		el.MixBlendMode = ""
		assert.NoError(t, Validate(tcbWith(el)))
	})
	t.Run("injection attempt rejected", func(t *testing.T) {
		el := base
		el.MixBlendMode = "screen;}*{"
		require.Error(t, Validate(tcbWith(el)))
	})
}

// ---- combination: all three fields on one element pass together ----

func TestValidate_CameraFieldsCombined(t *testing.T) {
	ir := tcbBaseIR()
	ir.Elements = []Element{
		{ID: "el_bg", Type: ElementShape, Color: "#222222", X: 0, Y: 0, W: 1080, H: 1080, Z: 0},
		{ID: "el_room", Type: ElementShape, Color: "#654321", X: 100, Y: 100, W: 880, H: 880, Z: 1,
			TransformOrigin: "top left",
			Clip:            &Clip{X: 200, Y: 200, W: 400, H: 400, Radius: 30},
			MixBlendMode:    "multiply",
			Animations: []ElementAnimation{
				{ID: "an_in", Type: "scaleIn", FromValue: ptrF64(2), ToValue: ptrF64(1),
					DurationFrames: 15, Easing: "linear", AtFrame: atFramePtr(0)},
			}},
	}
	assert.NoError(t, Validate(ir))
}

// ---- projection passthrough (atFrame passthrough pattern) ----

func TestProjector_CameraFieldsProjection(t *testing.T) {
	// set fields project; unset fields produce NO keys (legacy IRs stay
	// byte-identical — same pattern as TestProjector_ElementTimeWindow_Projection).
	ir := tcbBaseIR()
	ir.Elements = []Element{{ID: "el_cam", Type: ElementShape, Color: "#ff0000",
		X: 0, Y: 0, W: 1080, H: 1080,
		TransformOrigin: "top left",
		Clip:            &Clip{X: 200, Y: 200, W: 400, H: 400, Radius: 30},
		MixBlendMode:    "multiply"}}
	html, err := NewProjector(nil).HTML(t.Context(), ir, "")
	require.NoError(t, err)
	str := string(html)
	assert.Contains(t, str, `"transformOrigin":"top left"`)
	assert.Contains(t, str, `"clip":{"x":200,"y":200,"w":400,"h":400,"radius":30}`)
	assert.Contains(t, str, `"mixBlendMode":"multiply"`)

	// legacy: none of the keys appear in the IR DATA BLOCK for an element
	// without the fields (scoped to the payload — the builder JS itself
	// legitimately references style.transformOrigin, so whole-HTML
	// NotContains would false-fail).
	ir2 := tcbBaseIR()
	ir2.Elements = []Element{{ID: "el_old", Type: ElementShape, X: 0, Y: 0, W: 10, H: 10}}
	html2, err := NewProjector(nil).HTML(t.Context(), ir2, "")
	require.NoError(t, err)
	str2 := string(html2)
	marker := `id="ploykit-ir">`
	start := strings.Index(str2, marker) + len(marker)
	end := strings.Index(str2[start:], "</script>")
	payload2 := str2[start : start+end]
	assert.NotContains(t, payload2, "transformOrigin")
	assert.NotContains(t, payload2, "mixBlendMode")
	assert.NotContains(t, payload2, "clip")

	// #canvas isolation is unconditional (the blend-leak guard ships for
	// every document, legacy included — a CSS-only change, no DOM diff).
	assert.Contains(t, str2, "isolation: isolate")
}

// TestProjector_LegacyPayloadByteIdentical pins the pure-increment contract:
// for an IR without the three camera fields the projected IR data block is
// BYTE-IDENTICAL to the pre-feature baseline (SHA-256 captured from the
// unmodified projector on 2026-11-17; any payload-affecting regression —
// key reordering, stray default emission — trips this before a render
// diff ever could). The document's CSS may carry the unconditional
// isolation guard; the payload (what the builder reads) may not drift.
func TestProjector_LegacyPayloadByteIdentical(t *testing.T) {
	ir := &IR{
		SchemaVersion: IRSchemaVersion,
		Meta:          Meta{FPS: 30, Width: 1080, Height: 1080, DurationSec: 1.0},
		Script:        "sha fixture",
		Words:         []Word{{Index: 0, Text: "sha", Start: 0.1, End: 0.4, Source: WordSourceManual}},
		Elements: []Element{
			{ID: "el_bg", Type: ElementShape, Color: "#222222", X: 0, Y: 0, W: 1080, H: 1080, Z: 0},
			{ID: "el_bar", Type: ElementShape, Color: "#ff0000", X: 100, Y: 100, W: 600, H: 40, Z: 1,
				Animations: []ElementAnimation{{ID: "an1", Type: "move",
					From: &Point{X: 0, Y: 0}, To: &Point{X: 9, Y: 9}, DurationFrames: 15,
					AtFrame: ptrInt(0)}}},
		},
	}
	html, err := NewProjector(nil).HTML(t.Context(), ir, "")
	require.NoError(t, err)
	str := string(html)
	marker := `id="ploykit-ir">`
	start := strings.Index(str, marker) + len(marker)
	end := strings.Index(str[start:], "</script>")
	payload := str[start : start+end]
	sum := sha256.Sum256([]byte(payload))
	assert.Equal(t,
		"c5308d41b20b9381b9772023d7d4c7a85234f3c4d169e44d1008ed02ed2b8edd",
		hex.EncodeToString(sum[:]),
		"legacy IR payload must stay byte-identical (pure increment)")
}

func ptrInt(i int) *int { return &i }

// nan returns a quiet NaN (kept local so the table stays readable).
func nan() float64 {
	return math.NaN()
}

func ptrF64(f float64) *float64 { return &f }
