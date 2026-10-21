package main

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
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

// 资产清单接线（webx.AssetCacheManifest）：清单内的构建产物强缓存，清单外的
// 一律不碰。这条守的是"接线错到没用上清单"——接错时 Cache-Control 会整体消失
// （回落到裸 FileServer），而不是缓存错文件。
func TestFrontendUsesManifestForAssetCache(t *testing.T) {
	sub, err := fs.Sub(frontendFS, "frontend")
	if err != nil {
		t.Fatal(err)
	}
	files := buildAssetFiles(sub)
	if len(files) == 0 {
		t.Skip("embed 内无 .vite/manifest.json（前端未构建），清单路径由构建后验证")
	}

	var js string
	for _, f := range files {
		if strings.HasSuffix(f, ".js") {
			js = f
			break
		}
	}
	if js == "" {
		t.Fatal("manifest 应至少列出一个 js 产物")
	}

	resp := getFrontend(t, js)
	if resp.Code != http.StatusOK {
		t.Fatalf("%s 应 200, got %d", js, resp.Code)
	}
	if got := resp.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Errorf("清单内资源应强缓存, got %q", got)
	}
	if resp.Header().Get("ETag") == "" {
		t.Error("清单内资源应带 ETag")
	}

	// 不在清单里的路径（壳页 HTML 之外的真实文件，如 favicon）不加强缓存。
	unlisted := getFrontend(t, "/favicon.png")
	if cc := unlisted.Header().Get("Cache-Control"); strings.Contains(cc, "immutable") {
		t.Errorf("清单外文件不该被钉成 immutable, got %q", cc)
	}
}

// 清单读取失败时返回 nil（由 frontendHandler 回落到启发式），绝不 panic 或
// 让进程起不来：失去清单只损失缓存寿命，不影响正确性。
func TestBuildAssetFilesMissingManifestReturnsNil(t *testing.T) {
	empty := fstest.MapFS{}
	if got := buildAssetFiles(empty); got != nil {
		t.Errorf("无 manifest 应返回 nil, got %v", got)
	}
	bad := fstest.MapFS{".vite/manifest.json": {Data: []byte("not json")}}
	if got := buildAssetFiles(bad); got != nil {
		t.Errorf("非法 manifest 应返回 nil, got %v", got)
	}
}
