# Plugin Capability And Permission Reference

Plugins should use host behavior through `ctx.*` capabilities and declare the
matching permissions in `plugin.ts`. This keeps generated plugin code local,
testable, and reviewable.

| Capability          | Typical permissions                                                                       | Use for                                                         |
| ------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `ctx.storage`       | `Permission.StorageRead`, `Permission.StorageWrite`                                       | Plugin-owned structured records declared in `data.collections`. |
| `ctx.config`        | `Permission.ConfigRead`, `Permission.ConfigWrite`                                         | Non-secret plugin configuration.                                |
| `ctx.secrets`       | `Permission.SecretsRead`, `Permission.SecretsWrite`                                       | API keys, signing secrets, and connector credentials.           |
| `ctx.files`         | `Permission.FilesRead`, `Permission.FilesWrite`                                           | Uploads, downloads, signed URLs, and file metadata.             |
| `ctx.artifacts`     | `Permission.ArtifactsRead`, `Permission.ArtifactsWrite`                                   | Text artifacts, generated reports, and workspace files.         |
| `ctx.rag`           | `Permission.RagRead`, `Permission.RagWrite`                                               | Indexing and searching plugin-owned context.                    |
| `ctx.ai`            | `Permission.AiGenerate`, `Permission.AiEmbed`                                             | Host-injected text generation, streaming, and embeddings.       |
| `ctx.runs`          | `Permission.RunsRead`, `Permission.RunsWrite`                                             | Long-running work, progress, logs, and results.                 |
| `ctx.connectors`    | `Permission.ConnectorsRead`, `Permission.ConnectorsInvoke`, `Permission.ConnectorsManage` | Managed external service profiles and calls.                    |
| `ctx.http.fetch`    | `Permission.ExternalHttp` plus `egress`                                                   | Direct external HTTP through the SSRF-aware egress guard.       |
| `ctx.workspace`     | `Permission.WorkspaceRead`, `Permission.WorkspaceWrite`                                   | Workspace lookup, membership, roles, and invitations.           |
| `ctx.events`        | `Permission.EventsEmit`, `Permission.EventsSubscribe`                                     | Plugin and platform event flows.                                |
| `ctx.jobs`          | `Permission.JobsEnqueue`, `Permission.JobsRegister`                                       | Background work and scheduled jobs.                             |
| `ctx.webhooks`      | `Permission.WebhookReceive`                                                               | Webhook verification and accepted responses.                    |
| `ctx.apiKeys`       | `Permission.ApiKeysRead`, `Permission.ApiKeysWrite`                                       | Plugin-scoped API keys.                                         |
| `ctx.rateLimit`     | `Permission.RateLimitCheck`                                                               | Scoped rate checks for public or expensive operations.          |
| `ctx.audit`         | `Permission.AuditWrite`                                                                   | Audit records for user-visible or sensitive actions.            |
| `ctx.usage`         | `Permission.UsageWrite`                                                                   | Usage counters and analytics.                                   |
| `ctx.metering`      | `Permission.MeteringWrite`                                                                | Billable action authorization, commit, refund, void, reconcile. |
| `ctx.credits`       | `Permission.CreditsRead`, `Permission.CreditsConsume`                                     | User credit balances and credit consumption.                    |
| `ctx.billing`       | `Permission.BillingRead`, `Permission.BillingWrite`                                       | Plans, entitlements, grants, and redemption flows.              |
| `ctx.notifications` | `Permission.NotificationsSend`                                                            | In-app or email notifications.                                  |
| `ctx.ui.toast`      | `Permission.UiToast`                                                                      | Optional user feedback from plugin UI flows.                    |

## Rules For AI-Generated Plugins

- Start with the smallest permission set.
- Add permissions only when code uses the matching `ctx.*` capability.
- Public APIs must declare `anonymousPolicy`.
- External HTTP requires both `Permission.ExternalHttp` and `egress`.
- AI calls should declare plugin-namespaced meters when billable, for example
  `invoice-helper.ai.generate`.
- Secrets belong in `ctx.secrets`, not in config, source files, or environment
  variables.
- Long work belongs in `ctx.runs` and jobs, not request/response handlers.
