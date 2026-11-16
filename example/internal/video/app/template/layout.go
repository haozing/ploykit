package template

import (
	"fmt"
	"math"
	"strings"
	"unicode/utf8"

	videoapp "myproduct/internal/video/app"
)

// 版式基准字号（1080 宽画布，FontScale=1.0）。实际字号 = 基准 × th.FontScale。
const (
	baseCoverTitle   = 110.0 // cover 特大标题（契约上限）
	baseCoverSub     = 40.0  // cover 副标题
	baseSectionTitle = 64.0  // listicle/feature/chart/endcard 通用标题
	baseBody         = 40.0  // feature 正文
	baseListTitle    = 30.0  // listicle 条目文字
	baseChartLabel   = 30.0  // chart 柱底类目标签
	baseChartValue   = 34.0  // chart 柱顶数值
	baseQuote        = 68.0  // 引言大字
	baseQuoteMark    = 140.0 // 装饰引号
	baseSignature    = 34.0  // quote 署名
	baseCTA          = 48.0  // endcard CTA 文案
)

// maxCoverTitleLines / maxQuoteLines：自动缩行的行数硬上限，超出报错。
const (
	maxCoverTitleLines = 3
	maxQuoteLines      = 4
)

// Apply 把一张卡片渲染成可直接塞进 IR.Elements 的元素数组。
//
// idx 为 1 基（首张 idx=1），total 为总卡片数，恒有 1 <= idx <= total；
// window 是该卡片的帧窗口（含首含尾），输出的每个元素
// StartFrame/EndFrame 都等于该窗口。z 分层：背景 0 / 内容 10 / 强调 20
// （endcard 的 CTA 文字同为 20，靠切片内文档序保证画在色块之上）。
//
// 全画布背景 shape（z=0）是安全区的唯一例外：它必须铺满整个画布，
// 否则四周会露出播放器默认黑底（projector 的 #stage 是 #000）；
// 其余元素全部严格落在 SafeMargin 内。
// 返回前统一断言：z>0 元素几何 ⊆ 安全区、W/H 均为偶数。
func Apply(t Template, th Theme, card Card, idx, total int, window [2]int) ([]videoapp.Element, error) {
	if err := Validate(th); err != nil {
		return nil, err
	}
	if total < 1 {
		return nil, fmt.Errorf("template: total must be >= 1, got %d", total)
	}
	if idx < 1 || idx > total {
		return nil, fmt.Errorf("template: idx %d out of range [1, %d]", idx, total)
	}
	if t.CanvasW <= 0 || t.CanvasH <= 0 {
		return nil, fmt.Errorf("template %s: canvas %dx%d must be positive", t.Key, t.CanvasW, t.CanvasH)
	}
	if t.SafeMargin < 0 || t.SafeMargin*2 >= t.CanvasW || t.SafeMargin*2 >= t.CanvasH {
		return nil, fmt.Errorf("template %s: SafeMargin %d leaves no drawable area on %dx%d",
			t.Key, t.SafeMargin, t.CanvasW, t.CanvasH)
	}
	if window[0] < 0 || window[1] < window[0] {
		return nil, fmt.Errorf("template: invalid window [%d, %d]", window[0], window[1])
	}

	r := &renderer{t: t, th: th, card: card, idx: idx, total: total}
	var err error
	switch card.Role {
	case "cover":
		err = r.cover()
	case "listicle":
		err = r.listicle()
	case "feature":
		err = r.feature()
	case "chart":
		err = r.chart()
	case "quote":
		err = r.quote()
	case "endcard":
		err = r.endcard()
	default:
		return nil, fmt.Errorf("template: unknown role %q (must be one of cover|listicle|feature|chart|quote|endcard)", card.Role)
	}
	if err != nil {
		return nil, err
	}

	// 出口统一收尾：窗口指针 + 偶数宽高 + 安全区断言（z>0）。
	for i := range r.elems {
		el := &r.elems[i]
		start, end := window[0], window[1]
		el.StartFrame = &start
		el.EndFrame = &end
		el.W = evenUp(el.W)
		el.H = evenUp(el.H)
		if el.Z > 0 {
			if err := insideSafe(i, el, t); err != nil {
				return nil, err
			}
		}
	}
	return r.elems, nil
}

