package videomcp

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	videoapp "myproduct/internal/video/app"
)

// TestValidateRenderable anchors the video_validate empty-project verdict
// (e2e agent2 P2-7): a zero-element project must NOT be reported renderable
// — the black-box probe submitted one and burned a full quota slot on a 26KB
// solid-color MP4. The pure verdict is pinned here without a database; the
// tool body only does the Get + capability probe around it.
func TestValidateRenderable(t *testing.T) {
	empty := &videoapp.IR{Meta: videoapp.Meta{FPS: 30, Width: 1080, Height: 1920, DurationSec: 10}}

	renderable, warn := validateRenderable(empty, true)
	assert.False(t, renderable, "empty project must not be renderable even with the capability online")
	require.NotNil(t, warn)
	assert.Equal(t, "no elements: render would produce an empty video", *warn)

	// Capability offline already forces renderable=false (the hint carries
	// that cause — no duplicate element warning should fire for a NON-empty
	// project; for an empty one the warning still applies).
	withElements := &videoapp.IR{
		Meta: videoapp.Meta{FPS: 30, Width: 1080, Height: 1920, DurationSec: 10},
		Elements: []videoapp.Element{{
			ID: "e1", Type: videoapp.ElementText, X: 0, Y: 0, W: 100, H: 40, Z: 1,
		}},
	}
	renderable, warn = validateRenderable(withElements, false)
	assert.False(t, renderable, "offline capability still forces renderable=false")
	assert.Nil(t, warn, "no element warning for a populated project")

	renderable, warn = validateRenderable(withElements, true)
	assert.True(t, renderable, "populated project + online capability = renderable")
	assert.Nil(t, warn)
}
