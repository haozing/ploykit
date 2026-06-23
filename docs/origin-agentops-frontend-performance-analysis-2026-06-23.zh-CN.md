# Origin AgentOps 前端性能分析

分析日期：2026-06-23
分析对象：`https://aijia.yingasi.com/zh/login?next=%2Fdashboard%2Forigin-agentops%2Fagent-detail` 登录后的 `Origin AgentOps` Dashboard
账号：使用用户提供的管理员账号完成真实登录，报告不记录密码
主要证据目录：`.runtime/origin-agentops-perf-audit/run-2026-06-23T00-52-32-402Z`
审计脚本：`.runtime/origin-agentops-perf-audit/audit-origin-agentops.mjs`
源码参考：`D:\code2\znt\ploykit\modules\origin-agentops`。当前工作区 `D:\code2\ploykit` 没有 `modules/origin-agentops` 源码，因此本报告对该外部目录只读分析。

## 1. 总结

这次线上复测显示，页面卡顿的主因已经不是稳定后的滚动掉帧，也不是静态资源下载，而是路由切换期间的服务端 RSC 请求、模块全局 `state` 接口、以及页面子组件二次接口请求叠加。页面稳定后 RAF 帧率基本正常，最长帧大多约 16.8ms，只有 `admin` 抽样最高 33.4ms，未发现 console error 或 page error。

和 2026-06-14/06-16 的旧报告相比，线上侧栏点击行为有明显变化：大多数侧栏导航现在是 Next client transition，浏览器发起的是 `?_rsc=` fetch，而不是完整 document navigation。旧报告中“点击 agents/skills/tools 触发完整 document navigation”的问题在这轮侧栏点击里大体缓解。但是新的瓶颈依然很重：每次切页仍要等一个约 118KB 到 120KB 的 RSC payload，耗时通常 3.6s 到 6.5s，`admin` 页面 RSC 最慢达到 13.3s。

最重要的根因链路是：

1. `module.ts` 给 `/origin-agentops` 和 `/origin-agentops/[section]` 都配置同一个 `loaders/dashboard`。
2. `loaders/dashboard.ts` 每次路由都执行 `liveDashboardData(ctx, await originApiState(ctx))`。
3. `api/state.ts` 也执行同一套 `liveDashboardData(...)`。
4. `AgentOpsApp` 首屏已经拿到 loader 的 `data`，但组件挂载后又无条件请求 `/api/modules/origin-agentops/state`。
5. 各页面进入后再请求本页列表或详情接口，例如 `/agents`、`/tools`、`/runs`、`/traces`、`/audit`，`skills` 页还对可见 6 条技能并发请求 6 个版本接口。

因此用户体感是：点击菜单后主界面已经不是传统整页刷新，但仍要等 RSC 和 API 返回，按钮高亮、表格、详情和统计区域才稳定。

## 2. 采集方法

审计脚本使用 Playwright Chromium，桌面视口 `1440x920`，真实登录后依次打开或点击：

`agent-detail`、`overview`、`agents`、`skills`、`tools`、`toolhost`、`admin`、`runtime`、`approvals`、`traces`、`usage`、`api-keys`、`members`、`settings`。

采集内容：

- Playwright network request、status、duration、response size。
- Navigation timing、resource timing、paint timing。
- Long Task、layout shift、event timing。
- JS heap、DOM 节点数量。
- 2.5 秒滚动 RAF 抽样。
- 每页 full page screenshot。

注意：脚本中的 `wallTimeMs` 包含等待网络空闲和截图的保守 settle 时间，不直接等同用户看到首屏的时间。判断卡顿时，本报告优先看每个页面的慢 RSC/API 请求和可视页面截图。

## 3. 线上实测概览

