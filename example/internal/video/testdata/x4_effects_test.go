//go:build capx

// X-4 element-level effects — L2 pixel proof (case library §5.12/§8.2, round1
// §2.2 X-4, round2 §1 C04/C06; docs/delivery-audit-video-studio-round2-2026-11-15.md).
//
// X-4 (P0 decision): highlight/pulse/shake/fade all painted #canvas, which the
// full-canvas el_bg shape fully occluded — highlights were INVISIBLE (C04 F916
// amber≈0), pulse scaled the whole canvas (C06 464-476), fade dimmed a layer
// nobody could see. This file proves the fix through the real encode chain
// (Projector.HTML → capx RenderFrames → os.Pipe → EncodePNGStream → MP4 →
// ffmpeg frame extraction), one MP4 per scope mode:
//
//  1. ELEMENT-LEVEL highlight (targetElementId): a small target tile in the
//     upper-right; during the flash window that tile's region shows a
//     params.color lift (near-color share >10% at peak), and the FULL frame
//     amber share stays ~0 outside it (no whole-frame flash from an
//     element-scoped effect).
//  2. TARGET-LESS highlight (overlay path): no targetElementId → the flash
//     paints a z-10000 full-canvas overlay — the WHOLE frame shows the amber
//     lift at peak. This is the first time a legacy IR's highlight is visible
//     AT ALL (pre-fix it was ~0 everywhere: occluded behind el_bg). The pixel
//     delta vs the old builder is the fix itself (recorded as a behavior
//     change, not a break).
//  3. ELEMENT-LEVEL pulse (targetElementId): scale wave on a left-edge tile —
//     the target region's pixel diff across the pulse window is >300 px while
//     the canvas elsewhere is static (pulse no longer scales the world).
//
// Also asserted (cheap, same chain): IR Validate accepts the element-level
// effects, and the MP4s pass the artifact gate (ftyp / geometry / fps / frame
// count / duration ±1 frame / silent).
//
// Artifacts (§7.0 retention):
//   testdata/x4/ELEMENT-HIGHLIGHT/output.mp4 + frame-t*.png
//   testdata/x4/OVERLAY-HIGHLIGHT/output.mp4  + frame-t*.png
//   testdata/x4/ELEMENT-PULSE/output.mp4      + frame-t*.png
//   testdata/x4-l2-report.json                — verdict table
//
// Run:
//
//	go test -tags capx ./internal/video/testdata -run TestX4Effects -v -timeout 30m
//
// Skips itself when Chrome or ffmpeg is not found (CI without tools).
package l1

import (
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/haozing/ploykit/platform/capx"

	videoapp "myproduct/internal/video/app"
)

// ---- shared geometry / palette (one 1080x1920@30 5s composition per case;
// cream background, one accent tile upper-right, one pulse tile left-middle —
// regions are pairwise disjoint so each assertion attributes pixels to
// exactly one effect) ----

const (
	x4W, x4H, x4FPS = 1080, 1920, 30
	x4Seconds       = 5.0
	x4BG            = "#FFF7EE" // C01 cream
	x4Flash         = "#F5A623" // the C04 amber — same color the occlusion probe measured at 0
	x4Script        = "开抢 五折爆款 全场清仓 两千件手慢无 最后一天"

	// thresholds
	x4PeakShareMin   = 0.10  // near-color share at flash peak inside the asserted region
	x4FrameShareMax  = 0.005 // outside-tile amber share for the element case (~0)
	x4MeanShiftBand  = 0.05  // |mean shift| below this = region color unchanged
	x4DiffMin        = 300   // px changed across the pulse window
	x4IdleDiffMax    = 40    // static-region noise floor across the same window
	x4PulseIdleShare = 0.005 // amber share in the idle region (no flash bleed)
)

