# PloyKit 生产级架构与代码治理分析手册

本文档用于指导 PloyKit 从“功能完整的框架”持续演进到“可上线、可商业化、可长期维护的生产级框架”。它不是一次性审计报告，而是一套可重复执行的方法：先建立事实，再识别风险，再逐层改造，最后用自动化证据证明改造有效。

适用范围：

- 宿主应用：`apps/host-next`
- 模块运行时：`src/lib/module-runtime`
- 模块能力层：`src/lib/module-capabilities`
- 模块 SDK：`src/module-sdk`
- 默认模块：`modules`
- 模板：`templates/modules`
- 脚本与门禁：`scripts`
- 测试：`tests`
- 文档与发布材料：`docs`

## 1. 总体目标

PloyKit 的生产级目标可以拆成六个维度：

1. 架构边界清晰：宿主、运行时、能力层、SDK、模块、模板之间没有隐性耦合。
2. 契约与运行时一致：文档、类型、validator、doctor、运行时 enforcement、测试证据互相对齐。
3. 安全默认值可靠：默认启动不会产生高危账号、越权路径、跨租户数据、敏感信息泄漏或不受控成本。
4. 数据与商业逻辑可恢复：账本、订单、文件、任务、事件、Webhook、AI 调用都具备幂等、审计、重试和异常恢复能力。
5. 开发体验稳定：模块作者能通过清晰 CLI、模板、错误信息和文档高效交付，不需要理解全部宿主内部实现。
6. 发布证据可复现：每次 release 都能用固定命令和产物证明当前版本达到上线标准。

所有治理工作都应围绕这六个目标，而不是为了“代码看起来更漂亮”而改。

## 2. 分析原则

### 2.1 先证据，后结论

每一个问题都要尽量包含：

- 影响范围：影响宿主、模块、用户、运营还是开发者。
- 触发路径：用户或系统怎样走到这个问题。
- 代码证据：具体文件、函数、类型或测试。
- 运行证据：失败命令、日志、截图、数据库状态或响应体。
- 风险级别：P0、P1、P2、P3。
- 修复方案：首选方案、替代方案、迁移影响。
- 验收命令：修复后必须通过哪些检查。

没有证据的判断先记为假设，不要直接进入大规模重构。

### 2.2 先闭环，再扩展

框架类项目最危险的问题通常不是“缺少功能”，而是功能链路不闭合：

- 类型声明了，但运行时没执行。
- 文档承诺了，但 CLI 没支持。
- validator 阻止了，但模板还在生成旧写法。
- 权限枚举存在，但 capability guard 没检查。
- 测试覆盖了 memory store，但 Postgres 行为不同。
- 页面显示了状态，但后台任务没有真实恢复路径。

因此每次分析都要追问：这个能力是否从文档、类型、配置、运行时、测试、发布证据全链路闭合？

### 2.3 先稳定公共边界，再整理内部实现

PloyKit 的公共边界包括：

- `module.ts` 契约
- `ctx.*` capability API
- 模块模板
- CLI 命令与输出
- 默认配置
- 数据迁移
- API route 响应格式
- 运行时错误码
- 发布门禁

公共边界一旦被外部模块或用户依赖，改动成本很高。重构内部实现之前，先明确公共边界是否稳定；如果边界必须变，需要提供迁移策略、deprecation 提示和回归测试。

## 3. 风险分级

### P0：发布阻断

满足任一条件即为 P0：

- 默认安装存在可利用安全问题。
- 干净 clone 无法通过基础校验。
- 默认生成物依赖本地私有路径或外部项目。
- 生产环境可能自动创建固定高权限账号。
- 可能导致跨租户数据泄漏、任意文件读取、任意 SQL、任意 SSRF 或敏感密钥泄漏。
- 发布门禁无法产生可信证据。

P0 必须在公开发布或商业交付前修复。

### P1：生产可信度问题

满足任一条件可标为 P1：

- 契约与运行时不一致。
- 权限、计费、数据、任务、文件、AI/RAG、Webhook 等核心能力缺少 enforcement。
- 幂等、事务、并发控制不足，可能造成订单、账本、库存、任务重复执行等问题。
- 错误处理泄漏内部信息或导致客户端无法稳定恢复。
- 监控、审计或恢复路径不足，线上事故难以定位。

P1 应进入近期迭代计划。

### P2：维护性与协作问题

典型 P2：

