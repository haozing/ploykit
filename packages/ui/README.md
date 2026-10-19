# @ploykit/ui

React 前端壳：默认页面 + 组件。逻辑与状态在 [hooks](../hooks) 与 [client](../client) 里，本包是它们的渲染层。

| 包 | 内容 |
|---|---|
| `@ploykit/ui` | 组件壳、默认页面、全局组合件（本包） |
| `@ploykit/hooks` | `PloykitProvider` + headless hooks（认证/工作区/计费） |
| `@ploykit/client` | typed API client + CSRF（hooks 的底层） |

依赖方向：ui → hooks → client。Peer deps：`react` 19 / `react-dom` 19 / `@tanstack/react-query` 5 / `react-router` 7 / `tailwindcss` 4。产物为 ESM（相对导入无扩展名，需经 vite/esbuild 等打包器解析）。

## 快速使用

```tsx
import { AppProviders } from '@ploykit/ui'
import { useAuth, useLogin, useApi } from '@ploykit/hooks'
import { LoginPage } from '@ploykit/ui'

// 应用根部：一层包完（PloykitProvider > ConfirmProvider > Toaster 三层组合）
<AppProviders>
  <App />
</AppProviders>

// 已有自己的 QueryClient 时透传（不传则内部创建默认 QueryClient）
<AppProviders queryClient={queryClient}>...</AppProviders>

// 数据 hooks 一律来自 @ploykit/hooks
const { user, loading } = useAuth()
const api = useApi()

// 默认页面来自 @ploykit/ui
<Route path="/login" element={<LoginPage />} />
```

等价的手动三层挂法（需要插入自定义 Provider 层时用）：

```tsx
import { PloykitProvider } from '@ploykit/hooks'
import { ConfirmProvider, Toaster } from '@ploykit/ui'

<PloykitProvider queryClient={queryClient}>
  <ConfirmProvider>
    <App />
    <Toaster />
  </ConfirmProvider>
</PloykitProvider>
```

要复用全局 QueryClient 实例时，自行 `new QueryClient()` 后经 `queryClient` 传给 `PloykitProvider`。默认 QueryClient 的行为：`staleTime` 30s、4xx 不重试、窗口聚焦不重取。

## 路由适配层 `@ploykit/ui/router`

`@ploykit/ui` 内部的路由原语统一从适配层导入（不直接依赖 `@tanstack/react-router`）。产品侧同样可以走公开子路径复用，免去每个项目重新踩一遍 TanStack 的语义差异：

```tsx
import { Link, useNavigate, useParams, useLocation, useSearchParamsCompat } from '@ploykit/ui/router'
```

| react-router | 原生 TanStack | `@ploykit/ui/router` |
|---|---|---|
| `useParams()` | `useParams({ strict: false })`（无参调用 TS2554） | `useParams()` → `Record<string, string \| undefined>` |
| `<Navigate state={x} />` | `state` 类型为 `ParsedHistoryState`（常需 `as never` 断言） | 无 `Navigate` 组件，改用 `useNavigate({ to, state })`；`state: unknown`，直接传普通对象 |
| `useLocation().search` 是 `'?a=1'` 字符串 | `location.search` 是对象（直接拼接得到 `[object Object]`） | `useLocation()` 归一化：`search` 为带 `?` 的字符串，`hash` 不带 `#` |
| `navigate('/x')` 同步返回 | 返回 `Promise` | 适配层包裹后仍返回 `Promise`（不需要结果时写 `void navigate('/x')`） |
| `useSearchParams()` | 无此 API（搜索状态模型不同） | `useSearchParamsCompat()`：完整 `[URLSearchParams, setSearchParams]` 元组，含函数式更新与 `{ replace }` |

### 序列化契约

宿主应用自己调用 `createRouter` 时，**必须**同时传入 `rawStringifySearch` / `rawParseSearch`（`@ploykit/ui/router` 与 `@ploykit/runtime/router-tanstack` 都导出）：

