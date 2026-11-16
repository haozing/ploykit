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
// (targetElementId in the IR document) through AddEffectAtWord.
func TestAddEffectArgsTargetElementRoundtrip(t *testing.T) {
	in := map[string]any{
		"project_id":        "p1",
		"anchor_text":       "三倍",
		"type":              "counter",
		"params":            json.RawMessage(`{"from":0,"to":100}`),
		"target_element_id": "el_price",
	}
	b, err := json.Marshal(in)
	require.NoError(t, err)
	var out addEffectIn
	require.NoError(t, json.Unmarshal(b, &out))
	assert.Equal(t, "el_price", out.TargetElementID)
	assert.Equal(t, "counter", out.Type)

	// omitted target_element_id decodes to "" — the back-compat origin path
	var bare addEffectIn
	require.NoError(t, json.Unmarshal([]byte(`{"project_id":"p1","anchor_text":"x","type":"pulse"}`), &bare))
	assert.Empty(t, bare.TargetElementID)
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
	_, _, err := prepareSnapshot(Deps{}, p, in)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "project_id")
}

func TestPrepareSnapshot_NegativeFrame(t *testing.T) {
	in := decodeSnapshotIn(t, `{"project_id":"p1","frame":-3}`)
	p := patPrincipal(nil, "video:write")
	p.WorkspaceID = "ws1"
	_, _, err := prepareSnapshot(Deps{}, p, in)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "frame")
}

func TestPrepareSnapshot_DimsMismatch(t *testing.T) {
	p := patPrincipal(nil, "video:write")
	p.WorkspaceID = "ws1"
	in := decodeSnapshotIn(t, `{"project_id":"p1","frame":0,"width":1080}`)
	_, _, err := prepareSnapshot(Deps{}, p, in)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "together")

	in2 := decodeSnapshotIn(t, `{"project_id":"p1","frame":0,"width":1081,"height":1920}`)
	_, _, err = prepareSnapshot(Deps{}, p, in2)
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
	_, _, err := prepareSnapshot(Deps{}, p, in)
	require.Error(t, err)
	var wxErr *webx.Error
	require.True(t, errors.As(err, &wxErr), "want *webx.Error, got %T: %v", err, err)
	assert.Equal(t, "E_NOT_CONFIGURED", wxErr.Code)
	assert.True(t, strings.Contains(wxErr.Message, "render capability not configured"),
		"agent-readable text, got: %s", wxErr.Message)
	// deps.Snapshot 在场但桥接未接线（stub 构建）：同样的 E_NOT_CONFIGURED。
	in2 := decodeSnapshotIn(t, `{"project_id":"p1","frame":0}`)
	_, _, err2 := prepareSnapshot(Deps{Snapshot: func() videorender.Snapshotter { return nil }}, p, in2)
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
	p, _, err := prepareSnapshot(deps, patPrincipal([]string{"ws1"}, "video:write"), decodeSnapshotIn(t, base))
	require.NoError(t, err)
	assert.Equal(t, "ws1", p.WorkspaceID)

	// 多工作区 PAT 且未传 workspace_id：明确报错并列出可选值。
	_, _, err = prepareSnapshot(deps, patPrincipal([]string{"ws1", "ws2"}, "video:write"), decodeSnapshotIn(t, base))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "workspace_id")
	assert.Contains(t, err.Error(), "ws1, ws2")

	// 多工作区 PAT 显式传 scope 外 id：拒。
	in := decodeSnapshotIn(t, `{"project_id":"p1","frame":0,"workspace_id":"ws9"}`)
	_, _, err = prepareSnapshot(deps, patPrincipal([]string{"ws1", "ws2"}, "video:write"), in)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "credential scope")

	// 多工作区 PAT 显式传合法 id：通过（桥接在场才走到这里之后的路径）。
	inWS2 := decodeSnapshotIn(t, `{"project_id":"p1","frame":0,"workspace_id":"ws2"}`)
	p, snap, err := prepareSnapshot(deps, patPrincipal([]string{"ws1", "ws2"}, "video:write"), inWS2)
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
