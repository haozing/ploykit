package relayx

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/wswire"
)

const probeType = "relay:probe"

func notify(ready chan<- struct{}) {
	select {
	case ready <- struct{}{}:
	default:
	}
}

func waitSubscribed(t *testing.T, ctx context.Context, src, dst *Relay, ready <-chan struct{}) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for {
		src.PublishOut(ctx, "probe:ready", wswire.Frame{Type: probeType})
		select {
		case <-ready:
			return
		case <-time.After(50 * time.Millisecond):
		}
		if time.Now().After(deadline) {
			t.Fatal("subscription not ready within 3s")
		}
	}
}

func TestEnvelopeWireFormatV1(t *testing.T) {
	payload, err := json.Marshal(map[string]string{"k": "v"})
	require.NoError(t, err)
	env := Envelope{
		Origin: "01929c5e-9f6b-7cc1-9d20-3a44c0a56011",
		Scope:  wswire.ScopeKey(wswire.ScopeWorkspace, "ws-1"),
		Frame:  wswire.Frame{Type: "task:completed", Payload: payload, EventID: "e1"},
	}
	raw, err := json.Marshal(env)
	require.NoError(t, err)

	var keys map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(raw, &keys))

	assert.ElementsMatch(t, []string{"origin", "scope", "frame"}, mapKeys(keys))
	assert.Equal(t, `"`+env.Origin+`"`, string(keys["origin"]))
	assert.Equal(t, `"workspace:ws-1"`, string(keys["scope"]))

	var back Envelope
	require.NoError(t, json.Unmarshal(raw, &back))
	assert.Equal(t, env, back, "envelope must round-trip losslessly")
}

func mapKeys(m map[string]json.RawMessage) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func TestRelayCrossDelivery(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	tp := NewMemoryTransport()
	a := NewRelay("inst-a", tp, nil)
	b := NewRelay("inst-b", tp, nil)

	ready := make(chan struct{}, 1)
	var got []Envelope
	var mu sync.Mutex
	go func() {
		_ = b.Run(ctx, func(env Envelope) {
			if env.Frame.Type == probeType {
				notify(ready)
				return
			}
			mu.Lock()
			got = append(got, env)
			mu.Unlock()
		})
	}()
	waitSubscribed(t, ctx, a, b, ready)

	payload, _ := json.Marshal(map[string]string{"hello": "world"})
	a.PublishOut(ctx, wswire.ScopeKey(wswire.ScopeWorkspace, "ws-1"),
		wswire.Frame{Type: "task:completed", Payload: payload, EventID: "e1"})

	require.Eventually(t, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(got) == 1
	}, 3*time.Second, 20*time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	assert.Equal(t, "inst-a", got[0].Origin)
	assert.Equal(t, wswire.ScopeKey(wswire.ScopeWorkspace, "ws-1"), got[0].Scope)
	assert.Equal(t, "task:completed", got[0].Frame.Type)
	assert.Equal(t, "e1", got[0].Frame.EventID)
	assert.JSONEq(t, `{"hello":"world"}`, string(got[0].Frame.Payload))
}

func TestRelayOriginSuppression(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	tp := NewMemoryTransport()
	a := NewRelay("inst-a", tp, nil)

	var own atomic.Int32
	ready := make(chan struct{}, 1)
	go func() {
		_ = a.Run(ctx, func(env Envelope) {
			if env.Frame.Type == probeType {
				notify(ready)
				return
			}
			own.Add(1)
		})
	}()

	prober := NewRelay("prober", tp, nil)
	waitSubscribed(t, ctx, prober, a, ready)

	for i := 0; i < 3; i++ {
		a.PublishOut(ctx, wswire.ScopeKey(wswire.ScopeWorkspace, "ws-x"),
			wswire.Frame{Type: "task:completed", EventID: fmt.Sprintf("e%d", i)})
	}
	assert.Never(t, func() bool { return own.Load() > 0 },
		300*time.Millisecond, 20*time.Millisecond,
		"own-origin envelopes must never be delivered back (loop suppression)")
}

func TestRelayBadMessageSkipped(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	tp := NewMemoryTransport()
	b := NewRelay("inst-b", tp, nil)

	ready := make(chan struct{}, 1)
	var ids []string
	var mu sync.Mutex
	go func() {
		_ = b.Run(ctx, func(env Envelope) {
			if env.Frame.Type == probeType {
				notify(ready)
				return
			}
			mu.Lock()
			ids = append(ids, env.Frame.EventID)
			mu.Unlock()
		})
	}()
	prober := NewRelay("prober", tp, nil)
	waitSubscribed(t, ctx, prober, b, ready)

	require.NoError(t, tp.Publish(ctx, []byte("not-json at all")))

	require.NoError(t, tp.Publish(ctx, []byte(`{"origin":42,"scope":"workspace:x","frame":{}}`)))

	prober.PublishOut(ctx, wswire.ScopeKey(wswire.ScopeWorkspace, "ws-y"),
		wswire.Frame{Type: "task:completed", EventID: "good-1"})

	require.Eventually(t, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(ids) == 1
	}, 3*time.Second, 20*time.Millisecond, "valid envelope after bad ones still delivered")

	mu.Lock()
	defer mu.Unlock()
	assert.Equal(t, []string{"good-1"}, ids, "bad messages skipped, exactly one good delivery")
}

