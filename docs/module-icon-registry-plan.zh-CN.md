# PloyKit 模块图标注册机制设计

> 状态：Phase 1 已落地（宿主侧）
> 日期：2026-06-17
> 目标读者：宿主维护者、模块作者
> 关联文档：`service-integration-guide.zh-CN.md`、`skills/ploykit-module-developer/references/host-capabilities.md`

---

## 0. Phase 1 落地结果

本轮已完成宿主侧通用能力，但刻意没有把 RunLynk 的 `clipboardList` 迁移夹带进同一组改动：

- SDK 增加 `assets.icons` 类型与 validator 基础校验，支持 `{ kind: 'lucide'; name }` 与 `{ kind: 'svg'; path }`。
- 宿主核心 16 项图标移入 `scripts/lib/host-core-icons.mjs`，生成器统一产出 `src/lib/generated/module-icons.ts` 与可选 `src/lib/generated/module-icons/*.tsx`。
- `scripts/generate-module-map.mjs --check` 已覆盖 icon 生成物漂移；`npm run modules:check` 会阻塞未生成或过期的 registry。
- Dashboard 与 admin 的模块导航入口会把模块本地 key 优先解析为 `<moduleId>:<localKey>`，宿主核心 key 继续保持短 key。
- `Sidebar` 改为消费 `MODULE_ICONS`，缺失时 dev warning 并回退到 `activity`；`MobileNav` 仍不渲染 item icon，只共享类型。
- RunLynk 当前按模块侧短期方案使用 host core 图标 `activity`；`assets.icons.clipboardList` 迁移留给后续独立模块 PR。
- `package.json` 已增加 `prehost:dev`、`prehost:build`、`pretypecheck`，匹配当前仓库实际脚本名 `host:dev` / `host:build` / `typecheck`。

与原规约的差异：

- 当前生成器没有引入外部 `svgo` / XML AST 依赖，而是先落了保守的内置 SVG 白名单 sanitizer。它只允许基础形状标签和安全属性，拒绝脚本、事件属性、外链引用；后续若要支持更复杂品牌 SVG，再按 §7.1 升级到 SVGO + AST 双层清洗。
- `module:doctor` 的 icon 友好诊断、未使用声明 warning、近似匹配建议尚未单独展开；当前阻塞发生在 SDK validator 与 `modules:scan/modules:check`。
- `npm run typecheck` 已确认会先触发 `modules:scan`；本轮验证时 typecheck 被 `modules/runlynk/i18n.ts` 既有重复 key 阻塞，非图标链路问题。

---

## 1. 背景

f6c4b4f「Harden host module boundary」之后，PloyKit 明确了一条规则：宿主只提供通用能力，模块特定的产品语义不应渗透到宿主代码。

但侧边导航的图标系统违反了这条规则。当前 `apps/host-next/components/layout/Sidebar.tsx:30-50` 用一张写死的 16 项 `navIcons` 表，模块在 `navigation[].icon` 里写的字符串如果不在这 16 项里，就会静默渲染空白。RunLynk 的 jobs 项声明 `icon: 'clipboardList'` 就掉进了这个坑。

直接的修法只有两种，都不理想：

- 让 RunLynk 改用 `activity` 等已注册图标。每个模块都被迫迁就宿主的 16 项调色板，视觉表达受限。
- 在宿主里加一项 `clipboardList`。每接入一个新模块就改一次宿主 PR，边界形同虚设。

需要一种通用机制，让模块自助声明自己想用的图标，宿主只负责接住，从此不再为单模块新增图标改代码。

---

## 2. 现状与卡点

### 2.1 关键文件

| 文件 | 行号 | 现状 |
| --- | --- | --- |
| `apps/host-next/components/layout/types.ts` | `NavIconKey` 字面量 union | 16 项硬编码 |
| `apps/host-next/components/layout/Sidebar.tsx` | 30-50 | 手写 lucide import + 字面量映射 |
| `apps/host-next/components/layout/MobileNav.tsx` | 5 | 仅引用 `Menu/X/ChevronRight`，**不渲染 item icon**，但 type 仍走 `NavIconKey` |
| `modules/runlynk/app-model/dashboard-navigation.ts` | 53 | `icon: 'clipboardList'` 实际未渲染 |
| `src/lib/module-map.ts` | 生成 | 不感知图标 |
| `scripts/generate-module-map.mjs` | 生成 | 不感知图标 |

### 2.2 问题归类

- **类型逃逸**：模块用 `as NavItem['icon']` 强转，编译期不报错。
- **运行时静默**：表里没有就不画，没有 fallback 提示。
- **bundle 与策展冲突**：lucide 有 1500+ 图标，全打进 bundle 不可接受；策展又意味着每个新图标走宿主 PR。
- **跨模块协作缺失**：A 模块和 B 模块都想要 "clipboard"，没有去重机制。

---

## 3. 设计目标与非目标

### 3.1 v1 目标

- 模块在自己的 `module.ts` 里声明图标资源，宿主自动接住。
- **生成期 + doctor 校验安全**：在 `modules:scan` 与 `module:doctor` 阶段捕获错拼、缺图标、SVG 不合规。
- **Sidebar 运行时安全**：取不到图标时回退到 host core 占位图标 + dev 警告，永不留白。
- bundle 受控：仅打入 `navigation[].icon` **实际引用**的图标，未引用的声明仅在 doctor 中告警。
- 安全：自带 SVG 必须通过 SVGO + AST 白名单清洗，不能携带脚本或外部引用。
- 与 `assets.locales` 心智对称，模块作者无新概念负担。
- 宿主**只改一次**，后续模块迁入零侵入。

