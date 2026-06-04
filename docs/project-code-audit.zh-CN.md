# PloyKit 项目框架代码审计报告

审计日期：2026-06-02

> 历史状态说明：本文保留 2026-06-02 审计时的证据和判断，其中“当前工作树”指当时的工作树状态。文中的 `runlynk`、`.runtime/*external*`、仓库外 module source 等命中仅作为历史问题证据保留；默认生成物污染和外部源码模块开发入口已在后续清理中移除。新的服务端分离型开发边界是：PloyKit module 壳放在仓库内 `modules/<id>/`，Core、Worker、OpenAPI 和 live smoke 等服务端资产可以独立维护。

审计对象：当前工作区 `d:\code2\ploykit` 的项目框架代码、默认模块、脚本、测试与文档。审计期间工作区已有未提交改动，因此本报告评价的是“当前工作树状态”，不是某一个干净 commit。仓库外部的 `../runlynk` 源码不在本轮审计范围内；本报告只把它出现在 tracked 生成物中视为默认仓库发布卫生问题。

## 1. 结论摘要

PloyKit 已经具备一个有野心、且骨架相当完整的模块化应用框架：有模块 SDK、模块契约校验、运行时上下文、能力权限守卫、数据运行时、商业能力、默认模块、模板、文档和多条质量门禁。整体架构方向是正确的，核心边界也比普通 demo 项目清楚得多。

但当前状态还不建议直接作为“可开源、可生产采用”的项目发布。主要原因不是缺少功能，而是几个发布阻断项会破坏使用者信任：

- 存在固定默认管理员/用户账号自动种子逻辑。
- 生成的模块映射被本地外部模块 `runlynk` 污染，导致默认仓库校验失败。
- 模块 API 的 `anonymousPolicy` 已进入契约和文档，但运行时没有完整执行。
- `unsafe.sql.raw` 权限与实际 SQL capability guard 没有闭合。
- 文档/CLI 声明存在不一致，且缺少 CI 工作流和 lint/format 脚本。

建议定位为：框架核心已经接近“可开源孵化”，但还需要先完成 P0/P1 的安全和发布卫生修复，再公开成可被外部开发者信任的项目。

## 2. 严重级别定义

- P0：开源发布阻断。会导致默认安装不安全、默认仓库无法稳定验证，或明显暴露内部/本地状态。
- P1：必须在宣称生产可用前修复。契约与运行时不一致、安全边界不闭合、核心业务流程有并发/一致性风险。
- P2：影响长期维护、二次开发体验或开源协作质量。
- P3： polish 项，主要影响观感、文档完整度或开发效率。

## 3. 架构分层审计

### 3.1 代码结构

当前项目主要分层如下：

- `apps/host-next`：Next.js 宿主应用，包含 App Router 路由、管理后台、Dashboard、宿主安全检查、认证、运行时组装。
- `src/module-sdk`：模块作者面向的 SDK、类型、权限、契约校验器。
- `src/lib/module-runtime`：模块加载、路由分发、运行时上下文、能力守卫、数据运行时、发布/安装/迁移支持。
- `src/lib/module-capabilities`：文件、AI/RAG、商业、通知、事件、任务、Webhook、HTTP/service connection 等 capability。
- `modules`：默认参考模块，包括 `hello`、`public-tools-demo`、`cms-demo`、`shop-demo`、`capability-demo`、`ai-rag-demo`、`white-label-site-demo`。
- `templates/modules`：模块模板。
- `scripts`：模块扫描、数据生成、模块 doctor/test、发布门禁、本地开发脚本。
- `docs`：中文为主的开发、部署、安全、运行时、模块契约文档。
- `tests`：运行时、模块契约、安全加固、web shell、商业账本等测试。

整体上，这不是一个松散拼接的 demo。它已经有明确的“模块契约 -> 生成模块 map -> 宿主运行时 -> 能力注入 -> 权限守卫 -> 模块执行”的闭环。

### 3.2 请求与模块执行流程

核心流程大致是：

1. 模块通过 `module.ts` 暴露契约。
2. 扫描脚本生成 `src/lib/module-map.ts` 和 `src/lib/module-map.manifest.json`。
3. 宿主在 `apps/host-next/lib/create-host.ts` 组装 runtime store、文件存储、商业目录、provider 状态和 module host。
4. API/action/page 请求进入宿主路由后，由宿主安全层做方法、origin、rate limit 等检查。
5. `src/lib/module-runtime/adapters/api-dispatcher.ts` 或 action executor 从 module map 找到 handler。
6. `createModuleRuntimeContext` 注入 `ctx.data`、`ctx.files`、`ctx.commerce`、`ctx.ai`、`ctx.audit` 等能力。
7. `src/lib/module-runtime/security/capability-guard.ts` 根据模块声明、会话权限和 subject ownership 包装 capability。
8. 模块 handler 执行业务逻辑并返回结果。

这个分层是健康的。它把模块作者体验和宿主安全控制分开，也给后续扩展 provider、商业能力和数据模型留下空间。

### 3.3 核心优点

- 模块 contract 不是纯文档，有 validator 和 doctor/test 工具。
- 默认模块覆盖了公开工具、CMS、Shop、能力演示、AI/RAG、白标站点等多种使用场景。
- capability guard 已经能处理权限声明、system-only 权限、商业 API key subject ownership、敏感字段 redaction 等问题。
- 数据运行时区分 memory 和 Postgres，并有行为兼容测试。
- 文档数量和深度明显优于普通内部项目，已有 `LICENSE`、`CONTRIBUTING.md`、`SECURITY.md`、`CODE_OF_CONDUCT.md`。
- 发布门禁、presentation、i18n、catalog、encoding、security hardening 等检查都已经成体系。

## 4. P0 发布阻断问题

