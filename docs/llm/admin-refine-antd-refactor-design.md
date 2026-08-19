# PloyKit Admin Refine + Ant Design 重构设计

日期：2026-06-28

## 结论

建议将 PloyKit 的 host 管理后台前端重构为 **Refine + Ant Design**，但只作用于 `/admin` 管理域。公共前台、SaaS 用户控制台、个人中心、模块业务页继续保持当前 Tailwind / shadcn 风格。

Refine + AntD 对 PloyKit 后台是有价值的，尤其是用户、模块、运行记录、Webhook、服务连接、文件、计费、审计等高密度 CRUD 和运维页面。它能明显减少列表、筛选、分页、详情、表单、抽屉、批量操作的重复代码。

对插件或模块开发者也能提速，但前提是提供 **PloyKit 原生的 Admin Data Resource 合同**，由 host 自动映射成 Refine resources。插件开发者不应默认直接 import `@refinedev/*` 或 `antd`；否则会绕开 PloyKit 的权限、审计、Data v2、ctx 能力和 UI 边界。

## 外部依据

- Refine v5 定位为面向 CRUD-heavy web apps、internal tools、admin panels、dashboards、B2B apps 的 React meta-framework，并通过 data/auth/access/routing/i18n providers 组织后台能力。
  - https://refine.dev/core/docs/
- Refine Ant Design 集成提供 `useTable`、`useForm`、`useDrawerForm`、`useModalForm`、`useSelect`、notification provider、AntD theme 等能力。
  - https://refine.dev/core/docs/ui-integrations/ant-design/introduction/
- Refine Data Provider 以 `getList`、`getOne`、`create`、`update`、`deleteOne` 等统一接口承接排序、筛选、分页和 CRUD。
  - https://refine.dev/core/docs/data/data-provider/
- Ant Design 在 Next.js App Router 中建议使用 `@ant-design/nextjs-registry` 注入首屏样式，避免样式闪烁。
  - https://ant.design/docs/react/use-with-next/

## 当前代码事实

### 1. 后台目前是 host-owned server-first 页面

现有后台入口分布在：

- `apps/host-next/app/[lang]/admin/*`
- `apps/host-next/components/admin/*`
- `apps/host-next/lib/admin-*.ts`

典型页面如 `apps/host-next/app/[lang]/admin/modules/page.tsx`：

- server component 中读取语言和 admin session。
- 调用 `getAdminOperationsView()` 等 server-side view model。
- 创建 `createAdminAction(...)` server action。
- 将 view model 和 action 传入 `AdminModulesOperationsPage`。

这说明当前后台不是纯前端 SPA，而是 Next App Router 的 server component + server action 结构。

### 2. 后台已经有明确的 route registry 和权限事实源

`apps/host-next/lib/admin-route-registry.ts` 定义：

- admin page
- admin API
- admin action
- capability
- risk
- audit event
- rate limit

这些是后台安全边界的事实源，重构时必须保留或升级为新的 registry，而不是让 Refine route/resource 成为权限事实源。

### 3. 后台导航已经支持 host + module 贡献

`apps/host-next/lib/admin-console-nav.ts` 里：

- `ADMIN_CONSOLE_ROUTES` 定义 host admin 菜单。
- `resolveAdminNavItems(...)` 会合并 `host.resolveNavigation('admin.sidebar', { session })`。
- module 贡献的 admin nav 会被标记为 `source: 'module'`。

这说明模块后台入口已经存在概念基础。

### 4. admin shell 当前复用 `WorkspaceShell`

`apps/host-next/components/ProductShell.tsx` 中：

- `WorkspaceShell` 根据 `nav === adminNav` 进入 `AdminPageShell`。
- `AdminPageShell` 使用 `AppFrame` + `PageShell`。

Refine + AntD 重构时，`/admin` 应该脱离 `WorkspaceShell`，拥有独立的 `AdminRefineShell`，避免 admin 和 SaaS dashboard 继续共享布局实现。

### 5. 模块 admin page 已经存在动态路由

`apps/host-next/app/[lang]/admin/[...modulePath]/page.tsx`：

- 调用 `host.resolvePageRoute({ kind: 'admin', ... })`。
- 用 host admin shell 包裹模块 admin page。
- 使用 `strictReactOutput: true` 渲染模块页面。

