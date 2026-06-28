# PloyKit 平台能力分层与清理计划

> 日期：2026-06-28  
> 状态：建议稿（已按审计修订）  
> 目标：基于真实代码判断哪些能力应留在最小宿主核心、哪些是标准能力、哪些只是 host-next 产品后台能力、哪些适合迁为 `host-extension` 模块。

## 1. 结论

有必要清理，但不应该把所有非核心能力都删掉，也不应该把所有非核心能力都迁到 `modules/`。

更合适的目标是：

- Host Kernel 保持最小，只负责安全、隔离、合同、入口和调度。
- Standard Capabilities 继续作为 first-class `ctx.*`，但明确它们不是核心，而是 provider-backed 标准能力。
- host-next 自己的后台、设置、运维和演示种子属于产品宿主层，不进入 SDK 核心概念。
- 领域专用能力走 `modules/<id>` + `kind: 'host-extension'` + catalog trust。

第一阶段重点是“清理边界和命名”，不是“大迁移”。

本次修订采用四条原则：

- 宿主核心要小，只保留模块安全运行必须的协议、入口、隔离和调度。
- 文档必须区分“已装配”“合同存在但未装配”“设计候选”，不能把目标状态写成当前可用状态。
- `/api/admin/resources` 保留给当前 host-extension 提供的后台操作资源，未来 Refine CRUD 资源必须换名。
- 不考虑兼容性和旧数据时，可以直接重命名、移动和删减错误抽象，但不为分层本身引入复杂 DSL。

## 0. 执行状态

| 区块 | 状态 | 记录 |
| --- | --- | --- |
| 阶段 1：命名和文档清理 | 已完成 | Refine CRUD 改为 Admin Data Resource 和 `/api/admin/data-resources/*`；`capabilities.generated.md` 增加 core runtime / host-next mounted / SDK contract only 状态；`npm run llm-wiki:check` 通过。 |
| 阶段 2：接线文件继续拆薄 | 已完成 | 已拆出 `background.ts`、`services.ts`、`audit.ts`、`ai-rag.ts`、`files.ts`、`notifications.ts`、`commercial.ts`；`npm run typecheck`、`npm run test:host-runtime`、`npm run test:web-shell`、`npm run modules:check` 通过。 |
| 阶段 3：host-next admin 分区整理 | 已完成核心边界切分 | 原 runtime admin operations 已迁到 `apps/host-next/lib/admin/operations-center.ts`；`src/lib/module-runtime/admin` 只保留 admin resource 协议和 admin runtime introspection；`npm run test:admin-operations`、`npm run typecheck`、`npm run test:host-runtime`、`npm run test:web-shell`、`npm run modules:check` 通过。 |
| 阶段 4：host-extension 试点 | 已完成 | 新增 `modules/executor-extension-smoke`，声明 `kind: 'host-extension'`、`provides.capabilities.executor` 和 `provides.adminResources.executorHealth`；默认 catalog seed 已显式配置 `trust` / `allowedProvides`，并由 `tests/admin-operations.test.ts` 覆盖 seed 到 admin resource 的真实过滤；`npm run module:doctor -- executor-extension-smoke`、`npm run module:test -- executor-extension-smoke --summary`、`npm run test:admin-operations`、`npm run typecheck`、`npm run modules:check` 通过。 |
| 未装配能力状态收口 | 已完成 | `ctx.cache` 权限由旧 revalidate 语义改为 `Permission.CacheAccess` / `cache.access`；`ctx.cache`、`ctx.rateLimit`、`ctx.config`、`ctx.secrets` 本轮不补 provider，统一在 LLM 能力清单中标为 SDK/contract only，等待后续独立 provider RFC。 |

## 2. 当前代码事实

### 2.1 宿主能力装配

当前 host-next 通过 `apps/host-next/lib/create-host.ts` 创建宿主运行时：

```text
createHostRuntime
  -> getHostRuntimeStore
  -> getHostFileStorage
  -> ensureHostCatalogSeeded
  -> createModuleHostForRuntime
  -> createHostCapabilityProviders
  -> createModuleHost
```

