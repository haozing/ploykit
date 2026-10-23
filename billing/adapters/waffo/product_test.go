package waffo

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/haozing/ploykit/billing/app"
	"github.com/haozing/ploykit/billing/domain"
)

// ---- ConfigSchema(BC-6) ----

func TestConfigSchemaShape(t *testing.T) {
	schema := testChannel(t, "https://unused.invalid").ConfigSchema()
	if len(schema) != 7 {
		t.Fatalf("schema fields = %d, want 7", len(schema))
	}
	byKey := map[string]app.FieldSpec{}
	for _, s := range schema {
		byKey[s.Key] = s
	}
	for _, key := range []string{FieldMerchantID, FieldPrivateKey, FieldStoreID, FieldProductMonthly, FieldProductYearly, FieldWebhookPublicKey, FieldMode} {
		if _, ok := byKey[key]; !ok {
			t.Fatalf("schema missing field %s", key)
		}
	}
	if !byKey[FieldMerchantID].Required || byKey[FieldMerchantID].Type != app.FieldTypeText {
		t.Fatalf("merchant_id must be required text, got %+v", byKey[FieldMerchantID])
	}
	if byKey[FieldPrivateKey].Type != app.FieldTypeSecret || !byKey[FieldPrivateKey].Required {
		t.Fatalf("private_key must be required secret, got %+v", byKey[FieldPrivateKey])
	}
	mode := byKey[FieldMode]
	if mode.Type != app.FieldTypeSelect || len(mode.Options) != 2 ||
		mode.Options[0].Value != ModeTest || mode.Options[1].Value != ModeProd {
		t.Fatalf("mode must be select test/prod, got %+v", mode)
	}
}

// ---- RegisterProduct / SyncPrice(BC-7 REST 建品/改价) ----

func plan99() domain.Plan {
	return domain.Plan{Code: "pro", Name: "Pro", Currency: "USD",
		Limits: map[string]int{"price_monthly_cents": 990, "price_yearly_cents": 9900}}
}

func TestRegisterProductRequestShape(t *testing.T) {
	var path string
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &body)
		fmt.Fprint(w, `{"data":{"product":{"id":"PROD_NEW_1"}}}`)
	}))
	defer srv.Close()
	ch, err := New(Config{
		MerchantID: "MER_test", PrivateKey: pemPrivate(testRSA(t)),
		StoreID: "STO_1", APIBase: srv.URL,
	})
	if err != nil {
		t.Fatal(err)
	}

	id, err := ch.RegisterProduct(context.Background(), plan99(), domain.IntervalMonthly)
	if err != nil {
		t.Fatal(err)
	}
	if id != "PROD_NEW_1" {
		t.Fatalf("id = %s", id)
	}
	if path != "/v1/actions/subscription-product/create-product" {
		t.Fatalf("path = %s", path)
	}
	if body["storeId"] != "STO_1" {
		t.Fatalf("storeId = %v", body["storeId"])
	}
	if body["name"] != "Pro (Monthly)" {
		t.Fatalf("name = %v", body["name"])
	}
	if body["billingPeriod"] != "monthly" {
		t.Fatalf("billingPeriod = %v", body["billingPeriod"])
	}
	prices := body["prices"].(map[string]any)
	usd := prices["USD"].(map[string]any)
	if usd["amount"] != "9.90" || usd["taxIncluded"] != true || usd["taxCategory"] != "saas" {
		t.Fatalf("prices.USD = %v", usd)
	}
}

