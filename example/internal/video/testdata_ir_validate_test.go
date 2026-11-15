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
	files := []string{"c04.degraded.json", "c06.degraded.json"}
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
		})
	}
}