- 单文件过大、多个领域混杂。
- 解析逻辑重复，规则分散。
- 测试覆盖不均衡。
- CLI 输出不清晰。
- 文档断链或与实现有偏差。
- 模板没有跟上最佳实践。

P2 不一定阻断上线，但会显著提高长期维护成本。

### P3：体验与 polish

典型 P3：

- 页面状态文案不够一致。
- 示例模块分级不清楚。
- PR/Issue 模板缺失。
- 可视化证据不够漂亮。
- 局部命名可读性欠佳。

P3 可穿插处理，但不应挤占 P0/P1。

## 4. 第一阶段：建立项目事实地图

目标：知道系统有什么、边界在哪里、哪些路径最关键。

### 4.1 目录与职责地图

先按目录建立事实表：

| 目录 | 职责 | 风险点 | 主要验证 |
| --- | --- | --- | --- |
| `apps/host-next` | Next.js 宿主、页面、API、管理后台、认证 | route 安全、UI 大文件、配置默认值 | `test:web-shell`、`host:build` |
| `src/module-sdk` | 模块作者 API、类型、validator、权限 | 契约漂移、类型与运行时不一致 | `test:module-contract`、`module:doctor` |
| `src/lib/module-runtime` | 模块加载、上下文、权限、数据、路由 | capability guard、store 差异、访问策略 | `test:host-runtime`、`test:runtime-stores` |
| `src/lib/module-capabilities` | 文件、商业、AI、RAG、事件、任务、Webhook | 成本、安全、幂等、重试、外部集成 | capability 专项 smoke |
| `modules` | 默认参考模块 | demo 与生产边界不清、示例误导 | `module:test -- all` |
| `templates/modules` | 新模块模板 | 生成旧模式、缺少安全声明 | `module:doctor`、模板 smoke |
| `scripts` | CLI、生成器、发布门禁 | 脚本过大、规则重复、输出不可机器读 | CLI tests |
| `docs` | 使用、开发、安全、部署文档 | 断链、过期承诺、缺少边界说明 | `docs:encoding-check`、人工链接检查 |

执行命令：

```bash
rg --files
npm run typecheck
npm run modules:check
npm run catalog:doctor
```

记录：

- 哪些命令默认通过。
- 哪些命令需要环境变量。
- 哪些命令依赖 Docker、Postgres、浏览器或外部 provider。
- 哪些生成物会被 tracked。

### 4.2 关键请求链路地图

至少画出以下链路：

1. 公开页面访问链路：URL -> Next route -> host page rendering -> module page/surface -> SEO/presentation。
2. Dashboard 页面链路：session -> product scope -> route -> module surface/page ->权限过滤。
3. Admin 操作链路：admin session -> route security -> admin operation -> store/capability -> audit。
4. 模块 API 链路：`/api/modules/...` -> host route security -> module route match -> anonymous policy -> handler -> `ctx.*`。
5. 模块 action 链路：form/action route -> action registry -> capability guard -> result envelope。
6. 文件链路：upload policy -> storage adapter -> metadata store -> media gateway -> cleanup/reconcile。
7. 商业链路：checkout -> order -> invoice/subscription/credit -> ledger -> reconcile。
8. 任务链路：enqueue -> queue/outbox -> worker -> retry/dead-letter -> audit。
9. Webhook 链路：signature -> receipt -> idempotency -> handler -> outbox/audit。
10. AI/RAG 链路：provider config -> cost guard -> rate/capability policy -> invocation -> artifact/source/chunk store。

每条链路都要标注：

- 入口在哪里。
- 身份从哪里来。
- 租户或 workspace 从哪里来。
- 权限在哪里检查。
- 数据在哪里读写。
- 错误在哪里被规范化。
- 审计在哪里记录。
- 用户能看到什么反馈。
- 哪些测试覆盖了这条链路。

## 5. 第二阶段：架构边界分析

目标：让宿主和模块边界长期稳定，避免框架变成“硬编码产品集合”。

### 5.1 Host 与 Module 边界

检查项：

- 宿主和共享运行时不能导入具体模块路径。
- 宿主不能硬编码模块 ID 作为业务逻辑。
- 具体产品代码只能在 `modules/<module-id>` 中出现。
- `src/lib/module-map.ts` 和 manifest 只能作为生成注册表，不应承载手写业务判断。
- 模块使用宿主能力必须通过 `ctx.*`，不能绕过 capability guard。