这条能力应该保留，但未来模块 admin page 应优先走 declarative Admin Data Resource，而不是每个模块手写完整后台页面。

### 6. SDK 已支持 admin area 与 admin nav

`src/module-sdk/types.ts` 当前支持：

- `ModulePageArea = 'site' | 'dashboard' | 'admin'`
- `ModulePageFrame` 包含 `'admin'`
- `ModuleNavigationItem.location` 包含 `'admin.sidebar'`
- surfaces placement area 包含 `'admin' | 'dev'`

这说明模块开发者可以声明后台入口。Refine 重构应利用这条 contract，而不是另起一套插件私有后台体系。

### 7. 插件目录当前不存在，但插件开发规则已成型

当前仓库没有 `plugins/` 目录，但已有插件开发 skill 规则：插件也应从 `plugin.ts` 出发，使用 `ctx.*`，不能 import host internals、直接读 env、直接访问 DB 或 raw fetch。

因此，本设计同时定义未来 plugin admin 的接入形态，但不假设当前仓库已有插件运行时。

## 目标

1. 用 Refine + AntD 替换 `/admin` 前端体验。
2. 将后台列表、筛选、分页、排序、详情、表单、批量操作统一到 Refine resource 模型。
3. 保留 PloyKit host 的权限、审计、scope、runtime store、module contract、ctx capability 作为事实源。
4. 为模块/插件开发者提供 declarative Admin Data Resource 接口，让他们少写后台页面。
5. 不考虑旧 UI 兼容，不保留旧后台组件兼容层。

## 非目标

1. 不把 public site、dashboard、account center、模块业务页替换成 AntD。
2. 不让模块或插件直接拥有 host shell、auth、workspace switcher、global nav。
3. 不让 Refine data provider 直接访问 runtime store 或数据库。
4. 不把 Refine resources 当作权限事实源。
5. 不为了接入 Refine 保留旧 AdminPrimitives API。

## 新后台分层

```text
/admin
  AdminRefineShell
    AntD ConfigProvider
    Refine Provider
    accessControlProvider -> HostCapability / module permission
    authProvider -> host session
    dataProvider -> /api/admin/data-resources/*
    notificationProvider -> AntD App notification
    i18nProvider -> host i18n / admin i18n

/api/admin/data-resources/*
  Admin Data Resource API
    requireAdminDataResourceRequestContext
    AdminDataResourceRegistry
    host security catalog / admin API registry
    capability check
    risk check
    runtime store / host service
    audit
    typed response envelope
```

当前代码中的 `/api/admin/resources` 已经用于 `provides.adminResources` 暴露的 Module Admin Operation Resource，不能再作为 Refine CRUD data provider 路径。本文后续凡是 Refine CRUD 资源，都统一称为 Admin Data Resource。

## 核心设计：Admin Data Resource Registry

新增 `AdminDataResourceRegistry`，替代现在分散的 page component + local filtering + server action 组合。

`AdminDataResourceRegistry` 不能只是 Refine 前端资源配置。它必须进入 host security catalog、admin API registry、审计和 doctor 体系。当前 `requireAdminRequestContext(request, path)` 会按 admin 页面路径查 `findAdminPageRegistryEntry(path)`，因此不能直接拿来守护 `/api/admin/data-resources/*`。重构时应新增 `requireAdminDataResourceRequestContext(request, resource, operation)`，或等价的 `executeAdminDataResourceOperation(...)`，由它完成 API route、安全目录、resource 定义、capability、risk 和 audit 的统一校验。

建议文件：

```text
apps/host-next/lib/admin-data-resource-registry.ts
apps/host-next/lib/admin-data-resource-handlers.ts
apps/host-next/lib/admin-data-resource-context.ts
apps/host-next/lib/admin-data-resource-execution.ts
apps/host-next/lib/admin-data-resource-schema.ts
apps/host-next/app/api/admin/data-resources/[resource]/route.ts
apps/host-next/app/api/admin/data-resources/[resource]/[id]/route.ts
apps/host-next/components/admin-refine/AdminRefineProvider.tsx
apps/host-next/components/admin-refine/adminDataProvider.ts
apps/host-next/components/admin-refine/adminAuthProvider.ts
apps/host-next/components/admin-refine/adminAccessControlProvider.ts
apps/host-next/components/admin-refine/resources/*
```

