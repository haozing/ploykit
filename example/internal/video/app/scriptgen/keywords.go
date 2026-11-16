package scriptgen

import (
	"strings"
	"unicode"
	"unicode/utf8"

	"myproduct/internal/video/app"
	"myproduct/internal/video/app/template"
)

// 关键词抽取参数（保守取值：每卡 1-2 个锚，跑不爆 MaxEffects=128 的 20 卡上限）。
const (
	maxKeywordsPerCard = 2
	// 关键词原词长度的硬上限（rune）：过长说明匹配到的是句子片段而非词。
	maxKeywordRunes = 12
	// Type-A 拼接运行窗口的最大词数（与 videoapp.anchorCandidates maxRun 对齐，
	// 词表粒度变粗时锚仍可解析为 exact）。
	maxAnchorRun = 6
)

// keywordFrom 用最长匹配从原文中切出 text 对应的原始 substring（锚文本必须是
// script 原词——否则 resolve 会 missing，§7.0 词锚唯一时钟的前提）。
// 返回空串表示匹配悬空（不应发生，防御性兜底）。
func keywordFrom(script, text string) string {
	if text == "" {
		return ""
	}
	if strings.Contains(script, text) {
		return text
	}
	// 理论分支：normalize 变体。保守起见不猜变体、不造词。
	return ""
}

// splitTokens 把一段正文切成用于拼接匹配的 token 序列（中文 aware）：
//   - 连续的"词字符"段（字母/数字/%/_/-）为一个 token（"87%"、"3.5x"）；
//   - 连续的 CJK run：整段为一个 token（与词表估计的 phrase 粒度接近，
//     anchorCandidates 的 Type-B 单词包含匹配可以在粗粒度词表上命中短词）；
//   - 空白与标点跳过。
func splitTokens(s string) []string {
	var out []string
	var cur strings.Builder
	curKind := 0 // 0=无 1=词字符 2=CJK
	flush := func() {
		if cur.Len() > 0 {
			out = append(out, cur.String())
			cur.Reset()
		}
	}
	for _, r := range s {
		kind := 0
		switch {
		case unicode.IsSpace(r):
			kind = 0
		case isCJK(r):
			kind = 2
		case isWordRune(r):
			kind = 1
		default: // 标点/符号：token 边界
			kind = 0
		}
		if kind != curKind {
			flush()
			curKind = kind
		}
		if kind != 0 {
			cur.WriteRune(r)
		}
	}
	flush()
	return out
}

func isWordRune(r rune) bool {
	switch {
	case r == '_' || r == '-' || r == '%' || r == '％':
		return true
	case unicode.IsDigit(r):
		return true
	case unicode.IsLetter(r) && !isCJK(r):
		return true
	}
	return false
}

func isCJK(r rune) bool {
	return unicode.Is(unicode.Han, r) || unicode.Is(unicode.Hiragana, r) ||
		unicode.Is(unicode.Katakana, r) || unicode.Is(unicode.Hangul, r)
}

// isCJKString 判断整串是否以 CJK 字符为主（首字符 CJK 即视为短语 token）。
func isCJKString(s string) bool {
	for _, r := range s {
		if isCJK(r) {
			return true
		}
	}
	return false
}

// keywordRunner 在一段正文里按 token 序列找候选关键词（substring 原文锚点）：
//   - 数字/百分比 token 优先（"87%"、"3.5x"）；
//   - CJK 数字词（"三倍"、"五折"）次之；
//   - 兜底：最长的 CJK token（一个完整短语）。
//
// 返回的文本必然是 text 的 substring（即 script 原词）。
func keywordRunner(text string) []string {
	tokens := splitTokens(text)
	if len(tokens) == 0 {
		return nil
	}
	seen := map[string]bool{}
	var out []string
	add := func(s string) {
		if s == "" || utf8.RuneCountInString(s) > maxKeywordRunes || seen[s] {
			return
		}
		seen[s] = true
		out = append(out, s)
	}
	// 1) 数字/百分比 token
	for _, t := range tokens {
		if strings.ContainsAny(t, "0123456789％%") && !strings.Contains(t, "-") {
			add(t)
			if len(out) >= maxKeywordsPerCard {
				return out
			}
		}
	}
	// 2) CJK 数字词：在 CJK token 内滑窗扫描——run 粒度是整句短语，数量词
	// 埋在里面（"提升了三倍" 里找 "三倍"）。长窗优先，命中最长的数量表达。
	for _, t := range tokens {
		if !isCJKString(t) {
			continue
		}
		found := cjkNumberIn(t)
		if found == "" {
			continue
		}
		add(found)
		if len(out) >= maxKeywordsPerCard {
			return out
		}
	}
	// 3) 兜底：最长 CJK token（短语级锚，远短于整句）
	longest := ""
	for _, t := range tokens {
		if isCJKString(t) && utf8.RuneCountInString(t) > utf8.RuneCountInString(longest) {
			longest = t
		}
	}
	if longest != "" {
		add(longest)
	}
	return out
}

// isCJKNumberish 识别中文数字关键词（数量表达，如 三倍/五折/十年/两成）。
func isCJKNumberish(t string) bool {
	runes := []rune(t)
	if len(runes) == 0 || len(runes) > 4 {
		return false
	}
	return cjkNumberRunes(runes)
}

// cjkNumberIn 在一个 CJK 短语 token 里滑窗扫描数量词（"提升了三倍" → "三倍"），
// 返回最长命中（空串 = 无命中）。窗口 2-4 字，长窗优先。
func cjkNumberIn(s string) string {
	runes := []rune(s)
	for w := 4; w >= 2; w-- {
		for i := 0; i+w <= len(runes); i++ {
			if cjkNumberRunes(runes[i : i+w]) {
				return string(runes[i : i+w])
			}
		}
	}
	return ""
}

// cjkNumberRunes 判定 rune 序列是否构成「数字(+量词)」的数量表达：
// 首字符 ∈ 中文数字，其余字符 ∈ 量词白名单（缩窄防「三体」类作品名误标）。
func cjkNumberRunes(runes []rune) bool {
	if len(runes) == 0 || len(runes) > 4 {
		return false
	}
	nums := map[rune]bool{'零': true, '一': true, '二': true, '两': true, '三': true, '四': true,
		'五': true, '六': true, '七': true, '八': true, '九': true, '十': true, '百': true, '千': true, '万': true, '亿': true}
	if !nums[runes[0]] {
		return false
	}
	for _, r := range runes[1:] {
		switch r {
		case '倍', '折', '成', '位', '年', '天', '秒', '分', '字', '步', '遍', '次', '个', '月', '日', '页', '款', '条', '项', '大', '小', '多', '少':
		default:
			return false
		}
	}
	return true
}

// KeywordAnchors 为每张卡抽 1-2 个关键词，产出 highlight 效果的锚点（只产出
// Anchor，不带时间——时间在 Compose 里由词表统一解析写入 resolvedFrom）。
// 卡片没有可抽文本（空卡）时静默跳过——高亮是增强项，不是必需品。
// 返回的锚文本必然是 script 的 substring（原词），nil = 全部卡都无候选词。
func KeywordAnchors(script string, cards []template.Card) []videoapp.Anchor {
	var out []videoapp.Anchor
	for _, c := range cards {
		taken := 0
		for _, kw := range keywordRunner(cardText(c)) {
			if taken >= maxKeywordsPerCard {
				break
			}
			orig := keywordFrom(script, kw)
			if orig == "" {
				continue
			}
			out = append(out, videoapp.Anchor{Text: orig})
			taken++
		}
	}
	return out
}
