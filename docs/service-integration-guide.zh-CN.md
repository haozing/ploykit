# 受控服务接入指南

本文回答一个很实际的问题：当 PloyKit 模块要接入独立服务端时，应该怎么配置、怎么调用、怎么约定请求和错误码，才能既保留安全边界，又不让本地联调变成“缺一个环节就炸”的黑盒。

结论先说清楚：

- 需要这份指南。`serviceRequirements`、service connection、resource binding、secret ref、origin map、loader/action 错误处理必须按同一套规则落地，否则每个服务都会长出自己的接入暗知识。
- 不需要给每个服务在宿主里写特殊逻辑。宿主只提供通用 signed service 能力；RunLynk、支付、AI Core 等服务在模块内做产品语义映射。
- 需要服务端提供稳定的请求约定和 error envelope。没有统一错误结构时，PloyKit 只能猜测，页面会很难给出明确的恢复路径。

## 什么时候用受控服务

普通外部 HTTP 可以走 `ctx.http.fetch(...)`。只要出现下面任意一项，就应该走 `serviceRequirements` + `ctx.services.invoke(...)`：

- 需要 bearer token、HMAC、mTLS、私网地址或运行时 secret。
- 需要把 workspace、tenant、actor、request id 等 claims 由宿主代签传给服务端。
- 需要 egress allowlist、超时、重试、响应大小限制、脱敏和审计。
- 服务端是产品权威状态机，例如 job、worker lease、quota、账本、producer key、webhook delivery。

模块代码不要直接读 `process.env`，不要自己拼 HMAC，不要绕过 service connection 去 `fetch('http://localhost:8080')`。

## 分层职责

### 宿主负责

- 校验 `module.ts` 里的 `serviceRequirements` 和 `resourceBindings`。
- 根据 service connection 解析 `baseUrl`、secret refs、状态、provider 和 egress。
- 注入鉴权 header、签名 header、claims header。
- 执行 timeout、retry、max request/response bytes、redirect policy。
- 记录 provider invocation、audit，并按 redaction 规则脱敏。
- 抛出通用平台错误码，例如 `MODULE_SERVICE_CONNECTION_MISSING`。

### 模块负责

- 在 `module.ts` 声明服务能力和权限。
- 保留一个唯一的 `lib/service-client.ts` 或 adapter，页面、loader、action 只调用语义函数。
- 把宿主平台错误映射成产品错误，例如 `MODULE_SERVICE_TIMEOUT` -> `RUNLYNK_CORE_TIMEOUT`。
- 页面展示产品壳内的错误面板和下一步动作，而不是漏出宿主兜底页。
- mock、fixture、live smoke 都走同一条 `ctx.services.invoke(...)` 调用路径。

### 服务端负责

- 实现 OpenAPI 或等价机器可读产品 API 合同。
- 校验 bearer、签名、timestamp、claims、tenant/project 隔离和幂等。
- 返回稳定 error envelope、request id、状态码和业务错误码。
- 用 blackbox/live tests 证明签名、租户隔离、幂等、quota、lease、retry、one-time secret 等真实行为。

## 标准接入清单

### 1. 写产品 API 合同

服务端至少提供：

- endpoint、method、path/query/body schema。
- 成功响应 schema。
- 错误响应 schema。
- auth scheme。
- request id / correlation id / idempotency 约定。
- 示例响应或 fixtures。

HTTP 产品 API 首选 OpenAPI；事件、worker、stream 或 schema-only 边界可用 AsyncAPI、Protocol Buffers 或 JSON Schema 补充。

### 2. 在模块声明 serviceRequirements

最小形态如下，字段名以实际模块为准：

```ts
serviceRequirements: {
  coreAdmin: {
    required: true,
    provider: 'acme-core',
    kind: 'signed-http',
    connection: {
      baseUrl: 'https://core.acme.example',
      egress: ['https://core.acme.example'],
      timeoutMs: 8000,
      retry: { attempts: 2, backoff: 'exponential', retryOn: [502, 503, 504] },
      maxRequestBytes: 262144,
      maxResponseBytes: 524288,
      redirect: 'manual',
    },
    secrets: {
      bearerToken: { required: true },
      hmacSecret: { required: true },
    },
    claims: {
      requestId: '${ctx.request.id}',
      correlationId: '${ctx.request.correlationId}',
      actorId: '${ctx.auth.actorId}',
      workspaceId: '${ctx.scope.workspaceId}',
      tenantId: '${input.tenantId}',
      moduleId: '${ctx.module.id}',
    },
    operations: {
      'admin.request': {
        input: {
          allow: ['path', 'method', 'query', 'json', 'headers'],
          claimsAllow: ['tenantId'],
        },
        auth: { type: 'bearer', secret: 'bearerToken' },
        signing: {
          type: 'hmac-sha256',
          secret: 'hmacSecret',
          header: 'x-acme-signature',
          timestampHeader: 'x-acme-timestamp',
          claimsHeader: 'x-acme-claims',
          canonical: ['method', 'path', 'timestamp', 'bodySha256', 'claimsSha256'],
        },
        request: {
          body: 'json',
          allowHeaders: ['content-type', 'idempotency-key'],
          denyHeaders: ['authorization', 'cookie', 'x-acme-signature', 'x-acme-timestamp', 'x-acme-claims'],
        },
        response: { body: 'json', maxBytes: 524288 },
        audit: {
          event: 'acme.admin.requested',
          includeClaims: ['requestId', 'workspaceId', 'tenantId'],
        },
        redaction: {
          request: ['headers.authorization', 'headers.x-acme-signature', 'json.secret'],
          response: ['headers.set-cookie', 'json.token', 'json.secret'],
          error: ['body.token', 'body.secret'],
        },
      },
    },
  },
}
```

