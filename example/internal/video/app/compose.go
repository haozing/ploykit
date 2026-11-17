package videoapp

import (
	"context"

	"github.com/haozing/ploykit/platform/webx"
)

// ScriptComposer 是"剧本文案 + 模板 + 主题 + 词表 → 完整 IR"的纯函数契约
// （剧本→视频生成器，2026-11 批次）。实现位于 app/scriptgen（scriptgen
// import app——app 不能反向 import scriptgen，否则包环），boot 时通过
// WithScriptComposer 注入。words 是 SetScript 同款降级链
// （TTS → Aligner → EstimateWords）派生的词表，可为 nil（composer 内部
// 按字数比例估算窗口）。返回的 IR 必须通过 Validate（scriptgen.Compose
// 内部已跑；Mutate 会再跑一次作为最终门）。
type ScriptComposer func(script, templateKey, themeKey string, words []Word) (IR, error)

// CardSplitter 是分卡摘要投影：输入与 ScriptComposer 相同（词表可为 nil），
// 返回每张卡的 role/title 摘要，供响应体 cards 字段使用。与 composer 一同
// 注入（scriptgen 同时暴露两者，摘要与合成永远同源）。
type CardSplitter func(script string) ([]CardInfo, error)

// WithScriptComposer 注入剧本→IR 合成器 + 分卡摘要（boot / 测试接线点，
// 幂等覆盖；splitter 可为 nil——nil 时响应的 cards 为空数组）。
func (s *ProjectService) WithScriptComposer(compose ScriptComposer, split CardSplitter) {
	s.composer = compose
	s.cardSplitter = split
}

// TemplateInfo / ThemeInfo 是模板/主题目录的 REST 投影（GET
// /api/video/templates 一次返回两目录，前端画模板选择卡片用）。
type TemplateInfo struct {
	Key         string `json:"key"`
	Name        string `json:"name"`
	Description string `json:"description"`
	CanvasW     int    `json:"canvas_w"`
	CanvasH     int    `json:"canvas_h"`
	FPS         int    `json:"fps"`
	SafeMargin  int    `json:"safe_margin"`
	// Layout describes the版式 (card structure) in words so an agent can pick
	// a template deliberately instead of composing blind and screenshotting to
	// find out (plan G-08a: "video_list_templates 仅文字描述 + 尺寸参数").
	Layout string `json:"layout"`
}

type ThemeInfo struct {
	Key       string  `json:"key"`
	Name      string  `json:"name"`
	BG        string  `json:"bg"`
	FG        string  `json:"fg"`
	Accent    string  `json:"accent"`
	Muted     string  `json:"muted"`
	FontScale float64 `json:"font_scale"`
}

// TemplateCatalogResponse 是目录端点的响应体。
type TemplateCatalogResponse struct {
	Templates []TemplateInfo `json:"templates"`
	Themes    []ThemeInfo    `json:"themes"`
}

// TemplateCatalogEntry / ThemeCatalogEntry 是目录数据源的行类型：目录数据
// 由 template 包提供（同包环约束——app 不 import template），main.go 一行
// 注入 func() []Entry。
type TemplateCatalogEntry = struct {
	Key, Name, Description string
	CanvasW, CanvasH, FPS  int
	SafeMargin             int
	Layout                 string
}

type ThemeCatalogEntry = struct {
	Key, Name, BG, FG, Accent, Muted string
	FontScale                        float64
}

// WithTemplateCatalog 注入模板/主题目录数据源（nil = 空目录响应）。
func (s *ProjectService) WithTemplateCatalog(templates func() []TemplateCatalogEntry, themes func() []ThemeCatalogEntry) {
	s.templateCatalog = templates
	s.themeCatalog = themes
}

