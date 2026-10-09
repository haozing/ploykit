package wsx

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/internal/contract/wswire"
	"github.com/haozing/ploykit/platform/webx"
)

const testWS = "11111111-1111-1111-1111-111111111111"

var allowAllWorkspaces WorkspaceMember = func(context.Context, *webx.Principal, string) bool { return true }

func newHubSrv(t *testing.T, h *Hub, principal *webx.Principal) (*Hub, string) {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		if principal != nil {
			r = r.WithContext(webx.WithPrincipal(r.Context(), principal))
		}
		h.ServeWS(w, r)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return h, "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
}

func dial(t *testing.T, url string) *websocket.Conn {
	t.Helper()
	c, _, err := websocket.DefaultDialer.Dial(url+"?workspace_id="+testWS, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = c.Close() })
	return c
}

func readFrame(t *testing.T, c *websocket.Conn) wswire.Frame {
	t.Helper()
	_ = c.SetReadDeadline(time.Now().Add(3 * time.Second))
	var f wswire.Frame
	require.NoError(t, c.ReadJSON(&f))
	return f
}

func noFrame(t *testing.T, c *websocket.Conn) {
	t.Helper()
	_ = c.SetReadDeadline(time.Now().Add(400 * time.Millisecond))
	var f wswire.Frame
	if err := c.ReadJSON(&f); err == nil {
		t.Fatalf("should receive no frame, got %+v", f)
	}
}

func frame(t *testing.T, eventID string) wswire.Frame {
	p, _ := json.Marshal(map[string]string{"hello": "world"})
	return wswire.Frame{Type: "demo:event", Payload: p, EventID: eventID}
}

const testScope = "demo"

func registerTestScope(t *testing.T) {
	t.Helper()
	if err := wswire.RegisterScope(testScope); err != nil && !wswire.IsRegisteredScope(testScope) {
		t.Fatalf("RegisterScope(%q): %v", testScope, err)
	}
}

func TestRoomDeliveryAndDedupe(t *testing.T) {
	h := NewHub(nil)
	h.WorkspaceMember = allowAllWorkspaces
	p := &webx.Principal{UserID: "u1", Source: webx.SourceSession}
	_, url := newHubSrv(t, h, p)
	c1 := dial(t, url)
	c2 := dial(t, url)

	require.Eventually(t, func() bool { return h.RoomSize(wswire.ScopeKey(wswire.ScopeWorkspace, testWS)) == 2 },
		2*time.Second, 20*time.Millisecond)

	h.Broadcast(context.Background(), wswire.ScopeKey(wswire.ScopeWorkspace, testWS), frame(t, "e1"))
	assert.Equal(t, "demo:event", readFrame(t, c1).Type)
	assert.Equal(t, "demo:event", readFrame(t, c2).Type)

	h.Broadcast(context.Background(), wswire.ScopeKey(wswire.ScopeWorkspace, testWS), frame(t, "e1"))
	noFrame(t, c1)

	h.Broadcast(context.Background(), wswire.ScopeKey(wswire.ScopeWorkspace, "other"), frame(t, "e2"))
	noFrame(t, c1)
}

func TestSendToUser(t *testing.T) {
	h := NewHub(nil)
	p := &webx.Principal{UserID: "u1", Source: webx.SourceSession}
	_, url := newHubSrv(t, h, p)
	c := dial(t, url)
	require.Eventually(t, func() bool { return h.RoomSize(wswire.ScopeKey(wswire.ScopeUser, "u1")) == 1 },
		2*time.Second, 20*time.Millisecond)

	h.SendToUser(context.Background(), "u1", frame(t, "u1"))
	h.SendToUser(context.Background(), "u2", frame(t, "u2"))
	f := readFrame(t, c)
	assert.Equal(t, "u1", f.EventID)
	noFrame(t, c)
}

