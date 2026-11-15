// Package l1 hosts the Video Studio case-library L1 (still single-frame)
// render test for VS-C01. It lives under testdata/ on purpose: it is a test
// harness, not business code, and must never be imported by the product.
//
// What it does (docs/plan-agent-video-studio-case-library-and-test-plan-
// 2026-11-15.md §7.2, §3.1):
//
//  1. builds the DEGRADED current-IR projection of the VS-C01 target-schema
//     IR (conversion rules documented in l1-report.json "conversions"),
//  2. projects it to the self-contained player HTML via videoapp.Projector,
//  3. renders the full 450-frame loop with a REAL local headless Chrome via
//     platform/capx, keeping only the 10 keyframes
//     F0/F12/F77/F90/F180/F250/F320/F360/F396/F449,
//  4. runs existence-level structural assertions on each keyframe PNG
//     (region color statistics via Go image; no pixel-level golden compare —
//     this run IS the first baseline),
//  5. writes golden artifacts + meta.json + l1-report.json.
//
// Run: go -C example test -run TestL1RenderC01Keyframes -v ./internal/video/testdata -timeout 15m
package l1

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/haozing/ploykit/platform/capx"
	videoapp "myproduct/internal/video/app"
)

// ---- keyframe plan (§3.1.5 expected-frame table) ----

var keyframeList = []int{0, 12, 77, 90, 180, 250, 320, 360, 396, 449}

const (
	frameW       = 1080
	frameH       = 1920
	fps          = 30
	durationSec  = 15.0
	durationFrms = 450 // ceil(15*30), matches videoapp.DurationFrames
	timelineID   = "main"
)

// region rects from §3.1.2 layout / §3.1.5 assertions
var (
	rectTitle = [4]int{60, 180, 960, 240}  // (x,y,w,h) headline zone
	rectCard  = [4]int{90, 1120, 900, 380} // selling-point card zone
	rectPrice = [4]int{90, 1560, 900, 160} // price text zone
	rectOrgin = [4]int{0, 0, 300, 120}     // counter origin zone (known degradation)
	rectBar   = [4]int{90, 1780, 900, 100} // CTA orange bar zone
)

// frameSample is one kept keyframe.
type frameSample struct {
	frame        int
	timeSec      float64
	png          []byte
	cumulativeMS int64 // wall time since render start when captured
}

// sampleOut is the per-keyframe record written into l1-report.json.
type sampleOut struct {
	Frame           int            `json:"frame"`
	TimeSec         float64        `json:"time_sec"`
	Status          string         `json:"status"`
	StructureChecks map[string]any `json:"structure_checks"`
	DurationMS      int64          `json:"duration_ms"` // cumulative wall time since render start
	Artifact        string         `json:"artifact"`
	Notes           []string       `json:"notes,omitempty"`
}

func newRunID() string {
	b := make([]byte, 2)
	_, _ = rand.Read(b)
	return fmt.Sprintf("l1-c01-%s-%s", time.Now().Format("20060102-150405"), hex.EncodeToString(b))
}

// ---- degraded IR (target schema §3.1.3 -> current IR §3.1.4) ----

