# Capability Usage Map

> Handwritten LLM routing text. `ctx.*`, `Permission.*`, commands, and links are checked by `npm run llm-wiki:check`.

| I want to | Use | Declare | Do not |
| --- | --- | --- | --- |
| Store workspace-scoped records | Data v2 table with `scope: 'workspace'`, then `ctx.data.table(...)` and `ctx.scope.workspaceId` | `Permission.DataTableRead` / `Permission.DataTableWrite` | Do not add your own `tenant_id` authority or bypass Data v2 |
| Read current user/login state | `ctx.user` and `ctx.auth` | - | Do not create sessions, cookies, or user tables in the module |
| Gate by workspace/product context | `ctx.scope` and `ctx.workspace` | - | Do not infer tenancy from URL strings |
| Upload or manage files | `ctx.files.createUpload`, signed upload helpers, file ids | `Permission.FilesWrite`; add `Permission.FilesRead` when reading | Do not call S3 or local `fs` directly |
| Send notifications | `ctx.notifications.send` | `Permission.NotificationsSend` | Do not write notification rows yourself |
| Enqueue background work | `ctx.jobs.enqueue` and `jobs` in `module.ts` | `Permission.JobsEnqueue`; add `Permission.JobsRegister` for registered jobs | Do not run long work inside page loaders |
| Emit or handle module events | `ctx.events.emit` and `events` in `module.ts` | `Permission.EventsEmit` / `Permission.EventsSubscribe` | Do not invent in-memory event buses |
| Call a controlled external service | `serviceRequirements` plus `ctx.services.invoke` | `Permission.ServicesInvoke` | Do not hand-build bearer/HMAC headers in module code |
| Call ordinary external HTTP | `ctx.http.fetch` | `Permission.ExternalHttp`; add `egress` if required | Do not use global `fetch` |
| Charge metered usage | `ctx.metering.charge` or authorize/commit flow | `Permission.MeteringWrite` | Do not create a metering ledger |
| Reserve or consume credits | `ctx.credits.reserve`, `commitReservation`, `consume` | `Permission.CreditsConsume`; read with `Permission.CreditsRead` | Do not create balance tables |
| Check entitlements | `ctx.entitlements.has` or `list` | `Permission.EntitlementsRead` | Do not create plan/package authority tables |
| Apply checkout/refund facts | `ctx.commerce.applyCheckoutPaid` / refund APIs | `Permission.CommerceApply` | Do not process payment webhooks into module-owned orders |
| Generate AI output | `ctx.ai.generateText` / embeddings APIs | `Permission.AiGenerate` / `Permission.AiEmbed` | Do not bring provider keys into modules |
| Add RAG search | `ctx.rag` APIs | `Permission.RagRead` / `Permission.RagWrite` | Do not build a separate vector store by default |
| Add dashboard navigation | `navigation` in `module.ts` | `Permission.NavigationExtend` when required | Do not render your own host sidebar |
| Contribute/replace host surfaces | `surfaces` and `presentation` in `module.ts` | `Permission.SurfaceContribute` / `Permission.SurfaceOverride` | Do not fake host chrome inside pages |
| Record audit | `ctx.audit.write` | `Permission.AuditWrite` | Do not hide state changes in local logs only |

If no row fits, stop and report the missing host extension point instead of mocking platform state.