func TestFirstFrameAuth(t *testing.T) {
	h := NewHub(nil)
	h.WorkspaceMember = allowAllWorkspaces
	h.PATResolve = func(_ context.Context, token string) (*webx.Principal, error) {
		if token != "tk_good" {
			return nil, assert.AnError
		}
		return &webx.Principal{UserID: "u9", Source: webx.SourcePAT}, nil
	}
	_, url := newHubSrv(t, h, nil)
	c := dial(t, url)

	require.NoError(t, c.WriteJSON(map[string]string{"type": "auth", "token": "tk_good"}))
	f := readFrame(t, c)
	assert.Equal(t, wswire.ConfirmPrefix+wswire.CtrlAuth, f.Type)
	require.Eventually(t, func() bool { return h.RoomSize(wswire.ScopeKey(wswire.ScopeUser, "u9")) == 1 },
		2*time.Second, 20*time.Millisecond)

	h.SendToUser(context.Background(), "u9", frame(t, "uf"))
	assert.Equal(t, "uf", readFrame(t, c).EventID)

	require.NoError(t, c.WriteJSON(map[string]string{"type": "subscribe", "scope": "workspace", "id": testWS}))
	f = readFrame(t, c)
	assert.Equal(t, wswire.ConfirmPrefix+wswire.CtrlSubscribe, f.Type)
}

func TestFirstFrameAuthReject(t *testing.T) {
	h := NewHub(nil)
	h.PATResolve = func(_ context.Context, _ string) (*webx.Principal, error) {
		return nil, assert.AnError
	}
	_, url := newHubSrv(t, h, nil)
	c := dial(t, url)
	require.NoError(t, c.WriteJSON(map[string]string{"type": "auth", "token": "tk_bad"}))
	f := readFrame(t, c)
	assert.Equal(t, wswire.RejectedPrefix+wswire.CtrlAuth, f.Type)
}

func TestPATPrefixConfigurable_N4(t *testing.T) {
	t.Run("自定义前缀通过", func(t *testing.T) {
		h := NewHub(nil)
		h.PATPrefix = "ork_"
		h.PATResolve = func(_ context.Context, token string) (*webx.Principal, error) {
			if token != "ork_good" {
				return nil, assert.AnError
			}
			return &webx.Principal{UserID: "u9", Source: webx.SourcePAT}, nil
		}
		_, url := newHubSrv(t, h, nil)
		c := dial(t, url)
		require.NoError(t, c.WriteJSON(map[string]string{"type": "auth", "token": "ork_good"}))
		f := readFrame(t, c)
		assert.Equal(t, wswire.ConfirmPrefix+wswire.CtrlAuth, f.Type)
	})

	t.Run("错误前缀拒绝且不触 PATResolve", func(t *testing.T) {
		h := NewHub(nil)
		h.PATPrefix = "ork_"
		resolved := false
		h.PATResolve = func(_ context.Context, _ string) (*webx.Principal, error) {
			resolved = true
			return &webx.Principal{UserID: "u9", Source: webx.SourcePAT}, nil
		}
		_, url := newHubSrv(t, h, nil)
		c := dial(t, url)

		require.NoError(t, c.WriteJSON(map[string]string{"type": "auth", "token": "tk_good"}))
		f := readFrame(t, c)
		assert.Equal(t, wswire.RejectedPrefix+wswire.CtrlAuth, f.Type)
		assert.False(t, resolved, "错误前缀应在前缀闸门被拒，不应触达 PATResolve")
	})

	t.Run("未配置回退默认 tk_", func(t *testing.T) {
		h := NewHub(nil)
		h.PATResolve = func(_ context.Context, _ string) (*webx.Principal, error) {
			return &webx.Principal{UserID: "u9", Source: webx.SourcePAT}, nil
		}
		_, url := newHubSrv(t, h, nil)

		c := dial(t, url)
		require.NoError(t, c.WriteJSON(map[string]string{"type": "auth", "token": "tk_good"}))
		f := readFrame(t, c)
		assert.Equal(t, wswire.ConfirmPrefix+wswire.CtrlAuth, f.Type)

		c2 := dial(t, url)
		require.NoError(t, c2.WriteJSON(map[string]string{"type": "auth", "token": "ork_good"}))
		f2 := readFrame(t, c2)
		assert.Equal(t, wswire.RejectedPrefix+wswire.CtrlAuth, f2.Type)
	})
}

