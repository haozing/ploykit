//go:build capx

// Element time window (P0-1) pixel-level proof — case library §5.16 P0-1 +
// §3.1.4 T-09 degradation mapping. The T-09 root cause: elements are
// one-shot appended and visible for the WHOLE composition (C01's three
// selling cards all exist in the DOM from F0), so "card 1 leaves before
// card 2 enters" is unreachable. P0-1 adds Element.startFrame/endFrame; the
// builder hides a windowed element outside [startFrame, endFrame) via
// zero-duration visibility sets on the main timeline.
//
// This test is THE feasibility proof for C01's "三卡错峰" (staggered cards):
// it synthesizes one IR with two side-by-side elements —
//   A: startFrame=45 (1.5s in) / endFrame=105 (3.5s out)
//   B: no window (legacy, always visible)
// drives them through the REAL encode chain (Projector.HTML → capx
// RenderFrames → EncodePNGStream → MP4), extracts frames from the DECODED
// product at F30 / F60 / F120 (the before / inside / after triple), and
// asserts the A-region pixel color at each:
//
//   F30 (1.0s):  A region == background   (A hidden before its window)
//   F60 (2.0s):  A region == A's color    (A visible inside its window)
//   F120 (4.0s): A region == background   (A hidden again after endFrame)
//
// plus the back-compat control: B's region carries B's color at all three
// frames (no window → byte-identical legacy behavior).
//
// Hidden-before visible-after is the assertion the case library §5.9 marks
// mandatory ("只断言出现后元素是否存在等于没测") — both directions are
// pixel-asserted here.
//
// Frame math (§7.0 clock): frame = round(t × fps); t = frame / fps. F30 →
// seek 1.000s, F60 → 2.000s, F120 → 4.000s — all exact at 30fps, so MP4
// keyframe granularity cannot smear the sample.
//
// Artifacts (§7.0 retention):
//   testdata/timewindow/VS-TW/output.mp4
//   testdata/timewindow/VS-TW/frame-F{030,060,120}.png
//   testdata/timewindow-report.json
//
// Run:
//
//	go test -tags capx ./internal/video/testdata -run TestElementTimeWindow -v -timeout 20m
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

const (
	twCaseID     = "VS-TW"
	twFPS        = 30
	twSeconds    = 5.0
	twW          = 1080
	twH          = 1920
	twBG         = "#FFF7EE" // cream background (same family as C01)
	twColorA     = "#FF6A3D" // element A — the windowed card (C01 accent)
	twColorB     = "#1E9E62" // element B — the windowless control (C01 green)
	twStartFrame = 45        // 1.5s @30fps
	twEndFrame   = 105       // 3.5s @30fps
)

// geometry: A and B share the same x band and are vertically stacked, both
// far from the canvas edges; the regions asserted are inset 20px from the
// declared element rects so no anti-aliased edge pixel participates.
var (
	twRectA = [4]int{80, 400, 500, 400} // x, y, w, h
	twRectB = [4]int{80, 1000, 500, 400}
	twInset = 20
)

// buildTimeWindowIR synthesizes the P0-1 proof IR. No animations, no
// effects: every pixel change in the asserted regions is attributable to
// the time window alone. Static elements render identically at every frame
// except for the window-driven visibility flips.
func buildTimeWindowIR(t *testing.T) *videoapp.IR {
	t.Helper()
	script := "开抢 五折爆款 全场清仓 两千件手慢无 最后一天"
	ir := &videoapp.IR{
		SchemaVersion: videoapp.IRSchemaVersion,
		Meta: videoapp.Meta{
			FPS:         twFPS,
			Width:       twW,
			Height:      twH,
			DurationSec: twSeconds,
		},
		Script: script,
		Words:  videoapp.EstimateWords(script, twSeconds),
		Elements: []videoapp.Element{
			{ID: "el_bg", Type: videoapp.ElementShape, Color: twBG,
				X: 0, Y: 0, W: twW, H: twH, Z: 0},
			// A: the windowed element — visible exactly F45..F104 (hide set
			// lands at F105)
			{ID: "el_card_a", Type: videoapp.ElementShape, Color: twColorA,
				X: float64(twRectA[0]), Y: float64(twRectA[1]),
				W: float64(twRectA[2]), H: float64(twRectA[3]), Z: 2,
				StartFrame: intPtr(twStartFrame), EndFrame: intPtr(twEndFrame)},
			// B: the legacy control — no window, visible for the whole clip
			{ID: "el_card_b", Type: videoapp.ElementShape, Color: twColorB,
				X: float64(twRectB[0]), Y: float64(twRectB[1]),
				W: float64(twRectB[2]), H: float64(twRectB[3]), Z: 2},
		},
	}
	if verr := videoapp.Validate(ir); verr != nil {
		t.Fatalf("fixture IR invalid: %v", verr)
	}
	return ir
}

