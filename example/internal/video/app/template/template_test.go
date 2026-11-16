package template

import (
	"reflect"
	"strings"
	"testing"

	videoapp "myproduct/internal/video/app"
)

// checkInvariants 全版式通用的不变量断言：窗口指针、偶数宽高、安全区、
// z 分层合法、ID 全局唯一、元素数不超 IR 上限、IR 校验全绿。
func checkInvariants(t *testing.T, tt Template, th Theme, card Card, idx, total int, window [2]int) []videoapp.Element {
	t.Helper()
	elems, err := Apply(tt, th, card, idx, total, window)
	if err != nil {
		t.Fatalf("Apply(%s): unexpected error: %v", tt.Key, err)
	}
	if len(elems) == 0 {
		t.Fatalf("Apply(%s): no elements", tt.Key)
	}
	if len(elems) > videoapp.MaxElements {
		t.Fatalf("Apply(%s): %d elements exceeds IR MaxElements %d", tt.Key, len(elems), videoapp.MaxElements)
	}

	ids := map[string]bool{}
	seenBG := false
	for i, el := range elems {
		// 窗口指针：每个元素 StartFrame/EndFrame 都等于 window（含首含尾）。
		if el.StartFrame == nil || el.EndFrame == nil {
			t.Fatalf("element[%d] %s: window pointers must be set", i, el.ID)
		}
		if *el.StartFrame != window[0] || *el.EndFrame != window[1] {
			t.Fatalf("element[%d] %s: window [%d,%d] != [%d,%d]",
				i, el.ID, *el.StartFrame, *el.EndFrame, window[0], window[1])
		}
		// 偶数宽高。
		if el.W != evenUp(el.W) || el.H != evenUp(el.H) {
			t.Fatalf("element[%d] %s: w/h must be even, got %v x %v", i, el.ID, el.W, el.H)
		}
		// z 分层。
		if el.Z != layerBG && el.Z != layerContent && el.Z != layerAccent {
			t.Fatalf("element[%d] %s: z %d outside {0,10,20}", i, el.ID, el.Z)
		}
		// 安全区：z>0 元素全部 ⊆ [SafeMargin, Canvas−SafeMargin]。
		if el.Z > 0 {
			s := float64(tt.SafeMargin)
			if el.X < s || el.Y < s ||
				el.X+el.W > float64(tt.CanvasW)-s || el.Y+el.H > float64(tt.CanvasH)-s {
				t.Fatalf("element[%d] %s overflows safe margin: x=%v y=%v w=%v h=%v bounds=[%d,%d]",
					i, el.ID, el.X, el.Y, el.W, el.H, tt.SafeMargin, tt.CanvasW-tt.SafeMargin)
			}
		} else {
			// 背景：恰好一块，铺满画布。
			if seenBG {
				t.Fatalf("more than one z=0 background element")
			}
			seenBG = true
			if el.X != 0 || el.Y != 0 || el.W != float64(tt.CanvasW) || el.H != float64(tt.CanvasH) {
				t.Fatalf("bg element must cover the full canvas, got %v,%v %vx%v", el.X, el.Y, el.W, el.H)
			}
		}
		// ID 非空且全局唯一（多卡拼接前提）。
		if el.ID == "" || ids[el.ID] {
			t.Fatalf("element[%d]: id %q empty or duplicated", i, el.ID)
		}
		ids[el.ID] = true
	}
	if !seenBG {
		t.Fatalf("Apply(%s): missing full-canvas bg element", tt.Key)
	}

	// IR write-time 校验全绿（元素字段名/类型/窗口语义与 IR 真实契约对齐
	// 的最终证明 —— 生成器把 Apply 产物直接塞进 IR.Elements）。窗口必须
	// 落在 IR 时长内（DurationFrames = ceil(duration × fps)），给足 120s。
	ir := &videoapp.IR{
		Meta:     videoapp.Meta{FPS: tt.FPS, Width: tt.CanvasW, Height: tt.CanvasH, DurationSec: 120},
		Elements: elems,
	}
	if err := videoapp.Validate(ir); err != nil {
		t.Fatalf("IR.Validate on Apply(%s) output: %v", tt.Key, err)
	}
	return elems
}

