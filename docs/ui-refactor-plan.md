# @ploykit/ui 重构方案：shadcn 生成自有化 + hooks 拆包 + 导出面补丁

> 状态：**已实施**（2026-10-10，commits 5a82216/f79027a/ec73061/b2bd3bb + ADR 0010）。原方案存档；调研基线（调研基线：client 0.2.1 / runtime 0.1.1 / ui 0.1.1，master@9e85d12）。
> 决策原则一句话：**所有权归框架不让步，生产方式全盘拥抱 shadcn CLI（生成后自有化）；components/ui 是不可污染的 stock 镜像，适配单向流动：shadcn → ploykit 调用方 → example**。

---

## 0. 问题总结（本次调研确认的事实）

| # | 问题 | 证据 |
|---|---|---|
| P1 | components/ui 的 23 件组件为手写维护，上游（shadcn registry / Base UI）的 a11y 与缺陷修复无法系统性跟进；sidebar 单件 19.3kB 属高风险维护面 | `src/components/ui/` 全套与 shadcn 新版产物同构（Base UI 内核 + cva + cn + oklch token），但无任何与 registry 的同步机制 |
| P2 | 导出面缺口：package.json `exports` 仅有 `.` 与 `./package.json`，深路径导入被挡。root `index.ts` 只策展导出了 14/23 件——**alert-dialog、avatar、breadcrumb、card、checkbox、popover、progress、select、switch 共 9 件产品当前完全无法使用**（dist 里有、import 不到） | packages/ui/package.json exports map；src/index.ts |
| P3 | hooks/provider/realtime/ws-query-bridge 与 UI 组件同居一个包：UI 自建（如 antd）的产品想只用 hooks 也必须安装并满足 `tailwindcss`、`@base-ui/react` 等 UI 侧依赖 | packages/ui 的 dependencies/peerDependencies；src/hooks/ 全部 16 个文件的 import 仅依赖 react / @tanstack/react-query / @ploykit/client / @ploykit/runtime / zod，**零 UI 依赖** |
| P4 | 产品侧用 shadcn CLI 补长尾组件（同内核同 token，已被论证为正确姿势）无官方文档，每个新产品会重踩 components.json 配置、@base-ui/react 单副本确认这两个坑 | docs/dev-environment.md 无相关章节 |

**修正一处早前会话中的口误**：`cn` 已经从 `@ploykit/ui` root 导出（`export { cn, statusTone, ... } from './lib/utils'`），不需要再"补导出 cn"；缺口只在组件深路径（P2）。

**明确不做的事**：`src/components/` 下的业务组件（ConfirmDialog、DataTable、FormField、Page、SecretModal、NotificationBell、WorkspaceSwitcher 等 15 件）是 ploykit 自有领域组件，**不在替换范围**；layouts、pages 不动；token 体系继续留在产品侧 CSS（现状即正确）。

---

## 1. 现状基线（重构对照用）

### 1.1 components/ui 清单 ↔ shadcn registry 映射

shadcn CLI（2026 版）默认内核即 Base UI，与现有实现同源，映射如下。命名以 registry 实际输出为准，落地时逐件核对：