// renderer 累积一张卡片的元素。
type renderer struct {
	t     Template
	th    Theme
	card  Card
	idx   int
	total int
	elems []videoapp.Element
}

// add 追加元素并按「tpl_<role>_<idx 二位>_<name>」赋全局唯一 ID。
// 多张卡片拼进同一份 IR 时不撞 ID（effect.targetElementId / DOM id 按 ID 寻址）。
func (r *renderer) add(name string, el videoapp.Element) {
	el.ID = fmt.Sprintf("tpl_%s_%02d_%s", r.card.Role, r.idx, name)
	r.elems = append(r.elems, el)
}

// fs 基准字号 × 主题 FontScale，保留一位小数。
func (r *renderer) fs(base float64) float64 {
	return math.Round(base*r.th.FontScale*10) / 10
}

// titleLines 自动缩行：按视觉宽度（CJK 记 1、其余记 0.5）贪心断行，
// 已有显式 "\n" 的段落先分段。返回 nil 表示超出行数上限（caller 报错）；
// 空串返回 nil。断行用 "\n" 拼接 —— 投影端 .el-text 是 white-space:pre-wrap，
// 多行按既有语义逐行渲染（builder 仅透传 text，无对齐字段；左对齐即 IR
// 的默认行为，模板不发明 IR 之外的字段）。
func titleLines(s string, maxChars float64, maxLines int) []string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	var lines []string
	for _, seg := range strings.Split(s, "\n") {
		var cur strings.Builder
		var w float64
		for _, ru := range seg {
			rw := 0.5
			if isWide(ru) {
				rw = 1
			}
			if w+rw > maxChars && cur.Len() > 0 {
				lines = append(lines, cur.String())
				cur.Reset()
				w = 0
			}
			cur.WriteRune(ru)
			w += rw
		}
		if cur.Len() > 0 {
			lines = append(lines, cur.String())
		}
	}
	if len(lines) > maxLines {
		return nil
	}
	// 禁则处理：行首不得出现收尾标点（，。、！？；：）等）——断行断在标点前
	// 时把标点拉回上一行行尾（上一行轻微超宽半字，可接受的排版让步）。
	// 实拍教训：封面标题"…手串，十条…"断行后逗号顶行首（promo f40）。
	const forbiddenLead = "，。、！？；：）】」”’,.!?:;)]}"
	for i := 1; i < len(lines); i++ {
		for lines[i] != "" {
			r := []rune(lines[i])
			if !strings.ContainsRune(forbiddenLead, r[0]) {
				break
			}
			lines[i-1] += string(r[0])
			lines[i] = string(r[1:])
		}
		if lines[i] == "" {
			lines = append(lines[:i], lines[i+1:]...)
			i--
		}
	}
	if len(lines) > maxLines {
		return nil
	}
	return lines
}

// isWide 近似判定 CJK 全宽字符（东亚宽度 W/F 的常见区段足够覆盖标题文案）。
func isWide(r rune) bool {
	switch {
	case r >= 0x2E80 && r <= 0x9FFF: // 部首、CJK 符号标点、汉字
		return true
	case r >= 0xF900 && r <= 0xFAFF: // CJK 兼容表意
		return true
	case r >= 0xFF00 && r <= 0xFFEF: // 全角形式
		return true
	}
	return false
}

// evenUp 向上取整到偶数（整像素对齐；模板层保证，不依赖下游取整）。
func evenUp(v float64) float64 {
	if v <= 0 {
		return 0
	}
	n := int64(math.Ceil(v))
	if n%2 != 0 {
		n++
	}
	return float64(n)
}

