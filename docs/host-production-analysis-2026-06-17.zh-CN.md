# PloyKit 宿主代码生产级分析报告

- 分析日期：2026-06-17
- 分析范围：`apps/host-next`、`src/lib/module-runtime`、`src/lib/module-capabilities`、`src/module-sdk`、`scripts`（**不含 `modules/`**）
- 方法依据：`docs/production-grade-analysis-playbook.zh-CN.md`（§5 架构边界、§6 安全权限、§7 数据事务、§8 商业化、§11 可观测性、§13 复杂度、§14 依赖、§16 测试）
- 风险分级依据：playbook §3（P0 发布阻断 / P1 生产可信度 / P2 维护性 / P3 polish）

## 0. 逐项复核与处理状态（2026-06-17）

> 本节是对下方原始分析的处理标记。结论分为：已修复、部分有效/已缓解、误报/说明、确认但不做行为修复。

| 原条目 | 复核结论 | 处理结果 |
| --- | --- | --- |
| P0-1 兑换码 `maxRedemptions` 并发超发 | 真实问题 | 已修复。`recordRedeemRedemption` 增加 `maxRedemptions` 原子校验；Postgres 使用事务 + `pg_advisory_xact_lock`，memory store 同步校验；补跨用户并发/限量测试。 |
| P1-1 checkout/refund 多步写无事务 | 真实问题（生产持久 store 路径） | 已修复生产路径。`RuntimeStore` 增加可选 `transaction`，Postgres store 实现事务；商业 provider 的 checkout/refund/reconcile/settlement/subscription event 写路径通过事务包装。memory 顶层 runtime store 仍不提供全域事务，生产 required gate 已要求 durable store。 |
| P1-2 Data v2 memory `transaction` 无回滚 | 真实问题 | 已修复。memory Data v2 transaction 失败时恢复快照；补 rollback 回归测试。 |
| P1-3 Stripe webhook 不落 receipt | 真实问题 | 已修复。Stripe webhook 验签后写入 runtime webhook receipt，按 `stripe:<account>:<event.id>` 幂等，支持 duplicate/failed 重新处理并记录 processing/processed/failed 状态。 |
| P1-4 worker 重试可能重复 webhook handler 副作用 | 真实问题 | 已缓解。webhook runner 成功执行 handler 后写 delivery ledger marker；重试遇到已 delivered marker 会直接把 receipt 标为 processed。显式 replay 仍会重新执行；不可逆外部副作用仍应由 handler 自身使用业务幂等键。 |
| P1-5 `ConfigWrite` 契约漂移 | 真实问题 | 已修复为 reserved runtime permission。validator 会拒绝模块声明该权限；registry 标明 `runtime: "reserved"`，避免暴露不存在的 `ctx` 写能力。 |
| P1-6 `SecretsWrite` 契约漂移 | 真实问题 | 同 P1-5，已修复为 reserved runtime permission 并补 contract 测试。 |
| 匿名 AI 成本归并到 `anonymous` | 部分真实 | 已修复。AI billing subject 现在优先使用 user、subject、apiKey、workspace；无可计费 subject 时 fail-fast。原报告“匿名 public route 可直接耗共享桶”表述偏重，因为 anonymousPolicy/capability guard 已挡住多数匿名能力路径。 |
| 内存 AI/RAG runtime 无 cost guard，production 仅 warning | 部分真实 | AI production provider 非 webhook 已升为 config-doctor error；host AI API 仍走 cost guard。RAG durability 在使用 durable runtime store 时由 runtime vector/provider 状态体现；纯 memory/local 模式不作为 production ready。 |
| Admin commercial store 直读依赖调用点权限 | 真实问题 | 已修复。`getAdminCommercialView(session)` 强制 `billing.read` capability，并按 session productId 查询，页面/API 调用点传入已鉴权 session。 |
| `SubjectsRead` / `ConnectorsManage` / `UnsafeInternalResource` 漂移 | 部分真实 | `SubjectsRead`、`ConnectorsManage` 已标为 reserved 并拒绝模块声明；`UnsafeInternalResource` 是 system-only 保留权限，无 request runtime capability，原“无 assertPermission 即漏洞”属于误报/说明项。 |
| 审计/运行日志 retention required gate 不报错 | 真实问题 | 已修复。production/required config doctor 缺 `PLOYKIT_AUDIT_RETENTION_DAYS` 或 `PLOYKIT_RUN_LOG_RETENTION_DAYS` 时给 error，并校验 1..3650 天。 |
| Admin 单产品硬编码 `DEMO_PRODUCT_ID` | 真实问题 | 已修复核心 admin commercial view：使用 session productId/defaultProductId，不再使用局部 `DEMO_PRODUCT_ID` 常量。 |
| runtime migration 无 rollback/backfill 文档 | 真实问题 | 已修复文档。`docs/runtime-stores.zh-CN.md` 增加 forward-only、备份、dry-run、unique/not-null 前置检查、失败恢复、compensating migration 和 backfill 记录要求。 |
| `RuntimeStore` 顶层无事务原语 | 真实问题 | 已修复接口与 Postgres 实现。接口新增可选 `transaction`；生产商业路径消费该能力。 |
| `createRuntimeLogger` 未接入请求路径 | 真实问题 | 已修复。module API/page/action route 错误路径改为结构化 logger + redaction sink，替代直接裸 `console.error(error)`。 |
| 4 个 >800 行混合领域文件 / 大体量 UI 装配文件 | 真实维护性问题 | 确认但本轮不做行为性拆分。该项不阻塞生产正确性，拆分会产生大范围 churn；保留为后续重构项。 |
| 审计 hash 链无专门回归测试 | 真实问题 | 已修复。新增 `verifyAuditEnvelope` 并在 runtime store 测试中验证 hash 可校验且篡改会失败。 |
| `ctx.http` 出站无审计 | 真实问题 | 已修复。`createModuleHttpApi` 增加 audit hook；host capability provider 记录 `module.http.fetch` audit，包含 origin/path/status/duration/errorCode。 |
| AI 失败未分类 | 真实问题 | 已修复。provider AI runtime 失败 audit 增加 `errorCode` 和 `errorCategory`（provider/quota/policy/transport）。 |
| `module-action-route` 直接 `console.error` | 真实问题 | 已修复为结构化 runtime logger。 |
| `package.json overrides.postcss` 无原因 | 真实 polish | 已处理。新增 `overridesMeta.postcss` 说明保留 override 的原因。 |
| `auth.ts` dev session fallback 语义需测试 | 真实测试缺口 | 已补测试：生产缺 secret 会抛错，development 可使用 fallback 且不加 Secure。 |
| `module.sideEffect` 文档不清 | 部分误读 | 已澄清文档：sideEffect 会触发 validator 对 confirmation/idempotency 的要求，但不是事务/回滚边界。 |
| AI/RAG 高成本调用缺专属审计类型 | 真实问题（AI 路径） | 已修复 AI：高于 1 credit 的 AI invocation 记录 `host.ai.high_cost_invocation` audit。RAG 当前未发现同等高成本扣费路径，本轮标为 AI 已闭环。 |
| `module.scope.roles` / `module.egress` runtime 强制不明确 | 部分误报/已澄清 | `egress` 已由 `ctx.http.fetch` 强制消费；`scope.roles` 是目录/安装/Admin 语义元数据，不替代 route/action/surface 的 executable guard。文档已补明确边界。 |

