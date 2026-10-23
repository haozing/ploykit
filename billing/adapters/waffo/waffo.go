// Package waffo 实现 ploykit billing 的 Waffo Pancake(MoR)支付渠道
// (billing/app.PaymentChannel),走 waffo REST API(https://api.waffo.ai):
//
//	POST /v1/actions/checkout/create-session          创建收银台会话
//	POST /v1/actions/subscription-order/cancel-order  取消订阅(BC-9)
//	POST /v1/graphql { stores { id } }                探活(BC-9,同一套请求签名)
//	POST /webhooks/billing/waffo(产品仓路由)         接收 waffo 事件推送
//
// 请求鉴权:RSA-SHA256 签名 —— canonical = METHOD\nPATH\nTIMESTAMP\nB64(SHA256(body)),
// 放 X-Signature;商户号放 X-Merchant-Id,Unix 秒放 X-Timestamp(±5min 窗口)。
// webhook 验签:X-Waffo-Signature: "t=<毫秒>,v1=<b64>",对 "t.rawBody" 用 waffo
// 平台公钥(后台 Settings→Webhooks 复制,按环境区分)验 RSA-SHA256(PKCS1v15),
// 容忍窗口 45min —— waffo 重试原样重放签名头,t 不会重打,防重放靠
// ploykit 按 ChannelEventID 幂等入库,不靠时间窗。
//
// 订阅标识:waffo 事件载荷没有 subscriptionId,data.orderId 在 activated/
// renewed/canceled 全程不变,充当稳定订阅引用(SMS = subscription mark),
// 也是 CancelSubscription 的 providerSubID;checkout 会话 metadata.order_id
// (ploykit 订单号)经 orderMetadata 透传回每个事件,用它反查本地订单
// (resolveOrder 的 OrderID 路径)。
//
// 价格:真源在 DB plan limits($19/$190),waffo 后台商品只是目录壳;创建会话
// 用 priceSnapshot 按 order.AmountCents 覆盖价格,taxIncluded 默认 true ——
// MoR 模式下税款从 $19 里出,买家实付与站内标价一致,handlePaid 的金额
// 对账(chargedAmount == order.AmountCents)才不会把付款拒之门外。
// 金额换算统一走 billing/money(BC-3),本包不再私藏 formatAmount/parseAmount。
//
// 事件映射(→ ploykit domain.PaymentEvent):
//
//	subscription.activated          → checkout.completed(首付款,发权益+落订阅引用)
//	subscription.payment_succeeded  → periodNumber>1: subscription.renewed(续费推进到期日)
//	                                  periodNumber=1: ignored(activated 已覆盖,避免双发)
//	subscription.canceled           → subscription.canceled(降级 free)
//	refund.succeeded                → refund.created(退款撤权)
//	order.completed                 → checkout.completed(一次性,预留卖包)
//	其余(renewed/recovered/canceling/past_due/plan_changed/…) → ignored:
//	  renewed 与 payment_succeeded 双事件同到,只认钱那一条,否则 pro_until
//	  被推进两个周期;canceling 是"期末才停"(等 canceled);past_due 是 waffo
//	  侧催收,权益保留到期末(与 Stripe 路径只失败订单、不降级订阅一致)。
package waffo