// insideSafe 断言元素（含全部四边）落在安全区内。溢出时报出具体越界量
// 与元素下标。
func insideSafe(i int, el *videoapp.Element, t Template) error {
	s := float64(t.SafeMargin)
	var over []string
	if el.X < s {
		over = append(over, fmt.Sprintf("x %.0f < %d", el.X, t.SafeMargin))
	}
	if el.Y < s {
		over = append(over, fmt.Sprintf("y %.0f < %d", el.Y, t.SafeMargin))
	}
	if el.X+el.W > float64(t.CanvasW)-s {
		over = append(over, fmt.Sprintf("x+w %.0f > %d", el.X+el.W, t.CanvasW-t.SafeMargin))
	}
	if el.Y+el.H > float64(t.CanvasH)-s {
		over = append(over, fmt.Sprintf("y+h %.0f > %d", el.Y+el.H, t.CanvasH-t.SafeMargin))
	}
	if len(over) > 0 {
		return fmt.Errorf("template: element[%d] %q overflows safe margin: %s", i, el.ID, strings.Join(over, "; "))
	}
	return nil
}

// text 构造一个 text 元素并入库（左上角锚点；居中/缩行由 titleLines 预换行，
// 渲染端 pre-wrap 逐行铺开）。
func (r *renderer) text(name, txt, color string, size float64, x, y, w, h float64, z int) {
	r.add(name, videoapp.Element{
		Type: videoapp.ElementText, Text: txt, Color: color,
		FontSize: size, X: x, Y: y, W: w, H: h, Z: z,
	})
}

// shape 构造一个 shape 元素并入库。IR 的 shape 语义 = 纯色块 + 投影端固定
// 8px 圆角（timeline-builder: node.style.background = color；.el-shape
// { border-radius: 8px }），无描边/独立圆角参数 —— 模板不发明 IR 之外的字段。
func (r *renderer) shape(name, color string, x, y, w, h float64, z int) {
	r.add(name, videoapp.Element{
		Type: videoapp.ElementShape, Color: color,
		X: x, Y: y, W: w, H: h, Z: z,
	})
}

// progressDots 底部细进度点：total 个 16×16 小方块（投影端 8px 圆角在
// 16px 尺寸下呈近圆 —— 契约「小圆点形状」在 IR 现有 shape 语义内的实现），
// 第 idx 枚 accent、其余 muted。总宽超可用区时压缩点距，横排不越出安全区。
func (r *renderer) progressDots(topY float64) {
	const (
		dotSize = 16.0
		dotGap  = 24.0
	)
	n := r.total
	avail := float64(r.t.CanvasW) - 2*float64(r.t.SafeMargin)
	gap := dotGap
	if total := dotSize + gap*float64(n-1); total > avail {
		gap = math.Max(dotSize, (avail-dotSize)/float64(n-1))
	}
	// 压缩后的点距可能是小数：向下取偶，起点也向下取偶，
	// 保证整排只向左收缩、右缘不越过安全区。
	gap = math.Floor(gap/2) * 2
	totalW := dotSize + gap*float64(n-1)
	x0 := math.Floor(((float64(r.t.CanvasW)-totalW)/2)/2) * 2
	for i := 1; i <= n; i++ {
		c := r.th.Muted
		if i == r.idx {
			c = r.th.Accent
		}
		x := x0 + float64(i-1)*gap
		r.shape(fmt.Sprintf("dot_%d", i), c, evenUp(x), topY, dotSize, dotSize, layerAccent)
	}
}

