package quota

import (
	"context"
	"fmt"
	"net"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/webx"
)

func TestReserve_ValidationBeforeStore(t *testing.T) {
	svc := NewService(nil)
	ctx := context.Background()

	cases := []struct {
		name  string
		call  func() error
		field string
	}{
		{"amount=0", func() error {
			_, err := svc.Reserve(ctx, "ws", "k", 0, "idem", ReserveOpts{})
			return err
		}, "amount must be > 0"},
		{"amount<0", func() error {
			_, err := svc.Reserve(ctx, "ws", "k", -5, "idem", ReserveOpts{})
			return err
		}, "amount must be > 0"},
		{"空幂等键", func() error {
			_, err := svc.Reserve(ctx, "ws", "k", 5, "", ReserveOpts{})
			return err
		}, "idempotency key required"},
		{"settle 负实际量", func() error {
			_, err := svc.Settle(ctx, "rsv", -1, "idem")
			return err
		}, "actual must be >= 0"},
		{"settle 空幂等键", func() error {
			_, err := svc.Settle(ctx, "rsv", 1, "")
			return err
		}, "idempotency key required"},
		{"release 空幂等键", func() error {
			_, err := svc.ReleaseReservation(ctx, "rsv", 1, "")
			return err
		}, "idempotency key required"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := c.call()
			var we *webx.Error
			require.ErrorAs(t, err, &we)
			assert.Equal(t, 400, we.Status)
			assert.Equal(t, webx.CodeValidation, we.Code)
			assert.Contains(t, we.Message, c.field)
		})
	}
}

func TestReservation_Outstanding(t *testing.T) {
	r := Reservation{Amount: 10, ReleasedAmount: 4}
	assert.Equal(t, int64(6), r.Outstanding())
	r.ReleasedAmount = 10
	assert.Equal(t, int64(0), r.Outstanding())
}

func deadPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	lis, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	t.Cleanup(func() { _ = lis.Close() })
	go func() {
		for {
			c, err := lis.Accept()
			if err != nil {
				return
			}
			_ = c.Close()
		}
	}()
	pool, err := pgxpool.New(context.Background(),
		fmt.Sprintf("postgres://quota:quota@%s/quota", lis.Addr().String()))
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	return pool
}

func TestReserve_FailClosedByDefault(t *testing.T) {
	svc := NewService(deadPool(t))
	_, err := svc.Reserve(context.Background(), "ws-1", "tasks_monthly", 5, "idem-1", ReserveOpts{})
	var we *webx.Error
	require.ErrorAs(t, err, &we)
	assert.Equal(t, 503, we.Status)
	assert.Equal(t, CodeQuotaUnavailable, we.Code)
}

func TestReserve_FailOpenAdmitsOnStorageFailure(t *testing.T) {
	svc := NewService(deadPool(t))
	res, err := svc.Reserve(context.Background(), "ws-1", "tasks_monthly", 5, "idem-1",
		ReserveOpts{FailOpen: true})
	require.NoError(t, err)
	assert.True(t, res.Degraded)
	assert.False(t, res.Replay)
	assert.Empty(t, res.ReservationID, "放行结果不携带预留 ID——无可结算行")
}