### Resource 定义

```ts
interface AdminDataResourceDefinition<TRecord = unknown> {
  name: string;
  label: string;
  group: string;
  icon?: string;
  path: string;
  scope: 'product' | 'workspace' | 'user' | 'system';
  capability: HostCapability; // default read capability, not the mutation authority
  actions: {
    list?: AdminDataResourceOperation<TRecord, 'read'>;
    show?: AdminDataResourceOperation<TRecord, 'read'>;
    create?: AdminDataResourceOperation<TRecord, 'write'>;
    update?: AdminDataResourceOperation<TRecord, 'write'>;
    delete?: AdminDataResourceOperation<TRecord, 'dangerous'>;
    custom?: Record<string, AdminDataResourceOperation>;
  };
  auditPrefix: string;
  fields: readonly AdminDataResourceField[];
  table?: AdminDataTableDefinition<TRecord>;
}

interface AdminDataResourceOperation<TRecord = unknown, TRisk extends AdminRegistryRisk = AdminRegistryRisk> {
  capability: HostCapability;
  risk: TRisk;
  auditEvent: string;
  rateLimit?: 'none' | 'machine' | 'interactive' | 'dangerous';
  confirmation?: TRisk extends 'dangerous' ? AdminDangerConfirmation : AdminDangerConfirmation | false;
  handler: AdminDataResourceHandler<TRecord>;
}
```

Operation 级 `capability` / `risk` 是必须项。现有后台里同一个资源经常读写分权，例如 files 列表读取是 `files.read`，而 quarantine/delete 等 mutation 走 `admin.operations.write` 且是 `dangerous`。如果只在 resource 顶层声明能力，会把权限放大或把合法操作挡掉。

### API 响应 envelope

```ts
interface AdminListResponse<T> {
  ok: true;
  data: readonly T[];
  total: number;
  page: number;
  pageSize: number;
  filters: Record<string, unknown>;
  sorters: readonly { field: string; order: 'asc' | 'desc' }[];
  meta: {
    capability: HostCapability;
    correlationId: string;
  };
}

interface AdminMutationResponse<T> {
  ok: true;
  data: T;
  meta: {
    auditId?: string;
    correlationId: string;
    revalidated?: readonly string[];
  };
}
```

Refine data provider 只理解这个统一 envelope，不理解 runtime store。API 错误仍应沿用现有 PloyKit platform error 形态：`{ ok: false, code, message, details? }`。这样 Refine UI 能显示错误，测试和调用方也不会丢失平台错误码。

## Refine Provider 映射

### dataProvider

`adminDataProvider` 映射：

- `getList` -> `GET /api/admin/data-resources/:resource`
- `getOne` -> `GET /api/admin/data-resources/:resource/:id`
- `create` -> `POST /api/admin/data-resources/:resource`
- `update` -> `PATCH /api/admin/data-resources/:resource/:id`
- `deleteOne` -> `DELETE /api/admin/data-resources/:resource/:id`
- `custom` -> `POST /api/admin/data-resources/:resource/actions/:action`

Refine 的 filters/sorters/pagination 全部转成 query string，服务端负责过滤和分页。现有大量页面内的 `matchesTextSearch`、`matchesExactFilter`、`slice(...)` 应迁到 resource handler。

所有这些 endpoint 必须同时满足两层注册：

1. host route security catalog 能识别 `/api/admin/data-resources/*`，并按 admin API route 处理 CSRF、origin、rate limit 和 anonymous policy。
2. `AdminDataResourceRegistry` 能识别具体 resource + operation，并执行 operation 级 capability/risk/confirmation/audit。

### authProvider

`adminAuthProvider` 不负责登录流程，只负责后台判断：

- `check` 调 `/api/auth/session` 或新的 `/api/admin/session`。
- admin session 缺失时跳转 localized login。
- `getIdentity` 返回当前 admin user。
- `getPermissions` 返回 host capabilities。

登录、登出、注册、密码重置仍归 host auth 页面。

### accessControlProvider

Refine `can({ resource, action })` 映射到：

- resource 所需 `HostCapability`
- operation risk
- module/plugin resource 的 declared permission