| 页面 | 切换方式 | 慢 RSC/document | 慢 state | 主要本页 API | DOM 节点 | 结论 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 登录到 agent-detail | login | document 3.70s, 160.6KB | 4.79s, 72.6KB | agent detail 2.56s | 561 | 首次进入被 document、state、详情三段叠加 |
| overview | click | RSC 3.63s, 117.4KB | 3.46s | 无 | 677 | 首屏 RSC 与 state 并行，仍需 3s 级 |
| agent-detail | goto | document 3.61s | 4.90s | agent detail 2.38s | 561 | 直接打开详情仍是重路径 |
| agents | click | RSC 3.62s, 118.4KB | 未单独观测 | agents 2.57s | 642 | RSC 和列表接口叠加 |
| skills | click | RSC 3.63s, 117.4KB | 未单独观测 | skills 2.11s，6 个 versions 约 3.47s 到 3.65s | 554 | 明确 N+1 版本请求 |
| tools | click | RSC 4.84s, 118.0KB | 4.08s | tools 1.26s | 712 | RSC、state、列表三段叠加 |
| toolhost | click | RSC 6.54s, 117.4KB | 未单独观测 | tool-providers 2.93s | 538 | RSC 慢，列表接口也慢 |
| admin | click | RSC 13.31s, 117.9KB | 未单独观测 | service-connections 0.39s | 587 | 当前最慢页面，问题集中在 RSC/loader |
| runtime | click | RSC 5.83s, 117.9KB | 3.91s | runs 0.99s | 824 | 页面较重，RSC/state 是主瓶颈 |
| approvals | click | RSC 5.58s, 117.4KB | 4.17s | 无 | 453 | 页面数据主要被全局 state 拖慢 |
| traces | click | RSC 4.31s, 117.9KB | 4.16s | traces 1.56s, audit 1.56s | 776 | 三路并发请求，稳定前等待明显 |
| usage | click | RSC 3.87s, 118.1KB | 3.67s | 无 | 353 | 轻页面仍被 RSC/state 拖慢 |
| api-keys | click | RSC 3.75s, 117.4KB | 3.59s | api-keys 0.37s | 302 | 本页 API 快，瓶颈在全局数据 |
| members | click | RSC 3.81s, 117.4KB | 3.76s | 无 | 322 | 本应很轻，却仍走全局重路径 |
| settings | click | RSC 3.80s, 118.0KB | 3.62s | 无 | 357 | 本应很轻，却仍走全局重路径 |

辅助观察：

- 静态 `_next/static/chunks` 在后续切换里基本是缓存命中，不是这轮主要瓶颈。
- `state` 在本轮请求中出现 15 次，单次约 72.6KB，耗时多在 3.46s 到 4.90s。
- RSC payload 常见约 118KB 到 120KB，轻页面也返回类似体积，说明路由级 RSC 携带了大量跨页面数据。
- `admin` 页面虽然本页 `/service-connections` API 只有 0.39s，但 RSC 耗时 13.31s，说明慢点不在该页面的客户端列表请求，而更可能在路由 loader 或服务端渲染路径。
- 登录页阶段出现若干 `net::ERR_ABORTED` 的营销/登录页 RSC 预取，登录后核心页面没有 console error 或 page error。

## 4. 渲染与交互情况

稳定后的滚动 RAF 表现良好：

- 大多数页面 `avgFrameMs` 约 16.5ms。
- 大多数页面 `maxFrameMs` 约 16.8ms。
- 未观测到 `framesOver50Ms` 或 `framesOver100Ms`。

Long Task：

- 登录进入目标页：2 个 long task，总计约 124ms，最大约 65ms。
- overview：1 个 long task，约 324ms。
- toolhost：1 个 long task，约 51ms。
- 其他页面未观测到明显 long task。

这说明“卡”的主要体感来自等待网络和服务端响应，不是页面稳定后的持续主线程堵塞。不过 overview 的 324ms long task 仍值得看，可能来自 RSC 应用、大量 DOM 更新或 chart/table 初始渲染。

## 5. 源码定位

### 5.1 路由 loader 对所有 section 使用同一套全量 dashboard loader

`D:\code2\znt\ploykit\modules\origin-agentops\module.ts`

- line 395：`/origin-agentops` 使用 `./loaders/dashboard`。
- line 396：`/origin-agentops/[section]` 也使用 `./loaders/dashboard`。
- line 402：`/origin-agentops/state` API 使用 `./api/state`。

`D:\code2\znt\ploykit\modules\origin-agentops\loaders\dashboard.ts`

- line 6：`return liveDashboardData(ctx, await originApiState(ctx));`

`D:\code2\znt\ploykit\modules\origin-agentops\api\state.ts`

- line 7：`return ctx.json({ ok: true, data: await liveDashboardData(ctx, await originApiState(ctx)) });`

结论：路由 RSC 和客户端 `/state` API 都在执行同一个重聚合函数。即使用户打开 `members`、`settings`、`usage` 这类轻页面，也会走完整 dashboard read model。

### 5.2 `liveDashboardData` 是全量聚合，不是轻量状态

`D:\code2\znt\ploykit\modules\origin-agentops\lib\live-dashboard.ts`

- line 64：`liveDashboardData` 入口。
- line 67：先 `fetchOriginAgents(ctx)`。
- line 75：并发 `toolsForApi(ctx)` 和 `skillsForApi(ctx)`。
- line 82 到 86：再读 `service_connections`、`runs`、`approvals`、`usage_buckets`、`audit_events`，其中多个 limit 为 100。

