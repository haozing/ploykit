package sim

// 真库全管线验收：每个场景对应 2026-10-24 billing 渠道框架大修的一项修复，
// 全部经 Harness 走完整链路（真实 svc.CreateCheckout / 真实 HTTP webhook
// 入口 / 验签 / 五律映射 / 幂等 / 对账 / 权益 / 审计），断言行为而非实现。
// 无 TEST_DATABASE_URL 则整体 skip（hermetic 用例见 sim_test.go）。
//
// 场景索引（编号对应修复验收清单）：
//  1 P0 竞态:expiry 清扫后迟到付款复活 / user 取消后不复活
//  2 弃单清扫宽限窗（workers.orderSweepGrace=24h 的 cutoff 语义）
//  3 manual 订单 expires_at=NULL 永不清扫、核销无截止
//  4 waffo 幂等键 eventType:eventId（同 id 不同 eventId 两期都续；同 eventId 重放只算一次）
//  5 paypal 退款锚：不带 agreementId 的退款经 SALE 落的 PI 锚反查撤权
//  6 续期金额对账：目录价≠收款价拒续 + 审计；改按新价正常续
//  7 JPY 往返："4500"/"4500.00" 入账；畸形 "4,500" 走不可对账路径不误伤订单
//  8 首付金额对账（原防线）：completed 金额不符拒发权益
//  9 __SET__ 回传短路（hermetic,sim_test.go TestScenario9_SetMarkerKeepsStoredSecret_Hermetic）
// 10 毒行隔离：解不开的 billing_channel.* 密文不拖垮其余渠道注册

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/riverqueue/river/rivermigrate"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/audit"
	billingpg "github.com/haozing/ploykit/billing/adapters/pgrepo"
	"github.com/haozing/ploykit/billing/app"
	"github.com/haozing/ploykit/billing/domain"
	"github.com/haozing/ploykit/migrations"
	"github.com/haozing/ploykit/platform/pgmigrate"
	"github.com/haozing/ploykit/platform/sealx"
	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/settings"
)

// newSimScratchPool 与 pgrepo 的 newBillingScratchPool 同款：一次性 scratch
// 库 + 全部迁移（framework 001-999 + river schema）。
func newSimScratchPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	admin, err := pgxpool.New(ctx, dsn)
	require.NoError(t, err)
	scratch := "sim_it_" + uuid.NewString()[:8]
	_, err = admin.Exec(ctx, "CREATE DATABASE "+scratch)
	require.NoError(t, err, "scratch db（dev compose 用户 pk 是 superuser）")

	u, err := url.Parse(dsn)
	require.NoError(t, err)
	u.Path = "/" + scratch
	pool, err := pgxpool.New(ctx, u.String())
	require.NoError(t, err)

	require.NoError(t, pgmigrate.Up(ctx, pool, migrations.FS, "."))
	migrator, err := rivermigrate.New(riverpgxv5.New(pool), nil)
	require.NoError(t, err)
	_, err = migrator.Migrate(ctx, rivermigrate.DirectionUp, nil)
	require.NoError(t, err)

	t.Cleanup(func() {
		pool.Close()
		dropCtx, dropCancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer dropCancel()
		_, _ = admin.Exec(dropCtx, fmt.Sprintf("DROP DATABASE %s WITH (FORCE)", scratch))
		admin.Close()
	})
	return pool
}

// newPipeline 装配 Harness（auditor 接真实 audit_event 表，供行为断言）。
func newPipeline(t *testing.T) *Harness {
	t.Helper()
	pool := newSimScratchPool(t)
	h, err := Assemble(AssembleDeps{
		Pool:    pool,
		Auditor: audit.NewRecorder(pool, slog.Default()),
		Config:  app.Config{Currency: "USD"},
	})
	require.NoError(t, err)
	t.Cleanup(h.Close)
	return h
}

// ---- 断言辅助（直接查真库——断言行为结果而非中间结构）----