// cover 大字报封面：特大标题（<=110px 基准，自动缩行，最多 3 行超出报错）
// + accent 下划线条 + 副标题（Body）+ 底部进度点。
func (r *renderer) cover() error {
	if strings.TrimSpace(r.card.Title) == "" {
		return fmt.Errorf("template cover: title is required")
	}
	cw := float64(r.t.CanvasW)
	ch := float64(r.t.CanvasH)
	s := float64(r.t.SafeMargin)

	// 背景铺满画布（安全区唯一例外）。
	r.shape("bg", r.th.BG, 0, 0, cw, ch, layerBG)

	// 标题：字号随行数自适应（1 行 110 / 2 行 88 / 3 行 72，均 <=110 基准），
	// 3 行仍装不下报错。
	const titleW = 888 // 1080 − 2×96
	var lines []string
	base := 0.0
	for _, cand := range []float64{110, 88, 72} {
		base = cand
		lines = titleLines(r.card.Title, titleW/cand, maxCoverTitleLines)
		if lines != nil {
			break
		}
	}
	if lines == nil {
		return fmt.Errorf("template cover: title of %d runes exceeds %d lines even at %.0fpx",
			utf8.RuneCountInString(r.card.Title), maxCoverTitleLines, base)
	}

	size := r.fs(base)
	lh := size * 1.3
	blockH := lh * float64(len(lines))
	// 垂直偏上：标题块中心约在 30% 画布高处。
	titleY := evenUp(ch*0.30 - blockH/2)
	r.text("title", strings.Join(lines, "\n"), r.th.FG, size,
		s, titleY, titleW, evenUp(blockH), layerContent)

	// accent 下划线条：紧贴标题块下方。
	underlineY := evenUp(titleY + blockH + 24)
	r.shape("underline", r.th.Accent, s, underlineY, 280, 12, layerAccent)

	// 副标题（Body）在下划线之下；超长截断到 4 行（cover 主角是标题）。
	if strings.TrimSpace(r.card.Body) != "" {
		subSize := r.fs(baseCoverSub)
		sub := titleLines(r.card.Body, 760/subSize, 4)
		if sub == nil {
			full := titleLines(r.card.Body, 760/subSize, 1<<20)
			sub = full[:4]
		}
		subH := subSize * 1.4 * float64(len(sub))
		r.text("subtitle", strings.Join(sub, "\n"), r.th.Muted, subSize,
			s, evenUp(underlineY+12+56), 760, evenUp(subH), layerContent)
	}

	// 底部进度点。
	r.progressDots(ch - s - 48)
	return nil
}

// listicle 清单卡：accent 大序号（第 idx 张）+ 标题 + 带 accent 短横的条目行。
func (r *renderer) listicle() error {
	if strings.TrimSpace(r.card.Title) == "" {
		return fmt.Errorf("template listicle: title is required")
	}
	if len(r.card.Items) == 0 {
		return fmt.Errorf("template listicle: items is required (at least one)")
	}
	if len(r.card.Items) > 8 {
		return fmt.Errorf("template listicle: %d items exceeds max 8", len(r.card.Items))
	}
	cw := float64(r.t.CanvasW)
	ch := float64(r.t.CanvasH)
	s := float64(r.t.SafeMargin)
	r.shape("bg", r.th.BG, 0, 0, cw, ch, layerBG)

	// 大序号：视觉主角，01/02… 零填充两位。
	numSize := r.fs(96)
	r.text("num", fmt.Sprintf("%02d", r.idx), r.th.Accent, numSize,
		s, 160, 240, evenUp(numSize*1.2), layerAccent)

	// 标题在序号右侧、同一基线区。字号随行数自适应
	// （64 → 52 → 44，均 <=64 基准——与 cover 同款降档思路；2 行仍装不下报错）。
	titleX := s + 250
	titleW := cw - titleX - s
	var lines []string
	base := 0.0
	for _, cand := range []float64{baseSectionTitle, 52, 44} {
		base = cand
		lines = titleLines(r.card.Title, titleW/r.fs(cand), 2)
		if lines != nil {
			break
		}
	}
	if lines == nil {
		return fmt.Errorf("template listicle: title too long (max 2 lines even at %.0fpx)", r.fs(base))
	}
	titleSize := r.fs(base)
	titleH := titleSize * 1.3 * float64(len(lines))
	titleY := evenUp(160 + (numSize*1.2-titleH)/2)
	r.text("title", strings.Join(lines, "\n"), r.th.FG, titleSize,
		titleX, titleY, titleW, evenUp(titleH), layerContent)

	// 分隔细线。
	r.shape("divider", r.th.Muted, s, 360, cw-2*s, 4, layerContent)

	// 条目行：leading accent 短横 + 条目文字。
	itemSize := r.fs(baseListTitle)
	rowH := 150.0
	y0 := 430.0
	for i, it := range r.card.Items {
		y := y0 + rowH*float64(i)
		if evenUp(y+rowH) > ch-s {
			return fmt.Errorf("template listicle: %d items overflow the canvas", len(r.card.Items))
		}
		r.shape(fmt.Sprintf("dash_%d", i+1), r.th.Accent, s, evenUp(y+40), 56, 10, layerAccent)
		lines := titleLines(it, (cw-2*s-90)/itemSize, 2)
		if lines == nil {
			return fmt.Errorf("template listicle: item %d too long (max 2 lines at %.0fpx)", i+1, itemSize)
		}
		h := itemSize * 1.4 * float64(len(lines))
		r.text(fmt.Sprintf("item_%d", i+1), strings.Join(lines, "\n"), r.th.FG, itemSize,
			s+90, evenUp(y), cw-2*s-90, evenUp(h), layerContent)
	}
	return nil
}

