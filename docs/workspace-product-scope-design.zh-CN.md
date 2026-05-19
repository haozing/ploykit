# PloyKit Workspace / Product Scope 架构设计

日期：2026-05-19  
状态：设计稿  
适用阶段：开发阶段，可破坏兼容性，优先保证架构和代码干净

## 结论

PloyKit 需要一个宿主级“资源隔离作用域”，但不应该把 `Workspace`
强制暴露给所有产品和插件。

推荐架构是：

- 底层统一使用 `workspace` 作为权限、成员、资源、密钥、文件、运行记录和插件绑定的隔离边界。
- 产品层通过 `scope profile` 决定用户看到什么：
  - RunLynk 看到“团队空间”。
  - CMS 可以看到“站点”，也可以完全隐藏 workspace。
  - 单人工具默认使用隐式个人空间，不展示任何切换器。
- 插件不直接管理 workspace 生命周期；插件只消费当前产品作用域。
- 宿主负责创建、切换、成员、角色、默认空间和当前作用域解析。

所以问题不是“要不要 workspace”，而是：

> Workspace 应该是宿主内部的一等资源边界，而不是所有用户界面的一等产品概念。

## 背景

RunLynk 的设计要求用户理解：

```text
当前团队空间 -> 当前 RunLynk 项目 -> 任务类型 / 作业 / Worker / Producer / Webhook
```

但 CMS 这类产品未必需要用户理解 workspace：

```text
当前站点 -> 页面 / 文章 / 媒体 / 菜单
```

如果宿主把 `Workspace` 强制作为所有产品的显性概念，CMS 会显得多余。如果完全没有 workspace，RunLynk、团队权限、资源绑定、workspace API key、共享文件、共享配额又会缺少统一边界。

因此需要把“底层隔离边界”和“用户可见对象”分开。

## 设计目标

1. 保留统一资源边界，避免每个插件自己实现团队、成员、角色和隔离。
2. 允许不同产品用不同词汇表达同一个底层作用域。
3. 单人/单站点产品不显示多余的 workspace UI。
4. 插件代码只依赖稳定的 `ctx.scope` / `ctx.workspace` 能力，不读宿主内部表。
5. RunLynk 这类团队产品可以自然使用团队空间、成员、角色和项目绑定。
6. CMS 这类产品可以把 workspace 产品化成“站点”，或用隐式默认空间完全隐藏。
7. 开发阶段允许重命名、迁移和破坏旧接口，换取长期更干净的模型。

## 非目标

- 不在插件内实现通用 workspace 管理页面。
- 不让每个插件自建成员、邀请、角色系统。
- 不强制所有产品显示 workspace switcher。
- 不在 MVP 支持一个 workspace 下多个 RunLynk project。
- 不把 `resource binding`、`actor claims`、`workspace id` 作为普通用户首屏概念。

## 核心概念

### Workspace

宿主内部的资源隔离边界。

负责：

- 成员和角色：`owner`、`admin`、`editor`、`viewer`
- 插件资源绑定 scope
- workspace API key scope
- workspace 文件、运行记录、artifact、connector
- workspace 级服务连接和配额

Workspace 是平台能力，不等于所有产品里的“团队空间”。

### Product Scope

产品层看到的当前作用域。

它可以映射到底层 workspace，但使用不同展示名：

| 产品       | 用户看到    | 底层                              |
| ---------- | ----------- | --------------------------------- |
| RunLynk    | 团队空间    | workspace                         |
| CMS 单站点 | 不显示      | default workspace                 |
| CMS 多站点 | 站点        | workspace 或 site-owned workspace |
| CRM        | 团队 / 组织 | workspace                         |
| 个人工具   | 不显示      | personal workspace                |

### Scope Profile

产品声明自己如何使用 workspace。

建议类型：

```ts
type ProductScopeMode = 'hidden-default' | 'explicit-workspace' | 'domain-alias';

interface ProductScopeProfile {
  mode: ProductScopeMode;
  label: string;
  pluralLabel: string;
  icon?: string;
  routePrefix?: string;
  allowCreate: boolean;
  allowSwitch: boolean;
  allowMembers: boolean;
  defaultNameTemplate?: string;
}
```

示例：

```ts
const runlynkScopeProfile = {
  mode: 'explicit-workspace',
  label: '团队空间',
  pluralLabel: '团队空间',
  allowCreate: true,
  allowSwitch: true,
  allowMembers: true,
  defaultNameTemplate: '{userName} 的团队',
} satisfies ProductScopeProfile;
```