建议命令：

```bash
npm run host:boundary-check
npm run modules:scan
npm run modules:check
rg -n "modules/(hello|shop-demo|cms-demo|capability-demo|ai-rag-demo|white-label-site-demo)" apps src
```

验收标准：

- `apps`、`src/lib/module-runtime`、`src/lib/module-capabilities` 中没有直接导入具体模块实现。
- 默认 module map 不引用仓库外路径。
- 修改模块入口后重新 scan，生成物可复现。

### 5.2 SDK 与 Runtime 边界

检查项：

- `src/module-sdk/types.ts` 中的每个 contract 字段都有 validator 或明确的 experimental 标记。
- 每个安全相关字段都有运行时 enforcement。
- SDK 暴露的能力不要求模块作者 import host 内部路径。
- 模板只使用公开 SDK，不使用宿主内部实现。

重点字段：

- `permissions`
- `api.routes`
- `anonymousPolicy`
- `data`
- `commercial`
- `surfaces`
- `presentation`
- `dependencies.npm`
- `serviceRequirements`
- `jobs`
- `webhooks`

分析方法：

1. 从类型定义找字段。
2. 搜索 validator 是否检查。
3. 搜索 doctor/test 是否报告。
4. 搜索 runtime 是否执行。
5. 搜索模板是否生成。
6. 搜索文档是否解释。
7. 搜索测试是否覆盖 deny/allow。

如果某字段只出现在类型和文档里，没有运行时或测试，就记为契约漂移。

### 5.3 Capability 边界

能力层是 PloyKit 的核心安全边界。每个 `ctx.*` 能力都要分析：

- 是否有权限声明。
- 是否有 capability guard。
- 是否区分读写。
- 是否需要租户、workspace 或 subject ownership。
- 是否涉及外部网络、成本、文件、密钥或原始 SQL。
- 是否有审计记录。
- 是否有 rate limit 或 quota。
- 是否有 deny test。

敏感能力优先级：

1. `ctx.data.sql`
2. `ctx.files`
3. `ctx.commerce`
4. `ctx.ai`
5. `ctx.rag`
6. `ctx.http` / service invocation
7. `ctx.webhooks`
8. `ctx.jobs`
9. `ctx.events`
10. `ctx.secrets`

对每个敏感能力建立矩阵：

