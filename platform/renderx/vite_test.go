package renderx

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
)

const viteManifestFixture = `{
  "index.html": {
    "file": "assets/index-BkRMhVq3.js",
    "name": "index",
    "src": "index.html",
    "isEntry": true,
    "css": ["assets/index-C8lOYtLb.css", "assets/vendor-DXabE1f2.css"],
    "assets": ["assets/logo-CKqXXN1c.png"],
    "imports": []
  },
  "admin.html": {
    "file": "assets/admin-x9YzK2pQ.js",
    "name": "admin",
    "src": "admin.html",
    "isEntry": true,
    "css": ["assets/admin-Qw3rTy9u.css"]
  },
  "src/entry-client.tsx": {
    "file": "assets/entry-client-DxabdE1E.js",
    "name": "entry-client",
    "src": "src/entry-client.tsx",
    "isEntry": false
  }
}`

func TestParseViteManifest(t *testing.T) {
	t.Run("正常入口含 CSS 数组", func(t *testing.T) {
		got, err := ParseViteManifest([]byte(viteManifestFixture), "")
		if err != nil {
			t.Fatalf("ParseViteManifest: %v", err)
		}

		want := ViteAssets{
			JS:  []string{"/assets/index-BkRMhVq3.js"},
			CSS: []string{"/assets/index-C8lOYtLb.css", "/assets/vendor-DXabE1f2.css"},
		}
		if got.JS[0] != want.JS[0] || len(got.JS) != 1 {
			t.Errorf("JS = %v, want %v", got.JS, want.JS)
		}
		if len(got.CSS) != len(want.CSS) {
			t.Fatalf("CSS = %v, want %v", got.CSS, want.CSS)
		}
		for i := range want.CSS {
			if got.CSS[i] != want.CSS[i] {
				t.Errorf("CSS[%d] = %q, want %q", i, got.CSS[i], want.CSS[i])
			}
		}
	})

	t.Run("自定义 entryKey", func(t *testing.T) {
		got, err := ParseViteManifest([]byte(viteManifestFixture), "admin.html")
		if err != nil {
			t.Fatalf("ParseViteManifest(admin.html): %v", err)
		}
		if got.JS[0] != "/assets/admin-x9YzK2pQ.js" {
			t.Errorf("JS = %v, want [/assets/admin-x9YzK2pQ.js]", got.JS)
		}
		if len(got.CSS) != 1 || got.CSS[0] != "/assets/admin-Qw3rTy9u.css" {
			t.Errorf("CSS = %v, want [/assets/admin-Qw3rTy9u.css]", got.CSS)
		}
	})

	t.Run("缺入口键报可操作错误", func(t *testing.T) {

		_, err := ParseViteManifest([]byte(viteManifestFixture), "other.html")
		if err == nil {
			t.Fatal("缺入口键应报错")
		}
		for _, want := range []string{"other.html", "vite build"} {
			if !strings.Contains(err.Error(), want) {
				t.Errorf("错误信息缺 %q: %v", want, err)
			}
		}

		_, err = ParseViteManifest([]byte(`{"src/entry-client.tsx":{"file":"assets/e.js"}}`), "")
		if err == nil {
			t.Fatal("缺省入口键缺失应报错")
		}
		if !strings.Contains(err.Error(), `"index.html"`) || !strings.Contains(err.Error(), "vite build") {
			t.Errorf("缺省键错误信息不含入口键名/vite build 指引: %v", err)
		}
	})

	t.Run("坏 JSON", func(t *testing.T) {
		if _, err := ParseViteManifest([]byte(`{"index.html":`), ""); err == nil {
			t.Fatal("坏 JSON 应报错")
		}
	})
}

func TestViteBuildID(t *testing.T) {
	data := []byte(viteManifestFixture)

	id1, id2 := ViteBuildID(data), ViteBuildID(data)
	if id1 != id2 {
		t.Errorf("同输入 BuildID 不稳定: %q vs %q", id1, id2)
	}
	if len(id1) != 64 {
		t.Errorf("BuildID 应为 sha256 hex（64 字符），得 %d 字符: %q", len(id1), id1)
	}

	mutated := strings.Replace(viteManifestFixture, "index-BkRMhVq3", "index-BkRMhVq4", 1)
	if mutated == viteManifestFixture {
		t.Fatal("fixture 变异失败：未发生单字符变化")
	}
	if id3 := ViteBuildID([]byte(mutated)); id3 == id1 {
		t.Errorf("单字符变化后 BuildID 未换代: %q", id3)
	}

	h := sha256.New()
	h.Write([]byte(OutputVersion))
	h.Write([]byte{0})
	h.Write(data)
	if want := hex.EncodeToString(h.Sum(nil)); id1 != want {
		t.Errorf("BuildID 前像应含 OutputVersion: got %q want %q", id1, want)
	}
	if OutputVersion == "" {
		t.Fatal("OutputVersion 不能为空")
	}
}

// ViteManifestFiles 是 AssetCacheManifest 的数据来源：它必须列出构建产出的
// **全部**资源，且只列这些。少一个 → 那个资源失去长缓存；多一个（或宽松匹配）
// → 把不可替换的路径钉成 immutable。
func TestViteManifestFiles(t *testing.T) {
	data := []byte(`{
	  "index.html": {"file": "assets/index-abc12345.js", "css": ["assets/index-abc12345.css"]},
	  "src/app.tsx": {"file": "assets/app-def67890.js", "css": []},
	  "node_modules/x/f.woff2": {"file": "assets/f-ghi13579.woff2"}
	}`)
	files, err := ViteManifestFiles(data)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		"/assets/app-def67890.js",
		"/assets/f-ghi13579.woff2",
		"/assets/index-abc12345.css",
		"/assets/index-abc12345.js",
	}
	if len(files) != len(want) {
		t.Fatalf("got %v, want %v", files, want)
	}
	for i := range want {
		if files[i] != want[i] {
			t.Errorf("[%d] got %q, want %q", i, files[i], want[i])
		}
	}
}

func TestViteManifestFilesDedupesAndToleratesSlash(t *testing.T) {
	// 同一个 CSS 既可能出现在入口的 css 里，也可能被多个 chunk 引用。
	data := []byte(`{
	  "a": {"file": "assets/x-abc12345.js", "css": ["assets/shared-def67890.css"]},
	  "b": {"file": "/assets/y-ghi13579.js", "css": ["/assets/shared-def67890.css"]}
	}`)
	files, err := ViteManifestFiles(data)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 3 {
		t.Fatalf("重复条目应去重且斜杠归一, got %v", files)
	}
	for _, f := range files {
		if !strings.HasPrefix(f, "/") || strings.HasPrefix(f, "//") {
			t.Errorf("路径应恰好一个前导斜杠: %q", f)
		}
	}
}

func TestViteManifestFilesRejectsBadJSON(t *testing.T) {
	if _, err := ViteManifestFiles([]byte("not json")); err == nil {
		t.Fatal("非法 JSON 应报错")
	}
}