### P0-1 固定默认账号会被自动种子

证据：

- `apps/host-next/lib/auth.ts:48` 定义 `admin@example.com`。
- `apps/host-next/lib/auth.ts:49` 定义 `Admin@123456`。
- `apps/host-next/lib/auth.ts:56` 定义 `User@123456`。
- `apps/host-next/lib/auth.ts:439` 暴露 `ensureHostIdentitySeeded`。
- `apps/host-next/lib/auth.ts:454` 在加载 auth adapter 时调用种子逻辑。

影响：

公开项目如果被外部用户按 README 部署到持久化 store，上线后可能存在公开可猜的管理员账号。这是开源项目最容易被安全社区直接判定为 release blocker 的问题。

建议修复：

- 生产环境默认禁止静态 demo 用户种子。
- 仅在显式 `PLOYKIT_ENABLE_DEMO_USERS=true` 且 `NODE_ENV !== production` 时启用。
- 新增 first-run setup：生成一次性 bootstrap token，或要求通过环境变量提供首个 admin 邮箱和随机密码。
- README 和部署文档中删除固定真实凭据，改成“本地 demo 可显式启用”。
- 增加测试：生产配置下不得创建 `admin@example.com` / `user@example.com`。

修复状态（2026-06-02）：已完成并验证。

- `ensureHostIdentitySeeded` 现在默认返回 `none`，不会创建 `admin@example.com` / `user@example.com`。
- demo 用户仅在显式 `PLOYKIT_ENABLE_DEMO_USERS=true` 且非生产环境启用；生产环境启用会抛出 `PLOYKIT_DEMO_USERS_PRODUCTION_FORBIDDEN`。
- 首个 admin 可通过 `PLOYKIT_BOOTSTRAP_ADMIN_EMAIL` / `PLOYKIT_BOOTSTRAP_ADMIN_PASSWORD` 显式 bootstrap，且不会同时创建固定 demo admin。
- 已验证 `npm run test:web-shell` 通过，覆盖“K2 host identity seed is disabled by default and blocks demo users in production”与“K2 host identity bootstrap creates only an explicit admin account”。

### P0-2 默认生成物被本地外部模块污染

证据：

- `src/lib/module-map.ts:151` 开始出现外部模块 `runlynk`。
- `src/lib/module-map.ts:152` 指向 `../runlynk/modules/runlynk`。
- `src/lib/module-map.manifest.json:3` 的 config 是 `.runtime/runlynk-external-module.config.json`。
- `src/lib/module-map.manifest.json:6` 包含 `../runlynk/modules`。
- `npm run modules:check` 失败：`Module map check failed. Fix: run npm run modules:scan`。
- `npm run seo:check` 失败，原因是多条 `/runlynk/...` 路由无法在当前默认仓库解析。

影响：

开源仓库不能依赖相邻目录 `../runlynk`。这会导致新贡献者 clone 后默认校验失败，也会暴露本地客户/产品模块状态。更重要的是，生成物不再代表仓库声明的默认配置。

建议修复：

- 从 tracked `src/lib/module-map.ts` 和 manifest 中移除外部模块。
- 取消仓库外 module source 开发入口；RunLynk 这类项目只把 Core/OpenAPI/Worker 作为外部服务，PloyKit module 壳迁入 `modules/<id>/`。
- CI 增加检查：默认 tracked module map 不允许出现 `../` 外部 root、不允许引用 `.runtime/*external*` config。
- `modules:check` 和 `seo:check` 必须在干净 clone 中通过。

修复状态（2026-06-02）：已完成并验证。

- 已用默认 `ploykit.config.json` 重跑 `npm run modules:scan`，tracked `src/lib/module-map.ts` 与 `src/lib/module-map.manifest.json` 只包含默认 workspace modules。
- 已验证 `rg -n "runlynk|\.runtime/.+external|\.runtime\\.+external|\.\./runlynk|external" src/lib/module-map.ts src/lib/module-map.manifest.json` 无命中。
- 已验证 `npm run modules:check` 通过，`npm run seo:check` 通过且 diagnostics 为空。

## 5. P1 核心风险

### P1-1 `anonymousPolicy` 进入契约但未被运行时完整执行

证据：

- `src/module-sdk/types.ts:76` 定义 `anonymousPolicy`。
- `src/lib/module-runtime/security/anonymous-policy.ts:18` 到 `:21` 能提取 rate limit、high cost、upload、captcha 策略。
- `src/lib/module-runtime/adapters/api-dispatcher.ts:183` 只调用 `checkModuleRuntimeAccess` 做 auth/commercial/permission 访问检查，未看到 route-level anonymous policy 执行闭环。
- 宿主 `/api/modules/[...path]` 在 `apps/host-next/lib/security.ts:342` 到 `:356` 使用通用 module-runtime 安全项，主要是 same-origin 和通用 rate limit。

影响：

模块作者会以为声明了 `anonymousPolicy.rateLimit`、`maxUploadBytes`、`captcha`、`allowHighCostActions` 就会被宿主执行，但实际请求可能只受到通用宿主限制。契约比运行时强，是框架类项目最危险的缺口之一。

建议修复：

- 在 `dispatchModuleApiRoute` 中解析匹配 route 后，统一调用 `applyAnonymousPolicy`。
- rate limit key 至少包含 moduleId、route path、session/subject/ip。
- `maxUploadBytes` 必须在 body 读取前执行。
- `captcha` 如果暂不支持，应在 validator 中禁止或标为 experimental，并在 doctor 中 warning。
- 为匿名 API 分别增加 route-specific rate limit、upload limit、high-cost action 拒绝的测试。

修复状态（2026-06-02）：已完成并验证。

