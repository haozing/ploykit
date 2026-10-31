package app

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/platform/webx"
)

type metaAuditor struct{ calls []metaAuditCall }

type metaAuditCall struct {
	ws                          *string
	p                           *webx.Principal
	action, resourceType, resID string
	meta                        map[string]any
}

func (f *metaAuditor) Record(_ context.Context, ws *string, p *webx.Principal, action, resourceType, resID string, meta map[string]any) {
	f.calls = append(f.calls, metaAuditCall{ws, p, action, resourceType, resID, meta})
}

type fakeAdminRepo struct {
	gotOrders                       AdminOrderFilter
	gotOrdersLimit, gotOrdersOffset int
	orders                          []AdminOrderView
	ordersTotal                     int

	gotEvents                       PaymentEventFilter
	gotEventsLimit, gotEventsOffset int
	events                          []PaymentEventView
	eventsTotal                     int

	codes []string

	gotUpdate   updatePlanCall
	updateFound bool
	updateErr   error
}

func (f *fakeAdminRepo) ListAllOrders(_ context.Context, flt AdminOrderFilter, limit, offset int) ([]AdminOrderView, int, error) {
	f.gotOrders, f.gotOrdersLimit, f.gotOrdersOffset = flt, limit, offset
	return f.orders, f.ordersTotal, nil
}

func (f *fakeAdminRepo) ListPaymentEvents(_ context.Context, flt PaymentEventFilter, limit, offset int) ([]PaymentEventView, int, error) {
	f.gotEvents, f.gotEventsLimit, f.gotEventsOffset = flt, limit, offset
	return f.events, f.eventsTotal, nil
}

func (f *fakeAdminRepo) ListPlanCodes(_ context.Context) ([]string, error) { return f.codes, nil }

type updatePlanCall struct {
	code, name, limitsJSON, currency string
	sortNo                           int
}

func (f *fakeAdminRepo) UpdatePlan(_ context.Context, code, name, limitsJSON string, sortNo int, currency string) (bool, error) {
	f.gotUpdate = updatePlanCall{code, name, limitsJSON, currency, sortNo}
	return f.updateFound, f.updateErr
}

func newAdminOpsForTest(repo Repo, aud Auditor) (*BillingAdminService, *fakeAdminRepo) {
	core := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{}, aud,
		func() time.Time { return testNow }, nil)
	ar := &fakeAdminRepo{}
	return NewBillingAdminService(core, ar, func() time.Time { return testNow }, nil), ar
}

func TestBillingAdminListAllOrders(t *testing.T) {
	ctx := context.Background()
	want := []AdminOrderView{{Order: domain.Order{ID: "ord_1"}, WorkspaceName: "测试区"}}

	tests := []struct {
		name        string
		ws, status  string
		wantErrCode int
	}{
		{"无过滤（全部订单）", "", "", 0},
		{"按工作区过滤", "ws-9", "", 0},
		{"合法状态过滤", "", "pending", 0},
		{"组合过滤", "ws-9", "canceled", 0},
		{"非法状态 → 400", "", "refunding", http.StatusBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, ar := newAdminOpsForTest(newFakeRepo(), &metaAuditor{})
			ar.orders, ar.ordersTotal = want, 7

			got, total, err := svc.ListAllOrders(ctx, AdminOrderFilter{WorkspaceID: tt.ws, Status: tt.status}, 20, 40)
			if tt.wantErrCode != 0 {
				var we *webx.Error
				require.ErrorAs(t, err, &we)
				assert.Equal(t, tt.wantErrCode, we.Status)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, want, got)
			assert.Equal(t, 7, total)

			assert.Equal(t, AdminOrderFilter{WorkspaceID: tt.ws, Status: tt.status}, ar.gotOrders)
			assert.Equal(t, 20, ar.gotOrdersLimit)
			assert.Equal(t, 40, ar.gotOrdersOffset)
		})
	}
}

