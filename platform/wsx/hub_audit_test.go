package wsx

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/platform/wswire"
)

func TestAuthGraceZombieEvicted(t *testing.T) {
	oldGrace := authGrace
	authGrace = 400 * time.Millisecond
	defer func() { authGrace = oldGrace }()

	t.Run("未认证僵尸被驱逐", func(t *testing.T) {
		h := NewHub(nil)
		_, url := newHubSrv(t, h, nil)
		c := dial(t, url)

		stop := make(chan struct{})
		go func() {
			tick := time.NewTicker(80 * time.Millisecond)
			defer tick.Stop()
			for {
				select {
				case <-stop:
					return
				case <-tick.C:
					_ = c.WriteControl(websocket.PongMessage, nil, time.Now().Add(time.Second))
				}
			}
		}()
		defer close(stop)

		_ = c.SetReadDeadline(time.Now().Add(3 * time.Second))
		_, _, err := c.ReadMessage()
		require.Error(t, err, "只回 pong 的未认证连接必须在 authGrace 内被逐（旧实现被续到 60s）")
	})

	t.Run("已认证连接的 pong 保活不受影响", func(t *testing.T) {
		h := NewHub(nil)
		p := &webx.Principal{UserID: "u1", Source: webx.SourceSession}
		_, url := newHubSrv(t, h, p)
		c := dial(t, url)
		require.Eventually(t, func() bool {
			return h.RoomSize(wswire.ScopeKey(wswire.ScopeUser, "u1")) == 1
		}, 2*time.Second, 20*time.Millisecond)

		stop := make(chan struct{})
		go func() {
			tick := time.NewTicker(80 * time.Millisecond)
			defer tick.Stop()
			for {
				select {
				case <-stop:
					return
				case <-tick.C:
					_ = c.WriteControl(websocket.PongMessage, nil, time.Now().Add(time.Second))
				}
			}
		}()
		defer close(stop)

		time.Sleep(600 * time.Millisecond)
		h.SendToUser(context.Background(), "u1", frame(t, "alive"))
		_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
		f := readFrame(t, c)
		assert.Equal(t, "alive", f.EventID, "认证连接过了 authGrace 仍可收帧（pong 保活正常）")
	})
}

func TestSameOrigin(t *testing.T) {
	cases := []struct {
		orig, host string
		want       bool
	}{
		{"http://h", "h", true},
		{"http://h:80", "h", true},
		{"https://h:443", "h", true},
		{"http://h:80", "h:80", true},
		{"http://h", "h:80", true},
		{"https://h", "h:443", true},
		{"http://h:8080", "h", false},
		{"http://h:80", "h:8080", false},
		{"https://h", "h", true},
		{"http://h:80", "https://h", false},
		{"http://evil.example", "h", false},
	}
	for _, tc := range cases {
		assert.Equal(t, tc.want, sameOrigin(tc.orig, tc.host), "origin=%q host=%q", tc.orig, tc.host)
	}
}

func TestOriginMatrix(t *testing.T) {
	dialWithOrigin := func(t *testing.T, h *Hub, origin string) error {
		t.Helper()
		_, url := newHubSrv(t, h, nil)
		d := websocket.Dialer{HandshakeTimeout: 2 * time.Second}
		_, _, err := d.Dial(url, http.Header{"Origin": []string{origin}})
		return err
	}

	t.Run("白名单精确匹配", func(t *testing.T) {
		h := NewHub(nil)
		h.AllowedOrigins = []string{"https://app.example"}
		require.Error(t, dialWithOrigin(t, h, "https://other.example"))
		require.NoError(t, dialWithOrigin(t, h, "https://app.example"))
	})

	t.Run("通配 *", func(t *testing.T) {
		h := NewHub(nil)
		h.AllowedOrigins = []string{"*"}
		require.NoError(t, dialWithOrigin(t, h, "https://anything.example"))
	})

	t.Run("空 Origin 放行", func(t *testing.T) {
		h := NewHub(nil)
		require.NoError(t, dialWithOrigin(t, h, ""))
	})

	t.Run("无白名单跨源拒绝", func(t *testing.T) {
		h := NewHub(nil)
		require.Error(t, dialWithOrigin(t, h, "https://evil.example"))
	})

	t.Run("同源放行优先于白名单", func(t *testing.T) {
		h := NewHub(nil)
		h.AllowedOrigins = []string{"https://dev.example"}
		_, url := newHubSrv(t, h, nil)
		host := strings.TrimPrefix(url, "ws://")
		d := websocket.Dialer{HandshakeTimeout: 2 * time.Second}
		_, _, err := d.Dial(url, http.Header{"Origin": []string{"http://" + host}})
		require.NoError(t, err, "同源（含显式默认端口形态）必须放行，不得被白名单短路 403")
	})
}