`apps/host-next/lib/capability-providers.ts` 负责把标准能力接入 `CreateModuleHostCapabilitiesOptions`：

- `audit`
- `ai`
- `rag`
- `notifications`
- `files`
- `artifacts`
- `connectors`
- `services`
- `resourceBindings`
- `runs`
- `http`
- `jobs`
- `events`
- `webhooks`
- `usage`
- `metering`
- `credits`
- `billing`
- `entitlements`
- `commerce`
- `redeemCodes`
- `risk`
- `apiKeys`

这说明当前非核心能力并没有散落到模块里，而是由宿主统一装配为 provider-backed `ctx.*`。

需要注意：`CreateModuleHostCapabilitiesOptions` 和 `create-module-context` 中还存在 `config`、`secrets`、`rateLimit`、`cache` 的合同、guard 或 unavailable fallback，但 `apps/host-next/lib/capability-providers.ts` 当前没有完整装配这些 provider。它们不能在文档中写成 host-next 已可用能力。

### 2.2 通用能力实现位置

通用 runtime 能力主要在 `src/lib/module-capabilities/`：

```text
ai
artifacts
commercial
events
files
http
jobs
notifications
rag
services
webhooks
```

这层更像“框架标准能力实现库”，不是 Host Kernel。

### 2.3 host-next 产品宿主能力

host-next 有大量产品后台和运维文件：

```text
apps/host-next/lib/admin-*.ts
apps/host-next/lib/auth.ts
apps/host-next/lib/billing-api.ts
apps/host-next/lib/commercial-provider.ts
apps/host-next/lib/files.ts
apps/host-next/lib/identity-operations.ts
apps/host-next/lib/notifications-api.ts
apps/host-next/lib/product-scope.ts
apps/host-next/lib/runtime-store.ts
apps/host-next/lib/security.ts
apps/host-next/lib/worker.ts
```

这些不是模块 SDK 核心，也不应直接当成所有 PloyKit 宿主必须采用的产品逻辑。它们属于当前 Next 宿主实现。

### 2.4 已经开始的好方向

`apps/host-next/lib/capability-providers.ts` 已从大文件拆出：

```text
apps/host-next/lib/capabilities/background.ts
apps/host-next/lib/capabilities/services.ts
```

这说明当前清理方向已经不是“把能力删掉”，而是“把标准能力接线拆薄”。

## 3. 分层标准

### 3.1 Host Kernel

必须留在宿主核心。

判断标准：

- 没有它，模块无法安全运行。
- 它定义模块边界、入口、身份、租户、权限或数据隔离。
- 它不应该被普通模块替换。

当前应归入 Host Kernel：

| 能力 | 代码位置 | 处理方式 |
| --- | --- | --- |
| 模块合同和 SDK 类型 | `src/module-sdk/*` | 留核心 |
| 模块加载和 module map | `src/lib/module-runtime/loader/*` | 留核心 |
| runtime host | `src/lib/module-runtime/host/*` | 留核心 |
| ModuleContext 创建 | `src/lib/module-runtime/context/*` | 留核心 |
| session、scope、权限 guard | `src/lib/module-runtime/security/*`、`src/lib/module-runtime/scope/*` | 留核心 |
| routes/actions/jobs/webhooks 入口注册 | `src/lib/module-runtime/routes/*`、`actions/*`、`queue/*` | 留核心 |
| Data v2 scope enforcement | `src/lib/module-runtime/data/*`、`resources/*` | 留核心 |
| 审计合同 | `ctx.audit` | 合同留核心，host-next 已装配 provider |
| rate limit 合同 | `ctx.rateLimit` | 合同和 guard 可留核心，host-next 暂未装配 module provider |
| catalog trust 和 `allowedProvides` | `src/lib/module-runtime/catalog/*` | 留核心 |
| trusted extension 挂载协议 | `trusted-module-capabilities.ts`、`admin-resources.ts` | 留核心协议 |

