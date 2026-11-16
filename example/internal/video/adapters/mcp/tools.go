// Package videomcp registers the video_* MCP tools (§4.6) on the product
// mcpx server. Implementation pattern = devx tools.go: typed input struct
// with jsonschema tags, first line of every handler requireToolScope (PAT
// scope gate), then the shared ProjectService method (HTTP and MCP hit the
// same code). Tool errors surface as MCP error text carrying the webx error
// code (E_VIDEO_* / E_NOT_CONFIGURED / E_QUOTA_EXCEEDED); /mcp routes are
// contract-exempt (ADR 0014) so these tools do not appear in openapi.yaml.
package videomcp
import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/haozing/ploykit/platform/storagex"
	"github.com/haozing/ploykit/platform/webx"

	videoapp "myproduct/internal/video/app"
	videorender "myproduct/internal/video/render"
)

// Scope names (authz catalog keys; the wiring layer registers them).
const (
	ScopeRead   = "video:read"
	ScopeWrite  = "video:write"
	ScopeRender = "video:render"
)

// ErrScopeDenied mirrors devx.ErrScopeDenied semantics (tools_test asserts
// the message shape, not the sentinel identity).
var ErrScopeDenied = errors.New("videomcp: scope denied")

// addEffectIn is the video_add_effect_at_word input (package-level so tests
// can pin the wire shape). TargetElementID is the optional element-level
// target of the IR extension (T-10): it lands on Effect.TargetElementID
// (targetElementId in the IR document) and is write-time validated there.
type addEffectIn struct {
	ProjectID       string          `json:"project_id" jsonschema:"project id"`
	AnchorText      string          `json:"anchor_text" jsonschema:"anchor word text (must exist in words[]; miss = error)"`
	Occurrence      int             `json:"occurrence,omitempty" jsonschema:"0-based occurrence of the text among words (default 0)"`
	Type            string          `json:"type" jsonschema:"effect type: pulse|counter|highlight|shake|fade"`
	Params          json.RawMessage `json:"params,omitempty" jsonschema:"effect params object, validated per type"`
	TargetElementID string          `json:"target_element_id,omitempty" jsonschema:"optional element id the effect targets (must exist in elements[]; counter positions its host at that element's bbox)"`
	ExpectedVersion *int            `json:"expected_version,omitempty" jsonschema:"optimistic-lock version"`
}

// Deps carries the service plus the capability probe (no capx import: the
// probe and the snapshotter are interfaces so the tools compile without
// chromedp). Snapshot nil = single-frame capture offline — the
// video_snapshot_frame tool then degrades to a structured E_NOT_CONFIGURED
// error telling the agent to fall back to video_inspect. FrameExtract nil =
// encoded-output frame extraction offline — video_render_frames degrades the
// same way (batch G 的两双眼睛走同一套桥接/降级约定).
type Deps struct {
	Svc *videoapp.ProjectService
	Cap videoapp.CapProbe
	// Store serves the snapshot projection's asset inlining (data URIs, the
	// same zero-network document shape as the render pipeline). Optional: nil
	// only degrades video_snapshot_frame when the IR carries image elements.
	Store storagex.Store
	// Snapshot returns the single-frame capture bridge (videorender.
	// SnapshotterFor in production wiring; a fake in tests). Nil-safe: the
	// snapshot tools report E_NOT_CONFIGURED when nil or when the bridge
	// itself is unwired (stub build).
	Snapshot func() videorender.Snapshotter
	// FrameExtract returns the encoded-output frame extractor bridge
	// (videorender.FrameExtractorFor in production wiring; a fake in tests).
	// Nil-safe like Snapshot: video_render_frames reports E_NOT_CONFIGURED.
	FrameExtract func() videorender.FrameExtractor
}

