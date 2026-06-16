# 发布候选检查清单

这份清单用于 RC gate 前的人工确认。

## 必跑项

```bash
npm run typecheck
npm run host:build
npm run host:provider-matrix -- --required
PLOYKIT_PROVIDER_MATRIX_EXTERNAL=1 npm run host:provider-matrix -- --required
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
npm run host:dashboard-transition-smoke -- --required --base-url <host-url> --repeat 3 --inject-anchor
npm run release:maintainer-gate
```

## 判定口径

- 先看宿主级证据是否齐全，再看模块级证据是否齐全。
- 没有真实 S3、Stripe、Email、AI/RAG 凭据时，`provider-live-matrix` 只能算本地证据；
  真实 provider 放行按
  [真实 Provider Smoke 运维手册](real-provider-smoke-runbook.zh-CN.md) 执行并归档。
- 浏览器矩阵和可访问性矩阵的缺口，优先当作宿主路由或渲染问题处理。
- Dashboard transition 证据必须包含 `repeat>=3`、`--inject-anchor`、`appFramePresent=true`、`clientTransitionMarkerPresent=true` 和 `injectedAnchorInAppFrame=true`，证明宿主 AppFrame 已挂载且能接管模块输出的普通内部 `<a>`。
- 线上 Dashboard 复测应追加 `--no-latest` 并归档时间戳目录，避免失败的外部环境证据覆盖本地 RC gate 的 `latest.json`。
- `module:quality` 里的 RunLynk 失败，只能在 RunLynk 模块目录里修，不要升格成宿主专属规则。

## 复核

- 证据必须是最新的 `latest.json`。
- 证据中的 `required=true` 才能用于 RC gate。
- 任何新的占位文档、未完成 TODO 或临时跳过都应先修复再放行。