清理建议：

- 不要继续往 Host Kernel 里加具体业务 provider。
- 文档中只把这一层称为 core。
- 新能力默认不能进这一层，除非它是模块安全边界的一部分。
- `src/lib/module-runtime/admin` 只能保留 module-runtime 协议、registry、introspection 和跨宿主可复用操作；host-next 后台业务操作、页面 view model、产品运维动作应留在 `apps/host-next/lib/admin` 或未来同名目录下。

### 3.2 Standard Capabilities

不属于最小核心，但适合作为框架标准能力继续保留在 first-class `ctx.*`。

判断标准：

- 多数模块都可能用到。
- 能力合同可以稳定下来。
- 涉及安全、权限、租户、审计或计费边界。
- 宿主可以替换 provider，但模块看到统一 `ctx.*`。

当前应按实现状态归入 Standard Capabilities：

| 能力 | 当前表面 | 当前实现 | 当前状态 | 处理方式 |
| --- | --- | --- | --- | --- |
| 文件 | `ctx.files` | `src/lib/module-capabilities/files` + `apps/host-next/lib/files.ts` | 已装配 | 保留，provider-backed |
| artifacts | `ctx.artifacts` | `src/lib/module-capabilities/artifacts` | 已装配 | 保留 |
| 通知 | `ctx.notifications` | `src/lib/module-capabilities/notifications` | 已装配 | 保留 |
| 外部 HTTP | `ctx.http` | `src/lib/module-capabilities/http` | 已装配 | 保留，强制 egress |
| 服务调用 | `ctx.services` | `src/lib/module-capabilities/services` + `apps/host-next/lib/capabilities/services.ts` | 已装配 | 保留，绑定 `serviceRequirements` |
| connectors | `ctx.connectors` | service connection runtime | 已装配 | 保留，manage 保持受限 |
| resource bindings | `ctx.resourceBindings` | `src/lib/module-runtime/capabilities/resource-bindings.ts` | 已装配 | 保留 |
| runs | `ctx.runs` | `apps/host-next/lib/capabilities/background.ts` | 已装配 | 保留 |
| jobs | `ctx.jobs` | `apps/host-next/lib/capabilities/background.ts` | 已装配 | 保留 |
| events | `ctx.events` | `apps/host-next/lib/capabilities/background.ts` | 已装配 | 保留 |
| webhooks | `ctx.webhooks` | `apps/host-next/lib/capabilities/background.ts` | 已装配 | 保留 |
| AI | `ctx.ai` | `src/lib/module-capabilities/ai` + `apps/host-next/lib/ai-provider.ts` | 已装配 | 保留 |
| RAG | `ctx.rag` | `src/lib/module-capabilities/rag` + `apps/host-next/lib/rag-provider.ts` | 已装配 | 保留 |
| api keys | `ctx.apiKeys` | `apps/host-next/lib/capability-api-keys.ts` | 已装配 | 保留 |
| cache | `ctx.cache` | context fallback 已有，provider 未装配 | 合同存在但未装配 | 要么补 provider，要么从可用能力文档移除 |
| rate limit | `ctx.rateLimit` | guard/fallback 已有，provider 未装配 | 合同存在但未装配 | 不写成 host-next 已可用能力 |
| config | `ctx.config` | runtime 合同/fallback 已有，provider 未装配 | 合同存在但未装配 | 明确待装配 |
| secrets | `ctx.secrets` | runtime 合同/fallback 已有，provider 未装配 | 合同存在但未装配 | 明确待装配 |

清理建议：

- 不要迁成 `modules/`，第一阶段没有收益。
- 继续把 host-next 接线拆薄，让 `createHostCapabilityProviders` 成为聚合函数。
- 文档中明确它们是 Standard Capabilities，不是 Host Kernel。
- 标准能力要有 permission、doctor、测试和 unavailable fallback。
- 合同存在但未装配的能力不能进入“可用能力”清单；要么补齐 provider，要么标为待实现。

### 3.3 Commercial Authority