func TestCapabilitiesInHandshake(t *testing.T) {
	caps := []string{wswire.CapBatch, wswire.CapNotification, wswire.CapWorkspace}

	t.Run("PAT first-frame auth ack carries it", func(t *testing.T) {
		h := NewHub(nil)
		h.Capabilities = caps
		h.PATResolve = func(_ context.Context, token string) (*webx.Principal, error) {
			return &webx.Principal{UserID: "u9", Source: webx.SourcePAT}, nil
		}
		_, url := newHubSrv(t, h, nil)
		c := dial(t, url)
		require.NoError(t, c.WriteJSON(map[string]string{"type": "auth", "token": "tk_good"}))
		f := readFrame(t, c)
		assert.Equal(t, wswire.ConfirmPrefix+wswire.CtrlAuth, f.Type)
		var p struct {
			Capabilities []string `json:"capabilities"`
		}
		require.NoError(t, json.Unmarshal(f.Payload, &p))
		assert.Equal(t, caps, p.Capabilities)
	})

	t.Run("cookie-authenticated connections get an immediate connected frame", func(t *testing.T) {
		h := NewHub(nil)
		h.Capabilities = caps
		p := &webx.Principal{UserID: "u1", Source: webx.SourceSession}
		_, url := newHubSrv(t, h, p)
		c := dial(t, url)
		f := readFrame(t, c)
		assert.Equal(t, wswire.ConnectedFrameType, f.Type)
		var pl struct {
			Capabilities []string `json:"capabilities"`
		}
		require.NoError(t, json.Unmarshal(f.Payload, &pl))
		assert.Equal(t, caps, pl.Capabilities)
	})

	t.Run("undeclared capabilities mean the ack frame has no payload", func(t *testing.T) {
		h := NewHub(nil)
		h.PATResolve = func(_ context.Context, _ string) (*webx.Principal, error) {
			return &webx.Principal{UserID: "u9", Source: webx.SourcePAT}, nil
		}
		_, url := newHubSrv(t, h, nil)
		c := dial(t, url)
		require.NoError(t, c.WriteJSON(map[string]string{"type": "auth", "token": "tk_good"}))
		f := readFrame(t, c)
		assert.Equal(t, wswire.ConfirmPrefix+wswire.CtrlAuth, f.Type)
		assert.Nil(t, f.Payload)
	})
}

func TestUnknownFrameTypeIgnored(t *testing.T) {
	h := NewHub(nil)

	h.Authorize = func(_ context.Context, _ *webx.Principal, _, _, _ string) bool { return true }
	p := &webx.Principal{UserID: "u1", Source: webx.SourceSession}
	_, url := newHubSrv(t, h, p)
	c := dial(t, url)

	require.NoError(t, c.WriteJSON(map[string]any{"type": "future:control", "payload": map[string]string{"x": "y"}}))

	require.NoError(t, c.WriteJSON(map[string]any{"type": "", "token": "whatever"}))

	require.NoError(t, c.WriteMessage(websocket.TextMessage, []byte("not-json")))

	registerTestScope(t)
	require.NoError(t, c.WriteJSON(map[string]string{"type": "subscribe", "scope": testScope, "id": "t1"}))
	f := readFrame(t, c)
	assert.Equal(t, wswire.ConfirmPrefix+wswire.CtrlSubscribe, f.Type)
	noFrame(t, c)
}