// TestApply_SixLayouts 六版式各一卡：元素清单快照（几何/颜色/字号/窗口/z）
// —— 每个版式断言其结构特征元素的存在性与关键属性。
func TestApply_SixLayouts(t *testing.T) {
	const (
		canvasW, canvasH = 1080, 1920
		margin           = 96
	)
	window := [2]int{300, 900}
	ink, _ := GetTheme("ink")

	type expect struct {
		kind  string // text|shape|image
		name  string // ID 中 tpl_<role>_<idx>_ 之后的 name 段
		color string // 期望颜色（空 = 不检查）
		count int    // 期望出现次数
		z     int    // 期望 z（-1 = 不检查）
	}
	find := func(elems []videoapp.Element, e expect) []*videoapp.Element {
		var out []*videoapp.Element
		for i := range elems {
			el := &elems[i]
			if el.Type != e.kind {
				continue
			}
			wantPrefix := "tpl_"
			if !strings.HasPrefix(el.ID, wantPrefix) {
				continue
			}
			// ID 形如 tpl_<role>_<idx>_<name>（name 可含下标，如 dot_3）。
			// 前缀匹配 + 词边界：name "cta_box" 能命中 "cta_box"，
			// name "dot" 能命中 "dot_3" 但不会误中 "divider"。
			rest := strings.TrimPrefix(el.ID, wantPrefix)
			rest = rest[strings.Index(rest, "_")+1:] // drop role
			rest = rest[strings.Index(rest, "_")+1:] // drop idx
			if !strings.HasPrefix(rest, e.name) {
				continue
			}
			if len(rest) != len(e.name) && rest[len(e.name)] != '_' {
				continue
			}
			if e.color != "" && !strings.EqualFold(el.Color, e.color) {
				continue
			}
			if e.z >= 0 && el.Z != e.z {
				continue
			}
			out = append(out, el)
		}
		return out
	}
	expectN := func(elems []videoapp.Element, e expect, layout string) {
		t.Helper()
		got := find(elems, e)
		if len(got) != e.count {
			t.Fatalf("%s: expected %d %s(%s) element(s), got %d", layout, e.count, e.kind, e.name, len(got))
		}
	}

	tplCover, _ := Get("cover")
	coverCard := Card{Role: "cover", Title: "人工智能,\n重塑内容生产", Body: "从剧本到成片的自动化流水线"}
	coverElems := checkInvariants(t, tplCover, ink, coverCard, 1, 8, window)
	expectN(coverElems, expect{"shape", "bg", ink.BG, 1, layerBG}, "cover")
	expectN(coverElems, expect{"text", "title", ink.FG, 1, layerContent}, "cover")
	expectN(coverElems, expect{"shape", "underline", ink.Accent, 1, layerAccent}, "cover")
	expectN(coverElems, expect{"text", "subtitle", ink.Muted, 1, layerContent}, "cover")
	// 进度点：8 枚（total=8），第 1 枚 accent。
	expectN(coverElems, expect{"shape", "dot", ink.Muted, 7, layerAccent}, "cover")
	expectN(coverElems, expect{"shape", "dot", ink.Accent, 1, layerAccent}, "cover")
	// 标题字号：显式 \n 两段各自单行装下（maxChars≈8 @110px），
	// 首个候选 110 即满足 ≤3 行，故取 110。
	for _, el := range coverElems {
		if el.Type == videoapp.ElementText && strings.HasSuffix(el.ID, "_title") {
			if el.FontSize != 110 {
				t.Fatalf("cover title fontSize = %v, want 110", el.FontSize)
			}
			if !strings.Contains(el.Text, "\n") {
				t.Fatalf("cover title should be pre-wrapped with \\n, got %q", el.Text)
			}
		}
	}

	tplList, _ := Get("listicle")
	listCard := Card{Role: "listicle", Title: "三个效率习惯", Items: []string{"先写提纲再动笔", "番茄钟工作法", "每天复盘十五分钟"}}
	listElems := checkInvariants(t, tplList, ink, listCard, 3, 10, window)
	expectN(listElems, expect{"text", "num", ink.Accent, 1, layerAccent}, "listicle")
	if listElems[1].Text != "03" {
		t.Fatalf("listicle num = %q, want \"03\" (idx=3)", listElems[1].Text)
	}
	expectN(listElems, expect{"shape", "dash", ink.Accent, 3, layerAccent}, "listicle")
	expectN(listElems, expect{"text", "item", ink.FG, 3, layerContent}, "listicle")

	tplFeat, _ := Get("feature")
	featCard := Card{Role: "feature", Title: "产品截图解读", Body: "工作台左侧是任务流", ImageKey: "video/ws1/shot.png"}
	featElems := checkInvariants(t, tplFeat, ink, featCard, 2, 10, window)
	expectN(featElems, expect{"image", "img", "", 1, layerContent}, "feature")
	if featElems[1].Src != "video/ws1/shot.png" {
		t.Fatalf("feature img src = %q, want ImageKey passthrough", featElems[1].Src)
	}

	tplChart, _ := Get("chart")
	chartCard := Card{Role: "chart", Title: "季度产出", Items: []string{"Q1", "Q2", "Q3", "Q4"}, Values: []float64{20, 45, 60, 90}}
	chartElems := checkInvariants(t, tplChart, ink, chartCard, 5, 10, window)
	expectN(chartElems, expect{"shape", "bar", ink.Accent, 4, layerAccent}, "chart")
	expectN(chartElems, expect{"text", "label", ink.FG, 4, layerContent}, "chart")
	expectN(chartElems, expect{"text", "value", ink.Accent, 4, layerContent}, "chart")
	expectN(chartElems, expect{"text", "idx", ink.Muted, 1, layerContent}, "chart")
	// 柱高 ∝ 值：90 那根是最高柱。
	var maxH float64
	var maxI int
	for i, el := range chartElems {
		if strings.HasPrefix(el.ID, "tpl_chart_05_bar_") && el.H > maxH {
			maxH, maxI = el.H, i
		}
	}
	if chartElems[maxI].ID != "tpl_chart_05_bar_4" {
		t.Fatalf("tallest bar = %s, want tpl_chart_05_bar_4 (value 90)", chartElems[maxI].ID)
	}

	tplQuote, _ := Get("quote")
	quoteCard := Card{Role: "quote", Body: "简单是可靠的最高境界。", Title: "—— 阿兰·凯"}
	quoteElems := checkInvariants(t, tplQuote, ink, quoteCard, 1, 10, window)
	expectN(quoteElems, expect{"text", "mark", ink.Accent, 1, layerAccent}, "quote")
	expectN(quoteElems, expect{"text", "quote", ink.FG, 1, layerContent}, "quote")
	expectN(quoteElems, expect{"text", "signature", ink.Muted, 1, layerContent}, "quote")

	tplEnd, _ := Get("endcard")
	endCard := Card{Role: "endcard", Title: "下期预告", Body: "关注看下期"}
	endElems := checkInvariants(t, tplEnd, ink, endCard, 10, 10, window)
	expectN(endElems, expect{"shape", "cta_box", ink.Accent, 1, layerAccent}, "endcard")
	expectN(endElems, expect{"text", "cta_text", ink.BG, 1, layerAccent}, "endcard")
	// CTA 文字在色块之后（文档序 → 渲染在上层）。
	var boxIdx, txtIdx = -1, -1
	for i, el := range endElems {
		if el.ID == "tpl_endcard_10_cta_box" {
			boxIdx = i
		}
		if el.ID == "tpl_endcard_10_cta_text" {
			txtIdx = i
		}
	}
	if boxIdx == -1 || txtIdx == -1 || txtIdx < boxIdx {
		t.Fatalf("cta_text (idx %d) must come after cta_box (idx %d) in document order", txtIdx, boxIdx)
	}
}

