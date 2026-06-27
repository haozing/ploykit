# 模块开发指南

> Legacy human doc: 本文保留给人阅读。LLM 编写模块时，以 `AGENTS.md` 和 `docs/llm/` 为当前事实源；如果本文与 LLM wiki 冲突，优先使用 LLM wiki。

PloyKit 的模块是一等本地源码模块。模块只依赖 `@ploykit/module-sdk`、自己的目录文件和宿主注入的 `ctx.*` capability，不导入宿主 `src/lib/*`，不直接读数据库，不直接读 `process.env`。

模块按可信本地源码处理。PloyKit 的 `ctx.*` guard 是能力 API 层约束，不是
Node.js 级别的不可信第三方插件沙箱；不要安装或执行未经源码审查的陌生模块。

字段级契约、版本策略和发布门禁见 [module-contract-spec.zh-CN.md](module-contract-spec.zh-CN.md)。
受控外部服务的重设计计划见
[模块受控外部服务调用修复计划](module-service-invocation-plan.zh-CN.md)。

## 创建模块

```bash
npm run module:create -- my-app
npm run module:create -- my-resource --template resource
npm run module:create -- my-tool --template tool
npm run module:create -- my-connector --template connector
```

推荐模型：

- `app`：默认普通 dashboard 应用模板。
- `resource`：schema/resource/Data v2/OpenAPI 优先的 CRUD 资源模板。
- `tool`：单页工具，包含 action/API/schema。
- `connector`：受控连接器模板，允许声明连接器权限和同步 job。

`module:create` 不再提供 `product` 模板或 `--with service-backed/background` 扩展入口。受控服务、后台任务、webhook 或白牌能力仍是平台能力，但需要在模块 contract 中显式声明，不作为普通模块第一屏脚手架。

服务端分离型产品模块（例如独立 Go Core + PloyKit 控制台）不要只按普通 dashboard 或 CRUD 模块处理。优先阅读
[服务端分离型模块开发指南](service-backed-module-development.zh-CN.md)：服务端以 OpenAPI 等机器契约为源头，PloyKit
模块声明 `contractVersion: 2` 和 `serviceRequirements`，在模块内保留单一 service client/adapter，并用
contract mock、fixture mock 和 live smoke 分层开发。创建骨架时从最接近的 `app`、`resource`、`tool` 或 `connector` 开始，再手写所需的 `serviceRequirements`、permissions 和测试。

创建后脚本会自动刷新 module map，并对新模块运行 doctor。要看当前可用模板，也可以运行：

```bash
npm run modules:templates
```

## 开发循环

```bash
npm run module:doctor -- my-module
npm run module:test -- my-module
npm run modules:check
npm run typecheck
```

## 默认模块等级

仓库内置模块带有使用边界，不应把所有示例都当成 production-ready
产品模块。当前默认等级如下：

- Fixture：只用于测试运行时最小能力，例如 `hello`。
- Demo：展示宿主能力广度，不承诺生产业务完整性，例如 `capability-demo`。
- Reference：可作为真实产品模块骨架参考，例如 `public-tools-demo`、`cms-demo` 和 `white-label-site-demo`。

`shop-demo` 和 `ai-rag-demo` 介于 Demo/Reference：它们可以作为商业链路或 AI/RAG
骨架参考，但生产使用前必须补齐真实 provider、数据库、成本、并发、匿名策略和对账证据。

有 Data v2 声明的模块还需要：

```bash
npm run data:generate -- my-module
npm run data:types -- my-module
npm run data:verify -- --module my-module
```

服务端分离型模块还应增加契约与真实链路分层验证：

```bash
# 校验模块消费的 method/path 没有从服务端机器契约漂移。
npm run module:service-contract -- <module-id> --openapi ../service/openapi.yaml
npm run module:service-contract -- <module-id> --openapi ../service/openapi.yaml --write-fixtures
npm run module:test -- <module-id>

# 真实服务联调或发布前，把模块自有 live smoke 放在模块目录内，通过通用 evidence 入口执行。
npm run module:evidence -- --module <module-id> --file ./scripts/live-smoke.ts --runner tsx -- --required
```

mock 只证明页面、loader、action 和 error display 能按契约工作；租约、重试、幂等、quota、HMAC、跨租户隔离、
one-time token 和状态机时序必须用真实服务 live smoke 或服务端 blackbox 测试证明。

## CRUD 模块结构

CRUD 模板会生成：

