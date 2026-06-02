# 宿主商业核心原语计划

本文档记录宿主商业能力的边界、当前状态和后续拆分路线。

## 当前核心原语

- Billing catalog：plan、SKU、价格、interval、credits、entitlements。
- Entitlements：按 user/workspace/product subject 授权能力。
- Usage：记录模块用量和幂等 usage event。
- Metering：authorize、commit、refund、void、reconcile。
- Credits：grant、consume、balance 和 ledger。
- Commerce：checkout、order、subscription、invoice、payment method。
- Redeem codes：批次、兑换、绑定 subject、过期和最大兑换次数。

这些能力通过 `ctx.commerce`、`ctx.billing`、`ctx.entitlements`、`ctx.usage`、`ctx.metering`、`ctx.credits`、`ctx.redeemCodes` 暴露给模块，并由 capability guard 做权限、subject ownership 和 system/admin 边界检查。

## 安全边界

- 普通模块只能操作当前 session 允许的 subject。
- 跨 user/workspace/product 的商业 mutation 需要 admin 或 system session。
- API key session 只能操作 key 绑定的 subject。
- 金额、credit、usage、metering 路径必须保留 idempotency key 或 ledger record。
- 敏感商业 metadata 在 admin/API/browser 输出前必须 redaction。

## 拆分路线

当前商业能力集中在较大的实现文件中。后续应保持 public API 不变，先做内部拆分：

1. Catalog service：plan/SKU 校验、发布和 provider 映射。
2. Entitlement service：grant/revoke/expire/list 与 subject guard。
3. Metering service：authorization lifecycle 与 reconciliation。
4. Credits ledger：grant/consume/refund 和余额投影。
5. Commerce provider adapter：local/Stripe checkout、portal、webhook、reconcile。
6. Redeem code service：批次、hash、绑定、兑换 attempt。
7. Admin presentation mapper：只负责 view model 和 redaction。

## 验证入口

- `npm run test:commercial-ledger`
- `npm run test:commercial-postgres`
- `npm run test:web-shell`
- `npm run host:stripe-local-smoke`
