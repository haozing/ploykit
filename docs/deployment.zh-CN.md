# 部署说明

PloyKit 的部署还是本地优先、Docker 优先。真实数据库和浏览器证据
尽量在本地或 Docker 环境里跑完。

## 本地开发

```bash
npm run db:up
npm run runtime:stores:migrate
npm run runtime:stores:verify
npm run host:dev
```

## 生产式验证

```bash
npm run host:build
npm run host:start
```

## 数据库验证

```bash
npm run data:migrate -- --database-url postgres://ploykit:ploykit@127.0.0.1:55432/ploykit
npm run data:verify-db -- --database-url postgres://ploykit:ploykit@127.0.0.1:55432/ploykit
```

## Runtime Store 基线策略

当前 PloyKit runtime store 以 `migrations/runtime/*.sql` 和 Data v2 模块
migration 作为可重建基线。新生产环境应从空 Postgres 库开始执行：

```bash
npm run runtime:stores:migrate
npm run runtime:stores:verify
npm run data:migrate -- --database-url <database-url>
npm run data:verify-db -- --database-url <database-url>
```

这条基线只承诺“从空库重建当前 schema”。它不是历史数据库自动迁移承诺。
如果现有环境选择不迁移旧数据，发布说明必须显式写明：新版本需要新建或重建
runtime store 数据库，旧库只可作为归档或人工迁移源，不会被脚本自动升级为当前
生产基线。

## 备份与恢复策略

发布前应同时覆盖语义 smoke 和物理备份恢复：

- `npm run host:backup-restore-smoke -- --required` 验证 runtime store 语义快照、恢复计划和领域覆盖，但不证明 `pg_dump`、WAL/PITR、对象存储或 secrets 可恢复。
- `npm run host:upgrade-migration-smoke -- --required` 验证 runtime migration 顺序、覆盖、幂等和非破坏性语句。
- `npm run host:postgres-physical-restore-smoke -- --required` 使用两个隔离 Docker Postgres 容器执行本地 `pg_dump`/`pg_restore`，并用 runtime schema 与代表性 runtime store 数据指纹校验恢复库。
- Postgres 物理备份应由部署环境执行 `pg_dump` 或托管数据库快照，并在隔离库中恢复后运行 `npm run runtime:stores:verify`、`npm run data:verify-db -- --database-url <restore-url>` 和 `npm run host:postgres-local-smoke -- --no-docker`。
- WAL/PITR 属于数据库平台能力，必须在托管数据库或自管 Postgres 的独立恢复环境中演练，记录恢复时间点、目标库、校验命令和证据路径。
- 文件对象存储、provider secret、auth secret 和 service connection secret 不在 Postgres 备份内，必须使用对象存储版本化/复制和 secret manager 导出或恢复演练单独覆盖。

## 发布前门禁

这些门禁用于宿主 / 产品发布。模块本地开发不要为了单个模块把模块路由或模块专属 E2E 写进全局 RC、browser matrix 或 accessibility smoke；模块自有外部链路先记录在模块 README 中，说明前置条件、命令和证据路径。

```bash
npm run module:doctor -- <module-id>
npm run module:test -- <module-id>
npm run modules:scan
npm run modules:check
npm run host:boundary-check
npm run release:local-gate
npm run release:integration-gate
```

维护者正式发布前再运行：

```bash
npm run release:maintainer-gate
```

`modules:check` 和所有 release gate 脚本都会先跑 `host:boundary-check`。单独列出
这个命令，是为了在部署前快速定位宿主 / shared 代码是否 import 具体模块、硬编码
module id、`/dashboard/<id>`、模块专属 root script 或模块专属 host quality 路由。

## Admin 视觉验证

```bash
npm run admin:ui-gate
npm run host:browser-matrix -- --required
npm run host:accessibility-smoke -- --required
npm run admin:mobile-handfeel -- --required
npm run admin:visual-baseline
```