// RegisterTools installs the video_* MCP tool family — the agent's hands and
// eyes over the video studio. Division of labor: the agent (the model) owns
// creative decisions and orchestration; the tools execute deterministically
// and report ground truth back. Registration order below is hands → eyes →
// misc (order carries no behavioral meaning).
//
//   - Hands (deterministic execution): video_compose lays out the whole IR
//     from a script; video_upsert_element / video_move_element /
//     video_animate_element / video_add_effect_at_word make surgical IR edits;
//     video_upload_asset brings material in; video_render spends quota.
//   - Eyes (ground truth to judge by): video_inspect returns the IR plus every
//     anchor's resolution (exact|same_text|nearest|missing);
//     video_snapshot_frame / video_preview_frames return rendered frames
//     before encoding (IR truth); video_render_frames returns frames of the
//     encoded MP4 (deliverable truth — catches encoder/subtitle issues).
//   - Plumbing / misc: video_create_project, video_set_script,
//     video_set_words, video_list_templates, video_list_projects,
//     video_get_render, video_validate, video_list_elements, and the
//     video_generate_video shortcut.
//
// Recommended orchestration order: video_create_project → video_set_script →
// video_list_templates → video_compose → video_inspect (fix missing anchors)
// → surgical refinement → video_snapshot_frame / video_preview_frames (look)
// → video_render → video_get_render (poll) → video_render_frames (verify the
// encoded output). Every hand edit feeds the eye loop: edit → inspect/
// snapshot → decide → edit again.
func RegisterTools(s *mcp.Server, deps Deps) {
	// ==================== Hands: deterministic execution ====================

	// ---- video_compose (video:write) ----
	type composeIn struct {
		ProjectID       string `json:"project_id" jsonschema:"project id"`
		Script          string `json:"script" jsonschema:"narration script text (Chinese aware; blank lines split cards; 2-20 cards)"`
		Template        string `json:"template" jsonschema:"template key from video_list_templates (cover|listicle|feature|chart|quote|endcard)"`
		Theme           string `json:"theme" jsonschema:"theme key from video_list_templates (ink|midnight|vigoro|pastel)"`
		ExpectedVersion *int   `json:"expected_version,omitempty" jsonschema:"optimistic-lock version; omit to skip the check"`
		WorkspaceID     string `json:"workspace_id,omitempty" jsonschema:"target workspace — required only for multi-workspace PATs; single-workspace PATs resolve automatically"`
	}
	mcpAdd(s, "video_compose",
		"Compose a whole video from one narration script (THE normal path — no hand-placed elements needed): cards are split from the script "+
			"(blank lines / list items), laid out with the chosen template × theme, timed against the derived word table (TTS → aligner → estimated, "+
			"never fails on missing TTS — check words_source), keyword highlights anchored at real words. Replaces the project IR wholesale (audio tracks survive) and bumps version. "+
			"Editing copy? Re-run compose with the corrected FULL script — cards are re-split and re-timed atomically (there is no per-card edit tool; surgical element tweaks remain available via video_upsert_element / video_move_element). "+
			"Response carries the card list, words_source, and every anchor resolution (reason: exact|same_text|nearest|missing). "+
			"After editing, call video_snapshot_frame to see the frame and judge visually; video_inspect shows the IR + anchor resolutions.",
		ScopeWrite, func(ctx context.Context, _ *mcp.CallToolRequest, in composeIn) (any, error) {
			p, err := resolveWorkspacePrincipal(webx.PrincipalFrom(ctx), in.WorkspaceID)
			if err != nil {
				return nil, err
			}
			res, err := deps.Svc.ComposeProject(ctx, p, in.ProjectID, videoapp.ComposeInput{
				Script: in.Script, TemplateKey: in.Template, ThemeKey: in.Theme, ExpectedVersion: in.ExpectedVersion,
			})
			if err != nil {
				return nil, err
			}
			return res, nil
		})

	// ---- video_upsert_element (video:write) ----
	type upsertElementIn struct {
		ProjectID       string         `json:"project_id" jsonschema:"project id"`
		Element         map[string]any `json:"element" jsonschema:"element object {id,type:image|text|shape,src?,x,y,w,h,z,animations?}; src must be a video/<workspace>/ storage key uploaded first (unregistered src = 400 E_VIDEO_IR_INVALID details.field elements[N].src)"`
		ExpectedVersion *int           `json:"expected_version,omitempty" jsonschema:"optimistic-lock version"`
		WorkspaceID     string         `json:"workspace_id,omitempty" jsonschema:"target workspace — required only for multi-workspace PATs; single-workspace PATs resolve automatically"`
	}
	mcpAdd(s, "video_upsert_element",
		"Insert or replace one canvas element by id. Image src must reference an uploaded asset (video_upload_asset first); a dangling src is rejected at write time with E_VIDEO_IR_INVALID (asset not registered). "+
			"After editing, call video_snapshot_frame to see the frame and judge visually; video_inspect shows the IR + anchor resolutions.",
		ScopeWrite, func(ctx context.Context, _ *mcp.CallToolRequest, in upsertElementIn) (any, error) {
			p, err := resolveWorkspacePrincipal(webx.PrincipalFrom(ctx), in.WorkspaceID)
			if err != nil {
				return nil, err
			}
			el, err := decodeElement(in.Element)
			if err != nil {
				return nil, err
			}
			version, _, err := deps.Svc.UpsertElement(ctx, p, in.ProjectID, el, in.ExpectedVersion)
			if err != nil {
				return nil, err
			}
			return map[string]any{"version": version}, nil
		})

	// ---- video_move_element (video:write) ----
	type moveElementIn struct {
		ProjectID       string  `json:"project_id" jsonschema:"project id"`
		ElementID       string  `json:"element_id" jsonschema:"element id to move"`
		X               float64 `json:"x" jsonschema:"new x (canvas px; clamped at projection)"`
		Y               float64 `json:"y" jsonschema:"new y"`
		ExpectedVersion *int    `json:"expected_version,omitempty" jsonschema:"optimistic-lock version"`
		WorkspaceID     string  `json:"workspace_id,omitempty" jsonschema:"target workspace — required only for multi-workspace PATs; single-workspace PATs resolve automatically"`
	}
	mcpAdd(s, "video_move_element",
		"Reposition one element. After editing, call video_snapshot_frame to see the frame and judge visually; video_inspect shows the IR + anchor resolutions.",
		ScopeWrite, func(ctx context.Context, _ *mcp.CallToolRequest, in moveElementIn) (any, error) {
			p, err := resolveWorkspacePrincipal(webx.PrincipalFrom(ctx), in.WorkspaceID)
			if err != nil {
				return nil, err
			}
			version, err := deps.Svc.MoveElement(ctx, p, in.ProjectID, in.ElementID, in.X, in.Y, in.ExpectedVersion)
			if err != nil {
				return nil, err
			}
			return map[string]any{"version": version}, nil
		})

	// ---- video_animate_element (video:write) ----
	type animateIn struct {
		ProjectID       string         `json:"project_id" jsonschema:"project id"`
		ElementID       string         `json:"element_id" jsonschema:"element id to animate"`
		Type            string         `json:"type" jsonschema:"animation type: move|scaleIn|rotate|fadeIn|fadeOut"`
		From            map[string]any `json:"from,omitempty" jsonschema:"move start {x,y}"`
		To              map[string]any `json:"to,omitempty" jsonschema:"move end {x,y}"`
		FromValue       *float64       `json:"fromValue,omitempty" jsonschema:"scaleIn/rotate start value"`
		ToValue         *float64       `json:"toValue,omitempty" jsonschema:"scaleIn/rotate end value"`
		StartAnchor     string         `json:"start_anchor,omitempty" jsonschema:"anchor word text the animation starts at"`
		Occurrence      int            `json:"occurrence,omitempty" jsonschema:"anchor occurrence (default 0)"`
		DurationFrames  int            `json:"duration_frames" jsonschema:"animation length in frames (>0)"`
		Easing          string         `json:"easing,omitempty" jsonschema:"linear|power1.out|power2.out|power3.out|back.out|expo.out"`
		ExpectedVersion *int           `json:"expected_version,omitempty" jsonschema:"optimistic-lock version"`
		WorkspaceID     string         `json:"workspace_id,omitempty" jsonschema:"target workspace — required only for multi-workspace PATs; single-workspace PATs resolve automatically"`
	}
	mcpAdd(s, "video_animate_element",
		"Append a start-anchored animation to an element (move/scaleIn/rotate/fadeIn/fadeOut). "+
			"After editing, call video_snapshot_frame to see the frame and judge visually; video_inspect shows the IR + anchor resolutions.",
		ScopeWrite, func(ctx context.Context, _ *mcp.CallToolRequest, in animateIn) (any, error) {
			p, err := resolveWorkspacePrincipal(webx.PrincipalFrom(ctx), in.WorkspaceID)
			if err != nil {
				return nil, err
			}
			an := videoapp.ElementAnimation{
				Type: in.Type, DurationFrames: in.DurationFrames, Easing: in.Easing,
				FromValue: in.FromValue, ToValue: in.ToValue,
			}
			if in.From != nil {
				an.From = decodePoint(in.From)
			}
			if in.To != nil {
				an.To = decodePoint(in.To)
			}
			if in.StartAnchor != "" {
				an.StartAnchor = &videoapp.Anchor{Text: in.StartAnchor, Occurrence: in.Occurrence}
			}
			version, rf, err := deps.Svc.AnimateElement(ctx, p, in.ProjectID, in.ElementID, an, in.ExpectedVersion)
			if err != nil {
				return nil, err
			}
			return map[string]any{"version": version, "resolvedFrom": rf}, nil
		})

	// ---- video_add_effect_at_word (video:write) ----
	type addEffectWorkspaceIn struct {
		addEffectIn
		WorkspaceID string `json:"workspace_id,omitempty" jsonschema:"target workspace — required only for multi-workspace PATs; single-workspace PATs resolve automatically"`
	}
	mcpAdd(s, "video_add_effect_at_word",
		"Add a motion effect anchored at a word. Resolved word index + reason come back in resolvedFrom. Pass target_element_id to bind the effect to an existing element (counter renders at that element's position). "+
			"After editing, call video_snapshot_frame to see the frame and judge visually; video_inspect shows the IR + anchor resolutions.",
		ScopeWrite, func(ctx context.Context, _ *mcp.CallToolRequest, in addEffectWorkspaceIn) (any, error) {
			p, err := resolveWorkspacePrincipal(webx.PrincipalFrom(ctx), in.WorkspaceID)
			if err != nil {
				return nil, err
			}
			version, rf, err := deps.Svc.AddEffectAtWord(ctx, p,
				in.ProjectID, videoapp.Anchor{Text: in.AnchorText, Occurrence: in.Occurrence},
				in.Type, in.Params, in.TargetElementID, in.ExpectedVersion)
			if err != nil {
				return nil, err
			}
			return map[string]any{"version": version, "resolvedFrom": rf}, nil
		})

	// ---- video_upload_asset (video:write) ----
	type uploadIn struct {
		ProjectID   string `json:"project_id" jsonschema:"project id the asset belongs to"`
		Filename    string `json:"filename" jsonschema:"original filename (extension informs content-type detection when content_type is omitted)"`
		ContentType string `json:"content_type,omitempty" jsonschema:"image/png|image/jpeg|image/gif|image/webp|audio/mpeg|audio/mp4|audio/wav"`
		DataBase64  string `json:"data_base64" jsonschema:"file bytes, base64 (≤ ~700KB; large assets go through the REST multipart endpoint)"`
		WorkspaceID string `json:"workspace_id,omitempty" jsonschema:"target workspace — required only for multi-workspace PATs; single-workspace PATs resolve automatically"`
	}
	mcpAdd(s, "video_upload_asset",
		"Upload one small asset (image/audio ≤700KB base64). Stored content-addressed under video/<workspace>/assets/<project>/. Returns the storage key for element src / audio keys (attach audio with video_set_audio).",
		ScopeWrite, func(ctx context.Context, _ *mcp.CallToolRequest, in uploadIn) (any, error) {
			p, err := resolveWorkspacePrincipal(webx.PrincipalFrom(ctx), in.WorkspaceID)
			if err != nil {
				return nil, err
			}
			data, err := base64Decode(in.DataBase64)
			if err != nil {
				return nil, videoapp.ErrAssetUnsupported
			}
			ct := in.ContentType
			if ct == "" {
				ct = contentTypeFromName(in.Filename)
			}
			key, err := deps.Svc.UploadAsset(ctx, p, in.ProjectID, in.Filename, ct, data)
			if err != nil {
				return nil, err
			}
			return map[string]any{"key": key, "url": "/api/video/files/" + key, "size": len(data)}, nil
		})

	// ---- video_set_audio (video:write) ----
	// G-01（批G 提案）：音频挂载断链的补口——上传工具承诺了 audio keys 却
	// 无消费路径。null 语义 = 清除对应轨（Audio 指针字段天然支持）。
	// 输入类型 setAudioIn 在包级（tools_test 钉 wire 形状）。
	mcpAdd(s, "video_set_audio",
		"Attach voice/BGM audio tracks to the project (the keys video_upload_asset returned). A key must reference an uploaded asset — unregistered keys are rejected at write time (E_VIDEO_IR_INVALID), the same gate image src uses; the render would otherwise fail one full render cycle later. "+
			"voice_duration_sec extends the render timeline when the voice runs past meta duration. Omitting voice_key/bgm_key clears that track; volume fields are 0-1. "+
			"After setting audio, video_inspect shows the audio block and video_render mixes it into the MP4.",
		ScopeWrite, func(ctx context.Context, _ *mcp.CallToolRequest, in setAudioIn) (any, error) {
			p, err := resolveWorkspacePrincipal(webx.PrincipalFrom(ctx), in.WorkspaceID)
			if err != nil {
				return nil, err
			}
			audio := &videoapp.Audio{}
			if in.VoiceKey != nil {
				audio.Voice = &videoapp.AudioTrack{Key: strings.TrimSpace(*in.VoiceKey), DurationSec: in.VoiceDuration, Volume: in.VoiceVolume}
			}
			if in.BGMKey != nil {
				audio.BGM = &videoapp.AudioTrack{Key: strings.TrimSpace(*in.BGMKey), Volume: in.BGMVolume}
			}
			if audio.Voice == nil && audio.BGM == nil {
				return nil, errors.New("at least one of voice_key or bgm_key is required (pass the track you want to set; omitting both clears nothing)")
			}
			// 挂载前查登记行（fail-closed）：视频文件 handler 的第三道门
			// （CanAccessKey——video_asset 行或 video_render 行）在写时预演，
			// 把渲染期失败提前到写时（批G 提案 G-01a）。未接线（nil pool）
			// 时 CanAccessKey 返回 false——语义正好是 fail-closed。
			// 注意：map 字面量会急切求值两个字段——单轨挂载时另一轨是 nil
			// 指针，audio.BGM.Key 直接 panic 打死整个服务进程（E2E 真调
			// 实拍：只传 voice_key → nil deref panic）。逐轨判空。
			keysToCheck := make([]string, 0, 2)
			if audio.Voice != nil && audio.Voice.Key != "" {
				keysToCheck = append(keysToCheck, audio.Voice.Key)
			}
			if audio.BGM != nil && audio.BGM.Key != "" {
				keysToCheck = append(keysToCheck, audio.BGM.Key)
			}
			for _, key := range keysToCheck {
				ok, aerr := deps.Svc.CanAccessKey(ctx, p, key)
				if aerr != nil {
					return nil, aerr
				}
				if !ok {
					return nil, webx.NewError(400, "E_VIDEO_IR_INVALID",
						"audio key "+key+" not registered (upload via video_upload_asset / POST /api/video/assets first)")
				}
			}
			version, err := deps.Svc.SetAudio(ctx, p, in.ProjectID, audio, in.ExpectedVersion)
			if err != nil {
				return nil, err
			}
			return map[string]any{"version": version, "audio": audio}, nil
		})

	// ---- video_render (video:render) ----
	type renderParams struct {
		FPS           int     `json:"fps,omitempty" jsonschema:"output fps (default meta.fps)"`
		Width         int     `json:"width,omitempty" jsonschema:"output width (default meta.width)"`
		Height        int     `json:"height,omitempty" jsonschema:"output height (default meta.height)"`
		BurnSubtitles bool    `json:"burn_subtitles" jsonschema:"legacy flag: true = subtitle_mode burn"`
		SubtitleMode  string  `json:"subtitle_mode,omitempty" jsonschema:"burn|soft|none (default from burn_subtitles)"`
		BGMVolume     float64 `json:"bgm_volume,omitempty" jsonschema:"bgm volume override 0-1"`
	}
	type renderIn struct {
		ProjectID       string       `json:"project_id" jsonschema:"project id"`
		Params          renderParams `json:"params,omitempty" jsonschema:"render overrides"`
		ExpectedVersion *int         `json:"expected_version,omitempty" jsonschema:"optimistic-lock version"`
		RequestID       string       `json:"request_id,omitempty" jsonschema:"idempotency key: retries with the same request_id return the first submission instead of charging quota twice"`
		WorkspaceID     string       `json:"workspace_id,omitempty" jsonschema:"target workspace — required only for multi-workspace PATs; single-workspace PATs resolve automatically"`
	}
	mcpAdd(s, "video_render",
		"Submit a render of the project's IR snapshot. Fails with E_NOT_CONFIGURED when the render capability is offline (no quota spent), E_QUOTA_EXCEEDED when the monthly quota is out.",
		ScopeRender, func(ctx context.Context, _ *mcp.CallToolRequest, in renderIn) (any, error) {
			p, err := resolveWorkspacePrincipal(webx.PrincipalFrom(ctx), in.WorkspaceID)
			if err != nil {
				return nil, err
			}
			pp := in.Params
			params := videoapp.RenderParams{
				FPS: pp.FPS, Width: pp.Width, Height: pp.Height,
				BurnSubtitles: pp.BurnSubtitles, SubtitleMode: pp.SubtitleMode, BGMVolume: pp.BGMVolume,
			}
			reqID := strings.TrimSpace(in.RequestID)
			if len(reqID) > 128 {
				reqID = reqID[:128]
			}
			r, err := deps.Svc.SubmitRender(ctx, p, in.ProjectID, params, in.ExpectedVersion, reqID)
			if err != nil {
				return nil, err
			}
			return map[string]any{"render_id": r.ID, "status": r.Status}, nil
		})

	// ==================== Eyes: ground truth to judge by ====================

	// ---- video_inspect (video:read) ----
	type inspectIn struct {
		ProjectID   string `json:"project_id" jsonschema:"project id (from video_list_projects)"`
		WorkspaceID string `json:"workspace_id,omitempty" jsonschema:"target workspace — required only for multi-workspace PATs; single-workspace PATs resolve automatically"`
	}
	mcpAdd(s, "video_inspect",
		"Read the project's current state — the agent's screen reader. Returns the full IR snapshot (elements, effects, animations, words) plus "+
			"resolutions[]: for every effect/animation anchor the resolved word index and reason (exact|same_text|nearest|missing). "+
			"A missing anchor means that effect/animation will NOT appear in the render — fix the anchor first (video_set_script / video_set_words / "+
			"video_add_effect_at_word), then render. Pair with video_snapshot_frame for the visual pixel check.",
		ScopeRead, func(ctx context.Context, _ *mcp.CallToolRequest, in inspectIn) (any, error) {
			// /mcp 不挂 wsMW：PAT principal 的 WorkspaceID 可能为空，先解析
			// （单工作区 scope 解析 / 显式 workspace_id 经 AllowsWorkspace
			// 校验）——空 workspace 直查会变成 uuid 空串 SQL 错。
			p, err := resolveWorkspacePrincipal(webx.PrincipalFrom(ctx), in.WorkspaceID)
			if err != nil {
				return nil, err
			}
			pr, err := deps.Svc.Get(ctx, p, in.ProjectID)
			if err != nil {
				return nil, err
			}
			return map[string]any{
				"ir": pr.IR, "version": pr.Version,
				"resolutions": videoapp.ResolveAll(pr.IR, videoapp.PrevWordIndexes(pr.IR)),
			}, nil
		})

	// ---- video_snapshot_frame (video:write) ----
	// 截图走浏览器（headless Chrome 起页 + seek + 截屏），成本远高于一次 DB
	// 读——权限因此落 video:write 而非 video:read。agent 的"眼睛"：改完 IR
	// 调本工具按帧号拿一张 PNG 自行评判（标题大小/配色/布局/元素重叠）。
	mcpAdd(s, "video_snapshot_frame",
		"Capture ONE rendered frame of the current IR as PNG (base64) — the agent's eyes: call it after every edit to visually judge the result "+
			"(title size, colors, layout, element overlap). For 2-6 frames at once use video_preview_frames (one projection render for the whole batch, saves per-call round trips). "+
			"Frame numbers are 0-based; an out-of-range frame is clamped into [0, duration_frames-1] and "+
			"the response says so. Width/height default to the IR canvas and must be passed together (odd values rejected — yuv420p contract). "+
			"Identical (version, frame, size) captures within 5 minutes return the cached PNG (cached=true, zero cost). "+
			"Offline capture capability = structured E_NOT_CONFIGURED error: fall back to video_inspect (IR + anchor resolutions) instead.",
		ScopeWrite, func(ctx context.Context, _ *mcp.CallToolRequest, in snapshotIn) (any, error) {
			// 前置校验 + 能力探针（DB 无关，单测直接打这个函数）。
			p, snap, err := prepareSnapshot(deps, webx.PrincipalFrom(ctx), in)
			if err != nil {
				return nil, err
			}
			// 项目取数：workspace 谓词先行（Get 的语义），跨工作区 id 与
			// 不存在 id 同样 404——不存在性不泄漏。
			pr, err := deps.Svc.Get(ctx, p, in.ProjectID)
			if err != nil {
				return nil, err
			}
			total := videoapp.DurationFrames(pr.IR, pr.IR.Meta.FPS)
			frame := in.Frame
			clamped := false
			if frame > total-1 {
				frame, clamped = total-1, true
			}
			w, h := in.Width, in.Height
			if w == 0 {
				w, h = pr.IR.Meta.Width, pr.IR.Meta.Height
			}
			html, err := projectHTML(ctx, deps, pr.IR)
			if err != nil {
				return nil, err
			}
			res, err := snap.Snapshot(ctx, videorender.SnapshotDoc{
				HTML:         html,
				TimelineID:   "main",
				CacheVersion: strconv.Itoa(pr.Version),
			}, videorender.SnapshotSpec{
				Width: w, Height: h, FPS: pr.IR.Meta.FPS,
				Frame:          frame,
				DurationFrames: total,
			})
			if err != nil {
				// 桥接未接线（stub 构建 / 运行时惰性）：结构化降级——agent 能
				// 读懂去退化用 video_inspect。
				if errors.Is(err, videorender.ErrSnapshotNotConfigured) {
					return nil, videoapp.ErrNotConfigured
				}
				return nil, err
			}
			out := map[string]any{
				"png_base64":      base64.StdEncoding.EncodeToString(res.PNG),
				"frame":           res.Frame,
				"width":           res.Width,
				"height":          res.Height,
				"duration_frames": res.DurationFrames,
				"cached":          res.Cached,
			}
			if clamped {
				out["frame_clamped"] = true
				out["hint"] = "frame was out of range and clamped to the last frame (" + strconv.Itoa(total-1) + ") of " + strconv.Itoa(total)
			}
			return out, nil
		})

	// ---- video_preview_frames (video:write) ----
	// G-02 多帧批量眼：一次调用截 2-6 帧。桥接层 SnapshotMulti 在同一文档
	// 一次投影渲染收集全部目标帧（投影/浏览器起页只付一次），每帧独立缓存
	// 键（命中跳过重截——同一版本反复预览趋近零成本）。权限与单帧一致
	// （video:write——同样要起浏览器）。
	mcpAdd(s, "video_preview_frames",
		"Capture 2-6 rendered frames of the current IR in ONE call (PNG base64 each) — the batch eye for visual self-review: compare card transitions, "+
			"check a whole animation across its span, review layout at several moments with a single projection render instead of repeated single-frame calls "+
			"(video_snapshot_frame stays for the one-frame case). Frames are 0-based, deduped and sorted; each is clamped into [0, duration_frames-1] "+
			"(clamped frames are flagged in the response). Width/height default to the IR canvas and must be passed together (odd values rejected). "+
			"Per-frame (version, frame, size) caching applies: hit frames come back with cached=true at zero cost. "+
			"Offline capture capability = structured E_NOT_CONFIGURED error: fall back to video_inspect instead. "+
			"To verify the ENCODED deliverable (after render) use video_render_frames — this tool sees the pre-encode IR projection.",
		ScopeWrite, func(ctx context.Context, _ *mcp.CallToolRequest, in previewFramesIn) (any, error) {
			p, snap, err := prepareSnapshot(deps, webx.PrincipalFrom(ctx), snapshotIn{
				ProjectID:   in.ProjectID,
				Frame:       0,
				Width:       in.Width,
				Height:      in.Height,
				WorkspaceID: in.WorkspaceID,
			})
			if err != nil {
				return nil, err
			}
			if len(in.Frames) < 2 || len(in.Frames) > 6 {
				return nil, errors.New("frames must contain 2-6 frame numbers")
			}
			multi := videorender.MultiFor(snap)
			if multi == nil {
				return nil, videoapp.ErrNotConfigured
			}
			pr, err := deps.Svc.Get(ctx, p, in.ProjectID)
			if err != nil {
				return nil, err
			}
			total := videoapp.DurationFrames(pr.IR, pr.IR.Meta.FPS)
			w, h := in.Width, in.Height
			if w == 0 {
				w, h = pr.IR.Meta.Width, pr.IR.Meta.Height
			}
			// 去重升序 + 越界钳制（钳到最后一帧并在响应里标记——单帧工具
			// 同款语义，批量路径保持一致）。
			seen := map[int]bool{}
			frames := make([]int, 0, len(in.Frames))
			clampedSet := map[int]bool{}
			for _, f := range in.Frames {
				if f < 0 {
					return nil, errors.New("frames must be >= 0 (0-based frame numbers)")
				}
				if f > total-1 {
					clampedSet[total-1] = true
					f = total - 1
				}
				if !seen[f] {
					seen[f] = true
					frames = append(frames, f)
				}
			}
			sortInts(frames)
			html, err := projectHTML(ctx, deps, pr.IR)
			if err != nil {
				return nil, err
			}
			results, err := multi.SnapshotMulti(ctx, videorender.SnapshotDoc{
				HTML:         html,
				TimelineID:   "main",
				CacheVersion: strconv.Itoa(pr.Version),
			}, videorender.SnapshotSpec{
				Width: w, Height: h, FPS: pr.IR.Meta.FPS,
				DurationFrames: total,
			}, frames)
			if err != nil {
				if errors.Is(err, videorender.ErrSnapshotNotConfigured) {
					return nil, videoapp.ErrNotConfigured
				}
				return nil, err
			}
			outFrames := make([]map[string]any, 0, len(results))
			for _, res := range results {
				entry := map[string]any{
					"frame":     res.Frame,
					"png_base64": base64.StdEncoding.EncodeToString(res.PNG),
					"width":     res.Width,
					"height":    res.Height,
					"cached":    res.Cached,
				}
				if clampedSet[res.Frame] {
					entry["frame_clamped"] = true
				}
				outFrames = append(outFrames, entry)
			}
			return map[string]any{
				"frames":          outFrames,
				"duration_frames": total,
			}, nil
		})

	// ============ Plumbing & misc: discovery, words, shortcut ============

	// ---- video_create_project (video:write) ----
	type createIn struct {
		Title       string `json:"title" jsonschema:"project title (1-200 chars after trim)"`
		WorkspaceID string `json:"workspace_id,omitempty" jsonschema:"target workspace — required only for multi-workspace PATs; single-workspace PATs resolve automatically"`
	}
	mcpAdd(s, "video_create_project",
		"Create a video studio project. Returns the id and initial version (1).",
		ScopeWrite, func(ctx context.Context, _ *mcp.CallToolRequest, in createIn) (any, error) {
			p, err := resolveWorkspacePrincipal(webx.PrincipalFrom(ctx), in.WorkspaceID)
			if err != nil {
				return nil, err
			}
			pr, err := deps.Svc.Create(ctx, p, in.Title)
			if err != nil {
				return nil, err
			}
			return map[string]any{"id": pr.ID, "version": pr.Version}, nil
		})

	// ---- video_set_script (video:write) ----
	type setScriptIn struct {
		ProjectID       string `json:"project_id" jsonschema:"project id"`
		Script          string `json:"script" jsonschema:"new script text (≤5000 chars); words re-derived (TTS → aligner → estimated)"`
		ExpectedVersion *int   `json:"expected_version,omitempty" jsonschema:"optimistic-lock version; omit to skip the check"`
		WorkspaceID     string `json:"workspace_id,omitempty" jsonschema:"target workspace — required only for multi-workspace PATs; single-workspace PATs resolve automatically"`
	}
	mcpAdd(s, "video_set_script",
		"Replace the narration script. Words are re-derived and every effect/animation anchor is re-resolved; the response lists which anchors drifted. "+
			"Word derivation degrades and never fails: when TTS is unwired or its vendor call errors, the aligner is tried next; when neither succeeds "+
			"the words fall back to the char-proportional estimate (words_source=\"estimated\"). There is NO E_TTS_UNAVAILABLE / E_ALIGNER_UNAVAILABLE error "+
			"code — a missing or failing voice capability is not an error surface; check words_source in the response instead (§8.5a ruling).",
		ScopeWrite, func(ctx context.Context, _ *mcp.CallToolRequest, in setScriptIn) (any, error) {
			p, err := resolveWorkspacePrincipal(webx.PrincipalFrom(ctx), in.WorkspaceID)
			if err != nil {
				return nil, err
			}
			version, resolutions, source, err := deps.Svc.SetScript(ctx, p, in.ProjectID, in.Script, in.ExpectedVersion)
			if err != nil {
				return nil, err
			}
			return map[string]any{"version": version, "words_source": source, "resolutions": resolutions}, nil
		})

	// ---- video_set_words (video:write) ----
	type setWordsIn struct {
		ProjectID       string          `json:"project_id" jsonschema:"project id"`
		Words           []videoapp.Word `json:"words" jsonschema:"word list [{text,start,end,source?}] — replaces the table wholesale"`
		ExpectedVersion *int            `json:"expected_version,omitempty" jsonschema:"optimistic-lock version"`
		WorkspaceID     string          `json:"workspace_id,omitempty" jsonschema:"target workspace — required only for multi-workspace PATs; single-workspace PATs resolve automatically"`
	}
	mcpAdd(s, "video_set_words",
		"Human/debug channel for manual word-timing refinement; orchestration agents should rely on set_script's automatic derivation "+
			"(TTS → aligner → estimated) instead of hand-authoring timestamps. Replaces the word timing table wholesale; anchors are re-resolved against the new table.",
		ScopeWrite, func(ctx context.Context, _ *mcp.CallToolRequest, in setWordsIn) (any, error) {
			p, err := resolveWorkspacePrincipal(webx.PrincipalFrom(ctx), in.WorkspaceID)
			if err != nil {
				return nil, err
			}
			version, resolutions, err := deps.Svc.SetWords(ctx, p, in.ProjectID, in.Words, in.ExpectedVersion)
			if err != nil {
				return nil, err
			}
			return map[string]any{"version": version, "resolutions": resolutions}, nil
		})

	// ---- video_list_templates (video:read) ----
	mcpAdd(s, "video_list_templates",
		"List the style templates and themes for one-call script composition. Prefer composing over hand-placing elements: "+
			"video_compose turns a narration script into a fully laid-out IR using these templates (cover/listicle/feature/chart/quote/endcard) "+
			"and themes (each theme's bg/fg/accent already pass the WCAG contrast gate).",
		ScopeRead, func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (any, error) {
			return deps.Svc.TemplateCatalog(ctx), nil
		})

	// ---- video_list_projects (video:read) ----
	type listIn struct {
		WorkspaceID string `json:"workspace_id,omitempty" jsonschema:"target workspace — required only for multi-workspace PATs; single-workspace PATs resolve automatically"`
	}
	mcpAdd(s, "video_list_projects",
		"List the workspace's video studio projects (id, title, version, updated_at).",
		ScopeRead, func(ctx context.Context, _ *mcp.CallToolRequest, in listIn) (any, error) {
			p, err := resolveWorkspacePrincipal(webx.PrincipalFrom(ctx), in.WorkspaceID)
			if err != nil {
				return nil, err
			}
			items, err := deps.Svc.List(ctx, p)
			if err != nil {
				return nil, err
			}
			return map[string]any{"projects": items}, nil
		})

	// ---- video_get_render (video:read) ----
	type getRenderIn struct {
		RenderID    string `json:"render_id" jsonschema:"render id (from video_render)"`
		WorkspaceID string `json:"workspace_id,omitempty" jsonschema:"target workspace — required only for multi-workspace PATs; single-workspace PATs resolve automatically"`
	}
	mcpAdd(s, "video_get_render",
		"Fetch one render's status/progress/output (queued|running|succeeded|failed|interrupted + frames counters + output_url when done).",
		ScopeRead, func(ctx context.Context, _ *mcp.CallToolRequest, in getRenderIn) (any, error) {
			p, err := resolveWorkspacePrincipal(webx.PrincipalFrom(ctx), in.WorkspaceID)
			if err != nil {
				return nil, err
			}
			r, err := deps.Svc.GetRender(ctx, p, in.RenderID)
			if err != nil {
				return nil, err
			}
			out := map[string]any{
				"status": r.Status, "frames_done": r.FramesDone, "frames_total": r.FramesTotal,
				"error": r.Error,
			}
			if r.OutputKey != "" {
				out["output_url"] = "/api/video/files/" + r.OutputKey
			}
			return out, nil
		})

	// ---- video_validate (video:read) ----
	// G-03 只读预检（收窄版，批G 驳回裁定：不重建 Mutate 校验管线——写时门
	// 已保证存量 IR 合法）。增量只有五块：能力探针、帧数预览、锚点汇总、
	// 音频摘要、末词截断告警（真校验盲区：无配音时 words 超时长会被
	// DurationFrames 静默截掉）。全只读，不建 render 行不扣配额。
	mcpAdd(s, "video_validate",
		"Read-only pre-render check (dry-run): what would happen if you submitted video_render right now. Returns the render capability status, the frame "+
			"count the render would produce, an anchor-resolution summary (exact/nearest/missing counts + the missing list — missing anchors will NOT appear), "+
			"an audio summary (voice/bgm keys and words_source), and a last-word-truncation warning (words ending past the timeline get silently cut). "+
			"Creates no render row, spends no quota, bumps no version. The IR itself needs no re-validation — every stored IR already passed the write-time gates.",
		ScopeRead, func(ctx context.Context, _ *mcp.CallToolRequest, in inspectIn) (any, error) {
			p, err := resolveWorkspacePrincipal(webx.PrincipalFrom(ctx), in.WorkspaceID)
			if err != nil {
				return nil, err
			}
			pr, err := deps.Svc.Get(ctx, p, in.ProjectID)
			if err != nil {
				return nil, err
			}
			capOnline := deps.Cap != nil && deps.Cap.CapAvailable()
			total := videoapp.DurationFrames(pr.IR, pr.IR.Meta.FPS)
			resolutions := videoapp.ResolveAll(pr.IR, videoapp.PrevWordIndexes(pr.IR))
			counts := map[string]int{"exact": 0, "same_text": 0, "nearest": 0, "missing": 0}
			var missingList []map[string]any
			for _, res := range resolutions {
				if res.Reason == videoapp.AnchorSameText {
					counts["same_text"]++
				} else {
					counts[res.Reason]++
				}
				if res.Reason == videoapp.AnchorMissing {
					missingList = append(missingList, map[string]any{
						"owner_id": res.OwnerID, "owner": res.Owner, "anchor_text": res.AnchorText,
					})
				}
			}
			// 音频摘要 + 末词截断告警：无配音（或 voice.durationSec 未填）时
			// 真时长 = max(meta.durationSec, voice)，末词 end 超出会被渲染期
			// 静默截掉——写时 Validate 只查 voice 侧（ir.go voice-cover 检查
			// 需要 voice.DurationSec>0），这条 preflight 是盲区的唯一可见面。
			warnings := []string{}
			audio := map[string]any{"voice": nil, "bgm": nil, "words_source": wordsSourceOf(pr.IR)}
			timeline := pr.IR.Meta.DurationSec
			if pr.IR.Audio != nil {
				if v := pr.IR.Audio.Voice; v != nil {
					audio["voice"] = map[string]any{"key": v.Key, "duration_sec": v.DurationSec, "volume": v.Volume}
					if v.DurationSec > timeline {
						timeline = v.DurationSec
					}
				}
				if b := pr.IR.Audio.BGM; b != nil {
					audio["bgm"] = map[string]any{"key": b.Key, "volume": b.Volume}
				}
			}
			if last := lastWord(pr.IR); last != nil && last.End > timeline+1e-6 {
				warnings = append(warnings, fmt.Sprintf(
					"last word ends at %.2fs but the timeline is %.2fs — it will be silently truncated in the render. Shorten the script, or attach a voice track whose duration covers it (video_set_audio with voice_duration_sec).",
					last.End, timeline))
			}
			if len(pr.IR.Words) == 0 {
				warnings = append(warnings, "no word table: subtitles and word-anchored effects/animations have nothing to anchor to")
			}
			out := map[string]any{
				"renderable":     capOnline,
				"capability_online": capOnline,
				"frames_total":   total,
				"resolutions":    map[string]any{"counts": counts, "missing": missingList},
				"audio":          audio,
				"warnings":       warnings,
			}
			if !capOnline {
				out["hint"] = "render capability offline: video_render will fail with E_NOT_CONFIGURED (no quota spent)"
			}
			return out, nil
		})

	// ---- video_list_elements (video:read) ----
	// G-04 轻量元素清单：精修循环高频调用——只回 id/几何/文本截断，不回全
	// IR（大项目省 token；全量走 video_inspect）。
	mcpAdd(s, "video_list_elements",
		"List the project's canvas elements in a compact form (id, type, geometry x/y/w/h, z, start/end frame window, text truncated to 40 chars) — "+
			"the cheap element discovery for surgical refinement loops (feed ids into video_move_element / video_animate_element / video_upsert_element). "+
			"Does NOT return the full IR: animations, effects, anchors, words and full text come from video_inspect.",
		ScopeRead, func(ctx context.Context, _ *mcp.CallToolRequest, in inspectIn) (any, error) {
			p, err := resolveWorkspacePrincipal(webx.PrincipalFrom(ctx), in.WorkspaceID)
			if err != nil {
				return nil, err
			}
			pr, err := deps.Svc.Get(ctx, p, in.ProjectID)
			if err != nil {
				return nil, err
			}
			type listedElement struct {
				ID         string  `json:"id"`
				Type       string  `json:"type"`
				X          float64 `json:"x"`
				Y          float64 `json:"y"`
				W          float64 `json:"w"`
				H          float64 `json:"h"`
				Z          int     `json:"z"`
				StartFrame *int    `json:"start_frame,omitempty"`
				EndFrame   *int    `json:"end_frame,omitempty"`
				Text       string  `json:"text,omitempty"`
			}
			elements := make([]listedElement, 0, len(pr.IR.Elements))
			for _, el := range pr.IR.Elements {
				text := ""
				if el.Type == videoapp.ElementText {
					text = el.Text
					if r := []rune(text); len(r) > 40 {
						text = string(r[:40]) + "…"
					}
				}
				elements = append(elements, listedElement{
					ID: el.ID, Type: el.Type,
					X: el.X, Y: el.Y, W: el.W, H: el.H, Z: el.Z,
					StartFrame: el.StartFrame, EndFrame: el.EndFrame,
					Text: text,
				})
			}
			return map[string]any{"elements": elements, "count": len(elements)}, nil
		})

	// ---- video_render_frames (video:read) ----
	// G-07 成品抽帧眼：从已完成的 output.mp4 用 ffmpeg 逐帧 seek 抽 PNG
	// （pipe 到内存，不落盘临时文件）。验证的是编码后真实画面（字幕烧录/
	// 软字幕/混流/压缩失真）——与 IR 截图（video_preview_frames /
	// video_snapshot_frame）互补。成品已存在，纯读操作 → video:read。
	mcpAdd(s, "video_render_frames",
		"Extract 2-6 frames (PNG base64) from a FINISHED render's encoded MP4 — the deliverable eye: this sees the real encoded picture "+
			"(burned/soft subtitles, audio muxing, compression), which the pre-encode IR snapshots (video_snapshot_frame / video_preview_frames) cannot show. "+
			"time_sec values are seconds into the output video, deduped and sorted; a time past the end of the video errors. "+
			"Requires status=succeeded and the output file present. Pure read (video:read): ffmpeg runs as a transient process piping to memory, nothing is written.",
		ScopeRead, func(ctx context.Context, _ *mcp.CallToolRequest, in renderFramesIn) (any, error) {
			if strings.TrimSpace(in.RenderID) == "" {
				return nil, errors.New("render_id is required")
			}
			if len(in.Frames) < 2 || len(in.Frames) > 6 {
				return nil, errors.New("frames must contain 2-6 time_sec values")
			}
			extract := videorender.FrameExtractorFor()
			if deps.FrameExtract != nil {
				extract = deps.FrameExtract()
			}
			if extract == nil {
				return nil, videoapp.ErrNotConfigured
			}
			p, err := resolveWorkspacePrincipal(webx.PrincipalFrom(ctx), in.WorkspaceID)
			if err != nil {
				return nil, err
			}
			// workspace 谓词先行（GetRender 的语义）：跨工作区 render id 与
			// 不存在的 id 同样 404。
			r, err := deps.Svc.GetRender(ctx, p, in.RenderID)
			if err != nil {
				return nil, err
			}
			if r.Status != videoapp.RenderSucceeded {
				return nil, errors.New("render is not finished (status " + r.Status + "): poll video_get_render until succeeded before extracting frames")
			}
			if r.OutputKey == "" {
				return nil, errors.New("render carries no output file")
			}
			// 去重升序 + 非负校验（逐帧独立 seek，顺序不影响结果）。
			seen := map[float64]bool{}
			times := make([]float64, 0, len(in.Frames))
			for _, t := range in.Frames {
				if t < 0 {
					return nil, errors.New("frames must be >= 0 (seconds into the output)")
				}
				if !seen[t] {
					seen[t] = true
					times = append(times, t)
				}
			}
			sortFloats(times)
			// capx 的 ffmpeg 走 `-i <path>`（需要真实文件路径），而 storagex
			// 接口只暴露流（本地 FS / S3 皆然）——storage key 不能直接当路径
			// 传（首调实拍 exit -2 的根因：相对路径在进程 CWD 下不存在）。
			// 把产物物化到临时文件，逐帧抽完即删；Store 未接线时明确报错。
			if deps.Store == nil {
				return nil, errors.New("render frame extraction unavailable: storage not wired for materializing the output file")
			}
			src, obj, err := deps.Store.Open(ctx, r.OutputKey)
			if err != nil {
				return nil, fmt.Errorf("open render output: %w", err)
			}
			_ = obj
			tmp, err := os.CreateTemp("", "video-frames-*.mp4")
			if err != nil {
				src.Close()
				return nil, fmt.Errorf("materialize render output: %w", err)
			}
			tmpName := tmp.Name()
			defer os.Remove(tmpName)
			if _, err := io.Copy(tmp, src); err != nil {
				tmp.Close()
				src.Close()
				return nil, fmt.Errorf("materialize render output: %w", err)
			}
			if err := tmp.Close(); err != nil {
				src.Close()
				return nil, fmt.Errorf("materialize render output: %w", err)
			}
			src.Close()
			outFrames := make([]map[string]any, 0, len(times))
			for _, t := range times {
				png, err := extract.ExtractFrame(ctx, tmpName, t)
				if err != nil {
					return nil, err
				}
				outFrames = append(outFrames, map[string]any{
					"time_sec":   t,
					"png_base64": base64.StdEncoding.EncodeToString(png),
				})
			}
			return map[string]any{
				"frames":        outFrames,
				"render_id":     r.ID,
				"output_key":    r.OutputKey,
				"frames_total":  r.FramesTotal,
				"frames_done":   r.FramesDone,
				"params":        r.Params,
			}, nil
		})

	// ---- video_generate_video (video:write + render on submit) ----
	type generateIn struct {
		Title       string `json:"title,omitempty" jsonschema:"project title (default: first line of script, trimmed)"`
		Script      string `json:"script" jsonschema:"narration script text — the ONLY required input (Chinese aware; blank lines split cards)"`
		Template    string `json:"template,omitempty" jsonschema:"template key (cover|listicle|feature|chart|quote|endcard); default listicle"`
		Theme       string `json:"theme,omitempty" jsonschema:"theme key (ink|midnight|vigoro|pastel); default ink"`
		WorkspaceID string `json:"workspace_id,omitempty" jsonschema:"target workspace — required only for multi-workspace PATs; single-workspace PATs resolve automatically"`
		FPS         int    `json:"fps,omitempty" jsonschema:"output fps (default IR meta 30)"`
		Width       int    `json:"width,omitempty" jsonschema:"output width (default 1080)"`
		Height      int    `json:"height,omitempty" jsonschema:"output height (default 1920)"`
		Wait        bool   `json:"wait" jsonschema:"true = poll until the render reaches a terminal state before returning (recommended); false = return render_id immediately"`
	}
	mcpAdd(s, "video_generate_video",
		"Convenience shortcut — NOT the entry point for orchestrating agents. Orchestrating agents compose stepwise "+
			"(video_create_project → video_set_script → video_list_templates → video_compose → video_inspect → video_snapshot_frame → video_render) "+
			"to make a creative decision at each step and check the frame before render quota is spent. "+
			"This tool is for fire-and-forget scripts where the copy is already final: pass the narration script and it creates the project, composes it into "+
			"a fully laid-out IR (cards split from the script, styled with template × theme, timed against the word table, keyword highlights anchored at real words), "+
			"submits the render, and (wait=true, default recommended) polls until the MP4 is done, returning output_url. "+
			"Fails cleanly when the render capability is offline (E_NOT_CONFIGURED, no quota spent) or the monthly quota is out (E_QUOTA_EXCEEDED).",
		ScopeWrite, func(ctx context.Context, _ *mcp.CallToolRequest, in generateIn) (any, error) {
			p := webx.PrincipalFrom(ctx)
			script := strings.TrimSpace(in.Script)
			if script == "" {
				return nil, errors.New("script is required")
			}
			// /mcp 不挂 wsMW（WorkspaceHeaderCtx），PAT principal 的 WorkspaceID
			// 为空。单工作区 PAT 从 scope 解析；多工作区必须显式传 workspace_id
			// （并经 Scope.AllowsWorkspace 校验——scope 门语义不绕过）。
			wsID := p.WorkspaceID
			if wsID == "" {
				wsID = strings.TrimSpace(in.WorkspaceID)
				if wsID == "" {
					var ids []string
					if p.Scope != nil {
						ids = p.Scope.WorkspaceIDs
					}
					switch len(ids) {
					case 1:
						wsID = ids[0]
					case 0:
						return nil, errors.New("workspace unresolved: unrestricted PAT needs workspace_id argument (or call through a workspace-scoped surface)")
					default:
						return nil, errors.New("workspace unresolved: this PAT spans multiple workspaces — pass workspace_id (one of: " + strings.Join(ids, ", ") + ")")
					}
				} else if !p.Scope.AllowsWorkspace(wsID) {
					return nil, errors.New("workspace_id not in this PAT's credential scope")
				}
			}
			p2 := *p
			p2.WorkspaceID = wsID
			p = &p2
			title := strings.TrimSpace(in.Title)
			if title == "" {
				// 首行截断做标题（与 Studio 创建流 deriveTitleFromScript 同思路）。
				for _, line := range strings.Split(script, "\n") {
					line = strings.TrimSpace(line)
					if line != "" {
						title = line
						break
					}
				}
				if len([]rune(title)) > 24 {
					title = string([]rune(title)[:24])
				}
			}
			pr, err := deps.Svc.Create(ctx, p, title)
			if err != nil {
				return nil, err
			}
			tpl := in.Template
			if strings.TrimSpace(tpl) == "" {
				tpl = "listicle"
			}
			th := in.Theme
			if strings.TrimSpace(th) == "" {
				th = "ink"
			}
			res, err := deps.Svc.ComposeProject(ctx, p, pr.ID, videoapp.ComposeInput{
				Script: script, TemplateKey: tpl, ThemeKey: th,
			})
			if err != nil {
				return map[string]any{"project_id": pr.ID, "stage": "compose", "error": err.Error()}, nil
			}
			params := videoapp.RenderParams{FPS: in.FPS, Width: in.Width, Height: in.Height}
			r, err := deps.Svc.SubmitRender(ctx, p, pr.ID, params, &res.Version, pr.ID)
			if err != nil {
				return map[string]any{"project_id": pr.ID, "stage": "render_submit", "cards": res.Cards, "words_source": res.WordsSource, "error": err.Error()}, nil
			}
			out := map[string]any{
				"project_id": pr.ID, "render_id": r.ID, "status": r.Status,
				"cards": res.Cards, "words_source": res.WordsSource,
			}
			if !in.Wait {
				return out, nil
			}
			// wait=true：轮询到终态（每次间隔 1s，上限 10 分钟——渲染 10s 片约 40s，
			// 10800 帧全片约 15 分钟量级，此处按演示短片上量封顶，超时返回在途状态）。
			deadline := time.Now().Add(10 * time.Minute)
			for {
				time.Sleep(1 * time.Second)
				cur, err := deps.Svc.GetRender(ctx, p, r.ID)
				if err != nil {
					out["stage"] = "poll_error"
					out["error"] = err.Error()
					return out, nil
				}
				out["status"] = cur.Status
				out["frames_done"] = cur.FramesDone
				out["frames_total"] = cur.FramesTotal
				switch cur.Status {
				case "succeeded":
					out["output_url"] = "/api/video/files/" + cur.OutputKey
					out["download_hint"] = "GET output_url with the same credentials (PAT; workspace member)"
					return out, nil
				case "failed", "interrupted":
					out["error"] = cur.Error
					return out, nil
				}
				if time.Now().After(deadline) {
					out["stage"] = "poll_timeout"
					out["hint"] = "render still in flight; poll video_get_render with render_id"
					return out, nil
				}
			}
		})
}

