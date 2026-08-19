# PloyKit 模块即宿主扩展重构设计

> 状态：实现中，核心协议已部分落地  
> 范围：模块合同、宿主能力边界、可信扩展、能力精简和运行时装配  
> 兼容性：本设计不考虑旧合同和旧数据兼容  
> 目标：保留一个公开开发模型，让模块可以按协议扩展宿主，同时保持宿主核心最小、稳定、可审计

## 结论

PloyKit 不应该拆出“模块开发者、Provider 开发者、Extension 开发者”三种公开身份。这样会让开源框架的心智负担变重，也容易把本来统一的模块系统拆散。

更适合的模型是：

```text
对外只有一种扩展单元：Module。

Module 默认是产品模块。
Module 可以声明自己需要或提供宿主扩展。
宿主通过 catalog / install policy 决定它是否可信、是否启用、是否允许挂载扩展。
```

关键修正点：

- 模块可以声明 `kind: 'host-extension'`，但不能靠 `module.ts` 自证可信。
- 可信状态必须由宿主安装清单、catalog 状态或系统 allowlist 授予。
- 不新增 `definePlugin`、`defineProvider`、`defineExtension`。
- 不把所有能力都做进宿主核心。
- 不让普通模块直接扩展宿主内核。
- 先复用现有 `CapabilityDescriptor` / `ctx.extensions` 底座，避免重造一套复杂扩展系统。

## 当前代码事实

### `ModuleDefinition` 已经是宿主扩展合同

当前来源：`src/module-sdk/types.ts`。

现有 `ModuleDefinition` 已经包含：

```ts
export interface ModuleDefinition {
  id: string;
  name: string;
  version: string;
  product?: ModuleProductDefinition;
  permissions?: readonly PermissionValue[];
  scope?: ModuleScopeDefinition;
  data?: ModuleDataDefinition;
  pages?: readonly ModulePageDefinition[];
  apis?: readonly ModuleApiDefinitionContract[];
  navigation?: ModuleNavigationItem | readonly ModuleNavigationItem[];
  surfaces?: Record<string, ModuleSurfaceDefinition>;
  resources?: Record<string, ModuleResourceDefinition>;
  meters?: Record<string, ModuleMeterDefinition>;
  serviceRequirements?: Record<string, ModuleServiceRequirementDefinition>;
  resourceBindings?: Record<string, ModuleResourceBindingRequirement>;
  config?: Record<string, ModuleConfigFieldDefinition>;
  actions?: Record<string, ModuleActionDefinition>;
  jobs?: Record<string, ModuleJobDefinition>;
  events?: ModuleEventsDefinition;
  webhooks?: Record<string, ModuleWebhookDefinition>;
  lifecycle?: ModuleLifecycleDefinition;
  dependencies?: ModuleDependenciesDefinition;
  egress?: readonly string[];
  quality?: ModuleQualityDefinition;
}
```

这已经不是普通前端组件合同。模块可以贡献路由、页面、API、导航、surface、数据、任务、事件、webhook、生命周期和外部服务需求。所以“模块就是扩展宿主的单元”这个方向和现有代码一致。

### `ModuleContext` 已经是能力注入模型

当前来源：`src/module-sdk/context.ts`。

`ModuleContext` 已经按能力注入：

```ts
export interface ModuleContext {
  module: { id: string; version: string };
  product: ModuleProductContext;
  user: ModuleUser | null;
  auth: ModuleAuthContext;
  scope: ModuleScopeContext;
  workspace: ModuleWorkspaceContext;
  request: ModuleRequest;
  response: ModuleResponseFactory;
  data: ModuleDataApi;
  config: ModuleConfigApi;
  secrets: ModuleSecretsApi;
  services: ModuleServicesApi;
  connectors: ModuleConnectorsApi;
  resourceBindings: ModuleResourceBindingsApi;
  http: ModuleHttpApi;
  files: ModuleFilesApi;
  artifacts: ModuleArtifactsApi;
  notifications: ModuleNotificationsApi;
  runs: ModuleRunsApi;
  jobs: ModuleJobsApi;
  events: ModuleEventsApi;
  webhooks: ModuleWebhooksApi;
  usage: ModuleUsageApi;
  metering: ModuleMeteringApi;
  credits: ModuleCreditsApi;
  billing: ModuleBillingApi;
  entitlements: ModuleEntitlementsApi;
  commerce: ModuleCommerceApi;
  redeemCodes: ModuleRedeemCodesApi;
  ai: ModuleAiApi;
  rag: ModuleRagApi;
  apiKeys: ModuleApiKeysApi;
  rateLimit: ModuleRateLimitApi;
  risk: ModuleRiskApi;
  cache: ModuleCacheApi;
  audit: ModuleAuditApi;
  extensions: Readonly<Record<string, unknown>>;
  json(data: unknown, init?: ResponseInit): Response;
}
```