func TestSubscribeAuthorization(t *testing.T) {
	registerTestScope(t)
	h := NewHub(nil)
	h.Authorize = func(_ context.Context, p *webx.Principal, connWS, scope, id string) bool {
		return p != nil && connWS == testWS && scope == testScope && id == "t1"
	}
	p := &webx.Principal{UserID: "u1", Source: webx.SourceSession}
	_, url := newHubSrv(t, h, p)
	c := dial(t, url)

	require.NoError(t, c.WriteJSON(map[string]string{"type": "subscribe", "scope": testScope, "id": "t2"}))
	f := readFrame(t, c)
	assert.Equal(t, wswire.RejectedPrefix+wswire.CtrlSubscribe, f.Type)

	require.NoError(t, c.WriteJSON(map[string]string{"type": "subscribe", "scope": testScope, "id": "t1"}))
	f = readFrame(t, c)
	assert.Equal(t, wswire.ConfirmPrefix+wswire.CtrlSubscribe, f.Type)

	h.Broadcast(context.Background(), wswire.ScopeKey(testScope, "t1"), frame(t, "t1f"))
	assert.Equal(t, "t1f", readFrame(t, c).EventID)
}

func TestUnregisteredScopeIgnored(t *testing.T) {
	h := NewHub(nil)
	h.Authorize = func(_ context.Context, _ *webx.Principal, _, _, _ string) bool {
		return true
	}
	p := &webx.Principal{UserID: "u1", Source: webx.SourceSession}
	_, url := newHubSrv(t, h, p)
	c := dial(t, url)

	require.NoError(t, c.WriteJSON(map[string]string{"type": "subscribe", "scope": "ghost", "id": "g1"}))
	noFrame(t, c)
	assert.Equal(t, 0, h.RoomSize(wswire.ScopeKey("ghost", "g1")))
}