func orderRow(t *testing.T, h *Harness, id string) (status string, canceledBy *string, expiresAt *time.Time) {
	t.Helper()
	err := h.Pool.QueryRow(context.Background(),
		`SELECT status, canceled_by, expires_at FROM "order" WHERE id = $1`, id).
		Scan(&status, &canceledBy, &expiresAt)
	require.NoError(t, err)
	return status, canceledBy, expiresAt
}

func wsRow(t *testing.T, h *Harness, ws string) (plan string, subRef *string, planExpiresAt *time.Time) {
	t.Helper()
	err := h.Pool.QueryRow(context.Background(),
		`SELECT plan_code, subscription_ref, plan_expires_at FROM workspace WHERE id = $1`, ws).
		Scan(&plan, &subRef, &planExpiresAt)
	require.NoError(t, err)
	return plan, subRef, planExpiresAt
}

func auditCount(t *testing.T, h *Harness, action, resourceID string) int {
	t.Helper()
	var n int
	require.NoError(t, h.Pool.QueryRow(context.Background(),
		`SELECT count(*) FROM audit_event WHERE action = $1 AND resource_id = $2`, action, resourceID).Scan(&n))
	return n
}

func paymentEventCount(t *testing.T, h *Harness, channel string) int {
	t.Helper()
	var n int
	require.NoError(t, h.Pool.QueryRow(context.Background(),
		`SELECT count(*) FROM payment_event WHERE channel = $1`, channel).Scan(&n))
	return n
}

func deliverOK(t *testing.T, h *Harness, channel string, spec EventSpec) DeliverResult {
	t.Helper()
	res, err := h.Deliver(context.Background(), channel, spec)
	require.NoError(t, err)
	for _, st := range res.Statuses {
		require.Equal(t, 200, st, "webhook 投递应被管线接收: body=%s", res.Body)
	}
	return res
}

// ---- 场景 1：P0 弃单竞态 ----

func TestScenario1_P0Race_LatePaidRevivesExpiryCanceledOrder(t *testing.T) {
	h := newPipeline(t)
	ctx := context.Background()
	require.NoError(t, h.EnsurePlan(ctx, "simpro1", "Sim Pro 1", "USD", 1900, 19000))
	_, ws, err := h.EnsureWorkspace(ctx, "p0")
	require.NoError(t, err)
	now := time.Now().UTC()

	res, err := h.Checkout(ctx, NameStripe, ws, "simpro1", domain.IntervalMonthly,
		CheckoutOpts{ExpiresAt: now.Add(-time.Hour)})
	require.NoError(t, err)
	orderID := res.Order.ID

	// 前修复形态的清扫:cutoff=now(无宽限),已过期的 pending 立即清成 canceled(expiry)。
	swept, err := h.Svc.ExpireStaleOrders(ctx, now, 100)
	require.NoError(t, err)
	require.Contains(t, swept, orderID)
	status, canceledBy, _ := orderRow(t, h, orderID)
	assert.Equal(t, "canceled", status)
	require.NotNil(t, canceledBy)
	assert.Equal(t, "expiry", *canceledBy)

	// 迟到的 completed(金额正确):订单复活为 paid,workspace 升级,审计留痕。
	deliverOK(t, h, NameStripe, EventSpec{Type: "checkout.session.completed", OrderID: orderID})
	status, _, _ = orderRow(t, h, orderID)
	assert.Equal(t, "paid", status, "迟到支付赢过 expiry 启发式清扫(canceled→paid 复活)")
	plan, _, _ := wsRow(t, h, ws)
	assert.Equal(t, "simpro1", plan)
	assert.Equal(t, 1, auditCount(t, h, "billing.order_revived_after_expiry", orderID), "复活必须审计留痕")

	// 反例:user 主动取消后迟到付款 → 仍忽略,不发权益、不复活。
	res2, err := h.Checkout(ctx, NameStripe, ws, "simpro1", domain.IntervalMonthly, CheckoutOpts{})
	require.NoError(t, err)
	order2 := res2.Order.ID
	var owner string
	require.NoError(t, h.Pool.QueryRow(ctx, `SELECT created_by FROM workspace WHERE id=$1`, ws).Scan(&owner))
	require.NoError(t, h.Svc.CancelPendingOrder(ctx, &webx.Principal{UserID: owner, WorkspaceID: ws}, order2))
	deliverOK(t, h, NameStripe, EventSpec{Type: "checkout.session.completed", OrderID: order2})
	status, canceledBy, _ = orderRow(t, h, order2)
	assert.Equal(t, "canceled", status, "user 取消是终局,迟到付款不复活")
	require.NotNil(t, canceledBy)
	assert.Equal(t, "user", *canceledBy)
	assert.Equal(t, 0, auditCount(t, h, "billing.order_revived_after_expiry", order2))
}

