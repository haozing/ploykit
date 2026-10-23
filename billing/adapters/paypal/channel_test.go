package paypal

import (
	"context"
	"encoding/base64"
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
	"github.com/haozing/ploykit/billing/money"
)

// fakePaypal 是 hermetic 假 PayPal:OAuth token + webhook 验签两条公共路由,
// 用例经 extra 注册业务路由(建品/建计划/建订阅/取消/改价),全部断言在
// 请求体上,零真实网络。
type fakePaypal struct {
	srv *httptest.Server

	mu          sync.Mutex
	tokenCalls  int
	tokenAuth   string
	tokenBody   string
	verifyCalls int
	lastVerify  map[string]any

	verifyStatus string // 默认 SUCCESS;FAILURE 用例可改

	verifyHTTPStatus int // 非零 = 验签端点直接回该状态(网络/5xx 路径)
}

func newFakePaypal(t *testing.T, extra func(mux *http.ServeMux, f *fakePaypal)) *fakePaypal {
	t.Helper()
	f := &fakePaypal{verifyStatus: "SUCCESS"}
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/oauth2/token", func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		f.mu.Lock()
		f.tokenCalls++
		n := f.tokenCalls
		f.tokenAuth = r.Header.Get("Authorization")
		f.tokenBody = string(b)
		f.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"access_token":"tok-%d","token_type":"Bearer","expires_in":32400,"scope":"fake"}`, n)
	})
	mux.HandleFunc("/v1/notifications/verify-webhook-signature", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		f.mu.Lock()
		f.verifyCalls++
		f.lastVerify = body
		status := f.verifyStatus
		httpStatus := f.verifyHTTPStatus
		f.mu.Unlock()
		if httpStatus != 0 {
			w.WriteHeader(httpStatus)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"verification_status":"%s"}`, status)
	})
	if extra != nil {
		extra(mux, f)
	}
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakePaypal) snapshot() (tokenCalls, verifyCalls int, lastVerify map[string]any, tokenAuth, tokenBody string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.tokenCalls, f.verifyCalls, f.lastVerify, f.tokenAuth, f.tokenBody
}

func testChannel(t *testing.T, baseURL string) *Channel {
	t.Helper()
	ch, err := New(Config{
		ClientID:     "cid-test",
		ClientSecret: "secret-test",
		WebhookID:    "WHID-1",
		Mode:         "test",
		APIBase:      baseURL,
	})
	if err != nil {
		t.Fatal(err)
	}
	return ch
}

// ---- OAuth token:获取 + Basic auth + 缓存 + 过期重取 ----

func TestClientTokenFetchCacheAndRefresh(t *testing.T) {
	f := newFakePaypal(t, nil)
	cl := &Client{ClientID: "cid-test", ClientSecret: "secret-test",
		BaseURL: f.srv.URL, HTTP: f.srv.Client()}
	now := time.Now()
	cl.now = func() time.Time { return now }

	tok1, err := cl.token(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if tok1 != "tok-1" {
		t.Fatalf("token = %q, want tok-1", tok1)
	}
	_, verify, _, auth, body := f.snapshot()
	if verify != 0 {
		t.Fatal("token fetch must not call verify endpoint")
	}
	if want := "Basic " + base64.StdEncoding.EncodeToString([]byte("cid-test:secret-test")); auth != want {
		t.Fatalf("oauth auth header = %q, want %q", auth, want)
	}
	if body != "grant_type=client_credentials" {
		t.Fatalf("oauth body = %q, want grant_type=client_credentials", body)
	}

	// 缓存命中:第二次调用零网络(expires_in=32400,margin 60s 内不重取)。
	tok2, err := cl.token(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if tok2 != tok1 {
		t.Fatalf("cached token changed: %q vs %q", tok2, tok1)
	}
	if calls, _, _, _, _ := f.snapshot(); calls != 1 {
		t.Fatalf("token calls = %d, want 1 (cache)", calls)
	}

	// 越过 expiry-60s 边界:重取新 token。
	now = now.Add(32400*time.Second - 59*time.Second)
	tok3, err := cl.token(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if calls, _, _, _, _ := f.snapshot(); calls != 2 {
		t.Fatalf("token calls = %d, want 2 (refresh after expiry-margin)", calls)
	}
	if tok3 != "tok-2" {
		t.Fatalf("refreshed token = %q, want tok-2", tok3)
	}
}

func TestClientAPIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		fmt.Fprint(w, `{"name":"INVALID_CLIENT","message":"Client Authentication failed"}`)
	}))
	defer srv.Close()
	cl := &Client{ClientID: "c", ClientSecret: "s", BaseURL: srv.URL, HTTP: srv.Client()}
	var out map[string]any
	err := cl.do(context.Background(), http.MethodPost, "/v1/x", map[string]any{"a": 1}, &out)
	apiErr, ok := err.(*apiError)
	if !ok || apiErr.Status != 401 || !strings.Contains(apiErr.Error(), "INVALID_CLIENT") {
		t.Fatalf("want 401 apiError with body snippet, got %v", err)
	}
}

