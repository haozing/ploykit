package video_test

// Spec-audit validation harness (VS-C04 / VS-C06 degraded IRs, batch 1).
// Reads the degraded IR JSON files from testdata/ir and asserts each one
// unmarshals into videoapp.IR and passes videoapp.Validate with no errors.
// Temporary L0 gate for the case-library test plan round; safe to delete
// after L1/L2 consume the files.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	videoapp "myproduct/internal/video/app"
)

func TestDegradedIRFiles_Validate(t *testing.T) {
	// Batch 1: c04/c06 (spec-audit). Batch 2 (six cases): c02/c03/c05/c07/c08/c09.
	files := []string{
		"c02.degraded.json", "c03.degraded.json", "c05.degraded.json",
		"c07.degraded.json", "c08.degraded.json", "c09.degraded.json",
		"c04.degraded.json", "c06.degraded.json",
	}
	for _, name := range files {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join("testdata", "ir", name)
			b, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("read %s: %v", path, err)
			}
			var ir videoapp.IR
			if err := json.Unmarshal(b, &ir); err != nil {
				t.Fatalf("json.Unmarshal(%s): %v", path, err)
			}
			if err := videoapp.Validate(&ir); err != nil {
				t.Fatalf("Validate(%s) returned error: %v", path, err)
			}
			frames := videoapp.DurationFrames(&ir, ir.Meta.FPS)
			t.Logf("%s: Validate=nil, DurationFrames=%d (meta %dx%d@%d %.0fs, %d words, %d elements, %d effects)",
				name, frames, ir.Meta.Width, ir.Meta.Height, ir.Meta.FPS, ir.Meta.DurationSec,
				len(ir.Words), len(ir.Elements), len(ir.Effects))

			// Anchor sanity: every effect/animation anchor must resolve exact
			// (degraded IRs hand-pick text+occurrence; a non-exact resolution
			// means the word table and the anchors drifted — fix the IR, not
			// the test).
			videoapp.ResolveAll(&ir, nil)
			for i := range ir.Effects {
				if rf := ir.Effects[i].ResolvedFrom; rf == nil || rf.Reason != videoapp.AnchorExact {
					reason := "nil"
					if rf != nil {
						reason = rf.Reason
					}
					t.Errorf("%s: effect %s anchor %q did not resolve exact (reason=%s)",
						name, ir.Effects[i].ID, ir.Effects[i].Anchor.Text, reason)
				}
			}
			for i := range ir.Elements {
				for j := range ir.Elements[i].Animations {
					an := &ir.Elements[i].Animations[j]
					if an.StartAnchor == nil {
						continue
					}
					if rf := an.ResolvedFrom; rf == nil || rf.Reason != videoapp.AnchorExact {
						reason := "nil"
						if rf != nil {
							reason = rf.Reason
						}
						t.Errorf("%s: animation %s startAnchor %q did not resolve exact (reason=%s)",
							name, an.ID, an.StartAnchor.Text, reason)
					}
				}
			}
			// targetElementId sanity (round4 capability): every reference must
			// name an element (Validate enforces it; counted here for the report).
			for i := range ir.Effects {
				if ir.Effects[i].TargetElementID != "" {
					t.Logf("%s: effect %s uses element-level target %s", name, ir.Effects[i].ID, ir.Effects[i].TargetElementID)
				}
			}
		})
	}
}
