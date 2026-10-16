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
| (new) visitor analytics domain | Full visitor statistics: unique visitors, sessions, referrers, trends, dashboard page | First product that requires server-side visitor statistics (rejecting third-party trackers, or needing crawler-inclusive numbers). Pre-agreed shape (visitor walkthrough 2026-10-15, docs/visitor-analytics.md): renderx-adjacent middleware + daily-salted visitor hash (IP+UA, no cookies, no cross-day linkage) + pgpart daily table + aggregation worker + admin dashboard page; prototype product-side first to settle UV semantics, then decide on framework absorption. The anonymous layer is already shipped: `ploykit_traffic_requests{bot,tier,status}` + X-Renderx-Tier (no per-page detail by design — that is exactly what this item adds). |
| `platform/events` | Dead-letter surface / fan-out ergonomics | First real event whose terminal failure needs tracking beyond the final-attempt Error log (today: retries exhaust → log only; one handler per kind by river design). Options: DLQ sidecar table written on final failure, or document a fan-out idiom (single handler fanning to registered sub-handlers). |
| `platform/pgpart` + admin | Retention partition health panel | After the first rolling-archive operational incident. Surface the retention worker's last-success time and lag in the admin overview. |

## Security

| Area | Item | Trigger / Notes |
|---|---|---|
| `authorization` | Strong-profile restart (ADR 0013) | **Executed 2026-10-11** per `docs/plan-strong-profile-restart.md`: example reference wiring (workspace delete / transfer ownership) + in-tx FactsProvider + per-operation recent-auth window (batch 1); TOTP+backup-code MFA freshness with `RequireRecentMFA` (batch 2); per-operation transport exclusivity + mixed-transport rejection (batch 3); ADR 0005 acceptance re-verification + README rewrite (batch 4). G2 (project membership storage) and G5 (catalog→OpenAPI gates) are runlynk product-side work, explicitly out of the framework. |
| identity | First-class machine identity (agent principals) | Second machine-identity consumer beyond the `agent:<name>` PAT naming convention. Either wire `Principal.AgentID` (field exists; zero reads/writes today) from PAT token naming, or officialize the shadow-user + PAT pattern with a helper; include audit attribution. (Scope × command enforcement on non-HTTP mounts is closed by `webx.RequireScope` — this item remains for the identity-model level: agent identity, catalog-validated scopes, per-agent revocation.) |
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
| (new package) `ploykit/bootstrap` | Minimal assembly bootstrap (bootstrap.Default bundling the standard middleware chain + common domain mounts, per-domain toggles) | A third product onboards, or another "260+ lines copied from example" field report appears (risk-engine W1 was the first: its main.go matched example verbatim for 260 lines). Explicit assembly (the full example) stays the canonical path; bootstrap is only a starter sugar. |
| identity / webx | Session-establishing responses return the new csrf_token field directly | Next API-surface window (openapi contract bump). Saves the "re-fetch /config after login" round trip - the more fundamental fix behind the CSRF rotation doc (api-conventions.md); two real consumers each lost 30min+ to it. Additive response change; sync openapi + @ploykit/client. |
| `webx` | Route-registration preflight (friendly errors for ServeMux pattern legality) | Next webx change rides along. At startup, pre-parse all registered patterns and turn stdlib panics (colon wildcards / root-pattern conflicts) into actionable error messages. |
| `webx` | `webx.MountAPI(mux, path, opts)` | Second non-browser endpoint in any product (aiblog /mcp is the first). Bundle the AGENTS.md mounting checklist into defaults: timeout exemption, rate-limit/BodyLimit coverage, scope-enforcement hook; today every product hand-wires the four pitfalls (example/cmd/app/main.go pathGate block). |
| `platform/renderx` | Site/tenant dimension on PagePath & cache keys | Multi-site product (aiblog v2 names this the one framework change it needs). Approach reserved in rendering.md §11: add the dimension to PagePath/cache keys + per-tenant invalidation; render pipeline unchanged. |
| `platform/renderx` | Per-language cache keys (path × lang) | First multi-language SEO product. Cache keys are path × buildID today; `Lang` only writes `<html lang>` (single-language boundary declared in rendering.md §5.8). The dimension touches cacheKey, the loader Params surface (loader picks the language), and invalidation — decide whether lang rides Params (per-language invalidation falls out) or stays a separate axis. Products pin one language per deployment or split paths (/en/..., /ja/...) meanwhile. |
| `platform/storagex` | Read-only serving handler for /uploads/ | First product wiring user-uploaded files (covers/avatars). `LocalBackend.URL()` already returns `/uploads/{key}` but nothing serves it; ship an opt-in `storagex.ServeUploads(backend)` http.Handler (Content-Type inference + immutable cache) — the UPLOAD endpoint stays product-side (auth/size/type policy is per-product, not framework-defaultable). Example wiring per the AGENTS rule. |
| `billing` | Declarative one_time purchase → quota grant | First product selling credit packs / one-time buys. Today only subscriptions (interval != one_time) drive plan changes; one_time requires hand-subscribing order_marked_paid + quota.Grant with self-managed idempotency. A SKU catalog mapping order lines to grant keys would cover the most common SaaS commerce shape. Filed as ecosystem suggestion by a product not yet commercializing. |
| `platform/wsx` | Loopback any-port parity with `webx` CSRF | First field report of `/ws` failing after a dev frontend port drift (webx CSRF now trusts loopback hosts on any port via `TrustLocalhostAnyPort`; the hub's `AllowedOrigins` still exact-matches full `scheme://host[:port]` strings). Mirror the normalization: strip the port from loopback-family origins in the hub's origin gate behind the same flag name. |
| `webx` | `webx.SPA` helper | When more than one product repeats the same ~20-line SPA fallback. Extract `webx.SPA(fsys, apiPrefixes...)`. |

## Frontend & Rendering

| Area | Item | Trigger / Notes |
|---|---|---|
| rendering | Rendering-surface E2E suite | At the next dedicated testing campaign. Build a new test tree instead of overwriting the frozen baseline in place. |
| ui / example | Canvas (node-graph) example — custom nodes MUST render `<Handle>` | If/when the framework ships a canvas/flow example or doc (React Flow or similar). Field report (frontend walkthrough, P2): custom node cards that render only content and omit React Flow's `<Handle>` anchor make every edge silently disappear from the DOM — nodes render, data is intact, zero console warnings. Any canvas example must render source/target `<Handle>`s in its custom node component and call this pitfall out explicitly; it is third-party behavior the library will never diagnose. |
| rendering SSR | ~~QuickJS stack-depth fix at the root~~ | **Done (ADR 0015, 2026-10-16)**: wasm rebuilt in-repo from pinned quickjs-ng v0.17.0 (upstream PR #1700 restores the wasi stack guard) + 8MiB shadow stack + `MaxStackSize` capped below it; overflow is once again a catchable JS error, the instance survives, and the budget knob is effective. Rebased ahead of its trigger ("full-chain provider SSR or next rendering milestone") because the #16 walk proved the old binary's 64KiB wall was reachable by ordinary page trees. |
| web | Registration copy i18n | When an i18n effort starts; approach to be decided then. |
| API surface | Unify list envelope (items/total) and DELETE status codes (204) | Next breaking window (0.7+). Field report (FP walk): bare-array endpoints (tokens/sessions/invitations-mine) vs {items,total} envelopes force two unpack conventions per frontend; DELETE answers mix 200+body and 204 within one domain. Both unifications are breaking — collect more surfaces and do them in one contract bump. |
| API surface | Fine-grained error codes (E_PASSWORD_MISMATCH etc.) | When the next consumer asks for client-side i18n of error copy. The stable `error` enum exists but is too coarse for message-level branching; adding sub-codes must sync openapi + client + hooks in one pass. Framework-level messages are English-only since the FP-walk batch (translate-what-you-display stays client-side). |
| identity | Optional mount prefix for /auth/* routes | Second product proving the prefixStripper wrapper (api-conventions "identity mounts at the root") insufficient for reverse-proxy/WAF needs. Touching the Mount signature parameterizes openapi + @ploykit/client hardcoded root paths in lockstep — one contract bump, not an additive change. |
| webx | Dev-mode double-WriteHeader detector (DecodeJSON bool misuse) | Next webx middleware change. DecodeJSON returns bool and a handler that forgets `if !DecodeJSON(...) { return }` compiles fine and keeps running — field report (aifengkong): one handler wrote 400 via DecodeJSON and then executed the disable path, producing a second write. A dev-mode middleware (or a WriteHeader-once guard inside statusRecorder, gated to non-prod) that panics loudly on the second write turns the silent bug into a startup-adjacent crash; not shipped by default because Recover would swallow the panic shape in prod. |

| web | CSP `eval` violation attribution | At the next browser regression run or page audit. One `script-src` eval is blocked per page with no attribution to a dependency; locate the caller with source maps before deciding whether to tighten or allow the CSP. |
| ui / example | Framework-domain → UI page ownership ledger | When a framework domain grows a page without a matching UI component, or the example reimplements `@ploykit/ui` equivalents by hand. The Go-side duplication guard deliberately skips `web/`; at that point extend the ownership ledger (or the duplication feature table) to frontend sources. |
