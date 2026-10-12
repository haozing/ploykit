package relayx

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/haozing/ploykit/platform/ids"
	"github.com/haozing/ploykit/platform/wswire"
)

type Envelope struct {
	Origin string       `json:"origin"`
	Scope  string       `json:"scope"`
	Frame  wswire.Frame `json:"frame"`

	// Hops counts how many instances have relayed this envelope. Every hop
	// that forwards (rather than terminating) the frame must increment it
	// before re-publishing; Run drops frames whose Hops reached MaxHops.
	Hops int `json:"hops,omitempty"`
}

// MaxHops bounds the relay chain: the origin-drop check protects against
// hearing your own broadcast, but a consumer misusing Broadcast as a
// point-to-point deliver (orkome field report) loops the frame between ≥2
// replicas exponentially — the hop cap turns that into a bounded fan with a
// WARN naming the frame instead of silent CPU burn. 4 comfortably exceeds any
// sane fan-out topology.
const MaxHops = 4

type Transport interface {
	Publish(ctx context.Context, payload []byte) error

	Subscribe(ctx context.Context, fn func(payload []byte)) error
}

type Relay struct {
	self string
	tp   Transport
	log  *slog.Logger
}

func NewRelay(self string, tp Transport, log *slog.Logger) *Relay {
	if log == nil {
		log = slog.Default()
	}
	if self == "" {
		self = ids.NewV7().String()
		log.Warn("relayx: empty self origin, generated a random instance id (pass an explicit instance id)", "self", self)
	}
	return &Relay{self: self, tp: tp, log: log}
}

func (r *Relay) PublishOut(ctx context.Context, scope string, frame wswire.Frame) {
	r.publishEnvelope(ctx, Envelope{Origin: r.self, Scope: scope, Frame: frame})
}

// publishEnvelope marshals and publishes; forwarding hops bump Hops first.
func (r *Relay) publishEnvelope(ctx context.Context, env Envelope) {
	payload, err := json.Marshal(env)
	if err != nil {
		r.log.Warn("relayx: marshal envelope failed", "scope", env.Scope, "err", err)
		return
	}
	if err := r.tp.Publish(ctx, payload); err != nil {
		r.log.Warn("relayx: publish failed", "scope", env.Scope, "err", err)
	}
}

// Forward re-publishes a received envelope to the other instances (the hop
// that keeps the chain going). Run's deliver callback handles the local
// delivery; Forward is the only sanctioned way to keep it traveling, and it
// refuses frames at the hop cap.
func (r *Relay) Forward(ctx context.Context, env Envelope) bool {
	if r.hopsExhausted(env) {
		r.log.Warn("relayx: envelope hit the relay hop cap — dropped (a Broadcast/DeliverRemote mix-up loops frames between replicas; deliver locally or DeliverRemote, not both)",
			"origin", env.Origin, "scope", env.Scope, "event", env.Frame.Type, "max_hops", MaxHops)
		return false
	}
	env.Hops++
	env.Origin = r.self
	r.publishEnvelope(ctx, env)
	return true
}

func (r *Relay) hopsExhausted(env Envelope) bool {
	return env.Hops >= MaxHops
}

func (r *Relay) Run(ctx context.Context, deliver func(env Envelope)) error {
	return r.tp.Subscribe(ctx, func(payload []byte) {
		var env Envelope
		if err := json.Unmarshal(payload, &env); err != nil {
			r.log.Warn("relayx: bad envelope skipped", "err", err)
			return
		}
		if env.Origin == r.self {
			return
		}
		if r.hopsExhausted(env) {
			r.log.Warn("relayx: envelope hit the relay hop cap — dropped (a Broadcast/DeliverRemote mix-up loops frames between replicas; deliver locally or DeliverRemote, not both)",
				"origin", env.Origin, "scope", env.Scope, "event", env.Frame.Type, "max_hops", MaxHops)
			return
		}
		deliver(env)
	})
}
