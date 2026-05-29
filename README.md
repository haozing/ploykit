# PloyKit

<p align="center">
  <img src="docs/assets/brand/ploykit-logo.png" alt="PloyKit logo" width="760" />
</p>

PloyKit is a module-first, white-label product host for SaaS apps, public tools, and internal operations. The host owns product routing, data, permissions, billing, files, AI/RAG, SEO, background work, and release gates. Product-specific behavior lives in local source modules.

PloyKit modules are trusted local source modules. Runtime guards enforce permissions at the `ctx.*` capability API boundary, but PloyKit is not a Node.js sandbox for untrusted third-party code.

English | [中文](#中文)

## What You Can Build

- SaaS products assembled from local modules.
- Public utility sites backed by module APIs.
- Internal operations tools with admin, audit, files, billing, and jobs.
- White-label product shells where modules can contribute or replace selected surfaces.
- AI/RAG workflows that use host-managed providers and capability guards.

## Repository Layout

- `apps/host-next`: Next.js host application for public pages, dashboard, admin, auth, API routes, and shared UI.
- `src/lib/module-kernel`: small shared kernel for capability descriptors and runtime contracts.
- `src/lib/module-runtime`: module loading, routing, context creation, security guards, data access, and release helpers.
- `src/lib/module-capabilities`: host capability adapters for files, AI/RAG, HTTP egress, commercial flows, events, jobs, webhooks, notifications, and services.
- `src/module-sdk`: APIs used by module authors.
- `modules`: reference modules and demos mounted by the host.
- `templates/modules`: starter templates for new modules.
- `docs`: Chinese guides for module development, contracts, deployment, runtime stores, security, and AI-assisted authoring.
- `scripts` and `tests`: module checks, smoke tests, runtime gates, and release gates.

## Runtime Boundary

- Keep module-owned product code inside `modules/<module-id>/`.
- Host and shared runtime code must not import concrete modules or hard-code module IDs.
- `src/lib/module-map.ts` and `src/lib/module-map.manifest.json` are generated registries, not hand-written host logic.
- Use `npm run host:boundary-check` to catch host/shared imports of concrete modules and module-specific root scripts.
- Use `ctx.*` capabilities from module handlers and declare matching permissions in `module.ts`.

## Included Modules

- `hello`: minimal runtime fixture and contract smoke module.
- `public-tools-demo`: public JSON, CSV, and text tools.
- `cms-demo`: CMS-style CRUD, files, posts, and notes.
- `shop-demo`: catalog, cart, commerce, and billing guard demo.
- `capability-demo`: host capabilities, jobs, events, webhooks, AI/RAG, and public route demo.
- `ai-rag-demo`: AI and RAG workflow demo.
- `white-label-site-demo`: branded site and presentation-layer override demo.

## Requirements

- Node.js `22.x` or newer.
- npm `10.x` or newer.
- Docker, if you want to run the local Postgres service used by `npm run db:up`.

## Quick Start

```bash
npm install
npm run db:up
npm run runtime:stores:migrate
npm run host:dev
```

The Next.js host starts from `apps/host-next`.

## Module Workflow

```bash
npm run module:create -- my-module --template basic
npm run module:doctor -- modules/my-module
npm run module:test -- modules/my-module
npm run modules:check
```

Regenerate the module registry after adding or changing module entry points:

```bash
npm run modules:scan
```

## Validation Before PRs

For typical module-only changes:

```bash
npm run typecheck
npm run modules:check
npm run release:local-gate
npm run catalog:doctor
npm run module:doctor -- modules/<module-id>
npm run module:test -- modules/<module-id>
```

Run host/product release gates when shared host runtime, Web Shell, public/auth/admin pages, or release policy changed:

```bash
npm run host:boundary-check
npm run test:web-shell
npm run release:integration-gate
npm run host:browser-matrix -- --required
npm run host:accessibility-smoke -- --required
```

Maintainer releases use:

```bash
npm run release:maintainer-gate
```

## Documentation

- [Chinese docs index](docs/README.zh-CN.md)
- [Module development](docs/module-development.zh-CN.md)
- [Module contract spec](docs/module-contract-spec.zh-CN.md)
- [AI-assisted module authoring](docs/ai-module-authoring.zh-CN.md)
- [Runtime stores](docs/runtime-stores.zh-CN.md)
- [Security model](docs/security-model.zh-CN.md)
- [Deployment](docs/deployment.zh-CN.md)

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), keep module changes inside their module directory, and run the relevant validation commands before opening a PR.

For vulnerability reports, see [SECURITY.md](SECURITY.md).

## License

Apache-2.0. See [LICENSE](LICENSE).

## 中文

