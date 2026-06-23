# Origin AgentOps 性能归因修订与模块剩余问题

分析日期：2026-06-23
修订对象：`docs/origin-agentops-frontend-performance-analysis-2026-06-23.zh-CN.md`
线上入口：`https://aijia.yingasi.com/zh/login?next=%2Fdashboard%2Forigin-agentops%2Fagent-detail`
证据目录：`.runtime/origin-agentops-perf-audit/run-2026-06-23T00-52-32-402Z`
审计脚本：`.runtime/origin-agentops-perf-audit/audit-origin-agentops.mjs`
模块源码参考：`D:\code2\znt\ploykit\modules\origin-agentops`
宿主源码参考：当前工作区 `D:\code2\ploykit`

## 0. 本文用途

上一版性能报告把两类问题放在了一起：

1. 宿主框架负责的路由、RSC、AppFrame、client transition、dashboard shell 行为。
2. Origin AgentOps 模块自身负责的数据加载、`state` 聚合、页面二次请求和 N+1 请求。

本文只做一次归因修订，不重复压测。它基于同一轮线上 Playwright 证据和源码阅读结果，把宿主框架问题从 Origin 模块待办中移出，把模块自己能改的剩余问题单独留下。

修订后的结论是：

- “页面卡”仍然主要来自切页期间等待服务端与接口返回，不是稳定后滚动掉帧。
- `?_rsc=` 请求、AppFrame、client transition 拦截和 dashboard catch-all route 属于宿主框架面。
- Origin 模块真正需要承担的是：所有 section 共享全量 dashboard loader、`/state` 过重且重复请求、页面级 API 和 loader/state 重叠、Skills 首屏 N+1、Origin API 聚合缺少短缓存。
- RSC 慢是一个宿主可见的症状，不应简单写成“Origin RSC 实现问题”。模块能修的是 RSC 里携带的 loader 数据体积和 loader 执行链路。

## 1. 责任边界总表

| 观察项 | 修订后的归因 | 所属方 | 说明 |
| --- | --- | --- | --- |
| 侧栏点击大多触发 `?_rsc=` fetch，而不是完整 document navigation | 宿主 client transition 生效情况 | 宿主框架 | 当前线上多数切页已被宿主转成 Next client transition。Origin 不能把这个作为模块 P0 根因，只需避免绕开宿主导航能力。 |
| `?_rsc=` 常见 117KB 到 120KB，3.6s 到 6.5s，`admin` 最高约 13.3s | 传输机制归宿主，payload 与 loader 工作量部分归模块 | 宿主加模块 | 是否走 RSC 是宿主路由机制。RSC 里为何携带大量模块 loaderData，是模块 loader 设计问题。 |
| dashboard catch-all route、`force-dynamic`、AppFrame、RSC shell | 宿主路由和页面框架 | 宿主框架 | 这些文件在 `apps/host-next` 和 `src/lib/module-runtime`，不是 Origin 模块代码。 |
| 登录页阶段的营销页、登录页 RSC 预取 abort | 登录和站点壳层行为 | 宿主框架 | 登录成功后核心 dashboard 没有 console/page error。该问题不进入 Origin 模块性能 backlog。 |
| 缺少统一 Server-Timing 或切页 smoke gate | 平台观测能力 | 宿主框架为主 | 宿主负责通用机制；Origin 可在 loader/API 内补业务 span。 |
| `/api/modules/origin-agentops/state` 多次出现，约 72.6KB，常见 3.46s 到 4.90s | 模块全量 read model 过重 | Origin 模块 | `state` 由模块 API 提供，且复用全量 `liveDashboardData`。 |
| 所有 section 共享 `./loaders/dashboard` | 模块路由 contract 设计过重 | Origin 模块 | `module.ts` 把 `/origin-agentops` 和 `/origin-agentops/[section]` 都绑定到同一个 loader。 |
| `AgentOpsApp` 已有 loader data，mount 后仍无条件拉 `/state` | 客户端重复取数 | Origin 模块 | 这是模块组件行为，直接放大首屏和切页等待。 |
| Skills 首屏 6 个 version 请求，每个约 3.47s 到 3.65s | 页面级 N+1 | Origin 模块 | `SkillsPage` 对 visible skills 逐个请求 versions。 |
| `fetchOriginAgents` list 后对每个 agent 再拉 version detail | 服务调用 fan-out | Origin 模块 | 列表和详情职责没有拆开，放大 loader/state 成本。 |