- `module.ts`：声明 data table、dashboard route、API route、action 和权限。
- `pages/NotesPage.ts`：页面组件入口。
- `loaders/notes.ts`：通过 `ctx.data` 读取列表。
- `api/notes.ts`：GET/POST API。
- `actions/create-note.ts`：模块 action。
- `.ploykit/generated/data-plan.json`：静态数据计划。
- `.ploykit/generated/data-types.ts`：类型文件。
- `migrations/0001_generated.sql`：生成 migration。

模块代码只需要使用：

```ts
const notes = ctx.data.table('notes');
await notes.insert({ title: 'First note', status: 'draft' });
```

## 边界规则

- 开发任何页面入口、按钮、下拉、表单或状态展示前，先判断它是宿主级能力还是模块产品能力。登录、退出、session、账号菜单、个人资料、product/workspace scope、workspace 切换、workspace 管理、成员、邀请、角色、权限、全局 dashboard shell、全局导航、语言、主题、宿主通知、billing、checkout、发票、文件上传大闭环、secret/service connection、安全存储、审计和平台 Admin 默认属于宿主。
- 宿主已有能力时，模块应优先复用宿主页面、组件、API、`ctx.*` capability、registry/contribution seam 或请求新增通用宿主透传上下文。不要在模块内重新实现第二套账号、workspace、成员、权限、计费、文件或通知系统。
- 如果宿主能力暂未暴露给模块，不要用固定文案、mock 状态或假下拉伪造成真实状态；先报告需要的通用宿主扩展点。临时内部版本只能使用中性 fallback 和真实宿主链接，例如 `Workspace`、`Account`、`/dashboard/workspaces`、`/dashboard/profile`。
- 模块不能写死看似真实的当前用户、workspace、套餐、成员、权限或购买状态。任何这类展示必须来自宿主上下文、宿主 capability、真实外部服务或明确标记的静态营销内容。
- API handler 必须使用 `defineApi(...)`。
- action handler 必须使用 `action(...)` 或 `defineAction(...)`。
- job/event/webhook/lifecycle handler 可以导出函数或带 `run`/`handle` 的对象。
- 使用 `ctx.data`、`ctx.files`、`ctx.artifacts`、`ctx.notifications`、`ctx.runs`、`ctx.jobs`、`ctx.events`、`ctx.webhooks`、`ctx.ai`、`ctx.rag`、`ctx.http`、`ctx.services`、`ctx.billing`、`ctx.commerce`、`ctx.metering`、`ctx.credits`、`ctx.entitlements`、`ctx.redeemCodes`、`ctx.risk`、`ctx.resourceBindings`、`ctx.cache`、`ctx.apiKeys`、`ctx.rateLimit` 等能力时，必须在 `module.ts` 声明匹配权限。
- 模块禁止导入 `src/lib/*`、读取 `process.env`、使用 Node builtin、`eval`、`Function`、动态 `ctx[...]` 和裸 `fetch()`。
- 普通外部 HTTP 使用 `ctx.http.fetch(...)`；需要 service secret、runtime signing、动态 claims
  或强审计的 privileged external service 必须使用 `ctx.services.invoke(...)`。
- 服务端分离型模块应把 OpenAPI 或等价机器契约作为服务 API 源头；页面、loader、action 不直接拼受控服务请求，
  只调用模块内的 service client/adapter。切换 mock、联调服务和生产服务时，应切换 service connection，而不是改页面代码。

## 商业账本边界

商业模块可以用 Data v2 存业务配置、草稿、规则和展示缓存，例如产品配置、套餐草稿、
计量规则、支付映射、渠道配置、分销规则和报表快照。

商业模块不得用 Data v2 自建权威商业账本。以下事实必须来自宿主 `ctx.*` 原语：

- API key 是否有效、归属哪个 product/workspace/module。
- subject 当前 credits 余额和额度流水。
- subject 当前 entitlement。
- paid/refunded 订单状态。
- subscription 状态。
- invoice 和 credit note 支付事实。
- redeem code 是否可兑换、是否已兑换、兑换后发放了什么。
- metering charge 是否已幂等入账。

如果模块需要展示这些事实，应通过宿主 capability 或宿主 read model 查询；不要在模块表里
复制一份可被写入的余额、权益、订单支付状态或兑换状态。宿主商业原语的重构边界见
[宿主商业核心原语重构计划](host-commercial-core-primitives-plan.zh-CN.md)。

推荐接入方式：

