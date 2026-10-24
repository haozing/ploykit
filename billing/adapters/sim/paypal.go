package sim

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/haozing/ploykit/billing/app"
	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/billing/money"
)

// Paypal 是 simpaypal 渠道：镜像 billing/adapters/paypal 的事件信封与五律映射。
//
// 信封（与真 PayPal 同形）：{id(WH-xxx,事件级唯一), event_type, resource_type,
// resource{id, status, custom_id, billing_agreement_id, amount{currency,total},
// sale_id, total_refunded_amount{...}}}。订阅标识：custom_id = 本地订单号
// （建订阅时塞入,BILLING.SUBSCRIPTION.* 原样回带）；billing_agreement_id =
// 订阅 id（PAYMENT.SALE.* 的汇合点）。
//
// 事件映射（与真 paypal 一致）：
//
//	BILLING.SUBSCRIPTION.ACTIVATED → checkout.completed（订阅对象不带金额
//	  → AmountCents=0,amountMismatch 对 0 走忽略路径,首期金额对账交给
//	  同拍的 SALE 事件）
//	PAYMENT.SALE.COMPLETED → subscription.renewed（OrderID=custom_id,
//	  SubscriptionRef=billing_agreement_id,金额=resource.amount,
//	  PaymentIntentRef=sale id 供退款反查）
//	BILLING.SUBSCRIPTION.CANCELLED → subscription.canceled
//	PAYMENT.SALE.REFUNDED → refund.created（金额=amount,缺失退化
//	  total_refunded_amount;订单反查优先 billing_agreement_id,不在载荷时
//	  退化 sale_id(FindOrderByPaymentIntent)+resource.id）
//	其余 → ignored
//
// 验签差异见包注释：真 paypal 调 verify-webhook-signature API,sim 用
// X-Sim-Signature HMAC——验签语义（对 raw body、失败拒收）一致。
type Paypal struct {
	*core
}

// NewPaypal 构造 simpaypal 渠道。
func NewPaypal(cfg coreConfig) *Paypal { return &Paypal{core: newCore(NamePaypal, cfg)} }

func (c *Paypal) Name() string { return NamePaypal }

func (c *Paypal) Capabilities() app.ChannelCaps {
	// 951 > manual(900)：排在一切真渠道与 manual 之后,不挤占推荐位。
	return app.ChannelCaps{CatalogBased: false, SupportsCancelURL: true, DisplayOrder: 951}
}

func (c *Paypal) ChannelConfig() app.ChannelConfigInfo { return c.core.channelConfig() }

func (c *Paypal) ConfigSchema() []app.FieldSpec { return c.core.configSchema(EnvPaypalSecret) }

func (c *Paypal) EnvProvidedKeys() []string { return c.core.envProvidedKeys(EnvPaypalSecret) }

// CreateCheckout 返回本地 approve URL、SUB-SIM-* 会话引用（= 真渠道的
// 订阅 id SUB-xxx,也是 SALE 事件的 billing_agreement_id）、可配置 ExpiresAt
// （默认 1h）。
func (c *Paypal) CreateCheckout(_ context.Context, req app.CheckoutRequest) (domain.CheckoutSession, error) {
	order := req.Order
	ref := c.nextID("SUB-SIM-")
	return domain.CheckoutSession{
		OrderID:    order.ID,
		Channel:    c.Name(),
		ActionURL:  c.approveURL(order.ID),
		SessionRef: ref,
		ExpiresAt:  time.Now().UTC().Add(c.ttl),
	}, nil
}

// paypalEnvelope / paypalResource / flexMoney：真 PayPal webhook 载荷的镜像。
type paypalEnvelope struct {
	ID           string          `json:"id"`
	EventType    string          `json:"event_type"`
	ResourceType string          `json:"resource_type"`
	Resource     json.RawMessage `json:"resource"`
}

type paypalResource struct {
	ID                 string     `json:"id"`
	Status             string     `json:"status"`
	CustomID           string     `json:"custom_id"`
	BillingAgreementID string     `json:"billing_agreement_id"`
	Amount             *flexMoney `json:"amount"`
	SaleID             string     `json:"sale_id"`
	TotalRefundedAmt   *flexMoney `json:"total_refunded_amount"`
}

// flexMoney 兼容 v1 {currency,total} / v2 {currency_code,value} 两代金额形态。
type flexMoney struct {
	CurrencyCode string `json:"currency_code,omitempty"`
	Currency     string `json:"currency,omitempty"`
	Value        string `json:"value,omitempty"`
	Total        string `json:"total,omitempty"`
}

func (m *flexMoney) amount() string {
	if m == nil {
		return ""
	}
	if m.Value != "" {
		return m.Value
	}
	return m.Total
}

func (m *flexMoney) currency() string {
	if m == nil {
		return ""
	}
	if m.CurrencyCode != "" {
		return m.CurrencyCode
	}
	return m.Currency
}

// resourceTypeOf 给资源对象标上真 PayPal 载荷的 resource_type。
func resourceTypeOf(eventType string) string {
	switch {
	case eventType == "BILLING.SUBSCRIPTION.ACTIVATED", eventType == "BILLING.SUBSCRIPTION.CANCELLED":
		return "subscription"
	case eventType == "PAYMENT.SALE.COMPLETED":
		return "sale"
	case eventType == "PAYMENT.SALE.REFUNDED":
		return "refund"
	}
	return "unknown"
}