| 现有文件 | 内核 | registry 组件 | 现有行为测试 | 策略 |
|---|---|---|---|---|
| Button.tsx | 纯 cva | button | —（smoke 覆盖） | 替换，文件名改小写 |
| Badge.tsx | 纯 cva | badge | — | 替换（StatusBadge 等扩展保留在原文件尾部或挪走） |
| Input.tsx | 纯标记 | input | — | 替换 |
| label.tsx | base-ui | label | — | 替换 |
| skeleton.tsx | 纯标记 | skeleton | — | 替换 |
| separator.tsx | base-ui | separator | — | 替换 |
| card.tsx | 纯标记 | card | — | 替换 |
| breadcrumb.tsx | base-ui | breadcrumb | — | 替换 |
| dialog.tsx | @base-ui/react/dialog | dialog | 无 | 替换 + 补测试 |
| alert-dialog.tsx | base-ui | alert-dialog | ✅ | 替换，测试兜底 |
| avatar.tsx | base-ui | avatar | ✅ | 替换 |
| checkbox.tsx | base-ui | checkbox | ✅ | 替换 |
| switch.tsx | base-ui | switch | ✅ | 替换 |
| progress.tsx | base-ui | progress | ✅ | 替换 |
| select.tsx | base-ui | select | ✅ | 替换 |
| popover.tsx | base-ui | popover | ✅ | 替换 |
| tooltip.tsx | base-ui | tooltip | —（root 导出） | 替换 + 补测试 |
| tabs.tsx | base-ui | tabs | ✅ | 替换 |
| menu.tsx | @base-ui/react/menu | dropdown-menu（registry 名以实际为准） | ✅ | 替换 |
| sheet.tsx | base-ui | sheet | —（root 导出） | 替换 + 补测试 |
| field.tsx | 纯标记 | field | ✅ | 替换 |
| empty.tsx | 纯标记 | empty | — | 替换 + 补测试 |
| sidebar.tsx | base-ui 复合 | sidebar | ✅ | 批 3 整件替换，见 §3.3 |
| toast.tsx（components/） | sonner 封装 | sonner | ✅ toast.test | 生成对照后择机替换 |

### 1.2 hooks 拆包的真实边界（调研结论）

**可以干净搬走的**（对 UI 零依赖，import 已核实）：

- `src/provider/PloykitProvider.tsx` —— 仅 import react / @tanstack/react-query / @ploykit/client（含全部 context 与 `queryKeys`）
- `src/hooks/` 全部 16 个文件（useAuth、useLogin、useWorkspace、useBilling.tsx、useApi、useSEO、ws、useAudit、useMembers、useNotificationPrefs、usePasswordReset、useSessions、useSiteConfig、useTokens、useUsage、useZodForm、use-mobile）
  - `PlanGate`（useBilling.tsx 内）是无 UI 的纯门卫组件，随行
- `src/realtime.ts`（createWsClient / defaultWsUrl，仅依赖 @ploykit/client）
- `src/lib/ws-query-bridge.ts`（类型依赖 query + client）
- `src/lib/perm.ts`（roleSatisfies / Perm，纯逻辑，无 UI）

**留在 @ploykit/ui 的**：lib/utils.ts（cn/statusTone/格式化——tailwind-merge 属 UI）、lib/api-error.ts（面向展示的错误格式化）、components、layouts、pages。

**新包依赖面**：`dependencies: @ploykit/client`；`peerDependencies: react, @tanstack/react-query, zod`（useZodForm 用）；`@ploykit/runtime`（useSEO 用 emitDirective）。**没有 tailwindcss / base-ui / lucide——P3 就此消除。**

**不设兼容层（已决策）**：@ploykit/ui 的 root index **不再 re-export** 任何 hooks 符号，hooks 导出面整体移至 @ploykit/hooks；example/web 直接改从 @ploykit/hooks 导入。已发布的 ui 0.1.1 消费者按"不考虑向后兼容"原则不迁就——ui 下一个版本即 0.2.0（minor 重排导出面属框架自由裁量）。

### 1.3 消费面（改动波及核对表）

example/web 只有 6 个文件 import `@ploykit/ui`：routes.tsx（pages + 类型）、Dashboard.tsx、BlogPost.tsx（useSEO）、RealtimePage.tsx、ws.ts（createWsClient/defaultWsUrl）、entry-client.tsx（ErrorBoundary/PageError）。hooks 拆包后需迁移的仅 BlogPost.tsx 与 ws.ts 两处 + routes.tsx 中 hooks 符号。

---

## 2. 阶段 1：落地补丁（小时级，先行发布）

### 2.1 子路径 exports（P2）

packages/ui/package.json `exports` 增加（wildcard 一行覆盖全部组件，Node/Vite/tsc 均支持）：

```jsonc
"exports": {
  ".": { "development": "./src/index.ts", "types": "./dist/index.d.ts", "default": "./dist/index.js" },
  "./components/ui/*": {
    "development": "./src/components/ui/*.tsx",
    "types": "./dist/components/ui/*.d.ts",
    "default": "./dist/components/ui/*.js"
  },
  "./package.json": "./package.json"
}
```