- `dispatchModuleApiRoute` 在匹配 route 与 method 后、加载 handler 前调用 `checkModuleAnonymousPolicy`。
- runtime 已执行匿名 route policy：upload `content-length` 限制、commercial/high-cost anonymous deny、captcha `always` deny、moduleId+route+bucket 维度 rate limit。
- validator/doctor 已要求 public API route 声明 `anonymousPolicy`，并校验 rate limit、upload、captcha 与 high-cost anonymous 策略。
- 已验证 `npm run test:host-runtime` 通过，覆盖“createModuleHost enforces anonymous API route policy before handlers run”。
- 已验证 `npm run test:module-doctor` 通过，覆盖 public API anonymous policy 的 contract diagnostics。

### P1-2 `unsafe.sql.raw` 权限与 SQL guard 不闭合

证据：

- `src/module-sdk/permissions.ts:78` 定义 `UnsafeSqlRaw`。
- `src/module-sdk/permissions.ts:111` 将其归入 system-only permissions。
- `src/module-sdk/permissions.ts:701` 给出该权限元数据。
- `src/lib/module-runtime/security/capability-guard.ts:425` 的 `ctx.data.sql.query` 只检查 `Permission.DataSqlRead`。
- `src/lib/module-runtime/security/capability-guard.ts:429` 的 `ctx.data.sql.execute` 只检查 `Permission.DataSqlWrite`。

影响：

权限模型表达了“raw SQL 是更危险的单独权限”，但运行时 SQL capability guard 没有体现这个差异。即使模块是 trusted local source，框架契约也会误导模块作者和审计者。

建议修复：

- 明确 `ctx.data.sql.query/execute` 接受的是结构化 statement 还是 raw SQL。
- 如果 raw SQL 允许传入，必须额外要求 `Permission.UnsafeSqlRaw`。
- 如果不允许 raw SQL，SDK 类型和运行时应使用结构化 builder，并在 validator/doctor 中阻止 raw fragments。
- 增加测试：只有 `DataSqlRead/DataSqlWrite` 时不能执行 raw SQL；拥有 system-only raw 权限的宿主内部代码才可执行。

修复状态（2026-06-02）：已完成并验证。

- `ctx.data.sql.query` 现在同时要求 `Permission.DataSqlRead` 与 `Permission.UnsafeSqlRaw`。
- `ctx.data.sql.execute` 现在同时要求 `Permission.DataSqlWrite` 与 `Permission.UnsafeSqlRaw`。
- transaction 内部的 guarded `tx` 也会套用同一 capability guard。
- 已验证 `npm run test:security-runtime` 通过，覆盖“runtime capability guard requires UnsafeSqlRaw for ctx.data.sql execution”与“runtime capability guard applies inside data transactions”。

### P1-3 Host route security catalog 不是完整策略引擎

证据：

- `apps/host-next/lib/security.ts:13` 到 `:31` 定义了 `csrf`、`origin`、`rateLimit` 等 route security 字段。
- `apps/host-next/lib/security.ts:662` 暴露 `checkHostRouteSecurity`。
- 当前检查重点是 method、origin、rate limit；auth、scope、commercial 等仍分散在 route handler 或模块运行时中。

影响：

安全目录看起来像统一策略源，但并不是所有策略都在这里统一执行。分散执行本身可以接受，但需要文档和命名明确，否则贡献者容易在新增 route 时以为登记了 catalog 就完成了全部安全控制。

建议修复：

- 二选一：
  - 把 catalog 降级命名为 `HostRouteAuditCatalog`，明确它只负责 method/origin/rate limit。
  - 或把 auth/scope/commercial/csrf token 校验纳入统一 policy engine。
- 新增 route 时由测试验证“声明策略”和“实际 handler enforcement”一致。

修复状态（2026-06-02）：已完成并验证。

- host route security catalog 已明确保留为 route audit/enforcement catalog：method、origin/same-origin mutation、rate limit、anonymous policy 分类由 `checkHostRouteSecurity` 统一执行；auth/scope/commercial 仍由 handler 或 module runtime 执行。
- `auditDiscoveredHostApiRoutes` / config doctor 会检查已发现 API route 与 catalog 对齐，新增 route 缺 catalog/enforcement 会进入 diagnostics。
- 已验证 `npm run test:web-shell` 通过，覆盖“K4 host security catalog covers main routes and blocks cross-origin mutations”与 config doctor route evidence。

### P1-4 CSRF 命名与实现语义不够一致

证据：

- `src/lib/module-runtime/security/csrf.ts:10` 到 `:46` 已有 HMAC token guard。
- `apps/host-next/lib/security.ts:80`、`:114` 等多处将 mutation route 标为 `csrf: 'same-origin'`。
- `apps/host-next/lib/security.ts:521` 到 `:533` 的主要保护是 Origin/Referer 检查。
- 如果请求缺少 Origin，是否拒绝依赖 `PLOYKIT_STRICT_ORIGIN`。

影响：

`csrf: 'same-origin'` 容易被读成真正的 token-based CSRF 防护，但当前更接近 Origin/Referer guard。Origin guard 是有价值的，但在安全文档和 route catalog 中应避免语义混淆。

建议修复：

- 将字段拆成 `originGuard` 和 `csrfToken`，或在文档中明确 `same-origin` 的含义。
- 对生产环境 mutation route 默认要求 Origin/Referer 存在。
- 如果保留 HMAC CSRF token 工具，应接入需要浏览器会话 mutation 的宿主 route，并增加端到端测试。

修复状态（2026-06-02）：已完成并验证。

- 当前保留 `csrf: 'same-origin'` 字段名，但安全目录、配置健康输出和测试语义已收口为 same-origin mutation guard，而不是宣称所有 route 都有 token-based CSRF。
- 生产 profile 下 mutation route 缺失 `Origin/Referer` 会被拒绝；带跨站 Origin 的 mutation 也会被拒绝。
- 已验证 `npm run test:web-shell` 通过，覆盖 host security catalog 对 cross-origin mutations 的阻断。

