package webx

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func patPrincipal(perms []string, wsIDs []string, wsID string) *Principal {
	p := &Principal{
		UserID:      "u-pat",
		Source:      SourcePAT,
		WorkspaceID: wsID,
	}
	if perms != nil || wsIDs != nil {
		p.Scope = &CredentialScope{Permissions: perms, WorkspaceIDs: wsIDs}
	}
	return p
}

func reqWithPrincipal(p *Principal) *http.Request {
	r := httptest.NewRequest(http.MethodPost, "/mcp", nil)
	return r.WithContext(WithPrincipal(context.Background(), p))
}

func TestRequireScope_PATCHandSession(t *testing.T) {
	h := RequireScope("post:submit")(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// 范围内 PAT：放行
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithPrincipal(patPrincipal([]string{"post:submit"}, nil, "")))
	assert.Equal(t, http.StatusOK, rec.Code)

	// 通配 PAT：放行
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithPrincipal(patPrincipal([]string{"post:*"}, nil, "")))
	assert.Equal(t, http.StatusOK, rec.Code)

	// 范围外 PAT：403（修复前此处静默放行——scope enforcement 断层）
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithPrincipal(patPrincipal([]string{"read:only"}, nil, "")))
	assert.Equal(t, http.StatusForbidden, rec.Code)

	// 无 scope PAT（nil = 不受限）：放行
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithPrincipal(patPrincipal(nil, nil, "")))
	assert.Equal(t, http.StatusOK, rec.Code)

	// 会话身份不受 scope 约束：放行
	sess := &Principal{UserID: "u-human", Source: SourceSession}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithPrincipal(sess))
	assert.Equal(t, http.StatusOK, rec.Code)

	// 匿名（无 Principal）：放行——认证是 Authenticate 的职责，这里只管 PAT scope
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/mcp", nil))
	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestRequireScope_MultiRequirementAllOrNothing(t *testing.T) {
	h := RequireScope("post:submit", "notify:send")(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithPrincipal(patPrincipal([]string{"post:submit"}, nil, "")))
	assert.Equal(t, http.StatusForbidden, rec.Code, "缺任一所需权限域即拒")
}

func TestRequireWorkspaceScope_FixedContext(t *testing.T) {
	h := RequireWorkspaceScope()(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Principal.WorkspaceID 命中声明清单：放行
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithPrincipal(patPrincipal(nil, []string{"ws-1"}, "ws-1")))
	assert.Equal(t, http.StatusOK, rec.Code)

	// 未命中：403
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithPrincipal(patPrincipal(nil, []string{"ws-1"}, "ws-2")))
	assert.Equal(t, http.StatusForbidden, rec.Code)

	// Principal 无工作区时回落 X-Workspace-Id 头
	r := httptest.NewRequest(http.MethodPost, "/mcp", nil)
	r.Header.Set("X-Workspace-Id", "ws-1")
	r = r.WithContext(WithPrincipal(context.Background(), patPrincipal(nil, []string{"ws-1"}, "")))
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	assert.Equal(t, http.StatusOK, rec.Code)

	// 会话不受约束
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithPrincipal(&Principal{UserID: "u-human", Source: SourceSession, WorkspaceID: "ws-2"}))
	assert.Equal(t, http.StatusOK, rec.Code)
}
