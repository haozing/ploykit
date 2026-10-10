package wsx

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/platform/wswire"
)

func readRaw(t *testing.T, c *websocket.Conn) []byte {
	t.Helper()
	_ = c.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, raw, err := c.ReadMessage()
	require.NoError(t, err)
	return raw
}

func dialAs(t *testing.T, h *Hub, p *webx.Principal) *websocket.Conn {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		r = r.WithContext(webx.WithPrincipal(r.Context(), p))
		h.ServeWS(w, r)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	c, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http")+"/ws?workspace_id="+testWS, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = c.Close() })
	return c
}

func TestBroadcastEvent(t *testing.T) {
	tests := []struct {
		name    string
		event   string
		payload []byte
		eventID string
	}{
		{"事件/payload/eventID 全量透传", "demo.created", []byte(`{"workspace_id":"ws1","demo":{"id":"d1"}}`), "ev-fixed-1"},
		{"payload 为 nil（omitempty 不下发）", "demo.deleted", nil, "ev-fixed-2"},
		{"事件名带点号（前端按 type 精确匹配）", "demo.state.changed", []byte(`{"ok":true}`), "ev-fixed-3"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := NewHub(nil)
			h.WorkspaceMember = allowAllWorkspaces
			_, url := newHubSrv(t, h, &webx.Principal{UserID: "u1", Source: webx.SourceSession})
			c1 := dial(t, url)
			c2 := dialAs(t, h, &webx.Principal{UserID: "u2", Source: webx.SourceSession})
			scope1 := wswire.ScopeKey(wswire.ScopeUser, "u1")
			scope2 := wswire.ScopeKey(wswire.ScopeUser, "u2")
			require.Eventually(t, func() bool {
				return h.RoomSize(scope1) == 1 && h.RoomSize(scope2) == 1
			}, 2*time.Second, 20*time.Millisecond)

			require.NoError(t, h.BroadcastEvent(context.Background(), scope1, tt.event, tt.payload, tt.eventID))
			h.Broadcast(context.Background(), scope2, wswire.Frame{Type: tt.event, Payload: tt.payload, EventID: tt.eventID})

			raw1 := readRaw(t, c1)
			raw2 := readRaw(t, c2)
			assert.Equal(t, string(raw2), string(raw1), "BroadcastEvent 与直接构帧 Broadcast 的线上字节一致")

			var f wswire.Frame
			require.NoError(t, json.Unmarshal(raw1, &f))
			assert.Equal(t, tt.event, f.Type, "event 透传为帧 type")
			if tt.payload == nil {
				assert.Empty(t, f.Payload, "nil payload 不下发")
			} else {
				assert.JSONEq(t, string(tt.payload), string(f.Payload), "payload 透传")
			}
			assert.Equal(t, tt.eventID, f.EventID, "eventID 透传（帧去重键）")
		})
	}
}

func TestBroadcastEventAutoEventID(t *testing.T) {
	h := NewHub(nil)
	h.WorkspaceMember = allowAllWorkspaces
	_, url := newHubSrv(t, h, &webx.Principal{UserID: "u1", Source: webx.SourceSession})
	c := dial(t, url)
	scope := wswire.ScopeKey(wswire.ScopeWorkspace, testWS)
	require.Eventually(t, func() bool { return h.RoomSize(scope) == 1 }, 2*time.Second, 20*time.Millisecond)

	payload := []byte(`{"n":1}`)
	require.NoError(t, h.BroadcastEvent(context.Background(), scope, "demo.created", payload, ""))
	f1 := readFrame(t, c)
	require.NoError(t, h.BroadcastEvent(context.Background(), scope, "demo.created", payload, ""))
	f2 := readFrame(t, c)

	for _, f := range []wswire.Frame{f1, f2} {
		assert.Equal(t, "demo.created", f.Type)
		assert.JSONEq(t, string(payload), string(f.Payload))
		require.NotEmpty(t, f.EventID, "空 eventID 必须自动生成")
		id, err := uuid.Parse(f.EventID)
		require.NoError(t, err, "自动生成的 eventID 是 UUID")
		assert.Equal(t, uuid.Version(7), id.Version(), "UUIDv7（时序可排序，与 ids.NewV7 同源）")
	}
	assert.NotEqual(t, f1.EventID, f2.EventID, "两次广播的去重键互异")

	require.NoError(t, h.BroadcastEvent(context.Background(), wswire.ScopeKey(wswire.ScopeUser, "nobody"), "demo.x", payload, ""))
	noFrame(t, c)
}

func TestBroadcastEventRelayDelegation(t *testing.T) {
	fr := &fakeRelay{}
	h := NewHub(nil)
	h.Relay = fr
	payload := []byte(`{"k":"v"}`)

	require.NoError(t, h.BroadcastEvent(context.Background(), wswire.ScopeKey(wswire.ScopeUser, "u9"), "demo.created", payload, "ev-relay"))

	calls := fr.snapshot()
	require.Len(t, calls, 1)
	assert.Equal(t, wswire.ScopeKey(wswire.ScopeUser, "u9"), calls[0].scope)
	assert.Equal(t, wswire.Frame{Type: "demo.created", Payload: payload, EventID: "ev-relay"}, calls[0].frame)
}

func TestRegisterWrappersDelegate(t *testing.T) {
	require.Error(t, RegisterScope("BAD"), "非法词法被拒（大写）")
	require.Error(t, RegisterScope("workspace"), "框架保留名被拒")
	require.Error(t, RegisterCapability("notification"), "capability 保留名被拒")

	if err := RegisterCapability("wsxdemo"); err != nil {
		require.ErrorContains(t, err, "already registered", "仅接受重复注册这一种失败")
	}
	assert.Contains(t, Capabilities(), "notification")
	assert.Contains(t, Capabilities(), "wsxdemo")
}
