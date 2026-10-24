package paypal

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/haozing/ploykit/billing/app"
	"github.com/haozing/ploykit/billing/domain"
)

// ---- Capabilities(BC-2) ----

func TestCapabilities(t *testing.T) {
	caps := testChannel(t, "https://unused.invalid").Capabilities()
	if !caps.CatalogBased {
		t.Fatal("paypal is a catalog-based channel (product+plan 预注册)")
	}
	if !caps.SupportsCancelURL {
		t.Fatal("application_context.cancel_url 必填,paypal 天然支持取消 URL")
	}
	if caps.DisplayOrder != 300 {
		t.Fatalf("displayOrder = %d, want 300 (waffo 100 < stripe 200 < paypal 300 < manual 900)", caps.DisplayOrder)
	}
	// 币种白名单:PayPal Subscriptions 支持币种集(官方 currency-codes 的
	// recurring 适用集),必须含 JPY(零小数位币),且不含三位小数币
	// (KWD 等 —— money 层无法安全换算)与 CNY(PayPal 订阅不支持)。
	want := []string{
		"USD", "EUR", "GBP", "AUD", "CAD", "JPY", "SGD", "HKD", "NZD", "CHF",
		"SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "ILS", "MXN", "BRL", "MYR",
		"PHP", "TWD", "THB",
	}
	if strings.Join(caps.Currencies, ",") != strings.Join(want, ",") {
		t.Fatalf("currencies = %v, want %v", caps.Currencies, want)
	}
	for _, banned := range []string{"KWD", "BHD", "CNY"} {
		if slices.Contains(caps.Currencies, banned) {
			t.Fatalf("currencies must not contain %q (3-decimal / unsupported-by-subscriptions)", banned)
		}
	}
}

// ---- ConfigSchema(BC-6) ----

func TestConfigSchemaShape(t *testing.T) {
	schema := testChannel(t, "https://unused.invalid").ConfigSchema()
	if len(schema) != 4 {
		t.Fatalf("schema fields = %d, want 4", len(schema))
	}
	byKey := map[string]app.FieldSpec{}
	for _, s := range schema {
		byKey[s.Key] = s
	}
	for _, key := range []string{FieldClientID, FieldClientSecret, FieldWebhookID, FieldMode} {
		if _, ok := byKey[key]; !ok {
			t.Fatalf("schema missing field %s", key)
		}
	}
	if !byKey[FieldClientID].Required || byKey[FieldClientID].Type != app.FieldTypeText {
		t.Fatalf("client_id must be required text, got %+v", byKey[FieldClientID])
	}
	if !byKey[FieldClientSecret].Required || byKey[FieldClientSecret].Type != app.FieldTypeSecret {
		t.Fatalf("client_secret must be required secret, got %+v", byKey[FieldClientSecret])
	}
	if !byKey[FieldWebhookID].Required || byKey[FieldWebhookID].Type != app.FieldTypeText {
		t.Fatalf("webhook_id must be required text, got %+v", byKey[FieldWebhookID])
	}
	// Required 口径保持(「env 已提供即豁免」由配置面经 EnvProvidedKeys 判定),
	// help 必须把 env 变量这条路告诉运营。
	if !strings.Contains(byKey[FieldWebhookID].Help, "PAYPAL_WEBHOOK_ID") {
		t.Fatalf("webhook_id help must mention the env fallback, got %q", byKey[FieldWebhookID].Help)
	}
	mode := byKey[FieldMode]
	if !mode.Required || mode.Type != app.FieldTypeSelect || len(mode.Options) != 2 ||
		mode.Options[0].Value != ModeTest || mode.Options[1].Value != ModeProd {
		t.Fatalf("mode must be required select test/prod, got %+v", mode)
	}
	// SyncPrice 刚性依赖必须写进 help(运营在后台能看见):续期金额对账
	// 落地后,改价不同步目录价 = 旧价付款/续期被拒。
	if !strings.Contains(mode.Help, "同步渠道目录价") || !strings.Contains(mode.Help, "对账拒绝") {
		t.Fatalf("mode help must explain the sync-price dependency, got %q", mode.Help)
	}
}

