package stripe

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strconv"
	"testing"
	"time"

	"github.com/haozing/ploykit/billing/app"
	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/platform/webx"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	stripeapi "github.com/stripe/stripe-go/v87"
)

const testSigningKey = "whsec_test_signing_key"

func sign(t0 int64, body, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(fmt.Sprintf("%d.%s", t0, body)))
	return fmt.Sprintf("t=%d,v1=%s", t0, hex.EncodeToString(mac.Sum(nil)))
}

func eventBody(evtType, object string) string {
	return fmt.Sprintf(
		`{"id":"evt_1","object":"event","api_version":%q,"type":%q,"data":{"object":%s}}`,
		stripeapi.APIVersion, evtType, object)
}

func signedReq(t *testing.T, body string) app.WebhookRequest {
	t.Helper()
	h := http.Header{}
	h.Set("Stripe-Signature", sign(time.Now().Unix(), body, testSigningKey))
	return app.WebhookRequest{Header: h, Body: []byte(body)}
}

func TestParseWebhook(t *testing.T) {
	checkoutCompleted := eventBody("checkout.session.completed",
		`{"id":"cs_1","amount_total":9900,"metadata":{"order_id":"ord_1"}}`)

	tests := []struct {
		name    string
		req     app.WebhookRequest
		want    domain.PaymentEvent
		wantErr string
	}{
		{
			name: "合法签名 checkout.session.completed → EventCheckoutCompleted + OrderID",
			req:  signedReq(t, checkoutCompleted),
			want: domain.PaymentEvent{
				Channel:        "stripe",
				ChannelEventID: "evt_1",
				Type:           domain.EventCheckoutCompleted,
				OrderID:        "ord_1",
				ChannelRef:     "cs_1",
				AmountCents:    9900,
				Payload: map[string]any{
					"id":           "cs_1",
					"amount_total": float64(9900),
					"metadata":     map[string]any{"order_id": "ord_1"},
				},
			},
		},
		{
			name: "签名错误 → E_VALIDATION",
			req: func() app.WebhookRequest {
				r := signedReq(t, checkoutCompleted)

				http.Header(r.Header).Set("Stripe-Signature", sign(time.Now().Unix(), "tampered", testSigningKey))
				return r
			}(),
			wantErr: webx.CodeValidation,
		},
		{
			name:    "缺 Stripe-Signature 头 → E_VALIDATION",
			req:     app.WebhookRequest{Body: []byte(checkoutCompleted)},
			wantErr: webx.CodeValidation,
		},
		{
			name: "未知事件类型 → Type=ignored 无错误",
			req:  signedReq(t, eventBody("customer.created", `{"id":"cus_1"}`)),
			want: domain.PaymentEvent{
				Channel:        "stripe",
				ChannelEventID: "evt_1",
				Type:           "ignored",
				Payload:        map[string]any{"id": "cus_1"},
			},
		},
		{
			name: "payment_intent.payment_failed → EventPaymentFailed（OrderID 可为空，PI 即锚）",
			req:  signedReq(t, eventBody("payment_intent.payment_failed", `{"id":"pi_1","metadata":{}}`)),
			want: domain.PaymentEvent{
				Channel:          "stripe",
				ChannelEventID:   "evt_1",
				Type:             domain.EventPaymentFailed,
				ChannelRef:       "pi_1",
				PaymentIntentRef: "pi_1",
				Payload:          map[string]any{"id": "pi_1", "metadata": map[string]any{}},
			},
		},
		{
			name: "charge.refunded → EventRefundCreated（ChannelRef=PaymentIntent.ID，P1-3 双锚）",
			req:  signedReq(t, eventBody("charge.refunded", `{"id":"ch_1","payment_intent":"pi_9"}`)),
			want: domain.PaymentEvent{
				Channel:          "stripe",
				ChannelEventID:   "evt_1",
				Type:             domain.EventRefundCreated,
				ChannelRef:       "pi_9",
				PaymentIntentRef: "pi_9",
				Payload:          map[string]any{"id": "ch_1", "payment_intent": "pi_9"},
			},
		},
		{

			name: "checkout.session.completed unpaid（异步支付未到账） → Type=ignored",
			req:  signedReq(t, eventBody("checkout.session.completed", `{"id":"cs_u","payment_status":"unpaid","amount_total":9900,"metadata":{"order_id":"ord_u"}}`)),
			want: domain.PaymentEvent{
				Channel:        "stripe",
				ChannelEventID: "evt_1",
				Type:           "ignored",
				Payload: map[string]any{
					"id": "cs_u", "payment_status": "unpaid", "amount_total": float64(9900),
					"metadata": map[string]any{"order_id": "ord_u"},
				},
			},
		},
		{

			name: "checkout.session.async_payment_succeeded → EventCheckoutCompleted + PI 锚",
			req: signedReq(t, eventBody("checkout.session.async_payment_succeeded",
				`{"id":"cs_a","payment_status":"paid","amount_total":9900,"currency":"cny","metadata":{"order_id":"ord_a"},"payment_intent":"pi_a"}`)),
			want: domain.PaymentEvent{
				Channel:          "stripe",
				ChannelEventID:   "evt_1",
				Type:             domain.EventCheckoutCompleted,
				OrderID:          "ord_a",
				ChannelRef:       "cs_a",
				PaymentIntentRef: "pi_a",
				AmountCents:      9900,
				Currency:         "cny",
				Payload: map[string]any{
					"id": "cs_a", "payment_status": "paid", "amount_total": float64(9900),
					"currency": "cny", "metadata": map[string]any{"order_id": "ord_a"},
					"payment_intent": "pi_a",
				},
			},
		},
		{

			name: "checkout.session.async_payment_failed → EventPaymentFailed",
			req: signedReq(t, eventBody("checkout.session.async_payment_failed",
				`{"id":"cs_f","payment_status":"unpaid","metadata":{"order_id":"ord_f"},"payment_intent":"pi_f"}`)),
			want: domain.PaymentEvent{
				Channel:          "stripe",
				ChannelEventID:   "evt_1",
				Type:             domain.EventPaymentFailed,
				OrderID:          "ord_f",
				ChannelRef:       "cs_f",
				PaymentIntentRef: "pi_f",
				Payload: map[string]any{
					"id": "cs_f", "payment_status": "unpaid",
					"metadata": map[string]any{"order_id": "ord_f"}, "payment_intent": "pi_f",
				},
			},
		},
		{

			name: "checkout.session.completed payment 模式 → PaymentIntentRef 锚",
			req: signedReq(t, eventBody("checkout.session.completed",
				`{"id":"cs_p","payment_status":"paid","amount_total":500,"currency":"usd","metadata":{"order_id":"ord_p"},"payment_intent":"pi_p"}`)),
			want: domain.PaymentEvent{
				Channel:          "stripe",
				ChannelEventID:   "evt_1",
				Type:             domain.EventCheckoutCompleted,
				OrderID:          "ord_p",
				ChannelRef:       "cs_p",
				PaymentIntentRef: "pi_p",
				AmountCents:      500,
				Currency:         "usd",
				Payload: map[string]any{
					"id": "cs_p", "payment_status": "paid", "amount_total": float64(500),
					"currency": "usd", "metadata": map[string]any{"order_id": "ord_p"},
					"payment_intent": "pi_p",
				},
			},
		},
		{

			name: "checkout.session.completed 订阅模式 → SubscriptionRef=sub ID",
			req: signedReq(t, eventBody("checkout.session.completed",
				`{"id":"cs_2","amount_total":9900,"metadata":{"order_id":"ord_2"},"subscription":"sub_2"}`)),
			want: domain.PaymentEvent{
				Channel:         "stripe",
				ChannelEventID:  "evt_1",
				Type:            domain.EventCheckoutCompleted,
				OrderID:         "ord_2",
				ChannelRef:      "cs_2",
				SubscriptionRef: "sub_2",
				AmountCents:     9900,
				Payload: map[string]any{
					"id": "cs_2", "amount_total": float64(9900),
					"metadata":     map[string]any{"order_id": "ord_2"},
					"subscription": "sub_2",
				},
			},
		},
		{
			name: "checkout.session.completed 订阅展开对象形态 → SubscriptionRef 仍取得到",
			req: signedReq(t, eventBody("checkout.session.completed",
				`{"id":"cs_3","metadata":{"order_id":"ord_3"},"subscription":{"id":"sub_3","object":"subscription"}}`)),
			want: domain.PaymentEvent{
				Channel:         "stripe",
				ChannelEventID:  "evt_1",
				Type:            domain.EventCheckoutCompleted,
				OrderID:         "ord_3",
				ChannelRef:      "cs_3",
				SubscriptionRef: "sub_3",
				Payload: map[string]any{
					"id": "cs_3", "metadata": map[string]any{"order_id": "ord_3"},
					"subscription": map[string]any{"id": "sub_3", "object": "subscription"},
				},
			},
		},
		{

			name: "invoice.paid（v87 形态） → EventSubscriptionRenewed",
			req: signedReq(t, eventBody("invoice.paid",
				`{"id":"in_1","parent":{"type":"subscription","subscription_details":{"subscription":{"id":"sub_r1","object":"subscription"}}},"lines":{"data":[{"metadata":{"order_id":"ord_r1"}}]}}`)),
			want: domain.PaymentEvent{
				Channel:         "stripe",
				ChannelEventID:  "evt_1",
				Type:            domain.EventSubscriptionRenewed,
				SubscriptionRef: "sub_r1",
				OrderID:         "ord_r1",
				Payload: map[string]any{
					"id": "in_1",
					"parent": map[string]any{
						"type": "subscription",
						"subscription_details": map[string]any{
							"subscription": map[string]any{"id": "sub_r1", "object": "subscription"},
						},
					},
					"lines": map[string]any{
						"data": []any{map[string]any{"metadata": map[string]any{"order_id": "ord_r1"}}},
					},
				},
			},
		},
		{

			name: "invoice.paid（旧形态顶层字符串） → renewed，OrderID 留空",
			req: signedReq(t, eventBody("invoice.paid",
				`{"id":"in_2","subscription":"sub_r2","lines":{"data":[{"metadata":{}}]}}`)),
			want: domain.PaymentEvent{
				Channel:         "stripe",
				ChannelEventID:  "evt_1",
				Type:            domain.EventSubscriptionRenewed,
				SubscriptionRef: "sub_r2",
				Payload: map[string]any{
					"id": "in_2", "subscription": "sub_r2",
					"lines": map[string]any{"data": []any{map[string]any{"metadata": map[string]any{}}}},
				},
			},
		},
		{
			name: "customer.subscription.deleted → EventSubscriptionCanceled（SubscriptionRef=对象 ID）",
			req: signedReq(t, eventBody("customer.subscription.deleted",
				`{"id":"sub_c1","object":"subscription"}`)),
			want: domain.PaymentEvent{
				Channel:         "stripe",
				ChannelEventID:  "evt_1",
				Type:            domain.EventSubscriptionCanceled,
				SubscriptionRef: "sub_c1",
				Payload:         map[string]any{"id": "sub_c1", "object": "subscription"},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := New("sk_test_x", testSigningKey)
			ev, err := c.ParseWebhook(context.Background(), tt.req)
			if tt.wantErr != "" {
				var we *webx.Error
				require.ErrorAs(t, err, &we)
				assert.Equal(t, tt.wantErr, we.Code)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.want, ev)
		})
	}
}

