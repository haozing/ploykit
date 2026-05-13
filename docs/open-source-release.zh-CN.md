# 开源发布清单

公开发布 PloyKit 仓库或打公开 release tag 前，使用这个清单检查。

## 仓库元数据

- 添加 `LICENSE` 文件。
- 在 `package.json` 设置 `license`、`repository`、`bugs` 和 `homepage`。
- 决定应用是否继续保留 `"private": true`，或者制定 package 发布策略。
- 检查 README 链接、docs 链接和脚本引用是否有效。

## 环境变量与 Fixture

- 检查 `.env.example` 和 `.env.docker.example`，确保只包含占位符或本地 fixture。
- 明确标注本地测试凭据是 fixture。
- 确认 secrets、tokens、webhooks 和云存储值没有被提交。
- 如果对外宣称密码重置生产可用，先验证生产投递实现。

## 脚本与文档

- 检查 `docs/`，移除内部报告、过期计划或一次性验收产物。
- 检查 `scripts/`，移除本地调试脚本、一次性数据变更工具或依赖私有基础设施的脚本。
- 面向发布的验收脚本保留在 [../scripts/README.md](../scripts/README.md) 中说明。
- 按 [open-source-media-assets.zh-CN.md](open-source-media-assets.zh-CN.md)
  准备 P0 多媒体资源，并替换 `public/` 中的 Next.js 默认资产。

## 验证

至少运行：

```bash
npm run format:check
npm run typecheck
npm run lint
npm run test:run
npm run plugins:check
npm run db:verify
npm run test:security-audit
```

运行时敏感 release 还要运行：

```bash
npm run verify:runtime
npm run test:real
npm run test:human
```

## Release Notes

- 记录 [project-scope.zh-CN.md](project-scope.zh-CN.md) 中的已知产品边界。
- 说明 auth、插件密钥、数据库、存储和计费所需的环境变量。
- 列出自托管用户必须运行的迁移或 seed 命令。