// regions (x, y, w, h) — pairwise disjoint so each assertion attributes
// pixels to exactly one effect
var (
	x4RTile     = [4]int{760, 120, 260, 180}  // highlight target tile (upper-right)
	x4RTileWide = [4]int{700, 80, 360, 260}   // tile + AA margin for full-frame exclusion
	x4RFull     = [4]int{0, 0, 1080, 1920}    // whole frame
	x4RPulse    = [4]int{100, 860, 240, 160}  // pulse target tile (left-middle)
	x4RPulseW   = [4]int{60, 820, 340, 240}   // pulse tile + margin
	x4RIdle     = [4]int{640, 1000, 300, 200} // guaranteed-static region (no element, no effect)
)

var x4Anchor = "开抢" // first script word; starts at t=0 (word 0)

// x4 resolve the anchor exactly the way production does.
func x4Resolve(t *testing.T, ir *videoapp.IR) {
	t.Helper()
	fx := &ir.Effects[0]
	idx, reason, ok := videoapp.ResolveAnchors(fx.Anchor, ir.Words, -1)
	if !ok || idx != 0 || reason != videoapp.AnchorExact {
		t.Fatalf("anchor %q did not resolve to word 0/exact: idx=%d reason=%s ok=%v",
			x4Anchor, idx, reason, ok)
	}
	fx.ResolvedFrom = &videoapp.ResolvedFrom{WordIndex: idx, Reason: reason}
}

func x4BaseIR() *videoapp.IR {
	ir := &videoapp.IR{
		SchemaVersion: videoapp.IRSchemaVersion,
		Meta: videoapp.Meta{
			FPS:         x4FPS,
			Width:       x4W,
			Height:      x4H,
			DurationSec: x4Seconds,
		},
		Script: x4Script,
		Words:  videoapp.EstimateWords(x4Script, x4Seconds),
		Elements: []videoapp.Element{
			{ID: "bg", Type: videoapp.ElementShape, Color: x4BG,
				X: 0, Y: 0, W: x4W, H: x4H, Z: 0},
			// static mid-card text — outside all asserted regions
			{ID: "headline", Type: videoapp.ElementText, Text: "X-4 作用域验证",
				Color: "#2B2118", FontSize: 72,
				X: 240, Y: 600, W: 600, H: 120, Z: 3},
		},
	}
	return ir
}

// x4ElementHighlightIR: case ① — highlight bound to a small upper-right tile.
func x4ElementHighlightIR(t *testing.T) *videoapp.IR {
	t.Helper()
	ir := x4BaseIR()
	ir.Effects = []videoapp.Effect{{
		ID:              "fx_hl_tile",
		Anchor:          videoapp.Anchor{Text: x4Anchor, Occurrence: 0},
		Type:            videoapp.EffectHighlight,
		TargetElementID: "el_tile",
		Params:          []byte(`{"color":"` + x4Flash + `"}`),
	}}
	ir.Elements = append(ir.Elements,
		videoapp.Element{ID: "el_tile", Type: videoapp.ElementShape, Color: "#FFFDF7",
			X: 760, Y: 120, W: 260, H: 180, Z: 5})
	x4Resolve(t, ir)
	return ir
}

// x4OverlayHighlightIR: case ② — legacy IR shape, no targetElementId.
func x4OverlayHighlightIR(t *testing.T) *videoapp.IR {
	t.Helper()
	ir := x4BaseIR()
	ir.Effects = []videoapp.Effect{{
		ID:     "fx_hl_canvas",
		Anchor: videoapp.Anchor{Text: x4Anchor, Occurrence: 0},
		Type:   videoapp.EffectHighlight,
		Params: []byte(`{"color":"` + x4Flash + `"}`),
	}}
	x4Resolve(t, ir)
	return ir
}