前端访问控制只用于隐藏按钮和菜单。最终拒绝必须在 `/api/admin/data-resources/*` 服务端完成。

### notificationProvider

使用 `@refinedev/antd` 的 notification provider，并统一显示：

- mutation 成功
- danger action 需要确认
- platform error code
- doctor diagnostic summary

### i18nProvider

短期可以复用现有 host message 和 `admin-inline-i18n`。重构完成后建议把 admin 文案收敛到 resource metadata + locale dictionary，避免继续生成大量 hash key 文案。

## Ant Design 接入边界

### 依赖

新增依赖：

```json
{
  "@refinedev/core": "...",
  "@refinedev/antd": "...",
  "@refinedev/nextjs-router": "...",
  "antd": "...",
  "@ant-design/nextjs-registry": "..."
}
```

### Next App Router

在 root 或 admin layout 中使用 AntD registry。因为 AntD 官方建议 App Router 中使用 `@ant-design/nextjs-registry` 注入首屏样式，避免闪烁。

建议仅在 admin subtree 引入 AntD provider：

```tsx
// apps/host-next/app/[lang]/admin/layout.tsx
export default function AdminLayout({ children }) {
  return <AdminAntdRegistry>{children}</AdminAntdRegistry>;
}
```

如果 registry 只能稳定放在 root layout，也要保证 AntD theme token 不污染 public/dashboard 的 Tailwind 视觉。

### Client boundary

Refine + AntD 页面大多需要 client component。建议保留 server page 做：

- 语言解析
- admin session precheck
- metadata
- 向 client provider 注入 initial session / locale / resource manifest

具体页面由 client component 调 Refine hooks。

## 后台信息架构

### Host resources

第一批资源：

| Refine resource | 当前来源 | 能力 | 备注 |
| --- | --- | --- | --- |
| `users` | identity admin pages / `/api/admin/users` | `admin.users.manage` | list/show/update status/role/session reset |
| `roles` | `/api/admin/roles`、`/api/admin/permissions` | `admin.rbac.read` | read-heavy |
| `modules` | module operations view | `admin.operations.read/write` | list/show/status/health/contract evidence |
| `runs` | run admin pages | `admin.operations.read/write` | list/show/requeue/cancel |
| `webhooks` | webhook admin pages | `admin.webhooks.read/write` | deliveries/outbox/dead letters |
| `serviceConnections` | service connection pages | `admin.serviceConnections.read/write` | create/test/rotate/policy |
| `billingPlans` | billing admin pages | `billing.read/write` | catalog authoring |
| `orders` | revenue/billing pages | `billing.read` | read-heavy + reconciliation action |
| `entitlements` | entitlement pages | `billing.read/write` | grant/revoke/override |
| `files` | file admin pages | `files.read` + write action capability | quarantine/restore/archive/delete |
| `usage` | usage pages | `admin.operations.read` | metrics and records |
| `audit` | audit pages | `admin.operations.read/write` | timeline/search/retention |
| `settings` | settings pages | `admin.settings.read/write` | product/runtime config |
| `providers` | provider status | `admin.operations.read/write` | readiness/config doctor |

### Page groups

```text
Overview
  Operations Overview
  Analytics
  Advanced Search

Users & Access
  Users
  Roles
  Entitlements

Billing
  Revenue
  Billing Catalog
  Usage

Resources
  Files

Integrations
  Service Connections
  Webhooks

Runtime
  Modules
  Module Dev Console
  Runs

Security
  Audit

System
  Settings
```

## 插件/模块开发者如何用后台

### 判断

Refine + AntD 能给插件开发者提速，但不是通过“插件作者自己写 AntD 页面”来提速，而是通过 PloyKit 提供的 Admin Data Resource contract 来提速。

插件开发者应该声明：

- Admin Data Resource
- fields
- list filters
- table columns
- detail sections
- actions
- required permissions
- risk level

host 负责：

- 生成 Refine resource
- 生成 AntD list/show/form/action UI
- 接入 admin nav
- 校验 capability
- 调用 plugin/module handler
- 审计
- 错误展示

### 模块 contract 扩展建议

