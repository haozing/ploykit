package app

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/billing/domain"
)

func TestListPlanViews_TrialDaysProjection(t *testing.T) {
	base := newFakeRepo()
	base.wsPlan["ws_1"] = "pro"
	svc := NewBillingService(&plansRepo{fakeRepo: base, plans: []domain.Plan{
		{Code: "free", Name: "免费版", Currency: "CNY", SortNo: 1, Limits: map[string]int{"tasks_monthly": 50}},
		{Code: "pro", Name: "专业版", Currency: "USD", SortNo: 2, Limits: map[string]int{"price_monthly_cents": 9900, "trial_days": 14}},
	}}, NewChannelRegistry(), Config{}, BillingHooks{}, nil, func() time.Time { return testNow }, nil)

	views, err := svc.ListPlanViews(context.Background())
	require.NoError(t, err)
	require.Len(t, views, 2)

	assert.Equal(t, 14, views[1].TrialDays, "trial_days 应从 limits 投影为显式字段")
	assert.Equal(t, 0, views[0].TrialDays, "未配置试用 → 0（显式可编辑口径）")
	assert.Equal(t, "USD", views[1].Currency)
	assert.Equal(t, 2, views[1].SortNo)
	assert.Equal(t, map[string]int{"price_monthly_cents": 9900, "trial_days": 14}, views[1].Limits,
		"limits 原样透传（编辑回写仍走 limits，单一事实源不新建）")
}