// c01IR builds the current-IR projection of VS-C01. Conversion rules are
// mirrored in writeReport's "conversions" array — keep both in sync.
func c01IR() *videoapp.IR {
	f64 := func(v float64) *float64 { return &v }
	pt := func(x, y float64) *videoapp.Point { return &videoapp.Point{X: x, Y: y} }

	words := []videoapp.Word{
		{Index: 0, Text: "早餐", Start: 0.0, End: 0.4, Source: videoapp.WordSourceAligner},
		{Index: 1, Text: "来不及", Start: 0.4, End: 0.86, Source: videoapp.WordSourceAligner},
		{Index: 2, Text: "杯子", Start: 1.15, End: 1.4, Source: videoapp.WordSourceAligner},
		{Index: 3, Text: "五分钟", Start: 1.4, End: 1.72, Source: videoapp.WordSourceAligner},
		{Index: 4, Text: "三倍", Start: 2.6, End: 2.9, Source: videoapp.WordSourceAligner},
		{Index: 5, Text: "搅打力", Start: 2.9, End: 3.3, Source: videoapp.WordSourceAligner},
		{Index: 6, Text: "果肉", Start: 3.78, End: 4.04, Source: videoapp.WordSourceAligner},
		{Index: 7, Text: "打细", Start: 4.28, End: 4.52, Source: videoapp.WordSourceAligner},
		{Index: 8, Text: "USB-C", Start: 5.2, End: 5.62, Source: videoapp.WordSourceManual},
		{Index: 9, Text: "充电", Start: 5.62, End: 5.86, Source: videoapp.WordSourceAligner},
		{Index: 10, Text: "充电", Start: 6.13, End: 6.37, Source: videoapp.WordSourceAligner},
		{Index: 11, Text: "十五杯", Start: 6.37, End: 6.77, Source: videoapp.WordSourceAligner},
		{Index: 12, Text: "杯身", Start: 7.8, End: 8.08, Source: videoapp.WordSourceAligner},
		{Index: 13, Text: "防水", Start: 8.08, End: 8.35, Source: videoapp.WordSourceAligner},
		{Index: 14, Text: "就干净", Start: 8.75, End: 9.25, Source: videoapp.WordSourceAligner},
		{Index: 15, Text: "一百二十九", Start: 10.64, End: 11.06, Source: videoapp.WordSourceAligner},
		{Index: 16, Text: "券后", Start: 11.1, End: 11.3, Source: videoapp.WordSourceAligner},
		{Index: 17, Text: "七十九", Start: 11.3, End: 11.66, Source: videoapp.WordSourceAligner},
		{Index: 18, Text: "一万两千六百多件", Start: 11.92, End: 12.55, Source: videoapp.WordSourceAligner},
		{Index: 19, Text: "清洁刷", Start: 14.23, End: 14.62, Source: videoapp.WordSourceAligner},
	}

	// anchors: {wordId,lastText,lastIndex} -> {text=lastText, occurrence}
	// occurrence derived per doc anchor note (repeated words count prior
	// same-text words; w10=充电#0 / w11=充电#1). All four C01 effect anchors
	// point at unique words, so occurrence=0 for each.
	rawParams := func(s string) json.RawMessage { return json.RawMessage(s) }

	ir := &videoapp.IR{
		SchemaVersion: videoapp.IRSchemaVersion,
		Meta:          videoapp.Meta{FPS: fps, Width: frameW, Height: frameH, DurationSec: durationSec},
		Script:        "早餐来不及？一只杯子五分钟出汁。三倍搅打力，六叶刀头，果肉纤维打细不残留。USB-C 充电，一次充电打十五杯。杯身防水，冲一冲就干净。日常一百二十九，券后七十九，已售一万两千六百多件。点下方购物车，今天下单再送清洁刷。",
		Words:         words,
		Effects: []videoapp.Effect{
			{ID: "ef_hook", Type: videoapp.EffectHighlight, Anchor: videoapp.Anchor{Text: "五分钟", Occurrence: 0},
				Params: rawParams(`{"color":"#FFD166"}`)},
			{ID: "ef_sales", Type: videoapp.EffectCounter, Anchor: videoapp.Anchor{Text: "一万两千六百多件", Occurrence: 0},
				Params: rawParams(`{"from":8200,"to":12600,"suffix":" 件"}`)},
			{ID: "ef_kw1", Type: videoapp.EffectHighlight, Anchor: videoapp.Anchor{Text: "三倍", Occurrence: 0},
				Params: rawParams(`{"color":"#FFD166"}`)},
			{ID: "ef_kw3", Type: videoapp.EffectHighlight, Anchor: videoapp.Anchor{Text: "防水", Occurrence: 0},
				Params: rawParams(`{"color":"#FFD166"}`)},
		},
		Elements: []videoapp.Element{
			// el_product (image) DELETED: image elements require src and no
			// asset exists in this run — recorded as a conversion rule.
			{ID: "el_bg", Type: videoapp.ElementShape, X: 0, Y: 0, W: 1080, H: 1920, Z: 0, Color: "#FFF7EE"},
			{ID: "el_headline", Type: videoapp.ElementText, Text: "早餐来不及？", Color: "#2B2118", FontSize: 76,
				X: 60, Y: 180, W: 960, H: 240, Z: 2,
				Animations: []videoapp.ElementAnimation{{
					ID: "an_headline_in", Type: "scaleIn",
					FromValue: f64(0), ToValue: f64(1), DurationFrames: 12, Easing: "power2.out",
					// target startFrame=0 anyway; no StartAnchor (all anims from t=0)
				}},
			},
			{ID: "el_cardA", Type: videoapp.ElementShape, Color: "#FFFFFF", X: 90, Y: 1120, W: 900, H: 380, Z: 10,
				Animations: []videoapp.ElementAnimation{{ID: "an_cardA_in", Type: "scaleIn", FromValue: f64(0), ToValue: f64(1), DurationFrames: 15, Easing: "back.out"}}},
			{ID: "el_cardB", Type: videoapp.ElementShape, Color: "#FFFFFF", X: 90, Y: 1120, W: 900, H: 380, Z: 10,
				Animations: []videoapp.ElementAnimation{{ID: "an_cardB_in", Type: "scaleIn", FromValue: f64(0), ToValue: f64(1), DurationFrames: 15, Easing: "back.out"}}},
			{ID: "el_cardC", Type: videoapp.ElementShape, Color: "#FFFFFF", X: 90, Y: 1120, W: 900, H: 380, Z: 10,
				Animations: []videoapp.ElementAnimation{{ID: "an_cardC_in", Type: "scaleIn", FromValue: f64(0), ToValue: f64(1), DurationFrames: 15, Easing: "back.out"}}},
			{ID: "el_price", Type: videoapp.ElementText, Text: "券后 ¥79", Color: "#FF6A3D", FontSize: 96,
				X: 90, Y: 1560, W: 900, H: 160, Z: 10}, // subText/strikeText compound keys dropped
			{ID: "el_cta", Type: videoapp.ElementShape, Color: "#FF6A3D", X: 90, Y: 1780, W: 900, H: 100, Z: 10,
				Animations: []videoapp.ElementAnimation{{
					ID: "an_cta_in", Type: "move",
					From: pt(90, 1840), To: pt(90, 1780), DurationFrames: 10, Easing: "power2.out",
					// target had from/to {y only}; x backfilled with element
					// layout x=90 because the current builder computes offsets
					// as (from.x - left) — a missing x would read as 0 and
					// shift the bar 90px left for the whole tween.
				}},
			},
		},
		// Audio: nil (assets/bgm dropped). DurationFrames still 450.
	}
	return ir
}

