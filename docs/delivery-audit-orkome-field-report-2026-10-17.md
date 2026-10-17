# orkome × RunLynk 三方联调 field report — ploykit 侧发现清单

日期：2026-10-17
来源：orkome（下游消费者）接入自有 MCP 助理面 + RunLynk 云端浏览器能力的真实联调批次（当日两个修复波次 + 六个 DB-gated 存量测试清零），全部发现均已在源码（orkome 侧 vendor = ploykit 0.7.x）逐条核实并标注 orkome 仓证据位置。
格式：沿 shuijing 博客迁移批次先例——每条 = 现象 / 证据 / 建议，供框架侧验证采纳；文末附正面确认与一条「复核后不立案」的自我修正（防止框架侧重复排查）。

---

## 发现清单

### 1. identity `/api/tokens`：`scope` 透传零校验、零归一（P1，校验缺口）

**现象**：vendor `createPAT`（`identity/adapters/http/handlers.go` createPAT）把 `Scope *webx.CredentialScope` 从请求体解码后**原样直通** `TokenService.CreatePAT`——无 workspace_ids 的 UUID 格式校验、无数量上限、无空列表语义归一。下游要么裸奔（挂 vendor 面即暴露），要么各自私写一份校验（orkome 被迫在自家 `/cli-token` handler 私写 `normalizePATScope`：UUID 逐项校验 + ≤10 上限 + 空约束列表归一 nil）。

**为什么危险**：
- `CredentialScope.AllowsWorkspace` 的语义是 `nil = 不限`、**非 nil 空列表 = 全拒**——客户端顺手传 `"scope": {"workspace_ids": []}` 会得到一把什么都做不了的令牌，且创建 201 无任何提示；
- 垃圾 workspace_ids（非 UUID 字符串）静默落库，永远不匹配任何工作区——排查时是「令牌明明配了工作区却 403」的无线索陷阱；
- scope 是安全边界数据，公开面的校验缺口等于把策略下放给每个消费者的自觉。

**建议**：vendor `createPAT` 内建归一 + 校验（空列表→nil 或显式 400、逐项 UUID、数量上限），或至少暴露带文档的 `PATCreateGuard` 校验钩子（orkome ROADMAP 已留此接缝未接线）。

**证据**：orkome `internal/identity/adapters/http/handlers.go`（normalizePATScope 私有实现）、`web/src/components/settings/tokens-section.tsx`（前端补的限定工作区开关）；vendor 侧 read 路径 `identitypg.Repo.ResolvePAT` 的 scope 回装**已验证闭环可用**——缺口只在写侧校验。

### 2. authz admin 闸对「Role 通道未装配」无显式信号（P1，可诊断性）

**现象**：框架的 admin 授权决策读 `Principal.Role`，而 Role 由**消费者自行挂载的中间件**填充（orkome 的 memberPathMW 经 `RoleOf` 三段式）。挂载方漏接 RoleOf 时：owner 请求 admin 面 → 403「workspace owner or admin role required」——**与真非 admin 完全同形**，无法区分「权限不够」和「Role 通道没接」。

**实证**：orkome e2e golden 栈两处 `orchhttp.Deps` 漏接 RoleOf，L1 覆盖测试 mcp-servers POST 403，排查耗掉一轮完整 A/B（worktree + 双环境对照）才定位。生产 main.go 接线正确所以线上无感——这类问题只炸测试/新挂载面。

**建议**：授权决策需要角色而 `Principal.Role == ""` 时（会话/令牌类 principal 理论上总应有角色）：① 记一条一次性 WARN（「role channel not wired for this mount」）；② 错误体区分显式错误码（如 `E_ROLE_UNRESOLVED`）与普通 Forbidden。同时在 Mount 文档写明「挂 admin 面必须接 RoleOf」的契约。

### 3. eventbus 同 Phase 监听器执行顺序是隐式契约（P2，契约文档缺失）

**现象**：同一 PhaseCascade 内监听器按注册顺序同步执行，业务正确性可能依赖先后（orkome 两次实证：① workflow reset 与推进监听器的顺序决定流程推进是否丢失——同 cascade 内 handler 注册顺序决定消费先后；② TaskCompleted → reset 监听器先于结算尾部落 outcome 执行，e2e 立即读 outcome 出现竞态）。框架层面：bus 无顺序契约文档、无优先级机制、乱序时无诊断手段。

**建议**：① 在 bus 文档明示「注册顺序 = 调用顺序；同 Phase 监听器必须写成顺序无关」；② 对顺序敏感的监听场景提供显式机制（Order 选项或分 Phase 细化）；③ 考虑提供 `bus.On` 的 debug 模式打印实际触发顺序。

### 4. CSRF cookie 轮换与已加载 SPA 不兼容（P2，会话契约）

