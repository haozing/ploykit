# Origin AgentOps 模块性能分析

分析日期：2026-06-14
分析对象：线上 `https://aijia.yingasi.com/dashboard/origin-agentops/*` 中 `origin-agentops` 模块相关页面和接口
关联主报告：[PloyKit 全量代码分析报告](production-grade-code-analysis-2026-06-14.zh-CN.md)

本文只记录模块侧问题。宿主 Dashboard shell、Next.js route、hydration、metadata 重复解析、静态资源缓存等问题归入主报告的宿主章节。

## 1. 结论

线上真实性能问题由宿主和模块共同造成。模块侧最明确的问题有两类：`origin-agentops` 的状态接口和列表接口在 dashboard 路由切换期间被频繁调用且耗时明显偏高；模块内部左侧导航当前渲染为 `.oa-nav-item` 普通锚点，本轮线上复测点击 `agents -> skills -> tools` 仍触发完整 document navigation，导致切换耗时约 5.0-5.8 秒。宿主本轮已新增 AppFrame 内普通锚点 client transition 兜底，并进一步为 `shell.chrome='none'` 全屏模块页增加 host client-transition frame；本地 Origin AgentOps strict smoke 已验证普通 `<a>` 可被接管，8/8 transition document navigation=0，P95 198ms。2026-06-16 线上 required repeat 复测和 `--inject-anchor` 对照仍失败，增强诊断显示线上页面未暴露当前宿主的 `data-host-app-frame` / `data-host-client-transition-links` 标记。按主报告停止线，宿主仓库侧修复已收口；模块侧接入宿主 Link/navigate 能力、模块 API 优化和线上复测都进入后续模块 backlog，不作为本轮继续修复项。

实测最慢模块请求：

| 请求                                  |      观测耗时 | 触发场景                        | 判断             |
| ------------------------------------- | ------------: | ------------------------------- | ---------------- |
| `/api/modules/origin-agentops/state`  | 约 1.7-2.5 秒 | 多个 dashboard 路由切换都会触发 | 模块级 P1        |
| `/api/modules/origin-agentops/skills` |    约 1.28 秒 | 从 skills 切到 tools 期间仍出现 | 模块级 P1/P2     |
| `/api/modules/origin-agentops/agents` |    约 0.62 秒 | agents 页面加载或切回 agents    | 模块级 P2        |
| `/api/modules/origin-agentops/runs`   |    约 0.31 秒 | runtime 页面后续取数            | 可接受但仍应观测 |

这些接口即使不负责完整 document 约 3 秒的宿主渲染，也会明显拖慢页面稳定时间。尤其是 `state` 接口几乎是跨页面公共依赖，应优先治理。

本轮复测补充：

- `npm run host:dashboard-transition-smoke -- --base-url https://aijia.yingasi.com --routes /dashboard/origin-agentops/agents,/dashboard/origin-agentops/skills,/dashboard/origin-agentops/tools --max-p95-ms 10000` 已真实登录执行。
- 结果：登录成功，页面截图正常，无 console/page/network 错误，未捕获 hydration error。
- 失败点：`agents -> skills` 5775ms 且产生 1 次 document navigation；`skills -> tools` 5024ms 且产生 1 次 document navigation；transition document navigation 合计 2。
- 额外 Playwright 探针确认目标链接存在，DOM 形态为 `<a class="oa-nav-item" href="/dashboard/origin-agentops/...">`，未观察到模块内部导航使用宿主 `next/link` 或显式 client transition wrapper。
- 宿主本地补充验证：`npm run host:dashboard-transition-smoke -- --base-url http://localhost:3000 --routes /zh/dashboard,/zh/dashboard/workspaces,/zh/dashboard/files --inject-anchor --max-p95-ms 5000` 通过，AppFrame 内注入普通 `<a>` 后 document navigation 为 0，hydration error 为 0，P95 277ms。该证据证明宿主兜底路径可行，但不等于线上 `origin-agentops` 已修复。

2026-06-16 复测补充：