## 2. 从 Origin 模块待办中移出的宿主框架项

这些问题不再作为 `origin-agentops` 模块的 P0/P1 修复项出现。它们应进入宿主框架验证清单或平台性能专项。

### 2.1 完整 document navigation 与 client transition 拦截

旧口径容易把“点击侧栏是否变成整页跳转”写成 Origin 模块导航问题。修订后应拆成两层：

- 宿主负责拦截 dashboard 内同域、同语言、同 area 的链接，并把它们变成 client transition。
- Origin 模块负责使用宿主认可的导航入口，避免在未来 shell 改动后退化。

本轮线上证据显示，大多数侧栏点击已经是 `?_rsc=` fetch，不是完整 document navigation。因此它不是当前 Origin 模块最主要卡顿原因。

Origin 侧的剩余动作只保留为 P2 硬化项：把侧栏普通 `<a>` 接入宿主或模块 SDK 的 client navigation 能力，并保留回归测试。

### 2.2 RSC 机制、AppFrame 和 dashboard shell

以下属于宿主框架范围：

- `apps\host-next\app\(dashboard)\dashboard\[[...modulePath]]\page.tsx` 的 dashboard route shell。
- `HostClientTransitionFrame` 和 `ClientTransitionLinks`。
- Next RSC fetch 是否发生、如何和 App Router 协作。
- route metadata 解析、RSC response 包装、dashboard AppFrame 挂载。

旧报告里“RSC 慢”不能整体归为 Origin 模块问题。更准确的表述是：

- 宿主拥有 RSC 路由机制和切页外壳。
- Origin 拥有被序列化进 RSC 的 loaderData 体积，以及生成这些数据的 loader 执行成本。

所以模块 backlog 中保留“减小 loaderData”和“拆分 loader”，移除“修复 RSC 路由机制”。

### 2.3 登录页和营销页阶段的预取 abort

登录阶段出现过若干 `net::ERR_ABORTED`，主要来自登录页、营销页或跳转过程中的预取。登录后核心 dashboard 没有 console error 或 page error。

该项不进入 Origin 模块剩余问题。后续如果要治理，应由宿主登录链路或站点壳层专项处理。

### 2.4 平台级性能观测能力

Server-Timing、route transition smoke、RSC payload 基线、dashboard shell 指标属于平台通用能力。

修订后：

- 宿主负责提供统一指标入口和测试门禁。
- Origin 模块负责在 `loaders/dashboard.ts`、`api/state.ts`、`live-dashboard.ts`、`fetchOriginAgents` 等业务链路中增加可读 span，便于宿主指标聚合。

## 3. Origin AgentOps 剩余模块问题

下面是归因修订后仍属于 Origin 模块的问题，按优先级排列。

### P0. 所有 section 共享全量 dashboard loader

证据：

- `module.ts` 中 `/origin-agentops` 使用 `./loaders/dashboard`。
- `module.ts` 中 `/origin-agentops/[section]` 也使用 `./loaders/dashboard`。
- `loaders/dashboard.ts` 返回 `liveDashboardData(ctx, await originApiState(ctx))`。
- 轻页面如 `members`、`settings`、`usage`、`api-keys` 仍然返回约 117KB 到 120KB 的 RSC payload。

问题：

轻页面不需要完整 dashboard read model，却被迫执行完整聚合。`admin` 页面本页 `/service-connections` API 只有约 0.39s，但 RSC 达到约 13.31s，说明慢点主要在 route loader 或服务端渲染链路，不在该页面自己的列表 API。

建议：

- 拆分 `loaders/dashboard`，至少区分 shell data、overview data、detail data、list data。
- `members/settings/usage/api-keys/admin` 只加载 shell data 和本页必要 counters。
- `agent-detail` 只加载详情页必要数据，不顺带全局 dashboard 大对象。
- loaderData 对轻页面控制在 20KB 内，对重页面控制在 40KB 到 60KB 内。

验收：

- 轻页面模块 loader span P95 小于 500ms。
- 轻页面 RSC 中模块 loaderData 小于 20KB。
- RSC 慢时能从 Server-Timing 区分是宿主 shell 慢还是模块 loader 慢。