```ts
const simpleCmsScopeProfile = {
  mode: 'hidden-default',
  label: '站点',
  pluralLabel: '站点',
  allowCreate: false,
  allowSwitch: false,
  allowMembers: false,
  defaultNameTemplate: '{userName} 的站点',
} satisfies ProductScopeProfile;
```

```ts
const multiSiteCmsScopeProfile = {
  mode: 'domain-alias',
  label: '站点',
  pluralLabel: '站点',
  allowCreate: true,
  allowSwitch: true,
  allowMembers: true,
  routePrefix: '/sites',
} satisfies ProductScopeProfile;
```

## 推荐信息架构

### 隐式默认模式

适合：

- 单站点 CMS
- 个人工具
- 简单 SaaS
- 不强调团队协作的插件

用户看不到 workspace。

```text
Dashboard
  Content
  Media
  Settings
```

宿主行为：

- 用户首次进入时自动创建 default workspace。
- 当前 scope 总是 default workspace。
- header 不显示 workspace switcher。
- 插件仍然通过 workspace scope 存储资源。

### 显式团队空间模式

适合：

- RunLynk
- 协作型 SaaS
- 需要成员、角色、共享密钥、共享配额的产品

```text
Dashboard Header
  [团队空间切换器]

RunLynk
  项目概览
  任务类型
  作业
  Worker
  密钥
  Webhook
  设置
```

宿主行为：

- header 显示当前团队空间。
- 提供创建、切换、成员管理入口。
- 插件页面只展示当前团队空间上下文。

### 领域别名模式

适合：

- 多站点 CMS
- 多品牌营销站
- 多客户项目管理

用户看到的是领域对象，不是 workspace。

```text
Site Switcher
  Acme Blog
  Docs Site
  Marketing Site

CMS
  Pages
  Posts
  Media
  Menus
```

底层仍可使用 workspace 成员和资源边界，但 UX 叫“站点”。

## 数据模型建议

当前已有表可以保留，但建议开发阶段整理命名和职责。

### 保留的核心表

```text
workspaces
workspace_members
workspace_invitations
plugin_resource_bindings
plugin_service_connections
plugin_api_keys
plugin_files
plugin_runs
plugin_artifacts
```

### 新增 product scope profile

可以放在 runtime catalog 或产品配置里，而不是插件内硬编码。

```ts
interface RuntimeProduct {
  id: string;
  name: string;
  runtimeKey?: string;
  defaultLocale?: string;
  status?: string;
  scopeProfile?: ProductScopeProfile;
}
```

开发阶段可以直接迁移 catalog 类型，不做旧字段兼容。

### Workspace metadata

Workspace 可带产品语义：

```ts
interface WorkspaceMetadata {
  productId?: string;
  kind?: 'team' | 'site' | 'personal' | 'project';
  displayAlias?: string;
  defaultForUserId?: string;
}
```

注意：metadata 只用于展示和默认行为，不应该承载权限规则。

## 当前作用域解析

需要一个宿主统一服务：`runtimeScopeService` 或新的 `productScopeService`。

建议接口：

```ts
interface CurrentProductScope {
  productId: string;
  workspaceId: string;
  displayName: string;
  label: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  mode: ProductScopeMode;
  hidden: boolean;
}

interface ProductScopeService {
  getCurrent(input: {
    userId: string;
    productId: string;
    requestedWorkspaceId?: string;
  }): Promise<CurrentProductScope>;

  list(input: { userId: string; productId: string }): Promise<CurrentProductScope[]>;

  create(input: {
    userId: string;
    productId: string;
    name: string;
    slug?: string;
  }): Promise<CurrentProductScope>;

  switch(input: {
    userId: string;
    productId: string;
    workspaceId: string;
  }): Promise<CurrentProductScope>;
}
```

### 当前 workspace 来源优先级

建议按顺序解析：

1. URL 或 route context 显式指定的 workspace/site。
2. 用户最近选择的 product workspace。
3. 用户在该 product 下的默认 workspace。
4. 自动创建隐式 default workspace。

不要让 `ctx.workspace.current()` 永远返回第一个 workspace。那会在多 workspace 用户中造成不可预测行为。

## 插件上下文设计

插件应该拿到“当前产品作用域”，而不是自己猜。

建议保留 `ctx.workspace`，同时新增更语义化的 `ctx.scope`：

```ts
ctx.scope.current();
ctx.scope.require();
ctx.scope.hasRole(['owner', 'admin']);
```

返回：

