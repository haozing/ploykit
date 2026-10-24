package sim

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/haozing/ploykit/billing/app"
	"github.com/haozing/ploykit/billing/domain"
)

// Stripe 是 simstripe 渠道：镜像 billing/adapters/stripe 的事件信封与五律映射。
//
// 信封（与真 Stripe 同形）：{id(evt_xxx), type, data{object{...}}}，object 随
// 事件族异构：checkout.session / invoice / charge / subscription。订单反查靠
// checkout 会话 metadata.order_id（本地订单 UUID），invoice 续期靠
// lines.data[0].metadata.order_id 回带。
//
// 事件映射（与真 stripe 一致）：
//
//	checkout.session.completed → checkout.completed（amount_total,
//	  metadata.order_id,payment_intent,subscription;payment_status 非
//	  paid/no_payment_required → ignored）
//	invoice.paid               → subscription.renewed（amount_paid,
//	  subscription 引用,lines 的 order_id）
//	charge.refunded            → refund.created（payment_intent 反查锚,
//	  amount_refunded）
//	customer.subscription.deleted → subscription.canceled（subscription id）
//	其余                        → ignored
//
// 幂等键：ChannelEventID = evt.id（真 stripe 事件 id 本身全局唯一，不拼类型）。
type Stripe struct {
	*core
}

// NewStripe 构造 simstripe 渠道。
func NewStripe(cfg coreConfig) *Stripe { return &Stripe{core: newCore(NameStripe, cfg)} }

func (c *Stripe) Name() string { return NameStripe }

func (c *Stripe) Capabilities() app.ChannelCaps {
	// 952 > manual(900)：排在一切真渠道之后,不挤占推荐位。
	return app.ChannelCaps{CatalogBased: false, SupportsCancelURL: true, DisplayOrder: 952}
}

func (c *Stripe) ChannelConfig() app.ChannelConfigInfo { return c.core.channelConfig() }

func (c *Stripe) ConfigSchema() []app.FieldSpec { return c.core.configSchema(EnvStripeSecret) }

func (c *Stripe) EnvProvidedKeys() []string { return c.core.envProvidedKeys(EnvStripeSecret) }

// CreateCheckout 返回本地 approve URL、cs_sim_* 会话引用、可配置 ExpiresAt
// （默认 1h）。订阅引用按会话确定性派生（sub_sim_* 同序号）——真 stripe 的
// subscription 由会话创建,sim 用同源序号保持「会话→订阅」可对应。
func (c *Stripe) CreateCheckout(_ context.Context, req app.CheckoutRequest) (domain.CheckoutSession, error) {
	order := req.Order
	ref := c.nextID("cs_sim_")
	return domain.CheckoutSession{
		OrderID:    order.ID,
		Channel:    c.Name(),
		ActionURL:  c.approveURL(order.ID),
		SessionRef: ref,
		ExpiresAt:  time.Now().UTC().Add(c.ttl),
	}, nil
}

// stripeEnvelope：真 Stripe webhook 顶层信封。
type stripeEnvelope struct {
	ID   string `json:"id"`
	Type string `json:"type"`
	Data struct {
		Object json.RawMessage `json:"object"`
	} `json:"data"`
}

// 各事件族的 object 形态（镜像 stripe-go 类型里映射用到的字段）。
type stripeSessionObject struct {
	ID            string            `json:"id"`
	Object        string            `json:"object"`
	PaymentStatus string            `json:"payment_status"`
	AmountTotal   int64             `json:"amount_total"`
	Currency      string            `json:"currency"`
	Metadata      map[string]string `json:"metadata"`
	PaymentIntent string            `json:"payment_intent"`
	Subscription  string            `json:"subscription"`
}

type stripeInvoiceObject struct {
	ID           string `json:"id"`
	Object       string `json:"object"`
	Subscription string `json:"subscription"`
	AmountPaid   int64  `json:"amount_paid"`
	Currency     string `json:"currency"`
	Lines        struct {
		Data []struct {
			Metadata map[string]string `json:"metadata"`
		} `json:"data"`
	} `json:"lines"`
}

type stripeChargeObject struct {
	ID             string `json:"id"`
	Object         string `json:"object"`
	PaymentIntent  string `json:"payment_intent"`
	Currency       string `json:"currency"`
	AmountRefunded int64  `json:"amount_refunded"`
}

type stripeSubscriptionObject struct {
	ID     string `json:"id"`
	Object string `json:"object"`
	Status string `json:"status"`
}

