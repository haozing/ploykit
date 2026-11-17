package videoapp

import (
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// atFrame (explicit frame anchor) + resize (top-left w/h tween) — the two
// v1 increments from the versus-pilot friction (docs
// plan-video-studio-ir-v2-spec-2026-11-17.md §2.8 is the v2 destination;
// these flat fields are the v1 bridge). Same package, same Validate surface
// as ir_animation_fade_test.go; kept in its own file to avoid colliding with
// parallel edits to ir_test.go.

// atFrameBaseIR carries a float-clean clock: 1.0s @ 30fps → DurationFrames
// == 30 exactly (12.4 × 30 = 372.000…01 in IEEE-754 would ceil to 373 and
// make the boundary case read like an off-by-one).
func atFrameBaseIR() *IR {
	return &IR{
		Meta:   Meta{FPS: 30, Width: 1080, Height: 1080, DurationSec: 1.0},
		Script: "进度条演示",
	}
}

func atFramePtr(i int) *int { return &i }

func TestValidate_AtFrameAnchor(t *testing.T) {
	withAnim := func(an ElementAnimation) *IR {
		ir := atFrameBaseIR()
		ir.Elements = []Element{{ID: "e1", Type: ElementShape, X: 0, Y: 0, W: 10, H: 10,
			Animations: []ElementAnimation{an}}}
		return ir
	}

	t.Run("atFrame alone is valid (no startAnchor required)", func(t *testing.T) {
		require.NoError(t, Validate(withAnim(ElementAnimation{
			ID: "a1", Type: "move", From: &Point{X: 0, Y: 0}, To: &Point{X: 100, Y: 100},
			DurationFrames: 15, AtFrame: atFramePtr(10),
		})))
	})
	t.Run("atFrame 0 is legal (pointer distinguishes 0 from absent)", func(t *testing.T) {
		require.NoError(t, Validate(withAnim(ElementAnimation{
			ID: "a1", Type: "resize", From: &Point{X: 0, Y: 40}, To: &Point{X: 600, Y: 40},
			DurationFrames: 15, AtFrame: atFramePtr(0),
		})))
	})
	t.Run("atFrame and startAnchor are mutually exclusive", func(t *testing.T) {
		err := Validate(withAnim(ElementAnimation{
			ID: "a1", Type: "move", From: &Point{X: 0, Y: 0}, To: &Point{X: 9, Y: 9},
			DurationFrames: 15,
			StartAnchor:    &Anchor{Text: "进度", Occurrence: 0},
			AtFrame:        atFramePtr(5),
		}))
		require.Error(t, err)
		var ve *ValidationError
		require.True(t, errors.As(err, &ve), "error is ValidationError: %v", err)
		assert.Equal(t, "elements[0].animations[0].atFrame", ve.Field)
		assert.Contains(t, ve.Msg, "mutually exclusive")
	})
	t.Run("atFrame negative rejected", func(t *testing.T) {
		err := Validate(withAnim(ElementAnimation{
			ID: "a1", Type: "move", DurationFrames: 15, AtFrame: atFramePtr(-1),
		}))
		require.Error(t, err)
		var ve *ValidationError
		require.True(t, errors.As(err, &ve))
		assert.Equal(t, "elements[0].animations[0].atFrame", ve.Field)
		assert.Contains(t, ve.Msg, ">= 0")
	})
	t.Run("atFrame beyond durationFrames rejected", func(t *testing.T) {
		err := Validate(withAnim(ElementAnimation{
			ID: "a1", Type: "move", DurationFrames: 15, AtFrame: atFramePtr(31), // F = 30
		}))
		require.Error(t, err)
		var ve *ValidationError
		require.True(t, errors.As(err, &ve))
		assert.Equal(t, "elements[0].animations[0].atFrame", ve.Field)
		assert.Contains(t, ve.Msg, "atFrame must be <= durationFrames (30)")
	})
	t.Run("atFrame == durationFrames is legal (window-style boundary)", func(t *testing.T) {
		// mirrors the element-window allowance (endFrame == F expresses "to
		// the end"); a tween starting at F renders only its from-state.
		require.NoError(t, Validate(withAnim(ElementAnimation{
			ID: "a1", Type: "move", DurationFrames: 15, AtFrame: atFramePtr(30),
		})))
	})
	t.Run("both anchors absent keeps the v1 fallback path (still valid)", func(t *testing.T) {
		// v1 back-compat: no atFrame, no startAnchor → the legacy fallbacks
		// (t=0 / fade window) own the anchoring; v2 will tighten this.
		require.NoError(t, Validate(withAnim(ElementAnimation{
			ID: "a1", Type: "fadeIn", DurationFrames: 15,
		})))
	})
}

func TestValidate_ResizeAnimation(t *testing.T) {
	withAnim := func(an ElementAnimation) *IR {
		ir := atFrameBaseIR()
		ir.Elements = []Element{{ID: "e1", Type: ElementShape, X: 100, Y: 100, W: 10, H: 10,
			Animations: []ElementAnimation{an}}}
		return ir
	}

	t.Run("resize with from+to passes", func(t *testing.T) {
		require.NoError(t, Validate(withAnim(ElementAnimation{
			ID: "a1", Type: "resize", From: &Point{X: 0, Y: 40}, To: &Point{X: 600, Y: 40},
			DurationFrames: 15, Easing: "linear", AtFrame: atFramePtr(0),
		})))
	})
	t.Run("resize missing to rejected", func(t *testing.T) {
		err := Validate(withAnim(ElementAnimation{
			ID: "a1", Type: "resize", From: &Point{X: 0, Y: 40},
			DurationFrames: 15, AtFrame: atFramePtr(0),
		}))
		require.Error(t, err)
		var ve *ValidationError
		require.True(t, errors.As(err, &ve))
		assert.Equal(t, "elements[0].animations[0]", ve.Field)
		assert.Contains(t, ve.Msg, "resize requires both from and to")
	})
	t.Run("resize missing from rejected", func(t *testing.T) {
		err := Validate(withAnim(ElementAnimation{
			ID: "a1", Type: "resize", To: &Point{X: 600, Y: 40},
			DurationFrames: 15, AtFrame: atFramePtr(0),
		}))
		require.Error(t, err)
		var ve *ValidationError
		require.True(t, errors.As(err, &ve))
		assert.Contains(t, ve.Msg, "resize requires both from and to")
	})
	t.Run("resize keeps height constant is fine (w-only growth)", func(t *testing.T) {
		// progress-bar semantics: width grows, height pinned — both Points
		// still required, only the VALUES may repeat.
		require.NoError(t, Validate(withAnim(ElementAnimation{
			ID: "a1", Type: "resize", From: &Point{X: 600, Y: 40}, To: &Point{X: 600, Y: 40},
			DurationFrames: 15,
		})))
	})
}

func TestValidate_AnimationCap32(t *testing.T) {
	mk := func(n int) *IR {
		ir := atFrameBaseIR()
		ans := make([]ElementAnimation, n)
		for i := range ans {
			ans[i] = ElementAnimation{ID: "a", Type: "rotate", DurationFrames: 5}
		}
		ir.Elements = []Element{{ID: "e1", Type: ElementShape, X: 0, Y: 0, W: 10, H: 10,
			Animations: ans}}
		return ir
	}
	t.Run("32 animations pass (raised from 16)", func(t *testing.T) {
		require.NoError(t, Validate(mk(32)))
	})
	t.Run("33 animations rejected", func(t *testing.T) {
		err := Validate(mk(33))
		require.Error(t, err)
		var ve *ValidationError
		require.True(t, errors.As(err, &ve))
		assert.Equal(t, "elements[0].animations", ve.Field)
		assert.True(t, strings.Contains(ve.Msg, "animations exceeds"),
			"message should say animations exceeds: %q", ve.Msg)
	})
}

func TestValidate_MoveStartAnchorRegression(t *testing.T) {
	// pure-StartAnchor move (the v1 primary path) must be untouched by the
	// atFrame bridge — quick regression guard.
	ir := validIR()
	ir.Elements = []Element{{
		ID: "e1", Type: ElementShape, X: 100, Y: 100, W: 50, H: 50,
		Animations: []ElementAnimation{{
			ID: "a1", Type: "move",
			From: &Point{X: 100, Y: 100}, To: &Point{X: 400, Y: 300},
			StartAnchor:    &Anchor{Text: "发布", Occurrence: 0},
			DurationFrames: 45, Easing: "power2.out",
		}},
	}}
	require.NoError(t, Validate(ir))
}
