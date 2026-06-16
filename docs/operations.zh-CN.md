# 运维

这份文档记录 PloyKit 的日常运维入口和上线前检查顺序。

## 常用检查

```bash
npm run host:smoke
npm run host:browser-matrix -- --required
npm run host:accessibility-smoke -- --required
npm run host:config-doctor -- --required
npm run host:worker
```

## 发布前建议

1. 先确认 runtime store、auth secret 和 file storage 都是持久化配置。
2. 再确认 worker 心跳、队列和 provider matrix 都有最新证据。
3. 最后检查 browser matrix、accessibility smoke 和 release candidate gate。

真实 S3、Stripe、Email、AI/RAG provider 的凭据配置、必跑命令和证据口径见
[真实 Provider Smoke 运维手册](real-provider-smoke-runbook.zh-CN.md)。

## 备份恢复演练

Postgres baseline、托管快照和 WAL/PITR 的完整执行口径见
[Postgres Baseline 与 PITR 运维手册](postgres-baseline-pitr-runbook.zh-CN.md)。

上线前至少保留三类证据：

1. Runtime 语义恢复：执行 `npm run host:backup-restore-smoke -- --required`，确认语义快照覆盖 runs、outbox、worker、webhook、audit、files、commercial、RAG、identity、risk、settings 和 provider invocation 等领域。
2. Migration 升级安全：执行 `npm run host:upgrade-migration-smoke -- --required`，确认 migration 文件顺序、幂等、必需表覆盖和非破坏性语句。
3. 本地物理恢复 smoke：执行 `npm run host:postgres-physical-restore-smoke -- --required`，用两个隔离 Docker Postgres 容器验证 `pg_dump`/`pg_restore` 和 runtime store 数据指纹。
4. 目标环境物理恢复：在隔离 Postgres 库中恢复部署环境 `pg_dump`、托管快照或 WAL/PITR，然后运行 `npm run runtime:stores:verify`、`npm run data:verify-db -- --database-url <restore-url>` 和 `npm run host:postgres-local-smoke -- --no-docker`。

对象存储和 secrets 需要单独演练：确认文件对象版本化/复制可恢复，确认 auth secret、provider secret、service connection secret 和 webhook signing secret 能从 secret manager 恢复。不要把 `host:backup-restore-smoke` 当作这些外部资产的物理恢复证据。

## 故障排查

- `host:config-doctor` 报错时，先看 worker 心跳和生产环境变量。
- browser/accessibility 失败时，先确认 `HOST_SMOKE_BASE_URL` 指向真实 host。
- RC gate 失败时，先分辨是宿主缺证据还是模块自身缺证据。
- 恢复演练失败时，先区分是 runtime store schema/migration 问题、Data v2 模块表问题、对象存储缺对象，还是 secret/provider 配置缺失。