// ---- CreateCheckout ----

func TestCreateCheckoutRequestShape(t *testing.T) {
	var gotPath, gotAuth string
	var body map[string]any
	f := newFakePaypal(t, func(mux *http.ServeMux, _ *fakePaypal) {
		mux.HandleFunc("/v1/billing/subscriptions", func(w http.ResponseWriter, r *http.Request) {
			gotPath = r.URL.Path
			gotAuth = r.Header.Get("Authorization")
			_ = json.NewDecoder(r.Body).Decode(&body)
			fmt.Fprint(w, `{"id":"SUB-77","plan_id":"P-PLAN-1","status":"APPROVAL_PENDING",
				"links":[
					{"href":"https://www.sandbox.paypal.com/webapps/billing/subscriptions?token=BA-1","rel":"approve","method":"GET"},
					{"href":"https://api.m.sandbox.paypal.com/v1/billing/subscriptions/SUB-77","rel":"self","method":"GET"}
				]}`)
		})
	})
	ch := testChannel(t, f.srv.URL)

	sess, err := ch.CreateCheckout(context.Background(), app.CheckoutRequest{
		Order:            domain.Order{ID: "ord_123", PlanCode: "pro", Interval: domain.IntervalMonthly, AmountCents: 1900, Currency: "USD"},
		SuccessURL:       "https://app.example/billing/success",
		CancelURL:        "https://app.example/pricing",
		BuyerEmail:       "buyer@example.com",
		Locale:           "zh-CN",
		ChannelProductID: "P-PLAN-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if gotPath != "/v1/billing/subscriptions" {
		t.Fatalf("path = %q", gotPath)
	}
	if gotAuth != "Bearer tok-1" {
		t.Fatalf("auth = %q, want Bearer tok-1", gotAuth)
	}
	if body["plan_id"] != "P-PLAN-1" {
		t.Fatalf("plan_id = %v (BC-7:ChannelProductID 就是 paypal plan id)", body["plan_id"])
	}
	if body["custom_id"] != "ord_123" {
		t.Fatalf("custom_id = %v (订单反查键)", body["custom_id"])
	}
	ac := body["application_context"].(map[string]any)
	if ac["return_url"] != "https://app.example/billing/success" || ac["cancel_url"] != "https://app.example/pricing" {
		t.Fatalf("application_context = %v", ac)
	}
	if ac["locale"] != "zh-CN" {
		t.Fatalf("locale = %v", ac["locale"])
	}
	if sub, ok := body["subscriber"].(map[string]any); !ok || sub["email_address"] != "buyer@example.com" {
		t.Fatalf("subscriber = %v, want email prefill", body["subscriber"])
	}
	if _, has := body["plan"]; has {
		t.Fatal("payload must not carry any plan override — paypal has no session-level price")
	}

	if sess.ActionURL != "https://www.sandbox.paypal.com/webapps/billing/subscriptions?token=BA-1" {
		t.Fatalf("actionURL = %q, want rel=approve href", sess.ActionURL)
	}
	if sess.SessionRef != "SUB-77" || sess.OrderID != "ord_123" || sess.Channel != "paypal" {
		t.Fatalf("session mapping wrong: %+v", sess)
	}
	if sess.ExpiresAt.Before(time.Now()) {
		t.Fatalf("expiresAt = %v, want future sweep fallback", sess.ExpiresAt)
	}
}

func TestCreateCheckoutDefaults(t *testing.T) {
	var body map[string]any
	f := newFakePaypal(t, func(mux *http.ServeMux, _ *fakePaypal) {
		mux.HandleFunc("/v1/billing/subscriptions", func(w http.ResponseWriter, r *http.Request) {
			_ = json.NewDecoder(r.Body).Decode(&body)
			fmt.Fprint(w, `{"id":"SUB-1","status":"APPROVAL_PENDING","links":[{"href":"https://pp/approve","rel":"approve","method":"GET"}]}`)
		})
	})
	ch := testChannel(t, f.srv.URL)

	if _, err := ch.CreateCheckout(context.Background(), app.CheckoutRequest{
		Order:            domain.Order{ID: "o", PlanCode: "pro", Interval: domain.IntervalYearly, AmountCents: 19000, Currency: "USD"},
		ChannelProductID: "P-Y",
	}); err != nil {
		t.Fatal(err)
	}
	// BuyerEmail/Locale 空 = 不预填、PayPal 按买家偏好(application_context
	// 只剩必填的 return/cancel_url —— 本用例两者空串也照发,渠道契约由
	// 服务层注入)。
	if _, has := body["subscriber"]; has {
		t.Fatalf("subscriber must be omitted when email empty, got %v", body["subscriber"])
	}
	ac := body["application_context"].(map[string]any)
	if _, has := ac["locale"]; has {
		t.Fatalf("locale must be omitted when empty, got %v", ac["locale"])
	}
	if _, has := ac["user_action"]; has {
		t.Fatalf("user_action must stay default (SUBSCRIBE_NOW), got %v", ac["user_action"])
	}
}

func TestCreateCheckoutGuards(t *testing.T) {
	// 出网前快速失败:指向必炸地址,任何请求都会让用例失败得明确。
	ch := testChannel(t, "https://unused.invalid")

	if _, err := ch.CreateCheckout(context.Background(), app.CheckoutRequest{
		Order:            domain.Order{ID: "o", PlanCode: "pack", Interval: domain.IntervalOneTime, AmountCents: 990, Currency: "USD"},
		ChannelProductID: "P-1",
	}); err == nil || !strings.Contains(err.Error(), "one-time") {
		t.Fatalf("one_time must be rejected (Orders v2 预留), got %v", err)
	}
	if _, err := ch.CreateCheckout(context.Background(), app.CheckoutRequest{
		Order: domain.Order{ID: "o", PlanCode: "pro", Interval: domain.IntervalMonthly, AmountCents: 1900, Currency: "USD"},
	}); err == nil || !strings.Contains(err.Error(), "no plan registered") {
		t.Fatalf("missing ChannelProductID must fail clearly, got %v", err)
	}
}

func TestCreateCheckoutNoApproveLink(t *testing.T) {
	f := newFakePaypal(t, func(mux *http.ServeMux, _ *fakePaypal) {
		mux.HandleFunc("/v1/billing/subscriptions", func(w http.ResponseWriter, _ *http.Request) {
			fmt.Fprint(w, `{"id":"SUB-1","status":"APPROVAL_PENDING","links":[{"href":"https://pp/self","rel":"self","method":"GET"}]}`)
		})
	})
	ch := testChannel(t, f.srv.URL)
	_, err := ch.CreateCheckout(context.Background(), app.CheckoutRequest{
		Order:            domain.Order{ID: "o", PlanCode: "pro", Interval: domain.IntervalMonthly, AmountCents: 1900, Currency: "USD"},
		ChannelProductID: "P-1",
	})
	if err == nil || !strings.Contains(err.Error(), "approve") {
		t.Fatalf("missing approve link must error, got %v", err)
	}
}

// ---- CancelSubscription ----

func TestCancelSubscription(t *testing.T) {
	var gotPath string
	var body map[string]any
	f := newFakePaypal(t, func(mux *http.ServeMux, _ *fakePaypal) {
		mux.HandleFunc("/v1/billing/subscriptions/SUB-9/cancel", func(w http.ResponseWriter, r *http.Request) {
			gotPath = r.URL.Path
			_ = json.NewDecoder(r.Body).Decode(&body)
			w.WriteHeader(http.StatusNoContent) // 真实 PayPal:204 空响应
		})
	})
	ch := testChannel(t, f.srv.URL)

	if err := ch.CancelSubscription(context.Background(), "SUB-9"); err != nil {
		t.Fatal(err)
	}
	if gotPath != "/v1/billing/subscriptions/SUB-9/cancel" {
		t.Fatalf("path = %q", gotPath)
	}
	if reason, _ := body["reason"].(string); reason == "" || len(reason) > 128 {
		t.Fatalf("reason must be non-empty and <=128 chars (PayPal 契约), got %v", body["reason"])
	}

	// 空 SubscriptionRef 是调用方事故,不该出网。
	if err := ch.CancelSubscription(context.Background(), " "); err == nil {
		t.Fatal("empty subscription reference must be rejected")
	}

	// 渠道侧 4xx(订阅已终态)带原因返回。
	var status int
	fErr := newFakePaypal(t, func(mux *http.ServeMux, _ *fakePaypal) {
		mux.HandleFunc("/v1/billing/subscriptions/SUB-x/cancel", func(w http.ResponseWriter, _ *http.Request) {
			status = http.StatusUnprocessableEntity
			w.WriteHeader(status)
			fmt.Fprint(w, `{"name":"UNPROCESSABLE_ENTITY","message":"Subscription state is not cancel-able"}`)
		})
	})
	chErr := testChannel(t, fErr.srv.URL)
	err := chErr.CancelSubscription(context.Background(), "SUB-x")
	if err == nil || !strings.Contains(err.Error(), "cancel subscription") || !strings.Contains(err.Error(), "422") {
		t.Fatalf("want wrapped cancel error with status, got %v", err)
	}
}

// ---- TestConnection ----

func TestTestConnection(t *testing.T) {
	f := newFakePaypal(t, nil)
	ch := testChannel(t, f.srv.URL)
	if err := ch.TestConnection(context.Background()); err != nil {
		t.Fatal(err)
	}
	if calls, _, _, _, _ := f.snapshot(); calls != 1 {
		t.Fatalf("probe must be exactly one oauth token call, got %d", calls)
	}

	// 401(凭据错)必须带原因失败。
	unauth := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		fmt.Fprint(w, `{"name":"INVALID_CLIENT","message":"Client Authentication failed"}`)
	}))
	defer unauth.Close()
	chUnauth := testChannel(t, unauth.URL)
	err := chUnauth.TestConnection(context.Background())
	if err == nil || !strings.Contains(err.Error(), "test connection") || !strings.Contains(err.Error(), "401") {
		t.Fatalf("want wrapped 401 error, got %v", err)
	}
}

