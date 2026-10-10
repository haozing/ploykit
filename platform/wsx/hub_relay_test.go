package wsx

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/platform/wswire"
)

type fakeRelay struct {
	mu    sync.Mutex
	calls []relayCall
}

type relayCall struct {
	scope string
	frame wswire.Frame
}

func (f *fakeRelay) PublishOut(_ context.Context, scope string, frame wswire.Frame) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, relayCall{scope: scope, frame: frame})
}

func (f *fakeRelay) snapshot() []relayCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]relayCall, len(f.calls))
	copy(out, f.calls)
	return out
}

func relayedHub(t *testing.T, principal *webx.Principal) (*Hub, *fakeRelay, string) {
	t.Helper()
	h := NewHub(nil)
	h.WorkspaceMember = allowAllWorkspaces
	r := &fakeRelay{}
	h.Relay = r
	_, url := newHubSrv(t, h, principal)
	return h, r, url
}

func TestBroadcastRelayedAndDeliveredLocally(t *testing.T) {
	p := &webx.Principal{UserID: "u1", Source: webx.SourceSession}
	h, r, url := relayedHub(t, p)
	c := dial(t, url)
	scope := wswire.ScopeKey(wswire.ScopeWorkspace, testWS)
	require.Eventually(t, func() bool { return h.RoomSize(scope) == 1 }, 2*time.Second, 20*time.Millisecond)

	f := frame(t, "r1")
	h.Broadcast(context.Background(), scope, f)

	assert.Equal(t, "r1", readFrame(t, c).EventID, "local delivery still happens with a relay attached")

	calls := r.snapshot()
	require.Len(t, calls, 1, "exactly one outbound publish per broadcast")
	assert.Equal(t, scope, calls[0].scope)
	assert.Equal(t, "r1", calls[0].frame.EventID)
	assert.Equal(t, f.Type, calls[0].frame.Type)
	assert.JSONEq(t, string(f.Payload), string(calls[0].frame.Payload))
}

func TestSendToUserRelayedWithUserScope(t *testing.T) {
	p := &webx.Principal{UserID: "u1", Source: webx.SourceSession}
	h, r, url := relayedHub(t, p)
	c := dial(t, url)
	require.Eventually(t, func() bool { return h.RoomSize(wswire.ScopeKey(wswire.ScopeUser, "u1")) == 1 },
		2*time.Second, 20*time.Millisecond)

	h.SendToUser(context.Background(), "u1", frame(t, "ru"))

	assert.Equal(t, "ru", readFrame(t, c).EventID)
	calls := r.snapshot()
	require.Len(t, calls, 1)
	assert.Equal(t, wswire.ScopeKey(wswire.ScopeUser, "u1"), calls[0].scope)
	assert.Equal(t, "ru", calls[0].frame.EventID)
}

func TestDeliverRemoteLocalOnly(t *testing.T) {
	p := &webx.Principal{UserID: "u1", Source: webx.SourceSession}
	h, r, url := relayedHub(t, p)
	c := dial(t, url)
	scope := wswire.ScopeKey(wswire.ScopeWorkspace, testWS)
	require.Eventually(t, func() bool { return h.RoomSize(scope) == 1 }, 2*time.Second, 20*time.Millisecond)

	h.DeliverRemote(scope, frame(t, "rm"))

	assert.Equal(t, "rm", readFrame(t, c).EventID)
	assert.Empty(t, r.snapshot(), "DeliverRemote must never publish outbound")
}
