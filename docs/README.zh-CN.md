# 中文文档索引

这里收录 PloyKit 当前维护中的中文文档。根目录 [README.md](../README.md) 是项目总入口，本文档索引用于按主题继续阅读。

## 核心文档

- [模块开发](module-development.zh-CN.md)
- [module.ts 契约规范](module-contract-spec.zh-CN.md)
- [服务端分离型模块开发指南](service-backed-module-development.zh-CN.md)
- [AI 辅助模块开发](ai-module-authoring.zh-CN.md)
- [运行时存储](runtime-stores.zh-CN.md)
- [安全模型](security-model.zh-CN.md)
- [部署说明](deployment.zh-CN.md)
- [产品模块指南](ploykit-product-module-guide.zh-CN.md)

## 模块源

PloyKit 模块源码放在仓库内 `modules/<module-id>/`。根目录 `ploykit.config.json` 默认指向 `modules`：

```json
{
  "moduleSources": [
    { "id": "workspace", "path": "modules" }
  ]
}
```

PloyKit 不再支持从仓库外加载模块源码。服务端、Worker 或第三方 API 可以继续独立在仓库外维护，但 PloyKit module 壳应放在
`modules/<module-id>/`，并通过 `serviceRequirements` 或 host capabilities 调用外部服务。修改模块或模块入口后运行：

```bash
npm run modules:scan
```

## 阅读建议

- 模块作者优先阅读 `module-development.zh-CN.md` 和 `module-contract-spec.zh-CN.md`。
- 需要接入 AI/RAG 的模块，阅读 `ai-module-authoring.zh-CN.md`。
- 准备部署或评估运行时数据边界时，阅读 `deployment.zh-CN.md`、`runtime-stores.zh-CN.md` 和 `security-model.zh-CN.md`。
