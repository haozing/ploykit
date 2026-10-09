package webx

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHealth_LivenessAlwaysOK(t *testing.T) {
	h := NewHealth()
	h.AddCheck("db", func(_ context.Context) error { return errors.New("down") })

	rec := httptest.NewRecorder()
	h.Liveness().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	assert.Equal(t, http.StatusOK, rec.Code)
	var body struct {
		Status string `json:"status"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "ok", body.Status)
}

func TestHealth_ReadinessAllPass(t *testing.T) {
	h := NewHealth()
	h.AddCheck("db", func(_ context.Context) error { return nil })
	h.AddCheck("workers", func(_ context.Context) error { return nil })

	rec := httptest.NewRecorder()
	h.Readiness().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))

	assert.Equal(t, http.StatusOK, rec.Code)
	var body struct {
		Status string `json:"status"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "ready", body.Status)
}

func TestHealth_ReadinessOneFails(t *testing.T) {
	h := NewHealth()
	h.AddCheck("db", func(_ context.Context) error { return nil })
	h.AddCheck("cache", func(_ context.Context) error { return errors.New("connection refused") })

	rec := httptest.NewRecorder()
	h.Readiness().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))

	assert.Equal(t, http.StatusServiceUnavailable, rec.Code)
	var body struct {
		Status string   `json:"status"`
		Failed []string `json:"failed"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "unavailable", body.Status)
	assert.Equal(t, []string{"cache"}, body.Failed)
}

func TestHealth_ReadinessSlowCheckTimesOut(t *testing.T) {
	h := NewHealth()
	h.AddCheck("fast", func(_ context.Context) error { return nil })

	h.AddCheck("slow", func(ctx context.Context) error {
		<-ctx.Done()
		return ctx.Err()
	})

	rec := httptest.NewRecorder()
	start := time.Now()
	h.Readiness().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	elapsed := time.Since(start)

	assert.Equal(t, http.StatusServiceUnavailable, rec.Code)
	require.Less(t, elapsed, 3*time.Second, "a 2s-per-check budget must bound the probe")
	var body struct {
		Failed []string `json:"failed"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, []string{"slow"}, body.Failed)
}
