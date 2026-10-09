package pgrepo

import (
	"context"
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
