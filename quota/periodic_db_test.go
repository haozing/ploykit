package quota

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/webx"
)

func TestGrantPeriodic_TemplateAndRefresh(t *testing.T) {
	pool := testPool(t)
	ws := seedWS(t, pool)
	ctx := context.Background()
	svc := NewService(pool)

	oct := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	nov := time.Date(2026, 11, 5, 12, 0, 0, 0, time.UTC)
	dec := time.Date(2026, 12, 5, 12, 0, 0, 0, time.UTC)

	unlocked, err := svc.GrantPeriodic(ctx, ws, "tasks_monthly", "monthly_bonus", "bonus", 10, GrantCycleMonthly, oct)
	require.NoError(t, err)
	assert.True(t, unlocked)
	_, granted, err := svc.Usage(ctx, ws, "tasks_monthly", "2026-10")
	require.NoError(t, err)
	assert.Equal(t, int64(10), granted, "模板行本身即首期授予")

	issued, err := svc.RefreshPeriodicGrants(ctx, oct)
	require.NoError(t, err)
	assert.Empty(t, issued, "模板创建当期 Refresh 不得补发")

	issued, err = svc.RefreshPeriodicGrants(ctx, nov)
	require.NoError(t, err)
	require.Len(t, issued, 1)
	assert.Equal(t, "bonus#2026-11", issued[0].RefID)
	assert.Equal(t, "2026-11", issued[0].Period)
	assert.Equal(t, 10, issued[0].Amount)
	assert.Equal(t, ws, issued[0].WorkspaceID)
	assert.Equal(t, "tasks_monthly", issued[0].Key)
	assert.Equal(t, "monthly_bonus", issued[0].Reason)

	issued, err = svc.RefreshPeriodicGrants(ctx, nov)
	require.NoError(t, err)
	assert.Empty(t, issued, "同周期重复 Refresh 必须零新增")

	issued, err = svc.RefreshPeriodicGrants(ctx, dec)
	require.NoError(t, err)
	require.Len(t, issued, 1)
	assert.Equal(t, "bonus#2026-12", issued[0].RefID)

	var rows int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM quota_grant WHERE workspace_id = $1 AND reason = 'monthly_bonus'`, ws).
		Scan(&rows))
	assert.Equal(t, 3, rows, "模板 + 每期补发各一行")

	_, grantedNov, err := svc.Usage(ctx, ws, "tasks_monthly", "2026-11")
	require.NoError(t, err)
	assert.Equal(t, int64(10), grantedNov)
	var cycleNull int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM quota_grant WHERE workspace_id = $1 AND ref_id = 'bonus#2026-11' AND period_cycle IS NULL`, ws).
		Scan(&cycleNull))
	assert.Equal(t, 1, cycleNull, "补发行是普通授予行（period_cycle=NULL），不再被扫描")
}

func TestGrantPeriodic_IdempotentRegistration(t *testing.T) {
	pool := testPool(t)
	ws := seedWS(t, pool)
	ctx := context.Background()
	svc := NewService(pool)

	oct := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	nov := time.Date(2026, 11, 5, 12, 0, 0, 0, time.UTC)

	unlocked, err := svc.GrantPeriodic(ctx, ws, "tasks_monthly", "monthly_bonus", "bonus", 10, GrantCycleMonthly, oct)
	require.NoError(t, err)
	assert.True(t, unlocked)
	unlocked, err = svc.GrantPeriodic(ctx, ws, "tasks_monthly", "monthly_bonus", "bonus", 10, GrantCycleMonthly, nov)
	require.NoError(t, err)
	assert.False(t, unlocked, "跨期同四元组不得重建模板（去重键不含 period，029 语义）")

	var rows int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM quota_grant WHERE workspace_id = $1 AND reason = 'monthly_bonus'`, ws).
		Scan(&rows))
	assert.Equal(t, 1, rows)
}

func TestRefreshPeriodicGrants_IgnoresPlainGrants(t *testing.T) {
	pool := testPool(t)
	ws := seedWS(t, pool)
	ctx := context.Background()
	now := time.Now().UTC()
	svc := NewService(pool)

	unlocked, err := svc.Grant(ctx, ws, "tasks_monthly", "milestone", "plain-ref", 10, now)
	require.NoError(t, err)
	require.True(t, unlocked)

	issued, err := svc.RefreshPeriodicGrants(ctx, now)
	require.NoError(t, err)
	assert.Empty(t, issued, "一次性授予行不参与周期补发")
}

func TestGrantPeriodic_Validation(t *testing.T) {
	svc := NewService(nil)
	now := time.Now().UTC()

	_, err := svc.GrantPeriodic(context.Background(), "ws-1", "tasks_monthly", "monthly_bonus", "  ", 10, GrantCycleMonthly, now)
	var we *webx.Error
	require.ErrorAs(t, err, &we)
	assert.Equal(t, 400, we.Status)

	_, err = svc.GrantPeriodic(context.Background(), "ws-1", "tasks_monthly", "monthly_bonus", "ref-1", 10, "weekly", now)
	require.ErrorAs(t, err, &we)
	assert.Equal(t, 400, we.Status, "未支持周期必须拒绝（新周期=新迁移，显式演进）")
}
