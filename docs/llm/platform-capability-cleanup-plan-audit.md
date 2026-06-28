# PloyKit 平台能力分层与清理计划审计

> 日期：2026-06-28  
> 审计对象：`docs/llm/platform-capability-cleanup-plan.md`  
> 关联文档：`docs/llm/module-host-extension-refactor-design.md`、`docs/llm/admin-refine-antd-refactor-design.md`  
> 审计原则：结合真实代码；不考虑兼容性和旧数据；实事求是判断是否过度、是否遗漏、是否符合“宿主最小核心”。

## 1. 总体结论

`platform-capability-cleanup-plan.md` 的主方向是正确的：**不要把所有非核心能力都迁成模块，也不要继续把所有能力都叫 core**。它提出的 Host Kernel / Standard Capabilities / Commercial Authority / Host Product Admin / Trusted Extension 五层模型，基本符合当前代码和刚落地的 host-extension runtime。

但是文档现在有三个需要修正的地方：

1. **把“已实现状态”和“目标状态”混在了一起。**  
   特别是 `ctx.rateLimit`、`ctx.cache`、`ctx.config`、`ctx.secrets` 这些能力在 SDK 和 guard 中存在，但 host-next 当前没有完整 provider 装配。

2. **`/api/admin/resources` 命名和 Refine 后台设计有冲突。**  
   当前真实代码中的 `/api/admin/resources` 是 module-provided admin resources 的 list/execute API，不是 Refine CRUD resource data provider。Refine 文档也使用 `/api/admin/resources/:resource` 表达 host admin CRUD，这会产生语义冲突。

3. **Host Product Admin 和 Host Kernel 的边界还可以更硬。**  
   文档说 host-next admin 不进入 SDK 是对的，但没有进一步指出：如果不考虑兼容性，原 runtime admin operations 这类 host admin 操作也应重新评估，避免把产品后台操作长期放在 runtime core 名义下。该文件后续已迁到 `apps/host-next/lib/admin/operations-center.ts`。

整体判断：文档可用，但应修订后再作为后续代码清理依据。

## 2. 与真实代码一致的部分

### 2.1 Standard Capabilities 不是 Host Kernel

文档把 AI、RAG、files、notifications、http、services、jobs、events、webhooks 等归为 Standard Capabilities，这是正确的。

代码证据：

- `src/lib/module-capabilities/` 下已经有：
  - `ai`
  - `artifacts`
  - `commercial`
  - `events`
  - `files`
  - `http`
  - `jobs`
  - `notifications`
  - `rag`
  - `services`
  - `webhooks`
- `apps/host-next/lib/capability-providers.ts` 通过 `createHostCapabilityProviders(...)` 注入这些能力。
- `src/lib/module-runtime/host/create-module-host.ts` 的 `CreateModuleHostCapabilitiesOptions` 明确把这些能力作为可注入 provider。

结论：这些能力应该继续保留为 provider-backed `ctx.*`，不应迁成普通模块。

### 2.2 host-extension 适合承载领域专用能力

文档建议 worker executor、media processor、search indexer、CRM sync、地图等领域能力走 `modules/<id>` + `kind: 'host-extension'`，这是正确的。

代码证据：

- `src/module-sdk/types.ts` 已支持 `kind`、`uses`、`provides`。
- `src/lib/module-runtime/host/trusted-module-capabilities.ts` 已根据 catalog trust 和 `allowedProvides` 挂载 capabilities。
- `src/lib/module-runtime/admin/admin-resources.ts` 已根据 catalog trust 和 `allowedProvides` 暴露 admin resources。
- `scripts/generate-module-map.mjs` 已扫描 capability provider 和 admin handler。

结论：新领域能力默认不进顶层 `ctx.*`，而走 `ctx.extensions.require(...)`，这个路线成立。

### 2.3 Commercial Authority 不应迁成普通模块

文档把 usage、metering、credits、billing、entitlements、commerce、redeemCodes、risk 归为 Commercial Authority，这是正确的。

代码证据：

- `apps/host-next/lib/capability-providers.ts` 中这些能力都来自 `commercialForSession(hostSession).forModule(contract.id)`。
- `src/lib/module-runtime/security/capability-guard.ts` 对 credits、commerce 等有细粒度权限和 subject guard。
- runtime store 中有 credit ledger、orders、entitlements 等权威记录。