// x4ElementPulseIR: case ③ — pulse bound to a left-middle tile.
func x4ElementPulseIR(t *testing.T) *videoapp.IR {
	t.Helper()
	ir := x4BaseIR()
	ir.Effects = []videoapp.Effect{{
		ID:              "fx_pulse_tile",
		Anchor:          videoapp.Anchor{Text: x4Anchor, Occurrence: 0},
		Type:            videoapp.EffectPulse,
		TargetElementID: "el_pulse",
		Params:          []byte(`{"scale":1.4}`),
	}}
	ir.Elements = append(ir.Elements,
		videoapp.Element{ID: "el_pulse", Type: videoapp.ElementShape, Color: "#4DA3FF",
			X: 100, Y: 860, W: 240, H: 160, Z: 5})
	x4Resolve(t, ir)
	return ir
}

// ---- pixel analysis ----

// x4NearShare = share of pixels in rect within tol of the target RGB/channelwise.
func x4NearShare(img image.Image, rect [4]int, tr, tg, tb uint8, tol int) float64 {
	x0, y0 := rect[0], rect[1]
	x1, y1 := rect[0]+rect[2], rect[1]+rect[3]
	var n, hit int
	for y := y0; y < y1; y++ {
		for x := x0; x < x1; x++ {
			r, g, b, _ := img.At(x, y).RGBA()
			n++
			r8, g8, b8 := int(r>>8), int(g>>8), int(b>>8)
			d := 0
			if dr := r8 - int(tr); dr < 0 {
				d -= dr
			} else {
				d += dr
			}
			if dg := g8 - int(tg); dg < 0 {
				d -= dg
			} else {
				d += dg
			}
			if db := b8 - int(tb); db < 0 {
				d -= db
			} else {
				d += db
			}
			if d <= tol {
				hit++
			}
		}
	}
	if n == 0 {
		return 0
	}
	return float64(hit) / float64(n)
}

// x4MeanMean = mean of the per-pixel channel means over a rect (0-255).
func x4MeanMean(img image.Image, rect [4]int) float64 {
	x0, y0 := rect[0], rect[1]
	x1, y1 := rect[0]+rect[2], rect[1]+rect[3]
	var sum int64
	var n int64
	for y := y0; y < y1; y++ {
		for x := x0; x < x1; x++ {
			r, g, b, _ := img.At(x, y).RGBA()
			sum += int64(int(r>>8)+int(g>>8)+int(b>>8)) / 3
			n++
		}
	}
	if n == 0 {
		return 0
	}
	return float64(sum) / float64(n)
}

// x4DiffRect counts pixels whose channel-sum delta exceeds 90 (the same noise
// floor regionDiff uses) inside one rect.
func x4DiffRect(a, b image.Image, rect [4]int) int {
	x0, y0 := rect[0], rect[1]
	x1, y1 := rect[0]+rect[2], rect[1]+rect[3]
	n := 0
	for y := y0; y < y1; y++ {
		for x := x0; x < x1; x++ {
			ar, ag, ab, _ := a.At(x, y).RGBA()
			br, bg, bb, _ := b.At(x, y).RGBA()
			d := abs8(int(ar>>8)-int(br>>8)) + abs8(int(ag>>8)-int(bg>>8)) + abs8(int(ab>>8)-int(bb>>8))
			if d > 90 {
				n++
			}
		}
	}
	return n
}

func x4Decode(t *testing.T, path string) image.Image {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatalf("open %s: %v", path, err)
	}
	defer f.Close()
	img, err := png.Decode(f)
	if err != nil {
		t.Fatalf("decode %s: %v", path, err)
	}
	return img
}

// ---- the test ----