当前模块合同已经支持 `pages` 的 `area: 'admin'`、`navigation: 'admin.sidebar'` 和 admin surfaces，但 **尚不支持** 顶层 `admin: { resources }` 字段。下面的 `adminResource(...)` 是未来 RFC 示例，不是当前可直接写入 `module.ts` 的合同。真正实施前必须同步修改 `src/module-sdk/types.ts`、validator、doctor、generated docs、templates、tests 和模块地图生成器。

当前可用做法：

```ts
export default defineModule({
  id: 'content-admin',
  name: 'Content Admin',
  version: '0.1.0',
  permissions: [Permission.DataTableRead, Permission.DataTableWrite],
  pages: [
    page({
      id: 'content-admin.articles',
      area: 'admin',
      frame: 'admin',
      path: '/content-admin/articles',
      component: './pages/ArticlesAdminPage',
      auth: 'admin',
      permissions: [Permission.DataTableRead],
    }),
  ],
  navigation: {
    location: 'admin.sidebar',
    fallbackLabel: 'Content Admin',
    path: '/content-admin/articles',
  },
});
```

未来 RFC 做法：

```ts
admin: {
  resources: {
    articles: adminResource({
      label: 'Articles',
      navigation: {
        location: 'admin.sidebar',
        group: 'Content',
      },
      data: {
        table: 'articles',
        scope: 'workspace',
      },
      fields: {
        title: textField({ required: true }),
        status: enumField(['draft', 'published']),
        updatedAt: dateTimeField(),
      },
      actions: {
        list: { capability: Permission.DataTableRead, risk: 'read' },
        show: { capability: Permission.DataTableRead, risk: 'read' },
        create: { capability: Permission.DataTableWrite, risk: 'write' },
        update: { capability: Permission.DataTableWrite, risk: 'write' },
        delete: {
          capability: Permission.DataTableWrite,
          risk: 'dangerous',
          confirmation: { field: 'confirm', value: 'CONFIRM' },
        },
      },
      permissions: [Permission.DataTableRead, Permission.DataTableWrite],
    }),
  },
}
```

这类定义可以由 host 转成：

- Refine resource
- AntD Table columns
- AntD Form fields
- Detail descriptions
- filters
- action buttons

### 插件 contract 扩展建议

当前仓库没有 `plugins/` 目录，插件运行时也不是本次后台重构的当前代码事实。插件 Admin Data Resource 应作为后续 RFC，而不是 `/admin` Refine 化的前置条件。未来 `plugin.ts` 可以对齐同一模型：

```ts
admin: {
  resources: {
    syncJobs: pluginAdminDataResource({
      label: 'Sync Jobs',
      group: 'Connector',
      fields: { ... },
      handlers: {
        list: './admin/sync-jobs/list',
        show: './admin/sync-jobs/show',
        custom: {
          retry: './admin/sync-jobs/retry',
        },
      },
      permissions: [Permission.JobsRegister],
      risk: 'write',
    }),
  },
}
```

插件 handler 必须仍通过 `ctx.*` 能力运行。禁止插件 admin handler 直接导入 host internals、DB client、env 或 global fetch。

### 自定义页面仍然允许，但降级为 escape hatch

模块/插件仍可声明 `area: 'admin'` 的自定义页面，用于复杂诊断、可视化、图表或非 CRUD 工具。

但默认推荐顺序应是：

1. declarative Admin Data Resource
2. generated AntD CRUD page
3. resource custom action
4. custom admin page

## 是否允许插件直接使用 Refine + AntD

默认不允许或不推荐。

原因：

1. 会把 Refine/AntD 变成插件 ABI，未来难以调整。
2. 插件可能绕过 host 的 capability、audit、scope 和 runtime guards。
3. 插件自带 AntD version 会带来依赖冲突和 bundle 膨胀。
4. 插件页面很容易重建 host shell，违反 host owns shell 规则。

可以提供受控封装：

```ts
import {
  AdminDataResourceTable,
  AdminDataResourceForm,
  AdminActionButton,
  AdminEvidencePanel,
} from '@ploykit/plugin-sdk/admin';
```

这些组件由 host 实现，内部可以用 AntD，但插件开发者不直接依赖 AntD。

## 现有页面迁移策略

### 迁移优先级

第一批选择 CRUD 密度高、收益明显、风险可控的页面：

1. Users
2. Modules
3. Runs
4. Service Connections
5. Webhooks
6. Files