商业能力不是普通 Standard Capability，也不适合迁成普通模块。它们是平台事实源。

更准确地说，Commercial Authority 是 provider-backed 标准能力中的特殊权威层：实现库可以在 `src/lib/module-capabilities/commercial/*`，但余额、订单、账本、权益和风控事实必须由宿主权威提供，不能被普通模块或 host-extension 替代。

当前表面：

- `ctx.usage`
- `ctx.metering`
- `ctx.credits`
- `ctx.billing`
- `ctx.entitlements`
- `ctx.commerce`
- `ctx.redeemCodes`
- `ctx.risk`

当前由 `apps/host-next/lib/commercial-provider.ts` 和 `src/lib/module-capabilities/commercial/*` 提供。

处理方式：

- 合同可以保留在 `ctx.*`。
- 存储和 provider 可以替换。
- 权威事实必须归宿主。
- 普通模块不能另起账本当真相源。
- payment provider、tax provider、invoice provider 可以作为扩展接入，但只能接入宿主商业合同。

清理建议：

- 不迁到 `modules/`。
- 可以继续拆 `apps/host-next/lib/commercial-provider.ts` 内部职责。
- 保持审计、幂等、ledger、entitlement 的宿主权威。

### 3.4 Host Product Admin

这些是当前 host-next 产品后台，不是模块通用能力。

典型文件：

```text
apps/host-next/lib/admin-*.ts
apps/host-next/lib/admin-route-registry.ts
apps/host-next/lib/admin-resource-route.ts
apps/host-next/app/api/admin/*
```

处理方式：

- 保留在 `apps/host-next`。
- 不进入 `src/module-sdk`。
- 不要求每个 PloyKit 宿主都照搬。
- 后续如果换 Refine + AntD，这一层是主要重构对象。

后台资源命名必须拆开：

| 名称 | 当前/未来用途 | API 路径建议 |
| --- | --- | --- |
| Module Admin Operation Resource | 当前 `provides.adminResources`，由可信 host-extension 提供后台操作资源 | 保留 `/api/admin/resources` 和 `/api/admin/resources/[resourceId]/[operationName]` |
| Admin CRUD/Data Resource | 未来 Refine 后台中的 users、modules、runs、files 等 CRUD 数据资源 | 使用 `/api/admin/data-resources/*` 或 `/api/admin/crud/*` |

清理建议：

- admin route registry 保留，作为 host-next 后台 RBAC/route security 的事实源。
- 当前 `/api/admin/resources` 保留，因为它是 host-extension 接入后台操作面的桥。
- 具体后台页面和具体运维操作不要沉到 SDK。
- 如果某个后台操作是模块特有的，优先迁为 `provides.adminResources`。
- 未来 Refine CRUD resource 不再叫 `admin resource`，建议统一叫 `AdminDataResource` 或 `AdminCrudResource`。

### 3.5 Trusted Extension Candidates

适合放到 `modules/<id>`，声明 `kind: 'host-extension'`。

判断标准：

- 领域专用。
- 不是所有宿主都需要。
- 不应该进入顶层 `ctx.*`。
- 可以通过 catalog trust 和 `allowedProvides` 授权。
- 能以 `ctx.extensions.require('x')` 或 `adminResources` 方式被消费。

适合迁为 host-extension 的例子：

| 能力 | 建议形态 |
| --- | --- |
| worker executor | 例如模块 id `worker-executor`，提供 `capabilities.executor` |
| ffmpeg / media processor | 例如模块 id `media-processor`，提供 `capabilities.mediaProcessor` |
| search indexer | 例如模块 id `search-indexer`，提供 `capabilities.searchIndexer` |
| CRM sync | 例如模块 id `crm-sync`，提供 `capabilities.crmSync` |
| 地图/地理编码 | 例如模块 id `maps-provider`，提供 `capabilities.maps` |
| 特定运维资源 | `provides.adminResources` |
| 第三方业务 SDK adapter | `capabilities.*` + service requirements |

清理建议：