func TestX4Effects(t *testing.T) {
	chrome := chromePath(t)
	ffmpeg := ffmpegPath(t)
	ffprobe := ffprobePath()
	ctx := context.Background()

	enabled := true
	rt, err := capx.New(capx.Config{
		Enabled:    &enabled,
		ChromePath: chrome,
		FFMpegPath: ffmpeg,
		PoolSize:   1,
	})
	if err != nil {
		t.Fatalf("capx.New: %v", err)
	}
	defer rt.Close()
	if !rt.Available() {
		t.Fatal("runtime not available after successful New")
	}

	_, thisFile, _, _ := runtime.Caller(0)
	baseDir := filepath.Join(filepath.Dir(thisFile), "x4")
	if err := os.MkdirAll(baseDir, 0o755); err != nil {
		t.Fatal(err)
	}

	report := &counterReport{
		Layer: "L2-x4 (element-level highlight/pulse + target-less overlay, X-4 §5.12/§8.2)",
		RunID: time.Now().Format("20060102-150405") + "-x4-l2",
	}
	host, _ := os.Hostname()
	report.Env = append(report.Env,
		"os="+runtime.GOOS+"/"+runtime.GOARCH,
		"host="+host,
		"chrome="+chrome,
		"ffmpeg="+ffmpeg,
	)
	if ffprobe == "" {
		report.Env = append(report.Env, "ffprobe=MISSING (degraded to ffmpeg -i stderr parsing)")
	} else {
		report.Env = append(report.Env, "ffprobe="+ffprobe)
	}
	report.Evidence = append(report.Evidence,
		"[代码] 作用域分发：example/internal/video/app/timeline-builder.js effects 循环 — counter→counterHost；highlight/fade 带 targetElementId→元素节点，无 target→z-10000 全画布 overlay；pulse/shake 无 target→#canvas（整层语义保留）",
		"[代码] 字段与校验复用批4-3：example/internal/video/app/ir.go Effect.TargetElementID（json:targetElementId）+ Validate 元素存在性校验",
		"[边界] highlight 是背景闪现（节点 backgroundColor→params.color→回落），文字变色是 T-01 级改造本轮不做",
		"[行为变化] 无 target 的旧行为（#canvas 直改，被 el_bg 完全遮挡=不可见）→ overlay 可见化：像素从『恒 0』变为『峰值全帧抬升』——这是 X-4 修复目的，记录为行为变化而非破坏",
		"[口径] 断言对象是 MP4 解码抽帧（ffmpeg -ss → png.Decode），锚 word0 t=0：flash 上冲 0.25s→峰值 ≈t0.25s，hold 至 t0.5s，回落至 ≈t1.1s；pulse 上冲 0.18s→峰值 ≈t0.18s，回落至 ≈t0.48s",
	)

	cases := []struct {
		id   string
		ir   func(*testing.T) *videoapp.IR
		post func(*testing.T, *counterReport, *counterCaseResult, map[string]image.Image)
	}{
		{"ELEMENT-HIGHLIGHT", x4ElementHighlightIR, x4CheckElementHighlight},
		{"OVERLAY-HIGHLIGHT", x4OverlayHighlightIR, x4CheckOverlayHighlight},
		{"ELEMENT-PULSE", x4ElementPulseIR, x4CheckElementPulse},
	}

	// flash window samples: baseline (pre), peak (0.25s into the 0.25s rise),
	// settled (1.5s — well after the ~1.1s fade-out completes)
	sampleAt := []struct {
		at   float64
		name string
	}{{0.0, "frame-t0.000.png"}, {0.25, "frame-t0.250.png"}, {1.5, "frame-t1.500.png"}}

	// pulse window samples: pre (0.0), peak (0.18), settled (1.5)
	pulseSampleAt := []struct {
		at   float64
		name string
	}{{0.0, "frame-p0.000.png"}, {0.18, "frame-p0.180.png"}, {1.5, "frame-p1.500.png"}}

	overallFail := false
	for _, c := range cases {
		c := c
		t.Run(c.id, func(t *testing.T) {
			start := time.Now()
			res := counterCaseResult{CaseID: c.id}

			ir := c.ir(t)
			if verr := videoapp.Validate(ir); verr != nil {
				res.Status = "fail"
				res.FailReasons = append(res.FailReasons, "IR failed Validate: "+verr.Error())
				res.DurationMS = time.Since(start).Milliseconds()
				report.Cases = append(report.Cases, res)
				t.Fatalf("fixture IR invalid: %v", verr)
			}
			res.IRValidate = "pass"
			if len(ir.Effects) > 0 && ir.Effects[0].TargetElementID != "" {
				res.IRValidate += " (targetElementId=" + ir.Effects[0].TargetElementID + " references existing element)"
			} else {
				res.IRValidate += " (no targetElementId — legacy canvas/overlay path)"
			}
			res.AnchorResolution = fmt.Sprintf("anchor %q → word %d (%s), reason %s",
				x4Anchor, ir.Effects[0].ResolvedFrom.WordIndex,
				ir.Words[ir.Effects[0].ResolvedFrom.WordIndex].Text,
				ir.Effects[0].ResolvedFrom.Reason)

			frames := videoapp.DurationFrames(ir, x4FPS) // 150
			spec := capx.FrameSpec{Width: x4W, Height: x4H, FPS: x4FPS, DurationFrames: frames}
			if serr := spec.Validate(); serr != nil {
				t.Fatalf("frame spec: %v", serr)
			}
			res.FramesRendered = frames

			caseDir := filepath.Join(baseDir, c.id)
			if err := os.MkdirAll(caseDir, 0o755); err != nil {
				t.Fatal(err)
			}
			outputPath := filepath.Join(caseDir, "output.mp4")
			if _, rErr := renderAndEncode(t, ctx, rt, caseDir, ir, spec, outputPath); rErr != nil {
				res.Status = "fail"
				res.FailReasons = append(res.FailReasons, "render+encode: "+rErr.Error())
				res.DurationMS = time.Since(start).Milliseconds()
				report.Cases = append(report.Cases, res)
				t.Fatalf("render+encode: %v", rErr)
			}
			res.Artifacts = append(res.Artifacts, "x4/"+c.id+"/output.mp4")

			// artifact gate (ftyp / geometry / fps / frames / duration / silent)
			mp4Res := caseResult{CaseID: c.id}
			wantDur := float64(frames) / float64(x4FPS)
			assertArtifact(t, ctx, ffmpeg, ffprobe, outputPath, &mp4Res, spec, frames, wantDur,
				1.0/float64(x4FPS), audioExpect{present: false})
			res.MP4Check = &mp4Res
			for _, r := range mp4Res.FailReasons {
				res.FailReasons = append(res.FailReasons, "mp4: "+r)
			}

			// decode frames
			imgs := map[string]image.Image{}
			for _, grp := range [][]struct {
				at   float64
				name string
			}{sampleAt, pulseSampleAt} {
				for _, s := range grp {
					p := filepath.Join(caseDir, s.name)
					if err := extractFrame(ctx, ffmpeg, outputPath, p, s.at); err != nil {
						res.FailReasons = append(res.FailReasons, fmt.Sprintf("extract @%.2fs: %v", s.at, err))
						continue
					}
					res.Artifacts = append(res.Artifacts, "x4/"+c.id+"/"+s.name)
					imgs[s.name] = x4Decode(t, p)
				}
			}

			c.post(t, report, &res, imgs)

			if len(res.FailReasons) > 0 {
				res.Status = "fail"
				overallFail = true
			} else {
				res.Status = "pass"
			}
			res.DurationMS = time.Since(start).Milliseconds()
			report.Cases = append(report.Cases, res)
			if res.Status != "pass" {
				t.Logf("%s FAILED: %v", c.id, res.FailReasons)
			}
		})
	}

	for _, c := range report.Cases {
		switch c.Status {
		case "pass":
			report.Totals.Pass++
		case "fail":
			report.Totals.Fail++
		default:
			report.Totals.Skip++
		}
	}

	// report — always, pass or fail
	repPath := filepath.Join(filepath.Dir(baseDir), "x4-l2-report.json")
	b, _ := json.MarshalIndent(report, "", "  ")
	if werr := os.WriteFile(repPath, b, 0o644); werr != nil {
		t.Errorf("write x4-l2-report.json: %v", werr)
	}
	t.Logf("report written: %s (pass=%d fail=%d skip=%d)", repPath,
		report.Totals.Pass, report.Totals.Fail, report.Totals.Skip)

	if overallFail {
		t.Fatalf("X-4 cases failed: see %s", repPath)
	}
}

