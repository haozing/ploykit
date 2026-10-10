# ploykit Architecture

> The hook and platform-package designs are derived from line-by-line code study of several real multi-tenant SaaS products;
> every design decision is annotated with its motivation and applicable scenario. Binding decisions live in docs/adr/.

---

## 1. Core Design Rationale (Six Facts That Shaped the Design)

| # | Observation (common patterns across real multi-tenant SaaS products) | Impact on the design |
|---|---|---|
| 1 | **Strongly consistent side effects such as audit have only one safe shape**: in-transaction hooks that roll back on error (they live and die with the main operation) | The unified hook registry is modeled on Transactional semantics |
| 2 | **"Ghost events" are common in product code** — event constants such as `workspace.created/member.added/invitation.accepted` are defined but never emitted | These are exactly the spots the framework hook surface should cover |
| 3 | **Cascade cleanup is often scattered and asymmetric**: removing a member triggers cleanup (revoke PATs → cancel tasks → archive sessions), but voluntary leave does not | Cascade cleanup is consolidated into first-class Cleanup hooks and triggered uniformly on every removal path |
| 4 | **Isolation between platform packages and business logic cannot rely on convention alone** — platform packages such as webx/pg/sealx/egressx must have zero business dependencies, or the boundary rots | internal/arch architecture tests enforce zero business dependencies for `platform/*` |
| 5 | **Quota is naturally a four-step pipeline**: precheck → consume → meter → threshold notification (80% near-limit reminder + 429 when exhausted), with deduplication in two tiers: "once per month" and "once forever" | The quota pipeline is built as a pluggable hook chain |
| 6 | **Products differ completely in post-registration behavior**: seed a full set of default resources (in-transaction) / create an organization + analytics events + send email / do nothing | Confirms that `AfterRegister` is the most frequently customized hook |

---

## 2. Package Inventory

### 2.1 Platform packages (18 packages, grouped by function; products import as needed; no "exclusive/recommended" labels)

Platform packages are strictly isolated from business logic (internal/arch tests guarantee zero business dependencies for `platform/*`). **The framework only provides capabilities; the product chooses** — a Go module compiles by import, so unused packages never enter the binary.

> **Note**: The framework does not provide generic outbox/eventbus/scheduler foundation packages — cross-domain extension is handled by each domain's hooks.go (four semantics), reliable outbound delivery by webhooks' built-in deliveries queue, and periodic polling by workers intervals; comparable industry libraries (Watermill/gocron/Flipt) can be brought in yourself as needed. sealx/egressx are wired (see below); metrics/redactx/cronx live in the observability group.

#### Core platform (used by nearly every product)

| Package | Responsibility |
|---|---|
| **pg** | pool + Within transactional UoW + Read replica reads (circuit-breaker with half-open probing; primary-only fallback while the replica is down) |
| **pgmigrate** | migration runner (serialized via advisory lock) |
| **pgpart** | rolling maintenance of monthly RANGE partitions (Table/Round/MonthStart/EnsureForward pre-creation + DropExpired retirement; companion to ADR 0009) |
| **webx** | auth middleware (session cookie or PAT Bearer) / Principal / CSRF / rate limiting (Limiter interface + RateLimit middleware; the GCRA implementation lives in redisx) / CORS / RequestID / AccessLog / SecurityHeaders / Recover / BodyLimit / Timeout / ConfigHandler / Health |
| **workers** | worker lifecycle registry: Add/Start/Drain/AllHealthy (panic recovery, /readyz integration) |

#### Events and async (products with event-driven or scheduled-task needs)

> The events/async foundation is provided by platform/events: River transactional enqueue (events.Emit) + subscription workers (ADR 0003); the synchronous phase is handled by domain hooks; reliable outbound delivery goes through webhooks' built-in deliveries queue (SKIP LOCKED claiming + exponential backoff + DeliveryWorker); "daily fixed-time / missed-run catch-up" scheduling is handled by the schedule domain (cronx pure functions + schedule-table persistence in migration 037 + scan-and-enqueue into River, covering both the daily fixed-time and missed-run tiers).

