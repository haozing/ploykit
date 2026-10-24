// Package paypal 实现 ploykit billing 的 PayPal 支付渠道
// (billing/app.PaymentChannel),走 PayPal Subscriptions + Catalog Products
// REST API(目录型渠道家族,与 waffo 同类;BC-8 = 框架成色的试金石,
// 零内核改动接入):
//
//	POST /v1/oauth2/token                                 OAuth2 取 token(Basic auth,缓存到 expiry-60s)
//	POST /v1/catalogs/products                            建 product(PROD-xxx,RegisterProduct 第一步)
//	POST /v1/billing/plans                                建 plan(P-xxx,RegisterProduct 第二步;status=ACTIVE 直接可用)
//	POST /v1/billing/plans/{id}/update-pricing-schemes   改价(SyncPrice;204 空响应)
//	POST /v1/billing/subscriptions                        创建订阅结账(APPROVAL_PENDING + rel=approve 链接)
//	POST /v1/billing/subscriptions/{id}/cancel            取消订阅(reason 必填,1-128 字符)
//	POST /v1/notifications/verify-webhook-signature       webhook 验签(七字段,五头一 ID 一原始事件)
//	POST /webhooks/billing/paypal(产品仓路由)           接收 PayPal 事件推送
//
// 环境:mode=test → api-m.sandbox.paypal.com,mode=prod → api-m.paypal.com
// (PAYPAL_API_BASE 可覆盖,测试指向 httptest server)。沙箱与生产是两套
// 完全独立的 App(client id/secret/webhook id 各一套),PayPal 事件载荷不携带
// mode 标记 —— 五律 5 的跨环境隔离由凭据天然分离保证(沙箱回调打到生产配置
// 的 webhook id 上,验签必败),渠道自身配置的 mode 记入事件 Payload 供审计。
//
// 订阅标识:checkout 会话的 SessionRef = 订阅 id(SUB-xxx),随
// SetOrderChannelRefAndExpiry 落 order.channel_ref;custom_id = ploykit 订单号,
// BILLING.SUBSCRIPTION.* 事件原样回传(订单反查键);PAYMENT.SALE.* 事件的
// billing_agreement_id = 订阅 id(订阅家族事件与销售家族事件的汇合点)。
//
// 价格(目录型渠道的第二家族特征,与 waffo 的差异点):PayPal 订阅**没有会话级
// 改价** —— 收款价就是 plan 的 pricing_scheme.fixed_price,DB 改价后必须
// SyncPrice 推到 PayPal plan,否则用户按旧价付款、amountMismatch 拒发权益
// (SALE 事件金额 != 订单金额)。CreateCheckout 只带 plan_id,不带任何价格。
//
// 事件映射(→ ploykit domain.PaymentEvent,五律执行):
//
//	BILLING.SUBSCRIPTION.ACTIVATED → checkout.completed(OrderID=custom_id,
//	  SubscriptionRef=订阅 id,AmountCents=0:订阅对象不携带金额,amountMismatch
//	  对 0 走忽略路径,首期金额对账交给同拍的 SALE 事件)
//	PAYMENT.SALE.COMPLETED         → subscription.renewed(SubscriptionRef=
//	  billing_agreement_id,AmountCents=resource.amount(total/value 双形态),
//	  PaymentIntentRef=sale id 供退款反查)
//	BILLING.SUBSCRIPTION.CANCELLED → subscription.canceled(SubscriptionRef=订阅 id)
//	PAYMENT.SALE.REFUNDED          → refund.created(AmountCents=resource.amount
//	  或 total_refunded_amount 兜底,PaymentIntentRef=resource.sale_id)
//	其余(SUSPENDED/EXPIRED/UPDATED/CREATED/DISPUTE.*/PAYMENT.FAILED…) → ignored
package paypal

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/haozing/ploykit/billing/app"
)

