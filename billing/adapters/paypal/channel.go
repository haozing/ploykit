package paypal

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/haozing/ploykit/billing/app"
	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/billing/money"
	"github.com/haozing/ploykit/platform/webx"
)

// Channel 实现 app.PaymentChannel。不实现 CheckoutCanceller —— PayPal
// 没有作废 APPROVAL_PENDING 订阅的公开端点,放任过期即可(ploykit 的
// CancelPendingOrder 对未实现该接口的渠道直接跳过,弃单由
// OrderExpiryWorker 按 CheckoutSession.ExpiresAt 清扫)。
type Channel struct {
	client    *Client
	webhookID string // 开发者后台 App 的 Webhook ID;空=验签必败(半残态,ChannelConfig 可见)
	mode      string // test/prod;记入事件 Payload 供审计(五律 5;PayPal 载荷自身不带 mode)
}

func (c *Channel) Name() string { return "paypal" }

// paypalCapabilities 能力声明(BC-2):目录型渠道(product+plan 预注册,
// checkout 只带 plan_id)、支持取消 URL(application_context.cancel_url
// 必填,买家在 PayPal 页可取消回跳)、DisplayOrder 300(waffo 100 <
// stripe 200 < paypal 300 < manual 900)、币种白名单留空 —— PayPal
// 可用币种随商户账户能力变化,静态白名单只会误伤。
var paypalCapabilities = app.ChannelCaps{
	CatalogBased:      true,
	SupportsCancelURL: true,
	DisplayOrder:      300,
}

func (c *Channel) Capabilities() app.ChannelCaps { return paypalCapabilities }

// ---- CreateCheckout(BC-2 签名;BC-7 目录映射) ----

// createSubscriptionReq POST /v1/billing/subscriptions。plan_id 就是 BC-7
// 注册回来的渠道商品 ID(RegisterProduct 返回的 PayPal plan id P-xxx);
// custom_id = ploykit 订单号,BILLING.SUBSCRIPTION.* 事件原样回传(订单
// 反查键);subscriber.email_address 预填买家邮箱(空=不预填,买家 PayPal
// 页自填);application_context.return_url/cancel_url 均**必填**(PayPal
// 文档:批准后/取消后的回跳地址)。
//
// 注意:载荷**不带任何价格字段** —— PayPal 订阅没有会话级改价,收款价就是
// plan 的 pricing_scheme.fixed_price;DB 改价后必须 SyncPrice 推平,否则
// 买家按旧价付款、SALE 事件金额对不上订单金额被 amountMismatch 拒付。
type createSubscriptionReq struct {
	PlanID             string                 `json:"plan_id"`
	CustomID           string                 `json:"custom_id,omitempty"`
	Subscriber         *subscriberReq         `json:"subscriber,omitempty"`
	ApplicationContext *applicationContextReq `json:"application_context"`
}

type subscriberReq struct {
	EmailAddress string `json:"email_address,omitempty"`
}

type applicationContextReq struct {
	Locale     string `json:"locale,omitempty"`      // BCP-47("zh-CN" 等);空=PayPal 按买家偏好
	ReturnURL  string `json:"return_url"`            // 必填:买家批准后回跳(req.SuccessURL)
	CancelURL  string `json:"cancel_url"`            // 必填:买家取消回跳(req.CancelURL)
	UserAction string `json:"user_action,omitempty"` // 空=SUBSCRIBE_NOW(收银台直接显示订阅按钮)
}

type hateoasLink struct {
	Href string `json:"href"`
	Rel  string `json:"rel"`
}

type createSubscriptionResp struct {
	ID     string        `json:"id"` // SUB-xxx = 稳定订阅引用(SessionRef)
	Status string        `json:"status"`
	Links  []hateoasLink `json:"links"`
}

