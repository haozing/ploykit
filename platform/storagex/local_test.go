package storagex

import (
	"bytes"
	"context"
	"errors"
	"io"
	"mime/multipart"
	"path/filepath"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// storage-walk #10: List enumerates by prefix from the sidecar metas — the
// quota/cleanup surface. Skips broken sidecars; sorts; unescapes keys.
func TestLocalBackend_List(t *testing.T) {
	root := t.TempDir()
	l, err := NewLocal(root)
	require.NoError(t, err)
	ctx := context.Background()

	must := func(key, ct string, data []byte) {
		_, e := l.Put(ctx, key, ct, bytes.NewReader(data))
		require.NoError(t, e)
	}
	must("ws/a/cover.png", "image/png", []byte("aaaa"))
	must("ws/a/doc.pdf", "application/pdf", []byte("bb"))
	must("ws/b/other.png", "image/png", []byte("c"))

	t.Run("前缀过滤", func(t *testing.T) {
		got, err := l.List(ctx, "ws/a/")
		require.NoError(t, err)
		require.Len(t, got, 2)
		assert.Equal(t, "ws/a/cover.png", got[0].Key, "sorted")
		assert.Equal(t, int64(4), got[0].Size)
		assert.Equal(t, "image/png", got[0].ContentType)
	})

	t.Run("空前缀=全部", func(t *testing.T) {
		got, err := l.List(ctx, "")
		require.NoError(t, err)
		assert.Len(t, got, 3)
	})

	t.Run("不存在的前缀=空列表非错误", func(t *testing.T) {
		got, err := l.List(ctx, "ws/zzz/")
		require.NoError(t, err)
		assert.Empty(t, got)
	})

	t.Run("坏 sidecar 被跳过不炸枚举", func(t *testing.T) {
		p, err := l.path("ws/a/cover.png")
		require.NoError(t, err)
		require.NoError(t, os.WriteFile(p+".meta.json", []byte("{not json"), 0o644))
		got, err := l.List(ctx, "ws/a/")
		require.NoError(t, err)
		assert.Len(t, got, 1, "broken sidecar skipped, sibling intact")
	})
}

// storage-walk #14: ServeUploads serves stored objects with safe defaults;
// ParseUpload reads one bounded multipart file.
func TestServeUploads(t *testing.T) {
	root := t.TempDir()
	l, err := NewLocal(root)
	require.NoError(t, err)
	ctx := context.Background()
	_, err = l.Put(ctx, "ws/a/cover.png", "image/png", strings.NewReader("pngdata"))
	require.NoError(t, err)

	h := ServeUploads(l)

	t.Run("GET 命中：Content-Type + immutable cache", func(t *testing.T) {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/uploads/ws/a/cover.png", nil))
		assert.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, "image/png", w.Header().Get("Content-Type"))
		assert.Contains(t, w.Header().Get("Cache-Control"), "immutable")
		assert.Equal(t, "pngdata", w.Body.String())
	})

	t.Run("未存储键 404", func(t *testing.T) {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/uploads/ws/a/ghost.png", nil))
		assert.Equal(t, http.StatusNotFound, w.Code)
	})

	t.Run("越狱路径 404（不 500）", func(t *testing.T) {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/uploads/../etc/passwd", nil))
		assert.Equal(t, http.StatusNotFound, w.Code)
	})

	t.Run("写方法 405", func(t *testing.T) {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(http.MethodDelete, "/uploads/ws/a/cover.png", nil))
		assert.Equal(t, http.StatusMethodNotAllowed, w.Code)
	})
}

func TestParseUpload(t *testing.T) {
	newReq := func(field, fname string, payload []byte) *http.Request {
		var buf bytes.Buffer
		mw := multipart.NewWriter(&buf)
		fw, _ := mw.CreateFormFile(field, fname)
		_, _ = fw.Write(payload)
		_ = mw.Close()
		r := httptest.NewRequest(http.MethodPost, "/api/upload", &buf)
		r.Header.Set("Content-Type", mw.FormDataContentType())
		return r
	}

	t.Run("单文件读取", func(t *testing.T) {
		up, err := ParseUpload(newReq("file", "a.png", []byte("hello")), 1<<20)
		require.NoError(t, err)
		assert.Equal(t, "a.png", up.Filename)
		assert.Equal(t, "hello", string(up.Data))
	})

	t.Run("超限 ErrUploadTooLarge", func(t *testing.T) {
		_, err := ParseUpload(newReq("file", "big.bin", bytes.Repeat([]byte("x"), 100)), 10)
		assert.ErrorIs(t, err, ErrUploadTooLarge)
	})

	t.Run("缺 file 字段报错", func(t *testing.T) {
		_, err := ParseUpload(newReq("other", "a.png", []byte("x")), 1<<20)
		assert.Error(t, err)
	})
}

// Objects written outside Put (migrations, rsync) have no .meta.json sidecar;
// Open used to turn them into a silent ErrNotExist — "file present but served
// 404, zero logs" (field report: 12 blog images). Missing sidecar now falls
// back to stat + content sniffing; a corrupt sidecar stays a hard error.
func TestLocalBackend_OpenWithoutSidecar(t *testing.T) {
	root := t.TempDir()
	l, err := NewLocal(root)
	require.NoError(t, err)
	ctx := context.Background()

	png := append([]byte{0x89}, []byte("PNG\r\n\x1a\n rest of pretend image bytes")...)
	require.NoError(t, os.MkdirAll(filepath.Join(root, "works"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(root, "works", "a.png"), png, 0o644))

	rc, obj, err := l.Open(ctx, "works/a.png")
	require.NoError(t, err)
	defer rc.Close()
	assert.Equal(t, "image/png", obj.ContentType)
	assert.Equal(t, int64(len(png)), obj.Size)
	body, err := io.ReadAll(rc)
	require.NoError(t, err)
	assert.Equal(t, png, body) // the sniff seek must not consume the body

	// The file itself missing is still a clean ErrNotExist.
	_, _, err = l.Open(ctx, "works/ghost.png")
	assert.ErrorIs(t, err, os.ErrNotExist)

	// A corrupt sidecar is metadata damage: hard error, not silent sniffing.
	require.NoError(t, os.WriteFile(filepath.Join(root, "works", "a.png.meta.json"), []byte("{broken"), 0o644))
	_, _, err = l.Open(ctx, "works/a.png")
	assert.Error(t, err)
	assert.False(t, errors.Is(err, os.ErrNotExist))
}