func TestRegisterProductGuards(t *testing.T) {
	ch := testChannel(t, "https://unused.invalid") // 无 StoreID

	if _, err := ch.RegisterProduct(context.Background(), plan99(), domain.IntervalMonthly); err == nil {
		t.Fatal("missing store id must fail with a clear error")
	} else if !strings.Contains(err.Error(), "store") {
		t.Fatalf("error should name the store id, got: %v", err)
	}

	ch2, err := New(Config{MerchantID: "M", PrivateKey: pemPrivate(testRSA(t)), StoreID: "S",
		APIBase: "https://unused.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ch2.RegisterProduct(context.Background(), plan99(), domain.IntervalOneTime); err == nil {
		t.Fatal("one_time interval must be rejected for subscription products")
	}
	unpriced := domain.Plan{Code: "x", Currency: "USD", Limits: map[string]int{}}
	if _, err := ch2.RegisterProduct(context.Background(), unpriced, domain.IntervalMonthly); err == nil {
		t.Fatal("unpriced plan must fail before any HTTP call")
	}
}

func TestSyncPriceRequestShape(t *testing.T) {
	var path string
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &body)
		fmt.Fprint(w, `{"data":{"product":{"id":"PROD_NEW_1"}}}`)
	}))
	defer srv.Close()
	ch, err := New(Config{MerchantID: "MER_test", PrivateKey: pemPrivate(testRSA(t)), APIBase: srv.URL})
	if err != nil {
		t.Fatal(err)
	}

	if err := ch.SyncPrice(context.Background(), "PROD_NEW_1", plan99(), domain.IntervalYearly); err != nil {
		t.Fatal(err)
	}
	if path != "/v1/actions/subscription-product/update-product" {
		t.Fatalf("path = %s", path)
	}
	if body["id"] != "PROD_NEW_1" {
		t.Fatalf("id = %v", body["id"])
	}
	usd := body["prices"].(map[string]any)["USD"].(map[string]any)
	if usd["amount"] != "99.00" {
		t.Fatalf("prices.USD.amount = %v", usd["amount"])
	}
	if err := ch.SyncPrice(context.Background(), "", plan99(), domain.IntervalMonthly); err == nil {
		t.Fatal("empty product id must fail")
	}
}

// ---- CreateCheckout 的 ChannelProductID 优先级(BC-7) ----

func TestCreateCheckoutChannelProductIDPriority(t *testing.T) {
	var mu sync.Mutex
	var bodies []map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var b map[string]any
		_ = json.Unmarshal(raw, &b)
		mu.Lock()
		bodies = append(bodies, b)
		mu.Unlock()
		fmt.Fprint(w, `{"data":{"sessionId":"cs","checkoutUrl":"https://c/x","expiresAt":"2030-01-01T00:00:00Z"}}`)
	}))
	defer srv.Close()
	ch := testChannel(t, srv.URL)

	req := app.CheckoutRequest{Order: domain.Order{ID: "o1", PlanCode: "pro",
		Interval: domain.IntervalMonthly, AmountCents: 990, Currency: "USD"}}
	if _, err := ch.CreateCheckout(context.Background(), req); err != nil {
		t.Fatal(err)
	}
	// 无映射:回退静态 ProductMonthly(env-only 老接法不断)。
	mu.Lock()
	first := bodies[0]["productId"]
	mu.Unlock()
	if first != "PROD_MO" {
		t.Fatalf("fallback productId = %v, want PROD_MO", first)
	}

	req.ChannelProductID = "PROD_FROM_CATALOG"
	if _, err := ch.CreateCheckout(context.Background(), req); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	second := bodies[1]["productId"]
	mu.Unlock()
	if second != "PROD_FROM_CATALOG" {
		t.Fatalf("mapped productId = %v, want PROD_FROM_CATALOG", second)
	}

	// 静态商品缺失 + 无映射 → 清晰报错;目录映射仍可救活 bare 渠道。
	bare, err := New(Config{MerchantID: "MER_test", PrivateKey: pemPrivate(testRSA(t)), APIBase: srv.URL})
	if err != nil {
		t.Fatal(err)
	}
	_, err = bare.CreateCheckout(context.Background(), app.CheckoutRequest{
		Order: domain.Order{ID: "o2", PlanCode: "pro", Interval: domain.IntervalMonthly, AmountCents: 990, Currency: "USD"},
	})
	if err == nil || !strings.Contains(err.Error(), "no product registered") {
		t.Fatalf("both empty must error clearly, got %v", err)
	}
	if _, err := bare.CreateCheckout(context.Background(), app.CheckoutRequest{
		Order:            domain.Order{ID: "o3", PlanCode: "pro", Interval: domain.IntervalMonthly, AmountCents: 990, Currency: "USD"},
		ChannelProductID: "PROD_FROM_CATALOG",
	}); err != nil {
		t.Fatalf("catalog mapping must rescue a bare channel: %v", err)
	}
}