问题是这个能力面过于平铺。身份、租户、权限、Data v2、审计这些宿主核心能力，和 AI、文件、RAG、商业、webhook 等可替换运行时能力放在同一个层级，容易让框架边界变模糊。

### 权限模型已经表达了信任边界

当前来源：`src/module-sdk/permissions.ts`。

已有系统权限：

```ts
export const SystemOnlyPermissions = new Set<PermissionValue>([
  Permission.DataSchemaManage,
  Permission.RuntimeManage,
  Permission.ProductManage,
  Permission.AuthManage,
  Permission.UnsafeSqlRaw,
  Permission.UnsafeInternalResource,
]);
```

也已有保留运行时权限：

```ts
export const ReservedRuntimePermissions = new Set<PermissionValue>([
  Permission.ConfigWrite,
  Permission.SecretsWrite,
  Permission.SubjectsRead,
  Permission.ConnectorsManage,
]);
```

validator 已经会对这些权限给出 warning 或 error。这说明当前系统并不是“模块声明什么就能做什么”，而是已经有请求运行时、系统运行时和保留能力的区别。

### 能力扩展底座已经存在

当前来源：`src/lib/module-kernel/capability-registry.ts`。

现有 `CapabilityDescriptor` 很接近需要的扩展协议：

```ts
export interface CapabilityDescriptor<TName extends string = string, TApi = unknown> {
  name: TName;
  ctxKey: TName;
  permissions: readonly PermissionValue[];
  mount?(input: CapabilityMountInput): TApi | undefined;
  guard?(input: CapabilityGuardInput<TApi>): TApi;
  doctor?(input: { moduleRoot: string }): CapabilityDiagnostic[];
  validateContract?(input: { contract: ModuleRuntimeContract }): CapabilityDiagnostic[];
}
```

`createModuleHost` 也已经能通过 `mountCapabilityDescriptors` 把 descriptor 挂到 `ctx.extensions`。目前缺的是：descriptor 由宿主传入，而不是由可信模块合同声明后进入扫描、catalog 和 runtime。

### catalog 已经能承载启用状态，但还不能承载信任授权

当前来源：`src/lib/module-runtime/catalog/catalog-types.ts`。

当前 `ModuleCatalogModuleState` 包含：

```ts
export interface ModuleCatalogModuleState {
  productId: string;
  moduleId: string;
  status: ModuleCatalogModuleStatus;
  bundleId?: string;
  required?: boolean;
  scopeProfile?: ModuleProductScopeProfile;
  diagnostics?: readonly ModuleDiagnostic[];
  updatedAt?: string;
}
```

它已经能表达 enabled / disabled / maintenance，但还不能表达“这个模块是否被宿主信任为 host-extension”。因此信任状态不应写进 `module.ts` 自证，而应扩展 catalog / install policy。

## 主要问题

### 问题 1：模块不能自证可信

如果设计成：

```ts
trust: { level: 'trusted' }
```

那等于模块自己说自己可信。这个不安全，也不符合开源框架的安装模型。

正确做法：

```text
module.ts 声明意图。
catalog / install policy 授权信任。
runtime 只挂载已授权模块的扩展能力。
```

### 问题 2：`kind + trust` 有重复

原设计同时有：

```ts
kind: 'host-extension'
trust: { level: 'trusted' }
```

这两个字段职责重叠。更简洁的方式是：

- `module.ts.kind` 只表达模块意图：`product` 或 `host-extension`。
- 宿主 catalog/install policy 表达实际信任：`trust: 'product' | 'trusted' | 'system'`。

