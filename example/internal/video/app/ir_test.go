package videoapp

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func validIR() *IR {
	return &IR{
		Meta:   Meta{FPS: 30, Width: 1080, Height: 1920, DurationSec: 12.4},
		Script: "这款产品发布后，留存率提升了三倍。",
		Words: []Word{
			{Index: 0, Text: "发布", Start: 1.80, End: 2.10, Source: WordSourceTTS},
			{Index: 1, Text: "留存率", Start: 3.20, End: 3.60, Source: WordSourceTTS},
			{Index: 2, Text: "三倍", Start: 4.80, End: 5.00, Source: WordSourceTTS},
		},
	}
}

func TestValidate_AcceptsWellFormed(t *testing.T) {
	ir := validIR()
	ir.Effects = []Effect{
		{ID: "fx_1", Anchor: Anchor{Text: "发布", Occurrence: 0}, Type: EffectPulse,
			Params: []byte(`{"scale":1.2}`)},
	}
	ir.Elements = []Element{{
		ID: "sticker_1", Type: ElementImage, Src: "video/ws-1/assets/p1/abc.png",
		X: 100, Y: 100, W: 200, H: 200, Z: 1,
		Animations: []ElementAnimation{{
			ID: "an_1", Type: "move",
			From: &Point{X: 100, Y: 100}, To: &Point{X: 400, Y: 300},
			StartAnchor: &Anchor{Text: "发布", Occurrence: 0},
			DurationFrames: 45, Easing: "power2.out",
		}},
	}}
	ir.Audio = &Audio{
		Voice: &AudioTrack{Key: "video/ws-1/assets/p1/voice.mp3", DurationSec: 12.4},
		BGM:   &AudioTrack{Key: "video/ws-1/assets/p1/bgm.mp3", Volume: 0.3},
	}
	require.NoError(t, Validate(ir))
}