func fakeStripe(t *testing.T, handler http.HandlerFunc) *stripeapi.Backends {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return stripeapi.NewBackendsWithConfig(&stripeapi.BackendConfig{
		URL:               stripeapi.String(srv.URL),
		MaxNetworkRetries: stripeapi.Int64(0),
	})
}

func TestCreateCheckout(t *testing.T) {
	var (
		gotPath string
		gotBody string
		gotAuth string
		called  bool
	)
	backends := fakeStripe(t, func(w http.ResponseWriter, r *http.Request) {
		called = true
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"cs_test_1","object":"checkout.session",` +
			`"url":"https://checkout.stripe.com/c/pay/cs_test_1","expires_at":1790000000}`))
	})

	ch := New("sk_test_key", testSigningKey)
	ch.setBackends(backends)

	order := domain.Order{
		ID: "ord_1", WorkspaceID: "ws_1", PlanCode: "pro",
		Interval: domain.IntervalOneTime, AmountCents: 9900, Currency: "usd",
	}
	sess, err := ch.CreateCheckout(context.Background(), order,
		"https://app.example.com/billing/success", "https://app.example.com/billing/cancel")
	require.NoError(t, err)
	require.True(t, called, "应请求假 Stripe API")

	assert.Equal(t, "/v1/checkout/sessions", gotPath)
	assert.Equal(t, "Bearer sk_test_key", gotAuth)

	assert.Contains(t, gotBody, "mode=payment")
	assert.Contains(t, gotBody, "metadata[order_id]=ord_1")
	assert.Contains(t, gotBody, "line_items[0][price_data][unit_amount]=9900")
	assert.Contains(t, gotBody, "line_items[0][price_data][currency]=usd")
	assert.Contains(t, gotBody, "line_items[0][price_data][product_data][name]=pro+%28one_time%29")
	assert.Contains(t, gotBody, "success_url=https%3A%2F%2Fapp.example.com%2Fbilling%2Fsuccess")
	assert.Contains(t, gotBody, "cancel_url=https%3A%2F%2Fapp.example.com%2Fbilling%2Fcancel")

	m := regexp.MustCompile(`expires_at=(\d+)`).FindStringSubmatch(gotBody)
	require.NotNil(t, m, "请求体应含 expires_at")
	exp, err := strconv.ParseInt(m[1], 10, 64)
	require.NoError(t, err)
	assert.InDelta(t, time.Now().Add(24*time.Hour).Unix(), exp, 60)

	assert.Equal(t, domain.CheckoutSession{
		OrderID:    "ord_1",
		Channel:    "stripe",
		ActionURL:  "https://checkout.stripe.com/c/pay/cs_test_1",
		SessionRef: "cs_test_1",
		ExpiresAt:  time.Unix(1790000000, 0).UTC(),
	}, sess)
}

func TestCreateCheckoutSubscription(t *testing.T) {
	tests := []struct {
		name       string
		order      domain.Order
		wantBody   []string
		noWant     string
		checkTrial bool
		trialDays  int
	}{
		{
			name: "monthly → mode=subscription + recurring month",
			order: domain.Order{
				ID: "ord_1", PlanCode: "pro", Interval: domain.IntervalMonthly,
				AmountCents: 9900, Currency: "usd",
			},
			wantBody: []string{
				"mode=subscription",
				"line_items[0][price_data][recurring][interval]=month",
				"subscription_data[metadata][order_id]=ord_1",
			},
			noWant: "subscription_data[trial_end]",
		},
		{
			name: "yearly → recurring year",
			order: domain.Order{
				ID: "ord_2", PlanCode: "pro", Interval: domain.IntervalYearly,
				AmountCents: 99000, Currency: "usd",
			},
			wantBody: []string{
				"mode=subscription",
				"line_items[0][price_data][recurring][interval]=year",
				"subscription_data[metadata][order_id]=ord_2",
			},
			noWant: "subscription_data[trial_end]",
		},
		{
			name: "monthly + 14 天试用期 → trial_end ≈ now+14d",
			order: domain.Order{
				ID: "ord_3", PlanCode: "pro", Interval: domain.IntervalMonthly,
				AmountCents: 9900, Currency: "usd", TrialDays: 14,
			},
			wantBody:   []string{"mode=subscription", "subscription_data[metadata][order_id]=ord_3"},
			checkTrial: true,
			trialDays:  14,
		},
		{
			name: "one_time → 维持 mode=payment，无 recurring/subscription_data",
			order: domain.Order{
				ID: "ord_4", PlanCode: "pro", Interval: domain.IntervalOneTime,
				AmountCents: 29900, Currency: "usd",
			},
			wantBody: []string{"mode=payment", "metadata[order_id]=ord_4"},
			noWant:   "price_data][recurring]",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var gotBody string
			backends := fakeStripe(t, func(w http.ResponseWriter, r *http.Request) {
				b, _ := io.ReadAll(r.Body)
				gotBody = string(b)
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"id":"cs_test_1","object":"checkout.session",` +
					`"url":"https://checkout.stripe.com/c/pay/cs_test_1","expires_at":1790000000}`))
			})
			ch := New("sk_test_key", testSigningKey)
			ch.setBackends(backends)

			_, err := ch.CreateCheckout(context.Background(), tt.order,
				"https://app.example.com/s", "https://app.example.com/c")
			require.NoError(t, err)
			for _, want := range tt.wantBody {
				assert.Contains(t, gotBody, want)
			}
			if tt.noWant != "" {
				assert.NotContains(t, gotBody, tt.noWant)
			}
			if tt.checkTrial {
				m := regexp.MustCompile(`subscription_data\[trial_end\]=(\d+)`).FindStringSubmatch(gotBody)
				require.NotNil(t, m, "请求体应含 subscription_data[trial_end]")
				exp, err := strconv.ParseInt(m[1], 10, 64)
				require.NoError(t, err)
				assert.InDelta(t, time.Now().Add(time.Duration(tt.trialDays)*24*time.Hour).Unix(), exp, 60)
			}
		})
	}
}

