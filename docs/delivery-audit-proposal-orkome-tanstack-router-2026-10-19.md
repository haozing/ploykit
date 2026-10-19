# orkome 提案：前端路由栈复核——react-router v7 → TanStack Router

日期：2026-10-19
来源：orkome（下游消费者）。触发点：0.9.2 升级批次中发现 `@ploykit/ui` 大版（0.9.0）在 orkome 侧**采纳率为零**——不是不需要那些功能，而是路由栈把整包壳挡在门外。本提案沿 field-report 文化：每条论证带两仓证据锚点；性质是**决策请求**而非缺陷指控，供框架侧裁量。
范围声明：只针对前端路由栈一项选型。RHF/zod/Base UI/TanStack Query 等其余前端选型经同一把尺复核均为合理（§5），不在提案范围，防扩大化。

---

## 1. 背景：ui 采纳率为零的真实原因

**现象**：orkome web 自初始提交起从未 import `@ploykit/ui`（`@ploykit/runtime` 同样零引用）；消费分布 = client 56 处 + hooks 2 处（其一为 ws-query-bridge 单文件深引）。0.9.0 的 permKey 侧栏过滤、统一用户面板、AdminShell 同构、PasswordField 等资产全部无法消费。

**根因链**（三层，逐层有证据）：

1. ui 壳层与默认页建在 react-router v7 上：peer 声明 `react-router ^7`；155 个源文件中 46 个触碰 react-router，耦合集中在 layouts/pages（components 层 48 个组件仅 3 个绑路由）。
2. orkome 路由栈是 @tanstack/react-router → 引入框架壳等于双路由栈并存。
3. **更深一层**：`@ploykit/runtime` 的 src 直接依赖 react-router（`hydrate.ts:4` matchRoutes；`routes.ts:3` Route/Routes），且 peerDependencies 声明 react-router ^7——消费方哪怕只要渲染指令通道契约，也被迫连带装 react-router。orkome 的 vite 配置因此连 `@ploykit/hooks` 的 barrel 都不能整包引（经 runtime 间接 value-import react-router），只能深引无路由依赖的 ws-query-bridge 单文件。

第 3 层意味着：**路由栈耦合不止挡住 ui，还抬高了 hooks/runtime 的最低消费门槛**。

## 2. 核心论证：形态约束下 RR v7 的价值构成

尺子不是本提案新加的，是 ploykit 自己的既有裁决（rendering.md / component-selection.md）：

| RR v7 价值层 | 在 ploykit 产品形态（Go 单二进制 + SPA）下 |
|---|---|
| framework mode（Node SSR / streaming / server functions / RSC 路径） | **不可兑现**。前提是 Node 服务端；renderx G6 明写生产进程零 Node（wazero+QuickJS 内嵌、CGO_ENABLED=0、esbuild 以 Go 库形态进 go.mod）。启用它 = 在 Go 旁强加 Node 进程，破坏单二进制部署故事 |
| per-request SSR / 流式渲染 | renderx 显式非目标 N1/N2（QuickJS 无 JIT、无 Web Streams，仅同步 renderToString） |
| library mode（组件级路由） | 唯一被实际消费的面（renderx entry-server 的 StaticRouter + renderToString） |

结论：选型文档记录的理由是 **"de facto standard"**——这是全栈框架时代的理由，隐含期权是"将来可平滑升级 framework mode"。ploykit 形态下这条升级路径不存在，"事实标准"就成了**为一个点不着的引擎付的兼容税**。

library-only 赛道上 TanStack Router 的对应优势：

- path/search params 100% 类型推断，search params 一等公民（zod schema 校验）——对 "Go API + SPA" 的参数面是直接红利；
- 与 TanStack Query 同家集成顺滑（Query 已是框架数据层选型；RR loader 在 SPA+Query 架构里是重复数据层，loader 内 `ensureQueryData` 是 workaround 不是特性）；
- code-based routing 与现有 routes.tsx 集中路由表直配；
- bundle 更小；官方支持无框架依赖的手动 SSR（逐请求建 router + memory history，TanStack Start 即构建于此），覆盖 renderx 的 renderToString 用法。

## 3. 迁移面评估（诚实版）

