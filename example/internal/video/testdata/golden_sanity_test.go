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
//     cluster B (F0,F12,F77,F180,F320,F360,F396,F449): 1px black capture border
//     (stage #000 bleeding at the viewport edge) + AA ramp, pure bg by inset 4px
//     cluster Y (F90,F250): the X-4 fix made the target-less highlight VISIBLE —
//     at the overlay peak the opaque z-10000 overlay tints the WHOLE frame to
//     exactly #FFD166 (uniform frame, no black border). Evidence: x4_effects_
//     test.go header (behavior change, not a break) + l1-report F90 note
//     "yellow_ratio=1.0000 proves the flash is now VISIBLE" (pre-fix these
//     frames were bg-centered with a ~16% perimeter tint — the occluded state).
//     If a regeneration changes the cluster membership or the signatures, this
//     test fails and the baseline must be re-reviewed (not silently re-blessed).
//
// C04 golden tripwire (round-6 review, 2026-11-15; see TestGoldenC04_StructuralSanity):
// post-X-4/D-01 signatures on the 1800-frame degraded IR render.
//
// C06 golden tripwire (round-6 review, 2026-11-15; see TestGoldenC06_StructuralSanity):
// post-X-4 signatures on the 2250-frame degraded IR render.
//
// Not wired into CI gates; kept under testdata/ as a baseline-change tripwire.
package l1