// ---- 场景 2：清扫宽限窗 ----

func TestScenario2_SweepGraceWindow(t *testing.T) {
	h := newPipeline(t)
	ctx := context.Background()
	require.NoError(t, h.EnsurePlan(ctx, "simpro2", "Sim Pro 2", "USD", 1900, 19000))
	_, ws, err := h.EnsureWorkspace(ctx, "grace")
	require.NoError(t, err)
	now := time.Now().UTC()

	fresh, err := h.Checkout(ctx, NameStripe, ws, "simpro2", domain.IntervalMonthly,
		CheckoutOpts{ExpiresAt: now.Add(-time.Hour)}) // 刚过期 1h:宽限内
	require.NoError(t, err)
	stale, err := h.Checkout(ctx, NameStripe, ws, "simpro2", domain.IntervalMonthly,
		CheckoutOpts{ExpiresAt: now.Add(-25 * time.Hour)}) // 过期 25h:出宽限
	require.NoError(t, err)

	// ExpiryWorker 的真实 cutoff = now-orderSweepGrace(24h,见
	// billing/adapters/workers/expiry.go);repo 语义 expires_at <= cutoff 才清。
	swept, err := h.Svc.ExpireStaleOrders(ctx, now.Add(-24*time.Hour), 100)
	require.NoError(t, err)
	assert.Contains(t, swept, stale.Order.ID, "过期 25h 出宽限 → 清扫")
	assert.NotContains(t, swept, fresh.Order.ID, "过期 1h 在宽限内 → 留给迟到的 webhook")

	s1, _, _ := orderRow(t, h, fresh.Order.ID)
	s2, by2, _ := orderRow(t, h, stale.Order.ID)
	assert.Equal(t, "pending", s1)
	assert.Equal(t, "canceled", s2)
	require.NotNil(t, by2)
	assert.Equal(t, "expiry", *by2)
}

// ---- 场景 3：manual 永不过期 ----

func TestScenario3_ManualOrderNeverSwept(t *testing.T) {
	h := newPipeline(t)
	ctx := context.Background()
	require.NoError(t, h.EnsurePlan(ctx, "simpro3", "Sim Pro 3", "USD", 1900, 19000))
	_, ws, err := h.EnsureWorkspace(ctx, "manual")
	require.NoError(t, err)

	res, err := h.Checkout(ctx, app.ChannelManual, ws, "simpro3", domain.IntervalMonthly, CheckoutOpts{})
	require.NoError(t, err)
	orderID := res.Order.ID

	status, _, expiresAt := orderRow(t, h, orderID)
	require.Equal(t, "pending", status)
	assert.Nil(t, expiresAt, "manual 订单 expires_at=NULL:线下转账无会话过期,不参与清扫")

	// 30 天后的清扫(cutoff=now+30d)也碰不到 NULL 到期。
	swept, err := h.Svc.ExpireStaleOrders(ctx, time.Now().UTC().Add(720*time.Hour), 100)
	require.NoError(t, err)
	assert.NotContains(t, swept, orderID)

	// 30 天后人工核销仍成功(billing fix #2:核销无截止)。
	require.NoError(t, h.Svc.MarkOrderPaid(ctx, nil, orderID))
	status, _, _ = orderRow(t, h, orderID)
	assert.Equal(t, "paid", status)
	assert.Equal(t, 1, auditCount(t, h, "billing.order_marked_paid", orderID))
}

