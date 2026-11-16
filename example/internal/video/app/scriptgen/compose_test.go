package scriptgen

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	videoapp "myproduct/internal/video/app"
)

// composeSampleScript 覆盖 cover/listicle/feature/endcard 四种版式的完整样例。
const composeSampleScript = `三分钟看懂视频工作室

这是我们最新推出的 Agent 视频能力，转化率提升了 87%。

## 为什么快

从剧本到成片只需要一步。
- 自动分卡
- 自动配时间窗
- 自动配关键词

## 怎么用

把文案粘进来，选择模板，点击合成，渲染走既有队列。

开始创作吧`

func TestCompose_PassesValidate(t *testing.T) {
	ir, err := Compose(composeSampleScript, "cover", "ink", nil)
	require.NoError(t, err)
	require.NoError(t, videoapp.Validate(&ir), "Compose 产物必须过 videoapp.Validate")
	// meta 用模板画布/FPS
	assert.Equal(t, 1080, ir.Meta.Width)
	assert.Equal(t, 1920, ir.Meta.Height)
	assert.Equal(t, 30, ir.Meta.FPS)
	assert.Equal(t, composeSampleScript, ir.Script)
	// 元素窗口衔接：按 StartFrame 排序后互不越界、首窗起 0、末窗终 = durationFrames
	require.NotEmpty(t, ir.Elements)
	maxEnd := 0
	for _, el := range ir.Elements {
		require.NotNil(t, el.StartFrame)
		require.NotNil(t, el.EndFrame)
		if *el.EndFrame > maxEnd {
			maxEnd = *el.EndFrame
		}
	}
	assert.Equal(t, videoapp.DurationFrames(&ir, ir.Meta.FPS), maxEnd,
		"末窗终点 = DurationFrames（单一真源口径）")
	// fadeOut 动画已加到每个元素；fadeIn 首卡不发（窗口起 0，锚 0 的
	// fromTo 会把 F0 压黑）——windowFades 契约，builder 按所属元素窗口锚定。
	for _, el := range ir.Elements {
		require.NotEmpty(t, el.Animations, "每元素至少带一个 fadeOut")
		assert.Equal(t, "fadeOut", el.Animations[len(el.Animations)-1].Type)
		for _, an := range el.Animations {
			assert.Nil(t, an.StartAnchor, "淡入淡出 StartAnchor 留空（builder 窗口锚定契约）")
		}
	}
}

func TestCompose_KeywordAnchorsResolveExact(t *testing.T) {
	words := videoapp.EstimateWords(composeSampleScript, 24.0)
	ir, err := Compose(composeSampleScript, "cover", "midnight", words)
	require.NoError(t, err)
	require.NoError(t, videoapp.Validate(&ir))
	require.NotEmpty(t, ir.Effects, "含 87%% 的样例应产出高亮效果")
	for _, fx := range ir.Effects {
		assert.Equal(t, videoapp.EffectHighlight, fx.Type)
		// 锚文本必须 ∈ script 原词（resolve 不 missing 的前提）
		assert.True(t, strings.Contains(composeSampleScript, fx.Anchor.Text),
			"锚文本 %q 必须是 script 原词", fx.Anchor.Text)
		require.NotNil(t, fx.ResolvedFrom)
		assert.NotEqual(t, videoapp.AnchorMissing, fx.ResolvedFrom.Reason,
			"词表由 EstimateWords 派生时锚必须可解析（reason=%s text=%s）", fx.ResolvedFrom.Reason, fx.Anchor.Text)
	}
}

func TestCompose_UnknownKeys(t *testing.T) {
	_, err := Compose(composeSampleScript, "no-such-template", "ink", nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "未知模板")

	_, err = Compose(composeSampleScript, "cover", "no-such-theme", nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "未知主题")
}

func TestCompose_DurationFromWordTable(t *testing.T) {
	words := videoapp.EstimateWords(composeSampleScript, 40.0)
	ir, err := Compose(composeSampleScript, "cover", "ink", words)
	require.NoError(t, err)
	assert.InDelta(t, 40.0, ir.Meta.DurationSec, 1e-9, "durationSec 取词表末词 end")
	assert.Equal(t, videoapp.WordSourceEstimated, ir.Words[0].Source)
}

func TestCompose_NoWordTable_DurationEstimated(t *testing.T) {
	ir, err := Compose(composeSampleScript, "cover", "ink", nil)
	require.NoError(t, err)
	assert.Greater(t, ir.Meta.DurationSec, 0.0)
	require.NoError(t, videoapp.Validate(&ir))
}

func TestPrepare_MatchesCompose(t *testing.T) {
	irA, errA := Prepare(composeSampleScript, "cover", "ink", nil)
	irB, errB := Compose(composeSampleScript, "cover", "ink", nil)
	require.NoError(t, errA)
	require.NoError(t, errB)
	assert.Equal(t, irB, irA, "Prepare 是 Compose 的绑定别名")
}

func TestSplitCards_BulletOnlyMiddleRoles(t *testing.T) {
	cards, err := SplitCards(composeSampleScript)
	require.NoError(t, err)
	require.Equal(t, "cover", cards[0].Role)
	require.Equal(t, "endcard", cards[len(cards)-1].Role)
	// 中间卡：listicle（bullet 段）与 feature 混合，全部 role ∈ 模板目录
	roles := map[string]bool{"cover": true, "feature": true, "listicle": true, "chart": true, "quote": true, "endcard": true}
	for _, c := range cards {
		assert.True(t, roles[c.Role], "卡 role %q 必须在模板目录内", c.Role)
	}
}
