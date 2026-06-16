# PloyKit 全量代码分析报告

分析日期：2026-06-14
分析对象：当前工作区 `D:\code\ploykit`
分析依据：[生产级架构与代码治理分析手册](production-grade-analysis-playbook.zh-CN.md)

本文是按治理手册方法执行的一次当前代码全量分析。它和历史审计报告不同：本文以当前工作树、当前命令输出和当前源码为准，目标是给出下一阶段把 PloyKit 推向商业级生产框架的真实改造路线。

## 1. 结论摘要

PloyKit 当前已经具备较完整的生产级框架骨架：模块 SDK、模块契约、生成式 module map、Next.js 宿主、运行时能力注入、权限守卫、数据运行时、商业账本、文件、AI/RAG、任务、Webhook、Admin/Dashboard、文档和发布门禁都已成体系。项目不是松散 demo，而是一个可以继续产品化的模块优先框架。

当前最需要优先处理的不是“再堆功能”，而是把生产级闭环继续做实：

- 基础类型检查、模块边界、契约、安全、商业账本、SEO、i18n 多项验证通过。
- 本次分析发现 module map 生成物漂移，已通过 `npm run modules:scan` 更新，并复跑 `npm run modules:check` 通过。
- 本轮已补齐 module map drift 失败摘要：`modules:check` 失败时会列出 drift 模块 ID、`sourceHash`/`contractDigest` 旧新摘要和修复命令，并由 `test:module-map` 覆盖。
- 本轮已修复 `test:web-shell` 中认证事务邮件测试的前置身份状态问题，并复跑 `npm run test:web-shell` 通过，75 个子测试全部通过。
- 本轮已执行 `npm run format` 并复跑 `npm run format:check` 通过，format gate 已恢复绿色。
- Postgres 持久化证据洞本轮已补齐：使用隔离临时 Docker Postgres（`127.0.0.1:55433`）串行执行 `runtime:stores:verify`、`test:runtime-stores`、`test:commercial-postgres`、`host:postgres-local-smoke -- --no-docker`，29 个 runtime migration 全部应用，runtime store 9/9、commercial Postgres 1/1、host Postgres smoke 全部通过。后续仍建议把 runtime store 领域拆分、新 baseline、backup/restore 和 upgrade migration smoke 作为 Phase 1 深水区继续推进。
- 完整 RC 证据链本轮已打通：修复 `release:evidence --required` 的本地 production host 生命周期、Data v2 生成物漂移、dashboard catch-all presentation manifest 漏登和 Web Shell evidence 的生产环境变量污染后，使用干净临时 Postgres + production standalone 跑通 `npm run release:evidence -- --required --base-url http://localhost:3000`，25 个步骤全部通过，无 blockers，证据写入 `.runtime/rc-evidence/2026-06-14T11-43-16-668Z/`；后续已把 `dashboard-transition-smoke` 作为独立 maintainer gate 接入，发布门禁会严格读取本地 `--required --repeat 3 --inject-anchor` evidence。
- 本轮已继续消除生产构建的 Turbopack NFT tracing warning：清理 runtime barrel 边界，把 `module-map-health`/release gate 从请求链路总出口中拆出；模块 locale message 改为 `modules:scan` 阶段嵌入 generated module map，运行期 i18n 不再读磁盘；Admin entitlement/dead-letter/settings/files/audit/commercial view/runs detail/actions/module operations/dev-console view 改用领域 helper，避免静态引入 `admin-operations.ts` 大聚合文件；`admin-operations.ts` 已降为 39 行兼容壳，页面、API、测试和 smoke 脚本运行期调用改为直接从 `admin-module-operations.ts`、`admin-module-dev-console.ts`、`admin-delivery.ts`、`admin-settings.ts`、`admin-files.ts`、`admin-audit.ts`、`admin-commercial.ts` 与 `admin-runs.ts` 进入。使用隔离临时 Postgres 复跑 `runtime:stores:verify` + `host:build`，构建无 `unexpected file in NFT list` warning。
- 大文件和大型页面仍是主要维护性压力，多个核心文件超过 2000 行；本轮已继续拆分 dashboard notifications、dashboard landing/profile/workspaces、dashboard tasks/files、dashboard billing/orders/credits、admin webhooks/runs operations、admin data usage/analytics/files 和 admin commerce billing/revenue/entitlements 页面，将通知、landing/profile/workspaces、任务、文件、billing/orders/credit history、webhook/outbox detail、runs list/detail、usage/analytics、file storage/detail 与 billing/revenue/entitlements 实现迁出到独立文件，DashboardPages.tsx、OperationsPages.tsx、DataPages.tsx 与 CommercePages.tsx 再瘦一截。
- 线上实测发现 Dashboard 宿主层存在明确性能与稳定性问题：登录后 `/dashboard/origin-agentops/*` 路由切换稳定在约 3.9-5.8 秒，原始观察出现 React hydration error #418，本轮复测未复现 hydration error 但仍出现完整 document navigation；宿主 catch-all dashboard 路由强制动态渲染、metadata 与页面主体重复解析模块页、页面 shell 串行拉取多类宿主上下文，是需要优先治理的 host 问题。本轮已先完成 metadata-only 解析、catalog seed 去重复查询、`/brand/*` 长缓存、dashboard transition smoke、shell 数据并行化第一步、dashboard 结构化 timing span、AppFrame 内普通锚点 client transition 兜底、`shell.chrome='none'` 全屏模块外层 client-transition frame、dashboard 壳层跨请求短缓存、线上 origin-agentops smoke 复测、本地 repeat soak 和 release gate 接入；本地 `--inject-anchor --repeat 3` 已证明宿主可在普通 Dashboard 页和 Origin AgentOps 全屏模块页中接管模块输出的普通 `<a>`，最新 Origin AgentOps 本地 evidence 8 次 transition 均无 document navigation/hydration error，P95 198ms，`release:maintainer-gate` 已把该证据列为必需检查并通过。2026-06-16 线上再次对 `origin-agentops` 执行 required repeat 复测和 `--inject-anchor` 对照仍失败，transition document navigation 未清零，增强诊断显示线上页面未暴露当前 `data-host-app-frame` / `data-host-client-transition-links` 标记；该项仓库侧修复已完成，线上生产证据归为部署后的外部复测，不再纳入本轮仓库内继续修复。`Server-Timing` 响应头映射、线上 hydration 长周期观察和线上 document navigation 退化验证进入后续维护/上线验证 backlog。模块自身的 `origin-agentops` API/loader/内部导航慢点单独记录在 [Origin AgentOps 模块性能分析](origin-agentops-module-performance-analysis-2026-06-14.zh-CN.md)。
- 如果下一阶段选择“不兼容旧数据、旧测试夹具和旧内部结构”的干净重构路线，可以更彻底地重置 Postgres schema、拆分 runtime store、重写 dashboard shell 数据流和模块 metadata 解析链；但必须保留安全、权限、租户隔离、账本幂等、认证防枚举和发布证据这些产品级不变量。

综合判断：项目当前处于“生产化框架核心基本成型，且本地 RC 发布证据已闭环”的阶段。若要进入商业级生产可用，当前优先级已经从 Web Shell/format/Postgres/RC evidence 基础缺口，转向 Dashboard 线上真实浏览器性能稳定性、真实外部 provider 验证、Postgres 新 baseline/物理备份恢复策略和大文件持续拆分。

### 1.1 剩余工作收口口径（2026-06-16 更新）

本轮重新盘点后，后续不应再把“看到长文件就继续拆”当作主线。当前报告按“仓库内可验证修复”和“外部/长期 backlog”收口：

| 类型               | 本轮状态 | 收口口径                                                                                                                                                                                                                    |
| ------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 仓库内生产闭环修复 | 已完成   | release gate 规则收紧并验证通过；Postgres baseline/PITR 策略 runbook、真实 provider smoke runbook 已落地；Dashboard 普通锚点兜底和 `shell.chrome='none'` 全屏模块 client-transition frame 已用本地 Origin evidence 验证通过 |
| 外部/部署环境证据  | 不继续追 | 线上 Dashboard 复测、真实 provider 凭据执行、目标环境 PITR 演练、远端对象存储/向量库验证都需要部署环境或外部账号，不作为本轮仓库内继续修复项                                                                                |
| 维护性 backlog     | 不继续拆 | Top 25 长文件继续瘦身、capability guard 四件套矩阵补强、测试/发布 profile 分层清理、`Server-Timing` 响应头映射和 hydration 长周期观察都转为后续单独任务                                                                     |

本轮停止线：到 2026-06-16 当前仓库内可通过本地命令和本地浏览器 evidence 验证的修复已经完成；不再继续扩大到线上部署、外部账号执行、长期观测或大范围重构。代码拆分只有在后续被单独点名、且能降低明确生产风险时再做。

已完成（2026-06-16 本轮实施）：新增本收口口径，明确大文件拆分不再作为唯一主线；初始盘点把剩余工作拆成 4 类生产闭环和 3 类维护性长尾，并在本轮继续逐项扣减，避免后续“完成一项标注一项”退化成无终点的重构。

已完成（2026-06-16 本轮实施）：当前改动后的 release gate 规则已收紧并复跑验证；`npm run test:release-candidate` 51/51 通过，覆盖 RC gate 主测试、browser/module quality 与 runtime evidence 严格读取。本轮先验证旧 latest Dashboard 失败证据会使 `npm run release:maintainer-gate` 按预期阻断发布，失败信息明确包含 `appFramePresent=true`、`clientTransitionMarkerPresent=true`、`injectedAnchorInAppFrame=true` 与 `shell:app-frame`、`shell:client-transition-marker`、`shell:injected-anchor-frame` 缺失/失败；随后使用当前 standalone 重新生成本地强 Dashboard transition evidence：`npm run host:dashboard-transition-smoke -- --required --base-url http://localhost:3000 --routes /zh/dashboard,/zh/dashboard/workspaces,/zh/dashboard/files --repeat 3 --inject-anchor --max-p95-ms 5000` 通过，证据目录 `.runtime/dashboard-transition-smoke/2026-06-16T08-30-20-238Z`，8/8 transition、2 次 reset transition、transition document navigation=0、hydrationErrors=0、P95 183ms，`appFramePresent=true`、`clientTransitionMarkerPresent=true`、`injectedAnchorInAppFrame=true`；三张关键截图已抽检为正常 Dashboard 页面。基于该 latest evidence，`npm run release:maintainer-gate` 已恢复通过，`host-boundary-check` 扫描 770 个文件/7 个模块通过，maintainer profile 扫描 919 个文件且 diagnostics 为空，`dashboard-transition-smoke` 为 passed。

已完成（2026-06-16 本轮实施）：新增 [Postgres Baseline 与 PITR 运维手册](postgres-baseline-pitr-runbook.zh-CN.md)，明确 runtime/Data v2 baseline、旧库不兼容边界、本地 `pg_dump`/`pg_restore` gate、目标环境托管快照/WAL/PITR 演练步骤、RPO/RTO 建议和对象存储/secrets/provider 外部资产恢复边界；`operations.zh-CN.md`、`runtime-stores.zh-CN.md` 与文档索引已链接该 runbook。Postgres baseline/PITR 策略从生产闭环剩余项中扣除，剩余生产闭环收敛为 2 类：线上 Dashboard 复测、真实 provider smoke；真实目标环境 PITR 演练仍作为部署环境证据归档，不再视作代码仓库内待改项。

已完成（2026-06-16 本轮实施）：新增 [真实 Provider Smoke 运维手册](real-provider-smoke-runbook.zh-CN.md)，明确真实 S3、Stripe、Email webhook、AI webhook/API 与 RAG provider 的隔离测试账号前提、必需环境变量、单项 smoke 命令、`PLOYKIT_PROVIDER_MATRIX_EXTERNAL=1 npm run host:provider-matrix -- --required` 完整矩阵、验收口径、失败处理和证据归档；`operations.zh-CN.md`、`release-candidate-checklist.zh-CN.md` 与文档索引已链接该 runbook。真实 provider smoke 的仓库内执行策略从生产闭环剩余项中扣除，剩余生产闭环收敛为 1 类：线上 Dashboard 复测；真实凭据环境执行仍作为外部部署证据归档。

复测未通过（2026-06-16 本轮实施）：线上 Dashboard `origin-agentops` route transition 已再次真实登录复测，但不能标注完成。`npm run host:dashboard-transition-smoke -- --required --base-url https://aijia.yingasi.com --routes /dashboard/origin-agentops/agents,/dashboard/origin-agentops/skills,/dashboard/origin-agentops/tools --repeat 3 --max-p95-ms 1000` 失败：8/8 次 transition 均产生完整 document navigation，P50 2666ms、P95 2968ms、hydrationErrors=0，证据目录 `.runtime/dashboard-transition-smoke/2026-06-16T07-00-09-417Z`。`--inject-anchor --repeat 3` 对照同样失败：8/8 次 transition 均产生完整 document navigation，P95 3737ms，证据目录 `.runtime/dashboard-transition-smoke/2026-06-16T07-02-56-693Z`。本轮同时增强 `host:dashboard-transition-smoke`，报告会记录 `appFramePresent`、`clientTransitionMarkerPresent` 与注入锚点归属；增强后线上短复测显示 `appFramePresent=false`、`clientTransitionMarkerPresent=false`，证据目录 `.runtime/dashboard-transition-smoke/2026-06-16T07-08-41-933Z`。后续脚本和 RC gate 已把这些诊断升级为硬检查：`shell:app-frame`、`shell:client-transition-marker` 和 `shell:injected-anchor-frame` 必须通过；并新增 `--no-latest`，线上复测可归档时间戳目录而不覆盖本地 RC gate 的 latest evidence。本轮使用 `--no-latest` 再次复测线上：`npm run host:dashboard-transition-smoke -- --required --base-url https://aijia.yingasi.com --routes /dashboard/origin-agentops/agents,/dashboard/origin-agentops/skills,/dashboard/origin-agentops/tools --repeat 3 --inject-anchor --max-p95-ms 1000 --no-latest` 失败，证据目录 `.runtime/dashboard-transition-smoke/2026-06-16T08-37-06-949Z`，8/8 次 transition 均产生完整 document navigation，P50 3110ms、P95 4887ms、hydrationErrors=0，`appFramePresent=false`、`clientTransitionMarkerPresent=false`、`injectedAnchorInAppFrame=false`。截图已抽检，页面是已登录后的 Origin Dashboard，不是登录页、错误页或空白页。结论：最后 1 类生产闭环的线上证据已复测但仍未通过；本轮仓库侧已修复 `shell.chrome='none'` 全屏模块缺少 host client-transition frame 的问题，下一步应部署当前宿主产物后再跑 required repeat smoke。

已确认可线下测试并完成仓库侧修复（2026-06-16 本轮实施）：将线上模块包 `modules/origin-agentops.zip` 解压安装为 `modules/origin-agentops` 后，`npm run modules:scan` 更新 module map，`npm run module:doctor -- modules\origin-agentops` 0 error/0 warning，`npm run module:test -- modules\origin-agentops --summary` 通过，fake-host smoke 12/12，通过报告 `.runtime/module-test-reports/origin-agentops.json`；`npm run modules:check` 通过，当前 host boundary 扫描 770 个文件/8 个模块。带本地 memory runtime env 的 `npm run host:build` 通过并生成 standalone。修复前页面级本地 smoke 已能登录并打开 `/zh/dashboard/origin-agentops/{agents,skills,tools}` 与 `/dashboard/origin-agentops/{agents,skills,tools}`，截图为正常 Origin Dashboard 页面，但 strict transition 失败，证据目录 `.runtime/dashboard-transition-smoke/2026-06-16T10-05-37-426Z` 与 `.runtime/dashboard-transition-smoke/2026-06-16T10-14-05-695Z` 均显示 8/8 transition 产生 document navigation、`appFramePresent=false`。随后在 `shell.chrome='none'` 全屏模块分支外层增加 host client-transition frame，保留模块自带 UI，不渲染宿主侧栏；复跑 `/dashboard/origin-agentops/{agents,skills,tools}` 与 `/zh/dashboard/origin-agentops/{agents,skills,tools}` strict smoke 均通过，其中 latest 证据目录 `.runtime/dashboard-transition-smoke/2026-06-16T10-35-10-955Z` 显示 8/8 transition、2 次 reset transition、transitionDocumentNavigations=0、hydrationErrors=0、P95 198ms，`appFramePresent=true`、`clientTransitionMarkerPresent=true`、`injectedAnchorInAppFrame=true`。基于该 latest evidence，`npm run release:maintainer-gate` 通过，`dashboard-transition-smoke` 检查为 passed。

## 2. 当前事实地图

### 2.1 仓库规模

当前通过 `rg --files` 统计到 863 个文件。

主要结构：

| 区域                          | 当前事实                                                               | 生产级意义                                   |
| ----------------------------- | ---------------------------------------------------------------------- | -------------------------------------------- |
| `apps/host-next`              | Next.js 宿主，包含公开站点、Dashboard、Admin、Auth、API route、共享 UI | 用户入口与运营入口，稳定性要求最高           |
| `src/module-sdk`              | 模块作者 SDK、类型、权限、validator、testing helper                    | 模块生态公共边界                             |
| `src/lib/module-runtime`      | module map 加载、路由、上下文、security、store、release gate           | 框架内核                                     |
| `src/lib/module-capabilities` | AI/RAG、商业、文件、任务、事件、Webhook、HTTP、服务调用等能力          | 高风险能力集中区                             |
| `modules`                     | 默认 7 个模块                                                          | 框架能力样板和 smoke 载体                    |
| `templates/modules`           | 11 个模块模板                                                          | 新模块生成入口                               |
| `scripts`                     | 120 个 package script 背后的 CLI/gate/smoke                            | 发布和开发者体验基础                         |
| `tests`                       | 根目录 35 个 `.test.ts`                                                | 运行时、契约、安全、商业、Web Shell 回归证据 |
| `migrations/runtime`          | runtime migration 到 `0029_risk_events.sql`                            | 持久化 store 演进证据                        |
| `.github/workflows`           | 存在 `ci.yml`                                                          | 默认 CI 入口                                 |

### 2.2 默认模块

当前 module map 和 `modules/` 中默认模块一致，共 7 个：

- `ai-rag-demo`
- `capability-demo`
- `cms-demo`
- `hello`
- `public-tools-demo`
- `shop-demo`
- `white-label-site-demo`

本次分析前，`npm run modules:check` 失败，提示 `Module map check failed. Fix: run npm run modules:scan`。执行 `npm run modules:scan` 后，`src/lib/module-map.ts` 和 `src/lib/module-map.manifest.json` 更新了 7 个模块的 `sourceHash` 与 `contractDigest`，再执行 `npm run modules:check` 已通过。

结论：

- 默认模块源仍然干净，未发现 module map 指向仓库外模块。
- 生成物 drift 曾经存在，已在本次分析中修复。
- 后续应把 `modules:check` 作为提交前硬门禁，避免 tracked module map 再次漂移。

### 2.3 模板

当前 `templates/modules` 有 11 个模板：

- `ai-rag`
- `basic`
- `billing-aware`
- `connector`
- `crud`
- `dashboard`
- `job`
- `product`
- `product-app`
- `signed-service`
- `white-label`

模板覆盖面较好，已经覆盖公开工具、CRUD、Dashboard、Job、商业感知、AI/RAG、签名服务、白标产品等路径。本轮已把模板检查从“目录存在”推进到“生成后可验证”：`tests/developer-experience.test.ts` 会读取 `templates/modules/*` 全部 11 个目录，确认每个模板都有 smoke test、CLI `templates` 输出与磁盘目录一致，并逐个复制生成临时模块后跑 `module:doctor` 与 `module:test --summary`。本轮继续补强 extension 矩阵：`product --with service-backed`、`product --with background` 与组合 extension 都走真实 `module:create`、doctor 和 fake-host smoke；同时修复 service-backed nested service egress 被普通 HTTP egress 误判、service operation `tenantId` allowlist 漂移、background job key camelCase 漂移，以及 extension 注入片段未渲染 `__MODULE_ID__` 的问题。

### 2.4 脚本门禁

`package.json` 当前有 120 个 scripts，按名称粗分：

| 分类           | 数量 | 说明                                                                     |
| -------------- | ---: | ------------------------------------------------------------------------ |
| module/modules |   14 | 模块创建、扫描、doctor、test、quality、bundle、service contract          |
| data           |    8 | 模块数据 plan/generate/migrate/verify/diff/types/reset                   |
| runtime        |    4 | runtime store、runtime check、boundary check                             |
| release        |    5 | local/integration/maintainer/rc/evidence                                 |
| host           |   32 | host dev/build/smoke/provider/browser/accessibility/worker/files/billing |
| test           |   37 | 根级专项测试                                                             |
| admin          |    3 | Admin UI/mobile/visual gate                                              |

这说明项目已经具备生产级门禁雏形。当前问题是门禁数量多，执行 profile 需要更清晰地分层：日常、合并前、RC、真实 provider、真实浏览器、真实 Postgres。

## 3. 当前验证结果

本次分析中执行过的代表性命令如下。

### 3.1 已通过

```bash
npm ci
npm run typecheck
npm run modules:scan
npm run modules:check
npm run test:module-map
npm run test:developer-experience
npm run catalog:doctor
npm run docs:encoding-check
npm run test:module-contract
npm run test:security-runtime
npm run test:host-runtime
npm run test:runtime-stores
npm run test:commercial-postgres
npm run host:postgres-local-smoke
npm run test:commercial-ledger
npm run test:production-runtime
npm run test:ui-runtime
npm run test:host-page-runtime
npm run test:release-candidate
npm run host:build
npm run module:doctor -- all
npm run module:test -- all
npm run seo:check
npm run i18n:check
npm run release:evidence -- --required --base-url http://localhost:3000
npm audit --omit=dev --registry=https://registry.npmjs.org
```

关键通过证据：

- `typecheck` 通过。
- `modules:check` 在重新 scan 后通过，module doctor 7 个模块 diagnostics 为 0。
- `test:module-map` 本轮复跑 10/10 通过，覆盖外部 module source 拒绝、manifest 元数据洁净、drift 摘要输出、`module:test --summary` 短输出/详细报告落盘，以及 `module:test --help` 对输出模式、报告路径和退出码策略的说明。
- `test:developer-experience` 本轮复跑 11/11 通过，覆盖 11 个磁盘模板目录全部具备 `module.ts`、README 和 smoke test，CLI `templates` 输出与磁盘目录一致，`ploykit-module --help` / `create --help` 动态列出同一份模板/扩展集合，逐个生成模板模块后执行 `module:doctor` 与 `module:test --summary`，并新增 `service-backed`、`background` 与组合 extension 的真实 `module:create` + fake-host smoke 矩阵。
- `catalog:doctor` 返回 `success: true` 且 diagnostics 为空。
- `docs:encoding-check` 本轮复跑返回 `ok: true`，检查 492 个文件。
- `test:security-runtime` 本轮复跑 22 个子测试通过，脚本同时覆盖 `tests/security-runtime.test.ts`、`tests/security-runtime-services.test.ts`、`tests/security-runtime-capability-guard.test.ts` 与 `tests/security-runtime-data-commercial-guard.test.ts`，覆盖权限守卫、服务调用、resource binding、credits/entitlements/risk、notification、SQL raw、事务内 guard 等；本轮已将安全运行时共用 module artifact/loader 计数 fixture 抽到 `tests/security-runtime-fixtures.ts`，将 `services.invoke` 场景迁入独立测试文件，并进一步将 runtime capability guard 场景拆成基础能力守卫与 data/commercial/risk 专项测试文件，降低主测试文件的共享状态噪音。
- `test:host-runtime` 本轮复跑 21 个子测试通过，覆盖 API/action/page/anonymousPolicy/API key、metadata-only 不执行 page loader 的运行时约束，以及 dashboard route-level `generateMetadata` 只调用 metadata-only 路径的宿主入口约束。
- `test:module-contract` 19 个子测试通过，脚本同时覆盖 `tests/module-contract.test.ts` 与 `tests/module-contract-presentation.test.ts`，覆盖 public API anonymous policy、service policy、SEO/cache、alias、theme、white-label presentation、i18n 和 surface metadata 等契约。
- `test:commercial-ledger` 10 个子测试通过，脚本同时覆盖 `tests/commercial-ledger.test.ts` 与 `tests/commercial-ledger-primitives.test.ts`，覆盖 usage、metering、credits、orders、refund、subscription、workspace idempotency，以及 subject-first primitives / reservation / redeem / risk 生命周期。
- `runtime:stores:verify` 本轮在隔离临时 Postgres 上通过，30 个 runtime migration 全部应用，schema verification 无 missing/column/index/migration issue；`indexAudit.required=52`、`present=52`，webhooks 领域索引 2/2。
- `test:runtime-stores` 脚本本轮已覆盖 `tests/runtime-stores.test.ts`、`tests/runtime-stores-postgres.test.ts` 与 `tests/runtime-stores-postgres-scope.test.ts`；默认本地复跑 12 个子测试中 10 pass，2 个 Postgres 子项因本地数据库未启动按既有逻辑 skip，继续覆盖 webhook receipt workspace-scoped idempotency 回归、Postgres 持久化/schema/index 审计和 null workspace 精确过滤语义。
- `test:commercial-postgres` 本轮在隔离临时 Postgres 上通过，1 个子测试覆盖 credits、orders、entitlements、provider idempotency、subscription events、tax profile、revenue bucket 等商业持久化路径。
- `host:postgres-local-smoke -- --no-docker` 本轮在同一隔离临时 Postgres 上通过，生成 `.runtime/runtime-store-postgres/2026-06-14T09-57-16-250Z/postgres-local-smoke.json` 与 `.runtime/runtime-store-postgres/latest.json`；报告内数据库 URL 已脱敏。
- `test:production-runtime` 本轮复跑 16 个子测试通过，覆盖生产配置、OIDC reserved、redaction、HTTP egress 防护、商业 runtime、`/brand/*` 静态缓存策略、dashboard timing report schema、dashboard 壳层短缓存和 AppFrame 普通锚点 client transition 兜底。
- `test:ui-runtime` 本轮复跑 7 个子测试通过，新增覆盖模块翻译从 generated module map 的 `messages` 读取，不依赖运行期文件系统。
- `test:host-page-runtime` 本轮复跑 21 个子测试通过，脚本同时覆盖 `tests/host-page-runtime.test.ts`、`tests/host-page-presentation.test.ts` 与 `tests/host-page-surfaces.test.ts`，覆盖 host page override/composition/rendering、product composition/theme、route presentation manifest、admin/auth page 访问边界，以及 host page slot/admin header surface composition。
- `test:web-shell` 本轮复跑 75 个子测试全部通过；其中 X9 auth transactional route 已迁入独立 `tests/web-shell-auth.test.ts`，X2 user/scope/notification/billing/admin API route 子项已迁入 `tests/web-shell-api-routes.test.ts`，email provider/retry/outbox worker 子项已迁入 `tests/web-shell-email.test.ts`，contact route security、module webhook security、route catalog/security 与 config doctor 子项已迁入 `tests/web-shell-security.test.ts`，admin provider/worker status evidence 子项已迁入 `tests/web-shell-operations-status.test.ts`，host runtime-store config 子项已迁入 `tests/web-shell-runtime-store.test.ts`，Stripe webhook/checkout/portal client 子项已迁入 `tests/web-shell-stripe.test.ts`，file runtime/storage/quota 子项已迁入 `tests/web-shell-files.test.ts`，worker/runs 子项已迁入 `tests/web-shell-workers.test.ts`，host settings source metadata 子项已迁入 `tests/web-shell-settings.test.ts`，routing/navigation/health 子项已迁入 `tests/web-shell-routing.test.ts`，identity/auth adapter 子项已迁入 `tests/web-shell-identity.test.ts`，module host/runtime integration 子项已迁入 `tests/web-shell-module-host.test.ts`，admin dead-letter route 子项已迁入 `tests/web-shell-dead-letter.test.ts`，product/workspace scope 子项已迁入 `tests/web-shell-product-scope.test.ts`，admin identity/audit 子项已迁入 `tests/web-shell-admin-identity.test.ts`，admin service connection 子项已迁入 `tests/web-shell-service-connections.test.ts`，commercial/billing/entitlement 子项已迁入 `tests/web-shell-commercial.test.ts`，降低认证、API route、邮件、安全配置、运维状态、runtime-store 配置、Stripe client、文件能力、worker/runs、host settings 配置、路由导航、identity/auth、module host/runtime、admin dead-letter、product/workspace scope、admin identity/audit、admin service connection 与 commercial/billing/entitlement 链路对 Web Shell 大文件全局状态的耦合。
- `test:release-candidate` 本轮复跑 49 个子测试全部通过，脚本同时覆盖主 RC gate、browser/module quality 与 runtime evidence 专项测试；本轮已将 provider/store/worker/host/web shell/dashboard transition/product presentation/production adapters/delivery ledger evidence 读取迁入 `tests/release-candidate-runtime-evidence.test.ts`，并将临时项目、JSON 写入、provider invocation、worker soak 与 fixture module quality evidence helper 迁入 `tests/release-candidate-fixtures.ts`，降低 RC gate 主测试文件 fixture 与 evidence 分支噪音。
- `format:check` 本轮复跑通过。
- `module:test -- all --summary` 7 个模块 fake-host smoke 通过，stdout 为短摘要，详细报告继续写入 `.runtime/module-test-reports/all.json` 和各模块 JSON；`node scripts/module-test.mjs --help` 返回输出模式、报告路径和退出码策略说明。
- `seo:check`、`i18n:check` 均通过，i18n inline copy 为 0。
- `host:build` 本轮在隔离临时 Postgres + production env 下复跑通过，standalone host 生成成功，且没有 `Encountered unexpected file in NFT list` / Turbopack NFT tracing warning；删除 `admin-operations.ts` delivery/outbox、host settings 与 files 旧出口后再次复跑仍通过。
- `release:evidence -- --required --base-url http://localhost:3000` 本轮在干净临时 Postgres + production standalone 下通过，25 个步骤全部绿色，包含 `host:build`、`host:postgres-local-smoke -- --no-docker`、`data:migrate`、`presentation:check`、`white-label:smoke`、provider matrix、worker soak、chaos、Web Shell evidence、drift check、backup/restore、upgrade migration、host smoke、browser matrix、accessibility smoke 和 `release:maintainer-gate`。
- `npm audit --omit=dev --registry=https://registry.npmjs.org` 返回 0 vulnerabilities。

### 3.2 失败或不完整

#### Web Shell 回归原始失败已修复

```bash
npm run test:web-shell
```

原始结果：75 个子测试中 74 个通过，1 个失败。

原始失败子项：

```text
X9 auth transactional routes use the host email provider contract
```

全量运行时失败表现：

- 期望 password reset request 返回 `200`，实际返回 `400`。

单独运行该子测试时失败表现：

- 注册新用户后只捕获到 `Verify your PloyKit account`。
- 期望还捕获到 `Reset your PloyKit password`。

根因判断：

- 测试对 `admin@example.com` 发起 password reset。
- 当前默认身份种子默认关闭，`admin@example.com` 不一定存在。
- `requestPasswordReset` 对不存在用户采用防枚举语义返回 `{ sent: true }`，但不会产生真实 reset token，因此 route 不发送邮件。
- 因此该测试依赖了不明确的全局身份前置状态。它更像测试夹具/前置状态问题，但会阻断 Web Shell gate，仍应作为发布基线问题处理。

已实施：

- 该测试已改为对刚注册的随机 `email` 请求 reset，不再依赖 `admin@example.com` 的隐式全局存在。
- 已补不存在用户 password reset 不发邮件但仍返回 sent=true 的防枚举断言。
- 已复跑 `npm run test:web-shell`，75 个子测试全部通过。

#### Format gate 原始失败已修复

```bash
npm run format:check
```

原始结果：失败。Prettier 提示 4 个文件存在格式问题：

- `package.json`
- `tsconfig.json`
- `.prettierrc.json`
- `.github/workflows/ci.yml`

已实施：

```bash
npm run format
npm run format:check
```

本轮复跑 `npm run format:check` 已通过。

#### Postgres 子项原始未验证，已补齐

```bash
npm run test:runtime-stores
```

原始结果：整体命令通过，但 2 个 Postgres 子测试被跳过：

- `P13 Postgres runtime store persists runs, outbox, receipts, audit, usage and catalog state`
- `P13 Postgres runtime store keeps null workspace filters exact across platform domains`

跳过原因：

```text
Postgres is not reachable at postgres://ploykit:ploykit@127.0.0.1:55432/ploykit. Start it with npm run db:up.
```

结论：

- 原始结果只能证明 memory store，不能证明 Postgres store。
- 本轮已用隔离临时 Docker Postgres 重新补齐证据，显式使用 `DATABASE_URL=postgres://ploykit:...@127.0.0.1:55433/ploykit`，避免误连非本地数据库。
- 同名 `ploykit-v2-postgres` 历史容器来自另一个 compose project，未作为本轮证据库使用；本轮临时容器验证结束后已停止。
- 注意：Postgres runtime store 与 commercial Postgres 测试都会重置 runtime 表，不能并行打同一个数据库，否则会制造假失败。生产级 gate 应串行执行，或为每个测试分配独立临时库。

补齐验证：

```bash
$env:DATABASE_URL='postgres://ploykit:ploykit@127.0.0.1:55433/ploykit'
$env:PLOYKIT_RUNTIME_STORE='postgres'
npm run runtime:stores:verify
npm run test:runtime-stores
npm run test:commercial-postgres
npm run host:postgres-local-smoke -- --no-docker
```

补齐结果：

- `runtime:stores:verify` 通过：`expected: 29`、`applied: 29`，无 missing、columnIssues、indexIssues、migrationIssues。
- `test:runtime-stores` 通过：9/9，0 fail，0 skipped。
- `test:commercial-postgres` 通过：1/1。
- `host:postgres-local-smoke -- --no-docker` 通过，包含 `runtime-stores-verify`、`runtime-stores-tests`、`commercial-postgres-tests`、`runtime-check-postgres`、`runtime-stores-final-verify` 五项绿色。

## 4. 架构边界分析

### 4.1 Host 与 Module 边界

当前结构符合模块优先架构：

- 模块源集中在 `modules/<module-id>`。
- 默认配置 `ploykit.config.json` 指向 `modules`。
- `src/lib/module-map.ts` 由扫描脚本生成，宿主通过 runtime map 加载模块。
- `npm run modules:check` 包含 module map check、host boundary check、module check。

本次验证：

- `modules:check` 修复漂移后通过。
- module map 当前只包含 7 个默认模块。
- 搜索 `src/lib/module-map.ts`、`src/lib/module-map.manifest.json` 未发现 `../runlynk` 或外部 module source。

风险判断：

- 当前没有 P0 级外部模块污染。
- 但 module map drift 曾经存在，说明提交前生成物同步仍是容易漏掉的点。

改进方向：

- 把 `modules:scan` 生成物 drift 明确写入 PR checklist。
- CI 保持 `modules:check` 必跑。
- 已完成：`modules:check` 的 module map drift 报告现在会输出 `Drift summary`，直接列出 drift 模块、旧/新 `sourceHash` 或 `contractDigest` 摘要、生成物差异和修复命令。

### 4.2 SDK 与 Runtime 边界

当前 SDK 与 runtime 闭环较好：

- `src/module-sdk/types.ts` 定义 `anonymousPolicy`。
- `src/module-sdk/validator.ts` 要求 public API route 声明 `anonymousPolicy`，`src/module-sdk/validator-anonymous-policy.ts` 负责校验 `rateLimit`、upload、captcha 与匿名高成本策略细节。
- `src/lib/module-runtime/adapters/api-dispatcher.ts` 在 handler 加载前调用 `checkModuleAnonymousPolicy`。
- `tests/host-runtime.test.ts` 覆盖匿名 API route policy 在 handler 前执行。
- `tests/module-contract.test.ts` 覆盖 public API anonymous policy 细节。

高价值闭环：

- public API anonymous policy：类型、validator、runtime、测试均有证据。
- `UnsafeSqlRaw`：权限元数据、capability guard、security runtime 测试均有证据。
- service invocation：声明、签名、redaction、egress、operation policy 和测试都有证据。

仍需继续分析的点：

- `src/module-sdk/validator.ts` 已通过 Data v2 validator、anonymous policy validator、product/navigation validator、resources/i18n validator、actions validator、routes validator、surfaces validator、theme/presentation validator、background validator、runtime metadata/egress validator 拆分降到 237 行，已退出 Top 25，当前只保留主入口、基础字段校验和 contract parts 编排。
- `src/module-sdk/testing.ts` 已拆出 Data fake collection 和 commercial/monetization capability mock；`createTestingModuleContext` 对外入口保持不变，后续重点是防止通用 capability mock 继续膨胀为隐性规范。
- 已完成（2026-06-15 本轮实施）：`src/module-sdk/testing-data.ts` 承担 fake Data v2 document/table collection、unique/upsert、soft delete/restore 和 SQL ref helper；`src/module-sdk/testing-commercial.ts` 承担 testing host 的 metering、credits、billing、entitlements、commerce 与 redeem code mock；`src/module-sdk/testing.ts` 改为导入 `createTestingDataApi` 和 commercial testing helper。
- 完成证据：`src/module-sdk/testing.ts` 从 1377 行降到 820 行，新增 `src/module-sdk/testing-data.ts` 168 行和 `src/module-sdk/testing-commercial.ts` 364 行；`npm run typecheck`、`npm run test:developer-experience` 10/10、`npm run test:module-contract` 19/19、`npm run test:commercial-ledger` 10/10、`npm run module:test -- all --summary` 7/7、`npm run format:check` 均通过。
- 已完成（2026-06-16 本轮实施）：模板生成矩阵已覆盖全部 11 个基础模板和 `product` 模板的 `service-backed`、`background`、组合 extension 路径；extension 生成链路现在会验证真实 `module:create`、未残留 `__PLOYKIT_*` / `__MODULE_ID__` 占位符、`module:doctor` 与 `module:test --summary`。
- 完成证据：`tests/developer-experience.test.ts` 新增 extension 矩阵后 `npm run test:developer-experience` 11/11 通过；`npm run test:module-doctor` 14/14 通过，新增 “service egress separate from ordinary http egress” 回归；`npm run typecheck` 与串行 `npm run modules:check` 均通过。
- 已完成（2026-06-16 本轮实施）：新增 `src/module-sdk/validator-product.ts`，集中维护 module product/navigation contract validation，包括 navigation path/fallback label、product kind、required shell route/navigation、admin/site route navigation warning、product page audience/question/actions/sample path 与 route matching；新增 `src/module-sdk/validator-resources.ts`，集中维护 resources 与 strict i18n contract validation，包括 locale/asset local path、worker/WASM kind、asset maxBytes、default/required language locale resource、namespace 格式、strict navigation/action/surface message key 要求；新增 `src/module-sdk/validator-actions.ts`，集中维护 actions contract validation，包括 action name、本地 handler/input 路径、auth、timeout、entry permissions、commercial requirement、sideEffect、confirmation 与 idempotency 规则；新增 `src/module-sdk/validator-routes.ts`，集中维护 site/dashboard/admin/API routes contract validation，包括 route path/auth、page component/loader/metadata、public aliases、route aliases、route path conflict、cache、machine auth 与 anonymous policy 接入；新增 `src/module-sdk/validator-surfaces.ts`，集中维护 surfaces contract validation，包括 surface component/loader、本地 permissions、commercial requirement、responsive placement、fallback、visibility、replace permission 与 host page override loader 要求；新增 `src/module-sdk/validator-presentation.ts`，集中维护 theme/presentation contract validation，包括 ThemeWrite、host theme token allowlist、theme token value safety、white-label replaces/i18n/locales、host.page replace target、SEO namespace 与 presentation themeScope 要求；新增 `src/module-sdk/validator-background.ts`，集中维护 jobs/events/webhooks contract validation，包括 job key/handler/timeout/retries、event publish/subscribe permission 与事件名、webhook path/auth/permission/commercial/handler/signature/method 规则；新增 `src/module-sdk/validator-runtime-metadata.ts`，集中维护 lifecycle、dependencies.npm、meters、service requirements、resource bindings、config secret/default 与 egress contract validation；`src/module-sdk/validator.ts` 保留主 contract orchestration、基础字段校验和 contract parts wiring 校验。
- 完成证据：`src/module-sdk/validator.ts` 从 1618 行降到 237 行，新增 `validator-product.ts` 231 行、`validator-resources.ts` 177 行、`validator-actions.ts` 281 行、`validator-routes.ts` 595 行、`validator-surfaces.ts` 307 行、`validator-presentation.ts` 211 行、`validator-background.ts` 323 行与 `validator-runtime-metadata.ts` 257 行；`npm run test:module-contract` 19/19、`npm run test:module-doctor` 14/14、`npm run test:module-service-contract` 4/4、`npm run test:security-runtime` 22/22、`npm run test:host-page-runtime` 21/21、`npm run test:background-runtime` 4/4、`npm run test:background-reliability` 11/11、`npm run test:developer-experience` 11/11 与串行 `npm run typecheck` 均通过；本轮 touched SDK validator 文件已 Prettier 格式化。

## 5. 安全与权限分析

### 5.1 默认身份与认证

当前实现保留 demo 用户定义：

- `admin@example.com` / `Admin@123456`
- `user@example.com` / `User@123456`

但默认 seed 逻辑已经收口：

- `PLOYKIT_ENABLE_DEMO_USERS=true` 时才启用 demo 用户。
- 生产环境启用 demo 用户会抛出 `PLOYKIT_DEMO_USERS_PRODUCTION_FORBIDDEN`。
- 显式 bootstrap 通过 `PLOYKIT_BOOTSTRAP_ADMIN_EMAIL` 和 `PLOYKIT_BOOTSTRAP_ADMIN_PASSWORD`。

测试证据：

- `test:web-shell` 中已有 “host identity seed is disabled by default and blocks demo users in production” 相关用例通过。
- `test:production-runtime` 覆盖生产配置 fail-fast。

当前风险：

- Demo 用户常量仍出现在源码和测试中，合理但容易被外部误读。
- Web Shell 原始失败正是因为测试对 demo admin 的存在性假设不够显式；本轮已把该测试改为使用测试内注册用户，并补防枚举断言。

建议：

- 测试中凡使用 `admin@example.com`，必须在同一测试 setup 显式 seed 或说明依赖。
- 文档中继续强调 demo 用户不是默认生产行为。

### 5.2 Route Security

`apps/host-next/lib/security.ts` 已有统一 route catalog，字段包括：

- `auth`
- `scope`
- `csrf`
- `origin`
- `rateLimit`
- `anonymousPolicy`
- `commercialPolicy`

关键 route 已分类：

- auth
- user profile
- product scope
- notifications
- billing
- admin
- files/media
- module API/action/webhook
- worker

高价值点：

- mutation route 默认有 same-origin origin guard。
- module API/action/webhook 标记为 module-runtime 或 signature。
- billing checkout 是 high-cost rate limit。
- admin route 的 rate limit 可从 admin registry 转换。
- `checkHostRouteSecurity` 有 Web Shell 测试覆盖 cross-origin mutation 阻断。

风险：

- route catalog 是审计和部分 enforcement 中心，但 auth/scope/commercial 仍有一部分由 handler 或 module runtime 执行。这种分层可接受，但新增 route 时容易误以为登记 catalog 就完成全部安全。
- `csrf: 'same-origin'` 已在类型旁补充源码注释，明确它表示 Origin/Referer enforcement，不等同于 token-based CSRF；后续新增 route 仍需按 `docs/security-enforcement-map.zh-CN.md` 判断是否额外接入 token guard。

建议：

- 保持 `docs/security-enforcement-map.zh-CN.md` 与 `apps/host-next/lib/security.ts` 同步。
- 新增 API route 时要求同时补 route catalog、handler guard、测试。
- 已完成（2026-06-15 本轮实施）：在 `apps/host-next/lib/security.ts` 的 `HostRouteCsrf` 类型旁补充 same-origin CSRF 语义注释，明确 token-based CSRF 仍需 route handler 显式 guard，降低新增 route 时误读风险。
- 完成证据：`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "K4 host security|route security|cross-origin|admin providers"` 实际执行 75/75 个 Web Shell 子测试并全部通过，其中包含 `K4 host security catalog covers main routes and blocks cross-origin mutations`；`npm run test:production-runtime` 16/16 通过。

### 5.3 Capability Guard

`src/lib/module-runtime/security/capability-guard.ts` 是项目核心安全层。

当前高价值证据：

- `ctx.data.sql.query` 需要 `DataSqlRead` + `UnsafeSqlRaw`。
- `ctx.data.sql.execute` 需要 `DataSqlWrite` + `UnsafeSqlRaw`。
- transaction 内部会继续套 guard。
- `test:security-runtime` 覆盖 22 个用例，包括服务调用、resource binding、credits、entitlements、risk、notification、raw SQL、transaction。

结论：

- capability guard 已经具备生产级骨架，本轮已独立出 runtime capability guard 专项测试，降低与服务调用和基础权限守卫用例的耦合；本轮进一步把公共权限声明检查、resource binding 写权限检查、commercial subject 范围判断和可访问 subject 过滤 helper 迁入 `src/lib/module-runtime/security/capability-guard-common.ts`，`capability-guard.ts` 当前降到 1137 行。
- 继续增强方向应从“是否有 guard”转向“每个高风险 capability 是否有 deny/allow/redaction/tenant isolation 四件套”。

优先复核矩阵：

| 能力                                       | 当前判断                                                                                                                            | 后续重点                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `ctx.data.sql`                             | 已有 raw 权限闭合证据                                                                                                               | 保持 system-only 权限不被模板滥用                        |
| `ctx.http` / `ctx.services`                | egress、签名、redaction、私网阻断已有测试；本轮 provider matrix 本地严格证据已通过                                                  | 继续补真实外部 provider smoke                            |
| `ctx.commerce`                             | ledger、subject-first、Postgres、Stripe local mock 和 billing reconcile evidence 已补强                                             | 真实 Stripe provider 和重复 webhook 压测继续验证         |
| `ctx.files`                                | 有 runtime/storage driver 测试，本轮已跑 local cleanup/reconcile smoke、local MinIO S3 smoke 并纳入 release gate                    | 远端托管 S3/对象存储继续验证                             |
| `ctx.ai` / `ctx.rag`                       | provider runtime、RAG 文件、RAG provider、AI webhook local、provider invocation ledger、预算/quota/匿名策略 release evidence 已补强 | 真实 AI provider、远端向量库和 provider 凭据环境继续验证 |
| `ctx.jobs` / `ctx.events` / `ctx.webhooks` | 有 worker/outbox/webhook 基础证据                                                                                                   | soak、chaos、dead-letter 恢复证据继续补强                |

## 6. 数据、事务与一致性分析

### 6.1 Runtime Store

当前 runtime store 支持 memory 和 Postgres：

- memory runtime store 已完成领域拆分并收敛为组合入口；execution/runs/outbox/delivery/worker/webhook、commercial、billing documents、subscriptions、finance、redeem、identity、RAG、files、config/resource、product scope/catalog、notifications、observability/audit/usage/provider invocation 与 risk 子域已对齐 Postgres repository 拆分方式。
- Postgres runtime store 文件已按领域拆分完成，runs、outbox/delivery、worker、provider invocation、audit、files、identity、RAG、risk、config/resource binding、product scope、catalog state、webhooks、notifications、usage/metering 与 commercial 全子域 repository 本轮已独立；主文件已降到 94 行组合入口。
- `migrations/runtime` 已到 `0030_webhook_receipt_workspace_idempotency.sql`。

本次验证：

- `test:runtime-stores` 整体通过。
- Postgres 子项本轮已在隔离临时 Docker Postgres 上实际执行，11/11 通过，0 skipped。
- `runtime:stores:verify` 在同一临时库上通过，30 个 migration 全部 applied。
- `test:commercial-postgres` 通过，补充商业持久化、provider idempotency、subscription event 与 workspace/null scope 证据。
- `host:postgres-local-smoke -- --no-docker` 通过，报告写入 `.runtime/runtime-store-postgres/2026-06-14T09-57-16-250Z/postgres-local-smoke.json`。

风险判断：

- 对生产级框架而言，memory store 通过不能替代 Postgres 通过；该证据洞本轮已补齐基础验证。
- `postgres-runtime-store.ts` 与 `memory-runtime-store.ts` 均已收敛为 repository/helper 组合入口；memory store 已拆出 execution、commercial、billing documents、subscriptions、finance、redeem、identity、RAG、files、config/resource、product scope/catalog、notifications、observability/audit/usage/provider invocation 与 risk helper，后续维护性风险转移到共享 scope helper 一致性和跨 store 语义审计。
- backup/restore、upgrade migration、本地 provider 对账证据本轮已补齐；真实外部 provider 对账仍需继续补证。

建议：

- 保持 Postgres gate 串行执行，或为会重置表的测试分配独立数据库。
- 将 Postgres 必跑项纳入 integration/maintainer gate，而不是只作为 optional。
- 已完成（2026-06-15 本轮实施）：对 runtime store 的核心查询建立结构化索引审计清单，`RUNTIME_STORE_REQUIRED_INDEXES` 为每个 required index 记录 domain、table、query、columns 与 unique 语义；`runtime:stores:verify` 输出新增 `indexAudit`，可按领域证明 runs、outbox、worker、webhooks、commercial、provider、RAG、identity、risk、settings 的核心查询索引覆盖。
- 已完成（2026-06-15 本轮实施）：`src/lib/module-runtime/stores/postgres-runtime-store-runs.ts` 承担 Postgres runs repository，覆盖 `createRun`、`getRun`、`listRuns`、`updateRunStatus` 与 `appendRunLog`；`src/lib/module-runtime/stores/postgres-runtime-store-outbox.ts` 承担 Postgres outbox/delivery repository，覆盖 `enqueueOutbox`、`listOutbox`、`claimOutbox`、`markOutbox`、`recordDelivery` 与 `listDeliveries`；`src/lib/module-runtime/stores/postgres-runtime-store-workers.ts` 承担 Postgres worker repository，覆盖 `upsertWorkerHeartbeat` 与 `listWorkers`；`src/lib/module-runtime/stores/postgres-runtime-store-provider-invocations.ts` 承担 Postgres provider invocation repository，覆盖 `recordProviderInvocation` 与 `listProviderInvocations`；`src/lib/module-runtime/stores/postgres-runtime-store-audit.ts` 承担 Postgres audit repository，覆盖 `recordAudit` 与 `listAudit`；`src/lib/module-runtime/stores/postgres-runtime-store-files.ts` 承担 Postgres files repository，覆盖 `createFile`、`getFile`、`updateFile` 与 `listFiles`；`src/lib/module-runtime/stores/postgres-runtime-store-identity.ts` 承担 Postgres identity repository，覆盖 API keys 与 host users；`src/lib/module-runtime/stores/postgres-runtime-store-rag.ts` 承担 Postgres RAG repository，覆盖 RAG source/chunk upsert/list/delete；`src/lib/module-runtime/stores/postgres-runtime-store-risk.ts` 承担 Postgres risk repository，覆盖 risk event 与 risk block 写入/查询；`src/lib/module-runtime/stores/postgres-runtime-store-config.ts` 承担 Postgres config/resource repository，覆盖 host settings、service connections 与 resource bindings；`src/lib/module-runtime/stores/postgres-runtime-store-product-scope.ts` 承担 Postgres product scope repository，覆盖 memberships、products、workspaces、domain aliases 与 invites；`src/lib/module-runtime/stores/postgres-runtime-store-catalog.ts` 承担 Postgres catalog state repository，覆盖 catalog module state upsert/list；`src/lib/module-runtime/stores/postgres-runtime-store-webhooks.ts` 承担 Postgres webhook receipt repository，覆盖 receipt create/find/mark/list；`src/lib/module-runtime/stores/postgres-runtime-store-notifications.ts` 承担 Postgres notifications repository，覆盖 notifications 与 notification delivery upsert/list/read 路径；`src/lib/module-runtime/stores/postgres-runtime-store-metering.ts` 承担 Postgres usage/metering repository，覆盖 usage record/list 与 metering record/get/status/list 路径；commercial 子域已拆为 `postgres-runtime-store-commercial-orders.ts`、`postgres-runtime-store-commercial-billing.ts`、`postgres-runtime-store-commercial-credits.ts`、`postgres-runtime-store-commercial-entitlements.ts`、`postgres-runtime-store-commercial-subscriptions.ts`、`postgres-runtime-store-commercial-tax.ts`、`postgres-runtime-store-commercial-revenue.ts` 与 `postgres-runtime-store-commercial-redeem.ts`；`postgres-runtime-store.ts` 改为组合这些领域 store，外部 `RuntimeStore` API 不变。
- 已完成（2026-06-16 本轮实施）：新增 `src/lib/module-runtime/stores/memory-runtime-store-risk.ts`，集中维护 in-memory runtime store 的 risk event、risk block、idempotent block replay 与 scope 查询；`src/lib/module-runtime/stores/memory-runtime-store.ts` 当前降到 1765 行。`tests/runtime-stores.test.ts` 新增 `memory runtime store keeps risk events and blocks scoped and idempotent`，覆盖 risk event workspace/module/source 查询、risk block idempotency replay 和同 subject/scope metadata merge。完成证据：`npm run test:runtime-stores` 12 个子测试中 10 pass、2 个 Postgres 子测因本地数据库未启动按既有逻辑 skip；`npm run typecheck` 通过。
- 已完成（2026-06-16 本轮实施）：新增 `src/lib/module-runtime/stores/memory-runtime-store-billing.ts`，集中维护 in-memory runtime store 的 billing account、invoice 与 credit note 方法，包括 invoice order/number conflict、credit note provider replay、metadata redaction 和 list sorting；`src/lib/module-runtime/stores/memory-runtime-store.ts` 当前降到 1592 行。完成证据：`npm run test:runtime-stores` 12 个子测试中 10 pass、2 个 Postgres 子测因本地数据库未启动按既有逻辑 skip；`npm run test:commercial-ledger` 10/10 覆盖 invoice/credit note source idempotency 与商业账本引用路径；`npm run typecheck` 通过。
- 已完成（2026-06-16 本轮实施）：新增 `src/lib/module-runtime/stores/memory-runtime-store-subscriptions.ts`，集中维护 in-memory runtime store 的 subscription 与 subscription event 方法，包括 workspace scoped idempotency、event metadata redaction、subscription list sorting 和 event list filtering；`src/lib/module-runtime/stores/memory-runtime-store.ts` 当前降到 1506 行。完成证据：`npm run test:runtime-stores` 12 个子测试中 10 pass、2 个 Postgres 子测因本地数据库未启动按既有逻辑 skip；`npm run test:commercial-ledger` 10/10 覆盖 subscription event idempotency、ordering 与 access sync；`npm run typecheck` 通过。
- 已完成（2026-06-16 本轮实施）：新增 `src/lib/module-runtime/stores/memory-runtime-store-finance.ts`，集中维护 in-memory runtime store 的 tax profile、revenue bucket 与 settlement batch 方法，包括 tax profile scope merge、revenue bucket replay aggregation 和 settlement batch net/order/invoice/credit note counters；`src/lib/module-runtime/stores/memory-runtime-store.ts` 当前降到 1397 行。完成证据：`npm run test:runtime-stores` 12 个子测试中 10 pass、2 个 Postgres 子测因本地数据库未启动按既有逻辑 skip；`npm run test:commercial-ledger` 10/10 覆盖 revenue bucket replay、tax profile scope 和 settlement batch 查询；`npm run typecheck` 通过。
- 已完成（2026-06-16 本轮实施）：新增 `src/lib/module-runtime/stores/memory-runtime-store-redeem.ts`，集中维护 in-memory runtime store 的 redeem code 与 redemption 方法，包括 code status metadata 兼容、batch/status list 过滤、user-code duplicate guard 和 redemption idempotency；`src/lib/module-runtime/stores/memory-runtime-store.ts` 当前降到 1294 行。完成证据：`npm run test:runtime-stores` 12 个子测试中 10 pass、2 个 Postgres 子测因本地数据库未启动按既有逻辑 skip；`npm run test:commercial-ledger` 10/10 覆盖 redeem code create/list/redeem/freeze/binding/expired 路径；`npm run typecheck` 通过。
- 已完成（2026-06-16 本轮实施）：新增 `src/lib/module-runtime/stores/memory-runtime-store-identity.ts`，集中维护 in-memory runtime store 的 API key 与 host user 方法，包括 API key hash/prefix lookup、scope-filtered list/update、host user email normalization 和 status metadata merge；`src/lib/module-runtime/stores/memory-runtime-store.ts` 当前降到 1158 行。完成证据：`npm run test:runtime-stores` 12 个子测试中 10 pass、2 个 Postgres 子测因本地数据库未启动按既有逻辑 skip；`npm run test:security-runtime` 22/22 覆盖 capability guard 与 subject-scoped commercial/risk 路径；`npm run typecheck` 通过。
- 已完成（2026-06-16 本轮实施）：新增 `src/lib/module-runtime/stores/memory-runtime-store-rag.ts`，集中维护 in-memory runtime store 的 RAG source/chunk upsert/list/delete 方法，包括 source status timestamps、chunk ordering、workspace/module/source scope delete 和 embedding clone；`src/lib/module-runtime/stores/memory-runtime-store.ts` 当前降到 1055 行。完成证据：`npm run test:runtime-stores` 12 个子测试中 10 pass、2 个 Postgres 子测因本地数据库未启动按既有逻辑 skip；`npm run test:rag-files` 5 个子测试中 4 pass、1 个 Postgres 子测因本地数据库未启动按既有逻辑 skip；`npm run typecheck` 通过。
- 已完成（2026-06-16 本轮实施）：新增 `src/lib/module-runtime/stores/memory-runtime-store-files.ts`，集中维护 in-memory runtime store 的 file create/get/update/list 方法，包括 metadata merge、deleted filtering、workspace/module/owner/purpose/status/visibility/run 查询；`src/lib/module-runtime/stores/memory-runtime-store.ts` 当前降到 994 行。完成证据：`npm run test:runtime-stores` 12 个子测试中 10 pass、2 个 Postgres 子测因本地数据库未启动按既有逻辑 skip；`npm run test:rag-files` 5 个子测试中 4 pass、1 个 Postgres 子测因本地数据库未启动按既有逻辑 skip；`npm run typecheck` 通过。
- 已完成（2026-06-16 本轮实施）：新增 `src/lib/module-runtime/stores/memory-runtime-store-config.ts`，集中维护 in-memory runtime store 的 settings、service connections 与 resource bindings 方法，包括 setting version/status selection、service connection health/touch/list filtering、resource binding scope/name/kind/status filtering；`src/lib/module-runtime/stores/memory-runtime-store.ts` 当前降到 822 行。完成证据：`npm run test:runtime-stores` 12 个子测试中 10 pass、2 个 Postgres 子测因本地数据库未启动按既有逻辑 skip；`npm run test:security-runtime` 22/22 覆盖 service connection/resource binding capability guard；`npx tsx --test tests/web-shell-service-connections.test.ts` 1/1；`npx tsx --test tests/web-shell-runtime-store.test.ts` 4/4；`npm run typecheck` 通过。
- 已完成（2026-06-16 本轮实施）：新增 `src/lib/module-runtime/stores/memory-runtime-store-product-scope.ts`，集中维护 in-memory runtime store 的 catalog state、membership、product scope product/workspace/domain alias/invite 方法，包括 domain alias lowercase 归一、membership upsert key、workspace/product/status/token 过滤；`src/lib/module-runtime/stores/memory-runtime-store.ts` 当前降到 734 行。完成证据：`npm run test:runtime-stores` 12 个子测试中 10 pass、2 个 Postgres 子测因本地数据库未启动按既有逻辑 skip；`npx tsx --test tests/web-shell-product-scope.test.ts` 4/4；`npx tsx --test tests/product-scope-runtime.test.ts` 4/4；`npx tsx --test tests/web-shell-api-routes.test.ts` 2/2；`npm run typecheck` 通过。
- 已完成（2026-06-16 本轮实施）：新增 `src/lib/module-runtime/stores/memory-runtime-store-notifications.ts`，集中维护 in-memory runtime store 的 notifications 与 notification delivery 方法，包括 notification idempotency、delivered/skipped/read timestamps、read-all workspace filtering、delivery provider/status sorting；`src/lib/module-runtime/stores/memory-runtime-store.ts` 当前降到 599 行。完成证据：`npm run test:runtime-stores` 12 个子测试中 10 pass、2 个 Postgres 子测因本地数据库未启动按既有逻辑 skip；`npx tsx --test tests/web-shell.test.ts --test-name-pattern "notifications"` 实际执行 7/7；`npx tsx --test tests/web-shell-api-routes.test.ts` 2/2；`npm run typecheck` 通过。
- 已完成（2026-06-16 本轮实施）：新增 `src/lib/module-runtime/stores/memory-runtime-store-observability.ts`，集中维护 in-memory runtime store 的 audit、usage 与 provider invocation 方法，包括 audit hash chain、usage idempotency、provider invocation metadata redaction、workspace/module/provider/status filtering；`src/lib/module-runtime/stores/memory-runtime-store.ts` 当前降到 475 行。完成证据：`npm run test:runtime-stores` 12 个子测试中 10 pass、2 个 Postgres 子测因本地数据库未启动按既有逻辑 skip；`npx tsx --test tests/web-shell-admin-identity.test.ts` 4/4；`npx tsx --test tests/web-shell-operations-status.test.ts` 2/2；`npx tsx --test tests/web-shell-service-connections.test.ts` 1/1；`npm run typecheck` 通过。
- 已完成（2026-06-16 本轮实施）：新增 `src/lib/module-runtime/stores/memory-runtime-store-execution.ts`，集中维护 in-memory runtime store 的 runs、outbox、delivery ledger、worker heartbeat 与 webhook receipt 方法，包括 run/outbox/webhook workspace-scoped idempotency、outbox lease reclaim、delivery metadata redaction、worker heartbeat merge；`src/lib/module-runtime/stores/memory-runtime-store.ts` 当前降到 55 行组合入口，memory runtime store 领域拆分完成。完成证据：`npm run test:runtime-stores` 12 个子测试中 10 pass、2 个 Postgres 子测因本地数据库未启动按既有逻辑 skip；`npx tsx --test tests/web-shell-workers.test.ts` 4/4；`npx tsx --test tests/web-shell-dead-letter.test.ts` 3/3；`npx tsx --test tests/web-shell-security.test.ts` 4/4；`npm run typecheck` 通过。

### 6.2 事务与幂等

当前较强的证据：

- `test:commercial-ledger` 覆盖 workspace scoped idempotency、replayed provider events、subscription event ordering、credit notes。
- `module:test -- all` 中 `shop-demo` 覆盖 checkout order evidence 和 provider failure inventory compensation。
- `test:runtime-stores` 覆盖 outbox idempotency by workspace。
- 已完成（2026-06-16 本轮实施）：`test:runtime-stores` 新增 webhook receipt workspace-scoped idempotency 回归，memory 与 Postgres 均验证同一 product/module/webhook/idempotency key 在不同 workspace 与 null workspace 下不会误判重复；`runtime:stores:verify` 将 `module_webhook_receipts_idempotency_idx` 纳入 required index audit，webhooks 领域索引 2/2 present。

仍需继续压实：

- `shop-demo` 仍应被定位为 demo/reference，不宜直接宣称 product-grade，除非进一步证明并发 checkout、库存条件更新、支付 provider 幂等、Postgres 约束都完整。
- 文件 upload metadata 与对象存储之间的部分失败恢复，本轮已用 files cleanup/reconcile smoke 覆盖本地存储；S3/远端对象存储仍需单独跑。
- Webhook receipt 的 workspace 维度 idempotency 已完成本地 memory/Postgres 验证；provider/account 真实外部维度仍需在 Stripe/GitHub 等 provider 凭据环境继续验证。

## 7. 商业化与成本控制分析

商业能力是当前项目较成熟的区域之一。

当前证据：

- `src/lib/module-capabilities/commercial/commercial-ledger.ts` 已通过类型、admin runtime、provider runtime、ledger facts/revenue/refund helper、order benefits helper、subscriptions helper、tax helper、provider events helper、credits helper、metering helper、module commerce helper、redeem codes helper、risk helper 和 billing/entitlements helper 拆分降到 188 行，功能仍丰富且需要持续审计。
- `test:commercial-ledger` 10 个子测试全部通过。
- billing/Stripe shape 在 Web Shell 中有大量测试覆盖；本轮新增 Stripe checkout webhook replay 回归，证明同一 `checkout.session.completed` event 重复投递不会重复生成 order、credit ledger、entitlement、invoice、revenue bucket 或 order status outbox event。
- `test:production-runtime` 覆盖 commercial runtime 基础能力。
- 本轮已执行 `host:stripe-local-smoke` mock Stripe + ledger apply 和 `host:billing-reconcile-smoke`，并生成 `.runtime/stripe-smoke/2026-06-14T10-30-22-480Z/stripe-smoke.json`、`.runtime/billing-reconcile/2026-06-14T10-30-42-379Z/billing-reconcile-smoke.json`。

优势：

- idempotency、workspace scope、refund、subscription、tax profile、credit note 都有测试证据。
- 商业 provider 与 ledger 有明显分层。

风险：

- `commercial-ledger.ts` 已低于 2000 行，ledger facts/revenue/refund helper、order benefits/credits/entitlements helper、subscriptions helper、tax helper、provider events helper、credits helper、usage/metering helper、module commerce helper、redeem codes helper、risk helper 与 billing/entitlements helper 已拆出；后续重点转为跨 helper 语义审计、更细的领域测试增强，以及按真实 Provider Smoke 运维手册归档外部凭据环境执行证据。
- 本地 Stripe mock smoke 和 billing reconcile smoke 已执行；真实 Stripe provider smoke 仍未执行。
- 金钱和权益状态必须继续依赖数据库约束和 provider 对账，而不只是 memory tests；本轮 release gate 已能读取 `commercial-domain` strict evidence。

建议：

- 将 commercial ledger 继续拆成 orders、subscriptions、credits、tax、provider event applier、entitlement service、metering service 等更窄领域。
- 保留 `host:stripe-local-smoke`、`host:billing-reconcile-smoke` 为 maintainer/release evidence；真实 Stripe provider 需要单独环境变量和隔离账号。
- 已完成（2026-06-16 本轮实施）：新增 `tests/web-shell-stripe.test.ts` 的 `M6 Stripe checkout webhook replay does not duplicate commercial ledger entries`，同一 Stripe checkout webhook event 重复调用 `applyStripeCheckoutCompletedEvent` 后，订单、credits、entitlement、invoice、revenue bucket 和 order status event 均保持单条；真实 Stripe provider 凭据环境仍需单独 smoke。

## 8. AI/RAG 与外部能力分析

当前证据：

- `ai-rag-demo` 和 `capability-demo` smoke 通过。
- `test:production-runtime` 覆盖 HTTP egress origin、method、body size、private network、redirect、response size、timeout。
- `test:security-runtime` 覆盖 services.invoke 签名、redaction、operation policy、workspace isolation、DNS-resolved private egress。
- 本轮已执行 `host:ai-rag-local-smoke`、`host:rag-provider-smoke`、`host:ai-webhook-local-smoke`、`host:ai-rag-policy-smoke -- --required` 和 `host:provider-matrix -- --required`；最新 provider matrix 包含 `ai-rag-policy`，产生 20 条 provider invocation ledger，覆盖 `generateText`、`embedText`、`index`、`search`、`contextPack`、`delete`，报告写入 `.runtime/provider-matrix/2026-06-15T17-56-38-113Z/matrix.json`。

优势：

- 外部 HTTP 能力没有裸奔，策略和测试都比较完整。
- AI/RAG 通过 host-managed provider 暴露，符合框架边界。

风险：

- 本地 AI/RAG/provider matrix strict evidence 已执行；真实 AI/RAG 外部 provider smoke 仍未执行。
- 高成本调用的预算、quota、匿名访问策略已形成本地 release evidence；后续仍可补 dashboard 可视化与真实 provider 成本上限演练。
- RAG source/chunk 隔离本轮已在内存 provider 路径和 Postgres-backed runtime store vector store 路径验证；远端向量库路径仍需真实环境继续验证。

建议：

- 已完成（2026-06-15 本轮实施）：将 AI/RAG 高成本能力纳入本地 sensitive capability/release evidence，新增 `host:ai-rag-policy-smoke` 覆盖缺少 credits 拒绝、成功调用扣费入账、provider 失败释放 reservation、匿名 public API 必须声明 rate limit、匿名高成本 commercial API fail-closed。
- 对每个 provider smoke 记录 checkedAt、provider mode、required/profile。
- 对匿名 AI/RAG route 保持 fail-closed；本轮已由 validator diagnostics 和 `ai-rag-policy` release gate 证明。
- 已完成（2026-06-15 本轮实施）：`tests/rag-files-artifacts.test.ts` 新增 Postgres-backed RAG vector store workspace 隔离测试，覆盖相同 `sourceId` 跨 workspace 的 source/chunk ledger 隔离，以及删除 workspace A source 后 workspace B chunk 仍保留。

完成证据：

- `npx tsx --test tests/rag-files-artifacts.test.ts` 默认本地运行通过，4/5 pass，Postgres 子项按默认库不可达 skip。
- 使用隔离临时 Docker Postgres `ploykit-rag-postgres-smoke`（`127.0.0.1:55468`，验证后删除）设置 `DATABASE_URL=postgres://ploykit:ploykit@127.0.0.1:55468/ploykit` 后，`npx tsx --test tests/rag-files-artifacts.test.ts` 通过，5/5，0 skipped。
- `npm run host:ai-rag-policy-smoke -- --required` 通过，5/5 checks 通过，报告写入 `.runtime/ai-rag-policy/2026-06-15T17-55-05-907Z/ai-rag-policy-smoke.json`；最新 `host:provider-matrix -- --required` 也包含 `ai-rag-policy` 并通过，报告写入 `.runtime/provider-matrix/2026-06-15T17-56-38-113Z/matrix.json`。
- `npm run test:release-candidate` 通过，49/49；新增 `ai-rag-policy` 严格 evidence 读取和匿名 fail-closed 信号缺失拒绝两个 gate 子项。
- `npm run release:maintainer-gate` 通过，`ai-rag-policy` 为 passed，证据来自 `.runtime/ai-rag-policy/latest.json`：budget guard、quota accounting、anonymous policy evidence present。
- `npm run typecheck` 通过。

## 9. 模块开发体验分析

### 9.1 默认模块状态

`module:doctor -- all` 成功，`module:test -- all` 成功。重新 scan 后 doctor diagnostics 为 0。

建议模块等级：

| 模块                    | 建议等级       | 当前判断                                                      |
| ----------------------- | -------------- | ------------------------------------------------------------- |
| `hello`                 | Fixture        | 最小运行时夹具，适合 contract 和 capability smoke             |
| `public-tools-demo`     | Reference      | public API + guarded action 清楚，适合作公开工具样板          |
| `cms-demo`              | Reference      | CRUD、内容发布、Admin summary 较完整                          |
| `shop-demo`             | Demo/Reference | 商业链路丰富，但 product-grade 仍需并发/真实 provider/DB 证据 |
| `capability-demo`       | Demo           | 展示能力广，权限不应被生产模块直接照搬                        |
| `ai-rag-demo`           | Demo/Reference | AI/RAG 样板可用，需强调成本和匿名策略                         |
| `white-label-site-demo` | Reference      | 白标页面和 presentation override 样板                         |

### 9.2 CLI 体验

优势：

- doctor/test 输出 JSON，适合 CI。
- diagnostics 包含 severity、code、message、path、fix、category、subsystem。
- module map drift 能给出 `Drift summary` 和明确 fix：列出 drift 模块 ID、旧/新 digest 摘要，并提示 `npm run modules:scan`。

问题：

- 已缓解：`module:test -- all --summary` 现在输出模块级短摘要，不再把 doctor/fake-host 的完整 stdout 嵌进终端主输出。
- 已补齐：warning-only 和 error 的退出码策略已进入 `module:test --help` 与模块开发文档。

建议：

- 已完成（2026-06-15 本轮实施）：`scripts/module-test.mjs` 增加 `--summary`，保留默认 JSON 输出和显式 `--json` 机器读路径；详细报告继续写 `.runtime/module-test-reports`，本轮通过 `npm run test:module-map` 10/10 和 `npm run module:test -- all --summary` 7/7 验证。
- 已完成（2026-06-15 本轮实施）：`scripts/module-test.mjs --help` 与 `docs/module-development.zh-CN.md` 文档化退出码策略：target 解析失败或 doctor/fake-host/real-host 任一步失败返回非 0；doctor warning-only 保持通过。

## 10. 前端与用户稳定性分析

当前前端覆盖较广，但复杂度集中。

### 10.1 线上 Dashboard 宿主性能与路由稳定性

本次额外对线上地址 `https://aijia.yingasi.com/dashboard/origin-agentops/agents` 做了真实登录和路由切换观察。账号使用 `admin@example.com`，登录后确认进入 `Origin AgentOps` Dashboard。该分析只用于定位性能责任边界，不读取浏览器 cookie、localStorage 或密码存储。

线上实测结果：

| 场景                                             |                                观测结果 | 判断               |
| ------------------------------------------------ | --------------------------------------: | ------------------ |
| 已登录硬刷新 `/dashboard/origin-agentops/agents` | `load` 约 3.7-4.1 秒，稳定约 4.8-5.1 秒 | 首屏服务端渲染偏慢 |
| agents -> skills                                 |                    主内容稳定约 5.08 秒 | 路由切换过慢       |
| skills -> tools                                  |                    主内容稳定约 4.63 秒 | 路由切换过慢       |
| tools -> runtime                                 |                    主内容稳定约 4.24 秒 | 路由切换过慢       |
| runtime -> approvals                             |                    主内容稳定约 3.88 秒 | 路由切换过慢       |
| approvals -> agents                              |                    主内容稳定约 4.34 秒 | 路由切换过慢       |

网络瀑布证据：

- 切换 `skills` 时出现完整 document 请求 `/dashboard/origin-agentops/skills`，耗时约 3208ms。
- 切换 `tools` 时出现完整 document 请求 `/dashboard/origin-agentops/tools`，耗时约 3570ms。
- 切回 `agents` 时出现完整 document 请求 `/dashboard/origin-agentops/agents`，耗时约 2973ms。
- 静态资源不是主因：切换时 17 个 `_next/static/chunks` 基本为缓存命中，单个约 1-5ms。
- 控制台出现 `Minified React error #418`，参数指向 text hydration mismatch。

本轮复测（2026-06-14）：

- 已修正 `host:dashboard-transition-smoke` 的线上登录方式：API 登录请求现在带同源 `Origin` / `Referer`，符合生产 same-origin guard，而不是被 403 拦截后误判为登录页问题。
- 执行 `npm run host:dashboard-transition-smoke -- --base-url https://aijia.yingasi.com --routes /dashboard/origin-agentops/agents,/dashboard/origin-agentops/skills,/dashboard/origin-agentops/tools --max-p95-ms 10000`。
- 结果：登录成功（303，session cookie 已写入），初始 `/dashboard/origin-agentops/agents` 返回 200。
- 失败点：两次路由切换仍各产生 1 次完整 document navigation，`agents -> skills` 5775ms，`skills -> tools` 5024ms，transition document navigation 合计 2，P50 5024ms，P95 5775ms。
- 本轮 smoke 未捕获 hydration error，`hydrationErrors: 0`；这只能说明本次未复现 React #418，不能说明 hydration 风险已彻底清零。
- 截图已人工检查，页面不是登录页、错误页或空白页：`.runtime/dashboard-transition-smoke/2026-06-14T10-01-57-219Z/dashboard-origin-agentops-skills.png`、`.runtime/dashboard-transition-smoke/2026-06-14T10-01-57-219Z/dashboard-origin-agentops-tools.png`。
- 额外 Playwright 探针确认页面加载了 `_next/static` 脚本、无 console/page/network 错误，`/dashboard/origin-agentops/{agents,skills,tools}` 链接存在；这些链接显示为模块内部 `.oa-nav-item` 普通锚点，点击后仍触发 document navigation。宿主需要继续提供回归兜底，模块也需要把内部导航接入 Next client transition 或显式使用宿主 Link 能力。
- 本轮随后已在宿主 `AppFrame` 内新增普通锚点 client transition 兜底：对 dashboard/admin 区域内同源内部 `<a href>` 点击统一走 `router.push`，同时保留新窗口、下载、外链、modifier click、hash-only 和非 dashboard/admin 链接的浏览器默认行为。本地 `--inject-anchor` smoke 已验证普通 `<a>` 可被宿主接管，切换 document navigation 为 0；线上 `aijia.yingasi.com` 仍需部署这份代码后重新复测。
- 2026-06-16 线上 required repeat 复测仍失败：`--repeat 3 --max-p95-ms 1000` 下 8/8 次 transition 均产生完整 document navigation，P50 2666ms、P95 2968ms、hydrationErrors=0，证据目录 `.runtime/dashboard-transition-smoke/2026-06-16T07-00-09-417Z`。
- 2026-06-16 线上 `--inject-anchor --repeat 3` 对照也失败：8/8 次 transition 均产生完整 document navigation，P95 3737ms、hydrationErrors=0，证据目录 `.runtime/dashboard-transition-smoke/2026-06-16T07-02-56-693Z`。增强后的短复测显示 `appFramePresent=false`、`clientTransitionMarkerPresent=false`，说明线上页面尚未暴露当前本地 `AppFrame`/`ClientTransitionLinks` 诊断标记；本轮脚本已进一步在点击前记录注入锚点归属，本地最新 Origin evidence 已确认锚点落在 `[data-host-app-frame]` 内，线上下一轮复测也应先确认这些诊断为 true。

属于宿主的问题：

1. Dashboard catch-all 路由强制动态渲染。`apps/host-next/app/(dashboard)/dashboard/[[...modulePath]]/page.tsx` 使用 `export const dynamic = 'force-dynamic'`，导致每次 dashboard 页面都不能利用静态或 segment 缓存，只能重新走服务端渲染链。
2. `generateMetadata` 和页面主体曾经重复解析同一个模块页。原始实现中，`generateMetadata` 调用 `host.resolvePageRoute` 获取 title/description；页面主体随后再次调用 `host.resolvePageRoute`。在当时的 runtime 中，`resolveModulePageRoute` 会加载 component、执行 page loader、执行 metadata loader，因此 metadata 阶段可能把模块 loader work 提前跑一遍。本轮已新增 `resolvePageRouteMetadata`，metadata 阶段只匹配路由、检查访问权限并执行轻量 metadata loader，不再加载页面组件或执行 page loader。
3. Dashboard 页面 shell 曾串行读取过多宿主上下文。页面主体除了模块页解析，还会执行 `resolveDemoProductScope`、`listDemoWorkspaces`、`getProductThemeRuntimeView`、`dashboardFrameUser`、`dashboardNavGroups`、`dashboardModuleSearchHref` 等工作。部分是 host shell 数据，不应阻塞模块主内容或应并行化。本轮已把模块页解析与 shell scope/workspaces/theme/profile 数据并行，并把 dashboard sidebar navigation 解析收敛为显式缓存的普通 session / module session 两条路径；同时新增 dashboard 壳层跨请求短缓存，覆盖 product-scope snapshot/resolution、navigation、profile 和 theme，并接入 profile/workspace 写路径失效，避免重复解析同时保留权限语义。
4. Hydration mismatch 属于宿主必须先兜底的问题。原始线上观察出现 React #418，本轮复测未复现，但线上路由点击仍表现为完整 document navigation。即使根因来自某个模块输出或模块内部普通锚点，宿主也应提供检测和隔离：生产环境不能让单个模块文本不一致或导航实现不一致拖垮整个 dashboard shell 的 client navigation。本轮已新增 AppFrame 内普通锚点兜底，本地验证通过；线上仍需部署后确认 `.oa-nav-item` 是否被接管。
5. Dashboard 路由曾缺少服务端分段证据。当前线上原始观察只能从浏览器侧看到 document 约 3 秒，无法直接判断时间花在 auth/session、module host、route resolve、loader、metadata、shell profile/workspace/theme 哪一段。本轮已新增结构化 dashboard timing report：慢请求或显式配置时输出 `dashboard-timing` JSON，包含 `auth`、`module-host`、`session`、`module-session`、`navigation`、`route-resolve`、`shell-data`、`scope`、`workspaces`、`profile`、`theme`、`chrome` 等 span；真实 `Server-Timing` 响应头仍需调整 dashboard 响应写入边界。
6. 宿主静态资产缓存策略曾不完整。`/brand/mark.png` 响应约 136KB，`Cache-Control: public, max-age=0`。这不是 dashboard 切路由慢的主因，但会拖慢公开登录页首访体验。本轮已给 `/brand/:path*` 配置 `Cache-Control: public, max-age=31536000, immutable`，图片体积压缩仍可作为后续 polish。

宿主侧代码证据：

- `apps/host-next/app/(dashboard)/dashboard/[[...modulePath]]/page.tsx:39`：`dynamic = 'force-dynamic'`。
- `apps/host-next/app/(dashboard)/dashboard/[[...modulePath]]/page.tsx:284`：`generateMetadata`。
- `apps/host-next/app/(dashboard)/dashboard/[[...modulePath]]/page.tsx`：本轮已将 `generateMetadata` 改为调用 `host.resolvePageRouteMetadata`；页面主体仍调用 `host.resolvePageRoute` 渲染真实模块页。
- `apps/host-next/app/(dashboard)/dashboard/[[...modulePath]]/page.tsx`：本轮将 dashboard `generateMetadata` 的 metadata-only 路径抽成可注入 helper，保持生产入口行为不变；`tests/host-runtime.test.ts` 新增 route-level 回归，证明它不会调用完整 `resolvePageRoute` 或 page loader。
- `apps/host-next/app/(dashboard)/dashboard/[[...modulePath]]/page.tsx`：本轮已新增 `resolveDashboardShellData`，将 scope/workspaces/theme/profile 与 module page resolve 并行；navigation 通过 `resolveDashboardNavigation` 显式缓存，避免页面 chrome 再次隐式调用 `resolveNavigation`。
- `apps/host-next/lib/dashboard-timing.ts`：本轮新增 dashboard timing report 工具，统一 span 记录、慢请求阈值和结构化日志输出。
- `apps/host-next/lib/dashboard-shell-cache.ts`：本轮新增 dashboard 壳层短缓存工具，覆盖 product-scope、navigation、profile、theme，并提供写路径失效入口。
- `apps/host-next/components/layout/AppFrame.tsx`：本轮在宿主应用框架内挂载 `ClientTransitionLinks`，使 dashboard/admin 区域内的同源内部普通锚点也能被宿主 client navigation 接管。
- `apps/host-next/components/layout/ClientTransitionLinks.tsx`：本轮新增 document click 监听器，定位 AppFrame 内 `<a href>`，通过 `next/navigation` 的 `router.push` 执行客户端切换。
- `apps/host-next/lib/client-transition-links.ts`：本轮新增可单测的链接决策函数，明确拒绝外链、下载、新窗口、modifier click、hash-only、API/非 dashboard/admin 链接等默认行为场景。
- `src/lib/module-runtime/adapters/page-route.ts`：本轮已拆出共享路由匹配和权限检查，并新增 metadata-only resolver；完整 `resolveModulePageRoute` 仍负责组件、page loader 与 metadata loader。
- `apps/host-next/lib/create-host.ts`：本轮已把 `ensureHostCatalogSeeded` 的 catalog states 查询移到循环前，并用 `Set` 维护已存在和刚插入的 moduleId，避免每个模块重复查询。
- `scripts/host-dashboard-transition-smoke.mjs`：本轮新增 `--inject-anchor`，可在 `[data-host-app-frame]` 内插入普通 `<a>` 验证宿主兜底是否真的能阻止 document navigation。

建议修复顺序：

1. 部分完成：已建立真实浏览器回归脚本 `host:dashboard-transition-smoke`。它登录后点击 dashboard 真实导航链接，记录切换阶段是否产生新的 `document` 请求、是否出现 hydration error，并输出 P50/P95 与截图。2026-06-14 线上 origin-agentops 路径实跑失败：transition document navigation 为 2，P95 5775ms，hydration error 为 0；随后本地新增 AppFrame 普通锚点兜底并用 `--inject-anchor` 验证通过。2026-06-16 线上 required repeat 复测仍失败：8/8 次 transition 均产生完整 document navigation，P95 2968ms；`--inject-anchor` 对照也失败且增强诊断显示线上未暴露当前 AppFrame/client-transition 标记。随后仓库侧已为 `shell.chrome='none'` 全屏模块增加 host client-transition frame，本地 Origin AgentOps latest smoke 通过，transition document navigation=0、P95 198ms；线上仍需部署当前宿主产物后复测。
2. 已完成结构化日志：dashboard 路由已输出可配置的 `dashboard-timing` 结构化 report，至少拆出 `auth/session`、`module-host`、`navigation`、`route-resolve`、`shell-data`、`scope/workspaces`、`profile`、`theme`、`chrome`。dashboard 壳层跨请求短缓存也已覆盖 product-scope、navigation、profile、theme，并接到相关写路径失效。后续若要输出真实 `Server-Timing` 响应头，需要把 timing sink 接到可写响应层，而不是只在 page 组件内记录。
3. 已完成：把 dashboard metadata 解析改成轻量路径。`generateMetadata` 现在走 `resolvePageRouteMetadata`，不加载页面组件，不执行 page loader，只执行 metadata loader 并保留访问权限检查。已完成（2026-06-16 本轮实施）：新增 `dashboard generateMetadata resolves metadata-only routes without page loaders` 回归，直接调用 dashboard route 的 `generateMetadata` helper，断言只调用 `resolvePageRouteMetadata`、不调用完整 `resolvePageRoute`；`npm run test:host-runtime` 21/21 与 `npm run typecheck` 通过。
4. 已完成基础短缓存：已将 module page resolve 与 shell scope/workspaces/theme/profile 并行，并缓存 dashboard navigation 解析结果；dashboard 壳层 product-scope、navigation、profile、theme 已接入 10 秒默认 TTL 的跨请求短缓存，可用 `PLOYKIT_DASHBOARD_SHELL_CACHE_TTL_MS=0` 关闭。
5. 已完成：把 `ensureHostCatalogSeeded` 改为循环前读取一次 catalog states，避免每个模块重复查询。
6. 已完成一半：对 `/brand/*` 配置长期缓存；仍建议压缩 `mark.png` 或提供更小尺寸。
7. 已完成本地宿主兜底：AppFrame 内普通 dashboard/admin 锚点由 `ClientTransitionLinks` 接管为 `router.push`，`shell.chrome='none'` 全屏模块外层也由 host client-transition frame 接管，并由单元测试、本地真实浏览器 `--inject-anchor` smoke 和 Origin AgentOps latest smoke 覆盖；2026-06-16 线上复测未看到当前 AppFrame/client-transition 诊断标记，仍需部署当前宿主产物后确认。

验收标准：

- 登录后 dashboard 内部路由切换 P95 小于 1 秒，且不能出现完整 document navigation。
- 已登录硬刷新 dashboard P95 小于 2 秒；冷启动单独记录，不混入热路径指标。
- 控制台无 React hydration error、无 first-party 404/5xx。
- Dashboard document 响应带可读 `Server-Timing`，能定位慢段。
- 已完成：宿主层 route-level 测试覆盖 `generateMetadata` 不执行 page loader 的约束。

模块自身 API 和 loader 的慢点不放在本节归责，详见独立文档 [Origin AgentOps 模块性能分析](origin-agentops-module-performance-analysis-2026-06-14.zh-CN.md)。

### 10.2 UI 复杂度热点

大文件 Top 相关 UI 文件：

| 文件                                                                                       | 行数 | 风险                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------ | ---: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/host-next/components/admin/pages/dev-console/DevConsolePages.tsx`                    |  140 | Admin module dev console 页面主体；本轮已清理旧聚合残留 imports/types/helpers/options，并将环境对比、owner/runbook、AI repair、MDC summary、raw diagnostics 迁出，当前保留 stats、diagnostics review 与子组件 wiring                                                                                                                                                                                                                                                                                                        |
| `apps/host-next/components/admin/pages/dev-console/DevConsoleOperationsSummary.tsx`        |  215 | Dev Console operations summary，承载 host composition、theme governance 与 AI prompt export 三段 segmented evidence                                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/host-next/components/admin/pages/dev-console/DevConsoleRawDiagnostics.tsx`           |  116 | Dev Console raw diagnostics，承载 module map、templates、bundle inspect 与 AI authoring prompts 原始表                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/host-next/components/admin/pages/dev-console/DevConsolePageModel.ts`                 |   98 | Dev Console helper/model，承载 module root/runbook/owner/escalation、repair commands、AI prompt bundle 与 repair pack 构造                                                                                                                                                                                                                                                                                                                                                                                                  |
| `apps/host-next/components/admin/pages/dev-console/DevConsoleEnvironmentPanel.tsx`         |   79 | Dev Console environment comparison，承载 current/target env、module map、module tests 与 production target readiness                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/host-next/components/admin/pages/dev-console/DevConsoleOwnerPanel.tsx`               |   57 | Dev Console owner/runbook panel，承载 module owner、README runbook、escalation 与 module/runs links                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/host-next/components/admin/pages/dev-console/DevConsoleRepairPanel.tsx`              |   54 | Dev Console AI repair workflow，承载 module diagnostics、repair commands 与 copyable repair pack                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `apps/host-next/components/admin/pages/settings/SettingsPages.tsx`                         |  209 | Admin settings 页面主体；本轮已清理旧聚合残留 imports/types/helpers/options，并将产品设置表单、resolved settings、主题预览、runtime config 与 diagnostics 面板迁出，当前保留 stats、review queue 与子组件 wiring                                                                                                                                                                                                                                                                                                            |
| `apps/host-next/components/admin/pages/settings/SettingsProductSettingsPanel.tsx`          |  219 | Admin settings 产品设置表单，承载 editable/locked 字段、diff metadata、reason、email verification 与确认保存按钮                                                                                                                                                                                                                                                                                                                                                                                                            |
| `apps/host-next/components/admin/pages/settings/SettingsDiagnosticsPanels.tsx`             |  151 | Admin settings diagnostics center 与 summary table，承载 provider/worker segmented evidence 和 runtime readiness 汇总                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/host-next/components/admin/pages/settings/SettingsThemePreviewPanel.tsx`             |  109 | Admin settings theme preview，承载 token swatches、按钮/status/input/select smoke preview 与 token scope facts                                                                                                                                                                                                                                                                                                                                                                                                              |
| `apps/host-next/components/admin/pages/settings/SettingsRuntimeConfigPanel.tsx`            |   98 | Admin settings runtime config panel，承载 database、file storage、billing provider、auth 与 security runtime health rows                                                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/host-next/components/admin/pages/settings/SettingsResolvedPanel.tsx`                 |   83 | Admin settings resolved values，承载 FactList 与 settings field source/risk/restart/scope 表                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `apps/host-next/components/admin/pages/governance/GovernancePages.tsx`                     |  158 | Admin audit 页面主体；本轮已将全局搜索页、audit model、detail drawer、retention panel 与 timeline panel 拆出，当前保留 stats、review queue 与子组件 wiring                                                                                                                                                                                                                                                                                                                                                                  |
| `apps/host-next/components/admin/pages/governance/AuditPageModel.ts`                       |  273 | Admin audit 纯模型，承载 table query 归一、audit/usage 过滤、分页、风险分类、actor/family/action 统计与导出 href                                                                                                                                                                                                                                                                                                                                                                                                            |
| `apps/host-next/components/admin/pages/governance/SearchPage.tsx`                          |  245 | Admin global search 页面，承载 search stats、command palette、结果分组、empty state 与 pagination                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/host-next/components/admin/pages/governance/AuditTimelinePanel.tsx`                  |  192 | Admin audit timeline 组件，承载 filter bar、stats table、audit grouped timeline、usage table 与 pagination                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `apps/host-next/components/admin/pages/governance/GovernancePageModel.ts`                  |  110 | Governance 页面共享模型，承载 admin paged result、table query 归一与列表 pagination href                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/host-next/components/admin/pages/governance/AuditDetailDrawer.tsx`                   |   93 | Admin audit detail drawer，承载 audit fact list、相关搜索/模块/actor 链接与 redacted metadata                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `apps/host-next/components/admin/pages/governance/AuditRetentionPanel.tsx`                 |   60 | Admin audit retention panel，承载保留天数、模式、原因与确认提交表单                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/host-next/components/admin/pages/overview/OverviewPages.tsx`                         |  327 | Admin overview 首页主体；本轮已清理旧聚合残留 helper/types/imports，并将 risk queue、quick actions/audience workspace、recent users/growth trend 迁入局部组件，当前保留 stats、today summary、system health 与页面 wiring                                                                                                                                                                                                                                                                                                   |
| `apps/host-next/components/admin/pages/overview/OverviewGrowthPanels.tsx`                  |  225 | Admin overview recent users 与 growth trend 组件，承载 activity bucket/index、用户标题/头像 initials 与趋势图 stats                                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/host-next/components/admin/pages/overview/OverviewNavigationPanels.tsx`              |  159 | Admin overview navigation panels，承载 quick actions 与 audience segmented workspace                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/host-next/components/admin/pages/overview/OverviewRiskPanel.tsx`                     |   51 | Admin overview risk queue 组件，承载 ActionQueue 映射与风险计数                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `apps/host-next/components/admin/pages/operations/OperationsPages.tsx`                     |    3 | Admin operations 兼容导出壳；service connections、runs、webhooks 页面主体均已迁出                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/host-next/components/admin/pages/operations/ServiceConnectionsPages.tsx`             |  231 | 已从 OperationsPages.tsx 拆出的 service connections 页面；evidence panels、maintenance forms、connection filter/table 与 detail/related panels 均已拆出，当前主体保留 summary、review queue、focus connection 选择和子组件 wiring                                                                                                                                                                                                                                                                                           |
| `apps/host-next/components/admin/pages/operations/ServiceConnectionDetailPanels.tsx`       |  170 | Service connections detail panels，承载 focus connection drawer、FactList、相关 runs/jobs/webhooks/audit/settings links 与 related operations                                                                                                                                                                                                                                                                                                                                                                               |
| `apps/host-next/components/admin/pages/operations/ServiceConnectionEvidencePanels.tsx`     |   83 | Service connections 页面 evidence panels，承载 provider readiness、call timeline 与 config diagnostics 展示                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `apps/host-next/components/admin/pages/operations/ServiceConnectionMaintenancePanel.tsx`   |   67 | Service connections 页面 maintenance panel 组装组件，承载折叠区、action 开关与四组 form wiring                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `apps/host-next/components/admin/pages/operations/ServiceConnectionCreateForm.tsx`         |  140 | Service connections create form，承载自定义 provider 连接创建字段、auth/owner/scope options 与确认提交                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/host-next/components/admin/pages/operations/ServiceConnectionPolicyForm.tsx`         |  101 | Service connections policy form，承载 base URL/auth/secret refs/timeout/retry/health check policy 更新                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/host-next/components/admin/pages/operations/ServiceConnectionSecretRotationForm.tsx` |   89 | Service connections secret rotation form，承载轮换步骤说明、connection 选择、新 secret reference 与确认提交                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `apps/host-next/components/admin/pages/operations/ServiceConnectionRetentionForm.tsx`      |   54 | Service connections call log retention form，承载保留天数、reason 与 hidden/visible/cutoff evidence                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/host-next/components/admin/pages/operations/ServiceConnectionMaintenanceModel.ts`    |    1 | Service connections maintenance helper，承载 form action 类型                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `apps/host-next/components/admin/pages/operations/ServiceConnectionTableSection.tsx`       |  341 | Service connections 页面 filter/table/list 区，承载 table query form、desktop DataTable、mobile list 与 row actions                                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/host-next/components/admin/pages/operations/WebhookPages.tsx`                        |  221 | 已从 OperationsPages.tsx 拆出的 webhook/outbox 页面；列表页 page model、worker panels、delivery lanes/records tables、detail action panel、detail evidence、detail tables 与 detail drawer 已拆出，当前主体保留页面外壳、统计/review queue 与子组件 wiring                                                                                                                                                                                                                                                                  |
| `apps/host-next/components/admin/pages/operations/WebhookPageModel.ts`                     |  198 | Webhook 列表页纯 page model，承载过滤、分桶、bulk preview 与 review item 组装                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `apps/host-next/components/admin/pages/operations/WebhookWorkerPanels.tsx`                 |  271 | Webhook 列表页 worker status、bulk action、drain scope 与 queue pulse 展示组件                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `apps/host-next/components/admin/pages/operations/WebhookDeliveryTables.tsx`               |  341 | Webhook 列表页 delivery lanes、filter bar、outbox/receipt records table 与 compact row action 展示组件                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/host-next/components/admin/pages/operations/WebhookDetailActions.tsx`                |   88 | Webhook detail 页 retry、discard、archive 三组 action form 与 confirm button 展示组件                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/host-next/components/admin/pages/operations/WebhookDetailEvidence.tsx`               |  111 | Webhook detail 页 related operations、payload/metadata/error redacted evidence 展示组件                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/host-next/components/admin/pages/operations/WebhookDetailTables.tsx`                 |  138 | Webhook detail 页 receipt retry table、delivery ledger table 与 audit timeline 展示组件                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/host-next/components/admin/pages/operations/WebhookDetailDrawer.tsx`                 |   42 | Webhook detail 页 outbox snapshot drawer、copy ID 与 fact list 展示组件                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/host-next/components/admin/pages/operations/RunsPages.tsx`                           |  169 | 已从 OperationsPages.tsx 拆出的 runs list 页面；本轮已将 run detail、queue lanes 与 run history section 迁出，当前保留 queue stats、review queue、分页模型与子组件 wiring                                                                                                                                                                                                                                                                                                                                                   |
| `apps/host-next/components/admin/pages/operations/RunQueueLanes.tsx`                       |   71 | Admin runs queue lanes 组件，承载 running/queued/failed/waiting external lane health rows                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/host-next/components/admin/pages/operations/RunHistorySection.tsx`                   |  268 | Admin runs history section，承载 filter bar、kind chip、empty state、desktop table、mobile list、cancel/requeue row actions 与 pagination                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/host-next/components/admin/pages/operations/RunDetailPage.tsx`                       |  287 | Admin run detail 页主体，承载 status/progress/attempt stats、cancel/requeue action panel、runbook/escalation links、timeline、redacted input/result/error code blocks、snapshot drawer 与 linked evidence wiring                                                                                                                                                                                                                                                                                                            |
| `apps/host-next/components/admin/pages/operations/RunLinkedEvidence.tsx`                   |  117 | Admin run detail linked evidence 组件，承载 outbox、delivery ledger、file/artifact、usage 与 audit evidence tables                                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/host-next/components/dashboard/pages/DashboardPages.tsx`                             |   29 | Dashboard 页面兼容导出壳，仅保留 `DashboardSimplePage` 和 landing/profile/workspaces/commercial/files/tasks 转发导出                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/host-next/components/dashboard/pages/LandingPage.tsx`                                |  256 | 已从 DashboardPages.tsx 拆出的 Dashboard landing 页面                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/host-next/components/dashboard/pages/ProfilePage.tsx`                                |  307 | 已从 DashboardPages.tsx 拆出的 Dashboard profile/account 页面                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `apps/host-next/components/dashboard/pages/WorkspacesPage.tsx`                             |  132 | Dashboard workspaces 页面主体，保留 workspace synopsis、section nav 与 list/collaboration/access 三组 section wiring                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/host-next/components/dashboard/pages/WorkspaceListSection.tsx`                       |  106 | Dashboard workspace list section，承载 workspace card 列表、切换 workspace 与 create workspace panel                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/host-next/components/dashboard/pages/WorkspaceCollaborationSection.tsx`              |  155 | Dashboard workspace collaboration section，承载 members、invite member panel、invitation records 与 revoke action                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/host-next/components/dashboard/pages/WorkspaceAccessSection.tsx`                     |  108 | Dashboard workspace access section，承载 domain alias bind form 与 workspace/product alias cards                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `apps/host-next/components/dashboard/pages/WorkspacesPageModel.ts`                         |   33 | Dashboard workspaces 页面共享类型，承载 scope/member row/action 类型                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/host-next/components/dashboard/pages/CommercialPages.tsx`                            |    3 | Dashboard commercial 兼容导出壳，仅转发 billing、orders 与 credit history 页面                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `apps/host-next/components/dashboard/pages/DashboardBillingPage.tsx`                       |  346 | Dashboard billing 页面主体，承载 current plan、checkout CTA、billing summary、plan cards、invoices、payment methods 与 tax profile form                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/host-next/components/dashboard/pages/DashboardOrdersPage.tsx`                        |  145 | Dashboard orders 页面主体，承载 order synopsis、订单桌面/移动列表、invoice document link 与 billing 返回入口                                                                                                                                                                                                                                                                                                                                                                                                                |
| `apps/host-next/components/dashboard/pages/DashboardCreditHistoryPage.tsx`                 |  116 | Dashboard credit history 页面主体，承载 credit balance synopsis、credit transaction list 与 empty state                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/host-next/components/dashboard/pages/TaskPages.tsx`                                  |  246 | 已从 DashboardPages.tsx 拆出的任务列表与任务详情页面                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/host-next/components/dashboard/pages/FilePages.tsx`                                  |  289 | 已从 DashboardPages.tsx 拆出的用户文件页面                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `apps/host-next/components/dashboard/pages/DashboardPageUtils.tsx`                         |  190 | Dashboard 共享 UI primitives 兼容壳，保留 button class、status badge、progress、empty/card/hash panel/section nav，并 re-export formatting helper                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/host-next/components/dashboard/pages/DashboardPageFormatting.ts`                     |    6 | Dashboard formatting 兼容 barrel，转发 commerce/status/scope/task/file/notification formatting helper                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/host-next/components/dashboard/pages/DashboardCommerceFormatting.ts`                 |   86 | Dashboard commerce formatting helper，承载 billing plan/SKU、credit、order amount 与 payment method label                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/host-next/components/dashboard/pages/DashboardStatusFormatting.ts`                   |  117 | Dashboard status/user formatting helper，承载 status label/tone、user date/language/role                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/host-next/components/dashboard/pages/DashboardScopeFormatting.ts`                    |   49 | Dashboard product/workspace formatting helper，承载 product/workspace label 与 display name                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `apps/host-next/components/dashboard/pages/DashboardTaskFormatting.ts`                     |   26 | Dashboard task formatting helper，承载 task name/result/progress 文案                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/host-next/components/dashboard/pages/DashboardFileFormatting.ts`                     |   44 | Dashboard file formatting helper，承载 storage、file purpose 与 MIME type label                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `apps/host-next/components/dashboard/pages/DashboardNotificationFormatting.ts`             |  104 | Dashboard notification formatting helper，承载 notification category/title/body 归一化文案                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `apps/host-next/components/admin/pages/commerce/CommercePages.tsx`                         |    2 | Admin commerce 兼容导出壳，仅转发 billing、revenue 与 entitlements 页面                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/host-next/components/admin/pages/commerce/BillingPages.tsx`                          |  163 | 已从 CommercePages.tsx 拆出的 billing operating model、review queue 与子组件 wiring；本轮已将过滤、异常队列、order benefits 与上下文链接模型迁入 `BillingPageModel.ts`，将 business lanes 迁入 `BillingBusinessLanes.tsx`，将 order detail drawer 迁入 `BillingOrderDetailDrawer.tsx`，将 catalog authoring 迁入 `BillingCatalogAuthoring.tsx`，将 catalog workspace 迁入 `BillingCatalogWorkspace.tsx`，将 ledger evidence 迁入 `BillingLedgerEvidence.tsx`，并将 settlement evidence 迁入 `BillingSettlementEvidence.tsx` |
| `apps/host-next/components/admin/pages/commerce/BillingPageModel.ts`                       |  306 | Admin billing 页面纯模型，承载 table query 归一、记录过滤、review item、order benefit/context helper re-export 与 plan/SKU 分组                                                                                                                                                                                                                                                                                                                                                                                             |
| `apps/host-next/components/admin/pages/commerce/BillingOrderModel.ts`                      |   91 | Admin billing order helper，承载 order benefit summary、metadata order id、order context links 与 join helper                                                                                                                                                                                                                                                                                                                                                                                                               |
| `apps/host-next/components/admin/pages/commerce/BillingBusinessLanes.tsx`                  |  110 | Admin billing business lanes 面板，承载 product packaging、customer access、settlement、payment/tax profile 四组健康状态                                                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/host-next/components/admin/pages/commerce/BillingOrderDetailDrawer.tsx`              |   91 | Admin billing order detail drawer，承载订单上下文链接、benefit summary、invoice/subscription 事实列表                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/host-next/components/admin/pages/commerce/BillingCatalogAuthoring.tsx`               |  157 | Admin billing catalog authoring 面板，承载 plan/SKU 创建更新表单与确认提交                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `apps/host-next/components/admin/pages/commerce/BillingCatalogWorkspace.tsx`               |  244 | Admin billing commercial catalog workspace，承载 plans/SKUs 表格、ledger filter tab、archive 与 sync maintenance 操作                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/host-next/components/admin/pages/commerce/BillingLedgerEvidence.tsx`                 |   53 | Admin billing ledger evidence 组装面板，保留 feature matrix 并组合 customer ledger 与 operational ledger evidence                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/host-next/components/admin/pages/commerce/BillingCustomerLedgerEvidence.tsx`         |  252 | Admin billing customer ledger evidence，承载 orders、entitlements、credits 的桌面表格与移动列表                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `apps/host-next/components/admin/pages/commerce/BillingOperationalLedgerEvidence.tsx`      |  181 | Admin billing operational ledger evidence，承载 reservations、redeem lifecycle、machine API keys 与 risk facts                                                                                                                                                                                                                                                                                                                                                                                                              |
| `apps/host-next/components/admin/pages/commerce/BillingSettlementEvidence.tsx`             |  115 | Admin billing settlement evidence 面板，承载 subscriptions、invoices、payment methods 与 tax profiles 四组只读证据表                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/host-next/components/admin/pages/commerce/RevenuePages.tsx`                          |  331 | 已从 CommercePages.tsx 拆出的 revenue/entitlements 页面；本轮已将 table query/model、revenue overview、order evidence 与 entitlements workspace 迁入局部组件                                                                                                                                                                                                                                                                                                                                                                |
| `apps/host-next/components/admin/pages/commerce/RevenuePageModel.ts`                       |  198 | Admin revenue/entitlements 页面共享模型与 helper，承载 table query 归一、列表分页链接、provider event JSON 摘要、order benefit summary 与 entitlement/order context 关联                                                                                                                                                                                                                                                                                                                                                    |
| `apps/host-next/components/admin/pages/commerce/RevenueOverviewPanels.tsx`                 |  112 | Admin revenue overview 组件，承载 revenue stats、review queue 与 billing reconcile action                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/host-next/components/admin/pages/commerce/RevenueOrderEvidence.tsx`                  |  312 | Admin revenue 订单证据组件，承载 order evidence drawer、revenue pulse、daily buckets、order ledger、移动订单列表、SKU catalog 与 provider event timeline                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/host-next/components/admin/pages/commerce/RevenueEntitlementWorkspace.tsx`           |  170 | Admin entitlements 工作区组件，承载 manual grant、entitlement detail drawer 与 entitlement ledger wiring                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/host-next/components/admin/pages/commerce/RevenueEntitlementLedger.tsx`              |  299 | Admin entitlements ledger 组件，承载 filter bar、desktop table、mobile list、override/revoke row actions 与 pagination                                                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/host-next/components/admin/pages/data/UsageAnalyticsPages.tsx`                       |  337 | 已从 DataPages.tsx 拆出的 analytics 页面；本轮已将 usage/metering 页面迁入 `UsagePages.tsx`，并将 analytics charts/evidence/model 迁入局部组件                                                                                                                                                                                                                                                                                                                                                                              |
| `apps/host-next/components/admin/pages/data/UsageAnalyticsCharts.tsx`                      |  120 | Admin analytics 图表组件，承载 usage/revenue/growth 三组 ChartPanel 与 drilldown                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `apps/host-next/components/admin/pages/data/UsageAnalyticsEvidence.tsx`                    |  268 | Admin analytics evidence 组件，承载 data quality panel 与 revenue/growth/churn/usage/cohort/reliability/raw counts tables                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/host-next/components/admin/pages/data/UsageAnalyticsPageModel.ts`                    |  104 | Admin analytics 数据类型、bucket 统计、peak bucket 与 compact JSON helper                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/host-next/components/admin/pages/data/UsagePages.tsx`                                |  218 | Admin usage/metering 页面主体，保留 usage stats、metering review、quota/plan context、usage/metering charts 与 records section wiring                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/host-next/components/admin/pages/data/UsageRecordsSection.tsx`                       |  171 | Admin usage/metering records section，承载 filter bar、metering/usage desktop tables、mobile list 与 audit/module links                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/host-next/components/admin/pages/data/UsagePageModel.ts`                             |   56 | Admin usage 页面模型 helper，承载 table query 清洗、compact JSON 与 metering status filter options                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/host-next/components/admin/pages/data/FilePages.tsx`                                 |  152 | 已从 DataPages.tsx 拆出的 file storage 列表页面；本轮已将 file detail、storage governance panels 与 directory bulk/filter/records/pagination 迁入局部组件，当前保留 query/filter/pagination model 与子组件 wiring                                                                                                                                                                                                                                                                                                           |
| `apps/host-next/components/admin/pages/data/FileStorageGovernancePanels.tsx`               |  341 | Admin files storage governance 组件，承载 storage stats/review、quota/business impact、orphan governance、reconcile evidence 与 deleted object cleanup action                                                                                                                                                                                                                                                                                                                                                               |
| `apps/host-next/components/admin/pages/data/FileDetailPage.tsx`                            |  222 | Admin file detail 页面，承载 storage object、access/cleanup、metadata code block、audit timeline 与 snapshot drawer                                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/host-next/components/admin/pages/data/FileDirectorySection.tsx`                      |  111 | Admin files directory 组装组件，承载 bulk action、filter、records 与 pagination 的 wiring                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/host-next/components/admin/pages/data/FileDirectoryBulkActionPanel.tsx`              |   58 | Admin files directory 批量操作组件，承载 current filter archive/delete 表单与确认提交                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/host-next/components/admin/pages/data/FileDirectoryFilters.tsx`                      |  147 | Admin files directory 过滤组件，承载基础搜索/status/module 与 owner/MIME/provider/path/date/size advanced filters                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/host-next/components/admin/pages/data/FileDirectoryRecords.tsx`                      |  177 | Admin files directory 记录组件，承载 desktop DataTable、mobile list、media/audit links 与 quarantine/archive/delete/restore row actions                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/host-next/components/admin/pages/data/FileDirectoryPageModel.ts`                     |   82 | Admin files directory helper，承载 pagination href 与 file status option 常量                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `apps/host-next/components/admin/pages/modules/ModulePages.tsx`                            |  256 | 模块管理页主体；本轮已将 detail 页、inventory overview、catalog/table/list/pagination 与共享 page model 迁出，当前保留 stats、review queue 与子组件 wiring                                                                                                                                                                                                                                                                                                                                                                  |
| `apps/host-next/components/admin/pages/modules/ModuleInventoryOverview.tsx`                |  175 | Admin modules inventory overview，承载 inventory lanes、runtime host snapshot 与 product area map                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/host-next/components/admin/pages/modules/ModuleDetailPage.tsx`                       |  233 | Admin module detail 页主体，承载 capability narrative、AI fix prompt、snapshot drawer，并组合 product shape、operational metadata 与 detail evidence 组件                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/host-next/components/admin/pages/modules/ModuleProductShapePanel.tsx`                |   85 | Admin module detail product shape 面板，承载 product kind/audience/shell/navigation/page tables 与 empty state                                                                                                                                                                                                                                                                                                                                                                                                              |
| `apps/host-next/components/admin/pages/modules/ModuleOperationalMetadataPanel.tsx`         |   86 | Admin module detail operational metadata 面板，承载 runs/webhooks/audit links、owner/runbook/replacement/release facts                                                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/host-next/components/admin/pages/modules/ModuleDetailEvidence.tsx`                   |   44 | Admin module detail evidence 组装组件，承载 contract evidence 与 runtime diagnostics evidence wiring                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/host-next/components/admin/pages/modules/ModuleContractEvidence.tsx`                 |  163 | Admin module detail contract evidence 组装组件，承载 capability map、module root/release metadata 与 risk/gateway/extension evidence wiring                                                                                                                                                                                                                                                                                                                                                                                 |
| `apps/host-next/components/admin/pages/modules/ModuleContractRiskEvidence.tsx`             |  113 | Admin module detail contract risk evidence，承载 high-risk permissions、public APIs、webhooks、secrets/resources 与 risk score                                                                                                                                                                                                                                                                                                                                                                                              |
| `apps/host-next/components/admin/pages/modules/ModuleContractGatewayEvidence.tsx`          |   70 | Admin module detail contract gateway evidence，承载 routes 与 host gateway exposure tables                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `apps/host-next/components/admin/pages/modules/ModuleContractExtensionEvidence.tsx`        |   63 | Admin module detail contract extension evidence，承载 navigation/surface contribution 与 provider/resource requirements                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/host-next/components/admin/pages/modules/ModuleRuntimeDiagnosticsEvidence.tsx`       |  124 | Admin module detail runtime evidence，承载 runtime activity 与 diagnostics tables                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/host-next/components/admin/pages/modules/ModuleDetailEvidenceModel.ts`               |    9 | Admin module detail evidence 类型/helper，承载 detail module/contract/diagnostics 类型与 join helper                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/host-next/components/admin/pages/modules/ModuleCatalogSection.tsx`                   |   78 | Admin module catalog 组装组件，保留 pagination 计算、panel shell、toolbar、records 与 pagination wiring                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/host-next/components/admin/pages/modules/ModuleCatalogToolbar.tsx`                   |   93 | Admin module catalog toolbar，承载 filter bar、filter result hint 与 needs review/required/activity/visible summary chips                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/host-next/components/admin/pages/modules/ModuleCatalogRecords.tsx`                   |  220 | Admin module catalog records，承载 desktop DataTable、mobile list、status enable/disable 与 maintenance row actions                                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/host-next/components/admin/pages/modules/ModuleCatalogPageModel.ts`                  |   81 | Admin module catalog helper，承载 pagination href 与 module status filter options                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/host-next/components/admin/pages/modules/ModulePageModel.ts`                         |  167 | Admin module 页面共享模型与 helper，承载 product area、category、capability phrases、release impact 与 operator next action                                                                                                                                                                                                                                                                                                                                                                                                 |
| `apps/host-next/components/admin/pages/identity/IdentityPages.tsx`                         |    3 | Admin identity 兼容导出壳，仅转发 users、user detail 与 RBAC 页面                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/host-next/components/admin/pages/identity/UsersPage.tsx`                             |  188 | Admin users 目录页主体，保留 stats、review queue、directory panel、pagination 与 directory 子组件 wiring                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/host-next/components/admin/pages/identity/UsersDirectoryFilters.tsx`                 |   87 | Admin users directory filters，承载 search/status/role filter form 与 clear action                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/host-next/components/admin/pages/identity/UsersDirectoryRecords.tsx`                 |  186 | Admin users directory records，承载 desktop DataTable、mobile list、verification/activity/timestamp 展示与 billing/entitlements/audit links                                                                                                                                                                                                                                                                                                                                                                                 |
| `apps/host-next/components/admin/pages/identity/UsersDirectoryModel.tsx`                   |   38 | Admin users directory helper，承载 filter result hint 与 status/role filter options                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/host-next/components/admin/pages/identity/UserDetailPage.tsx`                        |  296 | Admin user detail 页主体，承载 account status/role/password reset actions、session revoke、audit timeline、metadata 与 user facts                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/host-next/components/admin/pages/identity/RbacPage.tsx`                              |  329 | Admin RBAC 页面主体，承载 stats、role management table、permission search/filter、permission matrix、diff view 与 coverage timeline                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/host-next/components/admin/pages/identity/IdentityPageModel.ts`                      |  194 | Admin identity 共享模型 helper，承载 auth summary、email verification state、review reason、table query 归一、pagination href 与 filter match helper                                                                                                                                                                                                                                                                                                                                                                        |

本次验证：

- `test:web-shell` 本轮复跑 75 个子测试全部通过；原始 auth transactional email 子项失败已修复。
- 本轮已在本地临时 `host:dev`（`PLOYKIT_ENABLE_DEMO_USERS=1`，用于真实登录种子）执行 `host:browser-matrix -- --required --base-url http://localhost:3000`、`host:accessibility-smoke -- --required --base-url http://localhost:3000`、`admin:ui-gate`，均通过。
- browser matrix 覆盖 35 条基础 route、桌面/移动视口、登录态 Dashboard/Admin、Admin 移动抽屉和全局搜索交互，报告写入 `.runtime/browser-matrix/2026-06-14T11-00-29-728Z/matrix.json`。
- accessibility smoke 覆盖 10 条基础 route、桌面/移动视口、命名控件、表单 label、图片 alt、重复 id、主区域/标题、横向溢出、Tab 焦点和 console error，报告写入 `.runtime/accessibility-smoke/2026-06-14T11-00-29-991Z/accessibility-smoke.json`。
- admin UI gate 扫描 45 个 Admin 文件，0 error/0 warning，报告写入 `.runtime/admin-ui-gate/2026-06-14T10-53-08.579Z/admin-ui-gate.json`。
- 已完成：`AdminWebhooksOperationsPage` 与 `AdminWebhookDetailOperationsPage` 迁入 `apps/host-next/components/admin/pages/operations/WebhookPages.tsx`，`OperationsPages.tsx` 保持转发导出，外部 `AdminPages` API 不变；已复跑 `npm run typecheck` 与 `npm run test:production-runtime` 通过。
- 已完成：`AdminWebhooksOperationsPage` 的列表页 page model 迁入 `apps/host-next/components/admin/pages/operations/WebhookPageModel.ts`，组件主体保留渲染和 action wiring；已复跑 `npm run typecheck`、`npm run test:web-shell -- --test-name-pattern "X8 admin dead-letter|X11 admin worker status|M6 host worker"` 与 `npm run test:production-runtime` 通过。
- 已完成：`AdminWebhooksOperationsPage` 的 worker status、bulk action、drain scope 与 queue pulse 展示迁入 `apps/host-next/components/admin/pages/operations/WebhookWorkerPanels.tsx`，页面主体保留模型调用和后续 delivery lanes/records/detail 渲染；已复跑 `npm run typecheck`、`npm run test:web-shell -- --test-name-pattern "X8 admin dead-letter|X11 admin worker status|M6 host worker"` 与 `npm run test:production-runtime` 通过。
- 已完成：`AdminWebhooksOperationsPage` 的 delivery lanes、filter bar、outbox/receipt records table 与 compact row actions 迁入 `apps/host-next/components/admin/pages/operations/WebhookDeliveryTables.tsx`，页面主体继续保持模型调用、worker panels、delivery tables 和 detail 页面 wiring；已复跑 `npm run typecheck`、`npm run test:web-shell -- --test-name-pattern "X8 admin dead-letter|X11 admin worker status|M6 host worker"` 与 `npm run test:production-runtime` 通过。
- 已完成：`AdminWebhookDetailOperationsPage` 的 retry、discard、archive action panel 迁入 `apps/host-next/components/admin/pages/operations/WebhookDetailActions.tsx`，detail 页面主体继续保持 evidence/tables/drawer wiring；已复跑 `npm run typecheck`、`npm run test:web-shell -- --test-name-pattern "X8 admin dead-letter|X11 admin worker status|M6 host worker"` 与 `npm run test:production-runtime` 通过。
- 已完成：`AdminWebhookDetailOperationsPage` 的 related operations 与 payload/metadata/error redacted evidence 迁入 `apps/host-next/components/admin/pages/operations/WebhookDetailEvidence.tsx`，detail 页面主体继续保持 tables/drawer wiring；已复跑 `npm run typecheck`、`npm run test:web-shell -- --test-name-pattern "X8 admin dead-letter|X11 admin worker status|M6 host worker"` 与 `npm run test:production-runtime` 通过。
- 已完成：`AdminWebhookDetailOperationsPage` 的 receipt retry table、delivery ledger table 与 audit timeline 迁入 `apps/host-next/components/admin/pages/operations/WebhookDetailTables.tsx`，detail 页面主体继续保持 drawer wiring；已复跑 `npm run typecheck`、`npm run test:web-shell -- --test-name-pattern "X8 admin dead-letter|X11 admin worker status|M6 host worker"` 与 `npm run test:production-runtime` 通过。
- 已完成：`AdminWebhookDetailOperationsPage` 的 outbox snapshot drawer、copy ID 和 fact list 迁入 `apps/host-next/components/admin/pages/operations/WebhookDetailDrawer.tsx`，detail 页面主体只保留页面 layout 与子组件 wiring；已复跑 `npm run typecheck`、`npm run test:web-shell -- --test-name-pattern "X8 admin dead-letter|X11 admin worker status|M6 host worker"` 与 `npm run test:production-runtime` 通过。
- 已完成：`AdminRunsOperationsPage` 与 `AdminRunDetailOperationsPage` 迁入 `apps/host-next/components/admin/pages/operations/RunsPages.tsx`，`OperationsPages.tsx` 保持转发导出，外部 `AdminPages` API 不变；已复跑 `npm run typecheck` 与 `npm run test:production-runtime` 通过。
- 已完成：`AdminRunDetailOperationsPage` 迁入 `apps/host-next/components/admin/pages/operations/RunDetailPage.tsx`，`RunsPages.tsx` 继续 re-export detail 页面并保留 runs list 的 queue stats、review queue、lane map、filters、desktop/mobile table 与 pagination，外部 `AdminPages`/`OperationsPages` API 不变；已复跑 `npm run typecheck`、`npm run test:web-shell -- --test-name-pattern "M6 host scoped runs|X8 admin dead-letter|M6 host worker|X11 admin worker status|K6 host worker"` 与 `npm run test:production-runtime` 通过。
- 已完成：`AdminServiceConnectionsOperationsPage` 迁入 `apps/host-next/components/admin/pages/operations/ServiceConnectionsPages.tsx`，`OperationsPages.tsx` 收缩为 service-connections/runs/webhooks 兼容转发导出，外部 `AdminPages` API 不变；已复跑 `npm run typecheck`、`npm run test:web-shell -- --test-name-pattern "A4 service connection|X11 admin provider status|X11 config doctor|K4 host security"` 与 `npm run test:production-runtime` 通过。
- 已完成：`AdminServiceConnectionsOperationsPage` 的 provider readiness、connection call timeline 与 config diagnostics evidence panels 迁入 `apps/host-next/components/admin/pages/operations/ServiceConnectionEvidencePanels.tsx`，service connections 页面主体继续保持 summary、detail drawer、maintenance forms、filters/table 和 actions wiring；已复跑 `npm run typecheck`、`npm run test:web-shell -- --test-name-pattern "A4 service connection|X11 admin provider status|X11 config doctor|K4 host security"` 与 `npm run test:production-runtime` 通过。
- 已完成：`AdminServiceConnectionsOperationsPage` 的 create/update policy/secret rotation/call log retention maintenance forms 迁入 `apps/host-next/components/admin/pages/operations/ServiceConnectionMaintenancePanel.tsx`，service connections 页面主体继续保持 summary、detail drawer、filters/table 和 actions wiring；同时清理从旧 operations 聚合遗留的无用 import/type；已复跑 `npm run typecheck`、`npm run test:web-shell -- --test-name-pattern "A4 service connection|X11 admin provider status|X11 config doctor|K4 host security"` 与 `npm run test:production-runtime` 通过。
- 已完成：`AdminServiceConnectionsOperationsPage` 的 table query form、advanced filters、desktop DataTable、mobile list 与 row actions 迁入 `apps/host-next/components/admin/pages/operations/ServiceConnectionTableSection.tsx`，service connections 页面主体继续保持 summary、detail drawer、review queue 和子组件 wiring；已复跑 `npm run typecheck`、`npm run test:web-shell -- --test-name-pattern "A4 service connection|X11 admin provider status|X11 config doctor|K4 host security"` 与 `npm run test:production-runtime` 通过。
- 已完成：`AdminFilesOperationsPage` 与 `AdminFileDetailOperationsPage` 迁入 `apps/host-next/components/admin/pages/data/FilePages.tsx`，`DataPages.tsx` 保持转发导出，外部 `AdminPages`/`FilePages` API 不变；已复跑 `npm run typecheck` 与 `npm run test:production-runtime` 通过。
- 已完成：`AdminFileDetailOperationsPage` 迁入 `apps/host-next/components/admin/pages/data/FileDetailPage.tsx`，`FilePages.tsx` 继续 re-export detail 页面并保留 files list/reconcile/table wiring，外部 `AdminPages`/`DataPages` API 不变；已复跑 `npm run typecheck`、`npm run test:web-shell -- --test-name-pattern "A10/A11 admin files|D22 admin file detail|M6 host file|X12 host file quota"` 与 `npm run test:production-runtime` 通过。
- 已完成：`AdminFilesOperationsPage` 的 bulk action、directory filters、advanced filters、desktop table、mobile list、row actions 与 pagination 迁入 `apps/host-next/components/admin/pages/data/FileDirectorySection.tsx`，`FilePages.tsx` 保留 stats、storage review、quota、orphan governance、reconcile 与 cleanup wiring；已复跑 `npm run typecheck`、`npm run test:web-shell -- --test-name-pattern "A10/A11 admin files|D22 admin file detail|M6 host file|X12 host file quota"` 与 `npm run test:production-runtime` 通过。
- 已完成：`AdminUsageOperationsPage` 与 `AdminAnalyticsOperationsPage` 迁入 `apps/host-next/components/admin/pages/data/UsageAnalyticsPages.tsx`，`DataPages.tsx` 保持转发导出，外部 `AdminPages` API 不变；已复跑 `npm run typecheck` 与 `npm run test:production-runtime` 通过。
- 已完成：`AdminUsageOperationsPage` 迁入 `apps/host-next/components/admin/pages/data/UsagePages.tsx`，`UsageAnalyticsPages.tsx` 保留 analytics 页面并清理 usage 旧聚合残留 helpers/imports，`DataPages.tsx` 分别转发 usage 与 analytics 页面，外部 `AdminPages` API 不变；已复跑 `npm run typecheck`、`npm run test:web-shell -- --test-name-pattern "A8/A9 admin analytics|X2 scope, notification, billing and admin APIs"` 与 `npm run test:production-runtime` 通过。
- 已完成：`AdminAnalyticsOperationsPage` 的 analytics charts、data quality 与 evidence tables 迁入 `apps/host-next/components/admin/pages/data/UsageAnalyticsCharts.tsx`、`UsageAnalyticsEvidence.tsx` 和 `UsageAnalyticsPageModel.ts`，页面主体只保留 shell、filters、insight 与 segmented overview wiring；已复跑 `npm run typecheck`、`npm run test:web-shell -- --test-name-pattern "A8/A9 admin analytics|X2 scope, notification, billing and admin APIs"` 与 `npm run test:production-runtime` 通过。
- 已完成：`AdminRevenueOperationsPage` 与 `AdminEntitlementsOperationsPage` 迁入 `apps/host-next/components/admin/pages/commerce/RevenuePages.tsx`，`CommercePages.tsx` 保持转发导出，外部 `AdminPages`/`BillingPages` API 不变；已复跑 `npm run typecheck` 与 `npm run test:production-runtime` 通过。
- 已完成：清理 `apps/host-next/components/admin/pages/commerce/CommercePages.tsx` 旧聚合残留 imports/types/helpers，文件收缩为 2 行兼容转发导出壳；`AdminBillingOperationsPage` 继续由 `BillingPages.tsx` 提供，`AdminRevenueOperationsPage`/`AdminEntitlementsOperationsPage` 继续由 `RevenuePages.tsx` 提供，外部 `AdminPages`/`BillingPages` API 不变；已复跑 `npm run typecheck`、`npm run test:web-shell -- --test-name-pattern "X6 admin entitlement|A8 admin entitlement|A8 admin commercial|X6 host billing|A7 admin billing|M6 host commercial"` 与 `npm run test:production-runtime` 通过。
- 已完成：`AdminBillingOperationsPage` 的 table query 归一、商业记录过滤、异常 review item、order benefit summary、order context links 与 plan/SKU 分组迁入 `apps/host-next/components/admin/pages/commerce/BillingPageModel.ts`，`BillingPages.tsx` 保留页面渲染和 action wiring，外部 `AdminPages`/`BillingPages` API 不变；已复跑 `npm run typecheck`、`npm run test:web-shell -- --test-name-pattern "X6 admin entitlement|A8 admin entitlement|A8 admin commercial|X6 host billing|A7 admin billing|M6 host commercial"` 与 `npm run test:production-runtime` 通过。
- 已完成：`AdminBillingOperationsPage` 的 catalog authoring 表单迁入 `apps/host-next/components/admin/pages/commerce/BillingCatalogAuthoring.tsx`，页面主体只传入 `lang`、`upsertPlanAction` 与 `upsertSkuAction`，外部 `AdminPages`/`BillingPages` API 不变；已复跑 `npm run typecheck`、`npm run test:web-shell -- --test-name-pattern "X6 admin entitlement|A8 admin entitlement|A8 admin commercial|X6 host billing|A7 admin billing|M6 host commercial"` 与 `npm run test:production-runtime` 通过。
- 已完成：`AdminBillingOperationsPage` 的 ledger evidence 面板迁入 `apps/host-next/components/admin/pages/commerce/BillingLedgerEvidence.tsx`，页面主体只传入 `lang` 与 `billingModel`，外部 `AdminPages`/`BillingPages` API 不变；已复跑 `npm run typecheck`、`npm run test:web-shell -- --test-name-pattern "X6 admin entitlement|A8 admin entitlement|A8 admin commercial|X6 host billing|A7 admin billing|M6 host commercial"` 与 `npm run test:production-runtime` 通过。
- 已完成：`AdminBillingOperationsPage` 的 settlement evidence 面板迁入 `apps/host-next/components/admin/pages/commerce/BillingSettlementEvidence.tsx`，页面主体只传入 `lang` 与 `commercial`，外部 `AdminPages`/`BillingPages` API 不变；已复跑 `npm run typecheck`、`npm run test:web-shell -- --test-name-pattern "X6 admin entitlement|A8 admin entitlement|A8 admin commercial|X6 host billing|A7 admin billing|M6 host commercial"` 与 `npm run test:production-runtime` 通过。
- 已完成：`AdminBillingOperationsPage` 的 commercial catalog workspace 迁入 `apps/host-next/components/admin/pages/commerce/BillingCatalogWorkspace.tsx`，页面主体只传入 `lang`、`billingModel` 与 archive/sync actions，外部 `AdminPages`/`BillingPages` API 不变；已复跑 `npm run typecheck`、`npm run test:web-shell -- --test-name-pattern "X6 admin entitlement|A8 admin entitlement|A8 admin commercial|X6 host billing|A7 admin billing|M6 host commercial"` 与 `npm run test:production-runtime` 通过。
- 已完成：`AdminBillingOperationsPage` 的 order detail drawer 与 business lanes 迁入 `apps/host-next/components/admin/pages/commerce/BillingOrderDetailDrawer.tsx` 和 `apps/host-next/components/admin/pages/commerce/BillingBusinessLanes.tsx`，页面主体只保留 billing operating model、review queue 与子组件 wiring，外部 `AdminPages`/`BillingPages` API 不变；已复跑 `npm run typecheck`、`npm run test:web-shell -- --test-name-pattern "X6 admin entitlement|A8 admin entitlement|A8 admin commercial|X6 host billing|A7 admin billing|M6 host commercial"` 与 `npm run test:production-runtime` 通过。
- 已完成：`AdminRevenueOperationsPage` 与 `AdminEntitlementsOperationsPage` 共享的 table query、pagination href、compact JSON、order benefit summary、metadata order id 与 order context links 迁入 `apps/host-next/components/admin/pages/commerce/RevenuePageModel.ts`，`RevenuePages.tsx` 保留页面渲染和 action wiring，外部 `AdminPages`/`BillingPages` API 不变；已复跑 `npm run typecheck`、`npm run test:web-shell -- --test-name-pattern "X6 admin entitlement|A8 admin entitlement|A8 admin commercial|X6 host billing|A7 admin billing|M6 host commercial"` 与 `npm run test:production-runtime` 通过。
- 已完成：`AdminRevenueOperationsPage` 的 order evidence drawer、revenue pulse、daily buckets、order ledger、移动订单列表、SKU catalog 与 provider event timeline 迁入 `apps/host-next/components/admin/pages/commerce/RevenueOrderEvidence.tsx`，页面主体保留 revenue stats、review queue、reconcile action 与子组件 wiring，外部 `AdminPages`/`BillingPages` API 不变；已复跑 `npm run typecheck`、`npm run test:web-shell -- --test-name-pattern "X6 admin entitlement|A8 admin entitlement|A8 admin commercial|X6 host billing|A7 admin billing|M6 host commercial"` 与 `npm run test:production-runtime` 通过。
- 已完成：`AdminEntitlementsOperationsPage` 的 manual grant、entitlement detail drawer、ledger table、移动列表、override/revoke actions 与 pagination 迁入 `apps/host-next/components/admin/pages/commerce/RevenueEntitlementWorkspace.tsx`，页面主体保留 entitlement stats、review queue、上下文模型和子组件 wiring，外部 `AdminPages`/`BillingPages` API 不变；已复跑 `npm run typecheck`、`npm run test:web-shell -- --test-name-pattern "X6 admin entitlement|A8 admin entitlement|A8 admin commercial|X6 host billing|A7 admin billing|M6 host commercial"` 与 `npm run test:production-runtime` 通过。
- 已完成：`DashboardLandingPage` 迁入 `apps/host-next/components/dashboard/pages/LandingPage.tsx`，`DashboardPages.tsx` 保持转发导出，外部 `@host/components/dashboard/DashboardPages` API 不变；已复跑 `npm run typecheck`、`npm run test:web-shell -- --test-name-pattern "P10 host shell resolves dashboard|X2 host user APIs|X4 product scope|X4 workspace"` 与 `npm run test:production-runtime` 通过。
- 已完成：`DashboardProfileOperationsPage` 迁入 `apps/host-next/components/dashboard/pages/ProfilePage.tsx`，`DashboardPages.tsx` 保持转发导出，外部 `@host/components/dashboard/DashboardPages` API 不变；同时清理 DashboardPages.tsx 中旧聚合残留 imports/types；已复跑 `npm run typecheck`、`npm run test:web-shell -- --test-name-pattern "P10 host shell resolves dashboard|X2 host user APIs|X9 notifications"` 与 `npm run test:production-runtime` 通过。
- 已完成：`DashboardWorkspacesOperationsPage` 迁入 `apps/host-next/components/dashboard/pages/WorkspacesPage.tsx`，`DashboardPages.tsx` 收缩为 29 行兼容导出壳，外部 `@host/components/dashboard/DashboardPages` API 不变；已复跑 `npm run typecheck`、`npm run test:web-shell -- --test-name-pattern "P10 host shell resolves dashboard|X4 product scope|X4 workspace"` 与 `npm run test:production-runtime` 通过。
- 已完成：`DashboardTasksOperationsPage` 与 `DashboardTaskDetailOperationsPage` 迁入 `apps/host-next/components/dashboard/pages/TaskPages.tsx`，`DashboardPages.tsx` 保持转发导出，外部 `DashboardPages` API 不变；已复跑 `npm run typecheck` 与 `npm run test:production-runtime` 通过。
- 已完成：`DashboardFilesOperationsPage` 迁入 `apps/host-next/components/dashboard/pages/FilePages.tsx`，`DashboardPages.tsx` 保持转发导出，外部 `DashboardPages`/`FilePages` API 不变；已复跑 `npm run typecheck` 与 `npm run test:production-runtime` 通过。
- 已完成：`DashboardBillingOperationsPage`、`DashboardOrdersOperationsPage` 与 `DashboardCreditHistoryOperationsPage` 迁入 `apps/host-next/components/dashboard/pages/CommercialPages.tsx`，`DashboardPages.tsx` 保持转发导出，外部 `DashboardPages`/`BillingPages` API 不变；已复跑 `npm run typecheck` 与 `npm run test:production-runtime` 通过。
- 已完成：`DashboardBillingOperationsPage`、`DashboardOrdersOperationsPage` 与 `DashboardCreditHistoryOperationsPage` 分别迁入 `apps/host-next/components/dashboard/pages/DashboardBillingPage.tsx`、`DashboardOrdersPage.tsx`、`DashboardCreditHistoryPage.tsx`，`CommercialPages.tsx` 收缩为 3 行兼容转发导出壳；已复跑 `npm run typecheck`、`npm run test:web-shell -- --test-name-pattern "P10 host shell resolves dashboard|X6 host billing|M6 host commercial|M6 user SaaS snapshot|billing overview|Stripe checkout"` 与 `npm run test:production-runtime` 通过。
- 已完成：`DashboardPageUtils.tsx` 的 commerce/status/scope/task/file/notification formatting helper 迁入 `DashboardPageFormatting.ts` 与 6 个领域 formatting 文件，`DashboardPageUtils.tsx` 只保留共享 UI primitives 与 re-export 兼容入口，外部页面导入路径不变；已复跑 `npm run typecheck`、`npm run test:web-shell -- --test-name-pattern "P10 host shell resolves dashboard|X2 host user APIs|X4 product scope|X4 workspace|X6 host billing|M6 host commercial|M6 user SaaS snapshot|billing overview|Stripe checkout|X9 notifications|M6 host file|X12 host file quota"` 与 `npm run test:production-runtime` 通过。

风险：

- 本地真实浏览器证据已补齐基础矩阵，但仍不能替代线上域名、生产构建、真实账号/真实数据量下的视觉和交互回归。
- 大页面持续增长会导致回归定位困难。

建议：

- 当前 admin pages 已无超过 350 行的聚合页；后续优先守住 350 行阈值，并避免已收缩的 `DevConsolePages.tsx`、`SettingsPages.tsx`、`GovernancePages.tsx`、`OverviewPages.tsx`、`DashboardPageUtils.tsx`、`OperationsPageUtils.tsx`、`BillingPageModel.ts`、`RevenueEntitlementWorkspace.tsx`、`ModuleDetailPage.tsx`、`ModulePages.tsx`、`apps/host-next/components/admin/pages/data/FilePages.tsx`、`RunDetailPage.tsx`、`RevenuePages.tsx`、`RunsPages.tsx`、`ServiceConnectionsPages.tsx`、`ServiceConnectionMaintenancePanel.tsx`、`ModuleContractEvidence.tsx`、`ModuleDetailEvidence.tsx`、`UsersPage.tsx`、`UsagePages.tsx`、`ModuleCatalogSection.tsx`、`BillingLedgerEvidence.tsx`、`WorkspacesPage.tsx`、`FileDirectorySection.tsx`、`CommercialPages.tsx`、`IdentityPages.tsx`、`UsageAnalyticsPages.tsx`、`BillingPages.tsx`、`DashboardPages.tsx`、`CommercePages.tsx` 重新膨胀。
- 拆分顺序：formatter/helper -> table/view components -> dialogs -> page model/hook。
- 发布前跑 `host:browser-matrix`、`host:accessibility-smoke`、`admin:ui-gate`。

## 11. 可观测性、审计与恢复分析

当前项目已经有较多审计和恢复迹象：

- Admin audit API。
- Worker status、queue lag、dead-letter replay/discard/archive。
- Provider invocation evidence。
- Email delivery ledger。
- Commercial provider event idempotency。
- Files cleanup/reconcile smoke 脚本，本轮已执行并写入 `.runtime/files-cleanup/2026-06-14T10-30-22-639Z/files-cleanup-smoke.json`、`.runtime/files-reconcile/2026-06-14T10-30-42-822Z/files-reconcile-smoke.json`。
- Backup/restore、upgrade migration、chaos smoke 脚本；本轮已执行 chaos smoke，报告写入 `.runtime/chaos/2026-06-14T10-37-57-391Z/chaos.json`。
- Worker soak 脚本；本轮已执行 required worker soak，报告写入 `.runtime/worker-soak/2026-06-14T10-37-57-418Z/soak.json`。

优势：

- 运营面不是后补文档，代码里已经有 Admin operations 和 evidence 体系。
- release evidence 脚本存在，且本轮已修复为可自管本地 production host 生命周期并在完整 required 模式下通过。

风险：

- 本次已跑完整 `release:evidence --required`，其中覆盖 backup/restore、upgrade migration、files cleanup/reconcile、worker soak、chaos、provider matrix、RAG provider smoke、AI webhook smoke、host smoke、browser matrix、accessibility smoke 和 maintainer gate；真实外部 provider smoke 仍未在正式凭据环境执行。
- Admin operations 兼容壳已从约 2736 行降到 3 行，entitlement、delivery/outbox、host settings、files、audit retention、commercial view、runs detail/actions、service connections 页面及 evidence/maintenance/table panels、module operations、module operation model、module dev-console view、worker runtime status/drain、worker soak evidence 读取、worker readiness presenter、Dashboard landing/profile/workspaces、Webhook 列表页 page model、worker panels、delivery tables、detail actions、detail evidence、detail tables 与 detail drawer 已先行拆出；Webhook 与 service connections 页面主体均已收敛为 page-level wiring，后续复杂度治理应转向其他大页面或进一步抽通用表单/表格 primitives。

建议：

- maintainer gate 中强制带上 worker soak、chaos、backup/restore、upgrade migration。
- Admin 操作按领域继续拆分：worker runtime status/drain 已拆到 `apps/host-next/lib/admin-worker-operations.ts`，worker soak evidence 读取已拆到 `apps/host-next/lib/admin-worker-evidence.ts`，worker readiness presenter 已拆到 `apps/host-next/lib/admin-worker-readiness.ts`，module operations 已拆到 `apps/host-next/lib/admin-module-operations.ts`，module row/model helper 已拆到 `apps/host-next/lib/admin-module-operation-model.ts`，dev-console view 已拆到 `apps/host-next/lib/admin-module-dev-console.ts`，settings 已拆到 `apps/host-next/lib/admin-settings.ts`，files 已拆到 `apps/host-next/lib/admin-files.ts`，audit mutation 已拆到 `apps/host-next/lib/admin-audit.ts`，commercial view 已拆到 `apps/host-next/lib/admin-commercial.ts`，runs detail/actions 已拆到 `apps/host-next/lib/admin-runs.ts`，后续不要再从 `admin-operations.ts` 回流运行时导出。
- 为恢复操作建立统一审计 envelope。

## 12. 文档与发布治理分析

当前文档基础较好：

- README 中英文入口。
- 中文 docs 覆盖模块开发、契约、安全、部署、runtime stores、服务接入、AI 辅助。
- 本次新增治理手册。
- `docs:encoding-check` 通过。

当前新增/变更：

- 新增 `docs/production-grade-analysis-playbook.zh-CN.md`。
- 本报告新增 `docs/production-grade-code-analysis-2026-06-14.zh-CN.md`。
- 已完成：中文索引已加入两份文档，并将治理类文档按“方法论与当前分析”“历史审计与迁移计划”“发布与执行边界”分组。

风险：

- 历史审计文档中保留了历史 RunLynk/external module 证据；`project-code-audit.zh-CN.md` 顶部已有历史状态说明，中文索引也已在历史审计与迁移计划分组中提示按文内日期和状态说明阅读。
- 文档数量增多后仍需持续维护分组边界，避免新增治理文档重新混入核心开发文档。

建议：

- 已完成（2026-06-15 本轮实施）：在 `docs/README.zh-CN.md` 中把治理类文档拆为方法论与当前分析、历史审计与迁移计划、发布与执行边界三组，并补入 release checklist、安全执行边界图、运营手册、历史审计与迁移计划入口。
- 完成证据：`docs/README.zh-CN.md` 中 20 个 markdown 文档链接均已验证存在；索引现已区分当前分析、历史审计、方法论手册和发布/执行边界。
- 已完成（2026-06-15 本轮实施）：`project-code-audit.zh-CN.md` 保留顶部“历史状态说明”，`docs/README.zh-CN.md` 在“历史审计与迁移计划”分组中补充统一阅读提示，说明这些文档保留历史状态、迁移路线或一次性治理任务证据。
- 完成证据：`rg -n "历史状态说明|历史审计与迁移计划" docs/project-code-audit.zh-CN.md docs/README.zh-CN.md` 可定位历史说明和索引分组提示；`docs/README.zh-CN.md` 20 个 markdown 文档链接均已验证存在。
- 已完成（2026-06-15 本轮确认）：本报告顶部已写明分析日期、分析对象和“以当前工作树、当前命令输出和当前源码为准”的范围说明。
- 完成证据：`rg -n "分析日期|分析对象|当前工作树" docs/production-grade-code-analysis-2026-06-14.zh-CN.md` 可定位报告日期、工作区对象和当前状态说明。

## 13. 代码体量与复杂度热点

当前最大文件 Top 25（排除生成目录、锁文件、构建产物和文档自身）：

| 文件                                                                 | 行数 |
| -------------------------------------------------------------------- | ---: |
| `apps/host-next/locales/en.json`                                     | 1758 |
| `apps/host-next/locales/zh.json`                                     | 1730 |
| `src/lib/module-runtime/release/rc-gate.ts`                          | 1568 |
| `apps/host-next/lib/commercial-provider.ts`                          | 1320 |
| `apps/host-next/components/admin/shared/AdminPrimitives.tsx`         | 1308 |
| `scripts/host-backup-restore-smoke.ts`                               | 1244 |
| `apps/host-next/lib/admin-service-connections.ts`                    | 1212 |
| `src/lib/module-capabilities/services/service-invocation-runtime.ts` | 1204 |
| `apps/host-next/lib/capability-providers.ts`                         | 1199 |
| `src/lib/module-runtime/security/capability-guard.ts`                | 1137 |
| `apps/host-next/lib/admin-inline-i18n-dictionaries.ts`               | 1134 |
| `src/lib/module-runtime/data/postgres.ts`                            | 1082 |
| `scripts/host-postgres-physical-restore-smoke.ts`                    | 1057 |
| `src/module-sdk/context.ts`                                          | 1036 |
| `src/lib/module-capabilities/commercial/commercial-runtime.ts`       | 1020 |
| `apps/host-next/components/admin/CompositionSettings.tsx`            |  999 |
| `apps/host-next/lib/auth.ts`                                         |  980 |
| `src/lib/module-runtime/stores/runtime-store-migrations.ts`          |  948 |
| `src/lib/module-runtime/stores/runtime-store-types.ts`               |  922 |
| `apps/host-next/app/globals.css`                                     |  876 |
| `src/module-sdk/testing.ts`                                          |  852 |
| `src/lib/module-runtime/stores/postgres-runtime-store-mappers.ts`    |  849 |
| `apps/host-next/lib/admin-provider-status.ts`                        |  823 |
| `scripts/i18n-check.ts`                                              |  813 |
| `scripts/host-rc-evidence.mjs`                                       |  800 |

判断：

- 大测试文件可以接受，但要警惕 fixture 和全局状态污染，本轮已修复的 Web Shell 认证邮件测试、安全运行时 fixture、`services.invoke`、runtime capability guard、data/commercial/risk guard、runtime store Postgres 测试、RC gate fixture、RC gate browser/module quality、RC gate runtime evidence、commercial primitives、commercial provider flows、host runtime routing/fixture、host page presentation/theme/route manifest、host page slot/admin header surfaces，以及 advanced Data CLI diff/migrate dry-run、verify-db、Data command/static helper 拆分都是信号。
- 当前源码、脚本和测试文本文件均已低于 2000 行；capability providers 已拆出 API key provider/verifier helper 并降到 1135 行，backup/restore semantic smoke 已拆出 seed fixture 并降到 1227 行，Admin service connections 已拆出 health probe helper 并降到 1160 行，runtime store 类型契约已拆出 common scope、notification、observability、RAG、identity、risk、file、config/resource、commercial 与 execution 类型块并降到 911 行，Admin inline i18n 运行逻辑已与大词典/短语 fallback 分离并降到 57 行，Admin lib/页面、备份脚本和若干大测试文件仍是 P2 维护性主战场；安全运行时主测试已拆出 fixture、`services.invoke` 专项用例、runtime capability guard 基础专项用例与 data/commercial/risk guard 专项用例，并降到 205 行退出 Top 25，module contract 测试已拆出 theme/white-label/i18n/surface metadata presentation 专项文件并退出 Top 25，host page runtime 测试已拆出 presentation/theme/route manifest 与 slot/admin header surfaces 专项文件并降到 409 行退出 Top 30，runtime store 测试已拆出 Postgres 专项文件，且 Postgres 测试本轮继续拆出 null workspace scope 专项和共享 DB helper，退出 Top 25，RC gate 测试已拆出 fixture module/evidence helper、browser/accessibility/module quality 专项文件与 runtime evidence 专项文件，并降到 597 行退出 Top 25，商业账本测试已拆出 subject-first primitives 专项文件与 provider/revenue/subscription/tax/refund flow 专项文件，host runtime 测试已拆出共享 module fixture 与 routing/metadata/alias 专项文件，advanced runtime 测试已拆出 Data CLI diff/migrate dry-run、verify-db helper/command、Data command helper 与 Data static helper 专项文件，并降到 79 行退出 Top 25；advanced Data 共享 helper 本轮继续把动态 import 和临时 fixture 清理迁入独立文件，`tests/advanced-runtime-data-helpers.ts` 降到 680 行并退出 Top 30；RC gate 已进一步降为 1472 行编排入口，Dashboard 聚合页、runtime store 类型入口、admin inline i18n 运行入口、capability API key provider、backup/restore smoke fixture、Admin service connection health probe 与 memory runtime store 已降为组合/兼容导出壳，后续只需防止实现回流。
- scripts 体量较大，后续 CLI 规则容易分散；本轮已把 `scripts/ploykit-module.mjs` 的模板/扩展 catalog、`module:create` usage、`templates` JSON 清单、service-backed/background overlay 注入、module hash/digest 计算、create 命令编排、contract source parser、doctor diagnostics helper、root help/JSON 输出/argv 分发、顶层错误 reporting、doctor 静态 contract rule group、capability rule group、dependency rule group、module map rule group、source-boundary rule group 与 command execution helper 迁入 `scripts/lib/module-template-catalog.mjs`、`scripts/lib/module-template-extensions.mjs`、`scripts/lib/module-digests.mjs`、`scripts/lib/module-create-command.mjs`、`scripts/lib/module-contract-source.mjs`、`scripts/lib/module-doctor-diagnostics.mjs`、`scripts/lib/module-cli-runner.mjs`、`scripts/lib/module-doctor-contract-rules.mjs`、`scripts/lib/module-doctor-capability-rules.mjs`、`scripts/lib/module-doctor-dependency-rules.mjs`、`scripts/lib/module-doctor-map-rules.mjs`、`scripts/lib/module-doctor-source-boundary-rules.mjs` 和 `scripts/lib/module-command-execution.mjs`；本轮进一步将 backup/restore semantic smoke seed fixture 迁入 `scripts/host-backup-restore-smoke-fixture.ts`，root help 与 `create --help` 继续从同一份 `MODULE_TEMPLATES` / `MODULE_EXTENSIONS` 生成，避免模板列表再次漂移。

建议拆分顺序：

1. 已完成 Web Shell 主要领域测试拆分；本轮进一步将 `tests/security-runtime.test.ts` 的共用 module artifact、API/action loader 计数器和重置 helper 迁入 `tests/security-runtime-fixtures.ts`，将 `services.invoke` 场景迁入 `tests/security-runtime-services.test.ts`，将 connector/service declaration、resource binding、session permission、audit unavailable、notification permission split 等 runtime capability guard 基础场景迁入 `tests/security-runtime-capability-guard.test.ts`，并将 artifact/credits、Data transaction、raw SQL 与 subject-scoped commercial/risk 场景迁入 `tests/security-runtime-data-commercial-guard.test.ts`；主测试文件从 1904 行降到 205 行，fixture 文件 179 行、services 专项测试 619 行、capability guard 基础专项测试 298 行、data/commercial guard 专项测试 668 行，降低 capability guard 与服务调用回归的全局状态噪音。完成证据：`npm run test:security-runtime` 22/22、`npm run typecheck` 通过。
2. 已完成 Postgres runtime store 与 in-memory runtime store 全领域拆分：`postgres-runtime-store.ts` 的 runs repository 已拆到 `postgres-runtime-store-runs.ts`，outbox/delivery repository 已拆到 `postgres-runtime-store-outbox.ts`，worker repository 已拆到 `postgres-runtime-store-workers.ts`，provider invocation repository 已拆到 `postgres-runtime-store-provider-invocations.ts`，audit repository 已拆到 `postgres-runtime-store-audit.ts`，files repository 已拆到 `postgres-runtime-store-files.ts`，identity repository 已拆到 `postgres-runtime-store-identity.ts`，RAG repository 已拆到 `postgres-runtime-store-rag.ts`，risk repository 已拆到 `postgres-runtime-store-risk.ts`，config/resource repository 已拆到 `postgres-runtime-store-config.ts`，product scope repository 已拆到 `postgres-runtime-store-product-scope.ts`，catalog state repository 已拆到 `postgres-runtime-store-catalog.ts`，webhook receipt repository 已拆到 `postgres-runtime-store-webhooks.ts`，notifications repository 已拆到 `postgres-runtime-store-notifications.ts`，usage/metering repository 已拆到 `postgres-runtime-store-metering.ts`，commercial catalog/orders、billing documents、credits/reservations、entitlements、subscriptions/events、tax profiles、revenue/settlement 与 redeem repository 均已独立；in-memory runtime store 已拆出 execution、commercial、billing documents、subscriptions、finance、redeem、identity、RAG、files、config/resource、product scope/catalog、notifications、observability/audit/usage/provider invocation 与 risk helper；本轮已将 `tests/runtime-stores.test.ts` 的两个 Postgres 子项迁入 `tests/runtime-stores-postgres.test.ts`，并进一步把 null workspace 精确过滤迁入 `tests/runtime-stores-postgres-scope.test.ts`、数据库可达性/reset helper 迁入 `tests/runtime-stores-postgres-helpers.ts`。当前 Postgres 主测试 445 行、scope 专项 283 行、helper 50 行。完成证据：`npm run test:runtime-stores` 默认本地 12 个子测试中 10 pass、2 个 Postgres 子项按既有逻辑 skip；`npm run typecheck` 通过。后续重点转向跨 store 语义审计和真实 Postgres 分库/串行 gate 维护。
3. Admin 页面和已拆出的 Dashboard 子页面继续拆 page model、table、dialogs、mutation actions，避免实现回流到聚合壳。
4. `commercial-ledger.ts` 已先拆出 ledger facts/revenue/refund helper、order benefits/credits/entitlements helper、subscriptions helper、tax helper、provider events helper、credits helper、usage/metering helper、module commerce helper、redeem codes helper、risk helper 与 billing/entitlements helper；本轮进一步将 P16 subject-first primitives 大用例迁入 `tests/commercial-ledger-primitives.test.ts`，并将 provider order events、revenue replay、subscription event ordering、tax evidence freeze 与 partial refund flow 迁入 `tests/commercial-ledger-provider-flows.test.ts`，`tests/commercial-ledger.test.ts` 从 1619 行降到 609 行并退出 Top 25。完成证据：`npm run test:commercial-ledger` 10/10、`npm run typecheck` 通过。后续重点转为跨 helper 语义审计、更细的领域测试增强，以及按真实 Provider Smoke 运维手册归档外部凭据环境执行证据。
5. `scripts/module-data.mjs` 已完成 Data CLI 主要领域拆分并降为入口壳；`ploykit-module` 的 parser/reporting、静态 contract rule group、capability rule group、dependency rule group、module map rule group、source-boundary rule group 和 command execution helper 已先抽出，`module-data` 的 generated artifact 写入/静态校验 helper、RLS policy/table verifier、数据库 introspection helper、role safety verifier、DB schema verifier、`verify-db` command flow helper、`migrate` / `reset` DB mutation runner、static command helper、reset SQL helper、command dispatch runner、type generation helper、Data plan normalization helper、migrate/reset dry-run output helper、module.ts loader helper、migrate/reset apply command helper、resolve/path safety helper、command args parser helper、DB verifier composition helper 与 command dependency wiring helper 已先抽出，并已将对应 Data helper 测试拆成 CLI、verify-db、command helper 与 static helper 专项；本轮进一步把测试共享 helper 的动态 import 与临时 fixture 清理拆出，保留 `advanced-runtime-data-helpers.ts` 作为类型契约与兼容 re-export 出口。

已完成（2026-06-16 本轮实施）：新增 `apps/host-next/lib/capability-api-keys.ts`，集中维护 host module API key secret/hash/prefix、owner/scope/permission guard、store-backed API key create/rotate/revoke/list/verify，以及 machine route API key verifier；`apps/host-next/lib/capability-providers.ts` 保留 capability provider 组装和兼容 re-export，当前从 1597 行降到 1199 行。完成证据：`npm run test:api-key-store` 1/1、`npm run test:host-runtime` 21/21、`npm run typecheck` 通过；本轮 touched capability provider 文件 Prettier 已通过。

已完成（2026-06-16 本轮实施）：新增 `scripts/host-backup-restore-smoke-fixture.ts`，集中维护 backup/restore semantic smoke 的固定 product/workspace/module/user/redeem scope 与 38 个 runtime store 语义域 seed fixture；`scripts/host-backup-restore-smoke.ts` 保留 snapshot/fingerprint/restore/report 编排，当前从 1722 行降到 1244 行。完成证据：`npm run host:backup-restore-smoke -- --required` 通过，仍覆盖 38 个 runtime store domain、semantic count/fingerprint/coverage/restore-plan checks 全部为 true；`npm run typecheck` 通过；本轮 touched backup smoke 文件 Prettier 已通过。

已完成（2026-06-16 本轮实施）：新增 `apps/host-next/lib/admin-service-connection-health.ts`，集中维护 Admin service connection 的 signed service readiness probe、HTTP health check、base path joining、egress/private-network/path guard、timeout fetch 与 deterministic fallback latency；`apps/host-next/lib/admin-service-connections.ts` 保留 Admin action、policy normalization、row mapping、audit state 和 view composition，当前从 1529 行降到 1212 行。完成证据：`npx tsx --test tests/web-shell-service-connections.test.ts` 1/1、`npm run test:web-shell -- --test-name-pattern "A4 service connection|X11 admin provider status|X11 config doctor|K4 host security"` 实际执行 76/76 个 Web Shell 子测试并全部通过、`npm run typecheck` 通过；本轮 touched Admin service connection 文件 Prettier 已通过。

已完成（2026-06-16 本轮实施）：新增 `src/lib/module-runtime/stores/runtime-store-execution-types.ts`，集中维护 runtime store 的 run create/list query、outbox status/record/enqueue input、delivery kind/status/record/input、worker status/record/upsert input，以及 webhook receipt status/record/create input 类型；`src/lib/module-runtime/stores/runtime-store-types.ts` 保持原入口 re-export 兼容，当前从 1386 行降到 1222 行。完成证据：`npm run typecheck`、`npm run test:runtime-stores` 默认本地 12 个子测试中 10 pass 且 2 个 Postgres 子项按既有逻辑 skip、`npm run test:background-reliability` 11/11 通过；本轮 touched runtime store 类型文件 Prettier 已通过。

已完成（2026-06-16 本轮实施）：新增 `src/lib/module-runtime/stores/runtime-store-common-types.ts`、`src/lib/module-runtime/stores/runtime-store-notification-types.ts` 与 `src/lib/module-runtime/stores/runtime-store-observability-types.ts`，将 runtime store 共享 scope、notifications/deliveries、audit/usage/provider invocation 类型从主入口迁出；`runtime-store-commercial-types.ts` 与 `runtime-store-execution-types.ts` 改为依赖 common scope，避免拆出类型再反向引用主聚合入口；`src/lib/module-runtime/stores/runtime-store-types.ts` 保持原入口 re-export 兼容，当前降到 1090 行。完成证据：`npm run typecheck`、`npm run test:runtime-stores` 默认本地 12 个子测试中 10 pass 且 2 个 Postgres 子项按既有逻辑 skip、`npm run test:commercial-ledger` 10/10、`npx tsx --test tests/web-shell.test.ts --test-name-pattern "notifications"` 7/7、`npx tsx --test tests/web-shell-admin-identity.test.ts tests/web-shell-operations-status.test.ts tests/web-shell-service-connections.test.ts` 7/7 通过；本轮 touched runtime store 类型文件 Prettier 已通过。

已完成（2026-06-16 本轮实施）：新增 `src/lib/module-runtime/stores/runtime-store-rag-types.ts`、`runtime-store-identity-types.ts`、`runtime-store-risk-types.ts`、`runtime-store-file-types.ts` 与 `runtime-store-config-types.ts`，将 RAG source/chunk、API key/host user/membership、risk event/block、file record、settings/service connection/resource binding 类型从主入口迁出；`src/lib/module-runtime/stores/runtime-store-types.ts` 继续从原入口 re-export 兼容并保留 `RuntimeStore` interface，当前降到 911 行。完成证据：`npm run typecheck`、`npm run test:runtime-stores` 默认本地 12 个子测试中 10 pass 且 2 个 Postgres 子项按既有逻辑 skip、`npm run test:rag-files` 5 个子测试中 4 pass 且 1 个 Postgres 子项按既有逻辑 skip、`npm run test:api-key-store` 1/1、`npm run test:security-runtime` 22/22、`npx tsx --test tests/web-shell-service-connections.test.ts tests/web-shell-files.test.ts tests/web-shell-identity.test.ts tests/web-shell-product-scope.test.ts` 18/18、`npx tsx --test tests/product-scope-runtime.test.ts tests/files-storage-driver.test.ts` 10/10 通过；本轮 touched runtime store 类型文件 Prettier 已通过。

已完成（2026-06-16 本轮实施）：新增 `src/lib/module-runtime/security/capability-guard-common.ts`，集中维护 capability guard 的 deny helper、session permission 判定、module permission/system-only permission 声明检查、config/service/resource binding 声明检查、resource binding 写权限判定、commercial subject 访问判断和可访问 subject 过滤；`src/lib/module-runtime/security/capability-guard.ts` 保留 Data/Config/Services/Files/Commercial/AI/RAG/API key/cache/audit 等具体 capability wrapper 与 `guardModuleContextCapabilities` 编排，当前从 1242 行降到 1137 行。完成证据：`npm run typecheck`、`npm run test:security-runtime` 22/22、`npm run test:host-runtime` 21/21 通过。

已完成（2026-06-16 本轮实施）：新增 `tests/host-runtime-fixtures.ts` 与 `tests/host-runtime-routing.test.ts`，前者集中维护 host runtime 测试共享 module map artifact、API/action/page/loader fixture，后者承接 dashboard/site page route、metadata-only、dashboard `generateMetadata`、loader/metadata error chrome context 和 public/dashboard alias 用例；`test:host-runtime` 脚本同时运行主 host runtime 测试与 routing 专项测试，`tests/host-runtime.test.ts` 当前从 1197 行降到 602 行并退出 Top 25。完成证据：`npm run test:host-runtime` 21/21、`npm run typecheck` 通过。

已完成（2026-06-16 本轮实施）：新增 `tests/host-page-presentation.test.ts`，承接 product/workspace/page theme CSS variable、product composition view、page presentation resolver、docs SEO localization、route presentation manifest 和 auth/admin route presenter access guard 用例；`test:host-page-runtime` 脚本同时运行 host page composition/rendering 主测试与 presentation 专项测试，`tests/host-page-runtime.test.ts` 当前从 935 行降到 739 行并退出 Top 25。完成证据：`npm run test:host-page-runtime` 21/21、`npm run typecheck` 通过。

已完成（2026-06-16 本轮实施）：新增 `tests/host-page-surfaces.test.ts`，承接 host page slot contribution composition policy、caller visibility/module permission plan、slot render error isolation 和 admin module header actions composition 用例；`test:host-page-runtime` 脚本同时运行 host page runtime、presentation 与 surfaces 三个专项测试文件，`tests/host-page-runtime.test.ts` 当前从 739 行降到 409 行并退出 Top 30，surfaces 专项文件 339 行。完成证据：`npm run test:host-page-runtime` 21/21；本轮 touched 文件 Prettier 已通过。

已完成（2026-06-16 本轮实施）：新增 `tests/module-contract-presentation.test.ts`，承接 module contract 的 theme permission/token allowlist、white-label presentation invalid/valid declaration、strict i18n fallback message key 和 local contract parts/action side effects/surface placement metadata 用例；`test:module-contract` 脚本同时运行主契约测试与 presentation 契约专项测试，`tests/module-contract.test.ts` 当前从 736 行降到 548 行并退出 Top 25，presentation 专项文件 194 行。完成证据：`npm run test:module-contract` 19/19；本轮 touched 文件 Prettier 已通过。

已完成（2026-06-16 本轮实施）：新增 `tests/advanced-runtime-data-cli.test.ts`，承接 Data CLI `module-data-diff` baseline/index drift 和 `module-data migrate --dry-run` stale generated migration artifact 拒绝用例；`test:advanced-runtime` 脚本同时运行主 advanced runtime 测试与 Data CLI 专项测试，`tests/advanced-runtime.test.ts` 当前从 1624 行降到 1463 行。完成证据：`npm run test:advanced-runtime` 23/23、`npm run typecheck` 通过。

已完成（2026-06-16 本轮实施）：新增 `tests/advanced-runtime-verify-db.test.ts`，承接 Data CLI `verify-db` 的 RLS helper、DB introspection、role safety、schema verifier、command flow 和 DB verifier composition 用例；`test:advanced-runtime` 脚本同时运行主 advanced runtime、Data CLI 专项与 verify-db 专项测试，`tests/advanced-runtime.test.ts` 当前从 1463 行降到 906 行。完成证据：`npm run test:advanced-runtime` 23/23、`npm run typecheck` 通过。

已完成（2026-06-16 本轮实施）：新增 `tests/advanced-runtime-data-command-helpers.test.ts` 与 `tests/advanced-runtime-data-static-helpers.test.ts`，前者承接 Data DB mutation runner、migrate/reset apply command helper 和 command dependency wiring 用例，后者承接 static command、reset SQL、CLI runner、type generation、Data plan、dry-run、loader、path safety 和 args parser 用例；`test:advanced-runtime` 脚本同时运行主 advanced runtime、Data CLI、verify-db、command helper 与 static helper 专项测试，`tests/advanced-runtime.test.ts` 当前从 906 行降到 79 行并退出 Top 25。完成证据：`npm run test:advanced-runtime` 23/23、`npm run typecheck` 通过。

已完成（2026-06-16 本轮实施）：新增 `tests/advanced-runtime-data-module-imports.ts` 与 `tests/advanced-runtime-data-fixtures.ts`，前者承接 Data helper 的脚本动态 import 入口，后者承接 Data diff 临时模块 fixture 创建和测试结束清理；`tests/advanced-runtime-data-helpers.ts` 保留类型契约和兼容 re-export，从 779 行降到 680 行，两个新文件分别为 101 行和 22 行。完成证据：`npm run test:advanced-runtime` 23/23；本轮 touched 文件 Prettier 已通过。

已完成（2026-06-16 本轮实施）：新增 `tests/commercial-ledger-provider-flows.test.ts`，承接商业账本 provider order status event idempotency、revenue bucket replay stability、subscription event ordering/access sync、tax profile scoped evidence freeze，以及 partial refund benefit retention/full refund revoke 用例；`test:commercial-ledger` 脚本同时运行主商业账本、primitives 与 provider flows 专项测试，`tests/commercial-ledger.test.ts` 当前从 1167 行降到 609 行并退出 Top 25。完成证据：`npm run test:commercial-ledger` 10/10、`npm run typecheck` 通过。

已完成（2026-06-16 本轮实施）：新增 `src/lib/module-runtime/release/rc-gate-evidence.ts`，集中维护 RC gate 的 runtime evidence JSON 读取、provider/worker/Postgres report 读取、Product Presentation manifest 读取、module test reports 读取、module quality route/evidence requirement 收集，以及 commercial/provider invocation domain evidence 提取；`src/lib/module-runtime/release/rc-gate.ts` 当前从 1812 行降到 1472 行，继续保留 check resolver 与 `runReleaseCandidateGate` 编排入口。完成证据：`npm run test:release-candidate` 51/51、`npm run typecheck` 通过。

已完成（2026-06-16 本轮实施）：新增 `tests/release-candidate-browser-quality.test.ts`，承接 RC gate 的 browser matrix required/module route coverage、accessibility smoke route coverage、module-declared core E2E/P2 browser/core verification strict evidence 和 pending module quality 用例；`test:release-candidate` 脚本同时运行主 RC gate 测试与 browser/module quality 专项测试，`tests/release-candidate.test.ts` 当前从 1320 行降到 1071 行。完成证据：`npm run test:release-candidate` 51/51、`npm run typecheck` 通过。

已完成（2026-06-16 本轮实施）：新增 `tests/release-candidate-runtime-evidence.test.ts`，承接 RC gate 的 provider matrix、runtime store Postgres、worker soak、host product smoke、Web Shell、dashboard transition、product presentation manifest、production adapters 和 delivery ledger strict evidence 用例；本轮继续补充 dashboard transition 缺失 injected-anchor 覆盖拒绝用例与缺失 AppFrame/client-transition marker 拒绝用例；`test:release-candidate` 脚本同时运行主 RC gate、browser/module quality 与 runtime evidence 专项测试，`tests/release-candidate.test.ts` 当前从 1071 行降到 597 行并退出 Top 25。完成证据：`npm run test:release-candidate` 51/51、`npm run typecheck` 通过。

已完成（2026-06-16 本轮实施）：新增 `tests/release-candidate-fixtures.ts`，集中维护 RC gate 测试使用的临时项目创建、JSON evidence 写入、provider invocation/worker soak evidence、fixture module route checks、P2 browser/core E2E/core verification evidence 和 module quality manifest 写入；`tests/release-candidate.test.ts` 当前从 1509 行降到 1320 行。完成证据：`npm run test:release-candidate` 49/49、`npm run typecheck` 通过。

已完成（2026-06-16 本轮实施）：新增 `src/lib/module-runtime/stores/runtime-store-commercial-types.ts`，集中维护 runtime store 的 metering、credits、entitlements、commercial catalog/orders、billing account、invoice/credit note、subscription/events、tax profile、revenue/settlement 与 redeem code 类型；`src/lib/module-runtime/stores/runtime-store-types.ts` 保持原入口 re-export 兼容，当前从 1670 行降到 1335 行。完成证据：`npm run typecheck`、`npm run test:runtime-stores` 12 个子测试中 10 pass 且 2 个 Postgres 子测因本地数据库未启动按既有逻辑 skip、`npm run test:commercial-ledger` 10/10 通过。

已完成（2026-06-16 本轮实施）：新增 `tests/commercial-ledger-primitives.test.ts`，承接 P16 subject-first commercial primitives 覆盖，包括 workspace/user subject credits grant/reserve/commit/release、metering charge replay 与失败 void、entitlement grant/revoke、workspace beneficiary checkout/refund、redeem code batch/bind/expire、risk record/block/check 生命周期；`test:commercial-ledger` 脚本同时运行主商业账本测试与 primitives 专项测试，`tests/commercial-ledger.test.ts` 当前从 1619 行降到 1167 行。完成证据：`npm run test:commercial-ledger` 10/10、`npm run typecheck` 通过。

已完成（2026-06-16 本轮实施）：新增 `tests/runtime-stores-postgres.test.ts`，承接 Postgres runtime store 持久化、schema verify/checksum drift、workspace-scoped idempotency 与 null workspace 精确过滤用例；`test:runtime-stores` 脚本同时运行内存/索引审计主测试和 Postgres 专项测试，`tests/runtime-stores.test.ts` 当前从 1341 行降到 587 行。完成证据：`npm run test:runtime-stores` 默认本地 12 个子测试中 10 pass、2 个 Postgres 子项因本地数据库未启动按既有逻辑 skip；`npm run typecheck` 通过。

已完成（2026-06-16 本轮实施）：新增 `tests/runtime-stores-postgres-scope.test.ts` 与 `tests/runtime-stores-postgres-helpers.ts`，前者承接 Postgres runtime store 的 null workspace 精确过滤用例，覆盖 runs/outbox/notifications/workers/commercial catalog/billing account/provider invocation/RAG/files 等平台域；后者集中维护 Postgres 可达性检测、默认测试库 URL 和 runtime 表 reset。`tests/runtime-stores-postgres.test.ts` 保留持久化、schema verify、checksum drift、index audit 和跨 workspace idempotency 主场景，从 759 行降到 445 行并退出 Top 25；`test:runtime-stores` 脚本同时运行三个 runtime store 测试文件。完成证据：`npm run test:runtime-stores` 默认本地 12 个子测试中 10 pass、2 个 Postgres 子项因本地数据库未启动按既有逻辑 skip；本轮 touched 文件 Prettier 已通过。

已完成（2026-06-16 本轮实施）：新增 `tests/security-runtime-data-commercial-guard.test.ts`，承接 capability guard 的 artifact undeclared permission、cross-user credits consume、Data transaction 内 permission guard、`UnsafeSqlRaw` system-only guard，以及 subject-scoped entitlements/redeem/risk 用例；`test:security-runtime` 脚本同时运行主安全运行时、services.invoke、capability guard 基础专项与 data/commercial guard 专项测试，`tests/security-runtime-capability-guard.test.ts` 当前从 957 行降到 298 行并退出 Top 25。完成证据：`npm run test:security-runtime` 22/22、`npm run typecheck` 通过。

已完成（2026-06-16 本轮实施）：新增 `tests/security-runtime-capability-guard.test.ts`，承接 runtime capability guard 的 connector/service declaration、resource binding scope/write、session permission、audit provider unavailable 和 notification read/send permission split 用例；`test:security-runtime` 脚本同时运行主安全运行时、services.invoke 专项、capability guard 基础专项与 data/commercial guard 专项测试，`tests/security-runtime.test.ts` 当前从 1151 行降到 205 行并退出 Top 25。完成证据：`npm run test:security-runtime` 22/22、`npm run typecheck` 通过。

已完成（2026-06-16 本轮实施）：新增 `tests/security-runtime-services.test.ts`，承接 `services.invoke` 的 legacy 调用、签名/redaction、warning 连接、blocked/disabled connection、operation policy、workspace isolation、DNS private egress 与 oversized response 用例；`test:security-runtime` 脚本同时运行主安全测试与 services 专项测试，`tests/security-runtime.test.ts` 当前从 fixture 拆分后的 1762 行进一步降到 1151 行。完成证据：`npm run test:security-runtime` 22/22、`npm run typecheck` 通过。

已完成（2026-06-16 本轮实施）：`ploykit-module --help` 与 `ploykit-module create --help` 已输出动态模板/扩展列表，`test:developer-experience` 覆盖 help 输出、11 个基础模板生成矩阵，以及 `service-backed`、`background`、组合 extension 真实生成矩阵；本轮 `npm run test:developer-experience` 11/11、`npm run test:module-doctor` 14/14、`npm run typecheck`、`npm run modules:check` 通过。

已完成（2026-06-15 本轮实施）：新增 `scripts/lib/module-template-catalog.mjs`，集中维护 `MODULE_TEMPLATES`、`MODULE_EXTENSIONS`、Data artifact 模板集合、`module:create` usage 和 `templates` 文件清单生成；`scripts/ploykit-module.mjs` 仅保留 CLI wiring、doctor/check 与 create 执行流程。本轮 `node scripts/ploykit-module.mjs templates` 输出正常，`npm run test:developer-experience` 10/10、`npm run typecheck`、`npm run format:check` 通过。

已完成（2026-06-16 本轮实施）：新增 `scripts/lib/module-template-extensions.mjs`，集中维护模板 extension marker cleanup、service-backed overlay 和 background overlay 注入；`scripts/ploykit-module.mjs` create 流程只负责复制模板、调用 extension helper、生成 Data artifact、刷新 module map 和执行 doctor。本轮进一步修复 service-backed 受控 service egress 与普通 HTTP egress 的 doctor 边界、`tenantId` claims allowlist、background `generate_report` job key，以及 extension 注入片段变量渲染；`npm run test:developer-experience` 11/11、`npm run test:module-doctor` 14/14、`npm run typecheck`、`npm run modules:check` 通过。

已完成（2026-06-15 本轮实施）：新增 `scripts/lib/module-digests.mjs`，集中维护 module source hash 文件枚举和 contract digest 计算，doctor summary、module map manifest drift 检查与 `inspect` 命令复用同一 helper；该轮 `scripts/ploykit-module.mjs` 降到 2111 行。本轮 `node scripts/ploykit-module.mjs inspect modules/hello` 的 `sourceHash` / `contractDigest` 与拆分前一致，`npm run test:module-doctor` 13/13、`npm run test:module-map` 10/10、`npm run test:developer-experience` 10/10、`npm run typecheck`、`npm run format:check` 通过。

已完成（2026-06-15 本轮实施）：新增 `scripts/lib/module-create-command.mjs`，集中维护 `module:create` 参数解析、模板复制、Data artifact 生成、module map 刷新、doctor 执行和输出 payload；该轮 `scripts/ploykit-module.mjs` 降到 1959 行，低于 2000 行。完成证据：`node scripts/ploykit-module.mjs create <临时模块> --template basic` 成功生成模块并通过 `doctor`，验证后已删除临时模块并恢复当前 module map；`npm run test:developer-experience` 10/10、`npm run test:module-doctor` 13/13、`npm run test:module-map` 10/10、`npm run typecheck`、`npm run format:check` 通过。

已完成（2026-06-16 本轮实施）：新增 `scripts/lib/module-contract-source.mjs`，集中维护 `ploykit-module` doctor/inspect 复用的源码解析 helper，包括 contract local path、handler path、parts、publicAliases、top-level arrays、public route objects、anonymousPolicy 和静态 `ctx.http.fetch` origin 解析；该轮 `scripts/ploykit-module.mjs` 降到 1663 行。完成证据：`node --check scripts/ploykit-module.mjs`、`node --check scripts/lib/module-contract-source.mjs`、`npm run module:doctor -- modules/hello`、`npm run test:developer-experience` 11/11、`npm run test:module-doctor` 14/14、`npm run test:module-map` 10/10、`npm run module:doctor -- all`、`npm run modules:check`、`npm run typecheck` 和 Prettier check 均通过。

已完成（2026-06-16 本轮实施）：新增 `scripts/lib/module-doctor-diagnostics.mjs`，集中维护 `ploykit-module` doctor 的 diagnostic 分类、标准化、去重和源码定位 helper；该轮 `scripts/ploykit-module.mjs` 降到 1576 行。完成证据：`node --check scripts/ploykit-module.mjs`、`node --check scripts/lib/module-doctor-diagnostics.mjs`、`npm run module:doctor -- modules/hello`、`npm run test:module-doctor` 14/14、`npm run test:module-map` 10/10、`npm run test:developer-experience` 11/11、`npm run module:doctor -- all`、`npm run modules:check`、`npm run typecheck` 和 Prettier check 均通过。

已完成（2026-06-16 本轮实施）：新增 `scripts/lib/module-cli-runner.mjs`，集中维护 `ploykit-module` root help 文案生成、JSON 输出、argv command dispatch、unknown command 处理和顶层 CLI error reporting；该轮 `scripts/ploykit-module.mjs` 为 1641 行，主入口继续保留 doctor/check/inspect/create/templates/dev 命令实现 wiring。完成证据：`node --check scripts/ploykit-module.mjs`、`node --check scripts/lib/module-cli-runner.mjs`、`node scripts/ploykit-module.mjs --help`、`node scripts/ploykit-module.mjs templates`、unknown command 非零退出验证、`npm run module:doctor -- modules/hello`、`npm run test:module-doctor` 14/14、`npm run test:module-map` 10/10、`npm run test:developer-experience` 11/11、`npm run module:doctor -- all`、`npm run modules:check`、`npm run typecheck` 和 Prettier check 均通过。

已完成（2026-06-16 本轮实施）：新增 `scripts/lib/module-doctor-contract-rules.mjs`，集中维护 `ploykit-module` doctor 的静态 contract rule group，包括 module id/version pattern、public aliases、resource kind、event/webhook signature、HTTP egress、public route anonymous/cache policy、Data artifact/migration 与 lifecycle handler 校验；该轮 `scripts/ploykit-module.mjs` 降到 1069 行。完成证据：`node --check scripts/ploykit-module.mjs`、`node --check scripts/lib/module-doctor-contract-rules.mjs`、`npm run module:doctor -- modules/hello`、`npm run test:module-doctor` 14/14、`npm run test:module-map` 10/10、`npm run test:developer-experience` 11/11、`npm run module:doctor -- all`、`npm run modules:check`、`npm run typecheck` 和 Prettier check 均通过。

已完成（2026-06-16 本轮实施）：新增 `scripts/lib/module-doctor-capability-rules.mjs`，集中维护 `ploykit-module` doctor 的 capability rule group，包括 `ctx.*` capability 到 `Permission.*`/字符串权限映射、config/secrets/services/resourceBindings contract metadata 要求，以及 privileged service module 禁止绕过 `ctx.services` 直接构造 HTTP/签名凭据；该轮 `scripts/ploykit-module.mjs` 降到 710 行。完成证据：`node --check scripts/ploykit-module.mjs`、`node --check scripts/lib/module-doctor-capability-rules.mjs`、`npm run module:doctor -- modules/hello`、`npm run test:module-doctor` 14/14、`npm run test:module-map` 10/10、`npm run test:developer-experience` 11/11、`npm run module:doctor -- all`、`npm run modules:check`、`npm run typecheck` 和 Prettier check 均通过。

已完成（2026-06-16 本轮实施）：新增 `scripts/lib/module-doctor-dependency-rules.mjs`，集中维护 `ploykit-module` doctor 的 dependency rule group，包括静态 `dependencies.npm` 诊断标准化、host `package.json` dependency/devDependency 覆盖检查和 `MODULE_DEPENDENCY_NOT_HOST_RUNTIME` 输出；该轮 `scripts/ploykit-module.mjs` 降到 676 行。完成证据：`node --check scripts/ploykit-module.mjs`、`node --check scripts/lib/module-doctor-dependency-rules.mjs`、`npm run module:doctor -- modules/hello`、`npm run test:module-doctor` 14/14、`npm run test:module-map` 10/10、`npm run test:developer-experience` 11/11、`npm run module:doctor -- all`、`npm run modules:check`、`npm run typecheck` 和 Prettier check 均通过。

已完成（2026-06-16 本轮实施）：新增 `scripts/lib/module-doctor-map-rules.mjs`，集中维护 `ploykit-module` doctor 的 module map rule group，包括 module map manifest 缺失/stale/release metadata 缺失、source hash drift 与 contract digest drift 检查，并继续为 doctor summary/inspect 提供 source hash helper；该轮 `scripts/ploykit-module.mjs` 降到 586 行，随后 source-boundary rule group 继续拆出。完成证据：`node --check scripts/ploykit-module.mjs`、`node --check scripts/lib/module-doctor-map-rules.mjs`、`npm run module:doctor -- modules/hello`、`npm run test:module-doctor` 14/14、`npm run test:module-map` 10/10、`npm run test:developer-experience` 11/11、`npm run module:doctor -- all`、`npm run modules:check`、`npm run typecheck` 和 Prettier check 均通过。

已完成（2026-06-16 本轮实施）：新增 `scripts/lib/module-doctor-source-boundary-rules.mjs`，集中维护 `ploykit-module` doctor 的 source-boundary rule group，包括 contract local path/root escape/missing file 校验、contract part file/export 检查、module source safety 边界校验，以及 API/action handler 的 `defineApi` / `action` / `defineAction` 定义检查；该轮 `scripts/ploykit-module.mjs` 降到 443 行。完成证据：`node --check scripts/ploykit-module.mjs`、`node --check scripts/lib/module-doctor-source-boundary-rules.mjs`、`node scripts/ploykit-module.mjs inspect modules/hello`、`npm run module:doctor -- modules/hello`、`npm run test:module-doctor` 14/14、`npm run test:module-map` 10/10、`npm run test:developer-experience` 11/11、`npm run module:doctor -- all`、`npm run modules:check`、`npm run typecheck` 和 Prettier check 均通过。

已完成（2026-06-16 本轮实施）：新增 `scripts/lib/module-command-execution.mjs`，集中维护 `ploykit-module` 的 command execution helper，包括本地脚本子进程执行、SDK contract validation 子进程调用、超时/失败 diagnostics 标准化，并让 `module:create` 与 `module:dev` 复用同一 `runLocalScript`；同时修复 `commandDev` 旧代码引用未定义 `runLocalScript` 的断点；`scripts/ploykit-module.mjs` 当前 397 行。完成证据：`node --check scripts/ploykit-module.mjs`、`node --check scripts/lib/module-command-execution.mjs`、`node --check scripts/lib/module-create-command.mjs`、`node scripts/ploykit-module.mjs validate-contract-internal modules/hello`、`node scripts/ploykit-module.mjs dev modules/hello`、`npm run module:doctor -- modules/hello`、`npm run test:module-doctor` 14/14、`npm run test:module-map` 10/10、`npm run test:developer-experience` 11/11、`npm run module:doctor -- all`、`npm run modules:check`、`npm run typecheck` 和 Prettier check 均通过。

已完成（2026-06-15 本轮实施）：新增 `scripts/lib/module-data-sql.mjs`，集中维护 Data v2 generated migration SQL 的 identifier/string quoting、column type/default、document store、metadata tables、RLS policy 和 table/index SQL 生成；`scripts/module-data.mjs` 当前降到 1953 行，低于 2000 行。本轮 `node scripts/module-data.mjs generate modules/hello --check` 证明 generated migration SQL 无漂移，`node scripts/module-data.mjs types modules/hello --check` 刷新 stale `modules/hello/.ploykit/generated/data-types.ts` 后，`node scripts/module-data.mjs verify modules/hello` 通过；`npm run test:advanced-runtime` 5/5、`npm run test:developer-experience` 10/10、`npm run typecheck`、`npm run format:check` 通过。

已完成（2026-06-16 本轮实施）：新增 `scripts/lib/module-data-artifacts.mjs`，集中维护 Data CLI generated artifact 路径、plan/types/migration 写入、stale/missing 静态校验和 `migrate --dry-run` migration entry 收集；`scripts/module-data.mjs` 当前降到 1657 行。完成证据：`node --check scripts/module-data.mjs`、`node --check scripts/lib/module-data-artifacts.mjs`、`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run`、`npm run test:advanced-runtime` 5/5、`npm run test:developer-experience` 11/11、`npm run modules:check`、`npm run typecheck`、`npm run docs:encoding-check` 和本轮 touched 文件 Prettier check 均通过。

已完成（2026-06-16 本轮实施）：新增 `scripts/lib/module-data-db-rls.mjs`，集中维护 Data CLI `verify-db` 的 RLS policy/table verifier，包括 policy 表达式 normalization、document/table scope policy 期望片段、RLS enabled/forced、policy extra/missing、command/USING/WITH CHECK mismatch diagnostics；`scripts/module-data.mjs` 当前降到 1507 行。完成证据：`node --check scripts/module-data.mjs`、`node --check scripts/lib/module-data-db-rls.mjs`、`node scripts/module-data.mjs verify-db modules/hello` 在无数据库配置下保持预期 `MODULE_DATA_VERIFY_DB_DATABASE_URL_REQUIRED` 非零输出、`npm run test:advanced-runtime` 6/6（新增 RLS helper policy drift diagnostics 覆盖）、`npm run modules:check`、`npm run typecheck`、`npm run docs:encoding-check` 和本轮 touched 文件 Prettier check 均通过。

已完成（2026-06-16 本轮实施）：新增 `scripts/lib/module-data-db-introspection.mjs`，集中维护 Data CLI `migrate` / `reset` / `verify-db` 复用的数据库连接池创建、DATABASE_URL/app-role URL 解析、table/column/RLS policy catalog 读取、metadata hash 读取和当前 role safety 快照读取；`tests/advanced-runtime.test.ts` 新增 fake pool 覆盖 catalog snapshot 映射；`scripts/module-data.mjs` 当前 1561 行，主 CLI 继续保留 Data plan、SQL/type generation、migrate/reset/verify-db orchestration、metadata/column mismatch 和 role safety diagnostics。完成证据：`node --check scripts/module-data.mjs`、`node --check scripts/lib/module-data-db-introspection.mjs`、`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run`、`node scripts/module-data.mjs verify-db modules/hello` 在无数据库配置下保持预期 `MODULE_DATA_VERIFY_DB_DATABASE_URL_REQUIRED` 非零输出、`npm run test:advanced-runtime` 7/7、`npm run modules:check`、`npm run typecheck` 和本轮 code touched 文件 Prettier check 均通过。

已完成（2026-06-16 本轮实施）：新增 `scripts/lib/module-data-db-role-safety.mjs`，集中维护 Data CLI `verify-db` 的 role safety verifier，包括 RLS 表名收集、database/app runtime role superuser/BYPASSRLS/DDL/table owner 风险诊断，以及 app-role safety required/skipped 诊断输出；`tests/advanced-runtime.test.ts` 新增 fake reader 覆盖 role risk diagnostics、details 和 RLS table name 收集；`scripts/module-data.mjs` 当前 1451 行，主 CLI 继续保留 Data plan、SQL/type generation、migrate/reset/verify-db orchestration 和 metadata/column mismatch diagnostics。完成证据：`node --check scripts/module-data.mjs`、`node --check scripts/lib/module-data-db-role-safety.mjs`、`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run`、`node scripts/module-data.mjs verify-db modules/hello` 在无数据库配置下保持预期 `MODULE_DATA_VERIFY_DB_DATABASE_URL_REQUIRED` 与 `MODULE_DATA_DB_APP_ROLE_SAFETY_SKIPPED` 输出、`node scripts/module-data.mjs verify-db modules/hello --require-app-role-safety` 保持预期 `MODULE_DATA_DB_APP_ROLE_URL_REQUIRED` 输出、`npm run test:advanced-runtime` 8/8、`npm run modules:check`、`npm run typecheck` 和本轮 code touched 文件 Prettier check 均通过。

已完成（2026-06-16 本轮实施）：新增 `scripts/lib/module-data-db-schema-verifier.mjs`，集中维护 Data CLI `verify-db` 的 DB schema verifier，包括 document store 表/列校验、metadata tables 存在性、document/table metadata hash drift、module table column missing/type/nullability drift，以及 RLS verifier 调用编排；`tests/advanced-runtime.test.ts` 新增 fake DB schema verifier 覆盖 table/column/metadata drift diagnostics 与 RLS policy verifier 调用；`scripts/module-data.mjs` 当前 1291 行，主 CLI 继续保留 Data plan、SQL/type generation、migrate/reset/verify-db connection flow 和 output orchestration。完成证据：`node --check scripts/module-data.mjs`、`node --check scripts/lib/module-data-db-schema-verifier.mjs`、`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run`、`node scripts/module-data.mjs verify-db modules/hello` 在无数据库配置下保持预期 `MODULE_DATA_VERIFY_DB_DATABASE_URL_REQUIRED` 与 `MODULE_DATA_DB_APP_ROLE_SAFETY_SKIPPED` 输出、`node scripts/module-data.mjs verify-db modules/hello --require-app-role-safety` 保持预期 `MODULE_DATA_DB_APP_ROLE_URL_REQUIRED` 输出、`npm run test:advanced-runtime` 9/9、`npm run modules:check`、`npm run typecheck` 和本轮 code touched 文件 Prettier check 均通过。

已完成（2026-06-16 本轮实施）：新增 `scripts/lib/module-data-verify-db-command.mjs`，集中维护 Data CLI `verify-db` command flow，包括 DATABASE_URL/app-role URL 解析、required/skipped diagnostics 分支、primary/app pool 生命周期、schema verifier 与 role safety verifier 调用、checkedModules/output payload 和非零 exit code 设置；`tests/advanced-runtime.test.ts` 新增 fake command runner 覆盖 primary/app role pool close、schema/role verifier 调用、app-role required 分支和 process.exitCode 隔离；`scripts/module-data.mjs` 当前 1207 行，主 CLI 继续保留 Data plan、SQL/type generation、migrate/reset orchestration 和 command dispatch。完成证据：`node --check scripts/module-data.mjs`、`node --check scripts/lib/module-data-verify-db-command.mjs`、`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run`、`node scripts/module-data.mjs verify-db modules/hello` 在无数据库配置下保持预期 `MODULE_DATA_VERIFY_DB_DATABASE_URL_REQUIRED` 与 `MODULE_DATA_DB_APP_ROLE_SAFETY_SKIPPED` 输出、`node scripts/module-data.mjs verify-db modules/hello --require-app-role-safety` 保持预期 `MODULE_DATA_DB_APP_ROLE_URL_REQUIRED` 输出、`npm run test:advanced-runtime` 10/10、`npm run modules:check`、`npm run typecheck` 和本轮 code touched 文件 Prettier check 均通过。

已完成（2026-06-16 本轮实施）：新增 `scripts/lib/module-data-db-mutate-command.mjs`，集中维护 Data CLI `migrate` / `reset --force` 的 DB mutation runner，包括 DATABASE_URL required diagnostics、pool 生命周期、transaction begin/commit/rollback、migration SQL 读取注入、applied/reset payload 和 migrate/reset failed diagnostics；`tests/advanced-runtime.test.ts` 新增 fake pool 覆盖 migration success/failure rollback、failed path、reset success、required URL diagnostics；`scripts/module-data.mjs` 当前 1122 行，主 CLI 继续保留 Data plan、SQL/type generation、dry-run output 和 command dispatch。完成证据：`node --check scripts/module-data.mjs`、`node --check scripts/lib/module-data-db-mutate-command.mjs`、`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run`、`node scripts/module-data.mjs reset modules/hello --dry-run`、`node scripts/module-data.mjs verify-db modules/hello` 在无数据库配置下保持预期 `MODULE_DATA_VERIFY_DB_DATABASE_URL_REQUIRED` 与 `MODULE_DATA_DB_APP_ROLE_SAFETY_SKIPPED` 输出、`node scripts/module-data.mjs verify-db modules/hello --require-app-role-safety` 保持预期 `MODULE_DATA_DB_APP_ROLE_URL_REQUIRED` 输出、`npm run test:advanced-runtime` 11/11、`npm run modules:check`、`npm run typecheck` 和本轮 code touched 文件 Prettier check 均通过。

已完成（2026-06-16 本轮实施）：新增 `scripts/lib/module-data-static-commands.mjs`，集中维护 Data CLI `plan` / `generate` / `types` / `verify` 的 static command helper，包括 static plan loading、diagnostics 汇总、success/exit code/output payload、generated plan/migration/types 写入 orchestration 和 generated artifact verify 输出；`tests/advanced-runtime.test.ts` 新增 fake artifact command runner 覆盖 plan count、generate/types changed paths、verify stale diagnostics 和 process.exitCode 隔离；`scripts/module-data.mjs` 当前 1031 行，主 CLI 继续保留 Data plan normalization、SQL/type generation、migrate/reset dry-run output 和 command dispatch。完成证据：`node --check scripts/module-data.mjs`、`node --check scripts/lib/module-data-static-commands.mjs`、`node scripts/module-data.mjs plan modules/hello`、`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run`、`node scripts/module-data.mjs reset modules/hello --dry-run`、`npm run test:advanced-runtime` 12/12、`npm run modules:check`、`npm run typecheck` 和本轮 code touched 文件 Prettier check 均通过。

已完成（2026-06-16 本轮实施）：新增 `scripts/lib/module-data-reset-sql.mjs`，集中维护 Data CLI reset SQL 生成，包括 module document 删除、module table drop、metadata/migration/grants/checks 清理和 identifier/string quoting；`tests/advanced-runtime.test.ts` 新增 reset SQL helper 直接覆盖 module id string quote 与 physical table identifier quote；`scripts/module-data.mjs` 当前 1011 行，主 CLI 继续保留 Data plan normalization、SQL/type generation、migrate/reset dry-run output 和 command dispatch。完成证据：`node --check scripts/module-data.mjs`、`node --check scripts/lib/module-data-reset-sql.mjs`、`node scripts/module-data.mjs plan modules/hello`、`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run`、`node scripts/module-data.mjs reset modules/hello --dry-run`、`npm run test:advanced-runtime` 13/13、`npm run modules:check`、`npm run typecheck` 和本轮 code touched 文件 Prettier check 均通过。

已完成（2026-06-16 本轮实施）：新增 `scripts/lib/module-data-cli-runner.mjs`，集中维护 Data CLI usage、argv command dispatch、unknown command 非零退出、top-level `MODULE_DATA_CLI_ERROR` JSON reporting 和 `tsx.unregister()` finally hook；`tests/advanced-runtime.test.ts` 新增直接覆盖成功 dispatch、unknown command usage/exitCode 和异常 command JSON 输出；`scripts/module-data.mjs` 当前 893 行，主 CLI 继续保留 Data plan normalization、SQL/type generation 与 migrate/reset dry-run output。完成证据：`node --check scripts/module-data.mjs`、`node --check scripts/lib/module-data-cli-runner.mjs`、`node scripts/module-data.mjs plan modules/hello`、`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run`、`node scripts/module-data.mjs reset modules/hello --dry-run`、unknown command 非零退出验证、`npm run test:advanced-runtime` 14/14、`npm run modules:check`、`npm run typecheck` 和本轮 code touched 文件 Prettier check 均通过。

已完成（2026-06-16 本轮实施）：新增 `scripts/lib/module-data-types.mjs`，集中维护 Data CLI generated TypeScript types，包括 TS identifier 归一、document field 类型映射、table column 类型映射、Data interface 与 `get<Module>Data(ctx)` accessor 生成；`tests/advanced-runtime.test.ts` 新增直接覆盖 identifier/nullable/type mapping 与 interface/accessor 输出片段；`scripts/module-data.mjs` 当前 800 行，主 CLI 继续保留 Data plan normalization 与 migrate/reset dry-run output。完成证据：`node --check scripts/module-data.mjs`、`node --check scripts/lib/module-data-types.mjs`、`node scripts/module-data.mjs plan modules/hello`、`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run`、`node scripts/module-data.mjs reset modules/hello --dry-run`、`npm run test:advanced-runtime` 15/15、`npm run modules:check`、`npm run typecheck` 和本轮 code touched 文件 Prettier check 均通过。

已完成（2026-06-16 本轮实施）：新增 `scripts/lib/module-data-plan.mjs`，集中维护 Data CLI Data plan normalization helper，包括 STANDARD_COLUMNS、physical table name、schema hash、document/table/view/grant/check/migration normalization，以及 Data v2 scope、migration、index、relation、view/grant/check diagnostics；`tests/advanced-runtime.test.ts` 新增直接覆盖默认值 clone、物理表名、schema hash 和关键 validation diagnostics；`scripts/module-data.mjs` 当前 395 行，主 CLI 继续保留 module.ts 加载、migrate/reset dry-run output 和 command wiring。完成证据：`node --check scripts/module-data.mjs`、`node --check scripts/lib/module-data-plan.mjs`、`node scripts/module-data.mjs plan modules/hello`、`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run`、`node scripts/module-data.mjs reset modules/hello --dry-run`、`npm run test:advanced-runtime` 16/16、`npm run modules:check`、`npm run typecheck` 和本轮 code touched 文件 Prettier check 均通过。

已完成（2026-06-16 本轮实施）：新增 `scripts/lib/module-data-dry-run.mjs`，集中维护 Data CLI migrate/reset dry-run output helper，包括 migration dry-run payload entry 映射、reset dry-run payload、success/error diagnostics 判定和 reset next 文案；`tests/advanced-runtime.test.ts` 新增直接覆盖 warning/error diagnostics、migration path/bytes/schemaHash 映射与 reset next 文案；`scripts/module-data.mjs` 当前 383 行，主 CLI 继续保留 module.ts 加载、migrate/reset apply orchestration 和 command wiring。完成证据：`node --check scripts/module-data.mjs`、`node --check scripts/lib/module-data-dry-run.mjs`、`node scripts/module-data.mjs plan modules/hello`、`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run`、`node scripts/module-data.mjs reset modules/hello --dry-run`、`npm run test:advanced-runtime` 17/17、`npm run modules:check`、`npm run typecheck` 和本轮 code touched 文件 Prettier check 均通过。

已完成（2026-06-16 本轮实施）：新增 `scripts/lib/module-data-loader.mjs`，集中维护 Data CLI module.ts loader helper，包括 module definition URL、nested default export 解包、`tsx.import` 注入式 module.ts 加载、无效导出错误和 `MODULE_DATA_CONTRACT_LOAD_FAILED` 标准诊断 payload；`tests/advanced-runtime.test.ts` 新增 fake importer 直接覆盖成功加载、bad export 与 import throw 诊断；`scripts/module-data.mjs` 当前 352 行，主 CLI 继续保留 migrate/reset apply orchestration 和 command wiring。完成证据：`node --check scripts/module-data.mjs`、`node --check scripts/lib/module-data-loader.mjs`、`node scripts/module-data.mjs plan modules/hello`、`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run`、`node scripts/module-data.mjs reset modules/hello --dry-run`、`npm run test:advanced-runtime` 18/18、`npm run modules:check`、`npm run typecheck` 和本轮 code touched 文件 Prettier check 均通过。

已完成（2026-06-16 本轮实施）：新增 `scripts/lib/module-data-apply-commands.mjs`，集中维护 Data CLI migrate/reset apply command helper，包括 apply context loading、migrate dry-run/DB URL required/apply payload、reset 默认 dry-run/force apply payload 和 exitCode 设置；`tests/advanced-runtime.test.ts` 新增 fake artifacts/dbMutations 覆盖 migrate dry-run、缺 DATABASE_URL、真实 apply、reset 默认 dry-run 与 `--force` apply；`scripts/module-data.mjs` 当前 289 行，主 CLI 继续保留 resolve/path safety、DB verifier composition 和 command wiring。完成证据：`node --check scripts/module-data.mjs`、`node --check scripts/lib/module-data-apply-commands.mjs`、`node scripts/module-data.mjs plan modules/hello`、`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run`、`node scripts/module-data.mjs reset modules/hello --dry-run`、`npm run test:advanced-runtime` 19/19、`npm run modules:check`、`npm run typecheck` 和本轮 code touched 文件 Prettier check 均通过。

已完成（2026-06-16 本轮实施）：新增 `scripts/lib/module-data-paths.mjs`，集中维护 Data CLI resolve/path safety helper，包括 module-local `./` 路径解析、空路径拒绝和 module root escape 防护；`tests/advanced-runtime.test.ts` 新增直接覆盖正常 migration path、非 `./` 路径、`./` 空路径和 `../` 逃逸路径；`scripts/module-data.mjs` 当前 277 行，主 CLI 继续保留 DB verifier composition 和 command dependency wiring。完成证据：`node --check scripts/module-data.mjs`、`node --check scripts/lib/module-data-paths.mjs`、`node scripts/module-data.mjs plan modules/hello`、`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run`、`node scripts/module-data.mjs reset modules/hello --dry-run`、`npm run test:advanced-runtime` 20/20、`npm run modules:check`、`npm run typecheck` 和本轮 code touched 文件 Prettier check 均通过。

已完成（2026-06-16 本轮实施）：新增 `scripts/lib/module-data-args.mjs`，集中维护 Data CLI command args parser helper，包括 target path、`--module` filter、`--database-url`、`--app-database-url`、`--schema` 和普通 flags 解析，以及缺值错误；`tests/advanced-runtime.test.ts` 新增直接覆盖 target/filter/value/flag 组合和 `--module` / `--database-url` / `--app-database-url` / `--schema` 缺值错误；`scripts/module-data.mjs` 当前 225 行，主 CLI 继续保留 DB verifier composition 和 command dependency wiring。完成证据：`node --check scripts/module-data.mjs`、`node --check scripts/lib/module-data-args.mjs`、`node scripts/module-data.mjs plan modules/hello`、`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run`、`node scripts/module-data.mjs reset modules/hello --dry-run`、`npm run test:advanced-runtime` 21/21、`npm run modules:check`、`npm run typecheck` 和本轮 code touched 文件 Prettier check 均通过。

已完成（2026-06-16 本轮实施）：新增 `scripts/lib/module-data-db-verifier.mjs`，集中维护 Data CLI DB verifier composition helper，统一组装 role safety verifier、RLS verifier、DB schema verifier 与 `verify-db` command 依赖；`tests/advanced-runtime.test.ts` 新增 fake pool/catalog/RLS/role composition 覆盖 schema/RLS/metadata、primary database role 与 app-role 两条 `verify-db` 路径；`scripts/module-data.mjs` 当前 225 行，主 CLI 继续保留 command dependency wiring。完成证据：`node --check scripts/module-data.mjs`、`node --check scripts/lib/module-data-db-verifier.mjs`、`node scripts/module-data.mjs plan modules/hello`、`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run`、`node scripts/module-data.mjs reset modules/hello --dry-run`、`npm run test:advanced-runtime` 22/22、`npm run modules:check`、`npm run typecheck` 和本轮 code touched 文件 Prettier check 均通过。

已完成（2026-06-16 本轮实施）：新增 `scripts/lib/module-data-command-dependencies.mjs`，集中维护 Data CLI command dependency wiring helper，统一组装 module source discovery、module.ts loader、Data plan helper、artifact helper、static/apply/verify-db commands 与最终 commands map；`tests/advanced-runtime.test.ts` 新增临时 Data 模块覆盖 command wiring helper 的 `buildPlans`、`plan` command 和 `verify-db` command 接线；`scripts/module-data.mjs` 当前 46 行，已降为 tsx 注册、JSON 输出/error reporting 与 CLI dispatch 入口壳。完成证据：`node --check scripts/module-data.mjs`、`node --check scripts/lib/module-data-command-dependencies.mjs`、`node scripts/module-data.mjs plan modules/hello`、`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run`、`node scripts/module-data.mjs reset modules/hello --dry-run`、`npm run test:advanced-runtime` 23/23、`npm run modules:check`、`npm run typecheck` 和本轮 code touched 文件 Prettier check 均通过。

已完成（2026-06-15 本轮实施）：新增 `src/module-sdk/validator-data.ts`，集中维护 Data v2 contract validation（documents、tables、relations、views、grants、checks、migrations）；`src/module-sdk/validator.ts` 当前降到 1835 行，低于 2000 行。本轮 `npm run test:module-contract` 19/19、`npm run test:module-doctor` 13/13、`npm run test:developer-experience` 10/10、`npm run typecheck`、`npm run format:check` 通过。

已完成（2026-06-16 本轮实施）：新增 `src/module-sdk/validator-anonymous-policy.ts`，集中维护 public API `anonymousPolicy` 细则校验，包括 rateLimit 必填、limit/window、upload size、captcha 枚举和匿名高成本 commercial API 阻断；`src/module-sdk/validator.ts` 当前降到 1763 行，继续保留 route wiring、public API policy required 入口和其它 module contract 校验。完成证据：`npm run test:module-contract` 19/19、`npm run test:module-doctor` 14/14、`npm run typecheck`、本轮 code touched 文件 Prettier check 与 `git diff --check -- src/module-sdk/validator.ts src/module-sdk/validator-anonymous-policy.ts` 均通过。

已完成（2026-06-15 本轮实施）：新增 `src/lib/module-runtime/release/rc-gate-types.ts`，集中维护 RC gate 的公开结果类型、evidence report shape、module quality requirement 和 domain evidence 类型；`src/lib/module-runtime/release/rc-gate.ts` 当前降到 1913 行，低于 2000 行，并继续从原入口 re-export 公开类型。本轮 `npm run test:release-candidate` 43/43、`npm run typecheck`、`npm run format:check` 通过。

已完成（2026-06-16 本轮实施）：新增 `src/lib/module-runtime/release/rc-gate-legacy-scan.ts`，集中维护 RC gate 的 legacy runtime 扫描器，包括默认扫描 target、文本扩展名、忽略目录、legacy term、cleanup context 判断、文件收集和 diagnostic 生成；`src/lib/module-runtime/release/rc-gate.ts` 当前 1930 行，继续保留 release evidence resolution 与 `runReleaseCandidateGate` 入口不变。完成证据：`npx tsx --test tests/release-candidate.test.ts` 49/49、`npm run typecheck`、本轮 code touched 文件 Prettier check 与 `git diff --check -- src/lib/module-runtime/release/rc-gate.ts src/lib/module-runtime/release/rc-gate-legacy-scan.ts` 均通过。

已完成（2026-06-15 本轮实施）：新增 `src/lib/module-runtime/stores/memory-runtime-store-commercial.ts`，集中维护 in-memory runtime store 的 metering、credit ledger/reservation、entitlement、commercial catalog/order 方法；`src/lib/module-runtime/stores/memory-runtime-store.ts` 当前降到 1855 行，低于 2000 行。本轮 `npm run test:runtime-stores` 内存子项 8/8 通过（默认 Postgres 2 项因本地库不可达按既有逻辑 skip）、`npm run test:commercial-ledger` 10/10、`npx tsx --test tests/web-shell-commercial.test.ts` 7/7、`npm run test:host-runtime` 20/20、`npm run typecheck`、`npm run format:check` 通过。

已完成（2026-06-15 本轮实施）：新增 `src/lib/module-capabilities/commercial/commercial-ledger-types.ts`、`commercial-ledger-admin.ts` 与 `commercial-ledger-provider.ts`，分别集中维护商业账本公开类型、Admin commercial runtime 和 provider paid/refund/reconcile/subscription/settlement runtime；`src/lib/module-capabilities/commercial/commercial-ledger.ts` 当前降到 1846 行，低于 2000 行。本轮 `npm run test:commercial-ledger` 10/10、`npx tsx --test tests/web-shell-commercial.test.ts` 7/7、`npm run test:host-runtime` 20/20、`npm run typecheck`、`npm run format:check` 通过。

已完成（2026-06-16 本轮实施）：新增 `src/lib/module-capabilities/commercial/commercial-ledger-facts.ts`，集中维护商业账本 ledger facts/revenue/refund helper，包括 paid order domain facts、billing account/subscription/invoice/tax snapshot 写入、revenue bucket 刷新、refund credit note 与 invoice refunded/net 更新；`src/lib/module-capabilities/commercial/commercial-ledger.ts` 当前降到 1537 行，provider runtime 继续通过同名回调调用，保持订单 paid/refund、replay/idempotency 与 revenue bucket 语义不变。完成证据：`npm run test:commercial-ledger` 10/10、`npx tsx --test tests/web-shell-commercial.test.ts` 7/7、`npx tsx --test tests/web-shell-stripe.test.ts` 4/4、`npm run typecheck` 与本轮 code touched 文件 Prettier check 均通过。

已完成（2026-06-16 本轮实施）：新增 `src/lib/module-capabilities/commercial/commercial-ledger-benefits.ts`，集中维护商业账本 order benefits/credits/entitlements helper，包括 paid order credits/entitlements 发放、full refund credits 反向入账、order-backed entitlement revoke，以及 benefit reconcile 缺失检测；`src/lib/module-capabilities/commercial/commercial-ledger.ts` 当前降到 1402 行，provider runtime 与 public commerce runtime 复用同一 helper，保持 paid/refund/replay/idempotency 语义不变。完成证据：`npm run test:commercial-ledger` 10/10、`npx tsx --test tests/web-shell-commercial.test.ts` 7/7、`npx tsx --test tests/web-shell-stripe.test.ts` 4/4、`npm run typecheck` 与本轮 code touched 文件 Prettier check 均通过。

已完成（2026-06-16 本轮实施）：新增 `src/lib/module-capabilities/commercial/commercial-ledger-subscriptions.ts`，集中维护商业账本 subscriptions helper，包括当前 subscription 查找、subscription event ordering 时间戳读取、plan entitlement 归一、subscription-backed entitlement grant/revoke 同步；`src/lib/module-capabilities/commercial/commercial-ledger.ts` 当前降到 1306 行，provider subscription event runtime 继续通过同名回调调用，保持 subscription idempotency、ordering 与 access sync 语义不变。完成证据：`npm run test:commercial-ledger` 10/10、`npx tsx --test tests/web-shell-commercial.test.ts` 7/7、`npx tsx --test tests/web-shell-stripe.test.ts` 4/4、`npm run typecheck` 与本轮 code touched 文件 Prettier check 均通过。

已完成（2026-06-16 本轮实施）：新增 `src/lib/module-capabilities/commercial/commercial-ledger-tax.ts`，集中维护商业账本 tax helper，包括 admin tax profile jurisdiction 规范化/本地校验/审计，以及 invoice tax snapshot 对 runtime tax profile 与 host user metadata 的读取；`src/lib/module-capabilities/commercial/commercial-ledger.ts` 当前降到 1334 行，admin runtime 与 ledger facts 继续通过同名回调调用，保持 tax profile scope 与 invoice tax evidence freeze 语义不变。完成证据：`npm run test:commercial-ledger` 10/10、`npx tsx --test tests/web-shell-commercial.test.ts` 7/7、`npx tsx --test tests/web-shell-stripe.test.ts` 4/4、`npm run typecheck`、本轮 code touched 文件 Prettier check 与 `git diff --check -- src/lib/module-capabilities/commercial/commercial-ledger.ts src/lib/module-capabilities/commercial/commercial-ledger-admin.ts src/lib/module-capabilities/commercial/commercial-ledger-tax.ts src/lib/module-capabilities/commercial/commercial-ledger-facts.ts` 均通过。

已完成（2026-06-16 本轮实施）：新增 `src/lib/module-capabilities/commercial/commercial-ledger-events.ts`，集中维护商业账本 provider events helper，包括 order status event payload、correlation/causation id、idempotency key 与 publish options；`src/lib/module-capabilities/commercial/commercial-ledger.ts` 当前降到 1287 行，provider runtime 继续通过同名回调调用，保持 paid/refunded order status outbox event 的 idempotency 与 payload 语义不变。完成证据：`npm run test:commercial-ledger` 10/10、`npx tsx --test tests/web-shell-commercial.test.ts` 7/7、`npx tsx --test tests/web-shell-stripe.test.ts` 4/4、`npm run typecheck`、本轮 code touched 文件 Prettier check、`npm run docs:encoding-check` 与 `git diff --check -- src/lib/module-capabilities/commercial/commercial-ledger.ts src/lib/module-capabilities/commercial/commercial-ledger-admin.ts src/lib/module-capabilities/commercial/commercial-ledger-tax.ts src/lib/module-capabilities/commercial/commercial-ledger-events.ts src/lib/module-capabilities/commercial/commercial-ledger-provider.ts src/lib/module-capabilities/commercial/commercial-ledger-facts.ts` 均通过。

已完成（2026-06-16 本轮实施）：新增 `src/lib/module-capabilities/commercial/commercial-ledger-credits.ts`，集中维护商业账本 credits helper，包括 credits balance/record、grant/consume/adjust/refund、reservation reserve/commit/release、revokeBySource 和 ledger list；`src/lib/module-capabilities/commercial/commercial-ledger.ts` 当前降到 1006 行，admin runtime、redeem code 发放和 metering charge 继续复用同一 credits helper，保持 subject-first、workspace scoped idempotency、reservation lifecycle 与 metering charge 语义不变。完成证据：`npm run test:commercial-ledger` 10/10、`npx tsx --test tests/web-shell-commercial.test.ts` 7/7、`npx tsx --test tests/web-shell-stripe.test.ts` 4/4、`npm run typecheck`、本轮 code touched 文件 Prettier check、`npm run docs:encoding-check` 与 `git diff --check -- src/lib/module-capabilities/commercial/commercial-ledger.ts src/lib/module-capabilities/commercial/commercial-ledger-credits.ts` 均通过。

已完成（2026-06-16 本轮实施）：新增 `src/lib/module-capabilities/commercial/commercial-ledger-metering.ts`，集中维护商业账本 usage/metering helper，包括 usage record/increment、metering authorize/commit/refund/void/reconcile，以及与 credits helper 协作的 metering charge 扣费、reservation commit 和失败 void；`src/lib/module-capabilities/commercial/commercial-ledger.ts` 当前降到 859 行，module runtime 继续通过同名 usage/metering API 暴露，保持 usage idempotency、metering charge replay、reservation overage fail-void 与 credits balance 语义不变。完成证据：`npm run test:commercial-ledger` 10/10、`npx tsx --test tests/web-shell-commercial.test.ts` 7/7、`npx tsx --test tests/web-shell-stripe.test.ts` 4/4、`npm run typecheck`、本轮 code touched 文件 Prettier check、`npm run docs:encoding-check` 与 `git diff --check -- src/lib/module-capabilities/commercial/commercial-ledger.ts src/lib/module-capabilities/commercial/commercial-ledger-metering.ts` 均通过。

已完成（2026-06-16 本轮实施）：新增 `src/lib/module-capabilities/commercial/commercial-ledger-commerce.ts`，集中维护商业账本 module commerce helper，包括 checkout 创建/读取、模块侧 applyCheckoutPaid/applyRefund、recordSubscriptionEvent、reconcilePaidOrderBenefits、scoped order lookup 和 paid input match guard；`src/lib/module-capabilities/commercial/commercial-ledger.ts` 当前降到 640 行，public `ctx.commerce` API 与 provider runtime scoped order guard 继续通过同名 helper 调用，保持 checkout/refund/reconcile/subscription/idempotency 语义不变。完成证据：`npm run test:commercial-ledger` 10/10、`npx tsx --test tests/web-shell-commercial.test.ts` 7/7、`npx tsx --test tests/web-shell-stripe.test.ts` 4/4、`npm run typecheck`、本轮 code touched 文件 Prettier check、`npm run docs:encoding-check` 与 `git diff --check -- src/lib/module-capabilities/commercial/commercial-ledger.ts src/lib/module-capabilities/commercial/commercial-ledger-commerce.ts` 均通过。

已完成（2026-06-16 本轮实施）：新增 `src/lib/module-capabilities/commercial/commercial-ledger-redeem.ts`，集中维护商业账本 redeem codes helper，包括 legacy `billing.redeemCode` 底层兑换、批量创建兑换码、subject/email bind 校验、兑换核销、entitlement/credits 发放、attempt audit、冻结/撤销、code/redemption 列表；`src/lib/module-capabilities/commercial/commercial-ledger.ts` 当前降到 406 行，module runtime 继续通过同名 billing/redeemCodes API 暴露，保持兑换码哈希、敏感元数据脱敏、scope/idempotency 与 credits helper 协作语义不变。完成证据：`npm run test:commercial-ledger` 10/10、`npx tsx --test tests/web-shell-commercial.test.ts` 7/7、`npx tsx --test tests/web-shell-stripe.test.ts` 4/4、`npm run typecheck`、本轮 code touched 文件 Prettier check、`npm run docs:encoding-check` 与 `git diff --check -- src/lib/module-capabilities/commercial/commercial-ledger.ts src/lib/module-capabilities/commercial/commercial-ledger-redeem.ts` 均通过。

已完成（2026-06-16 本轮实施）：新增 `src/lib/module-capabilities/commercial/commercial-ledger-risk.ts`，集中维护商业账本 risk helper，包括 risk event 记录、risk audit 写入、subject block upsert 和 scoped block check；`src/lib/module-capabilities/commercial/commercial-ledger.ts` 当前降到 326 行，module runtime 继续通过同名 `ctx.risk` API 暴露，保持 moduleId/scope、block scope 匹配和过期 block 跳过语义不变。完成证据：`npm run test:commercial-ledger` 10/10、`npx tsx --test tests/web-shell-commercial.test.ts` 7/7、`npx tsx --test tests/web-shell-stripe.test.ts` 4/4、`npm run typecheck`、本轮 code touched 文件 Prettier check、`npm run docs:encoding-check` 与 `git diff --check -- src/lib/module-capabilities/commercial/commercial-ledger.ts src/lib/module-capabilities/commercial/commercial-ledger-risk.ts` 均通过。

已完成（2026-06-16 本轮实施）：新增 `src/lib/module-capabilities/commercial/commercial-ledger-billing.ts`，集中维护商业账本 billing/entitlements helper，包括 active entitlement 过滤、plan/current plan 解析、legacy `billing.hasEntitlement`/`billing.redeemCode`、entitlements has/list/grant/revoke/override/expire；`src/lib/module-capabilities/commercial/commercial-ledger.ts` 当前降到 213 行，module runtime 继续通过同名 billing/entitlements API 暴露，保持 plan entitlement、subject-first grant/list、idempotency metadata 与过期 entitlement 过滤语义不变。完成证据：`npm run test:commercial-ledger` 10/10、`npx tsx --test tests/web-shell-commercial.test.ts` 7/7、`npx tsx --test tests/web-shell-stripe.test.ts` 4/4、`npm run typecheck`、本轮 code touched 文件 Prettier check、`npm run docs:encoding-check` 与 `git diff --check -- src/lib/module-capabilities/commercial/commercial-ledger.ts src/lib/module-capabilities/commercial/commercial-ledger-billing.ts` 均通过。

## 14. 依赖与供应链分析

当前根依赖：

- dependencies：15
- devDependencies：8
- Node engine：`>=22 <26`
- npm engine：`>=10`

本次验证：

- `npm ci` 成功。
- `npm audit --omit=dev --registry=https://registry.npmjs.org` 返回 0 vulnerabilities。

优势：

- 依赖数量克制。
- 模块依赖策略已有 `module-deps` 和测试约束。
- `test:production-runtime` 覆盖 HTTP egress 安全。

风险：

- `format:check` 原始失败已修复，但仍应作为 CI 基线持续保留。

已完成（2026-06-15 本轮实施）：

- `prettier` 仅用于 `format` / `format:check` / `format:all` npm scripts，源码、脚本、测试、模块和模板中没有运行期 import；已从 `dependencies` 移入 `devDependencies`，并同步更新 `package-lock.json`。
- 完成证据：`rg -n "from ['\"]prettier|require\(['\"]prettier|\bprettier\b" package.json package-lock.json src apps scripts tests modules templates docs --glob "!node_modules/**"` 仅保留 npm scripts、依赖声明和本文档记录；`npm run format:check` 通过。

建议：

- 保持 format gate 必跑，避免入口配置文件再次漂移。
- 周期性跑 audit 并固定官方 registry。
- 对模块依赖继续禁止 `file:`、`link:`、`workspace:`、git、URL、alias 等危险来源。

## 15. 干净重构原则与风险护栏

本节用于回答：如果不考虑兼容旧数据、旧内部实现和旧测试夹具，这些问题应该如何更彻底地修复，以及这样做会不会造成新的问题。

结论：可以走干净重构路线，但“干净”只意味着不保留历史脏数据和内部包袱，不意味着破坏产品级不变量。PloyKit 作为框架，必须保留以下不变量：

- 安全默认值不变：生产环境不能自动创建固定高权限账号。
- 租户边界不变：所有数据查询必须带 product/workspace/user scope。
- 权限语义不变：模块能力必须继续经过 capability guard。
- 认证防枚举不变：不存在用户的 password reset 仍不能暴露账号是否存在。
- 商业幂等不变：账本、订单、订阅、webhook replay 不能重复入账。
- 模块契约边界不变：模块仍通过 `module.ts`、loader、page、api、action、ctx capability 接入。
- 发布证据不变：重构后必须有命令和浏览器证据证明可上线。

### 15.1 可以不兼容的范围

如果明确选择“重置旧数据、清理旧实现”的路线，以下内容可以不保兼容：

| 范围                      | 可以怎么处理                        | 注意                           |
| ------------------------- | ----------------------------------- | ------------------------------ |
| 本地 demo 数据            | 可清空并重新 seed                   | seed 必须显式，生产默认关闭    |
| Postgres runtime schema   | 可重建 migration baseline           | 新 baseline 必须覆盖所有运行域 |
| memory store 内部结构     | 可按领域重写                        | 测试 helper 要同步             |
| Web Shell 测试 fixture    | 可按领域拆分和重置                  | 不再依赖全局 admin 隐式存在    |
| Dashboard shell 数据流    | 可重写为并行化/缓存化               | 保持用户可见路由和权限不退化   |
| Module page metadata 解析 | 可新增 metadata-only resolver       | 不应执行 page loader           |
| Admin/Dashboard 大页面    | 可按 page model、table、dialog 重拆 | 保持操作审计和权限 guard       |
| 静态品牌资源路径          | 可改为带 hash 文件名                | 文档和默认 brand 配置同步      |

不建议不兼容的范围：

- 公开 `module.ts` contract 的核心字段语义。
- `ctx.*` capability 名称和权限语义。
- API error envelope 和安全错误码。
- 审计事件语义。
- 商业账本的幂等 key 语义。
- 文件、Webhook、AI/RAG 等高风险能力的权限模型。

### 15.2 干净重构可能造成的新问题

| 改动方向               | 可能引入的问题                              | 防护方式                                                                          |
| ---------------------- | ------------------------------------------- | --------------------------------------------------------------------------------- |
| 重建 Postgres schema   | 迁移遗漏、索引缺失、null workspace 语义变化 | `runtime:stores:migrate`、`test:runtime-stores`、`host:postgres-local-smoke` 必跑 |
| 拆 runtime store       | memory/Postgres 行为不一致                  | 同一套 contract tests 同时跑 memory 与 Postgres                                   |
| 改 dashboard 路由缓存  | 用户看到过期 workspace/profile/权限         | 缓存 key 必含 user/product/workspace，权限变更后可失效                            |
| 去掉 `force-dynamic`   | 私有页面被错误缓存                          | 私有 dashboard 仍需 `no-store` 或 session scoped cache，不得 public cache         |
| metadata-only resolver | 标题/描述和页面内容不一致                   | metadata 只从 route static metadata 或轻量 metadata loader 来                     |
| 并行化 shell 数据      | 错误处理变复杂，局部失败拖垮整页            | 用 `Promise.allSettled` 区分必需和非必需数据                                      |
| 修 hydration           | 相对时间、当前状态显示变慢                  | 首屏显示绝对时间，hydration 后再增强                                              |
| 拆 Web Shell 测试      | 覆盖断层                                    | 先列旧测试目录映射，再逐组迁移                                                    |
| 拆大页面               | 操作按钮权限或审计丢失                      | 每个 action 组件保留权限、confirm、audit 三件套测试                               |
| 优化模块 API           | 统计数字短时间不实时                        | 标明刷新策略，关键状态单独实时拉取                                                |

### 15.3 推荐的干净修复策略

#### A. 认证与 Web Shell

当前问题不是产品逻辑必须兼容旧行为，而是测试夹具依赖隐式身份状态。干净修复应直接废弃隐式 admin 依赖：

1. Web Shell 测试每个文件自己创建需要的用户。
2. password reset 测试对刚注册的邮箱发起 reset。
3. 不存在用户 reset 单独测防枚举：返回成功语义，但不发送邮件。
4. demo admin 只在显式 seed 测试中出现。

这样不会破坏用户功能，反而会消除测试全局状态污染。

#### B. Runtime Store 与 Postgres

如果不兼容旧数据，建议不要继续给现有大 store 叠补丁，而是做一次领域化重构：

1. 建立新的 schema baseline，覆盖 identity、sessions、catalog、runs、outbox、audit、files、commercial、provider、notifications、risk。
2. 按领域拆 repository，不再让 `postgres-runtime-store.ts` 单文件承载全部 SQL。
3. memory store 也按同一领域接口拆分，避免 fake 行为和 Postgres 行为分叉。
4. 所有 repository 必须共享 scope helper，禁止手写散落的 workspace/product filter。
5. 对每个领域补 memory/Postgres 双路径测试。

这会舍弃旧迁移兼容，但能换来更干净的生产基线。只要当前产品还未承诺保留历史用户数据，这比在 29 个迁移之上继续修补更稳。

#### C. Dashboard 宿主性能

干净修复不应只做微调，而应重新定义 dashboard route 的数据分层：

1. Route shell：只负责 session、权限、navigation、scope、theme、用户菜单。
2. Module page resolver：只负责找到模块、权限检查、获取 page loader data。
3. Metadata resolver：只读 route static metadata 或轻量 metadata loader，不执行 page loader。
4. Client transition：必须保持 `next/link` 客户端导航，不允许 hydration error 让它退化成完整 document navigation。
5. Module API：页面内动态数据由模块自己请求，但宿主提供统一 abort/cache/error 约定。

关键是先修 hydration，再优化 document 耗时。否则所有缓存和并行化都会被完整页面重载掩盖。

#### D. Admin/Dashboard 大页面

不考虑旧内部结构时，应按产品域重拆，而不是机械按行数切文件：

1. `PageModel`：负责加载和派生 view model。
2. `Table`：只渲染列表和排序分页。
3. `Dialog/Form`：只处理单个操作。
4. `Action`：统一 confirm、权限、CSRF/origin、audit 文案。
5. `Copy`：移入领域 copy 文件，避免 inline i18n 扩散。

验收重点不是“文件变短”，而是每个操作的权限、审计、错误处理没有丢。

#### E. Module Map 与生成物

如果重构模块/模板，可以接受重新生成 module map，不需要兼容旧 hash。但必须保证：

1. `npm run modules:scan` 是唯一生成入口。
2. `npm run modules:check` 在 CI 中硬失败。
3. 生成物不包含本机绝对路径、外部仓库路径或不稳定时间戳。
4. 已完成：module map drift 报告直接列出模块 ID、旧 digest、新 digest、修复命令，并由 `test:module-map` 覆盖。
5. 已完成：模块 locale messages 在 `modules:scan` 阶段读取、校验并嵌入 generated module map；运行期 `translateModuleMessage` 不再读磁盘，避免 dashboard/admin 导航翻译把 `fs/path` 带进请求构建链路。
6. 已完成：generated `module-map.ts` 的类型 import 直接指向 `loader/module-map-types`，不再经过 runtime 总出口；后续 release gate、module-map-health、构建诊断类能力也应保持 direct import，不放回通用 barrel。

#### F. Production Build Import Boundary

如果不兼容旧内部结构，应把生产构建追踪边界作为一等架构约束，而不是把 Turbopack warning 当噪音：

1. 页面/API 路由只 import 运行期必需的轻量 helper，不直接 import 大聚合文件。
2. 诊断、release gate、module map health、文件扫描、CLI 专用能力必须放在 direct import 路径，不能从 runtime 总出口或 Web/API 常用 barrel 导出。
3. 运行期请求路径不得根据请求读项目源码、模块目录或 locale JSON；这些内容必须在 `modules:scan`、build 或显式诊断命令阶段生成。
4. Admin 操作按领域拆分：entitlements、delivery/outbox、settings、files、audit mutation、commercial view、runs detail/actions、module operations、module operation model、dev-console view、worker runtime status/drain、worker soak evidence 读取、worker readiness presenter 已提供独立 helper；Webhook 列表页 page model、worker panels、delivery tables、detail actions、detail evidence、detail tables 与 detail drawer 已从页面层拆出；后续转向其他大页面或抽通用表单/表格 primitives，避免任一 API route 静态带入整块 Admin 运营中心。
5. 每次触碰 barrel 或 Admin helper，都要用 production env + Postgres 跑 `host:build`，并显式检查没有 `Encountered unexpected file in NFT list`。

### 15.4 每类重构的验收命令

| 重构类型               | 必跑命令                                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 认证/Web Shell         | `npm run test:web-shell`、`npm run test:security-runtime`                                                                                                          |
| Runtime store/Postgres | `npm run db:up`、`npm run runtime:stores:migrate`、`npm run test:runtime-stores`、`npm run host:postgres-local-smoke`                                              |
| Dashboard 宿主路由     | `npm run typecheck`、`npm run test:host-runtime`、`npm run test:web-shell`、真实浏览器 route transition 脚本                                                       |
| 模块契约/runtime       | `npm run modules:scan`、`npm run modules:check`、`npm run module:doctor -- all`、`npm run module:test -- all`                                                      |
| 构建追踪/import 边界   | `npm run typecheck`、`npm run modules:check`、`npm run test:web-shell`、production env + Postgres 下 `npm run host:build` 且无 NFT warning                         |
| 商业账本               | `npm run test:commercial-ledger`、`npm run host:stripe-local-smoke`、`npm run host:billing-reconcile-smoke`                                                        |
| 文件/对象存储          | `npm run host:files-cleanup-smoke`、`npm run host:files-reconcile-smoke`、S3/local smoke                                                                           |
| AI/RAG/provider        | `npm run host:ai-rag-local-smoke`、`npm run host:rag-provider-smoke`、`npm run host:ai-rag-policy-smoke -- --required`、provider matrix                            |
| UI 拆分                | `npm run host:browser-matrix -- --required --base-url <host-url>`、`npm run host:accessibility-smoke -- --required --base-url <host-url>`、`npm run admin:ui-gate` |
| 发布总验收             | `npm run release:rc-gate`、`npm run release:evidence`                                                                                                              |

### 15.5 干净重构完成定义

一次干净重构只有在同时满足以下条件时才算完成：

- 删除了旧包袱，而不是同时保留新旧两套路径。
- 新路径有类型、runtime、测试、文档和发布证据。
- 没有把安全、权限、scope、审计、幂等这些约束从集中层打散到页面里。
- 所有 P0/P1 gate 绿色。
- 真实浏览器没有 hydration error、first-party 404/5xx、明显布局错位。
- 如果重置旧数据，文档中明确声明这是新 baseline，不承诺迁移历史环境。

### 15.6 不兼容旧数据时的风险复核

如果明确选择“不考虑旧数据兼容、不保留旧内部结构”，修复策略可以更干净，但不能把生产级约束一起删掉。下面是执行前必须逐项确认的风险复核。

| 改造点                 | 可以直接删除的旧包袱                                  | 不能破坏的不变量                                                             | 推荐修复方式                                                                          | 主要验证                                                                              |
| ---------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Runtime store baseline | 旧迁移兼容、历史表结构、过渡 adapter                  | 用户身份、session、workspace/product scope、audit、outbox 幂等、商业账本幂等 | 新建 baseline schema，按领域 repository 重写 memory/Postgres store，共享 scope helper | `db:up`、`runtime:stores:migrate`、`test:runtime-stores`、`host:postgres-local-smoke` |
| Dashboard route 数据层 | 旧的页面级串行数据读取、metadata 触发完整 page loader | 权限检查、模块路由匹配、私有页面不 public cache、错误边界                    | shell data、metadata data、module page data 三层拆开，metadata-only 保持权限检查      | `typecheck`、`test:host-runtime`、`test:web-shell`、真实 route transition             |
| Hydration 修复         | 服务端/客户端各自拼文本、随机值、相对时间首屏直出     | 首屏内容可读、客户端增强后状态准确、无 React #418                            | 服务端输出稳定文本；相对时间、实时状态、随机 UI 在 client hydration 后增强            | 浏览器控制台无 hydration error，切路由无 document navigation                          |
| Auth/Web Shell 测试    | 隐式 demo admin、跨测试共享身份状态                   | 防枚举、token 不泄露、cookie/session 安全、邮件 provider 合同                | 每个测试自建用户；demo admin 只在显式 seed 测试出现                                   | `test:web-shell`、`test:security-runtime`                                             |
| Module map 生成物      | 旧 digest、旧 hash、历史扫描产物                      | 生成入口唯一、无绝对路径、无外部仓库污染、contract digest 稳定               | 重新 scan 并提交生成物；CI 强制 `modules:check`                                       | `modules:scan`、`modules:check`、`module:doctor -- all`                               |
| Admin/Dashboard 大页面 | 旧页面内部 state 组织、巨型组件、重复 copy            | 操作权限、confirm、CSRF/origin、防误操作、audit 文案                         | 按 page model/table/dialog/action/copy 拆，action 层统一封装                          | `test:web-shell`、`admin:ui-gate`、browser/accessibility                              |
| 商业账本               | 旧 provider event shape、旧演示数据、历史试验字段     | ledger append-only 语义、idempotency key、refund/credit/order 可审计         | 按 orders/subscriptions/credits/provider events 重写领域层                            | `test:commercial-ledger`、Stripe local smoke、billing reconcile                       |
| 文件/对象存储          | 旧本地目录结构、旧 metadata shape                     | object 与 metadata 一致、quota、cleanup/reconcile、owner scope               | 新 storage baseline，提供一次性 reset 脚本，不承诺迁移旧对象                          | files cleanup/reconcile smoke、quota tests                                            |

执行原则：

1. 能删除旧路径就删除旧路径，不做“新旧双写”的长期兼容。
2. 数据重置必须在部署文档中显式写成新 baseline，不能让使用者误以为会迁移旧环境。
3. 每个新领域 repository 必须先有 contract test，再替换页面或 handler 调用。
4. 安全、权限、scope、审计、幂等只能上移到更集中层，不能下沉成页面里的散落判断。
5. 每个阶段只允许一个主风险面变化：例如先重写 runtime store，就不要同时大改 Dashboard UI。
6. 每完成一项，在本报告第 16、17、18 节同步状态和证据，避免文档变成旧世界地图。

## 16. 当前风险清单

### P0

当前未发现仍然存在的 P0 级默认安全或外部生成物污染问题。module map drift 已在本次分析中修复，并已通过 `modules:check`。

注意：如果不提交本次更新后的 `src/lib/module-map.ts` 和 `src/lib/module-map.manifest.json`，P0/P1 级发布卫生风险会重新出现。

### P1

#### P1-1 Web Shell auth transactional email 原始失败已修复

状态：已完成（2026-06-14 本轮实施）。

原始证据：

- `npm run test:web-shell`：75 个子测试中 1 个失败。
- 单独运行 `X9 auth transactional routes use the host email provider contract` 仍失败。

影响：

- Web Shell gate 无法绿色。
- auth transaction email 路径的测试前置状态不稳定，会降低认证/邮件链路的发布信心。

建议：

- 修测试前置状态：对刚注册邮箱请求 reset，或显式 seed/bootstrap admin。
- 补不存在用户不发邮件但返回 sent=true 的防枚举测试。

已实施：

- `X9 auth transactional routes use the host email provider contract` 改为对测试内刚注册的随机邮箱请求 reset，不再依赖 `admin@example.com` 的隐式全局存在。
- 增加不存在用户 password reset 防枚举断言：返回 sent=true，但不会触发新的邮件发送。
- 将 password reset route 的生产响应 shape 抽为 `passwordResetResponseData`，单独验证 production 不返回 `resetToken`，避免为了测试 token hiding 把整条 route 切到 production 后误触 memory runtime store 禁用。

完成证据：

- `npx tsx --test tests/web-shell-auth.test.ts` 通过。
- `npm run test:web-shell` 通过，75 个子测试全部通过。

#### P1-2 Postgres 持久化路径缺少本次完整验证

状态：已完成基础验证（2026-06-14 本轮实施）。

原始证据：

- `test:runtime-stores` 中 Postgres 子项因本地 DB 不可达被 skip。

影响：

- 不能用本次结果证明生产持久化 store 全绿。

建议：

- 启动 Postgres 后跑 runtime store、migration、host postgres smoke。
- 会重置 runtime 表的 Postgres 测试必须串行执行，或使用独立临时数据库，避免并发测试互相 drop 表制造假失败。

已实施：

- 启动 Docker Desktop 后，发现默认 compose 的 `ploykit-v2-postgres` 同名容器来自另一个历史工作目录。为避免污染旧环境，本轮改用 `ploykit-postgres-smoke-*` 隔离临时容器，显式映射到 `127.0.0.1:55433`。
- 对同一临时库串行执行 migration verify、runtime store、commercial Postgres、host postgres smoke；验证结束后停止临时容器。

完成证据：

- `npm run runtime:stores:verify` 通过：29 个 migration 全部 applied，schema 无 missing、columnIssues、indexIssues、migrationIssues。
- `npm run test:runtime-stores` 通过：9 个子测试全部通过，0 skipped，Postgres 子项 2/2 实际执行。
- `npm run test:commercial-postgres` 通过：1 个子测试通过。
- `npm run host:postgres-local-smoke -- --no-docker` 通过，报告路径为 `.runtime/runtime-store-postgres/2026-06-14T09-57-16-250Z/postgres-local-smoke.json`。

#### P1-3 Dashboard 宿主路由切换过慢且出现 hydration error

证据：

- 线上登录后访问 `/dashboard/origin-agentops/agents`，页面可正常进入 `Origin AgentOps`。
- 已登录硬刷新 dashboard 页面稳定约 4.8-5.1 秒。
- Dashboard 内部路由切换稳定约 3.9-5.1 秒。
- 独立 Playwright 网络瀑布显示，切换左侧导航时产生完整 document 请求，而不是轻量 RSC 客户端导航；document 请求约 2.9-3.6 秒。
- 生产控制台出现 `Minified React error #418`，参数指向 text hydration mismatch。
- 本轮使用修正后的 `host:dashboard-transition-smoke` 复测线上 `/dashboard/origin-agentops/agents -> skills -> tools`：登录成功，初始页 200，但两次 transition 仍各产生 1 次 document navigation，耗时 5775ms、5024ms，P95 5775ms；本次未捕获 hydration error。
- 本轮新增宿主 AppFrame 普通锚点 client transition 兜底后，本地 `--inject-anchor` smoke 通过：注入普通 `<a>` 点击 `/zh/dashboard -> /zh/dashboard/workspaces -> /zh/dashboard/files`，transition document navigation 为 0，hydration error 为 0，P95 277ms；普通 Next Link 路径本地 smoke 也通过，P95 243ms。
- 本轮继续补强本地长期观察：`host:dashboard-transition-smoke` 支持 `--repeat`/`HOST_DASHBOARD_TRANSITION_REPEAT` 和 `--fail-fast`，repeat 模式会把轮次间 `/zh/dashboard/files -> /zh/dashboard` reset transition 也纳入断言；三轮 `--inject-anchor --repeat 3 --required` 通过，8/8 transition、2 次 reset transition、transition document navigation 0、hydration error 0、P50 203ms、P95 246ms。

宿主责任：

- `apps/host-next/app/(dashboard)/dashboard/[[...modulePath]]/page.tsx` 强制动态渲染；`generateMetadata` 与页面主体重复 `resolvePageRoute` 的问题本轮已通过 metadata-only resolver 先行修复。
- 宿主 shell 在页面主体中串行解析 session、navigation、scope、workspace、theme、profile 等信息。
- 宿主缺少 dashboard 分段 `Server-Timing`，目前无法从服务端响应直接定位慢段。
- 宿主需要先兜底 hydration mismatch 和模块普通锚点，因为这些问题会让 `next/link` 的客户端导航收益消失，用户感知变成每次整页加载。本轮已完成普通锚点兜底的本地验证，并补了本地三轮 repeat soak；线上 hydration 长周期观察和部署后复测仍未完成。

影响：

- 用户每次切换模块 dashboard 路由都等待数秒，接近不可接受的生产体验。
- Hydration error 可能导致客户端交互退化，后续 UI 行为不稳定。
- 没有服务端分段计时会让线上事故只能靠猜测定位。

建议：

- 先修 hydration #418，并加入浏览器回归：dashboard 左侧路由切换不得产生新的 `document` 请求。
- Dashboard 路由加 `Server-Timing`，拆分 host session、module host、navigation、route resolve、loader、metadata、workspace/profile/theme。
- 已完成：Metadata 解析改为 metadata-only，不执行完整 page loader。
- 已完成本地兜底：AppFrame 内 dashboard/admin 普通锚点点击改走 `router.push`，防止模块普通 `<a>` 在 hydrated 后触发完整 document navigation；线上环境需部署后复测。
- 对 workspace/profile/navigation/theme 做请求级 memoization、短缓存和并行化。

已完成子项：

- 新增 `resolveModulePageRouteMetadata` / `host.resolvePageRouteMetadata`，共享路由匹配和访问权限检查，但不加载页面组件、不执行 page loader。
- Dashboard `generateMetadata` 已改用 metadata-only 路径；页面主体继续使用完整 `resolvePageRoute` 渲染模块页。
- 新增 `createModuleHost resolves page route metadata without running page loader` 测试，固定 metadata-only 不触发 component loader 和 page loader。
- `host:dashboard-transition-smoke` 已修正线上登录请求，带同源 `Origin` / `Referer`，不会再被生产 same-origin guard 403 拦截。
- 新增 `ClientTransitionLinks` 和 `resolveHostClientTransitionHref`，宿主在 AppFrame 内接管同源 dashboard/admin 普通锚点，同时不破坏外链、新窗口、下载、modifier click、hash-only 和非 dashboard/admin 链接默认行为。
- `host:dashboard-transition-smoke` 新增 `--inject-anchor`，能把普通 `<a>` 注入 AppFrame 内验证宿主兜底是否生效。
- `host:dashboard-transition-smoke` 新增 `--repeat` / `HOST_DASHBOARD_TRANSITION_REPEAT` 和 `--fail-fast`；多轮观察会记录 `repeatIndex`，并把轮次间 reset transition 计入 document navigation、hydration 和 P95 断言。

完成证据：

- `npm run test:host-runtime` 通过，20 个子测试全部通过。
- `npm run test:web-shell` 通过，75 个子测试全部通过。
- `npm run typecheck` 通过。
- `npm run test:production-runtime` 通过，15 个子测试全部通过；新增 `host client transition catches module dashboard anchors without breaking safe link defaults` 覆盖普通锚点兜底决策。
- `npm run host:dashboard-transition-smoke -- --base-url https://aijia.yingasi.com --routes /dashboard/origin-agentops/agents,/dashboard/origin-agentops/skills,/dashboard/origin-agentops/tools --max-p95-ms 10000` 已真实登录并复测，结论为失败：transition document navigation 2，P95 5775ms，hydration error 0；截图已检查。
- 2026-06-16 线上 required repeat 复测仍失败：`--repeat 3 --max-p95-ms 1000` 下 8/8 次 transition 均产生完整 document navigation，P95 2968ms；`--inject-anchor --repeat 3` 对照也失败，P95 3737ms；增强后短复测显示 `appFramePresent=false`、`clientTransitionMarkerPresent=false`。
- `npm run host:dashboard-transition-smoke -- --base-url http://localhost:3000 --routes /zh/dashboard,/zh/dashboard/workspaces,/zh/dashboard/files --inject-anchor --max-p95-ms 5000` 通过；普通 `<a>` 注入路径 transition document navigation 为 0，hydration error 为 0，P50 228ms、P95 277ms，截图已检查。
- `npm run host:dashboard-transition-smoke -- --base-url http://localhost:3000 --routes /zh/dashboard,/zh/dashboard/workspaces,/zh/dashboard/files --max-p95-ms 5000` 通过；普通宿主导航 transition document navigation 为 0，hydration error 为 0，P50 228ms、P95 243ms，截图已检查。
- `npm run host:dashboard-transition-smoke -- --base-url http://localhost:3000 --routes /zh/dashboard,/zh/dashboard/workspaces,/zh/dashboard/files --inject-anchor --repeat 3 --max-p95-ms 5000 --required` 通过；8/8 transition、2 次 reset transition、transition document navigation 为 0、hydration error 为 0、P50 203ms、P95 246ms，报告 `.runtime/dashboard-transition-smoke/2026-06-15T17-22-07-251Z/dashboard-transition-smoke.json`，截图 contact sheet 已检查：`.runtime/dashboard-transition-smoke/2026-06-15T17-22-07-251Z/contact-sheet.png`。

### P2

#### P2-1 Format gate 原始失败已修复

状态：已完成（2026-06-14 本轮实施）。

原始证据：

- `npm run format:check` 失败。
- 4 个入口文件需要 Prettier。

建议：

- 执行 `npm run format` 后复跑。

完成证据：

- 已执行 `npm run format`。
- `npm run format:check` 通过，输出 `All matched files use Prettier code style!`。

#### P2-2 核心文件过大

状态：已完成（2026-06-16 本轮已将当前源码、脚本和测试文本文件中的 2000 行以上热点全部降到 2000 行以内）。

证据：

- 多个核心文件超过 2000 行。

建议：

- 按本报告第 13 节分阶段拆分。

已实施：

- `scripts/ploykit-module.mjs` 的模板/扩展 catalog、`module:create` usage 和 `templates` JSON 文件清单生成已迁入 `scripts/lib/module-template-catalog.mjs`，主 CLI 不再直接维护模板目录扫描和 help choice list。
- service-backed/background 模板 extension marker cleanup 与 overlay 注入已迁入 `scripts/lib/module-template-extensions.mjs`，主 CLI create 流程不再内联大段 extension contract 片段。
- module source hash 文件枚举和 contract digest 计算已迁入 `scripts/lib/module-digests.mjs`，doctor summary、module map drift 检查与 `inspect` 命令复用同一 helper；该轮 `scripts/ploykit-module.mjs` 降到 2111 行。
- `module:create` 参数解析、模板复制、Data artifact 生成、module map 刷新、doctor 执行和输出 payload 已迁入 `scripts/lib/module-create-command.mjs`；该轮 `scripts/ploykit-module.mjs` 降到 1959 行，已低于 2000 行。
- `ploykit-module` doctor/inspect 复用的 contract source parser 已迁入 `scripts/lib/module-contract-source.mjs`，diagnostic 分类/标准化/去重/源码定位已迁入 `scripts/lib/module-doctor-diagnostics.mjs`，root help/JSON 输出/argv command dispatch/unknown command/top-level error reporting 已迁入 `scripts/lib/module-cli-runner.mjs`，doctor 静态 contract rule group 已迁入 `scripts/lib/module-doctor-contract-rules.mjs`，capability rule group 已迁入 `scripts/lib/module-doctor-capability-rules.mjs`，dependency rule group 已迁入 `scripts/lib/module-doctor-dependency-rules.mjs`，module map rule group 已迁入 `scripts/lib/module-doctor-map-rules.mjs`，source-boundary rule group 已迁入 `scripts/lib/module-doctor-source-boundary-rules.mjs`，command execution helper 已迁入 `scripts/lib/module-command-execution.mjs`；`scripts/ploykit-module.mjs` 当前 397 行。
- Data v2 generated migration SQL 的 quoting、column type/default、document store、metadata tables、RLS policy 与 table/index SQL 生成已迁入 `scripts/lib/module-data-sql.mjs`；generated artifact 路径、plan/types/migration 写入、stale/missing 静态校验和 `migrate --dry-run` migration entry 收集已迁入 `scripts/lib/module-data-artifacts.mjs`；`verify-db` RLS policy/table verifier 已迁入 `scripts/lib/module-data-db-rls.mjs`；数据库连接池、URL 解析、catalog introspection、metadata hash 与 role safety 快照读取已迁入 `scripts/lib/module-data-db-introspection.mjs`；role safety verifier 已迁入 `scripts/lib/module-data-db-role-safety.mjs`；DB schema verifier 已迁入 `scripts/lib/module-data-db-schema-verifier.mjs`；`verify-db` command flow 已迁入 `scripts/lib/module-data-verify-db-command.mjs`；`migrate` / `reset --force` DB mutation runner 已迁入 `scripts/lib/module-data-db-mutate-command.mjs`；`plan` / `generate` / `types` / `verify` static command helper 已迁入 `scripts/lib/module-data-static-commands.mjs`；reset SQL 生成已迁入 `scripts/lib/module-data-reset-sql.mjs`；usage/argv command dispatch/unknown command/top-level error/finally hook 已迁入 `scripts/lib/module-data-cli-runner.mjs`；generated TypeScript types 已迁入 `scripts/lib/module-data-types.mjs`；Data plan normalization 已迁入 `scripts/lib/module-data-plan.mjs`；migrate/reset dry-run output 已迁入 `scripts/lib/module-data-dry-run.mjs`；module.ts loader 已迁入 `scripts/lib/module-data-loader.mjs`；migrate/reset apply command flow 已迁入 `scripts/lib/module-data-apply-commands.mjs`；resolve/path safety 已迁入 `scripts/lib/module-data-paths.mjs`；command args parser 已迁入 `scripts/lib/module-data-args.mjs`；DB verifier composition 已迁入 `scripts/lib/module-data-db-verifier.mjs`；command dependency wiring 已迁入 `scripts/lib/module-data-command-dependencies.mjs`；`scripts/module-data.mjs` 当前 46 行，已低于 2000 行。
- Data v2 contract validation 的 documents、tables、relations、views、grants、checks 与 migrations 校验已迁入 `src/module-sdk/validator-data.ts`，public API `anonymousPolicy` 细则校验已迁入 `src/module-sdk/validator-anonymous-policy.ts`，module product/navigation contract validation 已迁入 `src/module-sdk/validator-product.ts`，resources/i18n contract validation 已迁入 `src/module-sdk/validator-resources.ts`，actions contract validation 已迁入 `src/module-sdk/validator-actions.ts`，routes contract validation 已迁入 `src/module-sdk/validator-routes.ts`，surfaces contract validation 已迁入 `src/module-sdk/validator-surfaces.ts`，theme/presentation contract validation 已迁入 `src/module-sdk/validator-presentation.ts`，jobs/events/webhooks contract validation 已迁入 `src/module-sdk/validator-background.ts`，runtime metadata/egress contract validation 已迁入 `src/module-sdk/validator-runtime-metadata.ts`；`src/module-sdk/validator.ts` 当前 237 行，已低于 2000 行并退出 Top 25。
- Host capability providers 的 API key create/rotate/revoke/list/verify、machine route API key verifier、owner/scope/permission guard 和 secret/hash/prefix helper 已迁入 `apps/host-next/lib/capability-api-keys.ts`；`apps/host-next/lib/capability-providers.ts` 保留 services/connectors/runs/jobs/events/webhooks 与最终 capability provider 组装，并从原入口兼容 re-export API key provider/verifier，当前 1199 行。
- Admin service connections 的 signed service readiness probe、HTTP health check、base-path joining、egress/private-network/path guard、timeout fetch 与 deterministic latency fallback 已迁入 `apps/host-next/lib/admin-service-connection-health.ts`；`apps/host-next/lib/admin-service-connections.ts` 保留 Admin action、policy normalization、row mapping、audit state 和 view composition，当前 1212 行。
- Runtime store 的 common scope、notification/delivery、observability/audit/usage/provider invocation、RAG、identity、risk、file 与 config/resource 类型已迁入 `src/lib/module-runtime/stores/runtime-store-common-types.ts`、`runtime-store-notification-types.ts`、`runtime-store-observability-types.ts`、`runtime-store-rag-types.ts`、`runtime-store-identity-types.ts`、`runtime-store-risk-types.ts`、`runtime-store-file-types.ts` 与 `runtime-store-config-types.ts`；execution 类型契约已迁入 `src/lib/module-runtime/stores/runtime-store-execution-types.ts`，包括 runs、outbox、delivery ledger、worker heartbeat 与 webhook receipt 的 status/record/input/query 类型；`src/lib/module-runtime/stores/runtime-store-types.ts` 继续从原入口 re-export execution/commercial/notification/observability/RAG/identity/risk/file/config 类型并保留 `RuntimeStore` interface，当前 911 行。
- Capability guard 的 deny/session permission/module permission/system-only permission、config/service/resource binding 声明检查、resource binding 写权限、commercial subject 访问判定和 subject 过滤 helper 已迁入 `src/lib/module-runtime/security/capability-guard-common.ts`；`src/lib/module-runtime/security/capability-guard.ts` 保留具体 capability wrapper 与 `guardModuleContextCapabilities` 编排，当前 1137 行。
- Admin inline i18n 的中英 exact dictionary 已迁入 `apps/host-next/lib/admin-inline-i18n-dictionaries.ts`，中文短语 fallback 规则已迁入 `apps/host-next/lib/admin-inline-i18n-phrases.ts`；`apps/host-next/lib/admin-inline-i18n.ts` 保留 catalog lookup、placeholder interpolation、email-preserving fallback 和 `adminInlineText` / `adminInlineColumns` 入口，当前 57 行。后续若继续治理 copy，应按 Admin 产品域拆字典，而不是把文案回流到运行逻辑入口。
- Backup/restore semantic smoke 的固定 product/workspace/module/user/redeem scope 与 runtime store 语义域 seed fixture 已迁入 `scripts/host-backup-restore-smoke-fixture.ts`；`scripts/host-backup-restore-smoke.ts` 保留 snapshot、fingerprint、restore 和 report 编排，当前 1244 行。
- RC gate 的公开结果类型、evidence report shape、module quality requirement 与 domain evidence 类型已迁入 `src/lib/module-runtime/release/rc-gate-types.ts`，legacy runtime 扫描器已迁入 `src/lib/module-runtime/release/rc-gate-legacy-scan.ts`，evidence JSON/manifest/report 读取与 module quality requirement 收集已迁入 `src/lib/module-runtime/release/rc-gate-evidence.ts`；`src/lib/module-runtime/release/rc-gate.ts` 当前 1472 行，已低于 2000 行，并继续从原入口 re-export 公开类型。
- In-memory runtime store 的 runs/outbox/delivery/worker/webhook receipt 方法已迁入 `src/lib/module-runtime/stores/memory-runtime-store-execution.ts`，metering、credit ledger/reservation、entitlement、commercial catalog/order 方法已迁入 `src/lib/module-runtime/stores/memory-runtime-store-commercial.ts`，billing account/invoice/credit note 方法已迁入 `src/lib/module-runtime/stores/memory-runtime-store-billing.ts`，subscription/event 方法已迁入 `src/lib/module-runtime/stores/memory-runtime-store-subscriptions.ts`，tax/revenue/settlement 方法已迁入 `src/lib/module-runtime/stores/memory-runtime-store-finance.ts`，redeem code/redemption 方法已迁入 `src/lib/module-runtime/stores/memory-runtime-store-redeem.ts`，API key/host user 方法已迁入 `src/lib/module-runtime/stores/memory-runtime-store-identity.ts`，RAG source/chunk 方法已迁入 `src/lib/module-runtime/stores/memory-runtime-store-rag.ts`，file create/get/update/list 方法已迁入 `src/lib/module-runtime/stores/memory-runtime-store-files.ts`，settings/service connection/resource binding 方法已迁入 `src/lib/module-runtime/stores/memory-runtime-store-config.ts`，catalog state/membership/product scope 方法已迁入 `src/lib/module-runtime/stores/memory-runtime-store-product-scope.ts`，notifications/deliveries 方法已迁入 `src/lib/module-runtime/stores/memory-runtime-store-notifications.ts`，audit/usage/provider invocation 方法已迁入 `src/lib/module-runtime/stores/memory-runtime-store-observability.ts`，risk event/block 方法已迁入 `src/lib/module-runtime/stores/memory-runtime-store-risk.ts`；`src/lib/module-runtime/stores/memory-runtime-store.ts` 当前 55 行组合入口，已低于 2000 行。
- 商业账本的公开类型已迁入 `src/lib/module-capabilities/commercial/commercial-ledger-types.ts`，Admin runtime 已迁入 `src/lib/module-capabilities/commercial/commercial-ledger-admin.ts`，provider paid/refund/reconcile/subscription/settlement runtime 已迁入 `src/lib/module-capabilities/commercial/commercial-ledger-provider.ts`，ledger facts/revenue/refund helper 已迁入 `src/lib/module-capabilities/commercial/commercial-ledger-facts.ts`，order benefits/credits/entitlements helper 已迁入 `src/lib/module-capabilities/commercial/commercial-ledger-benefits.ts`，subscriptions helper 已迁入 `src/lib/module-capabilities/commercial/commercial-ledger-subscriptions.ts`，tax helper 已迁入 `src/lib/module-capabilities/commercial/commercial-ledger-tax.ts`，provider events helper 已迁入 `src/lib/module-capabilities/commercial/commercial-ledger-events.ts`，credits helper 已迁入 `src/lib/module-capabilities/commercial/commercial-ledger-credits.ts`，usage/metering helper 已迁入 `src/lib/module-capabilities/commercial/commercial-ledger-metering.ts`，module commerce helper 已迁入 `src/lib/module-capabilities/commercial/commercial-ledger-commerce.ts`，redeem codes helper 已迁入 `src/lib/module-capabilities/commercial/commercial-ledger-redeem.ts`，risk helper 已迁入 `src/lib/module-capabilities/commercial/commercial-ledger-risk.ts`，billing/entitlements helper 已迁入 `src/lib/module-capabilities/commercial/commercial-ledger-billing.ts`；`src/lib/module-capabilities/commercial/commercial-ledger.ts` 当前 188 行，已低于 2000 行。
- `tests/module-doctor-cli.test.ts` 的临时 fixture 改为创建在 `modules/doctor-fixture-*` 并在测试结束清理，继续遵守当前显式模块根必须位于 `modules/<id>` 的安全边界；`test:module-map` 仍覆盖工作区外模块根拒绝。
- `tests/advanced-runtime.test.ts` 的 Data CLI 临时 fixture 改为创建在 `modules/data-fixture-*` 并在测试结束清理，继续遵守当前显式模块根必须位于 `modules/<id>` 的安全边界。
- `tests/advanced-runtime.test.ts` 的 Data CLI helper 类型、动态导入和 fixture 清理已迁入 `tests/advanced-runtime-data-helpers.ts`；本轮进一步把动态导入迁入 `tests/advanced-runtime-data-module-imports.ts`、fixture 清理迁入 `tests/advanced-runtime-data-fixtures.ts`，主测试文件当前 79 行，helper 类型出口 680 行，动态 import helper 101 行，fixture helper 22 行，23 个 advanced-runtime 子测试保持同一 `test:advanced-runtime` gate 覆盖。

完成证据：

- `node scripts/ploykit-module.mjs templates` 输出成功。
- `node scripts/ploykit-module.mjs --help` 输出成功，且 unknown command 维持非零退出。
- `node scripts/ploykit-module.mjs create --help` 输出成功。
- `node --check scripts/lib/module-doctor-contract-rules.mjs` 通过。
- `node --check scripts/lib/module-doctor-capability-rules.mjs` 通过。
- `node --check scripts/lib/module-doctor-dependency-rules.mjs` 通过。
- `node --check scripts/lib/module-doctor-map-rules.mjs` 通过。
- `node --check scripts/lib/module-doctor-source-boundary-rules.mjs` 通过。
- `node --check scripts/lib/module-command-execution.mjs` 通过。
- `node --check scripts/lib/module-data-db-introspection.mjs` 通过。
- `node --check scripts/lib/module-data-db-role-safety.mjs` 通过。
- `node --check scripts/lib/module-data-db-schema-verifier.mjs` 通过。
- `node --check scripts/lib/module-data-verify-db-command.mjs` 通过。
- `node --check scripts/lib/module-data-db-mutate-command.mjs` 通过。
- `node --check scripts/lib/module-data-static-commands.mjs` 通过。
- `node --check scripts/lib/module-data-reset-sql.mjs` 通过。
- `node --check scripts/lib/module-data-cli-runner.mjs` 通过。
- `node --check scripts/lib/module-data-types.mjs` 通过。
- `node --check scripts/lib/module-data-plan.mjs` 通过。
- `node --check scripts/lib/module-data-dry-run.mjs` 通过。
- `node --check scripts/lib/module-data-loader.mjs` 通过。
- `node --check scripts/lib/module-data-apply-commands.mjs` 通过。
- `node --check scripts/lib/module-data-paths.mjs` 通过。
- `node --check scripts/lib/module-data-args.mjs` 通过。
- `node --check scripts/lib/module-data-db-verifier.mjs` 通过。
- `node --check scripts/lib/module-data-command-dependencies.mjs` 通过。
- `node scripts/ploykit-module.mjs create <临时模块> --template basic` 成功生成模块，随后 `node scripts/ploykit-module.mjs doctor <临时模块>` 通过；验证后已删除临时模块并恢复当前 module map。
- `node scripts/ploykit-module.mjs inspect modules/hello` 输出成功，`sourceHash` 与 `contractDigest` 与拆分前一致。
- `node scripts/ploykit-module.mjs dev modules/hello` 输出成功，覆盖 `module-deps --install`、module map `--check` 和 `ploykit-module check` 三段 command execution。
- `node scripts/module-data.mjs generate modules/hello --check` 通过，generated migration SQL 无漂移。
- `node scripts/module-data.mjs types modules/hello --check` 刷新 stale `modules/hello/.ploykit/generated/data-types.ts` 后，`node scripts/module-data.mjs verify modules/hello` 通过。
- `node scripts/module-data.mjs migrate modules/hello --dry-run` 通过，输出 1 条 hello generated migration entry 且 diagnostics 为空。
- `node scripts/module-data.mjs reset modules/hello --dry-run` 通过，输出 1 条 hello reset plan 且 diagnostics 为空。
- `node scripts/module-data.mjs <unknown>` 保持预期非零退出并输出 Data CLI usage。
- `node scripts/module-data.mjs verify-db modules/hello` 在无数据库配置下保持预期 `MODULE_DATA_VERIFY_DB_DATABASE_URL_REQUIRED` 非零输出。
- `npm run test:advanced-runtime` 通过，23/23。
- `npm run test:module-contract` 通过，19/19。
- `npm run test:module-doctor` 通过，14/14。
- `npm run test:module-map` 通过，10/10。
- `npm run test:developer-experience` 通过，11/11。
- `npm run test:api-key-store` 通过，1/1。
- `npm run test:host-runtime` 通过，21/21。
- `npx tsx --test tests/web-shell-service-connections.test.ts` 通过，1/1。
- `npm run test:web-shell -- --test-name-pattern "A4 service connection|X11 admin provider status|X11 config doctor|K4 host security"` 通过，实际执行 76/76。
- `npm run host:backup-restore-smoke -- --required` 通过，仍覆盖 38 个 runtime store domain。
- `npm run test:background-reliability` 通过，11/11。
- `npm run module:doctor -- all` 通过，7/7 module diagnostics clean。
- `npm run modules:check` 通过。
- `npm run test:release-candidate` 通过，43/43。
- `npm run test:runtime-stores` 默认本地运行通过，12 个子测试中 10 pass、2 个 Postgres 子项因本地库不可达按既有逻辑 skip。
- `npm run test:rag-files` 通过，5 个子测试中 4 pass、1 个 Postgres 子项因本地库不可达按既有逻辑 skip。
- `npm run test:api-key-store` 通过，1/1。
- `npm run test:security-runtime` 通过，22/22。
- `npm run test:commercial-ledger` 通过，10/10。
- `npx tsx --test tests/admin-inline-i18n.test.ts` 通过，2/2。
- `npm run i18n:check` 通过，inline copy inventory 为 0。
- `npx tsx --test tests/web-shell.test.ts tests/web-shell-commercial.test.ts tests/web-shell-service-connections.test.ts tests/web-shell-files.test.ts tests/web-shell-identity.test.ts tests/web-shell-settings.test.ts` 通过，29/29。
- `npx tsx --test tests/web-shell.test.ts --test-name-pattern "notifications"` 通过，7/7。
- `npx tsx --test tests/web-shell-admin-identity.test.ts tests/web-shell-operations-status.test.ts tests/web-shell-service-connections.test.ts` 通过，7/7。
- `npx tsx --test tests/web-shell-service-connections.test.ts tests/web-shell-files.test.ts tests/web-shell-identity.test.ts tests/web-shell-product-scope.test.ts` 通过，18/18。
- `npx tsx --test tests/product-scope-runtime.test.ts tests/files-storage-driver.test.ts` 通过，10/10。
- `npx tsx --test tests/web-shell-commercial.test.ts` 通过，7/7。
- `npx tsx --test tests/web-shell-stripe.test.ts` 通过，4/4。
- `npm run test:host-runtime` 通过，20/20。
- `npm run test:advanced-runtime` 通过，23/23。
- `rg --files src scripts tests apps` 行数扫描显示当前源码、脚本和测试文本文件均低于 2000 行。
- `npm run typecheck` 通过。
- `npm run format:check` 通过。

#### P2-3 Web Shell 测试文件过大且全局状态复杂

状态：已完成（2026-06-15 本轮实施）。

证据：

- `tests/web-shell.test.ts` 已从 3472 行降到 479 行。
- 本轮已修复的 auth transactional email 子项说明：当测试文件过大且 fixture 共享过多时，容易把全局身份 seed/运行时 store 状态误当作前置条件。

建议：

- 按领域拆测试文件，统一环境变量和 store setup/teardown。

已实施：

- 将 `X9 auth transactional routes use the host email provider contract` 从 `tests/web-shell.test.ts` 迁入独立 `tests/web-shell-auth.test.ts`。
- 将 X2 user profile/role/password 与 scope/notification/billing/admin route handler 2 个 API route 子项迁入独立 `tests/web-shell-api-routes.test.ts`。
- 将 email provider signed webhook、retry、failed invocation evidence 和 email outbox worker delivery ledger 4 个子项迁入独立 `tests/web-shell-email.test.ts`。
- 将 contact API route security catalog、K4 module webhook signed secret/body limit、K4 host route/admin registry/RBAC/self-service permission security 与 config doctor route/provider/retention readiness 4 个安全子项迁入独立 `tests/web-shell-security.test.ts`。
- 将 admin provider status 与 worker status 2 个运维状态子项迁入独立 `tests/web-shell-operations-status.test.ts`。
- 将 host runtime-store mode/default database/production guard 4 个配置子项迁入独立 `tests/web-shell-runtime-store.test.ts`。
- 将 Stripe webhook signature、checkout session 和 billing portal client 3 个纯客户端子项迁入独立 `tests/web-shell-stripe.test.ts`。
- 将 host file runtime、local/S3 storage config 与 plan-aware quota 4 个文件能力子项迁入独立 `tests/web-shell-files.test.ts`。
- 将 worker drain、scoped runs API、bounded worker loop 与 worker status alert 4 个 worker/runs 子项迁入独立 `tests/web-shell-workers.test.ts`。
- 将 host settings env/store source metadata 1 个配置子项迁入独立 `tests/web-shell-settings.test.ts`。
- 将 path helper、sitemap、public navigation 与 host runtime health 4 个 routing/navigation/health 子项迁入独立 `tests/web-shell-routing.test.ts`。
- 将 host auth adapter、identity seed/bootstrap/status、login redirect 与 session bridge 9 个 identity/auth 子项迁入独立 `tests/web-shell-identity.test.ts`。
- 将 P10 host shell factory/API、K1 request-cookie module API、P20 AI/RAG capability API/action、M5 public tools API、X10 demo module runtime 与 workflow/outbox/webhook 7 个 module host/runtime integration 子项迁入独立 `tests/web-shell-module-host.test.ts`。
- 将 X8 admin dead-letter bulk replay、列表过滤和默认 discard/archive 3 个 route handler 子项迁入独立 `tests/web-shell-dead-letter.test.ts`。
- 将 X4 product scope API、workspace management、workspace scope isolation 与 K3 product scope seed 4 个 product/workspace scope 子项迁入独立 `tests/web-shell-product-scope.test.ts`。
- 将 X3 admin capability guard、R2 audit export、R2 user detail audit trail 与 R2 identity protection 4 个 admin identity/audit 子项迁入独立 `tests/web-shell-admin-identity.test.ts`。
- 将 A4 admin service connection inventory、connector invocation ledger 与 retention 1 个长子项迁入独立 `tests/web-shell-service-connections.test.ts`。
- 将 X6 entitlement API、A8 entitlement/commercial view、M6 SaaS snapshot/local checkout、X6 billing overview 与 A7 billing catalog 7 个 commercial/billing/entitlement 子项迁入独立 `tests/web-shell-commercial.test.ts`；拆分时修正 SaaS snapshot 对前序 `public-tools-demo` run 的隐性依赖，改为断言自身 seed 的 `web-shell` task。
- `package.json` 的 `test:web-shell` 改为同时执行 `tests/web-shell.test.ts`、`tests/web-shell-auth.test.ts`、`tests/web-shell-email.test.ts`、`tests/web-shell-security.test.ts`、`tests/web-shell-operations-status.test.ts`、`tests/web-shell-runtime-store.test.ts`、`tests/web-shell-stripe.test.ts`、`tests/web-shell-files.test.ts`、`tests/web-shell-workers.test.ts`、`tests/web-shell-settings.test.ts`、`tests/web-shell-routing.test.ts`、`tests/web-shell-identity.test.ts`、`tests/web-shell-module-host.test.ts`、`tests/web-shell-dead-letter.test.ts`、`tests/web-shell-product-scope.test.ts`、`tests/web-shell-admin-identity.test.ts`、`tests/web-shell-service-connections.test.ts`、`tests/web-shell-commercial.test.ts` 和 `tests/web-shell-api-routes.test.ts`，保持 Web Shell gate 覆盖面不变。
- 独立 auth 测试继续覆盖注册验证邮件、password reset 邮件、不存在用户防枚举不发邮件、production 响应不返回 `resetToken`。

完成证据：

- `npx tsx --test tests/web-shell-auth.test.ts` 通过，1/1。
- `npx tsx --test tests/web-shell-api-routes.test.ts` 通过，2/2。
- `npx tsx --test tests/web-shell-email.test.ts` 通过，4/4。
- `npx tsx --test tests/web-shell-security.test.ts` 通过，4/4。
- `npx tsx --test tests/web-shell-operations-status.test.ts` 通过，2/2。
- `npx tsx --test tests/web-shell-runtime-store.test.ts` 通过，4/4。
- `npx tsx --test tests/web-shell-stripe.test.ts` 通过，3/3。
- `npx tsx --test tests/web-shell-files.test.ts` 通过，4/4。
- `npx tsx --test tests/web-shell-workers.test.ts` 通过，4/4。
- `npx tsx --test tests/web-shell-settings.test.ts` 通过，1/1。
- `npx tsx --test tests/web-shell-routing.test.ts` 通过，4/4。
- `npx tsx --test tests/web-shell-identity.test.ts` 通过，9/9。
- `npx tsx --test tests/web-shell-module-host.test.ts` 通过，7/7。
- `npx tsx --test tests/web-shell-dead-letter.test.ts` 通过，3/3。
- `npx tsx --test tests/web-shell-product-scope.test.ts` 通过，4/4。
- `npx tsx --test tests/web-shell-admin-identity.test.ts` 通过，4/4。
- `npx tsx --test tests/web-shell-service-connections.test.ts` 通过，1/1。
- `npx tsx --test tests/web-shell-commercial.test.ts` 通过，7/7。
- `npm run test:web-shell` 通过，75/75。
- `npm run typecheck` 通过。
- `npm run format:check` 通过。

#### P2-4 Browser/accessibility evidence 本次已补齐本地严格证据

证据：

- 本轮先发现 `admin:ui-gate` 失败：`ProductShell` 没有显式从 Admin 导航注册表生成默认 Admin nav。
- 已修复 `apps/host-next/components/ProductShell.tsx`，让 `adminNav` 直接由 `getAdminNavItems('en')` 生成，避免默认哨兵 nav 与运行时 `resolveAdminNavItems` 分叉。
- 已修复 `host-browser-matrix`、`host-accessibility-smoke` 的登录请求，使其像真实同源页面提交一样携带 `Origin`/`Referer`，不放宽服务端 origin/CSRF 策略。
- `npm run admin:ui-gate` 通过，0 error/0 warning，报告 `.runtime/admin-ui-gate/2026-06-14T10-53-08.579Z/admin-ui-gate.json`。
- `npm run host:browser-matrix -- --required --base-url http://localhost:3000` 在本地临时 `host:dev` + `PLOYKIT_ENABLE_DEMO_USERS=1` 下通过，报告 `.runtime/browser-matrix/2026-06-14T11-00-29-728Z/matrix.json`，截图已抽检 `desktop-zh-admin.png`、`mobile-zh-admin.png`、`mobile-zh-admin-drawer-interaction.png`、`desktop-zh-admin-global-search.png`。
- `npm run host:accessibility-smoke -- --required --base-url http://localhost:3000` 在同一临时 host 下通过，报告 `.runtime/accessibility-smoke/2026-06-14T11-00-29-991Z/accessibility-smoke.json`。

建议：

- 后续发布前仍要在生产构建和目标域名上复跑同一矩阵；本轮已补生产构建/standalone smoke 基础证据，但 browser/accessibility 矩阵仍是在本地 dev host 下跑的。

#### P2-6 生产构建与 standalone smoke 本地证据已补齐

状态：已完成基础构建证据，并已消除本地 production build 的 Turbopack NFT tracing warning（2026-06-14 本轮实施）。

原始证据：

- 初次 `npm run host:build` 在缺少生产 Postgres runtime store 环境变量时触发 `PLOYKIT_RUNTIME_STORE_PRODUCTION_MEMORY_FORBIDDEN`，确认生产 memory store 护栏有效。
- 旧同名 `ploykit-v2-postgres` 容器来自历史路径且存在 runtime migration checksum drift，因此没有继续复用，改用临时干净容器 `ploykit-prod-build-postgres`，数据库 `ploykit_prod_build`，端口 `55436`。
- 在显式本地 `DATABASE_URL`、`PLOYKIT_RUNTIME_STORE=postgres`、`PLOYKIT_AUTH_PROVIDER=host`、`PLOYKIT_BOOTSTRAP_ADMIN_EMAIL=admin@example.com`、`PLOYKIT_BOOTSTRAP_ADMIN_PASSWORD=Admin@123456` 下，`runtime:stores:verify` 通过，29 个 runtime migrations 全部应用。
- 在同一 Postgres baseline 和生产 env 下，`npm run host:build` 通过，生成 standalone host：`apps/host-next/.next/standalone/apps/host-next/server.js`。
- 初次 standalone 登录 smoke 在缺少 `PLOYKIT_AUTH_SECRET` 时触发 `PLOYKIT_AUTH_SECRET_REQUIRED`，确认生产 session secret 护栏有效。
- 加入本地测试用 `PLOYKIT_AUTH_SECRET` 后，standalone `npm run host:smoke -- --base-url http://localhost:3000` 通过，报告写入 `.runtime/host-smoke/2026-06-14T11-13-17-023Z/smoke.json`，覆盖站点首页、登录页、公开 demo、公开工具 API、登录、Dashboard 账单/任务、Admin 模块/用户/Webhook。

已实施的 warning 治理：

- `src/lib/module-runtime/loader/index.ts` 不再从通用 loader barrel 导出 `module-map-health`；`src/lib/module-runtime/index.ts` 不再从 runtime 总出口导出 release gate，避免普通请求路径被静态带入诊断/发布检查依赖。
- `apps/host-next/lib/admin-module-operations.ts` 对 `checkModuleMapHealth` 改为页面视图内按需动态 import，并在 `module-map-health.ts` 中将诊断用 project root path 标记为 Turbopack ignore。
- `scripts/generate-module-map.mjs` 在 `modules:scan` 阶段读取并校验模块 `resources.locales` JSON，把 locale message 字典嵌入 `src/lib/module-map.ts`；`src/lib/module-runtime/i18n/module-messages.ts` 运行期只读 map entry `messages`，不再 import `fs/path` 或根据请求读磁盘。
- `apps/host-next/lib/admin-entitlements.ts` 承担 entitlement API/page 轻量读写能力，避免 entitlement route 误引 `admin-operations.ts` 大聚合文件。
- `apps/host-next/lib/admin-delivery.ts` 从转出口改为独立 delivery/outbox 服务；`api/admin/outbox/dead-letters`、Webhook 页面和相关组件类型改为引用它；`admin-operations.ts` 中重复的 `retryAdminOutbox`、`bulkReplayAdminDeadLetters`、`retryAdminWebhookReceipt`、`getAdminOutboxDetail` 等旧出口已删除，避免 delivery 领域回流到大聚合文件。
- `apps/host-next/lib/admin-settings.ts` 承担 host settings 读写、字段来源归一、env 锁定过滤、输入校验、审计 diff 和 runtime invalidation；settings 页面、Admin 组件类型和 Web Shell 测试均改为从该文件导入；`admin-operations.ts` 中 `AdminHostSettingsView`、`getAdminHostSettingsView`、`updateAdminHostSettings` 及 settings 私有校验 helper 已删除。
- `apps/host-next/lib/admin-files.ts` 承担 Admin files 列表、详情、storage object inspect、cleanup/reconcile、quarantine/restore/archive/delete/bulk update 和审计记录；files 页面、Admin files API 聚合、Admin 组件类型和 Web Shell 测试均改为从该文件导入；`admin-operations.ts` 中 `AdminFilesView`、`AdminFileDetailView`、`reconcileAdminFileStorage`、`getAdminFilesView`、`getAdminFileDetailView`、`quarantineAdminFile`、`restoreAdminFile`、`archiveAdminFile`、`deleteAdminFile`、`cleanupAdminDeletedFiles`、`bulkUpdateAdminFiles` 及 files 私有 helper 已删除。
- `apps/host-next/lib/admin-audit.ts` 承担 audit retention mutation、retention days 归一和审计记录；audit 页面和 Web Shell 测试均改为从该文件导入；`admin-operations.ts` 中 `applyAdminAuditRetention` 及其私有数字归一 helper 已删除。
- `apps/host-next/lib/admin-commercial.ts` 承担 Admin commercial view、商业 subject 归一、redeem code/redemption/attempt 映射、risk 事件/阻断映射、商业 metadata 脱敏、billing evidence 聚合和 catalog 读取；billing/revenue/entitlements 页面、Admin API、Admin 组件类型和 Web Shell 测试均改为从该文件导入；`admin-operations.ts` 中 `AdminCommercial*` 类型、`getAdminCommercialView` 和商业私有 helper 已删除。
- `apps/host-next/lib/admin-runs.ts` 承担 Admin run detail、run requeue/cancel action、run 关联 outbox/delivery/usage/files/worker artifact/audit 聚合；run detail 页面、run action、Admin 组件类型和 Web Shell 测试均改为从该文件导入；`admin-operations.ts` 中 `AdminRunDetailView`、`getAdminRunDetail`、`requeueAdminRun`、`cancelAdminRun` 和 run 私有 helper 已删除。
- 生成的 `src/lib/module-map.ts` 直接从 `./module-runtime/loader/module-map-types` 做 type import，不再经过 runtime 总出口。

完成证据：

- `npm run modules:scan` 更新 module map，白牌模块 `zh/en` messages 已嵌入 generated map；manifest 仍保持轻量，不写入大段 locale 文案。
- `npm run modules:check` 通过，7 个模块 diagnostics 均为 0。
- `npm run typecheck` 通过。
- `npm run test:module-map` 8/8 通过。
- `npm run test:ui-runtime` 7/7 通过，覆盖 generated map messages 翻译路径。
- `npm run test:host-runtime` 20/20 通过。
- `npm run test:host-page-runtime` 21/21 通过。
- `npm run test:web-shell` 75/75 通过，覆盖 dead-letter API bulk replay/discard/archive、Webhook receipt replay、outbox detail 等 `admin-delivery` 路径，也覆盖 host settings env 锁定、durable mutation、audit diff、无效 `emailProvider/fromEmail/timezone/sessionMaxAgeDays` 拒绝等 `admin-settings` 路径，覆盖 admin files bulk archive/delete、detail storage object、cleanup drilldown、files API 列表等 `admin-files` 路径，覆盖 audit retention mutation 记录 `admin.audit.retention_applied`，覆盖 `getAdminCommercialView` 的商业 secret metadata 脱敏、entitlement view 归一和 billing catalog 管理链路，并覆盖 `getAdminRunDetail` 的 run 关联 outbox/delivery/usage/files/artifact/audit 聚合。
- `npm run test:release-candidate` 43/43 通过。
- `npm run i18n:check` 通过。
- 使用隔离临时 Docker Postgres（`ploykit-build-trace-postgres`，端口 `55438`，验证后删除）执行 `runtime:stores:verify` 通过，随后 `npm run host:build` 通过，输出中不再包含 `Encountered unexpected file in NFT list` 或 `Turbopack build encountered ... warnings`；删除 delivery/outbox 旧出口后已再次复验。
- settings 拆分后又使用隔离临时 Docker Postgres（`ploykit-settings-build-trace-postgres`，端口 `55439`，验证后删除）执行 `runtime:stores:verify` 通过，随后 `npm run host:build` 通过，输出中仍不包含 `Encountered unexpected file in NFT list` 或 Turbopack warning。
- files 拆分后又使用隔离临时 Docker Postgres（`ploykit-files-build-trace-postgres`，端口 `55440`，验证后删除）执行 `runtime:stores:verify` 通过，随后 `npm run host:build` 通过，输出中仍不包含 `Encountered unexpected file in NFT list` 或 Turbopack warning。
- audit retention 拆分后又使用隔离临时 Docker Postgres（`ploykit-audit-build-trace-postgres`，端口 `55441`，验证后删除）执行 `runtime:stores:verify` 通过，随后 `npm run host:build` 通过，输出中仍不包含 `Encountered unexpected file in NFT list` 或 Turbopack warning。
- commercial view 拆分后又使用隔离临时 Docker Postgres（`ploykit-commercial-build-trace-postgres`，端口 `55442`，验证后删除）执行 `runtime:stores:verify` 通过，随后 `npm run host:build` 通过，输出中仍不包含 `Encountered unexpected file in NFT list` 或 Turbopack warning。
- runs detail/actions 拆分后又使用隔离临时 Docker Postgres（`ploykit-runs-build-trace-postgres`，端口 `55443`，验证后删除）执行 `runtime:stores:verify` 通过，随后 `npm run host:build` 通过，输出中仍不包含 `Encountered unexpected file in NFT list` 或 Turbopack warning。

剩余风险：

- 本轮生产 smoke 是本地 standalone + bootstrap admin + 干净 Postgres baseline，不等同于线上域名、CDN、真实对象存储、真实 provider 和真实历史数据。
- `admin-operations.ts` 已降为 39 行兼容壳；`admin-module-operations.ts` 当前承载 module operations 视图/详情/状态切换，纯 row/model/risk/capability 组装已拆到 `admin-module-operation-model.ts`；Admin Webhooks 页面的 worker runtime status/drain 已改由 `admin-worker-operations.ts` 进入，worker soak evidence 读取已拆到 `admin-worker-evidence.ts`，worker readiness presenter 已拆到 `admin-worker-readiness.ts`；后续可按模块列表、模块详情、catalog seed、module health presenter 和页面层继续细拆。

#### P2-7 完整 release evidence 本地 RC 闭环已补齐

状态：已完成（2026-06-14 本轮实施）。

原始问题：

- 手动先启动 `apps/host-next/.next/standalone/apps/host-next/server.js`，再运行 `npm run release:evidence -- --required --base-url http://localhost:3000`，会让 `host:build` 删除 `.next/standalone` 时触发 Windows `EBUSY`，随后静态 chunk 500，`host:smoke`、browser matrix、accessibility smoke 被连带打挂。
- `release:evidence` 原流程会读取若干旧 `.runtime/*/latest.json`，但没有在同一次流水线中生成 Data v2 migration、Product Presentation manifest、white-label smoke 和 Postgres strict evidence，导致 RC gate 证据可复现性不足。
- `host:web-shell-evidence` 会清掉 Postgres 环境保持测试隔离，但没有清掉 `NODE_ENV=production`，在 RC evidence 中触发生产 memory store 禁用保护，造成 49 个 Web Shell 子项误失败。
- Product Presentation 检查发现 `app/[lang]/dashboard/[...modulePath]` 对应的 dashboard 模块 catch-all 路由未登记到 host page registry/route presentation manifest。
- `data:migrate` 暴露 `capability-demo`、`cms-demo`、`hello`、`shop-demo` 的 Data v2 plan/migration 生成物过期。

已实施：

- `scripts/host-rc-evidence.mjs` 增加本地 managed production host 生命周期：本地 base URL preflight、构建后自动 `host:start`、浏览器/host smoke 完成后自动停止；如果 3000 已有任何 HTTP 响应，会先阻断构建，避免 `.next/standalone` 被锁。
- `release:evidence --required` 纳入 `host:postgres-local-smoke -- --no-docker`、`data:migrate`、`presentation:check`、`white-label:smoke`，让 RC gate 读取同一轮新鲜证据。
- `scripts/host-web-shell-evidence.mjs` 清理测试子进程的 `NODE_ENV`，避免 hermetic Web Shell 测试被外层 production standalone 环境污染。
- `dashboard.module-route` 已登记到 `HOST_PAGE_REGISTRY`、`HOST_ROUTE_PATH_BY_PAGE_ID` 和 `product.presentation.ts`，并补 `tests/host-page-runtime.test.ts` 覆盖 `/dashboard/:modulePath*`。
- 已执行 `npm run data:generate` 和 `npm run modules:scan`，刷新 Data v2 生成物和 module map digest。

完成证据：

- 最终使用干净临时 Docker Postgres（`ploykit-rc-evidence-postgres`，端口 `55437`，验证后已删除）和本地 production standalone 执行 `npm run release:evidence -- --required --base-url http://localhost:3000` 通过。
- RC evidence 报告：`.runtime/rc-evidence/2026-06-14T11-43-16-668Z/evidence.json` / `.runtime/rc-evidence/2026-06-14T11-43-16-668Z/evidence.md`。
- 25 个步骤全部通过：`typecheck`、managed host preflight、`host:build`、runtime store Postgres evidence、Data v2 migration、Product Presentation、white-label smoke、provider matrix、worker soak、chaos、managed host start、host readiness、Web Shell evidence、module quality、worker heartbeat、config doctor、data safety、drift check、backup/restore、upgrade migration、host product smoke、browser matrix、accessibility smoke、`release:maintainer-gate`、managed host stop。后续增量已把 Dashboard transition smoke 接入 `release:evidence --required`，下一轮完整 RC evidence 将新增独立 `dashboard-transition-smoke` 步骤。
- 本轮结束后确认 `localhost:3000` 无监听进程，临时 RC Postgres 和 MinIO 辅助容器均已移除。

#### P2-5 宿主公开静态资产缓存策略不完整

状态：已完成（2026-06-14 本轮实施）。

原始证据：

- 线上 `/brand/mark.png` 响应约 136KB。
- 响应头为 `Cache-Control: public, max-age=0`。

影响：

- 公开登录页和营销页首访会多一次不必要的图片传输或 revalidation。
- 这不是 dashboard 切路由慢的主因，但属于生产体验 polish 和带宽成本问题。

建议：

- 使用带 hash 的品牌资产路径或给 `/brand/*` 配长期缓存。
- 压缩 `mark.png`，为登录页实际展示尺寸提供更小资源。

已实施：

- `apps/host-next/next.config.mjs` 新增 `/brand/:path*` header，设置 `Cache-Control: public, max-age=31536000, immutable`。
- `tests/production-runtime.test.ts` 新增 `host static brand assets use immutable cache headers`，固定该配置不回退。

完成证据：

- `npm run test:production-runtime` 通过，15 个子测试全部通过。
- `npm run typecheck` 通过。

### P3

状态：已完成（2026-06-15 本轮实施）。

已实施：

- `docs/README.zh-CN.md` 已把常规核心文档、运行与发布文档、治理与审计文档分组，治理报告、历史审计、迁移计划和发布边界不再混在普通模块开发入口里。
- `README.md` 的英文/中文“当前模块”已补默认模块等级，明确 Fixture、Demo、Reference 和 Demo/Reference 的使用边界。
- `docs/README.zh-CN.md` 与 `docs/module-development.zh-CN.md` 已同步默认模块等级说明，避免内置 demo 被误当作 production-ready 产品模块。
- `module:test --summary` 已作为人读摘要入口记录在模块开发文档，默认 JSON 与显式 `--json` 仍保留给 CI/机器读取。

完成证据：

- `npm run docs:encoding-check` 通过。
- `npm run module:test -- all --summary` 通过，7/7。

## 17. 推荐修复路线

本路线按“可以不兼容旧数据和旧内部结构”的干净重构策略编排。目标不是把旧问题用最小 diff 补住，而是建立一个更清晰、更容易上线验收的新生产基线。执行时仍要保留第 15 节的不变量。

### Phase 0：恢复基础绿色

状态：已完成（2026-06-14 本轮实施）。

已完成：

1. 已修复 `test:web-shell` 中 auth transactional email 子项。
2. 已执行 `npm run format`，并复跑 `npm run format:check` 通过。
3. 已保留本次 `modules:scan` 生成的 module map 更新；`modules:check` 已确认生成物不再漂移。
4. 已清理该 Web Shell 认证邮件测试的全局状态依赖，不再依赖隐式 demo admin。

完成证据：

```bash
npm run typecheck
npm run modules:check
npm run test:web-shell
npm run format:check
```

### Phase 1：补齐持久化生产证据

状态：基础 Postgres 持久化验证、严格 backup/restore 语义 smoke、严格 upgrade migration 静态 smoke、runtime store 新 baseline 文档边界、物理备份恢复 runbook 和本地 `pg_dump`/`pg_restore` smoke 已完成；托管快照/WAL/PITR、对象存储和 secrets 恢复演练仍待在目标环境执行。

如果选择不兼容旧数据，应优先建立新的 runtime store baseline，而不是继续在历史迁移上叠补丁。

1. 已完成基础验证：启动隔离临时 Postgres。
2. 设计新的 runtime schema baseline，按 identity、catalog、runs/outbox、audit、files、commercial、provider、notifications、risk 分域。
3. 拆 `postgres-runtime-store.ts` 和 `memory-runtime-store.ts`，让 memory/Postgres 共享同一领域接口和 scope helper。
4. 已完成基础验证：跑 runtime migration/schema verify。
5. 已完成基础验证：跑 Postgres runtime store、commercial Postgres 和 host postgres smoke。
6. 已完成严格 smoke：跑 backup/restore 语义快照与 upgrade migration 静态矩阵。
7. 已完成文档化：如果确认不迁移旧数据，在部署文档中明确声明“新 baseline 需要重建数据库”。

建议命令：

```bash
npm run db:up
npm run runtime:stores:migrate
npm run test:runtime-stores
npm run host:postgres-local-smoke
npm run host:backup-restore-smoke
npm run host:postgres-physical-restore-smoke
npm run host:upgrade-migration-smoke
```

本轮已完成的 Phase 1 基础证据：

- `npm run runtime:stores:verify` 通过，29 个 runtime migration 全部 applied。
- `npm run test:runtime-stores` 通过，9/9，0 skipped。
- `npm run test:commercial-postgres` 通过，1/1。
- `npm run host:postgres-local-smoke -- --no-docker` 通过，报告写入 `.runtime/runtime-store-postgres/2026-06-14T09-57-16-250Z/postgres-local-smoke.json`。
- 本轮使用隔离临时 Docker Postgres（`127.0.0.1:55433`），未使用历史同名 compose 容器；验证结束后临时容器已停止。
- `npm run host:backup-restore-smoke -- --required` 通过，模式为 `runtime-store-semantic-snapshot`，覆盖 38 个 runtime store 语义域，报告写入 `.runtime/backup-restore/2026-06-14T10-08-21-619Z/backup-restore.json`。边界：该 smoke 明确不证明 pg_dump、WAL/PITR、托管数据库快照、对象存储、module Data v2 物理表或 secrets 备份。
- `npm run host:upgrade-migration-smoke -- --required` 通过，模式为 `runtime-store-upgrade-migration-static`，检查 29 个 runtime migration 顺序、44 个 required tables 覆盖、非破坏性语句和 idempotency，报告写入 `.runtime/upgrade-migration/2026-06-14T10-08-21-443Z/upgrade-migration.json`。
- 已完成（2026-06-15 本轮实施）：`src/lib/module-runtime/stores/runtime-store-migrations.ts` 新增结构化 `RUNTIME_STORE_REQUIRED_INDEXES` 索引审计矩阵与 `indexAudit` schema verify 输出；`tests/runtime-stores.test.ts` 新增无数据库依赖的核心查询领域覆盖测试，并在 Postgres schema verify 路径断言 required/present/missing/domain 统计。
- 完成证据：`npm run typecheck` 通过；`npm run test:runtime-stores` 在无默认 Postgres 时新增索引审计测试通过、Postgres 子项按既有逻辑 skip；随后使用隔离临时 Docker Postgres `ploykit-index-audit-postgres`（`127.0.0.1:55444`，验证后删除）串行执行 `npm run test:runtime-stores` 10/10 通过且 0 skipped，再执行 `npm run runtime:stores:verify` 通过，输出 `indexAudit.required=51`、`present=51`、`missing=[]`，覆盖 settings 1/1、provider 3/3、runs 1/1、outbox 3/3、worker 3/3、webhooks 1/1、commercial 29/29、rag 4/4、identity 3/3、risk 3/3。
- 已完成（2026-06-15 本轮实施）：`docs/deployment.zh-CN.md` 新增 Runtime Store 基线策略与备份恢复策略，明确当前 baseline 只承诺空库重建，不承诺历史库自动迁移；`docs/runtime-stores.zh-CN.md` 新增基线与迁移边界；`docs/operations.zh-CN.md` 新增备份恢复演练 runbook，区分语义 smoke、upgrade migration smoke、物理 Postgres 恢复、对象存储和 secrets 恢复。
- 完成证据：`npm run docs:encoding-check` 通过；`npm run host:backup-restore-smoke -- --required` 通过，报告写入 `.runtime/backup-restore/2026-06-15T15-53-08-340Z/backup-restore.json`；`npm run host:upgrade-migration-smoke -- --required` 通过，报告写入 `.runtime/upgrade-migration/2026-06-15T15-53-08-184Z/upgrade-migration.json`。边界：真实 `pg_dump`/托管快照/WAL/PITR、对象存储和 secrets 恢复演练仍需在目标部署环境执行后归档证据。
- 已完成（2026-06-16 本轮实施）：Webhook receipt idempotency 从 product/module/webhook/key 扩展为 product/workspace/module/webhook/key，memory runtime store、Postgres runtime store、runtime-store webhook gateway 和 `module_webhook_receipts_idempotency_idx` 均显式纳入 workspace/null workspace 维度；新增 `0030_webhook_receipt_workspace_idempotency.sql` 重建唯一索引并清理同 scope 重复行。
- 完成证据：`npm run typecheck` 通过；默认 `npm run test:runtime-stores` 通过 11 个子测试，其中 Postgres 子项按本地库不可达 skip；使用隔离临时 Docker Postgres `ploykit-webhook-idempotency-postgres`（`127.0.0.1:55466`，验证后删除）串行执行 `npm run test:runtime-stores` 11/11 通过且 0 skipped，再执行 `npm run runtime:stores:verify` 通过，30/30 migration applied、`indexAudit.required=52`、`present=52`、`missing=[]`，其中 webhooks 领域索引 2/2 present。
- 已完成（2026-06-16 本轮实施）：新增 `host:postgres-physical-restore-smoke`，使用两个唯一命名的隔离 Docker Postgres 容器执行本地 `pg_dump -Fc` 和 `pg_restore`，源库先跑 runtime migration/schema verify 并 seed runs、outbox、webhook、worker、audit、usage/metering、commercial、provider invocation、RAG、files、identity、risk、settings、service connection、resource binding 和 product scope 代表性数据；恢复库再跑 schema verify、数据指纹比对和写入校验。
- 完成证据：`npm run host:postgres-physical-restore-smoke -- --required` 通过，模式为 `postgres-pg-dump-restore-local`，报告写入 `.runtime/postgres-physical-restore/2026-06-15T17-05-40-228Z/physical-restore.json` 与 `.runtime/postgres-physical-restore/latest.json`；dump 文件 `.runtime/postgres-physical-restore/2026-06-15T17-05-40-228Z/runtime-store.dump` 为 111211 bytes；源库与恢复库均为 30/30 runtime migration applied、`indexAudit.required=52`、`present=52`、`missing=[]`，恢复后数据指纹与写入校验通过，临时容器已删除。边界：该 smoke 已证明本地 Docker Postgres 的 `pg_dump`/`pg_restore` 链路，不证明托管数据库快照、WAL/PITR、对象存储、secrets 或目标环境凭据恢复。
- 已完成（2026-06-16 本轮实施）：`release:maintainer-gate` 新增 `postgres-physical-restore-matrix` 必需检查，`release:evidence --required` 新增 `postgres-physical-restore` 步骤与 `artifacts.postgresPhysicalRestore`，发布证据链现在会读取 `.runtime/postgres-physical-restore/latest.json` 并拒绝缺失、失败或非 `--required` 生成的物理恢复证据。
- 完成证据：`npm run typecheck` 通过；`npm run test:release-candidate` 45/45 通过，新增严格读取和失败拒绝两个 Postgres physical restore gate 子项；`npm run release:maintainer-gate` 通过，真实 `postgres-physical-restore-matrix` 为 passed，证据来自 `.runtime/postgres-physical-restore/latest.json`。
- 验证注意：本轮首次把 `runtime:stores:verify` 与 `test:runtime-stores` 并行打同一个临时库时，因测试会 reset/drop runtime 表触发假失败；已按本报告建议改为串行重跑并通过。后续 Postgres gate 继续保持串行或分库执行。

### Phase 2：修复宿主 Dashboard 线上性能

1. 修 React hydration #418，优先排查服务端/客户端文本不一致、相对时间、随机值、locale 和模块输出中不可复现的文本。
2. 已完成基础脚本（2026-06-14 本轮实施）：建立浏览器性能回归 `host:dashboard-transition-smoke`，登录后点击 dashboard 左侧真实导航链接，断言切换阶段不产生完整 document navigation，控制台无 hydration error，并输出 P50/P95 与截图。线上 `origin-agentops` 已复测，当前仍失败：2026-06-14 失败为 document navigation 2、P95 5775ms；2026-06-16 required repeat 失败为 8/8 transition document navigation、P95 2968ms；本地新增 `--inject-anchor` 后已能验证宿主是否接管普通 `<a>`，线上 `--inject-anchor` 对照仍失败且未暴露当前 AppFrame/client-transition 标记。随后仓库侧新增全屏模块 host client-transition frame，本地 Origin AgentOps latest smoke 已通过，8/8 transition document navigation=0、P95 198ms。
3. 已完成结构化 span（2026-06-14 本轮实施）：Dashboard route 记录 `auth`、`module-host`、`session`、`module-session`、`navigation`、`route-resolve`、`shell-data`、`scope`、`workspaces`、`profile`、`theme`、`chrome` 等 span；默认慢请求阈值 1000ms，可用 `PLOYKIT_DASHBOARD_TIMING_SLOW_MS` 调整，`PLOYKIT_DASHBOARD_TIMING_LOG=always` 可强制输出。响应头 `Server-Timing` 仍需单独设计可写响应边界。
4. 已完成（2026-06-14 本轮实施）：将 `generateMetadata` 改为 metadata-only，避免执行完整 `resolvePageRoute` 和 page loader。
5. 部分完成：metadata data 已从 module page data 中拆出；shell 数据与 module page data 已开始分层并行，后续仍可继续抽出更清晰的 page model。
6. 已完成基础短缓存（2026-06-14 本轮实施）：已并行化 module page resolve 与 shell scope/workspaces/theme/profile 读取，并缓存 dashboard navigation 解析结果；profile/workspaces/navigation/theme 以及 product-scope snapshot/resolution 的跨请求短缓存已接入，默认 TTL 10 秒，并在 profile、workspace、membership、invite、domain alias 和 host runtime 失效路径清理。
7. 重新评估 `force-dynamic`：私有页面仍不能 public cache，但可以使用请求级缓存、session scoped cache 或细粒度 `no-store`，不要让整个 shell 永久失去优化空间。
8. 已修 `ensureHostCatalogSeeded` 的重复 catalog 查询（2026-06-14 本轮实施）：catalog states 现在在循环前读取一次，并用 `Set` 维护已有和刚插入的 moduleId，避免每个模块重复 `listCatalogStates`。
9. 已优化 `/brand/*` 静态缓存（2026-06-14 本轮实施）：Next config 为 `/brand/:path*` 增加 `Cache-Control: public, max-age=31536000, immutable`，并由 `test:production-runtime` 覆盖。图片体积压缩仍可作为后续 polish。
10. 已完成本地宿主普通锚点兜底（2026-06-14 本轮实施）：AppFrame 内 dashboard/admin 同源内部 `<a>` 点击统一走 `router.push`，并保留外链、新窗口、下载、modifier click、hash-only 和非 dashboard/admin 链接默认行为。该修复解决“模块输出普通 `<a>` 时宿主无法接管”的一类问题；2026-06-16 本轮进一步覆盖 `shell.chrome='none'` 全屏模块页，Origin AgentOps latest smoke 已通过；线上 `origin-agentops` 复测未看到当前 AppFrame/client-transition 诊断标记，仍需部署当前宿主产物后复测。
11. 已完成本地 repeat soak（2026-06-16 本轮实施）：`host:dashboard-transition-smoke` 支持 `--repeat <n>` / `HOST_DASHBOARD_TRANSITION_REPEAT` 和 `--fail-fast`，多轮之间通过 dashboard 内部 reset transition 回到首路由，并把 reset 计入 document navigation、hydration 和 P95 断言；本地三轮 `--inject-anchor` required smoke 已通过。
12. 已完成 release gate 接入（2026-06-16 本轮实施）：`release:maintainer-gate` 新增 `dashboard-transition-smoke` 必需检查，`release:evidence --required` 在 host/browser/accessibility smoke 同一阶段新增 `host:dashboard-transition-smoke -- --required --repeat 3 --inject-anchor --max-p95-ms 5000` 步骤，并把 `artifacts.dashboardTransitionSmoke` 写入 RC evidence 报告；严格门禁会拒绝缺失、失败、非 required、未包含 `--inject-anchor`、repeat 小于 3、reset transition 不足、document navigation 未清零、hydration error 未清零或 P95 check 失败的 evidence。

建议验收：

```bash
npm run typecheck
npm run test:host-runtime
npm run test:web-shell
npm run host:dashboard-transition-smoke -- --required --base-url <host-url>
npm run host:dashboard-transition-smoke -- --required --base-url <host-url> --repeat 3 --inject-anchor
npm run host:browser-matrix -- --required --base-url <host-url>
```

线上 origin-agentops 专项可用类似命令：

```bash
npm run host:dashboard-transition-smoke -- --required --base-url https://aijia.yingasi.com --routes /dashboard/origin-agentops/agents,/dashboard/origin-agentops/skills,/dashboard/origin-agentops/tools
```

已完成的 Phase 2 子项证据：

- `npx tsx --test --test-name-pattern "K5 admin catalog seed preserves persisted module state" tests/web-shell.test.ts` 通过。
- `npm run test:host-runtime` 通过，21 个子测试全部通过；新增 `createModuleHost resolves page route metadata without running page loader` 覆盖 metadata-only 不加载页面组件、不执行 page loader 的约束，并新增 `dashboard generateMetadata resolves metadata-only routes without page loaders` 覆盖 dashboard route-level metadata 入口不会调用完整 page route。
- `npm run host:dashboard-transition-smoke -- --base-url http://localhost:3000 --routes /zh/dashboard,/zh/dashboard/workspaces,/zh/dashboard/files --max-p95-ms 5000` 通过；切换阶段 document navigation 为 0，hydration error 为 0，P50 1286ms、P95 1427ms，截图已检查：`.runtime/dashboard-transition-smoke/2026-06-14T09-38-05-475Z/zh-dashboard-workspaces.png`、`.runtime/dashboard-transition-smoke/2026-06-14T09-38-05-475Z/zh-dashboard-files.png`。
- `npm run host:dashboard-transition-smoke -- --base-url http://localhost:3000 --routes /zh/dashboard,/zh/dashboard/workspaces,/zh/dashboard/files --inject-anchor --max-p95-ms 5000` 通过；AppFrame 内注入普通 `<a>` 后 transition document navigation 为 0，hydration error 为 0，P50 228ms、P95 277ms，截图已检查：`.runtime/dashboard-transition-smoke/2026-06-14T10-15-50-775Z/zh-dashboard-workspaces.png`、`.runtime/dashboard-transition-smoke/2026-06-14T10-15-50-775Z/zh-dashboard-files.png`。
- `npm run host:dashboard-transition-smoke -- --base-url http://localhost:3000 --routes /zh/dashboard,/zh/dashboard/workspaces,/zh/dashboard/files --max-p95-ms 5000` 通过；宿主真实导航 transition document navigation 为 0，hydration error 为 0，P50 228ms、P95 243ms，截图已检查：`.runtime/dashboard-transition-smoke/2026-06-14T10-16-48-605Z/zh-dashboard-workspaces.png`、`.runtime/dashboard-transition-smoke/2026-06-14T10-16-48-605Z/zh-dashboard-files.png`。
- `npm run host:dashboard-transition-smoke -- --base-url http://localhost:3000 --routes /zh/dashboard,/zh/dashboard/workspaces,/zh/dashboard/files --inject-anchor --repeat 3 --max-p95-ms 5000 --required` 通过；repeat soak 覆盖 8/8 transition（含 2 次 reset transition），transition document navigation 为 0，hydration error 为 0，P50 203ms、P95 246ms；报告 `.runtime/dashboard-transition-smoke/2026-06-15T17-22-07-251Z/dashboard-transition-smoke.json`，8 张截图已通过 contact sheet 检查：`.runtime/dashboard-transition-smoke/2026-06-15T17-22-07-251Z/contact-sheet.png`。
- `npm run test:release-candidate` 通过，新增 `dashboard-transition-smoke` 严格读取、repeat 覆盖不足拒绝、缺失 injected-anchor 覆盖拒绝和缺失 AppFrame/client-transition marker 拒绝 gate 子项。
- `npm run release:maintainer-gate` 曾通过，真实 `dashboard-transition-smoke` 证据来自 `.runtime/dashboard-transition-smoke/latest.json`：repeat=3、transitions=8、resetTransitions=2、transition document navigations=0、hydration errors=0、P95 246ms；本轮已进一步收紧后续 gate 必须包含 `injectAnchor=true`。
- `npm run host:dashboard-transition-smoke -- --base-url https://aijia.yingasi.com --routes /dashboard/origin-agentops/agents,/dashboard/origin-agentops/skills,/dashboard/origin-agentops/tools --max-p95-ms 10000` 已执行；登录成功，页面截图正常，但 smoke 失败：`agents -> skills` 5775ms 且 documentNavigationCount 1，`skills -> tools` 5024ms 且 documentNavigationCount 1，hydration error 0。证据目录：`.runtime/dashboard-transition-smoke/2026-06-14T10-01-57-219Z`。
- `npm run host:dashboard-transition-smoke -- --required --base-url https://aijia.yingasi.com --routes /dashboard/origin-agentops/agents,/dashboard/origin-agentops/skills,/dashboard/origin-agentops/tools --repeat 3 --max-p95-ms 1000` 已执行；登录成功，页面截图正常，但 smoke 失败：8/8 次 transition 均产生完整 document navigation，P50 2666ms、P95 2968ms，hydration error 0。证据目录：`.runtime/dashboard-transition-smoke/2026-06-16T07-00-09-417Z`。
- `npm run host:dashboard-transition-smoke -- --required --base-url https://aijia.yingasi.com --routes /dashboard/origin-agentops/agents,/dashboard/origin-agentops/skills,/dashboard/origin-agentops/tools --repeat 3 --inject-anchor --max-p95-ms 1000` 已执行；对照仍失败：8/8 次 transition 均产生完整 document navigation，P95 3737ms，hydration error 0。证据目录：`.runtime/dashboard-transition-smoke/2026-06-16T07-02-56-693Z`。
- 增强后的短复测证据目录 `.runtime/dashboard-transition-smoke/2026-06-16T07-08-41-933Z` 显示 `appFramePresent=false`、`clientTransitionMarkerPresent=false`，说明线上页面未暴露当前本地宿主诊断标记；本轮脚本已继续增加点击前注入锚点归属诊断，下一轮可直接确认部署后的锚点是否落在 `[data-host-app-frame]` 内。
- `npm run modules:check` 通过，确认新增 `host:dashboard-transition-smoke` 未引入 host/module 边界违规。
- `npm run test:production-runtime` 通过，16 个子测试全部通过；新增 `dashboard timing reports structured slow-route spans` 覆盖 dashboard timing report schema 和 `route-resolve`、`scope`、`workspaces`、`profile`、`theme` span；新增 `dashboard shell cache reuses scoped shell reads and respects invalidation` 覆盖短缓存 key、复用和失效；新增 `host client transition catches module dashboard anchors without breaking safe link defaults` 覆盖普通锚点兜底。
- `npm run test:web-shell` 通过，75 个子测试全部通过。
- `npm run typecheck` 通过。

### Phase 3：强化高风险能力 evidence

1. 已完成（2026-06-14 本轮实施）：跑 `host:stripe-local-smoke` mock Stripe + ledger apply 和 `host:billing-reconcile-smoke`，并生成可归档 `.runtime` evidence。
2. 已完成（2026-06-14 本轮实施）：跑 `host:files-cleanup-smoke`、`host:files-reconcile-smoke`，并把 `files-storage-domain` 接入 release gate。
3. 已完成（2026-06-14 本轮实施）：跑 `host:worker-soak -- --required` 和 `host:chaos-smoke -- --required`，并验证 `worker-soak`、`delivery-ledger`、`chaos-matrix` release evidence。
4. 已完成本地严格证据（2026-06-14/2026-06-15 本轮实施）：跑 provider matrix、RAG provider smoke、AI webhook local smoke、AI/RAG policy smoke，并验证 `provider-live-matrix`、`provider-invocation-ledger`、`ai-rag-policy`、`production-adapters` release evidence。真实外部 provider 仍待单独凭据环境验证。

已完成的 Phase 3 子项证据：

- `npx tsx scripts/host-stripe-smoke.ts --mock-stripe --required --apply-ledger` 通过，覆盖 checkout session、webhook signature、ledger apply，报告写入 `.runtime/stripe-smoke/2026-06-14T10-30-22-480Z/stripe-smoke.json`。
- 已完成（2026-06-16 本轮实施）：`tests/web-shell-stripe.test.ts` 新增 Stripe checkout webhook replay 回归，重复 `checkout.session.completed` event 不会重复入账，覆盖 order、credit ledger、entitlement、invoice、revenue bucket 与 commercial order status outbox event。
- 完成证据：`npx tsx --test tests/web-shell-stripe.test.ts` 4/4 通过；`npm run test:commercial-ledger` 10/10 通过；`npm run test:web-shell -- --test-name-pattern "Stripe|commercial|billing"` 实际执行 76/76 个 Web Shell 子测试并全部通过；`npm run typecheck` 通过。
- `npm run host:billing-reconcile-smoke` 通过，商业域证据包含 1 个 paid order、1 个 invoice、1 个 subscription、2 个 catalog items、1 个 billing account、1 个 revenue bucket，报告写入 `.runtime/billing-reconcile/2026-06-14T10-30-42-379Z/billing-reconcile-smoke.json`。
- `npx tsx scripts/host-files-cleanup-smoke.ts` 通过，确认删除文件对象被清理且 audit 可读，报告写入 `.runtime/files-cleanup/2026-06-14T10-30-22-639Z/files-cleanup-smoke.json`。
- `npm run host:files-reconcile-smoke` 通过，确认 ready object、deleted object present、missing active object、orphan object 四类一致性检测，报告写入 `.runtime/files-reconcile/2026-06-14T10-30-42-822Z/files-reconcile-smoke.json`。
- Release gate 新增 `files-storage-domain`，并用当前真实 `.runtime` evidence 验证 `commercial-domain`、`files-storage-domain` 均为 `passed`。
- `npx tsx --test --test-name-pattern "files storage domain|commercial domain|provider invocation ledger" tests/release-candidate.test.ts` 通过，4/4。
- `npm run host:worker-soak -- --required --jobs 5 --limit 5 --concurrency 2 --max-iterations 8 --interval-ms 1` 通过，处理 5/5 jobs，failed 0，deadLettered 0，delivery ledger 13 条、worker records 8 条、worker registry 1 条，报告写入 `.runtime/worker-soak/2026-06-14T10-37-57-418Z/soak.json`。
- `npm run host:chaos-smoke -- --required` 通过，覆盖 queue concurrency drain、retry backoff、expired lease reclaim、dead-letter replay recovery，4/4 checks 通过，报告写入 `.runtime/chaos/2026-06-14T10-37-57-391Z/chaos.json`。
- Release gate 用当前真实 `.runtime` evidence 验证 `worker-soak`、`delivery-ledger`、`chaos-matrix` 均为 `passed`。
- `npm run host:ai-rag-local-smoke` 通过，`test:ai-provider` 4/4、`test:rag-files` 4/4、RAG provider smoke 通过，provider invocation ledger 10 条，报告写入 `.runtime/ai-rag-local/2026-06-14T10-43-33-937Z/ai-rag-local-smoke.json`。
- `npm run host:rag-provider-smoke` 通过，验证 memory-vector provider、workspace isolation、contextPack、delete audit，报告写入 `.runtime/rag-provider/2026-06-14T10-43-37-380Z/rag-provider-smoke.json`。
- `npm run host:ai-webhook-local-smoke` 通过，验证本地 AI webhook 签名、generateText、embedText，报告写入 `.runtime/ai-webhook-local/2026-06-14T10-43-36-638Z/ai-webhook-local-smoke.json`。
- `npm run host:ai-rag-policy-smoke -- --required` 通过，覆盖缺少 credits 拒绝、成功扣费入账、provider 失败释放 reservation、匿名 public API rate limit 必需、匿名高成本 commercial API fail-closed，报告写入 `.runtime/ai-rag-policy/2026-06-15T17-55-05-907Z/ai-rag-policy-smoke.json`。
- `npm run host:provider-matrix -- --required` 初次因历史同名 `/ploykit-v2-minio` exited 容器冲突失败；本轮修复 `host-s3-local-smoke`，遇到同名 MinIO 容器时启动并复用，不删除、不重建。随后 provider matrix required 通过，包含 local-provider-depth、files cleanup/reconcile、local MinIO S3、AI/RAG local、AI webhook local、RAG provider、Stripe local mock、billing reconcile、email local webhook 等检查，报告写入 `.runtime/provider-matrix/2026-06-14T10-43-41-170Z/matrix.json`。
- `npm run host:provider-matrix -- --required` 复跑通过，矩阵已包含 `ai-rag-policy`，报告写入 `.runtime/provider-matrix/2026-06-15T17-56-38-113Z/matrix.json`。
- Release gate 用当前真实 `.runtime` evidence 验证 `provider-live-matrix`、`provider-invocation-ledger`、`ai-rag-policy`、`production-adapters` 均为 `passed`。
- `npm run test:release-candidate` 通过 49/49，新增 `ai-rag-policy` 严格 evidence 读取和匿名 fail-closed 信号缺失拒绝；`npm run release:maintainer-gate` 通过并强制要求 `ai-rag-policy`。

Server-Timing 边界说明：

- 本轮确认当前 Dashboard 是 Next App Router page，`headers()` 是只读请求头；`proxy.ts` 可以写响应头但拿不到页面渲染后的 `dashboard-timing` span。因此不能把现有 page 内 span 直接声明为 document response 的 `Server-Timing` 已完成。
- 后续要完成真实 `Server-Timing`，需要调整渲染边界：例如把 dashboard document 改造成可控 route handler/streaming wrapper，或在宿主层提供 request-scoped observability sink 并由可写响应层统一落头。当前只能算结构化日志完成，响应头仍待设计。

### Phase 4：降低维护复杂度

1. 拆 `tests/web-shell.test.ts`，按 auth、billing、files、worker、admin、provider 分文件。
2. 部分完成：拆 runtime stores，Postgres runs、outbox/delivery、worker、provider invocation、audit、files、identity 与 commercial catalog/orders repository 已完成；后续优先继续 commercial billing/ledger/subscription/tax 等领域 repository。
3. 部分完成：继续拆 Admin/Dashboard 大页面与 Admin 领域 helper，按 page model、table、dialog、action、copy 分层。
4. 已完成本轮目标并继续推进：拆 commercial ledger，ledger facts/revenue/refund helper、order benefits/credits/entitlements helper、subscriptions helper、tax helper、provider events helper、credits helper、usage/metering helper、module commerce helper、redeem codes helper、risk helper 与 billing/entitlements helper 已拆出；后续转为跨 helper 语义审计、更细的领域测试增强，以及真实 Provider Smoke 运维手册规定的外部凭据环境证据归档。
5. 部分完成：拆大 CLI，模板 catalog、extension overlay、digest、create command、contract source parser、doctor diagnostics helper、CLI runner/reporting、doctor 静态 contract rule group、capability rule group、dependency rule group、module map rule group、source-boundary rule group、command execution helper、Data CLI generated artifact helper、Data CLI RLS verifier、Data CLI 数据库 introspection helper、Data CLI role safety verifier、Data CLI DB schema verifier、Data CLI `verify-db` command flow helper、Data CLI `migrate` / `reset --force` DB mutation runner、Data CLI static command helper、Data CLI reset SQL helper、Data CLI command dispatch runner、Data CLI type generation helper、Data CLI Data plan normalization helper、Data CLI migrate/reset dry-run output helper、Data CLI module.ts loader helper、Data CLI migrate/reset apply command helper、Data CLI resolve/path safety helper、Data CLI command args parser helper、Data CLI DB verifier composition helper 与 Data CLI command dependency wiring helper 已拆出；`scripts/module-data.mjs` 已降为入口壳，后续 CLI 复杂度重点转向其他脚本或测试拆分。

本轮新增完成标注：

- 已完成（2026-06-16 本轮实施）：`scripts/lib/module-doctor-contract-rules.mjs` 承担 `ploykit-module` doctor 的静态 contract rule group，包括 module id/version pattern、public aliases、resource kind、event/webhook signature、HTTP egress、public route anonymous/cache policy、Data artifact/migration 与 lifecycle handler 校验；`scripts/ploykit-module.mjs` 从 1641 行降到 1069 行，主 CLI 保留命令 wiring、capability/dependency/map/source boundary 规则和 SDK contract evaluation。
- 完成证据：`node --check scripts/ploykit-module.mjs` 与 `node --check scripts/lib/module-doctor-contract-rules.mjs` 通过；`npm run module:doctor -- modules/hello` 通过；`npm run test:module-doctor` 14/14、`npm run test:module-map` 10/10、`npm run test:developer-experience` 11/11、`npm run module:doctor -- all`、`npm run modules:check`、`npm run typecheck` 与 Prettier check 均通过。
- 已完成（2026-06-16 本轮实施）：`scripts/lib/module-doctor-capability-rules.mjs` 承担 `ploykit-module` doctor 的 capability rule group，包括 `ctx.*` capability 权限映射、config/secrets/services/resourceBindings contract metadata 声明要求，以及 privileged service module 的 `ctx.services` 使用约束；`scripts/ploykit-module.mjs` 从 1069 行降到 710 行，主 CLI 保留命令 wiring、dependency/map/source boundary 规则和 SDK contract evaluation。
- 完成证据：`node --check scripts/ploykit-module.mjs` 与 `node --check scripts/lib/module-doctor-capability-rules.mjs` 通过；`npm run module:doctor -- modules/hello` 通过；`npm run test:module-doctor` 14/14、`npm run test:module-map` 10/10、`npm run test:developer-experience` 11/11、`npm run module:doctor -- all`、`npm run modules:check`、`npm run typecheck` 与 Prettier check 均通过。
- 已完成（2026-06-16 本轮实施）：`scripts/lib/module-doctor-dependency-rules.mjs` 承担 `ploykit-module` doctor 的 dependency rule group，包括静态 `dependencies.npm` 诊断标准化、host `package.json` dependency/devDependency 覆盖检查和 `MODULE_DEPENDENCY_NOT_HOST_RUNTIME` 输出；`scripts/ploykit-module.mjs` 从 710 行降到 676 行，主 CLI 保留命令 wiring、map/source boundary 规则和 SDK contract evaluation。
- 完成证据：`node --check scripts/ploykit-module.mjs` 与 `node --check scripts/lib/module-doctor-dependency-rules.mjs` 通过；`npm run module:doctor -- modules/hello` 通过；`npm run test:module-doctor` 14/14、`npm run test:module-map` 10/10、`npm run test:developer-experience` 11/11、`npm run module:doctor -- all`、`npm run modules:check`、`npm run typecheck` 与 Prettier check 均通过。
- 已完成（2026-06-16 本轮实施）：`scripts/lib/module-doctor-map-rules.mjs` 承担 `ploykit-module` doctor 的 module map rule group，包括 manifest 缺失/stale/release metadata 缺失、source hash drift 与 contract digest drift 检查，并继续为 doctor summary/inspect 提供 source hash helper；该轮 `scripts/ploykit-module.mjs` 从 676 行降到 586 行，随后 source-boundary rule group 继续拆出。
- 完成证据：`node --check scripts/ploykit-module.mjs` 与 `node --check scripts/lib/module-doctor-map-rules.mjs` 通过；`npm run module:doctor -- modules/hello` 通过；`npm run test:module-doctor` 14/14、`npm run test:module-map` 10/10、`npm run test:developer-experience` 11/11、`npm run module:doctor -- all`、`npm run modules:check`、`npm run typecheck` 与 Prettier check 均通过。
- 已完成（2026-06-16 本轮实施）：`scripts/lib/module-doctor-source-boundary-rules.mjs` 承担 `ploykit-module` doctor 的 source-boundary rule group，包括 contract local path/root escape/missing file 校验、contract part file/export 检查、module source safety 边界校验，以及 API/action handler 的 `defineApi` / `action` / `defineAction` 定义检查；`scripts/ploykit-module.mjs` 从 586 行降到 443 行，主 CLI 保留命令 wiring 和 SDK contract evaluation。
- 完成证据：`node --check scripts/ploykit-module.mjs` 与 `node --check scripts/lib/module-doctor-source-boundary-rules.mjs` 通过；`node scripts/ploykit-module.mjs inspect modules/hello` 输出成功；`npm run module:doctor -- modules/hello` 通过；`npm run test:module-doctor` 14/14、`npm run test:module-map` 10/10、`npm run test:developer-experience` 11/11、`npm run module:doctor -- all`、`npm run modules:check`、`npm run typecheck` 与 Prettier check 均通过。
- 已完成（2026-06-16 本轮实施）：`scripts/lib/module-command-execution.mjs` 承担 `ploykit-module` 的 command execution helper，包括本地脚本子进程执行、SDK contract validation 子进程调用、超时/失败 diagnostics 标准化，并让 `module:create` 与 `module:dev` 复用同一 `runLocalScript`；同时修复 `commandDev` 旧代码引用未定义 `runLocalScript` 的断点；`scripts/ploykit-module.mjs` 从 443 行降到 397 行，主 CLI 保留命令 wiring 和 doctor orchestration。
- 完成证据：`node --check scripts/ploykit-module.mjs`、`node --check scripts/lib/module-command-execution.mjs` 与 `node --check scripts/lib/module-create-command.mjs` 通过；`node scripts/ploykit-module.mjs validate-contract-internal modules/hello`、`node scripts/ploykit-module.mjs dev modules/hello`、`npm run module:doctor -- modules/hello` 均通过；`npm run test:module-doctor` 14/14、`npm run test:module-map` 10/10、`npm run test:developer-experience` 11/11、`npm run module:doctor -- all`、`npm run modules:check`、`npm run typecheck` 与 Prettier check 均通过。
- 已完成（2026-06-16 本轮实施）：`scripts/lib/module-data-artifacts.mjs` 承担 Data CLI generated artifact helper，包括 `data-plan.json`、`data-types.ts`、generated migration 的路径解析/写入、`verify` 的 stale/missing 静态校验，以及 `migrate --dry-run` 的 migration entry 收集；`scripts/module-data.mjs` 从 1778 行降到 1657 行，主 CLI 保留 Data plan 归一、SQL/type generation、DB migrate/verify-db orchestration。
- 完成证据：`node --check scripts/module-data.mjs` 与 `node --check scripts/lib/module-data-artifacts.mjs` 通过；`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run` 均通过；`npm run test:advanced-runtime` 5/5、`npm run test:developer-experience` 11/11、`npm run modules:check`、`npm run typecheck`、`npm run docs:encoding-check` 与本轮 touched 文件 Prettier check 均通过。
- 已完成（2026-06-16 本轮实施）：`scripts/lib/module-data-db-rls.mjs` 承担 Data CLI `verify-db` 的 RLS policy/table verifier，包括 policy 表达式 normalization、document/table scope policy 期望片段、RLS enabled/forced、policy extra/missing、command/USING/WITH CHECK mismatch diagnostics；`tests/advanced-runtime.test.ts` 新增 fake DB reader 覆盖 policy drift diagnostics；`scripts/module-data.mjs` 从 1657 行降到 1507 行，主 CLI 保留 DB connection、metadata/column/role safety orchestration。
- 完成证据：`node --check scripts/module-data.mjs` 与 `node --check scripts/lib/module-data-db-rls.mjs` 通过；`node scripts/module-data.mjs verify-db modules/hello` 在无数据库配置下保持预期 `MODULE_DATA_VERIFY_DB_DATABASE_URL_REQUIRED` 非零输出；`npm run test:advanced-runtime` 6/6、`npm run modules:check`、`npm run typecheck`、`npm run docs:encoding-check` 与本轮 touched 文件 Prettier check 均通过。
- 已完成（2026-06-16 本轮实施）：`scripts/lib/module-data-db-introspection.mjs` 承担 Data CLI 的数据库 introspection helper，包括 `migrate` / `reset` / `verify-db` 复用的连接池创建、DATABASE_URL/app-role URL 解析、table/column/RLS policy catalog 读取、metadata hash 读取和当前 role safety 快照读取；`tests/advanced-runtime.test.ts` 新增 fake pool 覆盖 catalog snapshot 映射；`scripts/module-data.mjs` 当前 1561 行，主 CLI 保留 Data plan、SQL/type generation、migrate/reset/verify-db orchestration、metadata/column mismatch 和 role safety diagnostics。
- 完成证据：`node --check scripts/module-data.mjs` 与 `node --check scripts/lib/module-data-db-introspection.mjs` 通过；`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run` 均通过；`node scripts/module-data.mjs verify-db modules/hello` 在无数据库配置下保持预期 `MODULE_DATA_VERIFY_DB_DATABASE_URL_REQUIRED` 非零输出；`npm run test:advanced-runtime` 7/7、`npm run modules:check`、`npm run typecheck` 与本轮 code touched 文件 Prettier check 均通过。
- 已完成（2026-06-16 本轮实施）：`scripts/lib/module-data-db-role-safety.mjs` 承担 Data CLI `verify-db` 的 role safety verifier，包括 RLS 表名收集、database/app runtime role superuser/BYPASSRLS/DDL/table owner 风险诊断，以及 app-role safety required/skipped 诊断输出；`tests/advanced-runtime.test.ts` 新增 fake reader 覆盖 role risk diagnostics、details 和 RLS table name 收集；`scripts/module-data.mjs` 当前 1451 行，主 CLI 保留 Data plan、SQL/type generation、migrate/reset/verify-db orchestration 和 metadata/column mismatch diagnostics。
- 完成证据：`node --check scripts/module-data.mjs` 与 `node --check scripts/lib/module-data-db-role-safety.mjs` 通过；`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run` 均通过；`node scripts/module-data.mjs verify-db modules/hello` 在无数据库配置下保持预期 `MODULE_DATA_VERIFY_DB_DATABASE_URL_REQUIRED` 与 `MODULE_DATA_DB_APP_ROLE_SAFETY_SKIPPED` 输出；`node scripts/module-data.mjs verify-db modules/hello --require-app-role-safety` 保持预期 `MODULE_DATA_DB_APP_ROLE_URL_REQUIRED` 输出；`npm run test:advanced-runtime` 8/8、`npm run modules:check`、`npm run typecheck` 与本轮 code touched 文件 Prettier check 均通过。
- 已完成（2026-06-16 本轮实施）：`scripts/lib/module-data-db-schema-verifier.mjs` 承担 Data CLI `verify-db` 的 DB schema verifier，包括 document store 表/列校验、metadata tables 存在性、document/table metadata hash drift、module table column missing/type/nullability drift，以及 RLS verifier 调用编排；`tests/advanced-runtime.test.ts` 新增 fake DB schema verifier 覆盖 table/column/metadata drift diagnostics 与 RLS policy verifier 调用；`scripts/module-data.mjs` 当前 1291 行，主 CLI 保留 Data plan、SQL/type generation、migrate/reset/verify-db connection flow 和 output orchestration。
- 完成证据：`node --check scripts/module-data.mjs` 与 `node --check scripts/lib/module-data-db-schema-verifier.mjs` 通过；`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run` 均通过；`node scripts/module-data.mjs verify-db modules/hello` 在无数据库配置下保持预期 `MODULE_DATA_VERIFY_DB_DATABASE_URL_REQUIRED` 与 `MODULE_DATA_DB_APP_ROLE_SAFETY_SKIPPED` 输出；`node scripts/module-data.mjs verify-db modules/hello --require-app-role-safety` 保持预期 `MODULE_DATA_DB_APP_ROLE_URL_REQUIRED` 输出；`npm run test:advanced-runtime` 9/9、`npm run modules:check`、`npm run typecheck` 与本轮 code touched 文件 Prettier check 均通过。
- 已完成（2026-06-16 本轮实施）：`scripts/lib/module-data-verify-db-command.mjs` 承担 Data CLI `verify-db` command flow，包括 DATABASE_URL/app-role URL 解析、required/skipped diagnostics 分支、primary/app pool 生命周期、schema verifier 与 role safety verifier 调用、checkedModules/output payload 和非零 exit code 设置；`tests/advanced-runtime.test.ts` 新增 fake command runner 覆盖 primary/app role pool close、schema/role verifier 调用、app-role required 分支和 process.exitCode 隔离；`scripts/module-data.mjs` 当前 1207 行，主 CLI 保留 Data plan、SQL/type generation、migrate/reset orchestration 和 command dispatch。
- 完成证据：`node --check scripts/module-data.mjs` 与 `node --check scripts/lib/module-data-verify-db-command.mjs` 通过；`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run` 均通过；`node scripts/module-data.mjs verify-db modules/hello` 在无数据库配置下保持预期 `MODULE_DATA_VERIFY_DB_DATABASE_URL_REQUIRED` 与 `MODULE_DATA_DB_APP_ROLE_SAFETY_SKIPPED` 输出；`node scripts/module-data.mjs verify-db modules/hello --require-app-role-safety` 保持预期 `MODULE_DATA_DB_APP_ROLE_URL_REQUIRED` 输出；`npm run test:advanced-runtime` 10/10、`npm run modules:check`、`npm run typecheck` 与本轮 code touched 文件 Prettier check 均通过。
- 已完成（2026-06-16 本轮实施）：`scripts/lib/module-data-db-mutate-command.mjs` 承担 Data CLI `migrate` / `reset --force` DB mutation runner，包括 DATABASE_URL required diagnostics、pool 生命周期、transaction begin/commit/rollback、migration SQL 读取注入、applied/reset payload 和 migrate/reset failed diagnostics；`tests/advanced-runtime.test.ts` 新增 fake pool 覆盖 migration success/failure rollback、failed path、reset success、required URL diagnostics；`scripts/module-data.mjs` 当前 1122 行，主 CLI 保留 Data plan、SQL/type generation、dry-run output 和 command dispatch。
- 完成证据：`node --check scripts/module-data.mjs` 与 `node --check scripts/lib/module-data-db-mutate-command.mjs` 通过；`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run`、`node scripts/module-data.mjs reset modules/hello --dry-run` 均通过；`node scripts/module-data.mjs verify-db modules/hello` 在无数据库配置下保持预期 `MODULE_DATA_VERIFY_DB_DATABASE_URL_REQUIRED` 与 `MODULE_DATA_DB_APP_ROLE_SAFETY_SKIPPED` 输出；`node scripts/module-data.mjs verify-db modules/hello --require-app-role-safety` 保持预期 `MODULE_DATA_DB_APP_ROLE_URL_REQUIRED` 输出；`npm run test:advanced-runtime` 11/11、`npm run modules:check`、`npm run typecheck` 与本轮 code touched 文件 Prettier check 均通过。
- 已完成（2026-06-16 本轮实施）：`scripts/lib/module-data-static-commands.mjs` 承担 Data CLI `plan` / `generate` / `types` / `verify` 的 static command helper，包括 static plan loading、diagnostics 汇总、success/exit code/output payload、generated plan/migration/types 写入 orchestration 和 generated artifact verify 输出；`tests/advanced-runtime.test.ts` 新增 fake artifact command runner 覆盖 plan count、generate/types changed paths、verify stale diagnostics 和 process.exitCode 隔离；`scripts/module-data.mjs` 当前 1031 行，主 CLI 保留 Data plan normalization、SQL/type generation、migrate/reset dry-run output 和 command dispatch。
- 完成证据：`node --check scripts/module-data.mjs` 与 `node --check scripts/lib/module-data-static-commands.mjs` 通过；`node scripts/module-data.mjs plan modules/hello`、`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run`、`node scripts/module-data.mjs reset modules/hello --dry-run` 均通过；`npm run test:advanced-runtime` 12/12、`npm run modules:check`、`npm run typecheck` 与本轮 code touched 文件 Prettier check 均通过。
- 已完成（2026-06-16 本轮实施）：`scripts/lib/module-data-reset-sql.mjs` 承担 Data CLI reset SQL helper，包括 module document 删除、module table drop、metadata/migration/grants/checks 清理和 identifier/string quoting；`tests/advanced-runtime.test.ts` 新增 reset SQL helper 直接覆盖 module id string quote 与 physical table identifier quote；`scripts/module-data.mjs` 当前 1011 行，主 CLI 保留 Data plan normalization、SQL/type generation、migrate/reset dry-run output 和 command dispatch。
- 完成证据：`node --check scripts/module-data.mjs` 与 `node --check scripts/lib/module-data-reset-sql.mjs` 通过；`node scripts/module-data.mjs plan modules/hello`、`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run`、`node scripts/module-data.mjs reset modules/hello --dry-run` 均通过；`npm run test:advanced-runtime` 13/13、`npm run modules:check`、`npm run typecheck` 与本轮 code touched 文件 Prettier check 均通过。
- 已完成（2026-06-16 本轮实施）：`scripts/lib/module-data-cli-runner.mjs` 承担 Data CLI command dispatch runner，包括 usage、argv command dispatch、unknown command 非零退出、top-level `MODULE_DATA_CLI_ERROR` JSON reporting 与 `tsx.unregister()` finally hook；`tests/advanced-runtime.test.ts` 新增直接覆盖成功 dispatch、unknown command usage/exitCode 和异常 command JSON 输出；`scripts/module-data.mjs` 当前 893 行，主 CLI 保留 Data plan normalization、SQL/type generation 与 migrate/reset dry-run output。
- 完成证据：`node --check scripts/module-data.mjs` 与 `node --check scripts/lib/module-data-cli-runner.mjs` 通过；`node scripts/module-data.mjs plan modules/hello`、`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run`、`node scripts/module-data.mjs reset modules/hello --dry-run` 均通过；unknown command 非零退出验证通过；`npm run test:advanced-runtime` 14/14、`npm run modules:check`、`npm run typecheck` 与本轮 code touched 文件 Prettier check 均通过。
- 已完成（2026-06-16 本轮实施）：`scripts/lib/module-data-types.mjs` 承担 Data CLI type generation helper，包括 TS identifier 归一、document field/table column 类型映射、Data interface 和 `get<Module>Data(ctx)` accessor 生成；`tests/advanced-runtime.test.ts` 新增直接覆盖 identifier/nullable/type mapping 与 interface/accessor 输出片段；`scripts/module-data.mjs` 当前 800 行，主 CLI 保留 Data plan normalization 与 migrate/reset dry-run output。
- 完成证据：`node --check scripts/module-data.mjs` 与 `node --check scripts/lib/module-data-types.mjs` 通过；`node scripts/module-data.mjs plan modules/hello`、`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run`、`node scripts/module-data.mjs reset modules/hello --dry-run` 均通过；`npm run test:advanced-runtime` 15/15、`npm run modules:check`、`npm run typecheck` 与本轮 code touched 文件 Prettier check 均通过。
- 已完成（2026-06-16 本轮实施）：`scripts/lib/module-data-plan.mjs` 承担 Data CLI Data plan normalization helper，包括 STANDARD_COLUMNS、physical table name、schema hash、document/table/view/grant/check/migration normalization，以及 Data v2 scope、migration、index、relation、view/grant/check diagnostics；`tests/advanced-runtime.test.ts` 新增直接覆盖默认值 clone、物理表名、schema hash 和关键 validation diagnostics；`scripts/module-data.mjs` 当前 395 行，主 CLI 保留 module.ts 加载、migrate/reset dry-run output 和 command wiring。
- 完成证据：`node --check scripts/module-data.mjs` 与 `node --check scripts/lib/module-data-plan.mjs` 通过；`node scripts/module-data.mjs plan modules/hello`、`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run`、`node scripts/module-data.mjs reset modules/hello --dry-run` 均通过；`npm run test:advanced-runtime` 16/16、`npm run modules:check`、`npm run typecheck` 与本轮 code touched 文件 Prettier check 均通过。
- 已完成（2026-06-16 本轮实施）：`scripts/lib/module-data-dry-run.mjs` 承担 Data CLI migrate/reset dry-run output helper，包括 migration dry-run payload entry 映射、reset dry-run payload、success/error diagnostics 判定和 reset next 文案；`tests/advanced-runtime.test.ts` 新增直接覆盖 warning/error diagnostics、migration path/bytes/schemaHash 映射与 reset next 文案；`scripts/module-data.mjs` 当前 383 行，主 CLI 保留 module.ts 加载、migrate/reset apply orchestration 和 command wiring。
- 完成证据：`node --check scripts/module-data.mjs` 与 `node --check scripts/lib/module-data-dry-run.mjs` 通过；`node scripts/module-data.mjs plan modules/hello`、`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run`、`node scripts/module-data.mjs reset modules/hello --dry-run` 均通过；`npm run test:advanced-runtime` 17/17、`npm run modules:check`、`npm run typecheck` 与本轮 code touched 文件 Prettier check 均通过。
- 已完成（2026-06-16 本轮实施）：`scripts/lib/module-data-loader.mjs` 承担 Data CLI module.ts loader helper，包括 module definition URL、nested default export 解包、`tsx.import` 注入式 module.ts 加载、无效导出错误和 `MODULE_DATA_CONTRACT_LOAD_FAILED` 标准诊断 payload；`tests/advanced-runtime.test.ts` 新增 fake importer 直接覆盖成功加载、bad export 与 import throw 诊断；`scripts/module-data.mjs` 当前 352 行，主 CLI 保留 migrate/reset apply orchestration 和 command wiring。
- 完成证据：`node --check scripts/module-data.mjs` 与 `node --check scripts/lib/module-data-loader.mjs` 通过；`node scripts/module-data.mjs plan modules/hello`、`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run`、`node scripts/module-data.mjs reset modules/hello --dry-run` 均通过；`npm run test:advanced-runtime` 18/18、`npm run modules:check`、`npm run typecheck` 与本轮 code touched 文件 Prettier check 均通过。
- 已完成（2026-06-16 本轮实施）：`scripts/lib/module-data-apply-commands.mjs` 承担 Data CLI migrate/reset apply command helper，包括 apply context loading、migrate dry-run/DB URL required/apply payload、reset 默认 dry-run/force apply payload 和 exitCode 设置；`tests/advanced-runtime.test.ts` 新增 fake artifacts/dbMutations 覆盖 migrate dry-run、缺 DATABASE_URL、真实 apply、reset 默认 dry-run 与 `--force` apply；`scripts/module-data.mjs` 当前 289 行，主 CLI 保留 resolve/path safety、DB verifier composition 和 command wiring。
- 完成证据：`node --check scripts/module-data.mjs` 与 `node --check scripts/lib/module-data-apply-commands.mjs` 通过；`node scripts/module-data.mjs plan modules/hello`、`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run`、`node scripts/module-data.mjs reset modules/hello --dry-run` 均通过；`npm run test:advanced-runtime` 19/19、`npm run modules:check`、`npm run typecheck` 与本轮 code touched 文件 Prettier check 均通过。
- 已完成（2026-06-16 本轮实施）：`scripts/lib/module-data-paths.mjs` 承担 Data CLI resolve/path safety helper，包括 module-local `./` 路径解析、空路径拒绝和 module root escape 防护；`tests/advanced-runtime.test.ts` 新增直接覆盖正常 migration path、非 `./` 路径、`./` 空路径和 `../` 逃逸路径；`scripts/module-data.mjs` 当前 277 行，主 CLI 保留 DB verifier composition 和 command dependency wiring。
- 完成证据：`node --check scripts/module-data.mjs` 与 `node --check scripts/lib/module-data-paths.mjs` 通过；`node scripts/module-data.mjs plan modules/hello`、`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run`、`node scripts/module-data.mjs reset modules/hello --dry-run` 均通过；`npm run test:advanced-runtime` 20/20、`npm run modules:check`、`npm run typecheck` 与本轮 code touched 文件 Prettier check 均通过。
- 已完成（2026-06-16 本轮实施）：`scripts/lib/module-data-args.mjs` 承担 Data CLI command args parser helper，包括 target path、`--module` filter、`--database-url`、`--app-database-url`、`--schema` 和普通 flags 解析，以及缺值错误；`tests/advanced-runtime.test.ts` 新增直接覆盖 target/filter/value/flag 组合和 `--module` / `--database-url` / `--app-database-url` / `--schema` 缺值错误；`scripts/module-data.mjs` 当前 225 行，主 CLI 保留 DB verifier composition 和 command dependency wiring。
- 完成证据：`node --check scripts/module-data.mjs` 与 `node --check scripts/lib/module-data-args.mjs` 通过；`node scripts/module-data.mjs plan modules/hello`、`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run`、`node scripts/module-data.mjs reset modules/hello --dry-run` 均通过；`npm run test:advanced-runtime` 21/21、`npm run modules:check`、`npm run typecheck` 与本轮 code touched 文件 Prettier check 均通过。
- 已完成（2026-06-16 本轮实施）：`scripts/lib/module-data-db-verifier.mjs` 承担 Data CLI DB verifier composition helper，统一组装 role safety verifier、RLS verifier、DB schema verifier 与 `verify-db` command 依赖；`tests/advanced-runtime.test.ts` 新增 fake pool/catalog/RLS/role composition 覆盖 schema/RLS/metadata、primary database role 与 app-role 两条 `verify-db` 路径；`scripts/module-data.mjs` 当前 225 行，主 CLI 保留 command dependency wiring。
- 完成证据：`node --check scripts/module-data.mjs` 与 `node --check scripts/lib/module-data-db-verifier.mjs` 通过；`node scripts/module-data.mjs plan modules/hello`、`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run`、`node scripts/module-data.mjs reset modules/hello --dry-run` 均通过；`npm run test:advanced-runtime` 22/22、`npm run modules:check`、`npm run typecheck` 与本轮 code touched 文件 Prettier check 均通过。
- 已完成（2026-06-16 本轮实施）：`scripts/lib/module-data-command-dependencies.mjs` 承担 Data CLI command dependency wiring helper，统一组装 module source discovery、module.ts loader、Data plan helper、artifact helper、static/apply/verify-db commands 与最终 commands map；`tests/advanced-runtime.test.ts` 新增临时 Data 模块覆盖 command wiring helper 的 `buildPlans`、`plan` command 和 `verify-db` command 接线；`scripts/module-data.mjs` 当前 46 行，已降为 tsx 注册、JSON 输出/error reporting 与 CLI dispatch 入口壳。
- 完成证据：`node --check scripts/module-data.mjs` 与 `node --check scripts/lib/module-data-command-dependencies.mjs` 通过；`node scripts/module-data.mjs plan modules/hello`、`node scripts/module-data.mjs generate modules/hello --check`、`node scripts/module-data.mjs types modules/hello --check`、`node scripts/module-data.mjs verify modules/hello`、`node scripts/module-data.mjs migrate modules/hello --dry-run`、`node scripts/module-data.mjs reset modules/hello --dry-run` 均通过；`npm run test:advanced-runtime` 23/23、`npm run modules:check`、`npm run typecheck` 与本轮 code touched 文件 Prettier check 均通过。
- 已完成（2026-06-16 本轮实施）：`src/lib/module-capabilities/commercial/commercial-ledger-facts.ts` 承担商业账本 ledger facts/revenue/refund helper，包括 paid order domain facts、billing account/subscription/invoice/tax snapshot 写入、revenue bucket 刷新、refund credit note 与 invoice refunded/net 更新；`src/lib/module-capabilities/commercial/commercial-ledger.ts` 当前 1537 行，provider runtime 继续通过同名回调调用。
- 完成证据：`npm run test:commercial-ledger` 10/10、`npx tsx --test tests/web-shell-commercial.test.ts` 7/7、`npx tsx --test tests/web-shell-stripe.test.ts` 4/4、`npm run typecheck` 与本轮 code touched 文件 Prettier check 均通过。
- 已完成（2026-06-16 本轮实施）：`src/lib/module-capabilities/commercial/commercial-ledger-benefits.ts` 承担商业账本 order benefits/credits/entitlements helper，包括 paid order credits/entitlements 发放、full refund credits 反向入账、order-backed entitlement revoke，以及 benefit reconcile 缺失检测；`src/lib/module-capabilities/commercial/commercial-ledger.ts` 当前 1402 行，provider runtime 与 public commerce runtime 复用同一 helper。
- 完成证据：`npm run test:commercial-ledger` 10/10、`npx tsx --test tests/web-shell-commercial.test.ts` 7/7、`npx tsx --test tests/web-shell-stripe.test.ts` 4/4、`npm run typecheck`、本轮 code touched 文件 Prettier check 与 `git diff --check -- src/lib/module-capabilities/commercial/commercial-ledger.ts src/lib/module-capabilities/commercial/commercial-ledger-benefits.ts` 均通过。
- 已完成（2026-06-16 本轮实施）：`src/lib/module-capabilities/commercial/commercial-ledger-subscriptions.ts` 承担商业账本 subscriptions helper，包括当前 subscription 查找、subscription event ordering 时间戳读取、plan entitlement 归一、subscription-backed entitlement grant/revoke 同步；`src/lib/module-capabilities/commercial/commercial-ledger.ts` 当前 1306 行，provider subscription event runtime 继续通过同名回调调用。
- 已完成（2026-06-16 本轮实施）：`src/lib/module-capabilities/commercial/commercial-ledger-tax.ts` 承担商业账本 tax helper，包括 admin tax profile jurisdiction 规范化/本地校验/审计，以及 invoice tax snapshot 读取；`src/lib/module-capabilities/commercial/commercial-ledger.ts` 该轮降到 1334 行，admin runtime 与 ledger facts 继续通过同名回调调用。
- 已完成（2026-06-16 本轮实施）：`src/lib/module-capabilities/commercial/commercial-ledger-events.ts` 承担商业账本 provider events helper，包括 order status event payload、correlation/causation id、idempotency key 与 publish options；`src/lib/module-capabilities/commercial/commercial-ledger.ts` 当前 1287 行，provider runtime 继续通过同名回调调用。
- 已完成（2026-06-16 本轮实施）：`src/lib/module-capabilities/commercial/commercial-ledger-credits.ts` 承担商业账本 credits helper，包括 credits balance/record、grant/consume/adjust/refund、reservation reserve/commit/release、revokeBySource 和 ledger list；`src/lib/module-capabilities/commercial/commercial-ledger.ts` 当前 1006 行，admin runtime、redeem code 发放和 metering charge 继续复用同一 helper。
- 已完成（2026-06-16 本轮实施）：`src/lib/module-capabilities/commercial/commercial-ledger-metering.ts` 承担商业账本 usage/metering helper，包括 usage record/increment、metering authorize/commit/refund/void/reconcile，以及与 credits helper 协作的 metering charge 扣费、reservation commit 和失败 void；`src/lib/module-capabilities/commercial/commercial-ledger.ts` 当前 859 行，module runtime 继续通过同名 usage/metering API 暴露。
- 已完成（2026-06-16 本轮实施）：`src/lib/module-capabilities/commercial/commercial-ledger-commerce.ts` 承担商业账本 module commerce helper，包括 checkout 创建/读取、模块侧 paid/refund、subscription event、paid benefit reconcile、scoped order lookup 和 paid input match guard；`src/lib/module-capabilities/commercial/commercial-ledger.ts` 当前 640 行，public `ctx.commerce` API 与 provider runtime scoped order guard 继续通过同名 helper 调用。
- 已完成（2026-06-16 本轮实施）：`src/lib/module-capabilities/commercial/commercial-ledger-redeem.ts` 承担商业账本 redeem codes helper，包括 legacy `billing.redeemCode` 底层兑换、批量创建兑换码、subject/email bind 校验、兑换核销、entitlement/credits 发放、attempt audit、冻结/撤销和 code/redemption 列表；`src/lib/module-capabilities/commercial/commercial-ledger.ts` 当前 406 行，module runtime 继续通过同名 billing/redeemCodes API 暴露。
- 已完成（2026-06-16 本轮实施）：`src/lib/module-capabilities/commercial/commercial-ledger-risk.ts` 承担商业账本 risk helper，包括 risk event 记录、risk audit 写入、subject block upsert 和 scoped block check；`src/lib/module-capabilities/commercial/commercial-ledger.ts` 当前 326 行，module runtime 继续通过同名 `ctx.risk` API 暴露。
- 已完成（2026-06-16 本轮实施）：`src/lib/module-capabilities/commercial/commercial-ledger-billing.ts` 承担商业账本 billing/entitlements helper，包括 active entitlement 过滤、plan/current plan 解析、legacy billing entitlement/redeem API，以及 entitlements has/list/grant/revoke/override/expire；`src/lib/module-capabilities/commercial/commercial-ledger.ts` 当前 213 行，module runtime 继续通过同名 billing/entitlements API 暴露。
- 完成证据：`npm run test:commercial-ledger` 10/10、`npx tsx --test tests/web-shell-commercial.test.ts` 7/7、`npx tsx --test tests/web-shell-stripe.test.ts` 4/4、`npm run typecheck`、本轮 code touched 文件 Prettier check 与 `git diff --check -- src/lib/module-capabilities/commercial/commercial-ledger.ts src/lib/module-capabilities/commercial/commercial-ledger-subscriptions.ts` 均通过。
- 完成证据：tax/provider events 本轮复跑 `npm run test:commercial-ledger` 10/10、`npx tsx --test tests/web-shell-commercial.test.ts` 7/7、`npx tsx --test tests/web-shell-stripe.test.ts` 4/4、`npm run typecheck`、本轮 code touched 文件 Prettier check、`npm run docs:encoding-check` 与 `git diff --check -- src/lib/module-capabilities/commercial/commercial-ledger.ts src/lib/module-capabilities/commercial/commercial-ledger-admin.ts src/lib/module-capabilities/commercial/commercial-ledger-tax.ts src/lib/module-capabilities/commercial/commercial-ledger-events.ts src/lib/module-capabilities/commercial/commercial-ledger-provider.ts src/lib/module-capabilities/commercial/commercial-ledger-facts.ts` 均通过。
- 完成证据：credits helper 本轮复跑 `npm run test:commercial-ledger` 10/10、`npx tsx --test tests/web-shell-commercial.test.ts` 7/7、`npx tsx --test tests/web-shell-stripe.test.ts` 4/4、`npm run typecheck`、本轮 code touched 文件 Prettier check、`npm run docs:encoding-check` 与 `git diff --check -- src/lib/module-capabilities/commercial/commercial-ledger.ts src/lib/module-capabilities/commercial/commercial-ledger-credits.ts` 均通过。
- 完成证据：usage/metering helper 本轮复跑 `npm run test:commercial-ledger` 10/10、`npx tsx --test tests/web-shell-commercial.test.ts` 7/7、`npx tsx --test tests/web-shell-stripe.test.ts` 4/4、`npm run typecheck`、本轮 code touched 文件 Prettier check、`npm run docs:encoding-check` 与 `git diff --check -- src/lib/module-capabilities/commercial/commercial-ledger.ts src/lib/module-capabilities/commercial/commercial-ledger-metering.ts` 均通过。
- 完成证据：module commerce helper 本轮复跑 `npm run test:commercial-ledger` 10/10、`npx tsx --test tests/web-shell-commercial.test.ts` 7/7、`npx tsx --test tests/web-shell-stripe.test.ts` 4/4、`npm run typecheck`、本轮 code touched 文件 Prettier check、`npm run docs:encoding-check` 与 `git diff --check -- src/lib/module-capabilities/commercial/commercial-ledger.ts src/lib/module-capabilities/commercial/commercial-ledger-commerce.ts` 均通过。
- 完成证据：redeem codes helper 本轮复跑 `npm run test:commercial-ledger` 10/10、`npx tsx --test tests/web-shell-commercial.test.ts` 7/7、`npx tsx --test tests/web-shell-stripe.test.ts` 4/4、`npm run typecheck`、本轮 code touched 文件 Prettier check、`npm run docs:encoding-check` 与 `git diff --check -- src/lib/module-capabilities/commercial/commercial-ledger.ts src/lib/module-capabilities/commercial/commercial-ledger-redeem.ts` 均通过。
- 完成证据：risk helper 本轮复跑 `npm run test:commercial-ledger` 10/10、`npx tsx --test tests/web-shell-commercial.test.ts` 7/7、`npx tsx --test tests/web-shell-stripe.test.ts` 4/4、`npm run typecheck`、本轮 code touched 文件 Prettier check、`npm run docs:encoding-check` 与 `git diff --check -- src/lib/module-capabilities/commercial/commercial-ledger.ts src/lib/module-capabilities/commercial/commercial-ledger-risk.ts` 均通过。
- 完成证据：billing/entitlements helper 本轮复跑 `npm run test:commercial-ledger` 10/10、`npx tsx --test tests/web-shell-commercial.test.ts` 7/7、`npx tsx --test tests/web-shell-stripe.test.ts` 4/4、`npm run typecheck`、本轮 code touched 文件 Prettier check、`npm run docs:encoding-check` 与 `git diff --check -- src/lib/module-capabilities/commercial/commercial-ledger.ts src/lib/module-capabilities/commercial/commercial-ledger-billing.ts` 均通过。
- 已完成（2026-06-16 本轮实施）：新增 `tests/advanced-runtime-data-helpers.ts`，集中承载 `tests/advanced-runtime.test.ts` 的 Data CLI helper 类型、动态 import helper 和 Data fixture 清理；`tests/advanced-runtime.test.ts` 从 2371 行降到 1624 行，`tests/advanced-runtime-data-helpers.ts` 为 779 行，当前源码、脚本和测试文本文件均低于 2000 行。
- 完成证据：`npm run test:advanced-runtime` 23/23、`npm run typecheck`、本轮 code touched 文件 Prettier check 与 `git diff --check -- tests/advanced-runtime.test.ts tests/advanced-runtime-data-helpers.ts` 均通过；`rg --files src scripts tests apps` 行数扫描无 2000 行以上文本文件输出。
- 已完成（2026-06-16 本轮实施）：新增 `tests/advanced-runtime-data-module-imports.ts` 与 `tests/advanced-runtime-data-fixtures.ts`，继续拆分 advanced runtime Data 共享 helper：前者集中维护 `scripts/lib/module-data-*.mjs` 动态 import，后者集中维护 Data diff 临时模块 fixture 生命周期；`tests/advanced-runtime-data-helpers.ts` 现在只保留类型契约和兼容 re-export，从 779 行降到 680 行。
- 完成证据：`npm run test:advanced-runtime` 23/23；本轮 touched 文件 Prettier check 通过。
- 已完成（2026-06-15 本轮实施）：Postgres runtime store 的 runs 领域已从 `postgres-runtime-store.ts` 抽到 `src/lib/module-runtime/stores/postgres-runtime-store-runs.ts`，独立承载 run 创建、读取、列表、状态更新和日志追加；主 store 通过 `createPostgresRunStore({ database, createId })` 组合该领域 repository，保持 `RuntimeStore` 对外契约不变。
- 完成证据：`postgres-runtime-store.ts` 从 2999 行降到 2888 行，新增 `postgres-runtime-store-runs.ts` 141 行；`npm run typecheck` 通过；默认 `npm run test:runtime-stores` 通过 8 个本地子测试且 Postgres 子项按本地库不可达 skip；使用隔离临时 Docker Postgres `ploykit-runs-store-split-postgres`（`127.0.0.1:55445`，验证后删除）串行执行 `npm run test:runtime-stores` 10/10 通过且 0 skipped，再执行 `npm run runtime:stores:verify` 通过，29/29 migration applied、`indexAudit.required=51`、`present=51`、`missing=[]`。
- 已完成（2026-06-15 本轮实施）：Postgres runtime store 的 outbox/delivery 领域已从 `postgres-runtime-store.ts` 抽到 `src/lib/module-runtime/stores/postgres-runtime-store-outbox.ts`，独立承载 outbox 入队、列表、claim、mark 与 delivery ledger 记录/查询；主 store 通过 `createPostgresOutboxStore({ database, createId })` 组合该领域 repository，保持 `RuntimeStore` 对外契约不变。
- 完成证据：`postgres-runtime-store.ts` 从 2888 行继续降到 2694 行，新增 `postgres-runtime-store-outbox.ts` 225 行；`npm run typecheck` 通过；默认 `npm run test:runtime-stores` 通过 8 个本地子测试且 Postgres 子项按本地库不可达 skip；使用隔离临时 Docker Postgres `ploykit-outbox-store-split-postgres`（`127.0.0.1:55446`，验证后删除）串行执行 `npm run test:runtime-stores` 10/10 通过且 0 skipped，再执行 `npm run runtime:stores:verify` 通过，29/29 migration applied、`indexAudit.required=51`、`present=51`、`missing=[]`，其中 outbox 领域索引 3/3 present。
- 已完成（2026-06-15 本轮实施）：Postgres runtime store 的 worker 领域已从 `postgres-runtime-store.ts` 抽到 `src/lib/module-runtime/stores/postgres-runtime-store-workers.ts`，独立承载 worker heartbeat upsert 与 worker registry list；主 store 通过 `createPostgresWorkerStore({ database, createId })` 组合该领域 repository，保持 `RuntimeStore` 对外契约不变。
- 完成证据：`postgres-runtime-store.ts` 从 2694 行继续降到 2633 行，新增 `postgres-runtime-store-workers.ts` 83 行；`npm run typecheck` 通过；默认 `npm run test:runtime-stores` 通过 8 个本地子测试且 Postgres 子项按本地库不可达 skip；使用隔离临时 Docker Postgres `ploykit-worker-store-split-postgres`（`127.0.0.1:55447`，验证后删除）串行执行 `npm run test:runtime-stores` 10/10 通过且 0 skipped，再执行 `npm run runtime:stores:verify` 通过，29/29 migration applied、`indexAudit.required=51`、`present=51`、`missing=[]`，其中 worker 领域索引 3/3 present。
- 已完成（2026-06-15 本轮实施）：Postgres runtime store 的 provider invocation 领域已从 `postgres-runtime-store.ts` 抽到 `src/lib/module-runtime/stores/postgres-runtime-store-provider-invocations.ts`，独立承载 provider invocation ledger 记录与查询；主 store 通过 `createPostgresProviderInvocationStore({ database, createId })` 组合该领域 repository，保持 `RuntimeStore` 对外契约不变。
- 完成证据：`postgres-runtime-store.ts` 从 2633 行继续降到 2574 行，新增 `postgres-runtime-store-provider-invocations.ts` 87 行；`npm run typecheck` 通过；默认 `npm run test:runtime-stores` 通过 8 个本地子测试且 Postgres 子项按本地库不可达 skip；使用隔离临时 Docker Postgres `ploykit-provider-store-split-postgres`（`127.0.0.1:55448`，验证后删除）串行执行 `npm run test:runtime-stores` 10/10 通过且 0 skipped，再执行 `npm run runtime:stores:verify` 通过，29/29 migration applied、`indexAudit.required=51`、`present=51`、`missing=[]`，其中 provider 领域索引 3/3 present。
- 已完成（2026-06-15 本轮实施）：Postgres runtime store 的 audit 领域已从 `postgres-runtime-store.ts` 抽到 `src/lib/module-runtime/stores/postgres-runtime-store-audit.ts`，独立承载 audit envelope/hash 写入与 audit log 查询；主 store 通过 `createPostgresAuditStore({ database, createId })` 组合该领域 repository，保持 `RuntimeStore` 对外契约不变。
- 完成证据：`postgres-runtime-store.ts` 从 2574 行继续降到 2507 行，新增 `postgres-runtime-store-audit.ts` 88 行；`npm run typecheck` 通过；默认 `npm run test:runtime-stores` 通过 8 个本地子测试且 Postgres 子项按本地库不可达 skip；使用隔离临时 Docker Postgres `ploykit-audit-store-split-postgres`（`127.0.0.1:55449`，验证后删除）串行执行 `npm run test:runtime-stores` 10/10 通过且 0 skipped，再执行 `npm run runtime:stores:verify` 通过，29/29 migration applied、`indexAudit.required=51`、`present=51`、`missing=[]`。
- 已完成（2026-06-15 本轮实施）：Postgres runtime store 的 files 领域已从 `postgres-runtime-store.ts` 抽到 `src/lib/module-runtime/stores/postgres-runtime-store-files.ts`，独立承载 file metadata create/get/update/list；主 store 通过 `createPostgresFileStore({ database, createId })` 组合该领域 repository，保持 `RuntimeStore` 对外契约不变。
- 完成证据：`postgres-runtime-store.ts` 从 2507 行继续降到 2413 行，新增 `postgres-runtime-store-files.ts` 118 行；`npm run typecheck` 通过；默认 `npm run test:runtime-stores` 通过 8 个本地子测试且 Postgres 子项按本地库不可达 skip；使用隔离临时 Docker Postgres `ploykit-files-store-split-postgres`（`127.0.0.1:55450`，验证后删除）串行执行 `npm run test:runtime-stores` 10/10 通过且 0 skipped，再执行 `npm run runtime:stores:verify` 通过，29/29 migration applied、`indexAudit.required=51`、`present=51`、`missing=[]`。
- 已完成（2026-06-15 本轮实施）：Postgres runtime store 的 identity 领域已从 `postgres-runtime-store.ts` 抽到 `src/lib/module-runtime/stores/postgres-runtime-store-identity.ts`，独立承载 API keys 与 host users 的 create/read/list/update 路径；主 store 通过 `createPostgresIdentityStore({ database, createId })` 组合该领域 repository，保持 `RuntimeStore` 对外契约不变。
- 完成证据：`postgres-runtime-store.ts` 从 2413 行继续降到 2231 行，新增 `postgres-runtime-store-identity.ts` 213 行；`tests/runtime-stores.test.ts` 补充 Postgres API key/host user 持久化断言，并将 `module_api_keys` 纳入 reset；`npm run typecheck` 通过；默认 `npm run test:runtime-stores` 通过 8 个本地子测试且 Postgres 子项按本地库不可达 skip；使用隔离临时 Docker Postgres `ploykit-identity-store-split-postgres`（`127.0.0.1:55451`，验证后删除）串行执行 `npm run test:runtime-stores` 10/10 通过且 0 skipped，再执行 `npm run runtime:stores:verify` 通过，29/29 migration applied、`indexAudit.required=51`、`present=51`、`missing=[]`，其中 identity 领域索引 3/3 present。
- 已完成（2026-06-15 本轮实施）：Postgres runtime store 的 commercial catalog/orders 子域已从 `postgres-runtime-store.ts` 抽到 `src/lib/module-runtime/stores/postgres-runtime-store-commercial-orders.ts`，独立承载 catalog item upsert/list、commercial order create/read/provider ref/idempotency/status/list；主 store 通过 `createPostgresCommercialOrderStore({ database, createId })` 组合该领域 repository，保持 `RuntimeStore` 对外契约不变。
- 完成证据：`postgres-runtime-store.ts` 从 2231 行继续降到 2066 行，新增 `postgres-runtime-store-commercial-orders.ts` 202 行；`npm run typecheck` 通过；默认 `npm run test:runtime-stores` 通过 8 个本地子测试且 Postgres 子项按本地库不可达 skip；默认 `npm run test:commercial-postgres` 按本地库不可达 skip；使用隔离临时 Docker Postgres `ploykit-commercial-orders-store-split-postgres`（`127.0.0.1:55452`，验证后删除）串行执行 `npm run test:runtime-stores` 10/10 通过、`npm run test:commercial-postgres` 1/1 通过，再执行 `npm run runtime:stores:verify` 通过，29/29 migration applied、`indexAudit.required=51`、`present=51`、`missing=[]`，其中 commercial 领域索引 29/29 present。
- 已完成（2026-06-15 本轮实施）：Postgres runtime store 的 commercial billing documents 子域已从 `postgres-runtime-store.ts` 抽到 `src/lib/module-runtime/stores/postgres-runtime-store-commercial-billing.ts`，独立承载 billing accounts、invoices 与 credit notes 的 upsert/list/idempotency/conflict 路径；主 store 通过 `createPostgresCommercialBillingStore({ database, createId })` 组合该领域 repository，保持 `RuntimeStore` 对外契约不变。
- 完成证据：`postgres-runtime-store.ts` 从 2066 行继续降到 1805 行，新增 `postgres-runtime-store-commercial-billing.ts` 296 行；`npm run typecheck` 通过；默认 `npm run test:runtime-stores` 通过 8 个本地子测试且 Postgres 子项按本地库不可达 skip；默认 `npm run test:commercial-postgres` 按本地库不可达 skip；使用隔离临时 Docker Postgres `ploykit-commercial-billing-store-split-postgres`（`127.0.0.1:55453`，验证后删除）串行执行 `npm run test:runtime-stores` 10/10 通过、`npm run test:commercial-postgres` 1/1 通过，再执行 `npm run runtime:stores:verify` 通过，29/29 migration applied、`indexAudit.required=51`、`present=51`、`missing=[]`，其中 commercial 领域索引 29/29 present。
- 已完成（2026-06-15 本轮实施）：Postgres runtime store 的 commercial subscriptions/events 子域已从 `postgres-runtime-store.ts` 抽到 `src/lib/module-runtime/stores/postgres-runtime-store-commercial-subscriptions.ts`，独立承载 subscription upsert/list 与 subscription event create/list/idempotency 路径；主 store 通过 `createPostgresCommercialSubscriptionStore({ database, createId })` 组合该领域 repository，保持 `RuntimeStore` 对外契约不变。
- 完成证据：`postgres-runtime-store.ts` 从 1805 行继续降到 1680 行，新增 `postgres-runtime-store-commercial-subscriptions.ts` 152 行；`npm run typecheck` 通过；默认 `npm run test:runtime-stores` 通过 8 个本地子测试且 Postgres 子项按本地库不可达 skip；默认 `npm run test:commercial-postgres` 按本地库不可达 skip；使用隔离临时 Docker Postgres `ploykit-commercial-subscriptions-store-split-postgres`（`127.0.0.1:55454`，验证后删除）串行执行 `npm run test:runtime-stores` 10/10 通过、`npm run test:commercial-postgres` 1/1 通过，再执行 `npm run runtime:stores:verify` 通过，29/29 migration applied、`indexAudit.required=51`、`present=51`、`missing=[]`，其中 commercial 领域索引 29/29 present。
- 已完成（2026-06-15 本轮实施）：Postgres runtime store 的 commercial tax profiles 子域已从 `postgres-runtime-store.ts` 抽到 `src/lib/module-runtime/stores/postgres-runtime-store-commercial-tax.ts`，独立承载 tax profile upsert/get 与 workspace scope 路径；主 store 通过 `createPostgresCommercialTaxStore({ database, createId })` 组合该领域 repository，保持 `RuntimeStore` 对外契约不变。
- 完成证据：`postgres-runtime-store.ts` 从 1680 行继续降到 1639 行，新增 `postgres-runtime-store-commercial-tax.ts` 63 行；`npm run typecheck` 通过；默认 `npm run test:runtime-stores` 通过 8 个本地子测试且 Postgres 子项按本地库不可达 skip；默认 `npm run test:commercial-postgres` 按本地库不可达 skip；使用隔离临时 Docker Postgres `ploykit-commercial-tax-store-split-postgres`（`127.0.0.1:55455`，验证后删除）串行执行 `npm run test:runtime-stores` 10/10 通过、`npm run test:commercial-postgres` 1/1 通过，再执行 `npm run runtime:stores:verify` 通过，29/29 migration applied、`indexAudit.required=51`、`present=51`、`missing=[]`，其中 commercial 领域索引 29/29 present。
- 已完成（2026-06-15 本轮实施）：Postgres runtime store 的 commercial revenue/settlement 子域已从 `postgres-runtime-store.ts` 抽到 `src/lib/module-runtime/stores/postgres-runtime-store-commercial-revenue.ts`，独立承载 revenue bucket upsert/list 与 settlement batch upsert/list 路径；主 store 通过 `createPostgresCommercialRevenueStore({ database, createId })` 组合该领域 repository，保持 `RuntimeStore` 对外契约不变。
- 完成证据：`postgres-runtime-store.ts` 从 1639 行继续降到 1510 行，新增 `postgres-runtime-store-commercial-revenue.ts` 150 行；`npm run typecheck` 通过；默认 `npm run test:runtime-stores` 通过 8 个本地子测试且 Postgres 子项按本地库不可达 skip；默认 `npm run test:commercial-postgres` 按本地库不可达 skip；使用隔离临时 Docker Postgres `ploykit-commercial-revenue-store-split-postgres`（`127.0.0.1:55456`，验证后删除）串行执行 `npm run test:runtime-stores` 10/10 通过、`npm run test:commercial-postgres` 1/1 通过，再执行 `npm run runtime:stores:verify` 通过，29/29 migration applied、`indexAudit.required=51`、`present=51`、`missing=[]`，其中 commercial 领域索引 29/29 present。
- 已完成（2026-06-15 本轮实施）：Postgres runtime store 的 commercial credits/reservations 子域已从 `postgres-runtime-store.ts` 抽到 `src/lib/module-runtime/stores/postgres-runtime-store-commercial-credits.ts`，独立承载 credit ledger record/list/balance、transactional consume 与 credit reservation create/read/update/list 路径；主 store 通过 `createPostgresCommercialCreditStore({ database, createId })` 组合该领域 repository，保持 `RuntimeStore` 对外契约不变。
- 完成证据：`postgres-runtime-store.ts` 从 1510 行继续降到 1286 行，新增 `postgres-runtime-store-commercial-credits.ts` 251 行；`npm run typecheck` 通过；默认 `npm run test:runtime-stores` 通过 8 个本地子测试且 Postgres 子项按本地库不可达 skip；默认 `npm run test:commercial-postgres` 按本地库不可达 skip；使用隔离临时 Docker Postgres `ploykit-commercial-credits-store-split-postgres`（`127.0.0.1:55457`，验证后删除）串行执行 `npm run test:runtime-stores` 10/10 通过、`npm run test:commercial-postgres` 1/1 通过，再执行 `npm run runtime:stores:verify` 通过，29/29 migration applied、`indexAudit.required=51`、`present=51`、`missing=[]`，其中 commercial 领域索引 29/29 present。
- 已完成（2026-06-15 本轮实施）：Postgres runtime store 的 commercial entitlements 子域已从 `postgres-runtime-store.ts` 抽到 `src/lib/module-runtime/stores/postgres-runtime-store-commercial-entitlements.ts`，独立承载 entitlement grant/list/revoke/override 路径；主 store 通过 `createPostgresCommercialEntitlementStore({ database, createId })` 组合该领域 repository，保持 `RuntimeStore` 对外契约不变。
- 完成证据：`postgres-runtime-store.ts` 从 1286 行继续降到 1207 行，新增 `postgres-runtime-store-commercial-entitlements.ts` 106 行；`npm run typecheck` 通过；默认 `npm run test:runtime-stores` 通过 8 个本地子测试且 Postgres 子项按本地库不可达 skip；默认 `npm run test:commercial-postgres` 按本地库不可达 skip；使用隔离临时 Docker Postgres `ploykit-commercial-entitlements-store-split-postgres`（`127.0.0.1:55458`，验证后删除）串行执行 `npm run test:runtime-stores` 10/10 通过、`npm run test:commercial-postgres` 1/1 通过，再执行 `npm run runtime:stores:verify` 通过，29/29 migration applied、`indexAudit.required=51`、`present=51`、`missing=[]`，其中 commercial 领域索引 29/29 present。
- 已完成（2026-06-15 本轮实施）：Postgres runtime store 的 commercial redeem 子域已从 `postgres-runtime-store.ts` 抽到 `src/lib/module-runtime/stores/postgres-runtime-store-commercial-redeem.ts`，独立承载 redeem code upsert/read/status/list 与 redemption record/list 路径；主 store 通过 `createPostgresCommercialRedeemStore({ database, createId })` 组合该领域 repository，保持 `RuntimeStore` 对外契约不变。
- 完成证据：`postgres-runtime-store.ts` 从 1207 行继续降到 1109 行，新增 `postgres-runtime-store-commercial-redeem.ts` 125 行；`npm run typecheck` 通过；默认 `npm run test:runtime-stores` 通过 8 个本地子测试且 Postgres 子项按本地库不可达 skip；默认 `npm run test:commercial-postgres` 按本地库不可达 skip；使用隔离临时 Docker Postgres `ploykit-commercial-redeem-store-split-postgres`（`127.0.0.1:55459`，验证后删除）串行执行 `npm run test:runtime-stores` 10/10 通过、`npm run test:commercial-postgres` 1/1 通过，再执行 `npm run runtime:stores:verify` 通过，29/29 migration applied、`indexAudit.required=51`、`present=51`、`missing=[]`，其中 commercial 领域索引 29/29 present。
- 已完成（2026-06-15 本轮实施）：Postgres runtime store 的 RAG 子域已从 `postgres-runtime-store.ts` 抽到 `src/lib/module-runtime/stores/postgres-runtime-store-rag.ts`，独立承载 RAG source upsert/list、chunk upsert/list 与 chunk delete by id/source 路径；主 store 通过 `createPostgresRagStore({ database })` 组合该领域 repository，保持 `RuntimeStore` 对外契约不变。
- 完成证据：`postgres-runtime-store.ts` 从 1109 行继续降到 969 行，新增 `postgres-runtime-store-rag.ts` 164 行；`npm run typecheck` 通过；默认 `npm run test:runtime-stores` 通过 8 个本地子测试且 Postgres 子项按本地库不可达 skip；默认 `npm run test:commercial-postgres` 按本地库不可达 skip；使用隔离临时 Docker Postgres `ploykit-rag-store-split-postgres`（`127.0.0.1:55460`，验证后删除）串行执行 `npm run test:runtime-stores` 10/10 通过、`npm run test:commercial-postgres` 1/1 通过，再执行 `npm run runtime:stores:verify` 通过，29/29 migration applied、`indexAudit.required=51`、`present=51`、`missing=[]`，其中 RAG 领域索引 4/4 present。
- 已完成（2026-06-15 本轮实施）：Postgres runtime store 的 risk 子域已从 `postgres-runtime-store.ts` 抽到 `src/lib/module-runtime/stores/postgres-runtime-store-risk.ts`，独立承载 risk event record/list 与 risk block upsert/list 路径；主 store 通过 `createPostgresRiskStore({ database, createId })` 组合该领域 repository，保持 `RuntimeStore` 对外契约不变。
- 完成证据：`postgres-runtime-store.ts` 从 969 行继续降到 861 行，新增 `postgres-runtime-store-risk.ts` 129 行；`npm run typecheck` 通过；默认 `npm run test:runtime-stores` 通过 8 个本地子测试且 Postgres 子项按本地库不可达 skip；默认 `npm run test:commercial-postgres` 按本地库不可达 skip；使用隔离临时 Docker Postgres `ploykit-risk-store-split-postgres`（`127.0.0.1:55461`，验证后删除）串行执行 `npm run test:runtime-stores` 10/10 通过、`npm run test:commercial-postgres` 1/1 通过，再执行 `npm run runtime:stores:verify` 通过，29/29 migration applied、`indexAudit.required=51`、`present=51`、`missing=[]`，其中 risk 领域索引 3/3 present。
- 已完成（2026-06-15 本轮实施）：Postgres runtime store 的 config/resource 子域已从 `postgres-runtime-store.ts` 抽到 `src/lib/module-runtime/stores/postgres-runtime-store-config.ts`，独立承载 host settings、service connections 与 resource bindings 的 upsert/get/list/touch 路径；主 store 通过 `createPostgresConfigStore({ database })` 组合该领域 repository，保持 `RuntimeStore` 对外契约不变。
- 完成证据：`postgres-runtime-store.ts` 从 861 行继续降到 629 行，新增 `postgres-runtime-store-config.ts` 264 行；`npm run typecheck` 通过；默认 `npm run test:runtime-stores` 通过 8 个本地子测试且 Postgres 子项按本地库不可达 skip；默认 `npm run test:commercial-postgres` 按本地库不可达 skip；使用隔离临时 Docker Postgres `ploykit-config-store-split-postgres`（`127.0.0.1:55462`，验证后删除）串行执行 `npm run test:runtime-stores` 10/10 通过、`npm run test:commercial-postgres` 1/1 通过，再执行 `npm run runtime:stores:verify` 通过，29/29 migration applied、`indexAudit.required=51`、`present=51`、`missing=[]`，其中 settings 领域索引 1/1 present、provider 领域索引 3/3 present。
- 已完成（2026-06-15 本轮实施）：Postgres runtime store 的 product scope 子域已从 `postgres-runtime-store.ts` 抽到 `src/lib/module-runtime/stores/postgres-runtime-store-product-scope.ts`，独立承载 memberships、products、workspaces、domain aliases 与 invites 的 upsert/list 路径；主 store 通过 `createPostgresProductScopeStore({ database })` 组合该领域 repository，保持 `RuntimeStore` 对外契约不变。
- 完成证据：`postgres-runtime-store.ts` 从 629 行继续降到 464 行，新增 `postgres-runtime-store-product-scope.ts` 193 行；`npm run typecheck` 通过；默认 `npm run test:runtime-stores` 通过 8 个本地子测试且 Postgres 子项按本地库不可达 skip；默认 `npm run test:commercial-postgres` 按本地库不可达 skip；使用隔离临时 Docker Postgres `ploykit-product-scope-store-split-postgres`（`127.0.0.1:55463`，验证后删除）串行执行 `npm run test:runtime-stores` 10/10 通过、`npm run test:commercial-postgres` 1/1 通过，再执行 `npm run runtime:stores:verify` 通过，29/29 migration applied、`indexAudit.required=51`、`present=51`、`missing=[]`。
- 已完成（2026-06-15 本轮实施）：Postgres runtime store 的 catalog state 子域已从 `postgres-runtime-store.ts` 抽到 `src/lib/module-runtime/stores/postgres-runtime-store-catalog.ts`，独立承载 catalog module state 的 upsert/list 路径；主 store 通过 `createPostgresCatalogStore({ database })` 组合该领域 repository，保持 `RuntimeStore` 对外契约不变。
- 完成证据：`postgres-runtime-store.ts` 从 464 行继续降到 428 行，新增 `postgres-runtime-store-catalog.ts` 53 行；`npm run typecheck` 通过；默认 `npm run test:runtime-stores` 通过 8 个本地子测试且 Postgres 子项按本地库不可达 skip；默认 `npm run test:commercial-postgres` 按本地库不可达 skip；使用隔离临时 Docker Postgres `ploykit-catalog-store-split-postgres`（`127.0.0.1:55464`，验证后删除）串行执行 `npm run test:runtime-stores` 10/10 通过、`npm run test:commercial-postgres` 1/1 通过，再执行 `npm run runtime:stores:verify` 通过，29/29 migration applied、`indexAudit.required=51`、`present=51`、`missing=[]`。
- 已完成（2026-06-15 本轮实施）：Postgres runtime store 的 webhooks receipt 子域已从 `postgres-runtime-store.ts` 抽到 `src/lib/module-runtime/stores/postgres-runtime-store-webhooks.ts`，独立承载 webhook receipt create/find/mark/list 路径；主 store 通过 `createPostgresWebhookStore({ database, createId })` 组合该领域 repository，保持 `RuntimeStore` 对外契约不变。
- 完成证据：`postgres-runtime-store.ts` 从 428 行继续降到 358 行，新增 `postgres-runtime-store-webhooks.ts` 91 行；`npm run typecheck` 通过；默认 `npm run test:runtime-stores` 通过 8 个本地子测试且 Postgres 子项按本地库不可达 skip；默认 `npm run test:commercial-postgres` 按本地库不可达 skip；使用隔离临时 Docker Postgres `ploykit-webhook-store-split-postgres`（`127.0.0.1:55465`，验证后删除）串行执行 `npm run test:runtime-stores` 10/10 通过、`npm run test:commercial-postgres` 1/1 通过，再执行 `npm run runtime:stores:verify` 通过，29/29 migration applied、`indexAudit.required=51`、`present=51`、`missing=[]`，其中 webhooks 领域索引 1/1 present。
- 已完成（2026-06-16 本轮实施）：webhook receipt repository 的 idempotency scope 已补齐 workspace/null workspace 维度；`findWebhookReceiptByIdempotencyKey`、`createWebhookReceipt` conflict target、memory idempotency map 与 runtime-store webhook gateway 均使用 product/workspace/module/webhook/key，`RUNTIME_STORE_REQUIRED_INDEXES` 新增 `module_webhook_receipts_idempotency_idx` required audit。
- 完成证据：新增 `tests/runtime-stores.test.ts` webhook receipt workspace-scoped idempotency 子项；默认 `npm run test:runtime-stores` 11 个子测试通过（Postgres 2 项按默认库不可达 skip）；隔离临时 Docker Postgres `ploykit-webhook-idempotency-postgres`（`127.0.0.1:55466`，验证后删除）下 `npm run test:runtime-stores` 11/11、`npm run runtime:stores:verify` 通过，30/30 migrations applied、webhooks index audit 2/2 present。
- 已完成（2026-06-15 本轮实施）：Postgres runtime store 的 notifications 子域已从 `postgres-runtime-store.ts` 抽到 `src/lib/module-runtime/stores/postgres-runtime-store-notifications.ts`，独立承载 notification create/list/read、bulk read 与 delivery record/list 路径；主 store 通过 `createPostgresNotificationStore({ database, createId })` 组合该领域 repository，保持 `RuntimeStore` 对外契约不变。
- 完成证据：`postgres-runtime-store.ts` 从 358 行继续降到 206 行，新增 `postgres-runtime-store-notifications.ts` 177 行；`npm run typecheck` 通过；默认 `npm run test:runtime-stores` 通过 8 个本地子测试且 Postgres 子项按本地库不可达 skip；默认 `npm run test:commercial-postgres` 按本地库不可达 skip；使用隔离临时 Docker Postgres `ploykit-notifications-store-split-postgres`（`127.0.0.1:55466`，验证后删除）串行执行 `npm run test:runtime-stores` 10/10 通过、`npm run test:commercial-postgres` 1/1 通过，再执行 `npm run runtime:stores:verify` 通过，29/29 migration applied、`indexAudit.required=51`、`present=51`、`missing=[]`。
- 已完成（2026-06-15 本轮实施）：Postgres runtime store 的 usage/metering 子域已从 `postgres-runtime-store.ts` 抽到 `src/lib/module-runtime/stores/postgres-runtime-store-metering.ts`，独立承载 usage record/list 与 metering record/get/status/list 路径；主 store 通过 `createPostgresMeteringStore({ database, createId })` 组合该领域 repository，保持 `RuntimeStore` 对外契约不变。
- 完成证据：`postgres-runtime-store.ts` 从 206 行继续降到 94 行，新增 `postgres-runtime-store-metering.ts` 122 行；`npm run typecheck` 通过；默认 `npm run test:runtime-stores` 通过 8 个本地子测试且 Postgres 子项按本地库不可达 skip；默认 `npm run test:commercial-postgres` 按本地库不可达 skip；使用隔离临时 Docker Postgres `ploykit-metering-store-split-postgres`（`127.0.0.1:55467`，验证后删除）串行执行 `npm run test:runtime-stores` 10/10 通过、`npm run test:commercial-postgres` 1/1 通过，再执行 `npm run runtime:stores:verify` 通过，29/29 migration applied、`indexAudit.required=51`、`present=51`、`missing=[]`。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/lib/admin-module-dev-console.ts` 承担 module dev-console view、module:test report 读取、diagnostics 聚合、developer platform report 与 bundle manifest 组装；`apps/host-next/app/[lang]/admin/module-dev-console/page.tsx` 和 `tests/web-shell.test.ts` 改为直接导入新 helper，`admin-operations.ts` 只保留 type-only 兼容导出，避免运行时回流到大聚合文件。
- 完成证据：该子项完成时 `admin-operations.ts` 从 1029 行降到 886 行，随后 module operations 子项继续降到 39 行兼容壳；`apps/host-next/lib/admin-module-dev-console.ts` 新增 152 行独立 helper；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "K1"` 实际执行 75/75 个 Web Shell 子测试并全部通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/lib/admin-module-operations.ts` 承担 Admin module operations view、module detail、module status mutation 和 module map health/host snapshot 组装；`apps/host-next/lib/admin-operations.ts` 降为 39 行兼容壳；Admin 页面、`admin-api.ts`、Web Shell 测试和 files smoke 脚本运行期调用已改为直接进入对应领域 helper。
- 完成证据：`admin-module-operations.ts` 当前 859 行，`admin-operations.ts` 当前 39 行；仓库内页面、测试和脚本不再直接 import `admin-operations.ts`；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X10|K5|K4 host security"` 实际执行 75/75 个 Web Shell 子测试并全部通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/lib/admin-module-operation-model.ts` 承担 module capability/product/risk summary、runtime state、module row builder 与 module diagnostics 过滤；`apps/host-next/lib/admin-module-operations.ts` 收缩为 store 读取、module detail 映射、status mutation 和 host snapshot 组装。
- 完成证据：`admin-module-operations.ts` 从 859 行降到 434 行，新增 `admin-module-operation-model.ts` 456 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X10|K5|K4 host security"` 实际执行 75/75 个 Web Shell 子测试并全部通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/lib/admin-worker-operations.ts` 承担 Admin worker runtime status 与 drain 操作边界；`apps/host-next/app/[lang]/admin/webhooks/page.tsx` 不再直接导入底层 `@host/lib/worker`，`AdminWebhooksOperationsPage` 的 worker 类型改为复用 Admin 领域 helper 导出的 `AdminWorkerRuntimeStatus`。
- 完成证据：新增 `admin-worker-operations.ts` 33 行；`rg -n "@host/lib/worker|drainHostWorker|getHostWorkerStatus" apps/host-next/app/[lang]/admin apps/host-next/components/admin apps/host-next/lib -g "*.ts" -g "*.tsx"` 显示 Admin 页面/组件不再直连底层 worker，仅 Admin 领域 helper、config doctor 和底层 worker 文件保留调用；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X11 admin worker status|M6 host worker|X8 admin dead-letter"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/lib/admin-worker-evidence.ts` 承担 worker soak `latest.json` 解析、缺失 evidence 默认值和 soak summary 归一化；`apps/host-next/lib/admin-worker-readiness.ts` 承担 heartbeat age/status、overall readiness 和 action 建议；`apps/host-next/lib/admin-worker-status.ts` 收缩为 live status、soak evidence、readiness presenter 与脱敏结果的最终组装，并保留 worker evidence/readiness 类型再导出兼容。
- 完成证据：`admin-worker-status.ts` 从 188 行降到 64 行，新增 `admin-worker-evidence.ts` 86 行与 `admin-worker-readiness.ts` 61 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X11 admin worker status|M6 host worker|X8 admin dead-letter"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/operations/WebhookPageModel.ts` 承担 Admin Webhooks 列表页的 table query 清洗、outbox/receipt 过滤、outbox kind 分桶、bulk preview row、worker alert tone、批量按钮 disabled 状态和 delivery review item 组装；`WebhookPages.tsx` 保持对外页面导出不变，列表页主体转为使用 `buildAdminWebhooksPageModel(...)`。
- 完成证据：`WebhookPages.tsx` 从 1114 行降到 1041 行，新增 `WebhookPageModel.ts` 198 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X8 admin dead-letter|X11 admin worker status|M6 host worker"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过；`git diff --check -- apps/host-next/components/admin/pages/operations/WebhookPageModel.ts apps/host-next/components/admin/pages/operations/WebhookPages.tsx` 无输出。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/operations/WebhookWorkerPanels.tsx` 承担 Admin Webhooks 列表页 worker status、bulk action、worker drain scope 与 queue pulse 三组展示；`WebhookPages.tsx` 只传入 page model 输出和 action handler，保持 `AdminWebhooksOperationsPage` 对外 props 不变。
- 完成证据：`WebhookPages.tsx` 从 1041 行降到 831 行，新增 `WebhookWorkerPanels.tsx` 271 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X8 admin dead-letter|X11 admin worker status|M6 host worker"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/operations/WebhookDeliveryTables.tsx` 承担 Admin Webhooks 列表页 delivery lanes、filter bar、outbox/receipt records table 与 compact row actions；`WebhookPages.tsx` 只保留页面统计、delivery review、page model、worker panels、delivery tables 和 detail 页面 wiring，保持 `AdminWebhooksOperationsPage` 对外 props 不变。
- 完成证据：`WebhookPages.tsx` 从 831 行降到 539 行，新增 `WebhookDeliveryTables.tsx` 341 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X8 admin dead-letter|X11 admin worker status|M6 host worker"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过；`git diff --check -- apps/host-next/components/admin/pages/operations/WebhookDeliveryTables.tsx apps/host-next/components/admin/pages/operations/WebhookPages.tsx docs/production-grade-code-analysis-2026-06-14.zh-CN.md` 无输出。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/operations/WebhookDetailActions.tsx` 承担 Admin Webhook detail 页 retry、discard、archive 三组 action form、disabled 状态和 confirm 文案；`WebhookPages.tsx` 只传入 outbox 与 action handlers，保持 `AdminWebhookDetailOperationsPage` 对外 props 不变。
- 完成证据：`WebhookPages.tsx` 从 539 行降到 469 行，新增 `WebhookDetailActions.tsx` 88 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X8 admin dead-letter|X11 admin worker status|M6 host worker"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过；`git diff --check -- apps/host-next/components/admin/pages/operations/WebhookPages.tsx apps/host-next/components/admin/pages/operations/WebhookDetailActions.tsx docs/production-grade-code-analysis-2026-06-14.zh-CN.md` 无输出。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/operations/WebhookDetailEvidence.tsx` 承担 Admin Webhook detail 页 related operations、payload/metadata/error redacted evidence 与相关 outbox kind/link 组装；`WebhookPages.tsx` 只传入 outbox，保持 `AdminWebhookDetailOperationsPage` 对外 props 不变。
- 完成证据：`WebhookPages.tsx` 从 469 行降到 374 行，新增 `WebhookDetailEvidence.tsx` 111 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X8 admin dead-letter|X11 admin worker status|M6 host worker"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过；`git diff --check -- apps/host-next/components/admin/pages/operations/WebhookPages.tsx apps/host-next/components/admin/pages/operations/WebhookDetailEvidence.tsx docs/production-grade-code-analysis-2026-06-14.zh-CN.md` 无输出。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/operations/WebhookDetailTables.tsx` 承担 Admin Webhook detail 页 receipt retry table、delivery ledger table 与 audit timeline；`WebhookPages.tsx` 只传入 detail/outbox 和 receipt retry action，保持 `AdminWebhookDetailOperationsPage` 对外 props 不变。
- 完成证据：`WebhookPages.tsx` 从 374 行降到 251 行，新增 `WebhookDetailTables.tsx` 138 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X8 admin dead-letter|X11 admin worker status|M6 host worker"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过；`git diff --check -- apps/host-next/components/admin/pages/operations/WebhookPages.tsx apps/host-next/components/admin/pages/operations/WebhookDetailTables.tsx docs/production-grade-code-analysis-2026-06-14.zh-CN.md` 无输出。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/operations/WebhookDetailDrawer.tsx` 承担 Admin Webhook detail 页 outbox snapshot drawer、Copy ID 和 FactList；`WebhookPages.tsx` 只传入 outbox，保持 `AdminWebhookDetailOperationsPage` 对外 props 不变。
- 完成证据：`WebhookPages.tsx` 从 251 行降到 221 行，新增 `WebhookDetailDrawer.tsx` 42 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X8 admin dead-letter|X11 admin worker status|M6 host worker"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过；`git diff --check -- apps/host-next/components/admin/pages/operations/WebhookPages.tsx apps/host-next/components/admin/pages/operations/WebhookDetailDrawer.tsx docs/production-grade-code-analysis-2026-06-14.zh-CN.md` 无输出。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/operations/ServiceConnectionsPages.tsx` 承担 Admin service connections 页面主体、provider readiness、config diagnostics、connection table 与 maintenance forms；`OperationsPages.tsx` 只保留 service-connections/runs/webhooks 兼容转发导出。
- 完成证据：`OperationsPages.tsx` 从 1192 行降到 3 行，新增 `ServiceConnectionsPages.tsx` 1190 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "A4 service connection|X11 admin provider status|X11 config doctor|K4 host security"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/operations/ServiceConnectionEvidencePanels.tsx` 承担 Admin service connections 页 provider readiness、connection call timeline 与 config diagnostics evidence panels；`ServiceConnectionsPages.tsx` 只传入 `lang` 和 `connections`，保持 `AdminServiceConnectionsOperationsPage` 对外 props 不变。
- 完成证据：`ServiceConnectionsPages.tsx` 从 1190 行降到 1125 行，新增 `ServiceConnectionEvidencePanels.tsx` 83 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "A4 service connection|X11 admin provider status|X11 config doctor|K4 host security"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/operations/ServiceConnectionMaintenancePanel.tsx` 承担 Admin service connections 页 create connection、update policy、secret rotation wizard 与 call log retention 四组 maintenance forms；`ServiceConnectionsPages.tsx` 只传入 `lang`、`connections` 和四个 action，保持 `AdminServiceConnectionsOperationsPage` 对外 props 不变。
- 完成证据：`ServiceConnectionsPages.tsx` 从 1125 行降到 667 行，新增 `ServiceConnectionMaintenancePanel.tsx` 382 行，并清理旧聚合遗留的无用 imports/types；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "A4 service connection|X11 admin provider status|X11 config doctor|K4 host security"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/operations/ServiceConnectionCreateForm.tsx` 承担 create connection form；`ServiceConnectionPolicyForm.tsx` 承担 policy update form；`ServiceConnectionSecretRotationForm.tsx` 承担 secret rotation wizard；`ServiceConnectionRetentionForm.tsx` 承担 call log retention form；`ServiceConnectionMaintenanceModel.ts` 承担共享 form action 类型；`ServiceConnectionMaintenancePanel.tsx` 只保留折叠区、action 开关与子表单 wiring，`AdminServiceConnectionsOperationsPage` 对外 props 不变。
- 完成证据：`ServiceConnectionMaintenancePanel.tsx` 从 388 行降到 67 行，新增 `ServiceConnectionCreateForm.tsx` 140 行、`ServiceConnectionPolicyForm.tsx` 101 行、`ServiceConnectionSecretRotationForm.tsx` 89 行、`ServiceConnectionRetentionForm.tsx` 54 行与 `ServiceConnectionMaintenanceModel.ts` 1 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "A4 service connection|X11 admin provider status|X11 config doctor|K4 host security"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/operations/ServiceConnectionTableSection.tsx` 承担 Admin service connections 页 table query form、advanced filters、desktop DataTable、mobile list 与 row actions；`ServiceConnectionsPages.tsx` 只传入 table model 输出、actions 和 option lists，保持 `AdminServiceConnectionsOperationsPage` 对外 props 不变。
- 完成证据：`ServiceConnectionsPages.tsx` 从 667 行降到 380 行，新增 `ServiceConnectionTableSection.tsx` 341 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "A4 service connection|X11 admin provider status|X11 config doctor|K4 host security"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/operations/ServiceConnectionDetailPanels.tsx` 承担 Admin service connections 页 focus connection drawer、FactList、runs/jobs/webhooks/audit/settings links 与 related operations；`ServiceConnectionsPages.tsx` 只保留 summary、review queue、focus connection 选择、maintenance/table/evidence 子组件 wiring，`AdminServiceConnectionsOperationsPage` 对外 props 不变。
- 完成证据：`ServiceConnectionsPages.tsx` 从 382 行降到 231 行，新增 `ServiceConnectionDetailPanels.tsx` 170 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "A4 service connection|X11 admin provider status|X11 config doctor|K4 host security"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/operations/OperationsPageOptions.ts` 承担 Admin operations 共享 status/type/filter option 常量；`OperationsPageUtils.tsx` 保留 re-export 兼容既有 runs/webhooks/service connections imports，并继续承载 table query、href/search、toast、run/outbox/service helper 与小型 JSX helper。
- 完成证据：`OperationsPageUtils.tsx` 从 372 行降到 291 行，新增 `OperationsPageOptions.ts` 95 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "M6 host scoped runs|X8 admin dead-letter|M6 host worker|X11 admin worker status|K6 host worker|A4 service connection|X11 admin provider status|X11 config doctor|K4 host security"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/dashboard/pages/LandingPage.tsx` 承担 Dashboard landing 页面 summary、attention cards、billing/workspace action panels、recent notifications 与 recent orders；`DashboardPages.tsx` 保持转发导出，保持 `@host/components/dashboard/DashboardPages` 对外导出不变。
- 完成证据：`DashboardPages.tsx` 从 1077 行降到 817 行，新增 `LandingPage.tsx` 256 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "P10 host shell resolves dashboard|X2 host user APIs|X4 product scope|X4 workspace"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/dashboard/pages/ProfilePage.tsx` 承担 Dashboard profile/account 页面 overview、profile form、password change、notification preferences 与 signed-in devices；`DashboardPages.tsx` 保持转发导出，保持 `@host/components/dashboard/DashboardPages` 对外导出不变。
- 完成证据：`DashboardPages.tsx` 从 817 行降到 455 行，新增 `ProfilePage.tsx` 307 行，并清理旧聚合残留 imports/types；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "P10 host shell resolves dashboard|X2 host user APIs|X9 notifications"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/dashboard/pages/WorkspacesPage.tsx` 承担 Dashboard workspaces 页面 workspace list、member list、invitation management 与 access/domain alias 管理；`DashboardPages.tsx` 只保留 `DashboardSimplePage` 和 re-export，保持 `@host/components/dashboard/DashboardPages` 对外导出不变。
- 完成证据：`DashboardPages.tsx` 从 455 行降到 29 行，新增 `WorkspacesPage.tsx` 426 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "P10 host shell resolves dashboard|X4 product scope|X4 workspace"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/dashboard/pages/WorkspaceListSection.tsx` 承担 Dashboard workspaces 页 workspace card 列表、切换 workspace 与 create workspace panel；`WorkspaceCollaborationSection.tsx` 承担 members、invite member panel、invitation records 与 revoke action；`WorkspaceAccessSection.tsx` 承担 domain alias bind form 与 workspace/product alias cards；`WorkspacesPageModel.ts` 承担 scope/member row/action 类型；`WorkspacesPage.tsx` 只保留 synopsis、section nav 与三组 section wiring，`DashboardWorkspacesOperationsPage` 对外 props 不变。
- 完成证据：`WorkspacesPage.tsx` 从 426 行降到 132 行，新增 `WorkspaceListSection.tsx` 106 行、`WorkspaceCollaborationSection.tsx` 155 行、`WorkspaceAccessSection.tsx` 108 行与 `WorkspacesPageModel.ts` 33 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "P10 host shell resolves dashboard|X4 workspace|X4 product scope|product-scope workspaces"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/commerce/CommercePages.tsx` 清理旧聚合残留 imports/types/helpers，收缩为 billing/revenue/entitlements 兼容转发导出壳；`AdminPages` 与 `BillingPages` 对外导出不变。
- 完成证据：`CommercePages.tsx` 从 438 行降到 2 行，`BillingPages.tsx` 1831 行、`RevenuePages.tsx` 1110 行继续承载已拆页面；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X6 admin entitlement|A8 admin entitlement|A8 admin commercial|X6 host billing|A7 admin billing|M6 host commercial"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/commerce/BillingPageModel.ts` 承担 Admin billing 页 table query 归一、商业记录过滤、异常 review item、order benefit summary、order context links 与 plan/SKU 分组；`BillingPages.tsx` 保留渲染和 action wiring，`AdminBillingOperationsPage` 对外 props 不变。
- 完成证据：`BillingPages.tsx` 从 1831 行降到 1212 行，新增 `BillingPageModel.ts` 374 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X6 admin entitlement|A8 admin entitlement|A8 admin commercial|X6 host billing|A7 admin billing|M6 host commercial"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/commerce/BillingOrderModel.ts` 承担 Admin billing order benefit summary、metadata order id、order context links 与 join helper；`BillingPageModel.ts` 保留 re-export 兼容既有 `BillingOrderDetailDrawer`/ledger imports，并继续承担 table query、记录过滤、review item 与 plan/SKU 分组。
- 完成证据：`BillingPageModel.ts` 从 387 行降到 306 行，新增 `BillingOrderModel.ts` 91 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X6 admin entitlement|A8 admin entitlement|A8 admin commercial|X6 host billing|A7 admin billing|M6 host commercial"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/commerce/BillingCatalogAuthoring.tsx` 承担 Admin billing 页 catalog authoring 面板中的 plan/SKU 创建更新表单与确认提交；`BillingPages.tsx` 只保留组件调用，`AdminBillingOperationsPage` 对外 props 不变。
- 完成证据：`BillingPages.tsx` 从 1115 行降到 973 行，新增 `BillingCatalogAuthoring.tsx` 157 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X6 admin entitlement|A8 admin entitlement|A8 admin commercial|X6 host billing|A7 admin billing|M6 host commercial"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/commerce/BillingLedgerEvidence.tsx` 承担 Admin billing 页 ledger evidence 面板中的 feature matrix、order records、entitlement records、credits、reservations、redeem lifecycle、machine API keys 与 risk facts；`BillingPages.tsx` 只保留组件调用，`AdminBillingOperationsPage` 对外 props 不变。
- 完成证据：`BillingPages.tsx` 从 973 行降到 554 行，新增 `BillingLedgerEvidence.tsx` 444 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X6 admin entitlement|A8 admin entitlement|A8 admin commercial|X6 host billing|A7 admin billing|M6 host commercial"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/commerce/BillingCustomerLedgerEvidence.tsx` 承担 Admin billing 页 customer-facing ledger evidence 中的 orders、entitlements、credits 桌面表格与移动列表；`BillingOperationalLedgerEvidence.tsx` 承担 reservations、redeem lifecycle、machine API keys 与 risk facts；`BillingLedgerEvidence.tsx` 只保留 feature matrix 与两组 evidence wiring，`AdminBillingOperationsPage` 对外 props 不变。
- 完成证据：`BillingLedgerEvidence.tsx` 从 444 行降到 53 行，新增 `BillingCustomerLedgerEvidence.tsx` 252 行与 `BillingOperationalLedgerEvidence.tsx` 181 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X6 admin entitlement|A8 admin entitlement|A8 admin commercial|X6 host billing|A7 admin billing|M6 host commercial"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/commerce/BillingSettlementEvidence.tsx` 承担 Admin billing 页 settlement evidence 面板中的 subscriptions、invoices、payment methods 与 tax profiles 四组只读证据表；`BillingPages.tsx` 只保留组件调用，`AdminBillingOperationsPage` 对外 props 不变。
- 完成证据：`BillingPages.tsx` 从 1212 行降到 1115 行，新增 `BillingSettlementEvidence.tsx` 115 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X6 admin entitlement|A8 admin entitlement|A8 admin commercial|X6 host billing|A7 admin billing|M6 host commercial"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/commerce/BillingCatalogWorkspace.tsx` 承担 Admin billing 页 commercial catalog workspace 中的 plans/SKUs 表格、ledger filter tab、archive 与 sync maintenance 操作；`BillingPages.tsx` 只保留组件调用和剩余 order/business lanes wiring，`AdminBillingOperationsPage` 对外 props 不变。
- 完成证据：`BillingPages.tsx` 从 554 行降到 337 行，新增 `BillingCatalogWorkspace.tsx` 244 行，并清理旧聚合残留的无用 imports；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X6 admin entitlement|A8 admin entitlement|A8 admin commercial|X6 host billing|A7 admin billing|M6 host commercial"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/commerce/BillingOrderDetailDrawer.tsx` 承担 Admin billing 页 order detail drawer、上下文链接、benefit summary 与 invoice/subscription facts；`apps/host-next/components/admin/pages/commerce/BillingBusinessLanes.tsx` 承担 product packaging、customer access、settlement、payment/tax profile 四组 business lanes；`BillingPages.tsx` 只保留 billing operating model、review queue 与子组件 wiring，`AdminBillingOperationsPage` 对外 props 不变。
- 完成证据：`BillingPages.tsx` 从 337 行降到 163 行，新增 `BillingOrderDetailDrawer.tsx` 91 行与 `BillingBusinessLanes.tsx` 110 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X6 admin entitlement|A8 admin entitlement|A8 admin commercial|X6 host billing|A7 admin billing|M6 host commercial"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/commerce/RevenuePageModel.ts` 承担 Admin revenue/entitlements 页面共享的 table query 归一、pagination href、provider event JSON 摘要、metadata order id、order benefit summary 与 order context links；`RevenuePages.tsx` 保留 revenue/entitlements 页面渲染和 action wiring，`AdminRevenueOperationsPage` 与 `AdminEntitlementsOperationsPage` 对外 props 不变。
- 完成证据：`RevenuePages.tsx` 从 1110 行降到 933 行，新增 `RevenuePageModel.ts` 197 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X6 admin entitlement|A8 admin entitlement|A8 admin commercial|X6 host billing|A7 admin billing|M6 host commercial"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/commerce/RevenueOrderEvidence.tsx` 承担 Admin revenue 页 order evidence drawer、revenue pulse、daily buckets、order ledger、移动订单列表、SKU catalog 与 provider event timeline；`RevenuePages.tsx` 保留 revenue stats、review queue、reconcile action、entitlements 页面与子组件 wiring，`AdminRevenueOperationsPage` 对外 props 不变。
- 完成证据：`RevenuePages.tsx` 从 933 行降到 687 行，新增 `RevenueOrderEvidence.tsx` 312 行；`RevenuePageModel.ts` 当前 198 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X6 admin entitlement|A8 admin entitlement|A8 admin commercial|X6 host billing|A7 admin billing|M6 host commercial"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/commerce/RevenueEntitlementWorkspace.tsx` 承担 Admin entitlements 页 manual grant、entitlement detail drawer、ledger table、移动列表、override/revoke actions 与 pagination；`RevenuePages.tsx` 保留 entitlement stats、review queue、上下文模型和子组件 wiring，`AdminEntitlementsOperationsPage` 对外 props 不变。
- 完成证据：`RevenuePages.tsx` 从 687 行降到 391 行，新增 `RevenueEntitlementWorkspace.tsx` 355 行；`RevenueOrderEvidence.tsx` 当前 312 行，`RevenuePageModel.ts` 当前 198 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X6 admin entitlement|A8 admin entitlement|A8 admin commercial|X6 host billing|A7 admin billing|M6 host commercial"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/commerce/RevenueOverviewPanels.tsx` 承担 Admin revenue 页 totals/orders/failed/missing benefits stats、revenue review queue 与 billing reconcile action；`RevenuePages.tsx` 只保留 revenue 数据选择、focus order、entitlements stats/review、上下文模型与子组件 wiring，`AdminRevenueOperationsPage` 对外 props 不变。
- 完成证据：`RevenuePages.tsx` 从 394 行降到 331 行，新增 `RevenueOverviewPanels.tsx` 112 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X6 admin entitlement|A8 admin entitlement|A8 admin commercial|X6 host billing|A7 admin billing|M6 host commercial"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/commerce/RevenueEntitlementLedger.tsx` 承担 Admin entitlements 页 filter bar、desktop table、mobile list、override/revoke row actions 与 pagination；`RevenueEntitlementWorkspace.tsx` 只保留 manual grant、entitlement detail drawer 与 ledger wiring，`AdminEntitlementsOperationsPage` 对外 props 不变。
- 完成证据：`RevenueEntitlementWorkspace.tsx` 从 358 行降到 170 行，新增 `RevenueEntitlementLedger.tsx` 299 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X6 admin entitlement|A8 admin entitlement|A8 admin commercial|X6 host billing|A7 admin billing|M6 host commercial"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/data/UsagePages.tsx` 承担 Admin usage/metering 页 stats、metering review、quota/plan context、usage/metering charts、desktop tables 与移动记录列表；`UsageAnalyticsPages.tsx` 保留 analytics 页面并清理旧 usage 聚合残留 helpers/imports；`DataPages.tsx` 改为分别转发 usage 与 analytics 页面，`AdminPages` 对外 API 不变。
- 完成证据：`UsageAnalyticsPages.tsx` 从 1472 行降到 796 行，新增 `UsagePages.tsx` 401 行，`DataPages.tsx` 当前 3 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "A8/A9 admin analytics|X2 scope, notification, billing and admin APIs"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/data/UsageRecordsSection.tsx` 承担 Admin usage/metering 页 records filter bar、metering/usage desktop tables、mobile list 与 audit/module links；`UsagePageModel.ts` 承担 table query 清洗、compact JSON 与 metering status filter options；`UsagePages.tsx` 只保留 stats、review queue、quota/plan context、usage/metering charts 与 records section wiring，`AdminUsageOperationsPage` 对外 props 不变。
- 完成证据：`UsagePages.tsx` 从 406 行降到 218 行，新增 `UsageRecordsSection.tsx` 171 行与 `UsagePageModel.ts` 56 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "A8/A9 admin analytics|X2 scope, notification, billing and admin APIs"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/data/UsageAnalyticsCharts.tsx` 承担 Admin analytics usage/revenue/growth 三组 ChartPanel；`UsageAnalyticsEvidence.tsx` 承担 data quality panel 与 revenue/growth/churn/usage/cohort/reliability/raw counts evidence tables；`UsageAnalyticsPageModel.ts` 承担 analytics 数据类型、bucket 统计、peak bucket 与 compact JSON helper；`UsageAnalyticsPages.tsx` 只保留 shell、filters、auto insight 与 segmented overview wiring，`AdminAnalyticsOperationsPage` 对外 props 不变。
- 完成证据：`UsageAnalyticsPages.tsx` 从 796 行降到 337 行，新增 `UsageAnalyticsCharts.tsx` 120 行、`UsageAnalyticsEvidence.tsx` 268 行与 `UsageAnalyticsPageModel.ts` 104 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "A8/A9 admin analytics|X2 scope, notification, billing and admin APIs"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/data/FileDetailPage.tsx` 承担 Admin file detail 页 status stats、storage object/access cleanup tables、redacted metadata code blocks、audit timeline 与 file snapshot drawer；`FilePages.tsx` 继续 re-export detail 页面并保留 files list、reconcile、bulk/cleanup actions 与 directory table wiring，`AdminFileDetailOperationsPage` 对外 props 不变。
- 完成证据：`FilePages.tsx` 从 1096 行降到 888 行，新增 `FileDetailPage.tsx` 222 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "A10/A11 admin files|D22 admin file detail|M6 host file|X12 host file quota"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/data/FileDirectorySection.tsx` 承担 Admin files 页 bulk action、directory filters、advanced filters、desktop table、mobile list、row actions 与 pagination；`FilePages.tsx` 保留 stats、storage review、quota/business impact、orphan governance、reconcile 与 cleanup wiring，`AdminFilesOperationsPage` 对外 props 不变。
- 完成证据：`FilePages.tsx` 从 888 行降到 449 行，新增 `FileDirectorySection.tsx` 492 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "A10/A11 admin files|D22 admin file detail|M6 host file|X12 host file quota"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/data/FileDirectoryBulkActionPanel.tsx` 承担 Admin files directory 当前筛选批量 archive/delete 表单；`FileDirectoryFilters.tsx` 承担基础搜索/status/module 与 owner/MIME/provider/path/date/size advanced filters；`FileDirectoryRecords.tsx` 承担 desktop DataTable、mobile list、media/audit links 与 quarantine/archive/delete/restore row actions；`FileDirectoryPageModel.ts` 承担 pagination href 与 file status options；`FileDirectorySection.tsx` 只保留 directory panel、filter hint、records 与 pagination wiring，`AdminFilesOperationsPage` 对外 props 不变。
- 完成证据：`FileDirectorySection.tsx` 从 492 行降到 111 行，新增 `FileDirectoryBulkActionPanel.tsx` 58 行、`FileDirectoryFilters.tsx` 147 行、`FileDirectoryRecords.tsx` 177 行与 `FileDirectoryPageModel.ts` 82 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "A10/A11 admin files|D22 admin file detail|M6 host file|X12 host file quota"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/data/FileStorageGovernancePanels.tsx` 承担 Admin files 页 storage stats/review、quota/business impact、orphan governance、reconcile evidence 与 deleted object cleanup action；`FilePages.tsx` 只保留 table query 清洗、file filter/pagination model 与 directory/governance 子组件 wiring，`AdminFilesOperationsPage` 对外 props 不变。
- 完成证据：`FilePages.tsx` 从 456 行降到 152 行，新增 `FileStorageGovernancePanels.tsx` 341 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "A10/A11 admin files|D22 admin file detail|M6 host file|X12 host file quota"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/modules/ModuleDetailEvidence.tsx` 承担 Admin module detail 页 contract/runtime evidence 面板中的 risk review、capability map、module root/release metadata、routes/gateways、surfaces/resources、runtime activity 与 diagnostics；`ModulePages.tsx` 保留模块列表、detail capability narrative、product shape、operational metadata、AI fix prompt 与 snapshot drawer wiring，`AdminModuleDetailOperationsPage` 对外 props 不变。
- 完成证据：`ModulePages.tsx` 从 1921 行降到 1458 行，新增 `ModuleDetailEvidence.tsx` 455 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X10|K5|K4 host security|K1 host runtime health"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/modules/ModuleContractEvidence.tsx` 承担 Admin module detail contract evidence 中的 risk review、capability map、module root/release metadata、routes/gateways、surfaces/resources；`ModuleRuntimeDiagnosticsEvidence.tsx` 承担 runtime activity 与 diagnostics tables；`ModuleDetailEvidenceModel.ts` 承担 detail module/contract/diagnostics 类型与 join helper；`ModuleDetailEvidence.tsx` 只保留外层 AdminPanel 与两组 evidence wiring，`AdminModuleDetailOperationsPage` 对外 props 不变。
- 完成证据：`ModuleDetailEvidence.tsx` 从 464 行降到 44 行，新增 `ModuleContractEvidence.tsx` 354 行、`ModuleRuntimeDiagnosticsEvidence.tsx` 124 行与 `ModuleDetailEvidenceModel.ts` 9 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X10|K5|K4 host security|K1 host runtime health"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/modules/ModuleContractRiskEvidence.tsx` 承担 Admin module detail contract risk review；`ModuleContractGatewayEvidence.tsx` 承担 routes 与 host gateway exposure evidence；`ModuleContractExtensionEvidence.tsx` 承担 navigation/surface contribution 与 resource requirements evidence；`ModuleContractEvidence.tsx` 只保留 capability map、module root/release metadata 与子组件 wiring，`AdminModuleDetailOperationsPage` 对外 props 不变。
- 完成证据：`ModuleContractEvidence.tsx` 从 354 行降到 163 行，新增 `ModuleContractRiskEvidence.tsx` 113 行、`ModuleContractGatewayEvidence.tsx` 70 行与 `ModuleContractExtensionEvidence.tsx` 63 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X10|K5|K4 host security|K1 host runtime health"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/modules/ModuleCatalogSection.tsx` 承担 Admin modules 页 catalog filters、summary chips、desktop table、mobile list、status/maintenance actions 与 pagination；`ModulePageModel.ts` 承担 product area、category、capability phrases、release impact 与 operator next action helper；`ModulePages.tsx` 保留 stats、review queue、inventory lanes、runtime host snapshot、product area map 与 detail summary wiring，`AdminModulesOperationsPage` 对外 props 不变。
- 完成证据：`ModulePages.tsx` 从 1458 行降到 1001 行，新增 `ModuleCatalogSection.tsx` 403 行与 `ModulePageModel.ts` 167 行；`ModuleDetailEvidence.tsx` 后续已进一步降到 44 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X10|K5|K4 host security|K1 host runtime health"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/modules/ModuleCatalogToolbar.tsx` 承担 Admin modules catalog filter bar、filter result hint 与 needs review/required/activity/visible summary chips；`ModuleCatalogRecords.tsx` 承担 desktop DataTable、mobile list、status enable/disable 与 maintenance row actions；`ModuleCatalogPageModel.ts` 承担 pagination href 与 module status filter options；`ModuleCatalogSection.tsx` 只保留 pagination 计算、panel shell、toolbar、records 与 pagination wiring，`AdminModulesOperationsPage` 对外 props 不变。
- 完成证据：`ModuleCatalogSection.tsx` 从 403 行降到 78 行，新增 `ModuleCatalogToolbar.tsx` 93 行、`ModuleCatalogRecords.tsx` 220 行与 `ModuleCatalogPageModel.ts` 81 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X10|K5|K4 host security|K1 host runtime health"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/modules/ModuleDetailPage.tsx` 承担 Admin module detail 页 capability narrative、product shape、operational metadata、AI fix prompt 与 snapshot drawer，并组合 `ModuleDetailEvidence.tsx`；`ModulePages.tsx` 清理旧聚合残留的跨页面 imports/types/options/helpers，仅保留 modules overview、runtime host snapshot、product area map 与 catalog wiring；`AdminModuleDetailOperationsPage` 继续从 `ModulePages.tsx` 转发导出，外部 `AdminPages`/路由导入不变。
- 完成证据：`ModulePages.tsx` 从 1001 行降到 384 行，新增 `ModuleDetailPage.tsx` 369 行；`ModuleCatalogSection.tsx` 后续已进一步降到 78 行，`ModulePageModel.ts` 当前 167 行，`ModuleDetailEvidence.tsx` 后续已进一步降到 44 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X10|K5|K4 host security|K1 host runtime health"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/modules/ModuleInventoryOverview.tsx` 承担 Admin modules 页 inventory lanes、runtime host snapshot 与 product area map；`ModulePages.tsx` 只保留 stats、review queue、catalog section 与子组件 wiring，`AdminModulesOperationsPage` 对外 props 不变。
- 完成证据：`ModulePages.tsx` 从 384 行降到 256 行，新增 `ModuleInventoryOverview.tsx` 175 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X10|K5|K4 host security|K1 host runtime health"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/modules/ModuleProductShapePanel.tsx` 承担 Admin module detail 页 product kind/audience/shell/navigation/page tables；`ModuleOperationalMetadataPanel.tsx` 承担 runs/webhooks/audit links 与 owner/runbook/replacement/release facts；`ModuleDetailPage.tsx` 只保留 capability narrative、detail evidence、AI fix prompt、snapshot drawer 与子组件 wiring，`AdminModuleDetailOperationsPage` 对外 props 不变。
- 完成证据：`ModuleDetailPage.tsx` 从 369 行降到 233 行，新增 `ModuleProductShapePanel.tsx` 85 行与 `ModuleOperationalMetadataPanel.tsx` 86 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X10|K5|K4 host security|K1 host runtime health"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/identity/UserDetailPage.tsx` 承担 Admin user detail 页 account status、host role、password reset、session revoke、audit timeline、metadata 与 user facts；`IdentityPageModel.ts` 承担 auth summary、email verification state 与 review reason helper；`IdentityPages.tsx` 清理旧聚合残留的跨域 imports/types/options/helpers，仅保留 users list 与 RBAC 页面主体；`AdminUserDetailOperationsPage` 继续从 `IdentityPages.tsx` 转发导出，外部 `AdminPages`/路由导入不变。
- 完成证据：`IdentityPages.tsx` 从本轮开始的 1494 行降到 882 行，新增 `UserDetailPage.tsx` 296 行与 `IdentityPageModel.ts` 78 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "R2 admin user detail|R2 admin identity|X3 admin APIs|K2 host identity|M2 host auth|X2 host user|X9 auth transactional"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/identity/UsersPage.tsx` 承担 Admin users 目录页 stats、review queue、filters、desktop table、mobile list、user context links 与 pagination；`IdentityPageModel.ts` 扩展承载 table query 归一、pagination href、text search 与 exact filter helper；`IdentityPages.tsx` 仅保留 RBAC 页面主体与 `AdminUsersOperationsPage`/`AdminUserDetailOperationsPage` 兼容转发导出，外部 `AdminPages`/路由导入不变。
- 完成证据：`IdentityPages.tsx` 从 882 行降到 333 行，新增 `UsersPage.tsx` 460 行；`IdentityPageModel.ts` 从 78 行扩展到 194 行，`UserDetailPage.tsx` 当前 296 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "R2 admin user detail|R2 admin identity|X3 admin APIs|K2 host identity|M2 host auth|X2 host user|X9 auth transactional"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/identity/UsersDirectoryFilters.tsx` 承担 Admin users directory search/status/role filter form 与 clear action；`UsersDirectoryRecords.tsx` 承担 desktop DataTable、mobile list、verification/activity/timestamp 展示与 billing/entitlements/audit links；`UsersDirectoryModel.tsx` 承担 filter result hint 与 status/role filter options；`UsersPage.tsx` 只保留 stats、review queue、directory panel、pagination 与子组件 wiring，`AdminUsersOperationsPage` 对外 props 不变。
- 完成证据：`UsersPage.tsx` 从 460 行降到 188 行，新增 `UsersDirectoryFilters.tsx` 87 行、`UsersDirectoryRecords.tsx` 186 行与 `UsersDirectoryModel.tsx` 38 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "R2 admin user detail|R2 admin identity|X3 admin APIs|K2 host identity|M2 host auth|X2 host user|X9 auth transactional"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/identity/RbacPage.tsx` 承担 Admin RBAC 页 stats、role management table、permission search/filter、permission matrix、diff view 与 coverage timeline；`IdentityPages.tsx` 收缩为 users、user detail、RBAC 三个页面的兼容转发导出壳，外部 `AdminPages`/路由导入不变。
- 完成证据：`IdentityPages.tsx` 从 333 行降到 3 行，新增 `RbacPage.tsx` 329 行；`UsersPage.tsx` 后续已进一步降到 188 行，`UserDetailPage.tsx` 当前 296 行，`IdentityPageModel.ts` 当前 194 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "R2 admin user detail|R2 admin identity|X3 admin APIs|K2 host identity|M2 host auth|X2 host user|X9 auth transactional"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/operations/RunDetailPage.tsx` 承担 Admin run detail 页 status/progress/attempt stats、cancel/requeue action panel、runbook/escalation links、execution timeline、linked evidence、redacted input/result/error code blocks 与 snapshot drawer；`RunsPages.tsx` 保留 runs list 的 queue stats、review queue、lane map、filters、desktop/mobile table 与 pagination；`AdminRunDetailOperationsPage` 继续从 `RunsPages.tsx` 转发导出，外部 `AdminPages`/路由导入不变。
- 完成证据：`RunsPages.tsx` 从 760 行降到 393 行，新增 `RunDetailPage.tsx` 389 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "M6 host scoped runs|X8 admin dead-letter|M6 host worker|X11 admin worker status|K6 host worker"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/operations/RunQueueLanes.tsx` 承担 Admin runs queue lane health rows；`RunHistorySection.tsx` 承担 run history filter、kind chip、empty state、desktop table、mobile list、cancel/requeue row actions 与 pagination；`RunsPages.tsx` 只保留 queue stats、execution review、分页模型与子组件 wiring，`AdminRunsOperationsPage` 对外 props 不变。
- 完成证据：`RunsPages.tsx` 从 393 行降到 169 行，新增 `RunQueueLanes.tsx` 71 行与 `RunHistorySection.tsx` 268 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "M6 host scoped runs|X8 admin dead-letter|M6 host worker|X11 admin worker status|K6 host worker"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/operations/RunLinkedEvidence.tsx` 承担 Admin run detail 页 outbox、delivery ledger、file/artifact、usage 与 audit evidence tables；`RunDetailPage.tsx` 只保留 status/progress/attempt stats、cancel/requeue action panel、runbook/escalation links、execution timeline、redacted input/result/error code blocks、snapshot drawer 与 linked evidence wiring，`AdminRunDetailOperationsPage` 对外 props 不变。
- 完成证据：`RunDetailPage.tsx` 从 389 行降到 287 行，新增 `RunLinkedEvidence.tsx` 117 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "M6 host scoped runs|X8 admin dead-letter|M6 host worker|X11 admin worker status|K6 host worker"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/dashboard/pages/DashboardBillingPage.tsx` 承担 Dashboard billing 页 current plan、checkout CTA、billing summary、plan cards、invoices、payment methods 与 tax profile form；`DashboardOrdersPage.tsx` 承担 Dashboard orders 页 order synopsis、订单列表、invoice document link 与 billing 返回入口；`DashboardCreditHistoryPage.tsx` 承担 Dashboard credit history 页 credit balance synopsis、credit transaction list 与 empty state；`CommercialPages.tsx` 收缩为 billing/orders/credit history 三个页面的兼容转发导出壳，外部 `DashboardPages`/`BillingPages`/路由导入不变。
- 完成证据：`CommercialPages.tsx` 从 600 行降到 3 行，新增 `DashboardBillingPage.tsx` 346 行、`DashboardOrdersPage.tsx` 145 行与 `DashboardCreditHistoryPage.tsx` 116 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "P10 host shell resolves dashboard|X6 host billing|M6 host commercial|M6 user SaaS snapshot|billing overview|Stripe checkout"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/dashboard/pages/DashboardPageUtils.tsx` 仅保留 Dashboard 共享 UI primitives，commerce/status/scope/task/file/notification formatting helper 迁入 `DashboardPageFormatting.ts` 和 6 个领域 formatting 文件；`DashboardPageUtils.tsx` 继续 re-export 原 helper 名称，保持现有页面导入不变。
- 完成证据：`DashboardPageUtils.tsx` 从 602 行降到 190 行，新增 `DashboardPageFormatting.ts` 6 行、`DashboardCommerceFormatting.ts` 86 行、`DashboardStatusFormatting.ts` 117 行、`DashboardScopeFormatting.ts` 49 行、`DashboardTaskFormatting.ts` 26 行、`DashboardFileFormatting.ts` 44 行与 `DashboardNotificationFormatting.ts` 104 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "P10 host shell resolves dashboard|X2 host user APIs|X4 product scope|X4 workspace|X6 host billing|M6 host commercial|M6 user SaaS snapshot|billing overview|Stripe checkout|X9 notifications|M6 host file|X12 host file quota"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/overview/OverviewPages.tsx` 清理旧聚合遗留 imports/types/query helpers/options/table/list/digest helper；recent users/growth trend 迁入 `OverviewGrowthPanels.tsx`，quick actions/audience workspace 迁入 `OverviewNavigationPanels.tsx`，risk queue 迁入 `OverviewRiskPanel.tsx`；`AdminOverviewPage` 对外 props 与路由导入不变。
- 完成证据：`OverviewPages.tsx` 从 1285 行降到 327 行，新增 `OverviewGrowthPanels.tsx` 225 行、`OverviewNavigationPanels.tsx` 159 行与 `OverviewRiskPanel.tsx` 51 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "X2 scope, notification, billing and admin APIs|A8/A9 admin analytics|X11 admin provider status|X11 admin worker status|K4 host security|A10 host settings|R2 admin user detail|A7 admin billing"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/governance/GovernancePages.tsx` 清理旧聚合残留 imports/types/helpers；global search 页面迁入 `SearchPage.tsx`，audit 过滤/分页/风险分类/统计迁入 `AuditPageModel.ts`，audit detail drawer、retention panel 与 timeline panel 分别迁入独立组件；`AdminAuditOperationsPage` 与 `AdminSearchOperationsPage` 对外导出不变。
- 完成证据：`GovernancePages.tsx` 从 1234 行降到 158 行，新增 `SearchPage.tsx` 245 行、`GovernancePageModel.ts` 110 行、`AuditPageModel.ts` 273 行、`AuditDetailDrawer.tsx` 93 行、`AuditRetentionPanel.tsx` 60 行与 `AuditTimelinePanel.tsx` 192 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "R2 admin audit API|A8/A9 admin analytics|X2 scope, notification, billing and admin APIs|K4 host security|A10 host settings|X11 admin provider status"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/settings/SettingsPages.tsx` 清理旧聚合残留 imports/types/helpers/options；产品设置表单迁入 `SettingsProductSettingsPanel.tsx`，resolved values 迁入 `SettingsResolvedPanel.tsx`，theme preview 迁入 `SettingsThemePreviewPanel.tsx`，runtime config 迁入 `SettingsRuntimeConfigPanel.tsx`，provider/worker diagnostics 与 summary 迁入 `SettingsDiagnosticsPanels.tsx`；`AdminSettingsOperationsPage` 与 `AdminSectionPage` 对外导出不变。
- 完成证据：`SettingsPages.tsx` 从 1125 行降到 209 行，新增 `SettingsProductSettingsPanel.tsx` 219 行、`SettingsDiagnosticsPanels.tsx` 151 行、`SettingsThemePreviewPanel.tsx` 109 行、`SettingsRuntimeConfigPanel.tsx` 98 行与 `SettingsResolvedPanel.tsx` 83 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "A10 host settings|A10/A11 admin files|X11 admin provider status|X11 admin worker status|X11 config doctor|K4 host security|M3 host runtime store|M6 host file storage"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-15 本轮实施）：`apps/host-next/components/admin/pages/dev-console/DevConsolePages.tsx` 清理旧聚合残留 imports/types/helpers/options；环境对比迁入 `DevConsoleEnvironmentPanel.tsx`，owner/runbook/escalation 迁入 `DevConsoleOwnerPanel.tsx`，AI repair table 迁入 `DevConsoleRepairPanel.tsx`，MDC operations summary 迁入 `DevConsoleOperationsSummary.tsx`，raw diagnostics 迁入 `DevConsoleRawDiagnostics.tsx`，module helper/repair pack/AI prompt bundle 迁入 `DevConsolePageModel.ts`；`AdminModuleDevConsoleOperationsPage` 对外导出不变。
- 完成证据：`DevConsolePages.tsx` 从 1069 行降到 140 行，新增 `DevConsoleOperationsSummary.tsx` 215 行、`DevConsoleRawDiagnostics.tsx` 116 行、`DevConsolePageModel.ts` 98 行、`DevConsoleEnvironmentPanel.tsx` 79 行、`DevConsoleOwnerPanel.tsx` 57 行与 `DevConsoleRepairPanel.tsx` 54 行；`npm run typecheck` 通过；`npm run test:web-shell -- --test-name-pattern "K5 admin catalog seed|P10 host shell|X10 demo modules|X11 config doctor|X11 admin provider status|K4 host security|M6 host worker|admin runtime exposes operational records"` 实际执行 75/75 个 Web Shell 子测试并全部通过；`npm run test:production-runtime` 16/16 通过。
- 已完成（2026-06-16 本轮实施）：`apps/host-next/lib/product-composition-brand.ts` 承担 product composition 的 brand view 与 admin visual baseline evidence 读取，包括 favicon/manifest/OpenGraph/themeColor diagnostics、locale OpenGraph image 映射，以及 admin UI/browser/theme/accessibility/mobile handfeel 最新报告摘要；`apps/host-next/lib/product-composition-theme.ts` 承担 product/workspace/page theme scope resolution、theme runtime view 合并、CSS 变量序列化和 unsafe token diagnostics；`apps/host-next/lib/product-composition.ts` 收缩为 product presentation composition、host page slot view、diagnostics view 和兼容导出入口，继续从原入口 re-export brand/baseline/theme 类型与 `createProductThemeCss` 保持 public API 不变。
- 完成证据：`product-composition.ts` 从 738 行降到 287 行，新增 `product-composition-brand.ts` 170 行与 `product-composition-theme.ts` 376 行；`npm run test:host-page-runtime` 21/21 通过，覆盖 product composition view、theme runtime、host page presentation 和 slot surface composition；`npm run typecheck` 通过；本轮 touched 实现文件已 Prettier 格式化。

每次拆分都必须保持 public API 不变，并跑对应专项测试。

### Phase 5：补 UI 真实证据

1. 已完成本地严格证据（2026-06-14 本轮实施）：跑 browser matrix。
2. 已完成本地严格证据（2026-06-14 本轮实施）：跑 accessibility smoke。
3. 已完成本地严格证据（2026-06-14 本轮实施）：跑 admin UI gate；browser matrix 同时覆盖 Admin mobile drawer/global search 交互。
4. 已完成本地严格证据（2026-06-14 本轮实施）：截图和 JSON evidence 已固化在 `.runtime/browser-matrix/2026-06-14T11-00-29-728Z/`、`.runtime/accessibility-smoke/2026-06-14T11-00-29-991Z/`、`.runtime/admin-ui-gate/2026-06-14T10-53-08.579Z/`。
5. 已完成本地 production standalone 严格证据（2026-06-14 本轮实施）：完整 `release:evidence --required` 在 production standalone 上再次跑通 `host:browser-matrix -- --required --base-url http://localhost:3000` 和 `host:accessibility-smoke -- --required --base-url http://localhost:3000`，报告分别写入 `.runtime/browser-matrix/2026-06-14T11-46-12-956Z/`、`.runtime/accessibility-smoke/2026-06-14T11-47-24-694Z/`。

## 18. 生产级完成定义对照

| 完成定义                             | 当前状态             | 证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 干净 clone 基础 gate 通过            | 本轮基础达成         | `typecheck`、`modules:check`、`format:check`、`test:web-shell` 已通过；Postgres 基础持久化、backup/restore 语义 smoke、upgrade migration 静态 smoke、本地 browser/accessibility/admin UI evidence、生产 `host:build`、standalone `host:smoke` 和完整 `release:evidence --required` 已补齐；本轮额外复验 production `host:build` 无 Turbopack NFT tracing warning                                                                                                                                                                                                                                                    |
| P0 清零                              | 本轮达成             | 未发现外部 module map 污染；demo seed 默认关闭                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| P1 清零                              | 仓库侧达成；外部待证 | Web Shell 已恢复；Postgres 基础验证已补齐；Dashboard 本地基础 transition smoke、普通锚点兜底、全屏模块 client-transition frame 和 repeat soak 已通过；线上 origin-agentops 已复测但 route transition 仍失败，2026-06-16 复测显示 required repeat 下 8/8 次 transition 均产生完整 document navigation，且线上未暴露当前 AppFrame/client-transition 诊断标记。该问题的仓库侧修复已完成，剩余是部署当前宿主产物后的外部复测，不再作为本轮继续修复项                                                                                                                                                                    |
| Contract/validator/runtime/test 一致 | 本轮基础达成         | module contract、host runtime、security runtime、Web Shell 通过                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 安全默认值可靠                       | 本轮基础达成         | production runtime/security tests 通过；认证 reset 防枚举测试已补                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 高风险 capability deny/allow 测试    | 本轮基础达成         | security runtime 覆盖较强；AI/RAG policy smoke 已补预算拒绝、成功扣费、失败释放 reservation、匿名 rate limit 必需和匿名高成本 fail-closed，并纳入 `ai-rag-policy` maintainer gate                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Postgres/memory store 均验证         | 基础达成             | `test:runtime-stores` 在隔离临时 Postgres 上 9/9 通过且 0 skipped；`host:postgres-local-smoke -- --no-docker` 通过                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 商业账本可审计可幂等                 | 本地达成；外部待证   | commercial ledger、commercial Postgres、Stripe local mock + ledger apply、billing reconcile 和 `commercial-domain` release evidence 均通过；[真实 Provider Smoke 运维手册](real-provider-smoke-runbook.zh-CN.md) 已规定真实 Stripe/S3/Email/AI/RAG 凭据环境的 smoke 命令和验收口径，真实执行证据仍需在隔离 provider 账号中归档                                                                                                                                                                                                                                                                                      |
| Admin/Dashboard 真实浏览器稳定       | 本地生产基础验证通过 | Dashboard 本地 route transition、`--inject-anchor` smoke、三轮 repeat soak 和 Origin AgentOps 全屏模块 latest smoke 已跑且截图已检查，并已作为 `dashboard-transition-smoke` 接入 maintainer gate；browser matrix、accessibility smoke、admin UI gate 在本地临时 host 下通过；完整 `release:evidence --required` 又在 production standalone 下跑通 host smoke、browser matrix、accessibility smoke；线上 origin-agentops 2026-06-16 复测仍失败且未暴露当前 AppFrame/client-transition 诊断标记，需部署当前宿主产物后复测                                                                                             |
| release evidence 可复现              | 本地 RC 闭环达成     | `npm run release:evidence -- --required --base-url http://localhost:3000` 在干净临时 Postgres + production standalone 下通过，25 个步骤全部绿色，无 blockers，报告 `.runtime/rc-evidence/2026-06-14T11-43-16-668Z/evidence.json`；`release:maintainer-gate` 已严格读取 `postgres-physical-restore-matrix`、Dashboard repeat + injected-anchor transition 和 AI/RAG policy evidence，当前本地 latest Dashboard transition 强证据通过，maintainer gate 已恢复绿色；线上 origin-agentops route transition 仍作为独立生产环境阻塞项继续跟踪                                                                             |
| Production build tracing 干净        | 已达成基础闭环       | `module-map-health`/release gate 从通用 runtime barrel 拆出，locale messages 改为 generated map，Admin entitlement/dead-letter/settings/files/audit/commercial view/runs detail/actions/module operations/dev-console view 改为领域 helper；`admin-operations.ts` 已降为 39 行兼容壳，运行期调用不再从该壳进入；隔离临时 Postgres 下 `runtime:stores:verify` + `host:build` 通过且无 `unexpected file in NFT list`                                                                                                                                                                                                  |
| 文档命令可执行                       | 本轮基础达成         | docs encoding、seo、i18n、format gate 通过；`test:developer-experience` 已覆盖 11 个基础模板和 service-backed/background/组合 extension 生成后 `module:doctor` 与 `module:test --summary` 通过                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 干净重构不变量守住                   | 基础达成；长期维护   | 已在 metadata-only resolver 中保留 route 匹配和访问权限检查；dashboard shell 并行化已保留普通 session/module session navigation 语义；安全、scope、审计、幂等相关测试和 runtime store/Postgres 验证已形成基础证据。后续 runtime store 深水区重构作为单独维护任务推进，不再作为本轮报告继续修复项                                                                                                                                                                                                                                                                                                                    |
| Dashboard route transition 可用      | 本地达成；线上待证   | metadata-only、shell 并行化、timing span、AppFrame 普通锚点兜底和 `shell.chrome='none'` 全屏模块 client-transition frame 已修；最新本地强 evidence `.runtime/dashboard-transition-smoke/2026-06-16T10-35-10-955Z` 覆盖 Origin AgentOps `/zh/dashboard/origin-agentops/{agents,skills,tools}` 的 `--required --repeat 3 --inject-anchor`，8/8 transition、2 次 reset transition、transition document navigation=0、hydrationErrors=0、P95 198ms，三个 shell marker 均为 true，且已纳入 `release:maintainer-gate` 并通过；线上 origin-agentops `--no-latest` 复测失败归为部署后外部验证，不再覆盖本地 latest evidence |
| 新 Postgres baseline 可重建          | 策略达成             | 现有 runtime + Data v2 migration baseline 可在空临时库重建，并在完整 RC evidence 中通过 `runtime:stores:verify`、`host:postgres-local-smoke -- --no-docker`、`data:migrate`、`drift:check`；本地 `pg_dump`/`pg_restore` smoke 已补并纳入 `postgres-physical-restore-matrix`；[Postgres Baseline 与 PITR 运维手册](postgres-baseline-pitr-runbook.zh-CN.md) 已明确新 baseline、旧库归档/人工迁移边界、托管快照/WAL/PITR 演练步骤和 RPO/RTO 口径；目标部署环境 PITR 演练仍需按 runbook 归档证据                                                                                                                       |

## 19. 下一次全量分析建议

下一次分析建议复跑本轮已打通的 RC 证据链，并按实际上线计划补齐线上/真实 provider 证据。以下命令是后续审计建议，不是本轮继续修复清单：

```bash
npm run format:check
npm run test:web-shell
npm run db:up
npm run runtime:stores:migrate
npm run test:runtime-stores
npm run modules:check
npm run module:doctor -- all
npm run module:test -- all
npm run test:commercial-ledger
npm run host:postgres-local-smoke
npm run host:stripe-local-smoke
npm run host:billing-reconcile-smoke
npm run host:worker-soak -- --required
npm run host:chaos-smoke -- --required
npm run host:backup-restore-smoke -- --required
npm run host:postgres-physical-restore-smoke -- --required
npm run host:upgrade-migration-smoke -- --required
npm run host:ai-rag-policy-smoke -- --required
npm run host:provider-matrix -- --required
npm run host:dashboard-transition-smoke -- --required --base-url <host-url> --repeat 3 --inject-anchor
npm run host:browser-matrix -- --required --base-url <host-url>
npm run host:accessibility-smoke -- --required --base-url <host-url>
npm run release:evidence -- --required --base-url http://localhost:3000
npm run host:dashboard-transition-smoke -- --required --base-url https://aijia.yingasi.com --routes /dashboard/origin-agentops/agents,/dashboard/origin-agentops/skills,/dashboard/origin-agentops/tools --repeat 3 --inject-anchor
```

如果这些通过，并且真实 S3/Stripe/Email/AI provider 凭据环境也通过对应 smoke，再评估是否能把当前状态提升到“可上线商业级候选”。

## 20. 总体评价

PloyKit 的架构方向是健康的：模块契约、运行时 host、capability guard、商业账本、数据 runtime、Admin 运营面、文档和 release gate 已经形成了一个生产级框架该有的骨架。本轮已经把 Web Shell 认证邮件测试、format gate、Postgres 基础持久化 evidence、Dashboard metadata-only、catalog seed 去重复查询、`/brand/*` 缓存、Dashboard transition smoke、shell 数据并行化、dashboard 壳层短缓存、dashboard notifications/tasks/files/commercial pages、admin webhooks/runs/admin data usage/analytics/files/admin commerce revenue-entitlements 页面拆分、结构化 timing span、AppFrame 普通锚点 client transition 兜底、`shell.chrome='none'` 全屏模块 client-transition frame、Data v2 生成物漂移、Product Presentation catch-all 漏登、production build NFT tracing warning、Admin commercial view/runs detail 领域拆分、release evidence 自管 production host 生命周期和完整 RC evidence required 这些基础问题压下去。按本轮停止线，当前仓库内可验证修复已经收口；Dashboard 线上 origin-agentops route transition、hydration 长周期观察、`Server-Timing` 响应头增强、真实外部 provider 执行证据、目标环境 PITR 演练证据和复杂度治理都归为后续外部验证或维护 backlog。

下一步优先补 Dashboard 线上浏览器性能回归、真实 provider 凭据环境、Postgres 物理备份恢复策略和大文件拆分，PloyKit 就会从“本地 RC 证据已闭环的框架”更接近“可被外部团队信任的商业级生产框架”。
