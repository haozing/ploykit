# Plugin Capability And Permission Reference

Plugins should use host behavior through `ctx.*` capabilities and declare the
matching permissions in `plugin.ts`. This keeps generated plugin code local,
testable, and reviewable.

For plugins that need to extend or override host-owned pages, see
[host page slots and overrides](host-page-overrides.md).

When a plugin needs an npm component or runtime library already installed by the
host, declare it in `plugin.dependencies.json` and make sure the host root
`package.json` lists it as a runtime dependency. Model providers, database
drivers, credentialed external services, and complex domain abilities should
usually live behind host capabilities instead of ordinary plugin imports.

| Capability          | Typical permissions                                                                       | Use for                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `ctx.storage`       | `Permission.StorageRead`, `Permission.StorageWrite`                                       | Plugin-owned structured records declared in `data.collections`.                 |
| `ctx.config`        | `Permission.ConfigRead`, `Permission.ConfigWrite`                                         | Non-secret plugin configuration.                                                |
| `ctx.secrets`       | `Permission.SecretsRead`, `Permission.SecretsWrite`                                       | API keys, signing secrets, and connector credentials.                           |
| `ctx.files`         | `Permission.FilesRead`, `Permission.FilesWrite`                                           | Uploads, downloads, signed URLs, and file metadata.                             |
| `ctx.artifacts`     | `Permission.ArtifactsRead`, `Permission.ArtifactsWrite`                                   | Text artifacts, generated reports, and workspace files.                         |
| `ctx.rag`           | `Permission.RagRead`, `Permission.RagWrite`                                               | Indexing and searching plugin-owned context.                                    |
| `ctx.ai`            | `Permission.AiGenerate`, `Permission.AiEmbed`                                             | Host-injected text generation, streaming, and embeddings.                       |
| `ctx.runs`          | `Permission.RunsRead`, `Permission.RunsWrite`                                             | Long-running work, progress, logs, and results.                                 |
| `ctx.connectors`    | `Permission.ConnectorsRead`, `Permission.ConnectorsInvoke`, `Permission.ConnectorsManage` | Managed external service profiles and calls.                                    |
| `ctx.services`      | `Permission.ServicesInvoke`                                                               | Host-bound internal APIs for complex domain or database work.                   |
| `ctx.http.fetch`    | `Permission.ExternalHttp` plus `egress`                                                   | Direct external HTTP through the SSRF-aware egress guard.                       |
| `ctx.workspace`     | `Permission.WorkspaceRead`, `Permission.WorkspaceWrite`                                   | Workspace lookup, membership, roles, and invitations.                           |
| `ctx.events`        | `Permission.EventsEmit`, `Permission.EventsSubscribe`                                     | Plugin and platform event flows.                                                |
| `ctx.jobs`          | `Permission.JobsEnqueue`, `Permission.JobsRegister`                                       | Background work and scheduled jobs.                                             |
| `ctx.webhooks`      | `Permission.WebhookReceive`                                                               | Webhook verification and accepted responses.                                    |
| `ctx.apiKeys`       | `Permission.ApiKeysRead`, `Permission.ApiKeysWrite`                                       | Plugin-scoped API keys.                                                         |
| `ctx.rateLimit`     | `Permission.RateLimitCheck`                                                               | Scoped rate checks for public or expensive operations.                          |
| `ctx.audit`         | `Permission.AuditWrite`                                                                   | Audit records for user-visible or sensitive actions.                            |
| `ctx.usage`         | `Permission.UsageWrite`                                                                   | Usage counters and analytics.                                                   |
| `ctx.metering`      | `Permission.MeteringWrite`                                                                | Billable action authorization, commit, refund, void, reconcile.                 |
| `ctx.credits`       | `Permission.CreditsRead`, `Permission.CreditsConsume`                                     | User credit balances and credit consumption.                                    |
| `ctx.billing`       | `Permission.BillingRead`, `Permission.BillingWrite`                                       | Plans, entitlements, grants, and redemption flows.                              |
| `ctx.notifications` | `Permission.NotificationsSend`                                                            | In-app or email notifications.                                                  |
| `ctx.ui.toast`      | `Permission.UiToast`                                                                      | Optional user feedback from plugin UI flows.                                    |
| Host Page Slots     | `Permission.HostPageExtend`, `Permission.HostPageOverride`                                | Extend or override host-owned pages with host-governed SEO, i18n, and rollback. |

## Recommended Compositions

Complex plugins should not put every concern into one API handler. Compose host
capabilities along their boundaries:

| Scenario                      | Recommended path                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Simple plugin-owned data      | `data.collections` plus `ctx.storage`.                                                                       |
| Complex database/domain query | Host service/repository plus `ctx.services`; plugins do not access the database directly.                    |
| Host page extension           | `hostPages.slots`; use `hostPages.overrides` for main-content replacement with SEO, i18n, shell, cache.      |
| npm UI/runtime component      | `plugin.dependencies.json` plus a host root `package.json` runtime dependency; plugin code imports normally. |
| Billable synchronous action   | Route/API commercial gate plus `ctx.metering.authorize()`, the work, then `ctx.metering.commit()`.           |
| Long-running workflow         | Public/API handler creates `ctx.runs`, enqueues `ctx.jobs`, and the job updates progress and results.        |
| External integration          | Use `ctx.http.fetch` for short no-secret calls; use `ctx.connectors` for credentials, retry, audit, logs.    |
| Host internal complex ability | Use `ctx.services`; the host owns URL binding, secrets, actor claims, timeout, retry, audit, and usage.      |

Recommended async commercialization flow:

1. Gate the API route with `commercial` or `ctx.metering.authorize()`.
2. Create a `ctx.runs` record for inputs, cost references, and initial status.
3. Enqueue the real work through `ctx.jobs`.
4. In the job, call `ctx.services` or `ctx.connectors` for complex database or
   external system work.
5. On success, call `ctx.metering.commit()`; on failure, `refund` or `void`.
6. Write run logs/results, then optionally emit events and send notifications.

## Rules For AI-Generated Plugins

- Start with the smallest permission set.
- Add permissions only when code uses the matching `ctx.*` capability.
- Public APIs must declare `anonymousPolicy`.
- External HTTP requires both `Permission.ExternalHttp` and `egress`.
- External npm packages must be listed in `plugin.dependencies.json`, and the
  host root `package.json` must list the same package as a runtime dependency.
- AI calls should declare plugin-namespaced meters when billable, for example
  `invoice-helper.ai.generate`.
- Secrets belong in `ctx.secrets`, not in config, source files, or environment
  variables.
- Long work belongs in `ctx.runs` and jobs, not request/response handlers.
