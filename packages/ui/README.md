# @ploykit/ui

React 前端壳：登录/工作区/计费的 Headless Hook + 默认页面。

## 快速使用

```tsx
import { PloykitProvider, useAuth, useLogin, LoginPage } from '@ploykit/ui'

// App 根部
<PloykitProvider>
  <App />
</PloykitProvider>

// 任意组件中
const { user, workspaces, loading } = useAuth()
const { sendCode, submit } = useLogin()

// 或直接用默认登录页
<LoginPage />
```

## 核心 API

| 导出 | 说明 |
|---|---|
| `PloykitProvider` | 根 Provider（App 根部包裹一次） |
| `useAuth()` | `{ user, workspaces, loading, refresh, logout }` |
| `useLogin()` | `{ sendCode, submit, loading, error }` |
| `useWorkspace()` | `{ current, switchTo, clear }` |
| `useWorkspaceSwitch()` | `{ current, list, switchTo, create, creating }` |
| `useBilling()` | `{ subscription, plans, checkout, loading }` |
| `PlanGate` | 付费门 `<PlanGate plan="pro" denied={<Upgrade/>}>` |
| `useApi()` | `{ get, post, put, delete }` 带认证 + 工作区上下文 |
| `LoginPage` | 默认登录页（可拷贝自定义，Hook 不变） |

## 自定义三个层级

1. **换皮**：CSS/Tailwind 覆盖样式
2. **换壳**：拷贝 `LoginPage.tsx` 到产品 `src/pages/`，改 JSX，Hook 调用不变
3. **纯逻辑**：只 `import { useLogin } from '@ploykit/ui'`，完全自己画 UI
