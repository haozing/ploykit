# PloyKit 模块即宿主扩展设计审计

> 审计对象：`docs/llm/module-host-extension-refactor-design.md`  
> 审计目标：检查逻辑是否通顺、是否符合真实代码、是否不考虑兼容和旧数据、是否过度设计、是否保持宿主最小稳定核心  
> 审计结论：原方向正确，但原版存在“模块自证可信”“字段重复”“第一版过宽”“宿主核心定义偏大”等问题；现已在设计文档中修正为更小、更安全、更贴近当前代码的方案。

## 总体结论

修订后的设计是合理的。

它没有把框架拆成多种开发者身份，而是保留一个公开模型：

```text
Module
```

同时通过宿主侧 catalog / install policy 表达信任，避免普通模块直接拥有宿主扩展能力。

这个方向符合当前代码基础：

- `ModuleDefinition` 已经是模块扩展宿主的合同中心。
- `ModuleContext` 已经是能力注入模型。
- `Permission` 已经区分普通权限、system-only 权限和 reserved runtime 权限。
- `CapabilityDescriptor` / `mountCapabilityDescriptors` 已经提供了扩展能力底座。
- catalog 已经有 module state，可自然承载 trusted/system 授权。

## 主要审计发现

### 发现 1：原设计让模块自证 trusted，不安全

原设计使用：

```ts
trust: {
  level: 'trusted',
}
```

这个字段如果放在 `module.ts` 中，会变成模块自己声明自己可信。对于开源框架，这是不安全的。

可信状态应该来自宿主：

- catalog
- install policy
- system allowlist
- 管理员显式启用

修订后设计改为：

```text
module.ts 只声明 kind 和 provides。
catalog/install policy 授予 trust 和 allowedProvides。
```

判断：已修正。

### 发现 2：`kind + trust` 重复

原设计同时存在：

```ts
kind: 'host-extension'
trust: { level: 'trusted' }
```

这两个字段在模块合同中职责重叠。

更合理的边界是：

```text
kind：模块声明自己的意图。
trust：宿主运行时授予的信任状态。
```

修订后设计只把 `kind` 放入 `module.ts`，把 `trust` 放入 catalog state。

判断：已修正。

### 发现 3：第一版 `provides` 设计过宽

原设计包含：

```ts
provides: {
  capabilities
  serviceProviders
  adminResources
  routePolicies
}
```

这对第一版来说过重。

当前代码已经有：

- `serviceRequirements`
- `ctx.services`
- route registry
- host route security catalog
- admin route registry

因此第一版不应该再引入 `serviceProviders` 和 `routePolicies`，否则会和现有概念交叉。

修订后第一版只保留：

```ts
provides: {
  capabilities?
  adminResources?
}
```

判断：已修正。

### 发现 4：原文把宿主核心定义得偏大

原设计中把 files、AI、RAG、jobs、events、webhooks、商业等都称为 core 或 core contract，容易让“最小宿主核心”失焦。

更合理的划分是：

```text
Host Kernel
  身份、认证、租户、权限、模块合同、路由入口、Data v2、审计、限流

Standard Capabilities
  files、jobs、events、webhooks、AI、RAG、services、notifications 等

Commercial Authority
  usage、metering、credits、billing、entitlements、commerce、risk

Trusted Extension Capabilities
  executor、ffmpeg、maps、crmSync 等领域能力
```

修订后文档已按这个方式拆分。

判断：已修正。

### 发现 5：普通 host-extension 示例不应使用 `Permission.RuntimeManage`

当前代码中 `Permission.RuntimeManage` 属于 `SystemOnlyPermissions`。原示例中 admin resource 使用它，会误导开发者以为 trusted extension 可以直接拿系统权限。

修订后文档明确：

- 不建议普通 trusted extension 使用 `RuntimeManage`。
- 已新增更窄的 `AdminResourcesRead` / `AdminResourcesWrite` 权限。
- `RuntimeManage` 保留给 CLI、system module 或宿主内部。

判断：已修正。

### 发现 6：`ctx.extensions` 裸对象不适合长期使用

