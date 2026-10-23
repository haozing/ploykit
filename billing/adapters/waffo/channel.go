package waffo

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/haozing/ploykit/billing/app"
	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/billing/money"
	"github.com/haozing/ploykit/platform/webx"
)

// Channel 实现 app.PaymentChannel。不实现 CheckoutCanceller —— waffo 收银台
// 会话没有作废 API,放任过期即可(ploykit 的 CancelPendingOrder 对未实现
// 该接口的渠道直接跳过,弃单由 OrderExpiryWorker 清扫)。
type Channel struct {
	client         *Client
	productMonthly string
	productYearly  string
	taxCategory    string
	taxIncluded    bool
	webhookPub     *rsa.PublicKey
}

func (c *Channel) Name() string { return "waffo" }

// waffoCapabilities 能力声明(BC-2):目录型渠道(商品需在 waffo 后台/BC-7
// 预注册,checkout 只带 productId)、无取消 URL(弃单自然过期,零回调)、
// DisplayOrder 100(/config billing_channels 排 waffo < stripe 200 < manual 900,
// 前端取第一个即可)、订阅币种白名单(一次性结账多一个 CNY,本渠道只做订阅;
// plan.currency 落在白名单外时 CreateCheckout 快速失败,不让用户走到收银台才炸)。
var waffoCapabilities = app.ChannelCaps{
	CatalogBased:      true,
	SupportsCancelURL: false,
	DisplayOrder:      100,
	Currencies:        []string{"USD", "EUR", "GBP", "HKD", "JPY"},
}

func (c *Channel) Capabilities() app.ChannelCaps { return waffoCapabilities }

// createSessionReq POST /v1/actions/checkout/create-session 请求体。
// 全部字段见 docs/api-reference/endpoints/orders/create-checkout-session。
type createSessionReq struct {
	ProductID               string         `json:"productId"`
	Currency                string         `json:"currency"`
	PriceSnapshot           *priceSnapshot `json:"priceSnapshot,omitempty"`
	BuyerEmail              string         `json:"buyerEmail,omitempty"` // F2:CheckoutRequest.BuyerEmail 预填,空=不传
	SuccessURL              string         `json:"successUrl,omitempty"`
	Language                string         `json:"language,omitempty"` // BCP 47;空由调用方定缺省
	ExpiresInSeconds        int            `json:"expiresInSeconds,omitempty"`
	Metadata                map[string]any `json:"metadata,omitempty"`
	OrderMerchantExternalID string         `json:"orderMerchantExternalId,omitempty"`
}

// priceSnapshot 覆盖 waffo 后台商品价 —— 价目真源在 DB plan limits,
// 后台商品只是目录壳,改价只改 DB 一处。amount 是展示字符串("19.00"),
// 非分(换算走 billing/money)。taxIncluded=true:MoR 模式税款从标价里出,
// 买家实付 = 站内标价,webhook 的 chargedAmount 才能和 order.AmountCents 对上。
type priceSnapshot struct {
	Amount      string `json:"amount"`
	TaxCategory string `json:"taxCategory"`
	TaxIncluded bool   `json:"taxIncluded"`
}

type createSessionResp struct {
	SessionID   string `json:"sessionId"`
	CheckoutURL string `json:"checkoutUrl"`
	ExpiresAt   string `json:"expiresAt"`
}

