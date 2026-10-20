# orkome 补充：v0.10.5 采纳过程新发现（壳层提案落地后的接缝）

日期：2026-10-20
来源：orkome 对 v0.10.3/v0.10.5 的即时采纳（三 commit 53b17f2/9b30dee/ac621c3）。五项提案与报告四项全部落地并验证通过——本报告只记录**采纳过程中新暴露的接缝**，均为上游源码实锤（file:line 以本仓 packages/ 为准）。
性质：沿用 field report 文化，每条=现象/证据/建议；文末附正面确认。

> **处置记录（2026-10-20，同日复核后全量修复）**：七条全部核实属实，处置如下——
> - **#1 已修**：渲染期无条件注册改为 useLayoutEffect + 仅 id 变化写入（registeredHeaderId 去重，时序语义不变，原时序测试保留并加写序列断言）；采纳建议②新增 `PloykitProvider workspaceHeaderSource?: 'kit' | 'consumer'`（缺省 'kit' 零破坏；'consumer' 完全不注册，卸载时撤销注册）。三条新测试锁死：无关重渲染不写入 / consumer 不覆盖消费方注册 / switchTo 写入序列=id 变更序列。
> - **#2 已修**：`WorkspaceSwitcherData.error` 契约放宽为 `unknown`（string 兼容保留=原样显示；推荐传原始 ApiError——翻译与配额分支两轨共用同一条管线）。新增注入模式配额点亮测试（E_QUOTA_EXCEEDED → 计费指引可达）。
> - **#3 已修**：KitLabels 新增 `pageLoading` / `pageEmpty` / `pageRetry` 三键（默认值与历史硬编码逐字一致零破坏）；Page 三态默认值改走 useKitLabels，组件 prop 仍优先。
> - **#4 已修**：PageHeader 新增 `titleClassName` 透传；h1 内置 `min-w-0 truncate` + `title` 属性（长名称不再换行）。
> - **#5 已修**：导出 `slugifyWorkspaceName`（规则不变）；注入 `create` 升级为二参 `(name, { slug })`——kit 生成 slug 随调用携带，消费方可采用亦可忽略（单参契约向后兼容）。README 注入缝章节同步。
> - **#6 文档化（不改代码）**：`queryKeys` 本就已从 `@ploykit/hooks` 导出，消费方对齐 cache key 的能力现成（`queryKeys.me` = `['auth','me']`、`queryKeys.workspaceList` = `['workspace','list']`）；`initialUser?` 注入 props 属过度设计，挂账待多消费方实证请求量问题再议。
> - **#7 已修（文档）**：packages/ui/README.md Tailwind 集成节新增「构建别名注意」——前缀 alias 必须指向包目录而非入口文件（alias 先于 exports）。
> 门禁：hooks 63 测试 + ui 780 测试 + client 30 测试全绿，双包 tsc/build 干净，example/web tsc + vite build 通过。

---

## 1. WorkspaceLayer 每次渲染覆盖全局 workspace 头注册（P1，串数据风险）

**现象**：`PloykitProvider.tsx:334` 在 WorkspaceLayer **渲染期**无条件执行 `setWorkspaceIdProvider(() => current?.id ?? null)`。`@ploykit/client` 的 `setWorkspaceIdProvider` 是模块级单例、last-write-wins；而 kit 内部 `current` 只由 `?ws=` / localStorage / 首工作区自动选中驱动，**不随消费方的切换动作更新**。后果：任何"自己也有工作区切换"的消费方，挂上 Provider 后其 API 头会被 kit 的陈旧 current 覆盖——切换工作区后请求仍打旧 workspace（串数据），且无任何报错。

**orkome 实证与绕法**：切换器用 `data` 注入缝喂自有状态（不调 kit switchTo），kit current 恒为首工作区；Provider 每渲染覆盖全局注册 → orkome 在 main.tsx 建 `WorkspaceHeaderAuthorityBridge`，用无依赖 `useLayoutEffect`（同 commit 内 render 必先于 layout effect）在每次提交后追平自有 zustand 真相。能工作但属消费方打补丁，且语义脆弱（依赖 React 提交顺序）。

**建议**：三选一——①改为 `useEffect` 且仅在自身 `current?.id` 变化时写入（默认不覆盖消费方）；②新增 `workspaceHeaderSource?: 'kit' | 'consumer'`（缺省 kit 保持现状，consumer 则完全不注册）；③`@ploykit/client` 的 provider 注册支持"消费者优先"的叠加语义。若短期不改，请在 PloykitProvider 文档明示「挂 Provider 后必须用 kit switchTo，否则头部串数据」——这是隐性契约。

## 2. `data` 注入缝的 error 契约与配额分支自相矛盾（P1，死分支）