func TestValidate_FieldRules(t *testing.T) {
	cases := []struct {
		name  string
		mut   func(ir *IR)
		field string
	}{
		{"fps invalid", func(ir *IR) { ir.Meta.FPS = 29 }, "meta.fps"},
		{"fps default 30", func(ir *IR) { ir.Meta.FPS = 0 }, ""},
		{"width too small", func(ir *IR) { ir.Meta.Width = 100 }, "meta.width"},
		{"height too big", func(ir *IR) { ir.Meta.Height = 3000 }, "meta.height"},
		{"duration not positive", func(ir *IR) { ir.Meta.DurationSec = 0 }, "meta.durationSec"},
		{"script too long", func(ir *IR) { ir.Script = strings.Repeat("世", MaxScriptChars+1) }, "script"},
		{"word end before start", func(ir *IR) {
			ir.Words[0].End = 1.0
		}, "words[0]"},
		{"word negative start", func(ir *IR) { ir.Words[0].Start = -1 }, "words[0]"},
		{"word overlap", func(ir *IR) {
			ir.Words[1].Start = 2.0 // inside words[0] 1.8-2.1
		}, "words[1]"},
		{"word bad source", func(ir *IR) { ir.Words[0].Source = "magic" }, "words[0].source"},
		{"effect unregistered type", func(ir *IR) {
			ir.Effects = []Effect{{ID: "fx", Anchor: Anchor{Text: "发布"}, Type: "zoom"}}
		}, "effects[0].type"},
		{"effect missing anchor text", func(ir *IR) {
			ir.Effects = []Effect{{ID: "fx", Type: EffectPulse}}
		}, "effects[0].anchor.text"},
		{"effect negative occurrence", func(ir *IR) {
			ir.Effects = []Effect{{ID: "fx", Anchor: Anchor{Text: "发布", Occurrence: -1}, Type: EffectPulse}}
		}, "effects[0].anchor.occurrence"},
		{"effect unknown param", func(ir *IR) {
			ir.Effects = []Effect{{ID: "fx", Anchor: Anchor{Text: "发布"}, Type: EffectPulse,
				Params: []byte(`{"boom":1}`)}}
		}, "effects.params.boom"},
		{"effect params not object", func(ir *IR) {
			ir.Effects = []Effect{{ID: "fx", Anchor: Anchor{Text: "发布"}, Type: EffectPulse,
				Params: []byte(`[1]`)}}
		}, "effects.params"},
		{"element bad type", func(ir *IR) {
			ir.Elements = []Element{{ID: "e1", Type: "video", X: 0, Y: 0, W: 10, H: 10}}
		}, "elements[0].type"},
		{"element image without src", func(ir *IR) {
			ir.Elements = []Element{{ID: "e1", Type: ElementImage, X: 0, Y: 0, W: 10, H: 10}}
		}, "elements[0].src"},
		{"element external url src", func(ir *IR) {
			ir.Elements = []Element{{ID: "e1", Type: ElementImage,
				Src: "https://evil.example/x.png", X: 0, Y: 0, W: 10, H: 10}}
		}, "elements[0].src"},
		{"element src not video prefix", func(ir *IR) {
			ir.Elements = []Element{{ID: "e1", Type: ElementImage,
				Src: "uploads/other/x.png", X: 0, Y: 0, W: 10, H: 10}}
		}, "elements[0].src"},
		{"element negative size", func(ir *IR) {
			ir.Elements = []Element{{ID: "e1", Type: ElementShape, Src: "",
				X: 0, Y: 0, W: -5, H: 10}}
		}, "elements[0]"},
		{"animation bad easing", func(ir *IR) {
			ir.Elements = []Element{{ID: "e1", Type: ElementShape, X: 0, Y: 0, W: 10, H: 10,
				Animations: []ElementAnimation{{ID: "a1", Type: "move", DurationFrames: 10, Easing: "bounce.in"}}}}
		}, "elements[0].animations[0].easing"},
		{"animation zero duration", func(ir *IR) {
			ir.Elements = []Element{{ID: "e1", Type: ElementShape, X: 0, Y: 0, W: 10, H: 10,
				Animations: []ElementAnimation{{ID: "a1", Type: "move", DurationFrames: 0}}}}
		}, "elements[0].animations[0].durationFrames"},
		{"animation bad type", func(ir *IR) {
			ir.Elements = []Element{{ID: "e1", Type: ElementShape, X: 0, Y: 0, W: 10, H: 10,
				Animations: []ElementAnimation{{ID: "a1", Type: "spin", DurationFrames: 10}}}}
		}, "elements[0].animations[0].type"},
		{"effect targetElementId missing element", func(ir *IR) {
			ir.Effects = []Effect{{ID: "fx", Anchor: Anchor{Text: "发布"}, Type: EffectCounter,
				TargetElementID: "no_such_el"}}
		}, "effects[0].targetElementId"},
		{"effect targetElementId empty string ok", func(ir *IR) {
			ir.Effects = []Effect{{ID: "fx", Anchor: Anchor{Text: "发布"}, Type: EffectCounter,
				TargetElementID: ""}}
		}, ""},
		{"effect targetElementId resolves to existing element", func(ir *IR) {
			ir.Elements = []Element{{ID: "el_price", Type: ElementText, X: 0, Y: 0, W: 10, H: 10}}
			ir.Effects = []Effect{{ID: "fx", Anchor: Anchor{Text: "发布"}, Type: EffectCounter,
				TargetElementID: "el_price"}}
		}, ""},
		{"voice shorter than last word", func(ir *IR) {
			ir.Audio = &Audio{Voice: &AudioTrack{Key: "video/ws/v.mp3", DurationSec: 1.0}}
		}, "audio.voice.durationSec"},
		{"bgm bad volume", func(ir *IR) {
			ir.Audio = &Audio{BGM: &AudioTrack{Key: "video/ws/b.mp3", Volume: 2}}
		}, "audio.bgm.volume"},
		{"audio key external", func(ir *IR) {
			ir.Audio = &Audio{BGM: &AudioTrack{Key: "http://x/y.mp3"}}
		}, "audio.bgm.key"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ir := validIR()
			c.mut(ir)
			err := Validate(ir)
			if c.field == "" {
				require.NoError(t, err)
				assert.Equal(t, 30, ir.Meta.FPS, "fps default applied")
				return
			}
			require.Error(t, err)
			var ve *ValidationError
			require.True(t, errors.As(err, &ve), "error is ValidationError: %v", err)
			assert.Equal(t, c.field, ve.Field, "field path in error")
		})
	}
}

