# orkome × ploykit v0.10.x 升级采纳 field report — ploykit 侧发现清单

日期：2026-10-19
来源：orkome（下游消费者）v0.10.1 升级 + 框架壳首次真采纳批次（Go v0.9.1→v0.10.1 + ui 2.0.1 + runtime 0.8.1，orkome 侧三 commit 92c18c4/f213dfb/04237b9）。本批次 orkome 完成了自根提交以来对 @ploykit/ui 的**第一次真实消费**（AppShell 壳替换 + PasswordField），以下发现全部来自真机采纳过程，均已在 ploykit 本仓源码逐条核实并标注 file:line。
格式：沿 field report 先例——每条 = 现象 / 证据 / 建议，供框架侧验证采纳；文末附正面确认。前情：orkome 前端路由栈提案（delivery-audit-orkome-router-proposal，已归档）两步全部落地，本报告不再重复。

---

## 发现清单

### 1. 官方 css 注册姿势在 vite8/rolldown 断裂（P1，采纳阻断）

**现象**：官方注册方式 `@import "@ploykit/ui/tailwind.css";` 在 vite8（rolldown CSS 管线）构建报 ENOENT——路径被解析为 `dist/index.js/tailwind.css`（把 exports `"."` 的 default 产物当目录再拼子路径），而 `packages/ui/package.json` exports 里 `"./tailwind.css": "./tailwind.css"` 条目明明存在。上游 example 用 vite6 无此问题，故此前未暴露。

**为什么严重**：这是每个 vite8 消费方在采纳第一步「注册 kit 类扫描」就会撞上的墙，报错信息（ENOENT 指向一个拼错的路径）完全无线索，且无任何文档提示 workaround——不撞过一次不知道怎么绕。

**已验证的 workaround**（orkome 侧采用）：消费方 global.css 就地声明 `@source "../../node_modules/@ploykit/ui/src";`——与 `@ploykit/ui/tailwind.css` 内容等价（该文件本身只有一条 @source）。产物 CSS 已验证含全部 kit 工具类（bg-sidebar/input-group 等）。

**建议**：①判一下是否 rolldown 的 plain-string subpath exports 解析 bug——若是，可调整 exports 形状规避（如 `"./tailwind.css"` 也用条件映射 `{"default": "./tailwind.css"}`），或在 docs 明写 vite8 的 @source workaround；②tarball-smoke 车道若想收口此类「包能装但注册姿势断」的断裂，可加一个非 vite6 打包器的消费形状检查。

**证据**：orkome web（vite8/rolldown）构建日志 ENOENT 实录；`packages/ui/package.json` exports 字段；workaround 后 orkome `dist/assets/*.css` grep bg-sidebar/input-group/sidebar-wrapper 全命中。

### 2. AppShell 宣称渐进可渲染，但 UserMenu/ImpersonationBanner 无 AuthContext 即整壳崩（P1，自相矛盾）

**现象**：AppShell 对 hooks 做了防御式封装——`useWorkspaceRoleSafe`/`useIsPlatformAdminSafe`（AppShell.tsx:29-45）try/catch 包裹，注释明说「AppShell 不强制宿主包 PloykitProvider（存量测试/渐进接入场景直接渲染）」。但它**无条件渲染**的 UserMenu（UserMenu.tsx:36 裸调 `useAuth()`）与 ImpersonationBanner（ImpersonationBanner.tsx:7）没有同款防御——无 AuthContext 时直接抛错，**整壳崩溃**。orkome 真机实证。

**影响**：「渐进接入」的承诺在壳的必渲染子组件处断裂。消费方哪怕只想先用壳导航（权限过滤降级），也必须先造一个 AuthContext——orkome 被迫挂裸 `AuthContext.Provider` 桥接（user 从自家 me 缓存映射、logout 转发自有 signOut）。

**建议**：二选一，现状是代码与注释互相矛盾——①UserMenu/SidebarUserMenu/ImpersonationBanner 同款 safe 化：无上下文时不渲染或渲染占位，让「不强制 Provider」名实相符（推荐，与 AppShell 已有的 safe 系列同构）；②或把「渲染前必须挂 AuthContext」升级为显式契约写进 AppShell props 注释与 Mount 文档。

**证据**：`packages/ui/src/layouts/AppShell.tsx:29-45`（防御式 + 注释）、`packages/ui/src/components/UserMenu.tsx:36`、`packages/ui/src/components/ImpersonationBanner.tsx:7`。

### 3. hooks 0.8.0 对 runtime 的依赖范围没跟上 0.8 大版（P2，依赖卫生 / 双拷贝 hazard）