```ts
const subject = { type: 'user' as const, id: ctx.user!.id };

const allowed = await ctx.entitlements.has({
  subject,
  entitlement: 'tool.pro',
});

const balance = await ctx.credits.balance({ subject, unit: 'credit' });

await ctx.metering.charge({
  subject,
  meter: 'tool.generate',
  quantity: 1200,
  unit: 'token',
  credits: { amount: 1, unit: 'credit' },
  idempotencyKey: requestId,
});
```

外部 AI 工具或 Worker 接入模块 API 时，让 route 声明 `auth: 'apiKey'` 或
`auth: 'user-or-apiKey'`，不要在模块表里保存 API key hash，也不要自己校验 bearer key。
支付 webhook handler 可以做 provider payload 解析和 sku 映射，但必须调用
`ctx.commerce.applyCheckoutPaid(...)` 或 `ctx.commerce.applyRefund(...)` 入宿主账本。

## 宿主文件边界

模块开发默认只修改仓库内模块根目录，例如 `modules/<id>/`。PloyKit 不再支持从仓库外加载 module 源码；服务端、Worker 或第三方 API 可以继续独立维护，但产品模块壳应放在 `modules/<id>/`，通过 `serviceRequirements`、`ctx.services.invoke(...)` 或其他 host capabilities 接入。允许因为模块契约同步而变更的宿主外文件只有：

- `src/lib/module-map.ts`
- `src/lib/module-map.manifest.json`
- 模块自己的 `.ploykit/generated/*`、`migrations/*` 或 `tests/*`

只有用户明确要求补宿主能力、SDK、模板、文档或共享测试基础设施时，才修改 `src/lib/module-runtime/*`、`src/module-sdk/*`、`templates/modules/*`、`docs/*`、`skills/*` 或共享测试。

模块自己的验收不能升格为宿主全局政策。模块开发中不要把模块路由硬写进 `scripts/host-browser-matrix.mjs`、`scripts/host-accessibility-smoke.mjs` 或其他宿主质量脚本，不要给 `src/lib/module-runtime/release/rc-gate.ts` 增加模块专属必过检查，也不要新增模块专属 `host:*` package script。需要真实外部链路时，把 E2E 脚本放在模块目录内（例如 `<module-root>/scripts/e2e.ts`），在模块 README 里记录前置条件、命令和证据路径，并通过通用入口运行：

```bash
npm run module:evidence -- --module <id> --file ./scripts/e2e.ts --runner tsx -- --required
```

模块 `quality.evidence` 需要自动执行模块自有脚本时，也应指向通用 `module:evidence` 入口，而不是新增 `module:<id>-*` package script。只有在确认宿主已有通用质量入口后，再接入通用入口。

宿主和共享层禁止感知具体模块实现：不要在 `apps/host-next/*`、`src/lib/module-runtime/*` 或宿主质量脚本里写 `moduleId === '<id>'`、`import modules/<id>`、`/dashboard/<id>`、`<module-root>` 这类特例。需要宿主渲染、路由、质量证据或发布门禁配合时，先补通用 registry、catalog、manifest 或 contribution seam，再由模块声明贡献。`npm run host:boundary-check` 会阻止宿主 import 具体模块、硬编码模块 id/rootDir，或在 tracked 宿主配置、CSS、package scripts 中写入仓库外源码路径。

需要把 RunLynk 这类外部服务接入 PloyKit 时，把 PloyKit module 放在 `modules/runlynk/`，把 Core/OpenAPI/Worker/live smoke 保留在服务端仓库。提交前用默认 `ploykit.config.json` 重新运行 `npm run modules:scan`，确保 `src/lib/module-map.ts` 和 `src/lib/module-map.manifest.json` 只包含仓库内模块。

## 测试

模块内可以放 `tests/*.test.ts`。`npm run module:test -- my-module` 会先运行 doctor，再运行模块自己的 fake-host tests。需要宿主真实入口时：

```bash
npm run module:test -- my-module --real
```

日常排错可以使用短摘要，完整 JSON 报告仍会写入 `.runtime/module-test-reports`：

```bash
npm run module:test -- my-module --summary
npm run module:test -- all --summary
```

退出码策略：target 解析失败，或 doctor、fake-host、real-host 任一步失败时返回非 0；doctor 只有 warning 诊断时保持通过。默认 stdout 输出完整 JSON，`--summary` 输出人读摘要，`--json` 可显式保留机器读取路径。