- `npm run host:dashboard-transition-smoke -- --required --base-url https://aijia.yingasi.com --routes /dashboard/origin-agentops/agents,/dashboard/origin-agentops/skills,/dashboard/origin-agentops/tools --repeat 3 --max-p95-ms 1000` 已真实登录执行，失败：8/8 次 transition 均产生完整 document navigation，P50 2666ms、P95 2968ms，hydrationErrors=0。
- `npm run host:dashboard-transition-smoke -- --required --base-url https://aijia.yingasi.com --routes /dashboard/origin-agentops/agents,/dashboard/origin-agentops/skills,/dashboard/origin-agentops/tools --repeat 3 --inject-anchor --max-p95-ms 1000` 对照失败：8/8 次 transition 均产生完整 document navigation，P95 3737ms，hydrationErrors=0。
- 增强后的短复测写入页面诊断：`appFramePresent=false`、`clientTransitionMarkerPresent=false`。这说明线上页面没有当前本地宿主 AppFrame/client-transition 诊断标记，注入锚点没有落在 `[data-host-app-frame]` 内，因此当前证据更偏向线上宿主产物未更新或 shell DOM 未按当前 AppFrame 输出，而不能把本地兜底声明为线上已生效。后续脚本与 RC gate 已把 `shell:app-frame`、`shell:client-transition-marker` 和 `shell:injected-anchor-frame` 升级为硬检查。
- 本地当前 standalone 强对照通过：`npm run host:dashboard-transition-smoke -- --required --base-url http://localhost:3000 --routes /zh/dashboard,/zh/dashboard/workspaces,/zh/dashboard/files --repeat 3 --inject-anchor --max-p95-ms 5000`，8/8 transition、2 次 reset transition、transitionDocumentNavigations=0、hydrationErrors=0、P95 183ms，`appFramePresent=true`、`clientTransitionMarkerPresent=true`、`injectedAnchorInAppFrame=true`，证据目录 `.runtime/dashboard-transition-smoke/2026-06-16T08-30-20-238Z`。
- 线上 `--no-latest` 再复测仍失败，不覆盖本地 RC gate latest：`npm run host:dashboard-transition-smoke -- --required --base-url https://aijia.yingasi.com --routes /dashboard/origin-agentops/agents,/dashboard/origin-agentops/skills,/dashboard/origin-agentops/tools --repeat 3 --inject-anchor --max-p95-ms 1000 --no-latest`，8/8 次 transition 均产生完整 document navigation，P95 4887ms，`appFramePresent=false`、`clientTransitionMarkerPresent=false`、`injectedAnchorInAppFrame=false`，证据目录 `.runtime/dashboard-transition-smoke/2026-06-16T08-37-06-949Z`。
- 线上模块包已可线下验证并完成仓库侧修复：将 `modules/origin-agentops.zip` 安装为 `modules/origin-agentops` 后，`npm run module:doctor -- modules\origin-agentops` 0 error/0 warning，`npm run module:test -- modules\origin-agentops --summary` 通过，fake-host smoke 12/12；`npm run modules:scan` 和 `npm run modules:check` 通过，host boundary 当前扫描 770 个文件/8 个模块。带本地 memory runtime env 的 `npm run host:build` 通过。修复前页面级本地 smoke 能登录并打开 `/zh/dashboard/origin-agentops/{agents,skills,tools}` 与 `/dashboard/origin-agentops/{agents,skills,tools}`，截图正常，但 strict transition 显示 8/8 transition document navigation、hydrationErrors=0、P95 约 0.76s、`appFramePresent=false`、`clientTransitionMarkerPresent=false`、`injectedAnchorInAppFrame=false`，证据目录 `.runtime/dashboard-transition-smoke/2026-06-16T10-05-37-426Z`、`.runtime/dashboard-transition-smoke/2026-06-16T10-14-05-695Z`。随后 host 在 `shell.chrome='none'` 全屏模块外层增加 client-transition frame，复跑 `/dashboard/origin-agentops/{agents,skills,tools}` 和 `/zh/dashboard/origin-agentops/{agents,skills,tools}` strict smoke 均通过；latest 证据 `.runtime/dashboard-transition-smoke/2026-06-16T10-35-10-955Z` 显示 8/8 transition、2 次 reset transition、transitionDocumentNavigations=0、hydrationErrors=0、P95 198ms，`appFramePresent=true`、`clientTransitionMarkerPresent=true`、`injectedAnchorInAppFrame=true`；`npm run release:maintainer-gate` 读取该 latest evidence 后通过。
- 证据目录：`.runtime/dashboard-transition-smoke/2026-06-16T07-00-09-417Z`、`.runtime/dashboard-transition-smoke/2026-06-16T07-02-56-693Z`、`.runtime/dashboard-transition-smoke/2026-06-16T07-08-41-933Z`、`.runtime/dashboard-transition-smoke/2026-06-16T08-30-20-238Z`、`.runtime/dashboard-transition-smoke/2026-06-16T08-37-06-949Z`、`.runtime/dashboard-transition-smoke/2026-06-16T10-05-37-426Z`、`.runtime/dashboard-transition-smoke/2026-06-16T10-14-05-695Z`、`.runtime/dashboard-transition-smoke/2026-06-16T10-30-45-043Z`、`.runtime/dashboard-transition-smoke/2026-06-16T10-31-05-917Z`、`.runtime/dashboard-transition-smoke/2026-06-16T10-35-10-955Z`。