// 环境变量名(密钥一律走 env 或 BC-5 后台落库,绝不入日志)。
const (
	EnvClientID     = "PAYPAL_CLIENT_ID"
	EnvClientSecret = "PAYPAL_CLIENT_SECRET"
	EnvWebhookID    = "PAYPAL_WEBHOOK_ID"
	EnvMode         = "PAYPAL_MODE"
	EnvAPIBase      = "PAYPAL_API_BASE" // 测试覆盖(指向 httptest server);生产留空按 mode 选
)

// ConfigSchema 字段键(BC-5/BC-6:后台渠道卡的表单字段名,同时是
// billing_channel.paypal.<field> 设置键与 NewFromFields 的 fields 键)。
const (
	FieldClientID     = "client_id"
	FieldClientSecret = "client_secret"
	FieldWebhookID    = "webhook_id"
	FieldMode         = "mode"
)

// envOfField 把 ConfigSchema 字段键映射到环境变量名(DB 值覆盖 env 值的
// 装配只用同一张表,BC-5)。
var envOfField = map[string]string{
	FieldClientID:     EnvClientID,
	FieldClientSecret: EnvClientSecret,
	FieldWebhookID:    EnvWebhookID,
	FieldMode:         EnvMode,
}

// 渠道模式常量(BC-4 五律 5;waffo 同款词汇表:test/prod)。
const (
	ModeTest = "test"
	ModeProd = "prod"
)

// API 主机(https://developer.paypal.com/api/rest/authentication/):
// 沙箱 api-m.sandbox.paypal.com,生产 api-m.paypal.com。
const (
	SandboxAPIBase = "https://api-m.sandbox.paypal.com"
	LiveAPIBase    = "https://api-m.paypal.com"
)

// Config 组装渠道所需的全部外部输入。
type Config struct {
	ClientID     string // 开发者后台 App 的 Client ID(sandbox/live 两套)
	ClientSecret string // 与 Client ID 配对的 secret
	WebhookID    string // 开发者后台 App 的 Webhook ID;为空则 webhook 验签必败(半残态:收银台能开、回调进不来)
	Mode         string // 空 = test(沙箱安全缺省);"test"/"prod"
	APIBase      string // 空 = 按 Mode 选;测试指向 httptest server
}

// FromEnv 从环境装配渠道,纪律照抄 waffo.FromEnv:四个必填变量
// (client_id+client_secret+webhook_id+mode)全缺 = 未配置,返回
// *app.DisabledChannel 桩(后台渠道页可见可贴密钥,活动渠道集 /config
// 不含它);缺任何一个 = 配置事故 —— production 直接报错拒启
// (收银台半残等于丢钱),dev 打 warn 降级为桩,不挡本地开发。
// 返回类型是 app.PaymentChannel 接口直返:typed-nil 陷阱(nil *Channel
// 包成非 nil 接口)从签名上消失,调用方无需再判 nil 重包装。
func FromEnv(getenv func(string) string, log *slog.Logger, production bool) (app.PaymentChannel, error) {
	clientID := getenv(EnvClientID)
	clientSecret := getenv(EnvClientSecret)
	webhookID := getenv(EnvWebhookID)
	mode := getenv(EnvMode)

	missing := make([]string, 0, 4)
	for name, v := range map[string]string{
		EnvClientID:     clientID,
		EnvClientSecret: clientSecret,
		EnvWebhookID:    webhookID,
		EnvMode:         mode,
	} {
		if strings.TrimSpace(v) == "" {
			missing = append(missing, name)
		}
	}
	switch len(missing) {
	case 4:
		return unconfiguredStub(), nil // 未配置:注册桩,后台可贴密钥启用
	case 0:
		// 完整,落到下方 New
	default:
		if production {
			return nil, fmt.Errorf("paypal: partial paypal config (missing %s) would ship a dead checkout",
				strings.Join(missing, ", "))
		}
		log.Warn("paypal: partial paypal config, channel disabled", "missing", strings.Join(missing, ","))
		return unconfiguredStub(), nil
	}

	ch, err := New(Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		WebhookID:    webhookID,
		Mode:         mode,
		APIBase:      getenv(EnvAPIBase),
	})
	if err != nil {
		return nil, err
	}
	return ch, nil
}

