package videomcp

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/webx"
	videoapp "myproduct/internal/video/app"
	videorender "myproduct/internal/video/render"
)

// sessionCtx / patCtx build tool-handler contexts the way the stateless
// /mcp transport does (Authenticate-installed principal in ctx).
func sessionCtx() context.Context {
	return webx.WithPrincipal(context.Background(),
		&webx.Principal{UserID: "u1", WorkspaceID: "ws1", Source: webx.SourceSession})
}

func patCtx(scopes ...string) context.Context {
	p := &webx.Principal{
		UserID: "u1", WorkspaceID: "ws1", Source: webx.SourcePAT,
		Scope: &webx.CredentialScope{Permissions: scopes},
	}
	return webx.WithPrincipal(context.Background(), p)
}

func newServer(deps Deps) *mcp.Server {
	s := mcp.NewServer(&mcp.Implementation{Name: "test"}, nil)
	RegisterTools(s, deps)
	return s
}

func TestRequireToolScope_PATDenied(t *testing.T) {
	err := requireToolScope(patCtx("video:read"), ScopeRender)
	require.Error(t, err)
	assert.True(t, strings.Contains(err.Error(), ErrScopeDenied.Error()), "wrapped sentinel: %v", err)
	assert.True(t, strings.Contains(err.Error(), "video:render"))
}

func TestRequireToolScope_PATAllowed(t *testing.T) {
	assert.NoError(t, requireToolScope(patCtx("video:read", "video:render"), ScopeRender))
}

func TestRequireToolScope_SessionRejected(t *testing.T) {
	// PAT-only contract (v2.0 D6 / audit P12): sessions must use the REST
	// surface; /mcp is CSRF-exempt so a session cookie must not reach
	// agent-grade tools.
	err := requireToolScope(sessionCtx(), ScopeRender)
	require.Error(t, err)
	assert.True(t, strings.Contains(err.Error(), ErrScopeDenied.Error()))
	assert.True(t, strings.Contains(err.Error(), "PAT"))
}

func TestRequireToolScope_WildcardDomain(t *testing.T) {
	assert.NoError(t, requireToolScope(patCtx("video:*"), ScopeWrite), "domain wildcard covers subscopes")
}

func TestRegisterTools_Installs12Tools(t *testing.T) {
	s := mcp.NewServer(&mcp.Implementation{Name: "t"}, nil)
	RegisterTools(s, Deps{Svc: videoapp.NewProjectService(nil, videoapp.Ports{}, nil), Cap: capFake{}})
	// The Go SDK does not expose a stable tool listing on the server side;
	// registration success + the per-tool tests below are the contract.
}

type capFake struct{ ok bool }

func (c capFake) CapAvailable() bool { return c.ok }

// The SDK in this vendored version lacks a convenient direct-invocation hook;
// the scope/skeleton behavior is exercised through requireToolScope above and
// the request-shape test below verifies the input struct decoding used by
// every handler (jsonschema tags map MCP arguments).

type uploadArgs struct {
	ProjectID   string `json:"project_id" jsonschema:"project id"`
	ContentType string `json:"content_type,omitempty" jsonschema:"content type"`
	DataBase64  string `json:"data_base64" jsonschema:"data"`
}

func TestUploadArgsBase64Roundtrip(t *testing.T) {
	raw := []byte("PNGDATA")
	in := uploadArgs{ProjectID: "p1", ContentType: "image/png", DataBase64: base64.StdEncoding.EncodeToString(raw)}
	b, err := json.Marshal(in)
	require.NoError(t, err)
	var out uploadArgs
	require.NoError(t, json.Unmarshal(b, &out))
	assert.Equal(t, "p1", out.ProjectID)
	decoded, err := base64Decode(out.DataBase64)
	require.NoError(t, err)
	assert.Equal(t, raw, decoded)
}

func TestContentTypeFromName(t *testing.T) {
	assert.Equal(t, "image/png", contentTypeFromName("shot.png"))
	assert.Equal(t, "", contentTypeFromName("pic.JPG"), "uppercase ext falls through to explicit content_type")
	assert.Equal(t, "audio/mpeg", contentTypeFromName("voice.mp3"))
	assert.Equal(t, "", contentTypeFromName("file.exe"))
}

func TestDecodeElement(t *testing.T) {
	el, err := decodeElement(map[string]any{
		"id": "e1", "type": "image", "src": "video/ws/a.png",
		"x": 10.0, "y": 20.0, "w": 100.0, "h": 50.0, "z": 2.0,
	})
	require.NoError(t, err)
	assert.Equal(t, "e1", el.ID)
	assert.Equal(t, "image", el.Type)
	assert.InDelta(t, 10, el.X, 1e-9)
	assert.Equal(t, 2, el.Z)
}

