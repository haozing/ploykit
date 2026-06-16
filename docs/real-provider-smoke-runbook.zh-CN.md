# 真实 Provider Smoke 运维手册

这份手册用于在真实凭据环境中验证 PloyKit 的外部 provider：S3 兼容对象存储、
Stripe、Email webhook、AI webhook/API 和 RAG provider。它补充本地 provider matrix，
本地 mock 或 local provider 通过不能替代本手册中的真实 provider 证据。

## 执行前提

只在隔离测试账号、测试 bucket、测试 Stripe price、测试 email endpoint 和测试 AI/RAG
provider 上执行。不要对生产客户、生产 bucket 或真实付费商品直接跑 smoke。

需要先确认：

- `DATABASE_URL` 或 `POSTGRES_URL` 指向可写的测试 Postgres。
- 对象存储 bucket 支持 put/head/range read/signed URL/delete。
- Stripe 使用测试模式 secret key 和测试 price。
- Email webhook endpoint 可接收签名请求并返回 2xx。
- AI/RAG provider 有测试 quota，失败不会影响生产账单。

## 必需环境变量

| Provider   | 必需变量                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------- |
| S3         | `PLOYKIT_FILE_STORAGE=s3`, `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Stripe     | `PLOYKIT_BILLING_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_PRICE_DEMO_PRO_MONTHLY`           |
| Email      | `PLOYKIT_EMAIL_PROVIDER=webhook`, `PLOYKIT_EMAIL_WEBHOOK_URL`, `PLOYKIT_EMAIL_WEBHOOK_SECRET`     |
| AI webhook | `PLOYKIT_AI_PROVIDER=webhook`, `PLOYKIT_AI_WEBHOOK_URL`, `PLOYKIT_AI_WEBHOOK_SECRET`              |
| RAG        | `PLOYKIT_RAG_PROVIDER=memory-vector`，并确保 runtime store 使用持久 Postgres                      |

可选变量：

- `S3_PUBLIC_ENDPOINT`
- `S3_REGION`
- `S3_SESSION_TOKEN`
- `S3_FORCE_PATH_STYLE=false`
- `PLOYKIT_EMAIL_SMOKE_TO`
- `PLOYKIT_AI_API_KEY`，用于非 webhook AI provider

## 推荐命令

单项预检：

```bash
npm run host:s3-smoke -- --required --check-signed-url
npm run host:stripe-smoke -- --required --apply-ledger
npm run host:email-smoke -- --required
npm run host:ai-rag-policy-smoke -- --required
npm run host:rag-provider-smoke
```

完整矩阵：

```bash
PLOYKIT_PROVIDER_MATRIX_EXTERNAL=1 npm run host:provider-matrix -- --required
npm run release:maintainer-gate
```

Windows PowerShell:

```powershell
$env:PLOYKIT_PROVIDER_MATRIX_EXTERNAL='1'
npm run host:provider-matrix -- --required
npm run release:maintainer-gate
```

## 验收口径

真实 provider smoke 通过必须同时满足：

- `.runtime/provider-matrix/latest.json` 的 `required=true` 且 `ok=true`。
- `provider-config:*` 均无 required missing env。
- S3 smoke 覆盖 put/head/range read/signed URL/delete。
- Stripe smoke 覆盖 checkout/payment/refund 或 ledger apply 路径，且商业账本幂等。
- Email smoke 使用 webhook provider 发送，签名 secret 已配置。
- AI/RAG policy 覆盖预算拒绝、成功扣费、失败释放 reservation、匿名 fail-closed。
- Provider invocation ledger 记录成功/失败、operation、kind、usage/cost/latency。
- `release:maintainer-gate` 的 `provider-live-matrix` 和
  `provider-invocation-ledger` 为 passed。

## 失败处理

- 缺 env：先修 secret manager 或 CI/CD 注入，不要在脚本里加默认真实凭据。
- S3 signed URL 失败：检查 public endpoint、path-style、region 和 bucket policy。
- Stripe ledger 重复：先看 idempotency key 和 provider event replay，不要手动删账本记录。
- Email 失败：检查 webhook URL、签名 secret、timeout 和 retry policy。
- AI/RAG 失败：检查 quota、预算 guard、reservation release 和 provider invocation ledger。

## 证据归档

至少保留：

- `.runtime/provider-matrix/latest.json`
- `.runtime/s3-smoke/latest.json` 或对应 smoke 输出
- `.runtime/ai-rag-policy/latest.json`
- `.runtime/ai-rag-local/latest.json` 或真实 AI/RAG provider 报告
- `release:maintainer-gate` 输出

不要在报告中暴露 secret、signed URL、完整数据库 URL、provider token 或客户数据。