// ---- EnvProvidedKeys(env 已提供即豁免 Required 的判定输入) ----

func TestEnvProvidedKeys(t *testing.T) {
	ch := testChannel(t, "https://unused.invalid")
	// hermetic:先把本渠道四个 env 全部清空(宿主 shell 可能带 PAYPAL_*)。
	t.Setenv(EnvClientID, "")
	t.Setenv(EnvClientSecret, "")
	t.Setenv(EnvWebhookID, "")
	t.Setenv(EnvMode, "")

	if got := ch.EnvProvidedKeys(); len(got) != 0 {
		t.Fatalf("no env provided = no keys, got %v", got)
	}
	// 设两态:env 提供谁,谁的 ConfigSchema 键出现;顺序 = schema 字段序。
	t.Setenv(EnvClientID, "cid-1")
	t.Setenv(EnvMode, "test")
	got := ch.EnvProvidedKeys()
	if strings.Join(got, ",") != strings.Join([]string{FieldClientID, FieldMode}, ",") {
		t.Fatalf("envProvidedKeys = %v, want [%s %s]", got, FieldClientID, FieldMode)
	}
	// 全提供:四个键齐、键名与 ConfigSchema 一致。
	t.Setenv(EnvClientSecret, "sec-1")
	t.Setenv(EnvWebhookID, "WHID-1")
	got = ch.EnvProvidedKeys()
	for _, field := range []string{FieldClientID, FieldClientSecret, FieldWebhookID, FieldMode} {
		if !slices.Contains(got, field) {
			t.Fatalf("envProvidedKeys missing %s, got %v", field, got)
		}
	}
}

// ---- RegisterProduct / SyncPrice(BC-7:product→plan 两步链) ----

func plan99() domain.Plan {
	return domain.Plan{Code: "pro", Name: "Pro", Currency: "USD",
		Limits: map[string]int{"price_monthly_cents": 990, "price_yearly_cents": 9900}}
}