// ---- 场景 4：waffo 幂等键 ----

func TestScenario4_WaffoIdempotencyKey(t *testing.T) {
	h := newPipeline(t)
	ctx := context.Background()
	require.NoError(t, h.EnsurePlan(ctx, "simpro4", "Sim Pro 4", "USD", 990, 9900))
	_, ws, err := h.EnsureWorkspace(ctx, "idem")
	require.NoError(t, err)

	res, err := h.Checkout(ctx, NameWaffo, ws, "simpro4", domain.IntervalMonthly, CheckoutOpts{})
	require.NoError(t, err)
	orderID := res.Order.ID

	// 同一渠道订单 id=ORD-x 跨期不变;各期只有 eventId 互异。
	deliverOK(t, h, NameWaffo, EventSpec{Type: "subscription.activated", OrderID: orderID, ID: "ORD-x", EventID: "ACT"})
	status, _, _ := orderRow(t, h, orderID)
	require.Equal(t, "paid", status)
	_, subRef, t1 := wsRow(t, h, ws)
	require.NotNil(t, subRef)
	assert.Equal(t, "ORD-x", *subRef, "订阅引用=waffo 订单号(稳定引用)")

	deliverOK(t, h, NameWaffo, EventSpec{Type: "subscription.payment_succeeded", OrderID: orderID, ID: "ORD-x", EventID: "EVT-2", PeriodNumber: 2})
	_, _, t2 := wsRow(t, h, ws)
	require.NotNil(t, t2)
	assert.True(t, t2.After(*t1), "期 2 续期:到期日推进")

	deliverOK(t, h, NameWaffo, EventSpec{Type: "subscription.payment_succeeded", OrderID: orderID, ID: "ORD-x", EventID: "EVT-3", PeriodNumber: 3})
	_, _, t3 := wsRow(t, h, ws)
	assert.True(t, t3.After(*t2), "期 3 续期:同 id 不同 eventId,不被当重复吞掉")

	// 同一 eventId 重放(真重放:同 body 同签名):幂等去重,只算一次。
	deliverOK(t, h, NameWaffo, EventSpec{Type: "subscription.payment_succeeded", OrderID: orderID, ID: "ORD-x", EventID: "EVT-3", PeriodNumber: 3, Repeat: 2})
	_, _, t3b := wsRow(t, h, ws)
	assert.True(t, t3b.Equal(*t3), "重放不推进到期日")
	assert.Equal(t, 3, paymentEventCount(t, h, NameWaffo),
		"ACT+EVT-2+EVT-3 三行;重放走 (channel,channel_event_id) 幂等,不落新行")
}

// ---- 场景 5：paypal 退款锚 ----

