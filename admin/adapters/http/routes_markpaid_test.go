package http

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/admin/app"
	"github.com/haozing/ploykit/platform/webx"
)

type httpFakeBillingOps struct {
	gotMarkPaid string
	markPaidErr error

	planCodes []string
	planViews []app.AdminPlanView
}

func (f *httpFakeBillingOps) ListAllOrders(context.Context, string, string, int, int) ([]app.AdminOrder, int, error) {
	return nil, 0, nil
}
func (f *httpFakeBillingOps) ListPaymentEvents(context.Context, string, int, int) ([]app.AdminPaymentEvent, int, error) {
	return nil, 0, nil
}
func (f *httpFakeBillingOps) AdminCancelPendingOrder(context.Context, *webx.Principal, string) error {
	return nil
}
func (f *httpFakeBillingOps) RunExpiryNow(context.Context) (int, error) { return 0, nil }
func (f *httpFakeBillingOps) RunOverageNow(context.Context) (int, error) {
	return 0, nil
}
func (f *httpFakeBillingOps) ListPlanCodes(context.Context) ([]string, error) {
	return f.planCodes, nil
}
func (f *httpFakeBillingOps) ListPlanViews(context.Context) ([]app.AdminPlanView, error) {
	return f.planViews, nil
}
func (f *httpFakeBillingOps) MarkOrderPaid(_ context.Context, _ *webx.Principal, orderID string) error {
	f.gotMarkPaid = orderID
	return f.markPaidErr
}
func (f *httpFakeBillingOps) BillingConfig(context.Context) (app.AdminBillingConfig, error) {
	return app.AdminBillingConfig{}, nil
}
func (f *httpFakeBillingOps) TestChannelConnection(context.Context, string) error {
	return nil
}
func (f *httpFakeBillingOps) AdminCancelSubscription(context.Context, *webx.Principal, string) error {
	return nil
}

func newBillingOpsMux(ops app.BillingAdminOps) *http.ServeMux {
	svc := app.NewBillingOpsService(app.NewAdminService(&fakeRepo{}, time.Now)).WithBillingOps(ops)
	mux := http.NewServeMux()
	MountBillingOps(mux, BillingOpsDeps{Svc: svc})
	return mux
}

func billingReq(mux *http.ServeMux, method, path string, admin bool) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, nil)
	r = r.WithContext(webx.WithPrincipal(r.Context(), &webx.Principal{UserID: "op", IsPlatformAdmin: admin}))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	return w
}

func TestMarkOrderPaidRoute(t *testing.T) {
	t.Run("未认证 401 / 非平台管理员 403", func(t *testing.T) {
		mux := newBillingOpsMux(&httpFakeBillingOps{})
		r := httptest.NewRequest(http.MethodPost, "/api/admin/billing/orders/ord_1/mark-paid", nil)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		assert.Equal(t, http.StatusUnauthorized, w.Code)

		w = billingReq(mux, http.MethodPost, "/api/admin/billing/orders/ord_1/mark-paid", false)
		assert.Equal(t, http.StatusForbidden, w.Code)
	})

	t.Run("成功 200 + orderID 透传", func(t *testing.T) {
		f := &httpFakeBillingOps{}
		w := billingReq(newBillingOpsMux(f), http.MethodPost, "/api/admin/billing/orders/ord_9/mark-paid", true)
		require.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, "ord_9", f.gotMarkPaid)
	})

	t.Run("billing 侧错误保形：非 manual 400 / 非 pending 409", func(t *testing.T) {
		f := &httpFakeBillingOps{markPaidErr: webx.NewValidation("only manual orders can be marked paid")}
		w := billingReq(newBillingOpsMux(f), http.MethodPost, "/api/admin/billing/orders/ord_x/mark-paid", true)
		assert.Equal(t, http.StatusBadRequest, w.Code)

		f = &httpFakeBillingOps{markPaidErr: webx.NewConflict("order is not pending")}
		w = billingReq(newBillingOpsMux(f), http.MethodPost, "/api/admin/billing/orders/ord_x/mark-paid", true)
		assert.Equal(t, http.StatusConflict, w.Code)
	})

	t.Run("未知错误 → 500 包装", func(t *testing.T) {
		f := &httpFakeBillingOps{markPaidErr: errors.New("db down")}
		w := billingReq(newBillingOpsMux(f), http.MethodPost, "/api/admin/billing/orders/ord_x/mark-paid", true)
		assert.Equal(t, http.StatusInternalServerError, w.Code)
	})
}

func TestAdminPlansRoute_WithPlanViews(t *testing.T) {

	f := &httpFakeBillingOps{
		planCodes: []string{"free", "pro"},
		planViews: []app.AdminPlanView{
			{Code: "free", Name: "Free", Currency: "CNY", TrialDays: 0, SortNo: 1},
			{Code: "pro", Name: "Pro", Currency: "CNY", TrialDays: 14, SortNo: 2, Limits: map[string]int{"trial_days": 14}},
		},
	}
	w := billingReq(newBillingOpsMux(f), http.MethodGet, "/api/admin/plans", true)
	require.Equal(t, http.StatusOK, w.Code)

	var body struct {
		Items []string            `json:"items"`
		Plans []app.AdminPlanView `json:"plans"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.Equal(t, []string{"free", "pro"}, body.Items, "码表契约不变")
	require.Len(t, body.Plans, 2)
	assert.Equal(t, "CNY", body.Plans[1].Currency)
	assert.Equal(t, 14, body.Plans[1].TrialDays, "trial_days 从 plan.limits 投影透出")
}