要点：root 策展导出**保留不动**（现有消费者零变化）；深路径是新增能力。产物路径已核实——tsc `outDir: dist` 会原样保留 `dist/components/ui/*` 结构，`files: ["dist"]` 已覆盖。

### 2.2 产品侧补长尾组件的官方指引（P4 → dev-environment.md 新章节）

在 docs/dev-environment.md 增加「产品侧用 shadcn CLI 补长尾组件」一节，内容要点：

1. `npx shadcn@latest init`（在产品目录，如 example/web）：内核选 **Base UI**（与框架同源）、css 指向产品的 `src/index.css`（token 已同套）、cn 别名指向产品自建 `src/lib/utils`；
2. `npx shadcn add <组件>` 生成进产品 `src/components/ui/`，与框架组件混用无内核冲突；
3. 装完执行 `npm ls @base-ui/react` 确认单副本（框架钉 ^1.8.0，hoist 应合成一份，出现两份必须先解决再构建）；
4. 边界说明：框架已有的 23 件优先从 `@ploykit/ui`（root 或子路径）导入，CLI 只用于长尾。

版本随阶段 1 一并发出：ui 0.2.0（新增导出面按 semver 属 minor）。

---

## 3. 阶段 2：shadcn 生成自有化替换（核心，2–3 天）

### 3.1 生成环境（一次性搭好，长期保留）

packages/ui 内提交一份 `components.json` + tsconfig paths（仅为 CLI 生成服务）：

```jsonc
// packages/ui/components.json（示意，字段以 CLI 要求为准）
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york", "rsc": false, "tsx": true,
  "tailwind": { "config": "", "css": "src/dev.css", "baseColor": "neutral", "cssVariables": true },
  "aliases": { "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui", "lib": "@/lib", "hooks": "@/hooks" }
}
```

配套：tsconfig 加 `"paths": { "@/*": ["src/*"] }`（编译不使用，仅供 CLI 解析别名）；`src/dev.css` 一个仅满足 init 校验的最小 tailwind 入口（真实 token 在产品侧，包内不产出样式）。

**生成后固定改造流水**（写成 `scripts/adopt-shadcn.mjs`，30 行以内的确定性脚本）：

1. `npx shadcn@latest add <comp> --overwrite` 生成；
2. 改写 import：`@/lib/utils` → `../../lib/utils`、`@/components/ui/x` → `./x`、`@/hooks/x` → `../../hooks/x`（tsc 全量兜底）；
3. 文件名统一为 registry 小写风格（`Button.tsx` → `button.tsx`），包内引用一次性替换；
4. 产物落 `src/components/ui/`，进入逐件 diff 审查。

若 CLI 对库目录 init 兼容性不佳，备选路径（按序尝试，结果等价）：在临时脚手架 app 里 add 后拷入；直接 fetch registry HTTP 端点的组件源码。

### 3.2 逐件替换流程（clean-copy 政策，每件必走）

**政策：以 shadcn 为准的干净覆盖，不做任何"保留定制"式合并。** 每件流程：

```
npx shadcn add <comp> → adopt 脚本改写 import 路径（唯一允许的改动）→ 整件覆盖
→ tsc + 行为测试暴露所有依赖旧 API / 旧行为的调用点
→ 第一优先级：改 packages/ui 内的调用方（layouts / pages / components 业务件）适配 stock 语义；
  调用方确实需要旧行为的，在业务层包 wrapper —— 绝不回写 components/ui
→ 第二优先级：packages/ui 全绿之后，才动 example/web（基于更新后的 ploykit 适配，而不是反过来）
→ 提交（一件一 commit，含该件适配调用点的说明）
```

**stock 镜像不变式**（长期有效，替换完成后继续约束）：