func intPtr(i int) *int { return &i }

// ---- pixel analysis ----

func mustDecodePNG(t *testing.T, path string) image.Image {
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

func hexRGB(h string) (int, int, int) {
	var r, g, b int
	fmt.Sscanf(h, "#%02x%02x%02x", &r, &g, &b)
	return r, g, b
}

// regionMeanRGB averages every pixel of the inset region rectangle.
func regionMeanRGB(t *testing.T, img image.Image, rect [4]int) (int, int, int) {
	t.Helper()
	x0, y0, w, h := rect[0]+twInset, rect[1]+twInset, rect[2]-2*twInset, rect[3]-2*twInset
	var rs, gs, bs int64
	n := int64(0)
	for y := y0; y < y0+h; y++ {
		for x := x0; x < x0+w; x++ {
			r, g, b, _ := img.At(x, y).RGBA()
			rs += int64(r >> 8)
			gs += int64(g >> 8)
			bs += int64(b >> 8)
			n++
		}
	}
	return int(rs / n), int(gs / n), int(bs / n)
}

// withinChannel is the per-channel tolerance for "region is this color".
// libx264 CRF 18 on flat fills is visually exact; 8 per channel covers
// encoder dither on the 8-bit boundary (observed ±1-3 on flat regions).
const withinChannel = 8

func regionIsColor(t *testing.T, img image.Image, rect [4]int, hex string) (bool, string) {
	t.Helper()
	wr, wg, wb := hexRGB(hex)
	gr, gg, gb := regionMeanRGB(t, img, rect)
	ok := abs(gr-wr) <= withinChannel && abs(gg-wg) <= withinChannel && abs(gb-wb) <= withinChannel
	return ok, fmt.Sprintf("region(%d,%d,%d,%d) mean RGB (%d,%d,%d) vs %s (%d,%d,%d)",
		rect[0], rect[1], rect[2], rect[3], gr, gg, gb, hex, wr, wg, wb)
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

// ---- report model ----

type twFrameVerdict struct {
	Frame    int    `json:"frame"`
	AtSec    string `json:"at_sec"`
	Check    string `json:"check"`
	Pass     bool   `json:"pass"`
	Detail   string `json:"detail"`
	Expected string `json:"expected"`
}

type twReport struct {
	Layer  string           `json:"layer"`
	RunID  string           `json:"run_id"`
	Env    []string         `json:"env"`
	Case   string           `json:"case_id"`
	Status string           `json:"status"`
	Frames []twFrameVerdict `json:"frame_verdicts"`
	Evce   []string         `json:"evidence,omitempty"`
	Notes  []string         `json:"notes,omitempty"`
	Totals struct {
		Pass int `json:"pass"`
		Fail int `json:"fail"`
	} `json:"totals"`
	Artifacts  []string `json:"artifacts,omitempty"`
	DurationMS int64    `json:"duration_ms"`
}

// ---- the test ----

func TestElementTimeWindow(t *testing.T) {
	chrome := chromePath(t)
	ffmpeg := ffmpegPath(t)
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
	baseDir := filepath.Join(filepath.Dir(thisFile), "timewindow", twCaseID)
	if err := os.MkdirAll(baseDir, 0o755); err != nil {
		t.Fatal(err)
	}

	start := time.Now()
	report := &twReport{
		Layer: "L2-timewindow (P0-1 element startFrame/endFrame, case library §5.16 + §3.1.4 T-09)",
		RunID: time.Now().Format("20060102-150405") + "-timewindow",
		Case:  twCaseID,
	}
	host, _ := os.Hostname()
	report.Env = append(report.Env,
		"os="+runtime.GOOS+"/"+runtime.GOARCH,
		"host="+host,
		"chrome="+chrome,
		"ffmpeg="+ffmpeg,
	)
	report.Evce = append(report.Evce,
		"[代码] IR 扩展：example/internal/video/app/ir.go Element.StartFrame/EndFrame（json:startFrame/endFrame，指针区分缺省与 0）+ Validate 写时校验（非负 / start≤end / ≤DurationFrames）",
		"[代码] 投影：example/internal/video/app/projector.go elementMap — 两字段数值透传，缺省不出键（向后兼容：旧 IR payload 无 startFrame/endFrame 键）",
		"[代码] 渲染：example/internal/video/app/timeline-builder.js — buildClipDOM 对带窗元素初始 visibility:hidden；build() 在主时间线 tl.set(visible, tStart) / tl.set(hidden, tEnd)（零时长 set，seek 确定性安全）",
		"[口径] 帧号 = 全局时间轴帧（§7.0 时钟，与词锚同轴）；t = frame/fps；F30→1.000s、F60→2.000s、F120→4.000s 均为整帧时刻",
		"[口径] 断言对象是 MP4 解码抽帧（ffmpeg -ss 提取 → png.Decode 区域均值），证明显隐被编码进产物而非仅存在于捕获层",
		"[语义] B 元素无时间窗 = 旧行为（全程可见）——同帧对照组，向后兼容的像素级证明",
	)

	// 1) IR + validate (already fatal inside build; recorded here for report)
	ir := buildTimeWindowIR(t)
	frames := videoapp.DurationFrames(ir, twFPS) // ceil(5*30) = 150
	spec := capx.FrameSpec{Width: twW, Height: twH, FPS: twFPS, DurationFrames: frames}
	if serr := spec.Validate(); serr != nil {
		t.Fatalf("frame spec: %v", serr)
	}

	// 2) full-chain render + encode through the real pipeline
	outputPath := filepath.Join(baseDir, "output.mp4")
	if _, rErr := renderAndEncode(t, ctx, rt, baseDir, ir, spec, outputPath); rErr != nil {
		t.Fatalf("render+encode: %v", rErr)
	}
	report.Artifacts = append(report.Artifacts, "timewindow/"+twCaseID+"/output.mp4")

	// 3) extract the before / inside / after triple from the DECODED product
	samples := []struct {
		frame int
		atSec float64
		name  string
	}{
		{30, 1.0, "frame-F030.png"}, // before A's window: A hidden
		{60, 2.0, "frame-F060.png"}, // inside A's window: A visible
		{120, 4.0, "frame-F120.png"}, // after A's window: A hidden again
	}
	paths := map[string]string{}
	for _, s := range samples {
		p := filepath.Join(baseDir, s.name)
		if err := extractFrame(ctx, ffmpeg, outputPath, p, s.atSec); err != nil {
			t.Fatalf("extract frame F%d: %v", s.frame, err)
		}
		paths[s.name] = p
		report.Artifacts = append(report.Artifacts, "timewindow/"+twCaseID+"/"+s.name)
	}

	// 4) pixel verdicts — the C01 "三卡错峰" feasibility proof lives here:
	// A (windowed) flips hidden→visible→hidden on the encoded product while
	// B (windowless) never changes.
	expected := []struct {
		frame    int
		atSec    float64
		name     string
		aElement bool // true = expect A's color, false = expect background
		bElement bool // B always expects its own color
	}{
		{30, 1.0, "frame-F030.png", false, true},
		{60, 2.0, "frame-F060.png", true, true},
		{120, 4.0, "frame-F120.png", false, true},
	}
	fail := 0
	for _, e := range expected {
		img := mustDecodePNG(t, paths[e.name])

		aHex := twBG
		aWhat := "background (A hidden outside window)"
		if e.aElement {
			aHex = twColorA
			aWhat = "element A color (A visible inside window)"
		}
		aOK, aDetail := regionIsColor(t, img, twRectA, aHex)
		report.Frames = append(report.Frames, twFrameVerdict{
			Frame: e.frame, AtSec: fmt.Sprintf("%.3f", e.atSec),
			Check: "A region", Pass: aOK, Detail: aDetail, Expected: aWhat,
		})
		if !aOK {
			fail++
		}

		bOK, bDetail := regionIsColor(t, img, twRectB, twColorB)
		report.Frames = append(report.Frames, twFrameVerdict{
			Frame: e.frame, AtSec: fmt.Sprintf("%.3f", e.atSec),
			Check: "B region (windowless control)", Pass: bOK,
			Detail: bDetail, Expected: "element B color at every frame (legacy always-visible)",
		})
		if !bOK {
			fail++
		}
	}

	// boundary neighborhoods recorded as notes (no assertion — the exact
	// boundary frame is codec-timing sensitive; the interior triple above is
	// the mandated proof). Extraction time = (N-0.5)/fps: frame N has PTS
	// N/fps, and ffmpeg -ss picks the first frame with PTS >= t, so probing
	// the midpoint of frame N-1's display interval selects frame N exactly
	// (a naive N/fps formatted to %.3f can round UP past PTS(N) and sample
	// frame N+1 — observed live at F44: 1.46667 → "1.467" ≥ PTS(45)=1.5? no
	// but ≥ PTS(44)=1.4667? no either → ffmpeg returned F45).
	//   F44 (1 before open)  → A still background
	//   F45 (open frame)     → A visible (window opens exactly at startFrame)
	//   F105 (hide frame)    → A hidden (hide set lands exactly at endFrame)
	//   F106 (1 after close) → A stays background
	for _, bp := range []struct {
		frame  int
		name   string
		wantEl bool // true = expect A's color (open frame), false = background
	}{
		{44, "frame-F044.png", false},
		{45, "frame-F045.png", true},
		{105, "frame-F105.png", false},
		{106, "frame-F106.png", false},
	} {
		atSec := (float64(bp.frame) - 0.5) / twFPS
		p := filepath.Join(baseDir, bp.name)
		if err := extractFrame(ctx, ffmpeg, outputPath, p, atSec); err != nil {
			report.Notes = append(report.Notes, fmt.Sprintf("boundary probe F%d: extract failed: %v", bp.frame, err))
			continue
		}
		img := mustDecodePNG(t, p)
		wantHex := twBG
		wantWhat := "background"
		if bp.wantEl {
			wantHex = twColorA
			wantWhat = "element A color"
		}
		ok, detail := regionIsColor(t, img, twRectA, wantHex)
		verdict := "as expected"
		if !ok {
			verdict = "UNEXPECTED"
		}
		report.Notes = append(report.Notes, fmt.Sprintf(
			"boundary probe F%d (extract %.3fs, sampling PTS %.4fs): want %s — %s — %s",
			bp.frame, atSec, float64(bp.frame)/twFPS, wantWhat, detail, verdict))
	}

	report.Totals.Fail = fail
	report.Totals.Pass = len(report.Frames) - fail
	if fail > 0 {
		report.Status = "fail"
	} else {
		report.Status = "pass"
	}
	report.DurationMS = time.Since(start).Milliseconds()

	writeTimeWindowReport(t, report)
	if fail > 0 {
		t.Fatalf("%s failed %d pixel assertions (see timewindow-report.json)", twCaseID, fail)
	}
	t.Logf("%s pass: window A [F%d,F%d) proven hidden→visible→hidden on decoded MP4; control B visible at every sampled frame",
		twCaseID, twStartFrame, twEndFrame)
}

// writeTimeWindowReport persists the verdict table (always, pass or fail).
func writeTimeWindowReport(t *testing.T, report *twReport) {
	t.Helper()
	_, thisFile, _, _ := runtime.Caller(0)
	repPath := filepath.Join(filepath.Dir(thisFile), "timewindow-report.json")
	b, _ := json.MarshalIndent(report, "", "  ")
	if werr := os.WriteFile(repPath, b, 0o644); werr != nil {
		t.Errorf("write timewindow-report.json: %v", werr)
	}
	t.Logf("report written: %s (pass=%d fail=%d)", repPath, report.Totals.Pass, report.Totals.Fail)
}
