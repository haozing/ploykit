package wswire

import (
	"encoding/json"
	"testing"
)

// F16: control fields must decode from both wire shapes — the flat form and
// the nested {type,payload:{...}} form the JS WsClient's send() encodes.
func TestDecodeControl_BothShapes(t *testing.T) {
	t.Run("flat form", func(t *testing.T) {
		cf, ok := DecodeControl([]byte(`{"type":"subscribe","scope":"task","id":"42"}`))
		if !ok {
			t.Fatal("decode failed")
		}
		if cf.Type != "subscribe" || cf.Scope != "task" || cf.ID != "42" {
			t.Fatalf("got %+v", cf)
		}
	})
	t.Run("nested payload form (JS WsClient send)", func(t *testing.T) {
		cf, ok := DecodeControl([]byte(`{"type":"subscribe","payload":{"scope":"task","id":"42"}}`))
		if !ok {
			t.Fatal("decode failed")
		}
		if cf.Scope != "task" || cf.ID != "42" {
			t.Fatalf("nested fields not normalized: %+v", cf)
		}
	})
	t.Run("nested auth form", func(t *testing.T) {
		cf, ok := DecodeControl([]byte(`{"type":"auth","payload":{"token":"tk_x"}}`))
		if !ok {
			t.Fatal("decode failed")
		}
		if cf.Token != "tk_x" {
			t.Fatalf("token not normalized: %+v", cf)
		}
	})
	t.Run("top-level wins over payload", func(t *testing.T) {
		cf, ok := DecodeControl([]byte(`{"type":"subscribe","scope":"workspace","id":"A","payload":{"scope":"task","id":"B"}}`))
		if !ok {
			t.Fatal("decode failed")
		}
		if cf.Scope != "workspace" || cf.ID != "A" {
			t.Fatalf("top level must win: %+v", cf)
		}
	})
	t.Run("non-object payload tolerated", func(t *testing.T) {
		cf, ok := DecodeControl([]byte(`{"type":"subscribe","payload":"opaque"}`))
		if !ok {
			t.Fatal("decode failed")
		}
		if cf.Scope != "" || cf.ID != "" {
			t.Fatalf("unexpected fields: %+v", cf)
		}
	})
	t.Run("unparseable rejected", func(t *testing.T) {
		if _, ok := DecodeControl([]byte(`{nope`)); ok {
			t.Fatal("must reject malformed json")
		}
	})
	t.Run("payload stays raw for callers that need it", func(t *testing.T) {
		cf, _ := DecodeControl([]byte(`{"type":"x","payload":{"a":1}}`))
		var probe struct {
			A int `json:"a"`
		}
		if err := json.Unmarshal(cf.Payload, &probe); err != nil || probe.A != 1 {
			t.Fatalf("payload must remain raw json: %v %+v", err, probe)
		}
	})
}