func TestBillingAdminCancelPendingOrder(t *testing.T) {
	ctx := context.Background()
	adminP := &webx.Principal{UserID: "op-1", Email: "op@test.local", IsPlatformAdmin: true}

	tests := []struct {
		name          string
		status        domain.OrderStatus
		wantErrStatus int
	}{
		{"pending → 取消成功", domain.OrderPending, 0},
		{"paid → 409（状态机只允许 pending）", domain.OrderPaid, http.StatusConflict},
		{"canceled → 409", domain.OrderCanceled, http.StatusConflict},
		{"refunded → 409", domain.OrderRefunded, http.StatusConflict},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := newFakeRepo()
			repo.orders["ord_1"] = &domain.Order{
				ID: "ord_1", WorkspaceID: "ws_1", PlanCode: "pro",
				Interval: domain.IntervalMonthly, Status: tt.status,
			}
			aud := &metaAuditor{}
			svc, _ := newAdminOpsForTest(repo, aud)

			err := svc.AdminCancelPendingOrder(ctx, adminP, "ord_1")
			if tt.wantErrStatus != 0 {
				var we *webx.Error
				require.ErrorAs(t, err, &we)
				assert.Equal(t, tt.wantErrStatus, we.Status)
				assert.Empty(t, aud.calls, "失败的取消不应写审计")
				assert.Equal(t, tt.status, repo.orders["ord_1"].Status, "失败路径订单状态不变")
				return
			}
			require.NoError(t, err)
			assert.Equal(t, domain.OrderCanceled, repo.orders["ord_1"].Status, "订单应迁移到 canceled")

			require.Len(t, aud.calls, 1)
			c := aud.calls[0]
			assert.Equal(t, "billing.order_canceled", c.action)
			assert.Equal(t, "order", c.resourceType)
			assert.Equal(t, "ord_1", c.resID)
			require.NotNil(t, c.ws)
			assert.Equal(t, "ws_1", *c.ws)
			assert.Equal(t, map[string]any{"admin": true}, c.meta)
			assert.Equal(t, adminP, c.p, "审计 actor 是管理员本人")
		})
	}

	t.Run("未知订单 → 404", func(t *testing.T) {
		svc, _ := newAdminOpsForTest(newFakeRepo(), &metaAuditor{})
		err := svc.AdminCancelPendingOrder(ctx, adminP, "ord_x")
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusNotFound, we.Status)
	})

	t.Run("core 未挂 auditor 不 panic", func(t *testing.T) {
		repo := newFakeRepo()
		repo.orders["ord_1"] = &domain.Order{ID: "ord_1", WorkspaceID: "ws_1", Status: domain.OrderPending}
		svc, _ := newAdminOpsForTest(repo, nil)
		assert.NotPanics(t, func() {
			require.NoError(t, svc.AdminCancelPendingOrder(ctx, adminP, "ord_1"))
		})
	})
}

func TestBillingAdminRunExpiryNow(t *testing.T) {
	ctx := context.Background()
	repo := newFakeRepo()
	repo.expired = []ExpiredWorkspace{
		{WorkspaceID: "ws_1", FromPlan: "pro"},
		{WorkspaceID: "ws_2", FromPlan: "enterprise"},
	}
	aud := &metaAuditor{}
	svc, _ := newAdminOpsForTest(repo, aud)

	n, err := svc.RunExpiryNow(ctx)
	require.NoError(t, err)
	assert.Equal(t, 2, n, "返回本轮降级工作区数")

	require.Len(t, aud.calls, 2)
	for _, c := range aud.calls {
		assert.Equal(t, "billing.plan_expired", c.action)
	}
}

func TestBillingAdminRunOverageNow(t *testing.T) {
	ctx := context.Background()

	t.Run("usage 未装配 → 明确 503", func(t *testing.T) {
		svc, _ := newAdminOpsForTest(newFakeRepo(), &metaAuditor{})
		n, err := svc.RunOverageNow(ctx)
		require.Error(t, err)
		assert.Zero(t, n)
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusServiceUnavailable, we.Status)
		assert.Contains(t, we.Message, "usage")
	})

	t.Run("usage 装配 → 委托 MeterDueOverages 并返回新建订单数", func(t *testing.T) {
		repo := newFakeRepo()
		future := testNow.Add(time.Hour)
		repo.metered = []MeteredWorkspace{{
			WorkspaceID:   "ws_1",
			PlanCode:      "pro",
			Limits:        map[string]int{"metered_tokens_unit_cents": 10, "metered_tokens_included": 100},
			PlanExpiresAt: &future,
		}}
		aud := &metaAuditor{}
		svc, _ := newAdminOpsForTest(repo, aud)
		svc.WithUsage(func(_ context.Context, _, _, _ string) (int64, int64, error) {
			return 120, 0, nil
		})

		n, err := svc.RunOverageNow(ctx)
		require.NoError(t, err)
		assert.Equal(t, 1, n)

		require.Len(t, aud.calls, 1)
		assert.Equal(t, "billing.metered_overage", aud.calls[0].action)
	})
}

