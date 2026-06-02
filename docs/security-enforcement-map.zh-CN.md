# PloyKit 安全执行边界图

本文档说明宿主路由、模块运行时和 capability guard 分别负责哪些安全检查。它用于新增 API route、模块 route 或 capability 时做审计对照。

## 1. Host API Route Catalog

文件：`apps/host-next/lib/security.ts`

`HostRouteCatalogEntry` 是宿主 API route 的安全目录。当前 `checkHostRouteSecurity` 会统一执行：

- HTTP method 是否已登记。
- mutation route 的 same-origin Origin/Referer guard。
- route-level rate limit。

注意：目录中的 `auth`、`scope`、`anonymousPolicy`、`commercialPolicy` 字段是审计标签，不是全部由 `checkHostRouteSecurity` 自动执行。对应执行点如下：

- `auth: user/admin`：由 route handler 调用 `requireApiSession`、`requireHostUser`、`requireAdminUser` 或 RBAC helper。
- `scope: product/workspace`：由 product scope/session resolver 和具体业务 API 校验。
- `anonymousPolicy: module-runtime`：由模块 API runtime 执行。
- `commercialPolicy: module-runtime`：由模块 runtime access 和 commercial capability guard 执行。
- `auth: webhook` / `origin: signature`：由 webhook/provider route 的签名校验逻辑执行。

因此新增宿主 API route 时需要同时做两件事：

1. 在 route catalog 中登记 method、origin、rate limit 和审计标签。
2. 在 route handler 中显式调用对应的 auth/scope/business guard。

## 2. Origin 与 CSRF 语义

`csrf: "same-origin"` 在当前目录中表示浏览器 mutation route 需要 same-origin Origin/Referer guard，不等同于 token-based CSRF。生产环境下，使用 `origin: "same-origin"` 的 mutation route 如果缺少 Origin/Referer，会返回 `HOST_ORIGIN_REQUIRED`。

`src/lib/module-runtime/security/csrf.ts` 提供 HMAC token guard，适用于需要 token-based CSRF 的 route。接入 token guard 时应在 route handler 中显式调用，并补对应测试。

## 3. Module API Runtime

文件：`src/lib/module-runtime/adapters/api-dispatcher.ts`

模块 API route 的执行顺序：

1. 匹配模块 route。
2. 校验 machine auth / API key。
3. 校验 HTTP method。
4. 执行 `anonymousPolicy`：
   - `maxUploadBytes`
   - 匿名 high-cost route deny
   - captcha required
   - route-specific anonymous rate limit
5. 执行 `checkModuleRuntimeAccess`：
   - public/auth/admin
   - route permissions
   - commercial requirement
6. 加载 handler。
7. 创建 guarded `ModuleContext`。
8. 执行 handler。

## 4. Capability Guard

文件：`src/lib/module-runtime/security/capability-guard.ts`

Capability guard 负责每次 `ctx.*` 调用的细粒度权限判断：

- 模块 contract 必须声明对应 permission。
- session 必须拥有对应 permission，admin/system session 例外。
- system-only permission 只能由 `session.system === true` 使用。
- 商业 subject-scoped capability 会阻止普通用户操作其他 user/workspace/product subject。
- `ctx.data.sql.query/execute` 需要 `DataSqlRead/DataSqlWrite` 且额外需要 system-only `UnsafeSqlRaw`。

## 5. 新增 Route Checklist

- route 是否在宿主 catalog 或模块 contract 中声明。
- mutation route 是否有 origin guard 和 rate limit。
- 浏览器会话 mutation 是否需要 token-based CSRF。
- route handler 是否显式调用 auth/scope guard。
- public module API 是否声明并通过 runtime 执行 `anonymousPolicy`。
- high-cost、raw SQL、external HTTP、AI/RAG、commercial capability 是否有 deny/allow 测试。