```tsx
import { createRouter } from '@tanstack/react-router'
import { rawStringifySearch, rawParseSearch } from '@ploykit/ui/router'

const router = createRouter({
  routeTree,
  stringifySearch: rawStringifySearch,
  parseSearch: rawParseSearch,
})
```

TanStack 默认会把纯数字字符串再 JSON 编码一次（`?page=2` → `?page=%222%22`）；只有接入这组纯字符串序列化器，`useSearchParamsCompat` 才能读写 react-router 形状的 URL。`RouterTestHarness` 已内置这一对。

### 测试挂载

`RouterTestHarness` 用内存 history 挂载真实路由上下文（任意路径都渲染 `children`）：

```tsx
import { RouterTestHarness } from '@ploykit/ui/router'

render(
  <RouterTestHarness initialEntries={['/app?page=2']}>
    <ComponentUnderTest />
  </RouterTestHarness>,
)
await act(async () => {}) // 首次渲染是异步的：先 act / waitFor 冲刷，再断言
await waitFor(() => expect(screen.getByText('...')).toBeInTheDocument())
```

## 全局 Provider 清单

| Provider | 导入自 | 职责 |
|---|---|---|
| `PloykitProvider` | `@ploykit/hooks` | 认证会话（`/auth/me`）+ 当前工作区上下文 + react-query `QueryClientProvider` |
| `ConfirmProvider` | `@ploykit/ui` | 提供 `useConfirm()` 的 Promise 式弹窗确认 |
| `Toaster` | `@ploykit/ui` | sonner 通知渲染（默认右上角、richColors；`toast.error` 时长 8s） |

漏挂症状：

- 缺 `PloykitProvider`：`useAuth` / `useWorkspace` / `useApi` 等直接 throw `must be used within PloykitProvider`。
- 缺 `ConfirmProvider`：`useConfirm()` 直接 throw `useConfirm must be used within ConfirmProvider`（fail-fast；旧版曾静默返回 `false`，导致"点了没反应且无报错"，已废弃）。
- 缺 `Toaster`：不报错，但所有 `toast()` 调用无任何可见提示。

三个 Provider 都不相互依赖，`AppProviders` 的嵌套顺序只是惯例；推荐统一挂最外层，保证登录前页面也能用 `useConfirm` / `toast`。

## Headless hooks（`@ploykit/hooks`）

| 导出 | 契约 |
|---|---|
| `useAuth()` | `{ user, workspaces, loading, error, refresh, logout }` |
| `useLogin()` | `{ sendCode(email), submit(email, code), loading, error }`；`submit` 返回 `{ ok, error? }` |
| `useWorkspace()` | `{ current, switchTo(id), clear }`；当前工作区 ID 同步进 URL `?ws=` 与 localStorage |
| `useWorkspaceSwitch()` | `{ current, list, switchTo, create(name, slug), creating, error }`；`create` 失败返回 `null` |
| `useBilling()` | `{ subscription, plans, checkout(planCode, interval, channel), checkoutError, loading, refresh }` |
| `useUsagePreview()` | `{ preview, loading }` |
| `PlanGate` | `<PlanGate plan="pro" denied={...}>{children}</PlanGate>`；按 `plans.sort_no` 做档位判定，`busy` prop 自定义加载态 |
| `useApi()` | `{ get, post, put, patch, delete }`；自动携带凭据与当前工作区 ID |
| `ApiError` | 带 `status` 的 API 错误类（可 `instanceof` 判 4xx） |
| `queryKeys` | react-query query key 常量表（`queryKeys.me`、`queryKeys.billingSubscription(wsId)` 等） |

其余 hooks（`useSessions` / `useTokens` / `useMembers` / `useAudit` / `useSEO` / `useZodForm` / `useWsStatus` 等）见 `packages/hooks/src/index.ts`。

## 组件

### DataTable

