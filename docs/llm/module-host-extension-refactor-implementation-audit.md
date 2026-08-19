# PloyKit 宿主扩展重构实现审计

> 日期：2026-06-28  
> 范围：当前工作区中与 `docs/llm/module-host-extension-refactor-design.md` 对应的实现变更  
> 目标：结合真实代码审计这批更改是否符合“宿主最小核心 + 模块按协议扩展宿主”的方向，并识别冗余、过度设计和后续必须修正的风险点。  
> 修复状态：M1、M2、M3、M4、M5 已在本轮实现中修复。

## 1. 总体结论

这批实现整体方向是对的：它没有把某个业务场景硬塞进宿主，也没有把所有未来能力提前做成宿主内置功能，而是把“模块扩展宿主”的能力收敛为两个可审计协议：

- `provides.capabilities`：可信模块向 `ctx.extensions` 提供运行时能力。
- `provides.adminResources`：可信模块向宿主后台提供可执行的管理资源操作。

宿主核心仍然主要负责模块加载、合同校验、catalog 信任、session/权限、运行时上下文、API 安全注册和审计落点。这符合“开源框架给通用协议，不让每个模块开发者都找框架作者提炼能力”的目标。

本轮未发现阻断级问题。审计时发现的 3 个优先问题已修复：

1. `uses.capabilities` 已从 doctor 静态检查扩展为 runtime 挂载过滤。
2. 模块合同中的 `ctxKey` 已移除，`provides.capabilities` key 就是 `ctx.extensions` key。
3. admin resource 列表 API 已改为 public DTO，不再返回 handler 路径。

如果按“不考虑兼容性和旧数据”的前提继续，这些问题都可以用相对小的改动修掉，不需要推翻当前设计。

## 2. 审计对象

主要审计的变更面：

- SDK 合同与校验：
  - `src/module-sdk/types.ts`
  - `src/module-sdk/validator.ts`
  - `src/module-sdk/context.ts`
  - `src/module-sdk/permissions.ts`
  - `src/module-sdk/testing.ts`
- 运行时与宿主：
  - `src/lib/module-runtime/host/create-module-host.ts`
  - `src/lib/module-runtime/host/trusted-module-capabilities.ts`
  - `src/lib/module-runtime/admin/admin-resources.ts`
  - `src/lib/module-runtime/context/create-module-context.ts`
  - `src/lib/module-kernel/capability-registry.ts`
- catalog 与 store：
  - `src/lib/module-runtime/catalog/*`
  - `src/lib/module-runtime/stores/*catalog*`
  - `migrations/runtime/0001_runtime_stores.sql`
- module map / doctor：
  - `scripts/generate-module-map.mjs`
  - `scripts/lib/module-doctor-capability-rules.mjs`
  - `scripts/ploykit-module.mjs`
- Host Next API 与能力拆分：
  - `apps/host-next/lib/admin-resource-route.ts`
  - `apps/host-next/app/api/admin/resources/*`
  - `apps/host-next/lib/admin-route-registry.ts`
  - `apps/host-next/lib/capability-providers.ts`
  - `apps/host-next/lib/capabilities/*`
- 测试：
  - `tests/host-runtime.test.ts`
  - `tests/admin-operations.test.ts`
  - `tests/module-contract.test.ts`
  - `tests/module-doctor-cli.test.ts`
  - `tests/module-map-cli.test.ts`
  - `tests/web-shell-api-routes.test.ts`
  - `tests/web-shell-security.test.ts`

## 3. 与重构文档的符合度