| 能力 | 权限 | 运行时检查 | 租户隔离 | 成本/配额 | 审计 | deny test | allow test |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ctx.data.sql.query` | `data.sql.read` + raw 权限 | capability guard | workspace/session | 无 | 是 | 是 | 是 |

矩阵里出现空格，就是优先修复点。

## 6. 第三阶段：安全与权限分析

目标：默认安全、显式授权、失败可解释。

### 6.1 默认启动安全

检查项：

- 生产环境不会自动创建固定账号。
- 默认配置不会启用 demo 用户。
- 没有默认 secret、默认 token、默认 webhook signing key。
- 本地开发便利能力必须由显式环境变量开启。
- 生产环境缺关键配置时应 fail fast。

建议命令：

```bash
npm run test:security-runtime
npm run test:security-hardening
npm run test:production-runtime
npm run runtime:check
```

记录所有 `PLOYKIT_*` 环境变量：

- 名称
- 默认值
- 是否允许生产缺省
- 错误码
- 文档位置
- 测试覆盖

### 6.2 Route Security

按 route 分类：

- Public page
- Auth route
- User dashboard route
- Admin route
- Module API route
- Module action route
- Worker route
- Billing route
- File/media route
- Webhook route

每类 route 检查：

- method 限制
- origin/same-origin guard
- CSRF token 或同源策略语义
- session 要求
- admin 要求
- product scope / workspace 要求
- module runtime access
- anonymous policy
- rate limit
- request body 大小限制
- error redaction
- audit

建议建立 `route security enforcement map`，并让 route catalog、handler 和测试保持一致。

### 6.3 权限一致性

分析路径：

1. 列出 `Permission` 枚举。
2. 标出 system-only 权限。
3. 搜索每个权限在哪里被检查。
4. 搜索每个 capability 是否有对应权限。
5. 找出“声明了但没有检查”的权限。
6. 找出“检查了但文档没说”的权限。
7. 找出“模板默认声明过宽”的权限。

重点问题模式：

- 模块为了 demo 方便声明了过大权限。
- 权限只在 UI 上隐藏入口，但 API 仍可调用。
- 管理后台直接调用 store，绕过统一 admin operation guard。
- action/API 错误把权限细节或内部路径透给客户端。

验收标准：

- 高风险能力至少有 deny/allow 双向测试。
- 权限错误返回稳定 code。
- 客户端看不到内部 stack、SQL、secret、provider key、文件真实路径。

## 7. 第四阶段：数据、事务与一致性分析

目标：线上不会因为并发、重试或部分失败产生脏数据。

### 7.1 Store 抽象一致性

PloyKit 有 memory 和 Postgres store。要验证：

- 同一个 store interface 在 memory/Postgres 下行为一致。
- 事务语义一致，尤其是失败回滚。
- ID、时间、状态枚举、排序、分页一致。
- 唯一约束、幂等 key、workspace scope 在两种 store 下都有效。
- Postgres migration 与 TypeScript 类型一致。

建议命令：

```bash
npm run test:runtime-stores
npm run runtime:stores:verify
npm run host:postgres-local-smoke
```

### 7.2 事务与并发

重点审计：

- checkout、订单、发票、订阅、credit ledger。
- 文件上传完成与 metadata 写入。
- 任务入队与 outbox。
- webhook receipt 与重复投递。
- AI/RAG invocation 与 artifact/source/chunk 写入。
- 用户注册、邮箱验证、密码重置。
- workspace 邀请、成员角色变更。

每条写路径都要回答：

- 是否有事务？
- 是否有幂等 key？
- 是否有唯一约束？
- 是否有状态机？
- 重复请求会怎样？
- 失败在中间步骤会怎样恢复？
- 后台 reconcile 能不能发现并修复？

危险模式：

- 先读库存再写库存，没有条件更新。
- 先调用外部支付，再写本地订单，没有 idempotency。
- 先上传文件，再写 metadata，失败后没有 cleanup。
- worker 失败重试导致重复发邮件或重复扣费。
- webhook handler 只看 event id，没有 provider/account/workspace scope。

验收标准：

- 金钱、库存、用量、权限、文件状态必须有数据库约束或幂等保护。
- 外部 provider 调用必须可重试、可对账、可审计。
- 关键状态机必须有非法跃迁测试。

### 7.3 Migration 与升级

检查：

- migration 文件是否只追加，不回写历史。
- migration journal 是否能识别已执行版本。
- 新增字段是否有 backfill 策略。
- schema 变更是否兼容旧数据。
- 回滚策略是否文档化。
- 版本升级 smoke 是否覆盖。

建议命令：

```bash
npm run host:upgrade-migration-smoke
npm run host:backup-restore-smoke
```

验收标准：

- 从上一个 release 数据库升级到当前版本可成功。
- 备份恢复后关键页面/API 可用。
- migration 失败时不会留下半升级状态。

## 8. 第五阶段：商业化与成本控制分析

目标：计费、账本、AI 成本和外部调用都可控、可审计、可恢复。

### 8.1 Commercial Ledger

检查：

- 金额、credit、usage 是否使用稳定单位，避免浮点误差。
- 每一笔 ledger entry 是否有 source、workspace、subject、idempotency key。
- refund、credit note、settlement、reconcile 是否覆盖。
- 并发扣费是否会重复。
- entitlement 与实际 capability enforcement 是否一致。

建议命令：

```bash
npm run test:commercial-ledger
npm run test:commercial-postgres
npm run host:billing-reconcile-smoke
npm run host:stripe-local-smoke
```

验收标准：

- 账本 append-only 或有明确修正记录。
- 所有金额变更可追踪到业务事件。
- 重复 webhook 不会重复入账。
- provider 状态与本地状态可 reconcile。

### 8.2 AI/RAG 成本与安全

检查：

- 匿名访问是否受限。
- high-cost action 是否必须显式允许。
- provider key 是否只在服务端使用。
- prompt、response、source chunk 是否做敏感信息处理。
- invocation 是否记录 token/cost/provider/model。
- 失败是否区分 provider error、quota error、policy error。

建议命令：

```bash
npm run test:ai-provider-runtime
npm run test:rag-files
npm run host:rag-provider-smoke
npm run host:provider-matrix
```

验收标准：

- 高成本能力有配额、审计和 deny test。
- 模块不能绕过 provider/cost guard。
- RAG 文件与 source chunk 有 workspace 隔离。

## 9. 第六阶段：模块开发体验分析

目标：模块作者用正确姿势自然写出安全、可测、可发布的模块。

### 9.1 模板质量

每个模板检查：

- 生成后 `module:doctor` 通过。
- 生成后 `module:test` 通过。
- 权限最小化。
- public API route 有 `anonymousPolicy`。
- action 返回稳定结果。
- README 说明能力边界。
- smoke test 覆盖主流程。

建议命令：

```bash
npm run modules:templates
npm run module:create -- tmp-check --template basic
npm run module:doctor -- tmp-check
npm run module:test -- tmp-check
```

### 9.2 CLI 体验

检查 CLI 输出：

- 是否有稳定错误码。
- 是否区分 error/warning/info。
- 是否给出修复建议。
- 是否支持 JSON 输出，便于 CI 使用。
- 是否不会吞掉原始错误位置。
- 是否对常见错误有友好解释。

重点命令：

```bash
npm run module:doctor -- all
npm run module:test -- all
npm run module:quality -- all
npm run data:plan -- all
npm run data:verify -- all
npm run module:evidence -- all
```

验收标准：

- 新模块作者不需要读宿主源码，也能从 CLI 输出修复 80% 常见问题。
- CI 里失败信息能定位到模块、文件、字段和建议动作。

### 9.3 默认模块分级

建议给默认模块标注等级：

- Fixture：只用于测试运行时最小能力。
- Demo：展示能力，不承诺生产业务完整性。
- Reference：可作为生产模块骨架参考。
- Product-grade：事务、权限、测试、文档、恢复路径都足够完整。

示例：

| 模块 | 建议等级 | 说明 |
| --- | --- | --- |
| `hello` | Fixture | 最小运行时夹具 |
| `public-tools-demo` | Reference | 公开工具模块样板 |
| `cms-demo` | Reference | 内容与 CRUD 样板 |
| `shop-demo` | Demo/Reference | 商业链路需持续强化并发与对账 |
| `capability-demo` | Demo | 展示能力，不应直接照搬权限 |
| `ai-rag-demo` | Demo/Reference | 需强调成本与匿名访问策略 |
| `white-label-site-demo` | Reference | 白标和 presentation 样板 |

## 10. 第七阶段：前端与用户稳定性分析

目标：用户使用时不迷路、不误操作、不因慢请求或异常状态失控。

### 10.1 页面状态完整性

每个页面至少检查：

- loading
- empty
- error
- permission denied
- offline/provider unavailable
- partial data
- pagination empty page
- mutation pending
- mutation success
- mutation failure
- retry/reconcile

重点页面：

- Admin overview
- Admin modules
- Admin operations
- Admin commerce
- Admin data
- Admin files
- Dashboard billing
- Dashboard files
- Dashboard notifications
- Auth pages
- Public site pages

建议命令：

```bash
npm run test:web-shell
npm run host:browser-matrix -- --required
npm run host:accessibility-smoke -- --required
npm run admin:ui-gate
npm run admin:mobile-handfeel
```

### 10.2 UI 复杂度

大型页面文件应重点拆分：

- page data model
- view components
- table columns
- filters
- dialogs/drawers
- mutation actions
- formatting helpers
- test fixtures

拆分原则：

- 不改变路由和用户行为。
- 先抽纯函数和小组件。
- 每次拆分后跑 typecheck 和相关页面测试。
- 不把样式重写和逻辑拆分混在同一个 PR。

### 10.3 可访问性与移动端

检查：

- 键盘可达。
- focus trap 正确。
- dialog/drawer 有清晰关闭路径。
- 表格在移动端不溢出关键操作。
- 错误信息与控件关联。
- 图标按钮有可访问名称。
- loading 不造成布局跳动。

验收标准：

- 关键用户流在桌面和移动端都能完成。
- 自动可访问性 smoke 通过。
- 人工截图检查没有文本重叠、按钮挤压、表格失控。

## 11. 第八阶段：可观测性、审计与恢复

目标：线上出问题时能知道发生了什么、影响谁、如何恢复。

### 11.1 日志

检查：

- 日志是否结构化。
- 是否包含 request id / correlation id。
- 是否包含 module id、workspace id、user id 或 subject。
- 是否做敏感字段 redaction。
- 是否区分 info/warn/error。
- 是否避免在客户端泄漏内部日志。

### 11.2 审计

必须审计的操作：

- 登录、登出、注册、密码重置。
- admin 修改用户、角色、权限。
- 模块安装、启用、禁用、升级。
- billing、credit、invoice、subscription 变化。
- 文件上传、删除、公开访问。
- API key 创建、撤销、使用异常。
- Webhook 接收和处理失败。
- Worker dead-letter。
- AI/RAG 高成本调用。

### 11.3 恢复路径

每个后台能力都要有：

- status page 或 admin panel。
- retry 或 reconcile 操作。
- dead-letter 查看。
- 安全的手动修复方式。
- 操作审计。

建议命令：

```bash
npm run host:worker-soak
npm run host:chaos-smoke
npm run host:files-reconcile-smoke
npm run host:files-cleanup-smoke
npm run host:billing-reconcile-smoke
```

## 12. 第九阶段：文档与发布治理

目标：文档不是装饰，而是生产能力的一部分。

### 12.1 文档一致性

每份文档检查：

- 是否有明确适用版本。
- 是否引用真实命令。
- 命令是否能在干净 clone 执行。
- 是否说明本地、集成、生产差异。
- 是否说明安全边界。
- 是否有断链。
- 是否有过期功能承诺。

重点文档：

- `README.md`
- `docs/module-development.zh-CN.md`
- `docs/module-contract-spec.zh-CN.md`
- `docs/security-model.zh-CN.md`
- `docs/security-enforcement-map.zh-CN.md`
- `docs/runtime-stores.zh-CN.md`
- `docs/deployment.zh-CN.md`
- `docs/release-candidate-checklist.zh-CN.md`

建议命令：

```bash
npm run docs:encoding-check
npm run i18n:check
npm run seo:check
npm run presentation:check
```

### 12.2 发布门禁

建议分层：

#### Local Gate

用于普通开发：

```bash
npm run typecheck
npm run modules:check
npm run catalog:doctor
npm run test:web-shell
npm run release:local-gate
```

#### Integration Gate

用于合并前：

```bash
npm run release:integration-gate
npm run module:test -- all
npm run test:security-hardening
npm run test:runtime-stores
```

#### Maintainer Gate

用于 RC 或正式发布：

```bash
npm run host:build
npm run release:maintainer-gate
npm run release:evidence
```

如涉及外部 provider、浏览器矩阵、Postgres、S3、Stripe、邮件，需要补充对应 smoke。

### 12.3 发布证据

每次发布应保存：

- commit hash
- Node/npm 版本
- 环境变量 profile
- module map manifest hash
- migration 状态
- 测试命令与结果
- browser/accessibility 截图或报告
- provider smoke 结果
- 已知风险与豁免

证据必须有生成时间，并明确是否 `required=true`。

## 13. 第十阶段：代码体量与复杂度治理

目标：降低修改成本，让每次变更都更小、更可 review。

### 13.1 大文件识别

建议定期运行：

```bash
rg --files -g "*.ts" -g "*.tsx" -g "*.mjs" | sort
```

再统计行数，优先关注：

- 超过 1500 行的业务文件。
- 超过 800 行且混合多个领域的文件。
- 同时包含数据访问、权限、格式化、UI、请求调用的文件。
- 频繁变更且冲突多的文件。

### 13.2 拆分顺序

优先级：

1. 纯 helper、mapper、formatter。
2. 类型、常量、错误码。
3. repository 或 store domain。
4. service layer。
5. UI 子组件。
6. hook/page model。
7. CLI parser 与 command handlers。

避免：

- 同时拆文件、改行为、换样式。
- 为了抽象而抽象。
- 在没有测试的情况下拆高风险商业/数据逻辑。

验收标准：

- 拆分前后 public API 不变。
- 相关测试通过。
- 代码 owner 或 reviewer 能更快定位问题。

## 14. 第十一阶段：依赖与供应链分析

目标：默认依赖可解释、可审计、不会让模块绕过框架边界。

### 14.1 根依赖

检查：

- 生产依赖是否必要。
- dev dependency 是否混入 runtime。
- Next/React/TypeScript 版本是否与 Node engines 匹配。
- `overrides` 是否有原因记录。
- audit 是否可在 npm 官方 registry 下运行。

建议命令：

```bash
npm audit --omit=dev --registry=https://registry.npmjs.org
npm run typecheck
```

### 14.2 模块依赖

检查：

- `dependencies.npm` 是否只允许安全 source。
- 是否禁止 `file:`、`link:`、`workspace:`、git、URL、alias。
- 是否使用 `--ignore-scripts` 安装。
- 缺失依赖是否能被 CLI 检出。
- 模板是否示范最小依赖。

建议命令：

```bash
npm run modules:deps -- --check
npm run test:developer-experience
```

验收标准：

- 模块依赖声明和安装策略统一。
- 无法通过动态表达式隐藏依赖。
- CI 能发现缺失或危险依赖。

## 15. 第十二阶段：性能与容量分析

目标：不是过早优化，而是避免明显线上瓶颈。

### 15.1 请求性能

检查：

- 首屏页面是否重复加载 module contracts。
- admin 大页面是否一次性拉取过多数据。
- 表格是否分页、过滤、排序在服务端闭环。
- RAG 搜索、文件列表、audit 列表是否有索引。
- route handlers 是否有不必要同步重计算。

### 15.2 后台吞吐

检查：

- worker batch size。
- retry backoff。
- dead-letter 阈值。
- provider rate limit。
- queue visibility 或 lock。
- 长任务是否有 heartbeat。

### 15.3 数据库索引

重点表：

- users / sessions
- workspaces / members / invitations
- runtime store records
- files
- audit events
- commercial orders / invoices / ledger
- outbox / jobs
- webhook receipts
- provider invocations
- RAG sources/chunks

每个高频查询都应对应索引；每个唯一业务约束都应落到数据库。

## 16. 第十三阶段：测试策略

目标：测试不是数量游戏，而是覆盖风险。

### 16.1 测试分层

- Unit：纯函数、validator、mapper、parser。
- Runtime：module host、capability guard、store interface。
- Contract：module.ts、doctor、templates。
- Integration：Postgres、worker、files、commercial。
- Browser：host page、admin、dashboard、auth、public site。
- Chaos：重试、失败、部分成功、恢复。
- Release：把关键证据串成 gate。

### 16.2 每类变更的最低测试

| 变更类型 | 最低测试 |
| --- | --- |
| SDK 类型/validator | `test:module-contract`、`module:doctor` |
| capability guard | `test:security-runtime`、deny/allow case |
| module runtime adapter | `test:host-runtime`、对应 API/action test |
| store | `test:runtime-stores`、Postgres smoke |
| commercial | `test:commercial-ledger`、billing smoke |
| UI 页面 | `test:web-shell`、browser/accessibility smoke |
| 模板 | `module:create`、`module:doctor`、`module:test` |
| 文档命令 | 手动执行文档中的命令或加 smoke |
| release gate | `release:local-gate` 或更高 profile |

### 16.3 回归测试写法

每个 bug 修复都尽量新增：

- 一个失败复现测试。
- 一个修复后通过测试。
- 一个边界测试。

高风险安全问题至少要有：

- unauthorized deny
- authorized allow
- malformed input deny
- redaction check

## 17. 第十四阶段：逐步执行路线

### Week 1：建立基线

目标：

- 跑通基础命令。
- 记录当前失败项。
- 建立风险清单。
- 生成当前架构地图。

建议执行：

```bash
npm run typecheck
npm run lint
npm run modules:check
npm run catalog:doctor
npm run test:web-shell
npm run test:security-hardening
npm run test:runtime-stores
npm run release:local-gate
```

输出：

- `docs/project-health-baseline.zh-CN.md`
- P0/P1/P2/P3 风险表
- 当前必修复命令列表

### Week 2：安全与契约闭环

目标：

- 补齐权限、anonymous policy、route security、error envelope。
- 修复所有契约漂移。

重点：

- SDK 字段全链路追踪。
- capability guard 矩阵。
- route security enforcement map。
- deny/allow 测试。

输出：

- 更新安全模型文档。
- 新增/更新安全测试。
- `npm run test:security-runtime` 和 `test:security-hardening` 通过。

### Week 3：数据与商业可靠性

目标：

- 强化事务、幂等、对账、迁移。

重点：

- checkout/order/ledger。
- files metadata 与 storage consistency。
- worker/outbox。
- webhook receipts。
- Postgres constraints。

输出：

- 数据一致性风险表。
- migration/upgrade smoke 结果。
- billing/files/worker reconcile smoke 结果。

### Week 4：模块作者体验

目标：

- 让模板、CLI、文档、doctor 输出形成闭环。

重点：

- 模板生成后即通过 doctor/test。
- CLI 错误信息可操作。
- 默认模块分级。
- docs 中命令可执行。

输出：

- 模板质量矩阵。
- CLI diagnostics 改进清单。
- 默认模块等级说明。

### Week 5：UI 与用户稳定性

目标：

- 关键页面具备完整状态、可访问性和移动端稳定性。

重点：

- Admin/Dashboard 大页面拆分。
- loading/empty/error/permission state。
- browser matrix。
- accessibility smoke。

输出：

- 页面状态矩阵。
- 截图证据。
- UI 回归测试。

### Week 6：发布证据与长期治理

目标：

- 把分析方法固化成 release gate 和日常 checklist。

重点：

- maintainer gate。
- evidence 归档。
- PR checklist。
- issue templates。
- recurring audit cadence。

输出：

- `release:evidence` 最新通过结果。
- PR 模板。
- 生产发布 checklist。

## 18. 每次分析的标准模板

建议每个专题分析都使用这个格式：

```md
# 专题名称

