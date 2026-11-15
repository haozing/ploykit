package videoapp

import (
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Subtitle cue-grouping limits (§4.10.3): CJK ≤16 chars/line, ≤2 lines,
// ≤6 seconds per cue. Split prefers punctuation boundaries. kinsokuMaxAdjust
// is how far a line may exceed maxLineRunes to honour kinsoku (a forbidden
// character pulled back from the next line's head or pushed down from this
// line's tail).
const (
	maxLineRunes = 16
	maxLines     = 2
	maxCueSec    = 6.0

	// kinsokuMaxAdjust: a line ends up at most 18 runes when the alternative
	// is a kinsoku violation. Hard caps (16/2) still win when even this
	// tolerance cannot fix the break (e.g. a ≥3-rune forbidden run).
	kinsokuMaxAdjust = 2
)

// Kinsoku character classes (round-3 spec; JIS/GB convention subset relevant
// to zh-Hans subtitles).
//
// Line-head forbidden (行頭禁則): a line must not START with these — closing
// punctuation and closing brackets attach to the previous line instead.
// Line-tail forbidden (行末禁則): a line must not END with these — opening
// brackets move to the next line instead.
const (
	lineHeadForbidden = "，。、；：！？」』）】〉》”’.,!?;:)]" + "\"'"
	lineTailForbidden = "「『（【〈《‘“([{" + "\"'"
)

func isLineHeadForbidden(r rune) bool {
	return strings.ContainsRune(lineHeadForbidden, r)
}

func isLineTailForbidden(r rune) bool {
	return strings.ContainsRune(lineTailForbidden, r)
}

// Cue is one subtitle entry.
type Cue struct {
	Start float64
	End   float64
	Text  string
}

// unit is one layoutable atom after expansion: either an original Word, or a
// hard-split chunk of an oversized Word. gluedToPrev marks chunks continuing
// the same original word — joinUnits must not insert a space between a glued
// pair (the original text had none). originalWord marks verbatim word-table
// words: a line break must never land inside one (word integrity); chunks of
// an oversized word are the exception — cutting between them is required,
// because together they exceed any line.
type unit struct {
	text         string
	start, end   float64
	gluedToPrev  bool
	sentenceEnd  bool // text ends with sentence punctuation (cut candidate)
	originalWord bool // came from the word table verbatim (word-integrity rule)
}

// expandUnits converts words into layoutable units. Words at or under
// maxLineRunes pass through; longer words hard-split into k balanced chunks
// (k = ceil(n/16), sizes as equal as possible) with times linearly
// interpolated across the word's [Start, End] by rune share — better a hard
// cut than an over-limit line. Chunk times tile the original interval exactly
// (no gap, no overlap).
func expandUnits(words []Word) []unit {
	units := make([]unit, 0, len(words))
	for _, w := range words {
		text := strings.TrimSpace(w.Text)
		if text == "" {
			continue
		}
		runes := []rune(text)
		if len(runes) <= maxLineRunes {
			units = append(units, unit{
				text:         text,
				start:        w.Start,
				end:          w.End,
				sentenceEnd:  endsWithSentencePunct(text),
				originalWord: true,
			})
			continue
		}
		// hard split: k balanced chunks of ≤maxLineRunes, times by rune share.
		k := (len(runes) + maxLineRunes - 1) / maxLineRunes
		base, extra := len(runes)/k, len(runes)%k
		span := w.End - w.Start
		lo := 0
		for c := 0; c < k; c++ {
			size := base
			if c < extra {
				size++
			}
			hi := lo + size
			f0 := float64(lo) / float64(len(runes))
			f1 := float64(hi) / float64(len(runes))
			units = append(units, unit{
				text:  string(runes[lo:hi]),
				start: w.Start + span*f0,
				end:   w.Start + span*f1,
				// chunks of one word are never sentence-punctuation break
				// candidates: a cut inside a word is a last resort, not a
				// preferred break (a punctuation-ending chunk would split an
				// all-punctuation word at every chunk boundary).
				gluedToPrev: c > 0,
			})
			lo = hi
		}
	}
	return units
}

// BuildCues groups words into cues: greedy accumulation until any limit is
// hit (line length → lines → duration), breaking preferentially right after
// sentence punctuation when one occurs inside the current window. A single
// word longer than one line hard-splits first (see expandUnits), so the
// ≤16-rune line cap is never exceeded by an unsplittable word.
func BuildCues(words []Word) []Cue {
	if len(words) == 0 {
		return nil
	}
	units := expandUnits(words)
	if len(units) == 0 {
		return nil
	}
	var cues []Cue
	start := 0
	for start < len(units) {
		end := start + 1
		breakPunct := -1 // index AFTER which a punctuation break was seen
		for end < len(units) {
			u := units[end-1]
			if u.end-units[start].start > maxCueSec {
				break
			}
			if unitsRunes(units[start:end]) > maxLineRunes*maxLines {
				break
			}
			if u.sentenceEnd {
				breakPunct = end
			}
			// adding the next unit would exceed a hard limit: cut here,
			// preferring the most recent punctuation boundary.
			next := units[end]
			if (next.end-units[start].start > maxCueSec) ||
				(unitsRunes(units[start:end+1]) > maxLineRunes*maxLines) {
				break
			}
			end++
		}
		if breakPunct >= start+1 && breakPunct < end {
			end = breakPunct
		}
		cues = append(cues, Cue{
			Start: units[start].start,
			End:   units[end-1].end,
			Text:  layoutUnits(units[start:end]),
		})
		start = end
	}
	return cues
}

// layoutUnits wraps cue text into ≤2 visual lines of ≤16 runes each
// (single-space joined; the SRT consumer renders the newline). Break-point
// selection honours two rules beyond the hard caps:
//
//  1. word integrity: a break never lands inside a word (glued chunks are
//     one physical word; the split point sits on a gluedToPrev boundary,
//     i.e. between units), so normal text never severs a word mid-line;
//  2. kinsoku: the next line must not start with line-head-forbidden
//     punctuation and this line must not end with a line-tail-forbidden
//     opening bracket — fixed by shifting the break up to kinsokuMaxAdjust
//     runes (a ≤18-rune first line beats a violation).
func layoutUnits(units []unit) string {
	text := joinUnits(units)
	runes := []rune(text)
	if len(runes) <= maxLineRunes {
		return text
	}

	// candidate cut positions: every unit boundary. A whole (≤16-rune) word
	// is exactly one unit, so a cut never severs a word (word integrity);
	// the boundaries between chunks of an oversized word are the sanctioned
	// hard-split points.
	var cuts []int
	off := 0
	for i, u := range units {
		off += utf8.RuneCountInString(u.text)
		if i < len(units)-1 {
			cuts = append(cuts, off)
		}
	}

	// candidate: cut ∈ cuts with 1 ≤ cut ≤ len(runes)-1. Score prefers (1)
	// kinsoku-clean, (2) balanced (closest to mid), (3) earlier cut.
	mid := len(runes) / 2
	best, bestScore := -1, cutScore{}
	for _, cut := range cuts {
		if cut <= 0 || cut >= len(runes) {
			continue
		}
		s := cutScore{
			kinsoku: kinsokuPenalty(string(runes[:cut]), string(runes[cut:])),
			balance: abs(cut - mid),
			earlier: cut,
		}
		if best < 0 || s.less(bestScore) {
			best, bestScore = cut, s
		}
	}
	if best < 0 {
		// No legal cut: impossible via expandUnits (every unit is ≤16 runes
		// and unglued units provide cuts). Defensive fallback: hard rune cut.
		best = maxLineRunes
	}
	line1, line2 := string(runes[:best]), string(runes[best:])
	line1, line2 = kinsokuShift(line1, line2)
	if line2 == "" {
		return line1
	}
	return line1 + "\n" + line2
}

// cutScore orders candidate break points: fewer residual kinsoku violations
// first, then balance around the middle, then the earlier cut.
type cutScore struct {
	kinsoku int
	balance int
	earlier int
}

func (s cutScore) less(o cutScore) bool {
	if s.kinsoku != o.kinsoku {
		return s.kinsoku < o.kinsoku
	}
	if s.balance != o.balance {
		return s.balance < o.balance
	}
	return s.earlier < o.earlier
}

// kinsokuPenalty reports how many forbidden characters remain stranded after
// cutting into line1|line2 (0 = kinsoku-clean). Used only for scoring; the
// hard line caps are checked separately.
func kinsokuPenalty(line1, line2 string) int {
	penalty := 0
	r1, r2 := []rune(line1), []rune(line2)
	if len(r2) > 0 && isLineHeadForbidden(r2[0]) {
		penalty++
	}
	if len(r1) > 0 && isLineTailForbidden(r1[len(r1)-1]) {
		penalty++
	}
	return penalty
}

// kinsokuShift moves the cut point to resolve kinsoku violations at the
// break, allowing the first line up to maxLineRunes+kinsokuMaxAdjust runes.
//   - line2 starting with a forbidden head character: pull characters back
//     into line1 (up to the tolerance);
//   - line1 ending with an opening bracket: push it down into line2.
//
// Returns the adjusted (line1, line2). When the tolerance cannot fix it
// (e.g. a ≥3-rune forbidden run), the input is returned — hard caps win.
func kinsokuShift(line1, line2 string) (string, string) {
	r1, r2 := []rune(line1), []rune(line2)
	// push down trailing opening brackets (may cascade: 「「)
	for len(r1) > 1 && len(r2) < maxLineRunes && isLineTailForbidden(r1[len(r1)-1]) {
		r2 = append([]rune{r1[len(r1)-1]}, r2...)
		r1 = r1[:len(r1)-1]
	}
	// pull back leading forbidden head characters (may cascade: 」」，;
	// an all-punctuation tail may empty line2 entirely — the cue then has
	// one slightly-over-limit line, which the tolerance permits).
	for len(r2) > 0 && len(r1) < maxLineRunes+kinsokuMaxAdjust && isLineHeadForbidden(r2[0]) {
		r1 = append(r1, r2[0])
		r2 = r2[1:]
	}
	// final state must still be legal within tolerance; otherwise revert.
	if len(r1) > maxLineRunes+kinsokuMaxAdjust ||
		(len(r2) > 0 && isLineHeadForbidden(r2[0])) ||
		(len(r1) > 0 && isLineTailForbidden(r1[len(r1)-1])) {
		return line1, line2
	}
	return string(r1), string(r2)
}

// joinUnits is joinWords over expanded units: single-space between units
// except between CJK-CJK neighbours — glued or not (glued chunks are halves
// of one word, which is trivially CJK-CJK adjacent text).
func joinUnits(units []unit) string {
	var b strings.Builder
	prevCJK := false
	first := true
	for _, u := range units {
		t := strings.TrimSpace(u.text)
		if t == "" {
			continue
		}
		cjk := isCJKRunes(t)
		if !first && !(cjk && prevCJK) {
			b.WriteByte(' ')
		}
		b.WriteString(t)
		prevCJK = cjk
		first = false
	}
	return strings.TrimSpace(b.String())
}

func unitsRunes(units []unit) int {
	return utf8.RuneCountInString(joinUnits(units))
}

func endsWithSentencePunct(text string) bool {
	r, size := utf8.DecodeLastRuneInString(strings.TrimSpace(text))
	if r == 0 {
		return false
	}
	_ = size
	switch r {
	case '。', '！', '？', '；', '.', '!', '?', ';', '，', ',':
		return true
	}
	return false
}

func isCJKRunes(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if !unicode.Is(unicode.Han, r) && !unicode.Is(unicode.Hangul, r) &&
			!unicode.Is(unicode.Katakana, r) && !unicode.Is(unicode.Hiragana, r) &&
			!isCJKPunct(r) {
			return false
		}
	}
	return true
}

func isCJKPunct(r rune) bool {
	switch r {
	case '。', '，', '！', '？', '；', '：', '、', '“', '”', '‘', '’',
		'（', '）', '「', '」', '『', '』', '【', '】', '〈', '〉', '《', '》':
		return true
	}
	return false
}

func srtTime(sec float64) string {
	if sec < 0 {
		sec = 0
	}
	total := int(sec * 1000)
	ms := total % 1000
	total /= 1000
	s := total % 60
	total /= 60
	m := total % 60
	h := total / 60
	return fmt.Sprintf("%02d:%02d:%02d,%03d", h, m, s, ms)
}

// SRT renders grouped cues as an .srt document (UTF-8, CRLF line endings per
// the subtitle convention; libass and soft-sub burn paths both consume it).
func SRT(words []Word) string {
	cues := BuildCues(words)
	if len(cues) == 0 {
		return ""
	}
	var b strings.Builder
	for i, c := range cues {
		fmt.Fprintf(&b, "%d\n%s --> %s\n%s\n\n", i+1, srtTime(c.Start), srtTime(c.End), c.Text)
	}
	return b.String()
}
