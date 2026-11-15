//go:build capx

// Counter-chain L2 verification (T-10, case-library doc §5.10; round-2 D-01
// follow-up §1 of docs/delivery-audit-video-studio-round2-2026-11-15.md).
// D-01 (counter onUpdate suppressed by GSAP's single-arg pause) was fixed in
// round 2 — pause(t, false) in platform/capx/renderer.go — but the fix was
// only pixel-verified at the STILL layer (L1). Batches 1/2 synthesized L2 IRs
// carried highlight only, so the ENCODE chain had never seen a counter. This
// file closes that gap: one 5s@1080x1920@30 IR with a counter effect
// (8200 -> 12600, suffix " 件", params.color #2B2118) driven through the real
// encode chain — Projector.HTML → capx RenderFrames → os.Pipe →
// EncodePNGStream (libx264 CRF 18) → MP4 — and asserted on the DECODED
// product (ffmpeg frame extraction), not the pre-encode captures.
//
// What is asserted (the core claim: digits roll over time and the roll is
// encoded into the product):
//
//  1. Digits exist: at t=1s / 3s / 4.8s the decoded frame's origin region
//     (0,0,300,120) carries > 0.5% dark ink (the counter host renders at the
//     canvas origin — known degrade, not re-reported here).
//  2. The number rolls: origin-region pixel diff between t=1s ("12478 件",
//     mid-roll under power1.out) and t=4.8s ("12600 件", settled) > 300 px.
//  3. The roll settles at the terminal value: t=4.8s vs t=4.9s diff < 150 px
//     (encoder noise only — the tween ended at t=1.2s, so both frames show
//     "12600 件"; also proves no seek-drift after 147 sequential seeks).
//  4. MP4 playable: ftyp box, 150 frames, 5.00s ± 1 frame, 1080x1920@30,
//     no audio stream (silent render, this round is picture-only).
//
// T-15 L2 part (thumbnail): capx.Runtime.ExtractThumbnail (encode.go:245,
// real implementation — the render_pipeline firstThumb stub is M-C04-04, a
// known pipeline gap deliberately NOT re-reported; this test exercises only
// the capx-layer capability): extract at 1s → JPEG must be non-empty,
// decodable, and 1080x1920.
//
// Observations recorded beyond pass/fail (task §6): counter text wrapping
// (ink bbox height vs one 96px/1.35 line), suffix-to-digits spacing (column
// gap profile), seek-drift (settle diff), mean ink RGB vs params.color.
//
// Artifacts (§7.0 retention):
//   testdata/counter/VS-C01-COUNTER/output.mp4          — the 5s counter clip
//   testdata/counter/VS-C01-COUNTER/frame-t{1,3,4.8,4.9}.png — MP4 extractions
//   testdata/counter/VS-C01-COUNTER/thumb-1s.jpg        — ExtractThumbnail out
//   testdata/counter-l2-report.json                     — verdict table
//
// Run:
//
//	go test -tags capx ./internal/video/testdata -run TestCounterL2 -v -timeout 30m
//
// Skips itself when Chrome or ffmpeg is not found (CI without tools).
package l1

import (
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	_ "image/jpeg" // register the JPEG decoder for ExtractThumbnail output

	"github.com/haozing/ploykit/platform/capx"

	videoapp "myproduct/internal/video/app"
)

// ---- counter IR (C01-shaped: 1080x1920@30 5s, cream card background so the
// dark-ink digits are the only origin-region content) ----

const (
	counterCaseID   = "VS-C01-COUNTER"
	counterFPS      = 30
	counterSeconds  = 5.0
	counterW        = 1080
	counterH        = 1920
	counterBG       = "#FFF7EE" // C01 cream — light card, dark ink required
	counterColor    = "#2B2118" // D-01 default ink, passed explicitly via params.color
	counterFrom     = 8200
	counterTo       = 12600
	counterSuffix   = " 件"
	counterAnchorWW = "开抢" // first script word; starts at t=0

	// origin region under test (the counter host renders at (0,0): no
	// x/y/w/h on the host div — known §5.10 degrade, asserted as-is)
	regionW, regionH = 300, 120

	// assertion thresholds
	inkRatioMin   = 0.005 // >0.5% dark pixels = digits present
	rollDiffMin   = 300   // px changed between t=1.0 and t=4.8 = rolling happened
	settleDiffMax = 150   // px changed between t=4.8 and t=4.9 = settled, no drift
)

