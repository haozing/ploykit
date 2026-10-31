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

// handlerBudget sleeps then reports whether the request context outlived the
// sleep (deadline still in the future = the tier's budget was larger than the
// sleep) and whether a deadline existed at all.
func handlerBudget(sleep time.Duration) (http.HandlerFunc, chan budgetResult) {
	ch := make(chan budgetResult, 1)
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(sleep)
		dl, has := r.Context().Deadline()
		ch <- budgetResult{hasDeadline: has, outlived: !has || dl.After(time.Now())}
		w.WriteHeader(http.StatusOK)
	})
	return h, ch
}

type budgetResult struct {
	hasDeadline bool
	outlived    bool
}

func TestTimeouts_LongestPrefixWins_ThreeTiers(t *testing.T) {
	// three tiers: default 60ms / plans 400ms / negotiate fully exempt
	h := Timeouts(60*time.Millisecond, map[string]time.Duration{
		"/api":                 60 * time.Millisecond,
		"/api/plans":           400 * time.Millisecond,
		"/api/plans/negotiate": 0,
	})

	t.Run("longest prefix tier applies: slow-within-tier handler survives", func(t *testing.T) {
		hd, ch := handlerBudget(150 * time.Millisecond) // > base 60ms, < tier 400ms
		rec := httptest.NewRecorder()
		h(hd).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/plans/123", nil))
		assert.Equal(t, http.StatusOK, rec.Code)
		require.True(t, (<-ch).outlived, "请求须以 /api/plans 的 400ms 预算存活，而非 60ms base")
	})

	t.Run("shorter prefix tier applies when longer ones miss", func(t *testing.T) {
		hd, ch := handlerBudget(0)
		rec := httptest.NewRecorder()
		h(hd).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/tasks", nil))
		assert.Equal(t, http.StatusOK, rec.Code)
		res := <-ch
		require.True(t, res.hasDeadline, "非豁免路径必须有 ctx 超时")
	})

	t.Run("zero override = full exemption, no context deadline", func(t *testing.T) {
		hd, ch := handlerBudget(150 * time.Millisecond) // > base 60ms
		rec := httptest.NewRecorder()
		h(hd).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/plans/negotiate", nil))
		assert.Equal(t, http.StatusOK, rec.Code)
		require.False(t, (<-ch).hasDeadline, "0 档=完全豁免，不得设置 ctx 超时")
	})

	t.Run("unmatched path gets the base timeout and 504s past it", func(t *testing.T) {
		hd := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			time.Sleep(300 * time.Millisecond)
			w.WriteHeader(http.StatusOK)
		})
		rec := httptest.NewRecorder()
		start := time.Now()
		h(hd).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))
		require.Less(t, time.Since(start), 250*time.Millisecond, "超时不得等 handler 跑完")
		assert.Equal(t, http.StatusGatewayTimeout, rec.Code)
		var body ErrorBody
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
		assert.Equal(t, "E_TIMEOUT", body.Code)
	})

	t.Run("tier budget itself fires: over-tier handler 504s", func(t *testing.T) {
		hd := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			time.Sleep(1 * time.Second) // > 400ms tier
			w.WriteHeader(http.StatusOK)
		})
		rec := httptest.NewRecorder()
		h(hd).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/plans/x", nil))
		assert.Equal(t, http.StatusGatewayTimeout, rec.Code)
	})
}

func TestTimeouts_WiringTimeValidation(t *testing.T) {
	assert.PanicsWithValue(t, "webx: Timeouts base must be > 0 (use a 0 override to exempt a prefix)", func() {
		_ = Timeouts(0, nil)
	})
	assert.PanicsWithValue(t, "webx: Timeouts override for /ws must be >= 0 (0 = exempt)", func() {
		_ = Timeouts(5*time.Second, map[string]time.Duration{"/ws": -1})
	})
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