### P0. `/state` 是全量 read model，且 mount 后重复请求

证据：

- `api/state.ts` 返回 `liveDashboardData(ctx, await originApiState(ctx))`。
- `AgentOpsApp({ data, section })` 已接收 loader data。
- `AgentOpsApp` mount 后仍无条件请求 `/api/modules/origin-agentops/state`。
- 本轮审计中 `state` 出现 15 次，单次约 72.6KB，常见耗时 3.46s 到 4.90s。

问题：

`state` 名义上像轻量状态接口，实际是全量 dashboard 聚合。它和 route loader 复用同一套重函数，导致切页期间 RSC 与 `/state` 并行抢资源。首屏已有 loader data 时再次请求 `/state`，会把页面稳定时间继续拉长。

建议：

- mount 时默认使用 loader `data`，不要无条件 revalidate。
- `/state` 改成轻量 shell state，只返回 service readiness、少量 badge、最近变更版本号等。
- action 成功、用户手动刷新、窗口 focus 且缓存过期时再触发 revalidate。
- 对同一 URL 做 inflight dedupe，避免并发重复。

验收：

- 首次进入页面后默认不再自动请求全量 `/state`。
- `/api/modules/origin-agentops/state` payload 小于 20KB。
- `/state` 热路径 P95 小于 300ms。

### P1. 页面级 API 与 loader/state 数据职责重叠

证据：

- `AgentsListPage` 请求 `/agents?page=1&pageSize=10`，线上约 2.57s。
- `AgentDetailPage` 请求 `/agents/{agentId}`，线上约 2.38s 到 2.56s。
- `ToolsPage` 请求 `/tools`，线上约 1.26s。
- `ToolHostPage` 请求 `/tool-providers`，线上约 2.93s。
- `RuntimePage` 请求 `/runs?limit=100`，线上约 0.99s。
- `TraceAuditPage` 并发请求 `/traces?limit=100` 和 `/audit?limit=200`，线上各约 1.56s。

问题：

页面级 API 本身可以存在，但当前与全量 loader/state 重叠。用户切页时经常同时等待 RSC、`state`、本页 API 三条链路，导致轻页面也像重页面一样卡。

建议：

- 每个 section 明确唯一首屏数据来源：要么 loader 提供首屏数据，要么页面 API 提供首屏数据，避免同一信息两边都拉。
- loader 只给 shell 和首屏关键字段，列表分页、筛选、排序交给页面 API。
- 页面 API 返回分页摘要，详情和大字段延迟加载。
- 切页时 abort 离开页面后的旧请求。

验收：

- 轻页面单次切页模块 API 数量小于等于 2。
- 重页面单次切页模块 API 数量小于等于 4。
- 页面列表 API P95 小于 800ms。

### P1. Skills 首屏 N+1 versions 请求

证据：

- `SkillsPage` 先请求 `/skills`。
- 随后对 visible skills 调 `loadSkillVersions(skill)`。
- 本轮线上 `skills` 页面出现 6 个 `/skills/{skillId}?action=versions&agentId=...` 并发请求，每个约 3.47s 到 3.65s。

问题：

Skills 首屏列表只有 6 条时已经触发明显 N+1。后续分页、筛选或更多技能会进一步放大。

建议：

- `/skills` 列表接口直接返回当前页所需的稳定版本摘要。
- 只有用户打开版本下拉、点击更新版本或进入详情时，再请求完整 versions。
- 对 versions 按 `skillId + agentId` 做短缓存。
- 翻页、筛选、离开页面时 abort 未完成 versions 请求。

验收：

- 打开 skills 页面首屏 versions 请求数为 0。
- Skills 首屏模块 API 总数小于等于 2。
- Skills 页面首屏 P95 小于 1s。

### P1. `fetchOriginAgents` 列表查询 fan-out detail

证据：

- `liveDashboardData` 调用 `fetchOriginAgents(ctx)`。
- `fetchOriginAgents` 读取 agent list 后，对 `result.agents.map(...)` 并发读取每个 agent 的 version detail。
- 这条链路被 loader 和 `/state` 反复调用。

问题：

列表读和详情读没有拆开。只需要列表摘要时，也会为每个 agent 拉 detail。这会放大 RSC、`state` 和 agent 列表页的成本。

建议：