func (c *Channel) CreateCheckout(ctx context.Context, req app.CheckoutRequest) (domain.CheckoutSession, error) {
	order := req.Order
	var productID string
	switch order.Interval {
	case domain.IntervalMonthly:
		productID = c.productMonthly
	case domain.IntervalYearly:
		productID = c.productYearly
	default:
		return domain.CheckoutSession{}, webx.NewValidation("waffo channel: billing interval not supported: " + string(order.Interval))
	}

	currency := strings.ToUpper(order.Currency)
	if !slices.Contains(waffoCapabilities.Currencies, currency) {
		return domain.CheckoutSession{}, webx.NewValidation("waffo channel: subscription currency not supported: " + currency)
	}

	// cancelURL 有意忽略(SupportsCancelURL=false 已声明,不许静默):
	// waffo 没有取消 URL,弃单自动过期(订单置 canceled,无 webhook),
	// 买家取消支付就停在收银台。
	language := "en" // 渠道缺省:英文收银台(买家仍可页内切换)
	if req.Locale != "" {
		language = req.Locale
	}
	body := createSessionReq{
		ProductID:               productID,
		Currency:                currency,
		PriceSnapshot:           &priceSnapshot{Amount: money.FormatCents(order.AmountCents, currency), TaxCategory: c.taxCategory, TaxIncluded: c.taxIncluded},
		BuyerEmail:              req.BuyerEmail,
		SuccessURL:              req.SuccessURL,
		Language:                language,
		ExpiresInSeconds:        86400,
		Metadata:                map[string]any{"order_id": order.ID}, // 经 orderMetadata 透传回每个 webhook 事件
		OrderMerchantExternalID: order.ID,
	}
	var resp createSessionResp
	if err := c.client.do(ctx, http.MethodPost, "/v1/actions/checkout/create-session", body, &resp); err != nil {
		return domain.CheckoutSession{}, err
	}
	if resp.CheckoutURL == "" {
		return domain.CheckoutSession{}, errors.New("waffo: create-session returned empty checkoutUrl")
	}
	expiresAt := time.Now().Add(24 * time.Hour)
	if resp.ExpiresAt != "" {
		if t, err := time.Parse(time.RFC3339, resp.ExpiresAt); err == nil {
			expiresAt = t
		}
	}
	return domain.CheckoutSession{
		OrderID:    order.ID,
		Channel:    c.Name(),
		ActionURL:  resp.CheckoutURL,
		SessionRef: resp.SessionID,
		ExpiresAt:  expiresAt.UTC(),
	}, nil
}

// cancelOrderReq POST /v1/actions/subscription-order/cancel-order 请求体。
// docs/api-reference/endpoints/subscriptions/cancel-subscription:orderId =
// Subscription order ID(ORD_xxx);响应 data.status = "canceling"(active/
// past_due,期末停)或 "canceled"(pending,立即停)—— 两种都算取消成功。
type cancelOrderReq struct {
	OrderID string `json:"orderId"`
}

type cancelOrderResp struct {
	OrderID string `json:"orderId"`
	Status  string `json:"status"`
}

// CancelSubscription 实现 app.SubscriptionCanceller(BC-9/F13)。
// providerSubID 就是我们落的 SubscriptionRef = waffo orderId(ORD_xxx,
// 激活/续费/取消全程不变的稳定订阅引用)。
func (c *Channel) CancelSubscription(ctx context.Context, providerSubID string) error {
	if strings.TrimSpace(providerSubID) == "" {
		return webx.NewValidation("waffo: cancel subscription: empty subscription reference")
	}
	var resp cancelOrderResp
	if err := c.client.do(ctx, http.MethodPost, "/v1/actions/subscription-order/cancel-order", cancelOrderReq{OrderID: providerSubID}, &resp); err != nil {
		return fmt.Errorf("waffo: cancel subscription %s: %w", providerSubID, err)
	}
	return nil
}

// TestConnection 实现 app.ConnectionTester(BC-9/F12):最便宜的无副作用
// 读 —— GraphQL stores 查询(POST /v1/graphql,与 REST 同一套 RSA 请求
// 签名;docs/api-reference/endpoints/graphql/overview)。2xx = 凭据/签名/
// 时钟全通;401 = 认证失败(密钥错或时钟漂移 >5min)。REST 侧没有
// list-webhooks 端点(webhook 列表查询走 GraphQL Store.storeWebhooks,
// 还需 storeId),stores 查询不需要任何额外配置,是文档给的探活路径。
func (c *Channel) TestConnection(ctx context.Context) error {
	var resp struct {
		Stores []struct {
			ID string `json:"id"`
		} `json:"stores"`
	}
	if err := c.client.do(ctx, http.MethodPost, "/v1/graphql", map[string]any{
		"query":     "{ stores { id name status } }",
		"variables": map[string]any{},
	}, &resp); err != nil {
		return fmt.Errorf("waffo: test connection: %w", err)
	}
	return nil
}

// ---- webhook ----