// snapshotIn is video_snapshot_frame's input (package-level so tests pin the
// wire shape).
type snapshotIn struct {
	ProjectID   string `json:"project_id" jsonschema:"project id"`
	Frame       int    `json:"frame" jsonschema:"0-based frame number to capture (clamped into [0, duration_frames-1] when out of range)"`
	Width       int    `json:"width,omitempty" jsonschema:"capture width px (default IR meta.width; pass with height; odd values rejected)"`
	Height      int    `json:"height,omitempty" jsonschema:"capture height px (default IR meta.height; pass with width; odd values rejected)"`
	WorkspaceID string `json:"workspace_id,omitempty" jsonschema:"target workspace — required only for multi-workspace PATs; single-workspace PATs resolve automatically"`
}

// previewFramesIn is video_preview_frames' input (G-02; package-level so
// tests pin the wire shape).
type previewFramesIn struct {
	ProjectID   string `json:"project_id" jsonschema:"project id"`
	Frames      []int  `json:"frames" jsonschema:"2-6 frame numbers to capture (0-based; deduped, sorted, clamped into [0, duration_frames-1])"`
	Width       int    `json:"width,omitempty" jsonschema:"capture width px (default IR meta.width; pass with height; odd values rejected)"`
	Height      int    `json:"height,omitempty" jsonschema:"capture height px (default IR meta.height; pass with width; odd values rejected)"`
	WorkspaceID string `json:"workspace_id,omitempty" jsonschema:"target workspace — required only for multi-workspace PATs; single-workspace PATs resolve automatically"`
}