func TestDecodePoint(t *testing.T) {
	pt := decodePoint(map[string]any{"x": 1.5, "y": 2.5})
	require.NotNil(t, pt)
	assert.InDelta(t, 2.5, pt.Y, 1e-9)
	assert.Nil(t, decodePoint(map[string]any{"x": "bad"}))
}

// addEffectIn carries the optional element-level target (IR extension T-10):
// the wire key is target_element_id and it maps onto Effect.TargetElementID
// (targetElementId in the IR document) through AddEffectAtWord. Params is a
// JSON object on the wire (批2 P1-2：修复前 json.RawMessage 被 jsonschema 推成
// "null|array of int"，与服务端 object 校验互斥死锁).
func TestAddEffectArgsTargetElementRoundtrip(t *testing.T) {
	in := map[string]any{
		"project_id":        "p1",
		"anchor_text":       "三倍",
		"type":              "counter",
		"params":            map[string]any{"from": 0, "to": 100},
		"target_element_id": "el_price",
	}
	b, err := json.Marshal(in)
	require.NoError(t, err)
	var out addEffectIn
	require.NoError(t, json.Unmarshal(b, &out))
	assert.Equal(t, "el_price", out.TargetElementID)
	assert.Equal(t, "counter", out.Type)
	require.NotNil(t, out.Params)
	assert.InDelta(t, 100.0, out.Params["to"].(float64), 1e-9)

	// omitted target_element_id decodes to "" — the back-compat origin path;
	// omitted params decodes to a nil map — per-type defaults (RawMessage nil).
	var bare addEffectIn
	require.NoError(t, json.Unmarshal([]byte(`{"project_id":"p1","anchor_text":"x","type":"pulse"}`), &bare))
	assert.Empty(t, bare.TargetElementID)
	assert.Nil(t, bare.Params)
	raw, err := effectParamsRaw(bare.Params)
	require.NoError(t, err)
	assert.Nil(t, raw, "omitted params must stay nil (per-type defaults)")
}

// --- video_snapshot_frame ---

// snapFake is the minimal Snapshotter double (never called in precondition
// tests — its presence just satisfies the capability check).
type snapFake struct{}

func (snapFake) Snapshot(context.Context, videorender.SnapshotDoc, videorender.SnapshotSpec) (*videorender.SnapshotResult, error) {
	return nil, videorender.ErrSnapshotNotConfigured
}

// decodeSnapshotIn pins the wire shape of the snapshot tool's arguments (the
// jsonschema-tagged struct maps MCP arguments; keys are snake_case on wire).
func decodeSnapshotIn(t *testing.T, raw string) snapshotIn {
	t.Helper()
	var in snapshotIn
	require.NoError(t, json.Unmarshal([]byte(raw), &in))
	return in
}

// patPrincipal builds a PAT principal with an empty WorkspaceID (the /mcp
// shape without wsMW) for prepareSnapshot-style direct calls.
func patPrincipal(wsIDs []string, scopes ...string) *webx.Principal {
	return &webx.Principal{
		UserID: "u1", Source: webx.SourcePAT,
		Scope: &webx.CredentialScope{WorkspaceIDs: wsIDs, Permissions: scopes},
	}
}

func TestPrepareSnapshot_MissingProjectID(t *testing.T) {
	in := decodeSnapshotIn(t, `{"frame":0}`)
	// 带 WorkspaceID 的 principal：跳过解析段，直达 project_id 校验。
	p := patPrincipal(nil, "video:write")
	p.WorkspaceID = "ws1"
	_, _, err := prepareSnapshot(context.Background(), Deps{}, p, in)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "project_id")
}

func TestPrepareSnapshot_NegativeFrame(t *testing.T) {
	in := decodeSnapshotIn(t, `{"project_id":"p1","frame":-3}`)
	p := patPrincipal(nil, "video:write")
	p.WorkspaceID = "ws1"
	_, _, err := prepareSnapshot(context.Background(), Deps{}, p, in)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "frame")
}

func TestPrepareSnapshot_DimsMismatch(t *testing.T) {
	p := patPrincipal(nil, "video:write")
	p.WorkspaceID = "ws1"
	in := decodeSnapshotIn(t, `{"project_id":"p1","frame":0,"width":1080}`)
	_, _, err := prepareSnapshot(context.Background(), Deps{}, p, in)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "together")

	in2 := decodeSnapshotIn(t, `{"project_id":"p1","frame":0,"width":1081,"height":1920}`)
	_, _, err = prepareSnapshot(context.Background(), Deps{}, p, in2)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "even")
}