// ParseWebhook：验签 → 解码 → 五律映射。
func (c *Stripe) ParseWebhook(_ context.Context, req app.WebhookRequest) (domain.PaymentEvent, error) {
	if err := verifySignature(c.secret, req.Header, req.Body); err != nil {
		return domain.PaymentEvent{}, err
	}
	var env stripeEnvelope
	if err := json.Unmarshal(req.Body, &env); err != nil {
		return domain.PaymentEvent{}, fmt.Errorf("simstripe: decode webhook payload: %w", err)
	}
	if len(env.Data.Object) == 0 {
		return domain.PaymentEvent{}, fmt.Errorf("simstripe: webhook event missing data.object")
	}

	ev := domain.PaymentEvent{
		Channel:        c.Name(),
		ChannelEventID: env.ID, // 真 stripe 事件 id 全局唯一
	}
	var rawObj map[string]any
	_ = json.Unmarshal(env.Data.Object, &rawObj)
	ev.Payload = map[string]any{"type": env.Type, "object": rawObj}

	switch env.Type {
	case "checkout.session.completed", "checkout.session.async_payment_succeeded":
		var obj stripeSessionObject
		if err := json.Unmarshal(env.Data.Object, &obj); err != nil {
			return domain.PaymentEvent{}, fmt.Errorf("simstripe: decode checkout session: %w", err)
		}
		if obj.PaymentStatus != "" && obj.PaymentStatus != "paid" && obj.PaymentStatus != "no_payment_required" {
			ev.Type = "ignored" // unpaid/processing 等中间态
			return ev, nil
		}
		ev.Type = domain.EventCheckoutCompleted
		ev.OrderID = obj.Metadata["order_id"]
		ev.ChannelRef = obj.ID
		ev.AmountCents = int(obj.AmountTotal)
		ev.Currency = obj.Currency
		ev.PaymentIntentRef = obj.PaymentIntent
		ev.SubscriptionRef = obj.Subscription
	case "invoice.paid":
		var obj stripeInvoiceObject
		if err := json.Unmarshal(env.Data.Object, &obj); err != nil {
			return domain.PaymentEvent{}, fmt.Errorf("simstripe: decode invoice: %w", err)
		}
		ev.Type = domain.EventSubscriptionRenewed
		ev.SubscriptionRef = obj.Subscription
		ev.AmountCents = int(obj.AmountPaid)
		ev.Currency = obj.Currency
		if len(obj.Lines.Data) > 0 {
			ev.OrderID = obj.Lines.Data[0].Metadata["order_id"]
		}
	case "charge.refunded":
		var obj stripeChargeObject
		if err := json.Unmarshal(env.Data.Object, &obj); err != nil {
			return domain.PaymentEvent{}, fmt.Errorf("simstripe: decode charge: %w", err)
		}
		ev.Type = domain.EventRefundCreated
		ev.ChannelRef = obj.PaymentIntent
		ev.PaymentIntentRef = obj.PaymentIntent
		ev.Currency = obj.Currency
		ev.AmountCents = int(obj.AmountRefunded)
	case "customer.subscription.deleted":
		var obj stripeSubscriptionObject
		if err := json.Unmarshal(env.Data.Object, &obj); err != nil {
			return domain.PaymentEvent{}, fmt.Errorf("simstripe: decode subscription: %w", err)
		}
		ev.Type = domain.EventSubscriptionCanceled
		ev.SubscriptionRef = obj.ID
	default:
		ev.Type = "ignored" // payment_intent.payment_failed 等留给真渠道语义验收
	}
	return ev, nil
}

// buildStripeEvent 由 Harness 的 eventInput 构造签名前信封（包内共用）。
// simstripe 的金额旋钮 Amount 是展示字符串（"45.00"/"4,500" 畸形），对象内
// amount_* 是整数分——统一经 amountCents() 解析（畸形串 → 0 → 不可对账
// 路径），复刻「信封字符串不可解析」的行为。
func buildStripeEvent(in eventInput) []byte {
	var obj any
	amountCents := int64(in.amountCents())
	payStatus := in.paymentStatus
	if payStatus == "" {
		payStatus = "paid"
	}
	switch in.eventType {
	case "checkout.session.completed", "checkout.session.async_payment_succeeded":
		obj = stripeSessionObject{
			ID:            in.channelRef,
			Object:        "checkout.session",
			PaymentStatus: payStatus,
			AmountTotal:   amountCents,
			Currency:      in.currency,
			Metadata:      map[string]string{"order_id": in.orderID},
			PaymentIntent: "pi_sim_" + in.eventID,
			Subscription:  in.subRef(),
		}
	case "invoice.paid":
		inv := stripeInvoiceObject{
			ID:           "in_sim_" + in.eventID,
			Object:       "invoice",
			Subscription: in.subRef(),
			AmountPaid:   amountCents,
			Currency:     in.currency,
		}
		inv.Lines.Data = []struct {
			Metadata map[string]string `json:"metadata"`
		}{{Metadata: map[string]string{"order_id": in.orderID}}}
		obj = inv
	case "charge.refunded":
		obj = stripeChargeObject{
			ID:             "ch_sim_" + in.eventID,
			Object:         "charge",
			PaymentIntent:  "pi_sim_" + in.eventID,
			Currency:       in.currency,
			AmountRefunded: amountCents,
		}
	case "customer.subscription.deleted":
		obj = stripeSubscriptionObject{ID: in.subRef(), Object: "subscription", Status: "canceled"}
	default:
		obj = map[string]any{"id": in.channelRef, "object": "sim.unknown"}
	}
	env := stripeEnvelope{ID: in.eventID, Type: in.eventType}
	env.Data.Object, _ = json.Marshal(obj)
	body, _ := json.Marshal(env)
	return body
}

var (
	_ app.PaymentChannel          = (*Stripe)(nil)
	_ app.ChannelCapabilityViewer = (*Stripe)(nil)
	_ app.ChannelConfigViewer     = (*Stripe)(nil)
	_ app.ChannelSchemaViewer     = (*Stripe)(nil)
	_ app.ChannelEnvViewer        = (*Stripe)(nil)
	_ Signer                      = (*Stripe)(nil)
)
