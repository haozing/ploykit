# ploykit Testing Strategy

> The framework's own suites stayed green through almost every production
> defect its products filed (~40 findings across shuijing, orkome, aifengkong).
> This document turns that escape history into a doctrine: every genuine
> escaped through one of five named classes, and each class maps to a test
> lane that would have caught it. It generalizes the incident-log culture of
> the AGENTS.md "operational gotchas" into a systematic test taxonomy.

---

## 1. The five escape classes (evidence: real production cases)

| # | Class | Representative escapes | The gap |
|---|---|---|---|
| 1 | **Test environment ≠ production runtime** | QuickJS stack overflow killed prerenders while Node SSR was fine (the wasm engine IS the runtime — rebuilt with a catchable guard, ADR 0015); hydration lost ALL page props because pageId derived from component names that production minification mangles — vitest never minified; standalone npm installs got zero Tailwind classes because Tailwind skips node_modules and the monorepo-relative `@source` path broke (packages/ui/README.md, "Tailwind v4 integration") | For every transform production applies (minify, wasm sandbox, standalone tarball install), there must be one test that runs POST-transform |
| 2 | **Cold/warm state and time** | Cold-DB boot failures (missing river schema, concurrent migration races); DB-gated harnesses assuming a pre-migrated database; CSRF cookie expiry (12h) outliving sessions made every write 403 on loaded pages (docs/api-conventions.md, "CSRF lifecycle"); a bootstrap race between concurrent `/config` fetches cached the loser token | Tests verify moments; production runs timelines — cold boots, expiries, replays, and concurrent writers need their own lanes |
| 3 | **Contracts that lived in docs/tests instead of types and runtime** | The registration hook's tx semantics differed by registration path; the nil-tx trap existed only as test-assertion documentation until a copied hook panicked in production (ADR 0016); PAT scope `{"workspace_ids": []}` means allow-nothing but was minted silently (CHANGELOG 0.8.2); the render cache key excluding query strings was an undocumented dark constraint (docs/rendering.md) | The durable fix is structural: split hooks by lifecycle so the trap is unrepresentable, reject misconfiguration at construction, prefer database invariants (partial unique index) over code discipline, add boot-time probes (devx.RLSCheck) for cross-layer pairing |
| 4 | **Missing adversarial-consumer view** | Objects written outside storagex.Put (migration tools, rsync) served silent 404s — the missing sidecar was the only symptom (CHANGELOG 0.8.1); scripts/integrations could not discover the mandatory X-Workspace-Id header (docs/api-conventions.md); products copied last year's hook code into JIT paths | For each public surface ask: who ELSE writes this state, calls this without our client, or copies this pattern from last year's product? |
| 5 | **Unowned cross-layer seams** | FORCE + ENABLE ROW LEVEL SECURITY with GUC policies while every query ran on the bare pool: each layer correct, the combination dead code on superuser connections and 42501 on fresh machines — two production incidents (docs/architecture.md §4.6); the framework's own example had the same two-skins shape: an RLS test demonstrating correct usage for months while the production task paths bypassed it (fixed in 0.9.0) | Seams need an OWNER: a boot-time probe plus a normative doc section (architecture.md §4.6 now owns the RLS seam) |

## 2. The lane taxonomy

Lanes are cumulative: higher lanes assume the lower ones pass. `make verify`
(L0) gates every commit; `make test-db` (L1) runs with
`TEST_DATABASE_URL=postgres://pk:pk@localhost:5437/pk?sslmode=disable`.