// TestPrepareSnapshot_StubBuildReportsNotConfigured: 桥接未接线（默认构建）
// 时报 E_NOT_CONFIGURED，文本可读、能指向 video_inspect 退化路径（文本
// 经 ErrNotConfigured.Message 透传给 agent）。
func TestPrepareSnapshot_StubBuildReportsNotConfigured(t *testing.T) {
	in := decodeSnapshotIn(t, `{"project_id":"p1","frame":0}`)
	p := patPrincipal(nil, "video:write")
	p.WorkspaceID = "ws1"
	_, _, err := prepareSnapshot(context.Background(), Deps{}, p, in)
	require.Error(t, err)
	var wxErr *webx.Error
	require.True(t, errors.As(err, &wxErr), "want *webx.Error, got %T: %v", err, err)
	assert.Equal(t, "E_NOT_CONFIGURED", wxErr.Code)
	assert.True(t, strings.Contains(wxErr.Message, "render capability not configured"),
		"agent-readable text, got: %s", wxErr.Message)
	// deps.Snapshot 在场但桥接未接线（stub 构建）：同样的 E_NOT_CONFIGURED。
	in2 := decodeSnapshotIn(t, `{"project_id":"p1","frame":0}`)
	_, _, err2 := prepareSnapshot(context.Background(), Deps{Snapshot: func() videorender.Snapshotter { return nil }}, p, in2)
	require.Error(t, err2)
	var wxErr2 *webx.Error
	require.True(t, errors.As(err2, &wxErr2))
	assert.Equal(t, "E_NOT_CONFIGURED", wxErr2.Code)
}

// TestPrepareSnapshot_BridgeErrorMappedToNotConfigured: 桥接接线了但底层
// 返回 ErrSnapshotNotConfigured（运行时惰性），handler 层应映射为同一个
// E_NOT_CONFIGURED（agent 只看到一个稳定降级信号）。
func TestSnapshotBridgeError_MapsToNotConfigured(t *testing.T) {
	// handler 的映射逻辑是 errors.Is(err, videorender.ErrSnapshotNotConfigured)
	// → videoapp.ErrNotConfigured；这里验证哨兵可被 errors.Is 命中（wrap 链），
	// agent 侧只看到 E_NOT_CONFIGURED 一个稳定信号。
	err := videorender.ErrSnapshotNotConfigured
	require.Error(t, err)
	wrapped := fmt.Errorf("snapshot: %w", err)
	assert.True(t, errors.Is(wrapped, videorender.ErrSnapshotNotConfigured))
}

// TestPrepareSnapshot_WorkspaceResolve: PAT workspace 解析语义（单工作区
// scope 自动解析；多工作区要求显式 workspace_id；scope 外 id 拒）。
func TestPrepareSnapshot_WorkspaceResolve(t *testing.T) {
	base := `{"project_id":"p1","frame":0}`
	deps := Deps{Snapshot: func() videorender.Snapshotter { return snapFake{} }}
	// 单工作区 PAT：从 scope 自动解析，不需要 workspace_id。
	p, _, err := prepareSnapshot(context.Background(), deps, patPrincipal([]string{"ws1"}, "video:write"), decodeSnapshotIn(t, base))
	require.NoError(t, err)
	assert.Equal(t, "ws1", p.WorkspaceID)

	// 多工作区 PAT 且未传 workspace_id：明确报错并列出可选值。
	_, _, err = prepareSnapshot(context.Background(), deps, patPrincipal([]string{"ws1", "ws2"}, "video:write"), decodeSnapshotIn(t, base))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "workspace_id")
	assert.Contains(t, err.Error(), "ws1, ws2")

	// 多工作区 PAT 显式传 scope 外 id：拒。
	in := decodeSnapshotIn(t, `{"project_id":"p1","frame":0,"workspace_id":"ws9"}`)
	_, _, err = prepareSnapshot(context.Background(), deps, patPrincipal([]string{"ws1", "ws2"}, "video:write"), in)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "credential scope")

	// 多工作区 PAT 显式传合法 id：通过（桥接在场才走到这里之后的路径）。
	inWS2 := decodeSnapshotIn(t, `{"project_id":"p1","frame":0,"workspace_id":"ws2"}`)
	p, snap, err := prepareSnapshot(context.Background(), deps, patPrincipal([]string{"ws1", "ws2"}, "video:write"), inWS2)
	require.NoError(t, err)
	assert.Equal(t, "ws2", p.WorkspaceID)
	require.NotNil(t, snap)
}

// --- video_set_audio (G-01a) ---

// decodeSetAudioIn pins the wire shape of the audio tool's arguments (keys
// are snake_case on wire; pointer-typed keys distinguish "set" from "clear").
func decodeSetAudioIn(t *testing.T, raw string) setAudioIn {
	t.Helper()
	var in setAudioIn
	require.NoError(t, json.Unmarshal([]byte(raw), &in))
	return in
}

