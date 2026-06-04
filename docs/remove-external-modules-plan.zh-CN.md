# 外部模块能力移除任务开发文档

本文用于指导 PloyKit 完整移除“仓库外源码模块”能力。目标不是削弱模块系统，而是把模块开发重新收敛到仓库内 `modules/<id>/`，避免本地外部路径、个人配置、跨仓库生成物和 host 编译链互相污染。

这里的“外部模块”专指 `module.ts`、页面、loader、action 等 PloyKit module 源码位于 PloyKit 仓库外，例如 `../runlynk/modules/runlynk`。它不同于“外部服务”：RunLynk Core、OpenAPI、Worker、第三方 HTTP 服务仍然可以独立在仓库外，通过 `serviceRequirements` 和 `ctx.services.invoke(...)` 接入。

## 核心结论

建议最终形态：

- PloyKit 只支持仓库内源码模块，模块根目录固定为 `modules/<id>/`。
- RunLynk 的 PloyKit module 若要在 PloyKit 内开发，应迁入 `modules/runlynk/`。
- RunLynk Core 继续作为外部服务存在，OpenAPI、真实状态机、worker contract、live smoke 仍由服务端仓库维护。
- 删除 `trustedModuleRoots`、外部 `moduleSources`、`PLOYKIT_CONFIG` 本地 module source override、外部模块文档和外部模块测试夹具。
- 生成的 `src/lib/module-map.ts` 和 `src/lib/module-map.manifest.json` 永远只反映仓库内模块，不允许出现指向仓库外的 `../runlynk`、绝对路径、`sourceKind: "external"` 或本地 config 名称。`module-map.ts` 从 `src/lib` 相对导入仓库内 `modules/*` 时出现的 `../../modules/*` 属于正常内部路径。

## 为什么要去掉

外部模块当前不是一个轻量挂载点，而是把仓库外源码直接纳入宿主编译输入：

- `scripts/generate-module-map.mjs` 会为外部模块生成跨仓库动态 import。
- `apps/host-next/next.config.mjs` 需要 `externalDir`、扩大 Turbopack root、额外依赖 alias。
- `src/lib/module-map.manifest.json` 会记录外部 source、rootDir、source hash 和 contract digest。
- 外部仓库一改，宿主 map 立刻漂移；重扫又会把本机路径写入 tracked 生成物。
- `module:test`、Next build、TypeScript、React SSR 错误会混在一起，开发者很难区分是模块自身问题、宿主集成问题还是跨仓库依赖解析问题。

收益只在“另一个仓库独立拥有 PloyKit module 源码”时明显。对 RunLynk 这类产品，更干净的边界是：服务端外部，PloyKit 壳内部。

## 当前涉及面清单

移除前先清点以下位置。不要对 `sourceId` 做全局删除，因为 RAG、商业账本、runtime store 中也有业务含义完全不同的 `sourceId`。

必须处理：

- `ploykit.config.json`：当前有 `moduleSources` 和 `trustedModuleRoots`。
- `ploykit.local.config.example.json`：外部模块示例，应删除或改成不含外部 source。
- `.gitignore`：当前忽略 `ploykit.local.config.json` 和 `ploykit.*.local.json`，若删除本地 config 能力，需要同步调整。
- `scripts/lib/module-sources.mjs`：外部路径信任、`PLOYKIT_CONFIG`、`trustedModuleRoots`、`sourceKind` 推断核心。
- `scripts/generate-module-map.mjs`：生成 `sourceId`、`sourceDir`、`sourceKind` 和跨仓库 import。
- `scripts/module-deps.mjs` / `scripts/lib/module-dependencies.mjs`：当前会扫描配置源中的外部模块依赖。
- `scripts/ploykit-module.mjs`：create/dev/check/doctor 通过 configured module sources 发现模块。
- `scripts/module-test.mjs`：通过 configured module sources 按 id 解析模块。
- `scripts/module-bundle.mjs` 与 `src/lib/module-runtime/packaging/module-bundle.ts`：manifest 中输出 source metadata。
- `src/lib/module-runtime/loader/module-map-types.ts`：`sourceKind?: 'workspace' | 'external'`。
- `src/lib/module-runtime/dev-console/*`、`apps/host-next/lib/admin-operations.ts`、admin/dev console UI：展示 module source metadata。
- `apps/host-next/next.config.mjs`：`PLOYKIT_CONFIG`、`trustedModuleRoots`、`externalDir`、Turbopack root 扩大逻辑。
- `apps/host-next/tsconfig.json` 和根 `tsconfig.json`：确认不再为了外部模块 include 仓库外路径。
- `scripts/host-boundary-check.mjs`：需要增加 tracked map/config 的外部路径阻断。
- `tests/module-map-cli.test.ts`：外部模块 fixture 测试需要删除或改为“拒绝外部 source”。
- `tests/developer-experience.test.ts`：host boundary 外部 source literal 测试需要改成更直接的 map/config 污染测试。
- `README.md`、`docs/README.zh-CN.md`、`docs/module-development.zh-CN.md`、`docs/external-module-local-development.zh-CN.md`：删除外部模块推荐流程。
- `skills/ploykit-module-developer/*` 与 `skills/ploykit-module-tester/*`：删除仓库外模块工作流描述。

