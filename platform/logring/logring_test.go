package logring

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/haozing/ploykit/platform/ids"
	"github.com/haozing/ploykit/platform/logx"
	"github.com/haozing/ploykit/platform/webx"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ctxWithRID mimics what webx.RequestIDMiddleware puts into the context. The
// middleware's setter is unexported, so go through the real middleware to
// build the context.
func ctxWithRID(t *testing.T, rid string) context.Context {
	t.Helper()
	var captured context.Context
	mw := webx.RequestIDMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured = r.Context()
	}))
	mw.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil))
	// The middleware generates its own id; to pin a specific one, pass it as
	// the incoming header.
	mw.ServeHTTP(httptest.NewRecorder(), func() *http.Request {
		req := httptest.NewRequest("GET", "/", nil)
		req.Header.Set("X-Request-Id", rid)
		return req
	}())
	return captured
}

func capture(t *testing.T, opt Options) (*Ring, *slog.Logger) {
	t.Helper()
	var buf bytes.Buffer
	next := slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})
	h := New(next, opt)
	// Handler.Ring is only reachable from the top-level handler; expose it.
	ring := h.Ring()
	return ring, slog.New(h)
}

func TestLogring_PerRequestCorrelation(t *testing.T) {
	ring, log := capture(t, Options{})
	rid := ids.NewV7().String()
	ctx := ctxWithRID(t, rid)

	log.InfoContext(ctx, "handling request", "path", "/api/tasks")
	log.WarnContext(ctx, "slow query", "ms", 950)
	log.Info("no request context here")

	got := ring.ByRequestID(rid, Query{})
	require.Len(t, got, 2, "records without the request id must not land in the bucket")
	assert.Equal(t, "handling request", got[0].Message)
	assert.Equal(t, slog.LevelWarn, got[1].Level)
	assert.Equal(t, "/api/tasks", got[0].Attrs[0].Value)

	tail := ring.Tail(Query{})
	require.Len(t, tail, 3, "global tail includes uncorrelated records")
}

func TestLogring_GlobalTailBound(t *testing.T) {
	ring, log := capture(t, Options{Capacity: 5})
	for i := 0; i < 8; i++ {
		log.Info("tick", "i", i)
	}
	got := ring.Tail(Query{})
	require.Len(t, got, 5)
	assert.Equal(t, "tick", got[0].Message)
	// Writes 0..4 fill the ring, then 5,6,7 overwrite slots 0..2; the head
	// lands on slot 3, so the oldest survivor is tick 3.
	assert.Equal(t, "3", got[0].Attrs[0].Value)
	assert.Equal(t, "7", got[4].Attrs[0].Value)

	st := ring.Stats()
	assert.Equal(t, uint64(8), st.Captured)
	assert.Equal(t, uint64(3), st.DroppedGlobal)
}

func TestLogring_PerRequestBound(t *testing.T) {
	ring, log := capture(t, Options{PerRequestCapacity: 4})
	rid := ids.NewV7().String()
	ctx := ctxWithRID(t, rid)
	for i := 0; i < 6; i++ {
		log.InfoContext(ctx, "step", "i", i)
	}
	got := ring.ByRequestID(rid, Query{})
	require.Len(t, got, 4)
	assert.Equal(t, "2", got[0].Attrs[0].Value, "oldest overflowed entries are dropped first")
	assert.Equal(t, "5", got[3].Attrs[0].Value)
}

func TestLogring_RequestLRUEviction(t *testing.T) {
	ring, log := capture(t, Options{MaxRequests: 2})
	rids := []string{ids.NewV7().String(), ids.NewV7().String(), ids.NewV7().String()}
	for _, rid := range rids {
		log.InfoContext(ctxWithRID(t, rid), "hit")
	}
	assert.Nil(t, ring.ByRequestID(rids[0], Query{}), "least recently used request bucket must be evicted")
	assert.Len(t, ring.ByRequestID(rids[2], Query{}), 1)
	st := ring.Stats()
	assert.Equal(t, 2, st.Requests)
	assert.Equal(t, uint64(1), st.DroppedRequests)
}