`D:\code2\znt\ploykit\modules\origin-agentops\lib\agent-service.ts`

- line 48：`fetchOriginAgents`。
- line 81：对 `result.agents.map(...)` 做并发详情读取。
- line 84 到 90：每个 agent 再调 `/v1/agents/{id}/versions/{version}/detail`。

结论：一次 `state` 或一次 route loader 会放大成多次 Origin API 和本地表查询。当前数据量不大时已经 3s 到 5s，数据变多后会进一步变差。

### 5.3 客户端已有 loader data，却挂载后再次拉 `/state`

`D:\code2\znt\ploykit\modules\origin-agentops\components\AgentOpsApp.tsx`

- line 2451：`AgentOpsApp({ data, section })` 接收 loader data。
- line 2471：`refresh()` 调 `/api/modules/origin-agentops/state`。
- line 2478：组件 mount 后无条件再 `requestJson(.../state)`。

结论：首屏 RSC 已带了 `data`，客户端挂载后再次拉全量 `state`。这会造成首屏稳定时间变长，也解释了线上切换中反复看到 `state` 秒级请求。

### 5.4 子页面进入后再拉本页列表或详情

这些二次请求有业务合理性，但目前和全量 loader/state 叠加，导致切页体验变差。

代表性代码：

- Agents：`pages/agents/AgentsListPage.tsx` line 112 请求 `/agents?page=1&pageSize=10`。
- Agent detail：`pages/agents/detail/AgentDetailPage.tsx` line 87 请求 `/agents/{agentId}`。
- Tools：`pages/tools/ToolsPage.tsx` line 129 请求 `/tools?...`。
- ToolHost：`pages/toolhost/ToolHostPage.tsx` line 129 请求 `/tool-providers?...`。
- Service Connections：`pages/connections/ServiceConnectionsPage.tsx` line 70 请求 `/service-connections`。
- Runtime：`pages/runtime/RuntimePage.tsx` line 73 请求 `/runs?limit=100`。
- Traces：`pages/traces/TraceAuditPage.tsx` line 86 和 87 并发请求 `/traces?limit=100` 与 `/audit?limit=200`。

### 5.5 Skills 页存在明确 N+1 版本请求

`D:\code2\znt\ploykit\modules\origin-agentops\pages\skills\SkillsPage.tsx`

- line 159：先请求 `/skills`。
- line 191：定义 `loadSkillVersions`。
- line 214 到 216：对 visible 的每个 skill 调 `loadSkillVersions(skill)`。

对应线上证据：`skills` 页面一次进入后出现 6 个 `/api/modules/origin-agentops/skills/{skillId}?action=versions&agentId=...` 并发请求，每个约 3.47s 到 3.65s。页面只有 6 条技能时已经明显，后续分页或筛选后仍可能重复触发。

### 5.6 模块内部侧栏仍是普通 `<a>`

`D:\code2\znt\ploykit\modules\origin-agentops\components\AgentOpsApp.tsx`

- line 286：侧栏菜单渲染为 `<a className="oa-nav-item" href="/dashboard/origin-agentops/...">`。
- line 2571：`navigateTo` 使用 `window.history.pushState`，但它只用于 `viewAgent`、`viewRun` 等模块内部动作，不用于侧栏菜单点击。

本轮线上侧栏点击大多已经由宿主/Next 转成 RSC client transition，所以不再表现为完整 document navigation。但模块仍依赖普通 anchor 和宿主兜底，不是最稳妥的长期方案。建议接入宿主导航组件、模块 SDK navigate 能力或 Next Link 能力，避免未来部署或 shell 变化后再次退化。

## 6. 根因判断

### P0：RSC/loader 过重，轻页面也走全量 dashboard 数据

证据：

- `admin` RSC 13.31s，`service-connections` 本页 API 仅 0.39s。
- `members`、`settings`、`usage` 等轻页面仍返回约 118KB RSC，并等待约 3.8s。
- 所有 section 共享 `loaders/dashboard`。

判断：这是当前最大瓶颈。即使优化客户端页面 API，只要 section route 仍统一跑 `liveDashboardData`，轻页面仍会慢。

### P1：`state` 接口太重且重复

证据：

- 本轮 `state` 观测 15 次，常见耗时 3.46s 到 4.90s，约 72.6KB。
- `AgentOpsApp` 已有 loader data，仍在 mount 后无条件请求 `/state`。
- `state` 与 loader 复用同一个 `liveDashboardData`。

判断：`state` 不是状态轻接口，而是全量 read model。它被当作页面公共依赖后，成为跨页面共同瓶颈。

### P1：页面级二次请求和 N+1 放大等待时间