#### Security

| Package | Responsibility |
|---|---|
| **sealx** | credential sealing with AES-256-GCM (**wired**: identity federation client_secret, PLOYKIT_SEAL_KEY; implemented in the identity domain, not workspace) |
| **egressx** | SSRF gate: private CIDR blocks + allowlist + URL preflight + Dialer.Control against DNS rebinding (**wired**: the sole outbound egress for webhooks) |

#### External connections

| Package | Responsibility |
|---|---|
| **redisx** | redis client construction (standalone/sentinel/cluster) |
| **storagex** | object storage: Local atomic writes + S3 path-style |

#### Realtime

| Package | Responsibility |
|---|---|
| **wsx** | WebSocket hub: rooms / connection gauge / read limit + subscribe rate limit / PAT resolve / Authorize callback |
| **relayx** | cross-instance realtime relay with two transports: memory (single instance / unit tests) / redis (multi-instance, full fan-out on a single channel) |

#### Observability

| Package | Responsibility |
|---|---|
| **logx** | leveled structured logging |
| **ids** | UUIDv4 / UUIDv7 generation |
| **renderx** | SSR/prerendering/SEO engine (wazero+QuickJS) |
| **metrics** | /metrics endpoint + request metrics middleware + token gate (wired into example) |
| **events** | transactional event foundation (River InsertTx + subscription dispatch, ADR 0003) |
| **redactx** | secret redaction (cleanses product free text before persistence) |
| **cronx** | cron expression → next-trigger pure function (computation core for schedule patterns) |

### 2.2 ploykit business domain packages

| Package | Responsibility |
|---|---|
| **identity** | registration / verification code login / sessions (revocable in DB) / PAT / JIT account provisioning |
| **workspace** | workspaces / members / invitations / share links / last-owner protection / cleanup hooks |
| **billing** | plans / orders / subscriptions / metered overage / payment channel seam (Stripe + Manual built in; manual includes admin-console mark-paid reconciliation; no domestic-payment channel is implemented) |
| **quota** | four-step quota pipeline: precheck → consume → meter → threshold notification; milestone unlocks |
| **admin** | admin console API |
| **notify** | notification port (bell model) + deduplication strategies + email adapter |
| **audit** | operation audit (actor snapshots) |
| **analytics** | analytics event ingestion (TrackService.Track) + recent/count queries |
| **webhooks** | outbound webhooks: registrable event catalog + HMAC signing + retries |
| **schedule** | user-defined scheduling: kind registration surface (RegisterKind) + atomic DB-backed claim of due schedule rows (ClaimDue) + River delivery, with missed-run catch-up (migration 037; design converged from n8n durable scheduler / Dify / pg-boss) |
| **settings** | site settings: single site_settings table (announcement / maintenance mode / registration control, plus three API rate-limit keys, migration 038), served via /config (design follows Documenso site-settings) |

### 2.3 Cross-cutting layers and internal packages

These are not business domains and not platform packages; the dependency rules that keep them decoupled are enforced by internal/arch (see 4.5).

| Package | Responsibility |
|---|---|
| **authz** | cross-cutting authorization, simple profile: permission catalog + role sets (owner/admin/member) + Authorizer + HTTP gates (Require/RequireOwn). Business domains may depend on it; it may depend only on platform |
| **authorization** | authorization, strong profile: self-contained registry/rules/evaluator with caller-injected facts. Imports nothing else in this module (including authz) |
| **internal/contract** | lowest-level shared contracts (error codes / apierr). Depends on nothing in-module; internal/ is not exposed to products |

### 2.4 Final package layout