| 设计目标 | 实现状态 | 审计判断 |
| --- | --- | --- |
| 只有一个公开模块身份，模块通过协议扩展宿主 | 已实现 `kind?: 'product' | 'host-extension'` | 合理，没有引入多套身份体系 |
| product 模块不能直接提供宿主扩展 | `validator` 对 `kind === 'product' && provides` 报错 | 符合设计 |
| host-extension 也必须经过 catalog 信任 | runtime 只挂载 `trust: trusted/system` 且 enabled 的模块 | 符合设计 |
| 扩展能力必须经过 allowlist | `allowedProvides` 使用 `capabilities.xxx` / `adminResources.xxx` 精准放行 | 符合设计 |
| system-only 权限不能被普通 trusted 模块拿到 | capability 和 admin resource 都检查 `SystemOnlyPermissions` | 符合设计 |
| `ctx.extensions` 从裸对象变成显式 API | 已有 `get` / `require` / `list` | 符合设计 |
| admin resource 走宿主后台 API 和权限网关 | 已接入 `admin-route-registry` 与 `requireApiSession` | 符合设计 |
| module map 支持 provider / admin handler 自动生成 | `generate-module-map.mjs` 已扫描 `capabilities` 和 `admin` | 符合设计 |
| 宿主能力装配拆分 | `background.ts`、`services.ts` 已拆出 | 初步符合，但 `services.ts` 仍偏大，可暂不继续细拆 |

总体看，设计文档中的阶段 1 到阶段 6 都已有落点。当前实现不是“只写文档没落地”，而是已经进入可继续打磨的实现阶段。

## 4. 关键设计边界审计

### 4.1 SDK 合同

`src/module-sdk/types.ts` 新增了：

- `ModuleKind`
- `ModuleUsesDefinition`
- `ModuleProvidesDefinition`
- `ModuleProvidedCapabilityDefinition`
- `ModuleProvidedAdminResourceDefinition`

这是合适的，因为扩展能力必须从 `module.ts` 开始声明，否则 module map、doctor、catalog 和 runtime 都无法形成一致闭环。

`src/module-sdk/validator.ts` 也覆盖了关键约束：

- `kind` 只能是 `product` 或 `host-extension`。
- `product` 模块不能声明 `provides`。
- capability key 不能占用核心 `ModuleContext` key。
- provider / handler 必须是模块本地路径。
- capability / admin resource 使用的权限必须在模块顶层 `permissions` 中声明。
- 非 read admin operation 必须声明 `auditEvent`。
- dangerous admin operation 必须声明 `confirmation`。

审计判断：这部分实现稳，且没有明显过度设计。

### 4.2 Catalog 信任模型

catalog 增加：

- `trust?: 'product' | 'trusted' | 'system'`
- `allowedProvides?: readonly string[]`

运行时通过 `resolveCatalogModuleState` 获取状态，并在 `trusted-module-capabilities.ts` 与 `admin-resources.ts` 中判断：

- 模块必须 enabled。
- 模块必须是 `host-extension`。
- catalog trust 必须是 `trusted` 或 `system`。
- `allowedProvides` 必须精确包含要挂载的扩展项。

审计判断：这是目前最适合的信任边界。它避免了“模块只要声明就能扩宿主”的危险，也避免了把所有能力提前放进宿主核心。

建议保持这种模式，不要再引入“开发者身份”“平台身份”“插件身份”等额外概念。当前 `kind + catalog trust + allowedProvides` 已经足够表达最小闭环。

### 4.3 `ctx.extensions`

`src/lib/module-runtime/context/create-module-context.ts` 把 `extensions` 包装成：

- `get(name)`
- `require(name)`
- `list()`

这比裸对象更适合开放给模块开发者，也方便 doctor 和运行时错误收敛。

runtime 挂载能力时，`create-module-host.ts` 会把当前 consumer contract 的 `uses.capabilities` 传给 `mountCapabilityDescriptors`，未声明的 extension 不会进入 `ctx.extensions`。

doctor 也能扫描：

- `ctx.extensions.require("xxx")`
- `ctx.extensions.get("xxx")`

并要求模块声明 `uses.capabilities`。因此现在是 doctor + runtime 双层边界。

审计判断：doctor 做得对，但如果这是开源框架的安全边界，运行时也应该做声明过滤。

## 5. 风险项

### M1：运行时未强制 `uses.capabilities`

严重程度：中  
建议优先级：高  
状态：已修复

证据：

- `scripts/lib/module-doctor-capability-rules.mjs` 会检查 `ctx.extensions.require/get` 是否声明了 `uses.capabilities`。
- `src/lib/module-kernel/capability-registry.ts` 的 `mountCapabilityDescriptors` 已支持 `allowedNames`。
- `src/lib/module-runtime/host/create-module-host.ts` 创建上下文时按当前 consumer contract 的 `definition.uses?.capabilities` 过滤。

影响：

