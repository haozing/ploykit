package http

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/admin/app"
	"github.com/haozing/ploykit/platform/webx"
)

// chanFakeBillingOps captures the BC-5/BC-6/BC-7 calls.
type chanFakeBillingOps struct {
	httpFakeBillingOps

	cards []app.AdminChannelCard

	gotUpdate struct {
		channel string
		fields  map[string]string
	}
	updateCard app.AdminChannelCard
	updateErr  error

	catalog app.AdminChannelCatalog

	gotRegister struct {
		channel, plan, interval string
	}
	registerID  string
	registerErr error

	gotSync struct {
		channel, plan, interval string
	}
	syncCents int
	syncErr   error
}

func (f *chanFakeBillingOps) ChannelCards(context.Context) ([]app.AdminChannelCard, error) {
	return f.cards, nil
}

func (f *chanFakeBillingOps) UpdateChannelFields(_ context.Context, _ *webx.Principal, channel string, fields map[string]string) (app.AdminChannelCard, error) {
	f.gotUpdate.channel, f.gotUpdate.fields = channel, fields
	if f.updateErr != nil {
		return app.AdminChannelCard{}, f.updateErr
	}
	return f.updateCard, nil
}

func (f *chanFakeBillingOps) ChannelCatalog(context.Context) (app.AdminChannelCatalog, error) {
	return f.catalog, nil
}

func (f *chanFakeBillingOps) RegisterChannelProduct(_ context.Context, _ *webx.Principal, channel, plan, interval string) (string, error) {
	f.gotRegister.channel, f.gotRegister.plan, f.gotRegister.interval = channel, plan, interval
	if f.registerErr != nil {
		return "", f.registerErr
	}
	return f.registerID, nil
}

func (f *chanFakeBillingOps) SyncChannelPrice(_ context.Context, _ *webx.Principal, channel, plan, interval string) (int, error) {
	f.gotSync.channel, f.gotSync.plan, f.gotSync.interval = channel, plan, interval
	if f.syncErr != nil {
		return 0, f.syncErr
	}
	return f.syncCents, nil
}

func chanReq(mux *http.ServeMux, method, path, body string, admin bool) *httptest.ResponseRecorder {
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, path, nil)
	} else {
		r = httptest.NewRequest(method, path, strings.NewReader(body))
	}
	r = r.WithContext(webx.WithPrincipal(r.Context(), &webx.Principal{UserID: "op", IsPlatformAdmin: admin}))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	return w
}

func TestListBillingChannelsRoute(t *testing.T) {
	f := &chanFakeBillingOps{}
	f.cards = []app.AdminChannelCard{{
		Name: "waffo", Configured: true, KeyMasked: "MER_x1***x12", WebhookConfigured: true,
		Capabilities: app.AdminChannelCaps{CatalogBased: true, DisplayOrder: 100, Currencies: []string{"USD"}},
		Schema: []app.AdminFieldSpec{{
			Key: "merchant_id", Label: "Merchant ID", Type: "text", Required: true,
			Help: "Dashboard → API & Development", Options: []app.AdminFieldOption{},
		}},
		Values:       map[string]string{"merchant_id": "MER_x12"},
		ConfigSource: "db",
	}}
	w := chanReq(newBillingOpsMux(f), http.MethodGet, "/api/admin/billing/channels", "", true)
	require.Equal(t, http.StatusOK, w.Code)

	var body struct {
		Channels []app.AdminChannelCard `json:"channels"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	require.Len(t, body.Channels, 1)
	card := body.Channels[0]
	assert.Equal(t, "waffo", card.Name)
	assert.True(t, card.Capabilities.CatalogBased)
	assert.Equal(t, "db", card.ConfigSource)
	assert.Equal(t, "MER_x1***x12", card.KeyMasked)

	// 未认证 401 / 非平台管理员 403。
	r := httptest.NewRequest(http.MethodGet, "/api/admin/billing/channels", nil)
	w2 := httptest.NewRecorder()
	newBillingOpsMux(f).ServeHTTP(w2, r)
	assert.Equal(t, http.StatusUnauthorized, w2.Code)
	assert.Equal(t, http.StatusForbidden, chanReq(newBillingOpsMux(f), http.MethodGet, "/api/admin/billing/channels", "", false).Code)
}

func TestUpdateBillingChannelRoute(t *testing.T) {
	f := &chanFakeBillingOps{}
	f.updateCard = app.AdminChannelCard{Name: "waffo", ConfigSource: "db"}

	t.Run("成功 200 + 响应 {channel: card}", func(t *testing.T) {
		mux := newBillingOpsMux(f)
		w := chanReq(mux, http.MethodPut, "/api/admin/billing/channels/waffo",
			`{"fields":{"merchant_id":"MER_2","private_key":""}}`, true)
		require.Equal(t, http.StatusOK, w.Code)

		assert.Equal(t, "waffo", f.gotUpdate.channel, "渠道名取自 path")
		assert.Equal(t, map[string]string{"merchant_id": "MER_2", "private_key": ""}, f.gotUpdate.fields)

		var body struct {
			Channel app.AdminChannelCard `json:"channel"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		assert.Equal(t, "waffo", body.Channel.Name)
		assert.Equal(t, "db", body.Channel.ConfigSource)
	})

	t.Run("billing 侧 400（未知字段）保形", func(t *testing.T) {
		f2 := &chanFakeBillingOps{}
		f2.updateErr = webx.NewValidation("渠道 waffo 无配置字段 \"rogue\"")
		w := chanReq(newBillingOpsMux(f2), http.MethodPut, "/api/admin/billing/channels/waffo",
			`{"fields":{"rogue":"x"}}`, true)
		assert.Equal(t, http.StatusBadRequest, w.Code)
	})

	t.Run("坏 JSON → 400", func(t *testing.T) {
		w := chanReq(newBillingOpsMux(f), http.MethodPut, "/api/admin/billing/channels/waffo", `{"fields":`, true)
		assert.Equal(t, http.StatusBadRequest, w.Code)
	})
}