**现象**：runtime 发 0.8.x 的同时，hooks 0.8.0 的 dependencies 仍钉 `"@ploykit/runtime": "^0.7.4"`。消费方若同时直接依赖 runtime 0.8.x（采纳 ui 2.0 后直接消费渲染通道契约是合理路径），pnpm 严格隔离树里会出现双拷贝：hooks 内 0.7.4 + 顶层 0.8.x。跨拷贝的模块单例（React context 等）存在断裂风险。

**orkome 侧解法**（供参考）：摘除顶层 `@ploykit/runtime` 直接依赖（orkome 源码零 import runtime，双拷贝随之消失）——但这是每个消费方各自绕，框架侧一次性修掉更好。

**建议**：hooks 发 0.8.1 把范围放宽为 `"^0.7.4 || ^0.8.0"`（或直接 `^0.8.0`，若 hooks 对 runtime 的消费面在 0.8 兼容——建议顺手确认 hydrate/routes 换 RouteAssembler 注入缝后 hooks 是否还有 runtime 值依赖，若无甚至可移除该依赖）。

**证据**：`npm view @ploykit/hooks@0.8.0 dependencies`；orkome `pnpm why @ploykit/runtime` 实测双版本输出（0.7.4 under hooks / 0.8.1 top-level）。

### 4. ui 内置文案硬编码中文、无 override 缝（P2，双语产品的采纳 blocker）

**现象**：UserMenu/SidebarUserMenu 的「账户设置」「退出登录」、失败 toast、aria-label「用户菜单」全部硬编码中文（UserMenu.tsx:48/59/78/98、SidebarUserMenu.tsx:35/51/109）。框架不规定 i18n 是对的（选型文档有记录），但当前形态下双语产品切 en 后框架菜单仍中文，且**没有任何覆盖缝**。

**建议**：不必引入框架级 i18n——给 AppShell/userMenu 加一个可选 labels 覆盖插槽即可，例如 `labels?: { logout?: string; accountSettings?: string; userMenuAria?: string; logoutFailedToast?: string }`，默认值保持现状零破坏，消费方一行接自己的 i18n 字典。

**证据**：上述行号；orkome 为 zh/en 双语产品（有 parity test + 头部语言切换），IAB 真机复现：en 模式下框架菜单仍中文。

### 5. kit Alert 缺 warning 语义（P3）

**现象**：`alertVariants` 仅有 default/destructive 两个 variant（alert.tsx:8-15），无 warning。消费方的警示容器（amber 类语义）只能手写 div 或整皮覆写 kit Alert——orkome 采纳评审时两处 amber 落点**全部主动跳过**（保留自己的 amber 容器范式），kit 在这个最常见的告警形态上没有可交付的东西。

**建议**：加 `warning` variant（一行 cva + amber token）。warning 在 Base UI/shadcn 生态是常规第三态；destructive 已有，唯独中间态缺失略反直觉。

**证据**：`packages/ui/src/components/ui/alert.tsx:8-15`。

---

## 正面确认（本轮升级+采纳中验证通过的面）

- **Go v0.9.1→v0.10.1 零 API 破坏**：orkome `go build/vet` 零调用点改动直接通过；全量 DB 测试除预存失败（在 v0.9.1 干净 worktree 上同样失败）外全绿。
- **role_perms 下发验证通过**：GET /api/workspaces 每行带非空 `role_perms`，orkome 在真实 identityhttp+workspacehttp 挂载链上加断言测试（wiring_workspace_test）通过；owner=全量目录语义符合预期。
- **ui 2.0 迁移质量**：AppShell + PasswordField 在 orkome 真机（亮/暗双态）渲染正确；kit token 与消费方 @theme 同源无视觉漂移（PasswordField 的 InputGroup 与 orkome Input 同 token）；permKey/rolePerms「未知默认可见」降级语义工作正常（无 Provider 场景实测）。
- **提案采纳通道**：runtime 解耦与 ui 2.0 两步的提交信息直接引用 orkome 提案步骤，提案→发版的链路顺畅，下游验收到位。

## 采纳状态附注（供框架侧了解下游现状）

orkome 本批次后：壳=AppShell（userMenu='sidebar-footer' 形态）+ 裸 AuthContext.Provider 桥接；组件面=PasswordField 已采纳，Alert/Item/Spinner 有据跳过；**permKey 细粒度侧栏过滤留待下一波**（等 #2 落地后决定 PloykitProvider 完整采纳方式）。