// approveSessionTTL:PayPal 未返回 APPROVAL_PENDING 会话的过期时刻,这里给
// 清扫工一个保守兜底窗口(24h,同 waffo 缺省);真实过期由 PayPal 侧
// approve 链接失效决定,清扫是幂等兜底不是时钟真源。
const approveSessionTTL = 24 * time.Hour

func (c *Channel) CreateCheckout(ctx context.Context, req app.CheckoutRequest) (domain.CheckoutSession, error) {
	order := req.Order
	// 一次性结账(credit packs 场景)走 Orders v2 API,与订阅结账是完全
	// 不同的载荷族 —— 本产品现阶段只卖订阅,one_time 显式拒绝而不是静默
	// 发一个必然失败的订阅请求。Orders v2 适配留作后续扩展点。
	if order.Interval == domain.IntervalOneTime {
		return domain.CheckoutSession{}, webx.NewValidation(
			"paypal channel: one-time checkout is not supported yet (Orders v2 reserved); subscription intervals only")
	}
	// BC-7:目录型渠道只认服务层解析出的渠道商品映射(paypal = plan id)。
	// 未注册时服务层已拦(Config.AutoRegisterCatalog),这里兜底报清晰错误,
	// 不让一个必然失败的结账出网。
	planID := strings.TrimSpace(req.ChannelProductID)
	if planID == "" {
		return domain.CheckoutSession{}, webx.NewValidation(fmt.Sprintf(
			"paypal channel: no plan registered for plan %s (%s); register it in the admin billing page",
			order.PlanCode, string(order.Interval)))
	}

	body := createSubscriptionReq{
		PlanID:             planID,
		CustomID:           order.ID,
		ApplicationContext: &applicationContextReq{ReturnURL: req.SuccessURL, CancelURL: req.CancelURL},
	}
	if req.BuyerEmail != "" {
		body.Subscriber = &subscriberReq{EmailAddress: req.BuyerEmail}
	}
	if req.Locale != "" {
		body.ApplicationContext.Locale = req.Locale
	}
	var resp createSubscriptionResp
	if err := c.client.do(ctx, http.MethodPost, "/v1/billing/subscriptions", body, &resp); err != nil {
		return domain.CheckoutSession{}, fmt.Errorf("paypal: create subscription: %w", err)
	}
	if resp.ID == "" {
		return domain.CheckoutSession{}, errors.New("paypal: create subscription: empty subscription id in response")
	}
	approveURL := ""
	for _, l := range resp.Links {
		if l.Rel == "approve" {
			approveURL = l.Href
			break
		}
	}
	if approveURL == "" {
		return domain.CheckoutSession{}, fmt.Errorf("paypal: create subscription %s: response has no rel=approve link", resp.ID)
	}
	return domain.CheckoutSession{
		OrderID:    order.ID,
		Channel:    c.Name(),
		ActionURL:  approveURL,
		SessionRef: resp.ID, // SUB-xxx → order.channel_ref(订阅家族事件的订单反查键)
		ExpiresAt:  time.Now().UTC().Add(approveSessionTTL),
	}, nil
}

// ---- CancelSubscription ----

// cancelSubscriptionReq POST /v1/billing/subscriptions/{id}/cancel;
// reason 必填(1-128 字符,PayPal 文档)。
type cancelSubscriptionReq struct {
	Reason string `json:"reason"`
}

const cancelReason = "Canceled at the request of the merchant platform"

// CancelSubscription 实现 app.SubscriptionCanceller。providerSubID 就是我们
// 落的 SubscriptionRef = PayPal 订阅 id(SUB-xxx,billing_agreement_id 与之
// 同值)。成功 = 204 空响应。
func (c *Channel) CancelSubscription(ctx context.Context, providerSubID string) error {
	if strings.TrimSpace(providerSubID) == "" {
		return webx.NewValidation("paypal: cancel subscription: empty subscription reference")
	}
	path := "/v1/billing/subscriptions/" + urlPathEscape(providerSubID) + "/cancel"
	if err := c.client.do(ctx, http.MethodPost, path, cancelSubscriptionReq{Reason: cancelReason}, nil); err != nil {
		return fmt.Errorf("paypal: cancel subscription %s: %w", providerSubID, err)
	}
	return nil
}