必须清理的生成污染：

- `src/lib/module-map.ts` 不得包含 `../runlynk`、绝对路径、外部模块 id。
- `src/lib/module-map.manifest.json` 的 `config` 不得是 `ploykit.local.config.json` 或 `.runtime/*external*`。
- manifest 中不得出现 `trustedModuleRoots`、`sourceKind: "external"`、外部 `sourceDir`。

不要误删：

- `ctx.http.fetch`、`Permission.ExternalHttp`、`sideEffect: 'external'`。
- `serviceRequirements`、`ctx.services.invoke(...)`、OpenAPI/service-backed 文档。
- RAG、files、commercial ledger、audit store 中表示业务来源的 `sourceId` 字段。
- `external` permission scope 或 external provider 概念，除非它专指外部源码模块。

## 目标架构

模块发现只允许：

```text
modules/<module-id>/module.ts
```

如果继续保留配置，配置只能表达仓库内模块目录：

```json
{
  "moduleSources": [
    {
      "id": "workspace",
      "path": "modules"
    }
  ]
}
```

更推荐的长期形态是进一步简化为无配置发现：默认扫描 `modules/`。若为了兼容现有脚本保留 `moduleSources`，也必须强制所有路径位于 `projectRoot` 内，并删除 `trustedModuleRoots`。

运行时 module map 条目只保留和仓库内源码相关的信息：

```ts
interface ModuleRuntimeMapEntry {
  rootDir?: string;
  release?: ModuleMapReleaseMetadata;
  module?: ModuleLoader;
  pages?: Record<string, ModuleLoader>;
  // ...
}
```

`sourceKind` 可以直接删除。`sourceId` / `sourceDir` 如果只用于 admin 展示，也建议删除；如果短期保留，则固定为 `workspace` / `modules`，不得再表示外部 source。

## 分阶段任务

### Phase 0：保护现场

目的：开始移除前先确保不会继续把本地外部状态写入 tracked 文件。

任务：

- 清空当前 shell 中的 `PLOYKIT_CONFIG`。
- 不运行带 `ploykit.local.config.json` 的 `modules:scan`、`host:dev`、`host:build`。
- 记录当前 `git status --short`，区分已有用户改动和本任务改动。
- 若 `src/lib/module-map.ts` 或 manifest 当前已包含外部模块，先在任务中明确：后续只用默认仓库内模块重新生成，不手工拼接删除。

验收：

```powershell
Remove-Item Env:PLOYKIT_CONFIG -ErrorAction SilentlyContinue
git status --short
```

### Phase 1：迁移 RunLynk module 到仓库内

目的：先把唯一真实使用场景迁到 `modules/runlynk`，再移除外部挂载能力。

任务：

- 将 RunLynk 的 PloyKit module 源码迁入 `modules/runlynk/`。
- 保留 RunLynk Core 仓库作为外部服务，不复制服务端状态机、数据库、worker runtime。
- module 内的 service client 继续通过 `ctx.services.invoke(...)` 调用 RunLynk Core。
- 更新 RunLynk module README，说明 Core/OpenAPI/live smoke 所在位置和运行前置条件。
- 确认 module 内 import 不依赖 `../runlynk` 仓库路径。

验收：

```powershell
npm run module:doctor -- runlynk
npm run module:test -- runlynk
npm run module:service-contract -- runlynk --openapi <runlynk-core-openapi.yaml>
```

如果暂时不迁入 RunLynk module，则必须从默认 module map 中移除 RunLynk；不能保留外部路径作为过渡状态。

### Phase 2：收紧模块发现

目的：从工具层删除仓库外源码模块入口。

任务：

- 在 `scripts/lib/module-sources.mjs` 中删除 `trustedModuleRoots`、`canonicalPath` 信任根校验和 `inferSourceKind` 的 external 分支。
- 删除或收窄 `PLOYKIT_CONFIG` 对 module source discovery 的影响。推荐删除；若保留，必须只允许 projectRoot 内路径。
- `discoverConfiguredModuleRoots` 只返回 `modules/` 下的模块。
- `discoverModuleRoots(projectRoot, target)` 仍支持按 id 或 `modules/<id>` 路径定位，但拒绝 projectRoot 外路径。
- `resolveModuleRoot` 不再从 manifest 中解析外部 root。
- 报错文案从 “trusted module roots / external source” 改成 “module must live under modules/<id>”。

