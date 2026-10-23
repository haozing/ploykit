package waffo

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/haozing/ploykit/billing/app"
	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/billing/money"
)

// testKey 缓存一把 2048 位测试密钥(生成 ~50ms,别每个用例都造)。
var (
	testKeyOnce sync.Once
	testKeyPair *rsa.PrivateKey
)

func testRSA(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	testKeyOnce.Do(func() {
		k, err := rsa.GenerateKey(rand.Reader, 2048)
		if err != nil {
			panic(err)
		}
		testKeyPair = k
	})
	return testKeyPair
}

func pemPrivate(k *rsa.PrivateKey) string {
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: mustPKCS8(k)}))
}

func mustPKCS8(k *rsa.PrivateKey) []byte {
	b, err := x509.MarshalPKCS8PrivateKey(k)
	if err != nil {
		panic(err)
	}
	return b
}

func pemPublic(k *rsa.PrivateKey) string {
	b, err := x509.MarshalPKIXPublicKey(&k.PublicKey)
	if err != nil {
		panic(err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: b}))
}

// ---- 密钥四形态归一 ----

func TestParsePrivateKeyForms(t *testing.T) {
	k := testRSA(t)
	pemBody := base64.StdEncoding.EncodeToString(mustPKCS8(k))
	forms := map[string]string{
		"pem":          pemPrivate(k),
		"escaped":      strings.ReplaceAll(pemPrivate(k), "\n", `\n`),
		"b64-wrapped":  base64.StdEncoding.EncodeToString([]byte(pemPrivate(k))),
		"raw-b64-body": pemBody,
	}
	for name, form := range forms {
		got, err := parsePrivateKey(form)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if got.N.Cmp(k.N) != 0 {
			t.Fatalf("%s: key mismatch", name)
		}
	}
	if _, err := parsePrivateKey(""); err == nil {
		t.Fatal("empty key must fail")
	}
	if _, err := parsePrivateKey("not-a-key"); err == nil {
		t.Fatal("garbage key must fail")
	}
}

// ---- Capabilities(BC-2) ----

func TestCapabilities(t *testing.T) {
	caps := testChannel(t, "https://unused.invalid").Capabilities()
	if !caps.CatalogBased || caps.SupportsCancelURL {
		t.Fatalf("catalog/cancelURL = %v/%v, want true/false", caps.CatalogBased, caps.SupportsCancelURL)
	}
	if caps.DisplayOrder != 100 {
		t.Fatalf("displayOrder = %d, want 100 (waffo < stripe 200 < manual 900)", caps.DisplayOrder)
	}
	want := []string{"USD", "EUR", "GBP", "HKD", "JPY"}
	if strings.Join(caps.Currencies, ",") != strings.Join(want, ",") {
		t.Fatalf("currencies = %v, want %v", caps.Currencies, want)
	}
	// 白名单与 CreateCheckout 的快速失败共用同一份声明。
	if !strings.Contains(strings.Join(caps.Currencies, ","), "JPY") {
		t.Fatal("JPY must be in the declared currency whitelist")
	}
}

// ---- 签名客户端 ----

