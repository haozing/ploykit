# Middleware 使用指南

## 📚 概述

本目录包含了应用的中间件系统，提供认证、授权、验证、错误处理等核心功能。

所有中间件都遵循**洋葱模型**（Onion Model），支持组合使用。

---

## 🔑 核心中间件

### 1. 认证中间件（Authentication）

#### `withAuth` - 强制认证

要求用户必须登录才能访问。

```typescript
import { withAuth, withErrorHandling } from '@/lib/middleware';

export const GET = withErrorHandling(
  withAuth(async (request, { auth }) => {
    // auth.userId - 当前用户ID
    // auth.userEmail - 当前用户邮箱
    return NextResponse.json({ userId: auth.userId });
  })
);
```

#### `withOptionalAuth` - 可选认证

允许未登录用户访问，但提供认证信息。

```typescript
export const GET = withOptionalAuth(async (request, { auth }) => {
  if (auth) {
    // 已登录用户
    return NextResponse.json({ user: auth.userId });
  } else {
    // 未登录用户
    return NextResponse.json({ user: null });
  }
});
```

---

### 2. 权限中间件（Authorization）

#### `withAdminGuard` - 管理员保护

限制只有管理员可以访问。

```typescript
import { withAdminGuard, withErrorHandling } from '@/lib/middleware';

export const GET = withAdminGuard(
  withErrorHandling(async (request, { auth }) => {
    // 只有管理员能执行到这里
    return NextResponse.json({ message: 'Admin only' });
  })
);
```

#### `withFeature` - 功能权限检查

基于订阅计划检查用户是否拥有特定功能权限。

```typescript
import { withFeature } from '@/lib/middleware/admin-guard';

export const POST = withFeature('platform.apiAccess', async (request, { auth }) => {
  // 只有订阅计划包含 'platform.apiAccess' 功能的用户可以访问
  return NextResponse.json({ success: true });
});
```

常用功能标识：

- `platform.apiAccess` - API 访问权限
- `platform.webhooksAccess` - Webhook 创建权限
- `platform.premiumTools` - 高级工具访问
- `advancedFeatures` - 高级功能
- `pluginInstall` - 插件安装权限

---

### 3. 验证中间件（Validation）

#### `withBodyValidation` - 请求体验证

使用 Zod schema 验证请求体。

```typescript
import { withBodyValidation } from '@/lib/middleware';
import { z } from 'zod';

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

export const POST = withBodyValidation(createUserSchema, async (request, { validated }) => {
  // validated.body 已经通过验证，类型安全
  const { name, email } = validated.body;
  return NextResponse.json({ name, email });
});
```

#### `withQueryValidation` - 查询参数验证

验证 URL 查询参数。

```typescript
import { withQueryValidation } from '@/lib/middleware';
import { createPaginatedListSchema } from '@/lib/validations/common';

const listSchema = createPaginatedListSchema({
  status: z.enum(['active', 'inactive']).optional(),
});

export const GET = withQueryValidation(listSchema, async (request, { validated }) => {
  // validated.query.page, validated.query.limit, validated.query.status
  return NextResponse.json({ query: validated.query });
});
```

#### `withParamsValidation` - 路径参数验证

验证动态路由参数。

```typescript
import { withParamsValidation } from '@/lib/middleware';
import { commonSchemas } from '@/lib/validations/common';

const paramsSchema = z.object({
  id: commonSchemas.uuid,
});

export const GET = withParamsValidation(paramsSchema, async (request, { validated }) => {
  // validated.params.id 是有效的 UUID
  return NextResponse.json({ id: validated.params.id });
});
```

#### `withValidation` - 组合验证

同时验证 body、query、params。

```typescript
import { withValidation } from '@/lib/middleware';

export const POST = withValidation(
  {
    body: createUserSchema,
    query: listSchema,
    params: paramsSchema,
  },
  async (request, { validated }) => {
    // validated.body, validated.query, validated.params 都已验证
    return NextResponse.json({ success: true });
  }
);
```

---

### 4. 错误处理中间件（Error Handling）

#### `withErrorHandling` - 统一错误处理

自动捕获异常并格式化错误响应。

```typescript
import { withErrorHandling } from '@/lib/middleware';

export const GET = withErrorHandling(async (request, context) => {
  // 任何抛出的错误都会被自动处理
  throw new Error('Something went wrong');
  // 自动返回 500 错误响应
});
```