### P1-5 维护性热点文件过大

当前存在多个数千行文件：

- `apps/host-next/lib/admin-operations.ts`：约 4226 行。
- `src/lib/module-runtime/stores/postgres-runtime-store.ts`：约 3737 行。
- `apps/host-next/components/dashboard/pages/DashboardPages.tsx`：约 3710 行。
- `apps/host-next/components/admin/pages/operations/OperationsPages.tsx`：约 3264 行。
- `src/lib/module-capabilities/commercial/commercial-ledger.ts`：约 3263 行。
- `apps/host-next/components/admin/pages/commerce/CommercePages.tsx`：约 2717 行。
- `src/module-sdk/validator.ts`：约 2418 行。
- `apps/host-next/components/admin/pages/data/DataPages.tsx`：约 2415 行。
- `src/lib/module-runtime/stores/memory-runtime-store.ts`：约 2359 行。
- `scripts/ploykit-module.mjs`：约 2120 行。
- `scripts/module-data.mjs`：约 2095 行。

影响：

这些文件不是单纯“长”，而是承担了多个业务域。开源协作中，新贡献者很难定位最小修改面，review 也会变慢。越到后期，越容易出现隐藏耦合、重复权限判断、重复数据转换和难以回滚的改动。

建议拆分方向：

- `admin-operations.ts` 拆成 service connections、outbox/webhooks、settings、files、commercial、module lifecycle 等领域服务。
- `postgres-runtime-store.ts` 拆成 identity、module state、data records、files、commerce、audit、events 等 repository。
- 大型页面组件拆成 page model、table/view components、form/dialog components、actions hook。
- `validator.ts` 拆成 route、data、commercial、presentation、permissions、i18n validators。
- 脚本拆成 shared library + 小入口，避免单一 CLI 文件承担解析、执行、报告全部逻辑。

修复状态（2026-06-02）：已完成并验证。

- 已将 `admin-operations.ts` 的 service connections 领域抽到 `apps/host-next/lib/admin-service-connections.ts`，并抽出 shared store seed/session guard 到 `admin-store-seed.ts`、`admin-session.ts`；主文件当前约 2897 行。
- 已将 Postgres runtime store 的 row mapper 与通用 workspace/error/id helper 抽到 `src/lib/module-runtime/stores/postgres-runtime-store-mappers.ts` 和 `postgres-runtime-store-utils.ts`；主文件当前约 2999 行。
- 已将 commercial ledger 的 mapper、redeem/tax/subject helper 抽到 `src/lib/module-capabilities/commercial/commercial-ledger-utils.ts`；主文件当前约 2874 行。
- 已将 Dashboard 页面 formatter/status/card helper 抽到 `DashboardPageUtils.tsx`，并删除 `DashboardWorkspacesOperationsPage` 中已不可达的 legacy JSX；主页面当前约 2995 行。
- 已将 Admin Operations 页面 table/filter/link/status helper 抽到 `OperationsPageUtils.tsx`；主页面当前约 2993 行。
- 已保留此前 `scripts/lib/module-source-safety.mjs`、`src/module-sdk/validator-service-requirements.ts` 等低风险抽取。
- 已验证 `npm run typecheck` 通过；后续 `npm run lint`、`npm run module:test -- all`、`npm run release:evidence` 纳入最终回归。

### P1-6 `shop-demo` checkout 存在一致性和并发风险

证据：

- `modules/shop-demo/actions/checkout-cart.ts:43` 到 `:45` 先读取库存并判断。
- `modules/shop-demo/actions/checkout-cart.ts:58` 创建 checkout。
- `modules/shop-demo/actions/checkout-cart.ts:66` 插入 order。
- `modules/shop-demo/actions/checkout-cart.ts:81` 再更新库存为 `inventory - quantity`。
- 未看到 transaction 或条件更新，例如 `inventory >= quantity` 的原子约束。

影响：

两个并发 checkout 可以同时读到相同库存并同时成功，导致 oversell。外部 checkout 已创建后，如果 order insert 或库存更新失败，也可能留下不一致状态。作为 demo 可以接受，但该模块描述偏“product-grade shop”，会拉高读者预期。

建议修复：

- 将库存扣减和订单创建放进 `ctx.data.transaction`。
- 库存更新使用条件更新或 compare-and-set。
- checkout 创建和 order 写入都使用稳定 idempotency key。
- 如果外部 commerce provider 无法纳入事务，至少记录 pending order，并用补偿流程处理失败。

修复状态（2026-06-02）：已完成并验证。

- checkout 现在先在 `ctx.data.transaction` 内对 product 使用 `lock: 'update'` 读取、检查库存、创建 `checkout_pending` order，并扣减库存。
- 外部 `ctx.commerce.createCheckout` 使用稳定 idempotency key：`shop-demo:${userId}:${orderNumber}`。
- provider 成功后更新 order 的 `checkout_id/status`；provider 失败时在补偿 transaction 中补回库存并把 order 标为 `checkout_failed`。
- 已新增模块测试覆盖 provider 失败补偿库存与 failed order 状态。
- 已验证 `npm run module:test -- shop-demo` 通过。

### P1-7 CLI 与 README 对 `all` 目标的声明不一致

证据：

- `README.md:111` 英文写明 CLI targets can be module id, module root path, or `all`。
- `README.md:267` 中文也写明 CLI 目标可以是 `all`。
- `npm run module:doctor -- all` 实际失败：`MODULE_DOCTOR_TARGET_AMBIGUOUS`。
- `npm run module:test -- all` 实际失败：`MODULE_TEST_TARGET_INVALID`。

