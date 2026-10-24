# billing/adapters/sim —— 模拟支付渠道测试接口（DEV-ONLY）

三个「模拟支付渠道」方言 + 测试 Harness + DEV HTTP 面，用于对 billing 全管线
（下单 → 渠道会话 → 签名 webhook → 验签 → 五律映射 → 幂等 → 对账 → 权益 →
审计）做**真库端到端验收**。它验收的是 2026-10-24 渠道框架大修的修复语义
（弃单竞态复活 / 续期金额对账 / 幂等键 / 退款锚 / JPY 解析 / `__SET__` 短路 /
毒行隔离 …），也用作未来渠道改动的回归护栏。

## 是什么

| 组件 | 位置 | 说明 |
|---|---|---|
| `simwaffo` | `waffo.go` | 镜像 waffo 信封 `{id(订单级,跨期相同), eventId(期级唯一), eventType, mode, timestamp, data{...}}`；activated→completed / payment_succeeded(期 1 ignored，>1 renewed) / canceled / refund；幂等键 `eventType:eventId`（回退 id）；DisplayOrder 950 |
| `simpaypal` | `paypal.go` | 镜像 PayPal `{id(WH-xxx), event_type, resource{custom_id, billing_agreement_id, amount{total/value}, sale_id, total_refunded_amount}}`；ACTIVATED（无金额）/ SALE.COMPLETED（customId+agreementId→renewed，sale id→PI 锚）/ REFUNDED（两种金额形态；不带 agreementId 时退化 sale_id 反查）/ CANCELLED |
| `simstripe` | `stripe.go` | 镜像 Stripe `{id, type, data{object{...}}}`；checkout.session.completed（金额+payment_status 门）/ invoice.paid（续期）/ charge.refunded（PI 反查锚）/ customer.subscription.deleted |
| `Harness` | `harness.go` | 三渠道 + manual + 已装配 `BillingService`；`Checkout`（真实 svc.CreateCheckout + 金额/币种/过期旋钮）、`Deliver`（构造签名信封经真实 HTTP 层 `POST /webhooks/billing/{name}` 投递，raw body 保真） |
| `simhttp` | `simhttp/` | DEV HTTP 面（下节） |
| 真库管线测试 | `pipeline_db_test.go` | 10 个场景逐修复验收；无 `TEST_DATABASE_URL` 自动 skip |

每个渠道实现完整 `PaymentChannel`（CreateCheckout 返回本地 approve URL、
SessionRef、可配置 ExpiresAt 默认 1h）+ `Capabilities` + `ConfigSchema`（一个
`secret` 字段）。验签：`X-Sim-Signature: hex(HMAC-SHA256(secret, rawBody))`，
每渠道独立 secret（DB `billing_channel.<name>.secret` > env
`SIM{WAFFO,PAYPAL,STRIPE}_SECRET` > 内置 dev 缺省 `sim-dev-secret-<name>`）。
与真渠道的有意差异只有两处（见包注释）：签名传输统一为 HMAC（密钥形态学不是
验收对象），`CatalogBased=false`（不做渠道侧商品目录，checkout 直接成功）。

## 怎么挂（example 接线）

main.go 两处，均 **DEV-ONLY**（`!production && PLOYKIT_DEV_ENABLED=1`，与
devx.Mount 同一 dev 开关门控）：

```go
// ① channelFactories 块尾：注册三渠道（DisplayOrder 950+ 排在一切真渠道之后）
simDev := !production && env("PLOYKIT_DEV_ENABLED", "") == "1"
if simDev {
    for name, factory := range sim.Factories(os.Getenv) {
        channelFactories[name] = factory
    }
}
// ② devx.Mount 之后：挂 DEV HTTP 面（Production=true 时 Mount 直接 panic 兜底）
if simDev {
    simhttp.Mount(mux, simhttp.Deps{Svc: billingSvc, Channels: channels,
        Repo: billingRepo, Pool: pool, Now: now, Log: log, Production: production})
}
```

### DEV HTTP 面

```
POST /dev/billing-sim/{channel}/checkout
     body: {"workspace":"<ws-uuid>","plan":"pro","interval":"monthly",
            "amount":1900,"currency":"USD","expires_in":-3600}
     → 201 {order_id, action_url, session_ref, expires_at, webhook_hint}
     amount=分(覆盖 plan 价,下单前改 plan 使订单金额由真实管线生成);
     expires_in=秒(可负:把 order.expires_at 挪到过去驱动弃单/竞态场景)

POST /dev/billing-sim/{channel}/event
     body: {"event_type":"subscription.activated","order_id":"<uuid>",
            "event_id":"EVT-2","id":"ORD-x","amount":"4500","currency":"JPY",
            "period_number":2,"sale_id":"S1","payment_status":"paid",
            "agreement_id":null,"custom_id":null,"repeat":1}
     → 200 {status:"received",...}
     agreement_id/custom_id 三态: 缺省=自动补全, ""=显式缺失, 非空=指定;
     repeat>1 = 同一签名信封重放(测幂等)

GET  /dev/billing-sim/{channel}/approve?order=<id>
     → 本地 approve 占位页(无副作用,说明下一步)
```

### Harness（Go 测试）

```go
h, err := sim.Assemble(sim.AssembleDeps{Pool: pool})
defer h.Close()
h.EnsurePlan(ctx, "simpro", "Sim Pro", "USD", 1900, 19000)
_, ws, _ := h.EnsureWorkspace(ctx, "t1")
res, err := h.Checkout(ctx, sim.NameStripe, ws, "simpro", domain.IntervalMonthly,
    sim.CheckoutOpts{ExpiresAt: time.Now().Add(-time.Hour)})
h.Svc.ExpireStaleOrders(ctx, time.Now(), 10)
h.Deliver(ctx, sim.NameStripe, sim.EventSpec{Type: "checkout.session.completed", OrderID: res.Order.ID})
```

## 边界声明

- **example 仅 DEV 挂载，生产禁用**：sim 渠道只在 `!production &&
  PLOYKIT_DEV_ENABLED=1` 时进 channelFactories；simhttp 只在同门控下 Mount，
  且 `Deps.Production=true` 直接 panic 兜底。它伪造支付 webhook——进生产
  等于给任何人发权益的接口。
- **不入 OpenAPI 契约**：simhttp 置于 `billing/adapters/sim/simhttp`（check_api
  只扫描各域 `adapters/http` 与 example 主干字面路由），dev 测试面不属于产品
  API 面；`python tools/check_api.py` 零漂移。
- **example 消费的路径**：DEV 接线块（渠道注册 + HTTP 面）就是 example 的
  全部消费面；Harness 的夹具/断言辅助（EnsurePlan/EnsureWorkspace/Deliver
  旋钮全集）只在 `pipeline_db_test.go` 里被消费——「works because example
  tests it」不适用于 Harness 的非 example 消费路径，其边界由本包测试自证。
- **真库测试**：`TEST_DATABASE_URL` 指向一次性库（每个测试建独立 scratch
  database，跑全部迁移），`TEST_DATABASE_URL=... go test ./billing/adapters/sim/
  -count=1`；hermetic 用例无 env 也全绿。
