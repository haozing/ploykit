package redisx

import (
	"context"
	"time"

	"github.com/go-redis/redis_rate/v10"
	"github.com/haozing/ploykit/platform/webx"
	"github.com/redis/go-redis/v9"
)

type GCRALimiter struct {
	limiter *redis_rate.Limiter
}

func NewGCRALimiter(cli redis.UniversalClient) *GCRALimiter {
	return &GCRALimiter{limiter: redis_rate.NewLimiter(cli)}
}

func (g *GCRALimiter) Allow(ctx context.Context, key string, perMinute int) (bool, time.Duration) {
	res, err := g.limiter.Allow(ctx, key, redis_rate.PerMinute(perMinute))
	if err != nil {

		return true, 0
	}
	return res.Allowed > 0, res.RetryAfter
}

var _ webx.Limiter = (*GCRALimiter)(nil)
