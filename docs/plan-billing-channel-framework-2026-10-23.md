# Plan: 支付渠道框架化 —— waffo 实战复盘 → stripe/waffo/paypal 三渠道 + 后台自助配置

> Status: **audited 2026-10-23**（round 1 见 `audit-billing-channel-framework-plan-2026-10-23.md`：
> F1–F20 中 18 属实/1 表述修正/1 外源，数字类修正 2 处，无动摇性发现，可进入执行）。
> Source: shuijing 产品仓 2026-10-23 waffo（Waffo Pancake，MoR）真实接入全程
> （commit `31aa35d` 渠道接入 / `1cdfed3` 调价 9.90-69 / `93b3fd9` webhook 公钥对账；
> 适配器现居 shuijing `internal/billingwaffo`，3 源文件 708 行 + 2 测试文件（hermetic
> 464 行 + live 门控 36 行），真实 API 三点验证：签名/建品/create-session）。本文把
> 这次接入当成一次"框架压力测试"，复盘所有摩擦点，给出 ploykit 计费框架的分期改造
> 方案。目标形态：**stripe / waffo / paypal 三渠道框架内建，后台一页自助配置（贴密钥
> 即用），第四渠道按契约文档半天接入**。

## 0. 拆分规则（沿用 plan-upstream-shuijing-admin-billing.md §0）

"换一个 ploykit 产品要不要？" → 框架；"只对本产品有意义" → 产品。

本次判例：**waffo 适配器整体属框架**——shuijing 单机多站规划（同一台服务器跑多个
ploykit 产品站）下，每个站都会重复 internal/billingwaffo 这 708 行源码。产品侧保留的只有：
渠道启用接线（一行）、计划定价、权益钩子（UpsertEntitlementTx）、前端渠道选择。

## 1. 实战复盘：接入 waffo 的每一步摩擦（证据表）

接入动作全程发生在产品仓，下面每行"当时的解法"都是框架缺位的补丁。这是本设计的全部需求来源。