// renderFramesIn is video_render_frames' input (G-07; package-level so tests
// pin the wire shape).
type renderFramesIn struct {
	RenderID    string    `json:"render_id" jsonschema:"render id (from video_render; must be status=succeeded)"`
	Frames      []float64 `json:"frames" jsonschema:"2-6 time_sec values (seconds into the encoded output; deduped, sorted)"`
	WorkspaceID string    `json:"workspace_id,omitempty" jsonschema:"target workspace — required only for multi-workspace PATs; single-workspace PATs resolve automatically"`
}

// projectHTML is the shared projection step of both snapshot tools: the
// DataURIResolver document (zero network, byte-identical to the render
// pipeline's projection). An unwired Store fails only when the IR actually
// carries image elements — pure-text projects stay capturable without it.
func projectHTML(ctx context.Context, deps Deps, ir *videoapp.IR) ([]byte, error) {
	if deps.Store == nil && len(ir.Elements) > 0 {
		for _, el := range ir.Elements {
			if el.Type == videoapp.ElementImage && el.Src != "" {
				return nil, errors.New("snapshot unavailable: storage not wired for asset inlining (element " + el.ID + " carries an image src)")
			}
		}
	}
	resolver := videoapp.DataURIResolver{
		Loader: func(ctx context.Context, key string) (io.ReadCloser, storagex.Object, error) {
			if deps.Store == nil {
				return nil, storagex.Object{}, errors.New("storage not wired")
			}
			return deps.Store.Open(ctx, key)
		},
	}
	html, err := videoapp.NewProjector(resolver).HTML(ctx, ir, "")
	if err != nil {
		return nil, fmt.Errorf("project: %w", err)
	}
	return html, nil
}

