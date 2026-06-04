# PloyKit Capability And Permission Map

Use host behavior through `ctx.*` and declare matching permissions in
`module.ts`.

| Capability | Typical permissions | Use for |
| --- | --- | --- |
| `ctx.data.document` | `Permission.DataDocumentRead`, `Permission.DataDocumentWrite` | Scoped document data. |
| `ctx.data.table` | `Permission.DataTableRead`, `Permission.DataTableWrite` | Data v2 physical tables declared in `module.ts`. |
| `ctx.data.transaction` | `Permission.DataTransaction` | Atomic multi-step Data v2 changes. |
| `ctx.data.sql` | `Permission.DataSqlRead`, `Permission.DataSqlWrite` | Controlled SQL escape hatch. |
| `ctx.runs` | `Permission.RunsRead`, `Permission.RunsWrite` | Run records, progress, logs, and status transitions. |
| `ctx.jobs` | `Permission.JobsEnqueue`, `Permission.JobsRegister` | Scheduled and background work. |
| `ctx.events` | `Permission.EventsEmit`, `Permission.EventsSubscribe` | Pub/sub behavior. |
| `ctx.webhooks` | `Permission.WebhookReceive` | Incoming webhook routes and receipts. |
| `ctx.config` | `Permission.ConfigRead`, `Permission.ConfigWrite` | Non-secret module configuration. |
| `ctx.secrets` | `Permission.SecretsRead`, `Permission.SecretsWrite` | API keys, webhook secrets, and credentials. |
| `ctx.files` | `Permission.FilesRead`, `Permission.FilesWrite`, `Permission.FilesPublish` | Uploads, media, signed URLs, and file metadata. |
| `ctx.artifacts` | `Permission.ArtifactsRead`, `Permission.ArtifactsWrite` | Reports and generated structured artifacts. |
| `ctx.rag` | `Permission.RagRead`, `Permission.RagWrite` | Indexing, search, and context packs. |
| `ctx.ai` | `Permission.AiGenerate`, `Permission.AiEmbed` | Generation, streaming, and embeddings. |
| `ctx.connectors` | `Permission.ConnectorsRead`, `Permission.ConnectorsInvoke`, `Permission.ConnectorsManage` | Managed external service profiles and operations. |
| `ctx.services` | `Permission.ServicesInvoke` | Privileged service calls declared by `serviceRequirements`. |
| `ctx.resourceBindings` | `Permission.ResourceBindingsRead`, `Permission.ResourceBindingsWrite` | Product/workspace resource bindings. |
| `ctx.http.fetch` | `Permission.ExternalHttp` plus `egress` | External HTTP through the egress guard. |
| `ctx.cache` | `Permission.CacheRevalidate` | Cache lookup and invalidation support. |
| `ctx.apiKeys` | `Permission.ApiKeysRead`, `Permission.ApiKeysWrite` | API key verification and lifecycle. |
| `ctx.rateLimit` | `Permission.RateLimitCheck` | Module-facing rate-limit checks. |
| `ctx.usage` | `Permission.UsageWrite` | Usage records and analytics. |
| `ctx.metering` | `Permission.MeteringWrite` | Billable authorization, commit, refund, void, and reconcile. |
| `ctx.credits` | `Permission.CreditsRead`, `Permission.CreditsConsume`, `Permission.CreditsWrite` | Credit balance, grant, consume, adjust, and refund. |
| `ctx.billing` | `Permission.BillingRead`, `Permission.BillingWrite` | Plans, entitlements, and redeem codes. |
| `ctx.commerce` | `Permission.CommerceRead`, `Permission.CommerceWrite` | Checkout and order records. |
| `ctx.notifications` | `Permission.NotificationsSend` | In-app or email notifications. |
| `ctx.audit` | `Permission.AuditWrite` | Audit records for sensitive or user-visible actions. |
| navigation | `Permission.NavigationExtend` | Host navigation contribution. |
| surfaces | `Permission.SurfaceContribute`, `Permission.SurfaceOverride` | Host page widgets, panels, actions, and overrides. |

Rules:

- Start with the smallest permission set.
- Add permissions only when code uses the matching capability.
- Avoid system-only permissions in normal modules.
- Public APIs must declare `anonymousPolicy`.
- External HTTP requires both `Permission.ExternalHttp` and a narrow `egress`
  origin such as `https://api.example.com`.
- Privileged services with secrets, runtime signing, dynamic claims, private
  network risk, or strong audit use `ctx.services.invoke(...)` plus
  `serviceRequirements`; do not call those origins with `ctx.http.fetch(...)`.
- For service-backed modules, keep a module-local service client as the only
  `ctx.services.invoke(...)` entry and use service connection configuration to
  switch between mock and live service targets.
- Long-running work belongs in actions/jobs/runs, not synchronous page loaders
  or request handlers.
- Secrets belong in `ctx.secrets`, not source files, config, logs, artifacts, or
  notifications.