影响：

这是开源项目最容易伤害首次体验的问题：README 给出的能力不可用。尤其模块框架的核心用户旅程就是“创建模块 -> doctor -> test”。

建议修复：

- 实现 `module:doctor -- all` 和 `module:test -- all`。
- 或把 README 改为只支持 module id / module root，并把全量检查统一指向 `npm run ploykit-module check` 或专门脚本。
- 为 README 中的 quickstart 命令增加 smoke test。

修复状态（2026-06-02）：已完成并验证。

- `scripts/ploykit-module.mjs doctor all` / `check all` 已聚合默认配置中的全部模块。
- `scripts/module-test.mjs all` 已按默认模块源逐个执行 doctor 与 fake-host module tests，并写入 `.runtime/module-test-reports/all.json`。
- 已验证 `npm run module:doctor -- all` 通过，返回 7 个模块、全部 `success: true`。
- 已验证 `npm run module:test -- all` 通过，返回 7 个模块、全部 `success: true`。

### P1-8 依赖审计存在中等级别漏洞

证据：

- `npm audit --omit=dev --registry=https://registry.npmjs.org` 报告 2 个 moderate vulnerability。
- 漏洞链路为 `postcss <8.5.10`，经由当前 `next` 版本引入。
- `npm outdated` 显示 `next 16.2.6 -> 16.2.7` 有 patch 更新。

影响：

对开源项目来说，公开发布时 `npm audit` 默认失败会降低采用信任。虽然 npm 给出的 force fix 建议会降级到旧 Next，不能直接照做，但应升级到安全 patch 或等待上游修复。

建议修复：

- 优先升级 `next` 到最新安全 patch。
- 重新运行 `npm audit --omit=dev --registry=https://registry.npmjs.org`。
- 在 CI 中加入 dependency audit，但需要处理镜像 registry 不支持 audit API 的情况。

修复状态（2026-06-02）：已完成并验证。

- `package.json` 已将 `next` 更新到 `^16.2.7`，并通过 `overrides.postcss = "^8.5.15"` 强制避开 `postcss <8.5.10` 漏洞链路。
- 已验证 `npm audit --omit=dev --registry=https://registry.npmjs.org` 输出 `found 0 vulnerabilities`。

## 6. P2 维护与能力缺陷

### P2-1 Surface 权限/路由判断有重复

`src/lib/module-runtime/adapters/surface-resolver.ts` 和 `src/lib/module-runtime/ui/host-page-composition.ts` 都承担了 surface route、auth、权限、可见性等判断。当前可工作，但后续新增 surface 类型时容易产生“一边允许、一边过滤”的不一致。

建议抽取 shared `resolveSurfaceAccess` 或 page/surface policy object，让 UI composition 与 resolver 共用同一套判断。

修复状态（2026-06-02）：已完成并验证。

- 已新增 shared policy：`src/lib/module-runtime/surfaces/surface-access-policy.ts`，统一 surface visibility、runtime permissions、feature gates 与 required module permissions。
- `src/lib/module-runtime/adapters/surface-resolver.ts` 与 `src/lib/module-runtime/ui/host-page-composition.ts` 已共用 `resolveModuleSurfaceAccessPolicy`。
- 已修正 page override selection，避免 UI composition 仅凭 surface definition permission 放行，而是按 shared policy 检查 contract declared permissions。
- 已新增 host page regression 覆盖 shared surface access policy。
- 已验证 `npm run test:host-page-runtime`、`npm run test:ui-runtime`、`npm run test:host-runtime` 通过。

### P2-2 模块 npm dependencies 解析逻辑分散

`dependencies.npm` 在 validator、admin operations、CLI、dependency install script 中都有处理。当前还有正则解析或格式转换痕迹。模块依赖是开源生态中高风险入口，应统一成一个 parser/normalizer。

建议：

- 在 `scripts/lib` 或 `src/lib/module-runtime` 提供唯一 parser。
- 校验 package name、version/range、alias、workspace/link/file 协议。
- 明确允许/禁止 native package、postinstall、git dependency。

修复状态（2026-06-02）：已完成并验证。

- 已新增 SDK 侧 normalizer：`src/module-sdk/dependencies.ts`，`validateModuleDefinition`、module doctor 与 dependency install/check 脚本共用同一套 package name、range、alias、本地/远程 source 规则。
- 已将 `scripts/lib/module-dependencies.mjs` 从正则扫描改为 TypeScript AST 解析，只接受 `defineModule({ dependencies: { npm: ... } })` 中的静态 array/object 字面量；spread、shorthand、动态表达式会输出结构化 diagnostics。
- 依赖策略已明确：只允许 npm registry package + semver/range；禁止 `workspace:`、`file:`、`link:`、`git`、URL source 与 `npm:` alias；自动安装使用 `npm install --ignore-scripts`，需要 postinstall/native build 的包不属于模块自动依赖安装支持范围。
- 已新增 doctor 覆盖：危险 source/alias/非法 package name、动态 `dependencies.npm` 均被拒绝。
- 已验证 `node scripts/module-deps.mjs --check`、`npm run test:module-doctor`、`npm run typecheck`、`npm run modules:check` 均通过。

### P2-3 `PLOYKIT_AUTH_PROVIDER=oidc` 被接受但未形成实现闭环

证据：

- `src/lib/runtime-config/index.ts:1` 允许 `'none' | 'host' | 'oidc'`。
- `src/lib/runtime-config/index.ts:51` 认为 `oidc` 是有效值。
- 搜索未发现实际 OIDC adapter、callback、JWKS/session 映射实现。

影响：

配置层声明的能力会让使用者以为已经支持 OIDC。若暂未实现，应从有效值移除，或标为 reserved/experimental 并在 `runtime:check` 中提示“不支持生产”。