### 3. 配 service connection

宿主环境需要有 active service connection：

- `service`: 与 `serviceRequirements.<name>` 对齐。
- `provider`: 与声明的 provider 对齐。
- `baseUrl`: 默认指向合同里的生产 origin，本地可通过 origin map 改写。
- `secretRefs`: 指向 bearer token、HMAC secret 或其他密文。
- `status`: 必须 active，不能 disabled、blocked、not ready。

本地联调时推荐保持合同 origin 不变，只用 origin map 改写到本机服务：

```env
PLOYKIT_SERVICE_E2E_ORIGIN_MAP={"https://core.acme.example":"http://localhost:8080"}
```

这样页面、loader、action、mock、live smoke 都不需要改代码。

### 4. 配 resource binding

service connection 解决“怎么连服务”；resource binding 解决“当前 workspace 对应远端哪个 tenant/project/resource”。

常见字段：

- `remoteTenantId`
- `defaultProjectId`
- `region`
- `plan`
- `linkedAt`

是否 `required` 要看产品流程：

- 首次接入页要能创建或绑定远端资源时，binding 可以不是 required，但页面必须明确显示缺失状态。
- 已进入核心控制台才能使用的资源，binding 应该 required。

### 5. 写唯一 service client

模块内只保留一个直接调用 `ctx.services.invoke(...)` 的文件，例如 `lib/service-client.ts`：

```ts
export async function invokeCoreAdmin<T>(ctx: ModuleContext, request: CoreAdminRequest) {
  try {
    return await ctx.services.invoke<CoreAdminRequest, CoreServiceResult<T>>(
      'coreAdmin',
      'admin.request',
      request,
      { correlationId: ctx.request.correlationId }
    );
  } catch (error) {
    return serviceErrorResult<T>(error, request);
  }
}
```

loader/action 不应该拼 service path，不应该分支判断 mock/live，只调用：

```ts
await listProjects(ctx);
await createJob(ctx, input);
await rotateWebhookSecret(ctx, input);
```

### 6. 做三层验证

- contract test：模块消费的 method/path 仍在 OpenAPI 中。
- mock/fixture test：页面、loader、action、错误展示可以按合同工作。
- live smoke：真实服务证明签名、租户隔离、幂等、quota、lease、retry、one-time secret 和状态机。

推荐命令形态：

```bash
npm run module:service-contract -- <module-id> --openapi ../service/openapi.yaml
npm run module:test -- <module-id>
npm run module:evidence -- --module <module-id> --file ./scripts/live-smoke.ts --runner tsx -- --required
```

## 请求约定

### 模块传入 ctx.services.invoke 的 input

模块只传业务请求：

- `path`
- `method`
- `query`
- `json`
- `headers`
- 允许进入 claims 的字段，例如 `tenantId`

模块可以传 `idempotency-key`，前提是 operation 的 `allowHeaders` 允许它。模块不应该传：

- `authorization`
- `cookie`
- 签名 header
- timestamp header
- claims header

这些由宿主 runtime 管理。

### 宿主注入到服务端的 header

以 RunLynk 为例：

- `authorization: Bearer <secretRef.bearerToken>`
- `x-runlynk-signature`
- `x-runlynk-timestamp`
- `x-runlynk-claims`
- `idempotency-key`，仅当模块显式传入且 policy 允许。

签名 canonical 推荐包含：

```text
method
path
timestamp
bodySha256
claimsSha256
```

claims header 推荐是稳定 JSON 的 base64url 编码。服务端必须校验 timestamp 窗口、body hash、claims hash 和签名，拒绝重放与跨租户访问。

### 服务端响应 header

服务端应该返回至少一个 request id：

- 通用：`x-request-id`
- 产品自定义：例如 `x-runlynk-request-id`

PloyKit 模块可以把它展示在错误面板、诊断页和 evidence 中，方便跨仓库排查。

