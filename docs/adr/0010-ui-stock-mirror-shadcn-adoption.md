# ADR 0010 · @ploykit/ui 组件生产方式：shadcn 生成后自有化（clean-copy）

Status: **implemented** (2026-10-10)；组件层 23 件已全量替换为 shadcn CLI 4.21（base-nova / Base UI 内核）官方产物，hooks 层同批拆出 `@ploykit/hooks`（client → runtime → hooks → ui 四层）。

## Background

components/ui 原为手写组件，形态与 shadcn 新版同构（Base UI 内核 + cva/cn/oklch token），但靠手工维护：上游 a11y/缺陷修复无法系统性跟进，sidebar 这类 19.3kB 的复杂件维护成本高。同时存在两个结构性缺口：

- **导出面缺口**：exports map 仅有根入口，23 件中 9 件（alert-dialog/avatar/breadcrumb/card/checkbox/popover/progress/select/switch）dist 有产物但产品完全无法导入；
- **层界混居**：react hooks/provider 与 UI 组件同居 @ploykit/ui，UI 自建（如 antd）的产品想只用 hooks 也被迫满足 tailwindcss/base-ui 等 UI 侧 peer。

备选路线的取舍：

- **产品侧各自 `npx shadcn add` 全套** — 被否决：组件副本散落各产品，框架升级管不到拷贝，与仓库反重复条款（AGENTS.md：框架长能力 → 清理产品侧等价物）方向相反；
- **依赖 shadcn 组件库 npm 包** — 不存在该形态（shadcn 的官方哲学是 copy & own），无此选项；
- **手写 + 上游 diff 移植** — 被否决：最复杂组件的考古式合并成本最高，恰是最需要上游修复流入的件。

## Decision

1. **所有权**：components/ui 归框架包（与 migrations 001–999 同构的分层），产品经 `@ploykit/ui`（root 策展导出或 `./components/ui/*` 子路径导出）消费。
2. **生产方式（clean-copy）**：组件由 shadcn CLI 生成后整件覆盖，`adopt-shadcn.mjs` 做 import 路径改写（`@/`→相对、`cn`→自有 lib/utils）——这是**唯一允许的改动**；`components.json`/tsconfig paths/`dev.css` 生成环境随包提交，未来跟进上游 = 重新 add + adopt + diff，diff 只会出现上游变更。
3. **适配单向流动**：shadcn → ploykit 调用方（layouts/pages/业务组件）→ example。tsc/测试暴露的不兼容一律改调用方，绝不回写 stock。产品视觉/交互以 stock 为新基准。
4. **夹带物规则**：shadcn 有等价物 → 用 stock；没有 → 保留 ploykit 自有定义但落位业务层（components/、lib/），components/ui 保持纯净（StatusBadge 迁出即此例）。
5. **stock 镜像不变式**（守卫测试钉住）：components/ui 禁止业务概念 import（@ploykit/*、provider、pages 均不可入）；缺口上提组合层解决——旧手写 sidebar 的三处 ploykit 增强（cookie 回读 P2-17、输入焦点保护 P3-1、骨架屏确定性 P2-11）全部上提 AppShell 或改钉 stock 语义，组件零改动。
6. **hooks 拆包**：provider/hooks×16/realtime/ws-query-bridge/perm 迁入 @ploykit/hooks（零 UI 依赖，peer 仅 react + @tanstack/react-query）；use-mobile 留守 ui（sidebar 依赖，UI 基础设施）。无兼容层：ui root 不再 re-export hooks 符号，发布顺序 client → runtime → hooks → ui。
7. **token 层归产品**：产品 CSS（example/web/src/index.css）持有完整 token 集并升级至 v4（shadcn/tailwind.css + tw-animate-css），ploykit 扩展 token（success/warning/sidebar 系）保留；包内 dev.css 仅供 CLI 校验。
8. **AppShell/业务组件/pages 永远框架自有**，不是 clean-copy 对象；shadcn blocks（整页布局模板）是重排视觉结构时的参考素材与产品侧长尾通道，不进框架包。

## Consequences

- 上游修复的跟进成本从"考古式移植"降为"机械 diff"；未来更换内核（如 Base UI 大版本）时重跑生成流水即可。
- stock 与旧手写版的语义差异（iconSm→icon-sm、EmptyFooter→EmptyContent、sidebar 骨架随机宽度等）按第 3 条由调用方消化，已随本次落地。
- `npm ls @base-ui/react` 单副本约束继续有效（产品侧 add 长尾组件后必查，见 dev-environment.md「产品侧用 shadcn CLI 补长尾组件」）。
- @ploykit/hooks 首次发布前需在 npm 配置 trusted publisher（haozing/ploykit/release.yml，environment 留空，登记后 2 天内首发）。
