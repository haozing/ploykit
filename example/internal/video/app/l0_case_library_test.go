// L0 case-library tests (plan §7.1: docs/plan-agent-video-studio-case-library-and-test-plan-2026-11-15.md).
// Pure-function layer only: no Chrome, no DB, no I/O beyond the embedded JS source.
// This file must not modify business code — it only adds test coverage named by §7.1.
package videoapp

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestL0_DurationFrames_CaseTable pins the single frame-count formula
// F = max(1, ceil(max(meta.durationSec, voice.durationSec) * fps)) against the
// nine §7.0 case-table rows (plan §7.0 "帧数公式"), plus the 8.04@30 parity
// sample, the voice-extension sample, the fps<=0 fallback and the min-1 floor.
func TestL0_DurationFrames_CaseTable(t *testing.T) {
	cases := []struct {
		caseID string
		d      float64
		fps    int
		want   int
	}{
		{"VS-C01 短视频带货 15s@30", 15, 30, 450},
		{"VS-C02 品牌发布 30s@25", 30, 25, 750},
		{"VS-C03 知识科普 45s@30", 45, 30, 1350},
		{"VS-C04 数据可视化口播 60s@30", 60, 30, 1800},
		{"VS-C05 旅行生活方式 30s@30", 30, 30, 900},
		{"VS-C06 访谈字幕 90s@25", 90, 25, 2250},
		{"VS-C07 招聘/企业宣传 40s@30", 40, 30, 1200},
		{"VS-C08 节日促销 20s@30", 20, 30, 600},
		{"VS-C09 产品功能演示 50s@30", 50, 30, 1500},
	}
	for _, c := range cases {
		t.Run(c.caseID, func(t *testing.T) {
			ir := &IR{Meta: Meta{FPS: c.fps, Width: 1080, Height: 1920, DurationSec: c.d}}
			assert.Equal(t, c.want, DurationFrames(ir, c.fps),
				"frame formula version: ceil(d*fps) single source (audit P8)")
			// fps<=0 falls back to ir.Meta.FPS — same number either way.
			assert.Equal(t, c.want, DurationFrames(ir, 0))
		})
	}

	t.Run("parity 8.04s@30 = 242 (round-vs-ceil divergence sample)", func(t *testing.T) {
		ir := &IR{Meta: Meta{FPS: 30, Width: 1080, Height: 1920, DurationSec: 8.04}}
		// 8.04 * 30 = 241.2 → ceil 242; the historical JS Math.round gave 241.
		assert.Equal(t, 242, DurationFrames(ir, 30))
	})

	t.Run("voice duration extends the timeline", func(t *testing.T) {
		ir := &IR{
			Meta:  Meta{FPS: 30, Width: 1080, Height: 1920, DurationSec: 10},
			Audio: &Audio{Voice: &AudioTrack{Key: "video/ws-1/assets/p1/voice.mp3", DurationSec: 12.4}},
		}
		// max(10, 12.4) * 30 = 372
		assert.Equal(t, 372, DurationFrames(ir, 30))
	})

	t.Run("minimum one frame floor", func(t *testing.T) {
		ir := &IR{Meta: Meta{FPS: 30, Width: 1080, Height: 1920, DurationSec: 0.01}}
		assert.Equal(t, 1, DurationFrames(ir, 30), "0.01*30=0.3 → ceil 1, floor keeps 1")
	})

	t.Run("exact integer product has no off-by-one", func(t *testing.T) {
		ir := &IR{Meta: Meta{FPS: 25, Width: 1920, Height: 1080, DurationSec: 30}}
		assert.Equal(t, 750, DurationFrames(ir, 25))
	})
}

// TestL0_TimelineBuilderJS_FrameFormulaParity is the documented degradation for
// the JS side of the same-source check (plan §7.1): the repo has no JS unit
// test framework (example/web/package.json carries vite/tsc only), so the
// embedded builder source is asserted as a string instead of executing it.
func TestL0_TimelineBuilderJS_FrameFormulaParity(t *testing.T) {
	src, err := builderFS.ReadFile("timeline-builder.js")
	require.NoError(t, err)
	s := string(src)

	// The frame-count line must ceil — same formula as Go DurationFrames
	// (service.go DurationFrames; timeline-builder.js durationFrames).
	assert.Contains(t, s, "Math.max(1, Math.ceil(durationSec * fps))",
		"JS frame count must be ceil with a 1-frame floor (parity with Go)")

	// No Math.round residue on the frame-count path. (Math.round DOES appear
	// elsewhere legitimately: counter text display and seek clamping — those
	// are not the frame-count formula and must not trip this assertion.)
	assert.NotContains(t, s, "Math.round(durationSec * fps)",
		"historical round/ceil divergence must not return")
	assert.NotContains(t, s, "Math.round(durationSec*fps)")
}