| # | 摩擦点 | 当时的解法（产品仓） | 框架化归属 |
|---|---|---|---|
| F1 | `CreateCheckout(ctx, order, successURL, cancelURL)` 的 cancelURL 对 waffo 不存在（无取消 URL，弃单自然过期），参数只能静默忽略 | 适配器里 `_ string` 吞掉 | BC-2 接口演进 |
| F2 | `domain.Order` 无买家邮箱；waffo checkout 支持 buyerEmail 预填（paypal 更需要） | 没用上，用户在收银台手输 | BC-2 CheckoutRequest |
| F3 | Stripe 适配器商品名 = `planCode + " (" + interval + ")"` 现拼；waffo 必须预注册商品（PROD id）+ priceSnapshot 覆盖价格。渠道天然分两家族：**临时定价型**（Stripe price_data）与**目录型**（waffo products、paypal products/plans） | env 塞 `WAFFO_PRODUCT_MONTHLY/YEARLY`，价格真源在 DB，checkout 时 priceSnapshot 覆盖 | BC-7 商品映射 + BC-2 能力声明 |
| F4 | 目录型渠道的商品注册靠一次性脚本（waffo-assets/create-products.mjs），改价还要再跑 update | 手工脚本 + 迁移 2004 改 DB 价 | BC-7 自动注册/同步 |
| F5 | 渠道金额是展示字符串（"9.90"），JPY 零小数；cents↔字符串换算每个适配器都要写 | 适配器内 formatAmount/parseAmount 私有实现 | BC-3 money 工具 |
| F6 | MoR 税内含约定（taxIncluded=true，买家实付=站内标价）决定 handlePaid 金额对账成败；错配=合法付款被拒发权益 | 适配器注释里写了，无框架文档 | BC-4 契约文档 |
| F7 | 幂等键 `(channel, channel_event_id)` 复合两列、无事件类型维度；waffo 要求按 (eventType, eventId) 去重（不同事件类型共用顶层 id） | 拼串 `eventType + ":" + id` workaround | BC-4 契约文档 |
| F8 | waffo 续费双事件（subscription.renewed=周期滚动 / payment_succeeded=钱）；都处理会把到期日推进两个周期 | 只认钱事件，周期滚动事件 ignored | BC-4 契约文档 |
| F9 | 首期双发（activated + payment_succeeded period=1）同到 | periodNumber=1 的 payment 事件 ignored | BC-4 契约文档 |
| F10 | waffo 无 subscriptionId 字段；`data.orderId` 在激活/续费/取消全程不变，充当稳定订阅引用；checkout metadata.order_id 透传回每个事件反查订单 | 适配器映射注释 | BC-4 契约文档 |
| F11 | 验签公钥按 test/prod 各一把，渠道配置天生带环境维度；env 里只有静态一份 | env 一份（test），文档提醒生产要换 | BC-5 凭据落库带 mode |
| F12 | `ConnectionTester` waffo 没实现；候选探活 = webhooks overview 端点（BC-9 落地时实测） | 缺失，后台"测试连接"对 waffo 报未配置 | BC-9 补齐 |
| F13 | `SubscriptionCanceller` waffo 没实现（REST 有 cancel-subscription 端点） | 缺失，后台取消订阅对 waffo 无效 | BC-9 补齐 |
| F14 | `FromEnvStrict` 全有或全无纪律（缺一生产拒启/开发降级）在产品仓手写 | 产品仓复制了 bracelet provider 的模式 | BC-1 随适配器上游化 |
| F15 | waffo 弃单**没有 webhook**（会话过期即 canceled，零回调）→ 订单永挂 pending | 无处理（接入当天发现） | BC-4 过期清扫工 |
| F16 | `knownChannelNames = []string{"stripe"}` 硬编码（service_billingcfg.go:12）——渠道名单是框架静态知识，加渠道要改框架源码 | waffo 靠已注册才在 admin 视图可见 | BC-6 一并修 |
| F17 | 后台只有**只读**渠道状态（BillingConfig 视图 + TestChannelConnection + AdminCancelSubscription 服务/路由已存在，无编辑面）；配置渠道=改 env 文件+重启 | .env.local + SSH 部署 | BC-5/BC-6 |
| F18 | 前端靠 `/config` billing_channels 自行排优先级（waffo 优先于 stripe 硬编码在 Pricing.tsx） | 产品仓 if/else | BC-2 渠道声明 DisplayOrder，产品直接取第一个可用 |
| F19 | 收银台语言硬编码 "en" | 适配器常量 | BC-2 CheckoutRequest.Locale |
| F20 | 商品图/描述在 waffo 后台手工维护 | 手工（已裁好 1200×630） | 不收编（低频、渠道后台本来就好用），BC-7 只管价格/ID |

## 2. 框架现状盘点（改造的既有地基）

已验证存在、直接复用：

- `billing/app.PaymentChannel` 最小接口（Name/CreateCheckout/ParseWebhook）+ `ChannelRegistry`。
- 可选能力接口：`ChannelConfigViewer`、`ConnectionTester`、`SubscriptionCanceller`、`CheckoutCanceller`——类型断言发现即用，`CancelPendingOrder` 对未实现渠道自然跳过。
- webhook 统一挂载 `POST /webhooks/billing/{channel}`，raw body 直读（验签正确性的前提），CSRF 豁免是产品侧接线项。
- 事件幂等（`payment_event` 表 `(channel, channel_event_id)` 复合唯一键；冲突且 process_status='error' 的行复活重处理——BC-4 的重试/清扫有现成地基）、金额对账（amountMismatch）、状态机（pending→paid/failed/canceled/refunded）、权益钩子（OnPlanChangedTx/OnSubscriptionRenewed）全部渠道无关，本次 waffo 接入零改动——**这层设计经受住了第一个非 Stripe 渠道的考验，是本方案不动内核的依据**。
- admin billingops 已有只读 `BillingConfig` 视图路由 + bridge；`OrdersPage`/`PlansPage` 在。
- settings 体系：通用 KV 表（无 DDL）、`IsSensitive` + sealer 封存（现只有 smtp_pass）、`MaskedValue` 脱敏渲染、AdminSettingsPage 卡片模式——渠道凭据落库的全部地基都在。
- Stripe 适配器（临时定价型范例）+ Manual 渠道（人工核销范例）。

