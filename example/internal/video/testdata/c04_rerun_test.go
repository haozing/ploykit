//go:build capx

// Package l1 — Video Studio test batch 4, item C04: corrected-frame-table
// rerun ("口径统一后的首次全绿机会").
//
// Round 3 unified the anchor clock (case-library §7.0: the word anchor
// frame = ceil(word.start × fps) is the case library's ONLY clock) and
// backfilled the C04 expected-frame table (§4.2.5, [口径 round2] column):
// 180→198, 216→327 (max +111), 540→549, 720→609 (max −111), 900→909,
// 960→957, 1260→1269; 1620/1799 unchanged. Every row that read "mismatch"
// in round 2 purely because the table used target-schema orchestration
// frames should now agree with the rendered reality — this file is the
// verification.
//
// Harness: same pattern as c04_c06_render_test.go (batch 2), C04 only —
// degraded current-IR projection -> self-contained player HTML -> full
// 1800-frame loop through a REAL local headless Chrome via platform/capx
// -> keep corrected keyframes AND the original-frame positions -> pixel
// region assertions -> golden artifacts (golden/c04-round3/) +
// c04-rerun-report.json with per-frame derivation formulas and the
// before/after comparison table.
//
// Before/after evidence lives IN ONE RENDER: the original frame positions
// (216/720/900/960) are kept alongside the corrected positions (327/609/
// 909+939/957) and the two positions of each pair are compared per key
// region (per-bar blue shares / line rect share / ring amber share /
// counter ink share + MAE) — the direct evidence of what the ±111/+9/−3
// corrections are worth.
//
// Degradation handling (unchanged semantics from batch 2):
//   - F609 is still a solid 440x300 rectangle (C04-D1, degraded X series):
//     marked in notes, never counted as fail (task instruction).
//   - A-C04-04 (F1620 bar-zone blue <= 2%) stays degraded_na: no element
//     unmount under C04-D6; the round2 measured 43.3% is re-checked for
//     consistency instead (band ±0.02, divergence would be a regression).
//   - D-01 counter: fixed upstream (renderer.go seekTimeline pauses with
//     suppressEvents=false); F960 digit visibility is re-confirmed and a
//     miss is treated as a REGRESSION (fail + immediate error).
//
// Status vocabulary: ok / fail / mismatch / degraded_na (as batch 2) plus
// before (original-position evidence row, recorded not judged) and probe.
//
// Run:
//
//	go -C example test -tags capx -run TestC04RerunRound3 -v ./internal/video/testdata -timeout 20m
package l1

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/haozing/ploykit/platform/capx"
	videoapp "myproduct/internal/video/app"
)

// ---- round3 corrected frame table (§4.2.5 [口径 round2] column) ----

type c4rRow struct {
	Orig      int     `json:"orig_frame"`
	Corrected int     `json:"corrected_frame"`
	TimeSec   float64 `json:"time_sec"`
	Formula   string  `json:"formula"`
	Expect    string  `json:"expect"`
}

var c4rTable = []c4rRow{
	{180, 198, 6.60, `ceil(6.6×30)=198 — "二零二二"occ1, an_bar22_grow 生长锚`, "柱生长 onset 帧（progress 0 → 蓝色≈0）；生长/落定证据在探针 200/205/210/222"},
	{216, 327, 10.90, `ceil(10.1×30)=303 — "二零二四"occ1, an_bar24_grow 锚；+24 帧落定 = 327`, "三根柱全部可见（A-C04-01 改按 327 执行）：柱顶 620/560/470±10px，高度 180:240:330 单调"},
	{540, 549, 18.30, `ceil(18.3×30)=549 — "增速"occ2, an_line_draw / an_note_in 锚`, "折线区 onset 帧（progress 0）；60 帧淡入落定于 F609（该帧另有断言）"},
	{720, 609, 20.30, `549+60=609 — an_line_draw 落定（60 帧 power1.out）`, "折线时段画面完整（降级 X 系：440×300 实心矩形——已知降级标记，不判败）"},
	{900, 909, 30.30, `ceil(30.3×30)=909 — "产业"occ1, an_ring_in(30 帧)/an_ring_num_in(20 帧) 锚`, "占比环入场 onset 帧；环落定 = 939（封面语义落点）——封面修正：F900 不含主图的发现由帧号 909/939 解决"},
	{960, 957, 31.90, `ceil(31.9×30)=957 — "五十六点七"occ1, ef_ring_cnt 窗口起（时长 min(1.2, 60−31.9)=1.2s→36 帧, 至 993）`, "counter 窗口开启帧（值=from→\"0%\"）；环心数字 56.7% 可见"},
	{1260, 1269, 42.30, `ceil(42.3×30)=1269 — "总量"occ3 词表节拍（无专属锚点动画）`, "三图同屏原尺寸（降级保持）；无高亮活动（ef_hl_growth 窗口 909–934 早已结束）"},
	{1620, 1620, 54.00, `无词锚，行不变（round3 §4.2.5）`, "柱区状态与 round2 实测 43.3% 复核一致（A-C04-04 hard prompt 降级不适用照旧，实测值留档）"},
	{1799, 1799, 59.97, `尾帧行不变`, "说明卡保持、三图保持（C04-D6 无元素卸载、无淡出）"},
}

// ---- regions (batch-2 C04 rects + corrected-position bar rects) ----

var (
	c4rTitle   = [4]int{960, 180, 840, 80}
	c4rBarZone = [4]int{100, 440, 560, 370}
	c4rLine    = [4]int{800, 360, 440, 300}
	c4rRing    = [4]int{1380, 380, 280, 280}
	c4rRingNum = [4]int{1460, 500, 160, 60}
	c4rNote    = [4]int{80, 830, 900, 40}
	c4rCounter = [4]int{0, 0, 400, 150}
	c4rFull    = [4]int{0, 0, 1920, 1080}
)

// c4rPanShift = camera-pan x offset at frame f. an_camera_pan_*: anchor
// "总量"occ2 @6.2s → F186, 360 frames linear, dx −60 → ends F546. The bars
// sit at baseX+shift, so any per-bar sampling rect must track the shift.
func c4rPanShift(f int) float64 {
	p := (float64(f) - 186) / 360
	if p < 0 {
		p = 0
	}
	if p > 1 {
		p = 1
	}
	return -60 * p
}

// c4rBarRect = sampling rect for one bar at frame f (base layout x, ±10px
// padding around the shifted 120px bar).
func c4rBarRect(baseX int, f int) [4]int {
	return [4]int{int(float64(baseX)+c4rPanShift(f)) - 10, 440, 140, 370}
}

