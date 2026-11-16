// Package template 为 Agent 视频工作室（video 域）提供「布局模板 × 主题预设」层：
// 纯函数包，输入卡片内容 + 主题，输出可直接塞进 videoapp.IR.Elements 的元素数组。
// 不碰 DB、不碰 HTTP；「剧本→视频」生成器（批B）按本包导出的契约消费。
//
// 与批B的契约（稳定约定，改动需同步批B）：
//   - idx 为 1 基（首张卡片 idx=1），total 为总卡片数，恒有 1 <= idx <= total；
//   - window 为该卡片在全局时间线上的帧窗口（含首含尾），生成器算好传入；
//     Apply 输出的每个元素 StartFrame/EndFrame 都等于该窗口；
//   - z 分层：背景 0 / 内容 10 / 强调 20。个别必须压在强调色块上方的文字
//     （endcard 的 CTA 文字）同为 20，靠切片内文档序保证渲染在上层；
//   - 全画布背景 shape（z=0）铺满整个画布，是「内容几何都在 SafeMargin 内」
//     这条规则的唯一例外 —— 背景若也内缩，画布四周会露出播放器默认黑底
//     （projector 的 #stage 是 #000）。z>0 的元素全部严格落在安全区内；
//   - 元素 ID 形如 tpl_<role>_<idx>_<name>（如 tpl_listicle_03_item_1），
//     全局唯一 —— 生成器把多张卡片的元素拼进同一份 IR 时不会撞 ID
//     （IR 的 effect.targetElementId 按 ID 寻址，DOM 里 id 重复会砸定位）；
//   - 卡片顺序号展示（cover 进度点、listicle 序号、chart 序号）都以 idx
//     直接呈现，第 idx 个位置高亮/计数。
package template

import (
	"fmt"
	"math"
	"strings"
)

// z 分层：背景(0) < 内容(10) < 强调(20)。
const (
	layerBG      = 0
	layerContent = 10
	layerAccent  = 20
)

// Theme 主题：配色 + 字号缩放。四套内置（ink / midnight / vigoro / pastel）。
type Theme struct {
	Key       string  // "ink" | "midnight" | "vigoro" | "pastel"
	Name      string  // 展示名
	BG        string  // 背景 hex，如 "#FAF6EF"
	FG        string  // 主文字 hex
	Accent    string  // 强调色 hex
	Muted     string  // 次要文字 hex
	FontScale float64 // 字号倍率，1.0 基准
}

// Template 模板：一种卡片版式。六套内置
// （cover / listicle / feature / chart / quote / endcard；首末卡片由生成器选 cover/endcard）。
type Template struct {
	Key              string // "cover" | "listicle" | "feature" | "chart" | "quote" | "endcard"
	Name             string
	Description      string
	CanvasW, CanvasH int // 默认 1080×1920
	FPS              int // 30
	SafeMargin       int // 安全区边距 px（内容元素不得越出）
}

// Card 一张卡片的内容。Role 决定用哪套版式渲染（同 Template.Key）。
type Card struct {
	Role     string    // 同 Template.Key
	Title    string    // 标题（quote 版式当署名用）
	Body     string    // 正文/引言/CTA（按版式取用；chart 传数值时存 "标签:值,标签:值"）
	Items    []string  // listicle 条目 或 chart 数据标签
	Values   []float64 // chart 柱值（可选；空则从 Body 解析，再不行报错）
	ImageKey string    // 可选已上传素材 storage key（feature 版式用；video/<workspace>/ 前缀）
}

// builtinTemplates 六套内置版式。几何基准一律 1080×1920 竖版。
var builtinTemplates = []Template{
	{
		Key: "cover", Name: "大字报封面",
		Description: "特大标题 + accent 下划线 + 副标题 + 底部进度点，用于首卡",
		CanvasW:     1080, CanvasH: 1920, FPS: 30, SafeMargin: 96,
	},
	{
		Key: "listicle", Name: "清单卡",
		Description: "accent 大序号 + 标题 + 带 accent 短横的条目行",
		CanvasW:     1080, CanvasH: 1920, FPS: 30, SafeMargin: 96,
	},
	{
		Key: "feature", Name: "图文卡",
		Description: "上半区图 + 下半区标题正文；无图时全文字居中",
		CanvasW:     1080, CanvasH: 1920, FPS: 30, SafeMargin: 96,
	},
	{
		Key: "chart", Name: "数据卡",
		Description: "标题 + 3-6 根 accent 竖柱，柱顶数值柱底类目标签，右上角序号",
		CanvasW:     1080, CanvasH: 1920, FPS: 30, SafeMargin: 96,
	},
	{
		Key: "quote", Name: "引言卡",
		Description: "大引号装饰 + 居中引言大字 + muted 署名",
		CanvasW:     1080, CanvasH: 1920, FPS: 30, SafeMargin: 96,
	},
	{
		Key: "endcard", Name: "关注卡",
		Description: "标题 + accent 实心圆角框包 CTA 文案，用于末卡",
		CanvasW:     1080, CanvasH: 1920, FPS: 30, SafeMargin: 96,
	},
}

