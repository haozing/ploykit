# PloyKit 核心与插件能力清理决策

> 日期：2026-08-19  
> 状态：Clean-slate final  
> 适用产品：AI 工具网站、数字商品商城、CMS、模块化 SaaS

## 1. 最终判断

PloyKit 的正确定位是：

> React/Next.js 产品宿主 + SaaS 共同基础设施 + 商业化权威 + 领域插件。

宿主解决身份、Scope、权限、数据、商业事实和运行边界。插件解决 AI 工具、CMS、数字商城中的数据模型、页面和业务流程。

本文件是最终清理目标。实现时直接采用下面的公共契约，不保留旧字段、旧权限、旧 DSL、旧路径或运行时旁路。

当前 SDK、runtime 和生成文档仍包含旧公共表面；本文件不是当前实现状态报告，而是一次性替换后的唯一目标。清理完成前不得继续向旧表面添加功能。

## 2. 清理审计结论

现有策略文档存在五个阻断问题：

1. 旧稿对未实现能力没有给出唯一去留结论，无法判断某项能力最终是否存在。
2. 没有逐项处理当前 34 个 `ModuleDefinition` 字段和 37 个 `ModuleContext` 字段。
3. 把 `provides/uses/kind` 这套宿主扩展模型继续暴露给普通插件，插件作者仍然需要理解 Provider 和 catalog 授权。
4. 把未挂载的 `config`、`secrets`、`rateLimit`、`cache` 留在 SDK 和运行时中，继续制造“合同存在但不能调用”的公共表面。
5. 把商业能力拆成过多顶层对象，AI 工具作者需要同时理解 `usage`、`metering`、`credits`、`billing`、`entitlements`、`commerce`、`redeemCodes` 和 `risk`。

清理原则：能由宿主统一维护的横切事实进入宿主；领域能力进入插件；没有明确目标用户和真实 Provider 的公共能力直接删除。

## 3. 最终分层

### 3.1 Host Kernel

Host Kernel 只保留模块运行所必需的稳定边界：

- 模块注册、加载和契约校验
- 页面、API、Action 的路由入口
- 用户身份、Product、Environment、Workspace Scope
- 权限检查和安全边界
- 基础 Data API 和事务边界
- 请求、响应、错误和关联 ID
- 基础审计
- 宿主页面壳、导航和统一 UI 主题入口

Host Kernel 不实现 AI Provider、支付 Provider、行业连接器或具体领域业务。

### 3.2 正式能力包

能力包是正式产品能力，不是隐藏的实验入口。`data` 属于所有模块都必须经过的 Host Kernel 边界；其余能力包按模块安装。未安装能力包的模块，不能看到对应类型、权限或 `ctx.*`。

| 能力包 | 正式内容 | 适用场景 |
| --- | --- | --- |
| `files` | 上传、签名 URL、发布、归档、文件元数据 | AI 工具、CMS、数字商城 |
| `async` | Jobs、Runs、队列、重试、取消和进度 | 长耗时 AI、批处理 |
| `events` | 事件发布、订阅、Webhook Receipt、Outbox | 外部回调和异步集成 |
| `notifications` | 站内通知和邮件 | 审核、任务完成、账单提醒 |
| `ai` | Provider、文本生成、Embedding、成本保护 | AI 工具 |
| `rag` | 索引、检索、Context Pack | 知识库和语义搜索 |
| `services` | 受控外部服务调用、签名、Secret 代管 | 第三方 API 和业务服务 |
| `commercial` | 用量、套餐、权益、额度、Checkout、支付事实和账本 | AI 工具、数字商城 |

以下能力不再作为正式能力包：通用缓存、模块自管限流、模块自管 Secret、模块自管配置、通用连接器目录、通用资源绑定和模块 API Key 管理。

### 3.3 领域插件

领域插件（当前代码中的 Module）只负责业务：

- 领域数据、Schema、Resource
- 领域页面、API 和 Action
- 领域业务状态机
- 领域管理页面和操作
- 对宿主能力的声明式使用

领域插件不能成为宿主 Provider，也不能改变宿主身份、权限、商业账本和数据隔离规则。

### 3.4 平台维护工具

Admin、Dev Console、发布门禁、浏览器矩阵、Accessibility、SEO、备份恢复、PITR、Chaos、Soak 和 Provider Smoke 全部属于 PloyKit 维护工具，不进入模块公共 SDK。

