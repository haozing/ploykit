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
	"os"
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
	storeID        string // BC-7 RegisterProduct 建品用;可空
	mode           string // test/prod;非空时跨环境 webhook 事件拒收(五律 5)
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

// Caps 是包级能力声明单一真源:实例方法与 DisabledChannel 桩共用(未配置
// waffo 的后台卡片排序/币种声明与真渠道一致)。
func Caps() app.ChannelCaps { return waffoCapabilities }

func (c *Channel) Capabilities() app.ChannelCaps { return Caps() }

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
	// BC-7:服务端解析的目录商品映射优先;缺省回退静态 ProductMonthly/
	// ProductYearly(env-only 老接法不断);两者皆空 = 该档位未注册,报清晰
	// 错误而不是发出一个必然失败的会话。
	var productID string
	switch order.Interval {
	case domain.IntervalMonthly:
		productID = c.productMonthly
	case domain.IntervalYearly:
		productID = c.productYearly
	default:
		return domain.CheckoutSession{}, webx.NewValidation("waffo channel: billing interval not supported: " + string(order.Interval))
	}
	if req.ChannelProductID != "" {
		productID = req.ChannelProductID
	}
	if productID == "" {
		return domain.CheckoutSession{}, webx.NewValidation(fmt.Sprintf(
			"waffo channel: no product registered for plan %s (%s); register it in the admin billing page or set the static product id",
			order.PlanCode, string(order.Interval)))
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
	// 价格格式化走 Checked 形态:币种白名单已挡三位小数币,这里是纵深
	// 防御 —— 白名单扩容失误时宁可拒单也不发 10 倍错价到收银台。
	priceAmount, err := money.FormatCentsChecked(order.AmountCents, currency)
	if err != nil {
		return domain.CheckoutSession{}, fmt.Errorf("waffo channel: format price snapshot: %w", err)
	}
	body := createSessionReq{
		ProductID:               productID,
		Currency:                currency,
		PriceSnapshot:           &priceSnapshot{Amount: priceAmount, TaxCategory: c.taxCategory, TaxIncluded: c.taxIncluded},
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

// waffoSignatureTolerance 验签时间窗 24h:waffo 官方重试链最长可达 8h,
// 窗口必须覆盖整条重试链(45min 会把第 4 次之后的合法重试当过期拒掉,
// 卡在收银台边上的回调丢失)。防重放不靠时间窗 —— 签名绑定原始 body+t,
// 同一事件的重放由 ChannelEventID 幂等兜底,不同事件签名天然不同。
const waffoSignatureTolerance = 24 * time.Hour

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
// ChannelEventID = eventType + ":" + eventId:waffo 文档要求按
// (eventType, eventId) 二元组去重,而 ploykit 的幂等键只有 ChannelEventID
// 一列 —— 必须把类型拼进去(不同事件类型可能共享同一顶层 id,如订阅
// 事件 id = ORD_xxx)。eventId 取事件级 eventId 字段;同一订阅订单的
// 各期 payment_succeeded 顶层 id 相同(ORD_xxx),只有 eventId 互异,
// 回退顶层 id 会把第 2 期之后的续费当重复吞掉(客户持续扣费但权益
// 掉回 free);eventId 缺失时回退顶层 id(兼容旧载荷,行为与初版一致)。
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

	// 五律 5:渠道配置了 mode 时跨环境事件直接拒收 —— test 回调永不落生产
	// 权益(反之亦然)。事件未携带 mode 或渠道未声明 mode 时不设限。
	if c.mode != "" && env.Mode != "" && !strings.EqualFold(env.Mode, c.mode) {
		return domain.PaymentEvent{}, webx.NewValidation(fmt.Sprintf(
			"waffo webhook mode mismatch: event %q vs channel %q (cross-environment callback rejected)",
			env.Mode, c.mode))
	}

	ev := domain.PaymentEvent{
		Channel:        c.Name(),
		ChannelEventID: env.EventType + ":" + firstNonEmpty(env.EventID, env.ID),
	}
	// 五律 5 修复:Payload 恒空让对账/排障无原始载荷可查 —— 落已验签的
	// 原始 envelope + mode(参考 stripe 适配器存 evt.Data.Object 的做法;
	// payment_event.payload 是 jsonb,存 map 即入)。
	var rawEnvelope map[string]any
	if err := json.Unmarshal(req.Body, &rawEnvelope); err != nil {
		return domain.PaymentEvent{}, fmt.Errorf("waffo: decode webhook payload for storage: %w", err)
	}
	ev.Payload = map[string]any{"mode": env.Mode, "raw": rawEnvelope}
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
		ev.AmountCents = parseAmountCents(env.Data.Currency, env.Data.ChargedAmount, env.Data.Amount)
	case "order.completed": // 一次性购买(预留卖包路径),映射同 activated 但无订阅引用
		ev.Type = domain.EventCheckoutCompleted
		ev.AmountCents = parseAmountCents(env.Data.Currency, env.Data.ChargedAmount, env.Data.Amount)
	case "subscription.payment_succeeded":
		if env.Data.PeriodNumber > 1 {
			ev.Type = domain.EventSubscriptionRenewed
			ev.SubscriptionRef = env.Data.OrderID
			ev.AmountCents = parseAmountCents(env.Data.Currency, env.Data.ChargedAmount, env.Data.Amount)
		} else {
			ev.Type = "ignored" // 首期:activated 已走 handlePaid,再发一次只是撞状态冲突
		}
	case "subscription.canceled":
		ev.Type = domain.EventSubscriptionCanceled
		ev.SubscriptionRef = env.Data.OrderID
	case "refund.succeeded":
		ev.Type = domain.EventRefundCreated
		ev.AmountCents = parseAmountCents(env.Data.Currency, env.Data.RefundedAmount)
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

// ChannelConfig 进 billing 配置面(service_billingcfg):Configured 是纯凭据
// 语义(client 就绪 = merchant_id + 私钥可签名),与 paypal 的
// Configured = ClientID+Secret 同判 —— 目录模式(BC-7)下静态商品 id 留空
// 是合法形态(schema help 自己说"目录模式下留空"),把 products 拼进判定
// 会让目录模式渠道卡恒显"未配置"、测试连接被 billingcfg 的门误拒。
// 商品缺失在 CreateCheckout 才是问题,那里已有清晰报错。webhook 公钥
// 未配时如实标未配置 —— 收银台能开但回调进不来,运营必须看得见这个半残态。
func (c *Channel) ChannelConfig() app.ChannelConfigInfo {
	configured := c.client != nil
	masked := ""
	if configured {
		masked = maskID(c.client.MerchantID)
	}
	return app.ChannelConfigInfo{
		Configured:        configured,
		KeyMasked:         masked,
		WebhookConfigured: c.webhookPub != nil,
	}
}

// Schema 是包级 ConfigSchema 单一真源(BC-6):实例方法、DisabledChannel 桩
// (FromEnv/NewFromFields 未配置分支)、后台渠道卡的表单渲染共用此描述符,
// 字段键同时是 billing_channel.waffo.<field> 设置键与 NewFromFields 的
// fields 键 —— 三处一份真源。每个字段的 Help 都注明
// 「清空=回退 env」:管理员清空字段保存后,该值会回退到环境变量提供的
// 值(NewFromFields 的 fields-优先-env-回退装配),不是"清空即删除配置"
// —— 不写明这一点,管理员会误以为清空能彻底摘掉某个值(P3-7)。
func Schema() []app.FieldSpec {
	return []app.FieldSpec{
		{Key: FieldMerchantID, Label: "Merchant ID", Type: app.FieldTypeText, Required: true,
			Help: "waffo 后台 Dashboard → API & Development 复制(MER_ 开头);清空保存后将回退到环境变量提供的值"},
		{Key: FieldPrivateKey, Label: "API 私钥", Type: app.FieldTypeSecret, Required: true,
			Help: "仅创建时下发;支持 PEM / 转义 \\n / 整段 base64 / 裸 base64 体四种形态;清空保存后将回退到环境变量提供的值"},
		{Key: FieldStoreID, Label: "Store ID", Type: app.FieldTypeText,
			Help: "商品注册用(BC-7 建品请求的 storeId);不使用后台注册商品可留空;清空保存后将回退到环境变量提供的值"},
		{Key: FieldProductMonthly, Label: "月付商品 ID", Type: app.FieldTypeText,
			Help: "静态 PROD_ id(env-only 老接法);目录模式下留空、在渠道页按套餐注册;清空保存后将回退到环境变量提供的值"},
		{Key: FieldProductYearly, Label: "年付商品 ID", Type: app.FieldTypeText,
			Help: "静态 PROD_ id(env-only 老接法);目录模式下留空、在渠道页按套餐注册;清空保存后将回退到环境变量提供的值"},
		{Key: FieldWebhookPublicKey, Label: "Webhook 验签公钥", Type: app.FieldTypeSecret,
			Help: "waffo 后台 Settings → Webhooks 复制;test/prod 各一把,分环境各自保存;清空保存后将回退到环境变量提供的值"},
		{Key: FieldMode, Label: "环境模式", Type: app.FieldTypeSelect,
			Help: "test = 测试回调/测试卡;prod = 生产。配置后跨环境回调直接拒收;清空保存后将回退到环境变量提供的值",
			Options: []app.FieldOption{
				{Value: ModeTest, Label: "test(测试)"},
				{Value: ModeProd, Label: "prod(生产)"},
			}},
	}
}

func (c *Channel) ConfigSchema() []app.FieldSpec { return Schema() }

// EnvProvidedKeys 返回进程环境变量当前实际提供(os.Getenv 非空)的配置
// 字段键(与 ConfigSchema 的 Key 同名;env 变量名走 NewFromFields/
// FromEnv 共用的 envOfField 映射)。billing 侧以 ChannelEnvViewer 鸭子
// 类型断言取用:后台渠道卡据此展示"清空该字段后将回退到的 env 值",
// 没被 env 提供的键不列。顺序与 ConfigSchema 一致,便于展示与断言。
func (c *Channel) EnvProvidedKeys() []string {
	var keys []string
	for _, field := range []string{
		FieldMerchantID, FieldPrivateKey, FieldStoreID,
		FieldProductMonthly, FieldProductYearly, FieldWebhookPublicKey, FieldMode,
	} {
		if strings.TrimSpace(os.Getenv(envOfField[field])) != "" {
			keys = append(keys, field)
		}
	}
	return keys
}

// ---- ProductRegistrar(BC-7,目录型商品映射) ----

// createProductReq POST /v1/actions/subscription-product/create-product。
// storeId 从渠道配置(Config.StoreID / WAFFO_STORE_ID);价格 = DB plan
// limits 的展示字符串(billing/money),taxIncluded/taxCategory 沿用渠道
// 约定(MoR 税内含,买家实付=站内标价)。
type createProductReq struct {
	StoreID       string                  `json:"storeId"`
	Name          string                  `json:"name"`
	BillingPeriod string                  `json:"billingPeriod"`
	Prices        map[string]productPrice `json:"prices"`
}

type productPrice struct {
	Amount      string `json:"amount"`
	TaxIncluded bool   `json:"taxIncluded"`
	TaxCategory string `json:"taxCategory"`
}

type createProductResp struct {
	Product struct {
		ID string `json:"id"`
	} `json:"product"`
}

// updateProductReq POST /v1/actions/subscription-product/update-product:
// 只改价格(create 时建的 name/billingPeriod 不动)。
type updateProductReq struct {
	ID     string                  `json:"id"`
	Prices map[string]productPrice `json:"prices"`
}

// intervalPeriod/intervalPriceKey/planPriceCents 把 domain 的 plan+interval
// 翻译成 waffo 建品载荷:billingPeriod monthly/yearly、价格取对应档位
// price_*_cents(与 checkout 的 planAmountCents 同源)。
func intervalPeriod(interval domain.BillingInterval) (string, error) {
	switch interval {
	case domain.IntervalMonthly:
		return "monthly", nil
	case domain.IntervalYearly:
		return "yearly", nil
	default:
		return "", webx.NewValidation("waffo: subscription products support monthly/yearly only, got: " + string(interval))
	}
}

func planPriceCents(plan domain.Plan, interval domain.BillingInterval) int {
	return app.PlanPriceCents(plan, interval)
}

// periodDisplay capitalizes the waffo billingPeriod for product names.
func periodDisplay(period string) string {
	if period == "" {
		return ""
	}
	return strings.ToUpper(period[:1]) + period[1:]
}

func (c *Channel) priceForPlan(plan domain.Plan, interval domain.BillingInterval) (map[string]productPrice, error) {
	cents := planPriceCents(plan, interval)
	if cents <= 0 {
		return nil, webx.NewValidation(fmt.Sprintf("waffo: plan %s is not priced for %s", plan.Code, string(interval)))
	}
	currency := strings.ToUpper(strings.TrimSpace(plan.Currency))
	if currency == "" {
		currency = "USD"
	}
	// 注册价同样走 Checked:plan.currency 不经渠道白名单(建品入口比
	// checkout 更靠前),三位小数币在这里必须显式失败而不是 10 倍错价。
	amount, err := money.FormatCentsChecked(cents, currency)
	if err != nil {
		return nil, fmt.Errorf("waffo: format price for plan %s: %w", plan.Code, err)
	}
	return map[string]productPrice{currency: {
		Amount:      amount,
		TaxIncluded: c.taxIncluded,
		TaxCategory: c.taxCategory,
	}}, nil
}

// RegisterProduct 实现 app.ProductRegistrar:在 waffo 侧创建订阅商品并
// 返回 PROD_ id(F4:一次性 create-products 脚本收编为后台按钮)。名称
// "套餐名 (Monthly|Yearly)";价格真源仍是 DB plan limits —— 渠道侧价目
// 只是目录壳,checkout 时 priceSnapshot 覆盖。
func (c *Channel) RegisterProduct(ctx context.Context, plan domain.Plan, interval domain.BillingInterval) (string, error) {
	period, err := intervalPeriod(interval)
	if err != nil {
		return "", err
	}
	if c.storeID == "" {
		return "", webx.NewValidation("waffo: store id is required for product registration (set WAFFO_STORE_ID or the store_id channel field)")
	}
	prices, err := c.priceForPlan(plan, interval)
	if err != nil {
		return "", err
	}
	name := plan.Name + " (" + periodDisplay(period) + ")"
	if plan.Name == "" {
		name = plan.Code + " (" + periodDisplay(period) + ")"
	}
	var resp createProductResp
	if err := c.client.do(ctx, http.MethodPost, "/v1/actions/subscription-product/create-product", createProductReq{
		StoreID:       c.storeID,
		Name:          name,
		BillingPeriod: period,
		Prices:        prices,
	}, &resp); err != nil {
		return "", fmt.Errorf("waffo: create product %s/%s: %w", plan.Code, period, err)
	}
	if resp.Product.ID == "" {
		return "", fmt.Errorf("waffo: create product %s/%s: empty product id in response", plan.Code, period)
	}
	return resp.Product.ID, nil
}

// SyncPrice 实现 app.ProductRegistrar:把 plan 当前 DB 价推给已注册商品
// (BC-7 改价联动;迁移+手工 update-product 的组合消失)。
func (c *Channel) SyncPrice(ctx context.Context, channelProductID string, plan domain.Plan, interval domain.BillingInterval) error {
	if strings.TrimSpace(channelProductID) == "" {
		return webx.NewValidation("waffo: sync price: empty channel product id")
	}
	prices, err := c.priceForPlan(plan, interval)
	if err != nil {
		return err
	}
	if err := c.client.do(ctx, http.MethodPost, "/v1/actions/subscription-product/update-product", updateProductReq{
		ID:     channelProductID,
		Prices: prices,
	}, nil); err != nil {
		return fmt.Errorf("waffo: update product %s price: %w", channelProductID, err)
	}
	return nil
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

// firstNonEmpty 返回第一个非空串(waffo 事件级 eventId 缺失时回退顶层 id)。
func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
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
// (BC-3,JPY "4500" 无小数点 → 4500,"19.00" → 1900)。按币种解析
// (ParseAmountForCurrency):部分网关对零小数位币种回显 "4500.00" 形态,
// 旧 ParseAmount 会解析成 450000(100 倍),金额对账整单拒付。不可解析
// 输入得 0,billing 侧按"金额缺失不参与对账"处理,不拦事件。
func parseAmountCents(currency string, values ...string) int {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return money.ParseAmountForCurrency(v, currency)
		}
	}
	return 0
}

// 编译期断言:满足 ploykit 渠道接口与全部可选能力面(BC-2/BC-9/BC-7)。
var (
	_ app.PaymentChannel          = (*Channel)(nil)
	_ app.ChannelCapabilityViewer = (*Channel)(nil)
	_ app.ChannelConfigViewer     = (*Channel)(nil)
	_ app.ChannelSchemaViewer     = (*Channel)(nil)
	_ app.ConnectionTester        = (*Channel)(nil)
	_ app.SubscriptionCanceller   = (*Channel)(nil)
	_ app.ProductRegistrar        = (*Channel)(nil)
)