## 2. 线上观察

已使用真实账号登录线上页面，并确认进入 `Origin AgentOps` Dashboard。登录后左侧导航包含：

- 概览
- 智能体
- 技能
- 工具
- 企业工具服务
- 服务连接
- 运行记录
- 待审批
- 追踪与审计
- 用量
- API Keys
- 成员
- 设置

路由切换期间，浏览器网络瀑布显示模块 API 与宿主 document 请求并行或交错出现。静态 `_next/static/chunks` 在切换时基本为缓存命中，模块请求和 document 请求才是主要耗时来源。

本轮复测截图：

- `.runtime/dashboard-transition-smoke/2026-06-14T10-01-57-219Z/dashboard-origin-agentops-skills.png`
- `.runtime/dashboard-transition-smoke/2026-06-14T10-01-57-219Z/dashboard-origin-agentops-tools.png`

两张截图均为正常模块页面，不是登录页、错误页或空白页。

## 3. 模块侧责任边界

属于模块侧的问题：

1. 模块 API 响应慢，例如 `/api/modules/origin-agentops/state` 稳定达到秒级。
2. 模块页面或客户端组件在每次路由切换时重复拉取全局状态。
3. 页面离开后仍可能完成上一页接口请求，例如切离 `skills` 后仍观察到 `/api/modules/origin-agentops/skills` 返回。
4. 列表接口可能缺少分页、字段裁剪、聚合缓存或索引。
5. 模块内部导航当前表现为普通锚点 `.oa-nav-item`，本轮线上复测仍触发完整 document navigation。宿主已新增 AppFrame 内普通锚点兜底并本地验证通过，但模块仍应改用宿主提供的 Link/client transition 能力，或由宿主给模块暴露可用的导航组件/动作；兜底只能防生产退化，不应成为模块长期导航架构。
6. 模块输出可能包含服务端/客户端不一致文本，例如相对时间、当前时间、随机值、用户 locale 差异；如果这些输出参与 hydration，可能触发 React #418。最终是否由模块输出导致，需要模块源码和 production source map/服务端日志进一步确认；本轮 smoke 未复现 hydration error。

不属于模块侧单独负责的问题：

1. Dashboard catch-all route 使用 `force-dynamic`。
2. 宿主 `generateMetadata` 和页面主体重复 `resolvePageRoute`。
3. 宿主 shell 串行读取 workspace、profile、theme、navigation。
4. 宿主需要提供 `next/link` 退化为完整 document navigation 的兜底和回归测试；本轮宿主已完成本地普通锚点兜底验证，但线上部署后仍需复测。模块内部如果直接输出普通 `<a>`，也必须由模块或模块 SDK 接入 client transition，避免把生产体验完全寄托在宿主补丁上。
5. `/brand/mark.png` 缓存策略。

## 4. 需要模块优先排查的接口

### 4.1 `/api/modules/origin-agentops/state`

风险级别：P1。

原因：

- 多个路由切换都会触发。
- 实测约 1.7-2.5 秒。
- 它看起来是模块全局状态接口，若每个页面都依赖它，会成为所有页面的共同瓶颈。

建议排查：

- 记录接口内部 span：认证、workspace scope、agent count、skill count、tool count、approval count、usage、service connection、audit/risk、commercial/entitlement。
- 检查是否一次请求聚合了过多 dashboard badge、统计卡片、侧边栏 badge 和当前页无关数据。
- 对稳定统计做 workspace 级短缓存，例如 5-15 秒。
- 对审批数、运行中数等高频变化字段单独接口或后台推送，不要阻塞主状态。
- 检查数据库索引：`product_id`、`workspace_id`、`status`、`agent_id`、`updated_at`、`created_at`、`run_status`、`approval_status`。
- 返回字段做裁剪，避免把完整 agent/tool/skill/runs 明细塞进 state。