// ---- ParseWebhook:验签 ----

func paypalHeaders() map[string][]string {
	return map[string][]string{
		"PAYPAL-AUTH-ALGO":         {"SHA256withRSA"},
		"PAYPAL-CERT-URL":          {"https://api-m.sandbox.paypal.com/cert"},
		"PAYPAL-TRANSMISSION-ID":   {"tid-123"},
		"PAYPAL-TRANSMISSION-SIG":  {"sig-abc"},
		"PAYPAL-TRANSMISSION-TIME": {"2026-10-24T00:00:00Z"},
	}
}

func webhookEvent(t *testing.T, eventType, resourceType string, resource map[string]any) []byte {
	t.Helper()
	b, err := json.Marshal(map[string]any{
		"id":            "WH-1",
		"event_type":    eventType,
		"resource_type": resourceType,
		"create_time":   "2026-10-24T00:00:00Z",
		"resource":      resource,
	})
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestParseWebhookVerifyRequestShape(t *testing.T) {
	f := newFakePaypal(t, nil)
	ch := testChannel(t, f.srv.URL)
	body := webhookEvent(t, "BILLING.SUBSCRIPTION.ACTIVATED", "subscription",
		map[string]any{"id": "SUB-1", "status": "ACTIVE", "custom_id": "ord_1"})

	ev, err := ch.ParseWebhook(context.Background(), app.WebhookRequest{Header: paypalHeaders(), Body: body})
	if err != nil {
		t.Fatal(err)
	}
	if ev.Type != domain.EventCheckoutCompleted {
		t.Fatalf("type = %v", ev.Type)
	}
	_, verifyCalls, lastVerify, _, _ := f.snapshot()
	if verifyCalls != 1 {
		t.Fatalf("verify calls = %d, want 1", verifyCalls)
	}
	// 七字段逐项:五头一 ID 一原始事件(原始 JSON 逐字节等价)。
	want := map[string]string{
		"auth_algo":         "SHA256withRSA",
		"cert_url":          "https://api-m.sandbox.paypal.com/cert",
		"transmission_id":   "tid-123",
		"transmission_sig":  "sig-abc",
		"transmission_time": "2026-10-24T00:00:00Z",
		"webhook_id":        "WHID-1",
	}
	for k, v := range want {
		if lastVerify[k] != v {
			t.Fatalf("verify.%s = %v, want %q", k, lastVerify[k], v)
		}
	}
	var rawEvent map[string]any
	if err := json.Unmarshal(body, &rawEvent); err != nil {
		t.Fatal(err)
	}
	gotEvent, ok := lastVerify["webhook_event"].(map[string]any)
	if !ok || gotEvent["id"] != rawEvent["id"] || gotEvent["event_type"] != rawEvent["event_type"] {
		t.Fatalf("webhook_event must be the raw event body, got %v", lastVerify["webhook_event"])
	}
}

func TestParseWebhookVerifyFailures(t *testing.T) {
	body := webhookEvent(t, "BILLING.SUBSCRIPTION.ACTIVATED", "subscription", map[string]any{"id": "SUB-1"})

	// FAILURE:验签 API 明确说不 → 拒收。
	fFailure := newFakePaypal(t, nil)
	fFailure.verifyStatus = "FAILURE"
	if _, err := testChannel(t, fFailure.srv.URL).ParseWebhook(context.Background(), app.WebhookRequest{Header: paypalHeaders(), Body: body}); err == nil {
		t.Fatal("verification_status=FAILURE must be rejected")
	}

	// 网络错(验签端点炸)→ 拒收,绝不放行。
	fBroken := newFakePaypal(t, nil)
	fBroken.verifyHTTPStatus = http.StatusInternalServerError
	if _, err := testChannel(t, fBroken.srv.URL).ParseWebhook(context.Background(), app.WebhookRequest{Header: paypalHeaders(), Body: body}); err == nil {
		t.Fatal("verify endpoint 5xx must be treated as verification failure")
	}

	// 缺任一头:出网前拒绝(零 token 调用)。
	fIdle := newFakePaypal(t, nil)
	ch := testChannel(t, fIdle.srv.URL)
	for _, drop := range []string{"PAYPAL-AUTH-ALGO", "PAYPAL-CERT-URL", "PAYPAL-TRANSMISSION-ID", "PAYPAL-TRANSMISSION-SIG", "PAYPAL-TRANSMISSION-TIME"} {
		h := paypalHeaders()
		delete(h, drop)
		if _, err := ch.ParseWebhook(context.Background(), app.WebhookRequest{Header: h, Body: body}); err == nil {
			t.Fatalf("missing %s must be rejected", drop)
		}
	}
	if calls, verify, _, _, _ := fIdle.snapshot(); calls != 0 || verify != 0 {
		t.Fatalf("header-missing rejections must not touch the network, token/verify = %d/%d", calls, verify)
	}

	// 空 body。
	if _, err := ch.ParseWebhook(context.Background(), app.WebhookRequest{Header: paypalHeaders(), Body: nil}); err == nil {
		t.Fatal("empty body must be rejected")
	}

	// webhook_id 未配置:恒拒。
	bare, err := New(Config{ClientID: "c", ClientSecret: "s", APIBase: fIdle.srv.URL})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := bare.ParseWebhook(context.Background(), app.WebhookRequest{Header: paypalHeaders(), Body: body}); err == nil || !strings.Contains(err.Error(), "webhook id not configured") {
		t.Fatalf("want webhook-id-missing error, got %v", err)
	}
}

// ---- ParseWebhook:五律事件映射 ----

func TestParseWebhookMapping(t *testing.T) {
	f := newFakePaypal(t, nil)
	ch := testChannel(t, f.srv.URL)

	v1Amount := func(total, currency string) map[string]any {
		return map[string]any{"total": total, "currency": currency}
	}
	cases := []struct {
		name         string
		eventType    string
		resource     map[string]any
		wantType     string
		wantOrder    string
		wantSub      string
		wantChannel  string
		wantPI       string
		wantAmount   int
		wantCurrency string
	}{
		{"activated", "BILLING.SUBSCRIPTION.ACTIVATED",
			map[string]any{"id": "SUB-1", "plan_id": "P-1", "status": "ACTIVE", "custom_id": "ord_123",
				"start_time": "2026-10-24T00:00:00Z"},
			domain.EventCheckoutCompleted, "ord_123", "SUB-1", "SUB-1", "", 0, ""},
		// 钱到账(五律 1):sale 对象无 custom_id,OrderID 留空走 SubscriptionRef 路径;
		// 金额 v1 形态 {currency,total}。
		{"sale-completed-v1-amount", "PAYMENT.SALE.COMPLETED",
			map[string]any{"id": "SAL-9", "state": "completed", "amount": v1Amount("19.00", "USD"),
				"billing_agreement_id": "SUB-1"},
			domain.EventSubscriptionRenewed, "", "SUB-1", "SUB-1", "SAL-9", 1900, "USD"},
		// 金额 v2 形态 {currency_code,value} 的兼容形态。
		{"sale-completed-v2-amount", "PAYMENT.SALE.COMPLETED",
			map[string]any{"id": "SAL-10", "state": "completed",
				"amount":               map[string]any{"value": "99.00", "currency_code": "USD"},
				"billing_agreement_id": "SUB-2"},
			domain.EventSubscriptionRenewed, "", "SUB-2", "SUB-2", "SAL-10", 9900, "USD"},
		// JPY 零小数。
		{"sale-completed-jpy", "PAYMENT.SALE.COMPLETED",
			map[string]any{"id": "SAL-11", "amount": v1Amount("4500", "JPY"), "billing_agreement_id": "SUB-3"},
			domain.EventSubscriptionRenewed, "", "SUB-3", "SUB-3", "SAL-11", 4500, "JPY"},
		{"cancelled", "BILLING.SUBSCRIPTION.CANCELLED",
			map[string]any{"id": "SUB-1", "status": "CANCELLED", "custom_id": "ord_123"},
			domain.EventSubscriptionCanceled, "ord_123", "SUB-1", "SUB-1", "", 0, ""},
		// 退款:amount(本次)优先,total_refunded_amount(累计)兜底;
		// billing_agreement_id 在载荷 → ChannelRef/SubscriptionRef 走订阅 id 反查。
		{"refunded-with-agreement", "PAYMENT.SALE.REFUNDED",
			map[string]any{"id": "RE-1", "sale_id": "SAL-9", "state": "completed",
				"amount": v1Amount("9.50", "USD"), "total_refunded_amount": v1Amount("19.00", "USD"),
				"billing_agreement_id": "SUB-1"},
			domain.EventRefundCreated, "", "SUB-1", "SUB-1", "SAL-9", 950, "USD"},
		// 退款载荷只有累计额,无订阅引用 → 退化 sale_id(PI)+ 退款 id(ChannelRef)。
		{"refunded-total-only", "PAYMENT.SALE.REFUNDED",
			map[string]any{"id": "RE-2", "sale_id": "SAL-9",
				"total_refunded_amount": v1Amount("19.00", "USD")},
			domain.EventRefundCreated, "", "", "RE-2", "SAL-9", 1900, "USD"},
		// 订阅中间态/催收/争议 → ignored(五律:只认钱与终态)。
		{"suspended", "BILLING.SUBSCRIPTION.SUSPENDED", map[string]any{"id": "SUB-1", "status": "SUSPENDED"}, "ignored", "", "", "", "", 0, ""},
		{"expired", "BILLING.SUBSCRIPTION.EXPIRED", map[string]any{"id": "SUB-1", "status": "EXPIRED"}, "ignored", "", "", "", "", 0, ""},
		{"updated", "BILLING.SUBSCRIPTION.UPDATED", map[string]any{"id": "SUB-1", "status": "ACTIVE"}, "ignored", "", "", "", "", 0, ""},
		{"payment-failed", "BILLING.SUBSCRIPTION.PAYMENT.FAILED", map[string]any{"id": "SUB-1", "status": "SUSPENDED"}, "ignored", "", "", "", "", 0, ""},
		{"dispute", "DISPUTE.CREATED", map[string]any{"dispute_id": "DSP-1"}, "ignored", "", "", "", "", 0, ""},
		{"sale-denied", "PAYMENT.SALE.DENIED", map[string]any{"id": "SAL-x", "state": "denied"}, "ignored", "", "", "", "", 0, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			body := webhookEvent(t, tc.eventType, "subscription", tc.resource)
			ev, err := ch.ParseWebhook(context.Background(), app.WebhookRequest{Header: paypalHeaders(), Body: body})
			if err != nil {
				t.Fatal(err)
			}
			if ev.Type != tc.wantType {
				t.Fatalf("type = %q, want %q", ev.Type, tc.wantType)
			}
			if ev.OrderID != tc.wantOrder {
				t.Fatalf("orderID = %q, want %q", ev.OrderID, tc.wantOrder)
			}
			if ev.SubscriptionRef != tc.wantSub {
				t.Fatalf("subscriptionRef = %q, want %q", ev.SubscriptionRef, tc.wantSub)
			}
			if ev.ChannelRef != tc.wantChannel {
				t.Fatalf("channelRef = %q, want %q", ev.ChannelRef, tc.wantChannel)
			}
			if ev.PaymentIntentRef != tc.wantPI {
				t.Fatalf("paymentIntentRef = %q, want %q", ev.PaymentIntentRef, tc.wantPI)
			}
			if ev.AmountCents != tc.wantAmount {
				t.Fatalf("amountCents = %d, want %d", ev.AmountCents, tc.wantAmount)
			}
			if ev.Currency != tc.wantCurrency {
				t.Fatalf("currency = %q, want %q", ev.Currency, tc.wantCurrency)
			}
			// 五律 4:幂等键拼事件类型(资源 id 跨事件复用)。
			if ev.ChannelEventID != tc.eventType+":WH-1" {
				t.Fatalf("channelEventID = %q, want %q", ev.ChannelEventID, tc.eventType+":WH-1")
			}
			if ev.Channel != "paypal" {
				t.Fatalf("channel = %q", ev.Channel)
			}
			// 五律 5:渠道配置的 mode 记入 Payload 供审计(paypal 载荷自身不带 mode)。
			if ev.Payload["mode"] != ModeTest {
				t.Fatalf("payload mode = %v, want %q", ev.Payload["mode"], ModeTest)
			}
		})
	}
}