// wordsSourceOf reports where the word table came from (the first word's
// source stamp — SetScript/SetWords stamp the table uniformly; an empty table
// reads as "none").
func wordsSourceOf(ir *videoapp.IR) string {
	if len(ir.Words) == 0 {
		return "none"
	}
	return ir.Words[0].Source
}

// lastWord returns the final word of the table (nil when empty).
func lastWord(ir *videoapp.IR) *videoapp.Word {
	if len(ir.Words) == 0 {
		return nil
	}
	return &ir.Words[len(ir.Words)-1]
}

// sortInts sorts small ascending slices (n ≤ 6 in practice; insertion sort
// keeps the dependency surface minimal).
func sortInts(a []int) {
	for i := 1; i < len(a); i++ {
		for j := i; j > 0 && a[j] < a[j-1]; j-- {
			a[j], a[j-1] = a[j-1], a[j]
		}
	}
}

// sortFloats is sortInts for the render_frames time_sec list.
func sortFloats(a []float64) {
	for i := 1; i < len(a); i++ {
		for j := i; j > 0 && a[j] < a[j-1]; j-- {
			a[j], a[j-1] = a[j-1], a[j]
		}
	}
}

// setAudioIn is video_set_audio's input (G-01a; package-level so tests pin
// the wire shape). Pointer-typed keys distinguish "set this track" from
// "leave/clear it" — omitting BOTH is rejected by the handler (clearing two
// tracks at once is not this tool's job).
type setAudioIn struct {
	ProjectID       string  `json:"project_id" jsonschema:"project id"`
	VoiceKey        *string `json:"voice_key,omitempty" jsonschema:"voice track storage key (video/<workspace>/... from video_upload_asset); omit or null = clear the voice track"`
	VoiceDuration   float64 `json:"voice_duration_sec,omitempty" jsonschema:"voice duration seconds (extends the timeline when past meta.duration_sec)"`
	VoiceVolume     float64 `json:"voice_volume,omitempty" jsonschema:"voice volume 0-1 (default 1)"`
	BGMKey          *string `json:"bgm_key,omitempty" jsonschema:"bgm track storage key; omit or null = clear the bgm track"`
	BGMVolume       float64 `json:"bgm_volume,omitempty" jsonschema:"bgm volume 0-1 (default 0 = muted bgm; render mixes with this)"`
	ExpectedVersion *int    `json:"expected_version,omitempty" jsonschema:"optimistic-lock version"`
	WorkspaceID     string  `json:"workspace_id,omitempty" jsonschema:"target workspace — required only for multi-workspace PATs; single-workspace PATs resolve automatically"`
}

