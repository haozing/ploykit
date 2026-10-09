package relayx

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"
)

const Channel = "ploykit:relay:v1"

var (
	redisRetryBaseBackoff = 500 * time.Millisecond
	redisRetryMaxBackoff  = 30 * time.Second
)

const subChanSize = 128

type RedisTransport struct {
	client redis.UniversalClient
}

func NewRedisTransport(client redis.UniversalClient) Transport {
	return &RedisTransport{client: client}
}

func (t *RedisTransport) Publish(ctx context.Context, payload []byte) error {
	return t.client.Publish(ctx, Channel, payload).Err()
}

func (t *RedisTransport) Subscribe(ctx context.Context, fn func(payload []byte)) error {
	backoff := redisRetryBaseBackoff
	for attempt := 1; ; attempt++ {
		err := t.subscribeOnce(ctx, fn)
		if ctx.Err() != nil {
			return nil
		}
		slog.Warn("relayx: redis subscribe dropped, resubscribing",
			"channel", Channel, "attempt", attempt, "backoff", backoff, "err", err)
		select {
		case <-time.After(backoff):
		case <-ctx.Done():
			return nil
		}
		backoff = min(2*backoff, redisRetryMaxBackoff)
	}
}

func (t *RedisTransport) subscribeOnce(ctx context.Context, fn func(payload []byte)) error {
	sub := t.client.Subscribe(ctx, Channel)
	defer sub.Close()
	if _, err := sub.Receive(ctx); err != nil {
		return err
	}

	ch := sub.Channel(redis.WithChannelSize(subChanSize))
	for {
		select {
		case <-ctx.Done():
			return nil
		case msg, ok := <-ch:
			if !ok {
				return errors.New("relayx: redis pubsub channel closed")
			}
			fn([]byte(msg.Payload))
		}
	}
}
