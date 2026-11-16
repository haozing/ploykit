//go:build capx

package l1

// Batch-6 L1 render part a: VS-C02 (品牌发布 TVC), VS-C03 (知识科普),
// VS-C05 (旅行步行线). Reuses the shared runCase harness from
// c04_c06_render_test.go (caseCfg + Assets data-URI hook + pixel helpers);
// this file only adds the asset set for C02/C05's image elements and the
// three case post callbacks.
//
// Round5 capabilities under test (first L1 showcase on these three cases):
//   - P0-1 element time windows: C02 场景切换 (scene1 200-261 → scene2 262-449
//     hard cut) and the lightbar 0-74 sweep-out; C03 光谱六条 6-frame stagger
//     (135/141/147/153/159/165); C05 photo1/photo2 switch (0-329/330-899) and
//     图解退场 719/边界 720. Probes pin background→element→background on every
//     phase boundary; any leak (element pixels outside [startFrame,endFrame))
//     fails the run.
//   - Element-level effects: C02 ef_logo_pulse→el_logo (pulse scale on the
//     logo node, border-strip geometry), C03 ef_pulse_dot→el_molecules
//     (out-of-bbox strip grows during the pulse window).
//   - T-12 text-color highlights: C03 ef_hl_blue→el_title (#4D96FF, word 蓝色
//     0.86-1.18s→F26-F36 window), C03 ef_hl_cross→el_note (#FFD54A, 分子
//     11.1-11.46s→F333-F344), C05 ef_hl_maple→el_title (#C8553D, 红叶
//     0.85-1.15s→F26-F35) — highlight share must rise inside the word window
//     and fall back after.
//   - Element-level fade: C05 ef_fade_bars→el_bar_top (opacity 1→0.9 at F768:
//     the bar's sampled color must shift toward the photo2 stand-in behind it).
//   - C05 ef_pulse_frame→el_vig_top fires at F181 while the vignette window
//     (330-719) is still CLOSED — the frames table records this doc-internal
//     timing contradiction ("窗口前无效"); probes prove zero pixels.
//
// Image assets: C02 (product/scene1/scene2/logo) and C05 (photo1/photo2) have
// image elements. The headless document has no network (capx network lock)
// and the player is fail-closed on img.decode, so every key resolves to a
// solid-color stand-in via the shared Assets hook — each with its own hue,
// chosen far from the case background so window probes can attribute pixels.
// Bitmap content itself is L2/L3 scope.
//
// immediateRender semantics (batch-2 finding, applies here): a scaleIn's
// fromTo applies its from-value at build time, so a windowed element whose
// entrance anchor is LATER than its window-open frame stays invisible
// (scale=0) between window-open and anchor — e.g. C03 band1 window opens 135
// but its scaleIn anchors 白光@F144: probes pin exactly where pixels start.
// C05 el_vig_* (window 330, anchor 通天桥 F348) and C03 el_bar_blue (window
// 735, anchor 蓝光 F762) are the frames.json-vs-render reading conflicts the
// probes arbitrate pixel-side.
//
// Run: go -C example test -tags capx ./internal/video/testdata -run TestL1RenderBatch6a -v -timeout 30m

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"strings"
	"testing"

	"github.com/haozing/ploykit/platform/storagex"
)

// ---- batch-6a synthetic image assets (per-key solid-color stand-ins) ----

// solidColorPNG renders a fully-opaque w x h solid-color PNG (own copy —
// self-contained by coordination decision, not shared with other files).
func solidColorPNG(w, h int, c color.RGBA) []byte {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.SetRGBA(x, y, c)
		}
	}
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}

var b6aImageServed int

// b6aAssets resolves each degraded-IR image key to its solid stand-in.
// Unknown keys error (fail-closed, mirroring storage misses).
func b6aAssets(_ context.Context, key string) (io.ReadCloser, storagex.Object, error) {
	// C02: product hero (blue-gray, distinct from bg #0E1320 and scenes),
	// scene1 metro (warm), scene2 desk (green) — scene1 vs scene2 hue-separated
	// so the 261→262 hard cut flips the sampled color entirely. logo reuses the
	// product key (same as the IR does).
	// C05: photo1 path (warm brick), photo2 bridge (sage green) — chosen so the
	// fade blend (0.9*bar + 0.1*photo2) shifts the bar color measurably and the
	// gold path line (#D9A441) stays distinct from both. Standins are 54x96
	// (9:16, the C05 canvas aspect): the player's img rule uses
	// object-fit:contain, so a 4:3 standin would letterbox inside the
	// 1080x1920 frame (visible band y555-1365 only, black stage around it) and
	// break the full-bleed photo/window/fade probes.
	colors := map[string]color.RGBA{
		"video/c02/product-hero.png":       {0x3A, 0x4E, 0x6E, 0xFF},
		"video/c02/scene-metro.jpg":        {0xC5, 0x6A, 0x4A, 0xFF},
		"video/c02/scene-desk.jpg":         {0x6E, 0x8F, 0x5A, 0xFF},
		"video/vs-c05/as_photo_path.jpg":   {0xC9, 0xB4, 0x7E, 0xFF},
		"video/vs-c05/as_photo_bridge.jpg": {0x7F, 0xA0, 0x5A, 0xFF},
	}
	c, ok := colors[key]
	if !ok {
		return nil, storagex.Object{}, fmt.Errorf("no synthetic batch-6a asset for key %q", key)
	}
	// C05 photos get 9:16 standins (full-bleed under object-fit:contain);
	// C02 images keep 4:3 — their probes sample inside the contained band.
	png := solidColorPNG(64, 48, c)
	if strings.HasPrefix(key, "video/vs-c05/") {
		png = solidColorPNG(54, 96, c)
	}
	b6aImageServed++
	return io.NopCloser(bytes.NewReader(png)),
		storagex.Object{Key: key, ContentType: "image/png", Size: int64(len(png))}, nil
}

// =====================================================================
// VS-C02 — 品牌发布 AURA One TVC（1920x1080@25, 750 frames, 30s）
// =====================================================================

// region rects (x, y, w, h); insets keep anti-aliased edges out.
var (
	c2RLightbar = [4]int{812, 432, 96, 216}  // lightbar #7BE3FF inset from (800,420,120,240)
	c2RSlogan   = [4]int{140, 400, 740, 120} // slogan_en text zone (y380..540)
	c2RScene1   = [4]int{640, 300, 400, 300} // scene bbox interior (120,160,1680,560);避开 product 重叠行 y>720 之下的说法不成立——场景 y160..720 盖住产品上段，取样区取场景中部
	c2RScene2   = [4]int{640, 300, 400, 300} // same rect: scene1/scene2 share the bbox (z-switch)
	c2RBelowScr = [4]int{660, 300, 360, 260} // inset for window probes
	c2RStrip    = [4]int{130, 830, 460, 100} // stats strip left column (120,760,1680,180), away from product x960+
	c2RStat1    = [4]int{140, 800, 400, 120} // stat1 text zone
	c2RLogoIn   = [4]int{766, 426, 60, 228}  // left inside-strip of logo bbox (760,420,400,240)
	c2RLogoOut  = [4]int{744, 426, 12, 228}  // left outside-strip (bg) — pulse must not touch
	c2RLogoPct  = [4]int{860, 520, 200, 60}  // logo center region (pulse geometry coarse check)
	c2RDate     = [4]int{580, 706, 760, 48}  // date text zone (560,700,800,60)
	c2RFull     = [4]int{0, 0, 1920, 1080}
)

func TestL1RenderBatch6a_C02(t *testing.T) {
	runCase(t, &caseCfg{
		caseID: "VS-C02",
		Assets: b6aAssets,
		irFile: "c02.degraded.json", framesFile: "c02.frames.json",
		goldenSub: "c02", reportFile: "l1-c02-report.json",
		fps: 25, width: 1920, height: 1080, durationFrames: 750,
		keyframes: []int{0, 37, 75, 95, 200, 217, 262, 325, 450, 455, 618, 675, 749},
		probes: []probeSpec{
			// lightbar window [0,74): close probe pair
			{70, "lightbar-open-last"}, {76, "lightbar-closed"},
			// scene1 window [200,261): open boundary + settled + open-last
			{198, "scene1-window-pre"}, {205, "scene1-window-open-scalein-pending"},
			{215, "scene1-growing"}, {240, "scene1-settled"}, {259, "scene1-open-last"},
			// scene2 window [262,449): hard cut + close into stats-window overlap
			{263, "scene2-window-open"}, {447, "scene2-open-last"}, {452, "scene2-closed-logo-window"},
			// stats strip window [325,449): boundary + strip-color diagnosis series
			{323, "stats-window-pre"}, {327, "stats-window-open"},
			{334, "stats-strip-tol14"}, {360, "stats-strip-settled-mid"}, {430, "stats-strip-late"},
			// date visibility diagnosis (anchor-boundary + tail)
			{640, "date-settled"}, {700, "date-late"},
			// pulse window on el_logo (anchor AURA F450, rise 4.5f peak ≈F455)
			{452, "pulse-rise"}, {455, "pulse-peak"}, {458, "pulse-fall"}, {467, "pulse-settled"},
		},
		post: c02Post,
	})
}

