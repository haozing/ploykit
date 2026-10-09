package webx

import (
	"github.com/jackc/pgx/v5/pgxpool"
)

func PoolStats(pool *pgxpool.Pool) (acquired, idle, total int32) {
	s := pool.Stat()
	return s.AcquiredConns(), s.IdleConns(), s.TotalConns()
}