func TestLogring_LevelFilterAndLimit(t *testing.T) {
	ring, log := capture(t, Options{})
	rid := ids.NewV7().String()
	ctx := ctxWithRID(t, rid)
	log.InfoContext(ctx, "a")
	log.WarnContext(ctx, "b")
	log.ErrorContext(ctx, "c")

	got := ring.ByRequestID(rid, Query{MinLevel: slog.LevelWarn})
	require.Len(t, got, 2)
	assert.Equal(t, "b", got[0].Message)

	got = ring.ByRequestID(rid, Query{Limit: 1})
	require.Len(t, got, 1)
	assert.Equal(t, "c", got[0].Message, "limit keeps the newest")
}

func TestLogring_RedactionDefaultOn(t *testing.T) {
	ring, log := capture(t, Options{})
	secret := "sk-proj-abcdefghijklmnopqrstuvwx"
	log.Info("login attempt", "note", "token "+secret+" leaked")
	for _, e := range ring.Tail(Query{}) {
		for _, a := range e.Attrs {
			assert.NotContains(t, a.Value, secret)
			assert.Contains(t, a.Value, "[REDACTED:", "pattern-bearing secrets must be scrubbed")
		}
	}
}

func TestLogring_RedactionCanBeDisabled(t *testing.T) {
	no := false
	ring, log := capture(t, Options{Redact: &no})
	log.Info("plain", "password", "hunter2")
	got := ring.Tail(Query{})
	require.Len(t, got, 1)
	assert.Equal(t, "hunter2", got[0].Attrs[0].Value)
}

func TestLogring_ForwardsToNextHandler(t *testing.T) {
	var buf bytes.Buffer
	next := slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelError})
	h := New(next, Options{})
	log := slog.New(h)

	assert.False(t, h.Enabled(context.Background(), slog.LevelInfo), "Enabled must follow next so info records are neither printed nor captured")
	log.Info("dropped before capture")
	assert.Empty(t, h.Ring().Tail(Query{}))

	log.Error("kept", "k", "v")
	require.Len(t, h.Ring().Tail(Query{}), 1)
	var rec map[string]any
	require.NoError(t, json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &rec))
	assert.Equal(t, "kept", rec["msg"])
}

func TestLogring_GroupsAndWithAttrsFlattened(t *testing.T) {
	ring, log := capture(t, Options{})
	sub := log.With("component", "task").WithGroup("db")
	rid := ids.NewV7().String()
	sub.InfoContext(ctxWithRID(t, rid), "query ran", slog.Group("timing", "ms", 12))
	got := ring.ByRequestID(rid, Query{})
	require.Len(t, got, 1)
	keys := map[string]string{}
	for _, a := range got[0].Attrs {
		keys[a.Key] = a.Value
	}
	assert.Equal(t, "task", keys["component"])
	assert.Equal(t, "12", keys["db.timing.ms"])
}

func TestLogring_WrapThroughLogx(t *testing.T) {
	var ring *Ring
	var buf bytes.Buffer
	log := logx.New(logx.Options{
		Writer:      &buf,
		Format:      "json",
		WrapHandler: Wrap(&ring, Options{Capacity: 64}),
	})
	require.NotNil(t, ring, "Wrap must hand the ring back")

	rid := ids.NewV7().String()
	log.InfoContext(ctxWithRID(t, rid), "via logx")
	assert.Len(t, ring.ByRequestID(rid, Query{}), 1)
	assert.Contains(t, buf.String(), `"msg":"via logx"`, "stdout output must be unchanged")
}

func TestLogring_EntriesAreJSONSerializable(t *testing.T) {
	ring, log := capture(t, Options{})
	rid := ids.NewV7().String()
	log.InfoContext(ctxWithRID(t, rid), "serializable", "n", 42)
	b, err := json.Marshal(ring.ByRequestID(rid, Query{}))
	require.NoError(t, err)
	assert.Contains(t, string(b), `"request_id":"`+rid+`"`)
	assert.Contains(t, string(b), `"level":`, "level must marshal, got: %s", b)
}
