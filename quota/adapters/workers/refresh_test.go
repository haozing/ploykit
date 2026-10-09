package workers

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/quota"
)

func TestRefreshWorker_NameAndShutdown(t *testing.T) {
	w := &RefreshWorker{}
	assert.Equal(t, "quota_grant_refresh", w.Name())

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- w.Run(ctx) }()
	cancel()
	select {
	case err := <-done:
		assert.NoError(t, err)
	case <-time.After(2 * time.Second):
		t.Fatal("Run 未随 ctx 取消退出")
	}
}

func TestRefreshWorker_RefreshesPeriodicGrants(t *testing.T) {
	svc, pool := workerTestDB(t)
	ctx := context.Background()
	ws := seedWS(t, pool)

	_, err := svc.GrantPeriodic(ctx, ws, "tasks_monthly", "monthly_bonus", "wbonus", 10,
		quota.GrantCycleMonthly, time.Now().UTC().AddDate(0, -1, 0))
	require.NoError(t, err)

	w := &RefreshWorker{Service: svc, Every: 30 * time.Millisecond}
	wctx, cancel := context.WithCancel(ctx)
	done := make(chan error, 1)
	go func() { done <- w.Run(wctx) }()
	require.Eventually(t, func() bool {
		var n int
		err := pool.QueryRow(context.Background(),
			`SELECT count(*) FROM quota_grant WHERE workspace_id = $1 AND reason = 'monthly_bonus'`, ws).Scan(&n)
		return err == nil && n >= 2
	}, 5*time.Second, 20*time.Millisecond, "worker 应在数个 tick 内补发当期周期额度")
	cancel()
	select {
	case err := <-done:
		assert.NoError(t, err)
	case <-time.After(2 * time.Second):
		t.Fatal("worker 未随 ctx 取消退出")
	}
}