## 4. `ModuleDefinition` 最终字段

### 4.1 保留字段

这些字段组成最终模块契约：

```text
id
name
version
description
profile
capabilities
permissions
scope
data
pages
apis
actions
resources
navigation
surfaces
assets
i18n
serviceRequirements
jobs
events
webhooks
commercial
```

说明：

- `profile` 必填，只能是 `app`、`ai-tool`、`digital-commerce` 或 `cms`。
- `capabilities` 只声明 Profile 之外额外启用的正式能力包，不接受任意字符串。允许值固定为
  `files | async | events | notifications | ai | rag | services | commercial`。
- `jobs/events/webhooks` 只有启用 `async` 或 `events` 能力包的模块使用。
- `serviceRequirements` 只有启用 `services` 能力包的模块使用。
- `assets` 只描述静态资源、图标、Worker 和 WASM，不承载业务资源。
- `commercial` 只声明 Meter、Entitlement 和收费 Action，不允许定义账本和支付事实。
- 商业声明统一进入 `commercial`，不再使用独立的 `meters` 顶层字段。
- `scope` 只保留 `required` 和 `resource`；删除不执行运行时授权的 `scope.roles`。

`commercial` 的最终声明只包含：

```text
meters          # 本模块产生的计量项
entitlements    # 本模块定义或引用的权益标识
```

页面和 Action 上的 `commercial` 只引用已经声明的 Meter/Entitlement，并声明单次额度消耗；宿主在进入 handler 前执行权益检查、预扣和幂等保护。

### 4.2 直接删除字段

以下字段从 `ModuleDefinition`、runtime contract、module map、validator、Admin evidence、模板、测试和生成文档中全部删除：

| 字段 | 删除原因 |
| --- | --- |
| `kind` | 普通插件不提供宿主扩展；Host Extension 不属于产品模块公共模型 |
| `product` | 产品页面质量和受众信息属于宿主产品清单，不属于运行契约 |
| `parts` | 契约拆分只是组织问题，增加校验和诊断，不增加运行能力 |
| `uses` | 不再让产品插件声明宿主扩展消费关系 |
| `provides` | 删除模块提供 Provider 和 Admin Resource 的路径 |
| `presentation` | 产品品牌和 Host Surface 由宿主 Product Presentation 管理 |
| `theme` | 主题由宿主统一管理，插件不得扩大主题令牌范围 |
| `meters` | 合并到 `commercial`，避免商业能力分散在顶层和路由字段中 |
| `resourceBindings` | 删除通用资源绑定模型，外部服务统一走 `serviceRequirements` |
| `config` | 删除模块配置读取模型；配置属于宿主设置或模块 Data |
| `head` | 页面 metadata 已由 page contract 负责，删除重复入口 |
| `lifecycle` | 删除多阶段生命周期 DSL；安装、迁移、启停由宿主命令和数据迁移负责 |
| `dependencies` | 模块不再声明任意 npm 依赖；共享依赖由宿主根工程管理 |
| `egress` | 出站策略归 `serviceRequirements` 和宿主 HTTP 安全层 |
| `quality` | 质量证据属于模块测试和 CI，不进入运行契约 |

删除后，插件模块契约只描述“这个模块是什么、提供什么页面/数据/动作、需要哪些正式能力”。

## 5. `ModuleContext` 最终表面

### 5.1 Host Kernel 表面

```text
ctx.module
ctx.product
ctx.user
ctx.auth
ctx.scope
ctx.workspace
ctx.request
ctx.response
ctx.data
ctx.audit
ctx.json
```

### 5.2 能力包表面

```text
ctx.files          # files
ctx.jobs           # async
ctx.runs           # async
ctx.events         # events
ctx.webhooks       # events
ctx.notifications  # notifications
ctx.ai             # ai
ctx.rag            # rag
ctx.services       # services
ctx.commercial     # commercial
```

缺少能力包时，模块在安装前校验失败；运行时不生成空对象、不生成 unavailable API、不生成静默旁路。

模块 `ctx` 类型由 `profile + capabilities` 生成。模块 handler 使用 `.ploykit/generated/module-context.ts` 中的类型；没有声明的能力不出现在该模块的 TypeScript Context 中。

### 5.3 直接删除的 `ctx.*`

