// Package sim 提供三个「模拟支付渠道」方言（simwaffo / simpaypal / simstripe），
// 用于在真库上对 billing 全管线做端到端验收。每个方言忠实镜像对应真实渠道
// （billing/adapters/waffo、paypal、stripe）的 **协议形状**——webhook 事件 JSON
// 的信封/字段结构与 → domain.PaymentEvent 的五律映射语义——但不复用其代码，
// 也不出任何网络调用：CreateCheckout 返回本地 approve URL + 会话引用，
// ParseWebhook 做 HMAC-SHA256 验签（每渠道独立 secret，签名放 X-Sim-Signature
// 头、对 raw body 计算——保持与真渠道一致的 raw-body 纪律）后按同款语义映射。
//
// 与真实渠道的**有意差异**（其余形状一致）：
//   - 验签传输简化：三个方言统一用 X-Sim-Signature: hex(HMAC-SHA256(secret, rawBody))，
//     而不是 waffo 的 RSA "t=,v1=" / paypal 的 verify-webhook-signature API /
//     stripe 的 Stripe-Signature。验签语义（对 raw body、缺头拒收、错签拒收）
//     保持一致；密钥形态学不是本模拟器的验收对象。
//   - CatalogBased=false：sim 渠道不做渠道侧商品目录（那是 waffo/paypal 的
//     REST 面能力，与事件管线无关），checkout 直接成功，测试无需注册商品。
//
// 本包是 DEV/测试设施：只允许在 example 的 DEV 接线（PLOYKIT_DEV_ENABLED=1
// 且非 production）与测试中注册，绝不进生产（见 simhttp.Mount 的 panic 兜底）。
//
// Harness 是测试接口核心：持三渠道 + 已装配 BillingService，Checkout 走真实
// svc.CreateCheckout，Deliver 构造签名信封经真实 HTTP 层（billinghttp.Mount 的
// POST /webhooks/billing/{channel} + httptest）投递——raw body 保真。
package sim

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
	"sync/atomic"
	"time"

	"github.com/haozing/ploykit/billing/app"
	"github.com/haozing/ploykit/platform/webx"
)

// SignatureHeader 是三个 sim 方言共用的验签头（见包注释的有意差异节）。
const SignatureHeader = "X-Sim-Signature"

// 环境变量名（BC-5 DB 值 > env > 内置 dev 缺省 三级回退）。
const (
	EnvWaffoSecret  = "SIMWAFFO_SECRET"
	EnvPaypalSecret = "SIMPAYPAL_SECRET"
	EnvStripeSecret = "SIMSTRIPE_SECRET"
)

// 渠道名（与 factory 注册键一致）。
const (
	NameWaffo  = "simwaffo"
	NamePaypal = "simpaypal"
	NameStripe = "simstripe"
)

// FieldSecret 是 ConfigSchema 唯一字段键，同时是
// billing_channel.<name>.secret 设置键。
const FieldSecret = "secret"

// DefaultSecret 是未配置任何密钥时的内置 dev 缺省（每渠道不同，跨渠道
// 互不可签——一个渠道的签名在另一个渠道的验签下必须失败）。
func DefaultSecret(name string) string { return "sim-dev-secret-" + name }

