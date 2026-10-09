package app

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/billing/domain"
)

func TestMeteredDims(t *testing.T) {
	tests := []struct {
		name   string
		limits map[string]int
		want   []meteredDim
	}{
		{
			name:   "无计量键 → 空",
			limits: map[string]int{"tasks_monthly": -1, "price_monthly_cents": 9900},
			want:   nil,
		},
		{
			name: "单维：单价 + 基础包含",
			limits: map[string]int{
				"metered_tasks_monthly_unit_cents": 10,
				"metered_tasks_monthly_included":   100,
			},
			want: []meteredDim{{Dim: "tasks_monthly", UnitCents: 10, Included: 100}},
		},
		{
			name: "多维：按 dim 排序稳定",
			limits: map[string]int{
				"metered_api_calls_unit_cents":     2,
				"metered_tasks_monthly_included":   50,
				"metered_tasks_monthly_unit_cents": 10,
				"metered_api_calls_included":       1000,
			},
			want: []meteredDim{
				{Dim: "api_calls", UnitCents: 2, Included: 1000},
				{Dim: "tasks_monthly", UnitCents: 10, Included: 50},
			},
		},
		{
			name: "只有 included 无单价 → 该维不计量",
			limits: map[string]int{
				"metered_api_calls_included": 100,
			},
			want: nil,
		},
		{
			name: "单价 <= 0 → 不计量（免费维度不出账）",
			limits: map[string]int{
				"metered_api_calls_unit_cents": 0,
				"metered_api_calls_included":   10,
			},
			want: nil,
		},
		{
			name: "included 缺省 0（全量按单价计）",
			limits: map[string]int{
				"metered_api_calls_unit_cents": 3,
			},
			want: []meteredDim{{Dim: "api_calls", UnitCents: 3, Included: 0}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, meteredDims(tt.limits))
		})
	}
}

type overageCall struct {
	order   domain.Order
	created bool
}

func TestCreateOverageOrder_AmountAndSkip(t *testing.T) {
	tests := []struct {
		name       string
		used       int64
		included   int64
		unitCents  int64
		wantCreate bool
		wantAmount int64
	}{
		{name: "超额 20 单位 × 10 分 = 200 分", used: 120, included: 100, unitCents: 10, wantCreate: true, wantAmount: 200},
		{name: "刚好用满基础包 → 不建单", used: 100, included: 100, unitCents: 10, wantCreate: false},
		{name: "未超基础包 → 不建单", used: 40, included: 100, unitCents: 10, wantCreate: false},
		{name: "单价 0 → 不建单", used: 120, included: 100, unitCents: 0, wantCreate: false},
		{name: "included 缺省 0 → 全量计费", used: 30, included: 0, unitCents: 5, wantCreate: true, wantAmount: 150},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := newFakeRepo()
			repo.plans["pro"] = domain.Plan{Code: "pro", Limits: map[string]int{"metered_tasks_monthly_unit_cents": 10}}
			auditor := &fakeAuditor{}
			hooks := &overageHookSink{}
			svc := NewBillingService(repo, NewChannelRegistry(), Config{Currency: "CNY"}, BillingHooks{
				OnMeteredOverage: hooks.record,
			}, auditor, func() time.Time { return testNow }, nil)

			order, created, err := svc.CreateOverageOrder(context.Background(), "ws_1", "2026-09",
				[]OverageItem{{Dim: "tasks_monthly", Used: tt.used, Included: tt.included, UnitCents: tt.unitCents}}, testNow)
			require.NoError(t, err)
			assert.Equal(t, tt.wantCreate, created)
			if !tt.wantCreate {
				assert.Empty(t, repo.overageCalls, "金额<=0 不得触碰订单表")
				assert.Empty(t, hooks.calls, "未建单不触发钩子")
				assert.Empty(t, auditor.calls, "未建单不审计")
				return
			}
			assert.Equal(t, tt.wantAmount, int64(order.AmountCents))
			require.Len(t, repo.overageCalls, 1)
			got := repo.overageCalls[0].order
			assert.Equal(t, domain.IntervalOneTime, got.Interval)
			assert.Equal(t, domain.OrderPending, got.Status)
			assert.Equal(t, "2026-09", got.Metadata["overage_period"])
			meta := got.Metadata["items"].([]overageMetaItem)
			require.Len(t, meta, 1)
			assert.Equal(t, "tasks_monthly", meta[0].Dim)
			assert.Equal(t, tt.used, meta[0].Used)
			assert.Equal(t, tt.included, meta[0].Included)
			assert.Equal(t, tt.wantAmount, meta[0].OverageCents)
			assert.Equal(t, "CNY", got.Currency)

			require.Len(t, hooks.calls, 1)
			assert.Equal(t, "ws_1", hooks.calls[0].workspaceID)
			assert.Equal(t, order.ID, hooks.calls[0].orderID)
			assert.Equal(t, "2026-09", hooks.calls[0].period)
			assert.Equal(t, 1, hooks.calls[0].items)
			assert.Equal(t, tt.wantAmount, hooks.calls[0].amountCents)

			require.Len(t, auditor.calls, 1)
			assert.Equal(t, "billing.metered_overage", auditor.calls[0].action)
			assert.Equal(t, "order", auditor.calls[0].resourceType)
			assert.Equal(t, order.ID, auditor.calls[0].resourceID)
		})
	}
}

