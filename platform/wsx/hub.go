package wsx

import (
	"context"
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"

	"github.com/haozing/ploykit/platform/ids"
	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/platform/wswire"
)

const (
	sendBuffer = 16
	dedupDepth = 128
	readLimit  = 64 << 10
	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
	pingPeriod = 25 * time.Second
	maxOrigins = 32

	maxSubscribeIDLen = 128

	// DefaultPATPrefix is the fallback PAT token prefix for Hub.PATPrefix when
	// empty. It aliases webx.DefaultPATPrefix — the canonical constant of the
	// PAT chain (identity/domain mints, webx parses, wsx authenticates the
	// first WS frame); the internal/arch parity test pins them together.
	DefaultPATPrefix = webx.DefaultPATPrefix
)

var (
	authGrace = 30 * time.Second

	subscribeRateWindow = time.Minute
	subscribeRateLimit  = 30
)

type Broadcaster interface {
	Broadcast(ctx context.Context, scope string, frame wswire.Frame)
	SendToUser(ctx context.Context, userID string, frame wswire.Frame)
}

type Metrics interface {
	Incr(name string)
	Gauge(name string, v float64)
}

type Authorize func(ctx context.Context, p *webx.Principal, connWorkspace, scopePrefix, id string) bool

type WorkspaceMember func(ctx context.Context, p *webx.Principal, workspaceID string) bool

type PATResolve func(ctx context.Context, token string) (*webx.Principal, error)

type Hub struct {
	mu    sync.RWMutex
	rooms map[string]map[*client]struct{}

	conns atomic.Int64

	Log *slog.Logger

	Metrics Metrics

	Authorize Authorize

	WorkspaceMember WorkspaceMember

	PATResolve PATResolve

	PATPrefix string

	OnSubscribe   func(scope string)
	OnUnsubscribe func(scope string)

	AllowedOrigins []string

	Capabilities []string

	originCapOnce sync.Once

	Relay interface {
		PublishOut(ctx context.Context, scope string, frame wswire.Frame)
	}

	upgrader websocket.Upgrader
}

func NewHub(log *slog.Logger) *Hub {
	return &Hub{
		rooms: make(map[string]map[*client]struct{}),
		Log:   log,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  4096,
			WriteBufferSize: 4096,
			CheckOrigin:     func(*http.Request) bool { return true },
		},
	}
}

func (h *Hub) Broadcast(ctx context.Context, scope string, frame wswire.Frame) {
	h.broadcastLocal(scope, frame)
	if h.Relay != nil {
		h.Relay.PublishOut(ctx, scope, frame)
	}
}

func (h *Hub) BroadcastEvent(ctx context.Context, scope, event string, payload []byte, eventID string) error {
	if eventID == "" {
		eventID = ids.NewV7().String()
	}
	h.Broadcast(ctx, scope, wswire.Frame{Type: event, Payload: payload, EventID: eventID})
	return nil
}

func (h *Hub) DeliverRemote(scope string, frame wswire.Frame) {
	h.broadcastLocal(scope, frame)
}

func (h *Hub) broadcastLocal(scope string, frame wswire.Frame) {
	data, err := json.Marshal(frame)
	if err != nil {
		return
	}
	h.mu.RLock()
	room := h.rooms[scope]
	if room == nil {
		h.mu.RUnlock()
		return
	}
	targets := make([]*client, 0, len(room))
	for c := range room {
		targets = append(targets, c)
	}
	h.mu.RUnlock()
	for _, c := range targets {
		c.deliver(frame.EventID, data)
	}
}

func (h *Hub) SendToUser(ctx context.Context, userID string, frame wswire.Frame) {
	h.Broadcast(ctx, wswire.ScopeKey(wswire.ScopeUser, userID), frame)
}

func (h *Hub) Rooms() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.rooms)
}

func (h *Hub) RoomSize(scope string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.rooms[scope])
}

func (h *Hub) subscribed(c *client, scope string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	_, ok := c.scopes[scope]
	return ok
}