func TestProductScopeGuardFailClosed_WX2(t *testing.T) {
	registerTestScope(t)
	p := &webx.Principal{UserID: "u1", Source: webx.SourceSession}
	allowAll := func(_ context.Context, _ *webx.Principal, _, _, _ string) bool { return true }

	sub := func(t *testing.T, c *websocket.Conn, id string) wswire.Frame {
		t.Helper()
		require.NoError(t, c.WriteJSON(map[string]string{"type": "subscribe", "scope": testScope, "id": id}))
		return readFrame(t, c)
	}

	t.Run("Authorize 未注入：已注册 scope 订阅被拒（fail-closed）", func(t *testing.T) {
		h := NewHub(nil)
		_, url := newHubSrv(t, h, p)
		c := dial(t, url)
		f := sub(t, c, "t1")
		assert.Equal(t, wswire.RejectedPrefix+wswire.CtrlSubscribe, f.Type)
		assert.Equal(t, 0, h.RoomSize(wswire.ScopeKey(testScope, "t1")), "不得入住")
	})

	t.Run("Authorize 返回 false：拒绝路径回归", func(t *testing.T) {
		h := NewHub(nil)
		h.Authorize = func(_ context.Context, _ *webx.Principal, _, _, _ string) bool { return false }
		_, url := newHubSrv(t, h, p)
		c := dial(t, url)
		f := sub(t, c, "t1")
		assert.Equal(t, wswire.RejectedPrefix+wswire.CtrlSubscribe, f.Type)
		assert.Equal(t, 0, h.RoomSize(wswire.ScopeKey(testScope, "t1")))
	})

	t.Run("ID 恰 128 字节可见 ASCII：放行", func(t *testing.T) {
		h := NewHub(nil)
		h.Authorize = allowAll
		_, url := newHubSrv(t, h, p)
		c := dial(t, url)
		id := strings.Repeat("a", 128)
		f := sub(t, c, id)
		assert.Equal(t, wswire.ConfirmPrefix+wswire.CtrlSubscribe, f.Type)
		assert.Equal(t, 1, h.RoomSize(wswire.ScopeKey(testScope, id)))
	})

	t.Run("ID 超长（129 字节）：拒绝", func(t *testing.T) {
		h := NewHub(nil)
		h.Authorize = allowAll
		_, url := newHubSrv(t, h, p)
		c := dial(t, url)
		id := strings.Repeat("a", 129)
		f := sub(t, c, id)
		assert.Equal(t, wswire.RejectedPrefix+wswire.CtrlSubscribe, f.Type)
		assert.Equal(t, 0, h.RoomSize(wswire.ScopeKey(testScope, id)), "不得建超长房间键（内存放大防护）")
	})

	t.Run("ID 含控制字符：拒绝", func(t *testing.T) {
		h := NewHub(nil)
		h.Authorize = allowAll
		_, url := newHubSrv(t, h, p)
		c := dial(t, url)
		for _, id := range []string{"a\x00b", "a\nb", "a\tb", "a\x1bb", "a\x7fb", "\x1f"} {
			f := sub(t, c, id)
			assert.Equal(t, wswire.RejectedPrefix+wswire.CtrlSubscribe, f.Type, "id=%q", id)
			assert.Equal(t, 0, h.RoomSize(wswire.ScopeKey(testScope, id)), "id=%q", id)
		}
	})

	t.Run("ID 含非 ASCII（多字节 UTF-8）：拒绝", func(t *testing.T) {
		h := NewHub(nil)
		h.Authorize = allowAll
		_, url := newHubSrv(t, h, p)
		c := dial(t, url)
		f := sub(t, c, "房间-键")
		assert.Equal(t, wswire.RejectedPrefix+wswire.CtrlSubscribe, f.Type)
	})

	t.Run("空 ID：拒绝", func(t *testing.T) {
		h := NewHub(nil)
		h.Authorize = allowAll
		_, url := newHubSrv(t, h, p)
		c := dial(t, url)
		f := sub(t, c, "")
		assert.Equal(t, wswire.RejectedPrefix+wswire.CtrlSubscribe, f.Type)
	})

	t.Run("workspace 房间行为不变（防回归）", func(t *testing.T) {
		h := NewHub(nil)
		h.WorkspaceMember = allowAllWorkspaces
		_, url := newHubSrv(t, h, p)
		c := dial(t, url)
		require.NoError(t, c.WriteJSON(map[string]string{"type": "subscribe", "scope": wswire.ScopeWorkspace, "id": testWS}))
		f := readFrame(t, c)
		assert.Equal(t, wswire.ConfirmPrefix+wswire.CtrlSubscribe, f.Type, "成员闸门放行时 workspace 订阅照常确认")
		require.Eventually(t, func() bool {
			return h.RoomSize(wswire.ScopeKey(wswire.ScopeWorkspace, testWS)) == 1
		}, 2*time.Second, 20*time.Millisecond)
	})
}