```
ploykit/ (Go module)
├── identity/            ← business domain
├── workspace/
├── billing/
├── quota/
├── admin/
├── notify/
├── audit/
├── analytics/
├── webhooks/
├── schedule/
├── settings/
├── authz/               ← cross-cutting authorization (simple profile)
├── authorization/       ← authorization (strong profile, self-contained)
├── internal/
│   ├── arch/            ← architecture boundary tests (rules A1-A6)
│   └── contract/        ← lowest-level shared contracts (apierr)
└── platform/            ← platform packages (18 packages, grouped by function; products import as needed)
    ├── pg/              core
    ├── pgmigrate/
    ├── pgpart/          rolling partition maintenance (ADR 0009)
    ├── webx/
    ├── workers/
    ├── renderx/         rendering (SSR/prerendering/SEO)
    ├── sealx/           security (wired)
    ├── egressx/         (wired: the sole outbound egress for webhooks)
    ├── redisx/          external connections (includes the GCRA limiter adapter)
    ├── storagex/
    ├── wsx/             realtime
    ├── relayx/
    ├── logx/            observability
    ├── metrics/
    ├── events/          transactional events (River, ADR 0003)
    ├── redactx/
    ├── cronx/
    └── ids/
```

---

## 3. Hook Design

### 3.1 Hook mechanism: three execution semantics

| Semantics | On error | Applicable scenarios |
|---|---|---|
| **Transactional** | rolls back the entire operation | seeding data, audit writes (must live and die with the main operation) |
| **Observational** | logs only, without affecting the main operation ("best effort") | analytics events, notifications, email |
| **Validating** | blocks the operation | business pre-validation |

A fourth semantics —

| Semantics | On error | Applicable scenarios |
|---|---|---|
| **Cleanup** | attempts every cleanup step; a single failure does not block the rest | cascade cleanup for member removal and workspace deletion (revoke PATs → cancel tasks → delete subscriptions → archive sessions) |

### 3.2 Hook registry (function fields on each domain's Hooks struct)

```go
// ploykit/identity/hooks.go

type Hooks struct {
    // === Registration ===
    // AfterRegister runs inside the registration transaction, after seeding data. Transactional.
    // Typical uses: seed default data / create an organization / send a welcome email
    AfterRegister func(ctx context.Context, tx pgx.Tx, userID string) error

    // === Login ===
    // AfterLogin runs inside the login transaction. Observational (login has already succeeded; it must not be rolled back because a hook failed).
    // Typical uses: analytics events / audit
    AfterLogin func(ctx context.Context, userID, sessionID string) error

    // OnLoginFailed fires on login failure. Observational.
    // Typical uses: risk-control alerting / failure counting
    OnLoginFailed func(ctx context.Context, email, ipHash string) error

    // === Sessions ===
    // AfterPasswordChange runs after a password change (all old sessions already revoked). Observational.
    AfterPasswordChange func(ctx context.Context, userID string) error
}
```

```go
// ploykit/workspace/hooks.go

type Hooks struct {
    // === Workspace ===
    // AfterCreate runs inside the workspace-creation transaction. Transactional.
    // Products seed default projects/boards/agents here
    AfterCreate func(ctx context.Context, tx pgx.Tx, workspaceID, ownerID string) error

    // BeforeDelete runs before the deletion transaction. Validating (may block deletion).
    BeforeDelete func(ctx context.Context, workspaceID string) error

    // OnTeardown runs inside the deletion transaction. Cleanup (best effort; a single failure does not block the rest).
    // Typical uses: canceling active tasks and other cascade cleanup
    OnTeardown func(ctx context.Context, tx pgx.Tx, workspaceID string) error

    // === Members ===
    // AfterMemberJoin runs inside the member-join transaction (both invitation acceptance and share-code redemption funnel through here). Transactional.
    // Typical uses: sending a welcome notification
    AfterMemberJoin func(ctx context.Context, tx pgx.Tx, workspaceID, userID, role string) error

    // BeforeMemberRemove runs before removal. Validating (may block, e.g. on unfinished tasks).
    BeforeMemberRemove func(ctx context.Context, workspaceID, userID string) error

    // OnMemberRemoved runs after removal. Cleanup (revoke PATs → cancel tasks → delete subscriptions → archive sessions cascade).
    // Triggered uniformly for both passive removal and voluntary leave
    OnMemberRemoved func(ctx context.Context, workspaceID, userID string) error

    // === Ownership ===
    // BeforeOwnerChange runs before an ownership transfer. Validating (may block, e.g. on unsettled billing).
    BeforeOwnerChange func(ctx context.Context, workspaceID, fromUserID, toUserID string) error

    // OnOwnerTransfer runs after a successful transfer. Observational.
    OnOwnerTransfer func(ctx context.Context, workspaceID, fromUserID, toUserID string) error
}
```

