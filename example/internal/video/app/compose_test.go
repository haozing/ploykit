package videoapp

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/webx"
)

// --- 剧本→视频生成器 service 集成（nil-pool 单测；DB 路径由集成套件覆盖） ---

// fakeComposer 返回一个最小合法 IR（过 Validate）；templateKey="bad" 模拟
// composer 侧的参数错误（scriptgen.Compose 对非法 key 的报错形态——同为
// E_VIDEO_IR_INVALID，经 Mutate 的错误透传路径原样冒出）。
func fakeComposer(ir IR) ScriptComposer {
	return func(script, templateKey, themeKey string, words []Word) (IR, error) {
		if templateKey == "bad" {
			return IR{}, webx.NewError(400, "E_VIDEO_IR_INVALID", "template: 未知模板 key「bad」")
		}
		return ir, nil
	}
}

func TestComposeProject_ComposerNotWired_IsNotConfigured(t *testing.T) {
	s := &ProjectService{log: testLogger()}
	_, err := s.ComposeProject(context.Background(), principal(), "p1", ComposeInput{
		Script: "第一段\n\n第二段", TemplateKey: "t", ThemeKey: "dark",
	})
	require.Error(t, err)
	var we *webx.Error
	require.True(t, errors.As(err, &we))
	assert.Equal(t, "E_NOT_CONFIGURED", we.Code)
	assert.Equal(t, 503, we.Status)
}

func TestTemplateCatalog_NilWiring_EmptyResponse(t *testing.T) {
	s := &ProjectService{log: testLogger()}
	cat := s.TemplateCatalog(context.Background())
	assert.Empty(t, cat.Templates)
	assert.Empty(t, cat.Themes)
}

func TestTemplateCatalog_WiredPassthrough(t *testing.T) {
	s := &ProjectService{log: testLogger()}
	s.WithTemplateCatalog(
		func() []TemplateCatalogEntry {
			return []TemplateCatalogEntry{{Key: "a", Name: "A", CanvasW: 1080, CanvasH: 1920, FPS: 30}}
		},
		func() []ThemeCatalogEntry {
			return []ThemeCatalogEntry{{Key: "dark", Name: "暗色", Accent: "#4f8", FontScale: 1.25}}
		})
	cat := s.TemplateCatalog(context.Background())
	require.Len(t, cat.Templates, 1)
	assert.Equal(t, "a", cat.Templates[0].Key)
	assert.Equal(t, 30, cat.Templates[0].FPS)
	require.Len(t, cat.Themes, 1)
	assert.Equal(t, 1.25, cat.Themes[0].FontScale)
}

func TestComposeProject_DegradeChain_Estimated(t *testing.T) {
	// 降级链（§8.5a 沿用）：无 TTS/Aligner → estimated；完整 Mutate 链路
	// 需要真实池（DB 集成套件覆盖），此处验证阶段 1 的词表来源语义。
	s := &ProjectService{log: testLogger()}
	ir := &IR{Meta: Meta{FPS: 30, Width: 1080, Height: 1920, DurationSec: 8}}
	pre, src, err := s.deriveWordsUnlocked(context.Background(), ir, "第一段 第二段")
	require.NoError(t, err)
	assert.Equal(t, WordSourceEstimated, src)
	assert.NotEmpty(t, pre.words)
	// 无配音轨时 observedVoiceKey 与 ir 的空 voice key 相等 → 不判 stale。
	assert.False(t, pre.staleAgainst(ir))
}

func TestComposeProject_VoiceDrift_StaleDetected(t *testing.T) {
	// 阶段间隙换配音轨的判定：observedVoiceKey 与当前 IR 不一致 → stale →
	// ComposeProject 闭包降级 estimated（逻辑与 SetScript 共享 staleAgainst）。
	ir := &IR{
		Meta:  Meta{FPS: 30, Width: 1080, Height: 1920, DurationSec: 8},
		Audio: &Audio{Voice: &AudioTrack{Key: "video/ws/new.mp3", DurationSec: 4}},
	}
	pre := &derivedWords{observedVoiceKey: "video/ws/old.mp3"}
	assert.True(t, pre.staleAgainst(ir))
}

// --- 与 scriptgen/template 的接线契约测试（同模块内跨包，app 不 import
// scriptgen——包环；此处用函数字面量模拟 main.go 的注入形态） ---

func TestScriptComposer_SignatureCompatibility(t *testing.T) {
	// scriptgen.Prepare 的形态与 ScriptComposer 一致（main.go 一行接线）。
	// app 不能 import scriptgen（scriptgen→app 单向），所以这里用一个
	// 形态相同的本地闭包证明注入路径可行；scriptgen 侧的单测
	// （scriptgen.compose_test.go TestPrepare_MatchesCompose）保证 Prepare
	// 与 Compose 行为一致，scriptgen 测试再保证 Compose 产物过 Validate。
	var c ScriptComposer = func(script, templateKey, themeKey string, words []Word) (IR, error) {
		return IR{Meta: Meta{FPS: 30, Width: 1080, Height: 1920, DurationSec: 3}}, nil
	}
	s := &ProjectService{log: testLogger()}
	s.WithScriptComposer(c, func(script string) ([]CardInfo, error) {
		return []CardInfo{{Role: "cover", Title: "t"}}, nil
	})
	assert.NotNil(t, s.composer)
	assert.NotNil(t, s.cardSplitter)
}