### 问题 3：`provides` 第一版过大

第一版包含：

```ts
provides: {
  capabilities
  serviceProviders
  adminResources
  routePolicies
}
```

这里有过度设计风险。`serviceProviders` 和 `routePolicies` 暂时不需要作为第一版模块扩展协议。当前已有 `serviceRequirements` 和 route/security catalog，直接再引入 provider/route policy 容易把模型拉复杂。

第一版只保留：

```ts
provides: {
  capabilities?
  adminResources?
}
```

### 问题 4：宿主核心不够小

如果把 files、AI、RAG、jobs、events、商业、通知都叫 core，会让“宿主最小核心”失去意义。

更合理的分类：

- Host Kernel：身份、租户、权限、模块注册、路由入口、Data v2、审计、限流。
- Standard Capabilities：文件、任务、事件、AI、RAG、商业、通知等标准能力包。
- Trusted Extension Capabilities：executor、ffmpeg、地图、行业同步器等领域能力。

### 问题 5：示例里不应让普通可信扩展使用 `Permission.RuntimeManage`

`Permission.RuntimeManage` 当前属于 `SystemOnlyPermissions`。如果把它放进普通 host-extension 示例，会误导开发者以为可信扩展可以直接拿系统权限。

更好的做法：

- admin resource 操作使用更窄的 capability permission。
- 第一版如果没有合适权限，就新增专门权限，比如 admin resource 读写权限或 host extension 提供权限。
- `RuntimeManage` 保留给 CLI、系统模块或宿主内部。

## 修订后的设计原则

```text
一个公开模型：Module。
两个模块意图：product / host-extension。
三种运行信任：product / trusted / system。
信任由宿主授予，不由模块自证。
宿主核心只保留安全与治理闭环。
标准能力可以内置，但不等于核心。
领域能力通过可信模块挂到 ctx.extensions。
```

## 修订后的合同设计

### `module.ts` 只声明意图

```ts
export type ModuleKind = 'product' | 'host-extension';

export interface ModuleProvidesDefinition {
  capabilities?: Record<string, ModuleProvidedCapabilityDefinition>;
  adminResources?: Record<string, ModuleProvidedAdminResourceDefinition>;
}

export interface ModuleUsesDefinition {
  capabilities?: readonly string[];
}

export interface ModuleDefinition {
  kind?: ModuleKind;
  provides?: ModuleProvidesDefinition;
  uses?: ModuleUsesDefinition;
}
```

默认：

```text
kind 缺省为 product。
product 模块不能声明 provides。
host-extension 模块可以声明 provides，但只有被宿主信任后才会挂载。
```

### catalog / install policy 授予信任

在 catalog state 或安装清单增加宿主侧字段：

```ts
export type ModuleRuntimeTrust = 'product' | 'trusted' | 'system';

export interface ModuleCatalogModuleState {
  productId: string;
  moduleId: string;
  status: ModuleCatalogModuleStatus;
  trust?: ModuleRuntimeTrust;
  allowedProvides?: readonly string[];
}
```

含义：

- `trust: 'product'`：只按普通模块运行。
- `trust: 'trusted'`：允许挂载 `provides` 中被 allowlist 允许的扩展。
- `trust: 'system'`：宿主内置模块或 CLI/system context，可使用系统权限。
- `allowedProvides`：细粒度允许哪些 extension point，避免“一可信就全开”。

示例：

```json
{
  "productId": "default",
  "moduleId": "worker-executor-local",
  "status": "enabled",
  "trust": "trusted",
  "allowedProvides": ["capabilities.executor", "adminResources.workers"]
}
```

## 修订后的运行时模型

当前：

```text
createHostRuntime
  -> createModuleHostForRuntime
    -> createHostCapabilityProviders
      -> 固定 ctx 能力
```

目标：

```text
createHostRuntime
  -> 读取 module contracts
  -> 读取 catalog module states
  -> 计算每个模块的 runtime trust
  -> 挂载 Host Kernel
  -> 挂载 Standard Capabilities
  -> 挂载 trusted module provides
  -> 创建 ModuleContext
```

挂载规则：