func TestWorkspaceRoomMembershipGate_SECV3(t *testing.T) {
	const foreignWS = "22222222-2222-2222-2222-222222222222"

	t.Run("非成员 subscribe 被 rejected，成员放行", func(t *testing.T) {
		h := NewHub(nil)
		h.WorkspaceMember = func(_ context.Context, p *webx.Principal, ws string) bool {
			return p != nil && p.UserID == "u1" && ws == testWS
		}
		p := &webx.Principal{UserID: "u1", Source: webx.SourceSession}
		_, url := newHubSrv(t, h, p)
		c := dial(t, url)

		require.NoError(t, c.WriteJSON(map[string]string{"type": "subscribe", "scope": "workspace", "id": foreignWS}))
		f := readFrame(t, c)
		assert.Equal(t, wswire.RejectedPrefix+wswire.CtrlSubscribe, f.Type)
		assert.Equal(t, 0, h.RoomSize(wswire.ScopeKey(wswire.ScopeWorkspace, foreignWS)))

		require.NoError(t, c.WriteJSON(map[string]string{"type": "subscribe", "scope": "workspace", "id": testWS}))
		f = readFrame(t, c)
		assert.Equal(t, wswire.ConfirmPrefix+wswire.CtrlSubscribe, f.Type)
		h.Broadcast(context.Background(), wswire.ScopeKey(wswire.ScopeWorkspace, testWS), frame(t, "w1"))
		assert.Equal(t, "w1", readFrame(t, c).EventID)
	})

	t.Run("cookie 直入（?workspace_id=）非成员不入房", func(t *testing.T) {
		h := NewHub(nil)
		h.WorkspaceMember = func(_ context.Context, _ *webx.Principal, ws string) bool { return ws == testWS }
		p := &webx.Principal{UserID: "u1", Source: webx.SourceSession}
		_, url := newHubSrv(t, h, p)
		_ = dial(t, url)
		require.Eventually(t, func() bool {
			return h.RoomSize(wswire.ScopeKey(wswire.ScopeWorkspace, testWS)) == 1
		}, 2*time.Second, 20*time.Millisecond, "成员的 cookie 连接应入房")

		mux := http.NewServeMux()
		mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
			r = r.WithContext(webx.WithPrincipal(r.Context(), p))
			h.ServeWS(w, r)
		})
		srv := httptest.NewServer(mux)
		t.Cleanup(srv.Close)
		foreign := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
		c2, _, err := websocket.DefaultDialer.Dial(foreign+"?workspace_id="+foreignWS, nil)
		require.NoError(t, err)
		t.Cleanup(func() { _ = c2.Close() })

		require.Eventually(t, func() bool {
			return h.RoomSize(wswire.ScopeKey(wswire.ScopeUser, "u1")) == 2
		}, 2*time.Second, 20*time.Millisecond, "user 房间不受闸门影响")
		assert.Equal(t, 0, h.RoomSize(wswire.ScopeKey(wswire.ScopeWorkspace, foreignWS)),
			"非成员的 workspace 房间不得入住")
		h.Broadcast(context.Background(), wswire.ScopeKey(wswire.ScopeWorkspace, foreignWS), frame(t, "leak"))
		noFrame(t, c2)
	})

	t.Run("闸门未注入 fail-closed：成员语义无处可查即拒绝", func(t *testing.T) {
		h := NewHub(nil)
		p := &webx.Principal{UserID: "u1", Source: webx.SourceSession}
		_, url := newHubSrv(t, h, p)
		c := dial(t, url)

		require.NoError(t, c.WriteJSON(map[string]string{"type": "subscribe", "scope": "workspace", "id": testWS}))
		f := readFrame(t, c)
		assert.Equal(t, wswire.RejectedPrefix+wswire.CtrlSubscribe, f.Type)
		assert.Equal(t, 0, h.RoomSize(wswire.ScopeKey(wswire.ScopeWorkspace, testWS)))

		require.Eventually(t, func() bool { return h.RoomSize(wswire.ScopeKey(wswire.ScopeUser, "u1")) == 1 },
			2*time.Second, 20*time.Millisecond)
	})

	t.Run("PAT 认证不回溯放行未验证的 workspace_id", func(t *testing.T) {
		h := NewHub(nil)
		h.WorkspaceMember = func(_ context.Context, _ *webx.Principal, ws string) bool { return ws == testWS }
		h.PATResolve = func(_ context.Context, _ string) (*webx.Principal, error) {
			return &webx.Principal{UserID: "u9", Source: webx.SourcePAT}, nil
		}
		_, url := newHubSrv(t, h, nil)
		c := dial(t, url)

		require.NoError(t, c.WriteJSON(map[string]string{"type": "auth", "token": "tk_good"}))
		f := readFrame(t, c)
		assert.Equal(t, wswire.ConfirmPrefix+wswire.CtrlAuth, f.Type)
		require.Eventually(t, func() bool { return h.RoomSize(wswire.ScopeKey(wswire.ScopeUser, "u9")) == 1 },
			2*time.Second, 20*time.Millisecond)
		assert.Equal(t, 0, h.RoomSize(wswire.ScopeKey(wswire.ScopeWorkspace, testWS)),
			"未过闸门的 workspace_id 不得因 PAT 认证回溯入房")
	})
}

