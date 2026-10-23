# Audit: plan-billing-channel-framework-2026-10-23.md — round 1

> 2026-10-23，设计文档定稿前的主张核验。方法与 delivery-audit-shuijing-upstream-migration.md
> 同款：文档里每条可验证断言逐条对两仓代码取证（ploykit @ a988a30、shuijing @ 93b3fd9），
> 四态判定：属实 / 部分属实 / 不实 / 外源（渠道文档，不可代码验证）。发现的问题以 N1.. 编号，
> 已回写设计文档。

## 1. 判定矩阵

### 文档头与 §0

| # | 断言 | 判定 | 证据 |
|---|---|---|---|
| A1 | "commit 31aa35d 渠道接入 + 后续调价批" | 部分属实 | 实际三个 commit：31aa35d（渠道）、1cdfed3（调价 9.90/69）、93b3fd9（webhook 公钥 livekey 对账）。文档漏数第三笔 → N1 已补 |
| A2 | "三个文件 + hermetic 测试" | 部分属实 | 3 源文件（waffo.go 259 / client.go 122 / channel.go 327 = **708 行**）+ 2 测试文件（channel_test.go 464 hermetic + livekey_xcheck_test.go 36 门控）→ N2 已改精确 |
| A3 | "每个站都会重复 internal/billingwaffo 这 900 行" | 不实（数字） | 同 A2：708 行源码。定性结论不变 → N2 |
| A4 | "真实 API 三点验证：签名/建品/create-session" | 属实 | 会话记录：create-product×2、update-product×2（改价）、create-session×2（19.00 与 9.90 各一次）全部 2xx，收银台 URL curl 200 |

### §1 摩擦点 F1–F20

| # | 断言 | 判定 | 证据 |
|---|---|---|---|
| F1 | waffo 适配器静默吞 cancelURL | 属实 | shuijing internal/billingwaffo/channel.go `CreateCheckout(ctx, order, successURL, _ string)`；注释"waffo 没有取消 URL" |
| F2 | domain.Order 无买家邮箱 | 属实 | ploykit billing/domain/model.go:35-54（字段全表：无 email） |
| F3 | Stripe 商品名现拼 planCode+interval | 属实 | billing/adapters/stripe/channel.go:57 |
| F4 | 商品注册/改价靠一次性脚本 | 属实 | shuijing waffo-assets/create-products.mjs（create/update/publish/session 四子命令） |
| F5 | cents↔展示字符串换算私有实现 | 属实 | channel.go formatAmount/parseAmount（私有）；JPY 零小数分支在测 |
| F6 | taxIncluded 约定只在适配器注释 | 属实 | channel.go priceSnapshot 结构体注释 + waffo.go 包注释"MoR 模式下税款从 $19 里出" |
| F7 | 幂等键无事件类型维度 | 部分属实（更强了） | pgrepo/repo.go:203-216：`ON CONFLICT (channel, channel_event_id)`——**复合两列**，非"单列"；且冲突行 process_status='error' 时 DO UPDATE 复活重处理（BQ1 语义）。F7 的实质成立（无 type 列 → 必须拼进 id 串），但"单列"表述错误 → N3 已改，并把复活语义补进 §2（对 BC-4 是利好：清扫/重试有地基） |
| F8/F9 | 续费双事件只认钱 / 首期双发去重 | 属实 | channel.go ParseWebhook switch：`subscription.payment_succeeded` periodNumber>1 才映射 renewed；periodNumber=1 → "ignored" |
| F10 | orderId 充当稳定订阅引用 + metadata 回传 | 属实 | channel.go：`ev.SubscriptionRef = env.Data.OrderID`；metadata.order_id → orderMetadata 读取 + orderMerchantExternalId 双保险 |
| F11 | 验签公钥按 test/prod 各一把 | 外源 | docs.waffo.ai/api-reference/webhooks.md（平台级、分环境、加 URL 不换钥） |
| F12 | ConnectionTester 未实现；"后确认可用 list-webhooks" | 部分属实 | 适配器确未实现（channel.go 无 TestConnection）；"已确认"过强——llms.txt 见 "Webhooks: overview" 端点存在，但未实测 → 改为"候选探活，BC-9 核实"（N4） |
| F13 | SubscriptionCanceller 未实现 | 属实 | channel.go 无 CancelSubscription；waffo REST 有 cancel-subscription（docs subscriptions/cancel-subscription.md） |
| F14 | FromEnvStrict 纪律产品仓复制 | 属实 | billingwaffo/waffo.go FromEnvStrict vs bracelet/provider.go:384 同构 |
| F15 | waffo 弃单零回调 | 外源 | create-checkout-session.md："No cancelUrl — abandoned sessions just expire (order ends canceled, no webhook)"。本地反证不存在（无法证伪渠道行为），清扫工设计按此假设 |
| F16 | knownChannelNames 硬编码 stripe | 属实 | billing/app/service_billingcfg.go:12 `var knownChannelNames = []string{"stripe"}` |
| F17 | admin 只读、无编辑面；测试连接/取消订阅路由已在 | 属实 | admin/adapters/http/routes_billingops.go:41 test-connection、:42 cancel-subscription、:189 BillingConfig；packages/ui/src/pages/admin/ 无渠道配置页 |
| F18 | 前端硬编码渠道优先级 | 属实 | shuijing web/src/pages/Pricing.tsx `channels.includes('waffo') ? 'waffo' : 'stripe'` |
| F19 | 收银台语言硬编码 "en" | 属实 | channel.go createSessionReq `Language: "en"` |
| F20 | 商品图后台手工 | 属实 | waffo-assets/seller-plan-1200x630.jpg 手工裁切上传 |