第二批：

1. Billing
2. Entitlements
3. Revenue
4. Usage
5. Audit
6. Settings

第三批：

1. Overview
2. Analytics
3. Module Dev Console
4. Provider/config doctor panels

### 不保留旧 UI 兼容

完成迁移后删除或替换：

- `apps/host-next/components/admin/shared/AdminPrimitives.tsx`
- `apps/host-next/components/admin/pages/*` 中旧页面组件
- `apps/host-next/components/ui/DataTable` 在 admin 内的使用
- admin page 中传 server action 的模式

删除旧 UI 之前，必须先建立 AntD-backed PloyKit admin semantic components，例如 `AdminEvidencePanel`、`AdminDiagnosticList`、`AdminDangerAction`、`AdminCapabilityTag`、`AdminRuntimeStatusTag`。这些组件承载 PloyKit 领域语义，不能在迁移中被普通 AntD card/table/form 完全打散。

保留或升级：

- `admin-route-registry.ts`
- `admin-console-nav.ts`
- `admin-action.ts` 的审计/风险思想
- `request-context.ts`
- `rbac.ts`
- runtime store 和 admin view model 的业务查询逻辑

## 数据访问重构

### 从 page-local filtering 到 server-side filtering

当前如 `AdminUsersOperationsPage`、`AdminModulesOperationsPage`、`AdminServiceConnectionsOperationsPage` 大量在 React component 内做：

- text search
- exact filter
- pagination
- count summary
- review items

重构后：

- list filters 由 Refine 传给 data provider。
- API handler 在服务端过滤、排序、分页。
- summary/review/evidence 作为 `meta` 或 companion endpoint 返回。

### 推荐 endpoint

```text
GET    /api/admin/data-resources/users
GET    /api/admin/data-resources/users/:id
PATCH  /api/admin/data-resources/users/:id
POST   /api/admin/data-resources/users/actions/bulk-status

GET    /api/admin/data-resources/modules
GET    /api/admin/data-resources/modules/:id
POST   /api/admin/data-resources/modules/:id/actions/status

GET    /api/admin/data-resources/runs
GET    /api/admin/data-resources/runs/:id
POST   /api/admin/data-resources/runs/:id/actions/requeue
POST   /api/admin/data-resources/runs/:id/actions/cancel
```

## 安全设计

### 服务端必须检查

每个 resource operation 都必须：

1. `requireAdminDataResourceRequestContext(request, resource, operation)`
2. 找到 `AdminDataResourceDefinition`
3. 确认 host security catalog 允许当前 route/method
4. 检查 `admin.access`
5. 检查 operation capability
6. 检查 operation risk
7. 对 dangerous mutation 要求 confirmation
8. 执行业务 handler
9. 写 audit
10. 返回 typed envelope

Refine 前端只做 UX，不做安全边界。

### 审计

现有 `createAdminAction` 里的审计思想应迁到 resource operation：

```text
admin.resource.<resource>.<operation>
admin.resource.modules.status
admin.resource.runs.requeue
admin.resource.webhooks.retry
```

所有 mutation 必须包含：

- resource
- operation
- actor
- capability
- risk
- target id
- correlation id
- sanitized input

### 插件/模块 admin action

插件/模块贡献的 admin action 也必须进入同一 audit store，并标记：

- source: `module` 或 `plugin`
- sourceId
- declared permissions
- invoked host capabilities

## UI 设计

### Admin 使用 AntD 的地方

- Layout / Sider / Menu
- Table
- Form
- Drawer
- Modal
- Tabs
- Descriptions
- Statistic
- Tag
- Alert
- Timeline
- Badge
- Dropdown
- Popconfirm
- Notification
- Result

### 保留 PloyKit 语义组件

即使用 AntD，也建议保留 host 语义层：

```text
AdminEvidencePanel
AdminDangerAction
AdminRuntimeStatusTag
AdminCapabilityTag
AdminDiagnosticList
AdminDataResourcePage
```

这些组件内部用 AntD 实现，但承载 PloyKit 的领域语言，避免页面变成纯 AntD 拼装。

### 主题

AntD theme token 从现有 admin CSS token 映射：

```text
--admin-bg
--admin-surface
--admin-border
--admin-text
--admin-text-muted
--admin-primary
--admin-success
--admin-warning
--admin-danger
```