证据：

- `agents`：RSC 3.62s + `/agents` 2.57s。
- `tools`：RSC 4.84s + `state` 4.08s + `/tools` 1.26s。
- `traces`：RSC 4.31s + `state` 4.16s + `/traces` 1.56s + `/audit` 1.56s。
- `skills`：`/skills` 2.11s + 6 个 versions 请求 3.47s 到 3.65s。

判断：页面本身不是不能局部取数，但需要和 loader/state 明确分层、去重和懒加载。

### P2：服务调用链缺少短缓存和请求去重

证据：

- `originApiState` 每次都调 `/readyz`。
- `liveDashboardData` 每次都调 `fetchOriginAgents`、tools、skills 和多张本地表。
- `fetchOriginAgents` 每次 agent list 后又调每个 agent 的 version detail。

判断：同一 workspace、同一用户在数秒内连续切页面，应命中短缓存或 request scoped cache，而不是重跑全量外部服务聚合。

### P2：当前导航依赖宿主兜底

证据：

- 侧栏仍输出普通 `<a>`。
- 2026-06-14/06-16 旧报告曾记录线上完整 document navigation。
- 本轮侧栏大多是 RSC client transition，说明线上行为有所改善，但模块自身仍没有明确使用 client navigation API。

判断：导航问题不是本轮最主要耗时，但仍应治理，避免回归。

## 7. 优化建议

### 7.1 拆分 loader 和 state

建议把当前 `liveDashboardData` 拆成多层：

- `loadShellData`：侧栏 badge、workspace、service readiness、少量 counters，目标小于 20KB。
- `loadOverviewData`：概览页专用统计、建议、最近运行、最近审批。
- `loadAgentDetailData(agentId)`：详情页专用。
- `loadSectionListData(section, query)`：列表页专用，遵循分页、排序、筛选。
- `loadStateData`：仅用于 action 后刷新，不再作为每个页面 mount 的默认 revalidate。

验收目标：

- `members/settings/usage/api-keys` 等轻页面 RSC P95 小于 800ms。
- RSC payload 小于 40KB，轻页面小于 20KB。
- `/api/modules/origin-agentops/state` 热路径 P95 小于 300ms，payload 小于 20KB。

### 7.2 去掉 mount 后无条件全量 `/state`

建议：

- `AgentOpsApp` 初始使用 loader `data`。
- mount 后不再无条件拉 `/state`。
- 只有以下场景 revalidate：用户点击刷新、action 成功、窗口重新 focus 且缓存过期、SSE/后台事件通知。
- 使用 SWR/TanStack Query 或模块内简单 inflight map，保证同一 URL 同一时刻只发一次。

### 7.3 对 Origin API 和本地 read model 做短缓存

建议缓存层级：

- `originApiState('/readyz')`：workspace 级 10s 到 30s 短缓存。
- `fetchOriginAgents`：列表和详情拆开，列表 5s 到 15s 缓存；版本 detail 按 agentId/version 缓存。
- `toolsForApi`、`skillsForApi`：按 query 缓存，action 后局部失效。
- `liveDashboardData`：如短期还不能拆分，至少对完整结果做 5s workspace/user 级缓存，防止连续切页反复聚合。

### 7.4 修复 Skills N+1

优先方案：

- `/skills?page=1&pageSize=10` 返回当前页每个 skill 的稳定版本与可选版本摘要，移除首屏 6 个 versions 请求。

替代方案：

- 只有用户打开版本下拉或点击“更新版本”时才请求 `/skills/{id}?action=versions`。
- 对版本请求做 per-skill cache。
- 翻页或筛选时 abort 上一批 versions 请求，避免离开页面后仍更新 state。

验收目标：

- 打开 skills 页首屏 API 数量小于等于 2。
- skills 页首屏 P95 小于 1s。

### 7.5 优化 Agent detail 读取

建议：

- `fetchOriginAgents` 不应为了列表或全局 state 给每个 agent 拉 version detail。
- 列表接口只返回列表字段，详情页再按需读取完整 detail。
- `findAgentForApi` 不应通过 `fetchOriginAgents(ctx)` 全量查找 agent，应该直接走 `/v1/agents/{id}` 或当前 `originAgentReadModel`。

### 7.6 控制 RSC payload

建议：

- 不要把完整 `AgentOpsDashboardData` 作为所有 section 的 props。
- 对 RSC 返回字段做页面级裁剪。
- 大列表只返回当前页摘要，详情面板延迟取完整数据。
- 图表和审计详情按需加载，不进入所有页面的通用 loader。

### 7.7 导航显式接入 client transition

建议：