结论：商业事实不能迁成普通模块账本。可以 provider-backed，但权威归宿主。

### 2.4 `capability-providers.ts` 拆薄方向正确

当前已拆出：

- `apps/host-next/lib/capabilities/background.ts`
- `apps/host-next/lib/capabilities/services.ts`

文档建议继续拆 `commercial.ts`、`ai-rag.ts`、`files.ts`、`notifications.ts`、`audit.ts`，方向合理。

结论：这属于可维护性清理，不改变架构边界，适合继续做。

## 3. 需要修正的问题

### P1：文档把未装配能力写得像已可用

严重程度：中  
建议优先级：高

问题：

`platform-capability-cleanup-plan.md` 把 `ctx.rateLimit`、`ctx.cache` 归为 Standard Capability，并把 `ctx.audit`、`ctx.rateLimit` 称为 Host Kernel 合同。这个方向可以成立，但真实代码里 host-next 当前只完整装配了部分能力。

代码事实：

- `src/lib/module-runtime/host/create-module-host.ts` 支持注入：
  - `config`
  - `secrets`
  - `rateLimit`
  - `cache`
- `src/lib/module-runtime/context/create-module-context.ts` 对这些能力都有 unavailable fallback。
- `src/lib/module-runtime/security/capability-guard.ts` 对它们有权限 guard。
- 但 `apps/host-next/lib/capability-providers.ts` 当前没有给 `config`、`secrets`、`rateLimit`、`cache` 装配 provider。

影响：

模块作者看到文档可能以为这些能力在 host-next 中已经可用，但实际调用会走 `MODULE_CAPABILITY_UNAVAILABLE`。

建议修正：

在文档中把能力状态分成三类：

| 状态 | 含义 |
| --- | --- |
| 已装配 | host-next 已注入 provider，可用于真实模块 |
| 合同已存在但未装配 | SDK/guard/fallback 已存在，但 host-next 暂不可用 |
| 设计候选 | 文档建议，代码还未落地 |

具体建议：

- `ctx.audit`：已装配。
- `ctx.rateLimit`：合同和 guard 已有，但 host-next 未作为 module capability 装配；不要写成已可用。
- `ctx.cache`：合同和 guard 已有，但真实 provider 未装配；应标为待实现。
- `ctx.config` / `ctx.secrets`：runtime store 有 config/secrets 能力基础，但 host-next `createHostCapabilityProviders` 未注入；应标为待装配或专门说明。

如果不考虑兼容性和旧数据，建议直接补齐 provider 或从 Standard Capabilities 表里移到“合同已存在但未装配”。

### P2：`/api/admin/resources` 命名与 Refine CRUD 设计冲突

严重程度：中  
建议优先级：高

问题：

当前真实代码中：

- `GET /api/admin/resources`：列出 module-provided admin resources。
- `POST /api/admin/resources/[resourceId]/[operationName]`：执行 module-provided admin resource operation。

但是 `admin-refine-antd-refactor-design.md` 中计划：

- `GET /api/admin/resources/:resource`
- `GET /api/admin/resources/:resource/:id`
- `POST /api/admin/resources/:resource`
- `PATCH /api/admin/resources/:resource/:id`
- `DELETE /api/admin/resources/:resource/:id`

这会把两个不同概念都叫 admin resources：

- host-extension 提供的 operator operation surface。
- Refine CRUD data resource。

影响：

如果继续使用同一路径，后续 API 设计会变得含混，甚至路由冲突。

建议修正：

二选一，推荐第一种：

1. Refine CRUD host resources 改名为 `/api/admin/data-resources/*` 或 `/api/admin/crud/*`。  
   当前 `/api/admin/resources` 保留给 module-provided admin resources。

2. module-provided admin resources 改名为 `/api/admin/module-resources/*` 或 `/api/admin/extension-resources/*`。  
   但这会改动刚落地的 API，收益不如第一种。

文档层应明确两个概念：

| 名称 | 用途 |
| --- | --- |
| Module Admin Resource | host-extension 贡献的后台操作资源 |
| Admin CRUD Resource | Refine 后台中的 users/modules/runs/files 等 CRUD 资源 |

如果不考虑兼容性，建议直接统一命名，避免以后被路径包袱拖住。

### P3：Host Product Admin 和 runtime admin 边界还不够硬

严重程度：中  
建议优先级：中

问题：

