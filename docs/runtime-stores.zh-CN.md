# 运行时存储

PloyKit 的运行时存储负责把模块和宿主的运行证据统一落地。它分成
memory store 和 Postgres store 两层实现，两个实现需要保持行为一致。

## 核心范围

- runs
- outbox / delivery
- worker heartbeat
- webhook receipts
- notifications / delivery
- audit
- usage / metering / credits / credit reservations
- commercial catalog / orders / invoices / subscriptions
- entitlements / redeem code batches / redeem attempts
- API keys / risk events / risk blocks
- module catalog state
- files metadata
- product scope / memberships / host users
- settings / service connections / resource bindings
- provider invocations / RAG chunks

## 当前约定

- 所有记录都按 `productId` 分域，必要时再叠加 `workspaceId`、
  `moduleId`、`actorId`。
- `createRun` 现在支持可选稳定 `id`，适合种子数据和可重复的测试。
- run、outbox、receipt、notification、credit、credit reservation、API key、
  subscription event、redeem code 和 risk block 等都按
  idempotency key 做幂等。
- memory store 和 Postgres store 的行为要一起改，一起测。
- API key 只保存 hash、prefix、owner subject、scope、permissions、expiresAt、
  revokedAt 和 lastUsedAt；明文只在创建或轮换响应里出现一次。
- redeem code 只保存 hash、masked display、prefix、batch/status metadata 和兑换事实；
  创建批次时可一次性返回明文，之后不能从 store 读回明文。
- credits 预扣必须写入 `module_credit_reservations`，确认或释放通过同一 reservation
  id 幂等完成；不要只放 runtime 内存 Map。
- risk 只作为通用事实和阻断原语：`module_risk_events` 记录事件，
  `module_risk_blocks` 记录 subject/scope 阻断，不承载行业风控规则。
- 商业化核心事实的 subject-first、幂等、账本边界重构见
  [宿主商业核心原语重构计划](host-commercial-core-primitives-plan.zh-CN.md)。

## 常用验证

```bash
npm run test:runtime-stores
npm run test:admin-operations
npm run test:api-key-store
npm run test:ai-provider-runtime
npm run test:commercial-ledger
npm run test:commercial-postgres
npm run test:files-storage
npm run test:background-reliability
npm run runtime:stores:verify
```

## 什么时候看这个文档

- 改 `src/lib/module-runtime/stores/*`
- 改 `apps/host-next/lib/admin-operations.ts`
- 改 runs / outbox / webhook / file / commercial / audit 的数据形状
- 改测试种子或需要稳定 run id 的场景