// feature 图文卡：ImageKey 非空 → 上半区图 + 下半区标题正文；
// 无图 → 全文字垂直居中。
func (r *renderer) feature() error {
	if strings.TrimSpace(r.card.Title) == "" {
		return fmt.Errorf("template feature: title is required")
	}
	cw := float64(r.t.CanvasW)
	ch := float64(r.t.CanvasH)
	s := float64(r.t.SafeMargin)
	r.shape("bg", r.th.BG, 0, 0, cw, ch, layerBG)

	// 标题：字号随行数自适应（64 → 52 → 44，均 <=64 基准；2 行仍装不下报错）。
	titleW := cw - 2*s
	var tLines []string
	tBase := 0.0
	for _, cand := range []float64{baseSectionTitle, 52, 44} {
		tBase = cand
		tLines = titleLines(r.card.Title, titleW/r.fs(cand), 2)
		if tLines != nil {
			break
		}
	}
	if tLines == nil {
		return fmt.Errorf("template feature: title too long (max 2 lines even at %.0fpx)", r.fs(tBase))
	}
	titleSize := r.fs(tBase)
	titleH := titleSize * 1.3 * float64(len(tLines))

	// 正文（两个分支共用校验）。
	bodySize := r.fs(baseBody)
	var bLines []string
	var bodyH float64
	if strings.TrimSpace(r.card.Body) != "" {
		bLines = titleLines(r.card.Body, titleW/bodySize, 6)
		if bLines == nil {
			return fmt.Errorf("template feature: body too long (max 6 lines at %.0fpx)", bodySize)
		}
		bodyH = bodySize * 1.5 * float64(len(bLines))
	}

	if r.card.ImageKey != "" {
		// 图在上半区：安全区内 888×760。src 透传 Card.ImageKey
		//（video/<workspace>/ 前缀；IR 校验拒绝绝对 URL，模板不加工）。
		imgW, imgH := 888.0, 760.0
		imgX := evenUp((cw - imgW) / 2)
		imgY := evenUp(s + 40)
		r.add("img", videoapp.Element{
			Type: videoapp.ElementImage, Src: r.card.ImageKey,
			X: imgX, Y: imgY, W: imgW, H: imgH, Z: layerContent,
		})
		textY := evenUp(imgY + imgH + 64)
		r.text("title", strings.Join(tLines, "\n"), r.th.FG, titleSize,
			s, textY, titleW, evenUp(titleH), layerContent)
		if len(bLines) > 0 {
			r.text("body", strings.Join(bLines, "\n"), r.th.Muted, bodySize,
				s, evenUp(textY+titleH+28), titleW, evenUp(bodyH), layerContent)
		}
		return nil
	}

	// 无图：全文字垂直居中。
	blockH := titleH
	if bodyH > 0 {
		blockH += 48 + bodyH
	}
	y := evenUp((ch - blockH) / 2)
	r.text("title", strings.Join(tLines, "\n"), r.th.FG, titleSize,
		s, y, titleW, evenUp(titleH), layerContent)
	if len(bLines) > 0 {
		r.text("body", strings.Join(bLines, "\n"), r.th.Muted, bodySize,
			s, evenUp(y+titleH+48), titleW, evenUp(bodyH), layerContent)
	}
	return nil
}