#### `withRetry` - 重试机制

为容易失败的操作添加重试逻辑。

```typescript
import { withRetry } from '@/lib/middleware';

export const POST = withRetry({ maxAttempts: 3, delayMs: 1000 }, async (request, context) => {
  // 失败后会自动重试最多 3 次
  return await unstableExternalAPI();
});
```

---

## 🔄 中间件组合模式

推荐的中间件组合顺序（从外到内）：

```typescript
export const POST = withErrorHandling(
  // 1. 最外层：错误处理
  withAdminGuard(
    // 2. 权限检查
    withValidation(
      // 3. 输入验证
      {
        body: createRoleSchema,
        query: paginationSchema,
      },
      async (request, { auth, validated }) => {
        // 4. 核心业务逻辑
        const role = await createRole(validated.body, auth.userId);
        return NextResponse.json({ role }, { status: 201 });
      }
    )
  )
);
```

**组合顺序原则**：

1. **错误处理** - 最外层，捕获所有内层错误
2. **认证/授权** - 尽早检查权限，避免无效请求浪费资源
3. **输入验证** - 确保数据合法后再执行业务逻辑
4. **业务逻辑** - 核心处理

---

## 🛠️ 工具函数

### `getOperatorUserId` - 获取操作者用户ID

在已认证的上下文中快速获取用户ID。

```typescript
import { withAuth, getOperatorUserId } from '@/lib/middleware';

export const POST = withAuth(async (request, context) => {
  const userId = getOperatorUserId(context);
  // 使用 userId
});
```

### `getOperatorEmail` - 获取操作者邮箱

获取当前操作用户的邮箱。

```typescript
import { withAuth, getOperatorEmail } from '@/lib/middleware';

export const POST = withAuth(async (request, context) => {
  const email = getOperatorEmail(context);
  // 使用 email
});
```

---

## 📦 常用 Schema

### `commonSchemas` - 通用验证模式

```typescript
import { commonSchemas } from '@/lib/validations/common';

// UUID 验证
commonSchemas.uuid;

// 邮箱验证
commonSchemas.email;

// URL 验证
commonSchemas.url;

// 状态枚举
commonSchemas.status; // 'active' | 'suspended' | 'deleted' | 'cancelled'

// Slug 验证（小写字母、数字、连字符）
commonSchemas.slug;

// 分页验证
commonSchemas.pagination; // { page: number, limit: number }

// 搜索验证
commonSchemas.search; // { search?: string }

// 日期范围验证
commonSchemas.dateRange; // { startDate?: Date, endDate?: Date }
```

### `createPaginatedListSchema` - 创建分页列表 Schema

```typescript
import { createPaginatedListSchema } from '@/lib/validations/common';

const listUsersSchema = createPaginatedListSchema({
  status: z.enum(['active', 'inactive']).optional(),
  role: z.string().optional(),
});

// 自动包含 page, limit, search 字段
```

---

## 🔮 待集成功能

以下功能已实现但暂未在业务代码中集成使用：

### `withUsageTracking` - 使用追踪

自动跟踪 API 调用次数，用于配额管理。

**状态**：已实现，待集成到需要计费的 API 端点。

### `withRateLimit` - 速率限制

基于用户和计划限制 API 调用频率。

**状态**：已实现（内存存储），计划迁移到 Redis 后启用。

### Entitlement Guards - 权益检查函数

这些是**辅助函数**（不是中间件），用于在业务逻辑中检查用户权益和配额。
当检查失败时会抛出相应的错误。

| 函数                               | 用途              | 抛出的错误                  |
| ---------------------------------- | ----------------- | --------------------------- |
| `canInstallPlugin(userId)`         | 检查插件安装权限  | `EntitlementError`          |
| `canUseStorage(userId, mb)`        | 检查存储配额      | `StorageLimitExceededError` |
| `canMakeApiCall(userId)`           | 检查 API 调用配额 | `RateLimitExceededError`    |
| `requireFeature(userId, feature)`  | 要求特定功能权限  | `FeatureNotAvailableError`  |
| `requireActiveEntitlement(userId)` | 要求活跃订阅      | `SubscriptionInactiveError` |

**使用示例**：