// TestApply_GeometryAllThemes 六版式 × 四主题全组合几何断言（越界/窗口），
// 快照测试的参数化扩展。
func TestApply_GeometryAllThemes(t *testing.T) {
	window := [2]int{0, 450}
	cards := []Card{
		{Role: "cover", Title: "测试封面标题", Body: "副标题文案"},
		{Role: "listicle", Title: "清单标题", Items: []string{"甲", "乙", "丙", "丁"}},
		{Role: "feature", Title: "图文标题", Body: "正文说明"},
		{Role: "feature", Title: "图文标题", Body: "正文说明", ImageKey: "video/ws/pic.png"},
		{Role: "chart", Title: "数据标题", Items: []string{"A", "B", "C"}, Values: []float64{3, 1, 2}},
		{Role: "quote", Body: "一句值得记住的话。", Title: "署名"},
		{Role: "endcard", Title: "结尾标题", Body: "关注看下期"},
	}
	for _, tk := range []string{"cover", "listicle", "feature", "chart", "quote", "endcard"} {
		tt, _ := Get(tk)
		for _, thk := range []string{"ink", "midnight", "vigoro", "pastel"} {
			th, _ := GetTheme(thk)
			for _, card := range cards {
				if card.Role != tk {
					continue
				}
				checkInvariants(t, tt, th, card, 2, 9, window)
			}
		}
	}
}