// TemplateCatalog 返回模板 + 主题目录（读路径：无 DB 依赖；目录是静态
// 产物，route 层已有 video:read 门）。
func (s *ProjectService) TemplateCatalog(ctx context.Context) TemplateCatalogResponse {
	out := TemplateCatalogResponse{Templates: []TemplateInfo{}, Themes: []ThemeInfo{}}
	if s.templateCatalog != nil {
		for _, t := range s.templateCatalog() {
			out.Templates = append(out.Templates, TemplateInfo{
				Key: t.Key, Name: t.Name, Description: t.Description,
				CanvasW: t.CanvasW, CanvasH: t.CanvasH, FPS: t.FPS, SafeMargin: t.SafeMargin,
			})
		}
	}
	if s.themeCatalog != nil {
		for _, th := range s.themeCatalog() {
			out.Themes = append(out.Themes, ThemeInfo{
				Key: th.Key, Name: th.Name, BG: th.BG, FG: th.FG,
				Accent: th.Accent, Muted: th.Muted, FontScale: th.FontScale,
			})
		}
	}
	return out
}

// ComposeInput 是 ComposeProject 的参数包（REST body / MCP tool input 同构）。
type ComposeInput struct {
	Script          string `json:"script"`
	TemplateKey     string `json:"template"`
	ThemeKey        string `json:"theme"`
	ExpectedVersion *int   `json:"expected_version,omitempty"`
}

// CardInfo 是一张合成卡片的摘要（role/title 给前端/agent 验视用）。
// 有意做成 struct 别名：scriptgen.CardInfo 字段一致（跨包结构化类型等价），
// main.go 的适配闭包可直接构造，无需 scriptgen 反向依赖本包。
type CardInfo = struct {
	Role  string `json:"role"`
	Title string `json:"title"`
}

// ComposeResult 是 ComposeProject 的响应投影：新版本号 + 卡片摘要 +
// 词表来源（沿 SetScript 语义 tts|aligner|estimated）+ 锚点解析审计。
type ComposeResult struct {
	Version     int                `json:"version"`
	Cards       []CardInfo         `json:"cards"`
	WordsSource string             `json:"words_source"`
	Resolutions []AnchorResolution `json:"resolutions,omitempty"`
}

// carryAudio 把旧 IR 的音频轨迁移到合成产物上（G-01b compose 保音频补丁）：
// composer 组装的 IR 不含 Audio 字段，整体替换会把已挂的 BGM/配音静默抹掉
// （每次 set_card 即 compose——BGM 在每次文案修改后丢失，与 SetScript 保留
// audio 的行为不一致）。合成产物自己带音频时以产物为准（未来 composer
// 派生配音的场景）。纯函数：Mutate 闭包在 *ir = composed 前调用。
func carryAudio(old, composed *IR) {
	if composed.Audio == nil && old.Audio != nil {
		composed.Audio = old.Audio
	}
	// Reconcile the film length with the carried voice track. The composer
	// derives Meta.DurationSec from the WORD TABLE, while DurationFrames()
	// takes max(meta, voice). A carried voice longer than the spell-out (the
	// normal case here: this example never wires TTS/aligner, and an uploaded
	// narration keeps its real duration) made the render longer than every
	// element's window — the elements were hidden and the tail decoded as pure
	// black (delivery audit P1). Raising meta and stretching the last window
	// makes both formulas agree.
	if composed.Audio == nil || composed.Audio.Voice == nil {
		return
	}
	voice := composed.Audio.Voice.DurationSec
	if voice <= composed.Meta.DurationSec {
		return
	}
	composed.Meta.DurationSec = voice
	last := DurationFrames(composed, composed.Meta.FPS) - 1
	if last < 0 {
		last = 0
	}
	// Stretch the element that ends latest (usually the full-canvas background
	// or the final card) to the new film end.
	target := -1
	for i := range composed.Elements {
		e := &composed.Elements[i]
		if e.EndFrame == nil {
			continue
		}
		if target < 0 || *e.EndFrame > *composed.Elements[target].EndFrame {
			target = i
		}
	}
	if target >= 0 && *composed.Elements[target].EndFrame < last {
		composed.Elements[target].EndFrame = &last
	}
}

