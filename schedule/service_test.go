package schedule

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeRepo struct {
	plans   map[string]*SchedulePlan
	updates []*SchedulePlan
	claimFn func(now time.Time, limit int) ([]Claimed, error)
}

func newFakeRepo(plans ...SchedulePlan) *fakeRepo {
	r := &fakeRepo{plans: map[string]*SchedulePlan{}}
	for i := range plans {
		p := plans[i]
		r.plans[p.WorkspaceID+"/"+p.ID] = &p
	}
	return r
}

func (r *fakeRepo) Create(_ context.Context, p *SchedulePlan) error {
	r.plans[p.WorkspaceID+"/"+p.ID] = p
	return nil
}

func (r *fakeRepo) Get(_ context.Context, workspaceID, id string) (SchedulePlan, error) {
	if p, ok := r.plans[workspaceID+"/"+id]; ok {
		return *p, nil
	}
	return SchedulePlan{}, ErrNotFound
}

func (r *fakeRepo) ListByWorkspace(_ context.Context, workspaceID string) ([]SchedulePlan, error) {
	var out []SchedulePlan
	for _, p := range r.plans {
		if p.WorkspaceID == workspaceID {
			out = append(out, *p)
		}
	}
	return out, nil
}

func (r *fakeRepo) Update(_ context.Context, p *SchedulePlan) error {
	if _, ok := r.plans[p.WorkspaceID+"/"+p.ID]; !ok {
		return ErrNotFound
	}
	r.updates = append(r.updates, p)
	r.plans[p.WorkspaceID+"/"+p.ID] = p
	return nil
}

func (r *fakeRepo) Delete(_ context.Context, workspaceID, id string) error {
	if _, ok := r.plans[workspaceID+"/"+id]; !ok {
		return ErrNotFound
	}
	delete(r.plans, workspaceID+"/"+id)
	return nil
}

func (r *fakeRepo) ClaimDue(_ context.Context, now time.Time, limit int) ([]Claimed, error) {
	if r.claimFn != nil {
		return r.claimFn(now, limit)
	}
	return nil, nil
}

type enqueuedJob struct {
	args river.JobArgs
	opts *river.InsertOpts
}

type fakeEnqueuer struct {
	inserts []enqueuedJob
	err     error
}

func (f *fakeEnqueuer) Insert(_ context.Context, args river.JobArgs, opts *river.InsertOpts) (*rivertype.JobInsertResult, error) {
	f.inserts = append(f.inserts, enqueuedJob{args: args, opts: opts})
	return nil, f.err
}

var fixedNow = time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)

func ptrBool(b bool) *bool { return &b }

func strPtr(s string) *string { return &s }

func TestCreateValidation(t *testing.T) {
	ctx := context.Background()

	cases := []struct {
		name    string
		in      CreateInput
		wantErr error
	}{
		{name: "非 cron 字符串", in: CreateInput{Kind: "k", CronExpr: "not-a-cron"}, wantErr: ErrInvalidCron},
		{name: "四字段（应为五字段）", in: CreateInput{Kind: "k", CronExpr: "* * * *"}, wantErr: ErrInvalidCron},
		{name: "越界分钟", in: CreateInput{Kind: "k", CronExpr: "99 * * * *"}, wantErr: ErrInvalidCron},
		{name: "时区非 IANA 名", in: CreateInput{Kind: "k", CronExpr: "0 9 * * *", Timezone: "Not/AZone"}, wantErr: ErrInvalidTZ},
		{name: "时区拼错区", in: CreateInput{Kind: "k", CronExpr: "0 9 * * *", Timezone: "Shanghai"}, wantErr: ErrInvalidTZ},
		{name: "Local 时区拒绝（P3-44：随部署机漂移不可复现）", in: CreateInput{Kind: "k", CronExpr: "0 9 * * *", Timezone: "Local"}, wantErr: ErrInvalidTZ},
		{name: "kind 空", in: CreateInput{CronExpr: "0 9 * * *"}, wantErr: ErrInvalidKind},
		{name: "misfire 非法值", in: CreateInput{Kind: "k", CronExpr: "0 9 * * *", Misfire: "always"}, wantErr: ErrBadMisfire},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc := NewService(newFakeRepo(), nil, func() time.Time { return fixedNow })
			_, err := svc.Create(ctx, "ws-1", tc.in)
			assert.ErrorIs(t, err, tc.wantErr)
		})
	}
}