- 新领域能力默认走 host-extension。
- 不给它们新增顶层 `ctx.*`。
- 不给它们直接写入 host-next 内部 service。
- 需要后台管理时用 `provides.adminResources`，不要修改全局后台表。

## 4. 当前文件归类建议

### 4.1 留在 `src/lib/module-runtime`

这些是框架 runtime，不迁：

```text
actions
adapters
catalog
context
contract
data
host
loader
registry
resources
routes
scope
security
stores
surfaces
```

可保持但注意边界：

```text
admin
capabilities
connectors
dev-console
i18n
lifecycle
metering
observability
packaging
queue
release
runs
runtime-checks
ui
```

这些目录里如果出现具体产品业务，应回收到 `apps/host-next` 或迁到模块。

`src/lib/module-runtime/admin` 需要单独二次审计：

- `admin-resources.ts` 是 host-extension 后台操作资源协议，应留在 runtime。
- `admin-runtime.ts` 如果只做 runtime introspection，可以留在 runtime。
- `admin-operations.ts` 如果包含 host-next 后台产品操作，应拆回 `apps/host-next/lib/admin/*`，避免 runtime core 被后台产品能力污染。

### 4.2 留在 `src/lib/module-capabilities`

这些是标准能力实现库，不迁为模块：

```text
ai
artifacts
commercial
events
files
http
jobs
notifications
rag
services
webhooks
```

清理方向：

- 保持 framework-level provider 实现。
- 不读取 host-next 页面状态。
- 不依赖具体 Next route。
- 只依赖 runtime store、provider 配置、contract、session。

### 4.3 留在 `apps/host-next/lib`

这些是 host-next 的产品宿主层：

```text
auth.ts
runtime-store.ts
security.ts
product-scope.ts
default-scope.ts
dev-runtime-seed.ts
host-settings.ts
worker.ts
files.ts
commercial-provider.ts
ai-provider.ts
rag-provider.ts
email-provider.ts
capability-providers.ts
capability-api-keys.ts
admin-*.ts
```

清理方向：

- `capability-providers.ts` 继续拆薄。
- `admin-*.ts` 等 Refine + AntD 重构时再系统整理。
- 不把 host-next 的后台页面逻辑沉到 `src/module-sdk`。
- 不把 demo seed、默认用户、默认 credits 当成框架核心。

### 4.4 可作为 host-extension 试点

优先选不影响商业事实和身份事实的能力试点：

1. `worker executor` 类能力。
2. 某个独立运维后台资源。
3. 某个第三方服务 adapter。
4. 搜索索引或媒体处理。

不建议第一批迁：

- auth/session
- product/workspace scope
- credits/billing/commerce ledger
- runtime store
- Data v2
- files 标准能力
- services 标准能力
- jobs/events/webhooks 标准能力

## 5. 清理路线

### 阶段 1：命名和文档清理（已完成）

目标：

- 所有文档统一使用 Host Kernel / Standard Capabilities / Commercial Authority / Host Product Admin / Trusted Extension。
- 不再把 AI、files、RAG、commerce 叫 core。
- 模块作者文档明确：领域能力走 `host-extension`。
- 能力文档明确区分“已装配”“合同存在但未装配”“设计候选”。
- 统一后台资源术语：`provides.adminResources` 只叫 Module Admin Operation Resource，Refine CRUD 资源叫 Admin Data/CRUD Resource。

建议动作：

- 更新 `docs/llm/module-host-extension-refactor-design.md`。
- 在 `docs/llm/index.md` 或能力文档中增加分层说明。
- 在 `capabilities.generated.md` 附近增加“标准能力不是核心”的说明。
- 把未装配的 `ctx.cache`、`ctx.rateLimit`、`ctx.config`、`ctx.secrets` 从“可用能力”表达中移除，或标为待实现。

### 阶段 2：接线文件继续拆薄（已完成）

目标：

`apps/host-next/lib/capability-providers.ts` 成为薄聚合：