文档把 `apps/host-next/lib/admin-*.ts` 归为 Host Product Admin 是对的，但没有审计 `src/lib/module-runtime/admin/*` 中哪些真的是 runtime 协议，哪些其实是 host admin 产品操作。

真实代码：

- `src/lib/module-runtime/admin/admin-resources.ts` 是 host-extension runtime 协议，适合留在 runtime。
- `src/lib/module-runtime/admin/admin-runtime.ts` 如果是 runtime introspection，也可以留。
- 原 runtime admin operations 名字和职责需要重新审计。它可能包含模块启停、outbox、runs 等 host admin 操作，未必都属于 runtime core。该文件后续已迁到 `apps/host-next/lib/admin/operations-center.ts`。

影响：

如果不清理，后续会形成一个灰色区域：只要叫 `admin`，就可以放进 `src/lib/module-runtime`。这会削弱“宿主核心最小”的目标。

建议修正：

文档应增加一条更硬的判断：

```text
src/lib/module-runtime/admin 只能保留 module-runtime 协议、registry、introspection 和 cross-host 可复用操作。
host-next 后台业务操作、页面 view model、产品运维动作应留在 apps/host-next/lib/admin 或未来 apps/host-next/lib/admin/*。
```

如果不考虑兼容性，建议下一步对原 runtime admin operations 做单独审计，决定是否拆回 host-next。该项后续已执行，目标文件为 `apps/host-next/lib/admin/operations-center.ts`。

### P4：Standard Capability 与 Commercial Authority 有轻微重叠

严重程度：低到中  
建议优先级：中

问题：

文档在 `3.2 Standard Capabilities` 中没有列 commercial，但 `2.2` 又把 `commercial` 作为通用能力实现目录，`3.3` 再把商业能力归为 Commercial Authority。这个表达容易让读者误会 commercial 到底算 Standard Capability 还是单独权威层。

真实代码：

- `src/lib/module-capabilities/commercial/*` 是框架级商业能力实现库。
- 但 `ctx.credits`、`ctx.commerce` 等能力的事实源必须是宿主权威。

建议修正：

文档应明确：

```text
Commercial Authority 是 Standard Capability 的特殊子类：
它可以 provider-backed，可以放在 module-capabilities 实现库中，但不能被 host-extension 或普通模块替代事实源。
```

或者把它完全从 Standard Capability 中独立出来，避免重叠。

### P5：Refine admin resource 设计与当前 host-extension adminResources 没有对齐到同一模型

严重程度：中  
建议优先级：中

问题：

`admin-refine-antd-refactor-design.md` 计划未来 `module.ts` 增加：

```ts
admin: {
  resources: { ... }
}
```

但当前已落地的是：

```ts
provides: {
  adminResources: { ... }
}
```

这两个模型的语义不同：

- `provides.adminResources`：可信 host-extension 提供后台操作资源。
- `admin.resources`：文档中偏 declarative CRUD UI/resource schema。

影响：

如果两个都存在，模块作者会困惑：后台资源到底声明在哪？普通 product 模块能不能声明？host-extension 才能声明吗？

建议修正：

文档应明确拆成两类：

1. `provides.adminResources`：只给 `kind: 'host-extension'`，用于扩展宿主后台操作能力。
2. 未来 `admin.crudResources` 或 `resources.*.admin`：给普通 product module 声明其 Data v2 资源的后台 UI 投影。

不要把两个都叫 `admin resources`。

如果不考虑兼容性，建议未来 Refine 文档改名：

- `AdminCrudResource`
- `AdminDataResource`
- `ModuleAdminOperationResource`

这样和当前 runtime 不冲突。

### P6：文档未明确“不考虑兼容和旧数据”下的可删项

严重程度：低  
建议优先级：中

问题：

文档说不建议大迁移，但没有明确哪些东西在不考虑兼容时可以直接删或改。

建议补充：

如果不考虑兼容和旧数据，可以更果断地做：

- 直接重命名 Refine CRUD API 路径，避免 `/api/admin/resources` 冲突。
- 直接把旧 cache revalidate 权限改成 `CacheAccess` 或拆成 `CacheRead` / `CacheWrite`。该项后续已改为 `CacheAccess` / `cache.access`。
- 直接把 host-next admin 文件移动到 `apps/host-next/lib/admin/*`，不做 re-export 兼容层。
- 直接把未装配的 `ctx.cache` 从“可用能力”文档中移除，直到 provider 落地。
- 直接把 `admin-resource` 命名收敛成 `AdminOperationResource`，把 CRUD 资源命名为 `AdminDataResource`。