// TestContrast_Themes 四套内置主题逐一过对比度硬门槛：
// BG:FG / BG:Accent >= 4.5:1，BG:Muted >= 3:1。
func TestContrast_Themes(t *testing.T) {
	for _, th := range builtinThemes {
		if err := Validate(th); err != nil {
			t.Errorf("theme %s: %v", th.Key, err)
		}
		bg, _ := parseHex(th.BG)
		for name, hex := range map[string]string{"FG": th.FG, "Accent": th.Accent} {
			fg, _ := parseHex(hex)
			if r := contrastRatio(bg, fg); r < 4.5 {
				t.Errorf("theme %s: BG:%s = %.2f:1 < 4.5", th.Key, name, r)
			}
		}
		muted, _ := parseHex(th.Muted)
		if r := contrastRatio(bg, muted); r < 3.0 {
			t.Errorf("theme %s: BG:Muted = %.2f:1 < 3.0", th.Key, r)
		}
	}
}

// TestContrast_RejectsBadTheme 低对比主题必须被拒（历史教训：白字奶白底
// 1.06:1 全遮挡惨案）。
func TestContrast_RejectsBadTheme(t *testing.T) {
	bad := Theme{Key: "ghost", Name: "幽灵", BG: "#FAF6EF", FG: "#FFFFFF",
		Accent: "#C4402F", Muted: "#6B6459", FontScale: 1.0}
	err := Validate(bad)
	if err == nil {
		t.Fatalf("white-on-cream theme must fail the contrast gate")
	}
	if !strings.Contains(err.Error(), "contrast") {
		t.Fatalf("error should mention contrast, got: %v", err)
	}
	// Apply 内部也要拒绝。
	if _, err := Apply(mustGet(t, "cover"), bad, Card{Role: "cover", Title: "标题"}, 1, 1, [2]int{0, 30}); err == nil {
		t.Fatalf("Apply must reject a theme failing the contrast gate")
	}
}

// TestFontScale 字号倍率生效：所有 text 元素字号 = 基准 × FontScale；
// 0.8 与 1.2 主题下 cover 标题字号恰好差 1.5 倍。
func TestFontScale(t *testing.T) {
	card := Card{Role: "cover", Title: "短标题"}
	tpl, _ := Get("cover")
	window := [2]int{0, 60}

	small := Theme{Key: "s", Name: "小", BG: "#0E1A2B", FG: "#F5F8FC", Accent: "#3EC1D3", Muted: "#8FA3BC", FontScale: 0.8}
	large := Theme{Key: "L", Name: "大", BG: "#0E1A2B", FG: "#F5F8FC", Accent: "#3EC1D3", Muted: "#8FA3BC", FontScale: 1.2}

	es, err := Apply(tpl, small, card, 1, 1, window)
	if err != nil {
		t.Fatal(err)
	}
	el, err := Apply(tpl, large, card, 1, 1, window)
	if err != nil {
		t.Fatal(err)
	}
	titleOf := func(elems []videoapp.Element) float64 {
		for _, e := range elems {
			if strings.HasSuffix(e.ID, "_title") && e.Type == videoapp.ElementText {
				return e.FontSize
			}
		}
		t.Fatal("no title element")
		return 0
	}
	fsS, fsL := titleOf(es), titleOf(el)
	// 「短标题」4 字在 110px 基准下单行装下（maxChars≈8），
	// 实际字号 = 110 × 0.8 / 110 × 1.2。
	if fsS != 88 || fsL != 132 {
		t.Fatalf("FontScale not applied: small=%v large=%v", fsS, fsL)
	}
	if fsL/fsS != 1.5 {
		t.Fatalf("ratio %v, want 1.5", fsL/fsS)
	}
	// FontScale 生效后垂直块整体变高：1.5 倍放大时六版式几何仍必须全绿
	//（高度溢出会被 Apply 的出口安全断言拦下）。
	scaleCards := []Card{
		{Role: "cover", Title: "测试封面标题", Body: "副标题文案"},
		{Role: "listicle", Title: "清单标题", Items: []string{"甲", "乙", "丙", "丁"}},
		{Role: "feature", Title: "图文标题", Body: "正文说明"},
		{Role: "chart", Title: "数据标题", Items: []string{"A", "B", "C"}, Values: []float64{3, 1, 2}},
		{Role: "quote", Body: "一句值得记住的话。", Title: "署名"},
		{Role: "endcard", Title: "结尾标题", Body: "关注看下期"},
	}
	big := Theme{Key: "big", Name: "大", BG: "#0E1A2B", FG: "#F5F8FC", Accent: "#3EC1D3", Muted: "#8FA3BC", FontScale: 1.5}
	for _, tk := range []string{"cover", "listicle", "feature", "chart", "quote", "endcard"} {
		tt := mustGet(t, tk)
		for _, card := range scaleCards {
			if card.Role != tk {
				continue
			}
			if _, err := Apply(tt, big, card, 2, 9, window); err != nil {
				t.Errorf("FontScale 1.5 × %s: %v", tk, err)
			}
		}
	}
	// 合法区间外报错。
	if _, err := Apply(tpl, Theme{FontScale: 3.0}, card, 1, 1, window); err == nil {
		t.Fatal("FontScale 3.0 must be rejected")
	}
}

