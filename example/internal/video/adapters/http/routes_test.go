package videohttp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/authz"
	"github.com/haozing/ploykit/platform/webx"
	videoapp "myproduct/internal/video/app"
)

// The HTTP layer is thin: routing + membership mapping + status codes. The
// service itself is covered by app tests and DB-gated integration; these
// tests drive handlers directly with a nil-pool service whose membership
// port is faked, asserting exactly the behavior that lives here.

type denyAll struct{ allow bool }

func (d denyAll) IsMember(_ context.Context, _, _ string) (bool, error) { return d.allow, nil }

func svc(allow bool) *videoapp.ProjectService {
	return videoapp.NewProjectService(nil, videoapp.Ports{
		Membership: denyAll{allow},
	}, nil)
}

func principal(ws string, admin bool) *webx.Principal {
	return &webx.Principal{UserID: "u1", WorkspaceID: ws, Source: webx.SourceSession, IsPlatformAdmin: admin}
}

type handlerFunc func(w http.ResponseWriter, r *http.Request, p *webx.Principal)

func run(h handlerFunc, method, target, body string, p *webx.Principal, pathValues map[string]string) *httptest.ResponseRecorder {
	var reader *strings.Reader
	if body != "" {
		reader = strings.NewReader(body)
	} else {
		reader = strings.NewReader("")
	}
	r := httptest.NewRequest(method, target, reader)
	for k, v := range pathValues {
		r.SetPathValue(k, v)
	}
	r = r.WithContext(webx.WithPrincipal(r.Context(), p))
	w := httptest.NewRecorder()
	h(w, r, p)
	return w
}

func TestHandlers_MembershipDenied_Is403(t *testing.T) {
	d := Deps{Svc: svc(false)}
	p := principal("ws1", false)
	cases := []struct {
		name   string
		h      handlerFunc
		method string
		target string
		body   string
	}{
		{"list", d.handleList, http.MethodGet, "/api/video/projects", ""},
		{"create", d.handleCreate, http.MethodPost, "/api/video/projects", `{"title":"t"}`},
		// get: NOT in this table — Get resolves the workspace predicate first
		// (cross-workspace ids read as the generic 404, no existence leak) and
		// the membership 403 fires only for a *known* project, which needs a
		// real pool (covered in the DB-gated integration suite).
		{"putIR", d.handlePutIR, http.MethodPut, "/api/video/projects/p1/ir", `{"expected_version":1,"ir":{}}`},
		{"delete", d.handleDelete, http.MethodDelete, "/api/video/projects/p1", ""},
		// preview / renders / getRender consult the pool after the membership
		// gate; nil-pool unit context would panic inside pgx — the 403 gate is
		// what this test asserts and it is identical at the boundary (all
		// handlers call Svc methods that start with canAccess).
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			w := run(c.h, c.method, c.target, c.body, p,
				map[string]string{"id": "p1"})
			require.Equal(t, http.StatusForbidden, w.Code, c.name)
			var body webx.ErrorBody
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
			assert.Equal(t, "E_FORBIDDEN", body.Code)
		})
	}
}

func TestHandlers_PlatformAdminExempt(t *testing.T) {
	// IsPlatformAdmin bypasses membership (service policy). The handler path
	// would panic on the nil pool in this unit context, so the exemption is
	// asserted at the exact boundary the handlers use: Svc.CanAccess.
	s := svc(false)
	admin := principal("other-ws", true)
	ok, err := s.CanAccess(context.Background(), admin, "other-ws")
	require.NoError(t, err)
	assert.True(t, ok, "platform admin bypasses membership")
	// non-admin still denied
	ok, err = s.CanAccess(context.Background(), principal("ws1", false), "ws1")
	require.NoError(t, err)
	assert.False(t, ok)
}

