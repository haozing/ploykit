package quota

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/migrations"
	pgm "github.com/haozing/ploykit/platform/pgmigrate"
	"github.com/haozing/ploykit/platform/webx"
)

func reservationTestDB(t *testing.T) *Service {
	t.Helper()
	pool := testPool(t)
	_, err := pgm.New(pool, migrations.FS, ".").Up(context.Background(), 0)
	require.NoError(t, err, "迁移自举到最新（含 024_quota_reservation）")
	return NewService(pool)
}

func forceExpire(t *testing.T, svc *Service, reservationID string) {
	t.Helper()
	_, err := svc.pool.Exec(context.Background(),
		`UPDATE quota_reservation SET expires_at = now() - interval '1 hour' WHERE id = $1`, reservationID)
	require.NoError(t, err)
}

func readReservation(t *testing.T, svc *Service, id string) Reservation {
	t.Helper()
	var r Reservation
	require.NoError(t, svc.pool.QueryRow(context.Background(),
		`SELECT id, workspace_id, quota_key, period_key, amount, settled_amount, released_amount, status, expires_at, created_at, settled_at, released_at
		 FROM quota_reservation WHERE id = $1`, id).
		Scan(&r.ID, &r.WorkspaceID, &r.QuotaKey, &r.PeriodKey, &r.Amount, &r.SettledAmount,
			&r.ReleasedAmount, &r.Status, &r.ExpiresAt, &r.CreatedAt, &r.SettledAt, &r.ReleasedAt))
	return r
}

func checkStatus(t *testing.T, svc *Service, ws, key string) Status {
	t.Helper()
	st, err := svc.Check(context.Background(), ws, key, time.Now().UTC())
	require.NoError(t, err)
	return st
}

func TestReserve_CapacityAndIdempotency(t *testing.T) {
	svc := reservationTestDB(t)
	pool := svc.pool
	ws := seedWS(t, pool)
	ctx := context.Background()
	now := time.Now().UTC()

	r1, err := svc.Reserve(ctx, ws, "tasks_monthly", 10, "idem-1", ReserveOpts{})
	require.NoError(t, err)
	assert.NotEmpty(t, r1.ReservationID)
	assert.False(t, r1.Replay)
	st := checkStatus(t, svc, ws, "tasks_monthly")
	assert.Equal(t, int64(0), st.Used)
	assert.Equal(t, int64(10), st.Reserved)

	r2, err := svc.Reserve(ctx, ws, "tasks_monthly", 10, "idem-1", ReserveOpts{})
	require.NoError(t, err)
	assert.Equal(t, r1.ReservationID, r2.ReservationID)
	assert.True(t, r2.Replay)
	assert.Equal(t, int64(10), checkStatus(t, svc, ws, "tasks_monthly").Reserved)

	_, err = svc.Reserve(ctx, ws, "tasks_monthly", 41, "idem-2", ReserveOpts{})
	var we *webx.Error
	require.ErrorAs(t, err, &we)
	assert.Equal(t, 429, we.Status)
	assert.Equal(t, CodeQuotaExhausted, we.Code)
	assert.Equal(t, int64(10), checkStatus(t, svc, ws, "tasks_monthly").Reserved, "被拒的预留不得预扣")

	_, err = svc.Reserve(ctx, ws, "tasks_monthly", 40, "idem-3", ReserveOpts{})
	require.NoError(t, err)
	assert.Equal(t, int64(50), checkStatus(t, svc, ws, "tasks_monthly").Reserved)

	row := readReservation(t, svc, r1.ReservationID)
	want := now.Add(ReservationTTL)
	assert.WithinDuration(t, want, row.ExpiresAt, 5*time.Second)

	briefs, err := svc.ActiveReservations(ctx, ws, Period(now))
	require.NoError(t, err)
	require.Len(t, briefs["tasks_monthly"], 2)
	amounts := []int64{briefs["tasks_monthly"][0].Amount, briefs["tasks_monthly"][1].Amount}
	assert.ElementsMatch(t, []int64{10, 40}, amounts)
	for _, b := range briefs["tasks_monthly"] {
		assert.Equal(t, ReservationReserved, b.Status)
	}

	r4, err := svc.Reserve(ctx, ws, "workspaces", 1, "idem-4", ReserveOpts{TTL: time.Hour})
	require.NoError(t, err)
	row4 := readReservation(t, svc, r4.ReservationID)
	assert.WithinDuration(t, now.Add(time.Hour), row4.ExpiresAt, 5*time.Second)
}

