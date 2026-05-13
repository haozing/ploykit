# 路由与 API 面

应用路由的真实来源始终是 `src/app`。这个文档只是给人看的主要路由族概览。

## 站点与认证

```text
/{lang}
/{lang}/about
/{lang}/contact
/{lang}/pricing
/{lang}/privacy
/{lang}/terms
/{lang}/success
/{lang}/login
/{lang}/register
/{lang}/forgot-password
/{lang}/reset-password
```

## 用户后台

```text
/{lang}/profile
/{lang}/billing
/{lang}/billing/orders
/{lang}/billing/credit-history
/{lang}/notifications
/{lang}/settings/notifications
/{lang}/tasks
/{lang}/tasks/{id}
```

## 管理后台

```text
/{lang}/admin
/{lang}/admin/users
/{lang}/admin/rbac
/{lang}/admin/entitlements
/{lang}/admin/usage
/{lang}/admin/analytics
/{lang}/admin/revenue
/{lang}/admin/audit-logs
/{lang}/admin/files
/{lang}/admin/plugins
/{lang}/admin/plugins/dev
/{lang}/admin/plugin-operations
/{lang}/admin/operations
/{lang}/admin/search
/{lang}/admin/settings
```

## 插件页面

```text
/{lang}/tools/{...slug}
/{lang}/{...publicAlias}
/{lang}/plugins/{pluginId}/{...slug}
/{lang}/admin/plugins/{pluginId}/{...slug}
```

## 代表性 API

```text
/api/auth/[...all]
/api/user/profile
/api/user/subscription
/api/notifications/*
/api/files/*
/api/plugin-files/{id}/{operation}
/api/plugin-runs
/api/plugin-runs/{id}/cancel
/api/plugin-assets/{pluginId}/{...path}
/api/plans
/api/checkout/create
/api/webhooks/stripe
/api/plugins
/api/plugins/{pluginId}/{...slug}
/api/plugins/{pluginId}/webhooks/{...path}
/api/admin/*
```

## 注意

- 插件公开工具页在插件合同里声明，并通过生成的运行时适配器挂载。
- 公开 alias 应作为产品 URL 对待，需要检查是否与一方页面冲突。
- Admin APIs 应继续位于既有 auth、RBAC、CSRF、origin 和 rate-limit 中间件边界之后。