以下字段、类型、Provider、Guard、权限和测试全部删除：

```text
ctx.config
ctx.secrets
ctx.connectors
ctx.resourceBindings
ctx.http
ctx.artifacts
ctx.usage
ctx.metering
ctx.credits
ctx.billing
ctx.entitlements
ctx.commerce
ctx.redeemCodes
ctx.apiKeys
ctx.rateLimit
ctx.risk
ctx.cache
ctx.extensions
```

处理规则：

- `usage`、`metering`、`credits`、`billing`、`entitlements`、`commerce` 合并为 `ctx.commercial`。
- `artifacts` 合并进 `ctx.files`；生成物使用文件记录和 Data 元数据表达。
- `services` 是唯一的受控外部服务入口；删除裸 `http`、连接器目录、资源绑定和模块 API Key 管理。
- 限流由宿主路由和商业策略强制执行，模块不拥有 `ctx.rateLimit`。
- 风险判断是商业 Provider 的内部步骤，模块不拥有 `ctx.risk`。
- Secret 只在宿主 Provider 内部读取，模块不拥有 `ctx.secrets`。
- `ctx.extensions` 删除；模块不能动态索引未知宿主能力。

## 6. 最终公开权限

模块 SDK 只公开以下 24 个权限：

```text
DataDocumentRead
DataDocumentWrite
DataTableRead
DataTableWrite
DataTransaction
SurfaceOverride
RunsRead
RunsWrite
JobsEnqueue
EventsEmit
FilesRead
FilesWrite
FilesPublish
ServicesInvoke
AiGenerate
AiEmbed
RagRead
RagWrite
AuditWrite
NotificationsRead
NotificationsSend
CommercialRead
CommercialCharge
CommercialCheckout
```

权限只约束运行时操作。导航、普通 Surface、Job 注册、Event 订阅和 Webhook 接收已经由契约声明，不再重复要求一枚权限。

以下权限类别从模块 SDK 全部删除：

- 原始 SQL 和 Schema 管理
- Theme、Head、Script 写入
- Job 注册、Event 订阅、Webhook 接收
- Cache、模块限流、裸 HTTP、Connector、Resource Binding
- 模块 Secret 和模块 Config
- Artifact、API Key 和 Admin Resource
- 分散的 Usage、Metering、Credits、Billing、Entitlement、Commerce、Redeem Code、Risk 权限
- Runtime、Product、Auth、Unsafe 等系统内部权限

系统内部授权使用宿主私有类型，不复用模块 `Permission`。

## 7. 商业能力最终设计

`ctx.commercial` 是宿主权威接口，面向 AI 工具和数字商城提供以下稳定能力：

- 当前主体、套餐和权益查询
- 用量记录和计量授权
- 额度余额、预扣、提交、释放和退款
- Checkout 创建
- 支付结果和订单事实查询
- 幂等键和商业审计

模块可以声明：

- 自己产生的 Meter
- 需要的 Entitlement
- 需要额度的 Action
- Action 的幂等和副作用

模块不能声明或写入：

- 自己的支付 Provider Secret
- 自己的余额表
- 自己的订阅表
- 自己的支付 Webhook 账本
- 自己的退款、税务、风险和结算事实

以下商业对象从模块公共 API 删除：

```text
redeemCodes
risk
tax
invoice
creditNote
settlement
affiliate
```

这些对象只能作为宿主商业实现内部模型，不能出现在模块 `ctx` 或 `ModuleDefinition` 中。

## 8. 领域 Profile

Profile 是 `ModuleDefinition` 的必填字段，只用于选择正式能力包，不新增第二套插件模型。额外能力包通过 `capabilities` 白名单声明。

### `app`

```text
Host Kernel
```

### `ai-tool`

```text
Host Kernel + ai + commercial
+ files（有资产时）
+ async（有长任务时）
+ rag（有知识库时）
```

### `digital-commerce`

```text
Host Kernel + files + commercial
```

插件负责数字商品目录、数字资产、购买后的产品页面和下载流程；宿主负责支付、权益、额度、幂等和商业事实。

### `cms`

```text
Host Kernel + files
+ notifications（有审核时）
+ rag（有语义搜索时）
```

不支持实体商品、库存、物流、仓储和实体售后模型。

## 9. 删除执行清单

