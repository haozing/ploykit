package webx

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTimeout_SlowHandlerGets504(t *testing.T) {
	h := Timeout(50 * time.Millisecond)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(300 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("late"))
	}))

	rec := httptest.NewRecorder()
	start := time.Now()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	elapsed := time.Since(start)

	assert.Equal(t, http.StatusGatewayTimeout, rec.Code)
	require.Less(t, elapsed, 250*time.Millisecond, "timeout must not wait for the handler to finish")

	var body ErrorBody
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "E_TIMEOUT", body.Code)
}

func TestTimeout_FastHandlerUnaffected(t *testing.T) {
	h := Timeout(2 * time.Second)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	assert.Equal(t, http.StatusCreated, rec.Code)
	assert.Equal(t, `{"ok":true}`, strings.TrimSpace(rec.Body.String()))
}

func TestTimeout_AlreadyWritingAbandonsFallback(t *testing.T) {
	handlerDone := make(chan struct{})
	h := Timeout(50 * time.Millisecond)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("partial"))
		<-r.Context().Done()
		close(handlerDone)
	}))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "partial", rec.Body.String())

	select {
	case <-handlerDone:
	case <-time.After(2 * time.Second):
		t.Fatal("handler goroutine should observe ctx cancellation and finish")
	}
}

func TestTimeoutExcept_ExemptPathNotKilled(t *testing.T) {
	noDeadline := make(chan bool, 1)
	h := TimeoutExcept(50*time.Millisecond, "/ws")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, hasDeadline := r.Context().Deadline()
		noDeadline <- !hasDeadline
		time.Sleep(300 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("upgrade-done"))
	}))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/ws/room1", nil))

	require.True(t, <-noDeadline, "豁免路径不得设置 ctx 超时")
	assert.Equal(t, http.StatusOK, rec.Code, "慢 handler 不被掐、正常完成")
	assert.Equal(t, "upgrade-done", rec.Body.String())
}

func TestTimeoutExcept_NonExemptPathStillTimesOut(t *testing.T) {
	h := TimeoutExcept(50*time.Millisecond, "/ws")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(300 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("late"))
	}))

	rec := httptest.NewRecorder()
	start := time.Now()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/tasks", nil))
	elapsed := time.Since(start)

	assert.Equal(t, http.StatusGatewayTimeout, rec.Code)
	require.Less(t, elapsed, 250*time.Millisecond, "timeout must not wait for the handler to finish")

	var body ErrorBody
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "E_TIMEOUT", body.Code)
}

func TestBodyLimit_DecodeJSONReturns413OverLimit(t *testing.T) {
	type payload struct {
		Data string `json:"data"`
	}

	t.Run("4MB body under 1MB limit: 413 E_PAYLOAD_TOO_LARGE", func(t *testing.T) {
		h := BodyLimit(1 << 20)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var p payload
			if !DecodeJSON(w, r, &p) {
				return
			}
			WriteJSON(w, http.StatusOK, p)
		}))

		big := `{"data":"` + strings.Repeat("x", 4<<20) + `"}`
		req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(big))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusRequestEntityTooLarge, rec.Code)
		var body ErrorBody
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
		assert.Equal(t, "E_PAYLOAD_TOO_LARGE", body.Code)
	})

	t.Run("body within limit: decodes normally", func(t *testing.T) {
		h := BodyLimit(1 << 20)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var p payload
			if !DecodeJSON(w, r, &p) {
				return
			}
			WriteJSON(w, http.StatusOK, p)
		}))

		req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"data":"fine"}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Contains(t, rec.Body.String(), "fine")
	})

	t.Run("malformed json within limit: still 400 E_BAD_JSON", func(t *testing.T) {
		h := BodyLimit(1 << 20)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var p payload
			if !DecodeJSON(w, r, &p) {
				return
			}
			WriteJSON(w, http.StatusOK, p)
		}))

		req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader([]byte(`{"data":`)))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusBadRequest, rec.Code)
		var body ErrorBody
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
		assert.Equal(t, "E_BAD_JSON", body.Code)
	})
}

func TestDecodeJSON_RejectsTrailingData_W7(t *testing.T) {
	type payload struct {
		Data string `json:"data"`
	}
	h := BodyLimit(1 << 20)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var p payload
		if !DecodeJSON(w, r, &p) {
			return
		}
		WriteJSON(w, http.StatusOK, p)
	}))

	t.Run("两个拼接对象 → 400 trailing data", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"data":"a"}{"data":"b"}`))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusBadRequest, rec.Code)
		var body ErrorBody
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
		assert.Equal(t, "E_BAD_JSON", body.Code)
		assert.Equal(t, "trailing data", body.Details)
	})

	t.Run("单个对象后仅空白 → 正常解码", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("{\"data\":\"a\"}\n\t "))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusOK, rec.Code)
	})
}
