# 产品 API 合同驱动的服务端分离型模块开发指南

本文面向 RunLynk 这类项目：领域事实和状态机由服务端实现，PloyKit 负责产品外壳、控制台、配置、权限、审计、商业化和发布门禁。目标不是把两个项目重新揉在一起，而是让产品、服务端实现和 PloyKit 围绕同一份产品真实 API 合同并行开发，最后可验证地合并。

## 核心结论

服务端分离型产品模块应采用产品 API 合同驱动开发：

- 产品以 `openapi.yaml` 或等价机器可读合同作为真实 API 合同源头；服务端实现它，PloyKit 消费它。
- HTTP 产品 API 首选 OpenAPI；事件、worker、stream 或 schema-only 边界可以使用 AsyncAPI、Protocol Buffers 或 JSON Schema 补充。
- PloyKit 模块通过 `contractVersion: 2`、`serviceRequirements` 和 `ctx.services.invoke(...)` 调用受控服务。
- PloyKit module 源码放在仓库内 `modules/<id>/`；独立维护的是 Core、Worker、gateway、blackbox/live smoke 等服务端实现资产，不是 PloyKit module 壳。
- 模块内部只保留一个 service client/adapter 层，页面、loader、action 不直接拼外部服务请求。
- 本地开发使用 mock/fixture 提升效率，但合并前必须跑真实服务的 live smoke 或 blackbox 测试。
- 文档只解释流程和语义，不能取代产品 API 合同；如果文档和机器可读合同冲突，以机器可读合同为准。

这不是“多写一份接口文档”，而是把产品 API 合同变成类型、mock、测试和 CI gate 的共同输入。

## 适用场景

适合使用本指南的情况：

- Go、Java、Rust、Python 等服务端实现独立维护权威数据和状态机。
- PloyKit 只是产品层、控制台、白标页面、租户配置、审计、计费或运营视图。
- 服务端需要 bearer token、HMAC、mTLS、私网地址、动态 claims、强审计或敏感脱敏。
- 前后端团队需要并行开发，而不是每个页面变更都启动完整服务端环境。

不适合完全 mock 的情况：

- lease、retry、idempotency、quota、webhook、one-time secret、签名鉴权、跨租户隔离等行为是核心正确性。
- 页面操作会改变服务端状态机。
- 服务端响应依赖数据库约束、并发、时间窗口或安全策略。

这些场景可以 mock UI 和基本流程，但最终验收必须打真实服务。

## OpenAPI 与 mock 的边界

共同维护产品级 `openapi.yaml` 并由 PloyKit 生成 mock 是可行的，也应该作为服务端分离型模块的默认开发方式。推荐理解为：

```text
openapi.yaml（产品真实 API 合同）
  -> 产品资源语义、endpoint 清单、request/response schema、error envelope
  -> 服务端实现 blackbox test + PloyKit consumer contract test
  -> 类型、基础 mock、fixture、PloyKit service client/adapter
  -> 开发期指向 mock service，联调和发布前指向真实服务
```

切换 mock 和真实接口时，不应改页面、loader、action 或业务 adapter。应保持同一套 `ctx.services.invoke(...)` 调用路径，只切换 service connection 的 `baseUrl`、secret refs 和运行环境：

```text
开发期：baseUrl = http://127.0.0.1:<mock-port>
联调期：baseUrl = http://127.0.0.1:<service-port>
生产期：baseUrl = https://api.example.com
```

OpenAPI 适合自动化覆盖产品 API 形状：

- endpoint、method、path/query/body 参数。
- 成功响应和错误响应的 JSON schema。
- auth scheme、header 名称、状态码和 error envelope。
- examples 生成的基础 fixture。

OpenAPI 不足以单独证明运行时行为：

- 租约：并发 worker 是否会拿到同一个 job、lease 超时后是否重新投递。
- 重试：backoff、最大次数、attempt 复制、retry/cancel 竞争。
- 幂等：相同 key 是否只写一次，相同 key 不同 body 是否冲突。
- quota：并发扣减、时间窗口、跨租户隔离。
- HMAC：canonical string、timestamp 窗口、body/claims hash、重放拒绝。
- one-time token：明文是否只返回一次，日志和审计是否脱敏。
- 状态机时序：哪些状态迁移允许，哪些必须拒绝。

所以 mock 应分层使用：