### 3.2 v1 非目标

- 不承诺 TypeScript 编译期类型安全。`NavigationContribution.icon` 在 SDK 中保持 `string` 类型，安全发生在生成期。TS 级别安全是 v2 目标（见 §15）。
- 不替换 lucide 作为宿主默认图标库。
- 不引入图标 CDN、远程加载、运行时动态注入。
- 不试图给所有 UI 表面（按钮、空状态、表头等）做统一图标策展。第一版只覆盖 `navigation[].icon` 的 `dashboard.sidebar` / `admin.sidebar` 消费点，但注册表设计成与导航解耦，后续表面可复用。
- 不引入 iconify / heroicons / phosphor。可作为后续扩展，第一版仅支持 `lucide` 与 `svg`。
- 不动 `MobileNav.tsx` 的 icon 渲染行为（当前不渲染 item icon，是设计选择）。

---

## 4. 模块作者 API

### 4.1 在 `module.ts` 声明

与 `assets.locales` 对称，新增 `assets.icons`：

```ts
import { defineModule, Permission } from '@ploykit/module-sdk';

export default defineModule({
  id: 'runlynk',
  /* ... */
  assets: {
    locales: {
      en: './locales/en.json',
      zh: './locales/zh.json',
    },
    icons: {
      clipboardList: { kind: 'lucide', name: 'ClipboardList' },
      workerHat:     { kind: 'svg', path: './assets/icons/worker-hat.svg' },
    },
  },
  navigation: [
    {
      location: 'dashboard.sidebar',
      labelKey: 'nav.console.jobs',
      path: '/runlynk/jobs',
      icon: 'clipboardList',  // 模块本地 key，generator 会命名空间化
      weight: 22,
    },
  ],
});
```

### 4.2 模块本地 key + 自动命名空间化

模块作者在 `assets.icons` 与 `navigation[].icon` 中只写**模块内本地 key**（如 `clipboardList`、`workerHat`）。

generator 在合并阶段会按规则生成全局唯一 id：

| 来源 | 生成 id 规则 |
| --- | --- |
| host core 16 项 | 不加前缀，保持原 key（`activity`、`layoutDashboard`...） |
| 模块声明（`kind: 'lucide'`） | 同 lucide 名字的多模块声明会**收敛到同一 lucide 引用**，但每个模块仍持有自己的命名空间 id（`runlynk:clipboardList`） |
| 模块声明（`kind: 'svg'`） | 始终命名空间化为 `<moduleId>:<localKey>`（`runlynk:workerHat`） |

`navigation[].icon: 'clipboardList'` 在模块 contract 中保持本地 key。宿主在 dashboard/admin 导航入口处已知 `moduleId`，会先尝试解析为 `'runlynk:clipboardList'`，再回退到 host core 短 key；Sidebar runtime 只接收解析后的 `NavItem.icon` 并查表。

模块作者不暴露在全局命名竞争中：A 模块和 B 模块都可以叫 `workerHat`，互不干扰。

### 4.3 `lucide` 引用

```ts
{ kind: 'lucide', name: 'ClipboardList' }
```

- `name` 必须是 `lucide-react` 的真实导出（PascalCase）。
- 校验阶段查 lucide 包的导出表，不存在则报 `MODULE_RESOURCE_ICON_LUCIDE_NAME_NOT_FOUND`，附近似匹配建议。
- 多模块声明同一个 lucide 图标在 generator 内部去重（同一 import），但模块间命名仍各自独立。

### 4.4 自带 SVG

```ts
{ kind: 'svg', path: './assets/icons/worker-hat.svg' }
```

- 路径相对模块根目录，必须存在于模块目录内。校验使用 `fs.realpath` + `path.relative` 比较，识别 symlink、`..` 解析后逃逸、Windows 大小写漂移。
- 必须通过 SVGO 清洗 + AST 白名单二次校验（见 §7.1）。
- 推荐 viewBox `0 0 24 24`、`stroke="currentColor"`、`fill="none"`，与 lucide 视觉一致；不强制，但 doctor 会警告。

### 4.5 `icon` 字段类型

`@ploykit/module-sdk` 中 `NavigationContribution.icon` v1 保持 `string` 类型。模块开发者获得安全的两层防线：

- 生成期：generator 检查每条 `navigation[].icon` 都能解析到合并表中的某个 id，否则 `MODULE_NAVIGATION_ICON_UNDECLARED` 阻塞。
- doctor：单模块视角下重复检查，错拼会被列出近似匹配（Levenshtein）。

v2 计划引入泛型 `defineModule<TIcons>`，把 `keyof TIcons` 与 host core 键合并为 union 暴露给 `navigation[].icon`，实现真正的 IDE 补全（详见 §15.5）。

---

## 5. 宿主侧实现

### 5.1 SDK schema 扩展

`@ploykit/module-sdk` 在 `Resources` 类型新增：

```ts
export type ModuleIconResource =
  | { kind: 'lucide'; name: string }
  | { kind: 'svg'; path: string };

export interface ModuleResources {
  locales?: Record<string, string>;
  icons?: Record<string, ModuleIconResource>;
  /* ... */
}
```

`validateModuleDefinition` 增加校验（见 §6）。

### 5.2 generator 流程

`scripts/generate-module-map.mjs` 增加 `collectModuleIcons` 步骤：