1. product 模块永远不能覆盖 top-level `ctx.*`。
2. host-extension 模块的扩展默认挂到 `ctx.extensions.*`。
3. system 模块也不应随意覆盖 kernel，除非进入宿主源码 allowlist。
4. `ctx.extensions.*` 必须经过 descriptor permission guard。
5. 未在 `uses.capabilities` 声明的扩展调用应被 doctor 阻止。

## 宿主能力分层

### 第一层：Host Kernel

Host Kernel 是最小稳定核心。它负责安全、隔离和调度，不负责具体业务能力。

| 能力 | 当前表面 | 是否核心 | 原因 |
| --- | --- | --- | --- |
| 模块身份 | `ctx.module` | 是 | 所有执行都必须知道 module id/version。 |
| 请求/响应 | `ctx.request`、`ctx.response`、`ctx.json` | 是 | handler 基础上下文。 |
| 用户/认证 | `ctx.user`、`ctx.auth` | 是 | 身份归宿主。 |
| 租户/产品/工作区 | `ctx.scope`、`ctx.workspace`、`ctx.product` | 是 | 多租户隔离基础。 |
| 权限与 session guard | `Permission.*`、capability guard | 是 | 模块安全边界。 |
| 模块合同注册 | contracts、registry、module map | 是 | 所有模块入口都依赖它。 |
| 路由入口 | `pages`、`apis`、`webhooks` registry | 是 | 宿主必须控制 HTTP 入口。 |
| action/job 入口注册 | `actions`、`jobs` registry | 是 | 宿主必须控制可执行入口。 |
| navigation/surface 注册 | `navigation`、`surfaces` | 是 | 宿主拥有 shell 和组合权。 |
| Data v2 声明与 scope enforcement | `data`、`resources` | 是 | 数据隔离和 schema 权威。 |
| 审计原语 | `ctx.audit` | 是 | 可替换存储，但审计合同必须核心。 |
| 限流原语 | `ctx.rateLimit` | 是 | 可替换实现，但 abuse control 合同必须核心。 |

Host Kernel 不应该包含：

- AI provider 实现
- 文件存储实现
- 任务队列实现
- 支付 provider 实现
- RAG/vector store 实现
- 通知 channel 实现
- 业务 executor 实现

### 第二层：Standard Capabilities

这些是框架标准能力。它们可以继续作为 first-class `ctx.*`，因为足够通用，但它们不是 Host Kernel。

| 能力 | 当前表面 | 建议 |
| --- | --- | --- |
| 文件 | `ctx.files` | 标准能力，provider-backed。 |
| artifacts | `ctx.artifacts` | 标准能力，provider-backed。 |
| 通知 | `ctx.notifications` | 标准能力，provider-backed。 |
| 外部 HTTP | `ctx.http` | 标准能力，保留 egress guard。 |
| 受控服务调用 | `ctx.services` | 标准能力，必须绑定 `serviceRequirements`。 |
| connectors | `ctx.connectors` | 标准能力；manage 继续 reserved。 |
| resource bindings | `ctx.resourceBindings` | 标准能力；write 可要求 trusted/admin。 |
| runs | `ctx.runs` | 标准能力，provider-backed run store。 |
| jobs | `ctx.jobs` | 标准能力，provider-backed queue。 |
| events | `ctx.events` | 标准能力，provider-backed bus。 |
| webhooks | `ctx.webhooks` | 标准能力，provider-backed receipt/signature。 |
| cache | `ctx.cache` | 标准能力；权限命名需要修正。 |
| AI | `ctx.ai` | 标准能力，provider-backed。 |
| RAG | `ctx.rag` | 标准能力，provider-backed。 |

这些能力可以继续出现在 `ModuleContext` 顶层，但应在文档中称为 Standard Capabilities，而不是 Host Kernel。

### 第三层：Commercial Authority

商业事实需要单一权威，因此这些合同应保持 host authority，但实现可替换。

| 能力 | 当前表面 | 建议 |
| --- | --- | --- |
| usage | `ctx.usage` | host authority。 |
| metering | `ctx.metering` | host authority。 |
| credits | `ctx.credits` | host authority。 |
| billing | `ctx.billing` | host authority，避免给普通模块 broad write。 |
| entitlements | `ctx.entitlements` | host authority。 |
| commerce | `ctx.commerce` | host authority。 |
| redeem codes | `ctx.redeemCodes` | host authority。 |
| risk | `ctx.risk` | host authority。 |