已执行的关键验证：

- `npm run test:commercial-ledger` ✅
- `npm run test:runtime-stores` ✅（Postgres 子测试因本机 `127.0.0.1:55432` 不可达而 skip）
- `npm run test:commercial-postgres` ✅（Postgres 不可达，测试按设计 skip）
- `npm run test:ai-provider-runtime` ✅
- `npm run test:production-runtime` ✅
- `npm run test:security-runtime` ✅
- `npm run test:module-contract` ✅
- `npx tsx --test tests/api-key-store.test.ts tests/rate-limit.test.ts tests/host-runtime.test.ts tests/module-contract.test.ts` ✅
- `npm run test:background-reliability` ✅
- `npx tsx --test tests/web-shell-auth.test.ts tests/web-shell-security.test.ts` ✅
- `npx tsx --test tests/web-shell-commercial.test.ts tests/web-shell.test.ts` ✅
- `npm run docs:encoding-check` ✅
- `npm run test:data-runtime` ⚠️ memory 子测试通过，Postgres 子测试因本机 Postgres 不可达失败（该测试不 skip）。
- `npm run typecheck` ⚠️ 本次改动相关类型错误已清零；当前剩余错误来自报告范围外、未跟踪的 `modules/runlynk/tests/smoke-integration.test.ts`（本文分析范围明确不含 `modules/`）。

