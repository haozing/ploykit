# AI 辅助模块开发

AI 可以写 PloyKit 模块，但必须让它在本地模块边界里工作：只改 `modules/<id>/`，从 `module.ts` 开始理解契约，按 doctor 诊断循环修复。

如果任务只是模块接入，默认写权限只开放 `modules/<module-id>/`、模块本地生成文件和测试，以及 module-map 生成文件；不要修改 `apps/host-next/*`、`src/lib/module-runtime/*`、`src/module-sdk/*`、`scripts/host-*`。确实缺少宿主扩展点时，不要用 `moduleId === '<id>'`、`import modules/<id>` 或把模块路由塞进宿主脚本来完成需求；先报告需要通用 registry/contribution seam，再做宿主级抽象。

## 推荐提示词

```text
你正在开发 PloyKit 本地模块。只修改 modules/<module-id>/。
先阅读 module.ts，确认 routes/actions/jobs/events/webhooks/data/permissions。
默认只修改 modules/<module-id>/；除 module-map 生成文件外，不把模块验收改成宿主全局门禁。
不要修改 apps/host-next/*、src/lib/module-runtime/*、src/module-sdk/*、scripts/host-*，除非用户明确要求宿主扩展点；缺扩展点时先提出通用 registry/contribution seam，不要在宿主写 moduleId 特判或 import 具体模块。
模块代码只能导入 @ploykit/module-sdk，不能导入 src/lib/*，不能读 process.env，不能直接访问数据库。
使用 ctx.data/ctx.files/ctx.artifacts/ctx.notifications/ctx.runs/ctx.jobs/ctx.events/ctx.webhooks/ctx.ai/ctx.rag/ctx.http/ctx.services/ctx.billing/ctx.commerce/ctx.metering/ctx.credits/ctx.entitlements/ctx.redeemCodes/ctx.risk/ctx.apiKeys/ctx.rateLimit/ctx.resourceBindings/ctx.cache 等能力时，同步更新 module.ts permissions。
商业模块可以用 Data v2 存产品配置、套餐草稿、计量规则、渠道配置、支付映射和报表缓存；不要用 Data v2 自建权威余额、权益、订单支付状态、退款状态、兑换状态、API key hash 或订阅状态，必须走宿主 ctx.* 商业原语。
AI 用量计费不要只写 ctx.usage；模块应把 token、图片、文件页数或任务时长换算成 credits，然后调用 ctx.metering.charge。需要长任务预扣时先调用 ctx.credits.reserve，成功后由 charge commit reservation，失败后 releaseReservation。
外部工具接入模块 API 时声明 auth: 'apiKey' 或 auth: 'user-or-apiKey'，不要在模块里保存或验证 server-to-server key。
普通外部 HTTP 走 ctx.http.fetch；需要 service secret、runtime signing、动态 claims 或强审计的受控服务只声明 serviceRequirements/resourceBindings，并调用 ctx.services.invoke，不要自己读 secret 或实现 HMAC。
完成后运行 npm run module:doctor -- modules/<module-id>，按第一个 error 修复并重跑。
```

CRUD 模块提示词：

```text
给 modules/<module-id> 增加一个 Data v2 CRUD 能力：
1. 在 module.ts 声明 table、API route、action 和 Data permissions。
2. API handler 使用 defineApi。
3. action handler 使用 action。
4. 页面 loader 使用 ctx.data，不导入宿主内部。
5. 运行 data:generate、data:types、module:doctor、module:test。
```

白牌 / 替换式模块提示词：

```text
给 modules/<module-id> 增加一个白牌或页面替换能力：
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
- 不要让商业模块自建权威 credits、entitlements、paid/refunded orders、redeem redemptions、API key hash、subscription 状态；这些事实必须来自宿主商业原语。
- 不要把 AI 模型价格表、渠道佣金、优惠玩法写进宿主 schema；这些属于模块配置和报表。
- 不要把 payment webhook 直接落到模块订单表并自行发权益；必须映射后调用 `ctx.commerce.applyCheckoutPaid/applyRefund`。
- 不要把模块路由硬写进 `scripts/host-browser-matrix.mjs` 或 `scripts/host-accessibility-smoke.mjs`。
- 不要在 `apps/host-next/*`、`src/lib/module-runtime/*` 或宿主质量脚本里出现具体模块 id 字面量；宿主只能通过 module map、catalog、manifest、registry 或 contribution seam 发现模块。
- 不要给 `src/lib/module-runtime/release/rc-gate.ts` 或 `scripts/release-candidate-gate.ts` 增加模块专属必过检查。
- 不要新增模块专属 `host:*` 或 `module:<具体模块>-*` package script；外部端到端验收脚本放在模块目录内，先记录在模块 README 中，说明前置条件、命令和证据路径，并优先通过 `npm run module:evidence -- --module <id> --file ./scripts/e2e.ts --runner tsx -- ...` 运行。

## 验证清单

```bash
npm run module:doctor -- modules/<module-id>
npm run module:test -- modules/<module-id>
npm run modules:scan
npm run modules:check
npm run host:boundary-check
npm run typecheck
```
