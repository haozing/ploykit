package sim

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	billinghttp "github.com/haozing/ploykit/billing/adapters/http"
	billingpg "github.com/haozing/ploykit/billing/adapters/pgrepo"
	"github.com/haozing/ploykit/billing/app"
	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/billing/money"
	"github.com/haozing/ploykit/platform/webx"
)

// Harness 是「模拟支付渠道测试接口」的核心：持有三个 sim 方言渠道 +
// manual 渠道 + 已装配的 BillingService，并把 webhook 投递挂到真实 HTTP 层
// （billinghttp.Mount 的 POST /webhooks/billing/{channel}，经 httptest
// server 进出）——raw body / 验签 / 路由语义全部保真。
type Harness struct {
	Pool     *pgxpool.Pool
	Repo     app.Repo
	Svc      *app.BillingService
	Registry *app.ChannelRegistry

	channels map[string]Signer
	server   *httptest.Server
}

// AssembleDeps 是 Assemble 的输入；零值字段走缺省（repo=billingpg.New(pool)、
// now=UTC 真时钟、auditor/log 为 nil 安全）。ChannelCfg 可按名覆盖渠道
// secret / 会话 TTL / approve 基址（如把 simhttp 的 URL 接进 approve 链接）。
type AssembleDeps struct {
	Pool       *pgxpool.Pool
	Repo       app.Repo
	Now        app.Clock
	Auditor    app.Auditor
	Log        *slog.Logger
	Hooks      app.BillingHooks
	Config     app.Config // billing 服务配置（Currency/SuccessURL…）；零值用缺省
	ChannelCfg map[string]coreConfig
	ExtraChans []app.PaymentChannel // 追加注册（默认已含 manual）
}

// Assemble 装配 Harness：三 sim 渠道 + manual 注册进 ChannelRegistry，
// BillingService 就绪，webhook 路由挂上 httptest server。调用方负责 Close。
func Assemble(deps AssembleDeps) (*Harness, error) {
	if deps.Pool == nil {
		return nil, fmt.Errorf("sim: Assemble requires Pool")
	}
	log := deps.Log
	if log == nil {
		log = slog.Default()
	}
	now := deps.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	repo := deps.Repo
	if repo == nil {
		repo = billingpg.New(deps.Pool)
	}

	h := &Harness{Pool: deps.Pool, Repo: repo, Registry: app.NewChannelRegistry(), channels: map[string]Signer{}}
	cfgFor := func(name string) coreConfig {
		if c, ok := deps.ChannelCfg[name]; ok {
			return c
		}
		return coreConfig{}
	}
	for _, ch := range []app.PaymentChannel{
		NewWaffo(cfgFor(NameWaffo)), NewPaypal(cfgFor(NamePaypal)), NewStripe(cfgFor(NameStripe)),
	} {
		h.Registry.Register(ch)
		if s, ok := ch.(Signer); ok {
			h.channels[ch.Name()] = s
		}
	}
	h.Registry.Register(&app.ManualChannel{})
	for _, ch := range deps.ExtraChans {
		h.Registry.Register(ch)
	}

	svc := app.NewBillingService(repo, h.Registry, deps.Config, deps.Hooks, deps.Auditor, now, log)
	h.Svc = svc

	// 真实 HTTP 层：只挂 billinghttp 的路由（其余 API 路由带 authz 中间件,
	// 此处不消费也不触发——webhook 路由在真产品里本就裸挂）。
	mux := http.NewServeMux()
	billinghttp.Mount(mux, billinghttp.Deps{Svc: svc})
	h.server = httptest.NewServer(mux)
	return h, nil
}

// Close 关闭底层 httptest server。
func (h *Harness) Close() {
	if h.server != nil {
		h.server.Close()
	}
}

// URL 返回 webhook 基址（POST {URL}/webhooks/billing/{channel}）。
func (h *Harness) URL() string { return h.server.URL }

// ---- 夹具 ----

// EnsurePlan 幂等落一个可定价 plan（007 种子的 free/pro 无价格,测试需要
// price_monthly_cents/price_yearly_cents 才能过 svc.CreateCheckout 的定价闸）。
func (h *Harness) EnsurePlan(ctx context.Context, code, name, currency string, monthlyCents, yearlyCents int) error {
	limits := fmt.Sprintf(`{"price_monthly_cents":%d,"price_yearly_cents":%d,"tasks_monthly":-1}`, monthlyCents, yearlyCents)
	if currency == "" {
		currency = "USD"
	}
	_, err := h.Pool.Exec(ctx, `
		INSERT INTO plan (code, name, limits, sort_no, currency)
		VALUES ($1, $2, $3::jsonb, 90, $4)
		ON CONFLICT (code) DO UPDATE SET limits = EXCLUDED.limits, currency = EXCLUDED.currency, name = EXCLUDED.name`,
		code, name, limits, currency)
	return err
}