func c02Post(cx *caseCtx) {
	t := cx.t
	img := func(f int) image.Image { return cx.imgs[f] }
	bgDark := func(i image.Image, r [4]int) float64 { return shareNear(i, r, 0x0E, 0x13, 0x20, 14) }
	cyan := func(i image.Image, r [4]int) float64 { return shareNear(i, r, 0x7B, 0xE3, 0xFF, 22) }
	prod := func(i image.Image, r [4]int) float64 { return shareNear(i, r, 0x3A, 0x4E, 0x6E, 20) }
	scene1 := func(i image.Image, r [4]int) float64 { return shareNear(i, r, 0xC5, 0x6A, 0x4A, 20) }
	scene2 := func(i image.Image, r [4]int) float64 { return shareNear(i, r, 0x6E, 0x8F, 0x5A, 20) }
	strip := func(i image.Image, r [4]int) float64 { return shareNear(i, r, 0x16, 0x20, 0x2E, 6) }   // tight: strip vs bg distance (8,13,14) keeps bg out at tol 6
	textFF := func(i image.Image, r [4]int) float64 { return shareNear(i, r, 0xF5, 0xF8, 0xFF, 12) } // #F5F8FF bright text (white_ratio's >=250 threshold misses it)
	textC9 := func(i image.Image, r [4]int) float64 { return shareNear(i, r, 0xC9, 0xD6, 0xE8, 18) } // #C9D6E8 softer text
	leak := func(label string, f int, measured string) {
		cx.hardPrompts = append(cx.hardPrompts, map[string]any{
			"id": "P0-1_WINDOW_LEAK", "frame": f, "verdict": "fail",
			"measured": measured, "reason": label,
		})
		t.Errorf("WINDOW LEAK: %s at F%d — %s", label, f, measured)
	}

	// ---- lightbar window [0,74) — move sweep 800→1120 + close ----
	pl := cx.probeRecs[70]
	pl.StructureChecks["lightbar_cyan_at_70"] = cyan(img(70), c2RLightbar)
	// sweep: midpoint F37 keyframe asserts x∈[800,1120]; probe 70 → x≈1120 端点：
	// at F70 move progress 70/74 linear → x ≈ 800+320*0.946 ≈ 1103
	pl.StructureChecks["lightbar_cyan_at_shifted"] = cyan(img(70), [4]int{int(800+320*70/74) - 48, 432, 96, 216})
	pc := cx.probeRecs[76]
	pc.StructureChecks["lightbar_cyan_at_76"] = cyan(img(76), c2RLightbar)
	pc.StructureChecks["bg_dark_at_76"] = bgDark(img(76), c2RLightbar)
	if v := pc.StructureChecks["lightbar_cyan_at_76"].(float64); v > 0.01 {
		leak("lightbar visible after endFrame=74 (half-open close)", 76, fmt.Sprintf("cyan=%.4f", v))
	}

	// ---- scene1 window [200,261): open at 200, scaleIn anchored F204 ----
	pPre := cx.probeRecs[198]
	pPre.StructureChecks["scene1_share_pre"] = scene1(img(198), c2RScene1)
	pPre.StructureChecks["scene2_share_pre"] = scene2(img(198), c2RScene1)
	if v := pPre.StructureChecks["scene1_share_pre"].(float64); v > 0.01 {
		leak("scene1 visible before startFrame=200", 198, fmt.Sprintf("share=%.4f", v))
	}
	if v := pPre.StructureChecks["scene2_share_pre"].(float64); v > 0.01 {
		leak("scene2 visible before startFrame=262", 198, fmt.Sprintf("share=%.4f", v))
	}
	pOpen := cx.probeRecs[205]
	pOpen.StructureChecks["scene1_share"] = scene1(img(205), c2RScene1)
	pOpen.StructureChecks["window_math"] = "窗口 200 开（可见性恢复）+ an_scene1_in 锚 通勤地铁 F204 起播（fromTo immediateRender 使 200-203 保持 scale=0.92 from 值? 否——from=0.92 非零，但 visibility:hidden 挡住 200 前；200-203 窗口开而动画未播 → 0.92 缩放静帧可见）"
	pGrow := cx.probeRecs[215]
	pGrow.StructureChecks["scene1_share"] = scene1(img(215), c2RScene1)
	pSet := cx.probeRecs[240]
	pSet.StructureChecks["scene1_share"] = scene1(img(240), c2RScene1)
	pLast := cx.probeRecs[259]
	pLast.StructureChecks["scene1_share"] = scene1(img(259), c2RScene1)

	// ---- scene2 window [262,449): hard cut ----
	p2Open := cx.probeRecs[263]
	p2Open.StructureChecks["scene2_share"] = scene2(img(263), c2RScene2)
	p2Open.StructureChecks["scene1_share_gone"] = scene1(img(263), c2RScene2)
	if v := p2Open.StructureChecks["scene1_share_gone"].(float64); v > 0.01 {
		leak("scene1 visible after endFrame=261 (hard-cut close)", 263, fmt.Sprintf("share=%.4f", v))
	}
	p2Last := cx.probeRecs[447]
	p2Last.StructureChecks["scene2_share"] = scene2(img(447), c2RScene2)
	p2Gone := cx.probeRecs[452]
	p2Gone.StructureChecks["scene2_share"] = scene2(img(452), c2RScene2)
	if v := p2Gone.StructureChecks["scene2_share"].(float64); v > 0.01 {
		leak("scene2 visible after endFrame=449", 452, fmt.Sprintf("share=%.4f", v))
	}
	p2Gone.StructureChecks["logo_share"] = prod(img(452), c2RLogoIn)

	// ---- stats strip window [325,449) on left sub-rect (product-free zone) ----
	// pre-window check: the region must be pure BG (bg #0E1320 vs strip
	// #16202E sit within loose tolerance of each other, so "bg present" is the
	// discriminating pre-window signal, not "strip absent")
	p3Pre := cx.probeRecs[323]
	p3Pre.StructureChecks["bg_at_strip_pre"] = bgDark(img(323), c2RStrip)
	p3Pre.StructureChecks["stat1_text_pre"] = textFF(img(323), c2RStat1)
	if v := p3Pre.StructureChecks["bg_at_strip_pre"].(float64); v < 0.9 {
		leak("non-bg pixels in strip region before startFrame=325", 323, fmt.Sprintf("bg=%.4f", v))
	}
	if v := p3Pre.StructureChecks["stat1_text_pre"].(float64); v > 0.005 {
		leak("stat1 text visible before its anchor/window", 323, fmt.Sprintf("text=%.4f", v))
	}
	p3Open := cx.probeRecs[327]
	p3Open.StructureChecks["strip_share"] = strip(img(327), c2RStrip)
	p3Open.StructureChecks["strip_share_tol14"] = shareNear(img(327), c2RStrip, 0x16, 0x20, 0x2E, 14)
	p3Open.StructureChecks["bg_at_strip"] = bgDark(img(327), c2RStrip)
	p3Open.StructureChecks["stat1_text"] = textFF(img(327), c2RStat1)
	p3Open.StructureChecks["window_math"] = "窗口 325 开 + an_stats_in 锚 四十五 F325 同帧（scaleIn from=0 → 精确帧不可见，像素自 F326 起）；stat1 锚 续航 F334（immediateRender from=0 → 327 时仍 scale=0）"
	// strip shape presence diagnosis (run-2 finding: stat TEXT renders at F340
	// but the strip shape color #16202E never matched even at tol 6 — sample
	// the same rect at tol 14, bg share, and later frames to pin when/whether
	// the strip shape appears at all)
	for _, f := range []int{334, 360, 430} {
		pd := cx.probeRecs[f]
		pd.StructureChecks["strip_share"] = strip(img(f), c2RStrip)
		pd.StructureChecks["strip_share_tol14"] = shareNear(img(f), c2RStrip, 0x16, 0x20, 0x2E, 14)
		pd.StructureChecks["bg_at_strip"] = bgDark(img(f), c2RStrip)
		pd.StructureChecks["stat1_text"] = textFF(img(f), c2RStat1)
	}

	// ---- date visibility diagnosis (anchor-boundary + tail) ----
	for _, f := range []int{640, 700} {
		pdd := cx.probeRecs[f]
		pdd.StructureChecks["date_text"] = textC9(img(f), c2RDate)
		pdd.StructureChecks["date_ink"] = round4(1 - bgDark(img(f), c2RDate))
	}
	// ---- ef_logo_pulse (element-level, target el_logo): F450 锚, rise 0.18s →
	// peak ≈F455 (scale 1.06), fall 0.3s → settled ≈F467. Geometry probes:
	// inside-left strip turns product-color as the scaled logo grows leftward
	// past x=766 (1.06 scale → left edge 760-12=748); outside strip stays bg.
	// NOTE an_logo_in (scaleIn 24f back.out from=0) shares the scale axis —
	// builder overwrite:auto lets the pulse tween take over scale at F450, so
	// measured geometry tracks the pulse path, not the entrance path.
	pp := cx.probeRecs[455]
	for _, f := range []int{452, 455, 458, 467} {
		pp.StructureChecks[fmt.Sprintf("f%d_logo_in_strip", f)] = prod(img(f), c2RLogoIn)
		pp.StructureChecks[fmt.Sprintf("f%d_logo_out_strip_bg", f)] = bgDark(img(f), c2RLogoOut)
		pp.StructureChecks[fmt.Sprintf("f%d_logo_center", f)] = prod(img(f), c2RLogoPct)
	}

	// ---- keyframes ----
	// F0 — dark open: bg + product (scaleIn from=0.6 immediateRender → 0.6
	// 缩放可见) + lightbar (window open at 0, x=800 起点)。标语/场景/规格/Logo/
	// 日期窗口未开 → 全隐藏（P0-1 红利）。规格条 pre-window 判据用 bg_dark
	// （strip 色 #16202E 与 bg #0E1320 距离 (8,13,14)，tol 14 时 bg 本身就命中
	// strip 色——首跑 F0/F323 假泄漏即此），tight-strip 只用于窗口内验证。
	f0 := img(0)
	c0 := cx.keyRecs[0].StructureChecks
	c0["bg_dark_share"] = bgDark(f0, c2RFull)
	c0["lightbar_cyan"] = cyan(f0, c2RLightbar)
	c0["lightbar_bg"] = bgDark(f0, c2RLightbar)
	c0["slogan_text_share"] = textFF(f0, c2RSlogan)
	c0["scene1_pre_share"] = scene1(f0, c2RScene1)
	c0["bg_at_strip"] = bgDark(f0, c2RStrip)
	switch {
	case c0["slogan_text_share"].(float64) < 0.005 && c0["scene1_pre_share"].(float64) < 0.005 &&
		c0["bg_at_strip"].(float64) >= 0.9 && c0["lightbar_cyan"].(float64) >= 0.5:
		cx.set(0, "ok", "暗场开场：el_bg #0E1320 + 扫光条（窗口 0 开，x=800 起点）+ 产品 0.6 缩放占位（immediateRender from）；标语/场景/规格条窗口未开隐藏（标语区零墨、场景区零像素、规格条区=纯 bg）——P0-1 红利，文档 F0 '未入场'逐项对位",
			"A-C02-04 暗底基调成立（bg_dark 见 report totals）")
	case c0["lightbar_cyan"].(float64) < 0.5 && c0["lightbar_bg"].(float64) >= 0.5:
		cx.set(0, "mismatch", fmt.Sprintf("F0 扫光条区=纯 bg（cyan=%.4f）——窗口 [0,74) 在 t=0 的 visible set 未在精确帧 0 呈现（GSAP 零时长 set 于 seek(0) 的应用时机），F37 探针证明条带其余窗口期正常渲染——M2 复核帧 0 单点", c0["lightbar_cyan"]),
			"标语/场景/规格条窗口未开隐藏成立（本帧其余判据全部通过）")
	default:
		cx.set(0, "fail", fmt.Sprintf("F0 结构不符 checks=%v", c0))
	}

	// F37 — sweep midpoint: cyan centroid inside [800,1120] band
	f37 := img(37)
	c37 := cx.keyRecs[37].StructureChecks
	c37["lightbar_cyan_mid"] = cyan(f37, [4]int{912, 432, 96, 216})
	c37["lightbar_cyan_origin"] = cyan(f37, c2RLightbar)
	if c37["lightbar_cyan_mid"].(float64) >= 0.5 {
		cx.set(37, "ok", fmt.Sprintf("扫光中段 x≈960（mid-share %.2f）——move 74 帧线性 800→1120 的进度 0.5 位置成立（A-C02-01 青带重心窗口内）", c37["lightbar_cyan_mid"].(float64)))
	} else {
		cx.set(37, "fail", fmt.Sprintf("扫光中段位置不符 checks=%v", c37))
	}

	// F95 — slogan settled (computed BEFORE the F75 verdict: F75's boundary
	// branch reads this value)
	f95 := img(95)
	c95 := cx.keyRecs[95].StructureChecks
	c95["slogan_text_share"] = textFF(f95, c2RSlogan)

	// F75 — slogan/sub window opens (anchor Sound F75 same frame).
	// Run-2 measured: text=0 at the exact window-open frame (both the visible
	// set AND the entrance tween start at t=3.0), settled by F95. The rendered
	// boundary rule (run-2 finding, scene switch confirms it): the visible set
	// at t=frame/fps first RENDERS on the next frame — visible frames are
	// (startFrame, endFrame]. At exact-open frames the element is invisible.
	f75 := img(75)
	c75 := cx.keyRecs[75].StructureChecks
	c75["slogan_text_share"] = textFF(f75, c2RSlogan)
	c75["scene_pre_share"] = scene1(f75, c2RScene1)
	switch {
	case c75["slogan_text_share"].(float64) >= 0.01 && c75["scene_pre_share"].(float64) < 0.005:
		cx.set(75, "ok", fmt.Sprintf("镜 2 窗口开：标语/中文副标可见（text=%.4f，scaleIn 20 帧进行中）；场景窗口 200 未开 → 零像素（P0-1 窗口语义）", c75["slogan_text_share"].(float64)),
			"词锚双驱动自洽：窗口 75 = Sound 词起点 3.0s（帧表'两条时钟自洽'对位）")
	case c75["slogan_text_share"].(float64) < 0.005 && c75["scene_pre_share"].(float64) < 0.005 &&
		c95["slogan_text_share"].(float64) >= 0.01:
		cx.set(75, "mismatch", fmt.Sprintf("F75 精确开窗帧标语零墨（text=%.4f），F95 已落定（%.4f）——窗口可见 set 与入场锚同帧（t=3.0）时，精确帧上 set 尚未呈现：渲染边界规则 (startFrame, endFrame]（run-2 由场景切换 F262 双零 + F263 全显证实），可见帧从 76 起",
			c75["slogan_text_share"], c95["slogan_text_share"]),
			"帧表'镜 2 窗口开启@75'与渲染差 1 帧偏移——结构成立，M2 统一窗口边界口径")
	default:
		cx.set(75, "fail", fmt.Sprintf("F75 标语缺失或场景提前 checks=%v", c75))
	}

	// F95 — slogan settled verdict
	if c95["slogan_text_share"].(float64) >= 0.01 {
		cx.set(95, "ok", fmt.Sprintf("标语落定（text=%.4f，20/20 帧）；产品 scaleIn 40 帧档仍在进行（至 F115）——T-05 降级：伪 3D 侧转为平面缩放", c95["slogan_text_share"].(float64)))
	} else {
		cx.set(95, "fail", fmt.Sprintf("F95 标语缺失 checks=%v", c95))
	}

	// F200 — scene1 window opens (anchor F204 four frames later).
	// Run-2 measured share=0.0000 at the exact open frame (visible set first
	// renders F201 per the (start,end] boundary rule); probes carry the case.
	f200 := img(200)
	c200 := cx.keyRecs[200].StructureChecks
	c200["scene1_share_at_open"] = scene1(f200, c2RScene1)
	c200["probe_f205"] = cx.probeRecs[205].StructureChecks["scene1_share"]
	c200["probe_f215"] = cx.probeRecs[215].StructureChecks["scene1_share"]
	c200["probe_f240"] = cx.probeRecs[240].StructureChecks["scene1_share"]
	if c200["probe_f205"].(float64) > 0.02 && c200["probe_f240"].(float64) > 0.5 {
		cx.set(200, "ok", fmt.Sprintf("镜 3 窗口开（F200 精确帧 share=%.4f——开窗 set 于下一帧呈现，(start,end] 边界；F205=%.2f 可见，F240=%.2f 落定；scene1 from=0.92 → F201-203 以 0.92 缩放静帧可见）",
			c200["scene1_share_at_open"], c200["probe_f205"], c200["probe_f240"]),
			"P0-1 红利：scene2（窗口 262）在镜 3 期间完全隐藏——帧差断言'场景区色温切换'可直接判定")
	} else {
		cx.set(200, "fail", fmt.Sprintf("F200 场景窗口/入场序列不符 checks=%v", c200))
	}

	// F217 — mid-scene1 frame (frames.json: "场景 2 尚未入场（startFrame=262）；
	// 场景 1 scaleIn 进行中"——scene1 窗口 [200,261) 此时仍开着，scene2 未开)
	f217 := img(217)
	c217 := cx.keyRecs[217].StructureChecks
	c217["scene1_share"] = scene1(f217, c2RScene2)
	c217["scene2_share"] = scene2(f217, c2RScene2)
	c217["probe_f259_scene1"] = cx.probeRecs[259].StructureChecks["scene1_share"]
	c217["probe_f263_scene2"] = cx.probeRecs[263].StructureChecks["scene2_share"]
	c217["probe_f447_scene2"] = cx.probeRecs[447].StructureChecks["scene2_share"]
	c217["probe_f452_scene2"] = cx.probeRecs[452].StructureChecks["scene2_share"]
	if c217["scene1_share"].(float64) > 0.05 && c217["scene2_share"].(float64) < 0.01 &&
		c217["probe_f263_scene2"].(float64) > 0.05 && c217["probe_f452_scene2"].(float64) < 0.01 {
		cx.set(217, "ok", fmt.Sprintf("镜 3 末段（scene1=%.2f 仍在窗口 [200,261) 内，scene2 零像素——窗口 262 未开）；切换后窗口 262-449 全程可见至 F447（%.2f）、F452 关闭（%.4f）——P0-1 半开区间硬切干净（261→262 一帧翻转，T-07 叠化断言降级不适用）",
			c217["scene1_share"], c217["probe_f447_scene2"], c217["probe_f452_scene2"]),
			"帧表注记的锚/窗错位（an_scene2_in 锚 F217 早于窗口 262）：immediateRender 使 scene2 以 0.92 缩放静帧等待——262 窗口开时入场动画已过半，'无入场缩放过程'与帧表预判一致")
	} else {
		cx.set(217, "fail", fmt.Sprintf("F217 场景窗口状态不符 checks=%v", c217))
	}

	// F262 — the exact switch frame. Run-2 measured BOTH zero here (scene1
	// hide set applied at 262, scene2 show set first renders 263): the window
	// boundary renders as (startFrame, endFrame] — one-frame gap at hard cuts.
	f262 := img(262)
	c262 := cx.keyRecs[262].StructureChecks
	c262["scene2_share"] = scene2(f262, c2RScene2)
	c262["scene1_share"] = scene1(f262, c2RScene2)
	c262["probe_f263_scene2"] = cx.probeRecs[263].StructureChecks["scene2_share"]
	switch {
	case c262["scene2_share"].(float64) > 0.05 && c262["scene1_share"].(float64) < 0.01:
		cx.set(262, "ok", fmt.Sprintf("切换帧精确：scene2=%.2f / scene1=%.4f——endFrame 帧关闭、startFrame 帧开启（[start,end) 理想语义逐帧成立）", c262["scene2_share"], c262["scene1_share"]))
	case c262["scene1_share"].(float64) < 0.01 && c262["scene2_share"].(float64) < 0.01 &&
		c262["probe_f263_scene2"].(float64) > 0.05:
		cx.set(262, "mismatch", fmt.Sprintf("切换帧双零（scene1=%.4f scene2=%.4f）而 F263 scene2=%.2f——渲染边界规则 (startFrame, endFrame]：hide set 于 endFrame+1 帧生效、show set 于 startFrame+1 帧生效，硬切存在 1 帧空隙（F262 全 bg）",
			c262["scene1_share"], c262["scene2_share"], c262["probe_f263_scene2"]),
			"P0-1 边界渲染发现（新）：帧表 261→262 一帧翻转的理想语义与渲染差 1 帧——结构成立（无泄漏、无叠影），M2 统一窗口边界口径；C03/C05 同规则适用")
	default:
		cx.set(262, "fail", fmt.Sprintf("F262 切换帧不符 checks=%v", c262))
	}

	// F325 — stats strip window + anchors.
	// Run-2 measured: region pure bg at F323 ✓; F327 strip=0 at tol 6 AND 14
	// (both stored), yet stat1 TEXT visible by F340 (0.0094) — the text (z7)
	// renders while the strip SHAPE (z6) contributes no strip-colored pixels.
	// Diagnosis probes (334/360/430) carry tol14/bg/text series; verdict
	// branches on whether the strip color ever appears.
	f325 := img(325)
	c325 := cx.keyRecs[325].StructureChecks
	c325["strip_share"] = strip(f325, c2RStrip)
	c325["probe_f323_bg"] = cx.probeRecs[323].StructureChecks["bg_at_strip_pre"]
	c325["probe_f323_text"] = cx.probeRecs[323].StructureChecks["stat1_text_pre"]
	c325["probe_f327_strip"] = cx.probeRecs[327].StructureChecks["strip_share"]
	c325["probe_f327_tol14"] = cx.probeRecs[327].StructureChecks["strip_share_tol14"]
	c325["probe_f327_bg"] = cx.probeRecs[327].StructureChecks["bg_at_strip"]
	c325["probe_f334_strip"] = cx.probeRecs[334].StructureChecks["strip_share"]
	c325["probe_f360_strip"] = cx.probeRecs[360].StructureChecks["strip_share"]
	c325["probe_f360_tol14"] = cx.probeRecs[360].StructureChecks["strip_share_tol14"]
	c325["probe_f360_text"] = cx.probeRecs[360].StructureChecks["stat1_text"]
	c325["probe_f430_strip"] = cx.probeRecs[430].StructureChecks["strip_share"]
	c325["probe_f430_text"] = cx.probeRecs[430].StructureChecks["stat1_text"]
	stripEver := c325["probe_f327_strip"].(float64) > 0.05 || c325["probe_f334_strip"].(float64) > 0.05 ||
		c325["probe_f360_strip"].(float64) > 0.05 || c325["probe_f430_strip"].(float64) > 0.05
	textEver := c325["probe_f360_text"].(float64) > 0.005 || c325["probe_f430_text"].(float64) > 0.005
	switch {
	case stripEver && textEver:
		cx.set(325, "mismatch",
			fmt.Sprintf("镜 4 规格条窗口 325 开（F323 pre=纯 bg %.4f/零文本；strip 序列 F327=%.2f F334=%.2f F360=%.2f F430=%.2f；stat text F360=%.4f F430=%.4f）——strip+文本窗口期可见；F325 精确帧=%.4f（同帧 scaleIn 锚 from=0，像素自 F326 起）",
				c325["probe_f323_bg"], c325["probe_f327_strip"], c325["probe_f334_strip"], c325["probe_f360_strip"], c325["probe_f430_strip"],
				c325["probe_f360_text"], c325["probe_f430_text"], c325["strip_share"]),
			"帧表 A-C02-02：三列文本独立 text（T-02 降级拆分），词锚错峰 immediateRender 锚前 scale=0——列依次浮现节奏保留")
	case !stripEver && textEver:
		cx.set(325, "mismatch",
			fmt.Sprintf("镜 4：stat 文本可见（F360=%.4f F430=%.4f）但 strip 底板色 #16202E 在整个窗口期零命中（F327 tol6=%.4f tol14=%.4f bg=%.4f；F334=%.4f F360 tol6/tol14=%.4f/%.4f F430=%.4f）——el_stats_strip shape 未以声明色呈现（抽帧像素数据如上，P0-1/投影管线候选缺陷，M2 复核：shape 色未渲染或被同 bbox 元素覆盖）",
				c325["probe_f360_text"], c325["probe_f430_text"],
				c325["probe_f327_strip"], c325["probe_f327_tol14"], c325["probe_f327_bg"],
				c325["probe_f334_strip"], c325["probe_f360_strip"], c325["probe_f360_tol14"], c325["probe_f430_strip"]),
			"窗口机制本身工作正常（pre-window 纯 bg ✓、文本窗口期出现 ✓）——仅 strip 底板色缺失，结构部分成立")
	default:
		cx.set(325, "fail", fmt.Sprintf("F325 规格条窗口不符 checks=%v", c325))
	}

	// F450 — logo window + pulse start
	// (all pulse keys live on probeRecs[455]'s record — the loop stored the
	// whole 452/455/458/467 series there)
	c450 := cx.keyRecs[450].StructureChecks
	c450["probe_f452_in"] = cx.probeRecs[455].StructureChecks["f452_logo_in_strip"]
	c450["probe_f455_in"] = cx.probeRecs[455].StructureChecks["f455_logo_in_strip"]
	c450["probe_f458_in"] = cx.probeRecs[455].StructureChecks["f458_logo_in_strip"]
	c450["probe_f467_in"] = cx.probeRecs[455].StructureChecks["f467_logo_in_strip"]
	c450["probe_f455_out_bg"] = cx.probeRecs[455].StructureChecks["f455_logo_out_strip_bg"]
	c450["scene2_gone"] = cx.probeRecs[452].StructureChecks["scene2_share"]
	if c450["probe_f455_in"].(float64) > 0.02 && c450["probe_f455_out_bg"].(float64) > 0.5 && c450["scene2_gone"].(float64) < 0.01 {
		cx.set(450, "ok", fmt.Sprintf("镜 5 Logo 窗口 450 开 + ef_logo_pulse 元素级首拍（锚 AURA F450）：pulse 几何探针 in-strip F452=%.4f→F455=%.4f→F458=%.4f→F467=%.4f（1.06 缩放左缘越过 x=766 的扫描带），out-strip 保持 bg=%.2f——脉冲只作用于 Logo 节点（round4 元素级红利实证；批 2 同位置 pulse 作用于整画布）",
			c450["probe_f452_in"], c450["probe_f455_in"], c450["probe_f458_in"], c450["probe_f467_in"], c450["probe_f455_out_bg"]),
			"an_logo_in（scaleIn from=0）与 pulse 同轴：builder overwrite:auto 下 pulse 于 F450 接管 scale——几何路径按 pulse 走（记录，不判缺陷）")
	} else {
		cx.set(450, "fail", fmt.Sprintf("F450 Logo/pulse 几何不符 checks=%v", c450))
	}

	// F455 — pulse peak keyframe verdict
	c455 := cx.keyRecs[455].StructureChecks
	c455["logo_in_strip"] = cx.probeRecs[455].StructureChecks["f455_logo_in_strip"]
	c455["logo_center"] = cx.probeRecs[455].StructureChecks["f455_logo_center"]
	if c455["logo_center"].(float64) > 0.3 {
		cx.set(455, "ok", fmt.Sprintf("pulse 峰值帧（450+ceil(0.18s×25)=455）：Logo 实体可见（center=%.2f，64×48 实心占位非真 Logo——素材降级）", c455["logo_center"].(float64)),
			"A-C02-03 按元素级判定：el_logo bbox 内缩放呼吸成立；文档 F474 观测位在第二拍回落段，帧差窗口 [450,470] 由探针序列承载")
	} else {
		cx.set(455, "fail", fmt.Sprintf("F455 pulse 峰值 Logo 缺失 checks=%v", c455))
	}

	// F618 — date window (600) + anchor (618, from=0 → invisible at the exact
	// anchor frame). Diagnosis probes 640/700 carry text+ink series for the
	// tail verdicts.
	f618 := img(618)
	c618 := cx.keyRecs[618].StructureChecks
	c618["date_text"] = textC9(f618, c2RDate)
	c618["date_ink"] = round4(1 - bgDark(f618, c2RDate))
	c618["probe_f640_text"] = cx.probeRecs[640].StructureChecks["date_text"]
	c618["probe_f640_ink"] = cx.probeRecs[640].StructureChecks["date_ink"]
	c618["probe_f700_text"] = cx.probeRecs[700].StructureChecks["date_text"]
	c618["probe_f700_ink"] = cx.probeRecs[700].StructureChecks["date_ink"]
	c618["logo_center"] = prod(f618, c2RLogoPct)
	dateEver := c618["probe_f640_text"].(float64) > 0.005 || c618["probe_f700_text"].(float64) > 0.005 ||
		c618["probe_f640_ink"].(float64) > 0.02 || c618["probe_f700_ink"].(float64) > 0.02
	if dateEver && c618["logo_center"].(float64) > 0.3 {
		cx.set(618, "mismatch", fmt.Sprintf("镜 6 日期落版：F618 精确锚帧 date 零墨（text=%.4f ink=%.4f——an_date_in 锚 十一月二十二日 F618 from=0 同帧 scale=0），但诊断探针 F640 text=%.4f/ink=%.4f、F700 text=%.4f/ink=%.4f——日期在窗口期可见（可见帧自 619 起）；Logo 保持居中框（center=%.2f）",
			c618["date_text"], c618["date_ink"], c618["probe_f640_text"], c618["probe_f640_ink"], c618["probe_f700_text"], c618["probe_f700_ink"], c618["logo_center"]),
			"降级注记：dateText/dateY/dateColor 复合键不可消费（⛔）——日期拆独立 text；重复词 AURA 用 occurrence=0/1 区分（w15/w19）")
	} else {
		cx.set(618, "fail", fmt.Sprintf("F618 日期全程缺失或 Logo 缺失 checks=%v", c618))
	}

	// F675 — hold frame
	f675 := img(675)
	c675 := cx.keyRecs[675].StructureChecks
	c675["date_text"] = textC9(f675, c2RDate)
	c675["date_ink"] = round4(1 - bgDark(f675, c2RDate))
	c675["logo_center"] = prod(f675, c2RLogoPct)
	if (c675["date_text"].(float64) >= 0.005 || c675["date_ink"].(float64) > 0.02) && c675["logo_center"].(float64) > 0.3 {
		cx.set(675, "ok", "落版保持帧：Logo + 日期同屏；BGM 卡点降级（T-13 ⛔ 无 beat 轨道）——动画锚全挂词时间戳，帧号与 92 BPM 对位留 L2 人工核验")
	} else {
		cx.set(675, "fail", fmt.Sprintf("F675 保持帧缺失 checks=%v", c675))
	}

	// F749 — tail
	f749 := img(749)
	c749 := cx.keyRecs[749].StructureChecks
	c749["date_text"] = textC9(f749, c2RDate)
	c749["date_ink"] = round4(1 - bgDark(f749, c2RDate))
	c749["logo_center"] = prod(f749, c2RLogoPct)
	c749["duration_frames_rendered"] = 750
	if (c749["date_text"].(float64) >= 0.005 || c749["date_ink"].(float64) > 0.02) && c749["logo_center"].(float64) > 0.3 {
		cx.set(749, "ok", "尾帧：Logo（窗口 450-749 含尾帧）+ 日期可见；DurationFrames=ceil(30×25)=750 帧循环完整",
			"F735 整片轻 fade 不可实现（fade 是遮罩语义；P0-2 fadeIn/fadeOut 是元素级——本轮不采用）；BGM 无淡出/loop/loudnorm（amix duration=first 截断）——L2 口径",
			"el_caption 空 text 占位（字幕由 RenderParams.SubtitleMode=hard 烧录路径注入，不在 Player DOM）")
	} else {
		cx.set(749, "mismatch", fmt.Sprintf("尾帧 date 探针：text=%.4f ink=%.4f logo=%.2f——date 文本采样弱/未中（F675 对照），Logo 尾帧保持；尾帧判定降为结构保持（窗口 [600,749] 含 749，无退场动画）——抽帧数据留档 M2 复核",
			c749["date_text"], c749["date_ink"], c749["logo_center"]))
	}
}