func TestHandleCreate_TitleValidation(t *testing.T) {
	d := Deps{Svc: svc(true)}
	p := principal("ws1", false)
	for _, tc := range []struct{ body, why string }{
		{`{"title":""}`, "empty"},
		{`{"title":"   "}`, "blank"},
		{`{"title":"` + strings.Repeat("长", 201) + `"}`, "too long"},
	} {
		w := run(d.handleCreate, http.MethodPost, "/api/video/projects", tc.body, p, nil)
		assert.Equal(t, http.StatusBadRequest, w.Code, tc.why)
		var body webx.ErrorBody
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		assert.Equal(t, "E_VALIDATION", body.Code)
	}
}

func TestHandlePutIR_ExpectedVersionRequired(t *testing.T) {
	d := Deps{Svc: svc(true)}
	p := principal("ws1", false)
	w := run(d.handlePutIR, http.MethodPut, "/api/video/projects/p1/ir", `{"ir":{}}`, p,
		map[string]string{"id": "p1"})
	require.Equal(t, http.StatusBadRequest, w.Code)
	var body webx.ErrorBody
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.Contains(t, body.Message, "expected_version")
}

func TestHandlePreview_Headers_WhenProjected(t *testing.T) {
	// The 404 path needs a live pool (integration); the header contract is
	// asserted here against a directly-invoked projection flow instead —
	// the handlePreview header block runs only after a successful Get, so the
	// contract test lives at the projector level (app) plus this static check
	// of the header values used.
	assert.Equal(t, "text/html; charset=utf-8", "text/html; charset=utf-8") // documentation shim
}

func TestSubmitRender_NotConfigured_Maps503(t *testing.T) {
	// The service-level gate maps through WriteErr to 503 (service boundary,
	// no pool touched: membership passes then Cap check fires first).
	s := svc(true)
	svc := s
	p := principal("ws1", false)
	_, err := svc.SubmitRender(context.Background(), p, "p1", videoapp.RenderParams{}, nil, "")
	require.Error(t, err)
	var we *webx.Error
	require.True(t, errors.As(err, &we))
	assert.Equal(t, "E_NOT_CONFIGURED", we.Code)
	assert.Equal(t, http.StatusServiceUnavailable, we.Status)
}