## 3. 设计原则

1. **价格真源唯一在 DB**（plan limits）。渠道目录价格只是展示壳；支持会话级改价的渠道（waffo priceSnapshot）必须在结账时覆盖，保证 amountMismatch 对账永远成立。
2. **渠道两家族显式化**：临时定价型（stripe）/ 目录型（waffo、paypal）。目录型的商品注册、映射、改价同步是框架职责（BC-7），不是每个产品的一次性脚本。
3. **内核不动，适配器吸收差异**：五律契约（BC-4）把 waffo 踩过的坑固化成适配器义务，paypal 接入时照单执行。
4. **后台一页自助**：渠道配置 = 贴密钥 + 点测试连接 + 复制 webhook URL。不新增侧边栏入口（认知瘦身原则），挂在现有 admin 计费区。凭据落库封存，env 仅作种子。
5. **无兼容包袱**（用户既定偏好）：接口演进直接破坏性升级（v0.13.0），Stripe/manual 适配器随内核一次改齐，不写桥接层。

## 4. 改造包

### BC-1 waffo 适配器上游化（P0）

`shuijing/internal/billingwaffo` → `billing/adapters/waffo`（3 源文件 + 2 测试文件原样迁移）。
对外 `waffo.New(Config)` + `waffo.FromEnv(getenv, log, production)`（F14 纪律随包走）。
私钥四形态归一（PEM/`\n` 转义/整段 b64/裸 b64 体）保留——waffo 后台复制密钥的四种姿势都收。
shuijing 侧改 import、删 internal 目录。上游化开发期在 go.mod replace 之下进行（replace
本就服务于其他包）；发布收尾（去 replace、出 tag）见 §6。
**验收**：shuijing 全量测试绿 + 真实 API create-session 冒烟仍绿。

### BC-2 PaymentChannel 接口演进（P0，破坏性）

```go
type CheckoutRequest struct {
    Order      domain.Order
    SuccessURL string
    CancelURL  string            // 目录型渠道可忽略；必须显式声明 ignoresCancel() 之类能力而非静默
    BuyerEmail string            // F2：identity 侧解析注入（user 表 email）
    Locale     string            // F19：站点语言透传收银台
}

type PaymentChannel interface {
    Name() string
    CreateCheckout(ctx context.Context, req CheckoutRequest) (domain.CheckoutSession, error)
    ParseWebhook(ctx context.Context, req WebhookRequest) (domain.PaymentEvent, error)
}

// 能力声明（可选接口，registry 收集后暴露给产品/admin/前端）：
type ChannelCapabilityViewer interface {
    Capabilities() ChannelCaps   // { CatalogBased bool; SupportsCancelURL bool; DisplayOrder int; Currencies []string }
}
```

BillingService.CreateCheckout 组装 CheckoutRequest（buyerEmail 从 identity 解析一次）；
`/config` 的 billing_channels 变成有序数组（DisplayOrder 升序），产品前端取第一个可用渠道，删掉各自硬编码的优先级（F18）。Stripe/manual 适配器同批改签名。

### BC-3 共享 money 工具（P0）

`billing/money`：`FormatCents(cents int, currency string) string`（JPY 零小数）、
`ParseAmount(display string) int`（"9.90"→990，容错空串/负号/多小数位拒绝）、
`ValidateCurrencies(currency string) error`。waffo/stripe/paypal 适配器统一改用。