// ---- record ----

type c4rRec struct {
	Frame    int            `json:"frame"`
	TimeSec  float64        `json:"time_sec"`
	Status   string         `json:"status"` // ok|fail|mismatch|degraded_na|before|probe
	Label    string         `json:"label,omitempty"`
	Role     string         `json:"role"` // corrected|before|probe
	Formula  string         `json:"formula,omitempty"`
	Expect   string         `json:"expect,omitempty"`
	Actual   string         `json:"actual,omitempty"`
	Checks   map[string]any `json:"structure_checks"`
	Notes    []string       `json:"notes,omitempty"`
	DurMS    int64          `json:"duration_ms"`
	Artifact string         `json:"artifact,omitempty"`
}

func TestC04RerunRound3(t *testing.T) {
	if testing.Short() {
		t.Skip("C04 rerun drives a real headless Chrome; skipped in -short mode")
	}
	_, thisFile, _, _ := runtime.Caller(0)
	baseDir := filepath.Dir(thisFile)
	goldenDir := filepath.Join(baseDir, "golden", "c04-round3")
	if err := os.MkdirAll(goldenDir, 0o755); err != nil {
		t.Fatalf("mkdir golden dir: %v", err)
	}
	runID := newRunID2("c04r3")

	// -- D-01 status at render time (same probe as batch 2) --
	d01 := checkD01(t)
	t.Logf("D-01 status at render time: %s (%s)", d01.State, d01.CallLn)
	if d01.State != "fixed" {
		t.Logf("WARNING: D-01 not fixed — F957/F960 counter assertions will fail (regression path)")
	}

	// -- 1. degraded IR: load, validate, duration --
	irBytes, err := os.ReadFile(filepath.Join(baseDir, "ir", "c04.degraded.json"))
	if err != nil {
		t.Fatalf("read c04.degraded.json: %v", err)
	}
	ir := &videoapp.IR{}
	if err := json.Unmarshal(irBytes, ir); err != nil {
		t.Fatalf("unmarshal IR: %v", err)
	}
	if err := videoapp.Validate(ir); err != nil {
		t.Fatalf("degraded IR failed Validate: %v", err)
	}
	const fpsC04 = 30
	frames := videoapp.DurationFrames(ir, ir.Meta.FPS)
	if frames != 1800 {
		t.Fatalf("DurationFrames=%d, expected 1800", frames)
	}
	msha, err := json.Marshal(ir)
	if err != nil {
		t.Fatalf("marshal IR: %v", err)
	}
	irSHA := fmt.Sprintf("%x", sha256.Sum256(msha))

	// -- 2. word-anchor derivation evidence --
	// anchor resolutions (framework-resolved) — the mechanism behind every
	// corrected frame number
	var resJSON []map[string]any
	for _, r := range videoapp.ResolveAll(ir, nil) {
		start := 0.0
		if r.WordIndex >= 0 && r.WordIndex < len(ir.Words) {
			start = ir.Words[r.WordIndex].Start
		}
		resJSON = append(resJSON, map[string]any{
			"owner": r.Owner, "owner_id": r.OwnerID, "anchor_text": r.AnchorText,
			"word_index": r.WordIndex, "reason": r.Reason,
			"word_start_sec": start, "anchor_frame": int(math.Ceil(start * float64(fpsC04))),
		})
		t.Logf("anchor %s(%s) %q -> word[%d] reason=%s start=%.2fs frame=%d",
			r.OwnerID, r.Owner, r.AnchorText, r.WordIndex, r.Reason, start, int(math.Ceil(start*float64(fpsC04))))
	}
	// the full derivation anchor table (§4.2.5 bottom: frame = ceil(start×30))
	type c4rAnchor struct {
		Index int     `json:"index"`
		Text  string  `json:"text"`
		Start float64 `json:"start_sec"`
		Frame int     `json:"frame"`
	}
	anchors := make([]c4rAnchor, 0, len(ir.Words))
	for _, w := range ir.Words {
		anchors = append(anchors, c4rAnchor{w.Index, w.Text, w.Start, int(math.Ceil(w.Start * float64(fpsC04)))})
	}

	// -- 3. project to player HTML --
	proj := videoapp.NewProjector(nil)
	html, err := proj.HTML(context.Background(), ir, "")
	if err != nil {
		t.Fatalf("project HTML: %v", err)
	}
	t.Logf("projected HTML bytes=%d", len(html))

	// -- 4. capx runtime, real local chrome --
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
		t.Fatalf("capx runtime not available")
	}
	rend, err := rt.Renderer()
	if err != nil {
		t.Fatalf("capx Renderer: %v", err)
	}

	// -- 5. full 1800-frame loop; keep corrected + before + probe frames --
	// role corrected: round3 frame numbers (+939 = the corrected cover-ready
	// frame) ; role before: original table positions for the comparison;
	// probes: growth series proving onset right after each corrected anchor.
	corrected := []int{198, 327, 549, 609, 909, 939, 957, 1269, 1620, 1799}
	before := []int{216, 720, 900, 960}
	type c4rProbe struct {
		f     int
		label string
	}
	probes := []c4rProbe{
		{200, "bar22-grow-early"}, {205, "bar22-grow-mid"}, {210, "bar22-grow-late"}, {222, "bar22-settled"},
		{553, "line-grow-early"}, {558, "line-grow-onset"}, {570, "line-grow-mid"}, {590, "line-grow-late"},
		{915, "ring-grow-early"}, {923, "ring-grow-mid"}, {931, "ring-grow-late"},
	}
	kept := map[int]bool{}
	var keptList []int
	for _, f := range corrected {
		kept[f], _ = true, keptList
	}
	for _, f := range before {
		if !kept[f] {
			kept[f] = true
		}
	}
	for _, p := range probes {
		kept[p.f] = true
	}
	// build ordered unique list (sorted for determinism)
	seen := map[int]bool{}
	for _, f := range corrected {
		if !seen[f] {
			seen[f] = true
			keptList = append(keptList, f)
		}
	}
	for _, f := range before {
		if !seen[f] {
			seen[f] = true
			keptList = append(keptList, f)
		}
	}
	for _, p := range probes {
		if !seen[p.f] {
			seen[p.f] = true
			keptList = append(keptList, p.f)
		}
	}
	for i := 0; i < len(keptList); i++ { // insertion sort, tiny n
		for j := i + 1; j < len(keptList); j++ {
			if keptList[j] < keptList[i] {
				keptList[i], keptList[j] = keptList[j], keptList[i]
			}
		}
	}

	pngs := map[int][]byte{}
	cum := map[int]int64{}
	renderStart := time.Now()
	err = rend.RenderFrames(t.Context(),
		capx.Doc{HTML: string(html), TimelineID: timelineID},
		capx.FrameSpec{Width: 1920, Height: 1080, FPS: fpsC04, DurationFrames: 1800},
		func(_ context.Context, f capx.Frame) error {
			if kept[f.Index] {
				pngs[f.Index] = f.PNG
				cum[f.Index] = time.Since(renderStart).Milliseconds()
			}
			if f.Index%200 == 0 {
				t.Logf("frame %d/1799 rendered (%.1fs elapsed)", f.Index, time.Since(renderStart).Seconds())
			}
			return nil
		})
	renderTotal := time.Since(renderStart)
	if err != nil {
		t.Fatalf("RenderFrames failed after %s: %v", renderTotal, err)
	}
	t.Logf("RENDER DONE: 1800 frames in %s (%.1f ms/frame avg, real chrome=%s)",
		renderTotal.Round(time.Millisecond), float64(renderTotal.Milliseconds())/1800, chromePath)

	// -- 6. hard PNG checks + decode + golden artifacts --
	imgs := map[int]image.Image{}
	recs := map[int]*c4rRec{}
	roleOf := map[int]string{}
	labelOf := map[int]string{}
	for _, f := range corrected {
		roleOf[f] = "corrected"
	}
	roleOf[939] = "corrected"
	for _, f := range before {
		if roleOf[f] == "" {
			roleOf[f] = "before"
		}
	}
	for _, p := range probes {
		roleOf[p.f] = "probe"
		labelOf[p.f] = p.label
	}
	for _, f := range keptList {
		pngB := pngs[f]
		checks := map[string]any{}
		checks["png_magic_ok"] = bytes.HasPrefix(pngB, pngMagic)
		im, derr := png.Decode(bytes.NewReader(pngB))
		checks["png_decoded"] = derr == nil
		dimOK := derr == nil && im.Bounds().Dx() == 1920 && im.Bounds().Dy() == 1080
		checks["dimensions"] = "1920x1080"
		checks["dimensions_ok"] = dimOK
		if !checks["png_magic_ok"].(bool) || derr != nil || !dimOK {
			t.Fatalf("frame %d failed hard PNG checks", f)
		}
		imgs[f] = im
		name := fmt.Sprintf("frame-%03d.png", f)
		if werr := os.WriteFile(filepath.Join(goldenDir, name), pngB, 0o644); werr != nil {
			t.Fatalf("write golden frame %d: %v", f, werr)
		}
		recs[f] = &c4rRec{
			Frame: f, TimeSec: float64(f) / float64(fpsC04), Role: roleOf[f],
			Label: labelOf[f], Checks: checks, DurMS: cum[f],
			Artifact: filepath.ToSlash(filepath.Join("example", "internal", "video", "testdata", "golden", "c04-round3", name)),
		}
	}

	// formula/expect wiring from the corrected table
	for _, row := range c4rTable {
		if r := recs[row.Corrected]; r != nil && r.Role == "corrected" {
			r.Formula = row.Formula
			r.Expect = row.Expect
		}
	}

	c4rSet := func(f int, status, actual string, notes ...string) {
		r := recs[f]
		r.Status = status
		r.Actual = actual
		r.Notes = notes
		t.Logf("F%-4d [%s] %s", f, status, actual)
		for _, n := range notes {
			t.Logf("         note: %s", n)
		}
	}

	img := func(f int) image.Image { return imgs[f] }
	blue := func(im image.Image, r [4]int) float64 { return shareNear(im, r, 46, 134, 222, 22) }
	amber := func(im image.Image, r [4]int) float64 { return shareNear(im, r, 245, 166, 35, 22) }
	navy := func(im image.Image, r [4]int) float64 { return shareNear(im, r, 31, 58, 95, 34) }
	gray := func(im image.Image, r [4]int) float64 { return shareNear(im, r, 91, 107, 127, 30) }
	cream := func(im image.Image, r [4]int) float64 { return shareNear(im, r, 242, 245, 249, 12) }
	inkOf := func(im image.Image, r [4]int) float64 { return round4(1 - cream(im, r)) }

	// ================= corrected-position assertions =================

	// -- F198 (row 180 -> 198): growth anchor onset. At the anchor frame the
	//    scaleIn tween sits at progress 0 (scale 0); growth evidence comes
	//    from the probe series; settled at 198+24=222.
	sh198 := blue(img(198), c4rBarRect(180, 198))
	sh200 := blue(img(200), c4rBarRect(180, 200))
	sh205 := blue(img(205), c4rBarRect(180, 205))
	sh210 := blue(img(210), c4rBarRect(180, 210))
	sh222 := blue(img(222), c4rBarRect(180, 222))
	for _, sp := range []struct {
		f int
		v float64
	}{{200, sh200}, {205, sh205}, {210, sh210}, {222, sh222}} {
		recs[sp.f].Checks["bar22_blue_share"] = sp.v
		recs[sp.f].Checks["pan_shift_px"] = round2(c4rPanShift(sp.f))
	}
	recs[198].Checks["bar22_blue_share_at_anchor"] = sh198
	recs[198].Checks["probe_shares"] = map[string]float64{"f200": sh200, "f205": sh205, "f210": sh210, "f222": sh222}
	if sh198 <= 0.02 && sh210 >= 0.2 && sh222 >= 0.40 {
		c4rSet(198, "ok",
			fmt.Sprintf("柱生长 onset 锚帧成立：F198 蓝色 %.4f（progress 0 → scale 0），探针 F210=%.2f（生长中）、F222=%.2f（198+24 落定）", sh198, sh210, sh222),
			"词锚 ceil(6.6×30)=198 与渲染严格一致——原表 180 是镜号边界（round2 实测首可见采样 F200，含阈值步长 ±2，与本轮探针序列吻合）")
	} else {
		c4rSet(198, "fail",
			fmt.Sprintf("生长 onset 与词锚 198 不符：F198 share=%.4f（应≈0）、F210=%.3f、F222=%.3f", sh198, sh210, sh222))
	}

	// -- F216 (before evidence): what the original table position actually
	//    shows in this same render — round2's mismatch, reproduced as data.
	c216 := recs[216].Checks
	b216_22 := blue(img(216), c4rBarRect(180, 216))
	b216_23 := blue(img(216), c4rBarRect(360, 216))
	b216_24 := blue(img(216), c4rBarRect(540, 216))
	c216["bar22_blue_share"] = b216_22
	c216["bar23_blue_share"] = b216_23
	c216["bar24_blue_share"] = b216_24
	if top, bottom, found := colorRowSpan(img(216), c4rBarRect(180, 216), 46, 134, 222, 22, 0.05); found {
		c216["bar22_top_row"] = top
		c216["bar22_bottom_row"] = bottom
		c216["bar22_baseline_gap_px"] = 800 - bottom // final baseline y=800 (620+180)
	}
	c4rSet(216, "before",
		fmt.Sprintf("原表帧位（before 证据）：仅 bar22 可见 %.2f（生长 198+18 帧处），bar23=%.3f bar24=%.3f，柱底悬空=%vpx（整柱中心 scaleIn）",
			b216_22, b216_23, b216_24, c216["bar22_baseline_gap_px"]),
		"round2 mismatch 的成因留档：原表 216 处 bar23（锚 F261）/bar24（锚 F303）尚未到锚——该行修正为 327 后此画面不再是期望")

	// -- F327 (row 216 -> 327): A-C04-01 executed at the corrected frame —
	//    three bars all visible and settled.
	c327 := recs[327].Checks
	c327["pan_shift_px"] = round2(c4rPanShift(327)) // -23.5
	r327_22 := c4rBarRect(180, 327)
	r327_23 := c4rBarRect(360, 327)
	r327_24 := c4rBarRect(540, 327)
	b327_22 := blue(img(327), r327_22)
	b327_23 := blue(img(327), r327_23)
	b327_24 := blue(img(327), r327_24)
	c327["bar22_blue_share"] = b327_22
	c327["bar23_blue_share"] = b327_23
	c327["bar24_blue_share"] = b327_24
	topsOK, topsDetail := true, ""
	if top, bottom, found := colorRowSpan(img(327), r327_22, 46, 134, 222, 22, 0.05); found {
		c327["bar22_top_row"], c327["bar22_bottom_row"] = top, bottom
		if absI(top-620) > 10 || 800-bottom > 2 {
			topsOK = false
		}
		topsDetail += fmt.Sprintf("bar22 top=%d bottom=%d ", top, bottom)
	} else {
		topsOK = false
	}
	if top, bottom, found := colorRowSpan(img(327), r327_23, 46, 134, 222, 22, 0.05); found {
		c327["bar23_top_row"], c327["bar23_bottom_row"] = top, bottom
		if absI(top-560) > 10 || 800-bottom > 2 {
			topsOK = false
		}
		topsDetail += fmt.Sprintf("bar23 top=%d bottom=%d ", top, bottom)
	} else {
		topsOK = false
	}
	if top, bottom, found := colorRowSpan(img(327), r327_24, 46, 134, 222, 22, 0.05); found {
		c327["bar24_top_row"], c327["bar24_bottom_row"] = top, bottom
		if absI(top-470) > 10 || 800-bottom > 2 {
			topsOK = false
		}
		topsDetail += fmt.Sprintf("bar24 top=%d bottom=%d ", top, bottom)
	} else {
		topsOK = false
	}
	monoOK := b327_22 >= 0.30 && b327_23 >= 0.30 && b327_24 >= 0.30
	if t24, ok := c327["bar24_top_row"].(int); ok {
		if t23, ok2 := c327["bar23_top_row"].(int); ok2 {
			if t22, ok3 := c327["bar22_top_row"].(int); ok3 {
				monoOK = monoOK && t24 < t23 && t23 < t22 // heights 330>240>180
			}
		}
	}
	c327["tops_detail"] = topsDetail
	if monoOK && topsOK {
		c4rSet(327, "ok",
			fmt.Sprintf("三柱全部可见（bar22=%.2f bar23=%.2f bar24=%.2f）且落定：%s——柱顶 620/560/470±10px、高度 180:240:330 单调、基线 y≈800",
				b327_22, b327_23, b327_24, topsDetail),
			"A-C04-01 改按修正帧 327 执行（算式 ceil(10.1×30)=303 + 24 帧落定）——round2 在原帧位 216 的 mismatch（仅 1/3 柱）由帧号修正解决",
			fmt.Sprintf("camera pan 进行至 %.1f%%（shift=%.1fpx），采样矩形已按位移跟踪", c4rPanShift(327)/-60*100, c4rPanShift(327)),
			"降级注记（照旧）：counter ef_bar24_cnt 窗口 303–339 内，数字 div 仍在画布 (0,0)（T-10 定位缺陷），柱顶金额标签省略")
	} else {
		c4rSet(327, "fail",
			fmt.Sprintf("三柱断言不成立 b22=%.3f b23=%.3f b24=%.3f topsOK=%v %s", b327_22, b327_23, b327_24, topsOK, topsDetail))
	}

	// -- F549 (row 540 -> 549): line draw onset. Progress 0 at the anchor.
	sh549 := blue(img(549), c4rLine)
	sh553 := blue(img(553), c4rLine)
	sh558 := blue(img(558), c4rLine)
	sh570 := blue(img(570), c4rLine)
	sh590 := blue(img(590), c4rLine)
	for _, sp := range []struct {
		f int
		v float64
	}{{553, sh553}, {558, sh558}, {570, sh570}, {590, sh590}} {
		recs[sp.f].Checks["line_blue_share"] = sp.v
	}
	recs[549].Checks["line_blue_share_at_anchor"] = sh549
	recs[549].Checks["probe_shares"] = map[string]float64{"f553": sh553, "f558": sh558, "f570": sh570, "f590": sh590}
	if sh549 <= 0.02 && sh558 >= 0.02 && sh590 >= 0.5 {
		c4rSet(549, "ok",
			fmt.Sprintf("折线 draw onset 锚帧成立：F549 蓝色 %.4f（progress 0），探针 F558=%.3f → F590=%.2f（60 帧 power1.out 淡入进行中，549+60=609 落定）", sh549, sh558, sh590),
			"词锚 ceil(18.3×30)=549（\"增速\"occ2）——原表 540 差 9 帧；el_note 同锚（18.3s→549），说明行此刻同步 onset")
	} else {
		c4rSet(549, "fail",
			fmt.Sprintf("折线 onset 与词锚 549 不符：F549=%.4f F558=%.4f F590=%.3f", sh549, sh558, sh590))
	}

	// -- F609 (row 720 -> 609): line period fully drawn. Degraded X series:
	//    still a solid 440x300 rectangle — marked, NOT counted as fail.
	sh609 := blue(img(609), c4rLine)
	recs[609].Checks["line_blue_share"] = sh609
	if sh609 >= 0.9 {
		c4rSet(609, "ok",
			fmt.Sprintf("折线区蓝色 %.2f——时段画面完整（549+60=609 落定帧）", sh609),
			"已知降级 X 系（标记不判败）：el_line 是 440×300 实心矩形 shape，非折线——三点几何丢失（C04-D1），A-C04-03 '点2 y 高于点1/点3' 区域几何无点可判，标签与纵轴刻度静态文本兜底未配置",
			"整线 scaleIn 后无逐段生长动画：'先点后线'节奏与口播 S4 不同步（照 round2 记录）")
	} else {
		c4rSet(609, "fail", fmt.Sprintf("折线区蓝色 %.3f < 0.9（落定帧应近满）", sh609))
	}

	// -- F720 (before evidence): the schema-orchestration frame the original
	//    table used; same static state as 609 (line settles and stays).
	c720 := recs[720].Checks
	sh720 := blue(img(720), c4rLine)
	c720["line_blue_share"] = sh720
	c720["mae_vs_f609_line"] = maeRect(img(720), img(609), c4rLine)
	c4rSet(720, "before",
		fmt.Sprintf("原表帧位（before 证据）：折线区蓝色 %.2f——与 F609 静态一致（线区 MAE=%.4f）；原 720 是目标 schema 24s 编排帧，词锚下 24.3s 仅对应\"不变价\"（与折线无锚定关系）",
			sh720, c720["mae_vs_f609_line"]),
		"修正价值在时间真值而非画面差：画面在 609 后静止，720 与 609 同画面——帧表改按 609 记录的是'何时完整'，不是'画面不同'")

	// -- F900 (before evidence): the cover candidate that round2 proved has
	//    no main figure — reproduced in this same render.
	c900 := recs[900].Checks
	a900 := amber(img(900), c4rRing)
	c900["ring_amber_share"] = a900
	c900["title_navy_share"] = navy(img(900), c4rTitle)
	c900["bar_zone_blue_share"] = blue(img(900), c4rBarZone)
	c4rSet(900, "before",
		fmt.Sprintf("原表帧位（before 证据）：环区橙色 %.4f——封面帧 900 不含主图（标题+三柱+实心矩形），round2 封面发现复现", a900),
		"环入场锚 ceil(30.3×30)=909——900 早于锚 9 帧；修正见 F909/F939")

	// -- F909 (row 900 -> 909): ring entrance onset at the corrected anchor.
	sh909 := amber(img(909), c4rRing)
	sh915 := amber(img(915), c4rRing)
	sh923 := amber(img(923), c4rRing)
	sh931 := amber(img(931), c4rRing)
	sh939 := amber(img(939), c4rRing)
	for _, sp := range []struct {
		f int
		v float64
	}{{915, sh915}, {923, sh923}, {931, sh931}} {
		recs[sp.f].Checks["ring_amber_share"] = sp.v
	}
	recs[909].Checks["ring_amber_share_at_anchor"] = sh909
	recs[909].Checks["probe_shares"] = map[string]float64{"f915": sh915, "f923": sh923, "f931": sh931}
	recs[909].Checks["ring_settled_share_f939"] = sh939
	if sh909 <= 0.02 && sh915 >= 0.05 && sh939 >= 0.9 {
		c4rSet(909, "ok",
			fmt.Sprintf("环入场 onset 锚帧成立：F909 橙色 %.4f（progress 0），探针 F915=%.2f → F931=%.2f（30 帧 power3.out scaleIn），F939=%.2f 落定", sh909, sh915, sh931, sh939),
			"封面修正闭环：原表 900 不含主图的发现（round2）由帧号修正解决——入场锚 909 与表格行对齐，'含主图的封面帧'语义落点 = 939（909+30 落定）",
			"降级注记（照旧 C04-D7）：环为整圆单色 #F5A623，无 56.7/43.3 扇区划分")
	} else {
		c4rSet(909, "fail",
			fmt.Sprintf("环 onset 与词锚 909 不符：F909=%.4f F915=%.4f F939=%.3f", sh909, sh915, sh939))
	}

	// -- F939: corrected cover-ready frame (kept keyframe companion).
	recs[939].Checks["ring_amber_share"] = sh939
	num939 := navy(img(939), c4rRingNum)
	recs[939].Checks["ring_num_navy_share"] = num939
	recs[939].Formula = "909+30=939 — an_ring_in 落定帧（封面语义落点）"
	recs[939].Expect = "含主图的封面帧：环 + 环心数字完整可见"
	if sh939 >= 0.9 && num939 >= 0.01 {
		c4rSet(939, "ok",
			fmt.Sprintf("封面语义落点成立：环橙色 %.2f、环心数字 navy %.3f——F939 起封面才含主图", sh939, num939),
			"（修正帧位的伴生断言：把 round2 'M2 若要环入封面需取 F939+' 的建议坐实为帧表证据）")
	} else {
		c4rSet(939, "fail", fmt.Sprintf("F939 环/数字缺失 amber=%.3f num=%.4f", sh939, num939))
	}

	// -- F957 (row 960 -> 957): counter window opens at the corrected anchor.
	ink957 := inkOf(img(957), c4rCounter)
	ring957 := amber(img(957), c4rRing)
	num957 := navy(img(957), c4rRingNum)
	recs[957].Checks["counter_origin_ink_share"] = ink957
	recs[957].Checks["ring_amber_share"] = ring957
	recs[957].Checks["ring_num_navy_share"] = num957
	if ink957 >= 0.005 && ring957 >= 0.5 && num957 >= 0.01 {
		c4rSet(957, "ok",
			fmt.Sprintf("counter 窗口开启帧成立：origin ink=%.4f（值=from→%%）、环可见 amber=%.2f、环心数字 navy=%.3f", ink957, ring957, num957),
			"词锚 ceil(31.9×30)=957（\"五十六点七\"），窗口 = 957 + min(1.2s, 60−31.9s)=1.2s → 36 帧，至 F993",
			"降级注记（照旧）：counter div 固定画布 (0,0) 非环心（T-10），白字浅底可读性缺陷在 M2 配色项")
	} else {
		c4rSet(957, "fail",
			fmt.Sprintf("counter 开窗断言不成立 ink=%.4f ring=%.3f num=%.4f", ink957, ring957, num957))
	}

	// -- F960: D-01 persistence confirmation (task-mandated). A miss here is
	//    a REGRESSION and is reported immediately.
	ink960 := inkOf(img(960), c4rCounter)
	ring960 := amber(img(960), c4rRing)
	num960 := navy(img(960), c4rRingNum)
	recs[960].Checks["counter_origin_ink_share"] = ink960
	recs[960].Checks["ring_amber_share"] = ring960
	recs[960].Checks["ring_num_navy_share"] = num960
	recs[960].Checks["expected_digit_text"] = "9% (progress (960−957)/36=0.0833, power1.out→0.16, round(56.7×0.16)=9)"
	if ring960 >= 0.5 && num960 >= 0.01 && ink960 >= 0.005 {
		c4rSet(960, "ok",
			fmt.Sprintf("D-01 持续成立：counter 数字可见（origin ink=%.4f，期望滚动值 \"9%%\"）、环可见 amber=%.2f、环心数字 navy=%.3f", ink960, ring960, num960),
			"D-01（capx seekTimeline pause 双参 suppressEvents=false）round2/round3 已闭环，本轮在修正帧表语境下确认无回归")
	} else {
		recs[960].Status = "fail"
		recs[960].Actual = fmt.Sprintf("D-01 回归：counter 数字缺失（origin ink=%.4f）ring=%.3f num=%.4f", ink960, ring960, num960)
		t.Errorf("D-01 REGRESSION at F960: counter digits invisible (ink=%.4f) — seekTimeline pause suppressEvents state: %s (%s)", ink960, d01.State, d01.CallLn)
	}

	// -- F1269 (row 1260 -> 1269): three figures full-size, no highlight.
	c1269 := recs[1269].Checks
	c1269["pan_shift_px"] = round2(c4rPanShift(1269)) // -60 (pan ended F546)
	b1269_22 := blue(img(1269), c4rBarRect(180, 1269))
	b1269_23 := blue(img(1269), c4rBarRect(360, 1269))
	b1269_24 := blue(img(1269), c4rBarRect(540, 1269))
	l1269 := blue(img(1269), c4rLine)
	a1269 := amber(img(1269), c4rRing)
	ambOut1269 := shareNearOutside(img(1269), c4rFull, 245, 166, 35, 22, c4rRing, c4rRingNum)
	c1269["bar22_blue_share"] = b1269_22
	c1269["bar23_blue_share"] = b1269_23
	c1269["bar24_blue_share"] = b1269_24
	c1269["line_blue_share"] = l1269
	c1269["ring_amber_share"] = a1269
	c1269["full_frame_amber_share_excl_ring"] = ambOut1269
	if b1269_22 >= 0.30 && b1269_23 >= 0.30 && b1269_24 >= 0.30 && l1269 >= 0.9 && a1269 >= 0.9 && ambOut1269 < 0.005 {
		c4rSet(1269, "ok",
			fmt.Sprintf("三图同屏原尺寸（bars %.2f/%.2f/%.2f, line=%.2f, ring=%.2f）；无高亮活动（环外全帧 amber=%.4f）", b1269_22, b1269_23, b1269_24, l1269, a1269, ambOut1269),
			"修正行的口径：1269 是\"总量\"occ3 的词表节拍参考，无专属锚点动画——round2 在原帧位 1260 的 mismatch（帧表声称高亮触发，实际窗口 909–934 早已结束）由行口径修正解决",
			"降级注记（照旧）：镜5 60% 缩略未实现（无 group/镜头对象，三图保持原尺寸）；camera pan 已于 F546 结束，柱位 x=120/300/480")
	} else {
		c4rSet(1269, "fail",
			fmt.Sprintf("三图同屏断言不成立 b22=%.3f b23=%.3f b24=%.3f line=%.3f ring=%.3f ambOut=%.4f",
				b1269_22, b1269_23, b1269_24, l1269, a1269, ambOut1269))
	}

	// -- F1620 (row unchanged): A-C04-04 hard prompt stays degraded_na; the
	//    round2 measured 43.3% must reproduce within ±0.02.
	zone1620 := blue(img(1620), c4rBarZone)
	note1620 := gray(img(1620), c4rNote)
	recs[1620].Checks["bar_zone_blue_share"] = zone1620
	recs[1620].Checks["note_gray_share"] = note1620
	recs[1620].Checks["round2_measured"] = 0.4333
	recs[1620].Checks["consistency_band"] = "±0.02"
	recs[1620].Checks["consistent_with_round2"] = math.Abs(zone1620-0.4333) <= 0.02
	recs[1620].Checks["doc_assertion"] = "A-C04-04 柱图区蓝色像素 ≤2%"
	recs[1620].Formula = "无词锚，行不变（round3 §4.2.5）"
	if math.Abs(zone1620-0.4333) > 0.02 || note1620 < 0.005 {
		c4rSet(1620, "fail",
			fmt.Sprintf("与 round2 实测 43.3%% 不一致：本轮柱区蓝色 %.1f%%（band ±2pp）note=%.4f——渲染产物或布局发生漂移，需人工复核", zone1620*100, note1620))
	} else {
		recs[1620].Status = "degraded_na"
		recs[1620].Actual = fmt.Sprintf("柱图区蓝色 %.1f%%（≫2%% 阈值）——与 round2 实测 43.3%% 一致（±2pp 带内）；说明卡灰字可见 gray=%.4f", zone1620*100, note1620)
		recs[1620].Notes = []string{
			"A-C04-04 降级不适用（hard prompt，照 spec-audit 指示实测留档不判败）：无元素卸载（C04-D6），三图常驻 DOM 至片尾",
			"说明卡'覆盖'不成立（照旧）：el_note 是 900×40 灰字注释行（y830, z=10），不遮挡任何图",
			"一致性复核通过：同一降级 IR、同一渲染链路，54.0s 处柱区蓝色占比在 round2 实测 ±2pp 带内复现",
		}
		t.Logf("F1620 [degraded_na] %s", recs[1620].Actual)
	}

	// -- F1799 (tail unchanged): persistence.
	note1799 := gray(img(1799), c4rNote)
	zone1799 := blue(img(1799), c4rBarZone)
	ring1799 := amber(img(1799), c4rRing)
	recs[1799].Checks["note_gray_share"] = note1799
	recs[1799].Checks["bar_zone_blue_share"] = zone1799
	recs[1799].Checks["ring_amber_share"] = ring1799
	recs[1799].Checks["duration_frames_rendered"] = 1800
	if note1799 >= 0.005 && zone1799 >= 0.05 && ring1799 >= 0.5 {
		c4rSet(1799, "ok", "尾帧：说明卡保持、三图保持（无淡出，C04-D6）；DurationFrames=1800（ceil 单源）帧循环完整渲染",
			"BGM 淡出/loudnorm/amix 截断不属本链路（L1 still 无音轨；L2 已单独覆盖）")
	} else {
		c4rSet(1799, "fail", fmt.Sprintf("尾帧内容缺失 note=%.4f bars=%.3f ring=%.3f", note1799, zone1799, ring1799))
	}

	// ================= before/after comparison (one render, two positions) ===

	type c4rPairOut struct {
		Pair           string         `json:"pair"`
		OrigFrame      int            `json:"orig_frame"`
		CorrectedFrame int            `json:"corrected_frame"`
		Region         string         `json:"region"`
		Orig           map[string]any `json:"orig_metrics"`
		Corrected      map[string]any `json:"corrected_metrics"`
		MAE            float64        `json:"mae_region"`
		Verdict        string         `json:"verdict"`
	}
	bar := func(f int, base int) float64 { return blue(img(f), c4rBarRect(base, f)) }
	beforeAfter := []c4rPairOut{
		{
			Pair: "bars-three-visible", OrigFrame: 216, CorrectedFrame: 327,
			Region: "bar_zone per-bar rects (pan-shift tracked)",
			Orig: map[string]any{
				"bar22": bar(216, 180), "bar23": bar(216, 360), "bar24": bar(216, 540),
				"state": "仅 bar22 生长中（198+18/24 帧，中心 scaleIn 柱底悬空）；bar23 锚 F261、bar24 锚 F303 未到",
			},
			Corrected: map[string]any{
				"bar22": bar(327, 180), "bar23": bar(327, 360), "bar24": bar(327, 540),
				"tops":  fmt.Sprintf("%v/%v/%v", recs[327].Checks["bar22_top_row"], recs[327].Checks["bar23_top_row"], recs[327].Checks["bar24_top_row"]),
				"state": "三柱落定（末柱锚 303+24=327），柱顶 620/560/470±10px、高度 180:240:330 单调",
			},
			MAE:     maeRect(img(216), img(327), c4rBarZone),
			Verdict: "±111 修正的直接证据：同一渲染里 F216 是 1/3 柱（mismatch 成因），F327 才是'三柱全可见'——A-C04-01 换到 327 后成立。帧差主因是 bar23/bar24 的词锚（8.7s/10.1s）晚于原表编排帧",
		},
		{
			Pair: "line-settle-timing", OrigFrame: 720, CorrectedFrame: 609,
			Region: "line rect (800,360,440,300)",
			Orig: map[string]any{
				"blue_share": sh720, "state": "实心矩形完整（静止态）",
			},
			Corrected: map[string]any{
				"blue_share": sh609, "state": "实心矩形完整（549+60=609 刚落定）",
			},
			MAE:     maeRect(img(720), img(609), c4rLine),
			Verdict: "−111 修正的价值是时间真值：画面在 609 落定后静止，720 与 609 同画面（MAE≈0）——原 720 是目标 schema 24s 编排帧，词锚下与折线无锚定关系；帧表改按 609 记录'何时完整'。降级 X 系照旧：两者都是实心矩形，非折线（标记不判败）",
		},
		{
			Pair: "cover-figure-presence", OrigFrame: 900, CorrectedFrame: 939,
			Region: "ring rect (1380,380,280,280)",
			Orig: map[string]any{
				"amber_share": a900, "state": "无主图（环锚 909 未到 9 帧）——round2 封面发现复现",
			},
			Corrected: map[string]any{
				"amber_share": sh939, "ring_num_navy": num939,
				"state": "环落定 + 环心数字可见（909+30=939）——含主图的封面帧",
				"onset": fmt.Sprintf("F909 amber=%.4f（onset），F915=%.2f → F931=%.2f 生长序列", sh909, sh915, sh931),
			},
			MAE:     maeRect(img(900), img(939), c4rRing),
			Verdict: "封面修正的直接证据：同一渲染里 900 不含主图、939 含完整主图（MAE 大）——帧表行 900→909（入场锚对齐）+ 封面语义落点 939 把 round2 的发现收口成帧表条款",
		},
		{
			Pair: "counter-window-onset", OrigFrame: 960, CorrectedFrame: 957,
			Region: "counter origin rect (0,0,400,150)",
			Orig: map[string]any{
				"ink_share": ink960, "expected_text": "9%", "state": "窗口内第 3 帧（957 窗口开）——D-01 已修，数字滚动可见",
			},
			Corrected: map[string]any{
				"ink_share": ink957, "expected_text": "0%", "state": "窗口开启帧（ceil(31.9×30)=957）——onset 值=from",
			},
			MAE:     maeRect(img(960), img(957), c4rCounter),
			Verdict: "−3 修正的口径收口：原表 960 的注释本来就写了锚 957（推导坐实行），两帧位数字均可见（D-01 修复持续成立）——修正让表格行号与窗口 onset 严格一致，字幕语义'开始滚动'对应 957 而非 960",
		},
	}

	// ================= report + meta =================

	// corrected frame table with per-row verdicts
	type c4rRowOut struct {
		c4rRow
		Status string `json:"status"`
		Actual string `json:"actual"`
	}
	tableOut := make([]c4rRowOut, 0, len(c4rTable))
	for _, row := range c4rTable {
		out := c4rRowOut{c4rRow: row}
		if r := recs[row.Corrected]; r != nil && r.Status != "" {
			out.Status = r.Status
			out.Actual = r.Actual
		} else if row.Corrected == 549 {
			// onset rows keep their own record
			out.Status = recs[549].Status
			out.Actual = recs[549].Actual
		}
		tableOut = append(tableOut, out)
	}

	var nOK, nFail, nMismatch, nNA, nBefore, nProbe int
	for _, f := range keptList {
		switch recs[f].Status {
		case "ok":
			nOK++
		case "fail":
			nFail++
		case "mismatch":
			nMismatch++
		case "degraded_na":
			nNA++
		case "before":
			nBefore++
		case "probe":
			nProbe++
		}
	}
	allGreen := nFail == 0 && nMismatch == 0

	meta := map[string]any{
		"case":            "VS-C04 rerun (round3 corrected frame table)",
		"layer":           "L1",
		"run_id":          runID,
		"batch":           "4 / C04",
		"fps":             fpsC04,
		"duration_frames": 1800,
		"width":           1920,
		"height":          1080,
		"kept_frames":     keptList,
		"roles":           roleOf,
		"frame_basis":     "ceil(60s×30)=1800, videoapp.DurationFrames = 1800",
		"generated_at":    time.Now().Format(time.RFC3339),
		"chrome":          chromePath,
		"go":              runtime.Version(),
		"ir_source_file":  "example/internal/video/testdata/ir/c04.degraded.json",
		"ir_sha256":       irSHA,
		"render_total_ms": renderTotal.Milliseconds(),
		"render_mode":     "full 1800-frame loop（模式记录：与 round2 l1-c04 同模式，保证 before/after 对照在同一渲染产物内）；修正帧位 + 原帧位 + 探针共 25 帧留存",
		"d01_status":      d01.State,
		"notes":           "round3 口径统一（词锚 frame=ceil(word.start×fps)）后的 C04 帧表重跑——修正帧位断言 + before/after 对照",
	}
	metaBytes, _ := json.MarshalIndent(meta, "", "  ")
	if err := os.WriteFile(filepath.Join(goldenDir, "meta.json"), metaBytes, 0o644); err != nil {
		t.Fatalf("write meta.json: %v", err)
	}

	report := map[string]any{
		"case":      "VS-C04 rerun (round3 corrected frame table)",
		"batch":     "4 / C04",
		"run_id":    runID,
		"layer":     "L1",
		"all_green": allGreen,
		"basis": map[string]any{
			"clock":        "word anchor: frame = ceil(word.start × fps) — 案例库 §7.0（round3 裁定：词锚是全案例库唯一时钟；startFrame 需 IR 扩展落地后才能做第一时钟）",
			"table_source": "docs/plan-agent-video-studio-case-library-and-test-plan-2026-11-15.md §4.2.5 [口径 round2] 列 + docs/delivery-audit-video-studio-round3-2026-11-15.md §3（三条校准锚点全部复现）",
			"ir_source":    "example/internal/video/testdata/ir/c04.degraded.json",
			"ir_sha256":    irSHA,
		},
		"d01_status": map[string]any{
			"state":            d01.State,
			"detail":           d01.Detail,
			"checked_at":       time.Now().Format(time.RFC3339),
			"seek_pause_line":  d01.CallLn,
			"verdict_this_run": "F957（窗口 onset，值 \"0%\"）与 F960（滚动中，期望 \"9%\"）数字均可见——D-01 修复在修正帧表语境下持续成立；F960 不可见即回归（fail + 立即 error）",
		},
		"render_mode":        "full 1800-frame loop through real local headless chrome（模式自选记录：全循环，与 round2 同模式保证可比性）",
		"frame_table":        tableOut,
		"samples":            recsOut(recs, keptList, "sample"),
		"probes":             recsOut(recs, keptList, "probe"),
		"before_rows":        recsOut(recs, keptList, "before"),
		"before_after":       beforeAfter,
		"derivation_anchors": anchors,
		"anchor_resolutions": resJSON,
		"degradation_policy": map[string]string{
			"F609_solid_rect": "已知降级 X 系（C04-D1）：el_line 为实心矩形非折线——标记在 notes，不判败",
			"A-C04-04":        "hard prompt 降级不适用（C04-D6 无元素卸载）：round2 实测 43.3% 以 ±2pp 带复核一致性，偏差即 fail",
			"T-10_counter":    "counter div 固定画布 (0,0) 非环心：位置/可读性缺陷照旧记录，不影响'数字可见'判定（D-01 已修）",
			"C04-D7_ring":     "环为整圆单色圆角方块，无 56.7/43.3 扇区：照旧记录",
		},
		"totals": map[string]any{
			"frames_planned":      1800,
			"frames_rendered":     1800,
			"kept_frames":         len(keptList),
			"samples_ok":          nOK,
			"samples_fail":        nFail,
			"samples_mismatch":    nMismatch,
			"samples_degraded_na": nNA,
			"before_rows":         nBefore,
			"probe_rows":          nProbe,
			"all_green":           allGreen,
			"render_total_ms":     renderTotal.Milliseconds(),
			"render_ms_per_frame": round2(float64(renderTotal.Milliseconds()) / 1800),
			"render_wall_clock":   renderTotal.Round(time.Second).String(),
		},
		"artifacts": map[string]any{
			"golden_dir":    "example/internal/video/testdata/golden/c04-round3/",
			"meta_json":     "example/internal/video/testdata/golden/c04-round3/meta.json",
			"report_json":   "example/internal/video/testdata/c04-rerun-report.json",
			"golden_frames": fmt.Sprintf("frame-<NNN>.png × %d（修正帧位 198/327/549/609/909/939/957/1269/1620/1799 + 原帧位 216/720/900/960 + 探针）", len(keptList)),
		},
		"references": map[string]any{
			"round3_doc":     "docs/delivery-audit-video-studio-round3-2026-11-15.md §3（锚点口径统一）/ §8 第 4 批入口 2",
			"case_library":   "docs/plan-agent-video-studio-case-library-and-test-plan-2026-11-15.md §4.2.5（[口径 round2] 回填列）/ §7.0（时钟裁定）",
			"round2_harness": "example/internal/video/testdata/c04_c06_render_test.go（同模式；其 l1-c04-report.json 为 before 侧基线）",
			"round2_report":  "example/internal/video/testdata/l1-c04-report.json",
		},
	}
	repBytes, _ := json.MarshalIndent(report, "", "  ")
	reportPath := filepath.Join(baseDir, "c04-rerun-report.json")
	if err := os.WriteFile(reportPath, repBytes, 0o644); err != nil {
		t.Fatalf("write report: %v", err)
	}

	t.Logf("VERDICT: ok=%d mismatch=%d fail=%d degraded_na=%d before=%d probe=%d all_green=%v (report: %s)",
		nOK, nMismatch, nFail, nNA, nBefore, nProbe, allGreen, "testdata/c04-rerun-report.json")
	if nFail > 0 {
		t.Errorf("C04 rerun: %d corrected-position assertion(s) failed (see %s)", nFail, reportPath)
	}
	if nMismatch > 0 {
		t.Errorf("C04 rerun: %d mismatch(es) — 口径统一后不应再有表实分歧（见 %s）", nMismatch, reportPath)
	}
}

// recsOut = ordered records of one role class ("sample" covers corrected +
// before keyframes with non-probe status; "probe"/"before" filter too).
func recsOut(recs map[int]*c4rRec, keptList []int, class string) []c4rRec {
	out := []c4rRec{}
	for _, f := range keptList {
		r := recs[f]
		switch class {
		case "probe":
			if r.Role == "probe" {
				out = append(out, *r)
			}
		case "before":
			if r.Role == "before" {
				out = append(out, *r)
			}
		default:
			if r.Role != "probe" {
				out = append(out, *r)
			}
		}
	}
	return out
}