// prepareSnapshot is video_snapshot_frame's precondition chain, extracted
// from the handler so unit tests exercise it without a database (every check
// here precedes Svc.Get). Returns the workspace-resolved principal and the
// capture bridge, or an agent-readable error:
//   - project_id missing / frame negative / width-height mismatch / odd dims
//   - capability offline (deps.Snapshot nil or the bridge unwired) → the
//     E_NOT_CONFIGURED error that tells the agent to fall back to
//     video_inspect
func prepareSnapshot(deps Deps, p *webx.Principal, in snapshotIn) (*webx.Principal, videorender.Snapshotter, error) {
	if strings.TrimSpace(in.ProjectID) == "" {
		return nil, nil, errors.New("project_id is required")
	}
	// /mcp 不挂 wsMW：PAT principal 的 WorkspaceID 可能为空，与
	// video_generate_video 相同的 resolve 模式（单工作区 scope 解析 /
	// 显式传参经 AllowsWorkspace 校验）。
	p, err := resolveWorkspacePrincipal(p, in.WorkspaceID)
	if err != nil {
		return nil, nil, err
	}
	if in.Frame < 0 {
		return nil, nil, errors.New("frame must be >= 0 (0-based frame number)")
	}
	// 尺寸：width/height 传一必须传二（都缺省用 IR meta）；奇数拒
	// （capx FrameSpec.Validate 的 yuv420p 契约，提前拒绝省一次 Chrome 起页）。
	w, h := in.Width, in.Height
	if (w == 0) != (h == 0) {
		return nil, nil, errors.New("width and height must be passed together (both default to the IR canvas when omitted)")
	}
	if w%2 != 0 || h%2 != 0 {
		return nil, nil, errors.New("width and height must be even (libx264 yuv420p contract)")
	}
	snap := videorender.SnapshotterFor()
	if deps.Snapshot != nil {
		snap = deps.Snapshot()
	}
	if snap == nil {
		return nil, nil, videoapp.ErrNotConfigured
	}
	return p, snap, nil
}