func (h *Hub) join(c *client, scope string) {
	var created bool
	h.mu.Lock()
	if h.rooms[scope] == nil {
		h.rooms[scope] = make(map[*client]struct{})
		created = true
	}
	c.scopes[scope] = struct{}{}
	h.rooms[scope][c] = struct{}{}
	h.mu.Unlock()

	if created && h.OnSubscribe != nil {
		h.OnSubscribe(scope)
	}
}

func (h *Hub) leave(c *client, scope string) {
	var emptied bool
	h.mu.Lock()
	if room := h.rooms[scope]; room != nil {
		delete(room, c)
		if len(room) == 0 {
			delete(h.rooms, scope)
			emptied = true
		}
	}
	delete(c.scopes, scope)
	h.mu.Unlock()

	if emptied && h.OnUnsubscribe != nil {
		h.OnUnsubscribe(scope)
	}
}

func (h *Hub) drop(c *client) {

	if !c.dropped.CompareAndSwap(false, true) {
		return
	}
	var emptied []string
	h.mu.Lock()
	for scope := range c.scopes {
		if room := h.rooms[scope]; room != nil {
			delete(room, c)
			if len(room) == 0 {
				delete(h.rooms, scope)
				emptied = append(emptied, scope)
			}
		}
	}
	h.mu.Unlock()

	if h.OnUnsubscribe != nil {
		for _, scope := range emptied {
			h.OnUnsubscribe(scope)
		}
	}
	h.conns.Add(-1)
	h.observeConns()
}

func (h *Hub) observeConns() {
	if h.Metrics != nil {
		h.Metrics.Gauge("ws_connections", float64(h.conns.Load()))
	}
}

func (h *Hub) joinWorkspace(c *client, workspaceID string) bool {
	if workspaceID == "" || c.principal == nil || h.WorkspaceMember == nil {
		return false
	}
	if !h.WorkspaceMember(context.Background(), c.principal, workspaceID) {
		return false
	}
	h.join(c, wswire.ScopeKey(wswire.ScopeWorkspace, workspaceID))
	return true
}

func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	if !h.originOK(r) {
		http.Error(w, "origin not allowed", http.StatusForbidden)
		return
	}
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	h.conns.Add(1)
	h.observeConns()
	p := webx.PrincipalFrom(r.Context())
	connWS := wsHeader(r)
	c := &client{
		hub: h, conn: conn, send: make(chan []byte, sendBuffer),
		scopes: make(map[string]struct{}), dedup: make(map[string]struct{}, dedupDepth),
		principal: p, authed: p != nil, connWS: connWS,
	}
	if p != nil {

		h.joinWorkspace(c, connWS)
		h.join(c, wswire.ScopeKey(wswire.ScopeUser, p.UserID))

		if len(h.Capabilities) > 0 {
			c.sendJSON(wswire.ConnectedFrameType, h.capabilitiesPayload())
		}
	}
	go c.writePump()
	go c.readPump()
}

func (h *Hub) capabilitiesPayload() any {
	if len(h.Capabilities) == 0 {
		return nil
	}
	return map[string]any{"capabilities": h.Capabilities}
}

func wsHeader(r *http.Request) string {

	return r.URL.Query().Get("workspace_id")
}

func (h *Hub) originOK(r *http.Request) bool {
	orig := r.Header.Get("Origin")
	if orig == "" {
		return true
	}
	if sameOrigin(orig, r.Host) {
		return true
	}
	allowed := h.AllowedOrigins
	if len(allowed) > maxOrigins {
		h.originCapOnce.Do(func() {
			if h.Log != nil {
				h.Log.Error("wsx: AllowedOrigins exceeds maxOrigins, extra entries ignored",
					"configured", len(allowed), "effective", maxOrigins)
			}
		})
		allowed = allowed[:maxOrigins]
	}
	if len(allowed) == 0 {
		return false
	}
	for _, a := range allowed {
		if a == "*" || a == orig {
			return true
		}
	}
	return false
}