func TestAllowedOriginsCap(t *testing.T) {
	h := NewHub(nil)
	origins := make([]string, maxOrigins+4)
	for i := range origins {
		origins[i] = "https://o" + strings.Repeat("a", i) + ".example"
	}
	over := "https://beyond-cap.example"
	origins = append(origins, over)
	h.AllowedOrigins = origins

	assert.False(t, h.originOK(&http.Request{Host: "h", Header: http.Header{
		"Origin": []string{over}}}), "超出 maxOrigins 的白名单条目不得生效")
	assert.True(t, h.originOK(&http.Request{Host: "h", Header: http.Header{
		"Origin": []string{origins[0]}}}), "前 maxOrigins 条照常生效")
}

func TestCallbackOutsideLock(t *testing.T) {

	probe := func(h *Hub) bool {
		ok := make(chan struct{})
		go func() {
			_ = h.RoomSize("any")
			close(ok)
		}()
		select {
		case <-ok:
			return true
		case <-time.After(2 * time.Second):
			return false
		}
	}
	subOK := make(chan bool, 8)
	unsubOK := make(chan bool, 8)

	h := NewHub(nil)
	h.WorkspaceMember = allowAllWorkspaces
	h.OnSubscribe = func(string) { subOK <- probe(h) }
	h.OnUnsubscribe = func(string) { unsubOK <- probe(h) }

	p := &webx.Principal{UserID: "u1", Source: webx.SourceSession}
	_, url := newHubSrv(t, h, p)
	c := dial(t, url)
	scope := wswire.ScopeKey(wswire.ScopeWorkspace, testWS)
	require.Eventually(t, func() bool { return h.RoomSize(scope) == 1 }, 2*time.Second, 20*time.Millisecond)
	select {
	case ok := <-subOK:
		require.True(t, ok, "OnSubscribe 回调内 RoomSize 死锁（回调未移出写锁）")
	case <-time.After(3 * time.Second):
		t.Fatal("OnSubscribe 未触发")
	}

	require.NoError(t, c.WriteJSON(map[string]string{"type": "unsubscribe", "scope": "workspace", "id": testWS}))
	require.Eventually(t, func() bool { return h.RoomSize(scope) == 0 }, 2*time.Second, 20*time.Millisecond)
	select {
	case ok := <-unsubOK:
		require.True(t, ok, "OnUnsubscribe 回调内 RoomSize 死锁（回调未移出写锁）")
	case <-time.After(3 * time.Second):
		t.Fatal("OnUnsubscribe 未触发")
	}
}