func TestRegisterProductRequestShape(t *testing.T) {
	var mu sync.Mutex
	var calls []struct {
		method string
		path   string
		query  string
		body   map[string]any
	}
	f := newFakePaypal(t, func(mux *http.ServeMux, _ *fakePaypal) {
		mux.HandleFunc("/v1/catalogs/products", func(w http.ResponseWriter, r *http.Request) {
			var b map[string]any
			_ = json.NewDecoder(r.Body).Decode(&b)
			mu.Lock()
			calls = append(calls, struct {
				method string
				path   string
				query  string
				body   map[string]any
			}{r.Method, r.URL.Path, r.URL.RawQuery, b})
			mu.Unlock()
			if r.Method == http.MethodGet {
				fmt.Fprint(w, `{"products":[],"total_items":0,"total_pages":0}`)
				return
			}
			fmt.Fprint(w, `{"id":"PROD-9","name":"Pro (Monthly)","type":"SERVICE","status":"ACTIVE"}`)
		})
		mux.HandleFunc("/v1/billing/plans", func(w http.ResponseWriter, r *http.Request) {
			var b map[string]any
			_ = json.NewDecoder(r.Body).Decode(&b)
			mu.Lock()
			calls = append(calls, struct {
				method string
				path   string
				query  string
				body   map[string]any
			}{r.Method, r.URL.Path, r.URL.RawQuery, b})
			mu.Unlock()
			fmt.Fprint(w, `{"id":"P-9","product_id":"PROD-9","status":"ACTIVE"}`)
		})
	})
	ch := testChannel(t, f.srv.URL)

	id, err := ch.RegisterProduct(context.Background(), plan99(), domain.IntervalMonthly)
	if err != nil {
		t.Fatal(err)
	}
	if id != "P-9" {
		t.Fatalf("RegisterProduct 必须返回 plan id, got %q", id)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(calls) != 3 {
		t.Fatalf("register must be a list→product→plan three-call chain, got %d calls: %+v", len(calls), calls)
	}
	// 第零步:GET 列目录查重(分页 + total_required 才有 total_pages)。
	if calls[0].method != http.MethodGet || calls[0].path != "/v1/catalogs/products" {
		t.Fatalf("call[0] = %s %s, want GET /v1/catalogs/products", calls[0].method, calls[0].path)
	}
	if !strings.Contains(calls[0].query, "page=1") ||
		!strings.Contains(calls[0].query, "total_required=true") ||
		!strings.Contains(calls[0].query, "page_size=") {
		t.Fatalf("list query = %q, want page/page_size/total_required", calls[0].query)
	}
	// 第一步:product(SERVICE)。
	if calls[1].method != http.MethodPost || calls[1].path != "/v1/catalogs/products" {
		t.Fatalf("call[1] = %s %s, want POST /v1/catalogs/products", calls[1].method, calls[1].path)
	}
	if calls[1].body["name"] != "Pro (Monthly)" {
		t.Fatalf("product name = %v", calls[1].body["name"])
	}
	if calls[1].body["type"] != "SERVICE" {
		t.Fatalf("product type = %v, want SERVICE", calls[1].body["type"])
	}
	// 第二步:plan(链接上一步的 product_id,status=ACTIVE 直取免 activate)。
	if calls[2].method != http.MethodPost || calls[2].path != "/v1/billing/plans" {
		t.Fatalf("call[2] = %s %s, want POST /v1/billing/plans", calls[2].method, calls[2].path)
	}
	if calls[2].body["product_id"] != "PROD-9" {
		t.Fatalf("plan product_id = %v (必须链接第一步建出的 product)", calls[2].body["product_id"])
	}
	if calls[2].body["status"] != "ACTIVE" {
		t.Fatalf("plan status = %v, want ACTIVE(建后即用,免二次 activate)", calls[2].body["status"])
	}
	cycles := calls[2].body["billing_cycles"].([]any)
	if len(cycles) != 1 {
		t.Fatalf("billing_cycles = %v, want exactly the REGULAR cycle", cycles)
	}
	cycle := cycles[0].(map[string]any)
	freq := cycle["frequency"].(map[string]any)
	if freq["interval_unit"] != "MONTH" || freq["interval_count"] != float64(1) {
		t.Fatalf("frequency = %v, want MONTH×1", freq)
	}
	if cycle["tenure_type"] != "REGULAR" || cycle["sequence"] != float64(1) {
		t.Fatalf("tenure/sequence = %v/%v", cycle["tenure_type"], cycle["sequence"])
	}
	if cycle["total_cycles"] != float64(0) {
		t.Fatalf("total_cycles = %v, want 0(无限续期)", cycle["total_cycles"])
	}
	scheme := cycle["pricing_scheme"].(map[string]any)
	price := scheme["fixed_price"].(map[string]any)
	if price["value"] != "9.90" || price["currency_code"] != "USD" {
		t.Fatalf("fixed_price = %v, want USD 9.90(DB plan limits 是价真源)", price)
	}
}

func TestRegisterProductYearlyAndGuards(t *testing.T) {
	var mu sync.Mutex
	var bodies []map[string]any
	f := newFakePaypal(t, func(mux *http.ServeMux, _ *fakePaypal) {
		mux.HandleFunc("/v1/catalogs/products", func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodGet {
				fmt.Fprint(w, `{"products":[],"total_pages":0}`)
				return
			}
			fmt.Fprint(w, `{"id":"PROD-Y"}`)
		})
		mux.HandleFunc("/v1/billing/plans", func(w http.ResponseWriter, r *http.Request) {
			var b map[string]any
			_ = json.NewDecoder(r.Body).Decode(&b)
			mu.Lock()
			bodies = append(bodies, b)
			mu.Unlock()
			fmt.Fprint(w, `{"id":"P-Y"}`)
		})
	})
	ch := testChannel(t, f.srv.URL)

	id, err := ch.RegisterProduct(context.Background(), plan99(), domain.IntervalYearly)
	if err != nil {
		t.Fatal(err)
	}
	if id != "P-Y" {
		t.Fatalf("id = %q", id)
	}
	mu.Lock()
	unit := bodies[0]["billing_cycles"].([]any)[0].(map[string]any)["frequency"].(map[string]any)["interval_unit"]
	value := bodies[0]["billing_cycles"].([]any)[0].(map[string]any)["pricing_scheme"].(map[string]any)["fixed_price"].(map[string]any)["value"]
	mu.Unlock()
	if unit != "YEAR" || value != "99.00" {
		t.Fatalf("yearly = %v × %v, want YEAR × 99.00", unit, value)
	}

	// one_time / 未定价档位在出网前快速失败。
	if _, err := ch.RegisterProduct(context.Background(), plan99(), domain.IntervalOneTime); err == nil {
		t.Fatal("one_time interval must be rejected for subscription plans")
	}
	unpriced := domain.Plan{Code: "x", Currency: "USD", Limits: map[string]int{}}
	if _, err := ch.RegisterProduct(context.Background(), unpriced, domain.IntervalMonthly); err == nil {
		t.Fatal("unpriced plan must fail before any HTTP call")
	}
	// 币种白名单外的 plan 在出网前快速失败(PayPal 订阅不收 CNY);
	// 三位小数币(KWD)同样被拒 —— 白名单先拦,FormatCentsChecked 兜底。
	for _, code := range []string{"CNY", "KWD"} {
		offlist := domain.Plan{Code: "x", Currency: code,
			Limits: map[string]int{"price_monthly_cents": 990}}
		_, err := ch.RegisterProduct(context.Background(), offlist, domain.IntervalMonthly)
		if err == nil || !strings.Contains(err.Error(), code) {
			t.Fatalf("currency %s must fail fast with the currency named, got %v", code, err)
		}
	}
}