func TestScenario5_PaypalRefundAnchorWithoutAgreementID(t *testing.T) {
	h := newPipeline(t)
	ctx := context.Background()
	require.NoError(t, h.EnsurePlan(ctx, "simpro5", "Sim Pro 5", "USD", 990, 9900))
	_, ws, err := h.EnsureWorkspace(ctx, "refund")
	require.NoError(t, err)

	res, err := h.Checkout(ctx, NamePaypal, ws, "simpro5", domain.IntervalMonthly, CheckoutOpts{})
	require.NoError(t, err)
	orderID := res.Order.ID

	deliverOK(t, h, NamePaypal, EventSpec{Type: "BILLING.SUBSCRIPTION.ACTIVATED", OrderID: orderID})
	status, _, _ := orderRow(t, h, orderID)
	require.Equal(t, "paid", status, "ACTIVATED 无金额:0 走忽略路径不参与对账")

	// SALE 带 customId+agreementId:续期 + 把 sale id 锚进订单(PI)。
	deliverOK(t, h, NamePaypal, EventSpec{Type: "PAYMENT.SALE.COMPLETED", OrderID: orderID, SaleID: "S1"})
	var pi string
	require.NoError(t, h.Pool.QueryRow(ctx,
		`SELECT metadata->>'payment_intent' FROM "order" WHERE id=$1`, orderID).Scan(&pi))
	assert.Equal(t, "S1", pi, "续期路径也要落 PI 锚(billing fix #3)")

	// 修复点:退款**不带** agreementId,只带 sale id——修复前此退款被静默丢弃。
	deliverOK(t, h, NamePaypal, EventSpec{Type: "PAYMENT.SALE.REFUNDED", OrderID: orderID, SaleID: "S1", DropAgreementID: true})
	status, _, _ = orderRow(t, h, orderID)
	assert.Equal(t, "refunded", status, "退款经 PI 锚(S1)反查到订单,不再静默丢弃")
	plan, _, _ := wsRow(t, h, ws)
	assert.Equal(t, "free", plan, "权益撤到 free")
}

// ---- 场景 6：续期金额对账 ----

func TestScenario6_RenewalAmountReconciliation(t *testing.T) {
	h := newPipeline(t)
	ctx := context.Background()
	require.NoError(t, h.EnsurePlan(ctx, "simpro6", "Sim Pro 6", "USD", 990, 9900))
	_, ws, err := h.EnsureWorkspace(ctx, "recon")
	require.NoError(t, err)

	res, err := h.Checkout(ctx, NamePaypal, ws, "simpro6", domain.IntervalMonthly, CheckoutOpts{})
	require.NoError(t, err)
	orderID := res.Order.ID
	deliverOK(t, h, NamePaypal, EventSpec{Type: "BILLING.SUBSCRIPTION.ACTIVATED", OrderID: orderID})
	_, _, t1 := wsRow(t, h, ws)
	require.NotNil(t, t1)

	// DB 改 plan 价 990 → 1990:目录价即收款价,渠道仍按旧价收 → 拒续。
	require.NoError(t, OverridePlanPrice(ctx, h.Pool, "simpro6", domain.IntervalMonthly, 1990, ""))
	deliverOK(t, h, NamePaypal, EventSpec{Type: "PAYMENT.SALE.COMPLETED", OrderID: orderID, Amount: "9.90", SaleID: "S-old"})
	_, _, t1b := wsRow(t, h, ws)
	assert.True(t, t1b.Equal(*t1), "旧价收款:不发放续期(到期日不动)")
	assert.Equal(t, 1, auditCount(t, h, "billing.amount_mismatch", orderID), "拒续必须审计留痕")
	var phase string
	require.NoError(t, h.Pool.QueryRow(ctx,
		`SELECT metadata->>'phase' FROM audit_event WHERE action='billing.amount_mismatch' AND resource_id=$1 LIMIT 1`,
		orderID).Scan(&phase))
	assert.Equal(t, "renewal", phase)

	// 改价后按新价收款 → 正常续。
	deliverOK(t, h, NamePaypal, EventSpec{Type: "PAYMENT.SALE.COMPLETED", OrderID: orderID, Amount: "19.90", SaleID: "S-new"})
	_, _, t2 := wsRow(t, h, ws)
	assert.True(t, t2.After(*t1), "新价收款:续期照发")
}

// ---- 场景 7：JPY 往返 ----