// waffoSignatureTolerance 文档推荐 45min(非 5min):重试原样重放签名头,
// t 永不重打;防重放靠 ploykit 按 ChannelEventID 幂等,不靠时间窗。
const waffoSignatureTolerance = 45 * time.Minute

type webhookEnvelope struct {
	ID        string          `json:"id"`
	EventID   string          `json:"eventId"`
	EventType string          `json:"eventType"`
	Mode      string          `json:"mode"`
	Timestamp string          `json:"timestamp"`
	Data      webhookData     `json:"data"`
	Raw       json.RawMessage `json:"-"`
}

type webhookData struct {
	OrderID            string         `json:"orderId"`
	OrderStatus        string         `json:"orderStatus"`
	BuyerEmail         string         `json:"buyerEmail"`
	Currency           string         `json:"currency"`
	ChargedAmount      string         `json:"chargedAmount"`
	Amount             string         `json:"amount"` // deprecated 但仍在
	PaymentID          string         `json:"paymentId"`
	PeriodNumber       int            `json:"periodNumber"`
	OrderMetadata      map[string]any `json:"orderMetadata"`
	RefundedAmount     string         `json:"refundedAmount"`
	OrderMerchantExtID string         `json:"orderMerchantExternalId"`
}

// ParseWebhook 验签 + 事件映射。验签必须用原始 body(本包拿到的就是
// ploykit billinghttp 读出的 raw bytes,未经过任何 JSON 再编码)。
// ChannelEventID = eventType + ":" + id:waffo 文档要求按 eventType+eventId
// 去重,而 ploykit 的幂等键只有 ChannelEventID 一列 —— 不同事件类型可能
// 共享同一顶层 id(如订阅事件 id = ORD_xxx),不拼类型会把后到的合法事件
// 当重复吞掉。
func (c *Channel) ParseWebhook(_ context.Context, req app.WebhookRequest) (domain.PaymentEvent, error) {
	if c.webhookPub == nil {
		return domain.PaymentEvent{}, errors.New("waffo: webhook public key not configured (WAFFO_WEBHOOK_PUBLIC_KEY)")
	}
	sig := headerGet(req.Header, "X-Waffo-Signature")
	if sig == "" {
		return domain.PaymentEvent{}, webx.NewValidation("missing X-Waffo-Signature header")
	}
	t, v1, err := parseSignatureHeader(sig)
	if err != nil {
		return domain.PaymentEvent{}, webx.NewValidation("malformed X-Waffo-Signature: " + err.Error())
	}
	ts, err := strconv.ParseInt(t, 10, 64)
	if err != nil {
		return domain.PaymentEvent{}, webx.NewValidation("malformed X-Waffo-Signature timestamp")
	}
	if d := time.Since(time.UnixMilli(ts)); d > waffoSignatureTolerance || d < -waffoSignatureTolerance {
		return domain.PaymentEvent{}, webx.NewValidation("X-Waffo-Signature timestamp outside tolerance")
	}
	digest := sha256.Sum256([]byte(t + "." + string(req.Body)))
	v1Raw, err := base64.StdEncoding.DecodeString(v1)
	if err != nil {
		return domain.PaymentEvent{}, webx.NewValidation("malformed X-Waffo-Signature v1 encoding")
	}
	if err := rsa.VerifyPKCS1v15(c.webhookPub, crypto.SHA256, digest[:], v1Raw); err != nil {
		return domain.PaymentEvent{}, webx.NewValidation("waffo webhook signature verification failed")
	}

	var env webhookEnvelope
	if err := json.Unmarshal(req.Body, &env); err != nil {
		return domain.PaymentEvent{}, fmt.Errorf("waffo: decode webhook payload: %w", err)
	}

	ev := domain.PaymentEvent{
		Channel:        c.Name(),
		ChannelEventID: env.EventType + ":" + env.ID,
	}
	// checkout 会话 metadata.order_id = ploykit 订单号,透传回每个事件;
	// 缺失时退化用 orderMerchantExternalId(同一值,双保险)。
	if v, ok := env.Data.OrderMetadata["order_id"].(string); ok {
		ev.OrderID = v
	}
	if ev.OrderID == "" {
		ev.OrderID = env.Data.OrderMerchantExtID
	}
	ev.ChannelRef = env.Data.OrderID
	ev.Currency = env.Data.Currency

	switch env.EventType {
	case "subscription.activated":
		ev.Type = domain.EventCheckoutCompleted
		ev.SubscriptionRef = env.Data.OrderID // 稳定订阅引用,handlePaid 落 workspace_subscription
		ev.AmountCents = parseAmountCents(env.Data.ChargedAmount, env.Data.Amount)
	case "order.completed": // 一次性购买(预留卖包路径),映射同 activated 但无订阅引用
		ev.Type = domain.EventCheckoutCompleted
		ev.AmountCents = parseAmountCents(env.Data.ChargedAmount, env.Data.Amount)
	case "subscription.payment_succeeded":
		if env.Data.PeriodNumber > 1 {
			ev.Type = domain.EventSubscriptionRenewed
			ev.SubscriptionRef = env.Data.OrderID
			ev.AmountCents = parseAmountCents(env.Data.ChargedAmount, env.Data.Amount)
		} else {
			ev.Type = "ignored" // 首期:activated 已走 handlePaid,再发一次只是撞状态冲突
		}
	case "subscription.canceled":
		ev.Type = domain.EventSubscriptionCanceled
		ev.SubscriptionRef = env.Data.OrderID
	case "refund.succeeded":
		ev.Type = domain.EventRefundCreated
		ev.AmountCents = parseAmountCents(env.Data.RefundedAmount)
		if env.Data.PeriodNumber > 0 {
			ev.SubscriptionRef = env.Data.OrderID // 订阅退款:撤权并清订阅引用
		}
	default:
		// renewed/recovered(与 payment_succeeded 双发,只认钱)、canceling
		// (期末才停)、uncanceled、past_due(waffo 侧催收,权益保留)、
		// plan_changed*(单一套餐产品无换挡场景)。
		ev.Type = "ignored"
	}
	return ev, nil
}