// ---- PNG analysis helpers (existence-level, no golden compare) ----

var pngMagic = []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}

func isDark(r, g, b uint8) bool {
	lum := 0.299*float64(r) + 0.587*float64(g) + 0.114*float64(b)
	return lum < 96
}
func isWhite(r, g, b uint8) bool  { return r >= 250 && g >= 250 && b >= 250 }
func isOrange(r, g, b uint8) bool { return r >= 220 && g >= 70 && g <= 160 && b <= 140 }
func isYellow(r, g, b uint8) bool { return r >= 240 && g >= 190 && g <= 230 && b >= 80 && b <= 130 }

// regionStats computes color-class ratios inside one rect (clipped to frame).
func regionStats(img image.Image, name string, rx, ry, rw, rh int) map[string]any {
	b := img.Bounds()
	x0, y0 := max(rx, b.Min.X), max(ry, b.Min.Y)
	x1, y1 := min(rx+rw, b.Max.X), min(ry+rh, b.Max.Y)
	var n, dark, white, orange, yellow int
	var lumSum float64
	for y := y0; y < y1; y++ {
		for x := x0; x < x1; x++ {
			r, g, bl, _ := img.At(x, y).RGBA()
			r8, g8, b8 := uint8(r>>8), uint8(g>>8), uint8(bl>>8)
			n++
			lumSum += 0.299*float64(r8) + 0.587*float64(g8) + 0.114*float64(b8)
			switch {
			case isDark(r8, g8, b8):
				dark++
			case isWhite(r8, g8, b8):
				white++
			case isOrange(r8, g8, b8):
				orange++
			case isYellow(r8, g8, b8):
				yellow++
			}
		}
	}
	rat := func(c int) float64 {
		if n == 0 {
			return 0
		}
		return float64(c) / float64(n)
	}
	mean := 0.0
	if n > 0 {
		mean = lumSum / float64(n)
	}
	return map[string]any{
		"name": name, "rect": []int{rx, ry, rw, rh}, "pixels": n,
		"dark_ratio":   round4(rat(dark)),
		"white_ratio":  round4(rat(white)),
		"orange_ratio": round4(rat(orange)),
		"yellow_ratio": round4(rat(yellow)),
		"mean_lum":     round2(mean),
	}
}

func round4(f float64) float64 { return float64(int64(f*10000+0.5)) / 10000 }
func round2(f float64) float64 { return float64(int64(f*100+0.5)) / 100 }

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// ---- test ----

