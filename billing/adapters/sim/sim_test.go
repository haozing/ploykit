package sim

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/billing/app"
	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/platform/webx"
)

// hermeticWebhook 用手写的信封 JSON(不走 builder)驱动 ParseWebhook——
// 信封字段名/形状由此独立验证,防止 builder 与 parser 共享同一盲区。
func hermeticWebhook(t *testing.T, ch app.PaymentChannel, payload string) domain.PaymentEvent {
	t.Helper()
	body := []byte(payload)
	header := map[string][]string{SignatureHeader: {SignBody(ch.(Signer).SigningSecret(), body)}}
	ev, err := ch.ParseWebhook(context.Background(), app.WebhookRequest{Header: header, Body: body})
	require.NoError(t, err)
	return ev
}

func TestSimWaffo_MappingSemantics(t *testing.T) {
	ch := NewWaffo(coreConfig{})

	t.Run("activated → completed 带金额+订阅引用,幂等键拼类型", func(t *testing.T) {
		ev := hermeticWebhook(t, ch, `{"id":"ORD-x","eventId":"E-1","eventType":"subscription.activated","mode":"test","timestamp":"2026-10-24T00:00:00Z","data":{"orderId":"ORD-x","chargedAmount":"19.00","currency":"USD","periodNumber":1,"orderMetadata":{"order_id":"11111111-1111-1111-1111-111111111111"}}}`)
		assert.Equal(t, domain.EventCheckoutCompleted, ev.Type)
		assert.Equal(t, "11111111-1111-1111-1111-111111111111", ev.OrderID)
		assert.Equal(t, "ORD-x", ev.ChannelRef)
		assert.Equal(t, "ORD-x", ev.SubscriptionRef)
		assert.Equal(t, 1900, ev.AmountCents)
		assert.Equal(t, "subscription.activated:E-1", ev.ChannelEventID)
	})

	t.Run("payment_succeeded 期 1 → ignored;期 2 → renewed", func(t *testing.T) {
		p1 := hermeticWebhook(t, ch, `{"id":"ORD-x","eventId":"E-p1","eventType":"subscription.payment_succeeded","data":{"orderId":"ORD-x","chargedAmount":"19.00","currency":"USD","periodNumber":1,"orderMetadata":{"order_id":"o1"}}}`)
		assert.Equal(t, "ignored", p1.Type)
		p2 := hermeticWebhook(t, ch, `{"id":"ORD-x","eventId":"E-p2","eventType":"subscription.payment_succeeded","data":{"orderId":"ORD-x","chargedAmount":"19.00","currency":"USD","periodNumber":2,"orderMetadata":{"order_id":"o1"}}}`)
		assert.Equal(t, domain.EventSubscriptionRenewed, p2.Type)
		assert.Equal(t, "ORD-x", p2.SubscriptionRef)
		assert.Equal(t, 1900, p2.AmountCents)
	})

	t.Run("同 id 不同 eventId → 不同幂等键(期级续费不被当重复)", func(t *testing.T) {
		a := hermeticWebhook(t, ch, `{"id":"ORD-x","eventId":"E-2","eventType":"subscription.payment_succeeded","data":{"orderId":"ORD-x","periodNumber":2,"orderMetadata":{"order_id":"o1"}}}`)
		b := hermeticWebhook(t, ch, `{"id":"ORD-x","eventId":"E-3","eventType":"subscription.payment_succeeded","data":{"orderId":"ORD-x","periodNumber":3,"orderMetadata":{"order_id":"o1"}}}`)
		assert.NotEqual(t, a.ChannelEventID, b.ChannelEventID)
		assert.Equal(t, "subscription.payment_succeeded:ORD-x", func() string {
			// eventId 缺失回退顶层 id(旧载荷兼容)
			ev := hermeticWebhook(t, ch, `{"id":"ORD-x","eventType":"subscription.payment_succeeded","data":{"orderId":"ORD-x","periodNumber":2,"orderMetadata":{"order_id":"o1"}}}`)
			return ev.ChannelEventID
		}())
	})

	t.Run("canceled / refund.succeeded(订阅退款带订阅引用)", func(t *testing.T) {
		c := hermeticWebhook(t, ch, `{"id":"ORD-x","eventId":"E-c","eventType":"subscription.canceled","data":{"orderId":"ORD-x"}}`)
		assert.Equal(t, domain.EventSubscriptionCanceled, c.Type)
		r := hermeticWebhook(t, ch, `{"id":"ORD-x","eventId":"E-r","eventType":"refund.succeeded","data":{"orderId":"ORD-x","refundedAmount":"19.00","currency":"USD","periodNumber":2}}`)
		assert.Equal(t, domain.EventRefundCreated, r.Type)
		assert.Equal(t, 1900, r.AmountCents)
		assert.Equal(t, "ORD-x", r.SubscriptionRef, "periodNumber>0 = 订阅退款,撤权并清订阅引用")
	})

	t.Run("JPY 回显两形态解析", func(t *testing.T) {
		ev := hermeticWebhook(t, ch, `{"id":"ORD-x","eventId":"E-j","eventType":"subscription.activated","data":{"orderId":"ORD-x","chargedAmount":"4500.00","currency":"JPY","orderMetadata":{"order_id":"o1"}}}`)
		assert.Equal(t, 4500, ev.AmountCents, "JPY '4500.00' 剥全零小数位 → 4500(不是 450000)")
		ev2 := hermeticWebhook(t, ch, `{"id":"ORD-x","eventId":"E-j2","eventType":"subscription.activated","data":{"orderId":"ORD-x","chargedAmount":"4,500","currency":"JPY","orderMetadata":{"order_id":"o1"}}}`)
		assert.Equal(t, 0, ev2.AmountCents, "畸形 '4,500' → 0 = 不可对账,不拦事件")
	})
}

