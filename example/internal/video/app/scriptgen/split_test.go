package scriptgen

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	videoapp "myproduct/internal/video/app"
	"myproduct/internal/video/app/template"
)

// sampleScript 是典型中文剧本样例：封面段 + 两个小标题段 + 结尾段。
const sampleScript = `三分钟看懂视频工作室

这是我们最新推出的 Agent 视频能力，转化率提升了 87%。

## 为什么快

从剧本到成片只需要一步，过去要手摆几十个元素。
- 自动分卡
- 自动配时间窗

## 怎么用

把文案粘进来，选择模板，点击合成。

开始创作吧`

func TestSplitCards_ChineseSample(t *testing.T) {
	cards, err := SplitCards(sampleScript)
	require.NoError(t, err)
	require.GreaterOrEqual(t, len(cards), 3)
	// 首卡 cover：标题取首段，次段进 Body
	assert.Equal(t, "cover", cards[0].Role)
	assert.Equal(t, "三分钟看懂视频工作室", cards[0].Title)
	assert.Contains(t, cards[0].Body, "87%")
	// bullet 段 → listicle
	foundListicle := false
	for _, c := range cards[1 : len(cards)-1] {
		if c.Role == "listicle" {
			foundListicle = true
			assert.Contains(t, c.Items, "自动分卡")
		}
	}
	assert.True(t, foundListicle, "bullet 段应产出 listicle 卡")
	// 末卡 endcard
	assert.Equal(t, "endcard", cards[len(cards)-1].Role)
	assert.Equal(t, "开始创作吧", cards[len(cards)-1].Title)
}

func TestSplitCards_TooFewParagraphs(t *testing.T) {
	_, err := SplitCards("只有一段的剧本")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "至少")
}

func TestSplitCards_TooManyParagraphs(t *testing.T) {
	// 21 段（上限 20 + 1）报可读错误
	blocks := make([]string, 21)
	for i := range blocks {
		blocks[i] = "段落"
	}
	_, err := SplitCards(strings.Join(blocks, "\n\n"))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "超出上限")
}

func TestStripMarkdownLine(t *testing.T) {
	cases := []struct {
		in, want string
		bullet   bool
	}{
		{"## 标题", "标题", false},
		{"### 三级标题", "三级标题", false},
		{"- 列表项", "列表项", true},
		{"* 星号列表", "星号列表", true},
		{"1. 有序列表", "有序列表", true},
		{"2、顿号列表", "顿号列表", true},
		{"**粗体**文字", "粗体文字", false},
		{"`代码`", "代码", false},
		{"普通一行", "普通一行", false},
		{"   ", "", false},
	}
	for _, c := range cases {
		got, bullet := stripMarkdownLine(c.in)
		assert.Equal(t, c.want, got, c.in)
		assert.Equal(t, c.bullet, bullet, c.in)
	}
}

func TestKeywordAnchors_TextIsScriptSubstring(t *testing.T) {
	cards, err := SplitCards(sampleScript)
	require.NoError(t, err)
	// 锚文本必须 ∈ script 原词（否则 resolve 会 missing）
	anchors := KeywordAnchors(sampleScript, cards)
	require.NotEmpty(t, anchors, "含 87% 的样例必须抽出至少一个关键词")
	for _, a := range anchors {
		assert.True(t, strings.Contains(sampleScript, a.Text),
			"锚文本 %q 必须是 script 原词的 substring", a.Text)
	}
	// 数字/百分比优先：87% 应在集合中
	found := false
	for _, a := range anchors {
		if a.Text == "87%" {
			found = true
		}
	}
	assert.True(t, found, "百分比 87%% 应优先抽出，anchors=%v", anchors)
}

func TestKeywordRunner_CJKNumberish(t *testing.T) {
	kws := keywordRunner("转化率提升了三倍，成本只有五折。")
	require.NotEmpty(t, kws)
	assert.Contains(t, kws, "三倍")
	assert.Contains(t, kws, "五折")
	// 「三体」不应误标（第二位不是量词）
	assert.NotContains(t, keywordRunner("推荐阅读三体"), "三体")
}

func TestSplitTokens(t *testing.T) {
	toks := splitTokens("转化率 87%，提升了三倍")
	assert.Contains(t, toks, "87%")
	assert.Contains(t, toks, "转化率")
	assert.Contains(t, toks, "提升了三倍")
}

func TestComputeWindows_WordTableCeilFrames(t *testing.T) {
	// 词表：2 个词，0-1s、1-2.5s @30fps → ceil: [0,30) [30,75)
	words := []videoapp.Word{
		{Index: 0, Text: "第一段文案", Start: 0, End: 1},
		{Index: 1, Text: "第二段文案更长一些", Start: 1, End: 2.5},
	}
	cards := []template.Card{{Role: "cover", Title: "第一段文案"}, {Role: "endcard", Title: "第二段文案更长一些"}}
	weights := cardWeights(cards)
	ws := computeWindows(cards, weights, words, 30, 75)
	require.Len(t, ws, 2)
	// 首窗起点 = ceil(0×30) = 0
	assert.Equal(t, 0, ws[0][0])
	// 末窗终点 = ceil(2.5×30) = 75
	assert.Equal(t, 75, ws[1][1])
	// 无重叠、顺序衔接：ws[0][1] <= ws[1][0] 或恰好衔接
	assert.LessOrEqual(t, ws[0][1], ws[1][0]+1)
}