// builtinThemes 四套内置主题，全部通过 Validate 的 WCAG 对比度硬门槛
// （BG:FG / BG:Accent >= 4.5:1，BG:Muted >= 3:1 —— 历史教训：白字奶白底
// 对比度 1.06:1 全遮挡惨案）。
var builtinThemes = []Theme{
	{
		Key: "ink", Name: "墨纸",
		BG: "#FAF6EF", FG: "#1F1B16", Accent: "#C4402F", Muted: "#6B6459",
		FontScale: 1.0,
	},
	{
		Key: "midnight", Name: "深夜",
		BG: "#0E1A2B", FG: "#F5F8FC", Accent: "#3EC1D3", Muted: "#8FA3BC",
		FontScale: 1.0,
	},
	{
		Key: "vigoro", Name: "活力黄",
		BG: "#FFD60A", FG: "#1A1A1A", Accent: "#A4161A", Muted: "#6B6459",
		FontScale: 1.0,
	},
	{
		Key: "pastel", Name: "粉彩",
		BG: "#FBE7EE", FG: "#3A3540", Accent: "#7C3AED", Muted: "#7A6C74",
		FontScale: 1.0,
	},
}

// Catalog 返回全部内置版式（副本；调用方改动不影响内置目录）。
func Catalog() []Template {
	out := make([]Template, len(builtinTemplates))
	copy(out, builtinTemplates)
	return out
}

// ThemeCatalog 返回全部内置主题（副本）。
func ThemeCatalog() []Theme {
	out := make([]Theme, len(builtinThemes))
	copy(out, builtinThemes)
	return out
}

// Get 按 key 取版式。
func Get(key string) (Template, bool) {
	for _, t := range builtinTemplates {
		if t.Key == key {
			return t, true
		}
	}
	return Template{}, false
}

// GetTheme 按 key 取主题。
func GetTheme(key string) (Theme, bool) {
	for _, th := range builtinThemes {
		if th.Key == key {
			return th, true
		}
	}
	return Theme{}, false
}

// ---- 对比度硬门槛（WCAG 相对亮度）----

// 对比度门槛：正文/强调 >= 4.5:1，辅助文字 >= 3:1；FontScale 允许区间。
const (
	contrastText  = 4.5
	contrastMuted = 3.0
	maxFontScale  = 2.0
	minFontScale  = 0.5
)

// Validate 校验主题可用性：四个颜色都是合法 hex、FontScale 在
// [0.5, 2.0]、BG:FG 与 BG:Accent 对比度 >= 4.5:1、BG:Muted >= 3:1。
// Apply 内部会先调用本函数，不过门槛直接报错。
func Validate(th Theme) error {
	colors := map[string]string{
		"BG": th.BG, "FG": th.FG, "Accent": th.Accent, "Muted": th.Muted,
	}
	for _, name := range []string{"BG", "FG", "Accent", "Muted"} {
		if _, err := parseHex(colors[name]); err != nil {
			return fmt.Errorf("theme %s: %s: %w", th.Key, name, err)
		}
	}
	if th.FontScale < minFontScale || th.FontScale > maxFontScale {
		return fmt.Errorf("theme %s: FontScale %.2f outside [%v, %v]",
			th.Key, th.FontScale, minFontScale, maxFontScale)
	}
	bg, _ := parseHex(th.BG)
	checks := []struct {
		name    string
		hex     string
		minimum float64
	}{
		{"FG", th.FG, contrastText},
		{"Accent", th.Accent, contrastText},
		{"Muted", th.Muted, contrastMuted},
	}
	for _, c := range checks {
		fg, _ := parseHex(c.hex)
		ratio := contrastRatio(bg, fg)
		if ratio < c.minimum {
			return fmt.Errorf("theme %s: contrast BG:%s = %.2f:1 is below %.1f:1 (the 1.06:1 full-occlusion incident)",
				th.Key, c.name, ratio, c.minimum)
		}
	}
	return nil
}

// parseHex 解析 "#RRGGBB"（# 可省略，大小写均可）。
func parseHex(s string) ([3]float64, error) {
	var out [3]float64
	s = strings.TrimPrefix(s, "#")
	if len(s) != 6 {
		return out, fmt.Errorf("hex %q must be #RRGGBB", s)
	}
	for i := 0; i < 3; i++ {
		hi, ok1 := hexVal(rune(s[i*2]))
		lo, ok2 := hexVal(rune(s[i*2+1]))
		if !ok1 || !ok2 {
			return out, fmt.Errorf("hex %q has a non-hex digit", s)
		}
		out[i] = float64(hi*16+lo) / 255
	}
	return out, nil
}

func hexVal(r rune) (int, bool) {
	switch {
	case r >= '0' && r <= '9':
		return int(r - '0'), true
	case r >= 'a' && r <= 'f':
		return int(r-'a') + 10, true
	case r >= 'A' && r <= 'F':
		return int(r-'A') + 10, true
	}
	return 0, false
}

// relLum WCAG 相对亮度。
func relLum(c [3]float64) float64 {
	lin := make([]float64, 3)
	for i, v := range c {
		if v <= 0.03928 {
			lin[i] = v / 12.92
		} else {
			lin[i] = math.Pow((v+0.055)/1.055, 2.4)
		}
	}
	return 0.2126*lin[0] + 0.7152*lin[1] + 0.0722*lin[2]
}

// contrastRatio 亮暗两色按 WCAG 公式求对比度。
func contrastRatio(a, b [3]float64) float64 {
	la, lb := relLum(a), relLum(b)
	if la < lb {
		la, lb = lb, la
	}
	return (la + 0.05) / (lb + 0.05)
}
