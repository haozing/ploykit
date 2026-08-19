# PloyKit 脚本入口

`package.json` 只暴露日常开发、模块开发、核心校验和发布闸门。一次性运维动作不再各占一个 npm script。

## 日常入口

```text
npm run host:dev
npm run host:build
npm run host:start
npm run modules:check
npm run module:doctor -- <module-id>
npm run module:test -- <module-id>
npm run test -- <group>
npm run check -- <check>
npm run release:local-gate
npm run release:integration-gate
npm run release:maintainer-gate
```

测试分组为 `module`、`runtime`、`web`、`commercial`、`security`、`ai`、`release` 和 `all`。

校验分组为 `docs`、`presentation`、`theme`、`i18n`、`seo`、`white-label`、`drift` 和 `all`。

## 运维入口

供应商 smoke、备份恢复、数据安全、邮件、文件清理、worker soak 等动作统一通过：

```text
npm run ops -- <operation> [args]
```

可用 operation 由 `scripts/ops.mjs` 明确列出。新增一次性运维脚本时，只更新该映射，不新增顶层 npm script。

## 约束

- 不新增模块专属 `host:*`、`module:*` 或供应商专属顶层脚本。
- 不把一次性 smoke、真实供应商凭据检查和恢复演练混入日常 `test` 或 `check` 默认组。
- 已删除的模块质量声明、模块专属性能证据和旧入口不保留兼容别名。