// ---- per-case pixel checks ----

// x4CheckElementHighlight: ① tile region shows the amber lift at peak and
// settles back; the rest of the frame stays amber-free.
func x4CheckElementHighlight(t *testing.T, report *counterReport, res *counterCaseResult, imgs map[string]image.Image) {
	base, hasBase := imgs["frame-t0.000.png"]
	peak, hasPeak := imgs["frame-t0.250.png"]
	settled, hasSettled := imgs["frame-t1.500.png"]
	if !hasBase || !hasPeak || !hasSettled {
		res.FailReasons = append(res.FailReasons, "missing decoded frames")
		return
	}

	peakShare := x4NearShare(peak, x4RTile, 245, 166, 35, 60)
	baseShare := x4NearShare(base, x4RTile, 245, 166, 35, 60)
	settledShare := x4NearShare(settled, x4RTile, 245, 166, 35, 60)
	res.Notes = append(res.Notes, fmt.Sprintf(
		"tile near-amber share: base=%.4f peak=%.4f settled=%.4f (threshold peak>%.2f)",
		baseShare, peakShare, settledShare, x4PeakShareMin))
	if peakShare <= x4PeakShareMin {
		res.FailReasons = append(res.FailReasons, fmt.Sprintf(
			"element highlight: tile amber share at peak %.4f <= %.2f — flash not visible on the target element", peakShare, x4PeakShareMin))
	}
	// amber #F5A623 mean (148.7) is DARKER than the near-white tile (~250):
	// the flash must MOVE the region mean toward amber substantially —
	// direction-aware (the old "lift" framing assumed a light flash on dark).
	peakMean := x4MeanMean(peak, x4RTile)
	baseMean := x4MeanMean(base, x4RTile)
	meanShift := (peakMean - baseMean) / baseMean
	if baseMean > 0 && (meanShift > -x4MeanShiftBand && meanShift < x4MeanShiftBand) {
		res.FailReasons = append(res.FailReasons, fmt.Sprintf(
			"element highlight: tile mean shift %.1f→%.1f (%.3f) — region did not change color at peak",
			baseMean, peakMean, meanShift))
	}
	if settledShare > x4PeakShareMin/2 {
		res.FailReasons = append(res.FailReasons, fmt.Sprintf(
			"element highlight: tile amber share %.4f at t=1.5s — flash did not settle back", settledShare))
	}
	res.Notes = append(res.Notes, fmt.Sprintf(
		"tile mean channel: base=%.1f peak=%.1f (shift %.3f; amber mean 148.7 — flash pulls the white tile DOWN toward amber)",
		baseMean, peakMean, meanShift))

	// element scope: no whole-frame bleed — amber outside the tile stays ~0
	outside := x4NearShareOutside(peak, x4RFull, 245, 166, 35, 60, x4RTileWide)
	res.Notes = append(res.Notes, fmt.Sprintf(
		"full-frame amber outside tile at peak: %.5f (< %.3f = element-scoped, no canvas flash)", outside, x4FrameShareMax))
	if outside > x4FrameShareMax {
		res.FailReasons = append(res.FailReasons, fmt.Sprintf(
			"element highlight leaked to the canvas: outside-tile amber %.4f > %.3f", outside, x4FrameShareMax))
	}
	res.Notes = append(res.Notes, fmt.Sprintf(
		"headline region untouched at peak: amber %.5f, idle diff base→peak %d px",
		x4NearShare(peak, [4]int{240, 600, 600, 120}, 245, 166, 35, 60),
		x4DiffRect(base, peak, [4]int{240, 600, 600, 120})))
	report.Evidence = append(report.Evidence,
		"[实测] "+res.CaseID+": tile peak share "+fmt.Sprint(peakShare)+" settled "+fmt.Sprint(settledShare)+" outside "+fmt.Sprint(outside))
}