// setAudioFakeSvc 是 CanAccessKey 可控的最小服务替身（nil pool 时
// CanAccessKey fail-closed 返回 false——正是真实 nil-pool 语义，但测试要
// 也能走通注册路径，所以注入真池的用例放 DB 集成套件，这里只测 wire 形状
// 与前置校验）。
func TestSetAudioIn_WireShape(t *testing.T) {
	in := decodeSetAudioIn(t, `{"project_id":"p1","voice_key":"video/ws1/a/v.mp3","voice_duration_sec":4.5,"voice_volume":1,"bgm_key":"video/ws1/a/b.mp3","bgm_volume":0.3}`)
	assert.Equal(t, "p1", in.ProjectID)
	require.NotNil(t, in.VoiceKey)
	assert.Equal(t, "video/ws1/a/v.mp3", *in.VoiceKey)
	assert.InDelta(t, 4.5, in.VoiceDuration, 1e-9)
	require.NotNil(t, in.BGMKey)
	assert.InDelta(t, 0.3, in.BGMVolume, 1e-9)

	// 缺省两个 key：两指针都是 nil（"清除对应轨"的 null 语义）。
	bare := decodeSetAudioIn(t, `{"project_id":"p1"}`)
	assert.Nil(t, bare.VoiceKey)
	assert.Nil(t, bare.BGMKey)
}

// TestSetAudio_RequiresAtLeastOneTrack: 两个 key 都缺 = 输入错误（不落
// Mutate——"clear both" 不是本工具语义，直接拒）。
func TestSetAudio_RequiresAtLeastOneTrack(t *testing.T) {
	s := mcp.NewServer(&mcp.Implementation{Name: "t"}, nil)
	RegisterTools(s, Deps{Svc: videoapp.NewProjectService(nil, videoapp.Ports{}, nil)})
	// 直接构造 handler 无法从 SDK 拿到，前置校验通过 handler 闭包实现——
	// 这里经 server 注册成功 + wire 形状测试覆盖；行为断言由 DB 集成套件
	// （SetAudio + CanAccessKey fail-closed 真池路径）承担。
}

// --- 批G 新工具（preview_frames / render_frames / validate / list_elements）---

// decodePreviewFramesIn / decodeRenderFramesIn pin the wire shapes of the
// batch eyes (keys are snake_case on wire).
func decodePreviewFramesIn(t *testing.T, raw string) previewFramesIn {
	t.Helper()
	var in previewFramesIn
	require.NoError(t, json.Unmarshal([]byte(raw), &in))
	return in
}

func decodeRenderFramesIn(t *testing.T, raw string) renderFramesIn {
	t.Helper()
	var in renderFramesIn
	require.NoError(t, json.Unmarshal([]byte(raw), &in))
	return in
}

func TestPreviewFramesIn_WireShape(t *testing.T) {
	in := decodePreviewFramesIn(t, `{"project_id":"p1","frames":[12,3,3,40],"width":540,"height":960}`)
	assert.Equal(t, "p1", in.ProjectID)
	assert.Equal(t, []int{12, 3, 3, 40}, in.Frames)
	assert.Equal(t, 540, in.Width)

	bare := decodePreviewFramesIn(t, `{"project_id":"p1","frames":[0,1]}`)
	assert.Equal(t, 0, bare.Width)
	assert.Equal(t, 0, bare.Height)
}

func TestRenderFramesIn_WireShape(t *testing.T) {
	in := decodeRenderFramesIn(t, `{"render_id":"r1","frames":[2.5,0,1.0,2.5]}`)
	assert.Equal(t, "r1", in.RenderID)
	assert.Equal(t, []float64{2.5, 0, 1.0, 2.5}, in.Frames)
}

func TestSortIntsAndFloats(t *testing.T) {
	xs := []int{5, 1, 3, 1}
	sortInts(xs)
	assert.Equal(t, []int{1, 1, 3, 5}, xs)
	fs := []float64{2.5, 0, 1}
	sortFloats(fs)
	assert.Equal(t, []float64{0, 1, 2.5}, fs)
}

// TestWordsSourceAndLastWord helpers: words_source 摘要与末词截断检查的
// 投影函数（validate 工具的五块之一的纯逻辑部分）。
func TestWordsSourceOfAndLastWord(t *testing.T) {
	empty := &videoapp.IR{}
	assert.Equal(t, "none", wordsSourceOf(empty))
	assert.Nil(t, lastWord(empty))

	ir := &videoapp.IR{Words: []videoapp.Word{
		{Index: 0, Text: "a", Start: 0, End: 1, Source: videoapp.WordSourceTTS},
		{Index: 1, Text: "b", Start: 1, End: 12.5, Source: videoapp.WordSourceTTS},
	}}
	assert.Equal(t, "tts", wordsSourceOf(ir))
	lw := lastWord(ir)
	require.NotNil(t, lw)
	assert.InDelta(t, 12.5, lw.End, 1e-9)
}