- 正常开发流程跑 doctor 时会被拦住。
- 但如果某个宿主运行时跳过 doctor，或者未来支持动态加载第三方包，模块仍可能在未声明 `uses.capabilities` 的情况下访问已挂载扩展。
- 对开源框架来说，安全边界不应只依赖构建期工具。

已完成修正：

1. `mountCapabilityDescriptors` 增加 `allowedNames`。
2. `createContextFactory` 从当前模块 contract 读取 `definition.uses?.capabilities`。
3. 未声明的 extension 不挂载，`ctx.extensions.require` 返回 `MODULE_EXTENSION_REQUIRED`。
4. 增加测试：模块未声明 `uses.capabilities` 时，即使 provider 已被 trusted/catalog allow，也不能在 runtime 访问。

### M2：`ctxKey` 与 capability 名称允许不一致，增加概念复杂度

严重程度：中  
建议优先级：高  
状态：已修复

证据：

- `ModuleProvidedCapabilityDefinition` 已不再暴露 `ctxKey`。
- catalog allowlist 使用 `capabilities.${name}`。
- runtime 对模块提供的 capability 使用 `name` 作为内部 `descriptor.ctxKey`。
- doctor 检查的是代码里的 `ctx.extensions.require("xxx")` 字符串，并和 `uses.capabilities` 对比。

影响：

已完成修正：

- 模块合同去掉 `ctxKey`。
- capability key 同时用于 catalog allowlist、`uses.capabilities`、doctor 和 `ctx.extensions.require`。
- 宿主内部 `CapabilityDescriptor.ctxKey` 保留给内置 descriptor 使用，但模块作者不再接触这个字段。

### M3：admin resource 列表 API 返回了内部 handler 路径

严重程度：低到中  
建议优先级：中  
状态：已修复

证据：

- `src/lib/module-runtime/admin/admin-resources.ts` 的 `ModuleAdminResourceOperationEntry` 继承 `ModuleProvidedAdminResourceOperationDefinition`，因此包含 `handler`。
- `apps/host-next/lib/admin-resource-route.ts` 的 `handleAdminResourcesGet` 已改为返回 public DTO。

影响：

- 当前 API 只要求 admin session，短期可接受。
- 但 admin 控制台前端通常不需要知道模块内部 handler 路径。
- 如果未来有细分后台角色或只读运营角色，返回 handler 会暴露不必要的实现细节。

已完成修正：

API 响应已单独定义 DTO，只返回：

- `id`
- `moduleId`
- `name`
- `label`
- `operations.operationName`
- `operations.permission`
- `operations.risk`
- `operations.auditEvent`
- `operations.confirmation` 是否需要，以及确认字段提示

不再返回 `handler`。

### M4：危险 admin operation 的失败尝试没有单独审计

严重程度：低  
建议优先级：中  
状态：已修复

证据：

- `executeModuleAdminResourceOperation` 在权限失败、确认失败时会记录 `admin.resource.denied`。
- 成功 mutation 仍记录原 operation audit event。

影响：

- API 网关层仍有访问记录和 route 安全控制。
- 但对 dangerous 操作来说，确认失败、权限失败本身也有审计价值。

已完成修正：

`executeModuleAdminResourceOperation` 会捕获拒绝原因并记录最小审计事件：

- `admin.resource.denied`
- `resourceId`
- `operationName`
- `risk`
- `reason`
- `actorId`

这不需要复杂化权限模型，只是补齐运维追踪。

### M5：设计文档状态仍是“设计草案”

严重程度：低  
建议优先级：低  
状态：已修复

证据：

- `docs/llm/module-host-extension-refactor-design.md` 顶部已更新为 `状态：实现中，核心协议已部分落地`。
- 但代码中阶段 1 到阶段 6 已有大量实现。

影响：

- 后续读文档的人可能误判当前状态。

后续建议继续在阶段表中细化已完成、待修正、后续阶段。

## 6. 宿主核心是否仍然最小

审计判断：基本保持了最小核心。

应该留在宿主核心的能力：

- 模块合同加载与校验。
- module map 生成和 loader 解析。
- catalog 状态、信任与 allowlist。
- session、scope、权限守卫。
- `ModuleContext` 创建。
- API 路由安全注册。
- runtime store 与 audit 基础设施。