// x4CheckOverlayHighlight: ② the legacy no-target highlight is finally
// VISIBLE — the whole frame lifts at peak (pre-fix this was ~0 everywhere).
func x4CheckOverlayHighlight(t *testing.T, report *counterReport, res *counterCaseResult, imgs map[string]image.Image) {
	base, hasBase := imgs["frame-t0.000.png"]
	peak, hasPeak := imgs["frame-t0.250.png"]
	settled, hasSettled := imgs["frame-t1.500.png"]
	if !hasBase || !hasPeak || !hasSettled {
		res.FailReasons = append(res.FailReasons, "missing decoded frames")
		return
	}

	frameShare := x4NearShare(peak, x4RFull, 245, 166, 35, 60)
	baseShare := x4NearShare(base, x4RFull, 245, 166, 35, 60)
	settledShare := x4NearShare(settled, x4RFull, 245, 166, 35, 60)
	res.Notes = append(res.Notes, fmt.Sprintf(
		"full-frame near-amber share: base=%.4f peak=%.4f settled=%.4f (threshold peak>%.2f; pre-fix this measured ≈0 — occluded)",
		baseShare, frameShare, settledShare, x4PeakShareMin))
	if frameShare <= x4PeakShareMin {
		res.FailReasons = append(res.FailReasons, fmt.Sprintf(
			"overlay highlight: full-frame amber share at peak %.4f <= %.2f — whole-frame flash still invisible (X-4 not fixed?)", frameShare, x4PeakShareMin))
	}
	// amber mean (148.7) < cream mean (243.5): the whole-frame overlay flash
	// pulls the frame mean DOWN toward amber — assert a substantial shift in
	// either direction (direction-agnostic color change, not a "lift").
	peakMean := x4MeanMean(peak, x4RFull)
	baseMean := x4MeanMean(base, x4RFull)
	meanShift := (peakMean - baseMean) / baseMean
	if baseMean > 0 && (meanShift > -x4MeanShiftBand && meanShift < x4MeanShiftBand) {
		res.FailReasons = append(res.FailReasons, fmt.Sprintf(
			"overlay highlight: full-frame mean shift %.1f→%.1f (%.3f) — frame did not change color at peak",
			baseMean, peakMean, meanShift))
	}
	if settledShare > x4PeakShareMin/2 {
		res.FailReasons = append(res.FailReasons, fmt.Sprintf(
			"overlay highlight: full-frame amber share %.4f at t=1.5s — flash did not settle", settledShare))
	}
	res.Notes = append(res.Notes, fmt.Sprintf(
		"full-frame mean channel: base=%.1f peak=%.1f (shift %.3f; amber mean 148.7 vs cream 243.5) — 首次可见：pre-fix 同帧位实测 amber≈0（l1-report F250 / c04 F916 留档）",
		baseMean, peakMean, meanShift))
	report.Evidence = append(report.Evidence,
		"[实测] "+res.CaseID+": full-frame peak share "+fmt.Sprint(frameShare)+" settled "+fmt.Sprint(settledShare)+" (pre-fix ≈0)")
}

