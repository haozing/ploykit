package videomcp

import (
	videoapp "myproduct/internal/video/app"
)

// validateRenderable is the video_validate verdict for the empty-project
// blind spot (e2e agent2 P2-7): a project with zero canvas elements renders
// a blank video — the black-box probe submitted one and got a 26KB solid-
// color MP4 for a full quota slot. The read-only preflight must not call
// that renderable.
//
// Pure function (no pool, no capability probe side effects) so the verdict
// is unit-testable without a database; the tool body only does the Get +
// capability probe and assembles the rest of the payload.
//
// Returns (renderable, noElementsWarning): the warning is nil exactly when
// the project has at least one element (or the caller has already got
// renderable=false from an offline capability — the capability hint carries
// that case, no duplicate warning).
func validateRenderable(ir *videoapp.IR, capOnline bool) (bool, *string) {
	if len(ir.Elements) > 0 {
		return capOnline, nil
	}
	w := "no elements: render would produce an empty video"
	return false, &w
}