func TestBillingCatalogRoute(t *testing.T) {
	f := &chanFakeBillingOps{}
	f.catalog = app.AdminChannelCatalog{
		Rows: []app.AdminChannelCatalogRow{{
			Channel: "waffo", PlanCode: "pro", Interval: "monthly",
			ChannelProductID: "PROD_1", SyncedPriceCents: 990, PlanPriceCents: 1990,
		}},
		Plans: []app.AdminChannelCatalogPlan{{Code: "pro", Name: "Pro", Currency: "USD", MonthlyCents: 1990}},
	}
	w := chanReq(newBillingOpsMux(f), http.MethodGet, "/api/admin/billing/catalog", "", true)
	require.Equal(t, http.StatusOK, w.Code)

	var cat app.AdminChannelCatalog
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &cat))
	require.Len(t, cat.Rows, 1)
	assert.Equal(t, "PROD_1", cat.Rows[0].ChannelProductID)
	assert.Equal(t, 1990, cat.Rows[0].PlanPriceCents)
	require.Len(t, cat.Plans, 1)
	assert.Equal(t, "pro", cat.Plans[0].Code)
}

func TestRegisterChannelProductRoute(t *testing.T) {
	t.Run("成功 200 → {channel_product_id}", func(t *testing.T) {
		f := &chanFakeBillingOps{}
		f.registerID = "PROD_NEW_pro_monthly"
		w := chanReq(newBillingOpsMux(f), http.MethodPost, "/api/admin/billing/channels/waffo/register-product",
			`{"plan_code":"pro","interval":"monthly"}`, true)
		require.Equal(t, http.StatusOK, w.Code)

		assert.Equal(t, "waffo", f.gotRegister.channel)
		assert.Equal(t, "pro", f.gotRegister.plan)
		assert.Equal(t, "monthly", f.gotRegister.interval)

		var body struct {
			ChannelProductID string `json:"channel_product_id"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		assert.Equal(t, "PROD_NEW_pro_monthly", body.ChannelProductID)
	})

	t.Run("非法 interval → 400；不支持渠道 400 保形", func(t *testing.T) {
		f := &chanFakeBillingOps{}
		w := chanReq(newBillingOpsMux(f), http.MethodPost, "/api/admin/billing/channels/waffo/register-product",
			`{"plan_code":"pro","interval":"weekly"}`, true)
		assert.Equal(t, http.StatusBadRequest, w.Code)

		f2 := &chanFakeBillingOps{}
		f2.registerErr = webx.NewError(400, "E_CHANNEL_PRODUCT_UNSUPPORTED", "payment channel does not support product registration: stripe")
		w = chanReq(newBillingOpsMux(f2), http.MethodPost, "/api/admin/billing/channels/stripe/register-product",
			`{"plan_code":"pro","interval":"monthly"}`, true)
		assert.Equal(t, http.StatusBadRequest, w.Code)
	})
}

func TestSyncChannelPriceRoute(t *testing.T) {
	f := &chanFakeBillingOps{}
	f.syncCents = 1990
	w := chanReq(newBillingOpsMux(f), http.MethodPost, "/api/admin/billing/channels/waffo/sync-price",
		`{"plan_code":"pro","interval":"monthly"}`, true)
	require.Equal(t, http.StatusOK, w.Code)

	assert.Equal(t, "waffo", f.gotSync.channel)
	assert.Equal(t, "monthly", f.gotSync.interval)

	var body struct {
		SyncedPriceCents int `json:"synced_price_cents"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.Equal(t, 1990, body.SyncedPriceCents)

	// 未注册映射 404 保形。
	f2 := &chanFakeBillingOps{}
	f2.syncErr = webx.NewNotFound("channel product not registered: waffo/pro/monthly")
	w = chanReq(newBillingOpsMux(f2), http.MethodPost, "/api/admin/billing/channels/waffo/sync-price",
		`{"plan_code":"pro","interval":"monthly"}`, true)
	assert.Equal(t, http.StatusNotFound, w2Code(w))
}

func w2Code(w *httptest.ResponseRecorder) int { return w.Code }