func TestCreateCheckoutAPIError(t *testing.T) {
	backends := fakeStripe(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":{"type":"api_error","message":"boom"}}`))
	})

	ch := New("sk_test_key", testSigningKey)
	ch.setBackends(backends)

	sess, err := ch.CreateCheckout(context.Background(), domain.Order{
		ID: "ord_1", PlanCode: "pro", Interval: domain.IntervalMonthly,
		AmountCents: 9900, Currency: "usd",
	}, "https://app.example.com/s", "https://app.example.com/c")
	require.Error(t, err)
	assert.Equal(t, domain.CheckoutSession{}, sess)
}

func TestChannelConfig_Mask(t *testing.T) {
	tests := []struct {
		name, key, wantMasked string
		wantConfigured        bool
	}{
		{"live key → 头8***尾4", "sk_live_abc123defghi9", "sk_live_***ghi9", true},
		{"test key → 同规则", "sk_test_0000111122", "sk_test_***1122", true},
		{"短密钥 → 只留 ***", "sk_abc", "***", true},
		{"空密钥 → 未配置（掩码空，由服务层渲染）", "", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := New(tt.key, "whsec_x")
			info := c.ChannelConfig()
			assert.Equal(t, tt.wantConfigured, info.Configured)
			assert.Equal(t, tt.wantMasked, info.KeyMasked)
			assert.True(t, info.WebhookConfigured)
		})
	}
}