## 1. 原始总体结论

宿主整体已经具备生产级框架的骨架，多个安全边界达到了相当高的成熟度：默认启动安全有 fail-fast、原始 SQL 有 system-only + RLS 双重防护、SSRF 防护完整、审计基础设施带 hash 链、Postgres 并发原语（advisory lock、`for update skip locked`、唯一幂等索引）质量很高。

主要风险**不来自“缺代码”，而来自“边界不闭合”**——这正是 playbook §2.2 / §23 强调的模式：能力建好了但没接上运行时，或类型声明了但没强制执行。

原始风险数量统计（处理状态见 §0）：

| 级别 | 数量 | 概述 |
| --- | --- | --- |
| P0 | 1 | 兑换码 `maxRedemptions` 跨用户并发竞态，可超发 |
| P1 | 6 | 商业多步写无事务、memory/PG 事务不对等、Stripe webhook 不落 receipt、worker 重试副作用、`ConfigWrite`/`SecretsWrite` 契约漂移 |
| P2 | 多项 | 结构化日志未接入运行时、大文件混合领域、迁移无回滚文档、匿名 AI 成本归并、admin store 直读、若干权限声明未检查 |
| P3 | 多项 | `ctx.http` 无审计、AI 错误未分类、overrides 无注释等 |

> 说明：下方 §2 起保留原始分析文本，避免丢失当时证据和推理；2026-06-17 的逐项处理结论与验证结果以 §0 为准。

---

## 2. P0 — 发布阻断

### P0-1 兑换码 `maxRedemptions` 存在 read-then-write 竞态，跨用户可超发

