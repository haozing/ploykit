# 中文文档索引

这里收录 PloyKit 当前维护中的中文文档。根目录 [README.md](../README.md) 是项目总入口，本文档索引用于按主题继续阅读。

## 核心文档

- [模块开发](module-development.zh-CN.md)
- [module.ts 契约规范](module-contract-spec.zh-CN.md)
- [AI 辅助模块开发](ai-module-authoring.zh-CN.md)
- [运行时存储](runtime-stores.zh-CN.md)
- [安全模型](security-model.zh-CN.md)
- [部署说明](deployment.zh-CN.md)
- [产品模块指南](ploykit-product-module-guide.zh-CN.md)

## 模块源

PloyKit 通过根目录 `ploykit.config.json` 配置模块源：

```json
{
  "moduleSources": [
    { "id": "workspace", "path": "modules" },
    { "id": "client-a", "path": "../client-a-ploykit-modules" }
  ],
  "trustedModuleRoots": [".", ".."]
}
```

`moduleSources` 可以指向仓库内目录，也可以指向仓库外的可信本地源码目录。仓库外目录必须被 `trustedModuleRoots` 覆盖。修改配置或模块入口后运行：

```bash
npm run modules:scan
```

## 阅读建议

- 模块作者优先阅读 `module-development.zh-CN.md` 和 `module-contract-spec.zh-CN.md`。
- 需要接入 AI/RAG 的模块，阅读 `ai-module-authoring.zh-CN.md`。
- 准备部署或评估运行时数据边界时，阅读 `deployment.zh-CN.md`、`runtime-stores.zh-CN.md` 和 `security-model.zh-CN.md`。