| 层级 | 用途 | 适合证明什么 |
| --- | --- | --- |
| schema mock | 由 OpenAPI schema/examples 自动生成 | 页面能跑、字段形状正确 |
| fixture mock | 人工维护典型成功/失败样例 | 空状态、错误展示、表单分支 |
| stateful mock | 少量模拟状态变化 | 基本交互流程和前端状态处理 |
| live smoke | 打真实服务端 | 签名、租户、幂等、状态机、并发和持久化 |

如果 mock 试图完整模拟租约、重试、幂等、quota 和签名，它会逐渐变成另一个小服务端，并且很容易和真实实现漂移。PloyKit 应把 mock 用于开发效率，把最终正确性交给真实服务 blackbox/live smoke。

## PloyKit 侧边界

### PloyKit 负责什么

- 模块契约：`module.ts` 声明 routes、actions、data、permissions、serviceRequirements、resourceBindings。
- 产品体验：site/dashboard/admin 页面、loader、action、surface、i18n、theme、SEO。
- 宿主能力：auth、RBAC、workspace/product scope、audit、files、notifications、billing、metering、api keys。
- 受控服务调用：由 runtime 负责 secret ref、签名、claims、egress、timeout、redaction、provider invocation ledger。
- 本地 read model：只存映射、偏好、短期缓存和展示快照，不复制服务端权威事实。

### 外部服务负责什么

- 权威领域对象和状态机。
- 实现产品 API 合同声明的真实业务 API、worker/producer API、callback/webhook、usage/quota、lease/retry/cancel。
- 服务端鉴权、租户隔离、幂等、并发和数据库约束。
- 对产品 API 合同中的 schema、error envelope、examples 和 auth 约定提供可验证实现。
- 服务端黑盒测试、迁移、部署、运行时监控。

### 模块不能做什么

- 不直接读 `process.env` 获取服务端 token。
- 不自己拼 bearer/HMAC/mTLS header。
- 不用裸 `fetch()` 或 `ctx.http.fetch(...)` 调 privileged service。
- 不把 secret、token、webhook signature 写入 Data v2、日志、artifact、notification 或 screenshot。
- 不把服务端权威状态复制成可写 Data v2 表。
- 不在 host runtime、host script 或 `apps/host-next/*` 里写具体模块特例。

## PloyKit 侧落地方式

PloyKit 现在已经有关键基础：`contractVersion: 2`、`serviceRequirements`、`ctx.services.invoke(...)`、service connection、redaction、audit、module doctor、`module:service-contract` 和 `product + service-backed` 模板扩展。服务端分离型模块不需要推翻架构，按下面的形态落地即可；后续增强主要继续补产品 API 合同的 request/response schema diff、fixture 生成和 live evidence 自动化。

### 1. 标准模块形态

每个产品 API 合同驱动的服务端分离型模块都应采用以下结构：

```text
modules/<id>/
  module.ts
  README.md
  lib/
    service-client.ts
    service-types.ts
    service-errors.ts
    redaction.ts
  loaders/
  actions/
  api/
  pages/
  tests/
    smoke-contract.test.ts
    smoke-mock.test.ts
    smoke-live.test.ts
```

约定：

- `module.ts` 声明 `contractVersion: 2` 和 `serviceRequirements.<service>`。
- `lib/service-client.ts` 是唯一直接调用 `ctx.services.invoke(...)` 的业务入口。
- loader/action/API 只能调用 `lib/service-client.ts` 暴露的语义函数，例如 `listProjects(ctx)`、`createJob(ctx, input)`。
- `lib/service-errors.ts` 统一把产品 API error envelope 转成页面可展示、可审计、已脱敏的结构。
- `tests/smoke-contract.test.ts` 校验模块声明、service policy、权限和 wrapper 调用路径。

### 2. OpenAPI consumer check

PloyKit 提供通用检查入口，用于验证模块实际消费的产品 API endpoint 仍存在于产品 API 合同中。

推荐命令：

```bash
npm run module:service-contract -- <module-id> --openapi ../contracts/openapi.yaml
npm run module:service-contract -- <module-id> --openapi ../contracts/openapi.yaml --write-fixtures
```

默认会优先读取模块内 `tests/service-contract.json`；如果没有该文件，会扫描 `lib/`、`services/`、`actions/`、`loaders/` 和
`api/` 下的字面量 `method + path`。对复杂动态路径，建议显式维护 `tests/service-contract.json`：