- 证据：[commercial-ledger-redeem.ts:79-90](../src/lib/module-capabilities/commercial/commercial-ledger-redeem.ts#L79-L90)
- 现象：兑换流程先 `listRedeemRedemptions` 数已有兑换数（line 84），再比较 `redemptions.length >= maxRedemptions`（line 88），最后才 `recordRedeemRedemption`（line 93）。整个过程**没有事务、没有针对总量的条件更新、没有总量唯一约束兜底**。
- 幂等键 `redeem:${codeHash}:${userId}`（line 92）只对**同一用户**去重；唯一约束仅 `(product_id, code, user_id)`（migration `0002:82`），**不防 N 个不同用户并发突破总量上限**。
- 最坏结果：一个限量 100 份的兑换码在高并发下被超发，超额发放权益（entitlement）与信用（credits）——直接造成商业损失。playbook §7.2 明列“先读库存再写库存，没有条件更新”为危险模式。
- 修复方向：在 Postgres 层用事务 + `pg_advisory_xact_lock`（兑换码已有 `consumeCreditLedger` 同款实现可复用，见 `postgres-runtime-store-commercial-credits.ts:67-131`），或对 redemption 写入增加基于 `maxRedemptions` 的条件插入 / 计数唯一约束。补跨用户并发 deny 测试。
- 验收命令：`npm run test:commercial-ledger`、`npm run test:commercial-postgres`、`npm run host:billing-reconcile-smoke`

---

## 3. P1 — 生产可信度

### P1-1 商业多步写无事务（checkout / refund）

- 证据：[commercial-ledger-provider.ts:116-213](../src/lib/module-capabilities/commercial/commercial-ledger-provider.ts#L116-L213)（`applyCheckoutPaid`）、同文件 `applyRefund` 280-317
- `applyCheckoutPaid` 顺序执行：upsert catalog → 建/查 order → `updateCommercialOrderStatus('paid')` → `applySkuBenefits` → 开发票 → 审计 → 发事件，**全程无 DB 事务**。中途失败会留下“order=paid 但发票/事件缺失”的半成品。
- 缓解：benefit 写入用确定性幂等键（`order:${id}:credits` 等）+ 有 `reconcilePaidOrderBenefits` 后台补偿，所以最坏结果是**延迟一致**而非重复扣费——故评 P1 而非 P0。但 `applyRefund` **无对应 reconcile 兜底**，半状态无法自动修复。
- 修复方向：将 paid/refund 的多步本地写包裹进 store 事务；为 refund 增加 reconcile 路径。

### P1-2 memory store `transaction` 无回滚，与 Postgres 行为不一致

- 证据：[data/memory.ts:191-192](../src/lib/module-runtime/data/memory.ts#L191-L192) vs `data/pg-executor.ts:74-91`
- memory 下 `transaction` 只是直接回调，无任何回滚；Postgres 下是真实 `begin/commit/rollback` + savepoint。后果：依赖事务回滚的写路径在 memory store（默认开发/测试环境）下永远“通过”，掩盖 Postgres 才会暴露的问题。违反 playbook §7.1“同一 store 在两种实现下行为一致”。
- 附带：memory 的 SQL `transaction` 把 `query`/`execute` 实现为返回空（memory.ts:201-208）——依赖原始 SQL 的事务逻辑在 memory 下是空操作。
- 修复方向：memory store 实现快照/回滚语义，或在测试中强制对事务路径跑 Postgres。

### P1-3 Stripe webhook 不落 receipt，无统一审计/重放入口

- 证据：[app/api/billing/stripe/webhook/route.ts:28](../apps/host-next/app/api/billing/stripe/webhook/route.ts#L28)
- 验签后直接 `applyStripeWebhookEvent`，**不创建 webhook receipt 记录**。幂等性完全依赖下游 `idempotencyKey: event.id`（落到 `module_commercial_orders` / `module_subscription_events` 的 unique 索引，功能上**不会重复入账**）。
- 缺口：(a) 与 module-webhooks 路径不一致（后者有 receipt + replay + 审计）；(b) 缺少统一的 webhook 接收审计与重放入口；(c) `event.id` 未带 provider/account scope（单 Stripe 账户可接受，多账户场景理论上可冲突，inferred）。
- 修复方向：Stripe webhook 接入与 module-webhooks 同款 receipt + 幂等 + 审计机制。

### P1-4 worker 重试可能重复副作用

- 证据：[runtime-store-webhook-gateway.ts:381-391](../src/lib/module-runtime/stores/runtime-store-webhook-gateway.ts#L381-L391)、`runtime-store-queue.ts:147-182`
- 框架重试机制本身正确（lease + attempts + dead-letter）。但**副作用幂等性下放给 handler**：webhook handler 成功执行后若 `markWebhookReceipt('processed')` 失败，整条会重试并重新执行 handler——若 handler 内做发邮件/扣费且无自身幂等键，会重复。playbook §7.2 明列此模式。
- 修复方向：在框架层提供副作用幂等包装，或在文档/模板中强制 handler 幂等键约定。

### P1-5 `Permission.ConfigWrite` 声明但无运行时写能力/守卫（契约漂移）

- 证据：`permissions.ts`（`config.write` 枚举）vs [capability-guard.ts:237-254](../src/lib/module-runtime/security/capability-guard.ts#L237-L254)（`guardConfig` 只守 `get`/`require`，用 `ConfigRead`）
- 权限枚举里有 `ConfigWrite`，但运行时既无写能力实现，也无对应守卫。属 playbook §2.2 典型契约漂移（“权限枚举存在，但 capability guard 没检查”）。
- 修复方向：实现写能力并加守卫，或将 `ConfigWrite` 标记为 experimental/移除。

### P1-6 `Permission.SecretsWrite` 同上

- 证据：`permissions.ts`（`secrets.write`）vs `guardSecrets`（capability-guard.ts:256-273 只读）+ 运行时 `capabilities/secrets.ts` 仅 get/require
- 与 P1-5 同类漂移。修复方向同上。

---

## 4. P2 — 维护性与协作

### 安全 / 权限

- **匿名 AI 成本归并到共享 `user:anonymous` 桶**：[ai-provider.ts:327](../apps/host-next/lib/capability-providers.ts) 取 `session.userId ?? 'anonymous'`，cost guard 的 reserve/charge 全部记到同一 subject（`cost-guard.ts:23`）。后果：匿名用户共享一个信用桶——要么全局耗尽放大 DoS，要么不受控。**若上游 route 层（anonymousPolicy）无匿名 AI 限制则应升 P1**，需确认。
- **内存 AI/RAG runtime 无 cost-guard**：`ai-runtime.ts`/`rag-runtime.ts` 仅 `usage.record`，无 reserve/charge；生产应强制 webhook provider，但 `config-doctor.ts:276` 仅 warning 而非 error。
- **Admin store 直读绕过 capability-guard 的 subject 过滤层**：`admin-commercial.ts:335` 等大量直接 `runtimeStore.store.list*({ productId: DEMO_PRODUCT_ID })`，依赖分散在调用点的 `requireCapability`，未来若被非 admin 路由复用会越权。建议为 admin store 读取建立显式前置断言。
- **声明但无运行时检查的权限**：`SubjectsRead`（`ctx.subjects` 全仓无实现）、`ConnectorsManage`（`guardConnectors` 只守 read/invoke）、`UnsafeInternalResource`（无任何 assertPermission 引用点）。
- **审计/运行日志保留期无默认且未在 required gate 升级为 error**：`config-doctor.ts:359-364` 仅文本提示。
- **Admin 单产品硬编码 `DEMO_PRODUCT_ID`**：多租户 admin 视图未按 productId 参数化。

### 数据 / 迁移

- **迁移无 rollback / 显式 backfill，回滚未文档化**：30 个迁移严格 append-only + checksum 漂移检测（质量高），但仅 forward-only，新增 unique 索引若已有重复数据会失败、无前置去重，回滚策略未文档化（playbook §7.3 要求）。
- **`RuntimeStore` 顶层接口无事务原语**：`runtime-store-types.ts:228` 无 `withTransaction`，跨域多步原子写难以在抽象层表达。

### 可观测性 / 复杂度 / 测试

- **结构化日志器未接入生产请求路径（契约漂移）**：[observability/logger.ts](../src/lib/module-runtime/observability/logger.ts) 定义了带 requestId/userId/moduleId + 脱敏的 `RuntimeLogRecord`，但 `createRuntimeLogger` 全仓**仅被自身和测试引用**——能力建好了没用上。这是本次最突出的可执行 P2。
- **4 个 >800 行混合领域文件**：`commercial-provider.ts`(1320，crypto+checkout+reconcile+审计+i18n)、`admin-service-connections.ts`(1212，加解密+权限+审计+连接器)、`auth.ts`(980，注册/登录/会话/重置/验证/审计/seed)、`worker.ts`(760，队列/事件/webhook/email 四 drain)。
- **大体量 UI/装配文件**：`AdminPrimitives.tsx`(1308，38 export)、`capability-providers.ts`(1199，全 capability 装配)。
- **审计 hash 链防篡改无专门回归测试**，结构化 logger 无集成测试。

---

## 5. P3 — polish

- `ctx.http` 出站调用无审计回调（`createModuleHttpApi` 未传 audit）；SSRF 防护本身很强。
- AI 失败未区分 provider-error / quota-error / policy-error 三态（`provider-ai-runtime.ts:100-111`）。
- `module-action-route.ts:345` `console.error` 直接打印 error 对象（仅服务端，不返回客户端）。
- `package.json` `overrides.postcss` 无原因注释（playbook §14.1 要求）。
- `auth.ts:422` 无 sessionId 时 dev 会话返回 `true` 的宽松语义，建议加测试固化（生产侧已安全）。
- `module.sideEffect` 为纯元数据，无运行时语义，应在文档明确其非 enforcement 字段。
- AI/RAG 高成本调用缺专属高风险审计事件类型，无法在审计流按 high-cost 筛选。
- `module.scope.roles` / `module.egress` 字段的运行时强制不明确（见下“契约漂移清单”）。

---

## 6. 验证为“健康”的边界（强项，无需改动）

记录这些是为了避免后续误改：

- **Host→Module 反向导入**：实测 0 命中，宿主/运行时不 import 具体模块实现，无硬编码模块 ID 业务逻辑；`module-map.ts` 为生成注册表（§5.1 ✅）。
- **默认启动安全**：demo 用户/bootstrap admin/auth secret/memory store/default DB URL 在生产全部 fail-fast（`auth.ts:285-321`、`runtime-store.ts:122-145`，§6.1 ✅）。
- **原始 SQL**：`DataSqlRead/Write` + `UnsafeSqlRaw`（system-only）双重权限 + RLS session + scope where + 标识符白名单 + 参数化（`capability-guard.ts:222-233`、`postgres.ts:249-287`，§5.3 ✅）。
- **SSRF（ctx.http）**：egress allowlist 默认拒绝 + DNS pinning + 私网拦截 + 敏感头拦截 + 重定向源校验（`http-runtime.ts:443-546`，✅）。
- **审计基础设施**：hash 链防篡改信封 + 自动分类/风险分级 + 写入前脱敏 + 查看即审计，覆盖 §11.2 全部必审操作（`observability/audit-metadata.ts`，✅）。
- **恢复路径**：dead-letter（含 dryRun）+ reconcile + worker 状态 admin 路由齐全，reconcile/soak/chaos smoke 脚本齐全（§11.3 ✅）。
- **信用账本并发**：Postgres `consumeCreditLedger` 用 advisory lock + 事务内余额检查 + 幂等键（教科书级，§8.1 ✅）。
- **commercial 金额单位**：全部 `numeric` + 整数 minor unit，无浮点累加（§8.1 ✅）。
- **outbox/queue 并发**：`for update skip locked` + lease + `on conflict do nothing` 幂等（§7.2 ✅）。
- **RAG workspace 隔离**：所有查询/删除按 product+workspace+module 过滤（§8.2 ✅）。
- **依赖**：runtime deps 干净无 dev 泄漏，engines 与 Next16/React19/TS6 匹配（§14 ✅，`npm audit` 未运行未验证）。
- **路由安全**：59 个 route 文件全部接入安全检查，0 个 MISSING；存在 route security catalog 自动审计（`route-security-audit.ts`，§6.2 ✅）。

---

## 7. 契约漂移清单（playbook §5.2 / §2.2）

“类型/枚举声明了，但运行时未执行或未检查”的字段，统一列出便于闭环：

| 字段 / 权限 | 声明位置 | 运行时状态 | 级别 |
| --- | --- | --- | --- |
| `Permission.ConfigWrite` | `permissions.ts` | 无写能力 + 无守卫 | P1 |
| `Permission.SecretsWrite` | `permissions.ts` | 无运行时实现 | P1 |
| `Permission.SubjectsRead` | `permissions.ts` | `ctx.subjects` 无实现 | P2 |
| `Permission.ConnectorsManage` | `permissions.ts` | `guardConnectors` 不检查 manage | P2 |
| `Permission.UnsafeInternalResource` | `SystemOnlyPermissions` | 无 assertPermission 引用 | P2 |
| `module.scope.roles.{read,write,manage}` | `types.ts:42-50` | `checkModuleRuntimeAccess` 不读取 | P1（按宿主路由维度未强制） |
| `module.egress` | `types.ts:454` | `ctx.http` 是否消费待确认 | P2 |
| `module.sideEffect` | `types.ts:96` | 纯元数据，无运行时语义 | P3 |
| `createRuntimeLogger` | `logger.ts` | 未接入任何生产请求路径 | P2 |

> 注：`module.scope.roles` 在两个分析视角中级别判定不同——架构边界视角按“宿主路由维度声明未强制”记 P1；与已闭合的 `commercial`/`anonymousPolicy`/`permissions`/`webhook signature`/`machineAuth` 字段对比，它是当前主要漂移项。建议优先确认实际 enforcement 是否落在其他守卫层后再定级。

---

## 8. 建议处理顺序

1. **P0-1 兑换码竞态**——发布阻断，最高优先。复用 `consumeCreditLedger` 的 advisory lock 模式 + 补并发 deny 测试。
2. **P1 数据一致性三件套**（P1-1 商业事务、P1-2 memory 回滚、P1-3 Stripe receipt、P1-4 worker 副作用）——进入近期迭代，配合 `test:commercial-*` / `test:runtime-stores` / billing smoke 验收。
3. **P1 契约漂移两件套**（P1-5 ConfigWrite、P1-6 SecretsWrite）——决定“实现 or 移除”，连同 §7 清单一次性闭合。
4. **P2 结构化日志接入运行时**——能力已就绪，接入成本低、收益高（线上可观测性直接受益）。
5. **P2 大文件拆分**——按 playbook §13.2 顺序（先纯函数/类型，再 repository，再 service，最后 UI），拆分前后跑 typecheck + 相关 web-shell 测试。
6. 其余 P2/P3 穿插处理，不挤占 P0/P1。

## 9. 建议验收命令（本次未执行，需在修复后运行）

```bash
# 数据 / 商业
npm run test:runtime-stores
npm run runtime:stores:verify
npm run test:commercial-ledger
npm run test:commercial-postgres
npm run host:billing-reconcile-smoke

# 安全 / 权限
npm run test:security-runtime
npm run test:security-hardening
npm run test:ai-provider-runtime

# 迁移 / 恢复
npm run host:upgrade-migration-smoke
npm run host:backup-restore-smoke
npm run host:worker-soak
npm run host:chaos-smoke

# 基线
npm run typecheck
npm run release:integration-gate
```