// RegisterProduct 幂等(product 层):映射丢失/首注册半途失败后重试,同
// 名同类型的 product 必须复用 —— 只发生一次 product 创建请求,第二次
// 直接 GET 命中后建 plan(plan 每次新建,映射由服务层两步成功后落)。
func TestRegisterProductReusesExistingProduct(t *testing.T) {
	var mu sync.Mutex
	listCalls, createCalls, planBodies := 0, 0, 0
	f := newFakePaypal(t, func(mux *http.ServeMux, _ *fakePaypal) {
		mux.HandleFunc("/v1/catalogs/products", func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			defer mu.Unlock()
			switch r.Method {
			case http.MethodGet:
				listCalls++
				// 第二次列出时目录里已有第一次建的 product(查重命中路径)。
				if createCalls > 0 {
					fmt.Fprint(w, `{"products":[{"id":"PROD-9","name":"Pro (Monthly)","type":"SERVICE"}],"total_items":1,"total_pages":1}`)
					return
				}
				fmt.Fprint(w, `{"products":[],"total_items":0,"total_pages":0}`)
			default:
				createCalls++
				fmt.Fprint(w, `{"id":"PROD-9","name":"Pro (Monthly)","type":"SERVICE"}`)
			}
		})
		mux.HandleFunc("/v1/billing/plans", func(w http.ResponseWriter, r *http.Request) {
			var b map[string]any
			_ = json.NewDecoder(r.Body).Decode(&b)
			mu.Lock()
			planBodies++
			mu.Unlock()
			if b["product_id"] != "PROD-9" {
				fmt.Fprintf(w, `{"id":"P-wrong"}`)
				return
			}
			fmt.Fprint(w, `{"id":"P-9","product_id":"PROD-9"}`)
		})
	})
	ch := testChannel(t, f.srv.URL)

	id1, err := ch.RegisterProduct(context.Background(), plan99(), domain.IntervalMonthly)
	if err != nil {
		t.Fatal(err)
	}
	if id1 != "P-9" {
		t.Fatalf("first register id = %q, want P-9", id1)
	}
	// 重试(模拟:映射行丢失后管理员再点注册)。
	id2, err := ch.RegisterProduct(context.Background(), plan99(), domain.IntervalMonthly)
	if err != nil {
		t.Fatal(err)
	}
	if id2 != "P-9" {
		t.Fatalf("second register id = %q, want a fresh plan P-9 under the reused product", id2)
	}
	mu.Lock()
	defer mu.Unlock()
	if createCalls != 1 {
		t.Fatalf("product creation must happen exactly once across retries, got %d", createCalls)
	}
	if listCalls != 2 {
		t.Fatalf("each register must list the catalog first, got %d list calls", listCalls)
	}
	if planBodies != 2 {
		t.Fatalf("plan creation happens per register call (no plan-level idempotency), got %d", planBodies)
	}
}

