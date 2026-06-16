# Postgres Baseline 与 PITR 运维手册

这份手册用于把 PloyKit runtime store、Data v2 模块表和宿主数据放到可重建、
可恢复、可审计的 Postgres 运维边界内。它补充本地
`host:postgres-physical-restore-smoke` 证据，但不替代目标部署环境的托管快照或
WAL/PITR 演练。

## 适用范围

- runtime store schema：`migrations/runtime/*.sql`
- Data v2 模块表和 metadata 表
- 宿主用户、产品、workspace、文件 metadata、商业账本、worker/outbox、webhook
  receipt、RAG source/chunk、provider invocation 等 Postgres 内事实

不包含：

- 对象存储里的真实文件对象
- secret manager 中的 auth/provider/service/webhook secret
- 第三方 provider 侧状态，例如 Stripe customer、S3 object version、Email message
- 旧版本任意历史库的自动迁移承诺

## 基线策略

1. 新环境以当前 `migrations/runtime/*.sql` 和 Data v2 migration 作为可重建
   baseline。
2. 空库必须能依次通过：

   ```bash
   npm run runtime:stores:verify
   npm run data:migrate -- --database-url <restore-url>
   npm run data:verify-db -- --database-url <restore-url>
   npm run host:postgres-local-smoke -- --no-docker
   ```

3. 若部署选择不兼容旧 schema，应在变更说明中写明“需要新 baseline 重建”，旧库只
   能作为归档、抽样校验或人工迁移源。
4. 任何旧库迁移都必须独立提供字段映射、回滚方案、抽样校验和审计记录，不得混入
   runtime migration baseline。

## 本地物理恢复 Gate

每次发布候选前至少复跑：

```bash
npm run host:backup-restore-smoke -- --required
npm run host:postgres-physical-restore-smoke -- --required
npm run host:upgrade-migration-smoke -- --required
npm run release:maintainer-gate
```

验收口径：

- `backup-restore` 证明 runtime store 语义快照和恢复计划覆盖关键领域。
- `postgres-physical-restore` 证明本地隔离 Docker Postgres 可执行
  `pg_dump -Fc`、`pg_restore`、schema verify、数据指纹比对和恢复后写入。
- `upgrade-migration` 证明 migration 顺序、幂等和非破坏性语句。
- `release:maintainer-gate` 严格读取上述 `latest.json`，并要求 evidence 为
  `required=true`。

## 目标环境 PITR 演练

目标环境上线前或重大 schema 变更前，应在隔离库中执行一次恢复演练：

1. 从托管 Postgres 控制台创建最新 snapshot，或选择一个明确时间点做 PITR。
2. 恢复到隔离实例或隔离数据库，不要覆盖生产库。
3. 记录恢复来源、时间点、恢复目标、操作者和工单/变更单编号。
4. 设置 `DATABASE_URL=<restore-url>`，运行：

   ```bash
   npm run runtime:stores:verify
   npm run data:verify-db -- --database-url <restore-url>
   npm run host:postgres-local-smoke -- --no-docker
   ```

5. 对关键业务域做抽样校验：至少包括 host users、workspaces、runs/outbox、
   webhook receipts、files metadata、commercial orders/invoices/credits、
   RAG sources/chunks、provider invocations。
6. 验证恢复库可写入一条隔离测试记录，然后清理该测试记录或销毁恢复库。

演练报告至少记录：

- snapshot/PITR 时间点和恢复完成时间
- runtime migration applied 数量、required index 数量和缺失索引列表
- Data v2 verify 结果
- 抽样校验对象数量和异常
- 是否验证对象存储、secret manager 和 provider 侧恢复

## RPO/RTO 建议

| 等级      | RPO | RTO | 要求                                  |
| --------- | --- | --- | ------------------------------------- |
| 开发/测试 | 24h | 4h  | 每日快照即可                          |
| 生产候选  | 1h  | 2h  | 托管快照 + WAL/PITR 可用，季度演练    |
| 商业生产  | 15m | 1h  | 连续 WAL/PITR，跨区备份，月度抽样恢复 |

## 外部资产恢复

Postgres 恢复通过后，还必须单独验证：

- 文件对象：桶版本化、跨区复制、孤儿对象/缺失对象 reconcile。
- secrets：auth secret、provider secret、service connection secret、webhook signing
  secret 可以从 secret manager 恢复。
- provider：Stripe、Email、AI/RAG、S3 真实 provider 的幂等 replay 和账本对账。

这些外部资产不能用 Postgres `pg_dump` 证明。