这些能力不应该被普通 host-extension 重新定义为另一套账本。可以允许 payment provider、tax provider、invoice provider，但它们只能接入宿主商业合同，不能替代商业事实归属。

### 第四层：Trusted Extension Capabilities

领域专用能力通过可信模块提供，挂到 `ctx.extensions`。

| 能力例子 | 为什么不进核心 |
| --- | --- |
| `ctx.extensions.executor` | worker 执行协议，不是通用内核。 |
| `ctx.extensions.ffmpeg` | 媒体处理领域能力。 |
| `ctx.extensions.maps` | 地图/地理编码领域能力。 |
| `ctx.extensions.crmSync` | CRM 领域同步能力。 |
| `ctx.extensions.searchIndexer` | 专用索引管线。 |

晋升为 first-class `ctx.*` 的条件：

- 多个无关领域都需要。
- 合同稳定。
- 涉及安全/计费/租户治理。
- 框架能提供清晰 permission、doctor、测试和 provider model。

## `ctx.extensions` 精简方案

当前：

```ts
extensions: Readonly<Record<string, unknown>>;
```

问题：

- 类型弱。
- LLM 容易直接索引。
- 难以做使用声明和 doctor 检查。
- 缺少 missing extension 的标准错误。

建议改为：

```ts
interface ModuleExtensionsApi {
  get<T = unknown>(name: string): T | null;
  require<T = unknown>(name: string): T;
  list(): readonly string[];
}

export interface ModuleContext {
  extensions: ModuleExtensionsApi;
}
```

doctor 规则：

- 使用 `ctx.extensions.require('x')` 必须在 `uses.capabilities` 声明 `x`，doctor 和 runtime 都应阻止未声明访问。
- 使用 `ctx.extensions.get('x')` 建议声明 `x`，否则 warning。
- product 模块不能声明 `provides.capabilities`。
- host-extension 模块未被 catalog 信任时，其 `provides` 不挂载。

## `provides.capabilities` 第一版

第一版保持窄设计：

```ts
export interface ModuleProvidedCapabilityDefinition {
  provider: string;
  permissions?: readonly PermissionValue[];
  description?: string;
}
```

示例：

```ts
export default defineModule({
  id: 'worker-executor-local',
  name: 'Local Worker Executor',
  kind: 'host-extension',
  permissions: [Permission.ServicesInvoke, Permission.AdminResourcesWrite],
  provides: {
    capabilities: {
      executor: {
        provider: './capabilities/executor',
        permissions: [Permission.ServicesInvoke],
        description: 'Runs module jobs through a host-managed worker executor.',
      },
    },
  },
});
```

宿主 catalog 授权：

```json
{
  "moduleId": "worker-executor-local",
  "status": "enabled",
  "trust": "trusted",
  "allowedProvides": ["capabilities.executor"]
}
```

消费模块：

```ts
export default defineModule({
  id: 'image-tools',
  kind: 'product',
  uses: {
    capabilities: ['executor'],
  },
});
```

运行时代码：

```ts
const executor = ctx.extensions.require<ExecutorApi>('executor');
await executor.run(input);
```

## `provides.adminResources` 第一版

admin resource 是给后台使用的 operator surface，不等于模块业务 `resources`。

第一版形态：

```ts
export interface ModuleProvidedAdminResourceDefinition {
  label?: string;
  operations: Record<string, ModuleProvidedAdminResourceOperation>;
}

export interface ModuleProvidedAdminResourceOperation {
  handler: string;
  permission: PermissionValue;
  risk: 'read' | 'write' | 'dangerous';
  auditEvent?: string;
  confirmation?: {
    field: string;
    value: string;
  };
}
```

示例：

```ts
provides: {
  adminResources: {
    workers: {
      label: 'Workers',
      operations: {
        list: {
          handler: './admin/workers.list',
          permission: Permission.AdminResourcesRead,
          risk: 'read',
        },
        restart: {
          handler: './admin/workers.restart',
          permission: Permission.AdminResourcesWrite,
          risk: 'dangerous',
          auditEvent: 'worker.restart',
          confirmation: { field: 'confirm', value: 'RESTART' },
        },
      },
    },
  },
}
```

