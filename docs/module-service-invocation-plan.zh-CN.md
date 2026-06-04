# 模块受控外部服务调用计划

本文档记录模块调用外部受控服务的安全边界和后续演进路线。

## 当前边界

- 模块需要访问普通外部 HTTP 时，必须声明 `Permission.ExternalHttp` 和明确 `egress` origin。
- 需要访问宿主托管、带密钥、带签名或有私网风险的服务时，应使用 `serviceRequirements` 和 `ctx.services.invoke`。
- 模块不得在自己的表、日志、artifact 或 notification 中保存 API key、bearer token、HMAC secret、webhook signature 等敏感值。
- `serviceRequirements` 中的 operation 会限制 method、request body、allow headers、response body、signing 和 auth。
- 运行时会做 egress origin、私网 DNS、敏感 header、body size、response size、重定向和超时保护。
- 对接独立服务端时，OpenAPI 或等价机器契约应成为 endpoint/schema/error envelope 的源头；Markdown 文档只解释流程。
- contract mock 和 fixture mock 可用于开发页面和普通 action，但不能替代真实服务对签名、租户、幂等、quota、one-time token 和状态机时序的验证。

## 推荐调用路径

1. 在 `module.ts` 中声明 `serviceRequirements`。
2. 在宿主中配置对应 service connection 和 secret ref。
3. 模块内建立单一 service client/adapter，作为唯一 `ctx.services.invoke(serviceName, operationName, input)` 入口。
4. 页面、loader、action 调用 service client 暴露的语义函数，不直接拼受控服务请求。
5. 宿主记录 provider invocation、redaction 后的 request/response metadata 和健康状态。
6. 开发期 service connection 可指向 mock server；联调和发布前必须指向真实服务跑 live smoke。

## 后续计划

- 将 service connection 的配置、健康检查和 secret rotation 继续从大型 admin operations 中拆出。
- 为每个 provider 增加最小 contract test：签名、拒绝未声明 header、拒绝私网 egress、redaction。
- 已增加通用 OpenAPI consumer check：`npm run module:service-contract -- <module-id> --openapi ../service/openapi.yaml` 校验模块 service client 使用的 method/path 仍存在于服务端机器契约。
- 已增加 `product --with service-backed` 扩展：在 product 主模板上生成 serviceRequirements、service client、fixtures、mock test 和 live smoke 骨架。
- 在 module doctor 中继续强化 privileged service 与 `ctx.http.fetch` 的互斥提示。
- 对 release evidence 输出每个 service operation 的 readiness 和最近一次安全检查。

## 验证入口

- `npm run test:security-runtime`
- `npm run test:production-runtime`
- `npm run module:doctor -- <module-id>`
- `npm run module:test -- <module-id>`
- `npm run module:service-contract -- <module-id> --openapi ../service/openapi.yaml`
- `npm run module:evidence -- --module <module-id> --file ./scripts/live-smoke.ts --runner tsx -- --required`