// resolveWorkspacePrincipal fills an empty principal.WorkspaceID for the
// /mcp surface (no wsMW there): single-workspace PATs resolve from the
// credential scope; multi-workspace PATs must pass workspace_id explicitly
// (validated with Scope.AllowsWorkspace — the scope gate is never bypassed).
// A principal that already carries a workspace passes through untouched.
// This is the video_generate_video resolve pattern, extracted when the
// snapshot tool needed the same semantics.
func resolveWorkspacePrincipal(p *webx.Principal, workspaceID string) (*webx.Principal, error) {
	if p == nil {
		return nil, fmt.Errorf("%w: no principal", ErrScopeDenied)
	}
	if p.WorkspaceID != "" {
		return p, nil
	}
	wsID := strings.TrimSpace(workspaceID)
	if wsID == "" {
		var ids []string
		if p.Scope != nil {
			ids = p.Scope.WorkspaceIDs
		}
		switch len(ids) {
		case 1:
			wsID = ids[0]
		case 0:
			return nil, errors.New("workspace unresolved: unrestricted PAT needs workspace_id argument (or call through a workspace-scoped surface)")
		default:
			return nil, errors.New("workspace unresolved: this PAT spans multiple workspaces — pass workspace_id (one of: " + strings.Join(ids, ", ") + ")")
		}
	} else if !p.Scope.AllowsWorkspace(wsID) {
		return nil, errors.New("workspace_id not in this PAT's credential scope")
	}
	p2 := *p
	p2.WorkspaceID = wsID
	return &p2, nil
}