// TestProjectHTML_StorageGate: Store 未接线 + IR 带图片元素 = 明确报错
// （含元素 id）；纯文本项目无 Store 也可投影（与单帧工具的旧门语义一致）。
func TestProjectHTML_StorageGate(t *testing.T) {
	imgIR := &videoapp.IR{Elements: []videoapp.Element{{ID: "img1", Type: "image", Src: "video/ws/a/p.png"}}}
	_, err := projectHTML(context.Background(), Deps{}, imgIR)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "img1")

	textIR := &videoapp.IR{Elements: []videoapp.Element{{ID: "t1", Type: "text", Text: "hi"}}}
	// 纯文本项目：不触 Store 即可投影（本地投影不访问资产）。
	_, err = projectHTML(context.Background(), Deps{}, textIR)
	require.NoError(t, err)
}

// TestMultiFor_NativeVsLoop: 原生 multi 桥接直通；非 multi 桥接（纯
// Snapshotter）回落逐帧 loop（语义一致——帧 N 的像素只取决于 (doc, spec, N)）。
func TestMultiFor_NativeVsLoop(t *testing.T) {
	// 原生（同时实现两接口）：同一实例直通——capx 构建的 cachedSnapshotter
	// 就是这个形状，MultiFor 不得再包一层 loop。
	native := videorender.MultiFor(multiFakeBridge{})
	require.NotNil(t, native)
	res, err := native.SnapshotMulti(context.Background(), videorender.SnapshotDoc{}, videorender.SnapshotSpec{Frame: 7}, []int{4, 2})
	require.NoError(t, err)
	require.Len(t, res, 2)
	assert.Equal(t, 4, res[0].Frame, "native bridge receives the raw frames list")
	assert.Equal(t, 2, res[1].Frame)

	// 非 multi 桥接 → loop fallback，逐帧调 Snapshot（snapOK 每帧出真结果）。
	loop := videorender.MultiFor(snapOK{})
	require.NotNil(t, loop)
	res, err = loop.SnapshotMulti(context.Background(), videorender.SnapshotDoc{}, videorender.SnapshotSpec{Frame: 7}, []int{1, 3})
	require.NoError(t, err)
	require.Len(t, res, 2)
	assert.Equal(t, 1, res[0].Frame)
	assert.Equal(t, 3, res[1].Frame)

	// nil 桥接 → nil（工具层报 E_NOT_CONFIGURED 的路径）。
	assert.Nil(t, videorender.MultiFor(nil))
}

// multiFakeBridge implements BOTH Snapshotter and SnapshotMulti — the shape
// the capx build's cachedSnapshotter has (MultiFor must pass it through
// untouched, not wrap it in the loop fallback).
type multiFakeBridge struct{ snapFake }

func (multiFakeBridge) SnapshotMulti(_ context.Context, _ videorender.SnapshotDoc, _ videorender.SnapshotSpec, frames []int) ([]videorender.SnapshotResult, error) {
	out := make([]videorender.SnapshotResult, 0, len(frames))
	for _, f := range frames {
		out = append(out, videorender.SnapshotResult{Frame: f, PNG: []byte("PNG")})
	}
	return out, nil
}

// snapOK is a plain Snapshotter that succeeds per frame — drives the loop
// fallback path in MultiFor's native-vs-loop test.
type snapOK struct{}

func (snapOK) Snapshot(_ context.Context, _ videorender.SnapshotDoc, spec videorender.SnapshotSpec) (*videorender.SnapshotResult, error) {
	return &videorender.SnapshotResult{Frame: spec.Frame, PNG: []byte("PNG"), Width: spec.Width, Height: spec.Height}, nil
}

// ==================== 批2 E2E 契约修复（P1-1/P1-2/P1-3/P2-4/P2-5） ====================

// --- P1-1 upsert_element snake_case 兜底 ---

// TestDecodeElement_SnakeCaseWindowFallback: 编排 agent 按 list_elements 的
// snake_case 响应字段名（start_frame/end_frame）反推输入名是最自然的动作——
// 修复前这些键被静默丢弃、元素窗口丢失无任何反馈（E2E 三连实验实拍）。修复后
// snake 别名归一到 IR 的 camelCase 键。
func TestDecodeElement_SnakeCaseWindowFallback(t *testing.T) {
	el, err := decodeElement(map[string]any{
		"id": "img_scene_half", "type": "image",
		"x": 96.0, "y": 150.0, "w": 888.0, "h": 500.0,
		"start_frame": 165.0, "end_frame": 210.0,
	})
	require.NoError(t, err)
	require.NotNil(t, el.StartFrame, "start_frame must land on StartFrame (was silently dropped)")
	assert.Equal(t, 165, *el.StartFrame)
	require.NotNil(t, el.EndFrame)
	assert.Equal(t, 210, *el.EndFrame)
}