说明：

- admin resource 示例使用 `Permission.AdminResourcesRead` / `Permission.AdminResourcesWrite`，避免把后台资源操作伪装成审计日志写入权限。
- 不建议用 `Permission.RuntimeManage` 作为普通扩展后台操作权限。
- 每个 operation 必须有独立 permission、risk、audit 和 confirmation。

## 宿主代码精简建议

### `capability-providers.ts` 拆分合理

当前 `apps/host-next/lib/capability-providers.ts` 聚合了太多能力装配逻辑，拆分是合理的。但这只是可维护性重构，不应该和 extension 协议强绑定。

建议拆分：

```text
apps/host-next/lib/capabilities/
  audit.ts
  ai.ts
  files.ts
  jobs.ts
  events.ts
  services.ts
  commercial.ts
  security.ts
  index.ts
```

保留：

```ts
createHostCapabilityProviders(...)
```

作为薄聚合函数。

### 不要把 standard capability 都改成 system module

把 commerce、files、AI/RAG、notifications 全部重打包为 system module，第一阶段没有必要，反而会增加迁移成本和调试复杂度。

第一阶段只做：

1. 标准能力代码拆文件。
2. Host Kernel 与 Standard Capabilities 在文档和类型上分层。
3. 新增 trusted module provided capabilities。

### 权限命名需要小修，不要大拆

建议优先修：

| 当前权限 | 问题 | 建议 |
| --- | --- | --- |
| `CacheAccess` | 已从旧 `CacheRevalidate` 语义收口；当前守护 get/set/delete/remember，仍是粗粒度访问权限。 | 后续只有出现真实读写分离需求时再拆 `CacheRead` / `CacheWrite`。 |
| `ServicesInvoke` | 当前可调用服务，必须和 `serviceRequirements` 绑定更紧。 | doctor/source scan 要检查调用名称是否已声明。 |
| `ConnectorsManage` | 已 reserved。 | 保持 reserved，管理动作走 admin resource。 |
| `RuntimeManage` | system-only。 | 不给普通 trusted extension 示例使用。 |

不要一次性重命名所有权限。权限是 LLM 和开发者最容易照抄的接口，改太多会造成新噪音。

## 实施阶段

### 阶段 0：修正文档语言

先统一表述：

```text
Module 是唯一扩展单元。
module.ts 声明意图。
catalog/install policy 授予信任。
Host Kernel 最小化。
Standard Capabilities 可替换但不是核心。
```

### 阶段 1：新增最小合同字段

修改 `src/module-sdk/types.ts`：

- `ModuleKind = 'product' | 'host-extension'`
- `ModuleProvidesDefinition`
- `ModuleUsesDefinition`
- `ModuleProvidedCapabilityDefinition`
- `ModuleProvidedAdminResourceDefinition`

不新增：

- `trust` 字段到 `module.ts`
- `system` module kind 到公开合同
- `serviceProviders`
- `routePolicies`

### 阶段 2：扩展 catalog 信任状态

修改 catalog state：

- `trust?: 'product' | 'trusted' | 'system'`
- `allowedProvides?: readonly string[]`

运行时只挂载：

- enabled 模块
- trust 允许的模块
- allowedProvides 允许的 extension point

### 阶段 3：改造 `ctx.extensions`

从裸对象改为 API：

```ts
ctx.extensions.get<T>('executor')
ctx.extensions.require<T>('executor')
ctx.extensions.list()
```

保留 descriptor permission guard。

### 阶段 4：可信模块提供 capability

复用：

- `CapabilityDescriptor`
- `CapabilityDescriptorRegistry`
- `mountCapabilityDescriptors`

新增：

- module scan 收集 `provides.capabilities`
- module map 输出 descriptor metadata
- host runtime 根据 catalog trust 构建 extension registry

### 阶段 5：admin resource 协议

已落地：

- `provides.adminResources`
- admin resource registry
- `/api/admin/resources/*` 路由安全
- operation-level permission/risk/audit/confirmation
- `Permission.AdminResourcesRead` / `Permission.AdminResourcesWrite` 窄权限

