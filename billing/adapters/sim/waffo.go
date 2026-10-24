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

// Waffo 是 simwaffo 渠道：镜像 billing/adapters/waffo 的事件信封与五律映射。
//
// 信封（与真 waffo 同形）：{id(订单级,跨期相同!), eventId(期级唯一), eventType,
// mode, timestamp, data{orderId, chargedAmount, currency, periodNumber,
// refundedAmount, orderMetadata{order_id}}}。订单反查靠 checkout 会话
// metadata.order_id 透传回来的 data.orderMetadata.order_id（本地订单 UUID）。
//
// 事件映射（与真 waffo 一字不差）：
//
//	subscription.activated         → checkout.completed(带金额,落订阅引用=orderId)
//	subscription.payment_succeeded → periodNumber>1: subscription.renewed
//	                                periodNumber==1: ignored(activated 已覆盖)
//	subscription.canceled          → subscription.canceled
//	refund.succeeded               → refund.created(refundedAmount;订阅退款带订阅引用)
//	其余                            → ignored
//
// 幂等键（五律 4,与真 waffo 同语义）：ChannelEventID = eventType + ":" +
// eventId(eventId 缺失回退顶层 id)。同一订阅订单各期顶层 id 相同、只有
// eventId 互异——回退顶层 id 会把第 2 期起的续费当重复吞掉。
type Waffo struct {
	*core
}

// NewWaffo 构造 simwaffo 渠道。
func NewWaffo(cfg coreConfig) *Waffo { return &Waffo{core: newCore(NameWaffo, cfg)} }

func (c *Waffo) Name() string { return NameWaffo }

func (c *Waffo) Capabilities() app.ChannelCaps {
	// DisplayOrder 950：排在 manual(900) 之后——sim 渠道永不挤占真渠道的
	// /config billing_channels 推荐位。CatalogBased=false（见包注释）。
	return app.ChannelCaps{CatalogBased: false, SupportsCancelURL: false, DisplayOrder: 950}
}

func (c *Waffo) ChannelConfig() app.ChannelConfigInfo { return c.core.channelConfig() }

func (c *Waffo) ConfigSchema() []app.FieldSpec { return c.core.configSchema(EnvWaffoSecret) }

func (c *Waffo) EnvProvidedKeys() []string { return c.core.envProvidedKeys(EnvWaffoSecret) }

// CreateCheckout 返回本地 approve URL、ORD-SIM-* 会话引用（= 真渠道的稳定
// 订阅引用 ORD_xxx，激活/续费/取消全程不变）、可配置 ExpiresAt（默认 1h）。
func (c *Waffo) CreateCheckout(_ context.Context, req app.CheckoutRequest) (domain.CheckoutSession, error) {
	order := req.Order
	ref := c.nextID("ORD-SIM-")
	expires := time.Now().UTC().Add(c.ttl)
	return domain.CheckoutSession{
		OrderID:    order.ID,
		Channel:    c.Name(),
		ActionURL:  c.approveURL(order.ID),
		SessionRef: ref,
		ExpiresAt:  expires,
	}, nil
}

// waffoEnvelope / waffoData：真 waffo webhook 载荷的镜像（仅保留映射用到的
// 字段；orderMetadata.order_id 是订单反查键）。
type waffoEnvelope struct {
	ID        string    `json:"id"`
	EventID   string    `json:"eventId"`
	EventType string    `json:"eventType"`
	Mode      string    `json:"mode"`
	Timestamp string    `json:"timestamp"`
	Data      waffoData `json:"data"`
}

type waffoData struct {
	OrderID        string         `json:"orderId"`
	Currency       string         `json:"currency"`
	ChargedAmount  string         `json:"chargedAmount"`
	RefundedAmount string         `json:"refundedAmount"`
	PeriodNumber   int            `json:"periodNumber"`
	OrderMetadata  map[string]any `json:"orderMetadata"`
}