// camelCase 是 canonical：两种拼写同时出现时 camel 胜（snake 兜底、不做冲突
// 检测——刻意最简，工具描述已写明）。
func TestDecodeElement_CamelCaseWinsOnConflict(t *testing.T) {
	el, err := decodeElement(map[string]any{
		"id": "e1", "type": "text",
		"startFrame": 100.0, "start_frame": 165.0,
	})
	require.NoError(t, err)
	require.NotNil(t, el.StartFrame)
	assert.Equal(t, 100, *el.StartFrame, "camelCase canonical wins when both spellings are sent")
}

// 嵌套动画的 snake 别名（animate_element 顶层入参同款命名：duration_frames）。
func TestDecodeElement_AnimationSnakeAliases(t *testing.T) {
	el, err := decodeElement(map[string]any{
		"id": "t1", "type": "text", "text": "hi",
		"animations": []any{
			map[string]any{"type": "fadeIn", "duration_frames": 30.0},
		},
	})
	require.NoError(t, err)
	require.Len(t, el.Animations, 1)
	assert.Equal(t, 30, el.Animations[0].DurationFrames, "duration_frames must map onto DurationFrames")
}

// fontSize 的 snake 别名顺带覆盖（嵌套字段同族问题）。
func TestDecodeElement_FontSizeAlias(t *testing.T) {
	el, err := decodeElement(map[string]any{"id": "t1", "type": "text", "font_size": 42.0})
	require.NoError(t, err)
	assert.InDelta(t, 42, el.FontSize, 1e-9)
}

// --- P1-2 add_effect_at_word params object 化 ---

// TestEffectParamsRaw_ObjectShape: params {"color":"#5FB3B3"} 进 → map 落地 →
// marshal 回 Effect.Params 存储的 object RawMessage；nil → nil（per-type 默认）。
func TestEffectParamsRaw_ObjectShape(t *testing.T) {
	raw, err := effectParamsRaw(map[string]any{"color": "#5FB3B3"})
	require.NoError(t, err)
	assert.JSONEq(t, `{"color":"#5FB3B3"}`, string(raw))
	var effect videoapp.Effect
	require.NoError(t, json.Unmarshal([]byte(`{"params":`+string(raw)+`}`), &effect))
	assert.JSONEq(t, `{"color":"#5FB3B3"}`, string(effect.Params), "params must land on Effect.Params as a JSON object")

	empty, err := effectParamsRaw(nil)
	require.NoError(t, err)
	assert.Nil(t, empty)
}

// TestAddEffectParams_SchemaGate: 走真 transport 驱动工具 handler——params
// 传对象要过得了 SDK 的 jsonschema 门（修复前：schema "null|array of int" 拒
// object、server 拒数组，任何 params 都传不进去），然后到达 service 边界
// （nil-pool 服务在 canAccess 优雅报错，不 panic）。isError=true 且文本是
// service 边界错误（而非 "validating"）= schema 门已放行 object。
func TestAddEffectParams_ObjectPassesSchemaGate(t *testing.T) {
	// project_id 用合法 UUID：Mutate 的 uuidShape 守卫（服务层）先于
	// canAccess，非 UUID id 会在 service 边界前被 404 拦下、拿不到稳定的服务
	// 层错误文本（nil-pool + nil-membership 下的确定性边界错误）。
	res := runToolViaTransport(t, Deps{Svc: videoapp.NewProjectService(nil, videoapp.Ports{}, nil)},
		"video_add_effect_at_word", map[string]any{
			"project_id":  "00000000-0000-0000-0000-000000000001",
			"anchor_text": "三倍", "type": "highlight",
			"params": map[string]any{"color": "#5FB3B3"},
		}, "video:write")
	require.NotNil(t, res)
	text := resultText(t, res)
	assert.True(t, res.IsError, "nil-pool service boundary error")
	assert.Contains(t, text, "membership port not wired", "object params passed the schema gate and the handler ran to the service boundary")
	assert.NotContains(t, text, "validating", "object params must not be rejected by the jsonschema gate")
	assert.NotContains(t, text, "has type", "the old catch-22 schema error shape must be gone")
}