1. `components/ui/*` 与 registry 输出保持一致，唯一允许的差异是 adopt 脚本的 import 路径改写；
2. `components/ui/*` 禁止出现业务概念——`@ploykit/client`、`../hooks/*`、`../provider/*` 一律不得 import（可加一个 import 白名单守卫测试固化：仅允许 react / @base-ui 系 / cva / cn / lucide / 兄弟 ui 件 / hooks/use-mobile）；
3. 任何缺口（缺 prop、缺行为）在组合层解决：业务 wrapper、AppShell、或产品侧。

**随 clean-copy 清出的存量夹带**——迁移规则统一为：**shadcn 有等价物 → 用 stock 的；没有 → 保留 ploykit 自有定义，但落位在业务层（components/ / lib/），components/ui 保持 stock**：

- `Badge.tsx` 内的 `StatusBadge`（shadcn 无此业务语义件）→ 保留，迁至 `components/StatusBadge.tsx`，index.ts 导出路径跟随；
- `Button.tsx` 的 `ButtonProps`、`Badge.tsx` 的 `BadgeProps` 等 → 以生成结果的 stock 导出面为准；消费者需要而 stock 不导出的命名类型，用 `React.ComponentProps<typeof Button>` 派生（随 stock 升级自动跟进）或在业务层自定义，不回写 components/ui。