func TestScenario7_JPYRoundTrip(t *testing.T) {
	h := newPipeline(t)
	ctx := context.Background()
	require.NoError(t, h.EnsurePlan(ctx, "simjpy7", "Sim JPY 7", "JPY", 4500, 45000))
	_, ws, err := h.EnsureWorkspace(ctx, "jpy")
	require.NoError(t, err)

	checkout := func() string {
		res, err := h.Checkout(ctx, NameWaffo, ws, "simjpy7", domain.IntervalMonthly, CheckoutOpts{})
		require.NoError(t, err)
		require.Equal(t, 4500, res.Order.AmountCents)
		require.Equal(t, "JPY", res.Order.Currency)
		return res.Order.ID
	}

	// "4500"(零小数位币原生形态)→ 入账。
	idA := checkout()
	deliverOK(t, h, NameWaffo, EventSpec{Type: "subscription.activated", OrderID: idA, Amount: "4500"})
	status, _, _ := orderRow(t, h, idA)
	assert.Equal(t, "paid", status)

	// "4500.00"(部分网关回显形态)→ 同额入账,不是 100 倍。
	idB := checkout()
	deliverOK(t, h, NameWaffo, EventSpec{Type: "subscription.activated", OrderID: idB, Amount: "4500.00"})
	status, _, _ = orderRow(t, h, idB)
	assert.Equal(t, "paid", status, "JPY '4500.00' 剥全零小数位 → 4500 == 订单金额,对账通过")

	// 畸形 "4,500":解析为 0 = 不可对账 → 不拦事件、不误伤订单
	// (amount<=0 走「金额缺席不参与对账」的既定语义,订单照常核销)。
	idC := checkout()
	deliverOK(t, h, NameWaffo, EventSpec{Type: "subscription.activated", OrderID: idC, Amount: "4,500"})
	status, _, _ = orderRow(t, h, idC)
	assert.Equal(t, "paid", status, "畸形金额=不可对账而非拒付,订单不受伤")
	assert.Equal(t, 0, auditCount(t, h, "billing.amount_mismatch", idC), "不可对账不是金额错配,不告警")
}

// ---- 场景 8：首付金额对账（原防线回归）----

func TestScenario8_FirstPaymentAmountMismatch(t *testing.T) {
	h := newPipeline(t)
	ctx := context.Background()
	require.NoError(t, h.EnsurePlan(ctx, "simpro8", "Sim Pro 8", "USD", 1900, 19000))
	_, ws, err := h.EnsureWorkspace(ctx, "mismatch")
	require.NoError(t, err)

	res, err := h.Checkout(ctx, NameStripe, ws, "simpro8", domain.IntervalMonthly, CheckoutOpts{})
	require.NoError(t, err)
	orderID := res.Order.ID

	deliverOK(t, h, NameStripe, EventSpec{Type: "checkout.session.completed", OrderID: orderID, Amount: "45.00"})
	status, _, _ := orderRow(t, h, orderID)
	assert.Equal(t, "pending", status, "首付金额不符:拒发权益,订单停在 pending(可等人工/重试)")
	plan, _, _ := wsRow(t, h, ws)
	assert.Equal(t, "free", plan)
	assert.Equal(t, 1, auditCount(t, h, "billing.amount_mismatch", orderID), "拒付必须审计留痕")
}

// ---- 场景 10：毒行隔离 ----
// (billing fix #5:settings.BillingChannelFields 对解不开的密文行跳过而非报错,
// AtomicRegistry 重建后其余渠道照常注册可用;sim 渠道回到内置 dev 密钥。)