func TestComputeWindows_NoWordTable_Proportional(t *testing.T) {
	cards := []template.Card{{Role: "cover", Title: "短"}, {Role: "feature", Title: "长一些的内容"}, {Role: "endcard", Title: "结尾"}}
	weights := cardWeights(cards)
	ws := computeWindows(cards, weights, nil, 30, 300)
	require.Len(t, ws, 3)
	assert.Equal(t, 0, ws[0][0], "首窗起点归 0")
	assert.Equal(t, 300, ws[len(ws)-1][1], "末窗终点归 durationFrames")
	for i := 1; i < len(ws); i++ {
		assert.GreaterOrEqual(t, ws[i][0], ws[i-1][1]-1, "窗口互不重叠（衔接容差 1 帧）")
	}
}

func TestWindowFades_Shape(t *testing.T) {
	// 有窗卡：fadeIn 锚窗口开帧（builder 侧规则，StartAnchor 留空由 builder
	// 按所属元素窗口解析）；fadeOut 结束在窗口关帧。
	fades := windowFades(1, 30, 300)
	require.Len(t, fades, 2)
	assert.Equal(t, "fadeIn", fades[0].Type)
	assert.Equal(t, "fadeOut", fades[1].Type)
	for _, f := range fades {
		assert.Greater(t, f.DurationFrames, 0)
		assert.LessOrEqual(t, f.DurationFrames, 16, "淡入淡出 10-12 帧量级")
		assert.Nil(t, f.StartAnchor, "StartAnchor 留空——builder 按所属元素窗口锚定")
	}
	// 首卡（窗口起 0）不发 fadeIn：锚在 0 的 fromTo 会把 F0 压黑（batch-6
	// F0 黑帧同类病灶）。
	fades = windowFades(2, 0, 300)
	require.Len(t, fades, 1)
	assert.Equal(t, "fadeOut", fades[0].Type)
	// 窗口宽 ≤1 帧不发淡出（没有渐变空间）。
	fades = windowFades(3, 5, 5)
	require.Empty(t, fades)
}

func TestNormalizeWindows_FloorGuarantee(t *testing.T) {
	// 真调案例：4 段文案 → cover 吸收次段 = 3 卡，末卡 CTA 字符权重极小，
	// 比例分配只拿到 1 帧（[299,300]）。保底后末卡必须有 ≥45 帧可读时长。
	cards := []template.Card{
		{Role: "cover", Title: "三分钟看懂视频工作室", Body: "这是我们最新推出的 Agent 视频能力，转化率提升了百分之八十七"},
		{Role: "feature", Title: "为什么快", Body: "从剧本到成片只需要一步，自动分卡自动配时间窗自动配关键词"},
		{Role: "endcard", Title: "开始创作", Body: "现在就打开工作台试试吧"},
	}
	weights := cardWeights(cards)
	ws := computeWindows(cards, weights, nil, 30, 300)
	require.Len(t, ws, 3)
	floor := minCardFrames(30)
	for i, w := range ws {
		assert.GreaterOrEqual(t, w[1]-w[0], floor,
			"卡 %d 窗口宽 %d 帧低于保底 %d", i, w[1]-w[0], floor)
	}
	assert.Equal(t, 0, ws[0][0])
	assert.Equal(t, 300, ws[2][1])
}

func TestNormalizeWindows_SharedBoundaryNoGap(t *testing.T) {
	// 无缝硬切口径：相邻窗口共享交界帧（前 end == 后 start）；任何窗口
	// 不重叠（后 start >= 前 start+1）。builder 的半帧 ε hide set 让交界
	// 帧归前卡含尾、下一帧起归后卡——不会出现两卡同隐的 1 帧空隙。
	cards := []template.Card{
		{Role: "cover", Title: "封面标题"},
		{Role: "feature", Title: "中段内容比封面长一些"},
		{Role: "feature", Title: "第二中段内容也不短"},
		{Role: "endcard", Title: "结尾"},
	}
	weights := cardWeights(cards)
	ws := computeWindows(cards, weights, nil, 30, 300)
	require.Len(t, ws, 4)
	for i := 1; i < len(ws); i++ {
		assert.Greater(t, ws[i][0], ws[i-1][0], "窗口起点严格递增（不重叠）")
		assert.Equal(t, ws[i-1][1], ws[i][0], "相邻窗口共享交界帧（无缝硬切）")
	}
}