func TestCreateOverageOrder_DuplicateNoHookNoAudit(t *testing.T) {
	repo := newFakeRepo()

	repo.overageIndex["ws_1|2026-09"] = true
	auditor := &fakeAuditor{}
	hooks := &overageHookSink{}
	svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{
		OnMeteredOverage: hooks.record,
	}, auditor, func() time.Time { return testNow }, nil)

	_, created, err := svc.CreateOverageOrder(context.Background(), "ws_1", "2026-09",
		[]OverageItem{{Dim: "tasks_monthly", Used: 120, Included: 100, UnitCents: 10}}, testNow)
	require.NoError(t, err)
	assert.False(t, created, "同工作区同周期已出账 → created=false（幂等）")
	assert.Empty(t, hooks.calls, "重复出账不触发钩子")
	assert.Empty(t, auditor.calls, "重复出账不审计")
}

func TestPreviousMonthPeriod(t *testing.T) {
	tests := []struct {
		now  time.Time
		want string
	}{
		{time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC), "2026-09"},
		{time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), "2025-12"},
		{time.Date(2026, 3, 31, 23, 59, 59, 0, time.UTC), "2026-02"},
		{time.Date(2026, 7, 31, 0, 0, 0, 0, time.UTC), "2026-06"},
	}
	for _, tt := range tests {
		assert.Equal(t, tt.want, previousMonthPeriod(tt.now), tt.now.String())
	}
}

type fakeUsage struct {
	vals map[string]int64
	errs map[string]error
}

func (f fakeUsage) read(_ context.Context, ws, key, period string) (int64, int64, error) {
	if err, ok := f.errs[ws+"|"+key+"|"+period]; ok {
		return 0, 0, err
	}
	return f.vals[ws+"|"+key+"|"+period], 0, nil
}

