package quota

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/webx"
)

func TestConsume_RejectsNonPositive_P2_6(t *testing.T) {
	svc := NewService(nil)
	ctx := context.Background()
	now := time.Now().UTC()

	for _, n := range []int64{0, -1, -100} {
		err := svc.Consume(ctx, "ws", "tasks_monthly", n, now)
		var we *webx.Error
		require.ErrorAs(t, err, &we, "n=%d", n)
		assert.Equal(t, 400, we.Status, "n=%d 应为 E_VALIDATION", n)
		assert.Equal(t, webx.CodeValidation, we.Code, "n=%d", n)

		_, err = svc.ConsumeWith(ctx, "ws", "tasks_monthly", n, now, ConsumeOpts{IdemKey: "k"})
		require.ErrorAs(t, err, &we, "ConsumeWith n=%d 同样拒绝", n)
	}
}

func TestConsume_CountsReservations_HardAdmission_P2_7(t *testing.T) {
	pool := testPool(t)
	ws := seedWS(t, pool)
	ctx := context.Background()
	now := time.Now().UTC()
	svc := NewService(pool)

	rr, err := svc.Reserve(ctx, ws, "tasks_monthly", 45, "mix-res-1", ReserveOpts{})
	require.NoError(t, err)

	err = svc.Consume(ctx, ws, "tasks_monthly", 10, now)
	var we *webx.Error
	require.ErrorAs(t, err, &we, "混用两层不得超卖")
	assert.Equal(t, 402, we.Status, "硬准入 402 E_QUOTA_EXCEEDED")

	_, err = svc.Settle(ctx, rr.ReservationID, 40, "mix-settle-1")
	require.NoError(t, err)
	require.NoError(t, svc.Consume(ctx, ws, "tasks_monthly", 10, now))
	used, _, err := svc.Usage(ctx, ws, "tasks_monthly", Period(now))
	require.NoError(t, err)
	assert.Equal(t, int64(50), used, "总量恰好 50，无超卖无双重计数")

	err = svc.Consume(ctx, ws, "tasks_monthly", 1, now)
	require.ErrorAs(t, err, &we)
	assert.Equal(t, 402, we.Status)
}

func TestConsume_ConcurrentNoOversell_P3_16(t *testing.T) {
	pool := testPool(t)
	ws := seedWS(t, pool)
	ctx := context.Background()
	now := time.Now().UTC()
	svc := NewService(pool)

	const total = 60
	var wg sync.WaitGroup
	errs := make([]error, total)
	for i := 0; i < total; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			errs[i] = svc.Consume(ctx, ws, "tasks_monthly", 1, now)
		}(i)
	}
	wg.Wait()

	var rejected, ok int
	for _, err := range errs {
		if err == nil {
			ok++
		} else {
			var we *webx.Error
			if assert.ErrorAs(t, err, &we) {
				assert.Equal(t, 402, we.Status, "并发拒绝必须是配额 402 而非其他错误")
			}
			rejected++
		}
	}
	assert.Equal(t, 50, ok, "恰有 50 个扣减成功（容量边界）")
	assert.Equal(t, 10, rejected, "恰有 10 个被拒")

	used, _, err := svc.Usage(ctx, ws, "tasks_monthly", Period(now))
	require.NoError(t, err)
	assert.Equal(t, int64(50), used, "并发下 used 精确等于容量，无超卖")
}