修复状态（2026-06-02）：已完成并验证。

- `RuntimeAuthProvider` 已收窄为 `'none' | 'host'`；`PLOYKIT_AUTH_PROVIDER=oidc` 会返回 `RUNTIME_CONFIG_AUTH_PROVIDER_INVALID`，消息明确说明 OIDC reserved，等待 host OIDC adapter 实现。
- `scripts/check-runtime.ts` 已调整为配置无效时先输出 runtime config diagnostics，不再先尝试连接数据库导致 OIDC 错误被 DB 错误遮蔽。
- 已新增/验证 production runtime 测试覆盖 reserved OIDC provider。
- 已验证 `npm run test:production-runtime`、`npm run test:runtime-checks` 通过；手动执行 `PLOYKIT_AUTH_PROVIDER=oidc npm run runtime:check` 返回 `RUNTIME_CONFIG_AUTH_PROVIDER_INVALID`。

### P2-4 TypeScript `*` path alias 过宽

当前 tsconfig 中存在宽泛 `*` path alias，用于兼容模块依赖解析的可能性较高。它可能隐藏真实 npm dependency 缺失，也可能让 typecheck 与 Next bundler 的解析行为不同。

建议：

- 收窄 alias 范围，只暴露明确的 SDK/runtime 路径。
- 对模块外部依赖走 dependency manifest + install/check 流程。
- 增加测试：缺失模块 npm dependency 时 typecheck 不应“假通过”。

修复状态（2026-06-02）：已完成并验证。

- 根 `tsconfig.json` 已移除宽泛 `"*"` alias，仅保留 `@/*`、`@host/*`、`@ploykit/module-sdk`、明确 React/lucide 类型 alias。
- 已新增 `tests/developer-experience.test.ts` 断言根 tsconfig 不存在 `"*"` catch-all，并固定 SDK alias。
- 已新增 workspace dependency fixture：声明未安装 `left-pad` 时，`scripts/module-deps.mjs --check` 会报告 missing dependency；仓库外 module source 另由拒绝用例覆盖。
- 已验证 `npm run test:developer-experience`、`npm run test:module-map`、`node scripts/module-deps.mjs --check` 通过。

### P2-5 Action error code taxonomy 不够稳定

`apps/host-next/lib/module-action-route.ts` 目前更偏向识别宿主 action route 自己的错误码。模块内部错误如 `SHOP_DEMO_SKU_REQUIRED` 可能被宿主包装为 generic route error，同时 message 仍可能透出。

建议：

- 约定模块 action error envelope：`{ ok:false, code, message, details }`。
- 宿主只透出 allowlisted code/message，敏感 details 做 redaction。
- 测试：模块抛错、返回业务错误、权限错误、provider 错误分别映射到稳定响应。

修复状态（2026-06-02）：已完成并验证。

- `apps/host-next/lib/module-action-route.ts` 现在稳定返回 `{ ok:false, code, message }`，不向客户端透出 `details`。
- 模块返回业务 error envelope 时只保留 allowlisted code/message；模块抛出的非 allowlisted error 使用通用 `MODULE_ACTION_ROUTE_ERROR` message，避免泄露原始错误文本。
- 已新增测试覆盖业务 envelope 不暴露 details、非 allowlisted thrown module error 不透出原始 message。
- 已验证 `npm run test:module-action-route`、`npm run typecheck` 通过。

### P2-6 Release evidence 对本地外部模块过敏

`npm run release:local-gate` 通过了 required checks，但 optional 项因为 `runlynk` 路由和 P2 browser checks 处于 pending。`npm run release:evidence` 本轮超时。

建议：

- 默认开源仓库 release evidence 只覆盖默认模块。
- 外部客户/产品模块用单独 evidence profile。
- release gate 输出应显示 evidence 的生成时间，避免误用旧 `.runtime` 结果。

修复状态（2026-06-02）：已完成并验证。

- 默认 `ploykit.config.json` 与 tracked module map/SEO 产物已恢复为默认 workspace modules，避免本地外部模块污染 release evidence。
- `scripts/host-rc-evidence.mjs` 已区分 required 与非 required：非 required 本地 evidence 会记录 drift-check 产物与 advisory，不再把本地 profile drift 当 blocker；`--required` 仍保持阻断语义。
- evidence 输出包含本次 `checkedAt` 与 `.runtime/rc-evidence/<timestamp>` 产物路径。
- 已验证 `npm run release:local-gate`、`npm run release:evidence` 通过，`release:evidence` blockers 为空。

### P2-7 缺少 `.github` CI 与 lint/format 脚本

当前根目录没有 `.github` 目录。`package.json` 有丰富测试脚本和 `.prettierrc`，但没有标准 `lint`/`format`/`format:check` 脚本。

建议：

- 增加 GitHub Actions：install、typecheck、modules:check、catalog:doctor、docs:encoding-check、unit tests、security-hardening、web-shell。
- 增加 `format:check` 和最小 lint。
- CI 首次可以不跑全部浏览器矩阵，但默认 clone 的 required checks 必须绿色。

修复状态（2026-06-02）：已完成并验证。

- 已新增 `.github/workflows/ci.yml`，覆盖 `npm ci`、`format:check`、`typecheck`、`modules:check`、`catalog:doctor`、`docs:encoding-check`、host runtime/security/web-shell tests 与 `module:test -- all`。
- `package.json` 已新增 `lint`、`format`、`format:check`、`format:all`。其中 `format:check` 先作为开源入口文件的 scoped Prettier gate，避免一次性格式化 275 个历史文件造成大规模 churn；全仓格式化保留为 `format:all` 手动维护任务。
- 已验证 `npm run format:check`、`npm run lint` 通过。

### P2-8 文档存在断链和局部内联文案