func TestBillingAdminListPaymentEventsAndPlanCodes(t *testing.T) {
	ctx := context.Background()
	svc, ar := newAdminOpsForTest(newFakeRepo(), &metaAuditor{})
	ar.codes = []string{"free", "pro"}
	ar.events = []PaymentEventView{{ID: "pe_1", Channel: "stripe", Processed: true}}
	ar.eventsTotal = 1

	codes, err := svc.ListPlanCodes(ctx)
	require.NoError(t, err)
	assert.Equal(t, []string{"free", "pro"}, codes)

	events, total, err := svc.ListPaymentEvents(ctx, PaymentEventFilter{WorkspaceID: "ws-3"}, 10, 20)
	require.NoError(t, err)
	assert.Equal(t, ar.events, events)
	assert.Equal(t, 1, total)
	assert.Equal(t, PaymentEventFilter{WorkspaceID: "ws-3"}, ar.gotEvents)
	assert.Equal(t, 10, ar.gotEventsLimit)
	assert.Equal(t, 20, ar.gotEventsOffset)
}

func TestBillingAdminUpdatePlan(t *testing.T) {
	ctx := context.Background()
	adminP := &webx.Principal{UserID: "op-1", Email: "op@test.local", IsPlatformAdmin: true}

	// newSvc 预置 core fake repo 的 pro 行（AdminUpdatePlan 要取 from 快照）
	newSvc := func(aud Auditor) (*BillingAdminService, *fakeAdminRepo) {
		repo := newFakeRepo()
		repo.plans["pro"] = domain.Plan{
			Code: "pro", Name: "Pro", Currency: "CNY", SortNo: 1,
			Limits: map[string]int{"price_monthly_cents": 4900, "workspaces": 1},
		}
		svc, ar := newAdminOpsForTest(repo, aud)
		ar.codes = []string{"pro"}
		ar.updateFound = true
		return svc, ar
	}

	t.Run("校验矩阵：非法输入 400 且不触库不写审计", func(t *testing.T) {
		badKey65 := strings.Repeat("a", 65)
		tests := []struct {
			name  string
			input PlanUpdateInput
		}{
			{"name 空白（trim 后 0 rune）", PlanUpdateInput{Name: "  ", Currency: "USD"}},
			{"name 101 rune（按 rune 计，中文）", PlanUpdateInput{Name: strings.Repeat("价", 101), Currency: "USD"}},
			{"currency 小写", PlanUpdateInput{Name: "Pro", Currency: "usd"}},
			{"currency 2 字母", PlanUpdateInput{Name: "Pro", Currency: "US"}},
			{"currency 4 字母", PlanUpdateInput{Name: "Pro", Currency: "USDD"}},
			{"limits 键大写开头", PlanUpdateInput{Name: "Pro", Currency: "USD", Limits: map[string]int{"Price": 1}}},
			{"limits 键数字开头", PlanUpdateInput{Name: "Pro", Currency: "USD", Limits: map[string]int{"9price": 1}}},
			{"limits 键空", PlanUpdateInput{Name: "Pro", Currency: "USD", Limits: map[string]int{"": 1}}},
			{"limits 键超 64 字符", PlanUpdateInput{Name: "Pro", Currency: "USD", Limits: map[string]int{badKey65: 1}}},
		}
		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				aud := &metaAuditor{}
				svc, ar := newSvc(aud)

				_, err := svc.AdminUpdatePlan(ctx, adminP, "pro", tt.input)
				var we *webx.Error
				require.ErrorAs(t, err, &we)
				assert.Equal(t, http.StatusBadRequest, we.Status)
				assert.Equal(t, updatePlanCall{}, ar.gotUpdate, "校验拒绝不得触达 repo")
				assert.Empty(t, aud.calls, "校验拒绝不写审计")
			})
		}
	})

	t.Run("合法边界放行：name 恰 100 rune / sort_no 负数 / limits nil / -1 无限哨兵", func(t *testing.T) {
		aud := &metaAuditor{}
		svc, ar := newSvc(aud)

		view, err := svc.AdminUpdatePlan(ctx, adminP, "pro", PlanUpdateInput{
			Name: strings.Repeat("价", 100), Currency: "USD", SortNo: -7,
		})
		require.NoError(t, err)
		assert.True(t, ar.updateFound)
		assert.Equal(t, "pro", ar.gotUpdate.code)
		assert.Equal(t, strings.Repeat("价", 100), ar.gotUpdate.name)
		assert.Equal(t, "USD", ar.gotUpdate.currency)
		assert.Equal(t, -7, ar.gotUpdate.sortNo)
		assert.JSONEq(t, `{}`, ar.gotUpdate.limitsJSON, "nil limits = 全量替换为空表")

		assert.Equal(t, PlanView{
			Code: "pro", Name: strings.Repeat("价", 100), Currency: "USD",
			SortNo: -7, Limits: map[string]int{},
		}, view)
	})

	t.Run("全量替换落库 + 返回 PlanView（与 ListPlanViews 同形）", func(t *testing.T) {
		aud := &metaAuditor{}
		svc, ar := newSvc(aud)

		view, err := svc.AdminUpdatePlan(ctx, adminP, "pro", PlanUpdateInput{
			Name: "专业版", Currency: "USD", SortNo: 2,
			Limits: map[string]int{"price_monthly_cents": 990, "workspaces": -1, "trial_days": 14},
		})
		require.NoError(t, err)
		assert.JSONEq(t, `{"price_monthly_cents":990,"workspaces":-1,"trial_days":14}`, ar.gotUpdate.limitsJSON)
		assert.Equal(t, PlanView{
			Code: "pro", Name: "专业版", Currency: "USD", TrialDays: 14, SortNo: 2,
			Limits: map[string]int{"price_monthly_cents": 990, "workspaces": -1, "trial_days": 14},
		}, view, "TrialDays 从 limits 投影，与 service_planview.planView 同形")
	})

	t.Run("未知 code → 404 且不写审计", func(t *testing.T) {
		aud := &metaAuditor{}
		svc, ar := newSvc(aud)

		_, err := svc.AdminUpdatePlan(ctx, adminP, "nope", PlanUpdateInput{Name: "x", Currency: "USD"})
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusNotFound, we.Status)
		assert.Equal(t, updatePlanCall{}, ar.gotUpdate, "不存在时不发 UPDATE")
		assert.Empty(t, aud.calls)
	})

	t.Run("UPDATE 竞态未命中（found=false）→ 404", func(t *testing.T) {
		aud := &metaAuditor{}
		svc, ar := newSvc(aud)
		ar.updateFound = false

		_, err := svc.AdminUpdatePlan(ctx, adminP, "pro", PlanUpdateInput{Name: "x", Currency: "USD"})
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusNotFound, we.Status)
		assert.Empty(t, aud.calls)
	})

	t.Run("成功 → 平台级审计 admin.plan_change（from/to 快照，workspaceID nil）", func(t *testing.T) {
		aud := &metaAuditor{}
		svc, _ := newSvc(aud)

		_, err := svc.AdminUpdatePlan(ctx, adminP, "pro", PlanUpdateInput{
			Name: "专业版", Currency: "USD", SortNo: 2,
			Limits: map[string]int{"price_monthly_cents": 990, "workspaces": -1},
		})
		require.NoError(t, err)

		require.Len(t, aud.calls, 1)
		c := aud.calls[0]
		assert.Nil(t, c.ws, "平台级事件，workspaceID nil")
		assert.Equal(t, adminP, c.p, "审计 actor 是管理员本人")
		assert.Equal(t, "admin.plan_change", c.action)
		assert.Equal(t, "plan", c.resourceType)
		assert.Equal(t, "pro", c.resID)

		assert.Equal(t, map[string]any{
			"from": map[string]any{
				"code": "pro", "name": "Pro", "currency": "CNY", "sort_no": 1,
				"limits": map[string]int{"price_monthly_cents": 4900, "workspaces": 1},
			},
			"to": map[string]any{
				"code": "pro", "name": "专业版", "currency": "USD", "sort_no": 2,
				"limits": map[string]int{"price_monthly_cents": 990, "workspaces": -1},
			},
		}, c.meta)
	})

	t.Run("core 未挂 auditor 不 panic", func(t *testing.T) {
		svc, _ := newSvc(nil)
		assert.NotPanics(t, func() {
			_, err := svc.AdminUpdatePlan(ctx, adminP, "pro", PlanUpdateInput{Name: "x", Currency: "USD"})
			require.NoError(t, err)
		})
	})
}