import (
	"crypto/sha256"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

var bg = [3]int{255, 247, 238}          // #FFF7EE, VS-C01 el_bg (A-C01-05)
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

// ---- shared helpers for the C04/C06 tripwires ----

// loadGoldenIn loads golden/<dir>/<name> (C01's loadGolden is c01-specific).
func loadGoldenIn(t *testing.T, dir, name string) image.Image {
	t.Helper()
	f, err := os.Open(filepath.Join("golden", dir, name))
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

// inkCount counts pixels matching pred in the rect x0..x1, y0..y1 (inclusive,
// stepped). Dense-scan variant of C01's sparse-grid sampler, used where the
// signature IS local ink (text/bars) rather than whole-frame color.
func inkCount(img image.Image, x0, x1, y0, y1, step int, pred func(r, g, b int) bool) int {
	n := 0
	for y := y0; y <= y1; y += step {
		for x := x0; x <= x1; x += step {
			r, g, b, _ := img.At(x, y).RGBA()
			if pred(int(r>>8), int(g>>8), int(b>>8)) {
				n++
			}
		}
	}
	return n
}

// TestGoldenC04_StructuralSanity pins the round-6 re-reviewed C04 baseline
// (l1-04-20261115-210242-4448; X-4 + D-01 post-fix signatures):
//
//   - 11 frames decode, identical 1920x1080; F1260/F1620/F1799 byte-identical
//     (deterministic settled tail — everything after the last anchor at F957
//     is static; a diff means the renderer is no longer seek-deterministic).
//   - cluster Bg (F0,F24,F180): pure #F2F5F9 canvas (el_bg), no counter ink,
//     no bars. F180 pre-bar22 (anchor 二零二二 occ0 = 6.6s -> F198): bars absent.
//   - F216: bar22 VISIBLE mid-scaleIn (post-D-01 anchor-driven render), bars
//     23/24 still absent (anchors F261/F303), no counter ink yet (anchor F303).
//     Rounded-corner degrade: the (185,625) interior is solid #2E86DE while
//     the (181,621) corner is blended — a sharp-corner bar would be solid at
//     both; ring is a square shape with radius (C04-D7 circle degrade).
//   - F540: bar22 settled; el_line NOT yet visible (anchor 增速 occ1 = 18.3s
//     -> F549); el_note NOT yet visible (same anchor). No counter yet? — the
//     bar24 counter anchor is 二零二四 occ0 = 10.1s -> F303, window 303-339;
//     by F540 the D-01 post-fix renderer shows the SETTLED terminal value
//     "1349084 亿元" inked at the canvas origin (pre-fix this was blank: D-01).
//   - F720: el_line 440x300 solid #2E86DE rect visible (the D1 degrade: a
//     three-point line chart rendered as one filled rectangle), el_note inked.
//   - F900: pre-ring (anchor 产业 occ0 = 30.3s -> F909): ring region still bg.
//   - F960: ring square #F5A623 visible + "56.7%" text inked (ring_num) +
//     counter digits ROLLING (origin-region ink grows vs F900 — D-01 proof).
//   - tail: no amber flash anywhere on the sampled grid (the ef_hl_growth
//     overlay window F909-F943 is over by F960; golden keeps no in-flash
//     frame, so whole-frame tint is NOT part of this baseline).
//
// If a regeneration breaks any signature, this test fails and the baseline
// must be re-reviewed (not silently re-blessed).
func TestGoldenC04_StructuralSanity(t *testing.T) {
	const (
		wWant, hWant = 1920, 1080
	)
	var bgC04 = [3]int{242, 245, 249}    // #F2F5F9 el_bg
	var barBlue = [3]int{46, 134, 222}   // #2E86DE bars / line / caption title
	var ringAmber = [3]int{245, 166, 35} // #F5A623 ring square

	var firstHash string
	for i, fr := range []struct {
		file string
	}{
		{"frame-000.png"}, {"frame-024.png"}, {"frame-180.png"}, {"frame-216.png"},
		{"frame-540.png"}, {"frame-720.png"}, {"frame-900.png"}, {"frame-960.png"},
		{"frame-1260.png"}, {"frame-1620.png"}, {"frame-1799.png"},
	} {
		img := loadGoldenIn(t, "c04", fr.file)
		b := img.Bounds()
		if b.Dx() != wWant || b.Dy() != hWant {
			t.Errorf("%s: expected %dx%d, got %dx%d", fr.file, wWant, hWant, b.Dx(), b.Dy())
		}

		// counter ink at the canvas origin (0..140 x 0..700 band): absent on the
		// pre-counter frames, present from F540 onward (D-01 post-fix).
		cnt := inkCount(img, 0, 700, 0, 140, 2, func(r, g, b int) bool {
			return r < 80 && g < 80 && b < 80
		})
		preCounter := i <= 3 // F0,F24,F180,F216
		if preCounter && cnt > 20 {
			t.Errorf("%s: counter ink present (%d px) before the bar24 counter anchor (F303)", fr.file, cnt)
		}
		if !preCounter && cnt < 400 {
			t.Errorf("%s: counter ink missing at origin (%d px) — D-01 post-fix the settled digits must stay visible", fr.file, cnt)
		}

		switch fr.file {
		case "frame-000.png", "frame-180.png":
			// cluster Bg: center is exactly el_bg
			if c := rgb(img, wWant/2, hWant/2); c != bgC04 {
				t.Errorf("%s: center %v != bg %v", fr.file, c, bgC04)
			}
			// bar22 region pure bg (no bars yet)
			for _, p := range [][2]int{{240, 700}, {400, 700}, {580, 700}} {
				if c := rgb(img, p[0], p[1]); c != bgC04 {
					t.Errorf("%s: bar-region pixel (%d,%d)=%v != bg — bars must not render before their anchors", fr.file, p[0], p[1], c)
				}
			}
		case "frame-024.png":
			// cluster Bg: center is exactly el_bg
			if c := rgb(img, wWant/2, hWant/2); c != bgC04 {
				t.Errorf("%s: center %v != bg %v", fr.file, c, bgC04)
			}
			// bar22 region pure bg (no bars yet)
			for _, p := range [][2]int{{240, 700}, {400, 700}, {580, 700}} {
				if c := rgb(img, p[0], p[1]); c != bgC04 {
					t.Errorf("%s: bar-region pixel (%d,%d)=%v != bg — bars must not render before their anchors", fr.file, p[0], p[1], c)
				}
			}
			// title settled: navy ink in the title band
			ink := inkCount(img, 940, 1720, 200, 262, 2, func(r, g, b int) bool {
				return b > 80 && b > r+30 && r < 120
			})
			if ink < 500 {
				t.Errorf("%s: title ink missing (%d px) — scaleIn should be settled at F24", fr.file, ink)
			}
		case "frame-216.png":
			// bar22 visible, bar23/24 not yet (anchors F261/F303)
			if c := rgb(img, 240, 700); c != barBlue {
				t.Errorf("%s: bar22 (240,700)=%v != barBlue — bar22 anchor F198 should be rendering", fr.file, c)
			}
			for _, p := range [][2]int{{400, 700}, {580, 700}} {
				if c := rgb(img, p[0], p[1]); c != bgC04 {
					t.Errorf("%s: (%d,%d)=%v != bg — bars 23/24 must not render before F261/F303", fr.file, p[0], p[1], c)
				}
			}
			// rounded-corner degrade signature: interior solid, corner blended
			if c := rgb(img, 185, 625); c != barBlue {
				t.Errorf("%s: bar22 interior (185,625)=%v != barBlue", fr.file, c)
			}
			if c := rgb(img, 181, 621); c == barBlue {
				t.Errorf("%s: bar22 corner (181,621)=%v is solid — rounded-corner degrade lost (sharp corners?)", fr.file, c)
			}
		case "frame-540.png":
			// bar22 settled, line+note not yet (anchor F549)
			if c := rgb(img, 240, 700); c != barBlue {
				t.Errorf("%s: bar22 (240,700)=%v != barBlue", fr.file, c)
			}
			if n := inkCount(img, 800, 1240, 360, 660, 4, func(r, g, b int) bool {
				return r == barBlue[0] && g == barBlue[1] && b == barBlue[2]
			}); n != 0 {
				t.Errorf("%s: el_line visible (%d px) before its anchor F549", fr.file, n)
			}
		case "frame-720.png":
			// el_line rect visible (D1 degrade: filled 440x300 rectangle)
			if n := inkCount(img, 800, 1240, 360, 660, 4, func(r, g, b int) bool {
				return r == barBlue[0] && g == barBlue[1] && b == barBlue[2]
			}); n < 3000 {
				t.Errorf("%s: el_line rect missing (%d px) — anchor F549 + 60-frame scaleIn should be settled", fr.file, n)
			}
			// el_note inked
			if n := inkCount(img, 80, 1000, 825, 885, 2, func(r, g, b int) bool {
				return r < 130 && b > 100 && b < 230
			}); n < 200 {
				t.Errorf("%s: el_note ink missing (%d px)", fr.file, n)
			}
		case "frame-900.png":
			// pre-ring: ring region still bg (anchor F909)
			if c := rgb(img, 1520, 520); c != bgC04 {
				t.Errorf("%s: ring pixel (1520,520)=%v != bg — ring must not render before F909", fr.file, c)
			}
		case "frame-960.png":
			// ring square + ring_num text + rolling counter
			if c := rgb(img, 1520, 520); c != ringAmber {
				t.Errorf("%s: ring center (1520,520)=%v != ringAmber", fr.file, c)
			}
			if n := inkCount(img, 1420, 1620, 480, 560, 2, func(r, g, b int) bool {
				return r < 90 && g < 90
			}); n < 80 {
				t.Errorf("%s: ring_num '56.7%%' ink missing (%d px)", fr.file, n)
			}
			if n := inkCount(img, 0, 700, 0, 140, 2, func(r, g, b int) bool {
				return r < 80 && g < 80 && b < 80
			}); n < 2500 {
				t.Errorf("%s: counter ink (%d) below settled-bar24 level — digits lost?", fr.file, n)
			}
		}
		_ = firstHash
		t.Logf("%s: ok", fr.file)
	}

	// settled-tail determinism: F1260 == F1620 == F1799 byte-for-byte
	var hashes [3]string
	for i, f := range []string{"frame-1260.png", "frame-1620.png", "frame-1799.png"} {
		data, err := os.ReadFile(filepath.Join("golden", "c04", f))
		if err != nil {
			t.Fatalf("read %s: %v", f, err)
		}
		hashes[i] = fmt.Sprintf("%x", sha256.Sum256(data))[:12]
	}
	if hashes[0] != hashes[1] || hashes[1] != hashes[2] {
		t.Errorf("settled tail not byte-identical: %v — renderer lost seek-determinism, re-review required", hashes)
	}

	// no amber overlay tint anywhere on the kept frames (the F909-F943 flash
	// window is over by F960 and golden keeps no in-flash frame)
	for _, f := range []string{"frame-900.png", "frame-960.png", "frame-1260.png"} {
		img := loadGoldenIn(t, "c04", f)
		amber := 0
		for gy := 0; gy < 32; gy++ {
			for gx := 0; gx < 18; gx++ {
				x := 8 + gx*(wWant-16)/17
				y := 8 + gy*(hWant-16)/31
				r, g, b, _ := img.At(x, y).RGBA()
				r8, g8, b8 := int(r>>8), int(g>>8), int(b>>8)
				if r8 > 200 && g8 > 140 && g8 < 210 && b8 < 90 {
					amber++
				}
			}
		}
		// the ring square legitimately sits under a few grid points on F960/F1260
		maxAllowed := 0
		if f != "frame-900.png" {
			maxAllowed = 20
		}
		if amber > maxAllowed {
			t.Errorf("%s: whole-frame amber tint on %d grid points (max %d) — an overlay flash leaked outside its window", f, amber, maxAllowed)
		}
	}
}

// TestGoldenC06_StructuralSanity pins the round-6 re-reviewed C06 baseline
// (l1-06-20261115-210605-2da6; X-4 post-fix signatures):
//
//   - 11 frames decode, identical 1920x1080; F675..F2025 byte-identical (the
//     degraded IR has no driver after the F474 caption move settles — a diff
//     means the renderer is no longer seek-deterministic).
//   - F0: black frame (page stage behind the scaleIn-from-0 shots) with ONLY
//     the divider + the immediateRender caption visible. The caption at x≈483
//     is the an_caption_move from-state (immediateRender applies the from x=480
//     at build time — recorded delta, M2 note in l1-c06-report).
//   - F20+: settled two-shot layout — shotA #1E2530, shotB #251E30, divider
//     exactly x 958-961 #2A313B.
//   - nameA ink from F20 (no anchor), nameB ink only from F450 (anchor
//     窄场景 occ1 = 9.2s -> F230, settled well before F450).
//   - caption pre-move through F450 (left edge ≈483), post-move from F675
//     (left edge ≈963 — the F464-F474 move landed; M2 records both states).
//   - F2249: endline '先把一件小事做到不返工' inked (anchor 返工 = 85.2s -> F2130,
//     settled before the tail) + the static cue-1 caption still on screen
//     (soft-subtitle track absent — C06-D2 degrade, recorded not re-reported).
//   - whole-frame blue (#2E86DE) tint absent on ALL kept frames: the
//     ef_hl_turn overlay flash (F24-F46 peak) has no golden keyframe inside
//     its window; a tint here would mean a flash leaked/stuck (X-4 regression).
//
// If a regeneration breaks any signature, this test fails and the baseline
// must be re-reviewed (not silently re-blessed).
func TestGoldenC06_StructuralSanity(t *testing.T) {
	var shotA = [3]int{30, 37, 48}   // #1E2530
	var shotB = [3]int{37, 30, 48}   // #251E30
	var divider = [3]int{42, 49, 59} // #2A313B

	frames := []string{
		"frame-000.png", "frame-020.png", "frame-225.png", "frame-450.png",
		"frame-675.png", "frame-900.png", "frame-1125.png", "frame-1350.png",
		"frame-1800.png", "frame-2025.png", "frame-2249.png",
	}

	// caption left-edge probe: leftmost near-white px in the caption band
	capLeft := func(img image.Image) int {
		for x := 0; x < 1920; x += 3 {
			for y := 955; y <= 1040; y += 4 {
				r, g, b, _ := img.At(x, y).RGBA()
				if int(r>>8) > 200 && int(g>>8) > 200 && int(b>>8) > 200 {
					return x
				}
			}
		}
		return -1
	}
	// nameA blue ink / nameB purple ink density in the name-bar bands
	nameAInk := func(img image.Image) int {
		return inkCount(img, 40, 520, 860, 915, 3, func(r, g, b int) bool {
			return b > 140 && b > r+40 && g < 160
		})
	}
	nameBInk := func(img image.Image) int {
		return inkCount(img, 980, 1500, 860, 915, 3, func(r, g, b int) bool {
			return r > 90 && b > 150 && g < 110
		})
	}

	var firstHash string
	for i, f := range frames {
		img := loadGoldenIn(t, "c06", f)
		b := img.Bounds()
		if b.Dx() != 1920 || b.Dy() != 1080 {
			t.Errorf("%s: expected 1920x1080, got %dx%d", f, b.Dx(), b.Dy())
		}

		// no whole-frame blue overlay tint (X-4 regression tripwire)
		blueTint := 0
		for gy := 0; gy < 32; gy++ {
			for gx := 0; gx < 18; gx++ {
				x := 8 + gx*(1920-16)/17
				y := 8 + gy*(1080-16)/31
				r, g, bl, _ := img.At(x, y).RGBA()
				r8, g8, b8 := int(r>>8), int(g>>8), int(bl>>8)
				if r8 < 80 && g8 > 110 && g8 < 170 && b8 > 190 {
					blueTint++
				}
			}
		}
		if blueTint > 0 {
			t.Errorf("%s: whole-frame blue tint on %d grid points — the ef_hl_turn overlay flash leaked outside its F24-F46 window", f, blueTint)
		}

		switch f {
		case "frame-000.png":
			// pre-scaleIn: both shot regions pure stage black; divider visible
			if c := rgb(img, 480, 400); c != [3]int{0, 0, 0} {
				t.Errorf("%s: shotA region (480,400)=%v != black", f, c)
			}
			if c := rgb(img, 1440, 400); c != [3]int{0, 0, 0} {
				t.Errorf("%s: shotB region (1440,400)=%v != black", f, c)
			}
			if c := rgb(img, 960, 300); c != divider {
				t.Errorf("%s: divider (960,300)=%v != %v", f, c, divider)
			}
			// immediateRender from-state caption at x≈480
			if l := capLeft(img); l < 0 || l > 500 {
				t.Errorf("%s: caption left edge %d — expected ≈483 (immediateRender from-state)", f, l)
			}
		case "frame-020.png", "frame-225.png", "frame-450.png",
			"frame-675.png", "frame-900.png", "frame-1125.png", "frame-1350.png",
			"frame-1800.png", "frame-2025.png", "frame-2249.png":
			if c := rgb(img, 480, 400); c != shotA {
				t.Errorf("%s: shotA (480,400)=%v != %v", f, c, shotA)
			}
			if c := rgb(img, 1440, 400); c != shotB {
				t.Errorf("%s: shotB (1440,400)=%v != %v", f, c, shotB)
			}
			if c := rgb(img, 960, 300); c != divider {
				t.Errorf("%s: divider (960,300)=%v != %v", f, c, divider)
			}
		}

		// name-bar timing: nameA always-on after scaleIn; nameB from F230 only
		if f == "frame-000.png" {
			if n := nameAInk(img); n > 5 {
				t.Errorf("%s: nameA ink (%d) before its scaleIn settles", f, n)
			}
		} else if n := nameAInk(img); n < 50 {
			t.Errorf("%s: nameA ink missing (%d px)", f, n)
		}
		if n := nameBInk(img); i < 3 { // F0, F20, F225 — all pre/settling anchor F230
			if n > 5 {
				t.Errorf("%s: nameB ink (%d px) before its anchor F230", f, n)
			}
		} else if n < 50 {
			t.Errorf("%s: nameB ink missing (%d px) — anchor F230 should be settled by F450", f, n)
		}

		// caption position: pre-move left edge ≈483 through F450, ≈963 from F675
		if f != "frame-000.png" {
			l := capLeft(img)
			if i <= 3 { // F20, F225, F450
				if l < 0 || l > 520 {
					t.Errorf("%s: caption left edge %d — expected ≈483 (pre-move state)", f, l)
				}
			} else {
				if l < 900 {
					t.Errorf("%s: caption left edge %d — expected ≈963 (post-move state; the F464-474 move regressed?)", f, l)
				}
			}
		}

		// endline ink only on the tail frame
		elInk := inkCount(img, 600, 1300, 755, 815, 3, func(r, g, b int) bool {
			return r > 200 && g > 200 && b > 200
		})
		if f == "frame-2249.png" {
			if elInk < 100 {
				t.Errorf("%s: endline ink missing (%d px) — anchor F2130 should be settled at the tail", f, elInk)
			}
		} else if elInk > 0 {
			t.Errorf("%s: endline ink present (%d px) before its anchor F2130", f, elInk)
		}

		_ = firstHash
		_ = i
		t.Logf("%s: ok", f)
	}

	// settled-tail determinism: F675..F2025 byte-identical (no driver after F474)
	var hashes [6]string
	for i, f := range []string{"frame-675.png", "frame-900.png", "frame-1125.png", "frame-1350.png", "frame-1800.png", "frame-2025.png"} {
		data, err := os.ReadFile(filepath.Join("golden", "c06", f))
		if err != nil {
			t.Fatalf("read %s: %v", f, err)
		}
		hashes[i] = fmt.Sprintf("%x", sha256.Sum256(data))[:12]
	}
	for i := 1; i < len(hashes); i++ {
		if hashes[i] != hashes[0] {
			t.Errorf("settled tail not byte-identical: %v — renderer lost seek-determinism, re-review required", hashes)
			break
		}
	}
}
