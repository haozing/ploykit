package webx

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

// storage-walk #11: the exemption must BYPASS, not layer — two nested
// MaxBytesReaders clamp to the minimum, which is the exact product trap this
// variant exists to replace.
func readAll(t *testing.T, h http.Handler, path string, size int) (status int, bodyRead string) {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(make([]byte, size)))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w.Code, r.URL.Path
}

func TestBodyLimitExcept_BypassNotMin(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = r.Body.Read(make([]byte, 1))
		w.WriteHeader(http.StatusOK)
	})
	limited := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		buf := make([]byte, 8<<20)
		n, err := r.Body.Read(buf)
		if err != nil && err.Error() != "EOF" {
			w.WriteHeader(http.StatusRequestEntityTooLarge)
			return
		}
		_ = n
		w.WriteHeader(http.StatusOK)
	})

	t.Run("豁免前缀：6MB body 通过（旁路而非嵌套 min）", func(t *testing.T) {
		h := BodyLimitExcept(1<<20, "/api/upload/")(limited)
		r := httptest.NewRequest(http.MethodPost, "/api/upload/cover", bytes.NewReader(make([]byte, 6<<20)))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		assert.Equal(t, http.StatusOK, w.Code)
	})

	t.Run("非豁免前缀：1MB 限制生效", func(t *testing.T) {
		h := BodyLimitExcept(1<<20, "/api/upload/")(limited)
		r := httptest.NewRequest(http.MethodPost, "/api/tasks", bytes.NewReader(make([]byte, 6<<20)))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		assert.Equal(t, http.StatusRequestEntityTooLarge, w.Code)
	})

	t.Run("反面钉子：嵌套两层（旧 pathGate 叠法）确实取 min", func(t *testing.T) {
		inner := BodyLimit(6 << 20)(limited)
		outer := BodyLimit(1 << 20)(inner)
		r := httptest.NewRequest(http.MethodPost, "/api/upload/cover", bytes.NewReader(make([]byte, 6<<20)))
		w := httptest.NewRecorder()
		outer.ServeHTTP(w, r)
		assert.Equal(t, http.StatusRequestEntityTooLarge, w.Code,
			"layering two MaxBytesReaders clamps to the min — the trap BodyLimitExcept replaces")
	})

	t.Run("普通路径完全可用", func(t *testing.T) {
		h := BodyLimitExcept(1 << 20)(ok)
		r := httptest.NewRequest(http.MethodPost, "/x", strings.NewReader("small"))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		assert.Equal(t, http.StatusOK, w.Code)
	})
	_ = readAll
}
