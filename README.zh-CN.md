# PloyKit

[English](README.md) | [简体中文](README.zh-CN.md)

PloyKit 是一个基于 Next.js App Router 的可插拔 SaaS 与公开工具站宿主框架。它把产品外壳、管理后台、计费边界、文件存储、审计能力，以及以 `plugin.ts` 为合同入口的本地插件运行时放在同一个工程体系里。

这个项目适合希望持续交付很多小型 SaaS 工具、内部工具或产品插件的团队：每个功能不需要重新发明认证、存储、计费、路由和运维边界。

![PloyKit 社交预览](public/media/social/github-preview.png)

## 核心能力

- 基于 Next.js App Router 的应用，内置 `zh` 与 `en` locale。
- 基于 Better Auth 的邮箱密码认证、可选 OAuth 接入点、密码重置、个人资料 API 与头像 API。
- RBAC、管理后台、用户管理、角色、权限、系统设置、审计日志与分析页面。
- 权益计划、用户订阅、积分、计费记录、Stripe checkout 与 webhook 处理边界。
- 平台文件 API，以及插件文件的签名上传和下载。
- 本地插件运行时：页面、API、webhook、job、event、lifecycle、menu、slot、asset 与 capability 适配器。
- 公开工具页能力：SEO metadata、sitemap、路由 alias、匿名策略、限流、captcha 接入点、缓存策略和 SSRF-aware egress 控制。
- 验证脚本：代码质量、插件合同、数据库迁移、运行时检查、E2E、可访问性、存储、Stripe、可观测性、升级、容量、soak、备份恢复、安全审计、chaos 与交付文档。

## 预览

| 管理后台                                                  | 插件开发控制台                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------ |
| ![管理后台](public/media/screenshots/dashboard-admin.png) | ![插件开发控制台](public/media/screenshots/plugin-dev-console.png) |

| 公开插件工具                                                     | AI 插件工作流                                                     |
| ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| ![公开 JSON 工具](public/media/screenshots/public-json-tool.png) | ![AI 插件工作流](public/media/screenshots/ai-plugin-workflow.png) |

| 插件管理                                                    | 运行时示例                                                            |
| ----------------------------------------------------------- | --------------------------------------------------------------------- |
| ![插件管理](public/media/screenshots/plugin-management.png) | ![插件运行时示例](public/media/screenshots/plugin-runtime-sample.png) |

## 设计理念

PloyKit 遵循一组开发约定。它们不只是代码风格，而是让宿主在插件能力增长时仍然可维护的护栏。

```text
入口少
声明强
边界硬
能力清
错误准
测试稳
```

落到实践里：

- 简单插件只声明一个页面或一个 API；高级插件再按需启用 files、runs、connectors、metering、AI、billing、jobs、events 和 webhooks。
- `plugins/<plugin-id>/plugin.ts` 是元数据、路由、数据集合、资源、权限、meters、生命周期和 egress 的权威声明。
- 插件通过 `ctx` 组合宿主能力，而不是导入宿主内部模块、读取进程密钥或绕过平台策略。
- 插件 UI、API、job、event、webhook、lifecycle hook 和 assets 都有明确入口形态与运行时适配器。
- 生成 map、合同检查、迁移检查、运行时检查、TypeScript、ESLint、Prettier、Vitest 与 Playwright 都是常规门禁。
- 同一套合同、模板和诊断闭环，也让 PloyKit 特别适合 AI 辅助插件开发。

## 技术栈

- Next.js `16.2.6`，App Router，standalone output
- React `19.2.6`
- TypeScript `6.0.3`，ESLint `10.4.0`，Prettier `3.8.3`
- Tailwind CSS `4.3.0`，Radix UI，Lucide React，Recharts `3.8.1`，Sonner
- Better Auth `1.6.11`
- PostgreSQL，Drizzle ORM `0.45.2`，Drizzle Kit `0.31.10`
- next-intl，内置 `zh` 与 `en`
- Vitest，Testing Library，Playwright
- Stripe SDK `22.1.1`
- Zod `4.4.3`

## 仓库结构

```text
.
|-- src/
|   |-- app/                 # Next.js 页面与 route handlers
|   |-- components/          # 共享 UI、布局、后台、认证、文件、插件
|   |-- config/              # 后台菜单与系统配置
|   |-- contexts/            # React contexts
|   |-- hooks/               # SWR 与业务 hooks
|   |-- i18n/                # next-intl locale 配置与请求加载
|   |-- lib/                 # 核心服务、认证、数据库、中间件、运行时
|   `-- plugin-sdk/          # 插件作者 SDK
|-- plugins/                 # 本地插件
|-- templates/plugins/       # 插件模板
|-- skills/                  # 面向插件作者的可选 Codex Skills
|-- scripts/                 # 数据库、插件、运行时、QA、Stripe 脚本
|-- drizzle/migrations/      # Drizzle SQL 迁移
|-- locales/                 # zh/en 文案
|-- tests/e2e/               # Playwright E2E
`-- docs/                    # 详细项目文档
```

## 品牌与多媒体素材

公开素材放在 `public/` 下，面向应用代码的路径集中同步到 `site.config.ts`
里的 `siteConfig.assets`。

- 浏览器图标：`public/favicon.svg`、`public/favicon.ico` 与
  `public/brand/apple-touch-icon.png`。
- 品牌与社交预览：`public/brand/ploykit-logo.svg`、
  `public/brand/ploykit-mark.svg`、`public/brand/og-default.png`、
  `public/media/social/github-preview.png` 与
  `public/media/social/docs-preview.png`。
- 产品截图：`public/media/screenshots/*.png`。
- 演示动图/视频：`public/media/demo/plugin-create-doctor-loop.gif` 与
  `public/media/demo/plugin-create-doctor-loop.mp4`。