func TestCreateNormalizesAndComputesNext(t *testing.T) {
	repo := newFakeRepo()
	svc := NewService(repo, nil, func() time.Time { return fixedNow })
	ctx := context.Background()

	p, err := svc.Create(ctx, "ws-1", CreateInput{Kind: " task.cleanup ", CronExpr: " 0 9 * * * ", Timezone: "Asia/Shanghai"})
	require.NoError(t, err)
	assert.Equal(t, "task.cleanup", p.Kind)
	assert.Equal(t, "0 9 * * *", p.CronExpr)
	assert.Equal(t, "Asia/Shanghai", p.Timezone)
	assert.Equal(t, MisfireSkip, p.Misfire)
	assert.True(t, p.Enabled)
	assert.True(t, p.NextFireAt.Equal(time.Date(2026, 10, 7, 1, 0, 0, 0, time.UTC)),
		"next 应为次日上海 09:00，got %s", p.NextFireAt)

	p2, err := svc.Create(ctx, "ws-1", CreateInput{Kind: "k", CronExpr: "*/15 * * * *", Misfire: "once"})
	require.NoError(t, err)
	assert.Equal(t, MisfireOnce, p2.Misfire)
	assert.Equal(t, "UTC", p2.Timezone)
}

func TestUpdateToggleAndRecompute(t *testing.T) {
	ctx := context.Background()
	staleNext := fixedNow.Add(-2 * time.Hour)
	repo := newFakeRepo(SchedulePlan{
		ID: "p1", WorkspaceID: "ws-1", Kind: "k", CronExpr: "0 9 * * *",
		Timezone: "UTC", NextFireAt: staleNext, Misfire: MisfireSkip, Enabled: true,
	})
	svc := NewService(repo, nil, func() time.Time { return fixedNow })

	got, err := svc.Update(ctx, "ws-1", "p1", UpdateInput{Enabled: ptrBool(false)})
	require.NoError(t, err)
	assert.False(t, got.Enabled)
	assert.True(t, got.NextFireAt.Equal(staleNext))

	got, err = svc.Update(ctx, "ws-1", "p1", UpdateInput{Enabled: ptrBool(true)})
	require.NoError(t, err)
	assert.True(t, got.Enabled)
	assert.True(t, got.NextFireAt.Equal(time.Date(2026, 10, 7, 9, 0, 0, 0, time.UTC)),
		"重新启用应从 now 重算 next，got %s", got.NextFireAt)

	_, err = svc.Update(ctx, "ws-1", "p1", UpdateInput{CronExpr: strPtr("bad")})
	assert.ErrorIs(t, err, ErrInvalidCron)
	got, err = svc.Update(ctx, "ws-1", "p1", UpdateInput{CronExpr: strPtr("30 8 * * *")})
	require.NoError(t, err)
	assert.Equal(t, "30 8 * * *", got.CronExpr)
	assert.True(t, got.NextFireAt.Equal(time.Date(2026, 10, 7, 8, 30, 0, 0, time.UTC)))

	_, err = svc.Update(ctx, "ws-2", "p1", UpdateInput{Enabled: ptrBool(true)})
	assert.ErrorIs(t, err, ErrNotFound)
	_, err = svc.Update(ctx, "ws-1", "p1", UpdateInput{Misfire: strPtr("always")})
	assert.ErrorIs(t, err, ErrBadMisfire)
}

func TestDelete(t *testing.T) {
	ctx := context.Background()
	repo := newFakeRepo(SchedulePlan{
		ID: "p1", WorkspaceID: "ws-1", Kind: "k", CronExpr: "0 9 * * *",
		Timezone: "UTC", NextFireAt: fixedNow.Add(time.Hour), Misfire: MisfireSkip, Enabled: true,
	})
	svc := NewService(repo, nil, func() time.Time { return fixedNow })

	require.NoError(t, svc.Delete(ctx, "ws-1", "p1"))
	_, err := repo.Get(ctx, "ws-1", "p1")
	assert.ErrorIs(t, err, ErrNotFound)

	err = svc.Delete(ctx, "ws-1", "p1")
	assert.ErrorIs(t, err, ErrNotFound)

	repo2 := newFakeRepo(SchedulePlan{
		ID: "p2", WorkspaceID: "ws-1", Kind: "k", CronExpr: "0 9 * * *",
		Timezone: "UTC", NextFireAt: fixedNow.Add(time.Hour), Misfire: MisfireSkip, Enabled: true,
	})
	svc2 := NewService(repo2, nil, func() time.Time { return fixedNow })
	err = svc2.Delete(ctx, "ws-2", "p2")
	assert.ErrorIs(t, err, ErrNotFound)
	_, err = repo2.Get(ctx, "ws-1", "p2")
	require.NoError(t, err)
}