// ParseWebhook：验签 → 解码 → 五律映射。ChannelEventID = event_type + ":" + id
// （五律 4:PayPal 资源 id 在同一对象的不同事件间复用,不拼类型会吞事件）。
func (c *Paypal) ParseWebhook(_ context.Context, req app.WebhookRequest) (domain.PaymentEvent, error) {
	if err := verifySignature(c.secret, req.Header, req.Body); err != nil {
		return domain.PaymentEvent{}, err
	}
	var env paypalEnvelope
	if err := json.Unmarshal(req.Body, &env); err != nil {
		return domain.PaymentEvent{}, fmt.Errorf("simpaypal: decode webhook payload: %w", err)
	}
	var res paypalResource
	if len(env.Resource) > 0 {
		if err := json.Unmarshal(env.Resource, &res); err != nil {
			return domain.PaymentEvent{}, fmt.Errorf("simpaypal: decode webhook resource: %w", err)
		}
	}

	ev := domain.PaymentEvent{
		Channel:        c.Name(),
		ChannelEventID: env.EventType + ":" + env.ID, // 五律 4:拼类型
		Payload:        map[string]any{"mode": "test"},
	}
	switch env.EventType {
	case "BILLING.SUBSCRIPTION.ACTIVATED":
		// 首付款到账:发权益+落订阅引用;订阅对象不携带金额 → AmountCents=0,
		// 首期金额对账交给常与 ACTIVATED 同拍的 SALE 事件。
		ev.Type = domain.EventCheckoutCompleted
		ev.OrderID = res.CustomID
		ev.SubscriptionRef = res.ID
		ev.ChannelRef = res.ID
	case "PAYMENT.SALE.COMPLETED":
		ev.Type = domain.EventSubscriptionRenewed
		ev.OrderID = res.CustomID
		ev.SubscriptionRef = res.BillingAgreementID
		ev.ChannelRef = res.BillingAgreementID
		ev.AmountCents = money.ParseAmountForCurrency(res.Amount.amount(), res.Amount.currency())
		ev.Currency = res.Amount.currency()
		ev.PaymentIntentRef = res.ID // sale id:退款反查锚
	case "BILLING.SUBSCRIPTION.CANCELLED":
		ev.Type = domain.EventSubscriptionCanceled
		ev.OrderID = res.CustomID
		ev.SubscriptionRef = res.ID
		ev.ChannelRef = res.ID
	case "PAYMENT.SALE.REFUNDED":
		// 金额取本次退款额(resource.amount);缺失退化累计额。订单反查:
		// 优先 billing_agreement_id;不在载荷时退化 sale_id+resource.id——
		// 「不带 agreementId 只带 sale id」的退款靠 PAYMENT.SALE.COMPLETED
		// 落的 payment_intent 锚反查（billing 内核修复 #3 的验收形态）。
		ev.Type = domain.EventRefundCreated
		amount, cur := res.Amount.amount(), res.Amount.currency()
		if amount == "" {
			amount, cur = res.TotalRefundedAmt.amount(), res.TotalRefundedAmt.currency()
		}
		ev.AmountCents = money.ParseAmountForCurrency(amount, cur)
		ev.Currency = firstNonEmpty(res.Amount.currency(), res.TotalRefundedAmt.currency())
		if res.BillingAgreementID != "" {
			ev.ChannelRef = res.BillingAgreementID
			ev.SubscriptionRef = res.BillingAgreementID
		} else {
			ev.ChannelRef = res.ID
		}
		if res.SaleID != "" {
			ev.PaymentIntentRef = res.SaleID
		}
	default:
		ev.Type = "ignored" // SUSPENDED/EXPIRED/PAYMENT.FAILED/DISPUTE.*/…
	}
	return ev, nil
}

// buildPaypalEvent 由 Harness 的 eventInput 构造签名前信封（包内共用）。
// dropAgreementID / dropCustomID 复刻「个别载荷缺失」形态；totalRefundedShape
// 切换退款金额的两种真实形态（本次退款额 amount vs 累计退款额
// total_refunded_amount——真 PayPal 载荷两种都存在）。
func buildPaypalEvent(in eventInput) []byte {
	res := paypalResource{
		ID:       in.paypalResourceID(),
		CustomID: in.customID(),
	}
	switch in.eventType {
	case "BILLING.SUBSCRIPTION.ACTIVATED":
		res.Status = "ACTIVE"
	case "BILLING.SUBSCRIPTION.CANCELLED":
		res.Status = "CANCELLED"
	case "PAYMENT.SALE.COMPLETED":
		res.BillingAgreementID = in.agreementID()
		res.Amount = &flexMoney{Currency: in.currency, Total: in.amount}
	case "PAYMENT.SALE.REFUNDED":
		if !in.dropAgreementID {
			res.BillingAgreementID = in.agreementID()
		}
		res.SaleID = in.saleID
		if in.totalRefundedShape {
			res.TotalRefundedAmt = &flexMoney{Currency: in.currency, Total: in.amount}
		} else {
			res.Amount = &flexMoney{Currency: in.currency, Total: in.amount}
		}
	}
	env := paypalEnvelope{
		ID:           in.eventID, // WH-xxx,事件级唯一
		EventType:    in.eventType,
		ResourceType: resourceTypeOf(in.eventType),
	}
	env.Resource, _ = json.Marshal(res)
	body, _ := json.Marshal(env)
	return body
}

var (
	_ app.PaymentChannel          = (*Paypal)(nil)
	_ app.ChannelCapabilityViewer = (*Paypal)(nil)
	_ app.ChannelConfigViewer     = (*Paypal)(nil)
	_ app.ChannelSchemaViewer     = (*Paypal)(nil)
	_ app.ChannelEnvViewer        = (*Paypal)(nil)
	_ Signer                      = (*Paypal)(nil)
)