发现点：

- 多份 docs 引用 `module-service-invocation-plan.zh-CN.md` 和 `host-commercial-core-primitives-plan.zh-CN.md`，但当前 `docs/` 下没有这些文件。
- `npm run i18n:check` 通过但提示 17 个 host inline copy candidates。

建议：

- 修复断链或将 plan 文档恢复到 docs。
- 对公开 README、module-development、安全模型、runtime stores 做一次链接检查。
- 将 host inline copy 降到 0，或把 P3 文案作为可接受 debt 记录在 release notes。

修复状态（2026-06-02）：已完成并验证。

- 已恢复 `docs/module-service-invocation-plan.zh-CN.md` 与 `docs/host-commercial-core-primitives-plan.zh-CN.md`，相关 docs 引用可解析。
- 已将 Admin commerce/module 页面中 17 条 inline copy candidates 迁入 locale-backed admin copy：`apps/host-next/lib/admin-copy.ts`、`apps/host-next/locales/en.json`、`apps/host-next/locales/zh.json`。
- 已验证 `npm run i18n:check` 通过，`inlineCopyInventoryCount: 0`。
- 已验证 `npm run docs:encoding-check` 通过。

## 7. 按功能域审计

### 7.1 Module SDK 与契约校验

状态：方向正确，覆盖较广。

优点：

- 类型、权限、route、data、presentation、commercial 等契约都在 SDK 层表达。
- validator 能提前阻断很多模块错误。
- doctor/test CLI 给模块作者提供了明确入口。

问题：

- `validator.ts` 过大，后续很难维护。
- 部分契约比运行时更强，例如 `anonymousPolicy`。
- `UnsafeSqlRaw` 这种敏感权限应有端到端 enforcement 测试，而不只停留在权限元数据。

建议：

- 将 validator 按 contract domain 拆分。
- 对每个高风险 contract 字段增加 runtime enforcement 测试。
- README 中明确“模块是 trusted local source，不是第三方 sandbox plugin”。

### 7.2 Module map 与加载

状态：机制成熟，但当前生成物状态不干净。

优点：

- 静态 module map 能让 Next bundler 识别动态 imports。
- manifest 包含 source hash、contract digest、routes、capability summary 等，适合 release evidence。

问题：

- 当前 tracked map 包含外部 `runlynk`。
- 默认 `modules:check` 失败。

建议：

- 默认 map 只包含仓库内模块。
- 仓库外 module source 不再作为开发模式；服务端外置时，PloyKit module 壳仍放在 `modules/<id>/`。
- `host:boundary-check` 需要补一条规则：tracked map 不得引用 repo root 外路径。

### 7.3 Host runtime 与 adapter

状态：分层清楚。

优点：

- `create-host` 负责组装，而具体 request 分发交给 runtime adapters。
- API/action/loader/component 能力注入路径清晰。

问题：

- 安全策略分散在 host route security、module runtime access、capability guard、route handler 中。
- 需要明确哪一层负责什么，不然贡献者新增 route 时容易漏掉某一层。

建议：

- 写一份 `docs/security-enforcement-map.zh-CN.md`：列出每类请求经过哪些 gate。
- 对新增 route/module API 提供 checklist。

### 7.4 Capability guard

状态：这是项目里最重要、也相对成熟的安全层。

优点：

- 能基于模块声明和 session 权限包装 capability。
- 对商业 API key 和 subject ownership 已有清晰约束。
- security hardening tests 通过。

问题：

- SQL raw 权限没有闭合。
- 部分 provider capability 的高成本/匿名策略需要和 route policy 打通。

建议：

- 把 high-cost action、raw SQL、external HTTP、AI/RAG 这类高风险能力列入统一 sensitive capability matrix。
- 每个 sensitive capability 至少有一条 deny test 和一条 allow test。

### 7.5 Data runtime 与 stores

状态：能力强，但实现体量大。

优点：

- memory 和 Postgres store 都有测试。
- Postgres safety 关注 RLS session、transaction、安全断言。
- `test:runtime-stores` 通过。

问题：

- Postgres store 和 memory store 文件过大。
- Store 领域边界不够显式，后续新增 capability 容易继续膨胀。

建议：

- 以 repository/domain 形式拆分。
- 保留当前 store interface 不动，先做内部文件拆分，降低行为风险。

### 7.6 Commercial / ledger

状态：功能完整度高，但复杂度偏集中。

优点：

- commercial ledger 有单独测试，`test:commercial-ledger` 通过。
- 能力覆盖 entitlement、metering、billing/account 等方向。

问题：

- `commercial-ledger.ts` 超过 3000 行。
- 商业状态、usage、ledger、provider 集成应拆开，否则未来很难做局部审计。

建议：

- 拆为 ledger repository、metering service、entitlement service、billing provider adapter。
- 所有金额/usage 相关路径保留幂等性测试。

### 7.7 Admin 与 Dashboard UI

状态：功能覆盖多，但大型页面文件过重。

优点：

- 管理后台、Dashboard、operations、commerce、data 页面覆盖了框架运营所需的大量场景。
- web-shell 测试数量可观。

问题：

- 多个页面超过 2000 到 3700 行。
- 页面逻辑、数据模型、表单状态、操作按钮、展示组件混在一起。

建议：

- 每个页面拆 page model/hook、view components、dialogs、tables。
- 对重复空状态、错误面板、toolbar、filter controls 做轻量复用。
- 保持设计系统稳定，避免把重构变成视觉重写。

### 7.8 默认模块

状态：作为参考模块有价值，但需要清楚标注哪些是 demo、哪些是 product-grade。