// chart 数据卡：标题 + 3-6 根竖柱（高度 ∝ Values 归一化，柱色 accent，
// 柱顶数值 + 柱底类目标签），右上角「idx/total」序号。值全 0 / 超 6 根报错。
func (r *renderer) chart() error {
	if strings.TrimSpace(r.card.Title) == "" {
		return fmt.Errorf("template chart: title is required")
	}
	n := len(r.card.Items)
	if n < 3 || n > 6 {
		return fmt.Errorf("template chart: %d bars out of range [3, 6]", n)
	}
	values := r.card.Values
	if len(values) == 0 {
		// 契约可选路径：Body 存 "标签:值,标签:值"。
		var err error
		values, err = parseValues(r.card.Body, n)
		if err != nil {
			return err
		}
	}
	if len(values) != n {
		return fmt.Errorf("template chart: %d values for %d labels", len(values), n)
	}
	max := 0.0
	for _, v := range values {
		if v < 0 {
			return fmt.Errorf("template chart: negative value %v", v)
		}
		if v > max {
			max = v
		}
	}
	if max <= 0 {
		return fmt.Errorf("template chart: all values are zero (or empty)")
	}

	cw := float64(r.t.CanvasW)
	ch := float64(r.t.CanvasH)
	s := float64(r.t.SafeMargin)
	r.shape("bg", r.th.BG, 0, 0, cw, ch, layerBG)

	// 右上角序号 idx/total。
	idxSize := r.fs(30)
	r.text("idx", fmt.Sprintf("%d/%d", r.idx, r.total), r.th.Muted, idxSize,
		cw-s-160, s, 160, evenUp(idxSize*1.2), layerContent)

	// 标题（给右上角序号留出 180px）。字号自适应 64 → 52 → 44。
	titleW := cw - 2*s
	var tLines []string
	tBase := 0.0
	for _, cand := range []float64{baseSectionTitle, 52, 44} {
		tBase = cand
		tLines = titleLines(r.card.Title, (titleW-180)/r.fs(cand), 2)
		if tLines != nil {
			break
		}
	}
	if tLines == nil {
		return fmt.Errorf("template chart: title too long (max 2 lines even at %.0fpx)", r.fs(tBase))
	}
	titleSize := r.fs(tBase)
	titleH := titleSize * 1.3 * float64(len(tLines))
	r.text("title", strings.Join(tLines, "\n"), r.th.FG, titleSize,
		s, 150, titleW, evenUp(titleH), layerContent)

	// 柱区：垂直 [460, 1560]，柱高按归一化值绘制。整行居中（不从左缘累加）：
	// evenUp 的取整膨胀由居中吸收，末柱右缘不越过安全区。
	const areaTop, areaBottom = 460.0, 1560.0
	labelSize := r.fs(baseChartLabel)
	valueSize := r.fs(baseChartValue)
	const (
		gap    = 40.0
		lblBox = 128.0 // 柱底类目标签盒宽（居中于柱）
	)
	avail := cw - 2*s
	// 向下取偶（不是向上）：保证 rowW = barW*n + gap*(n-1) <= avail，
	// 末柱右缘不越过安全区；行内再居中吸收余量。
	barW := math.Floor((avail-gap*float64(n-1))/float64(n)/2) * 2
	rowW := barW*float64(n) + gap*float64(n-1)
	x0 := evenUp(s + (avail-rowW)/2)
	for i := 0; i < n; i++ {
		x := x0 + float64(i)*(barW+gap)
		cx := x + barW/2
		h := (values[i] / max) * (areaBottom - areaTop)
		if h < 8 {
			h = 8 // 非零最小可见高度
		}
		barY := evenUp(areaBottom - evenUp(h))
		r.shape(fmt.Sprintf("bar_%d", i+1), r.th.Accent, evenUp(x), barY, barW, evenUp(h), layerAccent)
		// 柱底类目标签（FG），单行超宽截断加省略号。
		lbl := r.card.Items[i]
		if visW(lbl, labelSize) > lblBox {
			lbl = truncateToWidth(lbl, labelSize, lblBox)
		}
		r.text(fmt.Sprintf("label_%d", i+1), lbl, r.th.FG, labelSize,
			evenUp(cx-lblBox/2), evenUp(areaBottom+24), lblBox, evenUp(labelSize*1.3), layerContent)
		// 柱顶数值（accent），柱顶上方留 valueSize*1.3+16 高度。
		val := fmt.Sprintf("%g", values[i])
		valBox := math.Max(lblBox, evenUp(visW(val, valueSize)+16))
		r.text(fmt.Sprintf("value_%d", i+1), val, r.th.Accent, valueSize,
			evenUp(cx-valBox/2), evenUp(barY-valueSize*1.3-16), valBox, evenUp(valueSize*1.3), layerContent)
	}
	return nil
}