// mcpAdd is the shared tool skeleton (§4.6): scope gate is literally the
// first line inside the wrapped handler.
func mcpAdd[In any](s *mcp.Server, name, description, scope string, fn func(context.Context, *mcp.CallToolRequest, In) (any, error)) {
	mcp.AddTool(s, &mcp.Tool{Name: name, Description: description},
		func(ctx context.Context, req *mcp.CallToolRequest, in In) (*mcp.CallToolResult, any, error) {
			if err := requireToolScope(ctx, scope); err != nil {
				return nil, nil, err
			}
			out, err := fn(ctx, req, in)
			if err != nil {
				return nil, nil, err
			}
			b, _ := json.Marshal(out)
			return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: string(b)}}}, nil, nil
		})
}

// requireToolScope enforces the PAT-only contract for the video MCP surface
// (v2.0 D6; delivery audit Â§5 P12): browser sessions are REJECTED, not
// scope-checked and passed. Rationale: /mcp sits in the CSRF-exempt prefix
// list, so a session cookie plus same-site XSS could otherwise invoke
// agent-grade tools with the user's privileges; PAT possession is the
// agent-capability boundary. (devx keeps its session-passing shape because
// its surface is the developer's own log/job tooling, not a production
// write path.)
func requireToolScope(ctx context.Context, scope string) error {
	p := webx.PrincipalFrom(ctx)
	if p == nil {
		return fmt.Errorf("%w: no principal", ErrScopeDenied)
	}
	if p.Source != webx.SourcePAT {
		return fmt.Errorf("%w: video MCP tools require a PAT (session callers use the REST surface)", ErrScopeDenied)
	}
	if !p.Scope.Allows(scope) {
		return fmt.Errorf("%w: PAT scope does not include %s", ErrScopeDenied, scope)
	}
	return nil
}

// decodeElement converts the tool's map into the typed Element (explicit
// keys; unknown keys silently dropped — the IR Validate is the strict gate).
func decodeElement(m map[string]any) (videoapp.Element, error) {
	b, err := json.Marshal(m)
	if err != nil {
		return videoapp.Element{}, err
	}
	var el videoapp.Element
	if err := json.Unmarshal(b, &el); err != nil {
		return videoapp.Element{}, webx.NewError(400, "E_VIDEO_IR_INVALID", "element: element must be a valid element object")
	}
	return el, nil
}

func decodePoint(m map[string]any) *videoapp.Point {
	b, _ := json.Marshal(m)
	var pt videoapp.Point
	if json.Unmarshal(b, &pt) == nil {
		return &pt
	}
	return nil
}

func base64Decode(s string) ([]byte, error) {
	return base64.StdEncoding.DecodeString(s)
}

func contentTypeFromName(name string) string {
	switch {
	case strings.HasSuffix(name, ".png"):
		return "image/png"
	case strings.HasSuffix(name, ".jpg"), strings.HasSuffix(name, ".jpeg"):
		return "image/jpeg"
	case strings.HasSuffix(name, ".gif"):
		return "image/gif"
	case strings.HasSuffix(name, ".webp"):
		return "image/webp"
	case strings.HasSuffix(name, ".mp3"):
		return "audio/mpeg"
	case strings.HasSuffix(name, ".m4a"):
		return "audio/mp4"
	case strings.HasSuffix(name, ".wav"):
		return "audio/wav"
	}
	return ""
}