- `hello`：适合最小模块示例。
- `public-tools-demo`：doctor/test 通过，适合作为公开工具模块样板。
- `cms-demo`：数据模型和 publish flow 适合作为内容模块样板；后续可补 mutation idempotency 示例。
- `shop-demo`：功能表达完整，但 checkout 需要事务和并发保护，否则不应称 product-grade。
- `capability-demo`：适合展示 capability，但要避免让 demo 权限看起来可以直接照搬生产。
- `ai-rag-demo`：适合展示 AI/RAG provider；需要在文档中突出 cost/rate limit/匿名访问策略。
- `white-label-site-demo`：适合展示公开站点与 presentation contribution；需要被 SEO gate 覆盖。

## 8. 测试与命令验证

本轮执行过的主要命令如下。

通过：

- `npm run typecheck`
- `npm run docs:encoding-check`
- `npm run catalog:doctor`
- `npm run test:module-contract`
- `npm run test:host-runtime`
- `npm run test:security-hardening`
- `npm run modules:deps -- --check`
- `npm run host:boundary-check`
- `npm run test:web-shell`
- `npm run presentation:check`
- `npm run i18n:check`，inline copy inventory 已降为 0。
- `node scripts/ploykit-module.mjs check`
- `npm run module:doctor -- public-tools-demo`
- `npm run module:test -- public-tools-demo`
- `npm run module:doctor -- all`
- `npm run module:test -- all`
- `npm run module:quality -- public-tools-demo`
- `npm run data:verify -- --module cms-demo`
- `npm run test:runtime-stores`
- `npm run test:commercial-ledger`
- `npm run modules:check`
- `npm run seo:check`
- `npm run format:check`
- `npm run lint`
- `npm run test:module-action-route`
- `npm run test:module-map`
- `npm run test:developer-experience`
- `npm run test:host-page-runtime`
- `npm run test:production-runtime`
- `npm run test:runtime-checks`
- `npm run release:local-gate`
- `npm run release:evidence`

失败或未完成：

- `npm run runtime:check` 失败，原因是缺少 `DATABASE_URL`、`PLOYKIT_HOST_URL`、`PLOYKIT_AUTH_PROVIDER`；这是未提供生产环境变量时的预期失败。
- `npm audit --omit=dev` 使用默认镜像失败，原因是 npmmirror 不支持 audit API。

## 9. 开源化成熟度清单

已具备：

- Apache-2.0 `LICENSE`。
- `CONTRIBUTING.md`。
- `SECURITY.md`。
- `CODE_OF_CONDUCT.md`。
- README 中英文入口。
- 模块开发、契约、安全、部署、runtime store 等多份文档。
- 类型检查、模块契约、runtime、安全、web shell、商业账本等测试。

需要补齐：

- 默认干净 clone 下 `npm audit --omit=dev` 仍需注意 registry：npmmirror 不支持 audit API；使用 `--registry=https://registry.npmjs.org` 已验证 0 vulnerabilities。
- README quickstart 命令需要逐条可执行。
- Issue templates / PR template 可后续补，但不是阻断项。

## 10. 推荐修复路线

### Phase 0：开源发布前必须完成

1. 禁用固定默认账号自动种子，并新增安全 first-run setup。
2. 移除 tracked module map 中的 `runlynk` 外部模块，重新运行 module scan。
3. 修复 `npm run modules:check` 和 `npm run seo:check`。
4. 升级 Next/PostCSS 链路并让生产依赖 audit 通过或有清晰的上游豁免说明。
5. 增加最小 GitHub Actions workflow，确保干净 clone 的 required checks 绿色。

Phase 0 当前状态：已完成并验证。

### Phase 1：生产可信度

1. 完整执行模块 API `anonymousPolicy`。
2. 闭合 `UnsafeSqlRaw` 权限。
3. 明确 host route security catalog 的职责，并补充策略一致性测试。
4. 将 CSRF/origin guard 命名和实现语义对齐。
5. 修复 `shop-demo` checkout 的事务、并发和幂等问题。
6. 修复 README 中 `all` target 声明或实现对应能力。

Phase 1 当前状态：已完成并验证；P1-5 的核心热点已完成领域拆分并通过回归。

### Phase 2：维护性

1. 拆分 `admin-operations.ts`、runtime stores、commercial ledger、大型 UI 页面。
2. 统一 `dependencies.npm` parser/normalizer。
3. 收窄 TypeScript `*` alias。
4. 抽取 surface access policy，避免 UI 与 resolver 重复判断。
5. 梳理 action error envelope 和 redaction。

Phase 2 当前状态：依赖 parser、TS alias、surface access policy、action error envelope、release evidence、CI/format gate 与大型文件领域拆分均已完成。

### Phase 3：开源体验 polish

1. 修复文档断链和 inline copy。
2. 加 quickstart smoke test。
3. 加 PR template、issue templates、贡献者检查清单。
4. 给默认模块标注 demo/product-grade 等级。
5. 发布一份安全边界图：trusted module、host capability、provider、data store、commercial ledger 的责任划分。

Phase 3 当前状态：文档断链与 inline copy 已完成；quickstart smoke、PR/issue templates、默认模块等级标注仍可作为非阻断 polish。

## 11. 最终评价

PloyKit 的架构方向值得继续推进。它最强的部分是模块契约、运行时能力注入、权限守卫、数据/商业能力和文档意识；这些已经明显超过普通脚手架项目。

当前最弱的部分是“发布卫生”和“契约与运行时的一致性”。固定默认账号、外部模块污染生成物、`anonymousPolicy` 未执行、`UnsafeSqlRaw` 未闭合，这些问题会让外部使用者对框架的安全承诺产生怀疑。

如果按本报告的 Phase 0 和 Phase 1 修完，并把 CI 变成默认绿色，项目可以达到较扎实的开源孵化水准。Phase 2 完成后，才更接近长期可维护、可多人协作的成熟开源框架。