**关于 AppShell 与 shadcn blocks**：shadcn 官方有整页/整布局级的 [blocks 库](https://ui.shadcn.com/blocks)（dashboard 侧栏布局、login、settings 等），形态与 AppShell 同类，但性质是**纯 UI 设计模板**（零业务概念、拷完即自有）。AppShell 是框架级组合层（承载 UserMenu/WorkspaceSwitcher/权限与设置导航），**不适用 clean-copy 政策**，保持框架自有；blocks 的两个用法：框架侧重排 AppShell 视觉结构时的参考素材；产品侧经 `npx shadcn add` 获取整套自定义布局的长尾通道（与框架 AppShell 互不干扰）。

**政策的长期回报**：未来跟进上游 = 重新 `add` + adopt 改写 + diff——diff 里**只会出现上游变更**（零定制残留），升级决策从"考古式合并"变成机械可审的取舍。

分三批降险：**批 1 纯标记件**（button/badge/input/label/skeleton/separator/card/breadcrumb/empty）→ **批 2 交互件**（dialog/alert-dialog/tooltip/popover/select/checkbox/switch/progress/tabs/avatar/menu/field/sheet）→ **批 3 sidebar**（最大单件，放最后单独一批，策略相同：整件替换）。

### 3.3 sidebar 整件替换

sidebar.tsx 经核实是**零产品渗透的通用原语**：import 仅有 react / @base-ui 内部 API / cva / cn / 兄弟原语 / lucide 图标 / useIsMobile，无任何 workspace/api/query 概念；与 AppShell 的耦合是**组合层关系**（AppShell 拼装通用零件、插入 UserMenu/WorkspaceSwitcher），整件替换不触及。现有行为测试（cookie 持久化 sidebar_state、Ctrl/Cmd+B 快捷键）钉住的恰好是 shadcn 上游语义，替换后自动成为验收网。

替换时唯一要做的适配：registry 版导出清单与现版可能不同（SidebarRail/SidebarMenuSub 等）——**改 AppShell 的用法和 index.ts 的策展导出去适配 stock**，而不是反过来。不存在"保 fork"选项：components/ui 永远 stock，缺口上提组合层。

### 3.4 测试补齐与修订（替换的验收线）

现有 11 件有行为测试。替换后测试分两类处理：钉住 **stock 语义**的（如 sidebar 的 cookie 持久化、Ctrl/Cmd+B）原样保留、自动成为验收网；钉住 **ploykit 改动行为**的（若存在），随对应定制一起迁到业务层测试。dialog、tooltip、sheet、empty 及批 1 中无测试的件，**替换时同步补齐行为测试**（受控状态流转 + 交互断言，参照 alert-dialog.test.tsx 的写法）。完成后 23 件 100% 有测试——这是"自有化"后能安心自己维护的前提。

---

## 4. 阶段 3：拆出 @ploykit/hooks（1 天）

按 §1.2 的边界执行：

1. 新建 `packages/hooks`（@ploykit/hooks 0.1.0），搬入 provider/hooks/realtime/ws-query-bridge/perm；tsconfig/vitest 配置照抄 ui（`customConditions: ["development"]` + jsdom）；
2. root package.json `workspaces` += `"packages/hooks"`；
3. @ploykit/ui：dependencies += `@ploykit/hooks@^0.1.0`，root index 删除全部 hooks/provider/realtime/bridge/perm 导出行（无兼容层，见 §1.2），package.json 升 0.2.0（若与阶段 1 同批发布则合并版本）；
4. example/web 两处半迁移（BlogPost/ws.ts/routes.tsx）改从 `@ploykit/hooks` 导入；
5. **release.yml** 发布顺序改 client → runtime → **hooks** → ui，并加 `npm publish -w @ploykit/hooks --access public --provenance`；npm 侧需先给 @ploykit/hooks 配置 trusted publisher（haozing/ploykit/release.yml、environment 留空，登记后 2 天内完成首发）；
6. dev-environment.md 的「bump 版本须同步 consumers' ranges」规则补充 hooks 一环；docs/architecture.md §前端分层更新为 client/runtime/hooks/ui 四层。

**实施顺序建议**：阶段 1 → 阶段 3 → 阶段 2。理由：先切包边界（结构性改动，影响面在构建/发布链路），再在稳定的包内做组件逐件替换（内容性改动，影响面在测试），两类改动不混在一个发布里。

---

## 5. 验收清单（全部满足才算交付）

- [ ] `npm run build`（全部 workspaces 含 hooks 包）通过；`make verify-ui` 通过（含新增测试）；
- [ ] `npm run build:web` + example/web vitest 通过；
- [ ] SSR 链路回归：`cd example && go run ./cmd/render prerender` + pages/ssr-smoke 测试通过（组件替换后必跑）；
- [ ] 深路径冒烟：example/web 中 `import { AlertDialog } from '@ploykit/ui/components/ui/alert-dialog'` 构建通过（P2 消除）；
- [ ] `npm ls @base-ui/react`、`npm ls react` 全仓单副本；
- [ ] components/ui 23 件 100% 有行为测试；
- [ ] **re-sync 演练**：任选一件重新 `add` + adopt 改写后与仓库版 diff，差异为零（或仅上游自身变更）——证明未来跟进上游是零成本 diff；
- [ ] import 白名单守卫测试生效（components/ui 不含业务概念 import）；
- [ ] `npm publish --dry-run` 演练：ui 0.2.0 产物含子路径文件；@ploykit/hooks 0.1.0 产物正确；
- [ ] 打 tag 走 release.yml 全绿，npm 上 hooks/ui 新版本可见（trusted publishing，无 token 无 OTP）；
- [ ] docs 更新：dev-environment.md（产品侧 add 指南 + 版本同步规则 + 分层描述）、architecture.md（四层）、新增 ADR「UI 组件生产方式：生成后自有化」（沿用 docs/adr/ 编号顺延）。

## 6. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 生成物与现版 class/行为差异导致产品视觉回归 | 一件一 commit；example 页面人工过一遍；分三批替换控制爆炸半径；行为测试兜底 |
| shadcn CLI 在库目录不可用 | §3.1 两条备选路径（临时 app 生成 / 直接 fetch registry 源码） |
| sidebar 替换 API 差异波及 AppShell | 现有行为测试（cookie/快捷键）+ AppShell 测试兜底；一律改调用方适配 stock，组件不动 |
| hooks 拆包破坏 npm 已有消费者 | ui root re-export 兼容层 + 0.x semver 内无删除 |
| 发布链路（release.yml 顺序、trusted publisher 2 天首发窗口）出错 | 先 `--dry-run` 演练；hooks 包登记 trusted publisher 当天打 tag 首发 |

回滚：三个阶段相互独立，任一阶段出问题 revert 该阶段 commit 即可；hooks 包一旦发布到 npm 不可撤回，故发布前必须完成 dry-run 演练与 example/web 全量验证。