public/dashboard 继续使用当前 Tailwind tokens。不要让 AntD reset 或 theme 污染站点前台。

## Refine 对提效的实际价值

### 能明显提效

1. CRUD 列表页
2. 表格筛选和排序
3. 详情页
4. 创建/编辑表单
5. 抽屉表单
6. 批量操作
7. 删除/危险操作确认
8. 关联下拉
9. mutation loading/error/success
10. 插件/模块 declarative Admin Data Resource 的自动页面生成

### 提效有限

1. Module Doctor 诊断解释
2. Release gate evidence
3. Runtime topology
4. Webhook replay 策略
5. Commercial ledger 业务语义
6. 多租户 scope 和权限判断

这些仍然需要 PloyKit 自己的 domain model。

### 不应使用 Refine 的地方

1. public site
2. SaaS dashboard 普通用户页面
3. account center
4. 模块业务页面默认 UI
5. module-sdk/ui
6. host auth 页面

## 实施计划

### Phase 0：Spike

目标：确认 Next 16 / React 19 / AntD / Refine v5 可运行。

任务：

1. 安装 Refine + AntD 依赖。
2. 在 `/admin/refine-spike` 创建 isolated page。
3. 使用 `@ant-design/nextjs-registry`。
4. 创建一个 mock `users` resource。
5. 验证 table/form/drawer/theme/dark mode。
6. 验证 registry 放在 nested admin layout 时是否足以避免首屏样式闪烁；如果不稳定，再提升到 root layout 并确保 AntD token 不污染 public/dashboard。
7. 跑 `npm run typecheck` 和浏览器截图。

退出标准：

- 无 hydration error。
- 无 CSS flicker。
- AntD 只影响 admin subtree。
- Refine dataProvider 能调用本地 API。
- public/dashboard 截图无 AntD reset 或样式污染。

### Phase 1：Admin Resource 基础设施

任务：

1. 新增 `AdminDataResourceRegistry`。
2. 新增统一 resource API route。
3. 新增 `requireAdminDataResourceRequestContext` 或 `executeAdminDataResourceOperation`。
4. 将 `/api/admin/data-resources/*` 纳入 host route security catalog / admin API registry。
5. 新增 `adminDataProvider`。
6. 新增 `adminAuthProvider`。
7. 新增 `adminAccessControlProvider`。
8. 新增 `AdminRefineProvider`。
9. 从 `ADMIN_CONSOLE_ROUTES` 生成 Refine resources。

退出标准：

- `users` 和 `modules` 可以通过 Refine 列表读取。
- 服务端 capability check 生效。
- 未授权访问返回标准 platform error。

### Phase 2：迁移核心 CRUD 页面

先迁：

1. Users
2. Modules
3. Runs
4. Service Connections

任务：

- 将 page-local filtering 移入 resource handler。
- 将 server action 改为 resource mutation。
- 用 AntD Table/Form/Drawer 重建页面。
- 删除对应旧页面组件。

退出标准：

- 原有功能可用。
- 操作有 audit。
- dangerous action 需要确认。
- browser matrix 覆盖列表、详情、mutation。

### Phase 3：迁移剩余 admin 页面

迁移：

1. Webhooks
2. Files
3. Billing
4. Revenue
5. Entitlements
6. Usage
7. Audit
8. Settings
9. Analytics

退出标准：

- `/admin` 不再依赖 `AdminPrimitives`。
- admin route registry 与 resource registry 一致。
- `admin:ui-gate` 更新到 AntD 视觉基线。

### Phase 4A：模块 Admin Data Resource RFC

任务：

1. 在 module contract 中加入 declarative Admin Data Resource。
2. 从 module contracts 生成 Refine resources。
3. 增加 `module:doctor` 规则：
   - Admin Data Resource 必须声明权限。
   - mutation 必须声明 risk。
   - dangerous action 必须声明 confirmation。
   - handler 不得越界。
4. 提供 `@ploykit/module-sdk/admin` 语义组件。

退出标准：

- 一个资源型模块无需写自定义 admin page 即可出现在 `/admin`。
- 模块 admin action 进入统一 audit。
- 未声明权限的 Admin Data Resource 被 doctor 拒绝。