验收：

- 热路径 P95 小于 300ms。
- 返回 payload 保持在必要字段内。
- 同一 workspace 连续切换路由时 state 请求应命中短缓存或被去重。

### 4.2 `/api/modules/origin-agentops/agents`

风险级别：P2。

原因：

- 实测约 0.62 秒。
- agents 页面列表只有 2 条数据，但接口仍超过半秒，应确认是否做了过多关联查询或统计聚合。

建议排查：

- 列表接口默认分页，服务端只返回当前页。
- agent 行上的技能数、工具数、最近运行、版本信息可以批量聚合，避免 N+1。
- 页面初始渲染所需字段与详情弹窗字段分离。
- 删除、运行、查看等操作所需详情按需加载。

验收：

- 少量数据 P95 小于 200ms。
- 1000 条 agent 数据下当前页 P95 小于 500ms。
- 查询数随页面大小增长，不随总数据量线性增长。

### 4.3 `/api/modules/origin-agentops/skills`

风险级别：P1/P2。

原因：

- 实测约 1.28 秒。
- 切换到 tools 时仍观察到上一页 skills 请求返回，说明请求可能没有随路由切换取消或去重。

建议排查：

- 客户端请求增加 `AbortController`，路由切换时取消上一页请求。
- 用 SWR/React Query 类缓存时，设置合理 `staleTime`，避免短时间重复拉取。
- 空列表场景不应花 1 秒以上；检查是否等待外部 ToolHost、权限、统计或全文搜索索引。
- 将“技能库统计”和“技能列表”拆开，首屏优先返回列表。

验收：

- 空列表 P95 小于 200ms。
- 切离页面后不再更新已卸载组件状态。
- 路由来回切换时短时间内不重复请求同一查询。

### 4.4 `/api/modules/origin-agentops/runs`

风险级别：P2/P3。

原因：

- 实测约 0.31 秒，当前可接受。
- runtime 页面数据量更大时容易退化。

建议排查：

- runs 按 `workspace_id + started_at desc` 建索引。
- 默认只取当前页和必要摘要。
- trace/artifact/input/output 详情延迟加载。
- replay、更多操作不应阻塞列表首屏。

验收：

- 当前页 P95 小于 500ms。
- 大量 runs 下仍按分页稳定。

## 5. Loader 与页面输出排查

模块页面 loader 应满足：

- loader 只返回当前页面首屏必需数据。
- metadata loader 不执行重查询。
- 页面组件不在 render 阶段生成不可复现文本。
- 相对时间在服务端固定成绝对时间，或客户端统一 hydration 后再转换。
- 不在服务端和客户端分别调用 `Date.now()`、`new Date()`、`Math.random()` 生成可见文本。
- 列表中的“1 分钟前”“41 小时前”等相对时间，需要确认是否由服务端和客户端使用同一个基准时间。

建议模块增加测试：

- 同一 loader 输入重复执行两次，输出稳定。
- SSR 输出和客户端首轮渲染文本一致。
- 模块 route 切换后没有遗留请求更新已卸载页面。

## 6. 数据查询与索引清单

如果 `origin-agentops` 使用 Postgres 或其他持久化 store，应检查：

| 数据域         | 推荐索引或查询约束                                                     |
| -------------- | ---------------------------------------------------------------------- |
| agents         | `workspace_id, status, updated_at desc`                                |
| agent versions | `agent_id, version desc` 或 `agent_id, is_stable`                      |
| skills         | `workspace_id, status, updated_at desc`                                |
| tools          | `workspace_id, toolhost_id, status, updated_at desc`                   |
| runs           | `workspace_id, started_at desc`、`agent_id, started_at desc`、`status` |
| approvals      | `workspace_id, status, risk_level, submitted_at desc`                  |
| traces/audit   | `workspace_id, created_at desc`、`run_id`                              |
| usage          | `workspace_id, period_start, metric`                                   |
| api keys       | `workspace_id, status, created_at desc`                                |
| members        | `workspace_id, role, status`                                           |

所有列表接口都应有：

- 明确 page size 上限。
- 稳定排序。
- 字段白名单。
- workspace/product scope 过滤。
- 查询耗时日志。
- 慢查询阈值报警。