func TestPreview(t *testing.T) {
	svc := NewService(newFakeRepo(), nil, func() time.Time { return fixedNow })
	ctx := context.Background()

	times, err := svc.Preview(ctx, "*/15 * * * *", "UTC", 0)
	require.NoError(t, err)
	require.Len(t, times, 3)
	assert.True(t, times[0].Equal(time.Date(2026, 10, 6, 12, 15, 0, 0, time.UTC)))
	assert.True(t, times[2].Equal(time.Date(2026, 10, 6, 12, 45, 0, 0, time.UTC)))

	times, err = svc.Preview(ctx, "* * * * *", "UTC", 50)
	require.NoError(t, err)
	assert.Len(t, times, 10)

	times, err = svc.Preview(ctx, "0 9 * * *", "Asia/Shanghai", 2)
	require.NoError(t, err)
	assert.True(t, times[0].Equal(time.Date(2026, 10, 7, 1, 0, 0, 0, time.UTC)))
	assert.True(t, times[1].Equal(time.Date(2026, 10, 8, 1, 0, 0, 0, time.UTC)))

	_, err = svc.Preview(ctx, "bad", "UTC", 3)
	assert.ErrorIs(t, err, ErrInvalidCron)
	_, err = svc.Preview(ctx, "0 9 * * *", "Nope/Zone", 3)
	assert.ErrorIs(t, err, ErrInvalidTZ)
	_, err = svc.Preview(ctx, "0 9 * * *", "Local", 3)
	assert.ErrorIs(t, err, ErrInvalidTZ)
}

func TestFireUniqueByArgs(t *testing.T) {
	ctx := context.Background()
	plan := SchedulePlan{ID: "p1", WorkspaceID: "ws-1", Kind: "k"}
	due := time.Date(2026, 10, 6, 9, 0, 0, 0, time.UTC)

	svc := NewService(newFakeRepo(), nil, nil)
	require.NoError(t, svc.Fire(ctx, plan, due))

	enq := &fakeEnqueuer{}
	svc = NewService(newFakeRepo(), enq, nil)
	require.NoError(t, svc.Fire(ctx, plan, due))
	require.Len(t, enq.inserts, 1)
	args, ok := enq.inserts[0].args.(FireArgs)
	require.True(t, ok, "args 应为 FireArgs")
	assert.Equal(t, "p1", args.PlanID)
	assert.True(t, args.ScheduledFor.Equal(due))
	assert.Equal(t, JobKind, args.Kind())
	assert.True(t, enq.inserts[0].opts.UniqueOpts.ByArgs, "必须 unique ByArgs（同计划同刻全局一次）")
}

func TestPlanFiresMisfireTwoModes(t *testing.T) {
	grace := 60 * time.Second
	due := time.Date(2026, 10, 6, 9, 0, 0, 0, time.UTC)

	cases := []struct {
		name    string
		misfire string
		now     time.Time
		want    []time.Time
	}{
		{"准点：skip 照投", MisfireSkip, due.Add(5 * time.Second), []time.Time{due}},
		{"准点：once 照投", MisfireOnce, due.Add(5 * time.Second), []time.Time{due}},
		{"窗内迟到（<due+grace）：照投", MisfireSkip, due.Add(59 * time.Second), []time.Time{due}},
		{"边界含（=due+grace）：照投", MisfireSkip, due.Add(60 * time.Second), []time.Time{due}},
		{"超窗（missed）：默认 skip 跳过不投", MisfireSkip, due.Add(61 * time.Second), nil},
		{"迟到很久：skip 仍不投", MisfireSkip, due.Add(2 * time.Hour), nil},
		{"超窗（missed）：once 补发一次（scheduled_for=原 next_fire_at）", MisfireOnce, due.Add(2 * time.Hour), []time.Time{due}},
		{"once 只补一次（不回放多周期）", MisfireOnce, due.Add(24 * time.Hour), []time.Time{due}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := PlanFires(tc.misfire, due, tc.now, grace)
			if tc.want == nil {
				assert.Empty(t, got)
				return
			}
			require.Len(t, got, 1)
			assert.True(t, got[0].Equal(tc.want[0]))
		})
	}
}

