# module.ts 契约规范

`module.ts` 是 PloyKit 模块的唯一能力声明入口。模块作者通过 `defineModule(...)` 输出 `ModuleDefinition`；host 通过 module map 加载它，归一化为 runtime contract，然后装配 routes、actions、surfaces、Data v2、background handlers、providers、commercial guard 和 lifecycle。

## 版本

- 默认 contract schema 仍为 `contractVersion: 1`；需要受控外部服务 operation policy 的模块使用
  `contractVersion: 2`。
- 模块可以显式声明 `contractVersion: 1` 或 `contractVersion: 2`，也可以省略；runtime 会默认
  归一化为 1。
- validator 会拒绝未知 schema version。
- `version` 是模块自身 semver，不等同于 contract schema version。

模块 semver 规则：

- patch：修 bug、改文案、内部实现调整，不改变公开 route/action/data/permission 行为。
- minor：新增 route/action/surface/job/event/webhook、非破坏性 Data v2 字段、可选 config/service/resource requirement。
- major：删除或重命名公开能力、收紧权限/商业要求、改变 Data v2 语义、迁移 `id` 或破坏既有 handler 输入输出。

## 稳定字段

这些字段是稳定契约面，runtime、doctor、module map、Admin UI 都会消费：

- 身份：`id`、`name`、`version`、`description`、`contractVersion`。
- 安全：`permissions`、`scope`、`egress`。
- 数据：`data.documents`、`data.tables`、`data.views`、`data.grants`、`data.checks`、`data.migrations`。
- 路由：`routes.site`、`routes.dashboard`、`routes.admin`、`routes.api`。
- UI：`navigation`、`surfaces`、`resources`、`i18n`、`presentation`、`theme`、`head`。
- 后台：`actions`、`jobs`、`events`、`webhooks`、`lifecycle`。
- 运营：`meters`、`serviceRequirements`、`resourceBindings`、`config`、`dependencies`。

`parts` 是 v1 的组织字段：它可以记录拆分后的契约片段路径，但 module map 和 runtime 仍以 `module.ts` 导出的完整对象为准。part 文件必须是模块内 `./` 路径，且需要在 `module.ts` 中显式 import 并接回对应字段。

## 安全边界

- 模块代码只能使用 `@ploykit/module-sdk` 和注入的 `ctx.*` 能力。
- 使用 `ctx.*` 能力必须声明匹配 `Permission.*`。
- 普通外部 HTTP 必须使用 `ctx.http.fetch(...)`、`Permission.ExternalHttp` 和精确
  `egress` origin。
- 需要 service secret、runtime signing、动态 claims 或强审计的 privileged external service
  必须使用 `ctx.services.invoke(...)` 和 `Permission.ServicesInvoke`，具体 v2 方案见
  [模块受控外部服务调用修复计划](module-service-invocation-plan.zh-CN.md)。
- `theme.css` 不进入全局 host theme；使用 allowlist 中的 `theme.tokens`。
- `surface.mode: "replace"` 必须声明 `Permission.SurfaceOverride`，白牌替换还必须在 `presentation.replaces` 中声明目标。
- public site route 必须声明 metadata loader 和显式 cache 策略。
- public API 必须声明 `anonymousPolicy`，并提供 rate limit。

## 商业契约边界

商业化能力必须通过宿主 `ctx.*` 原语表达，不能在模块 Data v2 中建立第二套权威账本。
宿主商业核心原语的重构计划见
[宿主商业核心原语重构计划](host-commercial-core-primitives-plan.zh-CN.md)。

模块契约可以声明：

- route/action 的商业访问要求。
- route/action 的认证方式。
- 模块需要的 commercial permissions。
- 模块自己的产品配置、计量规则、支付映射、渠道配置和报表缓存。

模块契约不得把以下内容建成模块权威数据模型：