func TestMeterDueOverages_Unit(t *testing.T) {
	active := testNow.AddDate(0, 1, 0)
	expired := testNow.Add(-time.Hour)
	limits := map[string]int{
		"metered_tasks_monthly_unit_cents": 10, "metered_tasks_monthly_included": 100,
		"metered_api_calls_unit_cents": 2, "metered_api_calls_included": 1000,
	}

	t.Run("跳过无当前订阅（IS NULL 或已过期）", func(t *testing.T) {
		repo := newFakeRepo()
		repo.metered = []MeteredWorkspace{
			{WorkspaceID: "ws_null", PlanCode: "pro", Limits: limits, PlanExpiresAt: nil},
			{WorkspaceID: "ws_past", PlanCode: "pro", Limits: limits, PlanExpiresAt: &expired},
			{WorkspaceID: "ws_live", PlanCode: "pro", Limits: limits, PlanExpiresAt: &active},
		}
		usage := fakeUsage{vals: map[string]int64{
			"ws_null|tasks_monthly|2026-09": 500,
			"ws_past|tasks_monthly|2026-09": 500,
			"ws_live|tasks_monthly|2026-09": 120,
		}}
		svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{}, nil,
			func() time.Time { return testNow }, nil)

		created, err := svc.MeterDueOverages(context.Background(), testNow, usage.read, 10)
		require.NoError(t, err)
		require.Len(t, created, 1, "只有持有当前订阅的工作区计量")
		assert.Equal(t, "ws_live", created[0].WorkspaceID)

		assert.Equal(t, "2026-09", created[0].Metadata["overage_period"])
	})

	t.Run("多维：一工作区一周期一单，全部有效维度聚合计价", func(t *testing.T) {
		repo := newFakeRepo()
		repo.metered = []MeteredWorkspace{
			{WorkspaceID: "ws_multi", PlanCode: "pro", Limits: limits, PlanExpiresAt: &active},
		}
		usage := fakeUsage{vals: map[string]int64{
			"ws_multi|tasks_monthly|2026-09": 130,
			"ws_multi|api_calls|2026-09":     1020,
		}}
		hooks := &overageHookSink{}
		svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{
			OnMeteredOverage: hooks.record,
		}, nil, func() time.Time { return testNow }, nil)

		created, err := svc.MeterDueOverages(context.Background(), testNow, usage.read, 10)
		require.NoError(t, err)
		require.Len(t, created, 1, "一工作区一周期一单：全部维度聚合")
		assert.Equal(t, 340, created[0].AmountCents, "(130-100)*10 + (1020-1000)*2 = 340")
		meta := created[0].Metadata["items"].([]overageMetaItem)
		require.Len(t, meta, 2)
		assert.Equal(t, "api_calls", meta[0].Dim)
		assert.Equal(t, int64(40), meta[0].OverageCents)
		assert.Equal(t, "tasks_monthly", meta[1].Dim)
		assert.Equal(t, int64(300), meta[1].OverageCents)
		require.Len(t, hooks.calls, 1)
		assert.Equal(t, 2, hooks.calls[0].items)

		created, err = svc.MeterDueOverages(context.Background(), testNow, usage.read, 10)
		require.NoError(t, err)
		assert.Empty(t, created)
		assert.Len(t, hooks.calls, 1, "重复轮次不再触发钩子")
	})

	t.Run("未超基础包的维度跳过，不影响其他维度", func(t *testing.T) {
		repo := newFakeRepo()
		single := map[string]int{"metered_api_calls_unit_cents": 2, "metered_api_calls_included": 1000}
		repo.metered = []MeteredWorkspace{
			{WorkspaceID: "ws_s", PlanCode: "pro", Limits: single, PlanExpiresAt: &active},
		}
		usage := fakeUsage{vals: map[string]int64{"ws_s|api_calls|2026-09": 40}}
		svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{}, nil,
			func() time.Time { return testNow }, nil)

		created, err := svc.MeterDueOverages(context.Background(), testNow, usage.read, 10)
		require.NoError(t, err)
		assert.Empty(t, created, "用量未超基础包 → 金额<=0 不建单")
	})

	t.Run("usage 读取失败：记日志继续，不中断整轮", func(t *testing.T) {
		repo := newFakeRepo()
		repo.metered = []MeteredWorkspace{
			{WorkspaceID: "ws_err", PlanCode: "pro", Limits: limits, PlanExpiresAt: &active},
		}
		usage := fakeUsage{
			vals: map[string]int64{"ws_err|tasks_monthly|2026-09": 120},
			errs: map[string]error{"ws_err|api_calls|2026-09": assert.AnError},
		}
		svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{}, nil,
			func() time.Time { return testNow }, nil)

		created, err := svc.MeterDueOverages(context.Background(), testNow, usage.read, 10)
		require.NoError(t, err)
		require.Len(t, created, 1, "api_calls 读失败被跳过，tasks_monthly 照常出账")
		meta := created[0].Metadata["items"].([]overageMetaItem)
		require.Len(t, meta, 1)
		assert.Equal(t, "tasks_monthly", meta[0].Dim)
	})
}