func TestScanOnce(t *testing.T) {
	ctx := context.Background()
	due := fixedNow.Add(-5 * time.Second)
	lateDue := fixedNow.Add(-10 * time.Minute)
	mkPlan := func(id, misfire string) SchedulePlan {
		return SchedulePlan{ID: id, WorkspaceID: "ws-1", Kind: "k", CronExpr: "0 9 * * *",
			Timezone: "UTC", Misfire: misfire, Enabled: true}
	}

	type fired struct {
		planID string
		at     time.Time
	}
	t.Run("准点领取→逐条投递", func(t *testing.T) {
		repo := newFakeRepo()
		repo.claimFn = func(now time.Time, limit int) ([]Claimed, error) {
			assert.True(t, now.Equal(fixedNow), "ScanOnce 应以注入时钟为领取基准")
			assert.Equal(t, 100, limit, "默认批量 100")
			return []Claimed{{Plan: mkPlan("p1", MisfireSkip), Due: due}}, nil
		}
		var fires []fired
		w := &ScannerWorker{Repo: repo, Now: func() time.Time { return fixedNow }, Fire: func(_ context.Context, p SchedulePlan, at time.Time) error {
			fires = append(fires, fired{p.ID, at})
			return nil
		}}
		n, err := w.ScanOnce(ctx)
		require.NoError(t, err)
		assert.Equal(t, 1, n)
		require.Len(t, fires, 1)
		assert.Equal(t, "p1", fires[0].planID)
		assert.True(t, fires[0].at.Equal(due), "scheduled_for 应为原定触发时刻")
	})

	t.Run("missed 两档：skip 不投 / once 补发原时刻", func(t *testing.T) {
		repo := newFakeRepo()
		repo.claimFn = func(time.Time, int) ([]Claimed, error) {
			return []Claimed{
				{Plan: mkPlan("skip-plan", MisfireSkip), Due: lateDue},
				{Plan: mkPlan("once-plan", MisfireOnce), Due: lateDue},
			}, nil
		}
		var fires []fired
		w := &ScannerWorker{Repo: repo, Now: func() time.Time { return fixedNow }, Fire: func(_ context.Context, p SchedulePlan, at time.Time) error {
			fires = append(fires, fired{p.ID, at})
			return nil
		}}
		n, err := w.ScanOnce(ctx)
		require.NoError(t, err)
		assert.Equal(t, 1, n, "skip 档不投，仅 once 档补发一次")
		require.Len(t, fires, 1)
		assert.Equal(t, "once-plan", fires[0].planID)
		assert.True(t, fires[0].at.Equal(lateDue), "补发的 scheduled_for=原 next_fire_at")
	})

	t.Run("单条投递失败不阻断其余条目", func(t *testing.T) {
		repo := newFakeRepo()
		repo.claimFn = func(time.Time, int) ([]Claimed, error) {
			return []Claimed{{Plan: mkPlan("bad", MisfireSkip), Due: due}, {Plan: mkPlan("good", MisfireSkip), Due: due}}, nil
		}
		var firedIDs []string
		w := &ScannerWorker{Repo: repo, Now: func() time.Time { return fixedNow }, Fire: func(_ context.Context, p SchedulePlan, _ time.Time) error {
			if p.ID == "bad" {
				return errors.New("river down")
			}
			firedIDs = append(firedIDs, p.ID)
			return nil
		}}
		n, err := w.ScanOnce(ctx)
		require.NoError(t, err, "best-effort：单条失败不作为整轮错误")
		assert.Equal(t, 1, n)
		assert.Equal(t, []string{"good"}, firedIDs)
	})

	t.Run("领取失败上抛", func(t *testing.T) {
		repo := newFakeRepo()
		claimErr := errors.New("db down")
		repo.claimFn = func(time.Time, int) ([]Claimed, error) { return nil, claimErr }
		w := &ScannerWorker{Repo: repo, Fire: func(context.Context, SchedulePlan, time.Time) error { return nil }}
		_, err := w.ScanOnce(ctx)
		assert.ErrorIs(t, err, claimErr)
	})

	t.Run("部分领取+错误：已领取行照常投递且错误上抛", func(t *testing.T) {
		repo := newFakeRepo()
		claimErr := errors.New("conn dropped mid-claim")
		repo.claimFn = func(time.Time, int) ([]Claimed, error) {
			return []Claimed{{Plan: mkPlan("claimed", MisfireSkip), Due: due}}, claimErr
		}
		var firedIDs []string
		w := &ScannerWorker{Repo: repo, Now: func() time.Time { return fixedNow }, Fire: func(_ context.Context, p SchedulePlan, _ time.Time) error {
			firedIDs = append(firedIDs, p.ID)
			return nil
		}}
		n, err := w.ScanOnce(ctx)
		assert.ErrorIs(t, err, claimErr, "错误仍上抛（调用方记日志）")
		assert.Equal(t, 1, n, "已领取行应投递")
		assert.Equal(t, []string{"claimed"}, firedIDs)
	})

	t.Run("Fire 未接线时安全跳过", func(t *testing.T) {
		repo := newFakeRepo()
		repo.claimFn = func(time.Time, int) ([]Claimed, error) {
			return []Claimed{{Plan: mkPlan("p1", MisfireSkip), Due: due}}, nil
		}
		w := &ScannerWorker{Repo: repo}
		n, err := w.ScanOnce(ctx)
		require.NoError(t, err)
		assert.Equal(t, 0, n)
	})

	t.Run("Run 的默认节奏与名称", func(t *testing.T) {
		w := &ScannerWorker{}
		assert.Equal(t, "schedule_scanner", w.Name())
		assert.Equal(t, 5*time.Second, w.every())
		assert.Equal(t, 100, w.batch())
		assert.Equal(t, Grace, w.grace())
	})
}
