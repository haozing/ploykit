package wsx

import (
	"context"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/relayx"
	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/platform/wswire"
)

type equivHub struct {
	hub     *Hub
	relay   *relayx.Relay
	url     string
	ready   chan struct{}
	foreign atomic.Int32
}

func newEquivHub(t *testing.T, ctx context.Context, self string, tp relayx.Transport, p *webx.Principal) *equivHub {
	t.Helper()
	h := NewHub(nil)
	h.WorkspaceMember = allowAllWorkspaces
	r := relayx.NewRelay(self, tp, nil)
	h.Relay = r
	_, url := newHubSrv(t, h, p)
	eh := &equivHub{hub: h, relay: r, url: url, ready: make(chan struct{}, 1)}
	go func() {
		_ = r.Run(ctx, func(env relayx.Envelope) {
			if strings.HasPrefix(env.Scope, "probe:") {
				select {
				case eh.ready <- struct{}{}:
				default:
				}
				return
			}
			eh.foreign.Add(1)
			h.DeliverRemote(env.Scope, env.Frame)
		})
	}()
	return eh
}

func probePeer(t *testing.T, ctx context.Context, src *relayx.Relay, ready <-chan struct{}) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for {
		src.PublishOut(ctx, "probe:ready", wswire.Frame{Type: "relay:probe"})
		select {
		case <-ready:
			return
		case <-time.After(50 * time.Millisecond):
		}
		if time.Now().After(deadline) {
			t.Fatal("peer relay subscription not ready within 3s")
		}
	}
}

type connReader struct {
	frames chan wswire.Frame
}

func newConnReader(t *testing.T, c *websocket.Conn) *connReader {
	cr := &connReader{frames: make(chan wswire.Frame, 32)}
	go func() {
		for {

			_ = c.SetReadDeadline(time.Now().Add(3 * time.Minute))
			var f wswire.Frame
			if err := c.ReadJSON(&f); err != nil {
				close(cr.frames)
				return
			}
			cr.frames <- f
		}
	}()
	return cr
}

func (cr *connReader) next(t *testing.T, wantEventID string) wswire.Frame {
	t.Helper()
	select {
	case f, ok := <-cr.frames:
		require.True(t, ok, "connection reader stopped before %s arrived", wantEventID)
		require.Equal(t, wantEventID, f.EventID, "unexpected frame order or content")
		return f
	case <-time.After(3 * time.Second):
		t.Fatalf("frame %s not received within 3s", wantEventID)
		return wswire.Frame{}
	}
}

func (cr *connReader) assertSilent(t *testing.T, window time.Duration) {
	t.Helper()
	select {
	case f := <-cr.frames:
		t.Fatalf("should receive no frame, got %+v", f)
	case <-time.After(window):
	}
}

func runDualHubEquivalence(t *testing.T, tp relayx.Transport, waitReady func(t *testing.T, a, b *equivHub)) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	p := &webx.Principal{UserID: "u1", Source: webx.SourceSession}
	scope := wswire.ScopeKey(wswire.ScopeWorkspace, testWS)

	a := newEquivHub(t, ctx, "inst-a", tp, p)
	b := newEquivHub(t, ctx, "inst-b", tp, p)

	rA := newConnReader(t, dial(t, a.url))
	rB := newConnReader(t, dial(t, b.url))
	require.Eventually(t, func() bool {
		return a.hub.RoomSize(scope) == 1 && b.hub.RoomSize(scope) == 1
	}, 2*time.Second, 20*time.Millisecond, "both clients joined their own hub's room")

	waitReady(t, a, b)

	a.hub.Broadcast(ctx, scope, frame(t, "eq-a2b"))

	fB := rB.next(t, "eq-a2b")
	assert.Equal(t, "demo:event", fB.Type)
	assert.JSONEq(t, `{"hello":"world"}`, string(fB.Payload), "B receives A's broadcast via relay")
	fA := rA.next(t, "eq-a2b")
	assert.JSONEq(t, string(fB.Payload), string(fA.Payload), "A receives its own broadcast locally, identical bytes")
	rA.assertSilent(t, 400*time.Millisecond)
	rB.assertSilent(t, 400*time.Millisecond)
	assert.Equal(t, int32(0), a.foreign.Load(), "no loop: A's relay suppresses its own origin")
	assert.Equal(t, int32(1), b.foreign.Load(), "B consumed exactly one foreign envelope")

	b.hub.Broadcast(ctx, scope, frame(t, "eq-b2a"))

	rA.next(t, "eq-b2a")
	fB2 := rB.next(t, "eq-b2a")
	assert.Equal(t, "demo:event", fB2.Type)
	rA.assertSilent(t, 400*time.Millisecond)
	rB.assertSilent(t, 400*time.Millisecond)
	assert.Equal(t, int32(1), a.foreign.Load())
	assert.Equal(t, int32(1), b.foreign.Load())

	a.hub.SendToUser(ctx, "u1", frame(t, "eq-user"))

	rB.next(t, "eq-user")
	rA.next(t, "eq-user")
	rA.assertSilent(t, 400*time.Millisecond)
	rB.assertSilent(t, 400*time.Millisecond)
	assert.Equal(t, int32(1), a.foreign.Load(), "A's user frame skipped at its own relay (origin)")
	assert.Equal(t, int32(2), b.foreign.Load(), "B consumed the user-scoped envelope too")
}

func TestMultiHubRelayEquivalence(t *testing.T) {
	t.Run("memory", func(t *testing.T) {
		tp := relayx.NewMemoryTransport()
		runDualHubEquivalence(t, tp, func(t *testing.T, a, b *equivHub) {
			ctx := context.Background()
			probePeer(t, ctx, a.relay, b.ready)
			probePeer(t, ctx, b.relay, a.ready)
		})
	})

	t.Run("redis", func(t *testing.T) {
		raw := os.Getenv("TEST_REDIS_URL")
		if raw == "" {
			t.Skip("TEST_REDIS_URL not set; redis equivalence skipped")
		}
		opt, err := redis.ParseURL(raw)
		require.NoError(t, err)
		cli := redis.NewClient(opt)
		t.Cleanup(func() { _ = cli.Close() })
		pingCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		require.NoError(t, cli.Ping(pingCtx).Err(), "redis at %s not reachable", raw)

		tp := relayx.NewRedisTransport(cli)
		runDualHubEquivalence(t, tp, func(t *testing.T, _a, _b *equivHub) {

			require.Eventually(t, func() bool {
				n, err := cli.PubSubNumSub(context.Background(), relayx.Channel).Result()
				return err == nil && n[relayx.Channel] >= 2
			}, 5*time.Second, 50*time.Millisecond)
		})
	})
}