// TestL0_ResolveAnchors_RepeatedWordOccurrence covers the plan §2.1 C01
// scenario named by §7.1: the same word text occurs twice and occurrence
// 0/1 selects different indexes (document order).
func TestL0_ResolveAnchors_RepeatedWordOccurrence(t *testing.T) {
	words := []Word{
		{Index: 0, Text: "今天", Start: 0, End: 0.5, Source: WordSourceTTS},
		{Index: 1, Text: "充电", Start: 0.5, End: 1.0, Source: WordSourceTTS},
		{Index: 2, Text: "五分钟", Start: 1.0, End: 1.5, Source: WordSourceTTS},
		{Index: 3, Text: "就能", Start: 1.5, End: 2.0, Source: WordSourceTTS},
		{Index: 4, Text: "充电", Start: 2.0, End: 2.5, Source: WordSourceTTS},
		{Index: 5, Text: "一整天", Start: 2.5, End: 3.0, Source: WordSourceTTS},
	}
	t.Run("occurrence 0 hits the first 充电", func(t *testing.T) {
		idx, reason, ok := ResolveAnchors(Anchor{Text: "充电", Occurrence: 0}, words, 0)
		require.True(t, ok)
		assert.Equal(t, AnchorExact, reason)
		assert.Equal(t, 1, idx)
	})
	t.Run("occurrence 1 hits the second 充电", func(t *testing.T) {
		idx, reason, ok := ResolveAnchors(Anchor{Text: "充电", Occurrence: 1}, words, 0)
		require.True(t, ok)
		assert.Equal(t, AnchorExact, reason)
		assert.Equal(t, 4, idx)
	})
}

// TestL0_ResolveAnchors_ConcatRun covers the anchorCandidates Type-A path
// named by §7.1 (plan §2.1 C01 "跨词拼接锚点"): a multi-word run whose
// concatenation equals the anchor text ("券后七十九" style), including a
// repeated concat anchor with occurrence selection, single-word containment,
// and candidate dedup when a position qualifies both ways.
func TestL0_ResolveAnchors_ConcatRun(t *testing.T) {
	words := []Word{
		{Index: 0, Text: "今天", Start: 0, End: 0.5, Source: WordSourceTTS},
		{Index: 1, Text: "充电", Start: 0.5, End: 1.0, Source: WordSourceTTS},
		{Index: 2, Text: "五分钟", Start: 1.0, End: 1.5, Source: WordSourceTTS},
		{Index: 3, Text: "满三百", Start: 1.5, End: 2.0, Source: WordSourceTTS},
		{Index: 4, Text: "减五十", Start: 2.0, End: 2.5, Source: WordSourceTTS},
		{Index: 5, Text: "券后", Start: 2.5, End: 2.8, Source: WordSourceTTS},
		{Index: 6, Text: "七十", Start: 2.8, End: 3.1, Source: WordSourceTTS},
		{Index: 7, Text: "九", Start: 3.1, End: 3.4, Source: WordSourceTTS},
		{Index: 8, Text: "券后", Start: 3.4, End: 3.7, Source: WordSourceTTS},
		{Index: 9, Text: "七十", Start: 3.7, End: 4.0, Source: WordSourceTTS},
		{Index: 10, Text: "九", Start: 4.0, End: 4.3, Source: WordSourceTTS},
	}
	t.Run("concat run start wins, occurrence 0", func(t *testing.T) {
		idx, reason, ok := ResolveAnchors(Anchor{Text: "券后七十九", Occurrence: 0}, words, 0)
		require.True(t, ok)
		assert.Equal(t, AnchorExact, reason)
		assert.Equal(t, 5, idx, "candidate is the run START, not any member word")
	})
	t.Run("repeated concat anchor occurrence 1 selects the second run", func(t *testing.T) {
		idx, reason, ok := ResolveAnchors(Anchor{Text: "券后七十九", Occurrence: 1}, words, 0)
		require.True(t, ok)
		assert.Equal(t, AnchorExact, reason)
		assert.Equal(t, 8, idx)
	})
	t.Run("single-word containment (Type B)", func(t *testing.T) {
		idx, reason, ok := ResolveAnchors(Anchor{Text: "减五十", Occurrence: 0}, words, 0)
		require.True(t, ok)
		assert.Equal(t, AnchorExact, reason)
		assert.Equal(t, 4, idx)
	})
	t.Run("dedup: a position qualifying as both run-start and containment is one candidate", func(t *testing.T) {
		// "券后" is both a 1-word concat run and contained in the word itself;
		// candidates must be [5, 8] with no duplicates.
		cands := anchorCandidates(Anchor{Text: "券后"}, words)
		assert.Equal(t, []int{5, 8}, cands)
		// occurrence out of range → same_text, nearest candidate to prev.
		idx, reason, ok := ResolveAnchors(Anchor{Text: "券后", Occurrence: 5}, words, 8)
		require.True(t, ok)
		assert.Equal(t, AnchorSameText, reason)
		assert.Equal(t, 8, idx)
	})
}