func TestL1RenderC01Keyframes(t *testing.T) {
	if testing.Short() {
		t.Skip("L1 drives a real headless Chrome; skipped in -short mode")
	}
	runID := newRunID()
	_, thisFile, _, _ := runtime.Caller(0)
	baseDir := filepath.Dir(thisFile) // .../example/internal/video/testdata
	goldenDir := filepath.Join(baseDir, "golden", "c01")
	reportPath := filepath.Join(baseDir, "l1-report.json")
	if err := os.MkdirAll(goldenDir, 0o755); err != nil {
		t.Fatalf("mkdir golden dir: %v", err)
	}

	// -- 1. degraded IR: validate, resolve anchors --
	ir := c01IR()
	if err := videoapp.Validate(ir); err != nil {
		t.Fatalf("degraded IR failed Validate: %v", err)
	}
	resolutions := videoapp.ResolveAll(ir, nil)
	resJSON := make([]map[string]any, 0, len(resolutions))
	for _, r := range resolutions {
		start := 0.0
		if r.WordIndex >= 0 && r.WordIndex < len(ir.Words) {
			start = ir.Words[r.WordIndex].Start
		}
		resJSON = append(resJSON, map[string]any{
			"owner": r.Owner, "owner_id": r.OwnerID, "anchor_text": r.AnchorText,
			"word_index": r.WordIndex, "reason": r.Reason, "word_start_sec": start,
		})
		t.Logf("anchor %s(%s) %q -> word[%d] reason=%s start=%.2fs", r.OwnerID, r.Owner, r.AnchorText, r.WordIndex, r.Reason, start)
	}

	irBytes, err := json.Marshal(ir)
	if err != nil {
		t.Fatalf("marshal IR: %v", err)
	}
	irSHA := fmt.Sprintf("%x", sha256.Sum256(irBytes))
	t.Logf("degraded IR bytes=%d sha256=%s", len(irBytes), irSHA[:16]+"...")

	// -- 2. project to HTML (no image elements -> resolver never invoked;
	//       PreviewResolver default is safe) --
	proj := videoapp.NewProjector(nil)
	html, err := proj.HTML(context.Background(), ir, "")
	if err != nil {
		t.Fatalf("project HTML: %v", err)
	}
	t.Logf("projected HTML bytes=%d", len(html))

	// -- 3. capx runtime with REAL local chrome --
	chromePath, err := capx.ProbeChrome("")
	if err != nil {
		t.Fatalf("chrome probe failed: %v", err)
	}
	t.Logf("chrome: %s", chromePath)
	enabled := true
	rt, err := capx.New(capx.Config{Enabled: &enabled})
	if err != nil {
		t.Fatalf("capx.New: %v", err)
	}
	defer rt.Close()
	if !rt.Available() {
		t.Fatalf("capx runtime not available (chrome/ffmpeg probe failed)")
	}
	rend, err := rt.Renderer()
	if err != nil {
		t.Fatalf("capx Renderer: %v", err)
	}

	// -- 4. render the full 450-frame loop, keep keyframes --
	samples := map[int]*frameSample{}
	for _, f := range keyframeList {
		samples[f] = &frameSample{frame: f, timeSec: float64(f) / fps}
	}
	renderStart := time.Now()
	err = rend.RenderFrames(t.Context(),
		capx.Doc{HTML: string(html), TimelineID: timelineID},
		capx.FrameSpec{Width: frameW, Height: frameH, FPS: fps, DurationFrames: durationFrms},
		func(_ context.Context, f capx.Frame) error {
			if s, ok := samples[f.Index]; ok {
				s.png = f.PNG
				s.cumulativeMS = time.Since(renderStart).Milliseconds()
			}
			if f.Index%50 == 0 {
				t.Logf("frame %d/%d rendered (%.1fs elapsed)", f.Index, durationFrms-1, time.Since(renderStart).Seconds())
			}
			return nil
		})
	renderTotal := time.Since(renderStart)
	if err != nil {
		t.Fatalf("RenderFrames failed after %s: %v", renderTotal, err)
	}
	t.Logf("RENDER DONE: 450 frames in %s (%.1f ms/frame avg, real chrome=%s)",
		renderTotal.Round(time.Millisecond), float64(renderTotal.Milliseconds())/450, chromePath)

	// -- 5. structural checks + artifacts --
	analyzeStart := time.Now()
	var outs []sampleOut
	fails := 0
	for _, f := range keyframeList {
		s := samples[f]
		notes := []string{}
		status := "ok"
		checks := map[string]any{}

		// hard: png magic + dimensions
		checks["png_magic_ok"] = bytes.HasPrefix(s.png, pngMagic)
		var img image.Image
		decodeErr := error(nil)
		img, decodeErr = png.Decode(bytes.NewReader(s.png))
		checks["png_decoded"] = decodeErr == nil
		dimOK := false
		if decodeErr == nil {
			dimOK = img.Bounds().Dx() == frameW && img.Bounds().Dy() == frameH
		}
		checks["dimensions"] = fmt.Sprintf("%dx%d", frameW, frameH)
		checks["dimensions_ok"] = dimOK
		if !checks["png_magic_ok"].(bool) || decodeErr != nil || !dimOK {
			status = "fail"
			notes = append(notes, "PNG structural check failed")
		}

		if decodeErr == nil {
			title := regionStats(img, "title", rectTitle[0], rectTitle[1], rectTitle[2], rectTitle[3])
			card := regionStats(img, "card", rectCard[0], rectCard[1], rectCard[2], rectCard[3])
			price := regionStats(img, "price", rectPrice[0], rectPrice[1], rectPrice[2], rectPrice[3])
			origin := regionStats(img, "counter_origin", rectOrgin[0], rectOrgin[1], rectOrgin[2], rectOrgin[3])
			bar := regionStats(img, "cta_bar", rectBar[0], rectBar[1], rectBar[2], rectBar[3])
			full := regionStats(img, "full_frame", 0, 0, frameW, frameH)

			tr := title["dark_ratio"].(float64)
			cr := card["white_ratio"].(float64)
			pr := price["orange_ratio"].(float64)
			orW := origin["white_ratio"].(float64)
			orD := origin["dark_ratio"].(float64)
			br := bar["orange_ratio"].(float64)
			frY := full["yellow_ratio"].(float64)

			switch s.frame {
			case 0:
				// target: headline scale=0 -> no title ink
				checks["title_dark_ratio"] = tr
				checks["assert_title_ink_below_5pct"] = tr < 0.05
				if tr >= 0.05 {
					status = "fail"
					notes = append(notes, fmt.Sprintf("F0 title ink %.1f%% >= 5%% (scaleIn from t=0 should hide headline)", tr*100))
				}
				notes = append(notes, "degradation observed: price text and CTA bar already on screen at F0 (no element visibility windows)")
			case 12:
				checks["title_dark_ratio"] = tr
				checks["assert_title_ink_exists_ge_1pct"] = tr >= 0.01
				checks["doc_target_ge_18pct"] = tr >= 0.18
				checks["doc_target_value"] = 0.18
				if tr < 0.01 {
					status = "fail"
					notes = append(notes, "F12 title ink missing")
				}
				notes = append(notes, fmt.Sprintf("A-C01-01 doc target >=18%%: actual %.1f%% — target likely calibrated for target-schema layout (fontWeight 900 / no wrap); informational, no baseline this round", tr*100))
			case 77, 90, 180:
				checks["card_white_ratio"] = cr
				checks["assert_card_visible_ge_90pct"] = cr >= 0.90
				if s.frame == 180 {
					checks["card_green_accent_ratio"] = card["yellow_ratio"] // green #1E9E62 not covered by a dedicated class; yellow+orange ratios stay ~0 when absent
					notes = append(notes, "degradation observed: all three cards mounted from F0 and stacked at identical position/color — F77 target 'cardA not entered' and F180 'cardB distinguishable + green accent' are NOT expressible; whiteness proves the (degraded) card, not staggered entrance")
				} else {
					notes = append(notes, "degradation observed: card already fully entered at F77/F90 (target expected scale=0 at F77, scale∈[0.8,1] at F90)")
				}
				if cr < 0.90 {
					status = "fail"
					notes = append(notes, fmt.Sprintf("card zone whiteness %.1f%% < 90%%", cr*100))
				}
			case 250:
				// highlight peak per target table; degraded implementation
				// paints #canvas which el_bg fully occludes -> expect ~0
				checks["full_frame_yellow_ratio"] = frY
				checks["highlight_visible"] = frY > 0.01
				notes = append(notes, "degradation observed (stronger than documented): highlight paints the #canvas layer, which the full-canvas el_bg shape fully occludes — F250 target '#FFD166 lift' is INVISIBLE, not merely full-screen")
			case 320:
				checks["price_orange_ratio"] = pr
				checks["assert_price_ink_exists_ge_2pct"] = pr >= 0.02
				checks["counter_origin_white_ratio"] = orW
				checks["counter_origin_dark_ratio"] = orD
				if pr < 0.02 {
					status = "fail"
					notes = append(notes, fmt.Sprintf("price ink %.1f%% < 2%%", pr*100))
				}
				notes = append(notes, fmt.Sprintf("degradation observed: counter empty at F320 (word anchor starts 11.92s = F358, so F320 is BEFORE the tween; expected-frame-table's 'counter starts 8,200 at F320' does not hold under word-anchored timing). Suppression defect aside, even the pre-tween state shows no 'from' value — GSAP tween onStart also suppressed during seeks (origin zone dark_ratio=%.4f)", orD))
			case 360:
				checks["counter_origin_white_ratio"] = orW
				checks["counter_origin_dark_ratio"] = orD
				checks["counter_digits_rendered"] = orW >= 0.005
				// KNOWN DEFECT (root-caused by TestProbeCounterDOMState, see
				// report evidence): capx seekTimeline calls tl.pause(t) with a
				// single argument; GSAP defaults suppressEvents=true, which
				// suppresses onUpdate during seeks. The counter tween exists
				// and advances (progress 0.067 at t=12), but its onUpdate
				// never runs, so textContent stays "" on every seeked frame.
				// pause(12, false) renders "8767 件" — proving the mechanism.
				status = "fail"
				notes = append(notes, "KNOWN DEFECT (root-caused): counter digits absent on ALL seeked frames — capx tl.pause(t) suppresses GSAP onUpdate events (suppressEvents default true); tween object advances but textContent never updates. Probe: pause(12,false) yields '8767 件'.")
				notes = append(notes, fmt.Sprintf("counter host node exists in DOM (probe: id=counter-ef_sales, 96px/700, color rgb(255,255,255) WHITE on cream bg — style defect too) but textContent='' and rect 0x0; origin zone white_ratio=%.4f dark_ratio=%.4f", orW, orD))
			case 396:
				checks["bar_orange_ratio"] = br
				checks["bar_white_text_ratio"] = bar["white_ratio"]
				checks["assert_bar_orange_ge_80pct"] = br >= 0.80
				if br < 0.80 {
					status = "fail"
					notes = append(notes, fmt.Sprintf("CTA bar orange %.1f%% < 80%%", br*100))
				}
				notes = append(notes, "degradation observed: CTA bar has NO text (text/textColor compound keys unconsumed) — plain orange bar; entry move completed at ~F10 (from t=0) so bar rests at y=1780")
			case 449:
				checks["bar_orange_ratio"] = br
				checks["assert_bar_still_present_ge_50pct"] = br >= 0.50
				checks["full_frame_mean_lum"] = full["mean_lum"]
				notes = append(notes, fmt.Sprintf("degradation observed: target F445 whole-frame fade-to-dark not expressible (fade effect needs a word anchor; last word ends 14.62s ≠ 14.83s) — mean luminance %.1f stays at background level", full["mean_lum"].(float64)))
				if br < 0.50 {
					status = "fail"
					notes = append(notes, fmt.Sprintf("CTA bar missing at F449 (%.1f%%)", br*100))
				}
			}
		}

		if status != "ok" {
			fails++
		}

		// write golden artifact
		artifactRel := filepath.ToSlash(filepath.Join("example", "internal", "video", "testdata", "golden", "c01", fmt.Sprintf("frame-%03d.png", s.frame)))
		artifactAbs := filepath.Join(goldenDir, fmt.Sprintf("frame-%03d.png", s.frame))
		if werr := os.WriteFile(artifactAbs, s.png, 0o644); werr != nil {
			t.Fatalf("write golden frame %d: %v", s.frame, werr)
		}

		outs = append(outs, sampleOut{
			Frame: s.frame, TimeSec: s.timeSec, Status: status,
			StructureChecks: checks, DurationMS: s.cumulativeMS,
			Artifact: artifactRel, Notes: notes,
		})
		t.Logf("F%-3d status=%s checks=%s", s.frame, status, mustJSON(checks))
		for _, n := range notes {
			t.Logf("      note: %s", n)
		}
	}

	// -- 6. meta.json + l1-report.json --
	ffVer := ffmpegVersion(t)
	meta := map[string]any{
		"case":                "VS-C01",
		"layer":               "L1",
		"run_id":              runID,
		"fps":                 fps,
		"duration_frames":     durationFrms,
		"width":               frameW,
		"height":              frameH,
		"frames":              keyframeList,
		"frame_basis":         "ceil(durationSec*fps)=ceil(15*30)=450, videoapp.DurationFrames",
		"generated_at":        time.Now().Format(time.RFC3339),
		"chrome":              chromePath,
		"ffmpeg":              ffVer,
		"go":                  runtime.Version(),
		"ir_sha256":           irSHA,
		"ir_sha256_algorithm": "sha256(json.Marshal(videoapp.IR) after ResolveAll, before projection)",
		"render_total_ms":     renderTotal.Milliseconds(),
		"render_mode":         "full 450-frame loop; only keyframes kept",
		"notes":               "first baseline run — no golden compare; structural existence assertions only",
	}
	metaBytes, _ := json.MarshalIndent(meta, "", "  ")
	if err := os.WriteFile(filepath.Join(goldenDir, "meta.json"), metaBytes, 0o644); err != nil {
		t.Fatalf("write meta.json: %v", err)
	}

	okCount := len(outs) - fails
	report := map[string]any{
		"layer":  "L1",
		"run_id": runID,
		"case":   "VS-C01",
		"env": map[string]string{
			"chrome":   chromePath,
			"ffmpeg":   ffVer,
			"go":       runtime.Version(),
			"os":       runtime.GOOS + "/" + runtime.GOARCH,
			"capx":     "github.com/haozing/ploykit/platform/capx (local headless chrome, pool=1)",
			"chromedp": "real browser process — frame loop via CDP Page.captureScreenshot",
		},
		"samples":      outs,
		"degradations": degradationNotes(outs),
		"defects": []map[string]any{
			{
				"id":            "D-01",
				"found":         "counter renders no digits on ANY seeked frame (not a layout degradation)",
				"evidence":      "TestProbeCounterDOMState (testdata/probe_dom_test.go, real browser): counter host div exists (id=counter-ef_sales, 96px/700/white) but textContent='' at seeks to 5s/12s/13.5s; timeline child tween present (start=11.92s, dur=1.2s, target v 8200->12600, progress 0.067 at t=12). pause(12, false) => textContent becomes '8767 件'.",
				"root_cause":    "platform/capx/renderer.go seekTimeline calls tl.pause(tSec) with one argument; GSAP Timeline.pause(atTime, suppressEvents) defaults suppressEvents=true, which skips callbacks (onUpdate/onStart) during the seek render. timeline-builder.js counter effect relies solely onUpdate to write digits.",
				"impact":        "counter effect unusable end-to-end in render path: L1 F360/A-C01-03 fails; any MP4 rendered through capx would show an empty counter for its whole window. F449 target 'counter settles at 12,600' also void.",
				"fix_direction": "either capx seekTimeline pauses with suppressEvents=false (pause(t, false)), or timeline-builder.js counter writes text via tween progress in a non-event path (e.g. onUpdate rendered through gsap's render loop) — framework decision, belongs to capx+builder owners.",
			},
		},
		"conversions": conversionRules(),
		"totals": map[string]any{
			"frames_planned":      durationFrms,
			"frames_rendered":     durationFrms,
			"keyframes_kept":      len(keyframeList),
			"samples_ok":          okCount,
			"samples_fail":        fails,
			"render_total_ms":     renderTotal.Milliseconds(),
			"render_ms_per_frame": round2(float64(renderTotal.Milliseconds()) / durationFrms),
			"analysis_total_ms":   time.Since(analyzeStart).Milliseconds(),
		},
		"evidence": map[string]any{
			"golden_dir":         "example/internal/video/testdata/golden/c01/",
			"meta_json":          "example/internal/video/testdata/golden/c01/meta.json",
			"report_json":        "example/internal/video/testdata/l1-report.json",
			"ir_sha256":          irSHA,
			"anchor_resolutions": resJSON,
			"html_bytes":         len(html),
			"timeline_id":        timelineID,
			"chrome_real_render": fmt.Sprintf("chrome=%s rendered 450 frames in %s", chromePath, renderTotal.Round(time.Millisecond)),
			"plan_doc":           "docs/plan-agent-video-studio-case-library-and-test-plan-2026-11-15.md §3.1 §7.2",
		},
	}
	repBytes, _ := json.MarshalIndent(report, "", "  ")
	if err := os.WriteFile(reportPath, repBytes, 0o644); err != nil {
		t.Fatalf("write report: %v", err)
	}

	if fails > 0 {
		t.Errorf("L1 structural checks: %d/%d keyframes failed (see l1-report.json)", fails, len(outs))
	}
}