func TestSettle_PartialOverageAndIdempotency(t *testing.T) {
	svc := reservationTestDB(t)
	ws := seedWS(t, svc.pool)
	ctx := context.Background()

	r1, err := svc.Reserve(ctx, ws, "tasks_monthly", 10, "res-1", ReserveOpts{})
	require.NoError(t, err)

	got, err := svc.Settle(ctx, r1.ReservationID, 7, "settle-1")
	require.NoError(t, err)
	assert.Equal(t, int64(7), got.Actual)
	assert.False(t, got.Replay)
	st := checkStatus(t, svc, ws, "tasks_monthly")
	assert.Equal(t, int64(7), st.Used)
	assert.Equal(t, int64(0), st.Reserved, "结算后未清预留全部回退")
	row := readReservation(t, svc, r1.ReservationID)
	assert.Equal(t, ReservationSettled, row.Status)
	assert.Equal(t, int64(7), row.SettledAmount)
	require.NotNil(t, row.SettledAt)

	got, err = svc.Settle(ctx, r1.ReservationID, 7, "settle-1")
	require.NoError(t, err)
	assert.True(t, got.Replay)
	assert.Equal(t, int64(7), got.Actual)
	assert.Equal(t, int64(7), checkStatus(t, svc, ws, "tasks_monthly").Used)

	_, err = svc.Settle(ctx, r1.ReservationID, 3, "settle-2")
	var we409 *webx.Error
	require.ErrorAs(t, err, &we409)
	assert.Equal(t, 409, we409.Status)
	assert.Equal(t, int64(7), checkStatus(t, svc, ws, "tasks_monthly").Used)

	r2, err := svc.Reserve(ctx, ws, "tasks_monthly", 3, "res-2", ReserveOpts{})
	require.NoError(t, err)
	_, err = svc.Settle(ctx, r2.ReservationID, 5, "settle-3")
	require.NoError(t, err)
	st = checkStatus(t, svc, ws, "tasks_monthly")
	assert.Equal(t, int64(12), st.Used)
	assert.Equal(t, int64(0), st.Reserved)

	_, err = svc.Settle(ctx, "00000000-0000-0000-0000-000000000000", 1, "settle-x")
	var we404 *webx.Error
	require.ErrorAs(t, err, &we404)
	assert.Equal(t, 404, we404.Status)
}

func TestReleaseReservation_PartialAndIdempotent(t *testing.T) {
	svc := reservationTestDB(t)
	ws := seedWS(t, svc.pool)
	ctx := context.Background()

	r, err := svc.Reserve(ctx, ws, "tasks_monthly", 10, "res-1", ReserveOpts{})
	require.NoError(t, err)

	got, err := svc.ReleaseReservation(ctx, r.ReservationID, 4, "rel-1")
	require.NoError(t, err)
	assert.Equal(t, int64(4), got.Released)
	assert.Equal(t, int64(6), got.Remaining)
	st := checkStatus(t, svc, ws, "tasks_monthly")
	assert.Equal(t, int64(6), st.Reserved)
	row := readReservation(t, svc, r.ReservationID)
	assert.Equal(t, ReservationReserved, row.Status, "未清完仍是 reserved")
	assert.Equal(t, int64(4), row.ReleasedAmount)

	got, err = svc.ReleaseReservation(ctx, r.ReservationID, 4, "rel-1")
	require.NoError(t, err)
	assert.True(t, got.Replay)
	assert.Equal(t, int64(0), got.Released)
	assert.Equal(t, int64(6), checkStatus(t, svc, ws, "tasks_monthly").Reserved)

	got, err = svc.ReleaseReservation(ctx, r.ReservationID, 99, "rel-2")
	require.NoError(t, err)
	assert.Equal(t, int64(6), got.Released, "释放量应钳制到未清预留")
	assert.Equal(t, int64(0), got.Remaining)
	assert.Equal(t, int64(0), checkStatus(t, svc, ws, "tasks_monthly").Reserved)
	row = readReservation(t, svc, r.ReservationID)
	assert.Equal(t, ReservationReleased, row.Status)
	require.NotNil(t, row.ReleasedAt)

	_, err = svc.Settle(ctx, r.ReservationID, 1, "settle-1")
	var we *webx.Error
	require.ErrorAs(t, err, &we)
	assert.Equal(t, 409, we.Status)

	r2, err := svc.Reserve(ctx, ws, "tasks_monthly", 9, "res-2", ReserveOpts{})
	require.NoError(t, err)
	_, err = svc.ReleaseReservation(ctx, r2.ReservationID, 2, "rel-a")
	require.NoError(t, err)
	_, err = svc.ReleaseReservation(ctx, r2.ReservationID, 3, "rel-b")
	require.NoError(t, err)
	assert.Equal(t, int64(4), checkStatus(t, svc, ws, "tasks_monthly").Reserved)

	got, err = svc.ReleaseReservation(ctx, r2.ReservationID, 2, "rel-a")
	require.NoError(t, err)
	assert.True(t, got.Replay)
	assert.Equal(t, int64(4), checkStatus(t, svc, ws, "tasks_monthly").Reserved)
}