func TestSyncPriceRequestShape(t *testing.T) {
	var gotPath string
	var body map[string]any
	f := newFakePaypal(t, func(mux *http.ServeMux, _ *fakePaypal) {
		mux.HandleFunc("/v1/billing/plans/P-9/update-pricing-schemes", func(w http.ResponseWriter, r *http.Request) {
			gotPath = r.URL.Path
			raw, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(raw, &body)
			w.WriteHeader(http.StatusNoContent) // 真实 PayPal:204 空响应
		})
	})
	ch := testChannel(t, f.srv.URL)

	if err := ch.SyncPrice(context.Background(), "P-9", plan99(), domain.IntervalYearly); err != nil {
		t.Fatal(err)
	}
	if gotPath != "/v1/billing/plans/P-9/update-pricing-schemes" {
		t.Fatalf("path = %q(注意:复数 schemes)", gotPath)
	}
	schemes := body["pricing_schemes"].([]any)
	if len(schemes) != 1 {
		t.Fatalf("pricing_schemes = %v", schemes)
	}
	s := schemes[0].(map[string]any)
	if s["billing_cycle_sequence"] != float64(1) {
		t.Fatalf("billing_cycle_sequence = %v, want 1(REGULAR 周期)", s["billing_cycle_sequence"])
	}
	price := s["pricing_scheme"].(map[string]any)["fixed_price"].(map[string]any)
	if price["value"] != "99.00" || price["currency_code"] != "USD" {
		t.Fatalf("fixed_price = %v, want USD 99.00", price)
	}

	// 空 id 拒绝。
	if err := ch.SyncPrice(context.Background(), "", plan99(), domain.IntervalMonthly); err == nil {
		t.Fatal("empty plan id must fail")
	}

	// 币种白名单外的 plan 改价同样在出网前快速失败(planPrice 与注册/结账
	// 同一道闸;三位小数币由 FormatCentsChecked 兜底)。
	kwd := domain.Plan{Code: "x", Currency: "KWD", Limits: map[string]int{"price_monthly_cents": 990}}
	if err := ch.SyncPrice(context.Background(), "P-9", kwd, domain.IntervalMonthly); err == nil || !strings.Contains(err.Error(), "KWD") {
		t.Fatalf("3-decimal currency must be refused with the currency named, got %v", err)
	}

	// 渠道侧 4xx 带原因返回(改价失败必须可见 —— 这是 paypal 收款价的唯一真源通道)。
	var status int
	fErr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		status = http.StatusUnprocessableEntity
		w.WriteHeader(status)
		fmt.Fprint(w, `{"name":"VALIDATION_ERROR","message":"Invalid pricing scheme"}`)
	}))
	defer fErr.Close()
	chErr := testChannel(t, fErr.URL)
	err := chErr.SyncPrice(context.Background(), "P-9", plan99(), domain.IntervalMonthly)
	if err == nil || !strings.Contains(err.Error(), "update plan P-9 pricing") || !strings.Contains(err.Error(), "422") {
		t.Fatalf("want wrapped sync error with status, got %v", err)
	}
}
