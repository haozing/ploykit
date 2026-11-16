// Package scriptgen 把一段剧本文案 + 模板 + 主题合成为完整可渲染 IR 的
// 服务端管线（零 IR 手写）：分卡 → 关键词高亮 → 时间窗口 → 组装。
//
// 依赖方向（受 Go 包环约束）：scriptgen → {template, videoapp}。
// videoapp 自身不反向 import 本包（template/scriptgen 都 import videoapp，
// 反向依赖即成环），service 侧的集成通过 app/compose.go 的 ScriptComposer
// 函数形态注入：handler / MCP 一行 scriptgen.Prepare(...) 即可接线。
package scriptgen

import (
	"fmt"
	"strings"

	"github.com/haozing/ploykit/platform/webx"

	"myproduct/internal/video/app/template"
)

// 分卡数量边界（案例库：卡片数 2-20，超限报可读错误）。
const (
	MinCards = 2
	MaxCards = 20
)

// inval 把管线参数错误映射为既有错误码族 E_VIDEO_IR_INVALID（不新增码族）。
func inval(msg string) error {
	return webx.NewError(400, "E_VIDEO_IR_INVALID", msg)
}

// block 是分卡的中间形态：一个空行分隔的段落组。
type block struct {
	title  string   // 首行（去 markdown 符号后）
	body   []string // 其余非 bullet 行
	items  []string // bullet 行（-/·/1. 列表项，去符号后）
	weight int      // 非空白 rune 数（词表按比例分配的权重）
}

// parseBlocks 按空行把剧本文案分组为段落块。中文 aware：逐行处理，
// 行内去 markdown 符号（#/## 标题、-/*/数字. 列表符、**粗体**、`代码`），
// 空白行切块，空块丢弃。
func parseBlocks(script string) []block {
	lines := strings.Split(strings.ReplaceAll(script, "\r\n", "\n"), "\n")
	var blocks []block
	var cur *block
	flush := func() {
		if cur != nil {
			blocks = append(blocks, *cur)
			cur = nil
		}
	}
	for _, line := range lines {
		text, isBullet := stripMarkdownLine(line)
		if text == "" {
			flush()
			continue
		}
		if cur == nil {
			cur = &block{}
		}
		if isBullet {
			cur.items = append(cur.items, text)
		} else if cur.title == "" {
			cur.title = text
		} else {
			cur.body = append(cur.body, text)
		}
	}
	flush()
	for i := range blocks {
		b := &blocks[i]
		b.weight = runeWeight(b.title) + runeWeight(strings.Join(b.body, "")) + runeWeight(strings.Join(b.items, ""))
	}
	return blocks
}

// stripMarkdownLine 去掉一行的 markdown 结构符号，返回 (纯文本, 是否列表项)。
func stripMarkdownLine(line string) (string, bool) {
	s := strings.TrimSpace(line)
	if s == "" {
		return "", false
	}
	isBullet := false
	// ATX 标题：# / ## / ### ...
	trimmed := strings.TrimLeft(s, "#")
	if len(trimmed) < len(s) {
		s = strings.TrimSpace(trimmed)
	}
	// 无序列表：- / * / + ·
	for _, marker := range []string{"- ", "* ", "+ ", "· "} {
		if strings.HasPrefix(s, marker) {
			s = strings.TrimSpace(strings.TrimPrefix(s, marker))
			isBullet = true
			break
		}
	}
	// 有序列表：1. / 1) / 1、（顿号是全角 rune——按 rune 扫描，不做字节比较）
	if !isBullet {
		runes := []rune(s)
		i := 0
		for i < len(runes) && runes[i] >= '0' && runes[i] <= '9' {
			i++
		}
		if i > 0 && i < len(runes) {
			mark := runes[i]
			// ASCII 标记（./)）后须跟空白（避免吃掉「3.5 版本」这类小数）；
			// 全角顿号是中文排版独有，后跟文字（无空格）也算列表。
			afterOK := i+1 < len(runes) && (runes[i+1] == ' ' || runes[i+1] == '\t')
			if (mark == '.' || mark == ')') && afterOK {
				s = strings.TrimSpace(string(runes[i+1:]))
				isBullet = true
			} else if mark == '、' {
				s = strings.TrimSpace(string(runes[i+1:]))
				isBullet = true
			}
		}
	}
	// 行内标记：粗体/斜体星号、行内代码反引号
	s = strings.ReplaceAll(s, "*", "")
	s = strings.ReplaceAll(s, "`", "")
	return strings.TrimSpace(s), isBullet
}

