# 模块页面标准 React/TSX 迁移说明

## 目标

PloyKit 的模块页面和 Surface 统一使用标准 React 组件：

- UI 文件使用 `.tsx`。
- 默认导出命名 React 组件。
- 组件可以是函数组件，或标准 React 的 `memo`、`forwardRef`、`lazy` 组件类型。
- 组件返回 JSX 或其他合法 `ReactNode`。
- 页面通过 props 接收 `loaderData`、路由参数、语言和元数据。
- 客户端交互放在带有 `'use client'` 的子组件中。

模块运行时不再支持页面返回普通对象、`view` 描述对象或由宿主解释的结构化页面协议。

## 破坏性变更

以下行为将被移除：

- 页面或 Surface 返回 `{ title, message, view, ... }` 对象。
- 宿主通过 `ModuleValue` 将普通对象转换成页面。
- 页面返回普通对象后由宿主自动补充 `loaderData`、`metadata` 或路由信息。
- 使用 `.ts` 文件承载页面 UI。

迁移后，普通对象只能作为 loader、metadata、API、action、job 等数据或结果返回值，不能作为 UI 输出。

## 新组件协议

页面和 Surface 应采用以下形状：

```tsx
import type { ReactNode } from 'react';

interface PageProps {
  loaderData?: unknown;
  params?: Record<string, string>;
  language?: string;
  metadata?: unknown;
}

export default function ExamplePage(props: PageProps): ReactNode {
  return (
    <main>
      <h1>Example</h1>
      <pre>{JSON.stringify(props.loaderData, null, 2)}</pre>
    </main>
  );
}
```

需要状态或浏览器 API 时，页面保持服务端组件，将交互部分拆到客户端子组件：

```tsx
// pages/ExamplePage.tsx
import ExampleWorkbench from '../components/ExampleWorkbench';

export default function ExamplePage() {
  return <ExampleWorkbench />;
}
```

```tsx
// components/ExampleWorkbench.tsx
'use client';

import { useState } from 'react';

export default function ExampleWorkbench() {
  const [value, setValue] = useState('');
  return <input value={value} onChange={(event) => setValue(event.target.value)} />;
}
```

## 保留的非 UI 函数

以下内容不应改成 React 组件：

- `loaders/*`
- `metadata` loaders
- `api/*`
- `actions/*`
- `jobs/*`
- `events/*`
- `webhooks/*`
- `lifecycle/*`

它们属于运行时处理函数，继续返回数据、`Response` 或任务结果。只有 `pages/*`、`surfaces/*` 和 UI `components/*` 参与 React 渲染。

## 宿主边界

宿主仍然负责路由、Shell、导航、认证、工作区切换和全局布局。模块组件只能返回页面内容，不得复制宿主 Shell。

模块组件不应直接导入 `apps/host-next/*` 内部组件；需要交互时应使用模块自己的 React 组件和公开模块能力。

## 验证要求

迁移后执行：

```bash
npm run modules:scan
npm run typecheck
npm run module:doctor -- <id>
npm run module:test -- <id> --summary
npm run test:ui-runtime
```

检查重点：

- 页面和 Surface 文件均为 `.tsx`。
- 页面和 Surface 不再出现 `return { ... }` UI 输出。
- 仓库不再引用 `ModuleValue` 或结构化页面兼容渲染器。
- React element 由宿主直接渲染。
- Surface 在客户端渲染阶段的错误由宿主错误边界隔离，并显示模块级降级状态；服务端渲染错误仍由 Next 路由错误边界处理。
- 旧模块对象输出会明确失败，而不是被宿主静默转换。
