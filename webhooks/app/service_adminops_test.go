package app

import (
	"context"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/webx"
)

type adminRepoFake struct {
	*fakeRepo
	gotFilter           DeliveryFilter
	gotLimit, gotOffset int
	rows                []AdminDeliveryView
	total               int

	gotRedeliver string
	newRow       AdminDeliveryView
	redeliverErr error
}

func (f *adminRepoFake) ListAllDeliveries(_ context.Context, flt DeliveryFilter, limit, offset int) ([]AdminDeliveryView, int, error) {
	f.gotFilter, f.gotLimit, f.gotOffset = flt, limit, offset
	return f.rows, f.total, nil
}

func (f *adminRepoFake) AdminRedeliver(_ context.Context, deliveryID string) (AdminDeliveryView, error) {
	f.gotRedeliver = deliveryID
	return f.newRow, f.redeliverErr
}

func TestWebhookAdminListAllDeliveries(t *testing.T) {
	ctx := context.Background()

	t.Run("过滤与分页透传", func(t *testing.T) {
		f := &adminRepoFake{fakeRepo: newFakeRepo(), rows: []AdminDeliveryView{{Delivery: Delivery{ID: "dlv_1"}}}, total: 9}
		svc := newTestService(f)

		got, total, err := svc.ListAllDeliveries(ctx, DeliveryFilter{WorkspaceID: "ws-2", Status: "dead"}, 20, 40)
		require.NoError(t, err)
		assert.Equal(t, f.rows, got)
		assert.Equal(t, 9, total)
		assert.Equal(t, DeliveryFilter{WorkspaceID: "ws-2", Status: "dead"}, f.gotFilter)
		assert.Equal(t, 20, f.gotLimit)
		assert.Equal(t, 40, f.gotOffset)
	})

	t.Run("非法状态 → 400", func(t *testing.T) {
		f := &adminRepoFake{fakeRepo: newFakeRepo()}
		svc := newTestService(f)
		_, _, err := svc.ListAllDeliveries(ctx, DeliveryFilter{Status: "sent"}, 20, 0)
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusBadRequest, we.Status)
	})

	t.Run("repo 未实现 AdminRepo → 503（明确报缺不 panic）", func(t *testing.T) {
		svc := newTestService(newFakeRepo())
		_, _, err := svc.ListAllDeliveries(ctx, DeliveryFilter{}, 20, 0)
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusServiceUnavailable, we.Status)
	})
}

func TestWebhookAdminRedeliver(t *testing.T) {
	ctx := context.Background()

	t.Run("透传并返回新行（绕过归属校验：无 workspaceID 参数）", func(t *testing.T) {
		f := &adminRepoFake{fakeRepo: newFakeRepo(),
			newRow: AdminDeliveryView{Delivery: Delivery{ID: "dlv_new", Status: StatusPending}, WorkspaceID: "ws-2", URL: "https://x.test/hook"}}
		svc := newTestService(f)

		got, err := svc.AdminRedeliver(ctx, "dlv_src")
		require.NoError(t, err)
		assert.Equal(t, "dlv_new", got.ID)
		assert.Equal(t, StatusPending, got.Status)
		assert.Equal(t, "dlv_src", f.gotRedeliver)
	})

	t.Run("未知投递 → ErrNotFound（存在性校验保留）", func(t *testing.T) {
		f := &adminRepoFake{fakeRepo: newFakeRepo(), redeliverErr: ErrNotFound}
		svc := newTestService(f)
		_, err := svc.AdminRedeliver(ctx, "dlv_x")
		require.ErrorIs(t, err, ErrNotFound)
	})

	t.Run("repo 未实现 AdminRepo → 503", func(t *testing.T) {
		svc := newTestService(newFakeRepo())
		_, err := svc.AdminRedeliver(ctx, "dlv_1")
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusServiceUnavailable, we.Status)
	})
}