// x4CheckElementPulse: ③ the pulse tile changes across the window while the
// idle region stays static (element-scoped — no whole-canvas scale).
func x4CheckElementPulse(t *testing.T, report *counterReport, res *counterCaseResult, imgs map[string]image.Image) {
	base, hasBase := imgs["frame-p0.000.png"]
	peak, hasPeak := imgs["frame-p0.180.png"]
	settled, hasSettled := imgs["frame-p1.500.png"]
	if !hasBase || !hasPeak || !hasSettled {
		res.FailReasons = append(res.FailReasons, "missing decoded frames")
		return
	}

	// the tile scales 1.0→1.4→1.0: the tile interior is a uniform fill, so
	// diff the tile PLUS margin — the 1.4× scale grows the tile ~48px beyond
	// its bbox into the cream surround, which is exactly where the change
	// lands (inside-bbox-only diff measured 63 px, below the noise bar).
	tileDiff := x4DiffRect(base, peak, x4RPulseW)
	res.Notes = append(res.Notes, fmt.Sprintf(
		"pulse tile diff base→peak: %d px (> %d = scaling happened)", tileDiff, x4DiffMin))
	if tileDiff <= x4DiffMin {
		res.FailReasons = append(res.FailReasons, fmt.Sprintf(
			"element pulse: tile diff %d px <= %d — target did not scale", tileDiff, x4DiffMin))
	}
	settleDiff := x4DiffRect(base, settled, x4RPulseW)
	res.Notes = append(res.Notes, fmt.Sprintf(
		"pulse tile diff base→settled: %d px (< 300 = returned to rest)", settleDiff))
	if settleDiff > x4DiffMin {
		res.FailReasons = append(res.FailReasons, fmt.Sprintf(
			"element pulse: tile diff base→settled %d px >= %d — scale did not settle", settleDiff, x4DiffMin))
	}
	// element scope: the idle region must not move with the pulse
	idleDiff := x4DiffRect(base, peak, x4RIdle)
	res.Notes = append(res.Notes, fmt.Sprintf(
		"idle region diff base→peak: %d px (< %d = no whole-canvas scale)", idleDiff, x4IdleDiffMax))
	if idleDiff > x4IdleDiffMax {
		res.FailReasons = append(res.FailReasons, fmt.Sprintf(
			"element pulse leaked to the canvas: idle-region diff %d px > %d (pulse scaling the world again?)", idleDiff, x4IdleDiffMax))
	}
	// no flash bleed anywhere
	if bleed := x4NearShare(peak, x4RIdle, 245, 166, 35, 60); bleed > x4PulseIdleShare {
		res.FailReasons = append(res.FailReasons, fmt.Sprintf(
			"pulse case amber bleed in idle region: %.4f > %.3f", bleed, x4PulseIdleShare))
	}
	report.Evidence = append(report.Evidence,
		"[实测] "+res.CaseID+": tile diff "+fmt.Sprint(tileDiff)+"px, idle diff "+fmt.Sprint(idleDiff)+"px, settle "+fmt.Sprint(settleDiff)+"px")
}