func TestValidate_ListLimits(t *testing.T) {
	ir := validIR()
	ir.Words = make([]Word, MaxWords+1)
	for i := range ir.Words {
		ir.Words[i] = Word{Index: i, Text: "w", Start: float64(i), End: float64(i) + 0.5, Source: WordSourceEstimated}
	}
	require.Error(t, Validate(ir))
}

func TestResolveAnchors_FourBranches(t *testing.T) {
	words := []Word{
		{Index: 0, Text: "发布", Start: 1.8, End: 2.1},
		{Index: 1, Text: "留存率", Start: 3.2, End: 3.6},
		{Index: 2, Text: "发布", Start: 4.0, End: 4.3},
		{Index: 3, Text: "三倍", Start: 4.8, End: 5.0},
	}
	cases := []struct {
		name     string
		anchor   Anchor
		prev     int
		useEmpty bool // missing branch: resolve against an empty word table
		wantIdx  int
		wantWhy  string
		wantOK   bool
	}{
		{"exact first occurrence", Anchor{Text: "发布", Occurrence: 0}, 0, false, 0, AnchorExact, true},
		{"exact second occurrence", Anchor{Text: "发布", Occurrence: 1}, 0, false, 2, AnchorExact, true},
		{"exact at tail", Anchor{Text: "三倍", Occurrence: 0}, 3, false, 3, AnchorExact, true},
		{"same_text occurrence out of range", Anchor{Text: "发布", Occurrence: 5}, 0, false, 0, AnchorSameText, true},
		{"same_text nearest to prev", Anchor{Text: "发布", Occurrence: 9}, 3, false, 2, AnchorSameText, true},
		{"nearest text absent", Anchor{Text: "不存在", Occurrence: 0}, 2, false, 2, AnchorNearest, true},
		{"nearest text absent prev zero", Anchor{Text: "不存在", Occurrence: 0}, 0, false, 0, AnchorNearest, true},
		{"missing empty words", Anchor{Text: "发布", Occurrence: 0}, 0, true, -1, AnchorMissing, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			table := words
			if c.useEmpty {
				table = nil
			}
			idx, reason, ok := ResolveAnchors(c.anchor, table, c.prev)
			assert.Equal(t, c.wantOK, ok)
			assert.Equal(t, c.wantWhy, reason)
			if ok {
				assert.Equal(t, c.wantIdx, idx)
			}
		})
	}

	t.Run("nearest picks global minimum distance", func(t *testing.T) {
		// prev=1, absent text: distance to word 1 is 0
		idx, reason, ok := ResolveAnchors(Anchor{Text: "x"}, words, 1)
		require.True(t, ok)
		assert.Equal(t, AnchorNearest, reason)
		assert.Equal(t, 1, idx)
	})
}

func TestResolveAll_WritesBackResolvedFrom(t *testing.T) {
	ir := validIR()
	ir.Effects = []Effect{
		{ID: "fx_1", Anchor: Anchor{Text: "发布", Occurrence: 0}, Type: EffectPulse},
		{ID: "fx_2", Anchor: Anchor{Text: "三倍", Occurrence: 0}, Type: EffectCounter},
	}
	res := ResolveAll(ir, nil)
	require.Len(t, res, 2)
	require.NotNil(t, ir.Effects[0].ResolvedFrom)
	assert.Equal(t, 0, ir.Effects[0].ResolvedFrom.WordIndex)
	assert.Equal(t, AnchorExact, ir.Effects[0].ResolvedFrom.Reason)
	assert.Equal(t, 2, ir.Effects[1].ResolvedFrom.WordIndex)

	// Script edit: words shrink, occurrence out of range → same_text drift.
	ir.Words = []Word{
		{Index: 0, Text: "留存率", Start: 0.5, End: 1.0},
		{Index: 1, Text: "三倍", Start: 1.5, End: 2.0},
	}
	prev := PrevWordIndexes(ir)
	res = ResolveAll(ir, prev)
	require.Len(t, res, 2)
	// fx_1 text "发布" absent → nearest to prev index 0
	assert.Equal(t, 0, ir.Effects[0].ResolvedFrom.WordIndex)
	assert.Equal(t, AnchorNearest, ir.Effects[0].ResolvedFrom.Reason)
	assert.Equal(t, 1, ir.Effects[1].ResolvedFrom.WordIndex)
	assert.Equal(t, AnchorExact, ir.Effects[1].ResolvedFrom.Reason)
}