这不是迁移方案，而是直接清理顺序。清理后只保留最终契约。

### 9.1 SDK 和契约

- 删除 `ModuleDefinition` 中第 4.2 节列出的字段和相关类型。
- 删除 `ModuleContext` 中第 5.3 节列出的字段和相关类型。
- 增加必填 `profile`、能力包白名单 `capabilities` 和商业声明 `commercial`。
- 按 `profile + capabilities` 生成模块专属 Context 类型。
- 新增 `ctx.commercial`，删除六套分散的商业 API。
- 删除 `Permission` 中对应的配置、Secret、缓存、模块限流、连接器、资源绑定、API Key、风险、Admin Resource、主题写入、脚本写入和系统管理权限。
- 系统内部权限移出模块 SDK，不能被插件声明。

### 9.2 Runtime 和 Provider

- 删除 unavailable capability 工厂和对应 Guard。
- 删除 `trusted-module-capabilities`、模块 `provides` Provider 装载和 `allowedProvides` 产品路径。
- 删除模块 Admin Resource 注册；领域 Admin 操作改用 `auth: 'admin'` 的 Action。
- 删除 artifacts、connectors、resourceBindings、module HTTP、module API Key 的 Provider 入口。
- 合并商业 Provider 的公开适配层为 `commercial`。

### 9.3 模块、模板和文档

- 删除 `executor-extension-smoke` 和所有 Host Extension 示例。
- 删除 app、resource、tool、connector 模板中的被删字段和能力说明。
- 删除 `parts`、`product`、`quality`、`config`、`lifecycle` 的模块示例和测试夹具。
- 删除所有仅合同声明、临时、待实现、旧路径和旁路等表述。
- 生成新的能力清单和契约文档，只输出最终公共表面。

### 9.4 Admin 和脚本

- 保留平台 Admin 页面，但删除模块契约详情中对被删字段的展示。
- 删除模块质量声明和模块专属发布证据入口。
- 保留宿主级 CI、备份、恢复和运行安全检查，但不再由模块契约驱动。

## 10. 最终开发入口

模块作者只需要：

1. 在 `module.ts` 中选择 `app`、`ai-tool`、`digital-commerce` 或 `cms`。
2. 编写页面、Data、API、Action 和领域业务。
3. 按 Profile 使用已经安装的 `ctx.*`。
4. 声明 Meter、Entitlement 和权限。

Profile、能力白名单、Provider、权限、文档和模板必须来自同一份最终配置。能力缺失时在安装和校验阶段直接报错，不在运行时生成空能力。

## 11. 验收标准

- `ModuleDefinition` 不再包含第 4.2 节字段。
- `ModuleDefinition.profile` 必填，`capabilities` 只能选择正式能力包。
- `scope.roles` 不再存在，访问控制只由可执行的 auth、permission 和 commercial guard 负责。
- `ModuleContext` 不再包含第 5.3 节字段。
- 每个模块生成自己的 Context 类型，未声明能力在编译期不可见。
- 模块 SDK 只公开第 6 节的 24 个权限。
- 商业模块只通过 `ctx.commercial` 访问商业事实。
- 普通模块不需要理解 AI、RAG、商业、Webhook、连接器和 Provider 装载。
- AI 工具可以通过宿主完成调用、用量、额度、支付和权益闭环。
- 数字商城可以销售数字商品和数字权益，不引入实体电商模型。
- 插件不能提供宿主 Provider，也不能创建第二套身份、权限或账本。
- 不存在 SDK 类型已公开但运行时没有实现的能力。
- 不存在旧字段解析、旧路径、旧权限或旧 API 旁路。
- 新增领域插件不需要修改 Host Kernel。

## 12. 代码依据与被取代方案

- [PloyKit README](../README.md)
- [`ModuleDefinition`](../src/module-sdk/types.ts)
- [`ModuleContext`](../src/module-sdk/context.ts)
- [能力事实清单](llm/capabilities.generated.md)

以下旧方案与专属审计记录已删除，不再作为架构输入：

- `docs/llm/platform-capability-cleanup-plan.md`
- `docs/llm/platform-capability-cleanup-plan-audit.md`
- `docs/llm/module-host-extension-refactor-design.md`
- `docs/llm/module-host-extension-refactor-audit.md`
- `docs/llm/module-host-extension-refactor-implementation-audit.md`