// =====================================================================
// VS-C03 — 知识科普：天空为什么是蓝色（1080x1920@30, 1350 frames, 45s）
// =====================================================================

var (
	c3RSun     = [4]int{130, 130, 160, 160} // sun #FFE9A8 inset (120,120,180,180)
	c3RTitle   = [4]int{92, 250, 896, 70}   // title text zone (72,240,936,90)
	c3RBand1   = [4]int{160, 640, 80, 80}   // band rects inset 20 from (x,620,120,120)
	c3RBand2   = [4]int{286, 640, 80, 80}
	c3RBand3   = [4]int{412, 640, 80, 80}
	c3RBand4   = [4]int{538, 640, 80, 80}
	c3RBand5   = [4]int{664, 640, 80, 80}
	c3RBand6   = [4]int{790, 640, 80, 80}
	c3RMolTop  = [4]int{250, 806, 580, 10}  // strip ABOVE molecules bbox (240,820,600,300) — pulse 1.12 pushes top edge to ≈y802
	c3RMolBody = [4]int{300, 900, 480, 200} // molecules body interior
	c3RFormula = [4]int{160, 710, 760, 60}  // formula text zone (140,700,800,80)
	c3RBarRed  = [4]int{320, 1095, 140, 30} // bar_red lower interior (300,1080,180,60)
	c3RBarBlue = [4]int{620, 1080, 140, 40} // bar_blue lower interior (600,1000,180,140)
	c3RNote    = [4]int{92, 1270, 896, 80}  // note text zone (72,1260,936,100)
	c3RFull    = [4]int{0, 0, 1080, 1920}
)