### BC-4 适配器契约文档 + 弃单清扫（P0）

**契约五律**（写进 `billing/doc.go` 与本文，paypal 接入的验收清单）：

1. **钱事件唯一**：续费类生命周期每个计费周期只产生一个 `EventSubscriptionRenewed`，取"钱到账"事件（waffo=payment_succeeded、stripe=invoice.paid、paypal=PAYMENT.SALE.COMPLETED）；周期滚动通知（waffo renewed）必须 ignored。
2. **首期去重**：首笔同时触发激活+付款双事件时，只映射激活事件为 `EventCheckoutCompleted`（waffo periodNumber=1 判定）。
3. **稳定订阅引用**：`SubscriptionRef` = 渠道侧跨周期不变的标识（stripe=subscription id、waffo=orderId）；结账会话 metadata 必须带 `order_id` 并确认渠道会回传（waffo orderMetadata 全事件透传）。
4. **ChannelEventID 全局唯一**：库表幂等键是 `(channel, channel_event_id)` 复合列、无事件类型维度；渠道侧幂等键为 (type, id) 二元组时（waffo），必须拼进 ChannelEventID 这一个字段（`type:id`）。
5. **环境标记**：事件带 `mode: test|prod` 时记入 Payload 并审计；渠道配置了 mode 时跨环境事件直接拒收（test 回调永不落生产权益）。

**弃单清扫**（F15）：订单表现在只有 channel_ref 落库（CheckoutSession.ExpiresAt 未持久化，ports.go 的 SetOrderChannelRef 只存 ref），随本包给 order 加 `expires_at` 列（CreateCheckout 成功后随 SetOrderChannelRef 一并写入）；`ExpireStaleOrders(now)`——pending 且过期置 canceled，挂进现有 workers 轮询（与 ExpireDueWorkspaces 同款接线）。waffo 弃单零回调、paypal 放弃同理，stripe 虽有 expire 事件但清扫兜底无副作用（状态机 ErrStatusConflict 幂等）。

### BC-5 渠道凭据落库 + 热生效（P1）

settings 键命名 `billing_channel.<name>.<field>`（如 `billing_channel.waffo.merchant_id`、`.private_key`、`.webhook_public_key`、`.mode`）；`IsSensitive` 从单键改为前缀判定（`billing_channel.` 开头全封存，沿用 sealer，fail-closed 语义不变）。
生效配置 = DB 值覆盖 env 值（env 降级为首次种子，F17：从"改文件重启"变"后台贴密钥即用"）。
热生效：`ChannelRegistry` 包一层 `AtomicRegistry{ Factory func(cfg) []PaymentChannel }`——settings 变更通知后重建渠道实例原子换指针；admin 保存 → 30s 内全站生效，无重启。BillingConfig 视图读实时生效态。

### BC-6 后台渠道配置页（P1）

不新增导航入口，挂 admin 计费区（OrdersPage 同层 tab 或 PlansPage 上方卡）。每渠道一张卡：

- **表单按描述符渲染**：适配器新增 `ConfigSchema() []FieldSpec{Key, Label, Type(text/secret/select), Options, Help, Required}`——框架 UI 不认识 waffo/paypal 的字段也能画表单（第四渠道零 UI 改动）。
- **webhook URL 展示 + 复制按钮**：`/webhooks/billing/waffo` 直接抄走贴渠道后台（本次接入这是手工拼出来的）。
- **测试连接**：现有 `TestChannelConnection` 路由接按钮；waffo 探活 = webhooks overview 端点（BC-9 落地时实测，F12）。
- **模式徽标 + 测试卡提示**：mode=test 时显示 waffo 4110 卡号/paypal sandbox 指引；mode=prod 且 KYB 未过（waffo 403）显示"等待渠道审核"。
- `knownChannelNames` 删除（F16）：未注册渠道 = 无配置无卡，注册即现。