- **packages/ui**：46 个触碰 react-router 的文件多为机械映射（Link/useNavigate/Outlet 语义一一对应；routes.tsx → tanstack code-based routeTree）。components 层耦合极薄（3/48）。
- **packages/runtime**：`hydrate.ts`/`routes.ts` 换 tanstack 对应物 + peerDependencies 解耦。**这是消费面收益最大的一处**——解耦后 hooks barrel 可整包消费，下游最低门槛下降。
- **renderx 接线**：example 的 entry-server.tsx（StaticRouter wrap → tanstack memory history）+ entry-client 水合同步；框架侧 renderx（Go）**零改动**——它只消费 directive 通道与 bundle，不感知路由库。
- **顺手项**：清 RR loader 模式（Query 已是数据层）；component-selection.md 路由行与 rendering.md 引用面同步。
- **保留不变**：0.9.0 的 permKey/userMenuItems/AdminShell 是纯数据协议层，路由无关，治理成果零损失。
- **semver**：ui 2.0 major。v0 尾部、消费方最少的时刻 = 最便宜窗口，越晚越贵。

## 4. 备选方案对比

| 方案 | 收益 | 成本 | 备注 |
|---|---|---|---|
| **A. 换 TanStack Router**（本提案） | 消死引擎税；runtime 解耦后 ui/hooks 全资产对 tanstack 消费方开放 | 一次 ui 2.0 迁移（§3） | orkome 可撤销"抄协议不抄壳"妥协，壳采纳率 0 → 可用 |
| B. 保留 RR + 导航原语注入化（Link/Outlet/useNavigate 三口子） | 壳变路由无关，可出双皮 | 适配层永久维护 + tanstack 皮另做；RR 皮仍付死引擎税 | 比 A 便宜，但把一次性成本换成持续性成本 |
| C. 不动 | 零 | ui 采纳率持续为零；每个非 RR 消费方各自抄协议 | orkome 现状即 C 的实证 |

## 5. 同尺复核结论：其余选型均合理

同一把尺（Go 单二进制 + 纯 SPA + 零 Node + 登录墙应用）过完全部前后端选型：

- **Go 侧 29 个直接依赖零违例**。renderx 三件套（wazero + QuickJS fork + esbuild-as-Go-lib）是"无 Node 跑 React 渲染"的正确解，是全部选型里形态自觉度最高的决策。watch-item 一条：QuickJS 为 fork，上游停滞即成孤儿依赖——建议记入 ROADMAP（goja / 纯 Go 引擎为兜底路径）。
- **前端**：TanStack Query / zod / Base UI / lucide / cva 三件套 / sonner 全部纯客户端、无 Node 负担。react-hook-form 与 RR 不同类——它没有"点不着的引擎"，全部价值在 SPA 内可兑现，保留合理。
- **唯一形态违例就是路由栈一项**。

## 6. 决策请求

请框架侧裁量是否接受方案 A（ui 2.0 换 TanStack Router）。若接受，orkome 侧愿做第一手消费方验证（升级即全站回归 + field report 回执）。若倾向 B/C，也请将 §2 的形态论证留档——它同时解释了 ui 采纳率与 runtime peer 包袱的成因，对后续消费方选型有参考价值。

---

## 附：证据锚点

**ploykit 仓**：
- `packages/ui`：155 源文件 / 46 触碰 react-router；components 层 48 / 3（UserMenu/WorkspaceSwitcher/SidebarUserMenu）
- `packages/runtime/src/hydrate.ts:4`（matchRoutes）、`packages/runtime/src/routes.ts:3`（Route/Routes）、`packages/runtime/package.json` peerDependencies
- `example/web/src/entry-server.tsx:3,10`（StaticRouter wrap）
- `docs/component-selection.md` §2.2 Routing 行（"de facto standard"）
- `docs/rendering.md` G6（零 Node）/ N1/N2（SSR 非目标）/ §3（StaticRouter 为 library 面消费）

**orkome 仓**：
- `web/vite.config.ts`：hooks barrel 深引注释（不可整包引的原因）+ `@ploykit/ui` 零消费死别名
- `web/src`：client 56 处、hooks 2 处、ui/runtime 零引用（grep 实测）
