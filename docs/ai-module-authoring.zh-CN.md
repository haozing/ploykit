# AI 辅助模块开发

AI 可以写 PloyKit 模块，但必须让它在仓库内模块边界里工作：只改 `modules/<id>/`，从 `module.ts` 开始理解契约，按 doctor 诊断循环修复。

如果任务只是模块接入，默认写权限只开放 `modules/<id>/`、模块本地生成文件和测试，以及 module-map 生成文件；不要修改 `apps/host-next/*`、`src/lib/module-runtime/*`、`src/module-sdk/*`、`scripts/host-*`。确实缺少宿主扩展点时，不要用 `moduleId === '<id>'`、`import modules/<id>`、硬编码 `<module-root>` 或把模块路由塞进宿主脚本来完成需求；先报告需要通用 registry/contribution seam，再做宿主级抽象。

## 宿主能力优先规则

AI 开发模块前必须先判断功能事实来源：这是宿主级能力，还是模块自己的产品能力。

默认属于宿主的能力包括：登录、退出、session、账号菜单、个人资料、product/workspace scope、workspace 切换、workspace 管理、成员、邀请、角色、权限、全局 dashboard shell、全局导航、语言、主题、宿主通知、billing、checkout、发票、文件上传大闭环、secret/service connection、安全存储、审计和平台 Admin。

宿主已有时，AI 应优先复用宿主页面、组件、API、`ctx.*` capability、registry/contribution seam 或请求新增通用宿主透传上下文。不要在模块内重新实现第二套账号、workspace、成员、权限、计费、文件或通知系统。

模块只负责自己的产品领域能力，例如领域对象、领域页面内容、领域 loader/action/API/job/webhook、外部产品服务中转、领域诊断和证据。

如果宿主能力当前没有暴露给模块，AI 不应写固定文案、mock 状态或假下拉来伪装完成；应明确报告缺少的通用宿主扩展点。临时内部版本只能使用中性 fallback 和真实宿主链接，例如 `Workspace`、`Account`、`/dashboard/workspaces`、`/dashboard/profile`，不能写死看似真实的当前用户、workspace、套餐、成员或权限状态。

新增页面、按钮、表单、下拉、状态展示前，应先记录：

```md
### 宿主能力复用检查

- 功能名称：
- 这是宿主级能力还是模块产品能力：
- 宿主是否已有页面/组件/API/capability：
- 证据文件：
- 复用方式：
- 若宿主未暴露给模块，需要新增的通用扩展点：
- 模块内允许实现的部分：
- 明确禁止伪造的部分：
```

可以把下面这段直接追加到 AI 任务提示词里：

```text
开发前必须先检查宿主是否已有对应能力。账号、登录退出、workspace、成员、邀请、角色、权限、billing、文件上传、通知、全局导航、主题和语言默认属于宿主能力。宿主已有时，优先复用宿主组件、API、页面或请求新增宿主透传上下文；不要在模块内重新实现，也不要用固定文案或 mock 数据伪造真实状态。只有模块自己的产品领域业务才放在模块内实现。
```

## 推荐提示词

```text
你正在开发 PloyKit 本地模块。只修改仓库内 modules/<id>/。
先阅读 module.ts，确认 routes/actions/jobs/events/webhooks/data/permissions。
默认只修改 modules/<id>/；除 module-map 生成文件外，不把模块验收改成宿主全局门禁。
不要修改 apps/host-next/*、src/lib/module-runtime/*、src/module-sdk/*、scripts/host-*，除非用户明确要求宿主扩展点；缺扩展点时先提出通用 registry/contribution seam，不要在宿主写 moduleId 特判或 import 具体模块。
模块代码只能导入 @ploykit/module-sdk，不能导入 src/lib/*，不能读 process.env，不能直接访问数据库。
使用 ctx.data/ctx.files/ctx.artifacts/ctx.notifications/ctx.runs/ctx.jobs/ctx.events/ctx.webhooks/ctx.ai/ctx.rag/ctx.http/ctx.services/ctx.billing/ctx.commerce/ctx.metering/ctx.credits/ctx.entitlements/ctx.redeemCodes/ctx.risk/ctx.apiKeys/ctx.rateLimit/ctx.resourceBindings/ctx.cache 等能力时，同步更新 module.ts permissions。
商业模块可以用 Data v2 存产品配置、套餐草稿、计量规则、渠道配置、支付映射和报表缓存；不要用 Data v2 自建权威余额、权益、订单支付状态、退款状态、兑换状态、API key hash 或订阅状态，必须走宿主 ctx.* 商业原语。
AI 用量计费不要只写 ctx.usage；模块应把 token、图片、文件页数或任务时长换算成 credits，然后调用 ctx.metering.charge。需要长任务预扣时先调用 ctx.credits.reserve，成功后由 charge commit reservation，失败后 releaseReservation。
外部工具接入模块 API 时声明 auth: 'apiKey' 或 auth: 'user-or-apiKey'，不要在模块里保存或验证 server-to-server key。
普通外部 HTTP 走 ctx.http.fetch；需要 service secret、runtime signing、动态 claims 或强审计的受控服务只声明 serviceRequirements/resourceBindings，并调用 ctx.services.invoke，不要自己读 secret 或实现 HMAC。
如果模块对接独立服务端，先寻找 OpenAPI/AsyncAPI/JSON Schema/Proto 等机器契约；没有机器契约时先补契约，不要凭 Markdown 或口头描述直接写页面。模块内保留单一 service client/adapter，页面/loader/action 只调用语义函数。开发期可以 mock ctx.services.invoke 或指向 contract mock server，但租约、重试、幂等、quota、HMAC、跨租户隔离、one-time token 和状态机时序必须 live smoke。
完成后运行 npm run module:doctor -- <module-id>，按第一个 error 修复并重跑。
```