import (
	"bytes"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// 环境变量名(生产部署清单见 docs;密钥一律走 env,绝不入库/入日志)。
const (
	EnvMerchantID     = "WAFFO_MERCHANT_ID"
	EnvPrivateKey     = "WAFFO_PRIVATE_KEY"
	EnvProductMonthly = "WAFFO_PRODUCT_MONTHLY"
	EnvProductYearly  = "WAFFO_PRODUCT_YEARLY"
	EnvWebhookPubKey  = "WAFFO_WEBHOOK_PUBLIC_KEY"
	EnvTaxCategory    = "WAFFO_TAX_CATEGORY"
	EnvTaxIncluded    = "WAFFO_TAX_INCLUDED"
	EnvAPIBase        = "WAFFO_API_BASE"
)

// Config 组装渠道所需的全部外部输入。
type Config struct {
	MerchantID       string // MER_xxx
	PrivateKey       string // PEM / 转义 \n PEM / 整段 PEM 的 base64 / 裸 base64 体,四种形态都收
	ProductMonthly   string // PROD_xxx(waffo 后台的 Seller Plan (Monthly))
	ProductYearly    string // PROD_xxx(Seller Plan (Yearly))
	WebhookPublicKey string // 可空;为空则 webhook 一律验签失败(先通收银台、后通回调的部署顺序)
	TaxCategory      string // 空 = "saas"
	TaxIncluded      *bool  // nil = true
	APIBase          string // 空 = DefaultAPIBase
}

// DefaultAPIBase waffo 公有云 API;测试可指向 httptest server。
const DefaultAPIBase = "https://api.waffo.ai"

// FromEnv 从环境装配渠道(BC-1 上游化定名,原产品仓 FromEnvStrict),装配纪律
// 与 bracelet.ProviderFromEnvStrict 同哲学:四个必填变量全缺 = 未配置
// (nil, nil),产品照常跑(无支付渠道);缺任何一个 = 配置事故 ——
// production 直接报错拒启(收银台半残等于丢钱),dev 打 warn 降级跳过,
// 不挡本地开发。
func FromEnv(getenv func(string) string, log *slog.Logger, production bool) (*Channel, error) {
	merchant := getenv(EnvMerchantID)
	privKey := getenv(EnvPrivateKey)
	prodMonthly := getenv(EnvProductMonthly)
	prodYearly := getenv(EnvProductYearly)

	missing := make([]string, 0, 4)
	for name, v := range map[string]string{
		EnvMerchantID:     merchant,
		EnvPrivateKey:     privKey,
		EnvProductMonthly: prodMonthly,
		EnvProductYearly:  prodYearly,
	} {
		if strings.TrimSpace(v) == "" {
			missing = append(missing, name)
		}
	}
	switch len(missing) {
	case 4:
		return nil, nil // 未配置:waffo 不进渠道注册表,/config 也不会暴露
	case 0:
		// 完整,落到下方 New
	default:
		if production {
			return nil, fmt.Errorf("waffo: partial waffo config (missing %s) would ship a dead checkout",
				strings.Join(missing, ", "))
		}
		log.Warn("waffo: partial waffo config, channel disabled", "missing", strings.Join(missing, ","))
		return nil, nil
	}

	taxIncluded := true
	if v := getenv(EnvTaxIncluded); v != "" {
		b, err := strconv.ParseBool(v)
		if err != nil {
			return nil, fmt.Errorf("waffo: %s: %w", EnvTaxIncluded, err)
		}
		taxIncluded = b
	}

	return New(Config{
		MerchantID:       merchant,
		PrivateKey:       privKey,
		ProductMonthly:   prodMonthly,
		ProductYearly:    prodYearly,
		WebhookPublicKey: getenv(EnvWebhookPubKey),
		TaxCategory:      getenv(EnvTaxCategory),
		TaxIncluded:      &taxIncluded,
		APIBase:          getenv(EnvAPIBase),
	})
}

// New 校验并解析密钥,构造渠道。私钥/公钥解析失败立刻报错——半配置
// 不能等到第一笔收款才发现。
func New(cfg Config) (*Channel, error) {
	if strings.TrimSpace(cfg.MerchantID) == "" {
		return nil, errors.New("waffo: merchant id is required")
	}
	key, err := parsePrivateKey(cfg.PrivateKey)
	if err != nil {
		return nil, err
	}
	if cfg.ProductMonthly == "" || cfg.ProductYearly == "" {
		return nil, errors.New("waffo: monthly and yearly product ids are both required")
	}
	var pub *rsa.PublicKey
	if s := strings.TrimSpace(cfg.WebhookPublicKey); s != "" {
		if pub, err = parsePublicKey(s); err != nil {
			return nil, err
		}
	}
	taxCategory := cfg.TaxCategory
	if taxCategory == "" {
		taxCategory = "saas"
	}
	taxIncluded := true
	if cfg.TaxIncluded != nil {
		taxIncluded = *cfg.TaxIncluded
	}
	base := cfg.APIBase
	if base == "" {
		base = DefaultAPIBase
	}
	return &Channel{
		client: &Client{
			MerchantID: cfg.MerchantID,
			BaseURL:    strings.TrimRight(base, "/"),
			HTTP:       &http.Client{Timeout: 15 * time.Second},
			key:        key,
		},
		productMonthly: cfg.ProductMonthly,
		productYearly:  cfg.ProductYearly,
		taxCategory:    taxCategory,
		taxIncluded:    taxIncluded,
		webhookPub:     pub,
	}, nil
}

// parsePrivateKey 收四种形态:标准 PEM、字面 \n 转义 PEM、整段 PEM 的
// base64、裸 base64 体(后台复制的就是这种)。PKCS8 优先(PKCS#8 头
// "MIIEvAIBADANBgkqhkiG9w0BAQEFAASC"),退化 PKCS1。
func parsePrivateKey(s string) (*rsa.PrivateKey, error) {
	normalized, err := normalizePEM(s, "PRIVATE KEY")
	if err != nil {
		return nil, err
	}
	block, _ := pem.Decode([]byte(normalized))
	if block == nil {
		return nil, errors.New("waffo: private key is not PEM-decodable")
	}
	if k, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		rk, ok := k.(*rsa.PrivateKey)
		if !ok {
			return nil, errors.New("waffo: private key is not RSA")
		}
		return rk, nil
	}
	rk, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("waffo: parse private key: %w", err)
	}
	return rk, nil
}

// parsePublicKey 同 parsePrivateKey 的形态容忍,SPKI("PUBLIC KEY")。
func parsePublicKey(s string) (*rsa.PublicKey, error) {
	normalized, err := normalizePEM(s, "PUBLIC KEY")
	if err != nil {
		return nil, err
	}
	block, _ := pem.Decode([]byte(normalized))
	if block == nil {
		return nil, errors.New("waffo: webhook public key is not PEM-decodable")
	}
	k, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("waffo: parse webhook public key: %w", err)
	}
	rk, ok := k.(*rsa.PublicKey)
	if !ok {
		return nil, errors.New("waffo: webhook public key is not RSA")
	}
	return rk, nil
}

// normalizePEM 把四种输入形态归一成标准 PEM。
func normalizePEM(s, blockType string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", fmt.Errorf("waffo: empty %s", strings.ToLower(blockType))
	}
	if !strings.Contains(s, "-----BEGIN") {
		// 无头:要么是整段 PEM 的 base64(解出 BEGIN),要么是裸 base64 体(补头)。
		if raw, err := base64.StdEncoding.DecodeString(s); err == nil && bytes.Contains(raw, []byte("-----BEGIN")) {
			s = string(raw)
		} else {
			var b strings.Builder
			b.WriteString("-----BEGIN " + blockType + "-----\n")
			for i := 0; i < len(s); i += 64 {
				end := i + 64
				if end > len(s) {
					end = len(s)
				}
				b.WriteString(s[i:end])
				b.WriteByte('\n')
			}
			b.WriteString("-----END " + blockType + "-----")
			s = b.String()
		}
	}
	// 字面 \n 转义(env 单行值)还原成真换行;已是真换行则无变化。
	return strings.ReplaceAll(s, `\n`, "\n"), nil
}