刷新生成素材：

```bash
npm run media:generate
```

## 快速开始

前置要求：

- Node.js `>=22 <26`
- npm `>=10`
- PostgreSQL，或使用内置 Docker 本地 PostgreSQL 服务

安装依赖：

```bash
npm install
```

创建本地环境文件：

```bash
cp .env.example .env
```

如果使用内置 Docker 数据库，把这些值写入 `.env`：

```env
DB_PROVIDER=postgres
DATABASE_URL=postgresql://ploykit:ploykit@localhost:55432/ploykit
FILE_STORAGE_ENABLED=true
FILE_STORAGE_DRIVER=local
FILE_STORAGE_LOCAL_ROOT=.data/blobs
```

启动并等待 PostgreSQL：

```bash
npm run db:docker:up
npm run db:docker:wait
```

初始化 schema 和种子数据：

```bash
npm run db:init
```

`db:init` 会运行迁移和 `seed:tool-site`。seed 会创建本地开发用 admin 用户：

```text
email: admin@example.com
password: Admin@123456
```

这些凭据只是本地测试 fixture，不要在部署环境复用。

启动开发服务：

```bash
npm run dev
```

常用本地地址：

- 首页：`http://localhost:3000/zh`
- 登录：`http://localhost:3000/zh/login`
- 管理后台：`http://localhost:3000/zh/admin`
- 公开插件工具页：`http://localhost:3000/zh/tools/json-format`
- 公开 alias 示例：`http://localhost:3000/zh/json`

## 配置

`.env.example` 是通用模板。`.env.docker.example` 记录 `db:docker:*` 脚本使用的本地 Docker 默认值。

重要生产相关变量包括：

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=replace-with-openssl-rand-base64-32
PLUGIN_SECRET_ENCRYPTION_KEY=replace-with-a-stable-32-byte-secret
PLUGIN_FILE_SIGNING_SECRET=replace-with-a-stable-32-byte-secret
DB_PROVIDER=postgres
DATABASE_URL=postgresql://ploykit:ploykit@localhost:55432/ploykit
SUPPORTED_LANGUAGES=en,zh
```

计费、文件存储、密码重置投递、captcha 和外部 provider 设置见环境模板与详细文档。

## 常用命令

```bash
npm run dev               # 启动 Next.js 与插件 map watcher
npm run build             # 构建应用
npm run start             # 启动 standalone 生产服务
npm run verify            # 主要仓库验证门禁
npm run verify:runtime    # 数据库与运行时验证
npm run db:init           # 运行迁移并写入本地种子数据
npm run plugins:scan      # 重新生成插件 map
npm run plugins:check     # 检查插件合同
npm run test:run          # 运行 Vitest
npm run test:human        # 运行浏览器 E2E 流程
```

更完整的脚本目录见 [scripts/README.md](scripts/README.md)。

## 文档

| 主题               | 中文                                                                                         | 英文                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 文档索引           | [docs/README.zh-CN.md](docs/README.zh-CN.md)                                                 | [docs/README.md](docs/README.md)                                                 |
| 项目范围           | [docs/project-scope.zh-CN.md](docs/project-scope.zh-CN.md)                                   | [docs/project-scope.md](docs/project-scope.md)                                   |
| 插件开发           | [docs/plugin-development.zh-CN.md](docs/plugin-development.zh-CN.md)                         | [docs/plugin-development.md](docs/plugin-development.md)                         |
| AI 辅助插件开发    | [docs/ai-assisted-plugin-development.zh-CN.md](docs/ai-assisted-plugin-development.zh-CN.md) | [docs/ai-assisted-plugin-development.md](docs/ai-assisted-plugin-development.md) |
| AI 插件 Quickstart | [docs/ai-plugin-quickstart.zh-CN.md](docs/ai-plugin-quickstart.zh-CN.md)                     | [docs/ai-plugin-quickstart.md](docs/ai-plugin-quickstart.md)                     |
| 插件 Codex Skill   | [docs/codex-skill.zh-CN.md](docs/codex-skill.zh-CN.md)                                       | [docs/codex-skill.md](docs/codex-skill.md)                                       |
| 插件能力           | [docs/plugin-capabilities.zh-CN.md](docs/plugin-capabilities.zh-CN.md)                       | [docs/plugin-capabilities.md](docs/plugin-capabilities.md)                       |
| 宿主页面插槽与覆盖 | [docs/host-page-overrides.zh-CN.md](docs/host-page-overrides.zh-CN.md)                       | [docs/host-page-overrides.md](docs/host-page-overrides.md)                       |
| 插件诊断           | [docs/plugin-diagnostics.zh-CN.md](docs/plugin-diagnostics.zh-CN.md)                         | [docs/plugin-diagnostics.md](docs/plugin-diagnostics.md)                         |
| 数据库与迁移       | [docs/database-and-migrations.zh-CN.md](docs/database-and-migrations.zh-CN.md)               | [docs/database-and-migrations.md](docs/database-and-migrations.md)               |
| 路由与 API 面      | [docs/routes-and-apis.zh-CN.md](docs/routes-and-apis.zh-CN.md)                               | [docs/routes-and-apis.md](docs/routes-and-apis.md)                               |

## 部署

构建：

```bash
npm run build
```

启动 standalone server：

```bash
npm run start
```

构建 Docker 镜像：

```bash
docker build -t ploykit .
```

服务流量进入前先运行数据库迁移：

```bash
npm run db:migrate
```

生产部署需要提供数据库凭据、应用 URL、认证密钥、插件密钥、启用文件存储时的存储配置，以及启用计费时的 Stripe 配置。

## 许可证

PloyKit 基于 [MIT License](LICENSE) 发布。