func TestOriginCheck(t *testing.T) {
	h := NewHub(nil)
	_, url := newHubSrv(t, h, nil)
	hd := websocket.Dialer{HandshakeTimeout: 2 * time.Second}
	_, resp, err := hd.Dial(url, http.Header{"Origin": []string{"https://evil.example"}})
	require.Error(t, err, "malicious Origin should be rejected")
	if resp != nil {
		assert.Equal(t, http.StatusForbidden, resp.StatusCode)
	}
}

func TestSlowConsumerEvicted(t *testing.T) {
	h := NewHub(nil)
	h.WorkspaceMember = allowAllWorkspaces
	p := &webx.Principal{UserID: "u1", Source: webx.SourceSession}
	_, url := newHubSrv(t, h, p)
	c := dial(t, url)
	scope := wswire.ScopeKey(wswire.ScopeWorkspace, testWS)
	require.Eventually(t, func() bool { return h.RoomSize(scope) == 1 }, 2*time.Second, 20*time.Millisecond)

	for i := 0; i < sendBuffer+32; i++ {
		h.Broadcast(context.Background(), scope, frame(t, "evict-"+strings.Repeat("a", i+1)+time.Now().Format("150405.000000000")))
	}
	require.Eventually(t, func() bool { return h.RoomSize(scope) == 0 }, 3*time.Second, 20*time.Millisecond,
		"slow connections should be evicted from the room")
	_ = c.SetReadDeadline(time.Now().Add(3 * time.Second))
	for {
		var f wswire.Frame
		if err := c.ReadJSON(&f); err != nil {
			break
		}
	}
}

type fakeMetrics struct {
	incr   map[string]int
	gauges map[string]float64
}

func (f *fakeMetrics) Incr(name string) { f.incr[name]++ }
func (f *fakeMetrics) Gauge(name string, v float64) {
	if f.gauges == nil {
		f.gauges = map[string]float64{}
	}
	f.gauges[name] = v
}

func TestWSConnectionGauge(t *testing.T) {
	m := &fakeMetrics{incr: map[string]int{}}
	h := NewHub(nil)
	h.Metrics = m
	p := &webx.Principal{UserID: "u1", Source: webx.SourceSession}
	_, url := newHubSrv(t, h, p)
	c := dial(t, url)
	require.Eventually(t, func() bool { return m.gauges["ws_connections"] == 1 }, 2*time.Second, 20*time.Millisecond)
	_ = c.Close()
	require.Eventually(t, func() bool { return m.gauges["ws_connections"] == 0 }, 3*time.Second, 50*time.Millisecond,
		"connection gauge should return to zero after disconnect")
}

func TestWSEvictionCounted(t *testing.T) {
	m := &fakeMetrics{incr: map[string]int{}}
	h := NewHub(nil)
	h.WorkspaceMember = allowAllWorkspaces
	h.Metrics = m
	p := &webx.Principal{UserID: "u1", Source: webx.SourceSession}
	_, url := newHubSrv(t, h, p)
	c := dial(t, url)
	scope := wswire.ScopeKey(wswire.ScopeWorkspace, testWS)
	require.Eventually(t, func() bool { return h.RoomSize(scope) == 1 }, 2*time.Second, 20*time.Millisecond)
	_ = c

	for i := 0; i < sendBuffer+32; i++ {
		h.Broadcast(context.Background(), scope, frame(t, "evict-"+strings.Repeat("b", i+1)+time.Now().Format("150405.000000000")))
	}
	require.Eventually(t, func() bool { return h.RoomSize(scope) == 0 }, 3*time.Second, 20*time.Millisecond)
	assert.Equal(t, 1, m.incr["ws_evictions"], "eviction count exactly once (concurrent full-buffer collisions deduped by CAS)")
}