// SignBody 计算 X-Sim-Signature 的值：hex(HMAC-SHA256(secret, body))。
// Deliver/测试与 ParseWebhook 共用同一实现，签名永远对 raw body。
func SignBody(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

// verifySignature 验 X-Sim-Signature：缺头/错签/空 body 一律拒收
// （webx.NewValidation → HandleWebhook 转 401，事件不落库）。
func verifySignature(secret string, header map[string][]string, body []byte) error {
	sig := headerGet(header, SignatureHeader)
	if sig == "" {
		return webx.NewValidation("missing " + SignatureHeader + " header")
	}
	if len(body) == 0 {
		return webx.NewValidation("empty webhook body")
	}
	if !hmac.Equal([]byte(sig), []byte(SignBody(secret, body))) {
		return webx.NewValidation("sim webhook signature verification failed")
	}
	return nil
}

// core 是三方言共享的渠道内核：名字、验签密钥、会话 TTL（默认 1h，
// CreateCheckout 的 ExpiresAt 由此而来）、本地 approve URL 基址、
// 会话/订阅 id 序号。
type core struct {
	name    string
	secret  string
	ttl     time.Duration
	baseURL string
	seq     atomic.Int64
}

func (c *core) nextID(prefix string) string {
	return fmt.Sprintf("%s%d", prefix, c.seq.Add(1))
}

// SigningSecret 暴露当前验签密钥——Harness / simhttp 在投递时用它签名。
// 渠道经 AtomicRegistry 热重建后取的是新实例，投递方每次从注册表现取，
// 因此 DB 改密钥后新投递天然用新钥。
func (c *core) SigningSecret() string { return c.secret }

// approveURL 拼本地 approve 页地址（simhttp 的 GET approve 端点）。
func (c *core) approveURL(orderID string) string {
	return strings.TrimRight(c.baseURL, "/") + "/dev/billing-sim/" + c.name + "/approve?order=" + orderID
}

// ChannelConfig 声明（ChannelConfigViewer）：sim 渠道恒可用（有内置 dev
// 缺省密钥），webhook 恒已配置。
func (c *core) channelConfig() app.ChannelConfigInfo {
	return app.ChannelConfigInfo{Configured: true, KeyMasked: maskSecret(c.secret), WebhookConfigured: true}
}

// configSchema 是三方言共用的最小 ConfigSchema：一个 secret 字段。
// Help 里的 DEV-ONLY 警告确保后台渠道卡上看得见这是模拟器。
func (c *core) configSchema(envVar string) []app.FieldSpec {
	return []app.FieldSpec{
		{Key: FieldSecret, Label: "Webhook 签名密钥（HMAC-SHA256）", Type: app.FieldTypeSecret,
			Help: "DEV-ONLY 模拟渠道：" + c.name + " 的 webhook 验签密钥（X-Sim-Signature）。留空 = 环境变量 " + envVar + "，再缺省用内置 dev 密钥。绝不用于生产"},
	}
}

// envProvidedKeys 实现 app.ChannelEnvViewer：env 变量在供时豁免后台必填。
func (c *core) envProvidedKeys(envVar string) []string {
	if strings.TrimSpace(os.Getenv(envVar)) != "" {
		return []string{FieldSecret}
	}
	return nil
}

// coreConfig 是构造一个方言渠道的输入（Harness / factory 共用）。
type coreConfig struct {
	Secret     string        // 空 = 内置 dev 缺省
	SessionTTL time.Duration // <=0 = 1h
	BaseURL    string        // approve URL 基址；空 = http://sim.local（本地无页面，仅占位）
}

func newCore(name string, cfg coreConfig) *core {
	secret := strings.TrimSpace(cfg.Secret)
	if secret == "" {
		secret = DefaultSecret(name)
	}
	ttl := cfg.SessionTTL
	if ttl <= 0 {
		ttl = time.Hour
	}
	base := strings.TrimSpace(cfg.BaseURL)
	if base == "" {
		base = "http://sim.local"
	}
	return &core{name: name, secret: secret, ttl: ttl, baseURL: base}
}

// resolveSecret 按 BC-5 纪律解析密钥：DB 字段值（fields[FieldSecret]，
// 即 billing_channel.<name>.secret 行，毒行已被 settings.BillingChannelFields
// 跳过）→ 进程 env → 内置 dev 缺省。sim 渠道因此**总是**可构造——它是
// 模拟器，「未配置」不是合法状态（毒行隔离场景依赖这一点：毒行只会让
// 该渠道回到缺省密钥，绝不让注册失败）。
func resolveSecret(name, envVar string, fields map[string]string, getenv func(string) string) string {
	if v := strings.TrimSpace(fields[FieldSecret]); v != "" {
		return v
	}
	if getenv != nil {
		if v := strings.TrimSpace(getenv(envVar)); v != "" {
			return v
		}
	}
	return DefaultSecret(name)
}

// Factories 返回三个方言的 AtomicRegistry 工厂（产品 main.go 的 DEV 接线
// 一行并入 channelFactories）。工厂恒返回可用渠道（见 resolveSecret），
// 永不因凭据缺失跳过——DEV 模式注册了就要能用。
func Factories(getenv func(string) string) map[string]func(fields map[string]string) (app.PaymentChannel, error) {
	mk := func(name, envVar string, build func(coreConfig) app.PaymentChannel) func(map[string]string) (app.PaymentChannel, error) {
		return func(fields map[string]string) (app.PaymentChannel, error) {
			return build(coreConfig{Secret: resolveSecret(name, envVar, fields, getenv)}), nil
		}
	}
	return map[string]func(fields map[string]string) (app.PaymentChannel, error){
		NameWaffo:  mk(NameWaffo, EnvWaffoSecret, func(c coreConfig) app.PaymentChannel { return NewWaffo(c) }),
		NamePaypal: mk(NamePaypal, EnvPaypalSecret, func(c coreConfig) app.PaymentChannel { return NewPaypal(c) }),
		NameStripe: mk(NameStripe, EnvStripeSecret, func(c coreConfig) app.PaymentChannel { return NewStripe(c) }),
	}
}

func maskSecret(s string) string {
	if len(s) <= 8 {
		return "***"
	}
	return s[:4] + "***" + s[len(s)-2:]
}

// headerGet 大小写不敏感取头（http.Header 的 map 形态来自 billinghttp）。
func headerGet(h map[string][]string, name string) string {
	for k, vs := range h {
		if strings.EqualFold(k, name) && len(vs) > 0 {
			return vs[0]
		}
	}
	return ""
}
