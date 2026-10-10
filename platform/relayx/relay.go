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
}

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
	payload, err := json.Marshal(Envelope{Origin: r.self, Scope: scope, Frame: frame})
	if err != nil {
		r.log.Warn("relayx: marshal envelope failed", "scope", scope, "err", err)
		return
	}
	if err := r.tp.Publish(ctx, payload); err != nil {
		r.log.Warn("relayx: publish failed", "scope", scope, "err", err)
	}
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
		deliver(env)
	})
}
