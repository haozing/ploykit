package schedule

import (
	"context"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type schedEnv struct {
	pool *pgxpool.Pool
	repo *PGRepo
	wsID string
}

func newScheduleEnv(t *testing.T) *schedEnv {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	_, err = pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schedule_plan (
		  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
		  id            uuid NOT NULL DEFAULT gen_random_uuid(),
		  kind          text NOT NULL,
		  cron_expr     text NOT NULL,
		  timezone      text NOT NULL DEFAULT 'UTC',
		  next_fire_at  timestamptz NOT NULL,
		  misfire       text NOT NULL DEFAULT 'skip' CHECK (misfire IN ('skip', 'once')),
		  last_fired_at timestamptz,
		  created_at    timestamptz NOT NULL DEFAULT now(),
		  enabled       boolean NOT NULL DEFAULT true,
		  PRIMARY KEY (workspace_id, id)
		);
		CREATE INDEX IF NOT EXISTS schedule_plan_due_idx ON schedule_plan (next_fire_at) WHERE enabled;`)
	require.NoError(t, err)

	uniq := time.Now().UnixNano()
	var uid, wsID string
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO "user" (email, display_name) VALUES ($1, 'schedule test') RETURNING id`,
		fmt.Sprintf("sched-%d@test.local", uniq)).Scan(&uid))
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO workspace (slug, name, created_by) VALUES ($1, 'Sched', $2) RETURNING id`,
		fmt.Sprintf("sched-%d", uniq), uid).Scan(&wsID))
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM workspace WHERE id = $1`, wsID)
		_, _ = pool.Exec(ctx, `DELETE FROM "user" WHERE id = $1`, uid)
	})
	return &schedEnv{pool: pool, repo: NewPGRepo(pool), wsID: wsID}
}

func (e *schedEnv) insertPlan(t *testing.T, id, cron, misfire string, next time.Time, enabled bool) SchedulePlan {
	t.Helper()
	p := SchedulePlan{
		ID: id, WorkspaceID: e.wsID, Kind: "test.kind", CronExpr: cron,
		Timezone: "UTC", NextFireAt: next, Misfire: misfire, Enabled: enabled,
	}
	require.NoError(t, e.repo.Create(context.Background(), &p))
	return p
}

func TestClaimDueAdvanceAndCAS(t *testing.T) {
	e := newScheduleEnv(t)
	ctx := context.Background()

	due := time.Date(2026, 10, 6, 10, 0, 0, 0, time.UTC)
	claimAt := time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)
	wantNext := time.Date(2026, 10, 7, 9, 0, 0, 0, time.UTC)
	e.insertPlan(t, "11111111-1111-1111-1111-111111111111", "0 9 * * *", MisfireSkip, due, true)
	e.insertPlan(t, "22222222-2222-2222-2222-222222222222", "0 9 * * *", MisfireOnce, due, true)
	e.insertPlan(t, "33333333-3333-3333-3333-333333333333", "0 9 * * *", MisfireSkip, due, false)
	e.insertPlan(t, "44444444-4444-4444-4444-444444444444", "0 9 * * *", MisfireSkip, due.Add(24*time.Hour), true)

	claimed, err := e.repo.ClaimDue(ctx, claimAt, 10)
	require.NoError(t, err)
	require.Len(t, claimed, 2, "领取到期且启用的两行（停用/未到期排除）")

	for _, c := range claimed {
		assert.True(t, c.Due.Equal(due), "Due 应为原 next_fire_at")

		assert.True(t, c.Plan.NextFireAt.Equal(wantNext),
			"plan %s next 应从 claimAt 重算为 %s，got %s", c.Plan.ID, wantNext, c.Plan.NextFireAt)
		require.NotNil(t, c.Plan.LastFiredAt)
		assert.True(t, c.Plan.LastFiredAt.Equal(claimAt))
	}

	claimed2, err := e.repo.ClaimDue(ctx, claimAt.Add(5*time.Second), 10)
	require.NoError(t, err)
	assert.Empty(t, claimed2, "已领取行二次领取应为空（CAS 互斥）")

	got, err := e.repo.Get(ctx, e.wsID, "11111111-1111-1111-1111-111111111111")
	require.NoError(t, err)
	assert.True(t, got.NextFireAt.Equal(wantNext))
	assert.NotNil(t, got.LastFiredAt)
}

func TestClaimDueConcurrent(t *testing.T) {
	e := newScheduleEnv(t)
	ctx := context.Background()
	due := time.Date(2026, 10, 6, 10, 0, 0, 0, time.UTC)
	claimAt := time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)
	e.insertPlan(t, "55555555-5555-5555-5555-555555555555", "0 9 * * *", MisfireSkip, due, true)

	const instances = 4
	var mu sync.Mutex
	total := 0
	var wg sync.WaitGroup
	for range instances {
		wg.Add(1)
		go func() {
			defer wg.Done()
			claimed, err := e.repo.ClaimDue(ctx, claimAt, 10)
			if err != nil {
				return
			}
			mu.Lock()
			total += len(claimed)
			mu.Unlock()
		}()
	}
	wg.Wait()
	assert.Equal(t, 1, total, "并发领取同一行应恰有一例成功")
}

func TestDeleteRepo(t *testing.T) {
	e := newScheduleEnv(t)
	ctx := context.Background()
	id := "66666666-6666-6666-6666-666666666666"
	e.insertPlan(t, id, "0 9 * * *", MisfireSkip, time.Now().UTC().Add(time.Hour), true)

	err := e.repo.Delete(ctx, "00000000-0000-0000-0000-000000000000", id)
	assert.ErrorIs(t, err, ErrNotFound)
	got, err := e.repo.Get(ctx, e.wsID, id)
	require.NoError(t, err, "误删守卫：行应仍在")
	assert.Equal(t, id, got.ID)

	require.NoError(t, e.repo.Delete(ctx, e.wsID, id))
	_, err = e.repo.Get(ctx, e.wsID, id)
	assert.ErrorIs(t, err, ErrNotFound)
	err = e.repo.Delete(ctx, e.wsID, id)
	assert.ErrorIs(t, err, ErrNotFound, "二删 → ErrNotFound（http 映射 404）")
}

func TestClaimDuePoisonRowPenaltyAdvance(t *testing.T) {
	e := newScheduleEnv(t)
	ctx := context.Background()
	due := time.Date(2026, 10, 6, 10, 0, 0, 0, time.UTC)
	claimAt := time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)

	e.insertPlan(t, "77777777-7777-7777-7777-777777777777", "not-a-cron", MisfireSkip, due, true)
	e.insertPlan(t, "88888888-8888-8888-8888-888888888888", "0 9 * * *", MisfireSkip, due.Add(time.Minute), true)

	claimed, err := e.repo.ClaimDue(ctx, claimAt, 1)
	require.NoError(t, err)
	assert.Empty(t, claimed, "毒行不投递")

	poison, err := e.repo.Get(ctx, e.wsID, "77777777-7777-7777-7777-777777777777")
	require.NoError(t, err)
	assert.True(t, poison.NextFireAt.Equal(claimAt.Add(poisonRetry)),
		"毒行应被推进到 now+poisonRetry，got %s", poison.NextFireAt)

	claimed, err = e.repo.ClaimDue(ctx, claimAt.Add(5*time.Second), 1)
	require.NoError(t, err)
	require.Len(t, claimed, 1)
	assert.Equal(t, "88888888-8888-8888-8888-888888888888", claimed[0].Plan.ID)
}
