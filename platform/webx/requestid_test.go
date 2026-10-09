package webx

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRequestIDMiddleware_GeneratesAndPropagates(t *testing.T) {
	t.Run("no inbound header: generate a valid v7 uuid, echo in response header and ctx", func(t *testing.T) {
		var ctxID string
		h := RequestIDMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctxID = RequestIDFromCtx(r.Context())
			w.WriteHeader(http.StatusOK)
		}))

		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

		got := rec.Header().Get("X-Request-Id")
		require.NotEmpty(t, got, "response must carry X-Request-Id")
		_, err := uuid.Parse(got)
		assert.NoError(t, err, "generated id should be a valid uuid: %q", got)
		assert.Equal(t, got, ctxID, "ctx value and response header must be identical")
	})

	t.Run("inbound header: passed through untouched", func(t *testing.T) {
		var ctxID, headerID string
		h := RequestIDMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctxID = RequestIDFromCtx(r.Context())
			headerID = RequestID(r)
			w.WriteHeader(http.StatusOK)
		}))

		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set("X-Request-Id", "req-abc-123")
		h.ServeHTTP(rec, req)

		assert.Equal(t, "req-abc-123", rec.Header().Get("X-Request-Id"))
		assert.Equal(t, "req-abc-123", ctxID)
		assert.Equal(t, "req-abc-123", headerID)
	})

	t.Run("ctx without middleware: empty string, no panic", func(t *testing.T) {
		assert.Empty(t, RequestIDFromCtx(t.Context()))
	})

	t.Run("W5 ctx 优先：中间件链上取生成值而非空串", func(t *testing.T) {
		var got string
		h := RequestIDMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			got = RequestID(r)
		}))
		h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
		assert.NotEmpty(t, got, "无入站头时必须取到 ctx 中的生成值（旧实现返回空串）")
		_, err := uuid.Parse(got)
		assert.NoError(t, err, "ctx 值应为中间件生成的 uuid")
	})

	t.Run("W5 头兜底：未经中间件的裸请求仍可读入站头", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		r.Header.Set("X-Request-Id", "req-fallback")
		assert.Equal(t, "req-fallback", RequestID(r))
	})
}

func TestRequestIDMiddleware_AccessLogCarriesRequestID(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))

	h := RequestIDMiddleware(AccessLog(log)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	headerID := rec.Header().Get("X-Request-Id")
	require.NotEmpty(t, headerID)
	assert.Contains(t, buf.String(), "request_id="+headerID, "access log must include the request id from ctx")
}