// EnsureWorkspace 幂等落 user + owned workspace（plan_code='free'），返回
// (userID, workspaceID)。
func (h *Harness) EnsureWorkspace(ctx context.Context, label string) (userID, workspaceID string, err error) {
	uid, ws := uuid.NewString(), uuid.NewString()
	slug := "sim-" + label + "-" + ws[:8]
	if _, err = h.Pool.Exec(ctx, `INSERT INTO "user" (id, email) VALUES ($1, $2)`, uid, slug+"@sim.test"); err != nil {
		return "", "", err
	}
	if _, err = h.Pool.Exec(ctx,
		`INSERT INTO workspace (id, slug, name, plan_code, created_by) VALUES ($1, $2, $3, 'free', $4)`,
		ws, slug, "sim-"+label, uid); err != nil {
		return "", "", err
	}
	return uid, ws, nil
}

// ---- Checkout ----

// CheckoutOpts 是下单旋钮：
//   - AmountOverride/Currency：在 CreateCheckout **之前**改写 plan 行的价格/
//     币种——订单金额/币种由真实管线从 plan 自然生成（不是事后改单）。
//   - ExpiresAt：下单**之后**把 order.expires_at 改写为该时刻——模拟渠道
//     报告的会话早已过期/尚未过期（测宽限与竞态的时钟快进旋钮）。
type CheckoutOpts struct {
	AmountOverride int
	Currency       string
	ExpiresAt      time.Time
}

// CheckoutResult 返回会话与落库后的订单。
type CheckoutResult struct {
	Session domain.CheckoutSession
	Order   domain.Order
}

// Checkout 走真实 svc.CreateCheckout（plan 解析 → 建单 → 渠道会话 →
// SetOrderChannelRefAndExpiry 全链路），principal 取 workspace 创建者。
func (h *Harness) Checkout(ctx context.Context, channel, workspaceID, planCode string, interval domain.BillingInterval, opts CheckoutOpts) (CheckoutResult, error) {
	if opts.AmountOverride > 0 || opts.Currency != "" {
		if err := OverridePlanPrice(ctx, h.Pool, planCode, interval, opts.AmountOverride, opts.Currency); err != nil {
			return CheckoutResult{}, err
		}
	}
	var userID string
	err := h.Pool.QueryRow(ctx, `SELECT created_by FROM workspace WHERE id = $1`, workspaceID).Scan(&userID)
	if err != nil {
		return CheckoutResult{}, fmt.Errorf("sim: workspace not found: %w", err)
	}
	p := &webx.Principal{UserID: userID, WorkspaceID: workspaceID}
	session, err := h.Svc.CreateCheckout(ctx, p, workspaceID, planCode, interval, channel)
	if err != nil {
		return CheckoutResult{}, err
	}
	if !opts.ExpiresAt.IsZero() {
		if err := SetOrderExpiresAt(ctx, h.Pool, session.OrderID, opts.ExpiresAt); err != nil {
			return CheckoutResult{}, err
		}
	}
	order, ok, err := h.Repo.GetOrder(ctx, session.OrderID)
	if err != nil || !ok {
		return CheckoutResult{}, fmt.Errorf("sim: order %s not found after checkout: %v", session.OrderID, err)
	}
	return CheckoutResult{Session: *session, Order: order}, nil
}

// OverridePlanPrice 读-改-写 plan 行的价格键（保持其余 limits 不动）——
// CheckoutOpts.AmountOverride/Currency 的落点，Harness 与 simhttp 共用。
func OverridePlanPrice(ctx context.Context, pool *pgxpool.Pool, planCode string, interval domain.BillingInterval, amountCents int, currency string) error {
	key := "price_monthly_cents"
	if interval == domain.IntervalYearly {
		key = "price_yearly_cents"
	}
	if currency != "" {
		if _, err := pool.Exec(ctx, `UPDATE plan SET currency = $2 WHERE code = $1`, planCode, currency); err != nil {
			return err
		}
	}
	if amountCents > 0 {
		if _, err := pool.Exec(ctx, `
			UPDATE plan SET limits = jsonb_set(limits, ARRAY[$2], to_jsonb($3::int), true)
			WHERE code = $1`, planCode, key, amountCents); err != nil {
			return err
		}
	}
	return nil
}

