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

## 基线与迁移边界

`migrations/runtime/*.sql` 是当前 runtime store 的可重建 schema 基线。它必须能在空
Postgres 库中完整应用，并通过 `runtime:stores:verify` 的表、列、索引和 migration
journal 检查。

这不是对任意历史库的自动数据迁移承诺。若某个部署选择不迁移旧数据，应在部署说明中
明确声明“新 baseline 需要重建数据库”，并把旧库作为归档或人工迁移源处理。任何旧数据
迁移都应作为单独项目提供映射、回滚、抽样校验和审计证据。

Postgres baseline、`pg_dump`/`pg_restore`、托管快照和 WAL/PITR 演练的上线口径见
[Postgres Baseline 与 PITR 运维手册](postgres-baseline-pitr-runbook.zh-CN.md)。

## 迁移失败、回滚与 backfill

runtime store migration 采用 forward-only 策略：已经发布并进入
`module_runtime_migrations` journal 的 SQL 文件不得改写或重排；修复必须新增后续 migration。

生产执行顺序：

1. 先取得可恢复备份，并保存备份证据路径。
2. 执行 `npm run runtime:stores:verify -- --database-url <url>`，确认当前 journal 无
   missing、failed 或 checksum drift。
3. 执行 `npm run runtime:stores:migrate -- --dry-run --require-backup --backup-evidence <path>`。
4. 对会新增 `unique` / `not null` / foreign key 的 migration，先写并运行前置查询，证明现有
   数据无重复、空值或孤儿记录；若存在脏数据，先用独立 backfill/cleanup migration 处理。
5. 正式执行 `npm run runtime:stores:migrate -- --require-backup --backup-evidence <path>`。
6. 执行 `npm run runtime:stores:verify -- --database-url <url>` 和相关 smoke。

失败处理：

- 不要手动把 failed journal 改成 applied，也不要改写已经发布的 migration 文件。
- 若 DDL 在事务中失败且无数据变更，修正问题后新增 forward-fix migration，再重新执行。
- 若 migration 已产生部分业务影响，优先从备份或 PITR 恢复到升级前时间点；不能恢复时，必须写
  compensating migration，并附带抽样校验和审计说明。
- backfill migration 应记录输入范围、批次大小、重复/跳过数量和校验查询；高风险 backfill 应先在
  restored/staging 库跑完并保存报告。

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
npm run host:backup-restore-smoke -- --required
npm run host:postgres-physical-restore-smoke -- --required
npm run host:upgrade-migration-smoke -- --required
```

## 什么时候看这个文档

- 改 `src/lib/module-runtime/stores/*`
- 改 `apps/host-next/lib/admin-operations.ts`
- 改 runs / outbox / webhook / file / commercial / audit 的数据形状
- 改测试种子或需要稳定 run id 的场景