```json
{
  "endpoints": [
    {
      "service": "acmeApi",
      "operation": "request",
      "method": "GET",
      "path": "/v1/projects/{projectId}/jobs",
      "source": "lib/service-client.ts"
    }
  ]
}
```

当前入口已验证：

- wrapper 中声明的 `method + path` 都存在于 OpenAPI。
- 产品 API 合同删除或重命名 endpoint 时，PloyKit 模块测试立即失败。
- 加 `--write-fixtures` 时，会把 OpenAPI JSON responses/examples/schema 或 YAML endpoint 占位信息写入 `tests/fixtures/generated/`，作为基础
  contract mock fixture。

后续可继续在同一入口扩展：

- request body、query、path params 的基本字段能被 schema 覆盖。
- 成功响应和错误响应使用 OpenAPI 中的 schema 或 examples。
- 从 YAML schema/examples 生成更完整的 contract mock fixture。

### 3. mock/fixture 约定

产品 API 合同驱动的服务端分离型模块使用三种本地 mock：

- contract mock：从 OpenAPI examples/schema 生成基础 mock 响应。
- fixture mock：由模块测试或开发服务读取 `tests/fixtures/*.json` 返回稳定响应。
- stateful mock：只为少量关键页面流程保留内存状态，不承担生产正确性证明。

建议约定：

```text
modules/<id>/tests/fixtures/
  meta.ok.json
  projects.list.ok.json
  jobs.create.ok.json
  errors.quota_exceeded.json
```

mock 只能用于页面开发、交互开发和普通 loader/action 测试。以下内容必须 live 测：

- HMAC、bearer、mTLS、signed-service claims。
- one-time token/secret 创建和脱敏。
- idempotency key。
- lease、renew、timeout、retry、cancel。
- quota、usage、tenant scope、RBAC。
- webhook/callback delivery。

在 PloyKit fake-host 测试中，使用 `createTestingModuleContext({ serviceHandlers })` 把这些 fixture 挂到
`ctx.services.invoke(...)`，不要让页面、loader 或 action 为 mock/live 分支写不同代码。OpenAPI examples/schema 更新后，可用
`module:service-contract --write-fixtures` 刷新基础 contract mock fixture，再由模块测试按业务场景挑选 fixture。

最小可执行闭环应长这样：

```bash
npm run module:service-contract -- modules/<id> --openapi <openapi.yaml> --write-fixtures
npm run module:test -- modules/<id>
npm run module:evidence -- --module <id> --file ./scripts/live-smoke.ts --runner tsx -- --required
```

模块测试中建议固定三个断言：

- service client 发出的 `service`、`operation`、`method`、`path` 和关键 `tenantId/idempotency-key` 符合 `tests/service-contract.json`。
- fixture mock 覆盖成功、空状态、业务错误、权限/限额错误，不覆盖真实签名或租约正确性。
- live smoke 至少包含一个真实成功路径和一个真实拒绝路径，例如签名失败、租户不匹配、幂等冲突或 quota 拒绝。

对 OpenAI 或其他 AI agent 来说，mock 规则也要写进提示词：让 AI 只改 `modules/<id>/`，先读产品 API 合同，再生成或挑选
`tests/fixtures/`，用 `createTestingModuleContext({ serviceHandlers })` 接到 `ctx.services.invoke(...)`。不要让 AI 为了 mock
在页面/action 里写 `if (mock)` 分支，也不要让 AI 把 OpenAI 生成的示例响应当成产品或服务端权威事实。

### 4. product + service-backed 模板

模板体系现在以一个主模板加两个扩展表达这类模块，而不是继续增加平级模板：

```text
product        主模板：minimal + product + white-label + Data v2 CRUD 的统一产品模块骨架
service-backed 扩展：产品 API 合同/受控服务/service client/mock/live smoke
background     扩展：jobs/events/webhooks/lifecycle
```

因此新服务端分离型产品模块应使用 `product` 主模板叠加 `service-backed` 扩展：

```bash
npm run module:create -- runlynk-console --template product --with service-backed
npm run module:create -- runlynk-console --template product --with service-backed,background
```

- `contractVersion: 2` 的 service policy。
- `serviceRequirements` 示例。
- 单一 service client wrapper。
- redaction/error envelope helper。
- mock fixture 测试。
- live smoke 测试骨架。
- 模块 README 中的 mock/live 开发命令。