```ts
{
  type: 'workspace',
  id: 'workspace-id',
  label: '团队空间',
  displayName: '默认团队',
  role: 'owner',
  hidden: false,
}
```

`ctx.workspace` 可作为底层 workspace API：

```ts
ctx.workspace.current();
ctx.workspace.list();
ctx.workspace.create();
ctx.workspace.members();
ctx.workspace.invite();
ctx.workspace.hasRole();
```

插件 UI 应优先使用 `ctx.scope.current()` 里的产品化文案。

## 插件契约建议

插件可以声明自己是否需要显式 scope。

```ts
export default definePlugin({
  id: 'runlynk-core-console',
  scope: {
    required: true,
    visibility: 'product',
    roles: {
      read: ['owner', 'admin', 'editor', 'viewer'],
      write: ['owner', 'admin'],
    },
  },
  resourceBindings: [
    {
      type: 'project',
      scope: 'workspace',
      cardinality: 'one',
    },
  ],
});
```

CMS 单站点插件：

```ts
export default definePlugin({
  id: 'simple-cms',
  scope: {
    required: true,
    visibility: 'hidden',
  },
});
```

这里的 `visibility: 'hidden'` 不代表没有 workspace，只代表普通 UI 不显示作用域切换。

## RunLynk 产品规则

RunLynk 应使用：

```text
ProductScopeProfile.mode = explicit-workspace
label = 团队空间
```

MVP 规则：

- 一个团队空间绑定一个 RunLynk project。
- RunLynk 插件不创建 workspace，除非宿主通过通用能力提供创建入口。
- RunLynk 插件可以创建当前 workspace 下的 RunLynk project binding。
- `resourceBindings` 使用 `scope: 'workspace'`、`cardinality: 'one'`。
- 普通 UI 不展示 `resource binding`、`actor claims`。

用户文案：

```text
RunLynk 项目
管理当前团队空间的任务类型、作业、Worker、密钥和 Webhook。
当前团队空间：默认团队
```

无项目时：

```text
为当前团队空间启用 RunLynk
RunLynk 会为当前团队空间创建一个任务运行项目。
```

无 workspace 时：

```text
需要先选择团队空间
请选择已有团队空间，或创建新的团队空间后再启用 RunLynk。
```

## CMS 产品规则

CMS 不必显式展示 workspace。

### 单站点 CMS

使用：

```text
ProductScopeProfile.mode = hidden-default
label = 站点
```

行为：

- 首次进入自动创建 default workspace。
- 不显示 workspace switcher。
- 资源仍写入 workspace scope。
- 用户只看到 CMS 资源。

```text
CMS
  页面
  文章
  媒体
  菜单
  设置
```

### 多站点 CMS

使用：

```text
ProductScopeProfile.mode = domain-alias
label = 站点
```

行为：

- 显示站点切换器。
- 创建动作叫“创建站点”，底层创建 workspace。
- 成员入口叫“站点成员”。

```text
当前站点：Acme Blog
页面 / 文章 / 媒体 / 菜单 / 站点设置
```

这样 CMS 不会出现多余的“Workspace”心智。

## 导航与 Header

Dashboard header 根据当前 product 的 scope profile 决定是否显示切换器。

```ts
if (scopeProfile.mode === 'hidden-default') {
  return null;
}

return <ProductScopeSwitcher label={scopeProfile.label} />;
```

切换器文案由 profile 决定：

| mode               | UI                       |
| ------------------ | ------------------------ |
| hidden-default     | 不显示                   |
| explicit-workspace | 团队空间切换器           |
| domain-alias       | 站点 / 项目 / 品牌切换器 |

## 权限模型

底层继续使用 workspace role。

| 角色   | 读  | 写  | 管理成员 | 管理 billing / 配额 |
| ------ | --- | --- | -------- | ------------------- |
| owner  | 是  | 是  | 是       | 是                  |
| admin  | 是  | 是  | 是       | 可配置              |
| editor | 是  | 是  | 否       | 否                  |
| viewer | 是  | 否  | 否       | 否                  |

插件可在资源绑定声明中收敛权限：

```ts
resourceBindings: [
  {
    type: 'project',
    scope: 'workspace',
    cardinality: 'one',
    permissions: {
      read: ['owner', 'admin', 'editor', 'viewer'],
      write: ['owner', 'admin'],
    },
  },
];
```

## API 设计

宿主提供通用 API：

```text
GET    /api/product-scope/current?productId=runlynk
GET    /api/product-scope?productId=runlynk
POST   /api/product-scope
POST   /api/product-scope/switch
GET    /api/product-scope/:workspaceId/members
POST   /api/product-scope/:workspaceId/invitations
```