- `fetchOriginAgents` 默认只返回列表字段。
- 新增 `fetchOriginAgentDetail(agentId, version)` 或等价详情函数。
- `findAgentForApi` 不通过全量 `fetchOriginAgents(ctx)` 查找单个 agent，应走按 ID 读取。
- version detail 按 `agentId + version` 缓存。

验收：

- agent 列表路径不再触发每个 agent 的 detail 请求。
- agent detail 只请求当前 agent 的 detail。
- agent 列表 API P95 小于 800ms。

### P2. Origin API 和 read model 缺少短缓存

证据：

- `originApiState` 每次都走 readiness。
- `liveDashboardData` 每次都聚合 agents、tools、skills、service connections、runs、approvals、usage buckets、audit events。
- 连续切页时，重复请求会在数秒内多次出现。

建议：

- `originApiState('/readyz')` 做 workspace 级 10s 到 30s 缓存。
- `toolsForApi`、`skillsForApi` 按 query 做 5s 到 15s 缓存。
- `liveDashboardData` 在拆分前可先做 5s 短缓存止血。
- action 成功后只失效相关 key，不全量清空。

验收：

- 连续切页时相同 read model 命中缓存。
- action 后相关列表能正确刷新。
- 缓存命中率、miss 原因可观测。

### P2. 侧栏导航应显式接入宿主导航能力

证据：

- `AgentOpsApp` 侧栏仍渲染普通 `<a className="oa-nav-item" href="...">`。
- 当前线上多数点击已被宿主拦截为 RSC client transition。
- 模块内部 `navigateTo` 主要用于 `viewAgent`、`viewRun` 等动作，不覆盖侧栏。

问题：

这不是本轮主要耗时来源，但长期依赖普通 anchor 和宿主兜底不够稳。宿主 shell 或部署方式变化后，可能再次退化成完整 document navigation。

建议：

- 使用宿主或 module SDK 提供的 client navigation 组件或 action。
- 保留 href 作为可访问性和降级能力。
- 增加 smoke：点击侧栏不产生 document navigation。

验收：

- 侧栏点击 document navigation 数量为 0。
- history、语言前缀、dashboard area 均保持正确。

## 4. 修订后的优先级计划

### 第一阶段：先止血

1. 移除 `AgentOpsApp` mount 后无条件全量 `/state`。
2. 给 `liveDashboardData` 和 Origin API 聚合加短缓存与 inflight dedupe。
3. 将 `state` 缩成轻量 shell state。

预期收益：连续切页时少一条 3s 到 5s 的全量 state 请求，减轻服务端并发聚合。

### 第二阶段：拆 loader

1. `module.ts` 为轻页面和重页面分配不同 loader。
2. `members/settings/usage/api-keys/admin` 不再执行完整 `liveDashboardData`。
3. `agent-detail`、`agents`、`skills`、`tools`、`runtime`、`traces` 定义各自首屏数据边界。

预期收益：轻页面 RSC payload 和 loader 耗时明显下降。

### 第三阶段：治理页面 API

1. Skills 去掉首屏 versions N+1。
2. `fetchOriginAgents` 列表与详情拆开。
3. agents/tools/runtime/traces 与 loader/state 去重。
4. 页面离开时 abort 未完成请求。

预期收益：重页面等待链路从三条以上收敛到一到两条。

### 第四阶段：平台协同项

1. 接入宿主导航 API。
2. 为 loader/API 增加业务 span。
3. 与宿主约定 RSC payload、loader span、document navigation 的回归门禁。

预期收益：避免后续回归，并能准确区分宿主慢和模块慢。

## 5. 模块侧验收指标

这些指标只衡量 Origin 模块能直接控制的部分。

| 指标 | 目标 |
| --- | ---: |
| 首屏默认全量 `/state` 请求 | 0 |
| `/api/modules/origin-agentops/state` payload | < 20KB |
| `/state` 热路径 P95 | < 300ms |
| 轻页面模块 loaderData | < 20KB |
| 轻页面模块 loader span P95 | < 500ms |
| 重页面模块 loaderData | < 60KB |
| 页面列表 API P95 | < 800ms |
| Skills 首屏 versions 请求数 | 0 |
| Agent 列表触发 detail fan-out | 0 |
| 单次轻页面切页模块 API 数 | <= 2 |
| 单次重页面切页模块 API 数 | <= 4 |