```
1. 加载 HOST_CORE_ICONS（host 自己声明的核心 16 项）
2. 遍历所有模块的 assets.icons
3. 校验：
   - key 命名合法
   - lucide name 存在于 lucide-react 导出
  - svg 文件存在 + 模块根目录约束 + 保守白名单清洗通过
4. 命名空间化：模块声明的 key → <moduleId>:<localKey>
5. 扫描所有 navigation[].icon 引用，构建"实际使用集"
6. 仅"实际使用集 ∩ (host core ∪ 命名空间化模块图标)"进入最终注册表
7. 生成产物：
   - src/lib/generated/module-icons.ts（入仓库）
   - src/lib/generated/module-icons/<sanitized-id>.tsx（仅 svg 类型，入仓库）
8. 未被 navigation 引用的声明 → doctor warn（不进 bundle）
```

宿主核心 16 项不再写在 `Sidebar.tsx`，移到 `scripts/lib/host-core-icons.mjs`：

```js
export const HOST_CORE_ICONS = {
  activity: { kind: 'lucide', name: 'Activity' },
  layoutDashboard: { kind: 'lucide', name: 'LayoutDashboard' },
  /* ... 共 16 项，与现状一一对应 */
};
```

generator 把核心图标和模块图标走同一管道，单一真相源。

### 5.3 生成产物

**重要：所有生成产物都入仓库**，与 `src/lib/module-map.ts` 处理方式一致。`.runtime/` 目录只放运行时缓存，**不被 import**，避免 fresh clone / typecheck / CI 在 scan 之前找不到文件。

`src/lib/generated/module-icons.ts`（自动生成，禁止手编）：

```ts
/**
 * 自动生成于 scripts/generate-module-map.mjs。
 * Module count: 8, Icon count: 19
 *
 * 不要手编。修改方式：
 * 1. 改对应模块的 assets.icons
 * 2. 跑 npm run modules:scan
 */
import type { ComponentType, SVGProps } from 'react';
import {
  Activity,
  ClipboardList,
  LayoutDashboard,
  /* ... 仅被引用的 lucide 图标 */
} from 'lucide-react';
import RunlynkWorkerHat from './module-icons/runlynk-worker-hat';

export type ModuleIconProps = SVGProps<SVGSVGElement>;

export type ModuleIconKey =
  // host core
  | 'activity'
  | 'layoutDashboard'
  /* ... */
  // 命名空间化的模块图标
  | 'runlynk:clipboardList'
  | 'runlynk:workerHat';

export const HOST_CORE_ICON_FALLBACK = 'activity';

export const MODULE_ICONS = {
  // host core
  activity: Activity,
  layoutDashboard: LayoutDashboard,
  /* ... */
  // 模块图标（命名空间化）
  'runlynk:clipboardList': ClipboardList,
  'runlynk:workerHat': RunlynkWorkerHat,
} satisfies Record<string, ModuleIconComponent>;
```

每个 `kind: 'svg'` 的图标生成一个 `.tsx` 文件 `src/lib/generated/module-icons/<sanitized-id>.tsx`，文件名由 `<moduleId>:<localKey>` 转 kebab-case 得到（`runlynk-worker-hat.tsx`）。文件内容：

```tsx
// 自动生成，禁止手编。
import type { SVGProps } from 'react';

export default function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {/* SVGO + AST 清洗后的 path / shape */}
    </svg>
  );
}
```

`.runtime/` 仅作为构建中间缓存（如增量 hash 比对），不参与 import。

### 5.4 Sidebar 消费 + fallback

`apps/host-next/components/layout/types.ts`：

```ts
import type { ModuleIconKey } from '@/lib/generated/module-icons';

export type NavIconKey = ModuleIconKey;
```

`apps/host-next/components/layout/Sidebar.tsx`：