| Lane | Name | Covers | Where it lives |
|---|---|---|---|
| L0 | Unit / pure | Fast, fake-based logic tests; the majority of every suite | `make verify` (Go `go test ./...` without DB env), `npm test` (packages/client, runtime, ui vitest), `tools/check_api.py`, `tools/check_docs_language.py` |
| L1 | Integration, warm DB | DB-gated repository/service tests against `TEST_DATABASE_URL` | workspace/adapters/pgrepo/repo_test.go, platform/pg/tenant_test.go, identity/adapters/pgrepo/*_test.go, provisioning/personal_db_test.go |
| L2a | Cold boot | The real application boots against a FRESH database and serves real HTTP — no pre-migrated warm DB; catches missing bootstrap steps, migration races, first-hour-on-a-new-machine failures | example cold-boot e2e (this batch) |
| L2b | Non-bypass role | RLS-protected paths exercised as a NOSUPERUSER NOBYPASSRLS role — owner/superuser bypass makes every policy test vacuous | example/internal/task/rls_test.go, platform/pg/tenant_test.go, platform/devx/checks_rls_test.go; boot probe: devx.RLSCheck (platform/devx/checks.go) |
| L2c | Post-transform artifacts | Behavior of the SHIPPED artifact, not the source: hydration against a minified bundle, ESM loading of built dist, tarball install in a scratch dir | packages/runtime/src/__tests__/hydrate-minified.test.tsx (minified bundle), tools/esm-smoke.mjs (dist smoke, run after build), tools/tarball-smoke (this batch: npm pack → scratch install → import probe) |
| L2d | Real engine | The actual QuickJS wasm binary executes the render — never a Node stand-in | platform/renderx/engine_test.go (drives the wasm; the stack-guard regression lives here) |
| L3 | Real-app e2e | Boot the example app, real HTTP flows end to end (registration → provisioning → authenticated use), real database; adversarial consumers use plain HTTP clients without @ploykit/client | example cold-boot e2e (this batch) is the full-app member; example/internal/authorization/strong_e2e_test.go is the harness precedent (real schema, real sessions, real gate) |
| L4 | Field-report loop | Real products in production — friction and discoverability defects are findable ONLY by use | The pipeline below; the lane the doctrine aims to SHRINK, not eliminate |

Lane notes:

- **L2a (cold boot)** exists because of class 2. A warm CI database is the
  single largest shared assumption between the test environment and
  production; the migration-race class escaped through it repeatedly. Cold
  boot also subsumes the AGENTS.md river-schema gotcha: `events.Migrate` at
  boot is exercised for real, not assumed.
- **L2b (non-bypass role)** exists because of class 5. "Testing as owner is
  equivalent to not testing at all" (dev-environment.md). The lane is
  complemented by the boot-time doctor probes wired in
  example/cmd/app/main.go (RiverSchemaCheck, RLSCheck, SealKeyCheck,
  CookieSecureCheck, DrainWindowCheck) — lane tests prove a configuration
  once; probes prove it on every boot in every deployment.
- **L2c (post-transform)** exists because of classes 1 and 4. The published
  artifact is what consumers get: the tarball lane answers "does a standalone
  `npm install` of this package work in a clean tree" — the exact question
  the Tailwind `@source` escape punished for not asking.
- **L2d (real engine)** exists because of class 1 for the rendering surface:
  ADR 0015 rebuilt the wasm engine precisely because the Node stand-in could
  not observe stack exhaustion.
- **L4 (field-report loop)** pipeline: field report → source-verified verdict
  (fix / decline with rationale / ROADMAP entry with trigger condition, per
  docs/ROADMAP.md's registry rules) → release → product re-verification. The
  observed cycle time across the 0.8.x–0.9.0 window was DAYS, not months —
  that turnaround, not any test lane, is the actual mitigation for defects
  only production use can surface.

## 3. Normative rules (the checklist for every new capability)

1. **Declare lanes at birth.** A new capability lands with L0/L1 tests plus a
   statement of which L2 lanes apply (and new lane coverage where none fits).
   A zero-L2 capability must declare why in its docs — this is the same
   boundary clause AGENTS.md imposes on example wiring: "works because
   example tests it" does not extend to paths nothing exercises.
2. **One test per transform.** Inventory the transforms production applies to
   the capability (minification, bundling, wasm sandboxing, tarball
   packaging, SQL migrations) and ensure at least one test runs on the far
   side of each (L2c/L2d). A suite that tests only pre-transform artifacts
   tests a product nobody runs.
3. **Every "X must be kept in sync with Y" sentence in docs is a
   doctor-check candidate.** When such a pairing exists, file it; when its
   trigger fires (AGENTS.md wiring-discipline triggers), implement it as a
   boot-time probe in platform/devx so the sync is verified per boot, not
   per code review. The existing stock — RiverSchemaCheck, RLSCheck,
   SealKeyCheck, CookieSecureCheck, DrainWindowCheck — all began as doc
   sentences.
4. **Adversarial-consumer review per public surface** (class 4): who writes
   this state besides us? who calls this without our client (plain HTTP,
   scripts, third-party integrations)? what does year two look like (token
   and cookie expiries, replayed requests, schema upgrades, rotated keys)?
   An integration surface whose only tested caller is our own JS client is
   untested (see the X-Workspace-Id discovery failure).
5. **Upgrade-path review as a release gate** (classes 2 and 4): for every
   migration and every new capability, answer "a product running for a year
   — what happens in their first hour after upgrading?" Real near-miss:
   migration 048 backfills `workspace.kind = 'team'`; a factory keyed on
   `kind='personal'` would have double-provisioned every existing user on
   their next login had the adoption path not been reviewed into ADR 0016
   ("Adoption with existing users") and the Unreleased CHANGELOG before
   release. Backfills, defaults, and uniqueness changes all deserve this
   question.
6. **Structural over documentary fixes** (class 3): when a contract cannot be
   expressed in the type system or the schema, the contract is fragile. Split
   the API by lifecycle (OnRegisterTx vs AfterRegister) so the misuse is
   unrepresentable; reject misconfiguration at construction (POST /api/tokens
   rejecting the allow-nothing empty scope); prefer database invariants (the
   partial unique index on personal workspaces) over code discipline; pin
   remaining dark constraints in the normative doc (docs/rendering.md cache
   and Intl constraints) and give them a trigger.
7. **DB-gated harnesses bootstrap their own migrations** (cold-DB-safe):
   never assume a pre-migrated `TEST_DATABASE_URL` database. Reference:
   provisioning/personal_db_test.go runs `pgmigrate.Up` against the framework
   chain before testing (example/internal/authorization/strong_e2e_test.go
   does the same). Warm-DB assumptions are recorded debt (§4).
8. **Non-bypass role for anything touching RLS** (class 5): policies tested
   through an owner/superuser connection prove nothing. Copy the shape of
   example/internal/task/rls_test.go; register devx.RLSCheck with the same
   connection the application queries through.

## 4. Recorded debt

Debt is listed here so it is a decision, not a surprise (same rule as ADR
0016's adoption section):

- **Warm-DB assumptions in DB-gated harnesses**: quota/hooks_test.go,
  quota/adapters/http/usage_test.go, quota/adapters/workers/expiry_test.go,
  and example/internal/task/handlers_test.go skip without
  `TEST_DATABASE_URL` but do not run the migration chain themselves — they
  pass only against an already-migrated database. Migrating them to the
  provisioning/personal_db_test.go pattern is outstanding work; until then a
  fresh `TEST_DATABASE_URL` is NOT a supported way to run the L1 lane.
- **Session-level cookie-expiry behavior is covered by design, not by
  long-running tests**: the CSRF expiry-outlives-session class is mitigated
  in the client (single-flight self-heal + guarded one-shot reload,
  CHANGELOG 0.9.0) and documented in docs/api-conventions.md. No lane runs
  wall-clock-expiry scenarios; if a future escape shows the self-heal is
  insufficient, the fix is a deterministic clock seam in the client, not a
  13-hour test.

## 5. Maintenance note

This document updates EVERY time a new escape class is named. The protocol
when a production finding does not fit classes 1–5:

1. Name the class (one sentence: what shape of defect does it collect?).
2. Add or extend a lane that would catch it (a class without a lane is a
   complaint, not a doctrine).
3. Add the matching checklist line to §3 so the next capability declares it
   at birth.

The five classes above were named 2026-10 from ~40 field findings across
three products; classes 1–2 dominated the frontend/render surface, classes
3–5 the multi-tenant backend. Expect the next class to come from whichever
surface the lanes below cover least — today that is time-based behavior
beyond cookies (scheduled jobs, retention, quota windows), which L4 is still
the only lane observing.