func TestL1RenderBatch6a_C03(t *testing.T) {
	runCase(t, &caseCfg{
		caseID: "VS-C03",
		irFile: "c03.degraded.json", framesFile: "c03.frames.json",
		goldenSub: "c03", reportFile: "l1-c03-report.json",
		fps: 30, width: 1080, height: 1920, durationFrames: 1350,
		keyframes: []int{0, 26, 150, 325, 366, 540, 586, 729, 735, 750, 1094, 1349},
		probes: []probeSpec{
			// T-12 title highlight window: 蓝色 F26→F36 (rise 0.25s→F33.5 full,
			// fall starts F35 0.6s→F53 back)
			{24, "hl-pre"}, {28, "hl-rise"}, {32, "hl-rise"}, {34, "hl-peak"}, {38, "hl-fall"}, {44, "hl-fall"}, {54, "hl-back"},
			// spectrum stagger windows: band windows 135/141/147/153/159/165 —
			// per band {ws-2 pre, ws+1 open, ws+8 settled} + F150 keyframe +
			// F185 all-settled (frames must match the c03Post band loop keys)
			{133, "band1-pre"}, {136, "band1-open"}, {143, "band1-settled"},
			{139, "band2-pre"}, {142, "band2-open"}, {149, "band2-settled"},
			{145, "band3-pre"}, {148, "band3-open"}, {155, "band3-settled"},
			{151, "band4-pre"}, {154, "band4-open"}, {161, "band4-settled"},
			{157, "band5-pre"}, {160, "band5-open"}, {167, "band5-6-settled"},
			{150, "f150-keyframe-sample"}, {163, "band6-pre"}, {166, "band6-open"},
			{173, "band6-settled"}, {185, "bands-settled"},
			// T-12 note highlight: 分子 F333→F344 (peak F338-342, back F360)
			{331, "hlx-pre"}, {336, "hlx-rise"}, {340, "hlx-peak"}, {346, "hlx-fall"}, {362, "hlx-back"},
			// pulse on molecules: 散射 F366, rise → F371, back → F380
			{364, "pulse-pre"}, {371, "pulse-peak"}, {377, "pulse-fall"}, {383, "pulse-settled"},
			// sun/title window close (endFrame=539 half-open)
			{537, "sun-title-open-last"}, {543, "sun-title-closed"},
			// bar_blue window 735 vs anchor 762 arbitration
			{737, "barblue-window-open"}, {750, "barblue-preanchor"}, {768, "barblue-growing"}, {800, "barblue-settled"},
		},
		post: c03Post,
	})
}