func TestMemoryTransportFanoutCopies(t *testing.T) {
	tp := NewMemoryTransport()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var sinks [2][][]byte
	var mu sync.Mutex
	for i := range sinks {
		go func(i int) {
			_ = tp.Subscribe(ctx, func(p []byte) {
				mu.Lock()
				sinks[i] = append(sinks[i], p)
				mu.Unlock()
			})
		}(i)
	}

	require.Eventually(t, func() bool {
		_ = tp.Publish(ctx, []byte("probe"))
		mu.Lock()
		defer mu.Unlock()
		return len(sinks[0]) >= 1 && len(sinks[1]) >= 1
	}, 3*time.Second, 20*time.Millisecond)

	buf := []byte("payload")
	require.NoError(t, tp.Publish(ctx, buf))
	copy(buf, "xxxxxxx")

	require.Eventually(t, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(sinks[0]) >= 2 && len(sinks[1]) >= 2
	}, 3*time.Second, 10*time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	assert.Equal(t, "payload", string(sinks[0][len(sinks[0])-1]), "subscriber owns its copy")
	assert.Equal(t, "payload", string(sinks[1][len(sinks[1])-1]))
}

func TestMemoryTransportSubscribeCancel(t *testing.T) {
	tp := NewMemoryTransport()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- tp.Subscribe(ctx, func([]byte) {}) }()

	time.Sleep(20 * time.Millisecond)
	cancel()
	select {
	case err := <-done:
		require.NoError(t, err, "ctx cancel is a clean exit")
	case <-time.After(2 * time.Second):
		t.Fatal("Subscribe did not exit on ctx cancel")
	}
}

func TestMemoryTransportConcurrentChurn(t *testing.T) {
	tp := NewMemoryTransport()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sctx, scancel := context.WithTimeout(ctx, 50*time.Millisecond)
			_ = tp.Subscribe(sctx, func([]byte) {})
			scancel()
		}()
	}
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 200; j++ {
				_ = tp.Publish(ctx, []byte("churn"))
			}
		}()
	}
	wg.Wait()
}

type failTransport struct{ calls atomic.Int32 }

func (f *failTransport) Publish(context.Context, []byte) error {
	f.calls.Add(1)
	return errors.New("bus down")
}
func (f *failTransport) Subscribe(context.Context, func([]byte)) error { return nil }

type captureHandler struct {
	mu       sync.Mutex
	messages []string
}

func (h *captureHandler) Enabled(_ context.Context, l slog.Level) bool { return l >= slog.LevelWarn }
func (h *captureHandler) Handle(_ context.Context, r slog.Record) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.messages = append(h.messages, r.Message)
	return nil
}
func (h *captureHandler) WithAttrs([]slog.Attr) slog.Handler { return h }
func (h *captureHandler) WithGroup(string) slog.Handler      { return h }
func (h *captureHandler) snapshot() []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]string(nil), h.messages...)
}

func TestRelayPublishFailureOnlyLogs(t *testing.T) {
	ft := &failTransport{}
	rec := &captureHandler{}
	r := NewRelay("inst-x", ft, slog.New(rec))

	r.PublishOut(context.Background(), "workspace:w", wswire.Frame{Type: "t", EventID: "e1"})

	assert.Equal(t, int32(1), ft.calls.Load(), "Publish 恰被调用一次")
	msgs := rec.snapshot()
	require.NotEmpty(t, msgs, "Publish 失败必须记 Warn 日志（故障该有声）")
	assert.Contains(t, msgs[0], "publish failed")
}

func TestRelayEmptySelfGeneratesOrigin(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	tp := NewMemoryTransport()
	sender := NewRelay("", tp, nil)
	assert.NotEmpty(t, sender.self, "空 self 应自动生成实例 id")

	ready := make(chan struct{}, 1)
	var origins []string
	var mu sync.Mutex
	receiver := NewRelay("inst-r", tp, nil)
	go func() {
		_ = receiver.Run(ctx, func(env Envelope) {
			if env.Frame.Type == probeType {
				notify(ready)
				return
			}
			mu.Lock()
			origins = append(origins, env.Origin)
			mu.Unlock()
		})
	}()

	prober := NewRelay("prober", tp, nil)
	waitSubscribed(t, ctx, prober, receiver, ready)

	sender.PublishOut(ctx, "workspace:w", wswire.Frame{Type: "t", EventID: "e1"})
	require.Eventually(t, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(origins) == 1
	}, 3*time.Second, 20*time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	assert.NotEmpty(t, origins[0], "信封 origin 必须非空（否则双方空 origin 互丢）")
	assert.NotEqual(t, "inst-r", origins[0], "生成的 id 不得撞上接收方 origin")
}