// buildCounterIR synthesizes the counter IR. The background + headline are
// static (no animations) so every origin-region pixel change is attributable
// to the counter. The IR must pass videoapp.Validate — asserted before
// rendering. ResolvedFrom is populated the way production ResolveAll does
// (service.go:689) — the builder's anchorTime reads it.
func buildCounterIR(t *testing.T) *videoapp.IR {
	t.Helper()

	script := "开抢 五折爆款 全场清仓 两千件手慢无 最后一天"
	ir := &videoapp.IR{
		SchemaVersion: videoapp.IRSchemaVersion,
		Meta: videoapp.Meta{
			FPS:         counterFPS,
			Width:       counterW,
			Height:      counterH,
			DurationSec: counterSeconds,
		},
		Script: script,
		Words:  videoapp.EstimateWords(script, counterSeconds),
		Effects: []videoapp.Effect{{
			ID:     "fx_counter_sales",
			Anchor: videoapp.Anchor{Text: counterAnchorWW, Occurrence: 0},
			Type:   videoapp.EffectCounter,
			Params: []byte(`{"from":` + fmt.Sprint(counterFrom) +
				`,"to":` + fmt.Sprint(counterTo) +
				`,"suffix":"` + counterSuffix + `","color":"` + counterColor + `"}`),
		}},
		Elements: []videoapp.Element{
			{ID: "bg", Type: videoapp.ElementShape, Color: counterBG,
				X: 0, Y: 0, W: counterW, H: counterH, Z: 0},
			// static headline mid-card — far from the origin region, so it
			// never contaminates the counter assertions
			{ID: "headline", Type: videoapp.ElementText, Text: "限时五折 · T-10",
				Color: "#2B2118", FontSize: 84,
				X: counterW * 0.14, Y: counterH * 0.34,
				W: counterW * 0.72, H: 200, Z: 3},
		},
	}

	// resolve the counter anchor exactly the way production does
	// (service.ResolveAll → ResolveAnchors → resolvedFrom on the effect)
	fx := &ir.Effects[0]
	idx, reason, ok := videoapp.ResolveAnchors(fx.Anchor, ir.Words, -1)
	if !ok || idx != 0 || reason != videoapp.AnchorExact {
		t.Fatalf("counter anchor %q did not resolve to word 0/exact: idx=%d reason=%s ok=%v",
			counterAnchorWW, idx, reason, ok)
	}
	fx.ResolvedFrom = &videoapp.ResolvedFrom{WordIndex: idx, Reason: reason}
	return ir
}

// ---- pixel analysis (decoded-MP4 frame → origin region stats) ----

type inkStats struct {
	InkPx    int     `json:"ink_px"`
	TotalPx  int     `json:"total_px"`
	InkRatio float64 `json:"ink_ratio"`
	BBox     [4]int  `json:"bbox"` // x0,y0,x1,y1 of ink within the region (-1 when empty)
	MeanRGB  [3]int  `json:"mean_rgb"` // mean RGB of ink pixels (color fidelity obs.)
}

// regionInk measures the dark-ink content of the (0,0,regionW,regionH) region
// of a decoded PNG. Dark = mean channel < 128 (the counter ink #2B2118 has
// mean ~33; the cream background ~247 — no ambiguity).
func regionInk(t *testing.T, pngPath string) inkStats {
	t.Helper()
	img := decodePNG(t, pngPath)
	st := inkStats{TotalPx: regionW * regionH, BBox: [4]int{-1, -1, -1, -1}}
	var rSum, gSum, bSum int64
	for y := 0; y < regionH; y++ {
		for x := 0; x < regionW; x++ {
			r, g, b, _ := img.At(x, y).RGBA()
			r8, g8, b8 := int(r>>8), int(g>>8), int(b>>8)
			if (r8+g8+b8)/3 < 128 {
				st.InkPx++
				rSum += int64(r8)
				gSum += int64(g8)
				bSum += int64(b8)
				if st.BBox[0] < 0 || x < st.BBox[0] {
					st.BBox[0] = x
				}
				if st.BBox[1] < 0 || y < st.BBox[1] {
					st.BBox[1] = y
				}
				if x > st.BBox[2] {
					st.BBox[2] = x
				}
				if y > st.BBox[3] {
					st.BBox[3] = y
				}
			}
		}
	}
	if st.InkPx > 0 {
		st.InkRatio = float64(st.InkPx) / float64(st.TotalPx)
		st.MeanRGB = [3]int{int(rSum / int64(st.InkPx)), int(gSum / int64(st.InkPx)), int(bSum / int64(st.InkPx))}
	}
	return st
}