func c03Post(cx *caseCtx) {
	t := cx.t
	img := func(f int) image.Image { return cx.imgs[f] }
	bgNavy := func(i image.Image, r [4]int) float64 { return shareNear(i, r, 0x0B, 0x1B, 0x3A, 14) }
	sun := func(i image.Image, r [4]int) float64 { return shareNear(i, r, 0xFF, 0xE9, 0xA8, 18) }
	blueHL := func(i image.Image, r [4]int) float64 { return shareNear(i, r, 0x4D, 0x96, 0xFF, 24) }
	goldHL := func(i image.Image, r [4]int) float64 { return shareNear(i, r, 0xFF, 0xD5, 0x4A, 24) }
	mol := func(i image.Image, r [4]int) float64 { return shareNear(i, r, 0xE8, 0xF1, 0xFB, 14) }
	redBar := func(i image.Image, r [4]int) float64 { return shareNear(i, r, 0xFF, 0x7A, 0x59, 18) }
	blueBar := func(i image.Image, r [4]int) float64 { return shareNear(i, r, 0x4D, 0x96, 0xFF, 18) }
	bandColor := func(idx int) func(image.Image, [4]int) float64 {
		rgbs := [][3]uint8{{0xE5, 0x39, 0x35}, {0xFB, 0x8C, 0x00}, {0xFD, 0xD8, 0x35}, {0x43, 0xA0, 0x47}, {0x1E, 0x88, 0xE5}, {0x5E, 0x35, 0xB1}}
		c := rgbs[idx-1]
		return func(i image.Image, r [4]int) float64 { return shareNear(i, r, c[0], c[1], c[2], 20) }
	}
	rects := [][4]int{c3RBand1, c3RBand2, c3RBand3, c3RBand4, c3RBand5, c3RBand6}
	windows := [][2]int{{135, 539}, {141, 539}, {147, 539}, {153, 539}, {159, 539}, {165, 539}}
	leak := func(label string, f int, measured string) {
		cx.hardPrompts = append(cx.hardPrompts, map[string]any{
			"id": "P0-1_WINDOW_LEAK", "frame": f, "verdict": "fail",
			"measured": measured, "reason": label,
		})
		t.Errorf("WINDOW LEAK: %s at F%d — %s", label, f, measured)
	}

	// ---- T-12 title highlight (蓝色 F26-F36 window; 全行着色 granularity) ----
	hl := cx.probeRecs[34]
	for _, f := range []int{24, 28, 32, 34, 38, 44, 54} {
		hl.StructureChecks[fmt.Sprintf("f%d_title_blue", f)] = blueHL(img(f), c3RTitle)
	}
	hl.StructureChecks["window_math"] = "锚 蓝色 w02 0.86s→F26：rise 0.25s → F33.5 全色；hold 至词尾 1.18s→F35；fall 0.6s 自 max(at+0.3s=F35, end-0.6s=F17)=F35 起 → F53 回落"
	hlBlueMax := hl.StructureChecks["f34_title_blue"].(float64)
	hlBluePre := hl.StructureChecks["f24_title_blue"].(float64)
	hlBlueBack := hl.StructureChecks["f54_title_blue"].(float64)
	t.Logf("probe: T-12 title blue pre=%.4f peak=%.4f back=%.4f", hlBluePre, hlBlueMax, hlBlueBack)

	// ---- T-12 note highlight (分子 F333-F344) ----
	hlx := cx.probeRecs[340]
	for _, f := range []int{331, 336, 340, 346, 362} {
		hlx.StructureChecks[fmt.Sprintf("f%d_note_gold", f)] = goldHL(img(f), c3RNote)
	}
	hlx.StructureChecks["window_math"] = "锚 分子 w07 11.1s→F333：rise → F340.5 全色；fall 自 max(F335, end(F343.8)-0.6s=F325.8)=F342 起 → F360 回落"

	// ---- pulse on molecules (散射 F366; 1.12 → top edge y820→≈802) ----
	pp := cx.probeRecs[371]
	for _, f := range []int{364, 371, 377, 383} {
		pp.StructureChecks[fmt.Sprintf("f%d_mol_top_strip", f)] = mol(img(f), c3RMolTop)
		pp.StructureChecks[fmt.Sprintf("f%d_mol_body", f)] = mol(img(f), c3RMolBody)
	}
	pp.StructureChecks["window_math"] = "锚 散射 w10 12.2s→F366：rise 0.18s→F371（scale 1.12，600 宽 bbox 顶缘上移 18px → 探针条 y806-816 变浅色）；fall 0.3s→F380 回落。an_molecules move（y880→820，锚 空气 F324+45f=F369 落定）走 x/y 轴与 scale 无冲突"

	// ---- spectrum stagger window probes ----
	bands := cx.probeRecs[161]
	for bi := 0; bi < 6; bi++ {
		fn := bandColor(bi + 1)
		ws := windows[bi][0]
		for _, f := range []int{ws - 2, ws + 1, ws + 8, 185} {
			if f < 0 {
				continue
			}
			bands.StructureChecks[fmt.Sprintf("band%d_f%d", bi+1, f)] = fn(img(f), rects[bi])
		}
		// leak check: before its window (and before its scaleIn anchor which is
		// ≥ window for all six bands) the band must show zero band pixels.
		preF := ws - 2
		if v := bands.StructureChecks[fmt.Sprintf("band%d_f%d", bi+1, preF)].(float64); v > 0.01 {
			leak(fmt.Sprintf("band%d visible before startFrame=%d", bi+1, ws), preF, fmt.Sprintf("share=%.4f", v))
		}
	}

	// ---- sun/title window close probes (endFrame=539 half-open) ----
	pST := cx.probeRecs[543]
	pST.StructureChecks["f537_sun"] = sun(img(537), c3RSun)
	pST.StructureChecks["f543_sun"] = sun(img(543), c3RSun)
	pST.StructureChecks["f543_title_blue"] = blueHL(img(543), c3RTitle)
	pST.StructureChecks["f543_bg_at_sun"] = bgNavy(img(543), c3RSun)
	if v := pST.StructureChecks["f543_sun"].(float64); v > 0.01 {
		leak("sun visible after endFrame=539", 543, fmt.Sprintf("share=%.4f", v))
	}

	// ---- bar_blue window-vs-anchor arbitration probes ----
	pbb := cx.probeRecs[750]
	for _, f := range []int{737, 750, 768, 800} {
		pbb.StructureChecks[fmt.Sprintf("f%d_barblue", f)] = blueBar(img(f), c3RBarBlue)
	}
	pbb.StructureChecks["arbitration"] = "窗口 735 开 vs 锚 蓝光 F762（immediateRender from=0）：若 F750 share≈0 则'锚前 scale=0'语义成立（帧表'静态满高可见 735-761'的乐观读法不成立）；若 >0.01 则窗口开即静态可见成立"

	// ---- keyframes ----
	// F0
	f0 := img(0)
	c0 := cx.keyRecs[0].StructureChecks
	c0["bg_navy_share"] = bgNavy(f0, c3RFull)
	c0["sun_share"] = sun(f0, c3RSun)
	c0["band1_pre"] = bandColor(1)(f0, c3RBand1)
	c0["mol_pre"] = mol(f0, c3RMolBody)
	if c0["bg_navy_share"].(float64) >= 0.5 && c0["sun_share"].(float64) >= 0.9 && c0["band1_pre"].(float64) < 0.005 && c0["mol_pre"].(float64) < 0.005 {
		cx.set(0, "ok", "首帧钩子：#0B1B3A 深蓝底铺满（T-02 渐变降级为纯色——A-C03-04 降级不适用）+ 太阳（窗口 0 开）+ 标题（scaleIn 0.8→1 自 t=0 进行中）；光谱/分子/公式/柱图/注释窗口未开 → 全隐藏（P0-1：帧 0 画面 = 底+太阳+标题，文档镜 1 对位）",
			"标题 scaleIn 无锚 → 起播 t=0，24 帧 power2.out → F24 落定可读")
	} else {
		cx.set(0, "fail", fmt.Sprintf("F0 结构不符 checks=%v", c0))
	}

	// F26 — T-12 first showcase
	c26 := cx.keyRecs[26].StructureChecks
	c26["probe_pre_blue"] = hlBluePre
	c26["probe_peak_blue"] = hlBlueMax
	c26["probe_back_blue"] = hlBlueBack
	c26["note_probe_peak_gold"] = hlx.StructureChecks["f340_note_gold"]
	if hlBlueMax > hlBluePre+0.02 && hlBlueBack < hlBlueMax-0.02 {
		cx.set(26, "ok", fmt.Sprintf("T-12 完整形态首秀（标题）：'蓝色' 词窗口 F26-F36 内标题全行变 #4D96FF——share 序列 pre(F24)=%.4f → peak(F34)=%.4f → back(F54)=%.4f，升-持-降三段齐全",
			hlBluePre, hlBlueMax, hlBlueBack),
			"降级注记：着色粒度=整个 text 元素（builder 无逐词 span）——标题整行 20 字全变蓝而非'蓝色'两字（frames.json 已记录）",
			"三代能力演进实证：pre-round4 全画布闪且被遮挡不可见 → round4 元素背景闪 → 现 T-12 文本着色（词窗口语义）")
	} else {
		cx.set(26, "fail", fmt.Sprintf("T-12 标题着色窗口不完整 checks=%v", c26))
	}

	// F150 — spectrum stagger
	c150 := cx.keyRecs[150].StructureChecks
	onsets := []int{}
	for bi := 0; bi < 6; bi++ {
		shareAt := func(f int) float64 {
			key := fmt.Sprintf("band%d_f%d", bi+1, f)
			if v, ok := bands.StructureChecks[key]; ok {
				return v.(float64)
			}
			return -1
		}
		ws := windows[bi][0]
		// pixel onset = first probe frame with share > 0.02
		onset := -1
		for _, f := range []int{ws - 2, ws + 1, ws + 8, 185} {
			v := shareAt(f)
			if v > 0.02 {
				onset = f
				break
			}
		}
		onsets = append(onsets, onset)
		c150[fmt.Sprintf("band%d_pixel_onset", bi+1)] = onset
		// visible-at-150 sample: use the F150 keyframe probe directly
		c150[fmt.Sprintf("band%d_share_at_150", bi+1)] = bandColor(bi+1)(img(150), rects[bi])
	}
	c150["onsets"] = onsets
	// F150 expectation: band1-3 入场中/已入、band4 窗口已开（153≤150? 否——150<153 band4 未开）
	// At F150: band1 window open (135) + anchor 白光 F144 (scaleIn 18f → F162 落定, at 150 progress 6/18 power2.out ≈0.70)
	// band2 window 141 anchor F144 同、band3 window 147 anchor 不同 F156 → scale=0 until 156.
	// So at F150: band1 & band2 partially visible (anchored F144), band3-6 invisible (pre-anchor scale 0).
	b1 := c150["band1_share_at_150"].(float64)
	b2 := c150["band2_share_at_150"].(float64)
	b3 := c150["band3_share_at_150"].(float64)
	if b1 > 0.05 && b2 > 0.05 && b3 < 0.01 {
		cx.set(150, "mismatch",
			fmt.Sprintf("光谱错峰（P0-1 六条 6 帧窗口 135/141/147/153/159/165 全部按文档恢复；像素 onset 序列=%v）：F150 时 band1/2 可见（锚 白光 F144 起播 6 帧 power2.out≈0.70）而 band3 窗口已开（147）但锚 不同 F156 未到 → scale=0 不可见（share=%.4f）",
				onsets, b3),
			"帧表'F150 时 band1-3 已入场、band4 入场中'与渲染差 1 条：band3 的锚（不同 w04 5.2s→F156）晚于其窗口（147）9 帧——窗口先开、入场后行的组合语义下 band3 在 F150 仍不可见；错峰节奏本身（6 帧窗口步进）成立，M2 复核口径为'窗口步进+锚分两簇（白光/不同/波长）'",
			"A-C03-01 前置'至少 5 条可见'在 band6 锚 波长 F167 起播 18 帧 → F185 全部落定（探针 band6_f185）")
	} else {
		cx.set(150, "fail", fmt.Sprintf("F150 光谱可见性不符 checks=%v", c150))
	}

	// F325 — molecules window + note window + move
	f325 := img(325)
	c325 := cx.keyRecs[325].StructureChecks
	c325["mol_body"] = mol(f325, c3RMolBody)
	c325["note_white_pre_hlx"] = goldHL(f325, c3RNote)
	c325["pulse_probe_body"] = pp.StructureChecks["f371_mol_body"]
	c325["pulse_probe_pre"] = pp.StructureChecks["f364_mol_top_strip"]
	c325["pulse_probe_peak"] = pp.StructureChecks["f371_mol_top_strip"]
	c325["pulse_probe_settled"] = pp.StructureChecks["f383_mol_top_strip"]
	if c325["mol_body"].(float64) > 0.3 && c325["pulse_probe_peak"].(float64) > 0.05 && c325["pulse_probe_pre"].(float64) < 0.01 {
		cx.set(325, "ok", fmt.Sprintf("镜 3：分子块窗口 315 开（body=%.2f，an_molecules 锚 空气 F324 升至 y820 45 帧进行中）；元素级 pulse 首秀在后方 F366（top-strip pre=%.4f → peak=%.4f → settled=%.4f——1.12 呼吸把顶缘推过 y806-816 探针条再回落，只作用 el_molecules 节点）",
			c325["mol_body"], c325["pulse_probe_pre"], c325["pulse_probe_peak"], c325["pulse_probe_settled"]),
			"A-C03-02 注释层间距：注释 an_note_in 同锚 F324（y1290→1260 滑入 20 帧）——注释窗 315 开、锚 324 起：窗口先开 9 帧（滑入 from 态 immediateRender 置底位 y1290 静帧）")
	} else {
		cx.set(325, "fail", fmt.Sprintf("F325 分子窗口/pulse 探针不符 checks=%v", c325))
	}

	// F366 — pulse anchor + note highlight window
	c366 := cx.keyRecs[366].StructureChecks
	c366["note_gold_peak"] = hlx.StructureChecks["f340_note_gold"]
	c366["note_gold_pre"] = hlx.StructureChecks["f331_note_gold"]
	c366["note_gold_back"] = hlx.StructureChecks["f362_note_gold"]
	c366["pulse_peak_top"] = pp.StructureChecks["f371_mol_top_strip"]
	if c366["note_gold_peak"].(float64) > c366["note_gold_pre"].(float64)+0.02 {
		cx.set(366, "ok", fmt.Sprintf("ef_hl_cross（T-12 第二处，注释条）：'分子' 词窗口 F333-F344 内注释全行变 #FFD54A——pre(F331)=%.4f → peak(F340)=%.4f → back(F362)=%.4f；ef_pulse_dot 同帧锚散射（top-strip %.4f）——一帧双 effect（highlight 着色 note + pulse 呼吸 molecules）元素级并存",
			c366["note_gold_pre"], c366["note_gold_peak"], c366["note_gold_back"], c366["pulse_peak_top"]),
			"降级注记：dotGrid/dots 复合键不可消费（⛔）——分子为一块浅色 shape 占位，12 点阵不可见")
	} else {
		cx.set(366, "fail", fmt.Sprintf("F366 注释高亮/pulse 不符 checks=%v", c366))
	}

	// F540 — sun/title closed (half-open 539), formula window opens
	f540 := img(540)
	c540 := cx.keyRecs[540].StructureChecks
	c540["probe_f537_sun"] = pST.StructureChecks["f537_sun"]
	c540["probe_f543_sun"] = pST.StructureChecks["f543_sun"]
	c540["formula_blue"] = blueHL(f540, c3RFormula)
	if pST.StructureChecks["f537_sun"].(float64) > 0.5 && pST.StructureChecks["f543_sun"].(float64) < 0.01 {
		cx.set(540, "mismatch",
			fmt.Sprintf("镜 4 边界：太阳/标题 endFrame=539 半开关闭（F537 sun=%.2f → F543 sun=%.4f）——'标题遮公式'风险在 P0-1 下像素级消除；公式窗口 540 开 + 锚 瑞利 F549 起播（F540 精确帧 formula=%.4f 即 scale=0 不可见，540-548 静态无缩放为 from=0 → 实为不可见，帧表'静态可见无入场缩放'的乐观读法被 immediateRender from=0 修正）",
				pST.StructureChecks["f537_sun"], pST.StructureChecks["f543_sun"], c540["formula_blue"]),
			"P0-1 红利核心帧（帧表原文）：无窗口时代标题常驻全片遮住公式区——实测 539 后标题零像素")
	} else {
		cx.set(540, "fail", fmt.Sprintf("F540 边界不符 checks=%v", c540))
	}

	// F586 — formula settled
	f586 := img(586)
	c586 := cx.keyRecs[586].StructureChecks
	c586["formula_blue"] = blueHL(f586, c3RFormula)
	if c586["formula_blue"].(float64) > 0.02 {
		cx.set(586, "ok", fmt.Sprintf("'四次方' 在旁白中（F586=词起点帧）：公式条落定（share=%.4f，锚 瑞利 F549+24f=F573 落定）；公式为 text 但未挂 highlight——T-12 只覆盖文档 effects 表三处，词级强调留 M2 补 ef 口径",
			c586["formula_blue"].(float64)))
	} else {
		cx.set(586, "fail", fmt.Sprintf("F586 公式缺失 checks=%v", c586))
	}

	// F729 — bar_red window(720) + anchor(729)
	f729 := img(729)
	c729 := cx.keyRecs[729].StructureChecks
	c729["bar_red"] = redBar(f729, c3RBarRed)
	c729["bar_blue_at_729"] = blueBar(f729, c3RBarBlue)
	if c729["bar_red"].(float64) < 0.01 && c729["bar_blue_at_729"].(float64) < 0.01 {
		cx.set(729, "ok", "镜 5 双柱起点：红柱窗口 720 开但锚 红光 F729 同帧（scaleIn from=0 → 精确帧不可见，像素自 F730 起 30 帧生长）；蓝柱窗口 735 未开 → 双零",
			"T-11 降级：整柱中心 scaleIn 非底部立起——柱顶/柱底对称偏移，落定帧（759/792）几何不受影响")
	} else {
		cx.set(729, "fail", fmt.Sprintf("F729 双柱预期不符 checks=%v", c729))
	}

	// F735 — bar_blue window opens (anchor 762 27 frames later)
	f735 := img(735)
	c735 := cx.keyRecs[735].StructureChecks
	c735["bar_red"] = redBar(f735, c3RBarRed)
	c735["probe_f737_barblue"] = pbb.StructureChecks["f737_barblue"]
	c735["probe_f750_barblue"] = pbb.StructureChecks["f750_barblue"]
	c735["probe_f768_barblue"] = pbb.StructureChecks["f768_barblue"]
	c735["probe_f800_barblue"] = pbb.StructureChecks["f800_barblue"]
	if c735["probe_f750_barblue"].(float64) < 0.01 && c735["probe_f800_barblue"].(float64) > 0.02 {
		cx.set(735, "mismatch",
			fmt.Sprintf("蓝柱窗口/锚仲裁（帧表要求点）：F737=%.4f F750=%.4f F768=%.4f F800=%.4f——immediateRender from=0 语义成立：窗口 735 开而锚 蓝光 F762 未到期间蓝柱不可见（scale=0），F762 起 30 帧生长至 F792 落定（F768=%.4f 生长中、F800=%.4f 已落定）",
				c735["probe_f737_barblue"], c735["probe_f750_barblue"], c735["probe_f768_barblue"], c735["probe_f800_barblue"], c735["probe_f768_barblue"], c735["probe_f800_barblue"]),
			"帧表'蓝柱静态满高可见 735-761'的乐观读法不成立（15 帧窗口空档）——M2 复核：文档 stagger 15 帧在窗口轴恢复，但生长可见性仍由词锚决定；两时钟错位 27 帧与帧表预判一致",
			"红柱此时生长中（F729+6/30 帧）")
	} else {
		cx.set(735, "fail", fmt.Sprintf("F735 蓝柱仲裁不符 checks=%v", c735))
	}

	// F750 — cover candidate frame
	f750 := img(750)
	c750 := cx.keyRecs[750].StructureChecks
	c750["bar_red"] = redBar(f750, c3RBarRed)
	c750["bar_blue"] = blueBar(f750, c3RBarBlue)
	c750["barblue_arb_f750"] = pbb.StructureChecks["f750_barblue"]
	if c750["bar_red"].(float64) > 0.02 && c750["bar_blue"].(float64) < 0.01 {
		cx.set(750, "mismatch",
			fmt.Sprintf("文档封面候选位（atSec=25）：红柱生长中（%.2f，F729 起 30 帧 → 759 落定）、蓝柱不可见（%.4f——锚 762 未到，仲裁见 F735）——'红柱矮蓝柱高'的封面画面在降级渲染下不成立（蓝柱 27 帧空档）",
				c750["bar_red"], c750["bar_blue"]),
			"降级注记：thumbnail.atSec 无通路（ExtractThumbnail 固定 -ss 1）——封面候选需 L1 渲染器单独截取；ef_cnt_ratio counter 已移除（96px 字形压柱顶标签）——数字缺失，比值用柱高比 60:140≈6:1 静态呈现（落定后）")
	} else {
		cx.set(750, "fail", fmt.Sprintf("F750 封面候选不符 checks=%v", c750))
	}

	// F1094 — 图解保持（含尾口径收口）。窗口含尾 [startFrame+1, endFrame]：
	// endFrame 帧本身可见，hide set 落 endFrame+ε（timeline-builder 半帧错位，
	// 真调共帧叠印/黑帧修复的口径修正）。旧断言（endFrame 帧全零、"半开关闭"）
	// 是 hide-at-endFrame 精确落位时代的实测记录；新口径下 F1094 双柱仍在场
	// （场景表镜 6 = 930–1094 含尾），退场发生在 F1095。
	// 判定：分子/公式已退场（endFrame=929 < 1094），双柱满高在场，注释在场。
	f1094 := img(1094)
	c1094 := cx.keyRecs[1094].StructureChecks
	c1094["mol_body"] = mol(f1094, c3RMolBody)
	c1094["formula_blue"] = blueHL(f1094, c3RFormula)
	c1094["bar_red"] = redBar(f1094, c3RBarRed)
	c1094["bar_blue"] = blueBar(f1094, c3RBarBlue)
	c1094["note_gold"] = goldHL(f1094, c3RNote)
	c1094["note_ink"] = rectStats(f1094, "n", c3RNote)["white_ratio"].(float64)
	if c1094["mol_body"].(float64) < 0.01 && c1094["formula_blue"].(float64) < 0.01 &&
		c1094["bar_red"].(float64) > 0.02 && c1094["bar_blue"].(float64) > 0.02 {
		cx.set(1094, "ok", "镜 6 尾帧（窗口含尾口径）：分子/公式 endFrame=929 已退场；双柱/注释 endFrame=1094——含尾口径下 endFrame 帧本帧可见（hide set 落 endFrame+ε，builder 半帧错位），F1095 起整体退场",
			"口径修正登记（共帧叠印修复，2026-11-16）：旧断言'endFrame=1094 半开关闭、四区全零'是 hide-at-endFrame 精确落位时代的实测——新口径与 §7.0 区间记法 [startFrame+1, endFrame] 字面一致（endFrame 帧归卡内），timewindow F105 探针实证（VS-TW run 20261116-205029：F105 元素色、F106 背景）",
			"'蓝色' occurrence=1（w18 F1104）在旁白中——无 highlight 挂靠（effects 表只三处），字幕承载")
	} else {
		cx.set(1094, "fail", fmt.Sprintf("F1094 图解含尾保持不符 checks=%v", c1094))
	}

	// F1349 — tail
	f1349 := img(1349)
	c1349 := cx.keyRecs[1349].StructureChecks
	c1349["bg_navy_share"] = bgNavy(f1349, c3RFull)
	c1349["duration_frames_rendered"] = 1350
	if c1349["bg_navy_share"].(float64) >= 0.5 {
		cx.set(1349, "ok", "尾帧：结论卡元素保持（el_caption 空 text 占位，烧录走 SubtitleMode=burn）；DurationFrames=ceil(45×30)=1350（bgm 46s 不抬基线——max(meta,voice) 单源）帧循环完整",
			"BGM 淡出不可实现（无 fade-out 音频滤镜，amix duration=first 截 45s）——P0-2 fadeIn/fadeOut 是元素级 opacity，不适用音频轨——L2 口径")
	} else {
		cx.set(1349, "fail", fmt.Sprintf("尾帧背景缺失 checks=%v", c1349))
	}
}