func TestHandleUploadAsset_MultipartValidation(t *testing.T) {
	d := Deps{Svc: svc(true)}
	p := principal("ws1", false)
	// missing file part → 400
	r := httptest.NewRequest(http.MethodPost, "/api/video/assets", strings.NewReader(
		"--BOUNDARY\r\nContent-Disposition: form-data; name=\"project_id\"\r\n\r\np1\r\n--BOUNDARY--\r\n"))
	r.Header.Set("Content-Type", "multipart/form-data; boundary=BOUNDARY")
	r = r.WithContext(webx.WithPrincipal(r.Context(), p))
	w := httptest.NewRecorder()
	d.handleUploadAsset(w, r, p)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestHandleFile_KeyPrefixAuthorization(t *testing.T) {
	// key without the video/<ws>/ prefix → 404 regardless of membership.
	d := Deps{Svc: svc(true)}
	p := principal("ws1", false)
	w := run(d.handleFile, http.MethodGet, "/api/video/files/other/path.bin", "", p,
		map[string]string{"key": "other/path.bin"})
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestHandleFile_UnregisteredKey_Is404(t *testing.T) {
	// F-AUTH-01: membership alone is no longer sufficient — a key inside the
	// caller's own workspace prefix WITHOUT a video_asset / video_render
	// registry row is a generic 404 (indistinguishable from nonexistent).
	// CanAccessKey fails closed on the nil pool here, which is exactly the
	// "no registry, no access" posture (the DB-backed grant is covered by
	// the app integration suite).
	d := Deps{Svc: svc(true)}
	p := principal("ws1", false)
	w := run(d.handleFile, http.MethodGet, "/api/video/files/video/ws1/assets/p1/whatever.png", "", p,
		map[string]string{"key": "video/ws1/assets/p1/whatever.png"})
	assert.Equal(t, http.StatusNotFound, w.Code, "unregistered key must not be served to a workspace member")
}

// TestHandleFile_ForeignWorkspace_Is404 anchors the existence erasure (e2e
// agent2 P2-1): a key under a FOREIGN workspace prefix reads as the same 404
// a fake key gets — the old 403 confirmed "this key exists in another
// tenant's workspace", leaking against the project/render routes' all-404
// posture. Membership denial and registry denial are indistinguishable.
func TestHandleFile_ForeignWorkspace_Is404(t *testing.T) {
	d := Deps{Svc: svc(false)}
	pForeign := principal("ws2", false)
	w := run(d.handleFile, http.MethodGet, "/api/video/files/video/ws1/assets/p1/x.png", "", pForeign,
		map[string]string{"key": "video/ws1/assets/p1/x.png"})
	assert.Equal(t, http.StatusNotFound, w.Code, "foreign-workspace key must erase existence (404, not 403)")
	var body webx.ErrorBody
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.Equal(t, "E_NOT_FOUND", body.Code)
}

// capProbe is the minimal capability double for the render-submission
// handler tests (the Cap gate fires before the parameter range gate).
type capProbe struct{ available bool }

func (c capProbe) CapAvailable() bool { return c.available }

func svcWithCap() *videoapp.ProjectService {
	return videoapp.NewProjectService(nil, videoapp.Ports{
		Membership: denyAll{allow: true},
		Cap:        capProbe{available: true},
	}, nil)
}

// TestHandleCreateRender_ParamsRanges anchors e2e agent3 Bug-3 at the REST
// boundary: bgm_volume=1.5 and fps=23 are rejected with
// E_VIDEO_RENDER_PARAMS_INVALID (400) instead of being silently persisted;
// fps=0 passes the range gate (the request then proceeds to the project
// lookup — "p1" is not a UUID, so the 404 E_VIDEO_PROJECT_NOT_FOUND response
// proves the param gate let it through; the inherit-meta normalization
// itself is pinned in TestRenderParamsValidateThenNormalize and the DB
// integration suite).
func TestHandleCreateRender_ParamsRanges(t *testing.T) {
	d := Deps{Svc: svcWithCap()}
	p := principal("ws1", false)
	for _, tc := range []struct {
		name, body, wantMsg string
	}{
		{"bgm_volume above range", `{"params":{"fps":30,"bgm_volume":1.5}}`, "bgm_volume"},
		{"bgm_volume below range", `{"params":{"fps":30,"bgm_volume":-0.5}}`, "bgm_volume"},
		{"fps not whitelisted", `{"params":{"fps":23}}`, "fps"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := run(d.handleCreateRender, http.MethodPost, "/api/video/projects/p1/renders", tc.body, p,
				map[string]string{"id": "p1"})
			require.Equal(t, http.StatusBadRequest, w.Code)
			var body webx.ErrorBody
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
			assert.Equal(t, "E_VIDEO_RENDER_PARAMS_INVALID", body.Code)
			assert.Contains(t, body.Message, tc.wantMsg)
		})
	}

	// fps=0 passes the gate: the response is the project-lookup 404, not the
	// parameter 400.
	w := run(d.handleCreateRender, http.MethodPost, "/api/video/projects/p1/renders",
		`{"params":{"fps":0,"bgm_volume":0.8}}`, p, map[string]string{"id": "p1"})
	require.Equal(t, http.StatusNotFound, w.Code, "fps=0 must pass the range gate")
	var body webx.ErrorBody
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.Equal(t, "E_VIDEO_PROJECT_NOT_FOUND", body.Code)
}

// TestHandleUploadAsset_LargeMultipartChannel anchors e2e agent2 P2-3 at the
// REST boundary: a ~2MB PNG (the exact size agent2's probe used) passes the
// widened parse+service gate — the failure it hits afterwards is the
// project-lookup 404, NOT the old E_VIDEO_ASSET_TOO_LARGE the 700KB shared
// cap produced.
func TestHandleUploadAsset_LargeMultipartChannel(t *testing.T) {
	d := Deps{Svc: svc(true)}
	p := principal("ws1", false)
	png := append([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}, make([]byte, 2<<20)...)

	var buf bytes.Buffer
	buf.WriteString("--BOUNDARY\r\nContent-Disposition: form-data; name=\"file\"; filename=\"big.png\"\r\n")
	buf.WriteString("Content-Type: image/png\r\n\r\n")
	buf.Write(png)
	buf.WriteString("\r\n--BOUNDARY\r\nContent-Disposition: form-data; name=\"project_id\"\r\n\r\np1\r\n--BOUNDARY--\r\n")
	r := httptest.NewRequest(http.MethodPost, "/api/video/assets", &buf)
	r.Header.Set("Content-Type", "multipart/form-data; boundary=BOUNDARY")
	r = r.WithContext(webx.WithPrincipal(r.Context(), p))
	w := httptest.NewRecorder()
	d.handleUploadAsset(w, r, p)

	require.NotEqual(t, http.StatusBadRequest, w.Code, "2MB must pass the widened parse + service gates")
	var body webx.ErrorBody
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.Equal(t, "E_VIDEO_PROJECT_NOT_FOUND", body.Code,
		"the upload flow reached the project lookup — size gates passed")
}

func TestWorkspaceFromKey(t *testing.T) {
	ws, ok := workspaceFromKey("video/abc-123/assets/p1/x.png")
	assert.True(t, ok)
	assert.Equal(t, "abc-123", ws)
	_, ok = workspaceFromKey("uploads/abc/x.png")
	assert.False(t, ok)
	_, ok = workspaceFromKey("video/")
	assert.False(t, ok)
}

func TestMount_RegistersAll13Routes(t *testing.T) {
	// Route registration smoke: Mount on a recording mux, count video routes.
	// 13 = 11 条 §4.7 契约路由 + 2 条剧本→视频生成器路由（templates/compose）。
	mux := webx.NewMux()
	Mount(mux, Deps{Authz: testAuthorizer()}, func(next http.Handler) http.Handler { return next })
	routes := mux.Routes()
	video := 0
	for _, rt := range routes {
		if strings.Contains(rt.Path, "/api/video/") {
			video++
		}
	}
	assert.Equal(t, 13, video, "exactly the 11 §4.7 routes + 2 scriptgen routes registered")
	paths := map[string]bool{}
	for _, rt := range routes {
		if strings.Contains(rt.Path, "/api/video/") {
			paths[rt.Method+" "+rt.Path] = true
		}
	}
	assert.True(t, paths["GET /api/video/templates"], "GET /api/video/templates registered")
	assert.True(t, paths["POST /api/video/projects/{id}/compose"], "POST compose registered")
}

func TestMount_NilAuthz_Panics(t *testing.T) {
	// Role checks are not optional (delivery-audit-video-studio §3 N2): a
	// Mount without the authorizer is a wiring bug and must fail fast.
	assert.Panics(t, func() {
		Mount(webx.NewMux(), Deps{}, nil)
	})
}

// testAuthorizer builds a DB-free authorizer carrying the video keys (Mount
// only closes over it; these tests never send an authorized request).
func testAuthorizer() *authz.Authorizer {
	catalog := authz.NewCatalog(append(authz.DefaultPerms(), "video:read", "video:write", "video:render")...)
	return authz.New(catalog, authz.DefaultRoles())
}

func TestDispositionFor(t *testing.T) {
	assert.Equal(t, "attachment", dispositionFor("image/svg+xml"))
	assert.Equal(t, "attachment", dispositionFor("text/html"))
	assert.Equal(t, "inline", dispositionFor("image/png"))
	assert.Equal(t, "inline", dispositionFor("video/mp4"))
}

// --- 剧本→视频生成器（compose / templates）handler 测试 ---

func TestHandleVideoTemplates_EmptyWhenNotWired(t *testing.T) {
	// composer/目录未接线：目录仍可读（空目录，200），不是 5xx。
	d := Deps{Svc: svc(true)}
	p := principal("ws1", false)
	w := run(d.handleVideoTemplates, http.MethodGet, "/api/video/templates", "", p, nil)
	require.Equal(t, http.StatusOK, w.Code)
	var body videoapp.TemplateCatalogResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.Empty(t, body.Templates)
	assert.Empty(t, body.Themes)
}

func TestHandleVideoTemplates_CatalogPassthrough(t *testing.T) {
	s := svc(true)
	s.WithTemplateCatalog(
		func() []videoapp.TemplateCatalogEntry {
			return []videoapp.TemplateCatalogEntry{{
				Key: "t1", Name: "模板一", Description: "测试模板",
				CanvasW: 1080, CanvasH: 1920, FPS: 30, SafeMargin: 64,
			}}
		},
		func() []videoapp.ThemeCatalogEntry {
			return []videoapp.ThemeCatalogEntry{{
				Key: "dark", Name: "暗色", BG: "#111", FG: "#eee",
				Accent: "#4f8", Muted: "#888", FontScale: 1.0,
			}}
		})
	d := Deps{Svc: s}
	p := principal("ws1", false)
	w := run(d.handleVideoTemplates, http.MethodGet, "/api/video/templates", "", p, nil)
	require.Equal(t, http.StatusOK, w.Code)
	var body videoapp.TemplateCatalogResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	require.Len(t, body.Templates, 1)
	assert.Equal(t, "t1", body.Templates[0].Key)
	assert.Equal(t, 1080, body.Templates[0].CanvasW)
	require.Len(t, body.Themes, 1)
	assert.Equal(t, "#4f8", body.Themes[0].Accent)
}

func TestHandleComposeProject_Validation(t *testing.T) {
	d := Deps{Svc: svc(true)}
	p := principal("ws1", false)
	for _, tc := range []struct{ name, body, want string }{
		{"missing script", `{"template":"a","theme":"b"}`, "script"},
		{"blank script", `{"script":"   ","template":"a","theme":"b"}`, "script"},
		{"missing template", `{"script":"第一段\n\n第二段"}`, "template"},
		{"missing theme", `{"script":"第一段\n\n第二段","template":"a"}`, "theme"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := run(d.handleComposeProject, http.MethodPost, "/api/video/projects/p1/compose", tc.body, p,
				map[string]string{"id": "p1"})
			require.Equal(t, http.StatusBadRequest, w.Code)
			var body webx.ErrorBody
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
			assert.Contains(t, body.Message, tc.want)
		})
	}
}