## 错误码分层

不要把所有错误都塞进一个码表。推荐三层：

| 层级 | 谁产生 | 用途 | 示例 |
| --- | --- | --- | --- |
| 平台错误码 | PloyKit runtime | 说明 service connection、egress、secret、timeout 等通用接入问题 | `MODULE_SERVICE_CONNECTION_MISSING` |
| 产品接入错误码 | 模块 service client | 把平台错误翻译成用户能理解的产品问题 | `RUNLYNK_SERVICE_CONNECTION_MISSING` |
| 服务端业务错误码 | 外部服务 | 说明真实业务拒绝原因 | `RUNLYNK_PROJECT_FORBIDDEN` |

### 平台错误码

宿主通用错误码不应该带具体产品语义：

| 错误码 | 含义 | 主要处理人 |
| --- | --- | --- |
| `MODULE_SERVICE_CONNECTION_MISSING` | 缺少 service connection | 平台管理员 |
| `MODULE_SERVICE_CONNECTION_DISABLED` | connection 被禁用 | 平台管理员 |
| `MODULE_SERVICE_CONNECTION_BLOCKED` | connection 被风控或策略阻断 | 平台管理员 |
| `MODULE_SERVICE_CONNECTION_NOT_READY` | connection 未就绪 | 平台管理员 |
| `MODULE_SERVICE_CONNECTION_PROVIDER_MISMATCH` | provider 不匹配 | 平台管理员/模块作者 |
| `MODULE_SERVICE_SECRET_REF_MISSING` | connection 缺 secret ref | 平台管理员 |
| `MODULE_SERVICE_SECRET_MISSING` | secret ref 指向的密文不存在 | 平台管理员 |
| `MODULE_SERVICE_EGRESS_DENIED` | origin 不在 allowlist | 平台管理员/模块作者 |
| `MODULE_SERVICE_EGRESS_PATH_DENIED` | path 不在 allowlist | 模块作者 |
| `MODULE_SERVICE_PRIVATE_NETWORK_DENIED` | 私网地址被策略拒绝 | 平台管理员 |
| `MODULE_SERVICE_METHOD_DENIED` | method 不被 operation 允许 | 模块作者 |
| `MODULE_SERVICE_HEADER_DENIED` | header 不被 operation 允许 | 模块作者 |
| `MODULE_SERVICE_REQUEST_BODY_DENIED` | body 不被 operation 允许 | 模块作者 |
| `MODULE_SERVICE_REQUEST_TOO_LARGE` | 请求过大 | 模块作者/服务端 |
| `MODULE_SERVICE_RESPONSE_TOO_LARGE` | 响应过大 | 服务端/模块作者 |
| `MODULE_SERVICE_TIMEOUT` | 调用超时 | 服务端/平台管理员 |
| `MODULE_SERVICE_FETCH_FAILED` | 网络连接失败 | 服务端/平台管理员 |
| `MODULE_SERVICE_UPSTREAM_5XX` | 上游 5xx | 服务端 |

### 产品接入错误码

模块应该把平台码映射成产品码，并给页面恢复动作。以 RunLynk 为例：

| 平台码 | RunLynk 产品码 | 页面恢复动作 |
| --- | --- | --- |
| `MODULE_SERVICE_CONNECTION_MISSING` | `RUNLYNK_SERVICE_CONNECTION_MISSING` | 打开 Admin service connections |
| `MODULE_SERVICE_CONNECTION_DISABLED` | `RUNLYNK_SERVICE_CONNECTION_DISABLED` | 启用 `runlynkAdmin` |
| `MODULE_SERVICE_CONNECTION_BLOCKED` / `MODULE_SERVICE_CONNECTION_NOT_READY` | `RUNLYNK_SERVICE_CONNECTION_NOT_READY` | 检查连接健康和策略阻断 |
| `MODULE_SERVICE_SECRET_REF_MISSING` / `MODULE_SERVICE_SECRET_MISSING` | `RUNLYNK_SERVICE_SECRET_MISSING` | 补 admin token 和 signing secret |
| `MODULE_SERVICE_EGRESS_DENIED` / `MODULE_SERVICE_PRIVATE_NETWORK_DENIED` | `RUNLYNK_SERVICE_ORIGIN_BLOCKED` | 检查 egress 和 origin map |
| `MODULE_SERVICE_TIMEOUT` | `RUNLYNK_CORE_TIMEOUT` | 打开诊断页，检查 Core 健康 |
| `MODULE_SERVICE_FETCH_FAILED` / `MODULE_SERVICE_UPSTREAM_5XX` | `RUNLYNK_CORE_UNREACHABLE` | 检查 Core 进程、网络和日志 |

### 服务端业务错误码

服务端应该返回稳定 error envelope：

