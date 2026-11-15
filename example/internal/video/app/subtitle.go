package videoapp

import (
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Subtitle cue-grouping limits (§4.10.3): CJK ≤16 chars/line, ≤2 lines,
// ≤6 seconds per cue. Split prefers punctuation boundaries.
const (
	maxLineRunes = 16
	maxLines     = 2
	maxCueSec    = 6.0
)

// Cue is one subtitle entry.
type Cue struct {
	Start float64
	End   float64
	Text  string
}

// BuildCues groups words into cues: greedy accumulation until any limit is
// hit (line length → lines → duration), breaking preferentially right after
// sentence punctuation when one occurs inside the current window.
func BuildCues(words []Word) []Cue {
	if len(words) == 0 {
		return nil
	}
	var cues []Cue
	start := 0
	for start < len(words) {
		end := start + 1
		breakPunct := -1 // index AFTER which a punctuation break was seen
		for end < len(words) {
			w := words[end-1]
			if w.End-words[start].Start > maxCueSec {
				break
			}
			if runesOf(words[start:end]) > maxLineRunes*maxLines {
				break
			}
			if endsWithSentencePunct(w.Text) {
				breakPunct = end
			}
			// adding the next word would exceed a hard limit: cut here,
			// preferring the most recent punctuation boundary.
			next := words[end]
			if (next.End-words[start].Start > maxCueSec) ||
				(runesOf(words[start:end+1]) > maxLineRunes*maxLines) {
				break
			}
			end++
		}
		if breakPunct >= start+1 && breakPunct < end {
			end = breakPunct
		}
		cues = append(cues, Cue{
			Start: words[start].Start,
			End:   words[end-1].End,
			Text:  layoutLines(words[start:end]),
		})
		start = end
	}
	return cues
}

// layoutLines wraps cue text into ≤2 visual lines of ≤16 runes each
// (single-space joined; the SRT consumer renders the newline).
func layoutLines(words []Word) string {
	text := joinWords(words)
	runes := []rune(text)
	if len(runes) <= maxLineRunes {
		return text
	}
	// split near the middle at a space, both halves ≤ maxLineRunes when possible
	half := len(runes) / 2
	best := -1
	for i := half; i > 0; i-- {
		if runes[i-1] == ' ' {
			best = i
			break
		}
	}
	if best == -1 {
		for i := half; i < len(runes); i++ {
			if runes[i] == ' ' {
				best = i + 1
				break
			}
		}
	}
	if best == -1 || best > maxLineRunes || len(runes)-best > maxLineRunes {
		best = half
	}
	return string(runes[:best]) + "\n" + string(runes[best:])
}

func joinWords(words []Word) string {
	var b strings.Builder
	prevCJK := false
	for i, w := range words {
		t := strings.TrimSpace(w.Text)
		if t == "" {
			continue
		}
		cjk := isCJKRunes(t)
		if i > 0 && !(cjk && prevCJK) {
			b.WriteByte(' ')
		}
		b.WriteString(t)
		prevCJK = cjk
	}
	return strings.TrimSpace(b.String())
}

func runesOf(words []Word) int {
	return utf8.RuneCountInString(joinWords(words))
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
	case '。', '，', '！', '？', '；', '：', '、', '“', '”', '（', '）':
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