func TestTestConnection(t *testing.T) {
	t.Run("密钥有效 → GET /v1/balance 且透传 Bearer key", func(t *testing.T) {
		var gotPath, gotAuth string
		backends := fakeStripe(t, func(w http.ResponseWriter, r *http.Request) {
			gotPath = r.URL.Path
			gotAuth = r.Header.Get("Authorization")
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"object":"balance","available":[]}`))
		})
		ch := New("sk_test_key", testSigningKey)
		ch.setBackends(backends)

		require.NoError(t, ch.TestConnection(context.Background()))
		assert.Equal(t, "/v1/balance", gotPath)
		assert.Equal(t, "Bearer sk_test_key", gotAuth)
	})

	t.Run("密钥无效 → Stripe 错误透传（带前缀）", func(t *testing.T) {
		backends := fakeStripe(t, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","message":"Invalid API Key provided"}}`))
		})
		ch := New("sk_bad", testSigningKey)
		ch.setBackends(backends)

		err := ch.TestConnection(context.Background())
		require.Error(t, err)
		assert.Contains(t, err.Error(), "stripe: test connection")
	})

	t.Run("未配置密钥 → 400 E_CHANNEL_NOT_CONFIGURED（不打网络）", func(t *testing.T) {
		ch := New("", testSigningKey)
		err := ch.TestConnection(context.Background())
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, http.StatusBadRequest, we.Status)
		assert.Equal(t, app.CodeChannelNotConfigured, we.Code)
		assert.Equal(t, "渠道未配置密钥", we.Message)
	})
}