func TestSimPaypal_MappingSemantics(t *testing.T) {
	ch := NewPaypal(coreConfig{})

	t.Run("ACTIVATED 无金额 → completed,custom_id 反查,订阅引用落 SUB", func(t *testing.T) {
		ev := hermeticWebhook(t, ch, `{"id":"WH-1","event_type":"BILLING.SUBSCRIPTION.ACTIVATED","resource_type":"subscription","resource":{"id":"SUB-1","status":"ACTIVE","custom_id":"22222222-2222-2222-2222-222222222222"}}`)
		assert.Equal(t, domain.EventCheckoutCompleted, ev.Type)
		assert.Equal(t, "22222222-2222-2222-2222-222222222222", ev.OrderID)
		assert.Equal(t, "SUB-1", ev.SubscriptionRef)
		assert.Equal(t, 0, ev.AmountCents, "订阅对象不带金额,首期对账交给同拍 SALE")
		assert.Equal(t, "BILLING.SUBSCRIPTION.ACTIVATED:WH-1", ev.ChannelEventID)
	})

	t.Run("SALE.COMPLETED → renewed,sale id 落 PI 锚,金额双形态", func(t *testing.T) {
		ev := hermeticWebhook(t, ch, `{"id":"WH-2","event_type":"PAYMENT.SALE.COMPLETED","resource_type":"sale","resource":{"id":"S1","billing_agreement_id":"SUB-1","custom_id":"o1","amount":{"currency":"USD","total":"9.90"}}}`)
		assert.Equal(t, domain.EventSubscriptionRenewed, ev.Type)
		assert.Equal(t, "SUB-1", ev.SubscriptionRef)
		assert.Equal(t, "S1", ev.PaymentIntentRef)
		assert.Equal(t, 990, ev.AmountCents)
		v2 := hermeticWebhook(t, ch, `{"id":"WH-2b","event_type":"PAYMENT.SALE.COMPLETED","resource_type":"sale","resource":{"id":"S2","billing_agreement_id":"SUB-1","amount":{"currency_code":"JPY","value":"4500.00"}}}`)
		assert.Equal(t, 4500, v2.AmountCents, "v2 {currency_code,value} 形态 + JPY 剥零小数")
	})

	t.Run("REFUNDED 带 agreement → 撤订阅;不带 agreement(只带 sale id)→ PI 反查锚", func(t *testing.T) {
		withAg := hermeticWebhook(t, ch, `{"id":"WH-3","event_type":"PAYMENT.SALE.REFUNDED","resource_type":"refund","resource":{"id":"RE-1","billing_agreement_id":"SUB-1","sale_id":"S1","amount":{"currency":"USD","total":"9.90"}}}`)
		assert.Equal(t, domain.EventRefundCreated, withAg.Type)
		assert.Equal(t, "SUB-1", withAg.ChannelRef)
		assert.Equal(t, "SUB-1", withAg.SubscriptionRef)
		assert.Equal(t, "S1", withAg.PaymentIntentRef)

		noAg := hermeticWebhook(t, ch, `{"id":"WH-4","event_type":"PAYMENT.SALE.REFUNDED","resource_type":"refund","resource":{"id":"RE-2","sale_id":"S1","total_refunded_amount":{"currency":"USD","total":"9.90"}}}`)
		assert.Equal(t, domain.EventRefundCreated, noAg.Type)
		assert.Empty(t, noAg.SubscriptionRef)
		assert.Equal(t, "RE-2", noAg.ChannelRef)
		assert.Equal(t, "S1", noAg.PaymentIntentRef, "不带 agreementId 的退款靠 SALE 落的 PI 锚反查")
		assert.Equal(t, 990, noAg.AmountCents, "amount 缺失退化 total_refunded_amount")
	})

	t.Run("CANCELLED → canceled;其余 ignored", func(t *testing.T) {
		ev := hermeticWebhook(t, ch, `{"id":"WH-5","event_type":"BILLING.SUBSCRIPTION.CANCELLED","resource_type":"subscription","resource":{"id":"SUB-1","status":"CANCELLED"}}`)
		assert.Equal(t, domain.EventSubscriptionCanceled, ev.Type)
		other := hermeticWebhook(t, ch, `{"id":"WH-6","event_type":"BILLING.SUBSCRIPTION.SUSPENDED","resource_type":"subscription","resource":{"id":"SUB-1"}}`)
		assert.Equal(t, "ignored", other.Type)
	})
}

