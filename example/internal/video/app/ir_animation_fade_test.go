package videoapp

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// P0-2 (case library §5.16): element-level opacity animations join the
// animation registry. Kept in its own file (not ir_test.go) so it cannot
// collide with parallel edits to that file; same package, same Validate
// surface. fadeIn/fadeOut must pass validation; unknown types stay rejected.
func TestValidate_ElementFadeAnimations(t *testing.T) {
	base := func(typ string) *IR {
		ir := validIR()
		ir.Elements = []Element{{ID: "e1", Type: ElementShape, X: 0, Y: 0, W: 10, H: 10,
			Animations: []ElementAnimation{{ID: "a1", Type: typ, DurationFrames: 30}}}}
		return ir
	}

	t.Run("fadeIn accepted", func(t *testing.T) {
		require.NoError(t, Validate(base("fadeIn")))
	})
	t.Run("fadeOut accepted", func(t *testing.T) {
		require.NoError(t, Validate(base("fadeOut")))
	})
	t.Run("legacy types still accepted", func(t *testing.T) {
		for _, typ := range []string{"move", "scaleIn", "rotate"} {
			require.NoError(t, Validate(base(typ)), "type %s must stay valid", typ)
		}
	})
	t.Run("unknown type still rejected", func(t *testing.T) {
		for _, typ := range []string{"spin", "FadeIn", "fadein", "fadeOutEx"} {
			err := Validate(base(typ))
			require.Error(t, err, "type %q must be rejected", typ)
			var ve *ValidationError
			require.True(t, errors.As(err, &ve), "error is ValidationError: %v", err)
			assert.Equal(t, "elements[0].animations[0].type", ve.Field)
		}
	})
	t.Run("fade animation with easing and anchor", func(t *testing.T) {
		ir := validIR()
		ir.Elements = []Element{{ID: "e1", Type: ElementText, Text: "标题", X: 0, Y: 0, W: 100, H: 40,
			Animations: []ElementAnimation{{
				ID: "a1", Type: "fadeIn", DurationFrames: 45, Easing: "power2.out",
				StartAnchor: &Anchor{Text: "发布", Occurrence: 0},
			}}}}
		require.NoError(t, Validate(ir))
	})
}