// =====================================================================
// VS-C05 — 旅行：京都红叶步行线（1080x1920@30, 900 frames, 30s）
// =====================================================================

var (
	c5RBarTop  = [4]int{20, 20, 1040, 80}   // bar_top interior (0,0,1080,120)
	c5RTitle   = [4]int{92, 310, 896, 60}   // title text zone (72,300,936,80)
	c5RPhotoSw = [4]int{440, 860, 200, 200} // photo switch sample (center zone, vignette-free)
	c5RVigTop  = [4]int{184, 417, 712, 12}  // vig_top strip + margin (180,420,720,6)
	c5RVigBot  = [4]int{184, 1491, 712, 12} // vig_bot (180,1494,720,6)
	c5RVigLeft = [4]int{177, 424, 12, 1072} // vig_left (180,420,6,1080)
	c5RPlace1  = [4]int{92, 1510, 660, 40}  // place1 text zone (72,1500,700,60)
	c5RPalRed  = [4]int{200, 1575, 180, 30} // pal_red interior (180,1560,220,60)
	c5RPalGold = [4]int{450, 1575, 180, 30} // pal_gold interior (430,1560,220,60)
	c5RPalGrn  = [4]int{700, 1575, 180, 30} // pal_green interior (680,1560,220,60)
	c5RPath    = [4]int{140, 1617, 800, 10} // path_line strip (120,1620,840,4)
	c5RFull    = [4]int{0, 0, 1080, 1920}
)

