# PloyKit 全仓代码审计修复报告

日期：2026-06-27

依据：`docs/llm/ploykit-full-code-audit-plan.md`

对象：当前 clean-slate 工作区，基线提交 `7c2c0fb`。

## 总体结论

本轮已经修复上一版审计报告中列出的 clean-slate 架构问题。模块 authoring 层保持单一当前合同；host auth 不再接受旧 session/token 格式；in-memory commercial redeem code 不再保留旧配置码旁路或 `legacy:` fallback；release gate 文案已去掉版本迁移叙事；空 `assets: {}` 推荐也已移除。

本轮也补齐了 Data runtime 的 Postgres 证据：Docker Desktop 已启动，复用本机已有的 `ploykit-v2-postgres` 容器后，`npm run test:data-runtime` 已通过。

## 已修复项

### F1. Host auth 旧 session/token 格式兼容

- 状态：已修复
- 代码：`apps/host-next/lib/auth.ts:37` 定义唯一当前格式 `current`；`apps/host-next/lib/auth.ts:348` 生成 `current.<kid>.<payload>.<signature>`；`apps/host-next/lib/auth.ts:354` 只接受当前格式；`apps/host-next/lib/auth.ts:386` 生成当前 token hash；`apps/host-next/lib/auth.ts:703` 不再 fallback 到旧 token hash。
- 测试：`tests/web-shell-auth.test.ts:71` 验证当前 cookie 格式；`tests/web-shell-auth.test.ts:73` 验证旧 `v3` marker 被拒绝。
- 说明：保留 `kid` 只是密钥轮换能力，不是旧数据版本兼容。

### F2. Commercial redeem code 旧配置码和 `legacy:` fallback

- 状态：已修复
- 代码：`src/lib/module-capabilities/commercial/commercial-runtime.ts:42` 的 options 不再包含旧 `redeemCodes` 配置表；`src/lib/module-capabilities/commercial/commercial-runtime.ts:803` 的 `billing.redeemCode` 改为走当前 `redeemCodes.redeem`；`src/lib/module-capabilities/commercial/commercial-runtime.ts:1003` 未找到当前 redeem record 时直接失败；`src/lib/module-capabilities/commercial/commercial-runtime.ts:1011` redemption id 只来自当前记录 `record.id`。
- 测试：`tests/production-runtime.test.ts:711` 改为验证未声明 redeem code 被拒绝，并验证当前 `createBatch` 生成的两个 code 互相隔离。

### F3. Release gate 版本迁移叙事

- 状态：已修复
- 代码：`src/lib/module-runtime/release/rc-gate.ts:57` 改为 current module host；`src/lib/module-runtime/release/rc-gate.ts:73` 改为 governed module data；`src/lib/module-runtime/release/rc-gate.ts:141` 和 `src/lib/module-runtime/release/rc-gate.ts:998` 改为 removed-entry scan。
- 测试：`tests/release-candidate.test.ts:36` 的 cleanup fixture 也改为当前 runtime 叙事。
- 说明：检查 id 未改，避免扩大 release evidence 兼容面。

### F4. 空 `assets: {}` 推荐和示例噪音

- 状态：已修复
- 代码：`src/module-sdk/validator-clean-contract.ts` 已删除 `MODULE_ASSETS_RECOMMENDED`；`modules/platform-smoke`、`modules/public-tool-smoke`、`modules/resource-smoke`、`templates/modules/app`、`templates/modules/connector`、`templates/modules/resource`、`templates/modules/tool` 已删除无内容的 `assets: {}`。
- 保留规则：旧静态资源入口仍被拒绝，`src/module-sdk/validator-clean-contract.ts:991` 继续产生 `MODULE_CLEAN_STATIC_RESOURCES_MOVED`。
- 生成文档：`docs/llm/errors.generated.md` 已刷新，不再包含 `MODULE_ASSETS_RECOMMENDED`。

### R1/R2. 审计过程发现的门禁漂移