```ts
import { MODULE_ICONS, HOST_CORE_ICON_FALLBACK } from '@/lib/generated/module-icons';

// 删除原 navIcons 字面量
function resolveNavIcon(key: string | undefined) {
  if (!key) return undefined;
  const Icon = MODULE_ICONS[key as ModuleIconKey];
  if (Icon) return Icon;
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[host] navigation icon "${key}" not registered, falling back`);
  }
  return MODULE_ICONS[HOST_CORE_ICON_FALLBACK];
}
```

**fallback 行为**：取不到图标时不渲染空白，回退到 host core 的占位图标（当前为 `activity`），dev 模式 console.warn，prod 静默。这避免了 stale registry 或异步部署期间的视觉空洞。

### 5.5 MobileNav 不改

`MobileNav.tsx` 当前**不渲染** item icon（仅渲染 `label` 与 `detail`），是空间设计选择。第一版只把 type alias 改成新的 `ModuleIconKey`（与 Sidebar 共享 `NavItem` 类型），不引入 `MODULE_ICONS` 查表，不增加移动端 client bundle。

未来要让移动端也显示导航 icon，再通过独立 PR 改造，与本提案解耦。

### 5.6 dev / build 链路

`package.json` scripts 显式串联：

```json
{
  "scripts": {
    "prehost:dev": "npm run modules:scan",
    "prehost:build": "npm run modules:scan",
    "pretypecheck": "npm run modules:scan",
    "modules:scan": "node scripts/generate-module-map.mjs",
    "modules:check": "node scripts/generate-module-map.mjs --check"
  }
}
```

CI 守卫：

```yaml
- run: npm run modules:check        # --check 模式：不写盘，仅校验
- run: git diff --exit-code src/lib/generated/  # 防止生成产物漂移
```

| 链路 | 行为 |
| --- | --- |
| `npm run modules:scan` | 重新生成 `src/lib/generated/module-icons.ts` 与 `module-icons/*.tsx` |
| `npm run host:dev` | `prehost:dev` hook 自动 scan 一次 |
| `npm run host:build` | `prehost:build` hook 自动 scan 一次 |
| `npm run typecheck` | `pretypecheck` hook 自动 scan 一次 |
| 模块作者改 `module.ts` 后 | 需要手动 `npm run modules:scan`（与现在加路由、加表的体验一致） |
| `npm run modules:check` | `--check` 模式比对 `module-map`、manifest 与 icon 生成物 |

文档明确说明：dev 期间不主动 watch `module.ts` 变化触发 generator。如果未来要 watch，作为独立改进。

---

## 6. 校验规则

当前代码已落地的 SDK validator 错误码：

- `MODULE_ICON_KEY_INVALID`
- `MODULE_ICON_KIND_INVALID`
- `MODULE_ICON_LUCIDE_NAME_REQUIRED`
- `MODULE_ICON_LUCIDE_NAME_INVALID`
- `MODULE_ICON_SVG_PATH_INVALID`
- 复用既有 `MODULE_LOCAL_PATH_REQUIRED` / `MODULE_LOCAL_PATH_INVALID`

下面是完整目标规则表，其中 SVG 深度安全错误码、未使用声明 warning 与近似匹配建议属于后续硬化项：

| 错误码 | 触发条件 | 阻塞等级 |
| --- | --- | --- |
| `MODULE_RESOURCE_ICON_KEY_INVALID` | key 非 camelCase 标识符 | error |
| `MODULE_RESOURCE_ICON_KIND_INVALID` | `kind` 不在白名单 | error |
| `MODULE_RESOURCE_ICON_LUCIDE_NAME_REQUIRED` | `kind: 'lucide'` 缺 `name` | error |
| `MODULE_RESOURCE_ICON_LUCIDE_NAME_NOT_FOUND` | `name` 不在 lucide 导出表（错误信息附近似匹配） | error |
| `MODULE_RESOURCE_ICON_SVG_PATH_REQUIRED` | `kind: 'svg'` 缺 `path` | error |
| `MODULE_RESOURCE_ICON_SVG_PATH_OUTSIDE_MODULE` | path 经 realpath 解析后逃出模块根 | error |
| `MODULE_RESOURCE_ICON_SVG_NOT_FOUND` | 文件不存在 | error |
| `MODULE_RESOURCE_ICON_SVG_UNSAFE` | SVG 含被禁元素 / 属性 / 不安全的 url() | error |
| `MODULE_RESOURCE_ICON_CORE_OVERRIDE_DENIED` | 模块声明的本地 key 与 host core 同名（命名空间化前的预检） | warn（可继续，仅提示模块作者考虑改名） |
| `MODULE_RESOURCE_ICON_VIEWBOX_NON_STANDARD` | SVG viewBox 不是 `0 0 24 24` | warn |
| `MODULE_RESOURCE_ICON_STROKE_NON_CURRENTCOLOR` | SVG stroke 写死颜色，破坏 dark mode | warn |
| `MODULE_RESOURCE_ICON_DECLARED_BUT_UNUSED` | 模块声明但 navigation 未引用 | warn |
| `MODULE_NAVIGATION_ICON_UNDECLARED` | `navigation[].icon` 在合并表中找不到（命名空间化失败 / 未声明） | error |
| `MODULE_GENERATED_ICONS_DRIFT` | CI 检查到生成产物与工作区差异 | error |

> 注：v1 不再有 `MODULE_RESOURCE_ICON_CONFLICT`。命名空间化后，模块本地 key 不会跨模块冲突；同 lucide 名的多源声明在 generator 内部自动去重，无需暴露给作者。

---

## 7. 安全

### 7.1 SVG 清洗（双层）

第一层：使用 [SVGO](https://github.com/svg/svgo) 做语法层清洗，配置 plugin 移除明显危险内容。

```js
import { optimize } from 'svgo';

const sanitizeSvgRaw = (raw) => optimize(raw, {
  multipass: true,
  plugins: [
    { name: 'preset-default', params: { overrides: { removeViewBox: false } } },
    { name: 'removeScripts' },
    { name: 'removeStyleElement' },
    { name: 'removeAttrs', params: { attrs: '(on.*|style|class)' } },
  ],
});
```

第二层：SVGO 输出后再用 XML AST 解析（如 `xast-util-from-xml`），按白名单二次校验。**不使用正则清洗 SVG**——正则一定有边角漏洞。

允许的元素：

```
svg, g, defs, title, desc,
path, circle, rect, ellipse, line, polyline, polygon,
linearGradient, radialGradient, stop,
clipPath, mask, use（仅引用同文件 id）
```

允许的属性：

```
viewBox, width, height, preserveAspectRatio,
fill, stroke, stroke-width, stroke-linecap, stroke-linejoin,
stroke-miterlimit, stroke-dasharray, stroke-dashoffset,
stroke-opacity, fill-opacity, fill-rule,
opacity, transform, x, y, x1, y1, x2, y2, cx, cy, r, rx, ry,
d, points, offset, stop-color, stop-opacity,
id, clip-path, clip-rule, mask, gradient-units, spread-method,
href, xlink:href（仅 #local-id）,
aria-hidden, role, focusable
```

属性值校验：

- `href` / `xlink:href` 必须匹配 `^#[A-Za-z_][A-Za-z0-9_-]*$`，仅允许同文件 id 引用，拒绝外部 URL、`javascript:`、`data:`。
- `fill` / `stroke` / `clip-path` / `mask`：若值以 `url(` 开头，括号内必须是 `#local-id`，拒绝 `url(http...)`、`url(data:...)`、`url(javascript:...)`。
- 任意属性值含 `javascript:`、`data:`、`expression(`、`<` 等 → 拒绝。

禁止：

- `<script>`、`<foreignObject>`、`<iframe>`、`<image>`（外部引用）。
- 任意 `on*` 事件属性。
- 内嵌 `<style>` 元素。
- DOCTYPE、ENTITY 声明、CDATA 中的可执行 payload。

校验失败触发 `MODULE_RESOURCE_ICON_SVG_UNSAFE` 并阻塞构建，错误信息包含违规元素 / 属性的具体位置。

### 7.2 路径逃逸防护

`path` 解析顺序：

```js
import fs from 'node:fs/promises';
import path from 'node:path';

async function resolveSafeSvgPath(declared, moduleRoot) {
  const candidate = path.resolve(moduleRoot, declared);
  // 1. realpath 解析 symlink
  const real = await fs.realpath(candidate);
  const realRoot = await fs.realpath(moduleRoot);
  // 2. 用 path.relative 判断，比 startsWith 更稳
  const rel = path.relative(realRoot, real);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('MODULE_RESOURCE_ICON_SVG_PATH_OUTSIDE_MODULE');
  }
  return real;
}
```

要点：

- 用 `fs.realpath` 而非字符串前缀比较，识别 symlink 链。
- 用 `path.relative` 判断，避免 Windows 大小写漂移、UNC 路径、混合分隔符引发的误判。
- 拒绝相对路径解析后变成绝对路径的情况（如 `path: '/etc/passwd'`）。

### 7.3 lucide name lookup

```js
const lucideExports = await import('lucide-react');
const safeName = String(declaredName);
if (!/^[A-Z][A-Za-z0-9]*$/.test(safeName)) {
  throw new Error('MODULE_RESOURCE_ICON_LUCIDE_NAME_NOT_FOUND');
}
if (!Object.hasOwn(lucideExports, safeName)) {
  throw new Error('MODULE_RESOURCE_ICON_LUCIDE_NAME_NOT_FOUND');
}
```

拒绝带点、斜杠、空格、控制字符、非 PascalCase 的 name，防止注入到生成代码中。

### 7.4 生成产物校验

CI 步骤：

```yaml
- run: npm run modules:check
- run: git diff --exit-code src/lib/generated/
```

`--check` 模式不写盘，仅在内存中跑一遍生成、与现有文件做 byte-level 对比，差异时报 `MODULE_GENERATED_ICONS_DRIFT` 退出。这防止有人手编 `module-icons.ts` 或忘记跑 scan。

---

## 8. Bundle 与性能

### 8.1 bundle

- lucide 部分按命名导入，webpack/turbo tree-shake 生效，**仅打 navigation 实际引用的 lucide 图标**。
- SVG 部分每个图标一个 React 组件文件，约 0.3-1 KB（取决于 path 复杂度）。
- 50 模块、200 个被引用图标的极端场景下，新增体积约 30-60 KB（gzip 后），可接受。
- 未被 navigation 引用的声明不进 bundle，仅在 doctor 中提示。

### 8.2 性能

- 生成阶段：图标聚合 O(N) N=模块数，对现有 `modules:scan` 几乎不增加开销。
- 运行时：`MODULE_ICONS[key]` 是 Record 查表，O(1)；fallback 路径 O(1)。
- SSR：lucide 与生成的 SVG 组件都是纯函数式，无副作用，与现有 `'use client'` Sidebar 兼容。

### 8.3 后续优化（非首版）

- 若 bundle 显著膨胀，可改为按 sidebar 路由懒加载图标。
- 若图标量大到影响 build 时间，对生成文件做 sha256 增量比对，未变更时跳过写盘。
- v2 把 `MobileNav` 也接入时再评估二次拆包。

---

## 9. 实施步骤

### Phase 1（host 侧通用能力，已完成）

1. `@ploykit/module-sdk` 增加 `assets.icons` schema 与 validator 规则（§6）。
2. `scripts/lib/host-core-icons.mjs` 提取宿主当前 16 项核心图标。
3. `scripts/generate-module-map.mjs` 增加：
   - `collectModuleIcons`：聚合 + 命名空间化 + lucide 校验。
   - `sanitizeSvgIcon`：保守 SVG 白名单清洗；SVGO + AST 留作后续硬化。
   - `resolveModuleNavigationIconKey`：在 dashboard/admin 导航入口把模块本地 `icon` key 解析成 `<moduleId>:<localKey>`。
   - `filterByNavigationUsage`：仅保留 navigation 实际引用的图标。
   - 写出 `src/lib/generated/module-icons.ts` 与 `src/lib/generated/module-icons/*.tsx`。
   - `--check` 模式。
4. `package.json` 加 `prehost:dev` / `prehost:build` / `pretypecheck` / `modules:check` scripts。
5. `apps/host-next/components/layout/types.ts` 改为 `type NavIconKey = ModuleIconKey`。
6. `Sidebar.tsx` 改用 `MODULE_ICONS` 与 `resolveNavIcon` fallback；删除原 `navIcons` 字面量与 lucide 直接 import。
7. `MobileNav.tsx` 仅同步 type alias，不引入 `MODULE_ICONS`。
8. `modules:check` 已纳入 icon 生成物漂移校验；CI 额外 `git diff` 守卫可继续补。
9. 已补 `module-contract`、`module-map`、`host-page-runtime` 相关测试（§17.3）。
10. 文档已更新本规约与 RunLynk 对齐文档；`host-capabilities.md`、`module-development.zh-CN.md` 可作为后续文档扩展。

### Phase 2（模块迁移，后续独立 PR）

1. RunLynk：在 `module.ts` 加 `assets.icons.clipboardList = { kind: 'lucide', name: 'ClipboardList' }`，`dashboard-navigation.ts` 的 `icon: 'clipboardList'` 不变。
2. 其它模块：按需声明，旧字面量键不变。

Phase 1 完成后，host core 16 项继续作为 `MODULE_ICONS` 的一部分工作；旧字面量键继续命中。Phase 2 是渐进迁移，不阻塞功能，也不夹带在宿主 Phase 1 PR 里。

---

## 10. 测试策略

### 10.1 单测（SDK validator）

- 合法 lucide 声明通过。
- lucide 名格式错误报 `MODULE_ICON_LUCIDE_NAME_INVALID`；真实导出存在性由 generator 校验。
- SVG 路径逃出模块根复用 `MODULE_LOCAL_PATH_INVALID`；非 `.svg` 报 `MODULE_ICON_SVG_PATH_INVALID`。
- key 非 camelCase 报 `MODULE_ICON_KEY_INVALID`。
- 后续硬化：不存在的 lucide 名友好近似匹配、SVG 深度安全错误码、doctor warning。

### 10.2 集成（generator）

- fixture 项目含 2 模块，分别声明 lucide + svg，生成产物正确，命名空间化无误。
- 同 lucide 名的多模块声明在产物中复用同一 lucide 引用。
- 自带 SVG 的模块各自有独立 `<moduleId>:<localKey>` id。
- navigation 未引用的声明不进 `MODULE_ICONS`，doctor 给 warn。
- `--check` 模式检测到差异时正确退出。
- 当前内置白名单 sanitizer 会拒绝 `<script>`、事件属性、外链引用；SVGO + AST 双层清洗留作后续硬化。

### 10.3 端到端

- host 在 dev mode 下渲染 Sidebar，模块图标可见。
- `tests/module-map-cli.test.ts` 已增加临时 fixture：模块声明 `listChecks` 时生成 `<moduleId>:listChecks`，不把 RunLynk 当迁移样例。
- `tests/host-page-runtime.test.ts` 已增加用例：host core icon 继续命中，未知 icon 返回 `undefined`，Sidebar 自身负责 fallback。
- `npm run typecheck` 已验证 `pretypecheck` hook 生效；当前被 `modules/runlynk/i18n.ts` 既有重复 key 阻塞。

### 10.4 回归

- 现有 16 个核心图标在 sidebar 渲染不变（视觉快照）。
- `module:doctor` 在缺图标声明时给出明确错误。
- CI 禁止生成产物漂移。

---

## 11. 迁移路径：RunLynk

### 11.1 Phase 1 之前

```ts
// modules/runlynk/app-model/dashboard-navigation.ts:53
icon: 'clipboardList',  // 静默不渲染
```

### 11.2 当前短期修复（本轮）

```ts
// modules/runlynk/app-model/dashboard-navigation.ts
icon: 'activity',  // 使用 host core 图标，不夹带 RunLynk 图标迁移
```

这保证宿主 Phase 1 能独立落地，也符合“不要在同一 PR 把 RunLynk 具体图标需求塞进宿主机制”的边界。

### 11.3 后续独立模块 PR

```ts
// modules/runlynk/module.ts
resources: {
  locales: { /* ... */ },
  icons: {
    clipboardList: { kind: 'lucide', name: 'ClipboardList' },
  },
},
```

```ts
// modules/runlynk/app-model/dashboard-navigation.ts:53
icon: 'clipboardList',  // 模块本地 key，宿主导航入口会解析为 'runlynk:clipboardList'
```

该独立 PR 跑 `npm run modules:scan` 后，`src/lib/generated/module-icons.ts` 中会出现：

```ts
"runlynk:clipboardList": ClipboardList,
```

宿主 dashboard/admin 导航入口会优先把模块本地 `clipboardList` 解析为 `runlynk:clipboardList`。这一步是 RunLynk 模块迁移，不属于宿主 Phase 1。

### 11.4 如果 RunLynk 未来要自带品牌 SVG

```ts
resources: {
  icons: {
    runlynkLogo: { kind: 'svg', path: './assets/icons/runlynk-logo.svg' },
  },
},
```

`./assets/icons/runlynk-logo.svg` 满足清洗规则即可。生成产物中会出现：

- `src/lib/generated/module-icons/runlynk-runlynk-logo.tsx`
- `MODULE_ICONS['runlynk:runlynkLogo']` 引用

---

## 12. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| lucide-react 版本升级删图标 | 模块构建失败 | validator 在升级 PR 中提前发现；模块迁移到替代图标或自带 SVG |
| SVGO 升级行为漂移 | 清洗结果变化 | pin 版本，升级走独立 PR + 视觉快照 |
| AST 白名单误杀合法元素 | 模块图标不可用 | 起始白名单尽量宽，收集真实使用模式后调整 |
| 模块大量声明未使用图标 | doctor 噪音 | warn 不阻塞，CI 加阈值告警（如 >20 个未引用） |
| 生成文件被手编 | 数据不一致 | `modules:check` + `git diff` 在 CI 拦截 |
| 新模块未跑 scan 提交 | TS 报错 / 视觉空洞 | `pretypecheck` hook + Sidebar fallback 双重保护 |
| Windows 长路径 | 极端项目构建失败 | 命名空间化 id 通过 kebab-case 转换控制长度，单文件名 ≤ 80 字符 |
| 模块作者不熟悉 lucide 名称 | doctor 错误后无方向 | `MODULE_RESOURCE_ICON_LUCIDE_NAME_NOT_FOUND` 错误信息附近似匹配建议（Levenshtein 距离 ≤ 3） |

---

## 13. 备选方案对比

| 方案 | 类型安全 | bundle | 安全 | 模块作者负担 | 宿主改动量 | 评价 |
| --- | --- | --- | --- | --- | --- | --- |
| 扩 NavIconKey 到 lucide 全集 | 强 | 极差 | 好 | 零 | 一次 | 不可接受 |
| 模块直接传 React 组件 | 弱 | 好 | 差（任意代码） | 高 | 中 | 破坏 SSR/RSC 边界 |
| 模块传 `{kind, name}` 对象到 NavItem.icon | 中 | 好 | 中 | 中 | 大（消费方全改） | 类型扩散 |
| 字符串键 + 宿主白名单 | 中 | 好 | 好 | 低（受限） | 每加一个图标改一次 | 当前现状，边界破洞 |
| **assets.icons + 代码生成 + 命名空间化（本提案 v1）** | **生成期** | **好** | **好** | **低** | **一次** | **推荐** |
| iconify 远程加载 | 中 | 极差（在线） | 差 | 低 | 大 | 与离线宿主理念冲突 |

---

## 14. 后续扩展

提案落地后，注册表可承接更多场景：

- **MobileNav 引入 icon**：Sidebar 验证稳定后，独立 PR 接入 `MODULE_ICONS`。
- **页面 header / 空状态 / surface 槽位**：消费同一 `MODULE_ICONS`，扩展点不再受 sidebar 限制。
- **多图标库支持**：增加 `kind: 'phosphor' | 'heroicons'`，同走 generator 校验。
- **品牌图标包**：白标主题可通过 `presentation.icons` 替换核心键（受 `Permission.SurfaceOverride` 守卫）。
- **尺寸变体**：在生成产物里增加 `MODULE_ICONS_SM / MODULE_ICONS_LG`，模块声明时可指定支持的尺寸。

这些都是**可选**的后续扩展，第一版严格只做导航 + lucide + svg + Sidebar 消费点。

---

## 15. 决策点

提案落地前需要确认：

1. **lucide-react 是否长期作为基础图标库**？如果未来计划替换为 phosphor 或自研图标包，本提案需要把 lucide 引用层抽象为 `kind: 'iconLib'` + `lib: 'lucide'`。建议保留 lucide，扩展通过 §14 多图标库机制完成。
2. **SVG 清洗依赖 SVGO 还是自研 AST？** 本提案采用 SVGO + AST 双层。SVGO 已是社区标准，作为第一层；AST 白名单作为第二层防护。建议引入 SVGO 依赖。
3. **生成文件位置**：`src/lib/generated/` 还是 `apps/host-next/lib/generated/`？建议前者，与 `src/lib/module-map.ts` 保持一处。
4. **是否同步把 host core 16 项也走声明式**？建议同步迁移，避免双轨。
5. **TS 编译期类型安全（v2）**：`defineModule<TIcons>` 泛型推导是否值得做？该改造会影响 `NavigationContribution` 全部消费方，代价不小。建议 v1 仅做生成期安全，v2 评估泛型方案。
6. **doctor 警告与 CI 阻塞策略**：unused icon 默认 warn 还是 error？建议 warn，避免开发期摩擦；CI 加阈值告警。

完成上述决策后，按 §9 的 Phase 1 / Phase 2 推进即可。

---

## 16. 附录 A：生成产物示例（双模块场景）

假设 `modules/runlynk/module.ts` 声明：

```ts
resources: {
  icons: {
    clipboardList: { kind: 'lucide', name: 'ClipboardList' },
    workerHat: { kind: 'svg', path: './assets/icons/worker-hat.svg' },
  },
},
navigation: [
  { location: 'dashboard.sidebar', path: '/runlynk/jobs', icon: 'clipboardList', /* ... */ },
  { location: 'dashboard.sidebar', path: '/runlynk/workers', icon: 'workerHat', /* ... */ },
]
```

`modules/cms-demo/module.ts` 声明：

```ts
resources: {
  icons: {
    clipboardList: { kind: 'lucide', name: 'ClipboardList' },  // 同名同源
    bookOpen: { kind: 'lucide', name: 'BookOpen' },
  },
},
navigation: [
  { location: 'dashboard.sidebar', path: '/cms/posts', icon: 'clipboardList', /* ... */ },
  { location: 'dashboard.sidebar', path: '/cms/docs', icon: 'bookOpen', /* ... */ },
]
```

合并后生成 `src/lib/generated/module-icons.ts`：

```ts
import type { ComponentType, SVGProps } from 'react';
import {
  Activity, BookOpen, ClipboardList, LayoutDashboard, Package,
  /* ... 仅被引用的 host core */
} from 'lucide-react';
import RunlynkWorkerHat from './module-icons/runlynk-worker-hat';