验收测试：

- `module:create` 仍创建到 `modules/<id>`。
- `module:doctor -- hello` 通过。
- 传入 `../somewhere/modules/foo` 时应失败，并提示迁入 `modules/foo`。

### Phase 3：清理生成器和 manifest

目的：让生成物天然不可能包含外部路径。

任务：

- `scripts/generate-module-map.mjs` 不再生成 `sourceKind: "external"`。
- 如果决定删除 source metadata，则同步删除 `sourceId`、`sourceDir`、`sourceKind` 字段生成。
- 如果短期保留 `sourceId/sourceDir`，固定为 `workspace/modules`，并在类型中不再包含 external。
- `moduleSpecifier` 只接受 projectRoot 内文件；遇到 projectRoot 外文件直接抛错。
- `generateManifest` 删除 `trustedModuleRoots`，不记录 local config 名称。
- `scripts/module-bundle.mjs` 和 `createModuleBundleManifest` 同步删除或固定 source metadata。

必须新增 guard：

- `scripts/host-boundary-check.mjs` 检查 tracked `src/lib/module-map.ts` 和 manifest：
  - 不允许 `../` rootDir。
  - 不允许 Windows/Unix 绝对路径。
  - 不允许 `sourceKind: "external"`。
  - 不允许 `ploykit.local.config`、`.runtime/*external*`。

验收：

```powershell
npm run modules:scan
rg -n "sourceKind.*external|\\.\\./runlynk|[A-Za-z]:/|ploykit\\.local\\.config|external-dev|trustedModuleRoots" src/lib/module-map.ts src/lib/module-map.manifest.json
npm run host:boundary-check
```

上面的 `rg` 应无命中。注意如果正则误伤文案，需要缩小到 map/manifest 字段检查。

### Phase 4：清理 Next 和 TypeScript 外部目录支持

目的：宿主构建链不再为了外部模块扩大边界。

任务：

- 从 `apps/host-next/next.config.mjs` 删除 `PLOYKIT_CONFIG` 读取。
- 删除 `readTrustedModuleRoots`、`commonAncestor` 中外部 root 相关逻辑。
- 删除 `experimental.externalDir: true`，除非 Next 仍因 monorepo app 路径需要它；若必须保留，文档中明确它不是为了外部模块。
- Turbopack root 回到 projectRoot 或 host app 所需最小 root。
- dependency alias 只基于仓库内模块声明，不再扫描外部 source。
- 确认根 `tsconfig.json` 和 `apps/host-next/tsconfig.json` 不 include 仓库外路径。

验收：

```powershell
npm run typecheck
npm run host:build
```

### Phase 5：删除外部模块配置和文档

目的：文档和示例不再诱导开发者使用仓库外源码模块。

任务：

- 删除 `ploykit.local.config.example.json`，或改成不含 module source 的普通本地运行配置。若没有其他用途，建议删除。
- 从 `.gitignore` 删除 `ploykit.local.config.json` / `ploykit.*.local.json`；如果仍有其他 local config 用途，保留但文档说明它不能配置 module source。
- 删除 `docs/external-module-local-development.zh-CN.md`。
- 更新 `README.md`：
  - 删除仓库外 source 示例。
  - 删除 `trustedModuleRoots`。
  - 改为“模块必须位于 `modules/<id>/`”。
- 更新 `docs/README.zh-CN.md` 和 `docs/module-development.zh-CN.md`：
  - 删除“开发仓库外模块”的流程。
  - 增加“服务端可以外部，PloyKit module 源码应在仓库内”的说明。
- 更新 service-backed 文档，明确 RunLynk 这类项目推荐 `modules/runlynk` + 外部 Core。
- 更新 skills 文档，禁止建议外部 source module。

验收：

```powershell
rg -n "外部模块|仓库外模块|trustedModuleRoots|PLOYKIT_CONFIG|ploykit\\.local\\.config|external-dev|external source|external module" README.md docs skills ploykit*.json .gitignore
npm run docs:encoding-check
```

允许保留的命中只能是本文档或历史审计文档中的“移除说明”；普通开发指南不应再推荐外部模块。

### Phase 6：重写测试

目的：测试从“支持外部模块”改成“拒绝外部模块污染”。

任务：