// ---- TestConnection(BC-2 可选探活) ----

// TestConnection 取一次 OAuth token 即探活:2xx = client id/secret 正确、
// 网络通、API 主机选对(mode);401 = 凭据错(INVALID_CLIENT)。没有更便宜的
// 无副作用读 —— PayPal 的 hello 端点也要 Bearer。
func (c *Channel) TestConnection(ctx context.Context) error {
	if _, err := c.client.token(ctx); err != nil {
		return fmt.Errorf("paypal: test connection: %w", err)
	}
	return nil
}

// ---- ParseWebhook:验签 + 事件映射 ----

// verifyWebhookReq POST /v1/notifications/verify-webhook-signature 请求体
// (https://developer.paypal.com/api/webhooks/v1/):前五项逐头取自
// PAYPAL-AUTH-ALGO / PAYPAL-CERT-URL / PAYPAL-TRANSMISSION-ID /
// PAYPAL-TRANSMISSION-SIG / PAYPAL-TRANSMISSION-TIME,webhook_id 来自
// 开发者后台配置(必配,缺它验签必败),webhook_event = 收到的**原始**
// 事件 JSON(RawMessage 原样透传,再序列化必须逐字节等价)。
type verifyWebhookReq struct {
	AuthAlgo         string          `json:"auth_algo"`
	CertURL          string          `json:"cert_url"`
	TransmissionID   string          `json:"transmission_id"`
	TransmissionSig  string          `json:"transmission_sig"`
	TransmissionTime string          `json:"transmission_time"`
	WebhookID        string          `json:"webhook_id"`
	WebhookEvent     json.RawMessage `json:"webhook_event"`
}

type verifyWebhookResp struct {
	VerificationStatus string `json:"verification_status"` // SUCCESS / FAILURE
}

// webhookEnvelope PayPal webhook 顶层:id(WH-xxx,事件级唯一)、
// event_type、resource_type、resource(随事件族异构)。
type webhookEnvelope struct {
	ID           string          `json:"id"`
	EventType    string          `json:"event_type"`
	ResourceType string          `json:"resource_type"`
	Resource     json.RawMessage `json:"resource"`
}

// webhookResource 把三类 resource 形态叠进一个结构(BILLING.SUBSCRIPTION.*
// = subscription 对象、PAYMENT.SALE.COMPLETED = v1 sale 对象、
// PAYMENT.SALE.REFUNDED = refund 对象),未用字段留零值。
type webhookResource struct {
	// subscription 对象:id=SUB-xxx,status=ACTIVE/CANCELLED/…,
	// custom_id=建订阅时塞的 ploykit 订单号;不携带金额。
	ID       string `json:"id"`
	Status   string `json:"status"`
	CustomID string `json:"custom_id"`
	// sale 对象:billing_agreement_id = 订阅 id(SUB-xxx,销售家族与订阅
	// 家族事件的汇合点);amount = v1 金额对象 {currency,total}。
	BillingAgreementID string     `json:"billing_agreement_id"`
	Amount             *flexMoney `json:"amount"`
	// refund 对象:sale_id = 被退的那笔 sale(若在载荷);
	// total_refunded_amount = 该 sale 累计退款额(部分退款多次时,
	// amount 是本次、total_refunded_amount 是累计)。
	SaleID              string     `json:"sale_id"`
	TotalRefundedAmount *flexMoney `json:"total_refunded_amount"`
}