// ---- NewFromFields(BC-5 DB 凭据,env 回退) ----

func TestNewFromFields(t *testing.T) {
	log := slog.New(slog.NewTextHandler(&strings.Builder{}, nil))
	key := pemPrivate(testRSA(t))
	env := map[string]string{
		EnvMerchantID:     "MER_env",
		EnvPrivateKey:     key,
		EnvProductMonthly: "PROD_MO",
		EnvProductYearly:  "PROD_YR",
		EnvWebhookPubKey:  pemPublic(testRSA(t)),
	}
	getenv := func(k string) string { return env[k] }

	// 全缺 = 未配置(nil,nil)。
	ch, err := NewFromFields(nil, func(string) string { return "" }, log, true)
	if ch != nil || err != nil {
		t.Fatalf("empty = (nil,nil), got (%v,%v)", ch, err)
	}

	// fields 覆盖 env:merchant_id 来自 DB,其余回退 env。
	ch, err = NewFromFields(map[string]string{"merchant_id": "MER_db"}, getenv, log, true)
	if err != nil || ch == nil {
		t.Fatalf("fields overlay env: (%v,%v)", ch, err)
	}
	if got := ch.ChannelConfig().KeyMasked; !strings.Contains(got, "MER") {
		t.Fatalf("merchant from DB expected, masked = %q", got)
	}

	// 目录模式:fields 只给 merchant_id/private_key,env 不带静态商品 →
	// 构造成功,Configured=false(products 空,判定维持),mode=prod 生效拒收
	// test 回调。
	catalogEnv := func(k string) string {
		switch k {
		case EnvProductMonthly, EnvProductYearly:
			return ""
		default:
			return env[k]
		}
	}
	ch, err = NewFromFields(map[string]string{
		FieldMerchantID: "MER_db", FieldPrivateKey: key, FieldMode: "prod",
	}, catalogEnv, log, true)
	if err != nil || ch == nil {
		t.Fatalf("catalog mode build: (%v,%v)", ch, err)
	}
	if cc := ch.ChannelConfig(); cc.Configured {
		t.Fatalf("catalog mode without static products must report unconfigured, got %+v", cc)
	}
	if ch.mode != ModeProd {
		t.Fatalf("mode = %q, want prod", ch.mode)
	}
	body := webhookBody("subscription.activated", map[string]any{
		"orderId": "ORD_1", "currency": "USD", "chargedAmount": "19.00",
	})
	_, err = ch.ParseWebhook(context.Background(), app.WebhookRequest{
		Header: map[string][]string{"X-Waffo-Signature": {signWebhook(t, testRSA(t), body, time.Now())}},
		Body:   body,
	})
	if err == nil || !strings.Contains(err.Error(), "mode mismatch") {
		t.Fatalf("prod channel must reject test-mode webhook (body mode=test), got %v", err)
	}

	// 半配置(merchant 无 key):production 拒、dev 降级。
	if _, err := NewFromFields(map[string]string{"merchant_id": "MER_db"}, func(string) string { return "" }, log, true); err == nil {
		t.Fatal("partial config in production must fail")
	}
	if ch, err := NewFromFields(map[string]string{"merchant_id": "MER_db"}, func(string) string { return "" }, log, false); ch != nil || err != nil {
		t.Fatalf("partial config in dev = disabled, got (%v,%v)", ch, err)
	}
}
