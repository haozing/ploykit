package main

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func getFrontend(t *testing.T, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	frontendHandler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

func TestFrontendAssetMissIs404(t *testing.T) {
	resp := getFrontend(t, "/assets/index-gone.css")
	if resp.Code != http.StatusNotFound {
		t.Errorf("缺失资产应 404, got %d", resp.Code)
	}
	if strings.Contains(resp.Body.String(), "<html") {
		t.Error("资产 404 不应回 HTML 壳页（200 假成功）")
	}

	resp = getFrontend(t, "/assets/whatever-placeholder.css")
	if resp.Code == http.StatusOK {
		t.Error("占位资产不应命中（本用例只守缺失语义，存在性由构建产物决定）")
	}
}

func TestFrontendClientRouteFallsBackToShell(t *testing.T) {
	if _, err := fs.ReadFile(frontendFS, "frontend/index.html"); err != nil {
		t.Skip("前端产物未构建（embed 内无 index.html），回壳行为由 make -C example build 后的本地/发布构建验证")
	}
	resp := getFrontend(t, "/settings/workspace/schedules")
	if resp.Code != http.StatusOK {
		t.Errorf("客户端路由应 200 回壳页, got %d", resp.Code)
	}
	if ct := resp.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Errorf("壳页 Content-Type = %q", ct)
	}
	if !strings.Contains(resp.Body.String(), "<div id=\"root\">") {
		t.Error("壳页应有 #root 挂载点")
	}
}