func runeWeight(s string) int {
	n := 0
	for _, r := range s {
		if r == ' ' || r == '\t' || r == '\n' {
			continue
		}
		n++
	}
	return n
}

func joinBody(b block) string { return strings.Join(b.body, "\n") }

// paragraphText 一个块的整段文本：标题行 + 正文行（bullet 不进正文——
// listicle 版式单独消费 Items）。封面/结尾卡的 Body 用整段（单段落块
// 的文本都在 title 里，joinBody 会拿到空）。
func paragraphText(b block) string {
	parts := make([]string, 0, 1+len(b.body))
	if b.title != "" {
		parts = append(parts, b.title)
	}
	parts = append(parts, b.body...)
	return strings.Join(parts, "\n")
}

// SplitCards 把剧本文案分成为模板 Apply 准备的卡片序列：
// 首卡 Role=cover（Title=首段，Body=次段可选——段落数 ≥3 时吸收次段）；
// 中间卡 listicle（有 ≥2 个列表项）/ feature（纯标题+正文）；末卡 Role=endcard
// （批A endcard 版式要求 Body 非空——作为 CTA 文案渲染，空尾段时以标题
// 文本回填）。卡片数 2-20，超限报可读错误（E_VIDEO_IR_INVALID）。
func SplitCards(script string) ([]template.Card, error) {
	blocks := parseBlocks(script)
	if len(blocks) < MinCards {
		return nil, inval(fmt.Sprintf(
			"script: 剧本分卡后仅 %d 个段落，至少需要 %d 段（封面 + 正文 + 结尾）——请按空行分段后重试",
			len(blocks), MinCards))
	}
	if len(blocks) > MaxCards {
		return nil, inval(fmt.Sprintf(
			"script: 剧本分卡后共 %d 个段落，超出上限 %d——请压缩文案或拆分为多个项目",
			len(blocks), MaxCards))
	}
	endCard := func(b block) template.Card {
		c := template.Card{Role: "endcard", Title: b.title, Body: paragraphText(b)}
		if strings.TrimSpace(c.Body) == "" {
			// endcard 版式：Body 是 CTA 文案（必填）。尾段无正文时以标题回填
			// ——渲染语义上「到此结束」本身就是号召语。
			c.Body = b.title
		}
		return c
	}
	var cards []template.Card
	if len(blocks) == 2 {
		// 两段：封面吃首段（Body=次段可选中的"可选"——次段留给结尾卡更自然）
		cards = append(cards,
			template.Card{Role: "cover", Title: blocks[0].title},
			endCard(blocks[1]),
		)
		return cards, nil
	}
	cover := template.Card{Role: "cover", Title: blocks[0].title, Body: paragraphText(blocks[1])}
	cards = append(cards, cover)
	for _, b := range blocks[2 : len(blocks)-1] {
		cards = append(cards, middleCard(b))
	}
	last := blocks[len(blocks)-1]
	cards = append(cards, endCard(last))
	return cards, nil
}

func middleCard(b block) template.Card {
	role := "feature"
	if len(b.items) >= 2 {
		role = "listicle"
	}
	return template.Card{
		Role:  role,
		Title: b.title,
		Body:  joinBody(b),
		Items: b.items,
	}
}

// cardWeights 每卡的非空白 rune 权重（词表→卡片按比例分配的依据，
// 与 videoapp.EstimateWords 的字数权重口径一致）。
func cardWeights(cards []template.Card) []int {
	out := make([]int, len(cards))
	for i, c := range cards {
		w := runeWeight(c.Title) + runeWeight(c.Body)
		for _, it := range c.Items {
			w += runeWeight(it)
		}
		if w <= 0 {
			w = 1
		}
		out[i] = w
	}
	return out
}

// cardText 返回参与关键词抽取的正文（Body 优先，空则退回 Title——封面/结尾卡常无正文）。
func cardText(c template.Card) string {
	if strings.TrimSpace(c.Body) != "" {
		return c.Body
	}
	return c.Title
}