func TestScenario10_ToxicCredentialRowIsolation(t *testing.T) {
	pool := newSimScratchPool(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	secrets, err := sealx.NewSecrets([]byte("0123456789abcdef0123456789abcdef"))
	require.NoError(t, err)
	store := settings.NewStore(pool).WithSealer(secrets)

	// 正常行:simwaffo 用 DB 密钥(sealed);毒行:simstripe 的密文解不开
	// (带 sealed:v1: 前缀但 body 不是本密钥可解的密文——旋转密钥/损坏行)。
	require.NoError(t, store.Set(ctx, "billing_channel."+NameWaffo+".secret", "custom-waffo-secret", "test"))
	_, err = pool.Exec(ctx, `
		INSERT INTO site_settings (key, value, updated_at, updated_by)
		VALUES ($1, 'sealed:v1:AAAA', now(), 'test')
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
		"billing_channel."+NameStripe+".secret")
	require.NoError(t, err)

	factories := Factories(func(string) string { return "" }) // 排除 env 干扰
	reg := app.NewAtomicRegistry(ctx, slog.Default(), store.BillingChannelFields, factories, time.Hour)
	require.NoError(t, reg.RefreshNow(ctx))

	// 三个 sim 渠道都照常注册;毒行渠道回到缺省密钥,正常行渠道用 DB 密钥。
	for _, name := range []string{NameWaffo, NamePaypal, NameStripe} {
		ch, ok := reg.Get(name)
		require.True(t, ok, "毒行只废它自己那一行,%s 必须照常注册", name)
		_ = ch
	}
	wf, _ := reg.Get(NameWaffo)
	assert.Equal(t, "custom-waffo-secret", wf.(Signer).SigningSecret())
	st, _ := reg.Get(NameStripe)
	assert.Equal(t, DefaultSecret(NameStripe), st.(Signer).SigningSecret(), "毒行跳过 → 回内置 dev 密钥")

	// 功能面:用该注册表装配真实 BillingService,投递一笔 activated 全链路走通。
	repo := billingpg.New(pool)
	require.NoError(t, ensurePlanRow(ctx, pool, "simpro10", "USD", 1900))
	uid, ws, err := ensureUserWorkspace(ctx, pool, "toxic")
	require.NoError(t, err)
	order, err := repo.CreateOrder(ctx, domain.Order{
		WorkspaceID: ws, UserID: uid, PlanCode: "simpro10", Interval: domain.IntervalMonthly,
		AmountCents: 1900, Currency: "USD", Channel: NameStripe, Status: domain.OrderPending,
	})
	require.NoError(t, err)

	svc := app.NewBillingService(repo, reg, app.Config{Currency: "USD"}, app.BillingHooks{},
		audit.NewRecorder(pool, slog.Default()), func() time.Time { return time.Now().UTC() }, slog.Default())
	require.NoError(t, DeliverTo(ctx, svc, reg, repo, NameStripe,
		EventSpec{Type: "checkout.session.completed", OrderID: order.ID}))
	got, ok, err := repo.GetOrder(ctx, order.ID)
	require.NoError(t, err)
	require.True(t, ok)
	assert.Equal(t, domain.OrderPaid, got.Status, "毒行隔离后的渠道功能完整:支付事件照常核销")
}

// ensurePlanRow / ensureUserWorkspace 是场景 10 的内联夹具(Harness 未参与)。
func ensurePlanRow(ctx context.Context, pool *pgxpool.Pool, code, currency string, monthlyCents int) error {
	_, err := pool.Exec(ctx, `
		INSERT INTO plan (code, name, limits, sort_no, currency)
		VALUES ($1, $1, $2::jsonb, 90, $3)
		ON CONFLICT (code) DO UPDATE SET limits = EXCLUDED.limits, currency = EXCLUDED.currency`,
		code, fmt.Sprintf(`{"price_monthly_cents":%d,"price_yearly_cents":%d}`, monthlyCents, monthlyCents*10), currency)
	return err
}

func ensureUserWorkspace(ctx context.Context, pool *pgxpool.Pool, label string) (string, string, error) {
	uid, ws := uuid.NewString(), uuid.NewString()
	slug := "sim-" + label + "-" + ws[:8]
	if _, err := pool.Exec(ctx, `INSERT INTO "user" (id, email) VALUES ($1, $2)`, uid, slug+"@sim.test"); err != nil {
		return "", "", err
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO workspace (id, slug, name, plan_code, created_by) VALUES ($1, $2, $3, 'free', $4)`,
		ws, slug, "sim-"+label, uid); err != nil {
		return "", "", err
	}
	return uid, ws, nil
}