后续 UI 对接：

- Refine data provider 对接

这一阶段和 Refine + AntD 后台重构对齐，但不要把 UI 框架耦合进 runtime 合同。

### 阶段 6：宿主能力装配拆文件

已落地第一步：

- `apps/host-next/lib/capabilities/background.ts`
- `apps/host-next/lib/capabilities/services.ts`
- `apps/host-next/lib/capability-providers.ts` 保留为薄聚合装配入口。

后续如继续拆分，可再把 AI/RAG、files、commercial 分离。不要在同一轮里混入行为变化。

## doctor 和测试要求

### validator / doctor

必须新增：

| 规则 | 级别 |
| --- | --- |
| product 模块声明 `provides` | error |
| host-extension 模块未被 catalog trust 授权却尝试挂载 | error/runtime block |
| `provides.capabilities.*` key 与核心 `ctx.*` 冲突 | error |
| capability provider path 缺失 | error |
| capability permissions 未出现在模块顶层 permissions | error |
| `ctx.extensions.require('x')` 未声明 `uses.capabilities: ['x']` | error |
| admin resource operation 缺少 permission | error |
| admin resource dangerous operation 缺少 confirmation | error |
| admin resource mutation 缺少 auditEvent | error |
| 普通 trusted extension 请求 `SystemOnlyPermissions` | error，除非 catalog system allowlist |

### 测试

需要覆盖：

- product module 正常运行。
- product module 声明 `provides` 失败。
- host-extension module 未授权时不挂载 capability。
- host-extension module 授权后 capability 可被消费。
- `ctx.extensions.require` 缺失 capability 报标准平台错误。
- capability key 与核心能力冲突失败。
- admin resource dangerous action 没有 confirmation 失败。
- `Permission.RuntimeManage` 不能被普通 trusted extension 请求运行时使用。

## 不做事项

第一版不做：

- `definePlugin`
- `defineProvider`
- `defineExtension`
- 远程动态安装代码
- runtime hot reload extension
- 复杂依赖求解器
- 版本协商协议
- 把现有所有标准能力重包成 system module
- 让模块自证 trusted
- 自动把 extension capability 晋升为顶层 ctx capability

## PloyKit 优先事项

先不要围绕任何单一产品做设计。第一阶段应该用几个小而通用的验证模块把 PloyKit 框架本身做稳。

建议准备三个验证模块：

```text
modules/image-tools
  kind: product
  验证普通产品模块如何声明 uses.capabilities 并消费 executor

modules/worker-executor-local
  kind: host-extension
  验证可信模块如何提供 executor capability 和 worker admin resource

modules/admin-resource-smoke
  kind: host-extension
  验证 adminResources 的 operation-level permission/risk/audit/confirmation
```

宿主 catalog 授权示例：

```json
{
  "moduleId": "worker-executor-local",
  "status": "enabled",
  "trust": "trusted",
  "allowedProvides": [
    "capabilities.executor",
    "adminResources.workers"
  ]
}
```

PloyKit 第一阶段应该优先完成：

- `module.ts` 最小字段：`kind`、`uses`、`provides`。
- catalog trust / allowedProvides。
- `ctx.extensions.get/require/list`。
- trusted module capability 挂载。
- admin resource registry 和 operation-level guard。
- `capability-providers.ts` 拆分。
- doctor 和 runtime tests。

第一阶段不要做：

- 复杂业务平台验证。
- 远程动态安装。
- 把所有标准能力改造成 system module。
- 复杂 provider 市场。
- 为某个产品特例开宿主口子。

## 最终建议

采用这个方向：

```text
一个公开模型：Module。
module.ts 声明意图，不声明可信。
catalog/install policy 授予可信。
Host Kernel 保持最小：身份、租户、权限、合同、路由、Data v2、审计、限流。
Standard Capabilities 保持 first-class ctx.*，但 provider-backed。
领域能力由 trusted host-extension module 挂到 ctx.extensions。
admin resources 作为可信模块提供的后台操作资源，必须 operation-level guard。
```

这是比原设计更小、更稳、更符合当前代码基础的方案。它允许开源用户自助扩展宿主，但不会把普通模块变成无限制宿主代码。
