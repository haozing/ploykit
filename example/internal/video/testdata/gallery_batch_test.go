package l1

// 批量校验 tool-site gallery 展示片 IR（不渲染）：Validate + ResolveBeats，
// 让 15 条片在花 3 分钟渲染之前就把写时错误暴露出来。纯 Go，无浏览器依赖。

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	videoapp "myproduct/internal/video/app"
)

func TestGalleryShowcaseIRsValidate(t *testing.T) {
	root := os.Getenv("TOOLSITE_GALLERY_ROOT")
	if root == "" {
		root = `D:\code\tool-site\.runtime\videos`
	}
	dirs, err := filepath.Glob(filepath.Join(root, "gallery-*", "ir.json"))
	require.NoError(t, err)
	// Woodland Friends 的 11 种格式片（2026-11-18）：同一套写时校验
	formats, err := filepath.Glob(filepath.Join(root, "format-woodland-*", "ir.json"))
	require.NoError(t, err)
	dirs = append(dirs, formats...)
	if len(dirs) == 0 {
		t.Skipf("no gallery/format IRs under %s", root)
	}
	for _, p := range dirs {
		slug := filepath.Base(filepath.Dir(p))
		raw, err := os.ReadFile(p)
		require.NoError(t, err, slug)
		ir := &videoapp.IR{}
		require.NoError(t, json.Unmarshal(raw, ir), slug)
		require.NoError(t, videoapp.Validate(ir), slug)
		require.NoError(t, videoapp.ResolveBeats(ir), slug)
		t.Logf("OK %s: elements=%d words=%d moments=%d", slug, len(ir.Elements), len(ir.Words), len(ir.Beats.Moments))
	}
}