func TestSubscribeDupShortCircuitAndRate(t *testing.T) {
	registerTestScope(t)

	t.Run("重复订阅短路产品回调", func(t *testing.T) {
		h := NewHub(nil)
		h.WorkspaceMember = allowAllWorkspaces
		memberCalls := 0
		h.WorkspaceMember = func(context.Context, *webx.Principal, string) bool {
			memberCalls++
			return true
		}
		authCalls := 0
		h.Authorize = func(_ context.Context, _ *webx.Principal, _, _, _ string) bool {
			authCalls++
			return true
		}
		p := &webx.Principal{UserID: "u1", Source: webx.SourceSession}
		_, url := newHubSrv(t, h, p)
		c := dial(t, url)

		sub := func(scope, id string) {
			require.NoError(t, c.WriteJSON(map[string]string{"type": "subscribe", "scope": scope, "id": id}))
			f := readFrame(t, c)
			assert.Equal(t, wswire.ConfirmPrefix+wswire.CtrlSubscribe, f.Type, "scope=%s id=%s", scope, id)
		}
		sub("workspace", testWS)
		sub(testScope, "t1")
		sub("workspace", testWS)
		sub(testScope, "t1")
		assert.Equal(t, 1, memberCalls, "重复的 workspace 订阅不得再过成员闸门")
		assert.Equal(t, 1, authCalls, "重复的产品 scope 订阅不得再触 Authorize")
		assert.Equal(t, 1, h.RoomSize(wswire.ScopeKey(wswire.ScopeWorkspace, testWS)))
		assert.Equal(t, 1, h.RoomSize(wswire.ScopeKey(testScope, "t1")))
	})

	t.Run("窗口内超限拒帧", func(t *testing.T) {
		oldLimit := subscribeRateLimit
		subscribeRateLimit = 2
		defer func() { subscribeRateLimit = oldLimit }()

		h := NewHub(nil)
		h.Authorize = func(_ context.Context, _ *webx.Principal, _, _, _ string) bool { return true }
		p := &webx.Principal{UserID: "u1", Source: webx.SourceSession}
		_, url := newHubSrv(t, h, p)
		c := dial(t, url)

		for i := 0; i < 2; i++ {
			require.NoError(t, c.WriteJSON(map[string]string{"type": "subscribe", "scope": testScope, "id": "r" + strings.Repeat("x", i+1)}))
			f := readFrame(t, c)
			assert.Equal(t, wswire.ConfirmPrefix+wswire.CtrlSubscribe, f.Type)
		}
		require.NoError(t, c.WriteJSON(map[string]string{"type": "subscribe", "scope": testScope, "id": "r-over"}))
		f := readFrame(t, c)
		assert.Equal(t, wswire.RejectedPrefix+wswire.CtrlSubscribe, f.Type, "窗口内第 3 次订阅必须被速率闸拒绝")
	})
}

func TestUnsubscribeLeavePath(t *testing.T) {
	unsubbed := make(chan string, 1)
	h := NewHub(nil)
	h.WorkspaceMember = allowAllWorkspaces
	h.OnUnsubscribe = func(scope string) { unsubbed <- scope }
	p := &webx.Principal{UserID: "u1", Source: webx.SourceSession}
	_, url := newHubSrv(t, h, p)
	c := dial(t, url)
	scope := wswire.ScopeKey(wswire.ScopeWorkspace, testWS)
	require.Eventually(t, func() bool { return h.RoomSize(scope) == 1 }, 2*time.Second, 20*time.Millisecond)

	require.NoError(t, c.WriteJSON(map[string]string{"type": "unsubscribe", "scope": "workspace", "id": testWS}))
	require.Eventually(t, func() bool { return h.RoomSize(scope) == 0 }, 2*time.Second, 20*time.Millisecond,
		"unsubscribe 必须真正离开房间")
	select {
	case got := <-unsubbed:
		assert.Equal(t, scope, got, "房间清空触发 OnUnsubscribe")
	case <-time.After(2 * time.Second):
		t.Fatal("OnUnsubscribe 未触发")
	}
	h.Broadcast(context.Background(), scope, frame(t, "after-unsub"))
	noFrame(t, c)
}

func TestReadLimitOversizedMessage(t *testing.T) {
	h := NewHub(nil)
	h.WorkspaceMember = allowAllWorkspaces
	p := &webx.Principal{UserID: "u1", Source: webx.SourceSession}
	_, url := newHubSrv(t, h, p)
	c := dial(t, url)
	scope := wswire.ScopeKey(wswire.ScopeWorkspace, testWS)
	require.Eventually(t, func() bool { return h.RoomSize(scope) == 1 }, 2*time.Second, 20*time.Millisecond)

	big := strings.Repeat("x", readLimit+1024)
	require.NoError(t, c.WriteMessage(websocket.TextMessage, []byte(big)))
	require.Eventually(t, func() bool { return h.RoomSize(scope) == 0 }, 3*time.Second, 20*time.Millisecond,
		"超限帧必须导致连接被断（readLimit 生效）")
}