```typescript
import { canInstallPlugin, requireFeature } from '@/lib/middleware';

export const POST = withAuth(
  withErrorHandling(async (request, { auth }) => {
    // 在业务逻辑中检查权益
    await canInstallPlugin(auth.userId);
    await requireFeature(auth.userId, 'platform.pluginInstall');

    // 权益检查通过，执行安装
    const result = await installPlugin(pluginId);
    return NextResponse.json({ success: true, result });
  })
);
```

**状态**：已实现，待在相关业务逻辑中集成。

---

## 🎯 最佳实践

### 1. 始终使用 `withErrorHandling`

除非有特殊原因，否则所有路由都应该使用错误处理中间件。

```typescript
// ✅ 推荐
export const GET = withErrorHandling(handler);

// ❌ 不推荐（错误会导致 500 错误页面）
export const GET = handler;
```

### 2. 认证检查应尽早进行

将 `withAuth` 或 `withAdminGuard` 放在靠外层。

```typescript
// ✅ 推荐
withErrorHandling(
  withAuth(
    withValidation(...)
  )
)

// ❌ 不推荐（先验证再检查权限，浪费资源）
withErrorHandling(
  withValidation(
    withAuth(...)
  )
)
```

### 3. 使用 Zod 的类型推断

充分利用 TypeScript 的类型推断能力。

```typescript
const schema = z.object({
  name: z.string(),
  age: z.number(),
});

export const POST = withBodyValidation(schema, async (request, { validated }) => {
  // validated.body 的类型自动推断为 { name: string; age: number }
  const { name, age } = validated.body;
});
```

### 4. 复用常用的 Schema

将常用的验证逻辑提取到单独的文件中。

```typescript
// lib/validations/user.ts
export const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

// app/api/users/route.ts
import { createUserSchema } from '@/lib/validations/user';
```

---

## 📝 类型说明

### `ApiHandler<TContext>`

标准的 API 处理器类型。

```typescript
type ApiHandler<TContext> = (request: NextRequest, context: TContext) => Promise<Response>;
```

### `AuthenticatedApiHandler<TContext>`

已认证的 API 处理器类型，context 中包含 `auth` 对象。

```typescript
type AuthenticatedApiHandler<TContext> = (
  request: NextRequest,
  context: TContext & { auth: AuthContext }
) => Promise<Response>;
```

### `ValidatedApiHandler<TBody, TQuery, TParams, TContext>`

已验证的 API 处理器类型，context 中包含 `validated` 对象。

```typescript
type ValidatedApiHandler<TBody, TQuery, TParams, TContext> = (
  request: NextRequest,
  context: TContext & { validated: ValidationContext<TBody, TQuery, TParams> }
) => Promise<Response>;
```

---

## 🔗 相关文档

- [Next.js Route Handlers](https://nextjs.org/docs/app/building-your-application/routing/route-handlers)
- [Zod Documentation](https://zod.dev/)
- [Better Auth](https://www.better-auth.com/)

---

## 💡 常见问题

### Q: `withAdminGuard` 和 `withFeature` 有什么区别？

A: 两者检查不同类型的权限：

- `withAdminGuard` - 检查**系统角色**，只有管理员可以访问
- `withFeature` - 检查**订阅计划功能**，基于用户的付费计划决定访问权限

```typescript
// 管理后台 API - 需要管理员角色
export const GET = withAdminGuard(handler);

// 高级功能 API - 需要订阅计划包含该功能
export const POST = withFeature('platform.premiumTools', handler);
```

### Q: 中间件的执行顺序是什么？

A: 从外到内执行，类似洋葱模型：

```
请求 → withErrorHandling (进入)
     → withAuth (进入)
     → withValidation (进入)
     → handler (业务逻辑)
     ← withValidation (返回)
     ← withAuth (返回)
     ← withErrorHandling (返回) → 响应
```

### Q: 如何自定义错误消息？

A: 使用自定义 AppError 类：

```typescript
import { ForbiddenError, ValidationError } from '@/lib/errors';

// 抛出自定义错误
throw new ForbiddenError('You do not have permission', { resource: 'users' });
```

### Q: 速率限制为什么没有启用？

A: 速率限制器已实现但暂未在生产环境启用，等待迁移到 Redis 后再使用。

---

**最后更新**: 2025-01