```text
apps/host-next/lib/capabilities/
  audit.ts
  ai-rag.ts
  background.ts
  commercial.ts
  files.ts
  notifications.ts
  services.ts
  security.ts
  index.ts
```

当前已完成：

```text
background.ts
services.ts
audit.ts
ai-rag.ts
files.ts
notifications.ts
commercial.ts
```

已拆分目标：

| 目标文件 | 来源 | 原因 |
| --- | --- | --- |
| `commercial.ts` | `capability-providers.ts` commercial helpers | 商业接线独立，避免聚合函数继续变大 |
| `ai-rag.ts` | `aiForSession`、RAG provider | AI/RAG 共享审计和商业依赖 |
| `files.ts` | files/artifacts 接线 | 文件标准能力相对独立 |
| `notifications.ts` | notification runtime 接线 | 简单独立 |
| `audit.ts` | audit helper | 核心原语接线，适合单独测试 |

保留在 `capability-providers.ts` 的接线：

- `http`：仍是较薄的 egress + audit wrapper，后续可视需要单独拆。
- `resourceBindings`：当前只是一层 runtime store adapter，暂不为目录美观继续拆。
- `apiKeys`：已有独立 `capability-api-keys.ts`，聚合文件只负责注入。

同时要决定四个合同存在但未装配能力的去留：

| 能力 | 建议 |
| --- | --- |
| `ctx.cache` | 已处理：权限命名已从旧 revalidate 语义改为 `CacheAccess` / `cache.access`；provider 本轮不装配，保持 SDK/contract only |
| `ctx.rateLimit` | 已处理：区分 host route rate limiter 和 module-facing `ctx.rateLimit`；本轮不补 provider，不写成可用能力 |
| `ctx.config` | 已处理：本轮不补 provider；后续如开放给模块，必须先明确 scope、写入来源和审计 |
| `ctx.secrets` | 已处理：本轮不补 provider；后续如开放给模块，必须先明确读写权限、脱敏和审计 |

### 阶段 3：host-next admin 分区整理（已完成核心边界切分）

目标：

为 Refine + AntD 后台重构做准备。

建议目录：

```text
apps/host-next/lib/admin/
  routes.ts
  rbac.ts
  resources.ts
  operations/
  queries/
  presenters/
```

已完成：

- 原 runtime admin operations 已迁到 `apps/host-next/lib/admin/operations-center.ts`。
- `src/lib/module-runtime/admin/index.ts` 不再导出 host-next 产品后台 operations。
- host-next 页面和测试改为从 `@host/lib/admin/operations-center` 引用后台 operations 类型和执行器。

暂不继续移动所有 `admin-*.ts`：

- 当前目标是切掉 runtime core 污染，不是为目录美观制造大规模 churn。
- 后台 Refine + AntD 代码实施时，再把剩余 `admin-*.ts` 目录化到 `apps/host-next/lib/admin/*`。

不考虑兼容和旧数据时，Refine CRUD API 直接采用 `/api/admin/data-resources/*` 或 `/api/admin/crud/*`，不要继续复用 `/api/admin/resources/*`。当前 `/api/admin/resources` 的语义固定为 Module Admin Operation Resource。

### 阶段 4：选一个领域能力迁为 host-extension（已完成）

目标：

用真实模块验证协议，而不是一次性大迁移。

已选试点：

- `modules/executor-extension-smoke`

试点能力：

- `kind: 'host-extension'`
- `provides.capabilities.executor`
- `provides.adminResources.executorHealth`
- capability provider 位于模块内 `capabilities/executor.ts`
- admin operation handler 位于模块内 `admin/executor-health.read.ts`

后续候选：

- worker executor
- search indexer
- media processor
- service-backed adapter

验收条件：

- 模块在 `modules/<id>`。
- `module.ts` 声明 `kind: 'host-extension'`。
- catalog seed 显式配置 `trust` 和 `allowedProvides`。
- consumer 模块声明 `uses.capabilities`。
- doctor、module map、runtime 测试通过。

## 6. 不建议做的事

不建议把所有 `ctx.*` 都迁到 `ctx.extensions`。

