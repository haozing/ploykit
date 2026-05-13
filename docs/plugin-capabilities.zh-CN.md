# 插件能力与权限参考

插件应通过 `ctx.*` capability 使用宿主能力，并在 `plugin.ts` 声明匹配权限。这样生成的插件代码才保持局部、可测试、可审查。

| Capability          | 常用权限                                                                                  | 用途                                               |
| ------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `ctx.storage`       | `Permission.StorageRead`, `Permission.StorageWrite`                                       | 插件私有结构化记录，来自 `data.collections` 声明。 |
| `ctx.config`        | `Permission.ConfigRead`, `Permission.ConfigWrite`                                         | 非密钥插件配置。                                   |
| `ctx.secrets`       | `Permission.SecretsRead`, `Permission.SecretsWrite`                                       | API key、签名密钥和 connector 凭据。               |
| `ctx.files`         | `Permission.FilesRead`, `Permission.FilesWrite`                                           | 上传、下载、签名 URL 与文件 metadata。             |
| `ctx.artifacts`     | `Permission.ArtifactsRead`, `Permission.ArtifactsWrite`                                   | 文本产物、生成报告和 workspace 文件。              |
| `ctx.rag`           | `Permission.RagRead`, `Permission.RagWrite`                                               | 插件上下文索引与检索。                             |
| `ctx.ai`            | `Permission.AiGenerate`, `Permission.AiEmbed`                                             | 宿主注入的文本生成、流式生成和 embeddings。        |
| `ctx.runs`          | `Permission.RunsRead`, `Permission.RunsWrite`                                             | 长任务、进度、日志和结果。                         |
| `ctx.connectors`    | `Permission.ConnectorsRead`, `Permission.ConnectorsInvoke`, `Permission.ConnectorsManage` | 托管外部服务 profile 与调用。                      |
| `ctx.http.fetch`    | `Permission.ExternalHttp` plus `egress`                                                   | 经过 SSRF-aware egress guard 的直接外部 HTTP。     |
| `ctx.workspace`     | `Permission.WorkspaceRead`, `Permission.WorkspaceWrite`                                   | workspace 查询、成员、角色和邀请。                 |
| `ctx.events`        | `Permission.EventsEmit`, `Permission.EventsSubscribe`                                     | 插件与平台事件流。                                 |
| `ctx.jobs`          | `Permission.JobsEnqueue`, `Permission.JobsRegister`                                       | 后台任务和定时任务。                               |
| `ctx.webhooks`      | `Permission.WebhookReceive`                                                               | webhook 验签和 accepted response。                 |
| `ctx.apiKeys`       | `Permission.ApiKeysRead`, `Permission.ApiKeysWrite`                                       | 插件作用域 API keys。                              |
| `ctx.rateLimit`     | `Permission.RateLimitCheck`                                                               | public 或高成本操作的作用域限流检查。              |
| `ctx.audit`         | `Permission.AuditWrite`                                                                   | 用户可见或敏感动作的审计记录。                     |
| `ctx.usage`         | `Permission.UsageWrite`                                                                   | 用量计数与分析。                                   |
| `ctx.metering`      | `Permission.MeteringWrite`                                                                | 计费动作授权、提交、退款、作废和对账。             |
| `ctx.credits`       | `Permission.CreditsRead`, `Permission.CreditsConsume`                                     | 用户积分余额与消耗。                               |
| `ctx.billing`       | `Permission.BillingRead`, `Permission.BillingWrite`                                       | 计划、权益、授予和兑换流程。                       |
| `ctx.notifications` | `Permission.NotificationsSend`                                                            | 站内或邮件通知。                                   |
| `ctx.ui.toast`      | `Permission.UiToast`                                                                      | 插件 UI 流程中的可选用户反馈。                     |

## AI 生成插件的规则

- 从最小权限开始。
- 只有代码确实使用对应 `ctx.*` capability 时才添加权限。
- Public API 必须声明 `anonymousPolicy`。
- 外部 HTTP 同时需要 `Permission.ExternalHttp` 和 `egress`。
- AI 调用如果可计费，应声明插件命名空间 meter，例如 `invoice-helper.ai.generate`。
- Secrets 放在 `ctx.secrets`，不要放到 config、源码或环境变量里。
- 长任务放到 `ctx.runs` 和 jobs，不要塞进请求响应 handler。
