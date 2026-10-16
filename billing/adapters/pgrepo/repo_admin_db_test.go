package pgrepo

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/billing/app"
	"github.com/haozing/ploykit/billing/domain"
)

func TestListAllOrders_NoFilterReturnsRows_BOrders1(t *testing.T) {
	repo := subTestDB(t)
	ctx := context.Background()
	ws := seedWS(t, repo, "pro", "", nil)
	seedPaidOrder(t, repo, ws, "pro", "monthly", time.Now().UTC())

	items, total, err := repo.ListAllOrders(ctx, app.AdminOrderFilter{}, 20, 0)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, total, 1, "空过滤必须计数到订单（B-orders-1：修复前 total=0）")
	assert.NotEmpty(t, items, "空过滤必须返回订单行（B-orders-1：修复前列表恒空）")
	found := false
	for _, v := range items {
		if v.WorkspaceID == ws {
			found = true
			assert.Equal(t, "订阅测试", v.WorkspaceName, "join workspace 应带名称")
			assert.Equal(t, domain.OrderStatus("paid"), v.Status)
		}
	}
	assert.True(t, found, "空过滤结果应包含刚种的订单")

	items, total, err = repo.ListAllOrders(ctx, app.AdminOrderFilter{WorkspaceID: ws}, 20, 0)
	require.NoError(t, err)
	assert.Equal(t, 1, total)
	require.Len(t, items, 1)
	assert.Equal(t, ws, items[0].WorkspaceID)

	items, total, err = repo.ListAllOrders(ctx, app.AdminOrderFilter{WorkspaceID: ws, Status: "paid"}, 20, 0)
	require.NoError(t, err)
	assert.Equal(t, 1, total)
	assert.Len(t, items, 1)
	items, total, err = repo.ListAllOrders(ctx, app.AdminOrderFilter{WorkspaceID: ws, Status: "pending"}, 20, 0)
	require.NoError(t, err)
	assert.Equal(t, 0, total)
	assert.Empty(t, items)
}

func TestAdminOrderWhere_AllowsEmptyFilter_NoDB(t *testing.T) {
	assert.Contains(t, adminOrderWhere, "NULLIF($1, '')::uuid IS NULL OR",
		"空过滤放行必须走显式 IS NULL OR 分支，禁止 col = NULLIF 单独成句")
}

func TestUpdatePlan_FullReplaceAndNotFound(t *testing.T) {
	repo := subTestDB(t)
	ctx := context.Background()

	before, ok, err := repo.GetPlan(ctx, "pro")
	require.NoError(t, err)
	require.True(t, ok, "框架种子套餐 free/pro 必须存在（007_plan_seed）")
	t.Cleanup(func() {
		orig, _ := json.Marshal(before.Limits)
		_, _ = repo.pool.Exec(context.Background(),
			`UPDATE plan SET name = $2, limits = $3, sort_no = $4, currency = $5 WHERE code = $1`,
			"pro", before.Name, string(orig), before.SortNo, before.Currency)
	})

	found, err := repo.UpdatePlan(ctx, "pro", "专业版-改",
		`{"price_monthly_cents":990,"workspaces":-1}`, 9, "USD")
	require.NoError(t, err)
	assert.True(t, found)

	after, ok, err := repo.GetPlan(ctx, "pro")
	require.NoError(t, err)
	require.True(t, ok)
	assert.Equal(t, "专业版-改", after.Name)
	assert.Equal(t, "USD", after.Currency)
	assert.Equal(t, 9, after.SortNo)
	assert.Equal(t, map[string]int{"price_monthly_cents": 990, "workspaces": -1}, after.Limits,
		"全量替换语义：不在新 limits 里的旧键必须消失")

	found, err = repo.UpdatePlan(ctx, "no_such_plan", "x", `{}`, 0, "USD")
	require.NoError(t, err)
	assert.False(t, found, "未知 code RowsAffected==0 → found=false（服务层转 404）")
}
