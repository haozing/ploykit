# Capability Demo 宿主能力真实运行测试报告

生成时间：2026-05-17T14:02:36.169Z

测试对象：`plugins/capability-demo`

运行入口：`http://127.0.0.1:3100/api/plugins/capability-demo/self-test`

测试用户：`K3uxp6ZZ20XO3XR0LxFl6gpvooXvgmS6`

## 总结

- Self-test 状态：通过
- passed：16
- skipped：3
- failed：0
- seed：`mp9uh2ow-t08oz6`
- workspace：`6b641cf3-c4be-4429-a9dc-88a620035cb3`
- run：`0d2b541e-3f55-47be-9539-ef11fbdd7efa`
- API key echo：HTTP 200
- invalid API key：HTTP 401
- expired API key：HTTP 401
- cross-plugin API key：HTTP 401
- cross-workspace API key：HTTP 403
- cross-route API key：HTTP 403
- revoked API key：HTTP 401
- plugin webhook：HTTP 202

## 结论

真实 Next runtime 中，capability-demo 已覆盖宿主 storage、workspace、files、runs、artifacts、RAG、metering、credits、billing read gate、API key machine auth、rate limit、connectors、events、jobs、webhook、config、secrets、notifications、usage、audit、UI toast、external HTTP、SEO/sitemap/slots/theme/assets。AI 与兑换码兑换如果宿主未配置 provider/兑换码账本，会按平台边界返回 unavailable/skip，而不是伪造通过。

## 失败项

- 无

## 跳过项

- billing.redeem-code: Plugin "capability-demo" cannot redeem billing codes because no redemption host is configured.
- billing.grant-plan: ctx.billing.grantPlan requires an admin or system context.
- ai.generate-stream-embed: No host AI provider is configured for ctx.ai.generateText.

## 分项结果

| ID                          | 能力                                             | 状态    | 备注                                  |
| --------------------------- | ------------------------------------------------ | ------- | ------------------------------------- |
| context.request             | Plugin request/user/auth context                 | passed  |                                       |
| workspace.crud              | Workspace scope and membership                   | passed  |                                       |
| storage.crud                | Plugin storage CRUD and transaction              | passed  |                                       |
| config.secrets              | Config defaults and encrypted secrets            | passed  |                                       |
| rate-limit                  | Rate limit bucket                                | passed  |                                       |
| runs.lifecycle              | Runs lifecycle and task center records           | passed  |                                       |
| files.lifecycle             | Files upload/read/sign/archive/delete            | passed  |                                       |
| artifacts.rag               | Artifacts and RAG indexing/search/context/delete | passed  |                                       |
| metering.ledger             | Metering authorize/commit/refund/void/reconcile  | passed  |                                       |
| credits.consume             | Credits balance and consumption                  | passed  |                                       |
| billing.entitlements        | Billing plan and entitlement read gates          | passed  |                                       |
| billing.redeem-code         | Billing redeemCode host boundary                 | skipped | PLUGIN_BILLING_REDEMPTION_UNAVAILABLE |
| billing.grant-plan          | Billing grantPlan admin/system guard             | skipped | PLUGIN_BILLING_ADMIN_REQUIRED         |
| ai.generate-stream-embed    | AI generateText/streamText/embedText             | skipped | PLUGIN_AI_PROVIDER_UNCONFIGURED       |
| usage.audit.notification.ui | Usage/audit/notification/UI toast                | passed  |                                       |
| events.jobs                 | Events emit/subscribe and jobs enqueue/register  | passed  |                                       |
| http.external               | External HTTP egress guard                       | passed  |                                       |
| connectors.lifecycle-call   | Connectors CRUD/call/callback                    | passed  |                                       |
| api-keys.lifecycle          | Plugin API keys create/list/revoke               | passed  |                                       |

## API Key / Webhook 证据

```json
{
  "echoStatus": 200,
  "echoBody": {
    "ok": true,
    "userId": "K3uxp6ZZ20XO3XR0LxFl6gpvooXvgmS6",
    "apiKey": {
      "id": "7fa371fc-fd0c-4673-b69f-cbc466f32d26",
      "scope": {
        "type": "workspace",
        "id": "6b641cf3-c4be-4429-a9dc-88a620035cb3"
      },
      "permissions": ["POST:/api-key-echo", "route:POST:/api-key-echo"]
    },
    "metering": {
      "meter": "capability-demo.selftest.request",
      "usageId": "528bd26c-3ef3-41b5-a450-28c7b67d601d",
      "apiKeyId": "7fa371fc-fd0c-4673-b69f-cbc466f32d26"
    }
  },
  "invalidKeyStatus": 401,
  "expiredKeyStatus": 401,
  "crossPluginKeyStatus": 401,
  "crossWorkspaceKeyStatus": 403,
  "crossRouteKeyStatus": 403,
  "revokedKeyStatus": 401,
  "webhookStatus": 202,
  "webhookBody": {
    "success": true,
    "accepted": true
  }
}
```

## DB 抽样证据

```json
{
  "storageProbeRows": 2,
  "run": {
    "status": "succeeded",
    "visibility": "user-visible",
    "scope_type": "workspace",
    "scope_id": "6b641cf3-c4be-4429-a9dc-88a620035cb3"
  },
  "pluginFileRows": 2,
  "usageMetrics": [
    {
      "metric": "credit",
      "count": 1
    }
  ],
  "apiKey": {
    "last_used_at": "2026-05-17T14:02:36.027Z",
    "revoked_at": "2026-05-17T14:02:36.049Z",
    "scope_type": "workspace"
  },
  "notificationCount": 1,
  "webhookStatus": 202,
  "webhookAccepted": true
}
```