- 状态：已修复
- 内容：审计计划中的不存在脚本名已改为 `npm run test:web-shell`；`tests/module-map-cli.test.ts` 的图标 fixture 已从旧 `resources.icons` 改为 `assets.icons`。

## 复审结果

### 单合同和 clean-slate authoring

通过。`ModuleDefinition` 仍只公开当前 `pages`、`apis`、`assets`、`resources` 等入口；旧 `contractVersion`、author-facing `routes`、`resources.locales/icons/assets`、`resources.pages` 没有作为有效输入存在。

### Host 旧数据兼容残留

已清理本轮确认的旧兼容路径。剩余命中主要是：

- 测试里故意构造旧 `v3` cookie marker，证明会被拒绝。
- `scrypt-v1` 是密码 hash 算法标识，不是 session/token 数据兼容分支。
- 第三方 API 路径里的 `/v1/` 属于外部服务路径，不是 PloyKit 合同版本。

### Commercial 完整性

通过。当前 redeem code 必须来自 runtime 创建的当前记录；未声明 code 直接失败；已创建 code 的 entitlement、credits、max redemptions、bind、expired/frozen/revoked 规则继续由现有测试覆盖。

### 模板和参考模块

通过。四个模板和三个 smoke 模块不再强迫空 `assets` 字段；静态资源仍必须声明在 `assets`，业务资源仍声明在 `resources`。

## 验证结果

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `npx tsx --test tests/web-shell-auth.test.ts tests/web-shell-identity.test.ts tests/web-shell.test.ts` | 通过 | auth 当前格式、旧 marker 拒绝、session 行为 |
| `npm run test:production-runtime` | 通过 | commercial runtime 当前 redeem code 行为 |
| `npm run test:commercial-ledger` | 通过 | runtime-store commercial ledger 未回归 |
| `npm run test:release-candidate` | 通过 | release gate 文案/扫描行为未回归 |
| `npm run test:module-contract` | 通过 | SDK contract clean-slate 规则 |
| `npm run test:module-doctor` | 通过 | doctor contract/runtime checks |
| `npm run modules:check` | 通过 | module map、LLM wiki、host boundary、module check |
| `docker start ploykit-v2-postgres` | 通过 | 复用本机已有 Postgres 容器 |
| `npm run test:data-runtime` | 通过 | Postgres CRUD/RLS/rollback 子测试已补验 |

## Docker / Data Runtime 状态

Docker CLI 可用。本轮先尝试 `npm run db:up`，但当前机器已有同名历史容器 `ploykit-v2-postgres`，`docker compose up -d postgres` 因容器名冲突失败：

```text
Conflict. The container name "/ploykit-v2-postgres" is already in use
```

检查后该容器可启动，执行 `docker start ploykit-v2-postgres` 后，`npm run test:data-runtime` 通过。这个容器来自旧 compose working dir，不是当前 `D:\code\ploykit` 的 compose 项目；因此代码证据已补齐，但本机 Docker 项目状态仍建议后续整理。

## 当前残留风险

- 工作区仍是大规模未提交状态，审计基线需要在提交后从 clean checkout 重跑。
- 本机已有同名 Postgres 容器来自旧 compose 项目，`npm run db:up` 仍会遇到容器名冲突。测试已通过，但 Docker compose 项目状态需要人工清理或改名。
- 报告中的“v2”剩余命中如果出现在 Data capability 概念文档里，属于当前 data capability 命名；如果后续也要去掉产品名里的数字，需要另开一次命名清理。

## 建议下一步

1. 整理本机 Docker compose 项目状态，避免 `ploykit-v2-postgres` 容器名冲突继续影响 `npm run db:up`。
2. 跑一次全量核心门禁：`npm run typecheck`、`npm run modules:check`、`npm run test:web-shell`、`npm run test:security-runtime`、`npm run test:advanced-runtime`。
3. 将 clean-slate 迁移分组提交，使审计结论可复现。