// ParseWebhook：验签（X-Sim-Signature,对 raw body）→ 解码 → 五律映射。
func (c *Waffo) ParseWebhook(_ context.Context, req app.WebhookRequest) (domain.PaymentEvent, error) {
	if err := verifySignature(c.secret, req.Header, req.Body); err != nil {
		return domain.PaymentEvent{}, err
	}
	var env waffoEnvelope
	if err := json.Unmarshal(req.Body, &env); err != nil {
		return domain.PaymentEvent{}, fmt.Errorf("simwaffo: decode webhook payload: %w", err)
	}

	ev := domain.PaymentEvent{
		Channel:        c.Name(),
		ChannelEventID: env.EventType + ":" + firstNonEmpty(env.EventID, env.ID), // 五律 4:拼类型
	}
	// 落已验签的原始信封供对账/排障（同真 waffo 的 Payload 纪律）。
	var raw map[string]any
	if err := json.Unmarshal(req.Body, &raw); err != nil {
		return domain.PaymentEvent{}, fmt.Errorf("simwaffo: decode webhook payload for storage: %w", err)
	}
	ev.Payload = map[string]any{"mode": env.Mode, "raw": raw}
	// checkout 会话 metadata.order_id = 本地订单号,每个事件透传回带。
	if v, ok := env.Data.OrderMetadata["order_id"].(string); ok {
		ev.OrderID = v
	}
	ev.ChannelRef = env.Data.OrderID
	ev.Currency = env.Data.Currency

	switch env.EventType {
	case "subscription.activated":
		ev.Type = domain.EventCheckoutCompleted
		ev.SubscriptionRef = env.Data.OrderID // 稳定订阅引用
		ev.AmountCents = money.ParseAmountForCurrency(env.Data.ChargedAmount, env.Data.Currency)
	case "subscription.payment_succeeded":
		if env.Data.PeriodNumber > 1 {
			ev.Type = domain.EventSubscriptionRenewed
			ev.SubscriptionRef = env.Data.OrderID
			ev.AmountCents = money.ParseAmountForCurrency(env.Data.ChargedAmount, env.Data.Currency)
		} else {
			ev.Type = "ignored" // 首期:activated 已走 handlePaid
		}
	case "subscription.canceled":
		ev.Type = domain.EventSubscriptionCanceled
		ev.SubscriptionRef = env.Data.OrderID
	case "refund.succeeded":
		ev.Type = domain.EventRefundCreated
		ev.AmountCents = money.ParseAmountForCurrency(env.Data.RefundedAmount, env.Data.Currency)
		if env.Data.PeriodNumber > 0 {
			ev.SubscriptionRef = env.Data.OrderID // 订阅退款:撤权并清订阅引用
		}
	default:
		ev.Type = "ignored" // renewed/recovered(与 payment_succeeded 双发)/canceling/past_due/…
	}
	return ev, nil
}

// buildWaffoEvent 由 Harness 的 eventInput 构造签名前信封（包内共用）。
func buildWaffoEvent(in eventInput) []byte {
	env := waffoEnvelope{
		ID:        in.channelRef, // 订单级:同一订阅各期相同(跨期不变)
		EventID:   in.eventID,    // 期级唯一
		EventType: in.eventType,
		Mode:      "test",
		Timestamp: in.timestamp.UTC().Format(time.RFC3339),
		Data: waffoData{
			OrderID:        in.channelRef,
			Currency:       in.currency,
			ChargedAmount:  in.amount,
			RefundedAmount: in.refundedAmount(),
			PeriodNumber:   in.periodNumber,
			OrderMetadata:  map[string]any{"order_id": in.orderID},
		},
	}
	body, _ := json.Marshal(env)
	return body
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

var _ app.PaymentChannel = (*Waffo)(nil)
var _ app.ChannelCapabilityViewer = (*Waffo)(nil)
var _ app.ChannelConfigViewer = (*Waffo)(nil)
var _ app.ChannelSchemaViewer = (*Waffo)(nil)
var _ app.ChannelEnvViewer = (*Waffo)(nil)
var _ Signer = (*Waffo)(nil)

// Signer 是 Harness / simhttp 投递侧取验签密钥的口（见 core.SigningSecret）。
type Signer interface {
	PaymentChannelDialect()
	SigningSecret() string
}

// PaymentChannelDialect 哨兵方法把 Signer 限定在本包三方言内。
func (c *core) PaymentChannelDialect() {}
