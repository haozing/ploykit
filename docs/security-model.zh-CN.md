# 安全模型

PloyKit 的安全边界是 contract-first 的：模块声明能力，宿主挂载能力，
验证器和运行时一起兜住边界。

PloyKit 模块是可信本地源码模块，不是不可信第三方插件沙箱。模块代码在宿主
进程内执行；`ctx.*` guard 约束的是通过 SDK 暴露的能力 API，不能替代
Node.js、进程、容器或网络级沙箱。

## 基本原则

- 模块只看 `module.ts` 和注入的 `ctx.*`，不直接摸宿主内部实现。
- 用什么 `ctx.*`，就声明什么 `Permission.*`。
- 公开 API 必须声明 `anonymousPolicy`，并包含速率限制。
- 普通外部 HTTP 必须走 `ctx.http.fetch(...)`，同时声明 `Permission.ExternalHttp`
  和窄 egress origin。
- 需要 service secret、runtime signing、动态 claims 或强审计的 privileged external service
  必须走 `ctx.services.invoke(...)`，并由 runtime 按 service policy 代签、脱敏和记录审计。
- `ctx.services.invoke(...)` 的 service connection 必须按 product/workspace/module scope
  解析；method、body、header、egress、timeout、max-bytes 和 private network deny 都是
  runtime 强制边界，不只是文档约定。
- 普通模块 secret 放 `ctx.secrets`，非 secret 配置放 `ctx.config`；privileged service
  credentials 只能通过 Admin service connection 的 `secretRefs` 管理。

## 常见权限面

- `ctx.runs` / `ctx.jobs` / `ctx.events` / `ctx.webhooks`
- `ctx.files` / `ctx.artifacts`
- `ctx.ai` / `ctx.rag`
- `ctx.connectors` / `ctx.services`
- `ctx.billing` / `ctx.commerce` / `ctx.credits` / `ctx.metering`
- `ctx.entitlements` / `ctx.redeemCodes` / `ctx.risk`
- `ctx.notifications` / `ctx.audit`
- `ctx.apiKeys` / `ctx.rateLimit` / `ctx.cache`
- `ctx.resourceBindings`

商业化能力的长期边界是：宿主提供 API key、subject、credits、entitlements、commerce
apply、redeem code、metering charge、audit 和基础 risk 等通用原语；模块只承载业务配置、
行业规则和页面体验。详细计划见
[宿主商业核心原语重构计划](host-commercial-core-primitives-plan.zh-CN.md)。

## 机器身份和商业 subject

模块 API 可以声明 `auth: 'apiKey'` 或 `auth: 'user-or-apiKey'`。API key 认证成功后会
生成标准 runtime access session，包含 `authKind: 'apiKey'`、`apiKeyId`、owner
`subject`、scope 和 permissions。API key 明文不会进入 store、audit、notification 或
artifact；宿主只保存 hash 和 prefix。

商业能力按 `CommercialSubject` 授权和记账：

- `{ type: 'user', id }`
- `{ type: 'workspace', id }`
- `{ type: 'organization', id }`
- `{ type: 'apiKey', id }`

普通用户只能访问自己的 user subject；workspace/admin/system session 才能访问更宽 subject。
`ctx.credits`、`ctx.entitlements`、`ctx.redeemCodes` 和 `ctx.risk` 都必须经过 subject
ownership guard。

商业 capability 到 permission 的核心映射：

- `ctx.apiKeys.create/rotate/revoke/list/verify/require`：
  `Permission.ApiKeysRead` / `Permission.ApiKeysWrite`。
- `ctx.credits.balance/listLedger`：`Permission.CreditsRead`。
- `ctx.credits.grant/adjust/refund/revokeBySource`：`Permission.CreditsWrite`。
- `ctx.credits.consume/reserve/commitReservation/releaseReservation`：
  `Permission.CreditsConsume`。
- `ctx.entitlements.has/list`：`Permission.EntitlementsRead`。
- `ctx.entitlements.grant/revoke/override/expire`：`Permission.EntitlementsWrite`。
- `ctx.metering.authorize/commit/refund/void/reconcile/charge`：
  `Permission.MeteringWrite`。
- `ctx.commerce.createCheckout/getOrder`：`Permission.CommerceWrite` /
  `Permission.CommerceRead`。
- `ctx.commerce.applyCheckoutPaid/applyRefund/recordSubscriptionEvent/reconcilePaidOrderBenefits`：
  `Permission.CommerceApply`。
- `ctx.redeemCodes.createBatch/freeze/revoke`：`Permission.RedeemCodesWrite`。
- `ctx.redeemCodes.redeem`：`Permission.RedeemCodesRedeem`。
- `ctx.redeemCodes.list/listRedemptions`：`Permission.RedeemCodesRead`。
- `ctx.risk.record/block`：`Permission.RiskWrite`。
- `ctx.risk.check`：`Permission.RiskRead`。

## 白牌和页面替换

- `presentation.whiteLabel` 打开白牌模式。
- `presentation.replaces` 必须列出被替换的 host surface。
- 白牌模块还需要 `resources.locales`、`i18n`、`themeScope` 和页面
  presentation loader。

## 需要特别小心的点

- `DataSqlWrite`、`RuntimeManage`、`AuthManage`、`UnsafeSqlRaw`、
  `UnsafeInternalResource` 这类 system-only 权限不要在普通模块里乱用。
- 不要把 secret、token、签名、cookie 写进日志、artifact、notification
  或文档截图。
- 需要跨请求记忆的逻辑优先落到运行时存储，而不是偷读环境变量。
- 不要在模块里为 privileged service 自己实现 bearer/HMAC，也不要用 `ctx.http.fetch`
  直连受控服务 origin；详细修复计划见
  [模块受控外部服务调用修复计划](module-service-invocation-plan.zh-CN.md)。
- 不要安装或执行未经源码审查的陌生模块。未来若要支持第三方 marketplace，需要
  单独设计进程隔离、包签名、网络策略、资源配额、审计和撤销机制。