// unconfiguredStub builds the paypal DisabledChannel placeholder (schema/caps
// from the package-level single sources).
func unconfiguredStub() app.PaymentChannel {
	return app.NewDisabledChannel("paypal", Schema(), Caps())
}

// NewFromFields 按 BC-5 装配:字段值(fields,键=ConfigSchema 字段名,来自
// billing_channel.paypal.* 设置行)优先,缺失回退进程 env(env-only 老接法
// 不断)。与 FromEnv 的纪律差异:webhook_id/mode 不再必填 —— DB 渐进配置期
// 允许先通收银台后贴 webhook id(半残态由 ChannelConfig().WebhookConfigured
// 如实暴露),mode 缺省 test(沙箱安全方向:配错只炸收银台,不会拿沙箱
// 密钥打到生产 API);client_id+client_secret 仍全缺=未配置(返回
// DisabledChannel 桩,后台渠道页可见可贴密钥)、缺一报错(production
// 拒启/dev 降级为桩),与 waffo.NewFromFields 同哲学。返回类型是
// app.PaymentChannel 接口直返 —— typed-nil 陷阱从签名上消失。
func NewFromFields(fields map[string]string, getenv func(string) string, log *slog.Logger, production bool) (app.PaymentChannel, error) {
	if getenv == nil {
		getenv = func(string) string { return "" }
	}
	lookup := func(field string) string {
		if v, ok := fields[field]; ok && strings.TrimSpace(v) != "" {
			return v
		}
		return getenv(envOfField[field])
	}

	clientID := lookup(FieldClientID)
	clientSecret := lookup(FieldClientSecret)
	missing := make([]string, 0, 2)
	for name, v := range map[string]string{EnvClientID: clientID, EnvClientSecret: clientSecret} {
		if strings.TrimSpace(v) == "" {
			missing = append(missing, name)
		}
	}
	switch len(missing) {
	case 2:
		return unconfiguredStub(), nil // 未配置:注册桩,后台可贴密钥启用
	case 1:
		if production {
			return nil, fmt.Errorf("paypal: partial paypal config (missing %s) would ship a dead checkout",
				missing[0])
		}
		log.Warn("paypal: partial paypal config, channel disabled", "missing", strings.Join(missing, ","))
		return unconfiguredStub(), nil
	}

	ch, err := New(Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		WebhookID:    lookup(FieldWebhookID),
		Mode:         lookup(FieldMode),
		APIBase:      getenv(EnvAPIBase),
	})
	if err != nil {
		return nil, err
	}
	return ch, nil
}

// normalizeMode 收敛 "test"/"prod"(大小写;sandbox→test、production/live→prod
// 别名);其余值视为未声明(缺省沙箱)。
func normalizeMode(v string) string {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case ModeTest, "sandbox":
		return ModeTest
	case ModeProd, "production", "live":
		return ModeProd
	default:
		return ""
	}
}

// apiBaseFor 按 mode 选 API 主机;mode 未声明时取沙箱(安全缺省)。
func apiBaseFor(mode string) string {
	if mode == ModeProd {
		return LiveAPIBase
	}
	return SandboxAPIBase
}

// New 校验并构造渠道。client 凭据缺失立刻报错 —— 半配置不能等到第一笔
// 收款才发现。webhook_id 可空(验签必败的半残态在 ChannelConfig 可见)。
func New(cfg Config) (*Channel, error) {
	if strings.TrimSpace(cfg.ClientID) == "" {
		return nil, errors.New("paypal: client id is required")
	}
	if strings.TrimSpace(cfg.ClientSecret) == "" {
		return nil, errors.New("paypal: client secret is required")
	}
	mode := normalizeMode(cfg.Mode)
	base := strings.TrimRight(cfg.APIBase, "/")
	if base == "" {
		base = apiBaseFor(mode)
	}
	return &Channel{
		client: &Client{
			ClientID:     cfg.ClientID,
			ClientSecret: cfg.ClientSecret,
			BaseURL:      base,
			HTTP:         &http.Client{Timeout: 15 * time.Second},
		},
		webhookID: strings.TrimSpace(cfg.WebhookID),
		mode:      mode,
	}, nil
}
