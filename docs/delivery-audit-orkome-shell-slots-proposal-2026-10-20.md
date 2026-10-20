# orkome 提案：AppShell 侧栏插槽补齐 + WorkspaceSwitcher 能力/文案缝

日期：2026-10-20
来源：orkome（下游消费者）v0.10.1 采纳后的壳层深耕批次（框架壳真采纳 + ui-sweep 全站清扫 + 侧栏形态专题讨论）。所有发现均已在本仓源码逐条核实并标注 file:line。
性质：决策请求，供框架侧裁量。前情：router 提案（已落地）/ ui2-adoption field report（其 #1/#2/#3/#5 仍开放；本报告 #3 将其 #4 的 UserMenu 个案升级为机制级，不重复立案）。

---

## 1. AppShell 缺侧栏中部内容槽（P1，插槽体系补最后一块）

**现象**：`AppShell.tsx:166-190` 的 SidebarContent 内只有两种形态——平铺 nav 与 navGroups，均为纯 `path/label/icon` 链接语义（带 perm/permKey 过滤 + `pathname.startsWith` 高亮）。**交互密度型动态列表**（行内新建按钮、悬浮次级动作、星标切换）无处安放。

**实证（消费方案例）**：orkome ProjectNav（项目导航，约 90 行交互：头部"+"开新建项目 Dialog、行 hover 出"编辑流程"Workflow 图标、星标切换）——壳接入时被迫三选一：①塞 navGroups 丢全部管理动作（功能回退）；②收 sidebarFooter 沉底（项目跳转是高频动作，位置伤可用性，**用户实测一天即反馈"项目咋跑到下面来了"**）；③管理动作迁产品页面（动作与跳转分离，违背就近原则）。三个都是坏解，根因是插槽缺口。

**建议**：`sidebarMiddle?: ReactNode`，渲染于平铺 nav 之后、navGroups 之前（匹配"高频跳转在上"直觉，约 5 行改动）；折叠语义与 sidebarFooter 一致由消费方自理。

**已评估并否决的替代（留档防重提）**：①navGroups items 支持 ReactNode——破坏 perm/permKey 过滤与高亮规则的纯数据协议（0.9.0 的设计资产）；②消费方本地 fork AppShell——复制壳即失去上游演进。

**消费方现状**：orkome 已用 navGroups 纯链接语义先行（项目跳转回位导航区），管理动作暂缺等本插槽回归原位。

## 2. WorkspaceSwitcher：canonical 已就绪，采纳缺口 + 两个增强缝（P1）

**正面（先立此存照）**：kit 版 159 行已是 canonical——size-lg 侧栏头大卡（头像方块+名称+**plan_code**+ChevronsUpDown）、菜单含列表/Check/新建工作区内联表单/E_QUOTA_EXCEEDED 配额引导带计费链接；`useWorkspaceSwitch` 数据面（current/list/switchTo/create/creating/error）完整。

**问题**：orkome 被迫自研 50 行简版（h-7 小下拉：无 plan_code、无新建入口、折叠态无适配），根因=kit 切换器依赖 `useWorkspaceSwitch` → WorkspaceContext，而 orkome 未挂 Provider（壳接入时的 AuthBridge 波次取舍，Provider 完整挂载已排期）。

**建议两件**：
a) **数据注入缝评估**：WorkspaceSwitcher 支持可选 props 覆盖数据源（`data?: WorkspaceSwitchData`，缺省回落 hook）——未挂 Provider 的渐进采纳消费方可用自有状态喂入，已挂的零感知。与 AppShell 渐进可渲染（ui2-adoption 报告 #2）同一叙事。另一条路是消费方一律先挂 Provider（orkome 已排期），框架侧二选一定契约。
b) **`menuFooter?: ReactNode` 槽**：消费方在内置"新建工作区"之后补自己的 footer 项（orkome 需加「工作区设置」与「邀请码加入」两项）。

**评估后不做的（留档）**：每行尾随图标按钮。ARIA menu 契约下 menuitem 内嵌交互按钮是反模式；业界横评（Notion/Linear/Slack/Vercel/shadcn canonical）唯一做行级动作的 Notion 用自定义 popover 而非 ARIA menu；orkome 判定按频率归位——当前工作区管理走 menuFooter 设置入口，跨行管理等功能真实长出再上自定义 popover。

## 3. kit 级轻量 i18n labels 缝（P1，由组件个案升级为机制）

ui2-adoption 报告 #4（UserMenu 硬编码中文）之后，同类问题已扩散到四个组件，逐个提 labels prop 应升级为统一机制：

| 组件 | 硬编码证据 |
|---|---|
| WorkspaceSwitcher | '选择工作区'(:78)、'新建工作区'、'工作区名称'、'创建中…'/'创建'/'取消'(:134-136)、toast '已创建'(:54)、'切换工作区' aria；**外加 Link 硬编码 '/settings/workspace/billing'**（消费方路由形态不同——orkome 是 /settings#workspace） |
| DataTable | 分页条 '共 X 条 · 第 n/m 页'(:123)、'上一页/下一页'、空态 '本页没有数据，可返回上一页'(:80) |
| UserMenu / SidebarUserMenu | '退出登录'/'账户设置'/'用户菜单'（报告 #4） |
| SecretModal | '我已保存'闸门按钮（:14 契约注释所指） |

**消费方面**：orkome zh/en 双语 + parity 测试；en 用户当前在这四组组件看到中文。

**建议形态（三选一，框架侧裁量）**：①Provider 级统一注入（`KitLabelsProvider` 传键值表，组件读缝、内置默认）——一处配置全 kit 生效，推荐；②每组件 `labels` prop（统一命名、深 merge 默认）；③完整 i18n 消息目录（重，不建议）。文案本身质量好（"我已保存"闸门、配额引导都是对的），缺的只是可覆盖。

## 4. SecretModal 多值形态（P3）

`secretValue: string` 单值契约（SecretModal.tsx:19）。消费场景扩展：MFA 备份码恢复列表（N 个码网格）。建议：`secretValue` 放宽为 ReactNode（复制行为以纯文本 fallback），或抽 MultiSecretDialog 变体。orkome 侧 mfa-card 备份码暂保留手写 Dialog 等此件。

## 5. PageHeader 前缀形态（P3，低优）

详情页页头形态是「返回箭头+徽标+标题+动作位」，PageHeader 现协议（title/description/actions）承载不了前缀——消费方详情页（agents/skills/squads）保留自持页头。可选：`leading?: ReactNode` 槽。不急，记录在案。

---

## 正面确认

- canonical 切换器形态本身全对（大卡 + plan_code 是正确的信息层级，plan_code 展示是 kit 版独有价值）；useWorkspaceSwitch 数据面含配额/402 分流，完整。
- AppShell 插槽体系方向正确（sidebarHeader/footer/settingsContent 三槽已解大半消费场景），本提案 #1 是补最后一块（中部）。
- 提案→发版通道顺畅（tanstack 两步当日落地），本提案期待同款节奏。

## 采纳状态附注（供框架侧了解下游现状）

orkome 现状：AuthBridge（裸 AuthContext.Provider）；自研切换器 50 行暂用；项目跳转已用 navGroups 纯链接语义先行；PloykitProvider 完整挂载已排期（permKey 前置）。本提案 #1/#2/#3 落地后 orkome 一波采纳：ProjectNav 回 sidebarMiddle、切换器换 kit 版（或注入缝喂自有状态）、labels 缝全量接入——届时 AuthBridge 可大幅简化。