服务端分离型模块提示词：

```text
给 <module-id> 开发一个对接独立服务端的 PloyKit 模块。
1. 先读取服务端 OpenAPI/AsyncAPI/JSON Schema/Proto；如果没有机器契约，先输出需要补齐的契约清单，不要直接写页面。
2. 在 module.ts 声明 contractVersion: 2、serviceRequirements、resourceBindings 和 ServicesInvoke/AuditWrite 等必要权限。
3. 新增或维护 lib/service-client.ts，作为唯一 ctx.services.invoke 入口；页面、loader、action 只调用 listX/createY 这类语义函数。
4. 运行 npm run module:service-contract -- modules/<module-id> --openapi <openapi.yaml> --write-fixtures，用 OpenAPI examples/schema 或 tests/fixtures 生成 mock 响应，覆盖页面成功、空状态、错误状态和表单分支。
5. mock 不证明租约、重试、幂等、quota、HMAC、跨租户隔离、one-time token 或状态机时序；这些必须通过模块 live smoke 或服务端 blackbox 验证。
6. 切换 mock/真实服务时只改 service connection/baseUrl/secret refs，不改页面和 action 代码。
```

CRUD 模块提示词：

```text
给 <module-id> 增加一个 Data v2 CRUD 能力：
1. 在 module.ts 声明 table、API route、action 和 Data permissions。
2. API handler 使用 defineApi。
3. action handler 使用 action。
4. 页面 loader 使用 ctx.data，不导入宿主内部。
5. 运行 data:generate、data:types、module:doctor、module:test。
```

白牌 / 替换式模块提示词：

```text
给 <module-id> 增加一个白牌或页面替换能力：
1. 在 module.ts 声明 presentation.whiteLabel、presentation.replaces、themeScope 和 locale 资源。
2. 用 resources.locales 和 navigation.labelKey 承载可见文案。
3. 页面 presentation loader 返回 shell、SEO、cache、i18n 和 theme 元数据。
4. 运行 presentation:check、i18n:check、theme:check、seo:check 和 white-label:smoke。
```

后台模块提示词：

```text
给模块增加一个 job：
1. 在 module.ts 的 jobs 中声明 handler、timeoutMs、retries。
2. handler 导出 async function(ctx, input, run)。
3. 需要产出报告时用 ctx.artifacts.write。
4. 需要通知用户时用 ctx.notifications.send。
5. 添加 ArtifactsWrite / NotificationsSend / JobsRegister 权限。
```

## 禁止事项

- 不要让 AI 修改宿主 runtime 来绕过模块诊断。
- 不要让模块导入 `src/lib/*`。
- 不要让模块直接读 `process.env`。
- 不要让模块直接用 `fetch()`、`pg`、`fs`、`child_process`。
- 不要让模块为了 privileged external service 直接用 `ctx.http.fetch` 访问受控 origin。
- 不要让模块自己拼 bearer token、cookie、HMAC 或签名 header。
- 不要让模块把 secret、token、webhook signature 写进日志、artifact 或 notification。
- 不要让 AI 用手写 Markdown 接口文档替代 OpenAPI 等机器契约，也不要让 mock 成为状态机、租约、幂等、quota 或 HMAC 的最终证明。
- 不要让商业模块自建权威 credits、entitlements、paid/refunded orders、redeem redemptions、API key hash、subscription 状态；这些事实必须来自宿主商业原语。
- 不要把 AI 模型价格表、渠道佣金、优惠玩法写进宿主 schema；这些属于模块配置和报表。
- 不要把 payment webhook 直接落到模块订单表并自行发权益；必须映射后调用 `ctx.commerce.applyCheckoutPaid/applyRefund`。
- 不要把模块路由硬写进 `scripts/host-browser-matrix.mjs` 或 `scripts/host-accessibility-smoke.mjs`。
- 不要在 `apps/host-next/*`、`src/lib/module-runtime/*` 或宿主质量脚本里出现具体模块 id 字面量；宿主只能通过 module map、catalog、manifest、registry 或 contribution seam 发现模块。
- 不要给 `src/lib/module-runtime/release/rc-gate.ts` 或 `scripts/release-candidate-gate.ts` 增加模块专属必过检查。
- 不要新增模块专属 `host:*` 或 `module:<具体模块>-*` package script；外部端到端验收脚本放在模块目录内，先记录在模块 README 中，说明前置条件、命令和证据路径，并优先通过 `npm run module:evidence -- --module <id> --file ./scripts/e2e.ts --runner tsx -- ...` 运行。

## 验证清单

```bash
npm run module:doctor -- <module-id>
npm run module:test -- <module-id>
npm run modules:scan
npm run modules:check
npm run host:boundary-check
npm run typecheck
```

服务端分离型模块在合并前还应补充：

```bash
# 模块本地 consumer contract / fixture mock 测试，具体命令由模块维护。
npm run module:service-contract -- modules/<module-id> --openapi <openapi.yaml> --write-fixtures
npm run module:test -- <module-id>

# 真实服务 smoke，脚本放在模块目录内。
npm run module:evidence -- --module <module-id> --file ./scripts/live-smoke.ts --runner tsx -- --required
```