func TestEstimateWords_CharProportional(t *testing.T) {
	// weights 4/3 runes over 6s → 24/7s then the remainder.
	got := EstimateWords("产品发布 大成功", 6.0)
	require.Len(t, got, 2)
	assert.Equal(t, "产品发布", got[0].Text)
	assert.InDelta(t, 0, got[0].Start, 1e-9)
	assert.InDelta(t, 24.0/7.0, got[0].End, 1e-3)
	assert.Equal(t, "大成功", got[1].Text)
	assert.InDelta(t, 24.0/7.0, got[1].Start, 1e-3)
	assert.InDelta(t, 6.0, got[1].End, 1e-9)
	for _, w := range got {
		assert.Equal(t, WordSourceEstimated, w.Source)
	}

	t.Run("empty script", func(t *testing.T) {
		assert.Nil(t, EstimateWords("", 10))
	})
	t.Run("non-positive duration", func(t *testing.T) {
		assert.Nil(t, EstimateWords("hello", 0))
	})
	t.Run("last word closes duration exactly", func(t *testing.T) {
		got := EstimateWords("one two three", 9.0)
		require.Len(t, got, 3)
		assert.InDelta(t, 9.0, got[2].End, 1e-9)
	})
}

func TestSRT_Basic(t *testing.T) {
	words := []Word{
		{Index: 0, Text: "这款产品", Start: 0.5, End: 1.0, Source: WordSourceTTS},
		{Index: 1, Text: "发布后", Start: 1.0, End: 2.0, Source: WordSourceTTS},
		{Index: 2, Text: "留存率", Start: 3.0, End: 4.0, Source: WordSourceTTS},
		{Index: 3, Text: "提升了三倍。", Start: 4.0, End: 5.0, Source: WordSourceTTS},
	}
	out := SRT(words)
	// total 16 runes ≤ 2 lines and 4.5s ≤ 6s → one cue covering 0.5-5.0.
	require.Contains(t, out, "1\n00:00:00,500 --> 00:00:05,000\n")
	require.Contains(t, out, "这款产品发布后留存率提升了三倍。")
	assert.True(t, strings.HasSuffix(out, "\n\n"), "document ends with blank line")

	// gap > 6s between words forces a second cue.
	long := []Word{
		{Index: 0, Text: "开头", Start: 0, End: 1, Source: WordSourceTTS},
		{Index: 1, Text: "很久之后", Start: 10, End: 12, Source: WordSourceTTS},
	}
	out = SRT(long)
	require.Contains(t, out, "1\n00:00:00,000 --> 00:00:01,000\n")
	require.Contains(t, out, "2\n00:00:10,000 --> 00:00:12,000\n")
}

func TestBuildCues_Limits(t *testing.T) {
	// 40 one-second words → cues capped at 2 lines x 16 runes and 6s.
	var words []Word
	for i := 0; i < 40; i++ {
		words = append(words, Word{Index: i, Text: fmt.Sprintf("词%02d", i),
			Start: float64(i), End: float64(i) + 1, Source: WordSourceTTS})
	}
	cues := BuildCues(words)
	require.NotEmpty(t, cues)
	for _, c := range cues {
		assert.LessOrEqual(t, c.End-c.Start, maxCueSec+1e-9, "cue duration cap")
		for _, line := range strings.Split(c.Text, "\n") {
			assert.LessOrEqual(t, len([]rune(line)), maxLineRunes, "line length cap")
		}
		assert.LessOrEqual(t, len(strings.Split(c.Text, "\n")), maxLines, "line count cap")
	}
	// cues are contiguous and monotonic
	for i := 1; i < len(cues); i++ {
		assert.GreaterOrEqual(t, cues[i].Start, cues[i-1].Start)
	}
}

func TestBuildCues_PunctuationPreferred(t *testing.T) {
	words := []Word{
		{Text: "第一句。", Start: 0, End: 1},
		{Text: "第二句很长还没结束", Start: 1, End: 2},
		{Text: "第三句。", Start: 2, End: 3},
	}
	cues := BuildCues(words)
	require.NotEmpty(t, cues)
	assert.True(t, strings.HasSuffix(cues[0].Text, "。"), "first cue breaks after punctuation")
}

func TestSRT_Empty(t *testing.T) {
	assert.Empty(t, SRT(nil))
}