- `tests/module-map-cli.test.ts`
  - 删除 `writeExternalModule*` 接受外部 source 的成功测试。
  - 新增拒绝 `../outside` 或临时目录 module source 的测试。
  - 保留内部 fixture：在临时 workspace 的 `modules/<id>`，或当前仓库测试期间短暂创建并清理的 `modules/<id>` 中验证 id 解析。
- `tests/developer-experience.test.ts`
  - 将 host boundary external source literal 测试改成 tracked map/manifest 污染测试。
- `tests/catalog-runtime.test.ts`、`tests/admin-operations.test.ts`
  - 如果删除 `sourceKind`，同步更新断言。
- dev console / module pages 测试
  - 如果 UI 删除 source metadata，更新 snapshot/断言。
- 新增一个 guard test：
  - 写入含 `rootDir: "../outside/modules/foo"` 的临时 manifest，应被 boundary check 拒绝。

验收：

```powershell
npm run test:module-map
npm run test:developer-experience
npm run test:catalog-runtime
npm run test:admin-operations
```

### Phase 7：最终重扫和全量回归

目的：确认默认仓库完全干净。

任务：

- 清空 `PLOYKIT_CONFIG`。
- 使用默认 `modules/` 重新生成 map。
- 跑默认门禁。
- 检查没有外部路径残留。

验收命令：

```powershell
Remove-Item Env:PLOYKIT_CONFIG -ErrorAction SilentlyContinue
npm run modules:scan
npm run modules:check
npm run typecheck
npm run module:doctor -- all
npm run module:test -- all
npm run docs:encoding-check
npm run host:boundary-check
```

如果改动触及 Next config 或 RunLynk module 已迁入：

```powershell
npm run host:build
npm run module:doctor -- runlynk
npm run module:test -- runlynk
```

最终残留检查：

```powershell
rg -n "\\.\\./runlynk|D:/code2/runlynk|sourceKind.*external|trustedModuleRoots|external-dev|ploykit\\.local\\.config|PLOYKIT_CONFIG" src scripts apps docs README.md package.json ploykit*.json .gitignore tests skills
```

除本文档、历史审计说明或明确的“已移除”说明外，不应有命中。

## 验收标准

功能验收：

- `modules/<id>` 模块创建、doctor、test、map scan 正常。
- service-backed module 仍可通过 `serviceRequirements` 调外部服务。
- RunLynk module 若保留在 PloyKit 中，位于 `modules/runlynk`。
- 默认 clone 不需要相邻仓库、不需要 local config、不需要绝对路径。

发布卫生验收：

- tracked `src/lib/module-map.ts` 和 manifest 只包含仓库内模块。
- `npm run modules:check` 在默认配置下通过。
- `npm run host:boundary-check` 能阻止外部路径进入 tracked host policy 文件和 module map。
- 文档不再把仓库外源码模块作为推荐开发方式。

维护验收：

- 没有把外部源码模块的概念混入 external HTTP、service-backed、provider、RAG source、commercial source。
- 没有新增模块专属 root package scripts。
- 没有在 host runtime、Next config、CSS 或质量脚本里硬编码 RunLynk 外部路径。

## 推荐实施顺序

最稳妥的顺序是：

1. 先迁入或移除 RunLynk 外部 module。
2. 再收紧 module source discovery。
3. 再改生成器和 types。
4. 再清理 Next/TS 外部目录支持。
5. 再删文档和示例。
6. 最后重写测试、重扫 map、跑全量门禁。

不要先删 guard 或文档再重扫 map。这样容易留下“实现已变、生成物仍旧外部污染”的半干净状态。

## 回滚策略

如果移除过程中发现某个产品必须临时外部联调，不要恢复外部源码模块功能。推荐二选一：

- 把该产品 module 临时复制或以子模块方式放入 `modules/<id>/`。
- 只把服务端仓库保持外部，通过 OpenAPI/service connection/live smoke 联调。

如果必须回滚代码，应只回滚本次移除相关文件，不能恢复 `src/lib/module-map.ts` 中的具体外部模块路径。

## 给 RunLynk 的落地建议

RunLynk 最干净的结构是：

```text
ploykit/
  modules/
    runlynk/
      module.ts
      pages/
      loaders/
      actions/
      api/
      components/
      lib/core-client.ts
      tests/

runlynk-core/
  openapi.yaml
  service/
  workers/
  blackbox-tests/
```

PloyKit 侧只负责产品壳、控制台、权限、审计、service policy、mock/fixture/live smoke 入口。Core 侧负责权威业务对象、状态机、lease、retry、quota、idempotency、worker API 和服务端 blackbox 测试。

这样既保留服务端分离的架构收益，又避免外部源码模块把 PloyKit 默认构建链弄脏。
