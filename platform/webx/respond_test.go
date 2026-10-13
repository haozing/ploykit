package webx

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

// aifengkong #3: DecodeJSONKnown keeps strict typing while capturing unknown
// field names for the handler to act on (shadow-field rollout), instead of a
// blind 400.
type knownProbe struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

func TestDecodeJSONKnown(t *testing.T) {
	do := func(body string) ([]string, bool) {
		r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
		w := httptest.NewRecorder()
		v, ok := DecodeJSONKnown(w, r, &knownProbe{})
		return v, ok
	}
	t.Run("全部已知字段：unknown 空", func(t *testing.T) {
		v, ok := do(`{"name":"a","count":1}`)
		assert.True(t, ok)
		assert.Empty(t, v)
	})
	t.Run("未知字段被捕获而非 400，排序稳定", func(t *testing.T) {
		v, ok := do(`{"name":"a","extra_z":1,"extra_a":2}`)
		assert.True(t, ok)
		assert.Equal(t, []string{"extra_a", "extra_z"}, v)
	})
	t.Run("类型错误仍然 400（strict 解码先行）", func(t *testing.T) {
		w := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"count":"not-an-int"}`))
		v, ok := DecodeJSONKnown(w, r, &knownProbe{})
		assert.False(t, ok)
		assert.Empty(t, v)
		assert.Equal(t, http.StatusBadRequest, w.Code)
	})
	t.Run("坏 JSON 仍然 400", func(t *testing.T) {
		w := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{`))
		_, ok := DecodeJSONKnown(w, r, &knownProbe{})
		assert.False(t, ok)
		assert.Equal(t, http.StatusBadRequest, w.Code)
	})
	t.Run("尾随数据仍然 400", func(t *testing.T) {
		w := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"name":"a"} {"x":1}`))
		_, ok := DecodeJSONKnown(w, r, &knownProbe{})
		assert.False(t, ok)
		assert.Equal(t, http.StatusBadRequest, w.Code)
	})
}