## 7. 可观测性要求

模块 API 应输出结构化性能事件，至少包含：

- `moduleId`
- `route`
- `workspaceId`
- `requestId`
- `totalMs`
- `dbMs`
- `externalMs`
- `cacheHit`
- `rowsRead`
- `rowsReturned`
- `payloadBytes`

对 `/state` 这类聚合接口，应进一步拆分：

- `agentsMs`
- `skillsMs`
- `toolsMs`
- `runsMs`
- `approvalsMs`
- `usageMs`
- `membersMs`
- `serviceConnectionsMs`

生产环境不应记录敏感输入、token、API key、prompt 原文或用户私密内容。

## 8. 修复路线

### Phase 0：补证据

1. 在模块 API 中加入请求级 span。
2. 记录 `/state` 内部各聚合段耗时。
3. 对列表接口记录 rows read/returned。
4. 复现路由切换，保存接口耗时基线。

### Phase 1：先修公共状态接口

1. 拆 `/state` 的聚合逻辑。
2. 移除当前页不需要的字段。
3. 增加短缓存和请求去重。
4. 将变化频率不同的数据拆分。

### Phase 2：优化列表接口

1. agents、skills、tools、runs 分别做分页、字段裁剪、批量聚合。
2. 修 N+1。
3. 补数据库索引。
4. 路由切换时取消旧请求。

### Phase 2.5：修模块内部导航

1. 将 `.oa-nav-item` 内部路由从普通 `<a>` 改为宿主 Link/client transition，或显式使用模块 SDK/host surface 注入的 `navigate`/`Link` capability。
2. 宿主兜底已在本地验证可接管 AppFrame 内普通 `<a>`，但模块仍要保留自己的清晰导航契约：无 JS/降级场景保留普通 href，hydrated 后点击必须走 client transition。
3. 如果模块不能直接依赖 Next `Link`，由模块 SDK 或 host surface 注入 `navigate`/`Link` capability，避免模块页面自行硬编码 document navigation。
4. 对模块内部 `agents -> skills -> tools` 增加浏览器 smoke：transition document navigation 必须为 0，且要在宿主兜底开启和关闭两种模式下各跑一次，证明模块自身也不会退化。
5. 部署当前宿主产物后，重新跑线上 `origin-agentops` smoke；若 document navigation 仍不为 0，再优先检查模块 DOM 是否位于 `[data-host-app-frame]` 内、链接是否同源、是否带 `target/download/modifier` 或被模块脚本提前阻止。2026-06-16 增强脚本已经能在报告里输出 `appFramePresent`、`clientTransitionMarkerPresent` 和注入锚点归属；本地 Origin AgentOps latest evidence 已确认这些诊断为 true，线上下一轮复测也应先确认这些诊断为 true。RC gate 也会拒绝缺少 `shell:app-frame`、`shell:client-transition-marker` 或 `shell:injected-anchor-frame` 的 evidence。

### Phase 3：修 hydration 风险

1. 搜索模块输出中的相对时间、随机值和当前时间。
2. 统一由服务端传递 `renderedAt`，客户端基于同一时间转换。
3. 或者首屏显示绝对时间，hydration 后再增强为相对时间。
4. 增加 SSR/client 文本一致性测试。

## 9. 验收指标

模块侧建议目标：

| 指标                                            |                             目标 |
| ----------------------------------------------- | -------------------------------: |
| `/api/modules/origin-agentops/state` 热路径 P95 |                          < 300ms |
| agents/skills/tools 空列表 P95                  |                          < 200ms |
| agents/skills/tools 当前页 P95                  |                          < 500ms |
| runs 当前页 P95                                 |                          < 500ms |
| 模块内部路由切换 document navigation            |                                0 |
| 模块内部路由切换 P95                            |                             < 1s |
| 路由切换后遗留请求更新 UI                       |                                0 |
| Hydration mismatch                              |                                0 |
| 单接口 payload                                  | 按页面需要控制，避免返回无关明细 |

当模块内部导航和宿主侧 document navigation 兜底都修复并在线上复测通过后，再重新测模块接口对总路由切换的影响；否则模块 API 优化会被整页渲染成本掩盖。本轮宿主兜底只有本地证据；2026-06-16 线上复测仍未看到 AppFrame/client-transition 诊断标记，线上 `origin-agentops` 仍不能按已修复处理。