// SetOrderExpiresAt 改写订单 expires_at（CheckoutOpts.ExpiresAt 的落点：
// 模拟渠道报告的会话过期时刻）。零值时间清除为 NULL（manual 形态）。
func SetOrderExpiresAt(ctx context.Context, pool *pgxpool.Pool, orderID string, expiresAt time.Time) error {
	var exp any
	if !expiresAt.IsZero() {
		exp = expiresAt
	}
	_, err := pool.Exec(ctx, `UPDATE "order" SET expires_at = $2 WHERE id = $1`, orderID, exp)
	return err
}

// WorkspaceOwner 取 workspace.created_by（Checkout principal 的 UserID 来源）。
func WorkspaceOwner(ctx context.Context, pool *pgxpool.Pool, workspaceID string) (string, error) {
	var userID string
	if err := pool.QueryRow(ctx, `SELECT created_by FROM workspace WHERE id = $1`, workspaceID).Scan(&userID); err != nil {
		return "", err
	}
	return userID, nil
}

// ---- Deliver ----

// EventSpec 是投递旋钮（方言无关；各字段按渠道方言落入对应信封位置）。
// 零值字段自动补全：渠道引用取订单 channel_ref、事件 id 自动生成、金额
// 按订单金额+币种格式化——只拧要测的那个旋钮。
type EventSpec struct {
	Type     string // 方言事件类型（如 subscription.activated / BILLING.SUBSCRIPTION.ACTIVATED / checkout.session.completed）
	OrderID  string // 本地订单 id：自动补 custom_id/metadata.order_id/channel_ref/金额
	ID       string // 渠道侧引用（waffo orderId / paypal 订阅 id / stripe 会话 id）——测「同 id 不同 eventId」时显式指定
	EventID  string // 事件级 id（waffo eventId / paypal WH- / stripe evt-）；显式指定以测幂等/重复
	Amount   string // 金额字符串旋钮（"4500"/"4500.00"/"4,500" 畸形）
	Currency string

	PeriodNumber  int    // waffo 期号（1=ignored,>1=renewed）
	SaleID        string // paypal sale id（退款锚：SALE.COMPLETED 与 REFUNDED 传同值）
	PaymentStatus string // stripe checkout.session payment_status（"unpaid" → ignored 路径）

	DropAgreementID    bool // paypal：不带 billing_agreement_id（个别载荷缺失形态）
	DropCustomID       bool // paypal：不带 custom_id（内核退化 SubscriptionRef 路径）
	TotalRefundedShape bool // paypal 退款：用 total_refunded_amount 形态而非 amount

	Repeat int // 同一签名信封重复投递次数（真重放：同 body 同签名）
}

// DeliverResult 汇总投递结果（Repeat>1 时每个来回一行）。
type DeliverResult struct {
	Statuses []int
	Body     string // 最后一次响应体
}

// eventInput 是 EventSpec 解析自动补全后的方言中立输入。
type eventInput struct {
	eventType          string
	orderID            string
	channelRef         string
	eventID            string
	amount             string
	currency           string
	periodNumber       int
	saleID             string
	paymentStatus      string
	dropAgreementID    bool
	dropCustomID       bool
	totalRefundedShape bool
	timestamp          time.Time
}

func (in eventInput) refundedAmount() string {
	if strings.Contains(strings.ToLower(in.eventType), "refund") {
		return in.amount
	}
	return ""
}

// amountCents：stripe 信封里金额是整数分——同一字符串旋钮经
// money.ParseAmountForCurrency 解析（畸形串 → 0 → 不可对账路径）。
func (in eventInput) amountCents() int {
	return money.ParseAmountForCurrency(in.amount, in.currency)
}

// subRef：stripe 订阅引用从会话引用确定性派生（cs_sim_3 → sub_sim_3）。
func (in eventInput) subRef() string {
	return strings.Replace(in.channelRef, "cs_sim_", "sub_sim_", 1)
}

func (in eventInput) paypalResourceID() string {
	if strings.HasPrefix(in.eventType, "PAYMENT.SALE.") {
		return in.saleID
	}
	return in.channelRef
}

func (in eventInput) agreementID() string { return in.channelRef }

func (in eventInput) customID() string {
	if in.dropCustomID {
		return ""
	}
	return in.orderID
}

