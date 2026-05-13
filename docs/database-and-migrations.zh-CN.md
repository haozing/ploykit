# 数据库与迁移

Schema 位于 `src/lib/db/schema/*`，按领域拆分：core auth、RBAC、entitlements、billing extensions、plugins、plugin storage、plugin platform、files、notifications、audit logs、webhook reliability 和 system settings。

## Drizzle 配置

```ts
schema: './src/lib/db/schema/*';
out: './drizzle/migrations';
dialect: 'postgresql';
```

当前 migration journal 有 24 个 entry，最后一个是 `0023_workspace_scope_consistency`。

## 数据库 Provider

- `DB_PROVIDER=postgres`：使用 `DATABASE_URL`，或配置完整的 `POSTGRES_HOST`、`POSTGRES_DB`、`POSTGRES_USER`、`POSTGRES_PASSWORD`。
- `DB_PROVIDER=neon`：使用 `NEON_DATABASE_URL`。
- `DB_PROVIDER=supabase`：使用 `DATABASE_URL`。

## 命令

```bash
npm run db:generate
npm run db:migrate
npm run db:verify
npm run db:verify:structure
npm run db:init
npm run db:setup
npm run db:setup:seed
npm run seed:tool-site
```

Docker 数据库辅助命令：

```bash
npm run db:docker:up
npm run db:docker:down
npm run db:docker:reset
npm run db:docker:wait
npm run db:docker:verify
npm run db:docker:check
```

## 迁移规则

- 修改 `src/lib/db/schema/*` 后，生成或维护 `drizzle/migrations`，并运行 `npm run db:verify`。
- schema 形态或迁移结构变化时，运行 `npm run db:verify:structure`。
- 涉及 plugin storage、files、connectors、metering、credits、billing 或 webhook reliability 的运行时敏感改动，运行 `npm run verify:runtime`。
- 生产流量进入前先运行迁移。