// ComposeProject 把一段剧本文案合成为完整 IR 并持久化（剧本→视频生成器
// 主入口；HTTP POST /api/video/projects/{id}/compose 与未来的 MCP 工具
// 共用本方法）。
//
// 两阶段化思路复用 SetScript（audit P6）：
//
//	阶段 0：Get（无锁读）拿 IR 快照 + 乐观锁预检；
//	阶段 1：deriveWordsUnlocked 跑外部调用（TTS/Aligner，无行锁）；
//	阶段 2：Mutate 短锁——composer(script, keys, words) 合成 IR 并整体替换，
//	        随后走 Mutate 的全量 Validate / 锚点重解析 / version++ / 审计 /
//	        committed WS push。
//
// 永不因 TTS/Aligner 缺失失败（§8.5a 裁定沿用）：词表降级到 estimated，
// words_source 如实反映来源。composer 未接线 → E_NOT_CONFIGURED（503，
// 不新增错误码族）。expected_version 语义与 SetScript/SubmitRender 一致。
func (s *ProjectService) ComposeProject(ctx context.Context, p *webx.Principal, projectID string, in ComposeInput) (ComposeResult, error) {
	if s.composer == nil {
		return ComposeResult{}, ErrNotConfigured
	}
	// 阶段 0：无锁快照 + 乐观锁预检（与 SetScript 相同的门序）。
	pr, err := s.Get(ctx, p, projectID)
	if err != nil {
		return ComposeResult{}, err
	}
	if in.ExpectedVersion != nil && *in.ExpectedVersion != pr.Version {
		return ComposeResult{}, conflict(pr.Version)
	}

	// 阶段 1：外部调用（TTS/Aligner）不持行锁；失败降级 estimated。
	pre, source, derr := s.deriveWordsUnlocked(ctx, pr.IR, in.Script)
	if derr != nil {
		return ComposeResult{}, derr
	}

	// 阶段 2：短锁合成 + 整体替换。
	wordsSource := source
	newVersion, resolutions, err := s.Mutate(ctx, p, projectID, in.ExpectedVersion, func(ir *IR) error {
		words := pre.words
		if pre.staleAgainst(ir) {
			// 阶段间隙换过配音轨：aligner 词钉在旧音频上——降级 estimated。
			s.log.Info("compose: voice changed during derivation; falling back to estimate", "project_id", projectID)
			words = EstimateWords(in.Script, ir.Meta.DurationSec)
			wordsSource = WordSourceEstimated
		}
		composed, cerr := s.composer(in.Script, in.TemplateKey, in.ThemeKey, words)
		if cerr != nil {
			return cerr
		}
		// G-01b：合成产物不覆盖已挂音频（carryAudio 的契约见上方注释）。
		carryAudio(ir, &composed)
		*ir = composed
		return nil
	})
	if err != nil {
		return ComposeResult{}, err
	}
	// 卡片摘要（合成已成功；分卡失败不可能——同一输入刚通过了合成）。
	cards := []CardInfo{}
	if s.cardSplitter != nil {
		if ci, cerr := s.cardSplitter(in.Script); cerr == nil {
			cards = ci
		}
	}
	// TTS 新配音 key 的登记（与 SetScript 同款 after-commit 注册）。
	if pre.ttsAsset != nil {
		if rerr := s.registerAsset(ctx, nil, p.WorkspaceID, projectID,
			pre.ttsAsset.key, AssetKindAudio, pre.ttsAsset.size, pre.ttsAsset.sha,
			pre.ttsAsset.contentType); rerr != nil {
			s.log.Warn("compose: tts voice asset registration failed", "project_id", projectID, "err", rerr)
		}
	}
	return ComposeResult{
		Version:     newVersion,
		Cards:       cards,
		WordsSource: wordsSource,
		Resolutions: resolutions,
	}, nil
}