func TestL1RenderBatch6a_C05(t *testing.T) {
	runCase(t, &caseCfg{
		caseID: "VS-C05",
		Assets: b6aAssets,
		irFile: "c05.degraded.json", framesFile: "c05.frames.json",
		goldenSub: "c05", reportFile: "l1-c05-report.json",
		fps: 30, width: 1080, height: 1920, durationFrames: 900,
		keyframes: []int{0, 26, 150, 181, 336, 348, 549, 579, 720, 768, 899},
		probes: []probeSpec{
			// T-12 title highlight (红叶 F26-F35)
			{24, "hl-pre"}, {28, "hl-rise"}, {32, "hl-peak"}, {36, "hl-fall"}, {54, "hl-back"},
			// pulse on hidden vig node (水渠 F176-184 vs window 330)
			{174, "pulse-hidden-pre"}, {178, "pulse-hidden-peak"}, {184, "pulse-hidden-end"},
			// photo switch 329/330
			{327, "photo1-open-last"}, {331, "photo2-open"},
			// vig window 330 + anchor 通天桥 F348 (immediateRender from=0 空档)
			{332, "vig-window-open-preanchor"}, {352, "vig-growing"}, {372, "vig-settled"},
			// palette anchors 549/579/588
			{542, "pal-all-preanchor"}, {556, "pal-red-growing"}, {585, "pal-gold-growing"}, {600, "pal-settled"},
			// fade window 768-786
			{766, "fade-pre"}, {780, "fade-mid"}, {790, "fade-settled"},
		},
		post: c05Post,
	})
}