原因：

- 会破坏现有模块开发体验。
- 标准能力权限、doctor 和文档成本会大幅上升。
- 文件、HTTP、jobs、events、commercial 这类能力本来就需要宿主统一治理。

不建议把商业账本迁成普通模块。

原因：

- 商业事实必须单一权威。
- 普通模块账本会导致余额、订单、权益、退款、审计不一致。

不建议现在大规模移动 `apps/host-next/lib/admin-*.ts`。

原因：

- 后台 Refine + AntD 重构会触碰这些文件。
- 现在先移动会制造二次 churn。

不建议为了“目录好看”拆 `src/lib/module-runtime`。

原因：

- runtime 是框架核心，误拆会增加循环依赖和测试复杂度。
- 先按职责和引用关系清理，而不是按文件数量清理。

不建议把未装配的 `ctx.*` 写成 host-next 已可用能力。

原因：

- 模块作者会按文档调用，最终得到 `MODULE_CAPABILITY_UNAVAILABLE`。
- 这会把“合同存在”误读成“平台能力已经完成”。
- 对开源框架来说，能力状态比目标愿景更重要。

不考虑兼容和旧数据时，可以直接做这些修正：

- Refine CRUD API 路径直接改为 `/api/admin/data-resources/*` 或 `/api/admin/crud/*`。
- `AdminResourceRegistry` 改名为 `AdminDataResourceRegistry` 或 `AdminCrudResourceRegistry`。
- 当前 host-extension 后台操作资源命名收敛为 `ModuleAdminOperationResource`。
- `ctx.cache` 权限从模糊的 revalidate 语义改成更清晰的 access/read/write 语义。
- `apps/host-next/lib/admin-*.ts` 在后台重构时直接移动到 `apps/host-next/lib/admin/*`，不做兼容 re-export。
- 未装配的 `ctx.cache`、`ctx.rateLimit`、`ctx.config`、`ctx.secrets` 从可用能力文档降级为待装配能力。

## 7. 判断规则

新增能力时按这个顺序判断：

1. 是否是模块安全运行必须？是，进 Host Kernel。
2. 是否多个无关领域都会使用，且需要统一权限/审计/租户治理？是，作为 Standard Capability。
3. 是否涉及余额、权益、订单、账本、风控？是，归 Commercial Authority。
4. 是否只是 host-next 后台或运维体验？是，留 Host Product Admin。
5. 是否领域专用、可插拔、可由 catalog 信任授权？是，做 host-extension module。

默认选择：

```text
先不要进核心。
能做 host-extension 就做 host-extension。
确实通用且治理复杂，再晋升为 Standard Capability。
只有边界基础设施才进入 Host Kernel。
```

记录能力状态时按这个顺序判断：

1. host-next 是否已经在 `createHostCapabilityProviders` 注入 provider？是，标为“已装配”。
2. SDK、guard、fallback 是否存在但 provider 未注入？是，标为“合同存在但未装配”。
3. 只是设计文档里的目标？是，标为“设计候选”。
4. 文档里不能把 2 或 3 写成模块当前可用能力。

## 8. 最终建议

现在不需要“清掉”非核心能力。需要做的是：

1. 清理语言：core 只指 Host Kernel。
2. 清理状态：能力必须标注已装配、合同存在但未装配、设计候选。
3. 清理命名：`/api/admin/resources` 只保留给 Module Admin Operation Resource，Refine CRUD 另走 data/crud 路径。
4. 清理接线：继续拆薄 `capability-providers.ts`，同时决定未装配能力是补 provider 还是降级。
5. 清理归属：host-next 后台能力不要沉到 SDK，`src/lib/module-runtime/admin` 只留协议和 runtime introspection。
6. 清理扩展路径：新领域能力默认走 `modules/<id>` 的 host-extension。
7. 清理商业边界：商业事实继续归宿主权威。

这样既能让 PloyKit 保持开源框架的通用性，也不会把宿主最小核心变成一个装满所有能力的大盒子。