// ---- 金额换算(本体在 money 包,这里只测 flexMoney 双形态包装) ----

func TestFlexMoneyShapes(t *testing.T) {
	var v1 flexMoney
	if err := json.Unmarshal([]byte(`{"currency":"USD","total":"19.00"}`), &v1); err != nil {
		t.Fatal(err)
	}
	if v1.amount() != "19.00" || v1.currency() != "USD" {
		t.Fatalf("v1 shape: %q / %q", v1.amount(), v1.currency())
	}
	var v2 flexMoney
	if err := json.Unmarshal([]byte(`{"currency_code":"JPY","value":"4500"}`), &v2); err != nil {
		t.Fatal(err)
	}
	if v2.amount() != "4500" || v2.currency() != "JPY" {
		t.Fatalf("v2 shape: %q / %q", v2.amount(), v2.currency())
	}
	if money.ParseAmount(v2.amount()) != 4500 {
		t.Fatal("JPY zero-decimal passthrough broken")
	}
	var nilMoney *flexMoney
	if nilMoney.amount() != "" || nilMoney.currency() != "" {
		t.Fatal("nil money must degrade to empty strings")
	}
}

// ---- FromEnv 装配纪律(四必填全有或全无) ----

func TestFromEnv(t *testing.T) {
	log := slog.New(slog.NewTextHandler(&strings.Builder{}, nil))
	full := map[string]string{
		EnvClientID:     "cid-1",
		EnvClientSecret: "sec-1",
		EnvWebhookID:    "WHID-1",
		EnvMode:         "test",
	}
	getenv := func(m map[string]string) func(string) string {
		return func(k string) string { return m[k] }
	}

	// 全缺 = 未配置。
	ch, err := FromEnv(getenv(map[string]string{}), log, true)
	if ch != nil || err != nil {
		t.Fatalf("empty env = (nil,nil), got (%v,%v)", ch, err)
	}

	// 部分缺(3/4):production 拒启,dev 降级跳过。
	partial := map[string]string{EnvClientID: "cid-1", EnvClientSecret: "sec-1", EnvWebhookID: "WHID-1"}
	if _, err := FromEnv(getenv(partial), log, true); err == nil {
		t.Fatal("partial config in production must fail")
	}
	if ch, err := FromEnv(getenv(partial), log, false); ch != nil || err != nil {
		t.Fatalf("partial config in dev = disabled, got (%v,%v)", ch, err)
	}

	// 完整:构造成功,半残态可见。
	ch, err = FromEnv(getenv(full), log, true)
	if err != nil || ch == nil {
		t.Fatalf("full config: (%v,%v)", ch, err)
	}
	if cc := ch.ChannelConfig(); !cc.Configured || !cc.WebhookConfigured || !strings.Contains(cc.KeyMasked, "cid") {
		t.Fatalf("channel config = %+v", cc)
	}
	if ch.client.BaseURL != SandboxAPIBase {
		t.Fatalf("mode=test must hit sandbox, got %s", ch.client.BaseURL)
	}

	// live 别名归一到 prod → 生产主机。
	live := map[string]string{}
	for k, v := range full {
		live[k] = v
	}
	live[EnvMode] = "live"
	ch, err = FromEnv(getenv(live), log, true)
	if err != nil || ch == nil {
		t.Fatalf("live mode: (%v,%v)", ch, err)
	}
	if ch.client.BaseURL != LiveAPIBase {
		t.Fatalf("mode=live must hit api-m.paypal.com, got %s", ch.client.BaseURL)
	}
}

