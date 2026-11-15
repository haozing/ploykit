package videoapp

// Round-3 subtitle fix tests (delivery-audit round2 §5, 2026-11-15): CJK
// line-break gaps — an oversized single word had no hard-split fallback and
// the line break could violate kinsoku (line-initial punctuation, severed
// words). The five evidence samples from
// example/internal/video/testdata/subtitle-report.json (cjk_break_examples,
// round2 5/5) are regression assertions here so they run in every plain
// `go test ./internal/video/app/`.
//
// Caps under test are unchanged (§4.10.3): cue ≤6s, ≤2 lines, ≤16 runes/line.
// What changed is break-point selection: an oversized word hard-splits into
// ≤16-rune chunks with linearly interpolated times, and kinsoku moves
// forbidden characters across the break within a 2-rune over-limit tolerance.

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func mkWord(text string, start, end float64) Word {
	return Word{Text: text, Start: start, End: end, Source: WordSourceTTS}
}

// assertCueShape checks the §4.10.3 caps on every cue: ≤2 lines, each line
// within the rune cap (16, or 16+kinsoku tolerance when allowOver is set),
// and no line-initial forbidden punctuation.
func assertCueShape(t *testing.T, cues []Cue, allowOver bool) {
	t.Helper()
	limit := maxLineRunes
	if allowOver {
		limit = maxLineRunes + kinsokuMaxAdjust
	}
	for i, c := range cues {
		lines := strings.Split(c.Text, "\n")
		require.LessOrEqual(t, len(lines), maxLines, "cue %d line count", i)
		for j, line := range lines {
			assert.LessOrEqual(t, utf8.RuneCountInString(line), limit,
				"cue %d line %d rune cap", i, j)
			if rs := []rune(line); len(rs) > 0 {
				assert.False(t, isLineHeadForbidden(rs[0]),
					"cue %d line %d starts with kinsoku-forbidden %q (kinsoku violation)", i, j, string(rs[0]))
			}
		}
	}
}

// assertWordsIntact fails if any whole (not hard-split) word is severed by a
// line break — i.e. its text does not appear inside a single line of any cue.
// Words longer than maxLineRunes are skipped: they are physically impossible
// to keep on one line, and expandUnits covers them with the hard split.
func assertWordsIntact(t *testing.T, words []Word, cues []Cue) {
	t.Helper()
	for _, w := range words {
		text := strings.TrimSpace(w.Text)
		if utf8.RuneCountInString(text) > maxLineRunes {
			continue
		}
		found := false
		for _, c := range cues {
			for _, line := range strings.Split(c.Text, "\n") {
				if strings.Contains(line, text) {
					found = true
				}
			}
		}
		assert.True(t, found, "word %q must stay intact within a single line; cues=%v", text, cues)
	}
}

// cueRuneTotal counts content runes across all lines of all cues (the SRT
// layer re-joins lines with the newline stripped).
func cueRuneTotal(t *testing.T, cues []Cue) int {
	t.Helper()
	n := 0
	for _, c := range cues {
		for _, line := range strings.Split(c.Text, "\n") {
			n += utf8.RuneCountInString(strings.TrimSpace(line))
		}
	}
	return n
}