当前仓库仍保留 `signed-service`、`product-app` 等历史模板作为兼容入口和参考片段，但新服务端分离型产品模块应优先使用
`product + service-backed`。这样 RunLynk 这类模块既有 site/dashboard/admin、white-label/presentation、Data v2 缓存/映射，
又能叠加产品 API 合同和真实服务验收。需要队列、worker、回调或长任务时，再叠加 `background`。

## 推荐开发流程

### 1. 先划清事实来源

开始写页面前，先回答：

- 哪些对象和状态由服务端权威维护？
- 哪些数据只是 PloyKit 展示缓存、偏好或映射？
- 哪些操作有副作用，需要 idempotency？
- 哪些调用需要 secret、签名、动态 claims 或强审计？
- 哪些页面可以 mock 开发，哪些必须 live 验证？

如果答案不清楚，不要急着写页面。先补产品 API 合同或业务边界说明。

### 2. 先发布产品 API 合同

产品 API 合同可以放在服务端仓库、产品合同仓库或双方约定的契约目录中；关键是它不是服务端私有文档，而是产品、服务端实现和 PloyKit 共同对齐的机器可读源头。合同至少提供：

- `openapi.yaml` 或等价产品 API 机器合同。
- 统一 error envelope。
- auth schemes。
- request id / trace id / idempotency 约定。
- examples 或测试 fixtures。
- 契约校验脚本。

文档可以解释调用顺序，但不要让文档成为 endpoint/schema 的权威来源。

### 3. PloyKit 模块声明受控服务

示例：

```ts
export default defineModule({
  contractVersion: 2,
  id: 'acme-console',
  permissions: [
    Permission.NavigationExtend,
    Permission.SurfaceContribute,
    Permission.ServicesInvoke,
    Permission.ResourceBindingsRead,
    Permission.AuditWrite,
  ],
  serviceRequirements: {
    acmeApi: {
      required: true,
      provider: 'acme-api',
      kind: 'signed-http',
      connection: {
        baseUrl: 'https://api.acme.example',
        egress: ['https://api.acme.example'],
        timeoutMs: 8000,
        retry: { attempts: 2, backoff: 'exponential', retryOn: [502, 503, 504] },
        maxRequestBytes: 262144,
        maxResponseBytes: 1048576,
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
        request: {
          input: { allow: ['path', 'method', 'query', 'json', 'tenantId'] },
          auth: { type: 'bearer', secret: 'bearerToken' },
          signing: {
            type: 'hmac-sha256',
            secret: 'hmacSecret',
            header: 'x-acme-signature',
            timestampHeader: 'x-acme-timestamp',
            claimsHeader: 'x-acme-claims',
          },
          request: {
            body: 'json',
            allowHeaders: ['content-type', 'idempotency-key', 'x-request-id'],
            denyHeaders: ['authorization', 'cookie'],
          },
          response: { body: 'json', maxBytes: 1048576 },
          audit: { event: 'acme.api.requested' },
          redaction: {
            request: ['headers.authorization', 'json.secret', 'json.token'],
            response: ['headers.set-cookie', 'json.secret', 'json.token'],
            error: ['body.secret', 'body.token'],
          },
        },
      },
    },
  },
});
```

### 4. 写单一 service client

不要让页面、loader、action 到处拼路径：

```ts
import type { ModuleContext } from '@ploykit/module-sdk';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface ServiceRequest {
  path: string;
  method?: Method;
  query?: Record<string, string | number | boolean | null | undefined>;
  json?: unknown;
  tenantId?: string;
}

interface ServiceResult<T = unknown> {
  ok: boolean;
  status: number;
  json?: T;
}

export async function invokeAcmeApi<T>(
  ctx: ModuleContext,
  request: ServiceRequest
): Promise<ServiceResult<T>> {
  return ctx.services.invoke<ServiceRequest, ServiceResult<T>>(
    'acmeApi',
    'request',
    request,
    { correlationId: ctx.request.correlationId }
  );
}

export async function listAcmeJobs(ctx: ModuleContext, projectId: string) {
  return invokeAcmeApi(ctx, {
    path: `/v1/projects/${encodeURIComponent(projectId)}/jobs`,
    method: 'GET',
  });
}
```

这样以后换 mock、换签名策略、改 error envelope，只改一处。

### 5. 用 mock 开页面，用 live 证明正确性

开发阶段可以这样分层：

