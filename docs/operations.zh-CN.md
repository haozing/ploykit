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

## 故障排查

- `host:config-doctor` 报错时，先看 worker 心跳和生产环境变量。
- browser/accessibility 失败时，先确认 `HOST_SMOKE_BASE_URL` 指向真实 host。
- RC gate 失败时，先分辨是宿主缺证据还是模块自身缺证据。
