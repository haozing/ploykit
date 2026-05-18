# 插件能力与权限参考

插件应通过 `ctx.*` capability 使用宿主能力，并在 `plugin.ts` 声明匹配权限。这样生成的插件代码才保持局部、可测试、可审查。

如果插件需要扩展或覆盖宿主页面，见 [宿主页面插槽与覆盖](host-page-overrides.zh-CN.md)。

如果插件需要使用宿主已安装的 npm 组件库或运行时库，在插件根目录声明 `plugin.dependencies.json`，并确保宿主根 `package.json` 也把它列为运行时依赖。模型 provider、数据库驱动、密钥型外部服务和复杂领域能力不建议作为普通插件依赖，优先沉到宿主 capability。

| Capability          | 常用权限                                                                                  | 用途                                                  |
| ------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `ctx.storage`       | `Permission.StorageRead`, `Permission.StorageWrite`                                       | 插件私有结构化记录，来自 `data.collections` 声明。    |
| `ctx.config`        | `Permission.ConfigRead`, `Permission.ConfigWrite`                                         | 非密钥插件配置。                                      |
| `ctx.secrets`       | `Permission.SecretsRead`, `Permission.SecretsWrite`                                       | API key、签名密钥和 connector 凭据。                  |
| `ctx.files`         | `Permission.FilesRead`, `Permission.FilesWrite`                                           | 上传、下载、签名 URL 与文件 metadata。                |
| `ctx.artifacts`     | `Permission.ArtifactsRead`, `Permission.ArtifactsWrite`                                   | 文本产物、生成报告和 workspace 文件。                 |
| `ctx.rag`           | `Permission.RagRead`, `Permission.RagWrite`                                               | 插件上下文索引与检索。                                |
| `ctx.ai`            | `Permission.AiGenerate`, `Permission.AiEmbed`                                             | 宿主注入的文本生成、流式生成和 embeddings。           |
| `ctx.runs`          | `Permission.RunsRead`, `Permission.RunsWrite`                                             | 长任务、进度、日志和结果。                            |
| `ctx.connectors`    | `Permission.ConnectorsRead`, `Permission.ConnectorsInvoke`, `Permission.ConnectorsManage` | 托管外部服务 profile 与调用。                         |
| `ctx.services`      | `Permission.ServicesInvoke`                                                               | 宿主管理的服务连接，用于复杂领域或数据库工作。        |
| `ctx.http.fetch`    | `Permission.ExternalHttp` plus `egress`                                                   | 经过 SSRF-aware egress guard 的直接外部 HTTP。        |
| `ctx.workspace`     | `Permission.WorkspaceRead`, `Permission.WorkspaceWrite`                                   | workspace 查询、成员、角色和邀请。                    |
| `ctx.events`        | `Permission.EventsEmit`, `Permission.EventsSubscribe`                                     | 插件与平台事件流。                                    |
| `ctx.jobs`          | `Permission.JobsEnqueue`, `Permission.JobsRegister`                                       | 后台任务和定时任务。                                  |
| `ctx.webhooks`      | `Permission.WebhookReceive`                                                               | webhook 验签和 accepted response。                    |
| `ctx.apiKeys`       | `Permission.ApiKeysRead`, `Permission.ApiKeysWrite`                                       | 插件作用域 API keys。                                 |
| `ctx.rateLimit`     | `Permission.RateLimitCheck`                                                               | public 或高成本操作的作用域限流检查。                 |
| `ctx.audit`         | `Permission.AuditWrite`                                                                   | 用户可见或敏感动作的审计记录。                        |
| `ctx.usage`         | `Permission.UsageWrite`                                                                   | 用量计数与分析。                                      |
| `ctx.metering`      | `Permission.MeteringWrite`                                                                | 计费动作授权、提交、退款、作废和对账。                |
| `ctx.credits`       | `Permission.CreditsRead`, `Permission.CreditsConsume`                                     | 用户积分余额与消耗。                                  |
| `ctx.billing`       | `Permission.BillingRead`, `Permission.BillingWrite`                                       | 计划、权益、授予和兑换流程。                          |
| `ctx.notifications` | `Permission.NotificationsSend`                                                            | 站内或邮件通知。                                      |
| `ctx.ui.toast`      | `Permission.UiToast`                                                                      | 插件 UI 流程中的可选用户反馈。                        |
| Host Page Slots     | `Permission.HostPageExtend`, `Permission.HostPageOverride`                                | 扩展或覆盖宿主自带页面，由宿主治理 SEO、i18n 和回退。 |

## 推荐组合路径

复杂插件不要把所有事情塞进一个 API handler。优先按能力边界组合：

| 场景                 | 推荐路径                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| 简单插件私有数据     | `data.collections` + `ctx.storage`。                                                               |
| 复杂数据库或领域查询 | 宿主 service/repository + `ctx.services`，插件不直接访问数据库。                                   |
| 宿主页面扩展         | `hostPages.slots`；整页主内容替换用 `hostPages.overrides`，并声明 SEO、i18n、shell 和 cache。      |
| npm UI/运行时组件    | `plugin.dependencies.json` + 宿主根 `package.json` 运行时依赖；插件代码正常 import。               |
| 可计费同步动作       | route/API commercial gate + `ctx.metering.authorize()` + 业务动作 + `ctx.metering.commit()`。      |
| 长任务或工作流       | public/API handler 创建 `ctx.runs`，再 enqueue `ctx.jobs`，job 更新进度、结果，并按需 emit event。 |
| 外部系统集成         | 无凭据短调用用 `ctx.http.fetch`；有凭据、重试、审计或脱敏要求用 `ctx.connectors`。                 |
| 宿主管理服务调用     | 走 `ctx.services`，由宿主管理 URL、凭据、actor claims、超时、重试、审计和用量。                    |

推荐的异步商业化流程：

1. API route 通过 `commercial` 或 `ctx.metering.authorize()` 做访问和额度判断。
2. 创建 `ctx.runs` 记录输入、成本引用和初始状态。
3. 使用 `ctx.jobs` 把实际工作放到后台执行。
4. job 内调用 `ctx.services` 或 `ctx.connectors` 完成复杂数据库或外部系统工作。
5. 成功后 `ctx.metering.commit()`，失败时 `refund` 或 `void`。
6. 写入 run log/result，必要时 `ctx.events.emit()` 和 `ctx.notifications.send()`。

## AI 生成插件的规则

- 从最小权限开始。
- 只有代码确实使用对应 `ctx.*` capability 时才添加权限。
- Public API 必须声明 `anonymousPolicy`。
- 外部 HTTP 同时需要 `Permission.ExternalHttp` 和 `egress`。
- 外部 npm 包要写入 `plugin.dependencies.json`，并确认宿主根 `package.json` 运行时依赖里也有同名包。
- AI 调用如果可计费，应声明插件命名空间 meter，例如 `invoice-helper.ai.generate`。
- Secrets 放在 `ctx.secrets`，不要放到 config、源码或环境变量里。
- 长任务放到 `ctx.runs` 和 jobs，不要塞进请求响应 handler。