### Phase 4B：插件 Admin Data Resource RFC

任务：

1. 在 future plugin contract 中对齐 module Admin Data Resource 模型。
2. 增加 future `plugin:doctor` 规则。
3. 从 plugin contracts 生成 Refine resources。
4. 提供 `@ploykit/plugin-sdk/admin` 语义组件。

退出标准：

- 插件无需直接依赖 Refine/AntD 即可贡献后台资源。
- 插件 admin handler 仍通过 `ctx.*` 能力运行。
- 插件 admin action 进入统一 audit。

### Phase 5：删除旧后台前端

删除：

- 旧 admin page components。
- 旧 admin shared primitives。
- 旧 page-local query helpers。
- 旧 server action 绑定方式。

保留：

- host auth/session
- request context
- RBAC
- runtime store
- audit
- module runtime
- admin route/resource registry

## 测试与门禁

### 必跑

```bash
npm run typecheck
npm run test:web-shell
npm run test:admin-operations
npm run test:security-runtime
npm run modules:check
npm run admin:ui-gate
npm run admin:mobile-handfeel
```

### 新增测试

1. Admin resource registry tests
   - duplicate resource 被拒绝。
   - missing capability 被拒绝。
   - dangerous operation 没有 confirmation 被拒绝。
   - operation 级 capability/risk 覆盖 resource 默认值。

2. Admin resource API tests
   - list pagination/filter/sort。
   - unauthorized request 拒绝。
   - mutation 写 audit。
   - `/api/admin/data-resources/*` 出现在 host route security catalog。
   - resource 未注册或 operation 未注册返回 platform error code。

3. Admin Refine provider tests
   - resource manifest 正确映射到 Refine。
   - accessControlProvider 根据 capability 返回 can/cannot。

4. Module Admin Data Resource contract tests
   - 模块 Admin Data Resource 权限缺失时报 doctor error。
   - 模块 Admin Data Resource handler 越界时报 doctor error。

5. Browser tests
   - `/admin/users`
   - `/admin/modules`
   - `/admin/runs`
   - `/admin/service-connections`
   - mobile sider collapse
   - dark/light theme

## 风险

### R1. Client-heavy admin 降低首屏性能

缓解：

- server page 只做 auth 和 initial manifest。
- high-volume tables server-side pagination。
- 对 overview 使用轻量 server summary endpoint。

### R2. AntD 样式污染 public/dashboard

缓解：

- provider 限定在 admin subtree。
- browser visual matrix 覆盖 public/dashboard/admin。
- 不在 public/dashboard import AntD。

### R3. Refine resource 绕过 host 权限

缓解：

- dataProvider 只调用 `/api/admin/data-resources/*`。
- API route 必须查 resource registry。
- 每个 operation 服务端 require capability。

### R4. 插件直接依赖 AntD 造成 ABI 锁定

缓解：

- 默认暴露 PloyKit admin SDK，不暴露 Refine/AntD。
- 插件 admin contract 生成 host-owned Refine resource。
- custom admin page 作为 escape hatch。

### R5. 现有 server actions 到 API mutation 的迁移引入审计缺口

缓解：

- 先把 `createAdminAction` 的审计/risk 逻辑抽到 `executeAdminOperation`。
- server action 和 resource API 迁移期间共用执行器。
- 最后删除 server action 前端绑定。

## 推荐最终形态

```text
Public site             Tailwind / shadcn style, host + module public pages
SaaS dashboard          Tailwind / shadcn style, workspace/user workflows
Account center          Tailwind / shadcn style, host identity
Admin console           Refine + AntD, host-owned operational backend
Module/plugin admin     Declarative Admin Data Resources rendered by host Refine shell
Custom module pages     module-sdk/ui, rendered inside host shell
```

## 最终判断

替换 `/admin` 为 Refine + AntD 是值得做的。它不会替代 PloyKit 的模块系统，但会让后台 CRUD 和运营工具显著标准化。

对插件开发者来说，Refine + AntD 的最大价值不是让他们写 AntD，而是让他们通过 `plugin.ts` / `module.ts` 声明 Admin Data Resource 后，host 自动生成列表、详情、表单、动作和导航。这样既提速，又不牺牲 PloyKit 的 contract-first、安全和审计边界。
