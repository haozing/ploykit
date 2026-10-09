package settings

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func Bootstrap(pool *pgxpool.Pool, envLookup func(string) string) (*Store, error) {
	s := &Store{pool: pool, env: envLookup}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for _, key := range KeyOrder {
		_, found, err := s.Get(ctx, key)
		if err != nil {
			return nil, fmt.Errorf("settings bootstrap get %s: %w", key, err)
		}
		if found {
			continue
		}
		init := s.effectiveValue(key, "", false)
		if err := s.Set(ctx, key, init, "bootstrap"); err != nil {
			return nil, fmt.Errorf("settings bootstrap set %s: %w", key, err)
		}
	}
	return s, nil
}