// parseValues 解析 "标签:值,标签:值"（Body 存数值时的契约形式）。
func parseValues(body string, want int) ([]float64, error) {
	if strings.TrimSpace(body) == "" {
		return nil, fmt.Errorf("template chart: provide Values or Body as \"label:value,...\"")
	}
	var out []float64
	for _, part := range strings.Split(body, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		kv := strings.SplitN(part, ":", 2)
		if len(kv) != 2 {
			return nil, fmt.Errorf("template chart: body segment %q is not \"label:value\"", part)
		}
		var v float64
		if _, err := fmt.Sscanf(strings.TrimSpace(kv[1]), "%g", &v); err != nil {
			return nil, fmt.Errorf("template chart: value %q is not a number", kv[1])
		}
		out = append(out, v)
	}
	if len(out) != want {
		return nil, fmt.Errorf("template chart: body carries %d values, want %d", len(out), want)
	}
	return out, nil
}

// quote 引言卡：大引号装饰 + 引言大字居中（Body）+ muted 署名（Title 当署名用）。
func (r *renderer) quote() error {
	if strings.TrimSpace(r.card.Body) == "" {
		return fmt.Errorf("template quote: body (quote text) is required")
	}
	cw := float64(r.t.CanvasW)
	ch := float64(r.t.CanvasH)
	s := float64(r.t.SafeMargin)
	r.shape("bg", r.th.BG, 0, 0, cw, ch, layerBG)

	quoteSize := r.fs(baseQuote)
	quoteW := cw - 2*s
	lines := titleLines(r.card.Body, quoteW/quoteSize, maxQuoteLines)
	if lines == nil {
		return fmt.Errorf("template quote: quote too long (max %d lines at %.0fpx)", maxQuoteLines, quoteSize)
	}
	quoteH := evenUp(quoteSize * 1.5 * float64(len(lines)))

	markSize := r.fs(baseQuoteMark)
	markH := evenUp(markSize * 0.7)
	sigSize := r.fs(baseSignature)
	var sigH float64
	if strings.TrimSpace(r.card.Title) != "" {
		sigH = evenUp(sigSize * 1.4)
	}

	// 垂直排布：装饰引号 → 引言 → 署名，整块画布垂直居中。
	blockH := markH + 24 + quoteH
	if sigH > 0 {
		blockH += 48 + sigH
	}
	y := evenUp((ch - blockH) / 2)

	r.text("mark", "\u201C", r.th.Accent, markSize,
		s, y, 200, markH, layerAccent)

	quoteY := evenUp(y + markH + 24)
	r.text("quote", strings.Join(lines, "\n"), r.th.FG, quoteSize,
		s, quoteY, quoteW, quoteH, layerContent)

	if sigH > 0 {
		r.text("signature", r.card.Title, r.th.Muted, sigSize,
			s, evenUp(quoteY+quoteH+48), quoteW, sigH, layerContent)
	}
	return nil
}

