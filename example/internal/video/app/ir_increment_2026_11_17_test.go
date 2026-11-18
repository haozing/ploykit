package videoapp

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 2026-11-17 increment unit tests (11-clip replication friction):
// power2.inOut easing + FPS 18/20, counter format/decimals params,
// Effect.AtFrame (wordless frame anchor), FontAssets validation.
// Same package/surface as ir_test.go; own file to avoid colliding with
// parallel edits there.

// ---- easing + fps ----

func TestValidate_EasingPower2InOut(t *testing.T) {
	ir := validIR()
	ir.Elements = []Element{{
		ID: "e1", Type: ElementShape, X: 0, Y: 0, W: 10, H: 10,
		Animations: []ElementAnimation{{
			ID: "a1", Type: "move", From: &Point{X: 0, Y: 0}, To: &Point{X: 9, Y: 9},
			DurationFrames: 10, Easing: "power2.inOut",
		}},
	}}
	require.NoError(t, Validate(ir), "power2.inOut is legal since 2026-11-17 (the pulse builder used it all along)")
}

func TestValidate_FPS18And20(t *testing.T) {
	for _, fps := range []int{18, 20} {
		ir := validIR()
		ir.Meta.FPS = fps
		require.NoError(t, Validate(ir), "fps %d must be accepted", fps)
	}
	// 29 stays rejected (the neighboring control).
	ir := validIR()
	ir.Meta.FPS = 29
	err := Validate(ir)
	require.Error(t, err)
	var ve *ValidationError
	require.True(t, errors.As(err, &ve))
	assert.Equal(t, "meta.fps", ve.Field)
	assert.Contains(t, ve.Msg, "18|20")
}

// ---- counter params ----

func TestValidate_CounterFormatDecimalsParams(t *testing.T) {
	ok := func(params string) {
		err := validateEffectParams(EffectCounter, json.RawMessage(params))
		require.NoError(t, err, "params %s must pass", params)
	}
	bad := func(params string, field string) {
		err := validateEffectParams(EffectCounter, json.RawMessage(params))
		require.Error(t, err, "params %s must fail", params)
		var ve *ValidationError
		require.True(t, errors.As(err, &ve))
		assert.Contains(t, ve.Field, field)
	}

	ok(`{"from":0,"to":2395,"format":"0:{v}","decimals":2}`)
	ok(`{"format":"{v}s"}`)                            // format alone is fine
	ok(`{"decimals":1}`)                               // decimals alone is fine
	ok(`{"decimals":0}`)                               // zero = integer (legacy behavior)
	ok(`{"from":0,"to":5,"durationFrames":9}`)         // explicit continuous-segment duration (v0.33.2)
	ok(`{"from":3,"to":3,"durationFrames":1}`)         // tolerated on discrete segments (no tween anyway)
	bad(`{"format":123}`, "format")                    // format must be a string
	bad(`{"format":true}`, "format")                   // not a string either
	bad(`{"decimals":"2"}`, "decimals")                // quoted number rejected
	bad(`{"decimal":2}`, "decimal")                    // typo → unknown param
	bad(`{"format":"{v}","decimals":"1"}`, "decimals") // mixed ok/fail → fail on decimals
	bad(`{"durationFrames":"9"}`, "durationFrames")    // quoted number rejected
	bad(`{"durationFrames":true}`, "durationFrames")   // bool rejected
}

// ---- Effect.AtFrame ----

func fxIntPtr(i int) *int { return &i }

func TestValidate_EffectAtFrame(t *testing.T) {
	mk := func(fx Effect) *IR {
		ir := validIR()
		ir.Effects = []Effect{fx}
		return ir
	}

	t.Run("atFrame alone is valid (no anchor required)", func(t *testing.T) {
		require.NoError(t, Validate(mk(Effect{
			ID: "fx_timer", Type: EffectCounter, AtFrame: fxIntPtr(0),
			Params: []byte(`{"from":0,"to":23.95,"format":"0:{v}","decimals":2}`),
		})))
	})
	t.Run("atFrame with anchor text is rejected (mutually exclusive)", func(t *testing.T) {
		err := Validate(mk(Effect{
			ID: "fx", Type: EffectCounter, AtFrame: fxIntPtr(5),
			Anchor: Anchor{Text: "发布"},
		}))
		require.Error(t, err)
		var ve *ValidationError
		require.True(t, errors.As(err, &ve))
		assert.Equal(t, "effects[0].atFrame", ve.Field)
		assert.Contains(t, ve.Msg, "mutually exclusive")
	})
	t.Run("atFrame negative rejected", func(t *testing.T) {
		err := Validate(mk(Effect{ID: "fx", Type: EffectCounter, AtFrame: fxIntPtr(-1)}))
		require.Error(t, err)
		var ve *ValidationError
		require.True(t, errors.As(err, &ve))
		assert.Equal(t, "effects[0].atFrame", ve.Field)
		assert.Contains(t, ve.Msg, ">= 0")
	})
	t.Run("atFrame beyond durationFrames rejected", func(t *testing.T) {
		// validIR: 12.4s @ 30fps → DurationFrames = 372 (12.4×30 = 372.0 in
		// decimal; the float product rounds to exactly 372.0 here).
		err := Validate(mk(Effect{ID: "fx", Type: EffectCounter, AtFrame: fxIntPtr(373)}))
		require.Error(t, err)
		var ve *ValidationError
		require.True(t, errors.As(err, &ve))
		assert.Equal(t, "effects[0].atFrame", ve.Field)
		assert.Contains(t, ve.Msg, "<= durationFrames (372)")
	})
	t.Run("atFrame == durationFrames is legal (window-style boundary)", func(t *testing.T) {
		require.NoError(t, Validate(mk(Effect{ID: "fx", Type: EffectCounter, AtFrame: fxIntPtr(372)})))
	})
	t.Run("word-anchored effect without anchor text still rejected", func(t *testing.T) {
		// the anchor-text requirement only lifts for atFrame effects.
		err := Validate(mk(Effect{ID: "fx", Type: EffectPulse}))
		require.Error(t, err)
		var ve *ValidationError
		require.True(t, errors.As(err, &ve))
		assert.Equal(t, "effects[0].anchor.text", ve.Field)
	})
}