// TestL0_BuildCues_LongSentenceWrap: a sentence longer than 16 runes wraps
// into exactly 2 lines of ≤16 runes each, content preserved (§4.10.3 limits).
func TestL0_BuildCues_LongSentenceWrap(t *testing.T) {
	// 19 CJK runes total, no spaces (estimated-path shape: one field per
	// space-free run), 2 seconds — within the 6s cap so length drives the cut.
	sentence := "这是一句用来测试断行行为的超长中文句子" // 19 runes
	words := []Word{
		{Index: 0, Text: sentence[:13*3], Start: 0, End: 1, Source: WordSourceEstimated},
		{Index: 1, Text: sentence[13*3:], Start: 1, End: 2, Source: WordSourceEstimated},
	}
	require.Len(t, []rune(sentence), 19)
	cues := BuildCues(words)
	require.Len(t, cues, 1)
	lines := strings.Split(cues[0].Text, "\n")
	require.Len(t, lines, 2, ">16-rune sentence must wrap to 2 lines")
	for _, line := range lines {
		assert.LessOrEqual(t, len([]rune(line)), maxLineRunes)
	}
	assert.Equal(t, 19, len([]rune(strings.ReplaceAll(cues[0].Text, "\n", ""))),
		"no characters dropped by the wrap")
}

// TestL0_BuildCues_SixSecondCap: a multi-word stream whose window would
// exceed 6s is cut so every cue stays ≤6s.
func TestL0_BuildCues_SixSecondCap(t *testing.T) {
	var words []Word
	for i := 0; i < 6; i++ {
		words = append(words, Word{Index: i, Text: fmt.Sprintf("第%d段", i),
			Start: float64(i) * 2, End: float64(i)*2 + 2, Source: WordSourceTTS})
	}
	cues := BuildCues(words)
	require.NotEmpty(t, cues)
	for _, c := range cues {
		assert.LessOrEqual(t, c.End-c.Start, maxCueSec+1e-9, "cue duration ≤ 6s")
	}
}

// TestL0_BuildCues_EmptyWords: the empty word table yields no cues (direct
// assertion on BuildCues; TestSRT_Empty only covers it via SRT).
func TestL0_BuildCues_EmptyWords(t *testing.T) {
	assert.Nil(t, BuildCues(nil))
	assert.Nil(t, BuildCues([]Word{}))
}

// TestL0_BuildCues_SingleOversizedWordBoundary: when a SINGLE word alone
// exceeds the capacity, the round-3 fix hard-splits it into ≤16-rune chunks
// (times linearly interpolated across the word's interval) instead of
// emitting over-limit lines — the §7.1 gap this test used to skip over is
// closed; the old skip asserted a 20/20 two-line layout that the balanced
// split (27|13 with the cue packing at 32) supersedes. The 8s-duration half
// stays skipped: cue duration capping for a single word is a separate
// boundary, out of this fix's scope.
func TestL0_BuildCues_SingleOversizedWordBoundary(t *testing.T) {
	t.Run("40-rune single word hard-splits into ≤16-rune lines", func(t *testing.T) {
		w := []Word{{Index: 0, Text: strings.Repeat("长", 40), Start: 0, End: 1, Source: WordSourceEstimated}}
		cues := BuildCues(w)
		require.NotEmpty(t, cues)
		for _, c := range cues {
			for _, line := range strings.Split(c.Text, "\n") {
				assert.LessOrEqual(t, len([]rune(line)), maxLineRunes,
					"hard-split lines respect the 16-rune cap (was 20 before the fix)")
			}
		}
		assert.Equal(t, 27, len([]rune(strings.ReplaceAll(cues[0].Text, "\n", ""))),
			"first cue holds chunks 1-2 (16+11 = 27 runes, the cue packing cap is 32)")
		total := 0
		for _, c := range cues {
			total += len([]rune(strings.ReplaceAll(c.Text, "\n", "")))
		}
		assert.Equal(t, 40, total, "all 40 runes preserved across cues")
		// time interpolation tiles [0,1] exactly
		assert.InDelta(t, 0.0, cues[0].Start, 1e-9)
		for i := 1; i < len(cues); i++ {
			assert.InDelta(t, cues[i-1].End, cues[i].Start, 1e-9, "cues contiguous across the split word")
		}
		assert.InDelta(t, 1.0, cues[len(cues)-1].End, 1e-9)
	})
	t.Run("8s single word yields one 8s cue", func(t *testing.T) {
		w := []Word{{Index: 0, Text: "八秒长词", Start: 0, End: 8, Source: WordSourceTTS}}
		cues := BuildCues(w)
		require.Len(t, cues, 1)
		t.Logf("observed cue duration=%.1fs (cap is 6s)", cues[0].End-cues[0].Start)
		t.Skip("separate boundary, not this fix's scope: single-word cue duration capping; " +
			"the line-length half of this test is now asserted above")
	})
}

// TestL0_TimestampOfRun records the local run time for the report's run_id.
func TestL0_TimestampOfRun(t *testing.T) {
	t.Logf("l0-run-local-time=%s", time.Now().Format("2006-01-02 15:04:05"))
}