// degradationNotes aggregates per-frame observed degradations into the report
// top-level list (each entry is grounded in the sample numbers).
func degradationNotes(outs []sampleOut) []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range outs {
		for _, n := range s.Notes {
			key := n
			if strings.Contains(n, "A-C01-01 doc target") || strings.HasPrefix(n, "F12 title ink") {
				continue // informational, not degradation
			}
			if !seen[key] {
				seen[key] = true
				out = append(out, fmt.Sprintf("[F%03d] %s", s.Frame, n))
			}
		}
	}
	return out
}

// conversionRules documents every target-schema -> current-IR decision.
func conversionRules() []map[string]string {
	return []map[string]string{
		{
			"target":  "effects[].anchor {wordId, lastText, lastIndex, resolvedFrom, status}",
			"current": "Anchor{text, occurrence}",
			"rule":    "text := lastText; occurrence := number of prior same-text words (doc anchor note: w10=充电#0, w11=充电#1). C01's four effects (w04 五分钟, w05 三倍, w14 防水, w19 一万两千六百多件) anchor unique words -> occurrence=0 each; the 充电 disambiguation rule was not exercised by any C01 effect.",
		},
		{
			"target":  "animations[].startFrame (+ elements[].startFrame/endFrame visibility windows)",
			"current": "(no field)",
			"rule":    "startFrame deleted; ALL animations scheduled from t=0 with durationFrames kept. Consequence: three cards scale in simultaneously at F0-F15; headline/CTA entrances finish in the first ~0.4s regardless of their target scene positions.",
		},
		{
			"target":  "effects[].targetElementId (counter -> el_price, highlight -> el_headline/el_cardA/el_cardC)",
			"current": "(no field)",
			"rule":    "targetElementId deleted. Builder behavior: counter self-hosts <div id=counter-<fxId>> at canvas origin (0,0), 96px white text; highlight applies to the whole #canvas layer. NOTE: digits never appear on seeked frames due to defect D-01 (GSAP onUpdate suppression); white-on-cream color is an additional visibility defect once D-01 is fixed.",
		},
		{
			"target":  "el_product (type=image, src=video/c01/product-main.png)",
			"current": "(element deleted)",
			"rule":    "No asset bytes exist in this run and image elements REQUIRE src (Validate rejects empty src), so the image element was removed entirely. Chosen over a fake resolver/data-URI placeholder: lowest implementation cost, and a fake product image would contaminate first-baseline frames.",
		},
		{
			"target":  "assets[] / tracks[] / render{} blocks",
			"current": "(deleted)",
			"rule":    "No asset table, no track model, no render-recipe fields in current IR. Audio set to nil (BGM dropped); DurationFrames stays 450 via meta.durationSec=15 x fps=30. Track layering approximated by element z: bg=0, headline=2, cards/price/cta=10.",
		},
		{
			"target":  "compound params keys: mask{roundedRect,rx:32}, title/body/accent (cards), subText/strikeText (price), text/textColor/fontSize/textAlign (cta), fontWeight/textAlign/lineHeight (headline)",
			"current": "(dropped — Element only carries text/color/fontSize/x/y/w/h/z)",
			"rule":    "Compound keys deleted; cards become plain white rects, CTA becomes a textless orange bar, headline loses bold/centering/line-height control.",
		},
		{
			"target":  "animations[].from/to given as {y:...} only (an_cta_in)",
			"current": "Point{x,y} offsets interpreted as (value - element layout position)",
			"rule":    "x backfilled with the element's layout x (90) because the current move builder computes from.x - left; a missing x would read as 0 and shift the bar 90px left during the whole tween. Intent-preserving choice, recorded here.",
		},
		{
			"target":  "words[]: id/source/confidence/scriptStart/scriptEnd",
			"current": "Word{index,text,start,end,source}",
			"rule":    "id/confidence/scriptStart/scriptEnd dropped (no fields); all 20 words copied verbatim with their timestamps (aligner/manual source kept).",
		},
		{
			"target":  "F445 whole-frame fade (scene 6)",
			"current": "(not expressed)",
			"rule":    "A fade effect exists in the current registry but is word-anchored and fades a target opacity over 0.6s; the target's frame-based F445 dim has no expressible anchor (last word ends 14.62s). Omitted.",
		},
	}
}

func mustJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprintf("%v", v)
	}
	return string(b)
}

func ffmpegVersion(t *testing.T) string {
	t.Helper()
	p, err := exec.LookPath("ffmpeg")
	if err != nil {
		return "not found on PATH"
	}
	out, err := exec.Command(p, "-hide_banner", "-version").Output()
	if err != nil {
		return "error: " + err.Error()
	}
	first := strings.SplitN(string(out), "\n", 2)[0]
	return strings.TrimSpace(first)
}