## 范围

- 涉及目录：
- 涉及用户路径：
- 涉及命令：

## 当前事实

- 代码证据：
- 测试证据：
- 文档证据：

## 风险判断

- 级别：
- 影响：
- 触发条件：
- 最坏结果：

## 根因

- 架构边界：
- 契约漂移：
- 测试缺口：
- 默认配置：

## 修复方案

- 方案 A：
- 方案 B：
- 兼容性：
- 迁移策略：

## 验收

- 必跑命令：
- 新增测试：
- 人工检查：
- 发布证据：

## 后续债务

- P2：
- P3：
```

## 19. 生产级完成定义

PloyKit 可接近商业级生产框架时，应满足：

- 干净 clone 后基础 gate 通过。
- 所有 P0/P1 清零，P2 有明确 owner 和计划。
- 模块 contract、validator、runtime、doctor、template、docs、tests 一致。
- 安全默认值可用于公开部署。
- 所有高风险 capability 有 deny/allow 测试。
- Postgres/memory store 关键行为一致。
- 商业账本、文件、worker、webhook、AI/RAG 有幂等、审计、恢复路径。
- 默认模块清楚标注等级，不误导生产使用。
- Admin/Dashboard 关键页面具备完整状态和可访问性证据。
- release evidence 可复现、带时间戳、带 required profile。
- 文档中的 quickstart、module workflow、deployment 命令可执行。

## 20. 推荐常驻仪表盘

建议维护一个项目健康仪表盘，至少包含：

- 当前 release gate 状态。
- P0/P1/P2 数量。
- 最大文件 Top 20。
- 测试耗时 Top 20。
- module doctor 失败项。
- route security catalog 覆盖率。
- capability guard deny/allow 覆盖率。
- migration 最新版本。
- provider smoke 状态。
- browser/accessibility 最新证据。
- 文档断链数。
- inline copy 数。
- npm audit 状态。

这个仪表盘可以先用文档维护，后续再做成脚本或 Admin 页面。

## 21. 最小每日检查

日常开发结束前至少跑：

```bash
npm run typecheck
npm run modules:check
npm run catalog:doctor
npm run test:web-shell
```

改了安全、权限、运行时、商业、数据、文件、worker、AI/RAG 时追加对应专项测试。

## 22. 最小发布前检查

发布前至少跑：

```bash
npm run lint
npm run release:integration-gate
npm run module:test -- all
npm run test:security-hardening
npm run test:runtime-stores
npm run release:evidence
```

涉及真实部署时再追加：

```bash
npm run host:build
npm run host:provider-matrix -- --required
npm run host:browser-matrix -- --required --base-url <host-url>
npm run host:accessibility-smoke -- --required --base-url <host-url>
npm run host:backup-restore-smoke -- --required
npm run host:upgrade-migration-smoke -- --required
```

## 23. 最重要的改进心法

PloyKit 已经不是一个简单 demo，它的问题会越来越少来自“缺代码”，越来越多来自“边界不闭合”。后续每次新增能力，都要问七个问题：

1. 模块作者如何声明？
2. validator 如何阻止错误声明？
3. 运行时如何强制执行？
4. 宿主 UI 如何展示和操作？
5. 数据层如何保证一致性？
6. 测试如何证明 deny/allow/失败恢复？
7. 文档和发布证据如何让外部用户相信它？

这七个问题能回答清楚，功能才算真正进入生产级框架。