// endcard 关注卡：标题 + accent 实心圆角框包 CTA 文案（Body）。
// CTA 文字与色块同为 layerAccent（20）：切片内文档序保证文字画在色块之上，
// 不引入 IR 之外的第四层；文字色取 BG，强调色块上必然可读。
func (r *renderer) endcard() error {
	if strings.TrimSpace(r.card.Title) == "" {
		return fmt.Errorf("template endcard: title is required")
	}
	if strings.TrimSpace(r.card.Body) == "" {
		return fmt.Errorf("template endcard: body (CTA text) is required")
	}
	cw := float64(r.t.CanvasW)
	ch := float64(r.t.CanvasH)
	s := float64(r.t.SafeMargin)
	r.shape("bg", r.th.BG, 0, 0, cw, ch, layerBG)

	// 标题居中偏上。字号自适应 64 → 52 → 44。
	titleW := cw - 2*s
	var lines []string
	tBase := 0.0
	for _, cand := range []float64{baseSectionTitle, 52, 44} {
		tBase = cand
		lines = titleLines(r.card.Title, titleW/r.fs(cand), 2)
		if lines != nil {
			break
		}
	}
	if lines == nil {
		return fmt.Errorf("template endcard: title too long (max 2 lines even at %.0fpx)", r.fs(tBase))
	}
	titleSize := r.fs(tBase)
	titleH := titleSize * 1.3 * float64(len(lines))
	titleY := evenUp(ch*0.36 - titleH/2)
	r.text("title", strings.Join(lines, "\n"), r.th.FG, titleSize,
		s, titleY, titleW, evenUp(titleH), layerContent)

	// accent 实心圆角框（投影端固定 8px 圆角）包 CTA 文案。
	ctaSize := r.fs(baseCTA)
	ctaH := evenUp(ctaSize * 1.3)
	boxW := evenUp(600)
	boxH := evenUp(180)
	boxX := evenUp((cw - boxW) / 2)
	boxY := evenUp(ch * 0.60)
	r.shape("cta_box", r.th.Accent, boxX, boxY, boxW, boxH, layerAccent)
	r.text("cta_text", r.card.Body, r.th.BG, ctaSize,
		boxX, evenUp(boxY+(boxH-ctaH)/2), boxW, ctaH, layerAccent)
	return nil
}

// visW 估算一行文本的视觉宽度（CJK 记 1、其余记 0.5，单位：px）。
func visW(s string, fontSize float64) float64 {
	w := 0.0
	for _, ru := range s {
		if isWide(ru) {
			w += 1
		} else {
			w += 0.5
		}
	}
	return w * fontSize
}

// truncateToWidth 按视觉宽度截断并加省略号（… 记 1 字宽）。
func truncateToWidth(s string, fontSize, maxW float64) string {
	const ell = "…"
	runes := []rune(s)
	for n := len(runes); n > 0; n-- {
		cand := string(runes[:n]) + ell
		if visW(cand, fontSize) <= maxW {
			return cand
		}
	}
	return ell
}