```tsx
import { DataTable, type Column } from '@ploykit/ui'

interface User { id: string; name: string; code: string }

const columns: Column<User>[] = [
  { key: 'name', header: '名称', render: (u) => <b>{u.name}</b> },
  {
    key: 'actions',
    header: <span className="sr-only">操作</span>, // 别传 ''——空串 th 会塌陷
    className: 'whitespace-nowrap',                // 操作列防换行惯例
    render: (u) => <Button size="xs" variant="outline">编辑</Button>,
  },
]

<DataTable
  columns={columns}
  rows={rows}
  rowKey={(row) => row.id}          // 同业务键多行（如同 code 多版本）时用下标拼唯一 key：(row, i) => `${row.code}:${i}`
  onRowClick={(row) => openDetail(row)} // 整行点击；传入后行 hover 显示 pointer
  renderExpanded={(row) => row.open ? <Detail row={row} /> : null} // 返回非 null 即在该行后插入 colSpan 全宽展开行；展开状态由行数据自行表达
  loading={isLoading}
  pagination={{ page, pageSize, total, onPageChange: setPage }}
/>
```

- `Column<T>` = `{ key, header: ReactNode, render?(row), className? }`；不传 `render` 时取 `row[key]` 字符串化。
- `rowKey: (row, index) => string`（第二参可省）。
- 分页条内置"上一页/下一页"；翻页后数据为空时显示"本页没有数据，可返回上一页"而非空态。
- `loading` 时表体渲染骨架行；`empty` 可自定义空态（默认 `<PageEmpty />`）。

### Dialog / Sheet 尺寸档位

`DialogContent` 新增 `size` 档位（默认 `sm`，即原有 384px 宽度，现有代码不受影响）：

| size | max-width |
|---|---|
| `"sm"`（默认） | `sm:max-w-sm` |
| `"md"` | `sm:max-w-lg` |
| `"lg"` | `sm:max-w-2xl` |
| `"xl"` | `sm:max-w-4xl` |

`SheetContent` 新增 `size?: "sm" | "md" | "lg"`（默认 `sm` = 原有 `sm:max-w-sm`）；`side` 仍为 `"top" | "right" | "bottom" | "left"`（默认右侧），右侧/底部预设自带 `overflow-y-auto`。两者另有 `showCloseButton?: boolean`（默认 `true`）。Sheet 全套组合件从 barrel 导出：`Sheet`（受控 Root）、`SheetTrigger`、`SheetClose`、`SheetHeader`、`SheetFooter`、`SheetTitle`、`SheetDescription`。

```tsx
<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent size="lg">...</DialogContent>
</Dialog>
```

### Select 使用注意

```tsx
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@ploykit/ui'

<Select value={v} onValueChange={(value) => setV(value)}>  {/* value: string，不再是 string | null */}
```

- `onValueChange` 契约为 `(value: string) => void`：清空/取消选择时收到空串 `''`，不会出现 `string | null`。
- `SelectTrigger` 自有 `size?: "sm" | "default"`（高度档位：`sm` = h-7，`default` = h-8）。注意与 Button 的 `size` 枚举（`default` / `xs` / `sm` / `lg` / `icon`…）不同名不同义。
- 其余件（`SelectContent` / `SelectItem` / `SelectGroup` / `SelectLabel` / `SelectSeparator` 等）为 `@base-ui/react` Select 直出。

### SecretModal（仅显示一次的密钥弹窗）

```tsx
<SecretModal
  open={open}
  onOpenChange={setOpen}
  secretName="My Token"
  secretValue={token}
  title="新密钥已生成"  // 可选；不传时默认 `${secretName} 创建成功`
/>
```

安全契约：用户勾选"我已将密钥保存到安全的地方"之前，`onOpenChange` **不会收到 `false`**——ESC、遮罩点击、关闭按钮均被拦截，调用方无需自行兜底。内置复制按钮（2s 成功/失败反馈），每次打开重置勾选与复制状态。`title` prop 用于"重置 Key"等非创建成功场景覆盖默认标题。

