package webx

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

// 端到端：真实组合（Gzip 外层 + AssetCacheManifest + Precompressed + FileServer）。
// 验证三层协作契约：br 命中时不叠 gzip、无 br 时 gzip 接管、两条路 Vary 恰好一份。
// 这条测试锁的是**层间协作**——单层测试各自全绿也可能在组合上断裂（比如
// FileServer 预设的 Content-Length 让 gzip 静默跳过，资产全部失去压缩）。
func TestE2EGzipPrecompressedStack(t *testing.T) {
	fsys := fstest.MapFS{
		"assets/app.js":    {Data: []byte(strings.Repeat("identity-payload ", 200))},
		"assets/app.js.br": {Data: []byte("BR-BODY")},
		"assets/no-br.js":  {Data: []byte(strings.Repeat("plain-payload ", 200))},
	}
	inner := Precompressed(fsys)(http.FileServer(http.FS(fsys)))
	h := Gzip(AssetCacheManifest(inner, []string{"assets/app.js", "assets/no-br.js"}))

	// brotli 客户端：Precompressed 回 br，Gzip 不得再叠。
	req := httptest.NewRequest(http.MethodGet, "/assets/app.js", nil)
	req.Header.Set("Accept-Encoding", "gzip, br")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if enc := rec.Header().Get("Content-Encoding"); enc != "br" {
		t.Fatalf("br 客户端应得 br, got %q", enc)
	}

	// 只接受 gzip 的客户端：无 sidecar → FileServer 原样（预设 Content-Length）
	// → Gzip 接管（Content-Length 被压缩长度替换）。
	req2 := httptest.NewRequest(http.MethodGet, "/assets/no-br.js", nil)
	req2.Header.Set("Accept-Encoding", "gzip")
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req2)
	if enc := rec2.Header().Get("Content-Encoding"); enc != "gzip" {
		t.Fatalf("gzip-only 客户端应得 gzip, got %q", enc)
	}
	zr, err := gzip.NewReader(rec2.Body)
	if err != nil {
		t.Fatalf("应为合法 gzip: %v", err)
	}
	got, _ := io.ReadAll(zr)
	if !strings.HasPrefix(string(got), "plain-payload") {
		t.Errorf("解压内容不符")
	}

	// 两条路的 Vary 都恰好一份。
	for name, r := range map[string]*httptest.ResponseRecorder{"br": rec, "gzip": rec2} {
		count := 0
		for _, v := range r.Header().Values("Vary") {
			for _, p := range strings.Split(v, ",") {
				if strings.EqualFold(strings.TrimSpace(p), "Accept-Encoding") {
					count++
				}
			}
		}
		if count != 1 {
			t.Errorf("%s 路径 Vary 应恰好一份, got %d", name, count)
		}
	}
}