// ---- NewFromFields(BC-5 DB 凭据优先,env 回退) ----

func TestNewFromFields(t *testing.T) {
	log := slog.New(slog.NewTextHandler(&strings.Builder{}, nil))
	env := map[string]string{
		EnvClientID:     "cid-env",
		EnvClientSecret: "sec-env",
		EnvWebhookID:    "WHID-env",
		EnvMode:         "test",
	}
	getenv := func(k string) string { return env[k] }

	// 全缺 = 未配置(nil,nil)。
	ch, err := NewFromFields(nil, func(string) string { return "" }, log, true)
	if ch != nil || err != nil {
		t.Fatalf("empty = (nil,nil), got (%v,%v)", ch, err)
	}

	// fields 覆盖 env:client_id 来自 DB,其余回退 env。
	ch, err = NewFromFields(map[string]string{"client_id": "cid-db"}, getenv, log, true)
	if err != nil || ch == nil {
		t.Fatalf("fields overlay env: (%v,%v)", ch, err)
	}
	if got := ch.ChannelConfig().KeyMasked; !strings.HasPrefix(got, "cid") {
		t.Fatalf("client id from DB expected, masked = %q", got)
	}

	// 渐进配置:fields 只给 client_id+client_secret(webhook_id/mode 缺省)
	// → 可构造,WebhookConfigured=false 半残态可见,mode 缺省 test 走沙箱。
	ch, err = NewFromFields(map[string]string{
		FieldClientID: "cid-db", FieldClientSecret: "sec-db",
	}, func(string) string { return "" }, log, true)
	if err != nil || ch == nil {
		t.Fatalf("progressive config: (%v,%v)", ch, err)
	}
	if cc := ch.ChannelConfig(); !cc.Configured || cc.WebhookConfigured {
		t.Fatalf("half-configured channel must show webhook-unconfigured, got %+v", cc)
	}
	if ch.client.BaseURL != SandboxAPIBase {
		t.Fatalf("default mode must be sandbox-safe, got %s", ch.client.BaseURL)
	}

	// 半配置(client_id 无 secret):production 拒、dev 降级。
	if _, err := NewFromFields(map[string]string{"client_id": "cid-db"}, func(string) string { return "" }, log, true); err == nil {
		t.Fatal("partial pair in production must fail")
	}
	if ch, err := NewFromFields(map[string]string{"client_id": "cid-db"}, func(string) string { return "" }, log, false); ch != nil || err != nil {
		t.Fatalf("partial pair in dev = disabled, got (%v,%v)", ch, err)
	}

	// API base 覆盖(测试通道):显式 PAYPAL_API_BASE 优先于 mode 推导。
	ch, err = NewFromFields(map[string]string{
		FieldClientID: "cid-db", FieldClientSecret: "sec-db", FieldMode: "prod",
	}, func(k string) string {
		if k == EnvAPIBase {
			return "http://pp.test/"
		}
		return ""
	}, log, true)
	if err != nil || ch == nil {
		t.Fatalf("api base override: (%v,%v)", ch, err)
	}
	if ch.client.BaseURL != "http://pp.test" {
		t.Fatalf("explicit api base must win, got %s", ch.client.BaseURL)
	}
}