这批变更确实主要改在这些“协议和边界”位置，没有把具体业务塞进宿主。

适合作为扩展宿主能力的部分：

- 运行时 capability provider。
- 后台 admin resource。
- 模块自带管理操作。
- 特定领域服务连接、执行器、运维动作。

不建议继续放进宿主核心的部分：

- 具体业务模型。
- 具体后台页面。
- 具体外部服务调用细节。
- 某个 SaaS 产品独有的账本、任务、应用、插件市场业务。

当前 `apps/host-next/lib/capability-providers.ts` 已经从大文件拆出 `background.ts` 和 `services.ts`。这一步合理。`services.ts` 仍然较大，但职责还是“服务连接与服务调用”，暂时不需要为了行数继续拆成更多抽象层。后续只有当服务连接、OpenAPI、凭据管理、调用审计各自继续变复杂时，再按职责拆。

## 7. 是否存在过度设计

整体没有明显过度设计，尤其是没有引入多套身份系统，这是好的。

审计时唯一有过度苗头的是 `ctxKey`。该字段已从模块合同移除，避免 capability 的名字出现三种语义：

- provider 名称
- runtime ctx key
- consumer uses 声明

在开源框架里，这类灵活性如果没有强需求，通常会变成文档成本和 LLM 误用来源。建议尽快收敛。

admin resource 协议本身不算过度，因为它解决的是“可信模块如何扩展后台管理能力”的真实问题，而且已有权限、确认和审计约束。不过它的 API 返回 DTO 应该更克制。

## 8. 测试覆盖审计

已有测试覆盖比较到位：

- `tests/host-runtime.test.ts`
  - 覆盖 trusted module capability 挂载。
  - 覆盖未 trusted/catalog allow 时不能挂载。
  - 覆盖 `ctx.extensions.require` 缺失时报错。
- `tests/admin-operations.test.ts`
  - 覆盖 admin resource 只有 trusted + allowedProvides 时可见。
  - 覆盖 system-only 权限阻断。
  - 覆盖 dangerous confirmation。
  - 覆盖 mutation audit。
- `tests/module-doctor-cli.test.ts`
  - 覆盖 `ctx.extensions.require` 必须声明 `uses.capabilities`。
  - 覆盖动态 extension 名称禁止。
- `tests/module-map-cli.test.ts`
  - 覆盖 capability provider 和 admin handler 被写入 module map。
- `tests/web-shell-api-routes.test.ts`
  - 覆盖 admin resource API 的 route id、admin session、input 和 confirmation 透传。
- `tests/web-shell-security.test.ts`
  - 覆盖 admin resource route 的安全目录和 rate limit。

已补充或调整的测试：

1. runtime 层未声明 `uses.capabilities` 时不可访问 extension。
2. 模块合同不再支持 `ctxKey`，并校验 capability key 不能与核心 ctx key 冲突。
3. admin resources GET API 不返回 `handler`。
4. dangerous admin operation 确认失败时记录 denied audit。

## 9. 建议修正顺序

第一优先级：

1. 收敛 capability 命名模型：去掉 `ctxKey` 或强制 `ctxKey === name`。已完成。
2. runtime 按 `uses.capabilities` 过滤 `ctx.extensions`。已完成。

第二优先级：

3. admin resource list API 改为 DTO，不返回 handler。已完成。
4. 更新设计文档状态，标注已落地与待修正项。已完成。

第三优先级：

5. dangerous admin operation 失败尝试审计。已完成。
6. 根据后续复杂度再拆 `services.ts`，暂时不要为了拆而拆。

## 10. 最终判断

这批变更符合“模块可以根据协议扩展宿主，甚至模块本身就是宿主扩展”的方向，也没有让宿主提前背上所有未来能力。

最适合继续推进的路线是：

- 保持一个模块体系。
- 保持宿主核心只管协议、信任、权限、运行时和审计。
- 让可信 host-extension 模块通过 `provides` 扩展能力。
- 把命名模型和 runtime guard 再收紧一层。

M1、M2、M3、M4、M5 修完后，这套设计更适合开源框架：既能让模块开发者自己扩宿主，又不会让宿主核心失控变胖。