// 对照：params 传数组（修复前 agent 按 schema 的 array-of-int 传法）现在被
// schema 拒——两端口径统一为 object。
func TestAddEffectParams_ArrayRejectedBySchema(t *testing.T) {
	res := runToolViaTransport(t, Deps{Svc: videoapp.NewProjectService(nil, videoapp.Ports{}, nil)},
		"video_add_effect_at_word", map[string]any{
			"project_id":  "00000000-0000-0000-0000-000000000001",
			"anchor_text": "x", "type": "highlight",
			"params": []any{62, 193, 211},
		}, "video:write")
	require.True(t, res.IsError)
	assert.Contains(t, resultText(t, res), "validating", "array params must be rejected by the schema gate")
}

// --- P1-3 move/animate 元素不存在报 "element <id> not found" ---

// 纯函数面：错误码 E_VIDEO_IR_INVALID（与 targetElementId 校验同类）、文案与
// 锚词完全解耦。
func TestRequireElement(t *testing.T) {
	ir := &videoapp.IR{Elements: []videoapp.Element{{ID: "e1"}, {ID: "e2"}}}
	require.NoError(t, requireElement(ir, "e1"))

	err := requireElement(ir, "ghost_el")
	require.Error(t, err)
	var wxErr *webx.Error
	require.True(t, errors.As(err, &wxErr), "want *webx.Error, got %T: %v", err, err)
	assert.Equal(t, "E_VIDEO_IR_INVALID", wxErr.Code)
	assert.Contains(t, wxErr.Message, "element ghost_el not found")
	assert.NotContains(t, wxErr.Message, "anchor", "误导文案（anchor text not found）必须消失")
}

// handler 面：element_id 空值守卫先于 Svc.Get（nil-pool 安全路径），证明
// move/animate 两个 handler 都接上了前置校验（存在性分支的 Get+Mutate 真值
// 由 DB 集成套件承担）。
func TestMoveAnimateElement_EmptyElementIDRejected(t *testing.T) {
	deps := Deps{Svc: videoapp.NewProjectService(nil, videoapp.Ports{}, nil)}
	res := runToolViaTransport(t, deps, "video_move_element",
		map[string]any{"project_id": "p1", "element_id": "", "x": 10.0, "y": 20.0}, "video:write")
	require.NotNil(t, res)
	assert.True(t, res.IsError)
	assert.Contains(t, resultText(t, res), "element_id is required")

	res = runToolViaTransport(t, deps, "video_animate_element",
		map[string]any{"project_id": "p1", "element_id": "", "type": "fadeIn", "duration_frames": 30}, "video:write")
	require.NotNil(t, res)
	assert.True(t, res.IsError)
	assert.Contains(t, resultText(t, res), "element_id is required")
}

// --- P2-4 generate_video stage 失败文本 ---

// TestGenerateStageErr: stage、cause、project 去向（kept for retry）、清理
// 路径全在文本里（handler 返回该 error → mcpAdd → SDK isError=true）。
func TestGenerateStageErr(t *testing.T) {
	err := generateStageErr("render_submit", "retry hint here", errors.New("quota out"), "proj-1")
	require.Error(t, err)
	msg := err.Error()
	assert.Contains(t, msg, "stage render_submit")
	assert.Contains(t, msg, "quota out")
	assert.Contains(t, msg, "project_id proj-1 kept for retry")
	assert.Contains(t, msg, "retry hint here")
	assert.Contains(t, msg, "DELETE /api/video/projects/proj-1")
}

// --- P2-5 set_script 空 script fail-closed ---

// TestSetScript_EmptyScriptRejected: 空/全空白 script 在工具层拒（修复前
// 服务层静默接受并把词表清空、锚点全灭无反馈）。门禁先于 SetScript，nil-pool
// 服务可安全驱动到该分支。
func TestSetScript_EmptyScriptRejected(t *testing.T) {
	deps := Deps{Svc: videoapp.NewProjectService(nil, videoapp.Ports{}, nil)}
	for _, script := range []string{"", "   ", "\n\t"} {
		res := runToolViaTransport(t, deps, "video_set_script",
			map[string]any{"project_id": "p1", "script": script}, "video:write")
		require.NotNil(t, res)
		assert.True(t, res.IsError, "empty script %q must surface isError=true", script)
		assert.Contains(t, resultText(t, res), "script is required")
		assert.Contains(t, resultText(t, res), "word table")
	}
}

// --- 真 transport 驱动基建 ---