```json
{
  "error": {
    "code": "RUNLYNK_PROJECT_FORBIDDEN",
    "message": "Project does not belong to this workspace.",
    "request_id": "req_01J...",
    "details": {
      "project_id": "proj_..."
    }
  }
}
```

推荐状态码：

| HTTP 状态 | 适用场景 |
| --- | --- |
| `400` | 请求字段非法、schema 不通过 |
| `401` | bearer、签名、timestamp、claims 校验失败 |
| `403` | actor/tenant/project 无权限 |
| `404` | 资源不存在，且调用方有权知道它不存在 |
| `409` | 幂等冲突、状态机冲突、重复创建 |
| `422` | 业务规则不满足 |
| `429` | quota、rate limit、并发限制 |
| `500` | 服务端未知错误 |
| `502` / `503` / `504` | 服务依赖、队列、网关或超时问题 |

错误 `message` 必须可展示但不能泄露 secret；敏感细节放服务端日志，用 `request_id` 串联。

## 页面错误处理

服务型模块页面不应该因为 loader 调 Core 失败就掉回宿主默认兜底页。正确行为是：

- 路由匹配成功后，继续渲染模块自己的 shell。
- loader/action 错误进入模块错误面板。
- 错误面板展示产品错误码、request id、当前连接状态和下一步动作。
- 只有路由、组件或模块契约本身无法解析时，才使用宿主级错误页。

这样用户看到的是“RunLynk 的连接未就绪”，而不是两个完全不同的产品页面来回切换。

## 本地联调检查表

以 RunLynk 这类服务为例，启动前检查：

- 模块源码在 `modules/<id>/`，并已重新 `npm run modules:scan`。
- 服务端进程可访问，例如 `http://localhost:8080/healthz` 返回 200。
- service connection 存在、active、provider 匹配。
- `secretRefs.bearerToken` 和 `secretRefs.hmacSecret` 能解析到密文。
- origin map 把合同 origin 改写到本地服务。
- workspace 已绑定远端 tenant/project，或模块有 first-time activation 流程。
- 页面 loader/action 对 service 错误返回产品错误 envelope，而不是 throw 到宿主。

RunLynk 本地典型配置：

```env
PLOYKIT_SERVICE_E2E_ORIGIN_MAP={"https://core.runlynk.example":"http://localhost:8080"}
RUNLYNK_LOCAL_ADMIN_TOKEN=local_runlynk_admin_service_token_32_bytes
RUNLYNK_LOCAL_SERVICE_SIGNING_SECRET=local_runlynk_service_signing_secret_32_bytes
```

RunLynk 的模块声明中，`runlynkAdmin` 使用：

- provider: `runlynk-go-core`
- signing headers: `x-runlynk-signature`、`x-runlynk-timestamp`、`x-runlynk-claims`
- allow headers: `content-type`、`idempotency-key`
- resource binding: `runlynk_workspace`

## 排错矩阵

| 现象 | 优先怀疑 | 处理 |
| --- | --- | --- |
| 页面不存在或进了宿主通用页面 | module map 没更新、路由未匹配 | 运行 `npm run modules:scan`，检查 route path |
| 模块 shell 出现连接错误 | service connection 缺失或未就绪 | 看产品错误码和 Admin service connections |
| `MODULE_SERVICE_SECRET_MISSING` | secret ref 指向的密文缺失 | 补环境变量或密文存储 |
| `MODULE_SERVICE_EGRESS_DENIED` | origin 不在 allowlist | 检查 `serviceRequirements.connection.egress` |
| 本地仍请求合同域名 | origin map 未生效 | 检查 `PLOYKIT_SERVICE_E2E_ORIGIN_MAP` 所在进程环境 |
| `MODULE_SERVICE_PRIVATE_NETWORK_DENIED` | 私网访问策略未允许 | 使用 origin map 或调整受控策略 |
| `MODULE_SERVICE_TIMEOUT` | 服务端慢、未启动或断点卡住 | 查服务健康、日志、timeout 配置 |
| 401 签名错误 | secret 不一致、时钟漂移、canonical 不一致 | 查 HMAC secret、timestamp、body/claims hash |
| 403/404 项目错误 | workspace/tenant/project 绑定错误 | 查 resource binding 和服务端租户隔离 |
| 幂等冲突 | 重复 key 携带不同 body | 使用 request-scoped idempotency key，服务端返回 409 |

## 判断标准

一次服务接入算完成，至少满足：

- 页面、loader、action 没有直连服务端 URL。
- 模块内只有一个 service client 直接调用 `ctx.services.invoke(...)`。
- 缺 service connection、缺 secret、Core 不可达、业务拒绝都有产品化错误展示。
- mock 和真实服务走同一条调用路径。
- live smoke 证明至少一个真实成功路径和一个真实拒绝路径。
- 文档写清楚本地配置、service connection、resource binding、错误码和 evidence 命令。
