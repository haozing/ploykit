package scriptgen

import (
	"encoding/json"
	"math"

	"myproduct/internal/video/app"
	"myproduct/internal/video/app/template"
)

// mustParams 构造 highlight 的 params JSON（颜色来自主题 Accent）。
// 字面量恒法合法；unmarshal 失败返回 nil（params 缺省 = 渲染端默认色）。
func mustParams(s string) json.RawMessage {
	var m json.RawMessage
	if json.Unmarshal([]byte(s), &m) != nil {
		return nil
	}
	return m
}

// Compose 是纯函数管线终点：剧本 + 模板 + 主题 + 词表 → 完整可渲染 IR。
//
// 词表（words）可为 nil——此时各卡窗口按字数比例估算（fps = 模板 FPS）；
// 词表非空时窗口按词表时间轴换算（ceil 帧口径）。产物必须通过
// videoapp.Validate（组装内部即跑一次，带病 IR 不会离开本函数）。
//
// meta 用模板 Canvas/FPS；durationSec 取词表末词 end（无词表时按总字数 /
// 每秒 4.5 字的中文播报速度估算）。elements = 各卡 template.Apply 顺次拼接
// （窗口互不重叠、顺序衔接），effects = 每卡关键词的 highlight（锚文本
// 必为 script 原词），并跑 ResolveAll 把 resolvedFrom 落盘（Compose 的
// IR 是"已解析"状态，预览/渲染端零额外工作）。
func Compose(script, templateKey, themeKey string, words []videoapp.Word) (videoapp.IR, error) {
	tmpl, ok := template.Get(templateKey)
	if !ok {
		return videoapp.IR{}, inval("template: 未知模板 key「" + templateKey + "」——请先查 GET /api/video/templates 目录")
	}
	th, ok := template.GetTheme(themeKey)
	if !ok {
		return videoapp.IR{}, inval("theme: 未知主题 key「" + themeKey + "」——请先查 GET /api/video/templates 目录")
	}
	cards, err := SplitCards(script)
	if err != nil {
		return videoapp.IR{}, err
	}

	fps := tmpl.FPS
	// durationSec：词表末词 end 优先；无词表时按中文播报速度估算（4.5 字/秒，
	// 与案例库 EstimateWords 的语速假设同量级），下限 3 秒保证 Validate 通过。
	durationSec := 0.0
	if len(words) > 0 {
		durationSec = words[len(words)-1].End
	} else {
		chars := 0
		for _, c := range cards {
			chars += runeWeight(c.Title) + runeWeight(c.Body)
			for _, it := range c.Items {
				chars += runeWeight(it)
			}
		}
		durationSec = float64(chars) / 4.5
		if durationSec < 3 {
			durationSec = 3
		}
	}

	weights := cardWeights(cards)
	windows := computeWindows(cards, weights, words, fps, durationFramesOf(fps, durationSec))

	ir := videoapp.IR{
		Meta: videoapp.Meta{
			FPS:         fps,
			Width:       tmpl.CanvasW,
			Height:      tmpl.CanvasH,
			DurationSec: durationSec,
		},
		Script: script,
		Words:  words,
	}
	total := len(cards)
	elemSeq := 0
	for i, card := range cards {
		// 批A 契约：idx 1 基（1 <= idx <= total）。
		elems, aerr := template.Apply(tmpl, th, card, i+1, total, windows[i])
		if aerr != nil {
			return videoapp.IR{}, inval("template apply: " + aerr.Error())
		}
		for j := range elems {
			elemSeq++
			el := elems[j]
			// 淡入淡出锚在所属卡窗口（windowFades 契约）：window[i] 为
			// [startFrame, endFrame]，与元素窗口同源。
			el.Animations = append(el.Animations, windowFades(elemSeq, windows[i][0], windows[i][1])...)
			ir.Elements = append(ir.Elements, el)
		}
	}
	// 关键词高亮：锚文本 = script 原词；效果时间在 ResolveAll 解析后由
	// resolvedFrom 携带（渲染端 anchorTime(resolvedFrom) 直读）。ID 加序号
	// 去重（同一关键词可能在多卡重复出现，Validate 要求 id 唯一性由去重
	// 效果保证——Validate 本身只查非空，但 MCP/审计视图按 id 归属）。
	for i, a := range KeywordAnchors(script, cards) {
		ir.Effects = append(ir.Effects, videoapp.Effect{
			ID:     "fx_kw_" + itoa(i),
			Anchor: a,
			Type:   videoapp.EffectHighlight,
			Params: mustParams(`{"color":"` + th.Accent + `"}`),
		})
	}
	videoapp.ResolveAll(&ir, nil)
	if verr := videoapp.Validate(&ir); verr != nil {
		return videoapp.IR{}, inval("compose: " + verr.Error())
	}
	return ir, nil
}

// durationFramesOf 与 videoapp.DurationFrames 同口径，但不依赖 IR 实例
// （Compose 尚未组装出 IR）：ceil(durationSec × fps)，至少 1。
// 单一真源在 videoapp.DurationFrames；组装完成后 IR 走全局校验时用的就是它。
func durationFramesOf(fps int, durationSec float64) int {
	if fps <= 0 {
		fps = 30
	}
	n := int(math.Ceil(durationSec * float64(fps)))
	if n < 1 {
		n = 1
	}
	return n
}

// itoa 是 strconv.Itoa 的窄封装（本包唯一数字→字符串位点）。
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

// Prepare 把 Compose 绑定为 app.ScriptComposer 形态——service 集成点
// （app/compose.go 定义该函数类型；videoapp 不能 import 本包——会成环，
// 故用函数注入：main.go / MCP 侧一行 `svc.WithScriptComposer(scriptgen.Prepare, scriptgen.SplitCardInfos)`）。
func Prepare(script, templateKey, themeKey string, words []videoapp.Word) (videoapp.IR, error) {
	return Compose(script, templateKey, themeKey, words)
}

// CardInfo 是卡片摘要的本地投影（role/title）。类型别名不可用（app/
// scriptgen 包环），scriptgen.CardInfo 是独立定义；main.go 注入处以适配
// 闭包映射到 app.CardInfo（字段名一致，三行）。
type CardInfo struct {
	Role  string `json:"role"`
	Title string `json:"title"`
}

// SplitCardInfos 分卡摘要投影（app.CardSplitter 的 scriptgen 实现）：
// 与 Compose 的分卡逻辑同源（SplitCards），摘要与合成永远一致。
// 形态匹配 app.CardSplitter（Go 结构化类型：同字段名/类型即可赋值兼容）。
func SplitCardInfos(script string) ([]CardInfo, error) {
	cards, err := SplitCards(script)
	if err != nil {
		return nil, err
	}
	out := make([]CardInfo, 0, len(cards))
	for _, c := range cards {
		out = append(out, CardInfo{Role: c.Role, Title: c.Title})
	}
	return out, nil
}