// TestKinsoku_EvidenceSamples is the round2 §5 regression set (5/5).
func TestKinsoku_EvidenceSamples(t *testing.T) {
	t.Run("1 shiwubei: 十五杯 no longer severed", func(t *testing.T) {
		words := []Word{
			mkWord("防水杯身一次冲净快", 0, 2),
			mkWord("十五杯", 2, 4),
			mkWord("奶泡多不用擦也干净", 4, 5.9),
		}
		cues := BuildCues(words)
		require.Len(t, cues, 1, "21 runes ≤32, 5.9s ≤6s → one cue")
		assertCueShape(t, cues, false)
		assertWordsIntact(t, words, cues)
		assert.Equal(t, 21, cueRuneTotal(t, cues), "no characters dropped")
		lines := strings.Split(cues[0].Text, "\n")
		assert.False(t, strings.HasSuffix(lines[0], "十") && strings.HasPrefix(lines[1], "五"),
			"十五杯 must not be split across the line break: %q", cues[0].Text)
	})

	t.Run("2 doc-5.14 21-rune single word: every line ≤16", func(t *testing.T) {
		words := []Word{mkWord("产品上线之后口碑暴涨用户复购率翻倍留存提升", 0, 5.5)}
		cues := BuildCues(words)
		require.Len(t, cues, 1)
		assertCueShape(t, cues, false)
		assert.Equal(t, 21, cueRuneTotal(t, cues), "no characters dropped")
	})

	t.Run("3 xiaotuandui E2E: 怎么做 no longer severed", func(t *testing.T) {
		words := []Word{
			mkWord("很多人", 0, 0.4),
			mkWord("问", 0.4, 0.6),
			mkWord("两个人的", 0.6, 1.1),
			mkWord("小团队", 1.1, 1.6),
			mkWord("怎么做", 1.6, 2.1),
			mkWord("工具产品", 2.1, 2.8),
		}
		cues := BuildCues(words)
		require.Len(t, cues, 1)
		assertCueShape(t, cues, false)
		assertWordsIntact(t, words, cues)
		assert.Equal(t, 18, cueRuneTotal(t, cues), "no characters dropped")
	})

	t.Run("4 line-initial comma pulled back to line 1", func(t *testing.T) {
		words := []Word{mkWord("前面九个字加逗号，后面还有十个字了", 0, 4)}
		cues := BuildCues(words)
		require.Len(t, cues, 1)
		assertCueShape(t, cues, false)
		lines := strings.Split(cues[0].Text, "\n")
		require.Len(t, lines, 2)
		assert.False(t, isLineHeadForbidden([]rune(lines[1])[0]),
			"line 2 must not start with the comma: %q", cues[0].Text)
		assert.Equal(t, 17, cueRuneTotal(t, cues), "no characters dropped")
	})

	t.Run("5 over-32-rune single word: hard-split, all lines ≤16, times tile", func(t *testing.T) {
		long := "我们把这个超长词组一直延续下去用来验证单个词超过三十二个字符的时候折行兜底缺失的具体表现如何"
		require.Len(t, []rune(long), 46)
		words := []Word{mkWord(long, 0, 5.9)}
		cues := BuildCues(words)
		require.Len(t, cues, 2, "46 runes → chunks 16+15+15; cue1 packs chunks 1-2 (31 runes ≤32), cue2 the 15-rune remainder")
		assertCueShape(t, cues, false)
		assert.Equal(t, 46, cueRuneTotal(t, cues), "no characters dropped")
		// time interpolation: chunks tile [0, 5.9] exactly, cues stay contiguous
		assert.InDelta(t, 0.0, cues[0].Start, 1e-9)
		assert.InDelta(t, 5.9*31.0/46.0, cues[0].End, 1e-9, "cue 1 ends at the 31-rune share")
		assert.InDelta(t, cues[0].End, cues[1].Start, 1e-9, "cues contiguous across the split word")
		assert.InDelta(t, 5.9, cues[1].End, 1e-9)
	})
}

// TestKinsoku_OpenBracketPushedDown: a line must not END with an opening
// bracket — the bracket is pushed down to line 2 (kinsoku tail rule).
func TestKinsoku_OpenBracketPushedDown(t *testing.T) {
	words := []Word{
		mkWord("前半句到这里为止了呀「", 0, 1),
		mkWord("后半句开始了", 1, 2),
	}
	cues := BuildCues(words)
	require.Len(t, cues, 1)
	lines := strings.Split(cues[0].Text, "\n")
	require.Len(t, lines, 2)
	assert.False(t, isLineTailForbidden([]rune(lines[0])[len([]rune(lines[0]))-1]),
		"line 1 must not end with the opening bracket: %q", cues[0].Text)
	assert.True(t, strings.HasPrefix(lines[1], "「"),
		"the bracket moves to the head of line 2: %q", cues[0].Text)
	assert.Equal(t, 17, cueRuneTotal(t, cues), "no characters dropped")
}

// TestKinsoku_ConsecutivePunctPulledBack: a run of three forbidden head
// characters at the break is pulled back beyond the 2-rune tolerance only as
// far as needed — the shift stops as soon as line 2's head is clean, so a
// 17-rune cue resolves to 11|6 with no violation.
func TestKinsoku_ConsecutivePunctPulledBack(t *testing.T) {
	words := []Word{mkWord("十个字数完了吗嘿！！！后面还有七个字", 0, 2)}
	require.Len(t, []rune(words[0].Text), 18)
	cues := BuildCues(words)
	require.Len(t, cues, 1)
	assertCueShape(t, cues, false)
	assert.Equal(t, 18, cueRuneTotal(t, cues), "no characters dropped")
	lines := strings.Split(cues[0].Text, "\n")
	require.Len(t, lines, 2)
	assert.False(t, isLineHeadForbidden([]rune(lines[1])[0]),
		"line 2 head must be clean after the pull-back: %q", cues[0].Text)
	assert.True(t, strings.HasSuffix(lines[0], "！！！"),
		"all three exclamations pulled back onto line 1: %q", cues[0].Text)
}

// TestKinsoku_TwoPunctPulledBack: exactly two forbidden characters at the
// break are pulled back into line 1 within the kinsokuMaxAdjust tolerance
// (line 1 becomes 18 runes — the allowed slight over-limit).
func TestKinsoku_TwoPunctPulledBack(t *testing.T) {
	words := []Word{mkWord("十个字数完了吗嘿！！后面还有六个字", 0, 2)}
	require.Len(t, []rune(words[0].Text), 17)
	cues := BuildCues(words)
	require.Len(t, cues, 1)
	assertCueShape(t, cues, false)
	assert.Equal(t, 17, cueRuneTotal(t, cues), "no characters dropped")
}