// TestErrors 未知 role / 超长标题 / 越界 idx / 坏窗口 / chart 数据问题报错。
func TestErrors(t *testing.T) {
	tpl, _ := Get("cover")
	ink, _ := GetTheme("ink")
	longTitle := strings.Repeat("很长很长的标题", 20) // 120 CJK 字，3 行也装不下

	cases := []struct {
		name  string
		tpl   Template
		card  Card
		idx   int
		total int
		win   [2]int
	}{
		{"unknown role", tpl, Card{Role: "nope", Title: "t"}, 1, 1, [2]int{0, 30}},
		{"cover title too long", tpl, Card{Role: "cover", Title: longTitle}, 1, 1, [2]int{0, 30}},
		{"listicle no items", mustGet(t, "listicle"), Card{Role: "listicle", Title: "t"}, 1, 1, [2]int{0, 30}},
		{"listicle 9 items", mustGet(t, "listicle"), Card{Role: "listicle", Title: "t", Items: make([]string, 9)}, 1, 1, [2]int{0, 30}},
		{"chart 2 bars", mustGet(t, "chart"), Card{Role: "chart", Title: "t", Items: []string{"a", "b"}, Values: []float64{1, 2}}, 1, 1, [2]int{0, 30}},
		{"chart 7 bars", mustGet(t, "chart"), Card{Role: "chart", Title: "t", Items: make([]string, 7)}, 1, 1, [2]int{0, 30}},
		{"chart all zero", mustGet(t, "chart"), Card{Role: "chart", Title: "t", Items: []string{"a", "b", "c"}, Values: []float64{0, 0, 0}}, 1, 1, [2]int{0, 30}},
		{"chart no data", mustGet(t, "chart"), Card{Role: "chart", Title: "t", Items: []string{"a", "b", "c"}}, 1, 1, [2]int{0, 30}},
		{"idx zero", tpl, Card{Role: "cover", Title: "t"}, 0, 1, [2]int{0, 30}},
		{"idx > total", tpl, Card{Role: "cover", Title: "t"}, 2, 1, [2]int{0, 30}},
		{"negative window", tpl, Card{Role: "cover", Title: "t"}, 1, 1, [2]int{-1, 30}},
		{"end before start", tpl, Card{Role: "cover", Title: "t"}, 1, 1, [2]int{30, 5}},
		{"quote no body", mustGet(t, "quote"), Card{Role: "quote", Title: "署名"}, 1, 1, [2]int{0, 30}},
		{"endcard no CTA", mustGet(t, "endcard"), Card{Role: "endcard", Title: "t"}, 1, 1, [2]int{0, 30}},
	}
	for _, c := range cases {
		_, err := Apply(c.tpl, ink, c.card, c.idx, c.total, c.win)
		if err == nil {
			t.Errorf("%s: expected error, got nil", c.name)
		}
	}
}

