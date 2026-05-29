# PloyKit 完整产品模块宿主指南

> 本文说明宿主如何承载完整产品模块，以及模块作者如何声明 Site、Console、Admin 三层产品形态。

## 1. 目标

PloyKit 模块不只是一组 API、action 或 Dashboard 小工具。对于完整产品模块，宿主必须能承载：

- 前台产品页：`routes.site`
- 工作区控制台：`routes.dashboard`
- 平台管理员后台：`routes.admin`
- 模块 API：`routes.api`

模块通过 `module.ts` 声明产品形态，宿主负责路由 shell、导航、质量检查和 Admin 可视化。

## 2. 产品形态声明

完整产品模块应声明 `product`：

```ts
product: {
  kind: 'product',
  requiredShells: ['site', 'dashboard', 'admin'],
  pages: [
    {
      path: '/my-product',
      shell: 'site',
      audience: 'Visitor',
      userQuestion: 'What does this product do?',
      primaryActions: ['Open console'],
    },
  ],
}
```

宿主会使用这份声明做三件事：

- `module:doctor` 检查 required shell、产品页、导航和 route 是否缺失。
- `module:quality` 从 `product.pages` 自动生成 browser/accessibility 目标。
- Admin Modules 页面展示产品形态覆盖情况。

## 3. 路由与宿主 Shell

| route group | 宿主 Shell | 典型用途 |
| --- | --- | --- |
| `routes.site` | Public site shell | 产品页、公开文档、模板页、安全说明 |
| `routes.dashboard` | Workspace dashboard shell | 用户工作台、业务流程、项目内资源 |
| `routes.admin` | Admin shell | 平台运维、租户级治理、证据、安全、服务健康 |
| `routes.api` | Module API gateway | 模块 API，不直接挂宿主 API 文件 |

模块不要直接在 `apps/host-next/app` 下写自己的业务路由。除非是在扩展宿主的通用能力，否则应走模块契约。

## 4. 导航规则

| 位置 | 用途 |
| --- | --- |
| `site.header` | 公开产品入口 |
| `site.footer` | 文档、模板、合规链接 |
| `dashboard.sidebar` | 工作区用户入口 |
| `admin.sidebar` | 平台管理员入口 |

声明了 `routes.admin` 的模块应同时声明 `admin.sidebar`，否则管理员很难发现入口。声明了 `routes.site` 的产品模块通常应声明 `site.header` 或 `site.footer`。

## 5. 模板选择

优先使用：

```bash
npm run module:create -- my-product --template product-app
```

`product-app` 模板包含：

- `product.requiredShells`
- `product.pages`
- `routes.site`
- `routes.dashboard`
- `routes.admin`
- 多位置 navigation
- dashboard surface
- smoke test

## 6. 宿主与模块职责边界

宿主负责：

- 登录、注册、session
- 用户、组织、工作区
- RBAC 和 Admin shell
- Service connection 和 secretRefs
- Files、billing、audit、notifications 的基础能力
- 模块安装、启用、禁用、质量门禁

模块负责：

- 领域对象和工作流
- 产品页面内容
- schema、表格、表单、操作闭环
- 领域 API/action/job/webhook
- 领域诊断和证据

不要把宿主已有的登录、账单、团队、模块管理重新做一遍。也不要把模块领域后台误认为宿主通用 Admin。

## 7. 验收清单

完整产品模块交付前必须确认：

- `product.requiredShells` 与真实 route group 一致。
- 每个 `product.pages` 有 audience、userQuestion、primaryActions。
- required page 有对应 route。
- route shell 有对应 navigation。
- 动态页面提供 `samplePath`。
- browser/accessibility 覆盖来自 `product.pages`。
- Admin Modules 页面能看到产品形态覆盖。
- 页面没有自造全局 shell，使用宿主 site/dashboard/admin shell。