// TestKinsoku_FourExclaimRunUnfixable documents the tolerance boundary: a
// 4-rune forbidden run sitting at a 16-rune cut cannot be fully resolved
// within the +2 tolerance (pulling two leaves line 2 still forbidden; more
// would blow the 18-rune ceiling), so the hard line caps win and the residual
// violation is accepted — no infinite growth of line 1.
func TestKinsoku_FourExclaimRunUnfixable(t *testing.T) {
	words := []Word{
		mkWord(strings.Repeat("字", 16), 0, 1),
		mkWord("！！！！一二三四五六七", 1, 2),
	}
	cues := BuildCues(words)
	require.Len(t, cues, 1)
	lines := strings.Split(cues[0].Text, "\n")
	require.Len(t, lines, 2)
	assert.LessOrEqual(t, utf8.RuneCountInString(lines[0]), maxLineRunes,
		"hard cap enforced: line 1 stops at 16, does not grow past the tolerance")
	assert.Equal(t, 27, cueRuneTotal(t, cues), "no characters dropped")
}

// TestKinsoku_AllPunctSentence: an all-punctuation sentence has no
// kinsoku-clean two-line break anywhere; pulling the tail punctuation back
// absorbs the whole second line into one slightly-over-limit line (the
// allowed kinsokuMaxAdjust), losing nothing.
func TestKinsoku_AllPunctSentence(t *testing.T) {
	words := []Word{mkWord(strings.Repeat("！", 18), 0, 2)}
	cues := BuildCues(words)
	require.Len(t, cues, 1)
	assert.Equal(t, 18, cueRuneTotal(t, cues), "no characters dropped")
	lines := strings.Split(cues[0].Text, "\n")
	require.Len(t, lines, 1, "no clean break exists; the whole cue fits the tolerance as one line")
	assert.LessOrEqual(t, utf8.RuneCountInString(lines[0]), maxLineRunes+kinsokuMaxAdjust)
}

// TestKinsoku_ExactlyAtCap: 16 runes stay on one line; 17 force the split.
func TestKinsoku_ExactlyAtCap(t *testing.T) {
	t.Run("16-rune single word: one line", func(t *testing.T) {
		cues := BuildCues([]Word{mkWord(strings.Repeat("满", 16), 0, 1)})
		require.Len(t, cues, 1)
		assert.NotContains(t, cues[0].Text, "\n")
		assert.Len(t, []rune(cues[0].Text), 16)
	})
	t.Run("16-rune two words: one line", func(t *testing.T) {
		cues := BuildCues([]Word{mkWord(strings.Repeat("左", 8), 0, 1), mkWord(strings.Repeat("右", 8), 1, 2)})
		require.Len(t, cues, 1)
		assert.NotContains(t, cues[0].Text, "\n")
		assert.Len(t, []rune(cues[0].Text), 16)
	})
	t.Run("17-rune single word: two lines ≤16", func(t *testing.T) {
		cues := BuildCues([]Word{mkWord(strings.Repeat("长", 17), 0, 1)})
		require.Len(t, cues, 1)
		assertCueShape(t, cues, false)
		assert.Equal(t, 17, cueRuneTotal(t, cues))
	})
}

// TestKinsoku_TimeInterpolation: hard-split chunks tile the original word's
// [Start, End] interval exactly — contiguous, monotonic, no gap or overlap.
func TestKinsoku_TimeInterpolation(t *testing.T) {
	t.Run("expandUnits chunks tile the interval", func(t *testing.T) {
		units := expandUnits([]Word{mkWord(strings.Repeat("长", 40), 1.0, 3.0)})
		require.Len(t, units, 3)
		assert.InDelta(t, 1.0, units[0].start, 1e-9)
		for i := 0; i < 2; i++ {
			assert.InDelta(t, units[i].end, units[i+1].start, 1e-9, "chunks contiguous")
			assert.LessOrEqual(t, utf8.RuneCountInString(units[i].text), maxLineRunes)
		}
		assert.InDelta(t, 3.0, units[2].end, 1e-9)
		for i := 0; i < 3; i++ {
			assert.Equal(t, i > 0, units[i].gluedToPrev, "chunk 0 unglued, rest glued")
		}
	})
	t.Run("cues cover the split word's interval", func(t *testing.T) {
		cues := BuildCues([]Word{mkWord(strings.Repeat("长", 40), 1.0, 3.0)})
		require.GreaterOrEqual(t, len(cues), 2)
		assert.InDelta(t, 1.0, cues[0].Start, 1e-9)
		for i := 1; i < len(cues); i++ {
			assert.InDelta(t, cues[i-1].End, cues[i].Start, 1e-9, "cues contiguous")
		}
		assert.InDelta(t, 3.0, cues[len(cues)-1].End, 1e-9)
	})
}

// TestKinsoku_CharSets pins the kinsoku character classes required by the
// round-3 spec (行首禁则 closing punct/brackets; 行尾禁则 opening brackets).
func TestKinsoku_CharSets(t *testing.T) {
	for _, r := range "，。！？」』）\"'" {
		assert.True(t, isLineHeadForbidden(r), "%q must be line-head forbidden", string(r))
	}
	for _, r := range "「『（\"'" {
		assert.True(t, isLineTailForbidden(r), "%q must be line-tail forbidden", string(r))
	}
	assert.False(t, isLineHeadForbidden('水'))
	assert.False(t, isLineHeadForbidden('「'))
	assert.False(t, isLineTailForbidden('，'))
}