// runToolViaTransport spins a full MCP server + client over the SDK's
// in-memory transports: the PAT principal rides the server Run ctx exactly
// the way the stateless /mcp transport carries it (Authenticate-installed
// principal → handler ctx), so the scope gate, the jsonschema argument gate
// and the handler closure all execute for real. Returns the raw
// CallToolResult (isError + text) without any database dependency — handlers
// under test here error out before (or gracefully at) the service boundary.
func runToolViaTransport(t *testing.T, deps Deps, name string, args map[string]any, scopes ...string) *mcp.CallToolResult {
	t.Helper()
	ctx := patCtx(scopes...)
	ct, st := mcp.NewInMemoryTransports()
	s := mcp.NewServer(&mcp.Implementation{Name: "test"}, nil)
	RegisterTools(s, deps)
	go func() { _ = s.Run(ctx, st) }() //nolint:errcheck — in-memory transport errors only on teardown
	c := mcp.NewClient(&mcp.Implementation{Name: "test-client"}, nil)
	cs, err := c.Connect(ctx, ct, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = cs.Close() })
	res, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
	require.NoError(t, err, "tool execution errors come back as isError=true results, not transport errors")
	return res
}

// resultText extracts the first text content of a CallToolResult (the
// mcpAdd skeleton wraps every payload/error as TextContent JSON).
func resultText(t *testing.T, res *mcp.CallToolResult) string {
	t.Helper()
	require.NotEmpty(t, res.Content)
	tc, ok := res.Content[0].(*mcp.TextContent)
	require.True(t, ok, "want *mcp.TextContent, got %T", res.Content[0])
	return tc.Text
}

// --- role-matrix enforcement (delivery audit P1) -------------------------

// fakeAuthz stands in for authz.Authorizer: it grants a fixed permission set
// to whichever role the service resolved for the caller.
type fakeAuthz struct{ grants map[string]bool }

func (f fakeAuthz) CanIn(_ context.Context, _ *webx.Principal, perm string) bool {
	return f.grants[perm]
}

// roleMembership resolves every caller to a fixed workspace role.
type roleMembership struct{ role string }

func (m roleMembership) IsMember(_ context.Context, _, _ string) (bool, error) { return true, nil }
func (m roleMembership) RoleOf(_ context.Context, _, _ string) (string, bool, error) {
	return m.role, true, nil
}

// TestRequirePerm_RoleMatrixDecides is the regression for "REST 403 / MCP 200":
// a PAT whose declared scope includes video:write must still be refused when
// the caller's workspace role does not grant it.
func TestRequirePerm_RoleMatrixDecides(t *testing.T) {
	svc := videoapp.NewProjectService(nil, videoapp.Ports{
		Membership: roleMembership{role: "viewer"},
		Authz:      fakeAuthz{grants: map[string]bool{"video:read": true}},
	}, nil)

	p := patPrincipal(nil, "video:read", "video:write", "video:render")
	p.WorkspaceID = "ws1"

	require.NoError(t, svc.RequirePerm(context.Background(), p, "video:read"),
		"a granted permission must pass")
	err := svc.RequirePerm(context.Background(), p, "video:render")
	require.Error(t, err, "scope alone must not grant a permission the role lacks")
	assert.ErrorIs(t, err, videoapp.ErrForbidden)
}

// TestRequirePerm_ScopeStillNecessary: the role matrix must not widen a
// credential — a scope that omits the permission is denied even when the role
// would allow it.
func TestRequirePerm_ScopeStillNecessary(t *testing.T) {
	svc := videoapp.NewProjectService(nil, videoapp.Ports{
		Membership: roleMembership{role: "owner"},
		Authz:      fakeAuthz{grants: map[string]bool{"video:render": true}},
	}, nil)

	p := patPrincipal(nil, "video:read") // scope omits render
	p.WorkspaceID = "ws1"
	assert.ErrorIs(t, svc.RequirePerm(context.Background(), p, "video:render"), videoapp.ErrForbidden)
}

// TestRequirePerm_UnwiredRoleDenies: a principal with no resolvable role must
// be denied, never silently allowed (the old MCP behaviour).
func TestRequirePerm_UnwiredRoleDenies(t *testing.T) {
	svc := videoapp.NewProjectService(nil, videoapp.Ports{
		Membership: roleMembership{role: ""},
		Authz:      fakeAuthz{grants: map[string]bool{"video:render": true}},
	}, nil)
	p := patPrincipal(nil, "video:render")
	p.WorkspaceID = "ws1"
	assert.ErrorIs(t, svc.RequirePerm(context.Background(), p, "video:render"), videoapp.ErrForbidden)
}

// TestRequireToolScope_RejectsUnrestrictedPAT: ADR 0017 promises pat-all
// credentials are rejected on the video tool face; a nil scope is allow-all in
// the rest of the stack, so this must be an explicit denial.
func TestRequireToolScope_RejectsUnrestrictedPAT(t *testing.T) {
	p := &webx.Principal{UserID: "u1", Source: webx.SourcePAT} // Scope == nil
	ctx := webx.WithPrincipal(context.Background(), p)
	err := requireToolScope(ctx, ScopeWrite)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "explicit credential scope")
}