// Deliver 构造方言信封 + X-Sim-Signature 签名，经真实 HTTP 层投递
// （httptest server → billinghttp 的 POST /webhooks/billing/{channel}，
// raw body 保真）。返回每次投递的 HTTP 状态（200 = 管线接收并处理完）。
func (h *Harness) Deliver(ctx context.Context, channel string, spec EventSpec) (DeliverResult, error) {
	body, sig, err := buildSignedEvent(func(name string) (Signer, bool) {
		s, ok := h.channels[name]
		return s, ok
	}, h.Repo, channel, spec)
	if err != nil {
		return DeliverResult{}, err
	}

	repeat := spec.Repeat
	if repeat < 1 {
		repeat = 1
	}
	res := DeliverResult{Statuses: make([]int, 0, repeat)}
	url := h.server.URL + "/webhooks/billing/" + channel
	for i := 0; i < repeat; i++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
		if err != nil {
			return res, err
		}
		req.Header.Set(SignatureHeader, sig)
		req.Header.Set("Content-Type", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return res, err
		}
		buf := new(bytes.Buffer)
		_, _ = buf.ReadFrom(resp.Body)
		_ = resp.Body.Close()
		res.Statuses = append(res.Statuses, resp.StatusCode)
		res.Body = buf.String()
	}
	return res, nil
}

// eventSeq 为自动生成的 event id / sale id 供号（Harness 与 simhttp 共用）。
var eventSeq atomic.Int64

// buildSignedEvent 是 Deliver / DeliverTo 共用的「补全 → 建信封 → 签名」
// 单一真源：零值旋钮从订单自动补全（channel_ref / 币种 / 按订单金额格式化
// 的金额串），事件 id 与 sale id 自动供号。
func buildSignedEvent(lookup func(string) (Signer, bool), repo app.Repo, channel string, spec EventSpec) (body []byte, sig string, err error) {
	signer, ok := lookup(channel)
	if !ok {
		return nil, "", fmt.Errorf("sim: unknown sim channel: %s", channel)
	}
	in := eventInput{
		eventType:          spec.Type,
		orderID:            spec.OrderID,
		channelRef:         spec.ID,
		eventID:            spec.EventID,
		amount:             spec.Amount,
		currency:           spec.Currency,
		periodNumber:       spec.PeriodNumber,
		saleID:             spec.SaleID,
		paymentStatus:      spec.PaymentStatus,
		dropAgreementID:    spec.DropAgreementID,
		dropCustomID:       spec.DropCustomID,
		totalRefundedShape: spec.TotalRefundedShape,
		timestamp:          time.Now().UTC(),
	}

	// 自动补全：从订单取 channel_ref / 币种 / 默认金额。
	if in.orderID != "" {
		ctx := context.Background()
		order, ok, err := repo.GetOrder(ctx, in.orderID)
		if err != nil {
			return nil, "", err
		}
		if !ok {
			return nil, "", fmt.Errorf("sim: order not found: %s", in.orderID)
		}
		if in.channelRef == "" {
			in.channelRef = order.ChannelRef
		}
		if in.currency == "" {
			in.currency = order.Currency
		}
		if in.amount == "" {
			in.amount = money.FormatCents(order.AmountCents, in.currency)
		}
	}
	if in.eventID == "" {
		in.eventID = fmt.Sprintf("simevt-%d", eventSeq.Add(1))
	}
	if in.saleID == "" {
		in.saleID = fmt.Sprintf("SALE-SIM-%d", eventSeq.Add(1))
	}

	switch channel {
	case NameWaffo:
		body = buildWaffoEvent(in)
	case NamePaypal:
		body = buildPaypalEvent(in)
	case NameStripe:
		body = buildStripeEvent(in)
	default:
		return nil, "", fmt.Errorf("sim: no envelope builder for channel: %s", channel)
	}
	return body, SignBody(signer.SigningSecret(), body), nil
}

// DeliverTo 是 Harness.Deliver 的同进程孪生（simhttp dev 端点用）：信封与
// 签名构造完全同一份代码，但不自环回 HTTP——同进程 handler 直接调
// Svc.HandleWebhook（真实管线里 webhook 经 HTTP 进来的地方就是它包 raw
// body；此处保真的恰是 raw body + 验签，注释说明的降级路径）。
func DeliverTo(ctx context.Context, svc *app.BillingService, channels app.ChannelSet, repo app.Repo, channel string, spec EventSpec) error {
	body, sig, err := buildSignedEvent(func(name string) (Signer, bool) {
		ch, ok := channels.Get(name)
		if !ok {
			return nil, false
		}
		s, ok := ch.(Signer)
		return s, ok
	}, repo, channel, spec)
	if err != nil {
		return err
	}
	header := map[string][]string{
		SignatureHeader: {sig},
		"Content-Type":  {"application/json"},
	}
	return svc.HandleWebhook(ctx, channel, app.WebhookRequest{Header: header, Body: body})
}