func TestSimStripe_MappingSemantics(t *testing.T) {
	ch := NewStripe(coreConfig{})

	t.Run("checkout.session.completed → completed(金额/metadata/PI/订阅)", func(t *testing.T) {
		ev := hermeticWebhook(t, ch, `{"id":"evt_1","type":"checkout.session.completed","data":{"object":{"id":"cs_1","object":"checkout.session","payment_status":"paid","amount_total":1900,"currency":"usd","metadata":{"order_id":"33333333-3333-3333-3333-333333333333"},"payment_intent":"pi_1","subscription":"sub_1"}}}`)
		assert.Equal(t, domain.EventCheckoutCompleted, ev.Type)
		assert.Equal(t, "33333333-3333-3333-3333-333333333333", ev.OrderID)
		assert.Equal(t, "cs_1", ev.ChannelRef)
		assert.Equal(t, 1900, ev.AmountCents)
		assert.Equal(t, "pi_1", ev.PaymentIntentRef)
		assert.Equal(t, "sub_1", ev.SubscriptionRef)
		assert.Equal(t, "evt_1", ev.ChannelEventID)
	})

	t.Run("payment_status 非 paid → ignored(异步中间态)", func(t *testing.T) {
		ev := hermeticWebhook(t, ch, `{"id":"evt_2","type":"checkout.session.completed","data":{"object":{"id":"cs_2","payment_status":"unpaid","amount_total":1900,"currency":"usd","metadata":{"order_id":"o1"}}}}`)
		assert.Equal(t, "ignored", ev.Type)
	})

	t.Run("invoice.paid → renewed(lines metadata 回带 order_id)", func(t *testing.T) {
		ev := hermeticWebhook(t, ch, `{"id":"evt_3","type":"invoice.paid","data":{"object":{"id":"in_1","object":"invoice","subscription":"sub_1","amount_paid":1900,"currency":"usd","lines":{"data":[{"metadata":{"order_id":"o1"}}]}}}}`)
		assert.Equal(t, domain.EventSubscriptionRenewed, ev.Type)
		assert.Equal(t, "sub_1", ev.SubscriptionRef)
		assert.Equal(t, 1900, ev.AmountCents)
		assert.Equal(t, "o1", ev.OrderID)
	})

	t.Run("charge.refunded → refund.created(PI 锚)", func(t *testing.T) {
		ev := hermeticWebhook(t, ch, `{"id":"evt_4","type":"charge.refunded","data":{"object":{"id":"ch_1","object":"charge","payment_intent":"pi_1","currency":"usd","amount_refunded":1900}}}`)
		assert.Equal(t, domain.EventRefundCreated, ev.Type)
		assert.Equal(t, "pi_1", ev.ChannelRef)
		assert.Equal(t, 1900, ev.AmountCents)
	})

	t.Run("customer.subscription.deleted → canceled", func(t *testing.T) {
		ev := hermeticWebhook(t, ch, `{"id":"evt_5","type":"customer.subscription.deleted","data":{"object":{"id":"sub_1","object":"subscription","status":"canceled"}}}`)
		assert.Equal(t, domain.EventSubscriptionCanceled, ev.Type)
		assert.Equal(t, "sub_1", ev.SubscriptionRef)
	})
}

