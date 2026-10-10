# ROADMAP (Trigger-Driven)

This is the framework's single register for "do it later, when triggered" work.
Every item states its **trigger condition** and the **pre-agreed approach** — when
the condition is met, work can start without a fresh investigation. Building ahead
of the trigger is deliberately avoided: it re-creates unused shelfware.

Maintenance rules:

- New trigger-driven items are registered here (not scattered across other docs).
- When an item's trigger fires, it moves out of this file into its own effort.
- Long-lived normative documents (architecture, API indexes, component selection)
  do not live here.
- After each delivery, check whether any ADR's Status needs to flip
  (accepted → implemented, or superseded with a pointer to its successor).

## Scheduling

| Area | Item | Trigger / Notes |
|---|---|---|
| `schedule` | One-shot schedules (run_at) | First product needing "do X once at time T" with domain visibility (aiblog scheduled publishing). Add a `run_at` one-shot plan type beside cron plans (completion semantics + admin visibility); until then `events.EmitAt(ctx, tx, ev, at)` covers fire-and-forget one-shots — it exists so products stop hand-rolling due-scan loops. |
| `schedule` | Missed-run backfill for schedule plans | A concrete requirement for full catch-up (fire every missed occurrence). Extend the domain's misfire policy set — today `skip` drops missed runs and `once` fires at most one inside the grace window — e.g. an `all` policy emitting one fire per missed interval in `PlanFires`. Fixed-time cron runs (expression + timezone + `next_fire_at`), the kind registration surface (`RegisterKind`), and the River scanner/fire workers are already the substrate; do not add a parallel scheduler (the in-house one stays removed; cron parsing lives in `platform/cronx`). |

## Observability

| Area | Item | Trigger / Notes |
|---|---|---|
| `platform/metrics` | OpenTelemetry tracing | Multi-instance / multi-service deployments. The metrics package already bridges OTel metrics to Prometheus and installs the TraceContext propagator; add the tracing half (TracerProvider + span exporter). |
| `platform/events` | Dead-letter surface / fan-out ergonomics | First real event whose terminal failure needs tracking beyond the final-attempt Error log (today: retries exhaust → log only; one handler per kind by river design). Options: DLQ sidecar table written on final failure, or document a fan-out idiom (single handler fanning to registered sub-handlers). |
| `platform/pgpart` + admin | Retention partition health panel | After the first rolling-archive operational incident. Surface the retention worker's last-success time and lag in the admin overview. |

## Security

| Area | Item | Trigger / Notes |
|---|---|---|
| identity | First-class machine identity (agent principals) | Second machine-identity consumer beyond the `agent:<name>` PAT naming convention. Either wire `Principal.AgentID` (field exists; zero reads/writes today) from PAT token naming, or officialize the shadow-user + PAT pattern with a helper; include audit attribution. |
| `authz` | Row-level filtering via injected predicates | A product requires row-level authorization beyond tenant isolation (tenant isolation already holds, including real RLS tests). Inject filter predicates through authz closures; business domains stay untouched. |
| logging | Log redaction pipeline | Compliance requirements on log output. Re-express the redaction semantics as a log encoder/hook, or scrub in the shipping pipeline (e.g. Vector VRL). |
| settings / public `/config` | Rate-limit allowlist exposure cleanup | If the allowlist surfacing in the public `/config` payload is judged an information leak. Today the example spreads the whole `settings.Effective` map into the payload, allowlist included. Drop the key on the `/config` side: consumers read it through the dedicated `settings.RateLimits` accessor, so the payload change breaks nothing. |
| admin | OAuth application management console | When the platform opens OAuth client registration to third-party developers. Ship together with the authorization-server capability (list / revoke). |
| admin | SSO admin console expansion (CRUD) | When platform-level SSO middleware or enterprise IdP audit needs emerge. A read-only SSO page + `/api/admin/sso` already exist; expansion means add/remove/update operations. |
| `platform/sealx` | Master key rotation | Multi-instance deployments / compliance audits. Versioned envelopes (v2) with dual-read plus a re-encrypt command. |
| identity / storage | Full row-level security (RLS) enablement | Multi-instance / compliance hardening. The tenant-scoping channel and tri-state tests are already in place. |

## Compliance & Data Lifecycle

| Area | Item | Trigger / Notes |
|---|---|---|
| audit / admin | GDPR user data export | EU market, signing a DPA, or the first subject access request. An admin-triggered synchronous JSON export already exists (`GET /api/admin/users/{id}/export`: profile, memberships, sessions, PATs, audit events). Remaining when the trigger fires: a self-service API trigger and an async aggregation job (zip archive) for large payloads, coordinated with the audit domain. |
| webhooks | Delivery-history retention | When `delivery` table growth becomes an operational pain. A retention worker pruning by day, registered in the workers table. |
| billing | Auto-upgrade on manual (non-overage) plan redemption | The first product selling subscriptions through the manual channel. Upgrade must happen inside one transaction (plan change + subscription activation + emitted events); today redemption deliberately never auto-upgrades because without a discriminator an overage redemption must not re-tier. Admin escape hatch: `PATCH plan` + `OnPlanChangedTx`. |