PloyKit 是一个模块优先的白标产品宿主，适合 SaaS 应用、公开工具站和内部运营系统。宿主负责产品路由、数据、权限、计费、文件、AI/RAG、SEO、后台任务和发布门禁；具体产品能力应该放在本地源码模块中。

PloyKit 模块是可信的本地源码模块。运行时会在 `ctx.*` 能力 API 边界执行权限约束，但 PloyKit 不是用来运行不可信第三方 Node.js 代码的沙箱。

## 可以构建什么

- 由本地模块组合出来的 SaaS 产品。
- 由模块 API 驱动的公开工具站。
- 带有 Admin、审计、文件、计费和任务系统的内部运营工具。
- 支持模块贡献或替换指定页面区域的白标产品壳。
- 使用宿主管理的 Provider 和权限护栏运行 AI/RAG 工作流。

## 目录结构

- `apps/host-next`：Next.js 宿主应用，包含公开页面、Dashboard、Admin、认证、API 路由和共享 UI。
- `src/lib/module-kernel`：能力 descriptor 和运行时契约使用的小型共享内核。
- `src/lib/module-runtime`：模块加载、路由、上下文、安全护栏、数据访问和发布辅助能力。
- `src/lib/module-capabilities`：文件、AI/RAG、HTTP 出站、商业化、事件、任务、Webhook、通知和服务等宿主能力适配器。
- `src/module-sdk`：模块作者使用的 SDK。
- `modules`：宿主加载的参考模块和演示模块。
- `templates/modules`：新模块脚手架模板。
- `docs`：模块开发、契约、部署、运行时存储、安全和 AI 辅助开发文档。
- `scripts` 与 `tests`：校验脚本、冒烟测试、运行时门禁和发布门禁。

## 运行时边界

- 模块拥有的产品代码应放在 `modules/<module-id>/`。
- 宿主和共享运行时代码不应导入具体模块，也不应硬编码模块 ID。
- `src/lib/module-map.ts` 和 `src/lib/module-map.manifest.json` 是自动生成的注册表，不是手写宿主逻辑。
- 使用 `npm run host:boundary-check` 检查宿主/共享代码是否引用了具体模块或模块专属根脚本。
- 模块处理器应通过 `ctx.*` 使用宿主能力，并在 `module.ts` 中声明匹配权限。

## 当前模块

- `hello`：最小运行时夹具和契约冒烟模块。
- `public-tools-demo`：公开 JSON、CSV 和文本工具。
- `cms-demo`：类 CMS 的 CRUD、文件、文章和笔记示例。
- `shop-demo`：目录、购物车、商业化和计费护栏示例。
- `capability-demo`：宿主能力、任务、事件、Webhook、AI/RAG 和公开路由示例。
- `ai-rag-demo`：AI 与 RAG 工作流示例。
- `white-label-site-demo`：品牌化站点和展示层替换示例。

## 运行要求

- Node.js `22.x` 或更新版本。
- npm `10.x` 或更新版本。
- 如需本地 Postgres，请安装 Docker 并使用 `npm run db:up` 启动服务。

## 快速开始

```bash
npm install
npm run db:up
npm run runtime:stores:migrate
npm run host:dev
```

Next.js 宿主应用位于 `apps/host-next`。

## 模块开发流程

```bash
npm run module:create -- my-module --template basic
npm run module:doctor -- modules/my-module
npm run module:test -- modules/my-module
npm run modules:check
```

新增或修改模块入口后，重新生成模块注册表：

```bash
npm run modules:scan
```

## 提交前验证

一般模块内改动：

```bash
npm run typecheck
npm run modules:check
npm run release:local-gate
npm run catalog:doctor
npm run module:doctor -- modules/<module-id>
npm run module:test -- modules/<module-id>
```

如果改到了共享宿主运行时、Web Shell、公开/认证/Admin 页面或发布策略，再运行宿主/产品级门禁：

```bash
npm run host:boundary-check
npm run test:web-shell
npm run release:integration-gate
npm run host:browser-matrix -- --required
npm run host:accessibility-smoke -- --required
```

维护者正式发布前运行：

```bash
npm run release:maintainer-gate
```

## 文档入口

- [中文文档索引](docs/README.zh-CN.md)
- [模块开发](docs/module-development.zh-CN.md)
- [module.ts 契约规范](docs/module-contract-spec.zh-CN.md)
- [AI 辅助模块开发](docs/ai-module-authoring.zh-CN.md)
- [运行时存储](docs/runtime-stores.zh-CN.md)
- [安全模型](docs/security-model.zh-CN.md)
- [部署说明](docs/deployment.zh-CN.md)

## 贡献

欢迎贡献。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，将模块改动保持在对应模块目录内，并在提交 PR 前运行相关验证命令。

漏洞报告请查看 [SECURITY.md](SECURITY.md)。

## 许可证

Apache-2.0。见 [LICENSE](LICENSE)。