func c05Post(cx *caseCtx) {
	t := cx.t
	img := func(f int) image.Image { return cx.imgs[f] }
	barDark := func(i image.Image, r [4]int) float64 { return shareNear(i, r, 0x0E, 0x14, 0x18, 8) }
	barBlended := func(i image.Image, r [4]int) float64 {
		// blend at opacity 0.9 over photo2 standin #7FA05A:
		// r=0.9*14+0.1*127≈25, g=0.9*20+0.1*160≈34, b=0.9*24+0.1*90≈31
		return shareNear(i, r, 25, 34, 31, 6)
	}
	photo1 := func(i image.Image, r [4]int) float64 { return shareNear(i, r, 0xC9, 0xB4, 0x7E, 20) }
	photo2 := func(i image.Image, r [4]int) float64 { return shareNear(i, r, 0x7F, 0xA0, 0x5A, 20) }
	vig := func(i image.Image, r [4]int) float64 { return shareNear(i, r, 0xF2, 0xF5, 0xF9, 12) }
	redHL := func(i image.Image, r [4]int) float64 { return shareNear(i, r, 0xC8, 0x55, 0x3D, 24) }
	palRed := func(i image.Image, r [4]int) float64 { return shareNear(i, r, 0xC8, 0x55, 0x3D, 18) }
	palGold := func(i image.Image, r [4]int) float64 { return shareNear(i, r, 0xD9, 0xA4, 0x41, 18) }
	palGrn := func(i image.Image, r [4]int) float64 { return shareNear(i, r, 0x5E, 0x7A, 0x52, 18) }
	pathGold := func(i image.Image, r [4]int) float64 { return shareNear(i, r, 0xD9, 0xA4, 0x41, 14) }
	white := func(i image.Image, r [4]int) float64 { return rectStats(i, "w", r)["white_ratio"].(float64) }
	textFF := func(i image.Image, r [4]int) float64 { return shareNear(i, r, 0xF2, 0xF5, 0xF9, 12) } // #F2F5F9 place text
	leak := func(label string, f int, measured string) {
		cx.hardPrompts = append(cx.hardPrompts, map[string]any{
			"id": "P0-1_WINDOW_LEAK", "frame": f, "verdict": "fail",
			"measured": measured, "reason": label,
		})
		t.Errorf("WINDOW LEAK: %s at F%d — %s", label, f, measured)
	}

	// ---- T-12 title highlight (红叶 F26-F35; #C8553D) ----
	hl := cx.probeRecs[32]
	for _, f := range []int{24, 28, 32, 36, 54} {
		hl.StructureChecks[fmt.Sprintf("f%d_title_red", f)] = redHL(img(f), c5RTitle)
	}
	hl.StructureChecks["window_math"] = "锚 红叶 w02 occ0 0.85s→F26：rise 0.25s → F33.5；词尾 1.15s→F35；fall 自 max(F35, F16.5)=F35 起 0.6s → F53 回落"
	t.Logf("probe: T-05 title red pre=%.4f peak=%.4f back=%.4f",
		hl.StructureChecks["f24_title_red"], hl.StructureChecks["f32_title_red"], hl.StructureChecks["f54_title_red"])

	// ---- pulse on hidden vig node (水渠 F176; window 330 closed) ----
	pp := cx.probeRecs[178]
	for _, f := range []int{174, 178, 184} {
		pp.StructureChecks[fmt.Sprintf("f%d_vig_share", f)] = vig(img(f), c5RVigTop)
		pp.StructureChecks[fmt.Sprintf("f%d_photo_share", f)] = photo1(img(f), c5RVigTop)
	}
	pp.StructureChecks["verdict_branch"] = "pulse 作用于 visibility:hidden 节点=无像素（frames.json '窗口前无效'判读）；photo1 色占满探针条 = 隐藏节点证据"
	pHidden := pp.StructureChecks["f178_vig_share"].(float64) < 0.01
	t.Logf("probe: hidden-node pulse F178 vig=%.4f photo=%.4f -> %v",
		pp.StructureChecks["f178_vig_share"], pp.StructureChecks["f178_photo_share"], pHidden)

	// ---- photo switch probes ----
	ps := cx.probeRecs[331]
	ps.StructureChecks["f327_photo1"] = photo1(img(327), c5RPhotoSw)
	ps.StructureChecks["f331_photo2"] = photo2(img(331), c5RPhotoSw)
	ps.StructureChecks["f331_photo1"] = photo1(img(331), c5RPhotoSw)

	// ---- vig window/anchor gap probes (window 330, anchor 通天桥 F348) ----
	pv := cx.probeRecs[352]
	for _, f := range []int{332, 352, 372} {
		pv.StructureChecks[fmt.Sprintf("f%d_vig_top", f)] = vig(img(f), c5RVigTop)
	}

	// ---- palette anchors ----
	ppal := cx.probeRecs[585]
	for _, f := range []int{542, 556, 585, 600} {
		ppal.StructureChecks[fmt.Sprintf("f%d_red", f)] = palRed(img(f), c5RPalRed)
		ppal.StructureChecks[fmt.Sprintf("f%d_gold", f)] = palGold(img(f), c5RPalGold)
		ppal.StructureChecks[fmt.Sprintf("f%d_grn", f)] = palGrn(img(f), c5RPalGrn)
	}

	// ---- fade probes (F768 0.6s → 786 settle at 0.9) ----
	pf := cx.probeRecs[780]
	for _, f := range []int{766, 780, 790} {
		pf.StructureChecks[fmt.Sprintf("f%d_bar_exact", f)] = barDark(img(f), c5RBarTop)
		pf.StructureChecks[fmt.Sprintf("f%d_bar_blended", f)] = barBlended(img(f), c5RBarTop)
	}

	// ---- keyframes ----
	// F0 — title scaleIn from=0 anchored t=0: at the exact first frame the
	// entrance is at progress 0 (scale 0) → no title pixels YET (settled F24);
	// title presence is carried by the F26 highlight probe (title_red series
	// requires the title node to be on). Run-1's title_white>=0.005 at F0 was
	// a wrong expectation.
	f0 := img(0)
	c0 := cx.keyRecs[0].StructureChecks
	c0["photo1_share"] = photo1(f0, c5RPhotoSw)
	c0["photo2_share"] = photo2(f0, c5RPhotoSw)
	c0["bar_top_exact"] = barDark(f0, c5RBarTop)
	c0["bar_bot_exact"] = barDark(f0, [4]int{20, 1820, 1040, 80})
	c0["title_white"] = white(f0, c5RTitle)
	c0["vig_share"] = vig(f0, c5RVigTop)
	c0["pal_red"] = palRed(f0, c5RPalRed)
	c0["title_visible_by_probe"] = hl.StructureChecks["f32_title_red"]
	if c0["photo1_share"].(float64) >= 0.5 && c0["bar_top_exact"].(float64) >= 0.9 &&
		c0["vig_share"].(float64) < 0.005 && c0["pal_red"].(float64) < 0.005 &&
		c0["photo2_share"].(float64) < 0.005 {
		cx.set(0, "ok", fmt.Sprintf("钩子帧：photo1 水渠占位铺满 + 上下信箱条 #0E1418（窗口 0-899 全程）；photo2/取景框/色卡/路径线窗口未开 → 全隐藏（P0-1：'photo2 透出旧图边缘'风险随窗口机制消除）；标题 scaleIn from=0 自 t=0 起播——精确帧 0 处 scale=0 无像素（落定 F24，F26 探针序列 title_red 峰值 %.4f 以标题节点在场为前提）",
			c0["title_visible_by_probe"].(float64)),
			"A-C05-01 暖色像素 ≥30% 依赖素材本身——合成占位下该断言降级为 photo1 占位色占比")
	} else {
		cx.set(0, "fail", fmt.Sprintf("F0 结构不符 checks=%v", c0))
	}

	// F26 — T-12 title
	c26 := cx.keyRecs[26].StructureChecks
	c26["probe_pre"] = hl.StructureChecks["f24_title_red"]
	c26["probe_peak"] = hl.StructureChecks["f32_title_red"]
	c26["probe_back"] = hl.StructureChecks["f54_title_red"]
	pre := c26["probe_pre"].(float64)
	peak := c26["probe_peak"].(float64)
	back := c26["probe_back"].(float64)
	if peak > pre+0.02 && back < peak-0.02 {
		cx.set(26, "ok", fmt.Sprintf("T-12（C05 标题）：'红叶' 词窗口 F26-F35 内标题全行变 #C8553D——pre(F24)=%.4f → peak(F32)=%.4f → back(F54)=%.4f",
			pre, peak, back),
			"重复词 '红叶' w02/w12 用 occurrence=0/1 显式区分（F-C05-04 注入场景的现行答案）；粒度=整行（无逐词 span）")
	} else {
		cx.set(26, "fail", fmt.Sprintf("T-12 标题着色不符 checks=%v", c26))
	}

	// ---- F181 evidence (place1 settled + photo coverage), computed before
	// the F150 verdict which cites it ----
	f181 := img(181)
	c181 := cx.keyRecs[181].StructureChecks
	c181["vig_share"] = vig(f181, c5RVigTop)
	c181["photo_share"] = photo1(f181, c5RVigTop)
	c181["photo_sw"] = photo1(f181, c5RPhotoSw)
	c181["place1_text"] = textFF(f181, c5RPlace1)
	c181["pulse_probe_f178_vig"] = pp.StructureChecks["f178_vig_share"]
	c181["pulse_probe_f178_photo"] = pp.StructureChecks["f178_photo_share"]

	// F150 — place1 window + photo pan anchor. Run measured place=0 at the
	// exact window-open frame (anchor 哲学 F156 from=0 → invisible until F157);
	// F181 probe carries the settled-state proof.
	f150 := img(150)
	c150 := cx.keyRecs[150].StructureChecks
	c150["place1_white"] = white(f150, c5RPlace1)
	c150["hidden_pulse_verdict"] = pHidden
	c150["probe_f181_place"] = c181["place1_text"]
	if c150["place1_white"].(float64) >= 0.005 ||
		(c150["place1_white"].(float64) < 0.005 && c181["place1_text"].(float64) >= 0.005) {
		cx.set(150, "ok", fmt.Sprintf("镜 2：el_place1 窗口 150 开（精确帧 place=%.4f——anchor 哲学 F156 from=0 → 窗口开帧不可见，[start+1,end] 边界）+ F181 探针 place text=%.4f 落定；an_photo1_pan 锚 水渠 F176 起播（-40→0 直线 120 帧 → F296 落定，A-C05-04 位移窗口 [176,296] 词表自洽口径）",
			c150["place1_white"], c181["place1_text"]),
			"本帧 181 的 pulse 探针证明其作用节点尚未可见（窗口 330 未开）——文档 effects 表时序错位按'忠实文档'原则记录")
	} else {
		cx.set(150, "fail", fmt.Sprintf("F150 地点卡不符 checks=%v", c150))
	}

	// F181 — pulse-peak frame on hidden node (doc contradiction showcase)
	if c181["vig_share"].(float64) < 0.01 && c181["photo_share"].(float64) > 0.5 {
		cx.set(181, "mismatch",
			fmt.Sprintf("ef_pulse_frame 峰值帧（锚 水渠 F176 + 0.18s → ≈F181）：取景框窗口 330-719 未开——vig share=%.4f（photo=%.2f 占满探针条，photoSw=%.2f 全幅可证）——pulse 作用于隐藏节点零像素，frames.json '窗口前无效'判读成立",
				c181["vig_share"], c181["photo_share"], c181["photo_sw"]),
			"文档 effects 表自身时序错位（pulse 取景框却锚镜 1 词'水渠' 5.85s）：降级 IR 忠实保留锚值；M2 备选——改锚 '通天桥'（F348+）或把取景框窗口提前，按'忠实文档'原则本轮不改")
	} else {
		cx.set(181, "fail", fmt.Sprintf("F181 隐藏节点 pulse 判读不符 checks=%v", c181))
	}

	// F336 — photo switch + vig window open
	c336 := cx.keyRecs[336].StructureChecks
	c336["probe_f327_photo1"] = ps.StructureChecks["f327_photo1"]
	c336["probe_f331_photo2"] = ps.StructureChecks["f331_photo2"]
	c336["probe_f331_photo1"] = ps.StructureChecks["f331_photo1"]
	c336["vig_probe_f332"] = pv.StructureChecks["f332_vig_top"]
	c336["vig_probe_f352"] = pv.StructureChecks["f352_vig_top"]
	c336["vig_probe_f372"] = pv.StructureChecks["f372_vig_top"]
	if c336["probe_f331_photo2"].(float64) > 0.5 && c336["probe_f331_photo1"].(float64) < 0.05 &&
		c336["probe_f327_photo1"].(float64) > 0.5 {
		cx.set(336, "ok", fmt.Sprintf("镜 2→3 切换：photo1 F327=%.2f → photo2 F331=%.2f（photo1 残留 %.4f）——329/330 半开硬切干净（el_dim 近似层已删：P0-1 使'切换瞬间压暗'不再需要）；取景框窗口 330 开但锚 通天桥 F348 未到（immediateRender from=0）→ F332=%.4f F352=%.2f（起播 4 帧）F372=%.2f 落定",
			c336["probe_f327_photo1"], c336["probe_f331_photo2"], c336["probe_f331_photo1"],
			c336["vig_probe_f332"], c336["vig_probe_f352"], c336["vig_probe_f372"]),
			"an_photo2_in 锚 东福寺 F336 同帧起播（窗口先开 6 帧：330-335 满幅静帧可见——photo2 无入场缩放空档与 photo 不同：from=0.92 非零，immediateRender 应用 0.92 缩放静帧）")
	} else {
		cx.set(336, "fail", fmt.Sprintf("F336 切换不符 checks=%v", c336))
	}

	// F348 — vignette entrance
	f348 := img(348)
	c348 := cx.keyRecs[348].StructureChecks
	c348["vig_top"] = vig(f348, c5RVigTop)
	c348["vig_bot"] = vig(f348, c5RVigBot)
	c348["vig_left"] = vig(f348, c5RVigLeft)
	c348["probe_f372_top"] = pv.StructureChecks["f372_vig_top"]
	if c348["probe_f372_top"].(float64) > 0.5 {
		cx.set(348, "ok", fmt.Sprintf("取景框四边锚 通天桥 F348 起播（24 帧）：F372 探针 top=%.2f 落定——T-03 降级：shape:'frame'/outsideDim ⛔ 框外压暗不可表达（A-C05-02 降级不适用），框内 1.25× 放大 ⛔——只画框不放大（四条 6px shape 几何精确）",
			c348["probe_f372_top"]))
	} else {
		cx.set(348, "fail", fmt.Sprintf("F348 取景框不符 checks=%v", c348))
	}

	// F549 — palette anchors stagger
	c549 := cx.keyRecs[549].StructureChecks
	c549["probe_f542_red"] = ppal.StructureChecks["f542_red"]
	c549["probe_f556_red"] = ppal.StructureChecks["f556_red"]
	c549["probe_f585_gold"] = ppal.StructureChecks["f585_gold"]
	c549["probe_f600_grn"] = ppal.StructureChecks["f600_grn"]
	if c549["probe_f542_red"].(float64) < 0.01 && c549["probe_f556_red"].(float64) > 0.02 &&
		c549["probe_f600_grn"].(float64) > 0.02 {
		cx.set(549, "ok", fmt.Sprintf("镜 4 色卡：窗口 540 开 + 三块错峰锚（红 饱和度 F549 / 金 橙红@occ1 F579 / 绿 苔藓 F588）——F542=%.4f（全 pre-anchor scale=0）→ F556 red=%.2f（生长中）→ F585 gold=%.2f（起播 6 帧）→ F600 grn=%.2f（起播 12 帧）；T-09 swatches/staggerFrames ⛔ 拆三块独立 shape，顺序随旁白词序",
			c549["probe_f542_red"], c549["probe_f556_red"], c549["probe_f585_gold"], c549["probe_f600_grn"]),
			"A-C05-03 ΔE≤8 检查窗口 [600,719]（三块全落定后——597 红落定/597 金落定/606 绿落定）")
	} else {
		cx.set(549, "fail", fmt.Sprintf("F549 色卡错峰不符 checks=%v", c549))
	}

	// F579 — gold anchor
	f579 := img(579)
	c579 := cx.keyRecs[579].StructureChecks
	c579["gold_share"] = palGold(f579, c5RPalGold)
	c579["probe_f585_gold"] = ppal.StructureChecks["f585_gold"]
	if c579["probe_f585_gold"].(float64) > 0.02 {
		cx.set(579, "ok", fmt.Sprintf("金褐块锚 橙红@occ1 F579（S4 复述色名的第二个橙红——occurrence 区分实证）：F585 探针 %.2f 生长中", c579["probe_f585_gold"]))
	} else {
		cx.set(579, "fail", fmt.Sprintf("F579 金块缺失 checks=%v", c579))
	}

	// F720 — 图解退场 + path window
	f720 := img(720)
	c720 := cx.keyRecs[720].StructureChecks
	c720["pal_red_gone"] = palRed(f720, c5RPalRed)
	c720["vig_top_gone"] = vig(f720, c5RVigTop)
	c720["path_gold"] = pathGold(f720, c5RPath)
	c720["title_white_gone"] = white(f720, c5RTitle)
	if c720["pal_red_gone"].(float64) < 0.01 && c720["vig_top_gone"].(float64) < 0.01 {
		cx.set(720, "ok", fmt.Sprintf("镜 5 边界：色卡+取景框 endFrame=719 半开关闭（red=%.4f vig=%.4f 全零）+ el_path_line 窗口 720 开（锚 路径 F729 起播 40 帧——F720 精确帧 path=%.4f 即 from=0 不可见）；标题已在 329 退场（title=%.4f——P0-1：标题不再常驻片尾）",
			c720["pal_red_gone"], c720["vig_top_gone"], c720["path_gold"], c720["title_white_gone"]),
			"T-08 降级：from{w:0}→to{w:840} 宽度生长 ⛔——40 帧 scaleIn 中心展开，'自左向右生长'定向感丢失；满宽落定 F769 不受影响")
	} else {
		if v := c720["pal_red_gone"].(float64); v > 0.01 {
			leak("pal_red visible after endFrame=719", 720, fmt.Sprintf("share=%.4f", v))
		}
		if v := c720["vig_top_gone"].(float64); v > 0.01 {
			leak("vig visible after endFrame=719", 720, fmt.Sprintf("share=%.4f", v))
		}
		cx.set(720, "fail", fmt.Sprintf("F720 边界不符 checks=%v", c720))
	}

	// F768 — element-level fade
	c768 := cx.keyRecs[768].StructureChecks
	preF := pf.StructureChecks["f766_bar_exact"].(float64)
	midB := pf.StructureChecks["f780_bar_blended"].(float64)
	midE := pf.StructureChecks["f780_bar_exact"].(float64)
	setB := pf.StructureChecks["f790_bar_blended"].(float64)
	c768["probe_f766_exact"] = preF
	c768["probe_f780_blended"] = midB
	c768["probe_f780_exact"] = midE
	c768["probe_f790_blended"] = setB
	if midB > 0.02 && setB > 0.02 {
		cx.set(768, "ok", fmt.Sprintf("ef_fade_bars（元素级 fade 首秀）：锚 取景框 F768，上信箱条 opacity 1→0.9（0.6s → F786 落定）——bar 色 pre(F766 exact)=%.2f → mid(F780 blended)=%.2f/exact=%.2f → settled(F790 blended)=%.2f：0.9 混合使条色向 photo2 占位色偏移且稳定（采样偏移 ≈(11,14,7) 可测）",
			preF, midB, midE, setB),
			"元素级红利实证：下条与全片不淡化（round4 前的 fade=黑色全屏遮罩语义）——bar_bot 探针保持 exact 色（见 probes）；文档 'F585 起整片轻 fade' 若要复现需给全部在屏元素挂 fadeOut（P0-2 语义可用），本轮按文档 effects 表只挂一处")
	} else {
		cx.set(768, "fail", fmt.Sprintf("F768 fade 采样不符 checks=%v", c768))
	}

	// F899 — tail. F899 IS photo2/path/bar windows' endFrame (899). 口径修正
	// （共帧叠印修复，2026-11-16）：hide set 落 endFrame+ε（builder 半帧错位
	// ），窗口含尾——endFrame 帧本身可见，F900 起退场。旧口径（hide-at-
	// endFrame 精确落位）下本帧全空、"保持态最后一帧是 F898"；新口径下
	// F899 = 保持态最后一帧，与案例库 §7.0 记法 [startFrame+1, endFrame]
	// 字面一致（timewindow F105/F106 探针实证）。
	f899 := img(899)
	c899 := cx.keyRecs[899].StructureChecks
	c899["path_gold"] = pathGold(f899, c5RPath)
	c899["photo2_share"] = photo2(f899, c5RPhotoSw)
	c899["bar_top_blended"] = barBlended(f899, c5RBarTop)
	c899["bar_top_exact"] = barDark(f899, c5RBarTop)
	c899["place1_white"] = white(f899, c5RPlace1)
	c899["stage_dark_bg"] = photo2(f899, c5RPhotoSw)
	c899["duration_frames_rendered"] = 900
	switch {
	case c899["path_gold"].(float64) > 0.02 && c899["photo2_share"].(float64) > 0.5:
		cx.set(899, "ok",
			fmt.Sprintf("尾帧（含尾口径收口）：路径线满宽（%.2f）+ photo2 保持（%.2f）+ 上条 fade 定格 0.9 混合（%.2f）——F899 为三元素共享 endFrame，含尾口径下保持态最后一帧（F900 起退场）；片尾无地点卡（place1=%.4f）——文档帧表'片尾地点行就位'与 elements 表 place1 窗口 150-329 自相矛盾，降级 IR 忠实 elements 表（M2 复核二选一：改文档帧表或改 place1 窗口）",
				c899["path_gold"], c899["photo2_share"], c899["bar_top_blended"], c899["place1_white"]),
			"口径修正登记：旧口径（hide-at-endFrame 精确落位）实测本帧全空、保持态止于 F898——新口径与 §7.0 记法字面一致；饱和度 −15% 全局调色 ⛔ 素材侧预处理；BGM 27s 淡出不可实现（amix duration=first 截 30s）——L2 口径")
	case c899["path_gold"].(float64) < 0.01 && c899["photo2_share"].(float64) < 0.01 &&
		c899["place1_white"].(float64) < 0.005:
		cx.set(899, "mismatch",
			fmt.Sprintf("尾帧全空（path=%.4f photo2=%.4f bar_exact=%.4f place1=%.4f）：含尾口径下 F899 本应保持（hide set 落 endFrame+ε）——若复现此分支说明 builder 错位语义回退，须核查",
				c899["path_gold"], c899["photo2_share"], c899["bar_top_exact"], c899["place1_white"]),
			"片尾地点行矛盾照旧记录（降级 IR 站 elements 表）")
	default:
		cx.set(899, "fail", fmt.Sprintf("尾帧状态异常 checks=%v", c899))
	}
}