func TestResolveAll_EffectAtFrameSkipsWordResolution(t *testing.T) {
	ir := validIR()
	ir.Effects = []Effect{
		{ID: "fx_frame", Type: EffectCounter, AtFrame: fxIntPtr(10),
			Params: []byte(`{"from":0,"to":100}`)},
		{ID: "fx_word", Type: EffectPulse, Anchor: Anchor{Text: "发布", Occurrence: 0}},
	}
	res := ResolveAll(ir, nil)
	// the atFrame effect is absent from the resolution list and keeps a nil
	// ResolvedFrom (no fabricated audit trail); the word effect resolves.
	assert.Len(t, res, 1)
	assert.Equal(t, "fx_word", res[0].OwnerID)
	assert.Nil(t, ir.Effects[0].ResolvedFrom)
	require.NotNil(t, ir.Effects[1].ResolvedFrom)
	assert.Equal(t, AnchorExact, ir.Effects[1].ResolvedFrom.Reason)
}

// ---- FontAssets ----

func TestValidate_FontAssets(t *testing.T) {
	t.Run("well-formed font assets pass", func(t *testing.T) {
		ir := validIR()
		ir.FontAssets = []FontAsset{
			{Key: "video/ws-1/assets/p1/abc.woff2", Family: "My Brand Bold", Weight: "800"},
			{Key: "video/ws-1/assets/p1/def.woff2", Family: "Noto_Sans", Weight: "400 900"},
			{Key: "video/ws-1/assets/p1/ghi.woff2", Family: "Sans"}, // weight optional
		}
		require.NoError(t, Validate(ir))
	})
	t.Run("family required", func(t *testing.T) {
		ir := validIR()
		ir.FontAssets = []FontAsset{{Key: "video/ws/a.woff2"}}
		err := Validate(ir)
		require.Error(t, err)
		var ve *ValidationError
		require.True(t, errors.As(err, &ve))
		assert.Equal(t, "fontAssets[0].family", ve.Field)
	})
	t.Run("family charset rejects CSS metacharacters", func(t *testing.T) {
		for _, fam := range []string{`Evil';}`, `Bad"Quote`, "Semi;colon", "Br{ace}"} {
			ir := validIR()
			ir.FontAssets = []FontAsset{{Key: "video/ws/a.woff2", Family: fam}}
			err := Validate(ir)
			require.Error(t, err, "family %q must be rejected", fam)
			var ve *ValidationError
			require.True(t, errors.As(err, &ve))
			assert.Equal(t, "fontAssets[0].family", ve.Field)
		}
	})
	t.Run("duplicate family rejected", func(t *testing.T) {
		ir := validIR()
		ir.FontAssets = []FontAsset{
			{Key: "video/ws/a.woff2", Family: "Brand"},
			{Key: "video/ws/b.woff2", Family: "Brand"},
		}
		err := Validate(ir)
		require.Error(t, err)
		var ve *ValidationError
		require.True(t, errors.As(err, &ve))
		assert.Equal(t, "fontAssets[1].family", ve.Field)
		assert.Contains(t, ve.Msg, "duplicate")
	})
	t.Run("key must be a video/ storage key", func(t *testing.T) {
		for _, key := range []string{"https://cdn.example/f.woff2", "data:font/woff2;base64,AAA", "assets/f.woff2"} {
			ir := validIR()
			ir.FontAssets = []FontAsset{{Key: key, Family: "Brand"}}
			err := Validate(ir)
			require.Error(t, err, "key %q must be rejected", key)
			var ve *ValidationError
			require.True(t, errors.As(err, &ve))
			assert.Equal(t, "fontAssets[0].key", ve.Field)
		}
	})
	t.Run("weight charset checked", func(t *testing.T) {
		ir := validIR()
		ir.FontAssets = []FontAsset{{Key: "video/ws/a.woff2", Family: "Brand", Weight: "800;evil"}}
		err := Validate(ir)
		require.Error(t, err)
		var ve *ValidationError
		require.True(t, errors.As(err, &ve))
		assert.Equal(t, "fontAssets[0].weight", ve.Field)
	})
	t.Run("cap enforced", func(t *testing.T) {
		ir := validIR()
		ir.FontAssets = make([]FontAsset, MaxFontAssets+1)
		for i := range ir.FontAssets {
			ir.FontAssets[i] = FontAsset{Key: "video/ws/a.woff2", Family: "F" + string(rune('a'+i))}
		}
		err := Validate(ir)
		require.Error(t, err)
		var ve *ValidationError
		require.True(t, errors.As(err, &ve))
		assert.Equal(t, "fontAssets", ve.Field)
	})
	t.Run("omitempty keeps legacy IR bytes unchanged", func(t *testing.T) {
		ir := validIR()
		b, err := json.Marshal(ir)
		require.NoError(t, err)
		assert.False(t, strings.Contains(string(b), "fontAssets"),
			"an IR without fonts must not serialize a fontAssets key")
	})
}
