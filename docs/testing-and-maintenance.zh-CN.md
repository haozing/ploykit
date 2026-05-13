# 测试与维护门禁

根据改动风险选择最小足够的门禁；如果改动触及共享运行时、数据库合同、公开路由或用户可见流程，就扩大验证范围。

## 快速本地检查

```bash
npm run typecheck
npm run lint
npm run format:check
npm run test:run
```

## 仓库验证

```bash
npm run verify
npm run plugins:check
npm run plugins:templates
npm run runtime:check
```

## 真实链路 Smoke

```bash
npm run test:real
npm run test:real:reset
npm run test:real:prepare
```

## 浏览器与模拟人工 E2E

```bash
npm run test:human
npm run test:human:headed
npm run test:admin:human
```

## 验收矩阵

验收矩阵以 npm scripts 暴露，例如：

```bash
npm run test:browser-matrix:build
npm run test:workspace-scope
npm run test:stripe-provider
npm run test:storage-drivers
npm run test:accessibility:build
npm run test:upgrade-migration
npm run test:capacity:build
npm run test:soak:build
npm run test:backup-restore
npm run test:security-audit
npm run test:chaos
npm run test:delivery-docs
```

多数长任务脚本会把摘要写入 `test-results/`。

## 维护规则

- 修改 `src/lib/db/schema/*` 后，生成或维护 `drizzle/migrations`，并运行 `npm run db:verify`。
- 修改 `plugins/*/plugin.ts` 或插件 pages、APIs、jobs、events、webhooks、lifecycle handlers、assets 后，运行 `npm run plugins:scan`。
- 修改插件合同、SDK、运行时检查或模板后，运行 `npm run plugins:check` 和 `npm run plugins:templates`。
- 涉及数据库、文件、connectors、metering、匿名 public APIs、egress 或运行时能力时，至少运行 `npm run test:real`。
- 涉及用户可见页面或后台工作流时，补充 `npm run test:human` 或相关 Playwright spec。
- 合并较大改动前运行 `npm run verify`；运行时敏感改动再运行 `npm run verify:runtime`。