export type ModuleIconProps = SVGProps<SVGSVGElement>;

export type ModuleIconKey =
  // host core（仅被任意 navigation 引用的）
  | 'activity'
  | 'layoutDashboard'
  | 'package'
  // 命名空间化模块图标
  | 'runlynk:clipboardList'
  | 'runlynk:workerHat'
  | 'cms-demo:clipboardList'
  | 'cms-demo:bookOpen';

export const HOST_CORE_ICON_FALLBACK = 'activity';

export const MODULE_ICONS: Record<ModuleIconKey, ComponentType<ModuleIconProps>> = {
  activity: Activity,
  layoutDashboard: LayoutDashboard,
  package: Package,
  // 注意：lucide ClipboardList 在内部仅 import 一次，但两个模块各持有自己的 key
  'runlynk:clipboardList': ClipboardList,
  'cms-demo:clipboardList': ClipboardList,
  'runlynk:workerHat': RunlynkWorkerHat,
  'cms-demo:bookOpen': BookOpen,
};
```

宿主导航入口解析后（`NavItem.icon`）：

```ts
{ /* runlynk jobs */ icon: 'runlynk:clipboardList' }
{ /* runlynk workers */ icon: 'runlynk:workerHat' }
{ /* cms-demo posts */ icon: 'cms-demo:clipboardList' }
{ /* cms-demo docs */ icon: 'cms-demo:bookOpen' }
```

**关键观察**：

- 两个模块都用 `clipboardList` 本地 key 不冲突，最终各自命名空间化。
- 同 lucide 名 (`ClipboardList`) 在生成代码中仅 import 一次，bundle 不重复打包。
- 自带 SVG (`workerHat`) 单独成文件，`runlynk-worker-hat.tsx`。
- 如果 `cms-demo` 把 `clipboardList` 声明为 `{ kind: 'svg', path: './icons/cms-clip.svg' }`，没有冲突——它会变成 `cms-demo:clipboardList` 引用 cms-demo 自己的 SVG 文件，与 `runlynk:clipboardList` 互不影响。

---

## 17. 设计评审记录

### 17.1 第一轮评审（2026-06-16）

reviewer 反馈了 7 条关键问题，全部采纳并写入本规约：

| # | 反馈 | v1 决定 | 落点 |
| --- | --- | --- | --- |
| 1 | "类型安全"说得过满，SDK 中 `NavigationContribution.icon` 仍是 `string`，IDE 不会真正补全 | 降级为"生成期 + doctor 校验安全"，不承诺 TS 编译期；TS 级别安全列入 v2 目标 | §3.1、§3.2、§4.5、§15.5 |
| 2 | `.runtime/` 在 `.gitignore`，但生成的 `module-icons.ts` 会 import `.runtime/*.tsx`，fresh clone / typecheck / CI 必踩坑 | 生成产物全部入仓库，落到 `src/lib/generated/`；`.runtime/` 仅作运行时缓存，不参与 import | §5.3、§5.6、§9 |
| 3 | 全局 icon key 跨模块易冲突，A/B 模块都叫 `workerHat` 语义不同 | 模块本地 key 写法不变，generator 自动命名空间化为 `<moduleId>:<localKey>`；同 lucide 名内部去重，不暴露命名竞争 | §4.2、§5.2、§16 |
| 4 | bundle 目标与"声明即打包"冲突，unused warn 但 generator 仍写入 `MODULE_ICONS` | 第一版严格按"navigation 实际引用"打包，未引用声明仅 doctor warn 不进 bundle | §3.1、§5.2、§8.1 |
| 5 | SVG 清洗规则缺口：`url(...)` 没限制 scheme、`<use>` 的 `href` 没限制、路径校验仅 `startsWith` 不识别 symlink/Windows、用正则清洗有边角漏洞 | 改用 SVGO + XML AST 双层校验，明确允许 `url(#id)` 形式，`href`/`xlink:href` 仅允许 `#local-id`，路径用 `realpath + path.relative` 判断 | §7.1、§7.2 |
| 6 | dev/build 生命周期未写死，承诺"npm run dev 自动 watch"过于乐观 | `predev`/`prebuild`/`pretypecheck` 显式 hook 串联；CI `modules:check` + `git diff` 守卫；不承诺 watch；Sidebar 加 fallback 防止 stale registry 时空白 | §5.4、§5.6、§9 |
| 7 | `MobileNav` 当前不渲染 item icon，原方案"同样改造"是错的 | 第一版仅同步 type alias，不引入 `MODULE_ICONS` 查表；MobileNav 行为不变；移动端 icon 渲染列入后续扩展 | §3.2、§5.5、§14 |

### 17.2 决策落地范围

修订后本规约从"讨论稿"升级为"实施规约（v1）"，可以直接进入 Phase 1 实施。后续若有需要进一步调整的地方，新增 §17.X 评审记录即可，不要直接重写主体章节，便于追溯设计演化。

### 17.3 Phase 1 实施记录（2026-06-17）

本轮宿主侧已完成：

| 项 | 落地文件 |
| --- | --- |
| host core 图标单一来源 | `scripts/lib/host-core-icons.mjs` |
| SDK 类型与基础校验 | `src/module-sdk/types.ts`、`src/module-sdk/validator.ts` |
| 生成器聚合与漂移检查 | `scripts/generate-module-map.mjs` |
| 生成 registry | `src/lib/generated/module-icons.ts` |
| Sidebar 消费 registry | `apps/host-next/components/layout/types.ts`、`apps/host-next/components/layout/Sidebar.tsx` |
| dashboard/admin 模块导航 icon 解析 | `apps/host-next/lib/module-navigation-icons.ts`、dashboard route、`admin-console-nav.ts` |
| RunLynk 短期修复 | `modules/runlynk/app-model/dashboard-navigation.ts` 使用 host core `activity` |
| 验证 | `tests/module-contract.test.ts`、`tests/module-map-cli.test.ts`、`tests/host-page-runtime.test.ts` |

已通过：

- `npm run modules:scan`
- `npm run modules:check`
- `npm run test:module-contract`
- `npm run test:module-map`
- `npm run test:host-page-runtime`

`npm run typecheck` 已确认 `pretypecheck` 会自动运行 `modules:scan`，但当前被 `modules/runlynk/i18n.ts` 多个既有重复 key 阻塞；图标链路本身未产生新的 typecheck 错误。