// --- G-01b compose 保音频：carryAudio 契约（纯函数，Mutate 闭包在
// *ir = composed 前调用；DB 全链路由集成套件覆盖） ---

func TestCarryAudio_KeepsExistingTracks(t *testing.T) {
	old := &IR{Audio: &Audio{
		Voice: &AudioTrack{Key: "video/ws/a/voice.mp3", DurationSec: 5, Volume: 1},
		BGM:   &AudioTrack{Key: "video/ws/a/bgm.mp3", Volume: 0.4},
	}}
	composed := &IR{Meta: Meta{FPS: 30, Width: 1080, Height: 1920, DurationSec: 10}}
	carryAudio(old, composed)
	require.NotNil(t, composed.Audio, "合成产物必须继承旧 IR 的音频轨（compose 抹音频 = 每次文案修改丢 BGM）")
	require.NotNil(t, composed.Audio.Voice)
	assert.Equal(t, "video/ws/a/voice.mp3", composed.Audio.Voice.Key)
	assert.InDelta(t, 0.4, composed.Audio.BGM.Volume, 1e-9)
}

func TestCarryAudio_ComposedAudioWins(t *testing.T) {
	// 产物自带音频时以产物为准（未来 composer 派生配音的场景）。
	old := &IR{Audio: &Audio{BGM: &AudioTrack{Key: "video/ws/old-bgm.mp3"}}}
	voice := &AudioTrack{Key: "video/ws/fresh-voice.mp3", DurationSec: 3}
	composed := &IR{Audio: &Audio{Voice: voice}}
	carryAudio(old, composed)
	require.NotNil(t, composed.Audio)
	assert.Same(t, voice, composed.Audio.Voice, "产物音频优先，不被旧 IR 覆盖")
	assert.Nil(t, composed.Audio.BGM, "产物未带的轨不回填（carryAudio 只在产物无音频时整体继承）")
}

func TestCarryAudio_NilOldIsNoop(t *testing.T) {
	composed := &IR{Meta: Meta{FPS: 30, Width: 1080, Height: 1920, DurationSec: 10}}
	carryAudio(&IR{}, composed)
	assert.Nil(t, composed.Audio)
}

// TestCarryAudio_ExtendsFilmForLongerVoice is the regression for the "black
// tail" defect: the composer times the film by the word table, while the
// render length is max(meta, voice). A carried voice longer than the spell-out
// used to leave the tail outside every element's window -> pure black frames.
func TestCarryAudio_ExtendsFilmForLongerVoice(t *testing.T) {
	last := 299
	oldIR := &IR{
		Audio: &Audio{Voice: &AudioTrack{Key: "video/ws/a/voice.mp3", DurationSec: 20}},
	}
	composed := &IR{
		Meta:      Meta{FPS: 30, Width: 1080, Height: 1920, DurationSec: 10}, // 300 frames
		Elements:  []Element{{ID: "bg", EndFrame: &last}},
	}
	carryAudio(oldIR, composed)

	if composed.Audio == nil || composed.Audio.Voice == nil {
		t.Fatal("voice track must be carried over")
	}
	if composed.Meta.DurationSec != 20 {
		t.Fatalf("meta.durationSec = %v, want 20 (raised to the voice length)", composed.Meta.DurationSec)
	}
	wantLast := DurationFrames(composed, composed.Meta.FPS) - 1 // 599
	if composed.Elements[0].EndFrame == nil || *composed.Elements[0].EndFrame != wantLast {
		t.Fatalf("last window end = %v, want %d (film must end with content, not black)",
			composed.Elements[0].EndFrame, wantLast)
	}
	if got := DurationFrames(composed, 30); got != 600 {
		t.Fatalf("DurationFrames = %d, want 600", got)
	}
}

// TestCarryAudio_ShorterVoiceDoesNotShrink: a voice shorter than the spell-out
// must not shorten the film (the word table still drives the length).
func TestCarryAudio_ShorterVoiceDoesNotShrink(t *testing.T) {
	last := 599
	oldIR := &IR{Audio: &Audio{Voice: &AudioTrack{Key: "video/ws/a/v.mp3", DurationSec: 5}}}
	composed := &IR{
		Meta:     Meta{FPS: 30, Width: 1080, Height: 1920, DurationSec: 20},
		Elements: []Element{{ID: "bg", EndFrame: &last}},
	}
	carryAudio(oldIR, composed)
	if composed.Meta.DurationSec != 20 {
		t.Fatalf("meta.durationSec = %v, want 20 unchanged", composed.Meta.DurationSec)
	}
	if *composed.Elements[0].EndFrame != 599 {
		t.Fatalf("window end = %d, want 599 unchanged", *composed.Elements[0].EndFrame)
	}
}