## 4. 是否过度设计

整体不算过度。

五层模型看起来多，但它解决的是五种真实不同的归属：

- Host Kernel：安全运行基础。
- Standard Capabilities：框架通用能力。
- Commercial Authority：商业事实源。
- Host Product Admin：当前 host-next 产品后台。
- Trusted Extension：领域专用可插拔能力。

真正可能过度的不是分层本身，而是后续如果每层都建立一套复杂目录、registry、doctor 和 DSL。文档目前没有这样做，所以可接受。

需要避免的过度方向：

- 为了分层而移动所有目录。
- 为每个 Standard Capability 都做 system module。
- 为每个 admin 页面都做一套新的 resource DSL。
- 同时保留 `provides.adminResources` 和未来 `admin.resources`，但不区分语义。

## 5. 是否符合“最小最稳核心”

基本符合，但要把 P3 修掉。

当前 Host Kernel 定义是合理的：

- 模块合同
- module map
- runtime host
- ModuleContext
- session/scope/permission guard
- route/action/job/webhook entry
- Data v2 scope enforcement
- catalog trust
- extension mounting protocol

问题在于 `src/lib/module-runtime/admin/*` 这个目录需要再审。里面的 `admin-resources.ts` 是协议，应该留；但如果 `admin-operations.ts` 包含大量 host 后台产品操作，就不应长期留在 runtime core。

结论：

```text
Host Kernel 的定义是对的。
真实代码里 runtime/admin 需要再切一次。
```

## 6. 建议修改原文

建议对 `platform-capability-cleanup-plan.md` 做这些修订：

1. 增加“能力实现状态”列：已装配 / 合同存在未装配 / 设计候选。
2. 把 `ctx.rateLimit`、`ctx.cache`、`ctx.config`、`ctx.secrets` 标为“合同存在但 host-next 未完整装配”。
3. 明确 Commercial Authority 是独立层，不等同于普通 Standard Capability。
4. 增加 `/api/admin/resources` 命名冲突说明。
5. 增加 `src/lib/module-runtime/admin/*` 二次审计要求。
6. 明确 Refine CRUD resource 不应继续叫 `admin resource`，至少文档中要区分：
   - Module Admin Operation Resource
   - Admin CRUD/Data Resource

建议对 `admin-refine-antd-refactor-design.md` 做这些修订：

1. 把 Refine CRUD API 路径从 `/api/admin/resources/*` 改为 `/api/admin/data-resources/*` 或 `/api/admin/crud/*`。
2. 把 `AdminResourceRegistry` 改名为 `AdminCrudResourceRegistry` 或 `AdminDataResourceRegistry`。
3. 保留当前 module-provided admin resource API 的命名，或明确重命名计划。
4. 把未来 `module.ts admin.resources` 改名，避免和 `provides.adminResources` 混淆。

## 7. 后续优先级

第一优先级：

1. 修订两份文档中的 `admin resource` 命名冲突。
2. 在能力分层文档中标注能力实现状态。
3. 明确未装配能力不要写成可用能力。

第二优先级：

4. 单独审计原 runtime admin operations，后续已迁到 `apps/host-next/lib/admin/operations-center.ts`。
5. 决定 `ctx.cache` 权限命名：该项后续已改为 `CacheAccess` / `cache.access`。
6. 决定是否补齐 `ctx.rateLimit` / `ctx.cache` / `ctx.config` / `ctx.secrets` host-next provider。

第三优先级：

7. 继续拆薄 `capability-providers.ts`。
8. 等 Refine 后台开始实施时，再移动 `apps/host-next/lib/admin-*.ts` 到目录化结构。

## 8. 最终判断

`platform-capability-cleanup-plan.md` 可以作为方向文档，但不能直接作为执行清单。它需要先修订“实现状态”和“admin resource 命名冲突”。

如果我们实事求是地按当前代码推进，最合适的路线是：

```text
先修文档命名和状态。
再审 runtime/admin 是否混入产品后台操作。
再补齐或降级未装配的 ctx 能力。
最后再继续拆 capability-providers.ts。
```

这比直接开始搬目录更稳，也更符合“不考虑兼容和旧数据，但不过度开发”的原则。