// flexMoney 兼容 PayPal 两代金额形态:v1 {currency,total}(sale/refund
// webhook)与 v2 {currency_code,value}(个别载荷/新形态)。取值 total 兜底
// value(或反之),换算统一走 billing/money(BC-3)。
type flexMoney struct {
	CurrencyCode string `json:"currency_code"`
	Currency     string `json:"currency"`
	Value        string `json:"value"`
	Total        string `json:"total"`
}

func (m *flexMoney) amount() string {
	if m == nil {
		return ""
	}
	if strings.TrimSpace(m.Value) != "" {
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

// ParseWebhook 先调 PayPal 验签 API(五头一 ID 一原始事件),SUCCESS 才进入
// 事件映射;网络错误或非 SUCCESS 一律算验签失败(ploykit 回 401,不落库)。
// 五律 4:ChannelEventID = event_type + ":" + id —— 幂等键 (channel,
// channel_event_id) 无事件类型维度,而 PayPal 资源 id(SUB-xxx/sale id)
// 会在同一对象的不同事件间复用,不拼类型会把后到的合法事件当重复吞掉。
func (c *Channel) ParseWebhook(ctx context.Context, req app.WebhookRequest) (domain.PaymentEvent, error) {
	if c.webhookID == "" {
		return domain.PaymentEvent{}, errors.New("paypal: webhook id not configured (PAYPAL_WEBHOOK_ID) — signature verification would always fail")
	}
	authAlgo := headerGet(req.Header, "PAYPAL-AUTH-ALGO")
	certURL := headerGet(req.Header, "PAYPAL-CERT-URL")
	transmissionID := headerGet(req.Header, "PAYPAL-TRANSMISSION-ID")
	transmissionSig := headerGet(req.Header, "PAYPAL-TRANSMISSION-SIG")
	transmissionTime := headerGet(req.Header, "PAYPAL-TRANSMISSION-TIME")
	for name, v := range map[string]string{
		"PAYPAL-AUTH-ALGO":         authAlgo,
		"PAYPAL-CERT-URL":          certURL,
		"PAYPAL-TRANSMISSION-ID":   transmissionID,
		"PAYPAL-TRANSMISSION-SIG":  transmissionSig,
		"PAYPAL-TRANSMISSION-TIME": transmissionTime,
	} {
		if v == "" {
			return domain.PaymentEvent{}, webx.NewValidation("missing " + name + " header")
		}
	}
	if len(req.Body) == 0 {
		return domain.PaymentEvent{}, webx.NewValidation("empty webhook body")
	}

	var verify verifyWebhookResp
	err := c.client.do(ctx, http.MethodPost, "/v1/notifications/verify-webhook-signature", verifyWebhookReq{
		AuthAlgo:         authAlgo,
		CertURL:          certURL,
		TransmissionID:   transmissionID,
		TransmissionSig:  transmissionSig,
		TransmissionTime: transmissionTime,
		WebhookID:        c.webhookID,
		WebhookEvent:     json.RawMessage(req.Body), // 原始 JSON 逐字节透传
	}, &verify)
	if err != nil {
		return domain.PaymentEvent{}, fmt.Errorf("paypal: verify webhook signature: %w", err)
	}
	if !strings.EqualFold(verify.VerificationStatus, "SUCCESS") {
		return domain.PaymentEvent{}, webx.NewValidation("paypal webhook signature verification failed: status " + verify.VerificationStatus)
	}

	var env webhookEnvelope
	if err := json.Unmarshal(req.Body, &env); err != nil {
		return domain.PaymentEvent{}, fmt.Errorf("paypal: decode webhook payload: %w", err)
	}
	var res webhookResource
	if len(env.Resource) > 0 {
		if err := json.Unmarshal(env.Resource, &res); err != nil {
			return domain.PaymentEvent{}, fmt.Errorf("paypal: decode webhook resource: %w", err)
		}
	}

	ev := domain.PaymentEvent{
		Channel:        c.Name(),
		ChannelEventID: env.EventType + ":" + env.ID, // 五律 4:拼类型
	}
	// 五律 5:PayPal 载荷不携带 mode 标记,把渠道配置的 mode 记入 Payload
	// 供审计(沙箱/生产回调隔离由凭据分离保证:webhook id 分环境、跨环境
	// 验签必败)。
	if c.mode != "" {
		ev.Payload = map[string]any{"mode": c.mode}
	}
	switch env.EventType {
	case "BILLING.SUBSCRIPTION.ACTIVATED":
		// 首付款到账(买家批准 + 首期扣款完成),发权益 + 落订阅引用。
		// subscription 对象不携带金额 → AmountCents=0;amountMismatch 对
		// 0 走忽略路径不参与对账,首期金额对账交给常与 ACTIVATED 同拍
		// 到达的 PAYMENT.SALE.COMPLETED。
		ev.Type = domain.EventCheckoutCompleted
		ev.OrderID = res.CustomID
		ev.SubscriptionRef = res.ID
		ev.ChannelRef = res.ID
	case "PAYMENT.SALE.COMPLETED":
		// "钱到账"事件(五律 1):首期与每期续费都发 ——
		//   * 首期与 ACTIVATED 双发:SALE 先到则 handleRenewed 按
		//     SubscriptionRef 查 workspace_subscription 未落、自然忽略;
		//     SALE 后到则 addInterval 是绝对值重设到期日(非叠加),
		//     不会把 pro_until 推两个周期 —— 两种次序都安全,故这里
		//     不做周期号区分(PayPal 也不给)。
		//   * sale 对象没有 custom_id,OrderID 留空,订阅推进完全走
		//     SubscriptionRef(billing_agreement_id=SUB-xxx)路径。
		ev.Type = domain.EventSubscriptionRenewed
		ev.SubscriptionRef = res.BillingAgreementID
		ev.ChannelRef = res.BillingAgreementID
		ev.AmountCents = money.ParseAmount(res.Amount.amount())
		ev.Currency = res.Amount.currency()
		ev.PaymentIntentRef = res.ID // sale id:退款反查锚(SetOrderPaymentIntentRef)
	case "BILLING.SUBSCRIPTION.CANCELLED":
		ev.Type = domain.EventSubscriptionCanceled
		ev.OrderID = res.CustomID
		ev.SubscriptionRef = res.ID
		ev.ChannelRef = res.ID
	case "PAYMENT.SALE.REFUNDED":
		// 金额取本次退款额(resource.amount);载荷缺失时退化累计额
		// (total_refunded_amount)。"amount_refunded" 字段在 PayPal
		// refund 对象里不存在(实测 schema:amount + total_refunded_amount)。
		ev.Type = domain.EventRefundCreated
		amount := res.Amount.amount()
		if amount == "" {
			amount = res.TotalRefundedAmount.amount()
		}
		ev.AmountCents = money.ParseAmount(amount)
		ev.Currency = firstNonEmpty(res.Amount.currency(), res.TotalRefundedAmount.currency())
		// 订单反查:refund 对象优先给 billing_agreement_id(= 订阅 id,
		// 命中 order.channel_ref=SessionRef 的反查路径);不在载荷时退化
		// sale_id(FindOrderByPaymentIntent)+ 本退款 id。
		if res.BillingAgreementID != "" {
			ev.ChannelRef = res.BillingAgreementID
			ev.SubscriptionRef = res.BillingAgreementID // handleRefund 顺手清 workspace_subscription
		} else {
			ev.ChannelRef = res.ID
		}
		if res.SaleID != "" {
			ev.PaymentIntentRef = res.SaleID
		}
	default:
		// SUSPENDED/EXPIRED/UPDATED/CREATED/…(订阅状态中间态,权益到期
		// 末由 ExpireDueWorkspaces 清算,不在事件里抢跑)、
		// BILLING.SUBSCRIPTION.PAYMENT.FAILED(PayPal 侧自动重试催收,
		// 与 waffo past_due 同判:失败订单路线留给显式拒付)、
		// PAYMENT.SALE.DENIED/PENDING/REVERSED、DISPUTE.*(争议走人工)。
		ev.Type = "ignored"
	}
	return ev, nil
}

// ---- ChannelConfig / ConfigSchema(BC-2/BC-5/BC-6) ----

// ChannelConfig 进 billing 配置面:webhook id 未配时如实标未配置 ——
// 收银台能开但回调验签必败,运营必须看得见这个半残态。
func (c *Channel) ChannelConfig() app.ChannelConfigInfo {
	configured := c.client != nil && c.client.ClientID != "" && c.client.ClientSecret != ""
	return app.ChannelConfigInfo{
		Configured:        configured,
		KeyMasked:         maskID(c.clientID()),
		WebhookConfigured: c.webhookID != "",
	}
}

func (c *Channel) clientID() string {
	if c.client == nil {
		return ""
	}
	return c.client.ClientID
}

// ConfigSchema 实现 app.ChannelSchemaViewer(BC-6):后台渠道卡的表单按
// 此描述符渲染,字段键同时是 billing_channel.paypal.<field> 设置键与
// NewFromFields 的 fields 键 —— 三处一份真源。
func (c *Channel) ConfigSchema() []app.FieldSpec {
	return []app.FieldSpec{
		{Key: FieldClientID, Label: "Client ID", Type: app.FieldTypeText, Required: true,
			Help: "PayPal 开发者后台 App 的 Client ID(sandbox/live 两套凭据各自独立,勿混用)"},
		{Key: FieldClientSecret, Label: "Client Secret", Type: app.FieldTypeSecret, Required: true,
			Help: "与 Client ID 配对,App 详情页 Show client secret 复制"},
		{Key: FieldWebhookID, Label: "Webhook ID", Type: app.FieldTypeText, Required: true,
			Help: "开发者后台 App 的 Webhook ID,验签必需(与回调 URL 配对注册;不配则回调全部拒收)"},
		{Key: FieldMode, Label: "环境模式", Type: app.FieldTypeSelect, Required: true,
			Help: "test = api-m.sandbox.paypal.com 沙箱;prod = api-m.paypal.com 生产。注意:PayPal 订阅按 plan 价格收款(无会话级改价),DB 改价后必须在渠道页同步价格,否则旧价付款会被金额对账拒付",
			Options: []app.FieldOption{
				{Value: ModeTest, Label: "test(沙箱)"},
				{Value: ModeProd, Label: "prod(生产)"},
			}},
	}
}

// ---- ProductRegistrar(BC-7,目录型商品映射) ----

// createProductReq POST /v1/catalogs/products:type=SERVICE(订阅类服务的
// 正确类型;PHYSICAL/DIGITAL 是实物/数字商品)。name 带 (Monthly/Yearly)
// 档位后缀 —— 每个 plan+interval 建一对 product+plan,PayPal 后台可辨识;
// 幂等由服务层 GetChannelProduct 先查映射保证(RegisterChannelProduct)。
type createProductReq struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Type        string `json:"type"`
}

type createProductResp struct {
	ID string `json:"id"` // PROD-xxx
}

type fixedPrice struct {
	CurrencyCode string `json:"currency_code"`
	Value        string `json:"value"` // 展示字符串("9.90"),billing/money 换算
}

type pricingScheme struct {
	FixedPrice fixedPrice `json:"fixed_price"`
}

// billingCycle 一个计费周期:REGULAR 正式期、sequence 1、total_cycles 0
// (= 无限续期,直到取消),频率 monthly=MONTH×1 / yearly=YEAR×1。
type billingCycle struct {
	Frequency struct {
		IntervalUnit  string `json:"interval_unit"` // MONTH | YEAR
		IntervalCount int    `json:"interval_count"`
	} `json:"frequency"`
	TenureType    string        `json:"tenure_type"`
	Sequence      int           `json:"sequence"`
	PricingScheme pricingScheme `json:"pricing_scheme"`
	TotalCycles   int           `json:"total_cycles"`
}

type paymentPreferences struct {
	AutoBillOutstanding     bool   `json:"auto_bill_outstanding"`
	SetupFeeFailureAction   string `json:"setup_fee_failure_action"` // CONTINUE(无 setup fee,仅为字段完备)
	PaymentFailureThreshold int    `json:"payment_failure_threshold"`
}

// createPlanReq POST /v1/billing/plans。status=ACTIVE:文档允许建后直接
// ACTIVE(缺省即 ACTIVE,显式传明确意图),省掉一次 /activate 往返。
type createPlanReq struct {
	ProductID          string             `json:"product_id"`
	Name               string             `json:"name"`
	Description        string             `json:"description,omitempty"`
	Status             string             `json:"status"`
	BillingCycles      []billingCycle     `json:"billing_cycles"`
	PaymentPreferences paymentPreferences `json:"payment_preferences"`
}

type createPlanResp struct {
	ID     string `json:"id"` // P-xxx = 渠道商品 ID(CreateCheckout 的 plan_id)
	Status string `json:"status"`
}

// updatePricingSchemesReq POST /v1/billing/plans/{id}/update-pricing-schemes
// (注意:复数 schemes,204 空响应)。billing_cycle_sequence 指向建 plan 时
// sequence=1 的 REGULAR 周期。
type updatePricingSchemesReq struct {
	PricingSchemes []struct {
		BillingCycleSequence int           `json:"billing_cycle_sequence"`
		PricingScheme        pricingScheme `json:"pricing_scheme"`
	} `json:"pricing_schemes"`
}

// intervalUnit 把 ploykit 计费档位翻成 PayPal 频率单位。
func intervalUnit(interval domain.BillingInterval) (string, string, error) {
	switch interval {
	case domain.IntervalMonthly:
		return "MONTH", "Monthly", nil
	case domain.IntervalYearly:
		return "YEAR", "Yearly", nil
	default:
		return "", "", webx.NewValidation("paypal: subscription plans support monthly/yearly only, got: " + string(interval))
	}
}

// planPrice 为 plan+interval 组装 fixed_price:价格真源在 DB plan limits
// (app.PlanPriceCents),currency 取 plan.Currency(空=USD,与 waffo 同约)。
func planPrice(plan domain.Plan, interval domain.BillingInterval) (fixedPrice, error) {
	cents := app.PlanPriceCents(plan, interval)
	if cents <= 0 {
		return fixedPrice{}, webx.NewValidation(fmt.Sprintf("paypal: plan %s is not priced for %s", plan.Code, string(interval)))
	}
	currency := strings.ToUpper(strings.TrimSpace(plan.Currency))
	if currency == "" {
		currency = "USD"
	}
	return fixedPrice{CurrencyCode: currency, Value: money.FormatCents(cents, currency)}, nil
}

// RegisterProduct 实现 app.ProductRegistrar:两步链 —— 建 product
// (PROD-xxx,SERVICE)→ 建 plan(P-xxx,status=ACTIVE,固定价=当前 DB 价),
// 返回 **plan id**(对 paypal 而言渠道商品 = plan,CreateCheckout 的
// ChannelProductID 就是它)。
func (c *Channel) RegisterProduct(ctx context.Context, plan domain.Plan, interval domain.BillingInterval) (string, error) {
	unit, display, err := intervalUnit(interval)
	if err != nil {
		return "", err
	}
	price, err := planPrice(plan, interval)
	if err != nil {
		return "", err
	}
	name := plan.Name
	if name == "" {
		name = plan.Code
	}
	suffix := " (" + display + ")"

	var productResp createProductResp
	if err := c.client.do(ctx, http.MethodPost, "/v1/catalogs/products", createProductReq{
		Name:        name + suffix,
		Description: "ploykit plan " + plan.Code + " (" + string(interval) + ")",
		Type:        "SERVICE",
	}, &productResp); err != nil {
		return "", fmt.Errorf("paypal: create product %s/%s: %w", plan.Code, string(interval), err)
	}
	if productResp.ID == "" {
		return "", fmt.Errorf("paypal: create product %s/%s: empty product id in response", plan.Code, string(interval))
	}

	var planReq createPlanReq
	planReq.ProductID = productResp.ID
	planReq.Name = name + suffix
	planReq.Description = "Subscription plan " + plan.Code + " (" + display + ")"
	planReq.Status = "ACTIVE"
	planReq.BillingCycles = []billingCycle{{
		Frequency: struct {
			IntervalUnit  string `json:"interval_unit"`
			IntervalCount int    `json:"interval_count"`
		}{IntervalUnit: unit, IntervalCount: 1},
		TenureType:    "REGULAR",
		Sequence:      1,
		PricingScheme: pricingScheme{FixedPrice: price},
		TotalCycles:   0, // 无限续期
	}}
	planReq.PaymentPreferences = paymentPreferences{
		AutoBillOutstanding:     true,
		SetupFeeFailureAction:   "CONTINUE",
		PaymentFailureThreshold: 1,
	}
	var planResp createPlanResp
	if err := c.client.do(ctx, http.MethodPost, "/v1/billing/plans", planReq, &planResp); err != nil {
		return "", fmt.Errorf("paypal: create plan %s/%s: %w", plan.Code, string(interval), err)
	}
	if planResp.ID == "" {
		return "", fmt.Errorf("paypal: create plan %s/%s: empty plan id in response", plan.Code, string(interval))
	}
	return planResp.ID, nil
}

// SyncPrice 实现 app.ProductRegistrar:把 plan 当前 DB 价推给已注册 plan
// (BC-7 改价联动)。**对 paypal 这是刚性依赖**:订阅无会话级改价,不同步
// 就是按旧价收款 → amountMismatch 拒付。
func (c *Channel) SyncPrice(ctx context.Context, channelProductID string, plan domain.Plan, interval domain.BillingInterval) error {
	if strings.TrimSpace(channelProductID) == "" {
		return webx.NewValidation("paypal: sync price: empty channel product id")
	}
	price, err := planPrice(plan, interval)
	if err != nil {
		return err
	}
	req := updatePricingSchemesReq{PricingSchemes: []struct {
		BillingCycleSequence int           `json:"billing_cycle_sequence"`
		PricingScheme        pricingScheme `json:"pricing_scheme"`
	}{{BillingCycleSequence: 1, PricingScheme: pricingScheme{FixedPrice: price}}}}
	path := "/v1/billing/plans/" + urlPathEscape(channelProductID) + "/update-pricing-schemes"
	if err := c.client.do(ctx, http.MethodPost, path, req, nil); err != nil {
		return fmt.Errorf("paypal: update plan %s pricing: %w", channelProductID, err)
	}
	return nil
}

// ---- helpers ----

// urlPathEscape 防御性转义路径段(id 全来自渠道侧响应,不放松警惕)。
func urlPathEscape(s string) string {
	return strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_' {
			return r
		}
		return -1
	}, s)
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
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

// 编译期断言:满足 ploykit 渠道接口与全部可选能力面(BC-2/BC-7)。
var (
	_ app.PaymentChannel          = (*Channel)(nil)
	_ app.ChannelCapabilityViewer = (*Channel)(nil)
	_ app.ChannelConfigViewer     = (*Channel)(nil)
	_ app.ChannelSchemaViewer     = (*Channel)(nil)
	_ app.ConnectionTester        = (*Channel)(nil)
	_ app.SubscriptionCanceller   = (*Channel)(nil)
	_ app.ProductRegistrar        = (*Channel)(nil)
)
