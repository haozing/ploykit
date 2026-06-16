# 中文文档索引

这里收录 PloyKit 当前维护中的中文文档。根目录 [README.md](../README.md) 是项目总入口，本文档索引用于按主题继续阅读。

## 核心文档

- [模块开发](module-development.zh-CN.md)
- [module.ts 契约规范](module-contract-spec.zh-CN.md)
- [服务端分离型模块开发指南](service-backed-module-development.zh-CN.md)
- [受控服务接入指南](service-integration-guide.zh-CN.md)
- [AI 辅助模块开发](ai-module-authoring.zh-CN.md)
- [产品模块指南](ploykit-product-module-guide.zh-CN.md)

## 运行与发布

- [运行时存储](runtime-stores.zh-CN.md)
- [安全模型](security-model.zh-CN.md)
- [部署说明](deployment.zh-CN.md)
- [运营手册](operations.zh-CN.md)
- [Postgres Baseline 与 PITR 运维手册](postgres-baseline-pitr-runbook.zh-CN.md)
- [真实 Provider Smoke 运维手册](real-provider-smoke-runbook.zh-CN.md)
- [发布候选检查清单](release-candidate-checklist.zh-CN.md)
- [安全执行边界图](security-enforcement-map.zh-CN.md)

## 治理与审计

### 方法论与当前分析

- [生产级架构与代码治理分析手册](production-grade-analysis-playbook.zh-CN.md)
- [2026-06-14 全量代码分析报告](production-grade-code-analysis-2026-06-14.zh-CN.md)
- [2026-06-14 Origin AgentOps 模块性能分析](origin-agentops-module-performance-analysis-2026-06-14.zh-CN.md)

### 历史审计与迁移计划

以下文档保留历史状态、迁移路线或一次性治理任务的证据；阅读时应以文内日期和状态说明为准。

- [项目代码审计](project-code-audit.zh-CN.md)
- [移除外部模块计划](remove-external-modules-plan.zh-CN.md)
- [受控服务调用计划](module-service-invocation-plan.zh-CN.md)
- [宿主商业核心原语计划](host-commercial-core-primitives-plan.zh-CN.md)

## 模块源

PloyKit 模块源码放在仓库内 `modules/<module-id>/`。根目录 `ploykit.config.json` 默认指向 `modules`：

```json
{
  "moduleSources": [{ "id": "workspace", "path": "modules" }]
}
```

PloyKit 不再支持从仓库外加载模块源码。服务端、Worker 或第三方 API 可以继续独立在仓库外维护，但 PloyKit module 壳应放在
`modules/<module-id>/`，并通过 `serviceRequirements` 或 host capabilities 调用外部服务。修改模块或模块入口后运行：

```bash
npm run modules:scan
```

## 默认模块等级

内置模块按使用边界分为三类：

- Fixture：只用于测试运行时最小能力，不作为产品样板。
- Demo：展示宿主能力广度，不承诺生产业务完整性。
- Reference：可作为真实产品模块的骨架参考，仍需按目标产品补业务证据。

| 模块                    | 等级           | 使用边界                                                     |
| ----------------------- | -------------- | ------------------------------------------------------------ |
| `hello`                 | Fixture        | 最小运行时夹具和契约冒烟模块                                 |
| `public-tools-demo`     | Reference      | 公开工具模块样板                                             |
| `cms-demo`              | Reference      | 内容、CRUD 和文件能力样板                                    |
| `shop-demo`             | Demo/Reference | 商业链路样板，生产使用前需补并发、真实 provider 和数据库证据 |
| `capability-demo`       | Demo           | 能力展示模块，不应直接照搬权限范围                           |
| `ai-rag-demo`           | Demo/Reference | AI/RAG 样板，生产使用需明确成本控制和匿名访问策略            |
| `white-label-site-demo` | Reference      | 白标页面和 presentation override 样板                        |

## 阅读建议

- 模块作者优先阅读 `module-development.zh-CN.md` 和 `module-contract-spec.zh-CN.md`。
- 需要接入 AI/RAG 的模块，阅读 `ai-module-authoring.zh-CN.md`。
- 准备部署或评估运行时数据边界时，阅读 `deployment.zh-CN.md`、`runtime-stores.zh-CN.md` 和 `security-model.zh-CN.md`。
- 评审生产级改造、发布证据或安全执行边界时，阅读“治理与审计”分组中的方法论、当前分析和发布边界文档。