func TestSignatureVerification(t *testing.T) {
	waffo := NewWaffo(coreConfig{})
	paypal := NewPaypal(coreConfig{Secret: "another-secret"})
	body := []byte(`{"id":"ORD-x","eventType":"subscription.canceled","data":{"orderId":"ORD-x"}}`)
	call := func(ch app.PaymentChannel, header map[string][]string, b []byte) error {
		_, err := ch.ParseWebhook(context.Background(), app.WebhookRequest{Header: header, Body: b})
		return err
	}

	t.Run("缺头拒收", func(t *testing.T) {
		require.Error(t, call(waffo, map[string][]string{}, body))
	})
	t.Run("对 raw body 验签:一字节之差即拒收", func(t *testing.T) {
		sig := SignBody(waffo.SigningSecret(), body)
		tampered := []byte(strings.Replace(string(body), "ORD-x", "ORD-y", 1))
		require.Error(t, call(waffo, map[string][]string{SignatureHeader: {sig}}, tampered))
	})
	t.Run("密钥隔离:waffo 的签名在 paypal 验签下必败", func(t *testing.T) {
		sig := SignBody(waffo.SigningSecret(), body)
		require.Error(t, call(paypal, map[string][]string{SignatureHeader: {sig}}, body))
	})
	t.Run("正确签名通过", func(t *testing.T) {
		sig := SignBody(waffo.SigningSecret(), body)
		require.NoError(t, call(waffo, map[string][]string{SignatureHeader: {sig}}, body))
	})
	t.Run("JSON 重编码后的 body 不再匹配原签名(raw body 纪律)", func(t *testing.T) {
		var m map[string]any
		require.NoError(t, json.Unmarshal(body, &m))
		reencoded, _ := json.Marshal(m)
		sig := SignBody(waffo.SigningSecret(), body)
		require.Error(t, call(waffo, map[string][]string{SignatureHeader: {sig}}, reencoded),
			"键序/空白差异都会改变字节——签名只对投递方拿到的原始字节有效")
	})
}