- credits balance。
- entitlement grant。
- paid/refunded order truth。
- refund truth。
- subscription truth。
- invoice paid/refunded truth。
- redeem redemption truth。
- API key hash。

commercial guard 以 subject 为核心，而不是只以 `userId` 为核心。示例：

```ts
{
  path: '/ai-tool/generate',
  handler: './api/generate',
  methods: ['POST'],
  auth: 'apiKey',
  commercial: {
    subject: 'apiKeyOwner',
    entitlements: ['ai-tool.pro'],
    credits: { amount: 1, unit: 'credit' }
  },
  permissions: [
    Permission.EntitlementsRead,
    Permission.CreditsRead,
    Permission.MeteringWrite
  ]
}
```

允许的认证方式应保持通用：

- `public`
- `auth`
- `apiKey`
- `user-or-apiKey`

`apiKey` session 进入 runtime 后仍必须走 capability guard。API key 只能获得其 scope 和
permission 声明允许的能力，不能因为是 server-to-server 调用就绕过 module contract。

模块调用商业原语时也应使用 subject-first API：

```ts
const subject = { type: 'user' as const, id: ctx.user!.id };

await ctx.credits.reserve({
  subject,
  amount: 5,
  source: 'task',
  sourceId: taskId,
  idempotencyKey: `reserve:${taskId}`,
});

await ctx.metering.charge({
  subject,
  meter: 'ai.generate',
  quantity: tokenCount,
  unit: 'token',
  credits: { amount: 5 },
  reservationId,
  idempotencyKey: `charge:${taskId}`,
});
```

兑换码、支付和退款必须进入同一套宿主账本：

- 兑换码批次用 `ctx.redeemCodes.createBatch` 创建，宿主只保存 hash/masked code。
- 兑换成功用 `ctx.redeemCodes.redeem` 发放宿主 credits/entitlements。
- 支付成功用 `ctx.commerce.applyCheckoutPaid` 发放宿主 credits/entitlements。
- 退款用 `ctx.commerce.applyRefund` 撤销权益和冲正额度。

商业模块的 Data v2 适合保存：

- `products`
- `plans`
- `metering_rules`
- `payment_mappings`
- `channel_configs`
- `affiliate_rules`
- `report_snapshots`

这些表只能作为业务配置和展示 read model，不能成为宿主商业事实的替代来源。

## 发布门禁

修改 `module.ts`、handler 路径、资源、Data v2、lifecycle 或 module source 后必须运行：

```bash
npm run modules:scan
npm run modules:check
npm run typecheck
```

单模块开发必须运行：

```bash
npm run module:doctor -- <module-id>
npm run module:test -- <module-id>
```

Data v2 模块还必须运行：

```bash
npm run data:generate -- <module-id>
npm run data:types -- <module-id>
npm run data:verify -- --module <module-id>
```

## Lifecycle 约定

支持的 hook 为 `install`、`enable`、`disable`、`update`、`seed`、`activate`、`deactivate`、`reset`。handler 必须是模块内路径，导出默认函数或 `{ run }` 对象。

lifecycle handler 必须幂等。失败时 host 会向调用方返回错误；模块不得假设 partial side effect 会自动回滚。需要回滚的操作应写成 Data v2 transaction 或显式补偿步骤，并通过 audit/run 记录可观察证据。

## Service 与 Resource 要求

`serviceRequirements` 和 `resourceBindings` 当前是启用前检查和 provider UI 的输入。受控
外部服务修复计划会把它们升级为 contract v2 的 invocation policy 与 scoped resource
binding。

- required service 只有在存在 active 且未 blocked 的 service connection 时才算满足。
- required resource binding 只有在存在 active、名称匹配、模块共享或模块专属、kind 匹配的 binding 时才算满足。
- optional requirement 可以展示 warning，但不应阻断模块启用。

Admin 模块页的 runtime state 必须依据真实连接和资源绑定状态计算 required gap，不能仅按声明数量计算。