**现象**：`WorkspaceSwitcher.tsx:48` 注入契约 `error?: string | null`（预本地化字符串，供直接展示）；但 `:99` 配额判定 `isApiError(error, 'E_QUOTA_EXCEEDED')` 需要 **ApiError 对象**。字符串恒判 false → 注入模式下配额超限引导分支永远不可达，且 error 无法由 kit 统一翻译。

**建议**：契约改为 `error?: unknown`（消费方传原始 ApiError，kit 内部 `apiErrorMessage` 翻译并点亮配额分支）；若担心破坏现有注入方，可拆 `errorMessage?: string` + `error?: unknown` 双字段并注明优先级。

## 3. KitLabelsProvider 未覆盖 Page 三态家族（P1，双语产品踩坑）

**现象**：v0.10.5 的 26 键覆盖 WorkspaceSwitcher/DataTable/SecretModal/UserMenu 四组件，但 `Page.tsx` 三态默认值仍硬编码中文：`PageLoading label='加载中…'`(:33)、`PageEmpty label='暂无数据'`(:42)、`PageError` 重试按钮 `'重试'`(:66)。双语消费方若直接用 kit 三态件，en 环境露中文（orkome 因自持 states.tsx 未踩中，但这是下一批消费者必踩的坑）。

**建议**：三处默认值并入 KitLabelsProvider（`loading` / `empty` / `retry` 三键，默认值保持现状零破坏）；PageError 的 `message` 已是入参无需处理。

## 4. PageHeader 标题无截断/class 缝（P2，采纳回归）

**现象**：`Page.tsx:21` 的 h1 固定 `text-2xl font-bold`，不接受 className 也无 truncate。orkome 三处详情页从手写页头迁到 PageHeader 后**丢失了两个既有行为**：长名称 truncate（现换行）与归档态标题淡化（`opacity-55`，现只能靠 Badge 表达）。迁官方件反而回退，消费方只能放弃或 hack。

**建议**：`titleClassName?: string` 透传（或内部补 `truncate` + title 属性）。

## 5. slugify 未导出，注入 create 的消费方只能抄（P2，漂移风险）

**现象**：`WorkspaceSwitcher.tsx:30` 的 `slugify` 是模块私有；`data.create(name)` 只给 name，slug 生成规则（小写/≤40/<4 补随机后缀）由消费方负责。orkome 为对齐语义**逐行抄了一份**进自己的适配层——kit 改规则即漂移，且各消费方会各抄一份。

**建议**：导出 `slugifyWorkspaceName`（或 `create` 回调二参给 `(name, { slug })` 由 kit 生成）。

## 6. Provider 与消费方各拉一份 me/workspaces（P3，冗余请求）

**现象**：kit AuthLayer 固定自拉 `['auth','me']` + `['workspace','list']`（PloykitProvider.tsx:203/211）；消费方自有 me 查询再拉一份 → 冷启动 4 请求、两份数据可能短暂不一致（role_perms 等字段来自 `/api/workspaces`）。

**建议**：Provider 支持 `initialUser?/initialWorkspaces?` 注入，或导出 `queryOptions` 让消费方对齐到同一 cache key。低优，但消费方越多收益越大。

## 7. 文档注记：前缀 alias 与 `@ploykit/ui/tailwind.css` 不兼容（P3）

消费方若为 pnpm/vitest 解析把 `@ploykit/ui` 按前缀 alias 到 `dist/index.js`（orkome 现状），`@import "@ploykit/ui/tailwind.css"` 会被解析成 `dist/index.js/tailwind.css`（ENOENT）——与 exports 形状无关，alias 先于 exports。建议文档写明"alias 到包目录而非入口文件"，或提供 `@ploykit/ui/dist/tailwind.css` 显式子路径。orkome 现用 `@source "../../node_modules/@ploykit/ui/src"` 等价形态。

---

## 正面确认（本轮采纳验证通过）

- **五项提案全部按原文落地**：sidebarMiddle（ProjectNav 携全部管理动作回导航区，用户"项目跑到下面"问题根治）、Switcher data 缝+menuFooter+billingHref、KitLabelsProvider、SecretModal `string[]`（备份码门控等价、设置域最后一处手写密文收口）、PageHeader leading（三详情页 adopting 形态统一）。
- **采纳报告四项全修且验证有效**：useAuthSafe 使 AuthBridge 得以整体删除（kit logout 同端点+清缓存，语义对齐）；UserMenuLabels/ImpersonationBanner label 生效；Alert warning variant + `--color-warning` @theme 映射文档到位；vite8 exports 条件形状未复现原 ENOENT 但加固合理。
- **hooks 0.8.1 的 runtime `^0.8.1` 修改生效**：orkome 树内双拷贝隐患消失（单拷贝 0.8.2）。
- 采纳后门禁：typecheck/build 绿、314 测试全绿、IAB 真机（canonical 切换器大卡 + plan_code + 项目区回位）确认。
