// go test -run TestGoldenC01_StructuralSanity -v ./internal/video/testdata
//
// Structural sanity guard for the C01 golden baseline (round-2 review, 2026-11-15;
// re-blessed round-3 after the X-4 fix, 2026-11-15).
// Complements the human review (§7.7: 区域亮度 / 元素边界 / 豆腐块) with pixel-level
// invariants that hold for THIS baseline batch:
//   - all 10 frames decode, identical 1080x1920
//   - cluster B: frame center is exactly #FFF7EE (el_bg)
//   - no degenerate frame EXCEPT the overlay-peak cluster Y, whose whole-frame
//     uniform tint IS the signature (see below)
//   - two deterministic signatures in the post-X-4 baseline (fa1de7c batch,
//     re-rendered byte-identical by l1-c01-20261115-211009):
//       cluster B (F0,F12,F77,F180,F320,F360,F396,F449): 1px black capture border
//         (stage #000 bleeding at the viewport edge) + AA ramp, pure bg by inset 4px
//       cluster Y (F90,F250): the X-4 fix made the target-less highlight VISIBLE —
//         at the overlay peak the opaque z-10000 overlay tints the WHOLE frame to
//         exactly #FFD166 (uniform frame, no black border). Evidence: x4_effects_
//         test.go header (behavior change, not a break) + l1-report F90 note
//         "yellow_ratio=1.0000 proves the flash is now VISIBLE" (pre-fix these
//         frames were bg-centered with a ~16% perimeter tint — the occluded state).
//     If a regeneration changes the cluster membership or the signatures, this
//     test fails and the baseline must be re-reviewed (not silently re-blessed).
// Not wired into CI gates; kept under testdata/ as a baseline-change tripwire.
package l1