func TestClientSignsCanonicalRequest(t *testing.T) {
	k := testRSA(t)
	var gotMethod, gotPath, gotTS, gotSig, gotMerchant, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotTS = r.Header.Get("X-Timestamp")
		gotSig = r.Header.Get("X-Signature")
		gotMerchant = r.Header.Get("X-Merchant-Id")
		buf := make([]byte, 4096)
		n, _ := r.Body.Read(buf)
		gotBody = string(buf[:n])
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"data":{"echo":"ok"}}`)
	}))
	defer srv.Close()

	c := &Client{MerchantID: "MER_test", BaseURL: srv.URL, HTTP: srv.Client(), key: k}
	var out struct {
		Echo string `json:"echo"`
	}
	if err := c.do(context.Background(), http.MethodPost, "/v1/actions/x", map[string]any{"a": 1}, &out); err != nil {
		t.Fatal(err)
	}
	if out.Echo != "ok" {
		t.Fatalf("envelope data not decoded: %+v", out)
	}

	// 重算 canonical 并验签:服务端收到的就是规范签名。
	bodyHash := sha256.Sum256([]byte(gotBody))
	canonical := gotMethod + "\n" + gotPath + "\n" + gotTS + "\n" + base64.StdEncoding.EncodeToString(bodyHash[:])
	digest := sha256.Sum256([]byte(canonical))
	sig, err := base64.StdEncoding.DecodeString(gotSig)
	if err != nil {
		t.Fatal(err)
	}
	if err := rsa.VerifyPKCS1v15(&k.PublicKey, crypto.SHA256, digest[:], sig); err != nil {
		t.Fatalf("signature over canonical request does not verify: %v", err)
	}
	if gotMerchant != "MER_test" {
		t.Fatalf("merchant header = %q", gotMerchant)
	}
	if ts, err := strconv.ParseInt(gotTS, 10, 64); err != nil || time.Since(time.Unix(ts, 0)) > time.Minute {
		t.Fatalf("timestamp not fresh unix seconds: %q", gotTS)
	}
}

func TestClientAPIError(t *testing.T) {
	k := testRSA(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		fmt.Fprint(w, `{"error":"bad productId"}`)
	}))
	defer srv.Close()
	c := &Client{MerchantID: "M", BaseURL: srv.URL, HTTP: srv.Client(), key: k}
	err := c.do(context.Background(), http.MethodPost, "/v1/actions/x", nil, nil)
	var apiErr *apiError
	if err == nil || !errors.As(err, &apiErr) || apiErr.Status != 400 {
		t.Fatalf("want 400 apiError, got %v", err)
	}
}

// ---- CreateCheckout(BC-2 新签名) ----

func testChannel(t *testing.T, baseURL string) *Channel {
	t.Helper()
	ch, err := New(Config{
		MerchantID:       "MER_test",
		PrivateKey:       pemPrivate(testRSA(t)),
		ProductMonthly:   "PROD_MO",
		ProductYearly:    "PROD_YR",
		WebhookPublicKey: pemPublic(testRSA(t)),
		TaxCategory:      "saas",
		TaxIncluded:      boolPtr(true),
		APIBase:          baseURL,
	})
	if err != nil {
		t.Fatal(err)
	}
	return ch
}

func boolPtr(b bool) *bool { return &b }

func TestCreateCheckoutRequestShape(t *testing.T) {
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
		}
		fmt.Fprint(w, `{"data":{"sessionId":"cs_1","checkoutUrl":"https://checkout.waffo.ai/x/cs_1","expiresAt":"2030-01-01T00:00:00Z"}}`)
	}))
	defer srv.Close()
	ch := testChannel(t, srv.URL)

	sess, err := ch.CreateCheckout(context.Background(), app.CheckoutRequest{
		Order:      domain.Order{ID: "ord_123", Interval: domain.IntervalYearly, AmountCents: 19000, Currency: "usd"},
		SuccessURL: "https://app.example/billing/success",
		CancelURL:  "https://app.example/pricing", // 有意忽略(SupportsCancelURL=false)
		BuyerEmail: "buyer@example.com",
		Locale:     "zh-Hans",
	})
	if err != nil {
		t.Fatal(err)
	}
	if sess.ActionURL != "https://checkout.waffo.ai/x/cs_1" || sess.SessionRef != "cs_1" || sess.Channel != "waffo" {
		t.Fatalf("session mapping wrong: %+v", sess)
	}
	if sess.ExpiresAt.IsZero() {
		t.Fatal("expiresAt not parsed")
	}
	if body["productId"] != "PROD_YR" {
		t.Fatalf("productId = %v", body["productId"])
	}
	if body["currency"] != "USD" {
		t.Fatalf("currency = %v", body["currency"])
	}
	snap := body["priceSnapshot"].(map[string]any)
	if snap["amount"] != "190.00" || snap["taxCategory"] != "saas" || snap["taxIncluded"] != true {
		t.Fatalf("priceSnapshot = %v", snap)
	}
	if body["metadata"].(map[string]any)["order_id"] != "ord_123" {
		t.Fatalf("metadata = %v", body["metadata"])
	}
	if body["orderMerchantExternalId"] != "ord_123" {
		t.Fatalf("externalId = %v", body["orderMerchantExternalId"])
	}
	if body["language"] != "zh-Hans" || body["successUrl"] != "https://app.example/billing/success" {
		t.Fatalf("language/successUrl = %v / %v", body["language"], body["successUrl"])
	}
	if body["buyerEmail"] != "buyer@example.com" {
		t.Fatalf("buyerEmail = %v", body["buyerEmail"])
	}
	if _, has := body["cancelUrl"]; has {
		t.Fatal("cancelURL must not leak into the request body (channel ignores it by declaration)")
	}
}

func TestCreateCheckoutDefaults(t *testing.T) {
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
		}
		fmt.Fprint(w, `{"data":{"sessionId":"cs","checkoutUrl":"https://c/x","expiresAt":"2030-01-01T00:00:00Z"}}`)
	}))
	defer srv.Close()
	ch := testChannel(t, srv.URL)

	if _, err := ch.CreateCheckout(context.Background(), app.CheckoutRequest{
		Order: domain.Order{ID: "o", Interval: domain.IntervalMonthly, AmountCents: 1900, Currency: "USD"},
	}); err != nil {
		t.Fatal(err)
	}
	// BuyerEmail/Locale 空 = 不预填、渠道缺省英文收银台(BC-2 F19 之前的默认行为)。
	if _, has := body["buyerEmail"]; has {
		t.Fatalf("buyerEmail must be omitted when empty, got %v", body["buyerEmail"])
	}
	if body["language"] != "en" {
		t.Fatalf("default language = %v, want en", body["language"])
	}
	if body["productId"] != "PROD_MO" {
		t.Fatalf("monthly product = %v", body["productId"])
	}
}

func TestCreateCheckoutMonthlyAndGuards(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, `{"data":{"sessionId":"cs","checkoutUrl":"https://c/x","expiresAt":"2030-01-01T00:00:00Z"}}`)
	}))
	defer srv.Close()
	ch := testChannel(t, srv.URL)

	if _, err := ch.CreateCheckout(context.Background(), app.CheckoutRequest{
		Order: domain.Order{ID: "o", Interval: domain.IntervalMonthly, AmountCents: 1900, Currency: "USD"},
	}); err != nil {
		t.Fatal(err)
	}

	// 一次性与未支持币种在出网前快速失败(白名单来自 Capabilities().Currencies)。
	if _, err := ch.CreateCheckout(context.Background(), app.CheckoutRequest{
		Order: domain.Order{ID: "o", Interval: domain.IntervalOneTime, AmountCents: 1900, Currency: "USD"},
	}); err == nil {
		t.Fatal("one_time must be rejected")
	}
	if _, err := ch.CreateCheckout(context.Background(), app.CheckoutRequest{
		Order: domain.Order{ID: "o", Interval: domain.IntervalMonthly, AmountCents: 1900, Currency: "CNY"},
	}); err == nil {
		t.Fatal("CNY subscription must be rejected")
	}
}

// ---- CancelSubscription(BC-9) ----

func TestCancelSubscription(t *testing.T) {
	var gotPath string
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Errorf("decode request: %v", err)
		}
		fmt.Fprint(w, `{"data":{"orderId":"ORD_2aUyqjCzEIiEcYMKj7TZtw","status":"canceling"}}`)
	}))
	defer srv.Close()
	ch := testChannel(t, srv.URL)

	if err := ch.CancelSubscription(context.Background(), "ORD_2aUyqjCzEIiEcYMKj7TZtw"); err != nil {
		t.Fatal(err)
	}
	if gotPath != "/v1/actions/subscription-order/cancel-order" {
		t.Fatalf("path = %q", gotPath)
	}
	if gotBody["orderId"] != "ORD_2aUyqjCzEIiEcYMKj7TZtw" {
		t.Fatalf("body = %v", gotBody)
	}

	// 空 SubscriptionRef 是调用方事故,不该出网。
	if err := ch.CancelSubscription(context.Background(), " "); err == nil {
		t.Fatal("empty subscription reference must be rejected")
	}

	// 渠道侧 4xx(如订单已终态)带原因返回,不重试。
	errCh := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		fmt.Fprint(w, `{"error":"order not cancellable"}`)
	}))
	defer errCh.Close()
	chErr := testChannel(t, errCh.URL)
	if err := chErr.CancelSubscription(context.Background(), "ORD_x"); err == nil || !strings.Contains(err.Error(), "cancel subscription") {
		t.Fatalf("want wrapped cancel error, got %v", err)
	}
}

// ---- TestConnection(BC-9) ----

func TestTestConnection(t *testing.T) {
	var gotPath string
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Errorf("decode request: %v", err)
		}
		fmt.Fprint(w, `{"data":{"stores":[{"id":"STO_x","name":"My Store","status":"active"}]}}`)
	}))
	defer srv.Close()
	ch := testChannel(t, srv.URL)

	if err := ch.TestConnection(context.Background()); err != nil {
		t.Fatal(err)
	}
	if gotPath != "/v1/graphql" {
		t.Fatalf("probe path = %q, want /v1/graphql", gotPath)
	}
	if q, _ := gotBody["query"].(string); !strings.Contains(q, "stores") {
		t.Fatalf("probe query = %v", gotBody["query"])
	}

	// 401(密钥错/时钟漂移)必须带原因失败。
	unauth := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		fmt.Fprint(w, `{"error":"Authentication failed"}`)
	}))
	defer unauth.Close()
	chUnauth := testChannel(t, unauth.URL)
	err := chUnauth.TestConnection(context.Background())
	if err == nil || !strings.Contains(err.Error(), "test connection") || !strings.Contains(err.Error(), "401") {
		t.Fatalf("want wrapped 401 error, got %v", err)
	}
}

// ---- ParseWebhook ----

func signWebhook(t *testing.T, key *rsa.PrivateKey, body []byte, at time.Time) string {
	t.Helper()
	ts := strconv.FormatInt(at.UnixMilli(), 10)
	digest := sha256.Sum256(append([]byte(ts+"."), body...))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	return "t=" + ts + ",v1=" + base64.StdEncoding.EncodeToString(sig)
}

func webhookBody(eventType string, data map[string]any) []byte {
	env := map[string]any{
		"id":        "PAY_1",
		"eventId":   "PAY_1",
		"eventType": eventType,
		"mode":      "test",
		"timestamp": "2026-10-23T08:30:00.000Z",
		"storeId":   "STO_x",
		"data":      data,
	}
	b, _ := json.Marshal(env)
	return b
}

func TestParseWebhookVerifyAndMap(t *testing.T) {
	ch := testChannel(t, "https://unused.invalid")
	wrongKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	base := map[string]any{
		"orderId": "ORD_root", "currency": "USD", "chargedAmount": "19.00",
		"orderMetadata": map[string]any{"order_id": "ord_123"},
	}

	cases := []struct {
		name      string
		eventType string
		data      map[string]any
		want      string
		subRef    string
		orderID   string
		amount    int
	}{
		{"activated", "subscription.activated", base, domain.EventCheckoutCompleted, "ORD_root", "ord_123", 1900},
		{"first-payment-succeeded", "subscription.payment_succeeded", merge(base, map[string]any{"periodNumber": 1}), "ignored", "", "ord_123", 0},
		{"renewal-payment", "subscription.payment_succeeded", merge(base, map[string]any{"periodNumber": 2}), domain.EventSubscriptionRenewed, "ORD_root", "ord_123", 1900},
		{"period-roll", "subscription.renewed", merge(base, map[string]any{"periodNumber": 2}), "ignored", "", "ord_123", 0},
		{"past-due", "subscription.past_due", base, "ignored", "", "ord_123", 0},
		{"canceling", "subscription.canceling", base, "ignored", "", "ord_123", 0},
		{"canceled", "subscription.canceled", base, domain.EventSubscriptionCanceled, "ORD_root", "ord_123", 0},
		{"refund-sub", "refund.succeeded", merge(base, map[string]any{"refundedAmount": "19.00", "periodNumber": 1}), domain.EventRefundCreated, "ORD_root", "ord_123", 1900},
		{"onetime-order", "order.completed", base, domain.EventCheckoutCompleted, "", "ord_123", 1900},
		{"unknown", "subscription.plan_changed", base, "ignored", "", "ord_123", 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			body := webhookBody(tc.eventType, tc.data)
			ev, err := ch.ParseWebhook(context.Background(), app.WebhookRequest{
				Header: map[string][]string{"X-Waffo-Signature": {signWebhook(t, testRSA(t), body, time.Now())}},
				Body:   body,
			})
			if err != nil {
				t.Fatal(err)
			}
			if ev.Type != tc.want {
				t.Fatalf("type = %q, want %q", ev.Type, tc.want)
			}
			if ev.SubscriptionRef != tc.subRef {
				t.Fatalf("subRef = %q, want %q", ev.SubscriptionRef, tc.subRef)
			}
			if ev.OrderID != tc.orderID {
				t.Fatalf("orderID = %q, want %q", ev.OrderID, tc.orderID)
			}
			if ev.AmountCents != tc.amount {
				t.Fatalf("amount = %d, want %d", ev.AmountCents, tc.amount)
			}
			if ev.Channel != "waffo" || ev.ChannelEventID != tc.eventType+":PAY_1" {
				t.Fatalf("channel/id = %s / %s", ev.Channel, ev.ChannelEventID)
			}
		})
	}

	// 负路径:错钥、缺头、过期、坏签名形态都进 validation 错误(ploykit 回 401)。
	body := webhookBody("subscription.activated", base)
	negs := []struct {
		name   string
		header string
	}{
		{"wrong-key", signWebhook(t, wrongKey, body, time.Now())},
		{"missing-header", ""},
		{"stale", signWebhook(t, testRSA(t), body, time.Now().Add(-46*time.Minute))},
		{"garbage", "t=1"},
	}
	for _, tc := range negs {
		t.Run("neg/"+tc.name, func(t *testing.T) {
			h := map[string][]string{}
			if tc.header != "" {
				h["X-Waffo-Signature"] = []string{tc.header}
			}
			if _, err := ch.ParseWebhook(context.Background(), app.WebhookRequest{Header: h, Body: body}); err == nil {
				t.Fatal("must be rejected")
			}
		})
	}
}

func TestParseWebhookExternalIDFallback(t *testing.T) {
	ch := testChannel(t, "https://unused.invalid")
	body := webhookBody("subscription.activated", map[string]any{
		"orderId": "ORD_root", "orderMerchantExternalId": "ord_ext9",
	})
	ev, err := ch.ParseWebhook(context.Background(), app.WebhookRequest{
		Header: map[string][]string{"X-Waffo-Signature": {signWebhook(t, testRSA(t), body, time.Now())}},
		Body:   body,
	})
	if err != nil {
		t.Fatal(err)
	}
	if ev.OrderID != "ord_ext9" {
		t.Fatalf("fallback orderID = %q", ev.OrderID)
	}
}

func TestParseWebhookNoPubKey(t *testing.T) {
	ch, err := New(Config{MerchantID: "M", PrivateKey: pemPrivate(testRSA(t)), ProductMonthly: "A", ProductYearly: "B"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ch.ParseWebhook(context.Background(), app.WebhookRequest{
		Header: map[string][]string{"X-Waffo-Signature": {"t=1,v1=x"}}, Body: []byte("{}"),
	}); err == nil || !strings.Contains(err.Error(), "public key not configured") {
		t.Fatalf("want pubkey-missing error, got %v", err)
	}
}

func TestParseWebhookJPYAmounts(t *testing.T) {
	ch := testChannel(t, "https://unused.invalid")
	body := webhookBody("subscription.payment_succeeded", map[string]any{
		"orderId": "ORD_jpy", "currency": "JPY", "chargedAmount": "4500", "periodNumber": 2,
		"orderMetadata": map[string]any{"order_id": "ord_jpy"},
	})
	ev, err := ch.ParseWebhook(context.Background(), app.WebhookRequest{
		Header: map[string][]string{"X-Waffo-Signature": {signWebhook(t, testRSA(t), body, time.Now())}},
		Body:   body,
	})
	if err != nil {
		t.Fatal(err)
	}
	if ev.AmountCents != 4500 {
		t.Fatalf("JPY amount = %d, want 4500 (zero-decimal: no dot, minor unit as-is)", ev.AmountCents)
	}
}

// ---- 金额换算(BC-3:本体在 money 包,这里只测本包的回退包装) ----

func TestFormatParseAmount(t *testing.T) {
	if got := money.FormatCents(1900, "USD"); got != "19.00" {
		t.Fatalf("usd = %q", got)
	}
	if got := money.FormatCents(19000, "USD"); got != "190.00" {
		t.Fatalf("usd yearly = %q", got)
	}
	if got := money.FormatCents(4500, "JPY"); got != "4500" {
		t.Fatalf("jpy = %q", got)
	}
	if got := parseAmountCents("19.00"); got != 1900 {
		t.Fatalf("parse usd = %d", got)
	}
	if got := parseAmountCents("", "4500"); got != 4500 {
		t.Fatalf("parse jpy fallback = %d", got)
	}
	if got := parseAmountCents("", ""); got != 0 {
		t.Fatalf("parse empty = %d", got)
	}
}

// ---- FromEnv 装配纪律(BC-1:原 FromEnvStrict 改名,语义不变) ----

func TestFromEnv(t *testing.T) {
	log := slog.New(slog.NewTextHandler(&strings.Builder{}, nil))
	full := map[string]string{
		EnvMerchantID: "MER_x", EnvPrivateKey: pemPrivate(testRSA(t)),
		EnvProductMonthly: "PROD_MO", EnvProductYearly: "PROD_YR",
	}
	getenv := func(m map[string]string) func(string) string {
		return func(k string) string { return m[k] }
	}

	ch, err := FromEnv(getenv(map[string]string{}), log, true)
	if ch != nil || err != nil {
		t.Fatalf("empty env = (nil,nil), got (%v,%v)", ch, err)
	}

	partial := map[string]string{EnvMerchantID: "MER_x", EnvPrivateKey: "k"}
	if _, err := FromEnv(getenv(partial), log, true); err == nil {
		t.Fatal("partial config in production must fail")
	}
	if ch, err := FromEnv(getenv(partial), log, false); ch != nil || err != nil {
		t.Fatalf("partial config in dev = disabled, got (%v,%v)", ch, err)
	}

	ch, err = FromEnv(getenv(full), log, true)
	if err != nil || ch == nil {
		t.Fatalf("full config: (%v,%v)", ch, err)
	}
	if cc := ch.ChannelConfig(); !cc.Configured || cc.WebhookConfigured {
		t.Fatalf("channel config = %+v (webhook key unset → must show unconfigured)", cc)
	}
}

func merge(base, extra map[string]any) map[string]any {
	out := make(map[string]any, len(base)+len(extra))
	for k, v := range base {
		out[k] = v
	}
	for k, v := range extra {
		out[k] = v
	}
	return out
}