### §2 现状盘点

| # | 断言 | 判定 | 证据 |
|---|---|---|---|
| S1 | 内核（状态机/对账/钩子）waffo 接入零改动 | 属实 | 31aa35d diff 不触 ploykit（ploykit 工作树在本文档之前干净）；billing/app/service.go handlePaid/handleRenewed 等未动 |
| S2 | 可选接口四件套存在 | 属实 | ports_billingcfg.go:17/21/34 + service.go:679 CheckoutCanceller |
| S3 | webhook raw body 直读 | 属实 | billing/adapters/http/routes.go:126 `io.ReadAll(io.LimitReader(r.Body, 1<<20))` |
| S4 | 事件幂等"单列唯一" | 不实（表述） | 同 F7 → N3：复合键 + error 复活，已改写 |
| S5 | settings 封存地基（无 DDL/IsSensitive 单键/MaskedValue/卡片页） | 属实 | settings/store.go:15-16 fail-closed sealer、keys.go:95 `IsSensitive = KeySMTPPass`、AdminSettingsPage.tsx |
| S6 | orders 表无过期列，仅 channel_ref | 属实 | pgrepo/repo.go:32-33 orderCols 全列清单（无 expires_at）；repo.go:108 SetOrderChannelRef 只写 ref |
| S7 | plans 已有 PATCH | 属实 | routes_billingops.go:29 `PATCH /api/admin/plans/{code}` |

### 版本与分期

| # | 断言 | 判定 | 证据 |
|---|---|---|---|
| V1 | P0/P1/P2 = v0.13.0/v0.14.0/v0.15.0（前提：下一 minor 是 0.13.0） | 属实 | CHANGELOG.md：[0.12.0] 2026-10-21 已发布 + [Unreleased] 在顶 → 下一 minor 即 0.13.0（起草时版本取值曾按"0.12.0 未发"推算，与 sed 修正后的 0.13.0 起一致，结论无需再改） |

## 2. 发现与处置（已回写设计文档）

- **N1** 文档头 commit 清单补全三笔（31aa35d/1cdfed3/93b3fd9）。
- **N2** "900 行 / 三个文件+hermetic 测试" → "3 源文件 708 行 + 2 测试文件（hermetic 464 行 + live 门控 36 行）"。
- **N3** 幂等键表述：全文"单列 ChannelEventID"改为"(channel, channel_event_id) 复合幂等键，无事件类型维度；冲突行 error 态复活重处理"。§2 同步补复活语义。
- **N4** F12 "后确认可用 list-webhooks" 降级为"候选探活 = webhooks overview 端点（BC-9 落地时实测）"。
- **N5**（一致性澄清）BC-1 说"replace 仍服务于其他包"、§6 说"出 tag 去 replace"——两者不矛盾但易误读：BC-1 在 replace 之下开发迁移，§6 描述发布收尾。已在 BC-1 补一句"上游化开发期走 replace，发布见 §6"。

## 3. 审计结论

20 条摩擦点（F1–F20）**18 属实 / 1 部分属实（F7，实质成立表述错） / 1 外源（F15）**；现状盘点 7 条中 1 条表述不实（S4，同 F7）；数字类错误 2 处（A2/A3 行数）。**无动摇设计的发现**——唯一实质修正（复合幂等键 + error 复活）反而强化了 BC-4 清扫工/重试的地基论证。N1–N5 已全部回写设计文档，状态从 draft 升为 audited。文档可进入执行。