import (
	"image"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

var bg = [3]int{255, 247, 238}      // #FFF7EE, VS-C01 el_bg (A-C01-05)
var overlayPeak = [3]int{255, 209, 102} // #FFD166, target-less highlight overlay at peak (X-4 post-fix)

var c01Frames = []struct {
	file    string
	cluster byte // 'B' = black-border, 'Y' = yellow-tint perimeter
}{
	{"frame-000.png", 'B'},
	{"frame-012.png", 'B'},
	{"frame-077.png", 'B'},
	{"frame-090.png", 'Y'},
	{"frame-180.png", 'B'},
	{"frame-250.png", 'Y'},
	{"frame-320.png", 'B'},
	{"frame-360.png", 'B'},
	{"frame-396.png", 'B'},
	{"frame-449.png", 'B'},
}

func loadGolden(t *testing.T, name string) image.Image {
	t.Helper()
	f, err := os.Open(filepath.Join("golden", "c01", name))
	if err != nil {
		t.Fatalf("open %s: %v", name, err)
	}
	defer f.Close()
	img, err := png.Decode(f)
	if err != nil {
		t.Fatalf("decode %s: %v", name, err)
	}
	return img
}

func rgb(img image.Image, x, y int) [3]int {
	r, g, b, _ := img.At(x, y).RGBA()
	return [3]int{int(r >> 8), int(g >> 8), int(b >> 8)}
}

func near(c, want [3]int, tol int) bool {
	return c[0]-want[0] <= tol && want[0]-c[0] <= tol &&
		c[1]-want[1] <= tol && want[1]-c[1] <= tol &&
		c[2]-want[2] <= tol && want[2]-c[2] <= tol
}

func TestGoldenC01_StructuralSanity(t *testing.T) {
	var firstW, firstH int
	for i, fr := range c01Frames {
		img := loadGolden(t, fr.file)
		b := img.Bounds()
		w, h := b.Dx(), b.Dy()
		if i == 0 {
			firstW, firstH = w, h
		}
		if w != firstW || h != firstH {
			t.Errorf("%s: dimensions %dx%d differ from first frame %dx%d", fr.file, w, h, firstW, firstH)
		}
		if w != 1080 || h != 1920 {
			t.Errorf("%s: expected 1080x1920, got %dx%d", fr.file, w, h)
		}

		// cluster-B frames: center must be exact background. Cluster-Y frames
		// sit at the overlay peak — the whole frame IS the tint, asserted below.
		if fr.cluster == 'B' {
			if c := rgb(img, w/2, h/2); c != bg {
				t.Errorf("%s: center pixel %v != bg %v", fr.file, c, bg)
			}
		}

		// degenerate-frame detection on a sparse grid (inset 8px: skip perimeter
		// band). Cluster-Y overlay-peak frames are UNIFORM by design (the opaque
		// z-10000 overlay covers every pixel) — uniformity is their signature,
		// asserted below, so the degeneracy check applies to cluster B only.
		if fr.cluster == 'B' {
			colors := map[[3]int]int{}
			dark, white, total := 0, 0, 0
			for gy := 0; gy < 32; gy++ {
				for gx := 0; gx < 18; gx++ {
					x := 8 + gx*(w-16)/17
					y := 8 + gy*(h-16)/31
					c := rgb(img, x, y)
					colors[c]++
					total++
					if c[0] < 16 && c[1] < 16 && c[2] < 16 {
						dark++
					}
					if c[0] > 250 && c[1] > 250 && c[2] > 250 {
						white++
					}
				}
			}
			if len(colors) == 1 || dark == total || white == total {
				t.Errorf("%s: degenerate frame (uniform=%v dark=%d/%d white=%d/%d)", fr.file, len(colors) == 1, dark, total, white, total)
			}
		}

		// perimeter cluster signatures
		switch fr.cluster {
		case 'B':
			// x=0 column carries pure-black capture border pixels; interior pure by inset 4
			blacks := 0
			for y := 0; y < h; y++ {
				if c := rgb(img, 0, y); c == [3]int{0, 0, 0} {
					blacks++
				}
			}
			if blacks < 4 {
				t.Errorf("%s: cluster-B signature lost: only %d pure-black px on x=0 edge", fr.file, blacks)
			}
			for _, p := range [][2]int{{4, 4}, {w - 5, 4}, {4, h - 5}, {w - 5, h - 5}} {
				if c := rgb(img, p[0], p[1]); c != bg {
					t.Errorf("%s: cluster-B inset-4 pixel (%d,%d)=%v != bg", fr.file, p[0], p[1], c)
				}
			}
		case 'Y':
			// post-X-4 signature: the target-less highlight overlay is VISIBLE
			// and opaque at its peak — the sampled frame is uniformly #FFD166
			// (no black capture border anywhere, no bg showing through).
			// Pre-fix this cluster was bg-with-perimeter-tint (occluded state).
			sampled := 0
			uniform := true
			var first [3]int
			for gy := 0; gy < 32; gy++ {
				for gx := 0; gx < 18; gx++ {
					x := 8 + gx*(w-16)/17
					y := 8 + gy*(h-16)/31
					c := rgb(img, x, y)
					if sampled == 0 {
						first = c
					}
					if c != first {
						uniform = false
					}
					sampled++
				}
			}
			if !uniform {
				t.Errorf("%s: cluster-Y overlay-peak signature lost — frame not uniform on the sparse grid (first=%v)", fr.file, first)
			}
			for _, p := range [][2]int{{4, 4}, {w / 2, h / 2}, {w - 5, h - 5}} {
				if c := rgb(img, p[0], p[1]); c != overlayPeak {
					t.Errorf("%s: cluster-Y pixel (%d,%d)=%v != overlay peak %v", fr.file, p[0], p[1], c, overlayPeak)
				}
			}
			for _, e := range []struct{ x, y int }{{0, 2}, {w - 1, 2}, {0, h - 3}, {w - 1, h - 3}} {
				if c := rgb(img, e.x, e.y); c == [3]int{0, 0, 0} {
					t.Errorf("%s: cluster-Y frame has pure-black edge pixel (%d,%d)", fr.file, e.x, e.y)
				}
			}
		}

		t.Logf("%s: %dx%d ok (cluster %c)", fr.file, w, h, fr.cluster)
	}
}