**现象**：server 重启轮换 csrf cookie 后，**已加载页面**内存中的 csrfToken 全部失效——所有写请求 403 "CSRF token missing or invalid"，唯一恢复方式是整页刷新（orkome 真机实证，10-15 起多次复现）。双提交 CSRF 模型下，令牌生命周期与页面生命周期没有对齐机制。

**建议**：① 上一代令牌宽限窗口（轮换后 N 分钟内双 token 均接受）；② 403 响应携带轮换信号头，SPA 据此自动重取 `/config`；③ 文档明示「重启即全端刷新」的运维含义。

### 5. notify bell 对 `notification.link` 列的直读直写阻碍下游 schema 演进（P2，schema 契约）

**现象**：vendor bell 适配器直接读写 `notification.link` 列，orkome 侧业务代码已全线去 link（列语义已废弃），但**列删不掉**——vendor 表结构来自 ploykit migration 009，适配器 SQL 硬引用。下游的表结构演进被框架适配器的实现细节锁死。

**建议**：把 bell 依赖的列纳入框架迁移契约显式声明（哪些列是适配器运行必需），并提供适配器侧的可选列降级路径（列缺失时功能降级而非报错），让下游可清理废弃列。

### 6. `ui/button` 基类缺 `relative`，absolute 子元素锚定漂移（P3，ui 缺陷）

**现象**：基类无 `relative`，absolute 定位的子元素（角标/徽标）会向外层最近的定位祖先漂移——orkome 铃铛 99+ 徽标曾飞到页面顶部（y=-2），下游被迫在宿主侧逐个补 relative（17c80cb）。

**建议**：`ui/button` 基类补 `relative`（shadcn 上游同样如此，改动面一个 class），或组件文档明示「宿主需自备定位上下文」。

### 7. `pgmigrate.Down` API 人体工学（P3，godoc/命名）

**现象（含自我修正）**：`Down(ctx, limit)` 的语义是「回滚最近 N 个」（limit<0 全量、0 显式拒绝）。**复核结论：0.6.1 与 0.7.x 语义一致，不存在 0.7.0 破坏性变更**——orkome 有一个 down 往返测试按 goose 心智（Down 到目标版本）编写，从诞生起就是错的，本次清零时修复。框架无责，但 goose 的「down-to-version」是行业默认心智，同形 API 不同语义必然反复误用。

**建议**：① `Down` 的 godoc 首行显式声明「N most recently applied（NOT down-to-version）」；② 考虑补一个 `DownTo(ctx, version)` 显式语义 API。**正面确认**：`limit=0` 硬拒绝（旧语义静默全量回滚）是很好的防呆设计。

### 8. API surface 不一致（P3，已在 ROADMAP:84 立案——补一份 field data）

**现象**：orkome 联调再次撞上 ROADMAP 已列的清单：裸数组 vs `{items,total}` 双解包（tokens/sessions/invitations-mine）、DELETE 200+body 与 204 混用、`{"items":null}` vs `[]`（0.7.0 ④ 已修，生产未升级前仍会出现）。单域内三种更新动词（PUT/PATCH 混用）也在发生。

**建议**：维持「下一个破坏窗口一次收口」的计划；orkome 愿意提供全部撞点清单作为收口时的面清单输入。

---

## 正面确认（field-verified，值得保持）

- **0.7.0 吸收 orkome 走查 6 项**：PATCH /auth/me 指针分化、WorkspaceHeaderCtx GET query 回退、audit 导出 X-Truncated 头、裸数组 nil→[]、错误消息英文统一、/config 自带 framework_version——下游升级即得，吸收通道运转良好。
- **CredentialScope 设计与读路径闭环**：nil=不限 / `domain:*` 通配 / ResolvePAT 从 `scope_workspaces/scope_permissions` 回装 Principal——本次在 orkome 生产面全链验证可用（配合限定工作区令牌）。
- **pgmigrate limit=0 硬拒绝**：防呆设计优秀（旧语义静默全量回滚是真实事故源）。
- **Down 缺 down 文件时报错**（"missing its down file, cannot roll back"）——错误点名准确。

## 复核后不立案（防止框架侧重复排查）

- ~~pgmigrate.Down 0.7.0 语义变更~~：0.6.1 即「最近 N」语义，无变更；orkome 侧测试按 goose 心智误写，已修（见发现 7 的自我修正）。
- ~~webx.Authenticate Bearer 分支不装配 scope~~：已核实装配闭环（ResolvePAT → Principal.Scope），且 AllowsWorkspace/AllowsPermission 在 4 个执行点生效——无缺口。

## 建议的落地切分

- 可立即进 Unreleased 的：发现 6（一个 class）、发现 7（godoc 两行）、发现 1 的归一部分（空列表→nil）。
- 需要小设计的：发现 1（校验钩子形态）、发现 2（错误码 + 文档）、发现 3（bus 顺序契约文）。
- 需要破坏窗口的：发现 8（并入既有 ROADMAP 计划）、发现 5（bell 列契约）。