func TestUsagePreview(t *testing.T) {
	limits := map[string]int{
		"metered_tasks_monthly_unit_cents": 10, "metered_tasks_monthly_included": 100,
		"metered_api_calls_unit_cents": 2, "metered_api_calls_included": 1000,
	}

	t.Run("多维按 dim 排序，projected 只累计超额", func(t *testing.T) {
		repo := newFakeRepo()
		repo.wsPlan["ws_1"] = "pro"
		repo.plans["pro"] = domain.Plan{Code: "pro", Limits: limits}
		usage := fakeUsage{vals: map[string]int64{
			"ws_1|tasks_monthly|2026-10": 120,
			"ws_1|api_calls|2026-10":     400,
		}}
		svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{}, nil,
			func() time.Time { return testNow }, nil)

		pv, err := svc.UsagePreview(context.Background(), "ws_1", usage.read)
		require.NoError(t, err)
		assert.Equal(t, "2026-10", pv.Period, "当期实时（非上一周期）")
		require.Len(t, pv.Items, 2, "全部计量维度都列出（含未超额项）")
		assert.Equal(t, UsagePreviewItem{Dim: "api_calls", Used: 400, Included: 1000, UnitCents: 2, ProjectedOverageCents: 0}, pv.Items[0])
		assert.Equal(t, UsagePreviewItem{Dim: "tasks_monthly", Used: 120, Included: 100, UnitCents: 10, ProjectedOverageCents: 200}, pv.Items[1])
		assert.Equal(t, int64(200), pv.ProjectedTotalCents)
	})

	t.Run("无计量维度 → 空 items + 0 总额", func(t *testing.T) {
		repo := newFakeRepo()
		repo.plans["free"] = domain.Plan{Code: "free", Limits: map[string]int{"tasks_monthly": 50}}
		svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{}, nil,
			func() time.Time { return testNow }, nil)

		pv, err := svc.UsagePreview(context.Background(), "ws_1", fakeUsage{}.read)
		require.NoError(t, err)
		assert.Empty(t, pv.Items)
		assert.Equal(t, int64(0), pv.ProjectedTotalCents)
	})

	t.Run("套餐不存在 → 兜底空预估（不报错）", func(t *testing.T) {
		repo := newFakeRepo()
		svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{}, nil,
			func() time.Time { return testNow }, nil)
		pv, err := svc.UsagePreview(context.Background(), "ws_ghost", fakeUsage{}.read)
		require.NoError(t, err)
		assert.Empty(t, pv.Items)
	})

	t.Run("usage 读取失败 → 请求失败", func(t *testing.T) {
		repo := newFakeRepo()
		repo.wsPlan["ws_1"] = "pro"
		repo.plans["pro"] = domain.Plan{Code: "pro", Limits: limits}
		usage := fakeUsage{errs: map[string]error{"ws_1|tasks_monthly|2026-10": assert.AnError}}
		svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{}, nil,
			func() time.Time { return testNow }, nil)
		_, err := svc.UsagePreview(context.Background(), "ws_1", usage.read)
		assert.Error(t, err)
	})
}

type overageHookRecord struct {
	workspaceID string
	orderID     string
	period      string
	items       int
	amountCents int64
}

type overageHookSink struct{ calls []overageHookRecord }

func (h *overageHookSink) record(_ context.Context, ws, orderID, period string, items int, amount int64) error {
	h.calls = append(h.calls, overageHookRecord{ws, orderID, period, items, amount})
	return nil
}