UI 文案由 product scope profile 决定。API 仍使用 `workspaceId`，避免后端出现 `siteId/teamSpaceId/projectSpaceId` 多套字段。

## 错误码

建议宿主统一提供结构化错误：

```text
PRODUCT_SCOPE_REQUIRED
PRODUCT_SCOPE_FORBIDDEN
PRODUCT_SCOPE_NOT_FOUND
PRODUCT_SCOPE_CREATE_DISABLED
PRODUCT_SCOPE_SWITCH_DISABLED
PRODUCT_SCOPE_ROLE_REQUIRED
WORKSPACE_MEMBER_NOT_FOUND
WORKSPACE_INVITE_FORBIDDEN
```

插件可以映射成本地化文案：

```text
需要先选择团队空间
当前账号没有管理该团队空间的权限
当前站点不存在或你已失去访问权限
```

## 迁移策略

开发阶段不考虑兼容性，建议直接整理为干净模型。

1. 保留现有 `workspaces` 表。
2. 增加 product scope profile 到 runtime catalog。
3. 增加当前 product scope 服务。
4. 修改 `ctx.workspace.current()`：不再简单返回第一个 workspace，而是通过 product scope service 解析。
5. 新增 `ctx.scope.current()`，插件 UI 优先使用它。
6. Dashboard header 接入 product scope profile。
7. RunLynk 插件移除自建 workspace 入口，只展示当前团队空间。
8. CMS 类插件默认使用 hidden-default。
9. 清理普通用户 UI 中的 `Workspace`、`resource binding`、`actor claims`。

## 推荐实施顺序

### P0：语义和边界

- 定义 `ProductScopeProfile`。
- Runtime catalog 支持 `scopeProfile`。
- 新增 `productScopeService`。
- 明确 `hidden-default`、`explicit-workspace`、`domain-alias` 三种模式。

### P1：当前作用域

- 实现当前 product scope 解析。
- 为没有 workspace 的用户自动创建 default workspace。
- 保存用户最近选择的 product workspace。
- 修正 `ctx.workspace.current()` 的语义。
- 新增 `ctx.scope.current()`。

### P2：宿主 UI

- Dashboard header 增加 ProductScopeSwitcher。
- 支持 profile 驱动文案。
- hidden-default 模式不显示。
- domain-alias 模式显示“站点/项目/品牌”。

### P3：RunLynk 接入

- RunLynk 使用 explicit-workspace。
- 首页展示“当前团队空间”。
- 无项目时展示“启用 RunLynk”。
- 不展示 resource binding 和 actor claims。
- 错误码映射为产品文案。

### P4：CMS 接入

- 单站点 CMS 使用 hidden-default。
- 多站点 CMS 使用 domain-alias。
- 验证用户看不到多余 workspace 概念。

## 代码组织建议

```text
src/lib/product-scope/
  product-scope-types.ts
  product-scope-profile.ts
  product-scope-service.server.ts
  product-scope-repository.server.ts
  product-scope-errors.ts

src/components/product-scope/
  ProductScopeSwitcher.tsx
  ProductScopeCreateDialog.tsx
  ProductScopeMemberDialog.tsx

src/app/api/product-scope/
  route.ts
  current/route.ts
  switch/route.ts
  [workspaceId]/members/route.ts
```

不要把这些逻辑塞进单个插件，也不要散落在 dashboard header 和插件 runtime 中。

## 设计原则

1. 底层统一，表层可变。
2. 权限边界永远在宿主。
3. 插件消费当前作用域，不管理作用域生命周期。
4. 单人产品默认隐藏 workspace。
5. 协作产品显式展示团队空间。
6. 领域产品使用领域词汇，例如站点、品牌、项目。
7. 普通用户不看技术词，管理员和开发者可以在高级区看到 ID 和诊断信息。

## 最终判断

Workspace 不是多余的。多余的是把 workspace 作为所有产品都必须理解的显性概念。

干净的架构应该是：

```text
Workspace = 宿主内部资源边界
Product Scope = 产品可见作用域
Scope Profile = 产品如何表达这个作用域
Plugin = 消费当前作用域并声明资源需求
```

RunLynk 需要显式团队空间。  
CMS 单站点不需要显式 workspace。  
CMS 多站点可以把 workspace 产品化为站点。  
宿主只需要做一套干净的作用域能力，而不是为每个产品重复发明隔离模型。