- 把侧栏 `<a className="oa-nav-item">` 改为宿主/模块 SDK 提供的 client navigation 组件或 action。
- 如必须保留 `<a>`，也要保证宿主 AppFrame/client-transition marker 在线上有回归测试。
- 保留 dashboard transition smoke：断言点击侧栏不产生 document navigation。

### 7.8 增加服务端性能观测

建议在下面位置加 span 或 Server-Timing：

- `loaders/dashboard.ts`：总耗时、`originApiState`、`liveDashboardData`。
- `live-dashboard.ts`：agents、tools、skills、本地表查询分段。
- `fetchOriginAgents`：agent list、每个 version detail fan-out 数量和耗时。
- `api/state.ts`：payload size、cache hit/miss。
- 页面 API：`/skills/{id}?action=versions`、`/tools`、`/tool-providers`、`/runs`、`/traces`、`/audit`。

## 8. 建议的优先级排期

P0：

1. 拆 `loaders/dashboard`，至少让 `members/settings/usage/api-keys/admin` 不再跑完整 `liveDashboardData`。
2. 移除 `AgentOpsApp` mount 后无条件 `/state`。
3. 给 `originApiState` 和 `liveDashboardData` 加 5s 到 15s 短缓存，作为拆分前的止血。

P1：

1. 修复 Skills N+1 版本请求。
2. 将 agents/tools/runtime/traces 的页面 API 与 loader 数据去重，首屏只保留一条权威数据路径。
3. 优化 `fetchOriginAgents`，列表不 fan-out detail。

P2：

1. 侧栏导航改为明确 client navigation。
2. 增加 Server-Timing 和线上 smoke gate。
3. 对大表和详情面板做虚拟化或懒加载。当前 DOM 节点 300 到 824 不算夸张，优先级低于网络和服务端。

## 9. 验收标准

建议把以下指标加入回归：

| 指标 | 目标 |
| --- | ---: |
| 侧栏 route transition document navigation | 0 |
| 轻页面 RSC P95 | < 800ms |
| 重页面 RSC P95 | < 1500ms |
| `/api/modules/origin-agentops/state` 热路径 P95 | < 300ms |
| `/state` payload | < 20KB |
| 单次 route transition API 数量 | 轻页面 <= 2，重页面 <= 4 |
| Skills 首屏 versions 请求 | 0 |
| Long task | P95 < 100ms |
| Console/page error | 0 |

复测命令：

```powershell
$env:ORIGIN_AGENTOPS_PASSWORD='<由操作者本地提供>'
node .runtime\origin-agentops-perf-audit\audit-origin-agentops.mjs
```

复测时重点比较：

- `results.json` 中 `requestSummary.slowest` 的 RSC 与 API 耗时。
- `requests.json` 中 `/api/modules/origin-agentops/state` 的出现次数。
- `network.har` 中 `?_rsc=` payload size。
- 页面截图是否仍为真实 dashboard 页面。

## 10. 证据附件

本轮实测：

- `.runtime/origin-agentops-perf-audit/run-2026-06-23T00-52-32-402Z/results.json`
- `.runtime/origin-agentops-perf-audit/run-2026-06-23T00-52-32-402Z/requests.json`
- `.runtime/origin-agentops-perf-audit/run-2026-06-23T00-52-32-402Z/network.har`
- `.runtime/origin-agentops-perf-audit/run-2026-06-23T00-52-32-402Z/01-login-to-agent-detail.png`
- `.runtime/origin-agentops-perf-audit/run-2026-06-23T00-52-32-402Z/05-switch-skills.png`
- `.runtime/origin-agentops-perf-audit/run-2026-06-23T00-52-32-402Z/08-switch-admin.png`
- `.runtime/origin-agentops-perf-audit/run-2026-06-23T00-52-32-402Z/11-switch-traces.png`

历史参考：

- `D:\code2\ploykit-host-push-20260617\docs\origin-agentops-module-performance-analysis-2026-06-14.zh-CN.md`

源码参考：

- `D:\code2\znt\ploykit\modules\origin-agentops\module.ts`
- `D:\code2\znt\ploykit\modules\origin-agentops\loaders\dashboard.ts`
- `D:\code2\znt\ploykit\modules\origin-agentops\api\state.ts`
- `D:\code2\znt\ploykit\modules\origin-agentops\lib\live-dashboard.ts`
- `D:\code2\znt\ploykit\modules\origin-agentops\lib\agent-service.ts`
- `D:\code2\znt\ploykit\modules\origin-agentops\components\AgentOpsApp.tsx`
- `D:\code2\znt\ploykit\modules\origin-agentops\pages\skills\SkillsPage.tsx`