// ChannelConfig 进 billing 配置面(service_billingcfg):webhook 公钥未配
// 时如实标未配置 —— 收银台能开但回调进不来,运营必须看得见这个半残态。
func (c *Channel) ChannelConfig() app.ChannelConfigInfo {
	return app.ChannelConfigInfo{
		Configured:        c.client != nil && c.productMonthly != "" && c.productYearly != "",
		KeyMasked:         maskID(c.client.MerchantID),
		WebhookConfigured: c.webhookPub != nil,
	}
}

func maskID(id string) string {
	if id == "" {
		return ""
	}
	if len(id) <= 8 {
		return id[:3] + "***"
	}
	return id[:7] + "***" + id[len(id)-3:]
}

func headerGet(h map[string][]string, name string) string {
	for k, vs := range h {
		if strings.EqualFold(k, name) && len(vs) > 0 {
			return vs[0]
		}
	}
	return ""
}

// parseSignatureHeader "t=<毫秒>,v1=<b64>"(与 Stripe 的 t=…,v1=… 同形)。
func parseSignatureHeader(sig string) (t, v1 string, err error) {
	for _, part := range strings.Split(sig, ",") {
		k, v, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			continue
		}
		switch k {
		case "t":
			t = v
		case "v1":
			v1 = v
		}
	}
	if t == "" || v1 == "" {
		return "", "", errors.New("missing t/v1 component")
	}
	return t, v1, nil
}

// parseAmountCents 展示字符串 → 最小货币单位整数,空值向后回退
// (chargedAmount 优先、deprecated amount 兜底);解析本体在 billing/money
// (BC-3,JPY "4500" 无小数点 → 4500,"19.00" → 1900)。不可解析输入
// 得 0,billing 侧按"金额缺失不参与对账"处理,不拦事件。
func parseAmountCents(values ...string) int {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return money.ParseAmount(v)
		}
	}
	return 0
}

// 编译期断言:满足 ploykit 渠道接口与全部可选能力面(BC-2/BC-9)。
var (
	_ app.PaymentChannel          = (*Channel)(nil)
	_ app.ChannelCapabilityViewer = (*Channel)(nil)
	_ app.ChannelConfigViewer     = (*Channel)(nil)
	_ app.ConnectionTester        = (*Channel)(nil)
	_ app.SubscriptionCanceller   = (*Channel)(nil)
)