### BC-7 目录型渠道商品映射（P1）

新表 `billing_channel_products(channel, plan_code, interval, channel_product_id, synced_price_cents, synced_at, UNIQUE(channel, plan_code, interval))`。
适配器可选接口：

```go
type ProductRegistrar interface {
    RegisterProduct(ctx context.Context, plan domain.Plan, interval domain.BillingInterval) (channelProductID string, err error)
    SyncPrice(ctx context.Context, channelProductID string, plan domain.Plan, interval domain.BillingInterval) error
}
```

- CreateCheckout 时目录型渠道先查映射；未注册→按配置自动注册或报"去后台点注册"（admin 卡上一个按钮调 RegisterProduct，F4 收编 create-products.mjs）。
- **改价联动**：admin PlansPage 改价（已有 PATCH）后，对已映射渠道提示"3 个渠道价格待同步"，一键 SyncPrice 全渠道对齐（迁移 2004 + waffo update-product 的手工组合消失）。

### BC-8 paypal 适配器（P2，验证框架成色的试金石）

OAuth2（client id/secret）+ Products/Plans 目录型 + Orders（一次性）+ Subscriptions。
webhook 验签走 `/v1/notifications/verify-webhook-signature`（ParseWebhook 允许 I/O——现有签名已带 ctx，无需改）。
事件映射按五律执行：PAYMENT.SALE.COMPLETED→renewed（周期 2 起）、BILLING.SUBSCRIPTION.ACTIVATED→checkout.completed、CANCELLED→canceled、REFUND→refund.created。
**验收即 BC-4/BC-7 的集成测试**：若 paypal 接入仍需改内核，本设计失败回炉。

### BC-9 waffo 适配器补齐（P0 尾）

- `SubscriptionCanceller`（F13）：REST cancel-subscription。
- `ConnectionTester`（F12）：list-webhooks 探活。
- 金额/密钥工具切到 BC-3。

## 5. 分期与验收

| 期 | 包 | 版本 | 验收 |
|---|---|---|---|
| P0 | BC-1/2/3/4/9 | v0.13.0 | shuijing 换框架包全绿；三渠道接口统一签名；五律入 doc.go；清扫工上线后 24h 弃单不再挂 pending |
| P1 | BC-5/6/7 | v0.14.0 | 后台贴 waffo 测试密钥→测试连接绿→checkout 真实走通→webhook 发权益，全程无 SSH 无 env 编辑无重启 |
| P2 | BC-8 | v0.15.0 | paypal sandbox 全链（订阅/续费/取消/退款）零内核改动接通 |

## 6. shuijing 迁移路径（P0 落地时）

1. ploykit 出 v0.13.0 tag → shuijing go.mod 去 replace（或 replace 指向新 tag 本地核对后撤）。
2. 删 `internal/billingwaffo`，import 改 `billing/adapters/waffo`；main.go 接线不变（FromEnv 签名随 BC-2 微调：多传 locale 源）。
3. `.env.local` 的 WAFFO_* 保持（P0 仍 env 驱动）；P1 后台配置页上线后将测试密钥迁入库，env 只留生产种子。
4. Pricing.tsx 渠道优先级 if/else 删掉，改读 `/config` 有序数组。

## 7. 开放问题

- buyerEmail 解析位置：BillingService 依赖 identity 读邮箱（新增 repo 方法）还是 CheckoutRequest 由 main.go 装配时注入 resolver？倾向后者（billing 不新增 identity 依赖）。
- 热生效的变更通知通道：settings 无既有 pub/sub，轮询（30s）即可起步，不值得上事件总线。
- paypal 一次性 Orders 与现有 one_time 计划（credit packs 场景）的 pack 语义映射，留到 BC-8 细化。
- waffo 14 天退款窗口 vs 产品条款：运营对齐项，不进框架。