宿主框架指标应单独记录，例如 document navigation、RSC shell 耗时、AppFrame transition、dashboard route base overhead。不要把这些指标作为 Origin 模块单独达标的口径。

## 6. 证据映射

| 证据 | 说明 | 归因 |
| --- | --- | --- |
| `results.json` 中多数切页慢请求为 `?_rsc=` | 表明切页走宿主 RSC transition | 宿主机制，模块贡献 loaderData |
| `requests.json` 中 `state` 出现 15 次 | 全量 state 重复请求 | Origin 模块 |
| `admin` RSC 约 13.31s，本页 API 约 0.39s | 慢点不在 admin 客户端列表 API | 模块 loader 或宿主 RSC 需进一步分段 |
| `skills` 页面 6 个 versions 请求 | 首屏 N+1 | Origin 模块 |
| RAF 稳定后大多约 16.5ms | 稳定后渲染不是主要瓶颈 | 非 P0 |
| 无 console/page error | 卡顿不是由前端异常重试导致 | 非错误恢复问题 |

## 7. 源码定位

### Origin 模块源码

- `D:\code2\znt\ploykit\modules\origin-agentops\module.ts`
  - `/origin-agentops` 和 `/origin-agentops/[section]` 共用 `./loaders/dashboard`。
  - `/origin-agentops/state` 使用 `./api/state`。
- `D:\code2\znt\ploykit\modules\origin-agentops\loaders\dashboard.ts`
  - `return liveDashboardData(ctx, await originApiState(ctx));`
- `D:\code2\znt\ploykit\modules\origin-agentops\api\state.ts`
  - 返回同一套 `liveDashboardData(...)`。
- `D:\code2\znt\ploykit\modules\origin-agentops\lib\live-dashboard.ts`
  - 聚合 agents、tools、skills、本地表数据。
- `D:\code2\znt\ploykit\modules\origin-agentops\lib\agent-service.ts`
  - `fetchOriginAgents` 对 agent version detail 做 fan-out。
- `D:\code2\znt\ploykit\modules\origin-agentops\components\AgentOpsApp.tsx`
  - 接收 loader data 后仍在 mount 阶段请求 `/state`。
  - 侧栏仍输出普通 `<a>`。
- `D:\code2\znt\ploykit\modules\origin-agentops\pages\skills\SkillsPage.tsx`
  - 首屏对 visible skills 执行 versions 请求。

### 宿主框架源码

- `apps\host-next\app\(dashboard)\dashboard\[[...modulePath]]\page.tsx`
  - dashboard catch-all route、dynamic route、AppFrame、RSC 页面外壳。
- `apps\host-next\lib\client-transition-links.ts`
  - 宿主 client transition 的链接判断与拦截逻辑。
- `src\lib\module-runtime\ui\page-renderer.ts`
  - 将 module page props、loaderData、metadata 注入宿主页面。
- `src\lib\module-runtime\adapters\page-route.ts`
  - 解析 route loader 和 metadata。
- `src\lib\module-runtime\host\create-module-host.ts`
  - `resolvePageRoute` 与 `resolvePageRouteMetadata`。

## 8. 新文档口径

后续沟通建议使用下面这组表述：

- 不再说“Origin 的 RSC 导航有问题”，改为“宿主 RSC transition 中携带的 Origin loaderData 过重，且 Origin loader 执行链路过长”。
- 不再说“侧栏点击整页刷新是 Origin 当前 P0”，改为“当前线上大多已是宿主 client transition，Origin 侧保留显式接入导航 API 的 P2 硬化项”。
- 不再把 `admin` 的 13.31s 直接归因到 admin 页面 API，改为“admin 本页 API 很快，慢点在 route loader 或宿主 RSC shell，需要 Server-Timing 分段；已知 Origin 全量 dashboard loader 是高概率模块侧贡献因素”。
- 不再把登录页 abort 计入 Origin dashboard 性能问题。
- 模块优化目标聚焦在 loaderData、`/state`、页面 API、N+1、fan-out 和短缓存。

这样拆分后，Origin AgentOps 的剩余问题是清晰且可执行的：先减少重复全量请求，再拆全量 loader，最后治理页面 API 和 N+1。宿主框架问题则独立进入平台验证清单，避免两边互相背锅。