// x4NearShare is x4NearShare over the full rect minus exclusions (the
// shareNearOutside pattern, local copy).
func x4NearShareOutside(img image.Image, full [4]int, tr, tg, tb uint8, tol int, excl ...[4]int) float64 {
	inExcl := func(x, y int) bool {
		for _, r := range excl {
			if x >= r[0] && x < r[0]+r[2] && y >= r[1] && y < r[1]+r[3] {
				return true
			}
		}
		return false
	}
	x0, y0 := full[0], full[1]
	x1, y1 := full[0]+full[2], full[1]+full[3]
	var n, hit int
	for y := y0; y < y1; y++ {
		for x := x0; x < x1; x++ {
			if inExcl(x, y) {
				continue
			}
			r, g, b, _ := img.At(x, y).RGBA()
			n++
			r8, g8, b8 := int(r>>8), int(g>>8), int(b>>8)
			d := 0
			if dr := r8 - int(tr); dr < 0 {
				d -= dr
			} else {
				d += dr
			}
			if dg := g8 - int(tg); dg < 0 {
				d -= dg
			} else {
				d += dg
			}
			if db := b8 - int(tb); db < 0 {
				d -= db
			} else {
				d += db
			}
			if d <= tol {
				hit++
			}
		}
	}
	if n == 0 {
		return 0
	}
	return float64(hit) / float64(n)
}
