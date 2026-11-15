// Package videomcp registers the 12 video_* MCP tools (§4.6) on the product
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
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/haozing/ploykit/platform/webx"

	videoapp "myproduct/internal/video/app"
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

// Deps carries the service plus the capability probe (no capx import: the
// probe is an interface so the tools compile without chromedp).
type Deps struct {
	Svc *videoapp.ProjectService
	Cap videoapp.CapProbe
}

// RegisterTools installs all 12 video_* tools.
func RegisterTools(s *mcp.Server, deps Deps) {
	// ---- video_list_projects (video:read) ----
	type listIn struct{}
	mcpAdd(s, "video_list_projects",
		"List the workspace's video studio projects (id, title, version, updated_at).",
		ScopeRead, func(ctx context.Context, _ *mcp.CallToolRequest, _ listIn) (any, error) {
			items, err := deps.Svc.List(ctx, webx.PrincipalFrom(ctx))
			if err != nil {
				return nil, err
			}
			return map[string]any{"projects": items}, nil
		})

	// ---- video_create_project (video:write) ----
	type createIn struct {
		Title string `json:"title" jsonschema:"project title (1-200 chars after trim)"`
	}
	mcpAdd(s, "video_create_project",
		"Create a video studio project. Returns the id and initial version (1).",
		ScopeWrite, func(ctx context.Context, _ *mcp.CallToolRequest, in createIn) (any, error) {
			pr, err := deps.Svc.Create(ctx, webx.PrincipalFrom(ctx), in.Title)
			if err != nil {
				return nil, err
			}
			return map[string]any{"id": pr.ID, "version": pr.Version}, nil
		})

	// ---- video_inspect (video:read) ----
	type inspectIn struct {
		ProjectID string `json:"project_id" jsonschema:"project id (from video_list_projects)"`
	}
	mcpAdd(s, "video_inspect",
		"Fetch one project's full IR snapshot plus resolutions[] — the anchor audit view (each effect/animation's wordIndex + reason: exact|same_text|nearest|missing).",
		ScopeRead, func(ctx context.Context, _ *mcp.CallToolRequest, in inspectIn) (any, error) {
			pr, err := deps.Svc.Get(ctx, webx.PrincipalFrom(ctx), in.ProjectID)
			if err != nil {
				return nil, err
			}
			return map[string]any{
				"ir": pr.IR, "version": pr.Version,
				"resolutions": videoapp.ResolveAll(pr.IR, videoapp.PrevWordIndexes(pr.IR)),
			}, nil
		})

	// ---- video_set_script (video:write) ----
	type setScriptIn struct {
		ProjectID       string `json:"project_id" jsonschema:"project id"`
		Script          string `json:"script" jsonschema:"new script text (≤5000 chars); words re-derived (TTS → aligner → estimated)"`
		ExpectedVersion *int   `json:"expected_version,omitempty" jsonschema:"optimistic-lock version; omit to skip the check"`
	}
	mcpAdd(s, "video_set_script",
		"Replace the narration script. Words are re-derived and every effect/animation anchor is re-resolved; the response lists which anchors drifted.",
		ScopeWrite, func(ctx context.Context, _ *mcp.CallToolRequest, in setScriptIn) (any, error) {
			version, resolutions, source, err := deps.Svc.SetScript(ctx, webx.PrincipalFrom(ctx),
				in.ProjectID, in.Script, in.ExpectedVersion)
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
	}
	mcpAdd(s, "video_set_words",
		"Replace the word timing table (manual refinement path). Anchors are re-resolved against the new table.",
		ScopeWrite, func(ctx context.Context, _ *mcp.CallToolRequest, in setWordsIn) (any, error) {
			version, resolutions, err := deps.Svc.SetWords(ctx, webx.PrincipalFrom(ctx),
				in.ProjectID, in.Words, in.ExpectedVersion)
			if err != nil {
				return nil, err
			}
			return map[string]any{"version": version, "resolutions": resolutions}, nil
		})

	// ---- video_add_effect_at_word (video:write) ----
	type addEffectIn struct {
		ProjectID       string          `json:"project_id" jsonschema:"project id"`
		AnchorText      string          `json:"anchor_text" jsonschema:"anchor word text (must exist in words[]; miss = error)"`
		Occurrence      int             `json:"occurrence,omitempty" jsonschema:"0-based occurrence of the text among words (default 0)"`
		Type            string          `json:"type" jsonschema:"effect type: pulse|counter|highlight|shake|fade"`
		Params          json.RawMessage `json:"params,omitempty" jsonschema:"effect params object, validated per type"`
		ExpectedVersion *int            `json:"expected_version,omitempty" jsonschema:"optimistic-lock version"`
	}
	mcpAdd(s, "video_add_effect_at_word",
		"Add a motion effect anchored at a word. Resolved word index + reason come back in resolvedFrom.",
		ScopeWrite, func(ctx context.Context, _ *mcp.CallToolRequest, in addEffectIn) (any, error) {
			version, rf, err := deps.Svc.AddEffectAtWord(ctx, webx.PrincipalFrom(ctx),
				in.ProjectID, videoapp.Anchor{Text: in.AnchorText, Occurrence: in.Occurrence},
				in.Type, in.Params, in.ExpectedVersion)
			if err != nil {
				return nil, err
			}
			return map[string]any{"version": version, "resolvedFrom": rf}, nil
		})

	// ---- video_upsert_element (video:write) ----
	type upsertElementIn struct {
		ProjectID       string         `json:"project_id" jsonschema:"project id"`
		Element         map[string]any `json:"element" jsonschema:"element object {id,type:image|text|shape,src?,x,y,w,h,z,animations?}; src must be a video/<workspace>/ storage key"`
		ExpectedVersion *int           `json:"expected_version,omitempty" jsonschema:"optimistic-lock version"`
	}
	mcpAdd(s, "video_upsert_element",
		"Insert or replace one canvas element by id.",
		ScopeWrite, func(ctx context.Context, _ *mcp.CallToolRequest, in upsertElementIn) (any, error) {
			el, err := decodeElement(in.Element)
			if err != nil {
				return nil, err
			}
			version, _, err := deps.Svc.UpsertElement(ctx, webx.PrincipalFrom(ctx),
				in.ProjectID, el, in.ExpectedVersion)
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
	}
	mcpAdd(s, "video_move_element",
		"Reposition one element.",
		ScopeWrite, func(ctx context.Context, _ *mcp.CallToolRequest, in moveElementIn) (any, error) {
			version, err := deps.Svc.MoveElement(ctx, webx.PrincipalFrom(ctx),
				in.ProjectID, in.ElementID, in.X, in.Y, in.ExpectedVersion)
			if err != nil {
				return nil, err
			}
			return map[string]any{"version": version}, nil
		})

	// ---- video_animate_element (video:write) ----
	type animateIn struct {
		ProjectID      string         `json:"project_id" jsonschema:"project id"`
		ElementID      string         `json:"element_id" jsonschema:"element id to animate"`
		Type           string         `json:"type" jsonschema:"animation type: move|scaleIn|rotate"`
		From           map[string]any `json:"from,omitempty" jsonschema:"move start {x,y}"`
		To             map[string]any `json:"to,omitempty" jsonschema:"move end {x,y}"`
		FromValue      *float64       `json:"fromValue,omitempty" jsonschema:"scaleIn/rotate start value"`
		ToValue        *float64       `json:"toValue,omitempty" jsonschema:"scaleIn/rotate end value"`
		StartAnchor    string         `json:"start_anchor,omitempty" jsonschema:"anchor word text the animation starts at"`
		Occurrence     int            `json:"occurrence,omitempty" jsonschema:"anchor occurrence (default 0)"`
		DurationFrames int            `json:"duration_frames" jsonschema:"animation length in frames (>0)"`
		Easing         string         `json:"easing,omitempty" jsonschema:"linear|power1.out|power2.out|power3.out|back.out|expo.out"`
		ExpectedVersion *int          `json:"expected_version,omitempty" jsonschema:"optimistic-lock version"`
	}
	mcpAdd(s, "video_animate_element",
		"Append a start-anchored animation to an element (move/scaleIn/rotate).",
		ScopeWrite, func(ctx context.Context, _ *mcp.CallToolRequest, in animateIn) (any, error) {
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
			version, rf, err := deps.Svc.AnimateElement(ctx, webx.PrincipalFrom(ctx),
				in.ProjectID, in.ElementID, an, in.ExpectedVersion)
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
	}
	mcpAdd(s, "video_upload_asset",
		"Upload one small asset (image/audio ≤700KB base64). Stored content-addressed under video/<workspace>/assets/<project>/. Returns the storage key for element src / audio keys.",
		ScopeWrite, func(ctx context.Context, _ *mcp.CallToolRequest, in uploadIn) (any, error) {
			data, err := base64Decode(in.DataBase64)
			if err != nil {
				return nil, videoapp.ErrAssetUnsupported
			}
			ct := in.ContentType
			if ct == "" {
				ct = contentTypeFromName(in.Filename)
			}
			key, err := deps.Svc.UploadAsset(ctx, webx.PrincipalFrom(ctx), in.ProjectID, in.Filename, ct, data)
			if err != nil {
				return nil, err
			}
			return map[string]any{"key": key, "url": "/api/video/files/" + key, "size": len(data)}, nil
		})

	// ---- video_render (video:render) ----
	type renderParams struct {
		FPS            int     `json:"fps,omitempty" jsonschema:"output fps (default meta.fps)"`
		Width          int     `json:"width,omitempty" jsonschema:"output width (default meta.width)"`
		Height         int     `json:"height,omitempty" jsonschema:"output height (default meta.height)"`
		BurnSubtitles  bool    `json:"burn_subtitles" jsonschema:"legacy flag: true = subtitle_mode burn"`
		SubtitleMode   string  `json:"subtitle_mode,omitempty" jsonschema:"burn|soft|none (default from burn_subtitles)"`
		BGMVolume      float64 `json:"bgm_volume,omitempty" jsonschema:"bgm volume override 0-1"`
	}
	type renderIn struct {
		ProjectID       string       `json:"project_id" jsonschema:"project id"`
		Params          renderParams `json:"params,omitempty" jsonschema:"render overrides"`
		ExpectedVersion *int         `json:"expected_version,omitempty" jsonschema:"optimistic-lock version"`
	}
	mcpAdd(s, "video_render",
		"Submit a render of the project's IR snapshot. Fails with E_NOT_CONFIGURED when the render capability is offline (no quota spent), E_QUOTA_EXCEEDED when the monthly quota is out.",
		ScopeRender, func(ctx context.Context, _ *mcp.CallToolRequest, in renderIn) (any, error) {
			p := in.Params
			params := videoapp.RenderParams{
				FPS: p.FPS, Width: p.Width, Height: p.Height,
				BurnSubtitles: p.BurnSubtitles, SubtitleMode: p.SubtitleMode, BGMVolume: p.BGMVolume,
			}
			r, err := deps.Svc.SubmitRender(ctx, webx.PrincipalFrom(ctx), in.ProjectID, params, in.ExpectedVersion)
			if err != nil {
				return nil, err
			}
			return map[string]any{"render_id": r.ID, "status": r.Status}, nil
		})

	// ---- video_get_render (video:read) ----
	type getRenderIn struct {
		RenderID string `json:"render_id" jsonschema:"render id (from video_render)"`
	}
	mcpAdd(s, "video_get_render",
		"Fetch one render's status/progress/output (queued|running|succeeded|failed|interrupted + frames counters + output_url when done).",
		ScopeRead, func(ctx context.Context, _ *mcp.CallToolRequest, in getRenderIn) (any, error) {
			r, err := deps.Svc.GetRender(ctx, webx.PrincipalFrom(ctx), in.RenderID)
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

// requireToolScope mirrors devx/tools.go:157: only PAT principals are
// scope-bounded; sessions pass (role checks live with the product).
func requireToolScope(ctx context.Context, scope string) error {
	p := webx.PrincipalFrom(ctx)
	if p == nil || p.Source != webx.SourcePAT {
		return nil
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
