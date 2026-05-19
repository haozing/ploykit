# Capability Demo 宿主能力真实运行测试报告

生成时间：2026-05-19T02:00:57.637Z

测试对象：`plugins/capability-demo`

运行入口：`http://127.0.0.1:3100/api/plugins/capability-demo/self-test`

测试用户：`5YIQXBzeFUnsNmlsQFCIJjmAZQyRJ7d3`

## 总结

- Self-test 状态：通过
- passed：16
- skipped：3
- failed：0
- seed：`mpbzkuqw-k0445b`
- workspace：`705d3887-2f10-438b-94ff-efda5e15b978`
- run：`5ca5f43a-1df2-4d1f-9b00-281b65d4daec`
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
    "userId": "5YIQXBzeFUnsNmlsQFCIJjmAZQyRJ7d3",
    "apiKey": {
      "id": "8c552504-e205-46dc-a2cb-e21222bd6ebe",
      "scope": {
        "type": "workspace",
        "id": "705d3887-2f10-438b-94ff-efda5e15b978"
      },
      "permissions": ["POST:/api-key-echo", "route:POST:/api-key-echo"]
    },
    "metering": {
      "meter": "capability-demo.selftest.request",
      "usageId": "042f1195-5bcd-4365-838f-d52d43807652",
      "apiKeyId": "8c552504-e205-46dc-a2cb-e21222bd6ebe"
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
    "scope_id": "705d3887-2f10-438b-94ff-efda5e15b978"
  },
  "pluginFileRows": 2,
  "usageMetrics": [],
  "apiKey": {
    "last_used_at": "2026-05-19T02:00:57.464Z",
    "revoked_at": "2026-05-19T02:00:57.627Z",
    "scope_type": "workspace"
  },
  "notificationCount": 1,
  "webhookStatus": 202,
  "webhookAccepted": true
}
```