当前 `ModuleContext` 是：

```ts
extensions: Readonly<Record<string, unknown>>;
```

这个形态可作为底座，但不适合作为公开长期接口：

- 类型弱。
- 难以 guard。
- 难以 doctor。
- LLM 容易直接索引。
- 缺少 missing extension 的标准错误。

修订后建议：

```ts
ctx.extensions.get<T>('executor')
ctx.extensions.require<T>('executor')
ctx.extensions.list()
```

判断：合理。

### 发现 7：不考虑兼容和旧数据的要求已体现

修订后的设计没有保留旧形态迁移负担，而是直接建议：

- 新增最小合同字段。
- 修改 `ctx.extensions` 公开形态。
- 扩展 catalog state。
- 重构 provider 文件。
- 不为旧 extension 形态做兼容层。

判断：符合要求。

### 发现 8：没有过度追求“万物模块化”

修订后明确不做：

- 把所有 standard capabilities 重包成 system module。
- 动态远程安装代码。
- runtime hot reload extension。
- 复杂依赖求解器。
- 版本协商协议。
- 自动把 extension capability 晋升为顶层 ctx capability。

判断：避免了过度设计。

## 宿主最小核心审计

修订后 Host Kernel 包含：

- module identity
- request/response
- user/auth
- scope/workspace/product
- permission/session guard
- module contract registry
- route/action/job/surface/navigation registry
- Data v2 声明和 scope enforcement
- audit primitive
- rate limit primitive

这个范围合理。

其中需要注意：

- `ctx.audit` 是核心合同，但审计存储实现可以 provider-backed。
- `ctx.rateLimit` 是核心合同，但限流实现可以 provider-backed。
- `jobs` 作为入口注册属于 kernel，但 `ctx.jobs` 队列执行属于 Standard Capability。
- `webhooks` 作为路由入口属于 kernel，但 receipt/signature runtime 属于 Standard Capability。

设计文档已经基本表达了这个区别。

## 仍需后续确认的问题

### 问题 1：是否要新增 host extension 提供权限

如果 trusted extension 要提供 `ctx.extensions.*`，可能需要一个专门权限：

例如新增 host extension 提供权限。

或者更细：

或者进一步拆成 extension capability 提供权限和 admin resource 提供权限。

这能避免滥用 `RuntimeManage`。

建议：实现阶段补充。

### 问题 2：`allowedProvides` 的粒度需要定死

文档建议：

```json
["capabilities.executor", "adminResources.workers"]
```

这个粒度比较合适，但实现时要明确：

- 是否允许 wildcard。
- 是否允许 capability operation 级别授权。
- 是否和 bundle required module 绑定。

建议第一版不支持 wildcard。

### 问题 3：extension capability 的类型如何暴露

`ctx.extensions.require<T>()` 需要开发者自己传泛型。未来可以考虑模块导出类型包，但第一版不需要。

建议第一版保持简单。

### 问题 4：admin resource 权限命名需要实现时确定

文档避免使用 `RuntimeManage`。实现后应使用更窄的 `AdminResourcesRead` / `AdminResourcesWrite` 权限。

当前实现已新增 `AdminResourcesRead` / `AdminResourcesWrite`。暂不再增加 host extension 操作权限，避免第一版权限面变宽。

## 最终审计判断

修订后的文档逻辑通顺，边界清晰，符合真实代码基础，也符合“不考虑兼容和旧数据”的重构前提。

它没有把设计做得过度复杂。相反，它删掉了原版中过早引入的 `serviceProviders`、`routePolicies`、公开 `system` module kind 和模块自证 trust。

宿主核心拆分也更合理：

```text
Host Kernel 最小稳定。
Standard Capabilities first-class 但不算核心。
Commercial Authority 保持宿主事实权威。
Trusted Extension Capabilities 解决开源用户自助扩展宿主的问题。
```

建议后续实现时按文档阶段推进，不要先重包所有现有能力，也不要先做动态安装系统。第一版只需要让可信本地模块能通过 catalog 授权挂载 `ctx.extensions` 和 admin resources。
