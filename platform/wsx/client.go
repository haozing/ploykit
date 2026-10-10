package wsx

import (
	"encoding/json"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"

	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/platform/wswire"
)

type client struct {
	hub        *Hub
	conn       *websocket.Conn
	send       chan []byte
	scopes     map[string]struct{}
	dedupMu    sync.Mutex
	dedup      map[string]struct{}
	dedupOrder []string
	dropped    atomic.Bool
	evicted    atomic.Bool
	principal  *webx.Principal
	authed     bool
	connWS     string

	subMu    sync.Mutex
	subCount int
	subReset time.Time
}

func (c *client) deliver(eventID string, data []byte) {
	if eventID != "" {
		c.dedupMu.Lock()
		if _, seen := c.dedup[eventID]; seen {
			c.dedupMu.Unlock()
			return
		}
		c.dedup[eventID] = struct{}{}
		c.dedupOrder = append(c.dedupOrder, eventID)
		if len(c.dedupOrder) > dedupDepth {
			oldest := c.dedupOrder[0]
			c.dedupOrder = c.dedupOrder[1:]
			delete(c.dedup, oldest)
		}
		c.dedupMu.Unlock()
	}
	select {
	case c.send <- data:
	default:

		if c.hub.Metrics != nil && c.evicted.CompareAndSwap(false, true) {
			c.hub.Metrics.Incr("ws_evictions")
		}
		c.close()
	}
}

func (c *client) sendJSON(frameType string, payload any) {
	data, err := json.Marshal(wswire.Frame{Type: frameType})
	if payload != nil {
		p, _ := json.Marshal(payload)
		data, err = json.Marshal(wswire.Frame{Type: frameType, Payload: p})
	}
	if err != nil {
		return
	}
	select {
	case c.send <- data:
	default:
	}
}

func (c *client) close() {
	_ = c.conn.WriteControl(websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "slow consumer"), time.Now().Add(writeWait))
	_ = c.conn.Close()
}

func (c *client) allowSubscribe(now time.Time) bool {
	c.subMu.Lock()
	defer c.subMu.Unlock()
	if c.subReset.IsZero() || now.Sub(c.subReset) >= subscribeRateWindow {
		c.subReset = now
		c.subCount = 0
	}
	if c.subCount >= subscribeRateLimit {
		return false
	}
	c.subCount++
	return true
}

func (c *client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer ticker.Stop()
	for {
		select {
		case data, ok := <-c.send:
			if !ok {
				return
			}
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.TextMessage, data); err != nil {
				c.hub.drop(c)
				_ = c.conn.Close()
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				c.hub.drop(c)
				_ = c.conn.Close()
				return
			}
		}
	}
}

func (c *client) readPump() {
	defer func() {
		c.hub.drop(c)
		_ = c.conn.Close()
	}()
	c.conn.SetReadLimit(readLimit)
	_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {

		if !c.authed {
			return nil
		}
		return c.conn.SetReadDeadline(time.Now().Add(pongWait))
	})
	if !c.authed {

		_ = c.conn.SetReadDeadline(time.Now().Add(authGrace))
	}
	for {
		mt, data, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		if mt != websocket.TextMessage {
			continue
		}
		c.hub.handleControl(c, data)
		if c.authed {
			_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
		}
	}
}
