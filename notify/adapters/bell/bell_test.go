package pgrepo

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/notify/app"
)

func countNotifs(t *testing.T, pool *pgxpool.Pool, userID, typ string) int {
	t.Helper()
	var n int
	require.NoError(t, pool.QueryRow(context.Background(),
		`SELECT count(*) FROM notification WHERE user_id = $1 AND type = $2`,
		userID, typ).Scan(&n))
	return n
}

func TestNotifyOncePerMonth_ConcurrentSingleRow(t *testing.T) {
	repo, pool, closeDB := prefTestDB(t)
	defer closeDB()
	ctx := context.Background()
	uid := seedPrefUser(t, pool)
	march := time.Date(2026, 3, 15, 9, 0, 0, 0, time.UTC)
	svc := app.NewNotifyService(repo, nil, func() time.Time { return march })
	in := app.NotifyInput{UserID: uid, Type: "quota_near_limit", Title: "配额将尽", Body: "已用 40/50", Link: "/billing"}

	start := make(chan struct{})
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			errs[i] = svc.NotifyOncePerMonth(ctx, in)
		}(i)
	}
	close(start)
	wg.Wait()

	assert.NoError(t, errs[0])
	assert.NoError(t, errs[1], "撞唯一索引的一方向调用方报告成功（本月已发送）")
	assert.Equal(t, 1, countNotifs(t, pool, uid, "quota_near_limit"), "并发双发必须只落一行")
}

func TestNotifyOncePerMonth_MonthBoundary(t *testing.T) {
	repo, pool, closeDB := prefTestDB(t)
	defer closeDB()
	ctx := context.Background()
	uid := seedPrefUser(t, pool)
	march := time.Date(2026, 3, 15, 9, 0, 0, 0, time.UTC)
	var cur time.Time
	svc := app.NewNotifyService(repo, nil, func() time.Time { return cur })
	in := app.NotifyInput{UserID: uid, Type: "quota_exhausted", Title: "配额已尽"}

	cur = march
	require.NoError(t, svc.NotifyOncePerMonth(ctx, in))
	cur = march.AddDate(0, 0, 10)
	require.NoError(t, svc.NotifyOncePerMonth(ctx, in))
	assert.Equal(t, 1, countNotifs(t, pool, uid, "quota_exhausted"), "同月第二次发送被唯一索引吸收")

	cur = march.AddDate(0, 1, 0)
	require.NoError(t, svc.NotifyOncePerMonth(ctx, in))
	assert.Equal(t, 2, countNotifs(t, pool, uid, "quota_exhausted"), "跨月应落新行")
}

func TestMonthlyIndex_ExcludesOtherSemantics(t *testing.T) {
	repo, pool, closeDB := prefTestDB(t)
	defer closeDB()
	ctx := context.Background()
	uid := seedPrefUser(t, pool)
	svc := app.NewNotifyService(repo, nil, func() time.Time { return time.Date(2026, 3, 15, 9, 0, 0, 0, time.UTC) })

	for _, key := range []string{"ws1:tasks:2026-03", "ws2:tasks:2026-03"} {
		require.NoError(t, svc.Notify(ctx, app.NotifyInput{
			UserID: uid, Type: "quota_near_limit", Title: "配额将尽", DedupKey: key,
		}))
	}
	assert.Equal(t, 2, countNotifs(t, pool, uid, "quota_near_limit"),
		"DedupKey 行不参与月度索引：同月同类型多键（多工作区）各落一行")

	for i := 0; i < 2; i++ {
		require.NoError(t, svc.Notify(ctx, app.NotifyInput{
			UserID: uid, Type: "task_reminder", Title: "任务提醒", Link: "/tasks",
		}))
	}
	assert.Equal(t, 2, countNotifs(t, pool, uid, "task_reminder"),
		"常规通知不参与月度索引：同月同类型多条合法")
}

func TestNotify_NoLinkKeepsTitleBody(t *testing.T) {
	repo, pool, closeDB := prefTestDB(t)
	defer closeDB()
	ctx := context.Background()
	uid := seedPrefUser(t, pool)
	svc := app.NewNotifyService(repo, nil, func() time.Time { return time.Date(2026, 3, 15, 9, 0, 0, 0, time.UTC) })

	require.NoError(t, svc.Notify(ctx, app.NotifyInput{
		UserID: uid, Type: "quota_near_limit", Title: "配额将尽", Body: "tasks 已用 40/50",
	}))
	var title, body string
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT title, body FROM notification WHERE user_id = $1 AND type = $2`,
		uid, "quota_near_limit").Scan(&title, &body))
	assert.Equal(t, "配额将尽", title)
	assert.Equal(t, "tasks 已用 40/50", body)
}