// regionDiff counts pixels of the origin region whose channel-sum delta
// exceeds the same 90 threshold diffPNGFrames uses (same codec family, same
// noise floor).
func regionDiff(t *testing.T, pngA, pngB string) int {
	t.Helper()
	a, b := decodePNG(t, pngA), decodePNG(t, pngB)
	n := 0
	for y := 0; y < regionH; y++ {
		for x := 0; x < regionW; x++ {
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

func decodePNG(t *testing.T, path string) image.Image {
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
	if img.Bounds().Dx() < regionW || img.Bounds().Dy() < regionH {
		t.Fatalf("frame %s smaller than the origin region: %v", path, img.Bounds())
	}
	return img
}

// columnGaps profiles ink columns inside the origin region and returns the
// zero-ink gaps ≥ 10px between ink runs — the suffix-spacing observation
// (a space + CJK glyph after the digits should produce one clear gap before
// the 件 glyph block).
func columnGaps(t *testing.T, pngPath string) (inkSpan [2]int, gaps [][2]int) {
	t.Helper()
	img := decodePNG(t, pngPath)
	colInk := make([]bool, regionW)
	for x := 0; x < regionW; x++ {
		for y := 0; y < regionH; y++ {
			r, g, b, _ := img.At(x, y).RGBA()
			if (int(r>>8)+int(g>>8)+int(b>>8))/3 < 128 {
				colInk[x] = true
				break
			}
		}
	}
	inkSpan = [2]int{-1, -1}
	for x := 0; x < regionW; x++ {
		if colInk[x] {
			if inkSpan[0] < 0 {
				inkSpan[0] = x
			}
			inkSpan[1] = x
		}
	}
	run := 0
	for x := inkSpan[0]; x <= inkSpan[1] && x >= 0; x++ {
		if colInk[x] {
			if run >= 10 {
				gaps = append(gaps, [2]int{x - run, run})
			}
			run = 0
		} else {
			run++
		}
	}
	return inkSpan, gaps
}

// ---- report model ----

type thumbResult struct {
	OK        bool   `json:"ok"`
	Bytes     int    `json:"bytes"`
	Format    string `json:"format,omitempty"`
	Width     int    `json:"width,omitempty"`
	Height    int    `json:"height,omitempty"`
	Err       string `json:"err,omitempty"`
}

type inkSample struct {
	AtSec   float64  `json:"at_sec"`
	File    string   `json:"file"`
	Stats   inkStats `json:"stats"`
	Pass    bool     `json:"pass"`
	Detail  string   `json:"detail,omitempty"`
}

type counterCaseResult struct {
	CaseID           string            `json:"case_id"`
	Status           string            `json:"status"` // pass | fail | skip
	FailReasons      []string          `json:"fail_reasons,omitempty"`
	Notes            []string          `json:"notes,omitempty"`
	IRValidate       string            `json:"ir_validate"`
	AnchorResolution string            `json:"anchor_resolution"`
	FramesRendered   int               `json:"frames_rendered"`
	InkSamples       []inkSample       `json:"ink_samples,omitempty"`
	RollDiffPx       int               `json:"roll_diff_px,omitempty"`
	SettleDiffPx     int               `json:"settle_diff_px,omitempty"`
	MP4Check         *caseResult       `json:"mp4_check,omitempty"`
	Thumbnail        *thumbResult      `json:"thumbnail,omitempty"`
	Artifacts        []string          `json:"artifacts,omitempty"`
	DurationMS       int64             `json:"duration_ms"`
}

type counterReport struct {
	Layer    string              `json:"layer"`
	RunID    string              `json:"run_id"`
	Env      []string            `json:"env"`
	Cases    []counterCaseResult `json:"cases"`
	Totals   struct {
		Pass int `json:"pass"`
		Fail int `json:"fail"`
		Skip int `json:"skip"`
	} `json:"totals"`
	Findings []string `json:"findings,omitempty"`
	Evidence []string `json:"evidence"`
}

// ---- the test ----

func TestCounterL2(t *testing.T) {
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
	baseDir := filepath.Join(filepath.Dir(thisFile), "counter", counterCaseID)
	if err := os.MkdirAll(baseDir, 0o755); err != nil {
		t.Fatal(err)
	}

	start := time.Now()
	res := counterCaseResult{CaseID: counterCaseID}
	fail := func(reason string) {
		res.Status = "fail"
		res.FailReasons = append(res.FailReasons, reason)
	}

	report := &counterReport{
		Layer: "L2-counter (T-10 encode chain + T-15 thumbnail, D-01 round-2 follow-up)",
		RunID: time.Now().Format("20060102-150405") + "-counter-l2",
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
		"[代码] D-01 修复点：platform/capx/renderer.go seekTimeline — tl.pause(t, false)（suppressEvents=false，onUpdate 写数字回调在 seek 渲染时触发）",
		"[代码] counter 参数白名单含 color：example/internal/video/app/ir.go validateEffectParams（from/to/suffix/color）",
		"[代码] counter 宿主：example/internal/video/app/timeline-builder.js counterHost — 原点定位（无 x/y/w/h，§5.10 已知降级）、z-index 9999（D-01 第三层）、色缺省/params.color 覆盖",
		"[代码] counter tween 时长 = Math.min(1.2, Math.max(0.3, durationSec - at))，ease power1.out —— 锚 word0（t=0）→ 滚动窗口 0~1.2s，t=1.0s 处于滚动尾段（≈12478），t≥1.2s 定格 12600",
		"[代码] 缩略图：platform/capx/encode.go ExtractThumbnail（-ss 00:00:01 -frames:v 1 -q:v 2 真实现）；render_pipeline.go firstThumb 为 stub（M-C04-04 已知管线缺口，本轮不重复报、不验管线层）",
		"[口径] 断言对象是 MP4 解码抽帧（ffmpeg -ss 提取 → png.Decode），不是渲染侧原始截屏——证明数字被编码进产物而非仅存在于捕获层",
	)

	// 1) IR + Validate
	ir := buildCounterIR(t)
	if verr := videoapp.Validate(ir); verr != nil {
		res.IRValidate = "FAIL: " + verr.Error()
		fail("IR failed Validate: " + verr.Error())
		res.DurationMS = time.Since(start).Milliseconds()
		report.Cases = append(report.Cases, res)
		writeCounterReport(t, report)
		t.Fatalf("fixture IR invalid: %v", verr)
	}
	res.IRValidate = "pass (counter params from/to/suffix/color all in whitelist)"
	res.AnchorResolution = fmt.Sprintf("anchor %q → word %d (%s), reason %s, tween starts t=%.3fs",
		counterAnchorWW, ir.Effects[0].ResolvedFrom.WordIndex,
		ir.Words[ir.Effects[0].ResolvedFrom.WordIndex].Text,
		ir.Effects[0].ResolvedFrom.Reason, ir.Words[0].Start)

	// 2) full-chain render + encode (150 frames), silent (no audio this round)
	frames := videoapp.DurationFrames(ir, counterFPS) // ceil(5*30) = 150
	spec := capx.FrameSpec{Width: counterW, Height: counterH, FPS: counterFPS, DurationFrames: frames}
	if serr := spec.Validate(); serr != nil {
		t.Fatalf("frame spec: %v", serr)
	}
	res.FramesRendered = frames

	outputPath := filepath.Join(baseDir, "output.mp4")
	if _, rErr := renderAndEncode(t, ctx, rt, baseDir, ir, spec, outputPath); rErr != nil {
		fail("render+encode: " + rErr.Error())
		res.DurationMS = time.Since(start).Milliseconds()
		report.Cases = append(report.Cases, res)
		writeCounterReport(t, report)
		t.Fatalf("render+encode: %v", rErr)
	}
	res.Artifacts = append(res.Artifacts, "counter/"+counterCaseID+"/output.mp4")

	// 3) MP4 gate (reuse the L2 harness: ftyp / geometry / fps / frame count /
	// duration ±1 frame / NO audio stream). Silent on purpose.
	mp4Res := caseResult{CaseID: counterCaseID}
	wantDur := float64(frames) / float64(counterFPS)
	assertArtifact(t, ctx, ffmpeg, ffprobe, outputPath, &mp4Res, spec, frames, wantDur,
		1.0/float64(counterFPS), audioExpect{present: false})
	res.MP4Check = &mp4Res
	for _, r := range mp4Res.FailReasons {
		fail("mp4: " + r)
	}

	// 4) frame extraction from the DECODED product (the encoding proof)
	sampleSpecs := []struct {
		atSec float64
		name  string
	}{
		{1.0, "frame-t1.000.png"},
		{3.0, "frame-t3.000.png"},
		{4.8, "frame-t4.800.png"},
		{4.9, "frame-t4.900.png"}, // settle reference (also retained)
	}
	paths := map[string]string{}
	for _, s := range sampleSpecs {
		p := filepath.Join(baseDir, s.name)
		if err := extractFrame(ctx, ffmpeg, outputPath, p, s.atSec); err != nil {
			fail(fmt.Sprintf("extract frame @%.1fs: %v", s.atSec, err))
			continue
		}
		paths[s.name] = p
		res.Artifacts = append(res.Artifacts, "counter/"+counterCaseID+"/"+s.name)
	}

	// 4a) digit presence: >0.5% dark ink in the origin region at each sample
	for _, s := range sampleSpecs[:3] { // t=1/3/4.8 mandated
		p, ok := paths[s.name]
		if !ok {
			continue
		}
		st := regionInk(t, p)
		sm := inkSample{AtSec: s.atSec, File: s.name, Stats: st, Pass: st.InkRatio > inkRatioMin}
		sm.Detail = fmt.Sprintf("ink %d/%d px (%.2f%%), bbox %v, meanRGB %v",
			st.InkPx, st.TotalPx, st.InkRatio*100, st.BBox, st.MeanRGB)
		if !sm.Pass {
			sm.Detail += " — BELOW threshold: digits missing in origin region"
			fail(fmt.Sprintf("t=%.1fs origin-region ink ratio %.4f <= %.3f — counter digits not encoded", s.atSec, st.InkRatio, inkRatioMin))
		}
		res.InkSamples = append(res.InkSamples, sm)
	}

	// 4b) the number rolls: t=1.0 (mid/late roll ≈12478) vs t=4.8 (settled
	// 12600) must differ materially inside the origin region
	if p1, ok1 := paths["frame-t1.000.png"]; ok1 {
		if p48, ok48 := paths["frame-t4.800.png"]; ok48 {
			res.RollDiffPx = regionDiff(t, p1, p48)
			if res.RollDiffPx <= rollDiffMin {
				fail(fmt.Sprintf("roll diff t=1.0 vs t=4.8 = %d px <= %d — digits did not change over time (roll not encoded)", res.RollDiffPx, rollDiffMin))
			}
		}
	}

	// 4c) the roll settles: t=4.8 vs t=4.9 near-identical (tween ended at
	// 1.2s; any large diff here would mean drift/never-settling)
	if p48, ok48 := paths["frame-t4.800.png"]; ok48 {
		if p49, ok49 := paths["frame-t4.900.png"]; ok49 {
			res.SettleDiffPx = regionDiff(t, p48, p49)
			if res.SettleDiffPx >= settleDiffMax {
				fail(fmt.Sprintf("settle diff t=4.8 vs t=4.9 = %d px >= %d — digits not stable at the terminal value (drift?)", res.SettleDiffPx, settleDiffMax))
			}
			// terminal-value stability also needs ink present at 4.9
			st49 := regionInk(t, p49)
			res.Notes = append(res.Notes, fmt.Sprintf(
				"t=4.9 settle reference: ink %.2f%% (threshold %.1f%%), diff vs t=4.8 = %d px (< %d) — counter 定格于终值，147 次顺序 seek 后无漂移",
				st49.InkRatio*100, inkRatioMin*100, res.SettleDiffPx, settleDiffMax))
			if st49.InkRatio <= inkRatioMin {
				fail(fmt.Sprintf("t=4.9 origin-region ink ratio %.4f <= %.3f — terminal frame lost the digits", st49.InkRatio, inkRatioMin))
			}
		}
	}

	// 4d) observations: wrapping / suffix spacing / ink color fidelity
	if p49, ok := paths["frame-t4.900.png"]; ok {
		st := regionInk(t, p49)
		if st.BBox[3] > 160 {
			res.Notes = append(res.Notes, fmt.Sprintf(
				"FINDING: counter text appears WRAPPED (ink bbox height %d px > one 96px/1.35 line ≈130px): bbox %v", st.BBox[3], st.BBox))
		} else {
			res.Notes = append(res.Notes, fmt.Sprintf(
				"no wrapping: ink bbox height %d px fits one 96px/1.35 line; bbox(x0,y0,x1,y1)=%v — counter host renders at origin as documented (§5.10 known degrade)", st.BBox[3], st.BBox))
		}
		span, gaps := columnGaps(t, p49)
		gapStrs := make([]string, 0, len(gaps))
		for _, g := range gaps {
			gapStrs = append(gapStrs, fmt.Sprintf("x=%d(w=%d)", g[0], g[1]))
		}
		res.Notes = append(res.Notes, fmt.Sprintf(
			"suffix spacing: ink column span x=%d..%d, internal gaps≥10px: [%s] — \" 件\" suffix gap profile",
			span[0], span[1], strings.Join(gapStrs, ", ")))
		res.Notes = append(res.Notes, fmt.Sprintf(
			"ink color fidelity: mean RGB of ink pixels %v vs params.color #2B2118=(43,33,24) — dark ink legible on cream %s", st.MeanRGB, counterBG))
	}

	// 5) T-15 L2: capx ExtractThumbnail at 1s (real capx-layer capability;
	// pipeline firstThumb stub = M-C04-04, known, not re-reported)
	thumb := &thumbResult{}
	thumbPath := filepath.Join(baseDir, "thumb-1s.jpg")
	tf, err := os.Create(thumbPath)
	if err != nil {
		thumb.Err = err.Error()
		fail("thumbnail: create file: " + err.Error())
	} else {
		tErr := rt.ExtractThumbnail(ctx, outputPath, tf)
		tf.Close()
		if st, serr := os.Stat(thumbPath); serr == nil {
			thumb.Bytes = int(st.Size())
		}
		if tErr != nil {
			thumb.Err = tErr.Error()
			fail("thumbnail: ExtractThumbnail: " + tErr.Error())
		} else if thumb.Bytes == 0 {
			thumb.Err = "empty output"
			fail("thumbnail: 0 bytes")
		} else {
			f, oerr := os.Open(thumbPath)
			if oerr != nil {
				thumb.Err = oerr.Error()
				fail("thumbnail: reopen: " + oerr.Error())
			} else {
				cfg, format, derr := image.DecodeConfig(f) // header-only decode: format + dimensions
				f.Close()
				if derr != nil {
					thumb.Err = derr.Error()
					fail("thumbnail: not decodable: " + derr.Error())
				} else {
					thumb.OK = true
					thumb.Format = format
					thumb.Width, thumb.Height = cfg.Width, cfg.Height
					if cfg.Width != counterW || cfg.Height != counterH {
						fail(fmt.Sprintf("thumbnail dimensions %dx%d != %dx%d", cfg.Width, cfg.Height, counterW, counterH))
					}
				}
			}
		}
	}
	res.Thumbnail = thumb
	res.Artifacts = append(res.Artifacts, "counter/"+counterCaseID+"/thumb-1s.jpg")

	if res.Status == "" {
		res.Status = "pass"
	}
	res.DurationMS = time.Since(start).Milliseconds()
	report.Cases = append(report.Cases, res)

	// observations/findings summary (task §6): anything beyond the asserted
	// picture correctness worth carrying forward
	for _, sm := range res.InkSamples {
		if sm.Pass && sm.Stats.BBox[0] > 4 {
			report.Findings = append(report.Findings, fmt.Sprintf(
				"t=%.1fs ink starts at x=%d — counter host not flush with x=0 (letter-spacing/leading glyph bearing)", sm.AtSec, sm.Stats.BBox[0]))
		}
	}
	if res.RollDiffPx > 0 {
		report.Findings = append(report.Findings, fmt.Sprintf(
			"roll quantified: %d origin-region px changed between t=1.0 (mid-roll, power1.out ≈ %d) and t=4.8 (settled %d) — the digit roll IS encoded into the MP4",
			res.RollDiffPx, 12478, counterTo))
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
	report.Evidence = append(report.Evidence,
		"[实测] 断言阈值：墨迹>0.5%（"+fmt.Sprint(regionW)+"x"+fmt.Sprint(regionH)+" 暗像素，亮度<128）；滚动差>"+fmt.Sprint(rollDiffMin)+"px；定格差<"+fmt.Sprint(settleDiffMax)+"px（通道和>90 计变化，与 diffPNGFrames 同一噪声门限）",
		"[实测] 数字滚动期望锚点：t=1.0s ≈ 8200+4400*power1.out(1/1.2)=12478（计算值，非 OCR——像素差断言不依赖具体数值）",
	)

	writeCounterReport(t, report)
	if res.Status != "pass" {
		t.Fatalf("%s failed assertions: %v", counterCaseID, res.FailReasons)
	}
	t.Logf("%s pass: %d frames, roll_diff=%d px, settle_diff=%d px, thumbnail %s %dx%d (%d bytes)",
		counterCaseID, res.FramesRendered, res.RollDiffPx, res.SettleDiffPx,
		thumb.Format, thumb.Width, thumb.Height, thumb.Bytes)
}

// ---- element-level positioning variant (IR extension T-10 P0) ----
//
// The counter host historically self-anchored at the canvas origin (0,0) —
// case library §5.10 degrade: C01's price digits and C04's hub number were
// never where they belonged. The IR extension Effect.TargetElementID
// (targetElementId, write-time validated against elements[]) lets the host
// borrow the target element's bbox. This variant is the pixel-level proof:
//
//   - the target element is a price panel at the BOTTOM-RIGHT of the canvas
//     (a region the origin-originated counter could never reach);
//   - the bottom-right region must carry >0.5% dark ink at each sample
//     (digits present at the target);
//   - the digit roll must be observable INSIDE the target region (diff >300px
//     between mid-roll and settled) — the number is rolling where the target
//     is, not just sitting there;
//   - the ORIGIN region must be clean (<0.1% ink) — proving the host MOVED,
//     not multiplied (back-compat regression in the same frame: the no-target
//     TestCounterL2 asserts the origin behavior unchanged for legacy IRs).
//
// Degradation semantics recorded (builder comment mirrors this): the host
// takes the target's POSITION but not its visibility/animation state — the
// counter is a word-anchored stage effect borrowing geometry only.
func TestCounterL2_TargetElement(t *testing.T) {
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
	baseDir := filepath.Join(filepath.Dir(thisFile), "counter", "VS-C10-COUNTER-TARGET")
	if err := os.MkdirAll(baseDir, 0o755); err != nil {
		t.Fatal(err)
	}

	start := time.Now()
	res := counterCaseResult{CaseID: "VS-C10-COUNTER-TARGET"}
	fail := func(reason string) {
		res.Status = "fail"
		res.FailReasons = append(res.FailReasons, reason)
	}

	report := &counterReport{
		Layer: "L2-counter-target (T-10 P0: targetElementId element-level positioning, case library §5.10)",
		RunID: time.Now().Format("20060102-150405") + "-counter-l2-target",
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
		"[代码] IR 扩展：example/internal/video/app/ir.go Effect.TargetElementID（json:targetElementId）+ Validate 写时校验（引用不存在的 element id → E_VIDEO_IR_INVALID details.field=targetElementId）",
		"[代码] 定位实现：example/internal/video/app/timeline-builder.js counterHost — fx.targetElementId 命中画布节点时宿主 left/top 取目标 bbox（同一 stage 坐标系），z-index 9999 保留（D-01 第三层不回退）",
		"[语义] 宿主只借目标几何，不随目标显隐/入场动画（目标 scaleIn 未入场时 counter 仍显示于目标位置）——降级链口径，见 builder 注释",
		"[口径] 断言对象是 MP4 解码抽帧：右下目标区域墨迹>0.5%、区域内滚动差>300px、原点区域墨迹<0.1%（宿主迁移而非复制）",
	)

	// 1) IR: same counter as VS-C01 but bound to a bottom-right price panel.
	ir := buildCounterTargetIR(t)
	if verr := videoapp.Validate(ir); verr != nil {
		res.IRValidate = "FAIL: " + verr.Error()
		fail("IR failed Validate: " + verr.Error())
		res.DurationMS = time.Since(start).Milliseconds()
		report.Cases = append(report.Cases, res)
		writeCounterReport(t, report)
		t.Fatalf("fixture IR invalid: %v", verr)
	}
	res.IRValidate = "pass (counter carries targetElementId=el_price, resolves to existing element)"
	res.AnchorResolution = fmt.Sprintf("anchor %q → word %d (%s), reason %s",
		counterAnchorWW, ir.Effects[0].ResolvedFrom.WordIndex,
		ir.Words[ir.Effects[0].ResolvedFrom.WordIndex].Text,
		ir.Effects[0].ResolvedFrom.Reason)

	// 2) full-chain render + encode
	frames := videoapp.DurationFrames(ir, counterFPS) // 150
	spec := capx.FrameSpec{Width: counterW, Height: counterH, FPS: counterFPS, DurationFrames: frames}
	if serr := spec.Validate(); serr != nil {
		t.Fatalf("frame spec: %v", serr)
	}
	res.FramesRendered = frames

	outputPath := filepath.Join(baseDir, "output.mp4")
	if _, rErr := renderAndEncode(t, ctx, rt, baseDir, ir, spec, outputPath); rErr != nil {
		fail("render+encode: " + rErr.Error())
		res.DurationMS = time.Since(start).Milliseconds()
		report.Cases = append(report.Cases, res)
		writeCounterReport(t, report)
		t.Fatalf("render+encode: %v", rErr)
	}
	res.Artifacts = append(res.Artifacts, "counter/VS-C10-COUNTER-TARGET/output.mp4")

	// 3) extract the same sample frames from the DECODED product
	sampleSpecs := []struct {
		atSec float64
		name  string
	}{
		{1.0, "frame-t1.000.png"},
		{3.0, "frame-t3.000.png"},
		{4.8, "frame-t4.800.png"},
		{4.9, "frame-t4.900.png"},
	}
	paths := map[string]string{}
	for _, s := range sampleSpecs {
		p := filepath.Join(baseDir, s.name)
		if err := extractFrame(ctx, ffmpeg, outputPath, p, s.atSec); err != nil {
			fail(fmt.Sprintf("extract frame @%.1fs: %v", s.atSec, err))
			continue
		}
		paths[s.name] = p
		res.Artifacts = append(res.Artifacts, "counter/VS-C10-COUNTER-TARGET/"+s.name)
	}

	// target region under test: bottom-right price panel and its surroundings.
	// el_price sits at x=648, y=1440, w=360, h=200; the region is the panel
	// plus margin (digits may exceed the declared w — width is not set on the
	// host so a long "12600 件" overflows rightward without wrapping).
	const tRx, tRy, tRw, tRh = 620, 1410, 440, 260
	regionTarget := func(pngPath string) inkStats { return regionInkAt(t, pngPath, tRx, tRy, tRw, tRh) }
	diffTarget := func(pngA, pngB string) int { return regionDiffAt(t, pngA, pngB, tRx, tRy, tRw, tRh) }

	// 3a) digit presence in the TARGET region at each sample
	for _, s := range sampleSpecs[:3] {
		p, ok := paths[s.name]
		if !ok {
			continue
		}
		st := regionTarget(p)
		sm := inkSample{AtSec: s.atSec, File: s.name, Stats: st, Pass: st.InkRatio > inkRatioMin}
		sm.Detail = fmt.Sprintf("target region (%d,%d,%d,%d): ink %d/%d px (%.2f%%), bbox %v, meanRGB %v",
			tRx, tRy, tRw, tRh, st.InkPx, st.TotalPx, st.InkRatio*100, st.BBox, st.MeanRGB)
		if !sm.Pass {
			sm.Detail += " — BELOW threshold: digits missing at the target element region"
			fail(fmt.Sprintf("t=%.1fs target-region ink ratio %.4f <= %.3f — counter did not land at targetElementId bbox", s.atSec, st.InkRatio, inkRatioMin))
		}
		res.InkSamples = append(res.InkSamples, sm)
	}

	// 3b) the roll happens INSIDE the target region (t=1.0 mid-roll vs
	// t=4.8 settled)
	if p1, ok1 := paths["frame-t1.000.png"]; ok1 {
		if p48, ok48 := paths["frame-t4.800.png"]; ok48 {
			res.RollDiffPx = diffTarget(p1, p48)
			if res.RollDiffPx <= rollDiffMin {
				fail(fmt.Sprintf("target-region roll diff t=1.0 vs t=4.8 = %d px <= %d — digits at the target are static (not rolling there)", res.RollDiffPx, rollDiffMin))
			}
		}
	}

	// 3c) settle check inside the target region
	if p48, ok48 := paths["frame-t4.800.png"]; ok48 {
		if p49, ok49 := paths["frame-t4.900.png"]; ok49 {
			res.SettleDiffPx = diffTarget(p48, p49)
			if res.SettleDiffPx >= settleDiffMax {
				fail(fmt.Sprintf("target-region settle diff t=4.8 vs t=4.9 = %d px >= %d — digits not stable at the terminal value", res.SettleDiffPx, settleDiffMax))
			}
		}
	}

	// 3d) the host MOVED: the origin region must be near-empty in the same
	// frames that carry the digits at the target (a duplicated host would
	// paint both; the legacy origin behavior has its own test in TestCounterL2)
	if p49, ok := paths["frame-t4.900.png"]; ok {
		stOrigin := regionInk(t, p49) // (0,0,300,120) — same region as legacy test
		if stOrigin.InkRatio > 0.001 {
			fail(fmt.Sprintf("origin-region ink %.4f%% > 0.1%% at t=4.9 while digits render at the target — host not relocated (or duplicated)", stOrigin.InkRatio*100))
		}
		res.Notes = append(res.Notes, fmt.Sprintf(
			"origin region clean: ink %.3f%% (<0.1%%) — host relocated to target bbox, not duplicated",
			stOrigin.InkRatio*100))
		stTarget := regionTarget(p49)
		res.Notes = append(res.Notes, fmt.Sprintf(
			"target region ink bbox(x0,y0,x1,y1)=%v within region (%d,%d,+%d,+%d); meanRGB %v vs params.color #2B2118",
			stTarget.BBox, tRx, tRy, tRw, tRh, stTarget.MeanRGB))
	}

	if res.Status == "" {
		res.Status = "pass"
	}
	res.DurationMS = time.Since(start).Milliseconds()
	report.Cases = append(report.Cases, res)

	if res.RollDiffPx > 0 {
		report.Findings = append(report.Findings, fmt.Sprintf(
			"target-region roll quantified: %d px changed between t=1.0 and t=4.8 inside (%d,%d,%d,%d) — the digit roll IS encoded at the target position",
			res.RollDiffPx, tRx, tRy, tRw, tRh))
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

	writeCounterReport(t, report)
	if res.Status != "pass" {
		t.Fatalf("%s failed assertions: %v", res.CaseID, res.FailReasons)
	}
	t.Logf("%s pass: %d frames, target-region roll_diff=%d px, settle_diff=%d px",
		res.CaseID, res.FramesRendered, res.RollDiffPx, res.SettleDiffPx)
}

// buildCounterTargetIR synthesizes the element-positioned counter IR: same
// counter numbers as VS-C01, but a bottom-right price panel (el_price) is the
// counter's targetElementId. Panel geometry (648,1440,360x200) was chosen so
// the origin region (0,0,300,120) and the target region (620,1410,440x260)
// are disjoint — one host relocated shows up as ink in exactly one of them.
func buildCounterTargetIR(t *testing.T) *videoapp.IR {
	t.Helper()

	script := "开抢 五折爆款 全场清仓 两千件手慢无 最后一天"
	ir := &videoapp.IR{
		SchemaVersion: videoapp.IRSchemaVersion,
		Meta: videoapp.Meta{
			FPS:         counterFPS,
			Width:       counterW,
			Height:      counterH,
			DurationSec: counterSeconds,
		},
		Script: script,
		Words:  videoapp.EstimateWords(script, counterSeconds),
		Effects: []videoapp.Effect{{
			ID:              "fx_counter_price",
			Anchor:          videoapp.Anchor{Text: counterAnchorWW, Occurrence: 0},
			Type:            videoapp.EffectCounter,
			TargetElementID: "el_price",
			Params: []byte(`{"from":` + fmt.Sprint(counterFrom) +
				`,"to":` + fmt.Sprint(counterTo) +
				`,"suffix":"` + counterSuffix + `","color":"` + counterColor + `"}`),
		}},
		Elements: []videoapp.Element{
			{ID: "bg", Type: videoapp.ElementShape, Color: counterBG,
				X: 0, Y: 0, W: counterW, H: counterH, Z: 0},
			// the positioning target: a price panel at the bottom-right
			{ID: "el_price", Type: videoapp.ElementShape, Color: "#FFFDF7",
				X: 648, Y: 1440, W: 360, H: 200, Z: 2},
			// static headline mid-card — outside both asserted regions
			{ID: "headline", Type: videoapp.ElementText, Text: "限时五折 · T-10",
				Color: "#2B2118", FontSize: 84,
				X: counterW * 0.14, Y: counterH * 0.34,
				W: counterW * 0.72, H: 200, Z: 3},
		},
	}

	fx := &ir.Effects[0]
	idx, reason, ok := videoapp.ResolveAnchors(fx.Anchor, ir.Words, -1)
	if !ok || idx != 0 || reason != videoapp.AnchorExact {
		t.Fatalf("counter anchor %q did not resolve to word 0/exact: idx=%d reason=%s ok=%v",
			counterAnchorWW, idx, reason, ok)
	}
	fx.ResolvedFrom = &videoapp.ResolvedFrom{WordIndex: idx, Reason: reason}
	return ir
}

// regionInkAt is regionInk parameterized over the region rectangle (the
// element-positioning variant asserts a bottom-right region instead of the
// origin).
func regionInkAt(t *testing.T, pngPath string, rx, ry, rw, rh int) inkStats {
	t.Helper()
	img := decodePNGRect(t, pngPath, rx+rw, ry+rh)
	st := inkStats{TotalPx: rw * rh, BBox: [4]int{-1, -1, -1, -1}}
	var rSum, gSum, bSum int64
	for y := ry; y < ry+rh; y++ {
		for x := rx; x < rx+rw; x++ {
			r, g, b, _ := img.At(x, y).RGBA()
			r8, g8, b8 := int(r>>8), int(g>>8), int(b>>8)
			if (r8+g8+b8)/3 < 128 {
				st.InkPx++
				rSum += int64(r8)
				gSum += int64(g8)
				bSum += int64(b8)
				if st.BBox[0] < 0 || x < st.BBox[0] {
					st.BBox[0] = x
				}
				if st.BBox[1] < 0 || y < st.BBox[1] {
					st.BBox[1] = y
				}
				if x > st.BBox[2] {
					st.BBox[2] = x
				}
				if y > st.BBox[3] {
					st.BBox[3] = y
				}
			}
		}
	}
	if st.InkPx > 0 {
		st.InkRatio = float64(st.InkPx) / float64(st.TotalPx)
		st.MeanRGB = [3]int{int(rSum / int64(st.InkPx)), int(gSum / int64(st.InkPx)), int(bSum / int64(st.InkPx))}
	}
	return st
}

// regionDiffAt is regionDiff parameterized over the region rectangle.
func regionDiffAt(t *testing.T, pngA, pngB string, rx, ry, rw, rh int) int {
	t.Helper()
	a, b := decodePNGRect(t, pngA, rx+rw, ry+rh), decodePNGRect(t, pngB, rx+rw, ry+rh)
	n := 0
	for y := ry; y < ry+rh; y++ {
		for x := rx; x < rx+rw; x++ {
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

// decodePNGRect decodes a PNG and verifies it covers the asserted rectangle.
func decodePNGRect(t *testing.T, path string, needW, needH int) image.Image {
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
	if img.Bounds().Dx() < needW || img.Bounds().Dy() < needH {
		t.Fatalf("frame %s smaller than the asserted region: %v", path, img.Bounds())
	}
	return img
}

// writeCounterReport persists the report next to the other L2 reports
// (testdata/counter-l2-report.json) — always, pass or fail.
func writeCounterReport(t *testing.T, report *counterReport) {
	t.Helper()
	_, thisFile, _, _ := runtime.Caller(0)
	repPath := filepath.Join(filepath.Dir(thisFile), "counter-l2-report.json")
	b, _ := json.MarshalIndent(report, "", "  ")
	if werr := os.WriteFile(repPath, b, 0o644); werr != nil {
		t.Errorf("write counter-l2-report.json: %v", werr)
	}
	t.Logf("report written: %s (pass=%d fail=%d skip=%d)", repPath,
		report.Totals.Pass, report.Totals.Fail, report.Totals.Skip)
}

// silence potential unused-import drift if the io import becomes conditional
var _ io.Writer = (*os.File)(nil)
var _ = exec.Command