func TestCancelSubscription(t *testing.T) {
	t.Run("DELETE /v1/subscriptions/{id}，默认不补发票不按比例退", func(t *testing.T) {
		var gotPath, gotMethod string
		backends := fakeStripe(t, func(w http.ResponseWriter, r *http.Request) {
			gotPath = r.URL.Path
			gotMethod = r.Method
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"sub_1","object":"subscription","status":"canceled"}`))
		})
		ch := New("sk_test_key", testSigningKey)
		ch.setBackends(backends)

		require.NoError(t, ch.CancelSubscription(context.Background(), "sub_1"))
		assert.Equal(t, "/v1/subscriptions/sub_1", gotPath)
		assert.Equal(t, http.MethodDelete, gotMethod)
	})

	t.Run("渠道侧失败 → 错误透传", func(t *testing.T) {
		backends := fakeStripe(t, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","message":"No such subscription: sub_x"}}`))
		})
		ch := New("sk_test_key", testSigningKey)
		ch.setBackends(backends)

		err := ch.CancelSubscription(context.Background(), "sub_x")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "stripe: cancel subscription")
	})

	t.Run("未配置密钥 → 400 E_CHANNEL_NOT_CONFIGURED", func(t *testing.T) {
		ch := New("", testSigningKey)
		err := ch.CancelSubscription(context.Background(), "sub_1")
		var we *webx.Error
		require.ErrorAs(t, err, &we)
		assert.Equal(t, app.CodeChannelNotConfigured, we.Code)
	})
}