```text
UI render test
  不需要服务端；直接传 loader data。

Module mock test
  mock ctx.services.invoke；校验 loader/action 的路径、方法、响应处理。

Consumer contract test
  运行 module:service-contract；校验模块消费的 method/path 没偏离产品 API 合同，schema diff 后续在同一入口扩展。

Live smoke test
  真实 PloyKit runtime + 真实服务端；校验签名、租户、幂等、状态机。

Service blackbox test
  服务端实现侧自己跑；校验真实实现满足产品 API 合同中的路由、响应 schema 和错误 envelope。
```

mock 失败说明页面或 adapter 有问题。live 失败说明真实集成还不能合并。

### 6. 合并门禁

PloyKit 模块侧建议至少跑：

```bash
npm run module:doctor -- <module-id>
npm run module:test -- <module-id>
npm run module:service-contract -- <module-id> --openapi ../contracts/openapi.yaml
npm run modules:check
npm run typecheck
```

涉及真实服务端的 release candidate 再跑：

```bash
npm run module:evidence -- --module <module-id> --file ./scripts/live-smoke.ts --runner tsx -- --required
```

服务端实现侧建议至少跑：

```bash
# 示例，具体命令由服务端实现仓库维护
go test ./...
go vet ./...
./scripts/verify-openapi.ps1
```

如果产品 API 合同、PloyKit wrapper、真实服务端实现三者不能同时通过，不能认为集成完成。

## RunLynk 参考落地

RunLynk 已经具备正确方向：

- RunLynk 产品 API 合同由 `openapi.yaml` 表达；Core、Worker gateway 或其他服务端组件负责实现它。
- PloyKit module 壳应位于 `modules/runlynk/`，不要再通过仓库外 module source 挂载。
- PloyKit 模块使用 `contractVersion: 2`。
- RunLynk 模块通过 `serviceRequirements.runlynkAdmin` 声明 signed HTTP。
- 模块里有 `lib/core-client.ts`，统一封装 `invokeRunLynkAdmin(...)`。
- 服务端实现侧有 OpenAPI route/schema blackbox 和 API test matrix。
- Worker contract endpoint 返回 schema、capability、endpoint template、starter defaults 和 `mock_input`。

还可以继续补强：

- 在 PloyKit 侧接入 `module:service-contract`，确保 `modules/runlynk/lib/core-*` 使用的 endpoint 都存在于产品 API 合同 `openapi.yaml`。
- 把 mock fixtures 从页面测试中进一步沉淀成稳定目录。
- 把 mock mode、live mode、evidence mode 写进模块 README。
- 对 one-time secret、tenant claims、idempotency、quota、worker lease 等关键路径保持 live smoke，不被 mock 替代。
- 按 `product + service-backed` 形态整理模块骨架：产品壳、白牌/替换、Data v2 映射和受控服务调用放在同一主模块内。

## 反模式

- 手写一份接口 Markdown，然后 PloyKit 和服务端各自实现。
- 把 `openapi.yaml` 当成服务端私有实现文档，而不是产品真实 API 合同。
- 页面代码直接 `ctx.services.invoke(...)` 到处拼 `path`。
- 为了本地调试把服务端 token 写进模块 config、Data v2 或 `.env` 读取逻辑。
- 用 mock 证明状态机正确。
- 在 PloyKit host 层写某个模块或某个服务端项目的特例。
- 把服务端权威对象全量复制到 PloyKit Data v2，再试图双写同步。
- 服务端实现变更只改 Go handler，不先更新产品 API 合同。
- PloyKit 页面变更只改 mock，不对齐产品 API 合同，也不跑真实 service smoke。

## 简短决策表

| 问题 | 推荐做法 |
| --- | --- |
| 只是公开第三方 HTTP，无 secret、无强审计 | `ctx.http.fetch(...)` + `Permission.ExternalHttp` + 精确 `egress` |
| 需要 token/HMAC/claims/私网/强审计 | `serviceRequirements` + `ctx.services.invoke(...)` |
| 产品已有 `openapi.yaml` | OpenAPI 作为产品 API 合同，生成类型、mock、consumer check |
| 产品还没有 API 合同 | 先补产品 API 合同，再写 PloyKit 页面 |
| 页面想脱离服务端开发 | 用 fixture/contract mock |
| 要证明可发布 | 跑真实服务端 live smoke/blackbox |
| PloyKit 要存数据 | 只存映射、偏好、缓存、展示快照 |
| 服务端状态机数据 | 由服务端权威维护，PloyKit 查询或展示 |