func TestFactories_SecretResolution(t *testing.T) {
	t.Run("fields > env > 内置缺省", func(t *testing.T) {
		getenv := func(k string) string {
			if k == EnvPaypalSecret {
				return "from-env"
			}
			return ""
		}
		factories := Factories(getenv)
		fromFields, err := factories[NameWaffo](map[string]string{"secret": "from-db"})
		require.NoError(t, err)
		assert.Equal(t, "from-db", fromFields.(Signer).SigningSecret())
		fromEnv, err := factories[NamePaypal](nil)
		require.NoError(t, err)
		assert.Equal(t, "from-env", fromEnv.(Signer).SigningSecret())
		fallback, err := factories[NameStripe](map[string]string{})
		require.NoError(t, err)
		assert.Equal(t, DefaultSecret(NameStripe), fallback.(Signer).SigningSecret())
	})
	t.Run("毒行(fields 为空)不炸:回到缺省密钥照常注册", func(t *testing.T) {
		factories := Factories(func(string) string { return "" })
		for _, name := range []string{NameWaffo, NamePaypal, NameStripe} {
			ch, err := factories[name](map[string]string{})
			require.NoError(t, err, name)
			require.NotNil(t, ch, name)
		}
	})
	t.Run("DisplayOrder 排在真渠道与 manual 之后", func(t *testing.T) {
		reg := app.NewChannelRegistry()
		for _, ch := range []app.PaymentChannel{NewWaffo(coreConfig{}), NewPaypal(coreConfig{}), NewStripe(coreConfig{})} {
			reg.Register(ch)
		}
		names := reg.OrderedNames()
		assert.Equal(t, []string{NameWaffo, NamePaypal, NameStripe}, names)
		for _, n := range names {
			ch, _ := reg.Get(n)
			assert.Greater(t, ch.(app.ChannelCapabilityViewer).Capabilities().DisplayOrder, 900,
				"sim 渠道必须排在 manual(900) 之后,不挤占真渠道推荐位")
		}
	})
}

// ---- 场景 9（__SET__ 回传短路）:app 层语义已有 billing/app/service_fix_test.go
// 覆盖,此处走 sim 渠道自己的 ConfigSchema(secret 字段)在同一条真实
// UpdateChannelFields 管线下的行为——hermetic(内存 settings 桩,无 DB)。----

type fakeChannelSettings struct{ saved map[string]string }

func newFakeChannelSettings() *fakeChannelSettings {
	return &fakeChannelSettings{saved: map[string]string{}}
}

func (f *fakeChannelSettings) Set(_ context.Context, k, v, _ string) error {
	f.saved[k] = v
	return nil
}

func (f *fakeChannelSettings) SetMany(_ context.Context, kv map[string]string, _ string) error {
	for k, v := range kv {
		f.saved[k] = v
	}
	return nil
}

func (f *fakeChannelSettings) BillingChannelFields(context.Context) (map[string]map[string]string, error) {
	out := map[string]map[string]string{}
	for k, v := range f.saved {
		name, field, ok := strings.Cut(strings.TrimPrefix(k, "billing_channel."), ".")
		if !ok || name == "" || field == "" {
			continue
		}
		if out[name] == nil {
			out[name] = map[string]string{}
		}
		out[name][field] = v
	}
	return out, nil
}

func TestScenario9_SetMarkerKeepsStoredSecret_Hermetic(t *testing.T) {
	store := newFakeChannelSettings()
	store.saved["billing_channel."+NameWaffo+".secret"] = "real-secret"
	reg := app.NewChannelRegistry()
	reg.Register(NewWaffo(coreConfig{}))
	svc := app.NewBillingService(nil, reg, app.Config{}, app.BillingHooks{}, nil, nil, nil)
	admin := app.NewBillingAdminService(svc, nil, nil, nil).WithChannelSettings(store)

	// GET 原样回 PUT 的典型回显:后台把掩码 __SET__ 原样提交。
	card, err := admin.UpdateChannelFields(context.Background(), &webx.Principal{UserID: "u1"}, NameWaffo,
		map[string]string{"secret": "__SET__"})
	require.NoError(t, err)
	assert.Equal(t, "real-secret", store.saved["billing_channel."+NameWaffo+".secret"],
		"__SET__ 必须与空串同义=保持,哨兵绝不能被存成真密钥")
	assert.Equal(t, "__SET__", card.Values["secret"], "读回仍是掩码")
}

// simhttp 的 DEV-ONLY 兜底与端点行为见 simhttp 包自己的 hermetic 测试
// (simhttp/http_test.go——本包测试 import simhttp 会成环,simhttp 导入本包)。