func sameOrigin(orig, reqHost string) bool {
	u, err := url.Parse(orig)
	if err != nil {
		return false
	}
	defPort := "80"
	if u.Scheme == "https" {
		defPort = "443"
	}
	oHost := strings.ToLower(u.Hostname())
	oPort := u.Port()
	if oPort == "" {
		oPort = defPort
	}
	rHost, rPort, err := net.SplitHostPort(reqHost)
	if err != nil {

		rHost, rPort = strings.ToLower(strings.Trim(reqHost, "[]")), defPort
	}
	return oHost == rHost && oPort == rPort
}

func (h *Hub) patPrefix() string {
	if h.PATPrefix == "" {
		return DefaultPATPrefix
	}
	return h.PATPrefix
}

func (h *Hub) handleControl(c *client, raw []byte) {
	var in struct {
		Type  string `json:"type"`
		Token string `json:"token"`
		Scope string `json:"scope"`
		ID    string `json:"id"`
	}
	if json.Unmarshal(raw, &in) != nil {
		return
	}
	switch in.Type {
	case wswire.CtrlAuth:
		if c.authed {
			return
		}
		if h.PATResolve == nil || !strings.HasPrefix(in.Token, h.patPrefix()) {
			c.sendJSON(wswire.RejectedPrefix+wswire.CtrlAuth, nil)
			return
		}
		p, err := h.PATResolve(context.Background(), in.Token)
		if err != nil || p == nil {
			c.sendJSON(wswire.RejectedPrefix+wswire.CtrlAuth, nil)
			return
		}
		c.principal, c.authed = p, true
		h.join(c, wswire.ScopeKey(wswire.ScopeUser, p.UserID))
		c.sendJSON(wswire.ConfirmPrefix+wswire.CtrlAuth, h.capabilitiesPayload())
	case wswire.CtrlSubscribe:
		if !c.authed {
			c.sendJSON(wswire.RejectedPrefix+wswire.CtrlSubscribe, nil)
			return
		}

		if !c.allowSubscribe(time.Now()) {
			c.sendJSON(wswire.RejectedPrefix+wswire.CtrlSubscribe, map[string]string{"scope": in.Scope})
			return
		}
		switch in.Scope {
		case wswire.ScopeWorkspace:

			if h.subscribed(c, wswire.ScopeKey(wswire.ScopeWorkspace, in.ID)) {
				c.sendJSON(wswire.ConfirmPrefix+wswire.CtrlSubscribe, map[string]string{"scope": in.Scope})
				return
			}

			if ws := in.ID; ws != "" && h.joinWorkspace(c, ws) {
				c.sendJSON(wswire.ConfirmPrefix+wswire.CtrlSubscribe, map[string]string{"scope": in.Scope})
				return
			}
			c.sendJSON(wswire.RejectedPrefix+wswire.CtrlSubscribe, map[string]string{"scope": in.Scope})
		default:

			if !wswire.IsRegisteredScope(in.Scope) {
				return
			}

			if !validSubscribeID(in.ID) {
				c.sendJSON(wswire.RejectedPrefix+wswire.CtrlSubscribe, map[string]string{"scope": in.Scope})
				return
			}

			if h.subscribed(c, wswire.ScopeKey(in.Scope, in.ID)) {
				c.sendJSON(wswire.ConfirmPrefix+wswire.CtrlSubscribe, map[string]string{"scope": in.Scope})
				return
			}

			if h.Authorize == nil || !h.Authorize(context.Background(), c.principal, c.connWS, in.Scope, in.ID) {
				c.sendJSON(wswire.RejectedPrefix+wswire.CtrlSubscribe, map[string]string{"scope": in.Scope})
				return
			}
			h.join(c, wswire.ScopeKey(in.Scope, in.ID))
			c.sendJSON(wswire.ConfirmPrefix+wswire.CtrlSubscribe, map[string]string{"scope": in.Scope})
		}
	case wswire.CtrlUnsub:
		if in.Scope != "" && in.ID != "" {
			h.leave(c, wswire.ScopeKey(in.Scope, in.ID))
		}
	}
}

func validSubscribeID(id string) bool {
	if len(id) == 0 || len(id) > maxSubscribeIDLen {
		return false
	}
	for i := 0; i < len(id); i++ {
		if id[i] < 0x20 || id[i] > 0x7e {
			return false
		}
	}
	return true
}
