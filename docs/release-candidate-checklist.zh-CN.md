# 发布候选检查清单

这份清单用于 RC gate 前的人工确认。

## 必跑项

```bash
npm run typecheck
npm run host:build
npm run host:provider-matrix -- --required
npm run host:worker-soak -- --required
npm run host:chaos-smoke -- --required
npm run host:web-shell-evidence -- --required
npm run module:quality -- --required
npm run host:data-safety -- --required
npm run drift:check -- --reuse-latest --required
npm run host:backup-restore-smoke -- --required
npm run host:upgrade-migration-smoke -- --required
npm run host:browser-matrix -- --required --base-url <host-url>
npm run host:accessibility-smoke -- --required --base-url <host-url>
npm run release:maintainer-gate
```

## 判定口径

- 先看宿主级证据是否齐全，再看模块级证据是否齐全。
- 浏览器矩阵和可访问性矩阵的缺口，优先当作宿主路由或渲染问题处理。
- `module:quality` 里的 RunLynk 失败，只能在 RunLynk 模块目录里修，不要升格成宿主专属规则。

## 复核

- 证据必须是最新的 `latest.json`。
- 证据中的 `required=true` 才能用于 RC gate。
- 任何新的占位文档、未完成 TODO 或临时跳过都应先修复再放行。