## API & Tooling

| Area | Item | Trigger / Notes |
|---|---|---|
| `tools/check_api.py` | Schema-level contract reconciliation | When contract drift shows up in audits again. Extend route-path diffing with response-field and status-code spot checks (OpenAPI ↔ route registration, both sides); CI-able. |
| `GET /auth/sessions` | Sessions list pagination | When per-user session counts make full rendering / auditing painful (hundreds of rows). Add `limit`/`offset` + total envelope, sync OpenAPI, thread params through the client hook, wire DataTable pagination on the page. |
| `/api/audit` | Keyset pagination for audit events | When audit volume demands deep pagination (at an OpenAPI contract-versioning window). Replace OFFSET with a two-key keyset cursor `(created_at, id)` (the list already orders by `created_at DESC, id DESC`); align with the admin-side keyset precedent. Contract change. |
| `quota` | Period granularity beyond monthly | First product with a non-monthly cadence (aiblog daily publishing). `quota.Period(now)` hardcodes "2006-01"; period is already a plain string through counters/idempotency, so adding a granularity dimension is contained — decide the config surface (per-key vs per-workspace default) when triggered. |
| usage / quota API | Period-over-period usage comparison | When trend / cycle-comparison demand appears. `quota_counter` rows persist per period and freeze once a period ends, but the usage API reads only the current period (`quota.Period(now)`); add a history read, and decide whether frozen counter rows suffice or a period-close snapshot is required. A storage-backed new feature, not a bug fix. |
| schedule list API | Schedule plan list pagination | When per-workspace plan counts approach the current list cap. The `next_fire_at` ordering is naturally keyset-friendly. |
| （新包）`ploykit/bootstrap` | 最小组装引导（bootstrap.Default 汇聚标准中间件链 + 常用域挂载，逐域开关） | 第三个产品接入，或再出现"从 example 复制 260+ 行才能起骨架"的实录（risk-engine W1 首例：其 main.go 260 行与 example 逐字同构）。显式组装（example 全量版）仍是正统，bootstrap 只是起步糖。 |
| identity / webx | 会话建立响应直接返回新 csrf_token 字段 | 下一个 API 面变更窗口（openapi contract 升级时）。省掉"登录后必须重取 /config"一次往返，是 CSRF 轮换文档（api-conventions.md）更根本的修复；两个真实消费方各被绊 30min+。响应加字段为增量变更，需同步 openapi + @ploykit/client。 |
| `webx` | 路由注册预检（ServeMux 模式合法性友好报错） | 下次 webx 改动顺带。启动时对全部注册模式跑一次解析预检，把 stdlib panic（冒号 wildcard / 根模式冲突）转成带修复建议的错误信息。 |
| `webx` | `webx.MountAPI(mux, path, opts)` | Second non-browser endpoint in any product (aiblog /mcp is the first). Bundle the AGENTS.md mounting checklist into defaults: timeout exemption, rate-limit/BodyLimit coverage, scope-enforcement hook; today every product hand-wires the four pitfalls (example/cmd/app/main.go pathGate block). |
| `platform/renderx` | Site/tenant dimension on PagePath & cache keys | Multi-site product (aiblog v2 names this the one framework change it needs). Approach reserved in rendering.md §11: add the dimension to PagePath/cache keys + per-tenant invalidation; render pipeline unchanged. |
| `webx` | `webx.SPA` helper | When more than one product repeats the same ~20-line SPA fallback. Extract `webx.SPA(fsys, apiPrefixes...)`. |

## Frontend & Rendering

| Area | Item | Trigger / Notes |
|---|---|---|
| rendering | Rendering-surface E2E suite | At the next dedicated testing campaign. Build a new test tree instead of overwriting the frozen baseline in place. |
| rendering SSR | QuickJS stack-depth fix at the root | When full-chain provider SSR or the next rendering milestone lands. Fork to raise the stack limit and surface a proper JS `RangeError` (today mitigated by a minimal wrap in the entry server). |
| web | Registration copy i18n | When an i18n effort starts; approach to be decided then. |
| web | CSP `eval` violation attribution | At the next browser regression run or page audit. One `script-src` eval is blocked per page with no attribution to a dependency; locate the caller with source maps before deciding whether to tighten or allow the CSP. |
| ui / example | Framework-domain → UI page ownership ledger | When a framework domain grows a page without a matching UI component, or the example reimplements `@ploykit/ui` equivalents by hand. The Go-side duplication guard deliberately skips `web/`; at that point extend the ownership ledger (or the duplication feature table) to frontend sources. |