func TestExpireDueReservations_RollbackAndHook(t *testing.T) {
	svc := reservationTestDB(t)
	ws := seedWS(t, svc.pool)
	ctx := context.Background()

	var mu sync.Mutex
	var expiredHooks []string
	svc.WithHooks(QuotaHooks{
		OnReservationExpired: func(_ context.Context, id, _, _ string, amount int64) error {
			mu.Lock()
			defer mu.Unlock()
			expiredHooks = append(expiredHooks, fmt.Sprintf("%s@%d", id, amount))
			return nil
		},
	})

	r1, err := svc.Reserve(ctx, ws, "tasks_monthly", 8, "res-1", ReserveOpts{})
	require.NoError(t, err)

	r2, err := svc.Reserve(ctx, ws, "tasks_monthly", 10, "res-2", ReserveOpts{})
	require.NoError(t, err)
	_, err = svc.ReleaseReservation(ctx, r2.ReservationID, 3, "rel-1")
	require.NoError(t, err)
	assert.Equal(t, int64(15), checkStatus(t, svc, ws, "tasks_monthly").Reserved)

	forceExpire(t, svc, r1.ReservationID)
	forceExpire(t, svc, r2.ReservationID)

	expired, err := svc.ExpireDueReservations(ctx, time.Now().UTC(), 10)
	require.NoError(t, err)
	require.Len(t, expired, 2)
	assert.Equal(t, int64(0), checkStatus(t, svc, ws, "tasks_monthly").Reserved, "到期未清量应全额回退")
	for _, e := range expired {
		assert.Equal(t, ReservationExpired, e.Status)
	}
	require.Len(t, expiredHooks, 2, "OnReservationExpired 每行一次（Observational）")
	assert.ElementsMatch(t, []string{
		r1.ReservationID + "@8",
		r2.ReservationID + "@7",
	}, expiredHooks)

	expired, err = svc.ExpireDueReservations(ctx, time.Now().UTC(), 10)
	require.NoError(t, err)
	assert.Empty(t, expired)
	assert.Equal(t, int64(0), checkStatus(t, svc, ws, "tasks_monthly").Reserved)
	assert.Len(t, expiredHooks, 2)

	_, err = svc.Settle(ctx, r1.ReservationID, 8, "settle-1")
	var we *webx.Error
	require.ErrorAs(t, err, &we)
	assert.Equal(t, 409, we.Status)
}

func TestReserve_ConcurrencyNoOversell(t *testing.T) {
	svc := reservationTestDB(t)
	ws := seedWS(t, svc.pool)
	ctx := context.Background()

	const n, each = 10, 6
	var mu sync.Mutex
	ok, rejected := 0, 0
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := svc.Reserve(ctx, ws, "tasks_monthly", each, "concurrent-"+string(rune('a'+i)), ReserveOpts{})
			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				ok++
			} else {
				var we *webx.Error
				if assert.ErrorAs(t, err, &we) && we.Status == 429 {
					rejected++
				}
			}
		}(i)
	}
	wg.Wait()
	assert.Equal(t, 8, ok, "floor(50/6)=8 路成功")
	assert.Equal(t, 2, rejected)
	st := checkStatus(t, svc, ws, "tasks_monthly")
	assert.Equal(t, int64(48), st.Reserved, "预扣总额不得超限")
	assert.Equal(t, int64(0), st.Used)
}

func TestReserve_ConcurrentSameKeySingleReservation(t *testing.T) {
	svc := reservationTestDB(t)
	ws := seedWS(t, svc.pool)
	ctx := context.Background()

	var mu sync.Mutex
	ids := map[string]int{}
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			res, err := svc.Reserve(ctx, ws, "tasks_monthly", 5, "same-key", ReserveOpts{})
			mu.Lock()
			defer mu.Unlock()
			require.NoError(t, err)
			ids[res.ReservationID]++
		}()
	}
	wg.Wait()
	require.Len(t, ids, 1, "同键并发只落一行")
	assert.Equal(t, int64(5), checkStatus(t, svc, ws, "tasks_monthly").Reserved, "同键并发只预扣一次")
}