// TestChartBodyValues chart 契约可选路径：Body 存 "标签:值,标签:值" 时
// Values 留空也能渲染。
func TestChartBodyValues(t *testing.T) {
	tpl, _ := Get("chart")
	ink, _ := GetTheme("ink")
	card := Card{Role: "chart", Title: "月度产出",
		Items: []string{"一月", "二月", "三月"},
		Body:  "一月:12,二月:30,三月:22"}
	elems, err := Apply(tpl, ink, card, 1, 1, [2]int{0, 90})
	if err != nil {
		t.Fatalf("chart via Body values: %v", err)
	}
	bars := 0
	for _, el := range elems {
		if strings.HasPrefix(el.ID, "tpl_chart_01_bar_") {
			bars++
		}
	}
	if bars != 3 {
		t.Fatalf("bars = %d, want 3", bars)
	}
	// 数量不匹配报错。
	card.Body = "一月:12,二月:30"
	if _, err := Apply(tpl, ink, card, 1, 1, [2]int{0, 90}); err == nil {
		t.Fatal("2 body values for 3 labels must error")
	}
	// 负值报错。
	card.Body = "一月:-1,二月:2,三月:3"
	if _, err := Apply(tpl, ink, card, 1, 1, [2]int{0, 90}); err == nil {
		t.Fatal("negative value must error")
	}
}

// TestCatalog 目录与查询契约。
func TestCatalog(t *testing.T) {
	cats := Catalog()
	if len(cats) != 6 {
		t.Fatalf("Catalog = %d templates, want 6", len(cats))
	}
	keys := map[string]bool{}
	for _, c := range cats {
		keys[c.Key] = true
	}
	for _, want := range []string{"cover", "listicle", "feature", "chart", "quote", "endcard"} {
		if !keys[want] {
			t.Errorf("Catalog missing %q", want)
		}
		if got, ok := Get(want); !ok || got.Key != want {
			t.Errorf("Get(%q) = %v,%v", want, got, ok)
		}
		if _, ok := Get("nope"); ok {
			t.Errorf("Get(nope) must miss")
		}
	}
	// Canvas/FPS/SafeMargin 契约默认值。
	for _, c := range cats {
		if c.CanvasW != 1080 || c.CanvasH != 1920 || c.FPS != 30 || c.SafeMargin != 96 {
			t.Errorf("template %s defaults drifted: %+v", c.Key, c)
		}
	}
	ths := ThemeCatalog()
	if len(ths) != 4 {
		t.Fatalf("ThemeCatalog = %d, want 4", len(ths))
	}
	tkeys := map[string]bool{}
	for _, th := range ths {
		tkeys[th.Key] = true
	}
	for _, want := range []string{"ink", "midnight", "vigoro", "pastel"} {
		if !tkeys[want] {
			t.Errorf("ThemeCatalog missing %q", want)
		}
		if got, ok := GetTheme(want); !ok || got.Key != want {
			t.Errorf("GetTheme(%q) = %v,%v", want, got, ok)
		}
		if _, ok := GetTheme("nope"); ok {
			t.Errorf("GetTheme(nope) must miss")
		}
	}
	// 目录是副本：改返回值不影响内置。
	cats[0].Key = "hacked"
	if again, _ := Get("cover"); again.Key == "hacked" {
		t.Fatal("Catalog must return a copy")
	}
}

// TestTitleLines 缩行工具的行为边界（多卡标题复用的同一语义）。
func TestTitleLines(t *testing.T) {
	// CJK 宽度 1。
	got := titleLines("一二三四五六", 4, 2)
	if !reflect.DeepEqual(got, []string{"一二三四", "五六"}) {
		t.Fatalf("titleLines CJK = %v", got)
	}
	// 显式换行先分段。
	got = titleLines("甲乙\n丙丁", 10, 3)
	if !reflect.DeepEqual(got, []string{"甲乙", "丙丁"}) {
		t.Fatalf("titleLines explicit \\n = %v", got)
	}
	// 超行数上限返回 nil。
	if titleLines("一二三四五六七八", 4, 1) != nil {
		t.Fatal("over-limit must return nil")
	}
	// 空串返回 nil。
	if titleLines("", 10, 3) != nil {
		t.Fatal("empty must return nil")
	}
}

func mustGet(t *testing.T, key string) Template {
	t.Helper()
	tpl, ok := Get(key)
	if !ok {
		t.Fatalf("template %q not found", key)
	}
	return tpl
}