```go
// ploykit/billing/app/hooks.go

type Hooks struct {
    // BeforeCheckout runs before checkout. Validating.
    BeforeCheckout func(ctx context.Context, workspaceID, userID, planCode string) error

    // OnPlanChanged runs after a plan change. Observational.
    // Typical uses: enabling/disabling add-on features, sending confirmation emails
    OnPlanChanged func(ctx context.Context, workspaceID, from, to string) error

    // OnPlanChangedTx runs inside the plan-change write transaction. Transactional (rollback-safe ledger entries).
    OnPlanChangedTx func(ctx context.Context, tx pgx.Tx, workspaceID, from, to string) error

    // OnPaymentFailed fires when payment fails. Observational.
    OnPaymentFailed func(ctx context.Context, workspaceID, orderID, reason string) error

    // OnSubscriptionRenewed runs after a successful renewal. Observational.
    OnSubscriptionRenewed func(ctx context.Context, workspaceID string, expiresAt time.Time) error

    // OnMeteredOverage fires after the first overage order is billed. Observational.
    OnMeteredOverage func(ctx context.Context, workspaceID, orderID, period string, items int, amountCents int64) error
}
```

```go
// ploykit/quota/hooks.go

type Hooks struct {
    // OnNearLimit fires when usage reaches the threshold (default 80%). Observational.
    // "Once per month" deduplication is the hook implementer's responsibility (bell + activity dual channels, optional)
    OnNearLimit func(ctx context.Context, workspaceID, key string, used, limit int64) error

    // OnExhausted fires when quota is exhausted (on request denial). Observational.
    // Typical use: a one-time notification guiding an upgrade
    OnExhausted func(ctx context.Context, workspaceID, key string) error

    // OnGrant fires on milestone unlock. Observational.
    // Idempotent deduplication is the hook implementer's responsibility: the congratulation lives and dies with the unlock
    OnGrant func(ctx context.Context, workspaceID, key, reason, refID string, amount int) error

    // OnReservationExpired fires when a two-phase reservation is expired and reclaimed by the TTL sweeper. Observational (once per row).
    OnReservationExpired func(ctx context.Context, reservationID, workspaceID, quotaKey string, amount int64) error
}
```

### 3.3 Hook count: 25 (aligned domain-by-domain with docs/api-index.md; every call site nil-checks, so an unset hook is a no-op — products attach implementations as needed)

| Domain | Hooks | Details |
|---|---|---|
| identity | 4 | AfterRegister(Tx) / AfterLogin(Obs) / OnLoginFailed(Obs) / AfterPasswordChange(Obs) |
| workspace | 8 | AfterCreate(Tx) / BeforeDelete(Val) / OnTeardown(Cleanup) / AfterMemberJoin(Tx) / BeforeMemberRemove(Val) / OnMemberRemoved(Cleanup) / BeforeOwnerChange(Val) / OnOwnerTransfer(Obs) |
| billing | 6 | BeforeCheckout(Val) / OnPlanChanged(Obs) / OnPlanChangedTx(Tx) / OnPaymentFailed(Obs) / OnSubscriptionRenewed(Obs) / OnMeteredOverage(Obs) |
| quota | 4 | OnNearLimit(Obs) / OnExhausted(Obs) / OnGrant(Obs) / OnReservationExpired(Obs) |
| admin | 1 | OnImpersonation(Obs) — notifies when an administrator impersonates a user |
| webhooks | 2 | OnDeliveryFailed(Obs) / OnSubscriptionDisabled(Obs) — dead-letter delivery alerting / subscription-disabled notification |

### 3.4 Division of labor: events vs hooks

Hooks and events are not an either-or choice. ploykit's division of labor:

```
Inside the framework: hooks (function fields) — synchronous, explicit semantics, type-safe
Outbound notification: platform/events (in-transaction enqueue) — asynchronous, multi-subscriber, crash-recoverable

Hooks are the entry point for products to customize framework behavior;
events are the notification channel for products to react to completed operations.
They complement each other; neither replaces the other.
```

**Built-in framework mechanism**: events are enqueued in-transaction via events.Emit (outbox semantics: commit guarantees delivery, rollback kills the event too) → subscription workers dispatch asynchronously, retrying failures with exponential backoff (ADR 0003).

---

## 4. Additional Architecture Rules

### 4.1 Middleware chain order (as wired in example/cmd/app/main.go)

```
metrics Mount (/metrics, optional bearer-token gate)
  → auth-path rate limit → PrincipalHolder → RequestID → AccessLog → SecurityHeaders
    → BodyLimit (/api/ and /auth/) → Timeout (5s, except /ws)
      → CORS → CSRF (conditional) → Recover
        → Authenticate (session cookie or PAT Bearer)
          → per-user rate limit
            → handler (transaction + hooks + audit within the same transaction)
```

Workspace scoping is applied per route group, not globally: `WorkspaceHeaderCtx` reads the `X-Workspace-Id` header (or the URL path parameter on nested routes), checks credential scope and `GetMember`, then injects `WorkspaceID`/`Role` into the Principal; an `authz.Require` permission gate composes on top where a route declares one.

### 4.2 Decoupling business domains from identity

**Hard constraint: business domains never import identity.** Dependencies are limited to three things:
1. `webx.Principal` (carried in ctx, populated by identity middleware)
2. `MemberCheck func(ctx, wsID, userID) (bool, error)` injected as a closure
3. `RoleOf func(ctx, wsID, userID) string` injected as a closure

### 4.3 Two notification deduplication strategies

| Strategy | Implementation | Applies to |
|---|---|---|
| Once per month | `NotifyService.NotifyOncePerMonth` (persists the row with a `once_per_month` flag; the partial unique index `uq_notification_month` on `(user_id, type, month)` collapses repeats — a conflicting insert is reported back as "not new") | near-limit/exhausted quota reminders |
| Once forever | `DedupKey` inserts (`uq_notification_dedup` on `(user_id, dedup_key)`); milestone grants dedup independently via `uq_quota_grant_dedup` on quota_grant `(workspace_id, counter_key, reason, ref_id)` | milestone unlocks |

### 4.4 The "congratulation lives and dies with the unlock" idempotence pattern

Side effect and its record share success or failure under **the same idempotency key**: `Service.Grant` inserts into quota_grant with `ON CONFLICT DO NOTHING` and treats `RowsAffected() > 0` as "this call performed the unlock"; the OnGrant hook fires only in that case. If the row already exists (unlocked before), the insert is a no-op and the notification never fires — replay-driven notification spam is ruled out.

### 4.5 Enforced dependency rules (internal/arch)

`internal/arch/arch_test.go` walks the whole module import graph (including transitive paths) and enforces:

| Rule | Constraint |
|---|---|
| A1 | platform/* never reaches business domains |
| A2 | business domains never import identity — decoupling per 4.2 |
| A3 | business domains never import each other; composition happens in the product composition root (example/cmd/app/main.go) |
| A4 | internal/contract is the bottom layer: no business domains, no platform/* |
| A5 | authz depends only on platform — never on business domains or identity |
| A6 | authorization imports nothing else in this module; facts and rules are injected by the caller |

The only sanctioned cross-domain edges live in `internal/arch/allowlist.txt` (admin→audit read-only queries, ADR 0002; admin/adapters/bridge → app layers of five domains, ADR 0004). The allowlist is freshness-checked: an entry whose edge no longer exists fails the test, so exemptions cannot accumulate silently. Dependency direction stays one-way throughout: products import the framework; the framework never imports products.

---

## 5. Open-Source Components (see the standalone selection document)

Backend dependency principle: prefer the standard library over third-party packages wherever possible, and every dependency must have an irreplaceable justification (budget principles in component-selection.md).
Currently 29 direct dependencies, see go.mod (besides pgx v5 / golang.org/x/crypto (argon2) / stripe-go / go-mail (SMTP) / testify (testing), river / wazero / esbuild / otel / prometheus / aws-sdk-go-v2 (S3) / robfig/cron and others entered the repository along with platform capabilities).
Frontend product-facing dependencies ≤ 10 (what example/web declares besides the @ploykit packages):
```
react / react-dom / react-router / @tanstack/react-query / @base-ui/react / zod / lucide-react / tailwindcss
```
react-hook-form is an internal dependency of @ploykit/hooks (wrapped by useZodForm), not something a product has to adopt directly.

Full selections and rejection rationale: see [component-selection.md](component-selection.md)

---

## 5B. Frontend Design Notes

@ploykit/ui is a component-and-page SDK; the product owns the application shell and composes it from SDK exports (reference composition: example/web).

### 5B.1 Composition model: provider + explicit imports

Frontend packages are layered client → runtime → hooks → ui: `@ploykit/hooks` (packages/hooks) is the zero-UI-dependency hooks layer — `PloykitProvider` (packages/hooks/src/provider) wires auth/session context and react-query — a default `QueryClient` is created when none is passed. All data hooks (`useAuth` / `useBilling` / `useWorkspace` / ...) read through it. There is no runtime override registry: customization means importing the exported pages and components and rendering your own composition. The framework prepares typed Props; the product decides layout and which slots to fill.

### 5B.2 Component surface

- **Primitives**: components/ui is a **stock mirror of shadcn registry output** (Base-UI kernel, clean-copy policy per ADR 0010: generate via CLI, adopt with path-rewrite only, no business concepts allowed in-directory — enforced by the stock-mirror guard test). Products needing long-tail components `npx shadcn add` them into their own src (same kernel, same tokens — see dev-environment.md)
- **Composite**: Page (PageHeader/PageLoading/PageEmpty/PageError), DataTable, FormField, ConfirmDialog, NotificationBell, SiteBanner, WorkspaceSwitcher, ImpersonationBanner, ...
- **Pages**: LoginPage, LandingPage, password reset / email verification, workspace pages, ...
- **Forms**: `useZodForm` wraps react-hook-form + zod validation

Slot names and Props types are SDK surface (protected by semver) — the TypeScript compiler checks Props usage, no extra validation layer.

### 5B.3 PlanGate: paywall component

No full entitlement system (multi-module × multi-entitlement × CDN-cached checks suit multi-module marketplace shapes, not a single-application plan model). Just a Gate component in the billing hooks:

```tsx
// part of the billing hooks inside @ploykit/ui
<PlanGate plan="pro" denied={<UpgradePrompt />} busy={<MySpinner />}>
  <PremiumFeature />
</PlanGate>
```

Decision logic: the current subscription's plan and the required plan are looked up in the plans list and compared by `sort_no`; while billing data loads `busy` renders, and a missing subscription renders `denied`.

---

## 6. Product Adoption Paths

> Products adopt ploykit along one of three paths depending on their starting point; the table below lists the typical approach and effort estimate for each.

| Current state | Adoption approach | Estimate |
|---|---|---|
| **Full-stack replacement** (independent products with home-grown identity/workspace/billing) | Replace identity/workspace/billing wholesale with ploykit; swap the BFF quota pipeline for ploykit/quota (hooks attached for notifications); swap analytics for ploykit/analytics | 1 week |
| **Multi-tenant products with an existing platform layer** | Replace the identity domain with ploykit/identity (gaining session revocation + event hooks); point the platform/ packages at ploykit/platform step by step; consolidate cleanup logic into OnMemberRemoved/OnTeardown and unify trigger symmetry between "removal" and "voluntary leave" | 1-2 weeks |
| **Products taking only some capabilities** | Skip identity (keep their own role system); borrow the generalized Transactional hook pattern; audit can use the ploykit/platform packages | As needed |