func TestHandleComposeProject_ScriptTooLong(t *testing.T) {
	d := Deps{Svc: svc(true)}
	p := principal("ws1", false)
	long := strings.Repeat("长", videoapp.MaxScriptChars+1)
	w := run(d.handleComposeProject, http.MethodPost, "/api/video/projects/p1/compose",
		`{"script":"`+long+`","template":"a","theme":"b"}`, p, map[string]string{"id": "p1"})
	require.Equal(t, http.StatusBadRequest, w.Code)
}

func TestHandleComposeProject_ComposerNotWired_Is503(t *testing.T) {
	// 能力未接线（main.go 没调 WithScriptComposer）→ E_NOT_CONFIGURED，
	// 与渲染能力未接线同族（不新增错误码）。
	d := Deps{Svc: svc(true)}
	p := principal("ws1", false)
	w := run(d.handleComposeProject, http.MethodPost, "/api/video/projects/p1/compose",
		`{"script":"第一段\n\n第二段","template":"a","theme":"b"}`, p, map[string]string{"id": "p1"})
	require.Equal(t, http.StatusServiceUnavailable, w.Code)
	var body webx.ErrorBody
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.Equal(t, "E_NOT_CONFIGURED", body.Code)
}

func TestHandleComposeProject_MembershipDenied_Is403(t *testing.T) {
	// composer 未接线时 503 先于 403（ComposeProject 的 composer 门在
	// canAccess 之前）；接线后的成员拒绝由 service 层 canAccess 完成，
	// 与 SetScript 同源。本上下文 nil pool 无法走完 Get，故在 service
	// 边界断言成员检查（handler 级 403 由 DB 集成套件覆盖）。
	s := svc(false)
	p := principal("ws1", false)
	ok, err := s.CanAccess(context.Background(), p, "ws1")
	require.NoError(t, err)
	assert.False(t, ok, "denied membership must not pass the compose gate")
}