### ImpactConfirmation（破坏性操作确认）

```tsx
<ImpactConfirmation
  open={open}
  onOpenChange={setOpen}
  onConfirm={doDelete}
  title="删除调度"
  impacts={[
    '将删除 3 条调度',
    <>关联的 <b>12</b> 条执行历史将被保留</>,  // impacts: ReactNode[]，可含富文本
  ]}
  confirmText="确认删除"
  danger
/>
```

- 勾选"我理解并接受以上影响"前确认按钮禁用；确认后先回调 `onConfirm` 再关闭。
- 影响列表区自带 `max-h-48 overflow-y-auto`，项多时内部滚动，弹窗不被撑出视口。

### Textarea

与 `Input` 同 token 的多行文本域（`rounded-lg border-input` 等一致），从 barrel 直接导入。

### 其他常用导出

- **布局**：`AppShell` / `SettingsShell` / `AuthShell` / `AdminShell` + 全套 Sidebar。
- **页面**：`LoginPage`（props：`resetPath` / `registerPath` / `oauthProviders` / `enableFedLogin` / `onSuccess` / `title` / `description`；`resetPath` / `registerPath` **传空串即隐藏对应链接**——产品未挂载 /forgot-password、/register 路由时防止死链 404）、`RegisterPage`、`ForgotPasswordPage`、`ResetPasswordPage`、`VerifyEmailPage`、`InviteAcceptPage`，以及 workspace/account/admin 各默认页面。
- **反馈与状态**：`StatusBadge`、`PageHeader` / `PageLoading` / `PageEmpty` / `PageError`、`ErrorBoundary`、`ReauthDialog`（step-up sudo 模式弹窗）。
- **工具**：`cn`、`formatDate` / `formatDateTime` / `shortID`、`statusTone` / `statusLabel`、`apiErrorMessage`、`FormField`、`CronInput`。
- 基础 UI 件（Button / Input / Card / Tabs / AlertDialog / DropdownMenu / Popover / Switch / Checkbox / Progress / Avatar / Breadcrumb / Empty / Field / Label / Tooltip / Skeleton / Separator…）全部从 barrel 导出；也可走子路径 `import { Button } from '@ploykit/ui/components/ui/button'`（推荐统一走 barrel）。

## Tailwind v4 集成

本包组件的 class 全部走语义令牌（`bg-card`、`text-muted-foreground`…），需要 Tailwind 扫描到本包源码才会生成对应规则。Tailwind v4 的自动内容探测会跳过 node_modules，因此按消费方式二选一：

- **monorepo 消费方**（workspace 软链）：可保留自己写的 `@source "<相对路径>/packages/ui/src";`，也可改用下面的 import（推荐——相对路径在产品拆出独立仓库后会静默失效，曾有产品因此上线了无样式的登录页数周未察觉）。
- **独立（npm）消费方**：在 CSS 入口（如 `src/index.css`）加一行：

```css
@import "@ploykit/ui/tailwind.css";
```

`@ploykit/ui/tailwind.css` 内部只有一条 `@source "./src";`。`@source` 相对样式表文件自身解析，因此无论包位于 monorepo workspace 还是 node_modules，都指向包内的 `src/`，无需消费方关心安装路径。

令牌定义（`--card` / `--popover` 等 CSS 变量与 `@theme` 映射）仍由消费方按 shadcn 惯例在自己的 CSS 里提供（参见 `example/web/src/index.css`）。

## 自定义三个层级

1. **换皮**：CSS/Tailwind 覆盖样式（组件全部走 design token：`bg-popover`、`text-muted-foreground` 等）。
2. **换壳**：拷贝 `LoginPage.tsx` 等默认页面到产品 `src/pages/`，改 JSX，hook 调用不变（hooks 从 `@ploykit/hooks` 导入）。
3. **纯逻辑**：只 `import { useLogin } from '@ploykit/hooks'`，完全自己画 UI。
