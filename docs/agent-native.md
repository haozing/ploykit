# ploykit Agent-Native Design

> Living document: **session evidence first, infrastructure second** — what lands here is driven by findings from real Agent development sessions, on ploykit itself and on product repos built on ploykit. This document records current rules and surfaces only; construction history lives in git history.

---

## 1. Core Philosophy

Agents do not fear complexity; they fear ambiguity. Agent-Native is essentially about making the framework's **implicit knowledge explicit and contractual**:

| Principle | Meaning | ploykit landing point |
|---|---|---|
| Making implicit knowledge explicit | rules an Agent cannot derive go into AGENTS.md | the AGENTS.md dual layer (§4.1) |
| Constraints expressed as tests | rules rely not on Agent diligence but on go test enforcement | `internal/arch` boundary tests (§4.2) |
| Progressive disclosure | hand over a 40-line map first; open details on demand | the hooks.go pattern is a ready-made template |
| Errors must be actionable | errors carry location, cause, fix | arch test output format / apierr error codes / check_api drift guard |
| Feedback loop | a single entry point for verification | `make verify` + `python tools/check_api.py` |

**A ploykit-specific judgment (the biggest difference between this design and generic approaches)**: the Agent's main battlefield is not this repo but the product repo. Agents in product repos consume ploykit via `go get` / npm, and the only Agent-facing surfaces they can touch are four:

1. the comment contracts in each domain's `hooks.go`
2. godoc
3. the error codes of `internal/contract/apierr` (E_UNAUTHENTICATED / E_FORBIDDEN / …, with a zh-CN mapping layer on the UI side in `packages/ui/src/lib/api-error.ts`)
4. the AGENTS.md bundled with the example template

However much infrastructure the framework builds in, nothing beats doing these four outlets well.

---

## 2. Current-State Inventory

### Existing assets

| Asset | Location | Assessment |
|---|---|---|
| hook contract comments | each domain's `hooks.go` (billing in `billing/app/hooks.go`) | ★ every hook carries semantics + evidence + applicable scenarios; a single ~30-line file is a complete "skill doc". 25 hooks, all wired in practice: identity 4 / workspace 8 / billing 6 / quota 4 / admin 1 / webhooks 2 (master table in docs/api-index.md) |
| test system | `_test.go` suites across the repo (platform fully covered) + vitest suites in packages/ui | counts per `go test ./...` / `make verify-ui` output |
| API contract drift guard | `docs/openapi.yaml` + `tools/check_api.py` | the central contract is the single source of truth for frontend and backend; any extra/missing route on either the spec or the code side exits 1 — a ready-made implementation of "feedback loop + actionable errors" |
| stable error codes | `internal/contract/apierr` | machine-readable E_* codes + a zh-CN UI mapping layer |
| rendering subsystem | `platform/renderx` (engine / directive / loader / prerender / seo / cache / handler / dev) + `docs/rendering.md` + `example/cmd/render` (SSR entry fixture in `platform/renderx/testdata/`) | SSR/prerender/SEO engine; example `make build` is a three-step chain: vite build → cmd/render prerender → embed → go build |
| evidence-based architecture doc | `docs/architecture.md` | highly human-readable; should not be the Agent's entry point every time |
| decision records | `docs/adr/` | architecture rulings are set in stone, preventing endless re-litigation |
| residual dev-environment knowledge | `docs/dev-environment.md` | knowledge like npm workspaces hoisting and exact react-version pinning is exactly AGENTS.md material |
| composition-root exemplar | `example/cmd/app/main.go` | shows how every domain is assembled (including the migration dual track: framework `migrations.FS` + the product's own embedded migrations) |
| product command entry | `example/Makefile` | stable command names: db-up / db-down / backend / frontend / build / clean |
| hook semantics tests | `quota/hooks_test.go`, `webhooks/app/hooks_test.go` | hooks carry behavior contracts, not just wiring |
| architecture boundary tests | `internal/arch` (A1–A7 + allowlist + stale/validity dual detection + synthetic-graph canary self-check, three-part violation output) | the constraint layer's enforcement mechanism, run automatically by `go test ./...` (§4.2) |

### Known open items

| Item | Status |
|---|---|
| overrides override slots not landed | `web/src/overrides/` as designed in architecture.md §5B.1 does not exist in example, and packages/ui has no overrides directory; docs and AGENTS.md must not reference it until it lands (example/AGENTS.md carries the do-not-reference annotation) |
| authorization + contractx have zero consumers | shelved under the wiring-discipline rule; ruling, restart triggers, and acceptance criteria in docs/adr/0005-authorization-wiring-deferral.md — when any product needs step-up / closed-set catalogs / hashable operation sets, add the example reference wiring first |

---

## 3. Four-Layer Capability Model Mapping

| Layer | Generic approach | ploykit landing point | Status |
|---|---|---|---|
| Contract layer | AGENTS.md | dual layer: root + example | landed |
| Context layer | PROJECT_INDEX / api-index / llms.txt | hooks master table in docs/api-index.md (hand-written; no generator); openapi.yaml is already the machine-readable index of the API surface | partially landed; llms.txt deferred (§5) |
| Constraint layer | type systems / lint boundaries / arch tests | Go arch tests (`internal/arch` A1–A7) + the TS compiler (ruled in architecture.md §5B.1) + the check_api drift guard | landed |
| Autonomy layer | CLI doctor/fix, golden datasets | check_api + the hooks tests cover one corner; golden HTTP snapshots remain (§5) | deferred |

---

## 4. Enforcement and Tooling

### 4.1 The AGENTS.md dual layer

**Root `AGENTS.md` (repo root, ≤40 lines).** Write only knowledge that cannot be derived from code; link everything else. Sections:

1. One-line positioning + the dependency iron rule: dependencies always flow one way, **product → framework**
2. Commands: `make verify` (contract check + build + vet + test); `make test-db` (full run with DB-gated tests, `make -C example db-up` first); `python tools/check_api.py`; `make verify-ui`
3. Hard constraints, each enforced by an arch test (§4.2): business domains must not import identity (decoupling via `webx.Principal` / `MemberCheck` / `RoleOf` closure injection, architecture.md §4.2); `platform/*` has zero business dependencies; `authz` is the cross-cutting shared layer; no horizontal imports between business domains (exemptions: admin → audit read-only per ADR 0002, `admin/adapters/bridge` composition per ADR 0004); framework migrations (001–999) are framework contract, product migrations number from **1001**; `internal/` is not exposed to products; wiring discipline (including the reverse clause); tenant credentials go through sealx
4. Navigation table: domain extension points → `<domain>/hooks.go` + docs/api-index.md; cross-cutting authz → `authz/`; rendering → `platform/renderx` + docs/rendering.md; API contract → docs/openapi.yaml + tools/check_api.py; platform capabilities → `platform/<pkg>` + docs/platform-api-index.md; frontend → packages/ui, packages/client; design → docs/architecture.md; rulings → docs/adr/; dev environment → docs/dev-environment.md; deferral registry → docs/ROADMAP.md
5. Hook four-semantics quick reference (Transactional / Observational / Validating / Cleanup, one line each)

**`example/AGENTS.md` (bundled with the product template).** This is the leverage point: every product repo scaffolded from example naturally carries Agent guidance. Content:

1. Layout: `web/src` (frontend, SSR dual entries `entry-client.tsx` / `entry-server.tsx` + `routes.tsx` + `pages/`), `internal/` (business logic), `cmd/app/main.go` (composition root — read it before adding a new domain)
2. Off-limits: the embedded framework migrations (`migrations.FS`) cannot be changed; product migrations number from **1001**; do not hand-edit build outputs (`web/dist`, `cmd/app/frontend`), `renderx-cache`, or `node_modules`; missing framework capability → change ploykit, do not bypass the framework in the product
3. Commands: `make db-up / db-down / backend / frontend / build` (build is the three-step chain: vite build → `cmd/render` prerender → embed → go build, see docs/rendering.md §4.5)
4. Golden reference: `main.go` is the only complete exemplar of how every domain is assembled
5. The §5B.1 overrides mechanism is not landed and must not be referenced; for page integration `web/src/routes.tsx` is the source of truth

### 4.2 Architecture boundary tests (`internal/arch`)

| # | Rule |
|---|---|
| A1 | `platform/*` must not import business domains (`internal/contract` allowed) |
| A2 | business domains must not import identity. Scope: only the non-test dependency graph is checked (`go list -json ./...` without `-test` naturally excludes test files), so integration tests are exempt (e.g. `admin/adapters/http/impersonation_integration_test.go` imports identity legitimately) |
| A3 | no horizontal imports between business domains. Exemptions are explicit allowlist entries: admin, as an aggregation console, may read-only depend on the audit query surface (ADR 0002 — write paths still go through local Auditor port injection); the `admin/adapters/bridge` composition bridge (ADR 0004) |
| A4 | `internal/contract` must not import business domains or platform |
| A5 | `authz` must not import business domains or identity (it depends only on `platform/webx` and `platform/ids` — the de facto cross-cutting shared layer) |
| A6 | `authorization` must not import any other package of this module (self-contained: facts and rules are injected by callers) |
| A7 | `contractx` must not import business domains (zero business dependencies, same scope as platform) |

Implementation: `internal/arch` builds its own package graph from the `Imports` field of `go list -json ./...` (non-test imports) and judges reachability via BFS; violations print the three-part output: **file:line + the violated rule + fix guidance** (transitive violations get directory-level localization with the full path). Exemptions live in the explicit list `internal/arch/allowlist.txt` (6 entries: `admin -> audit` per ADR 0002, and `admin/adapters/bridge -> {identity,workspace,notify,billing,webhooks}/app` per ADR 0004; matching is by exact package, stale entries are auto-detected and flagged red, and entries must be business-domain → business-domain — A2/A3 are the only consumers of the exemption graph, so edges exempting other rules are flagged red immediately). `arch_canary_test.go` self-checks the rules on a synthetic graph (every rule turns red on a known violation; the healthy layering yields zero false positives; exemptions apply only to A2/A3). `example_reinvention_test.go` guards the reverse wiring-discipline clause: example must not re-implement platform capabilities by hand (e.g. CORS belongs to `webx.CORS`). Silent exemptions are not allowed.

### 4.3 Root `Makefile`

```make
verify:
	python tools/check_api.py
	go build ./... && go vet ./... && go test ./...

test-db:
	TEST_DATABASE_URL=postgres://pk:pk@localhost:5437/pk?sslmode=disable go test -p 1 ./...

verify-ui:
	cd packages/ui && npx vitest run
```

Notes: DB-gated tests auto-skip when `TEST_DATABASE_URL` is unset; `verify-ui` is separate from `verify` so the main gate stays intact on node-less machines; example is an independent Go module with its own Makefile.

---

## 5. Explicitly Deferred (with start conditions, to prevent premature optimization)

Promotion rule: a deferred item starts as soon as its start condition is met.

| Item | Start condition | Why not now |
|---|---|---|
| golden HTTP snapshots | behavioral regressions after refactors, or when adapters need changes | API drift is covered by check_api, hook semantics by the hooks tests; adapter request→response snapshots are the remaining gap |
| ploykit CLI (doctor / fix / generate) | the same onboarding error recurs in ≥2 product repos | consumption today is go get / npm with no CLI carrier; doctor's check rules should grow out of session evidence first |
| agentlog JSON log system | after the CLI exists; the renderx build chain (prerender) output offers a landing spot | ploykit remains primarily a library; the error surfacing path is error wrapping + apierr |
| llms.txt / MCP server | open-sourcing, or external Agent consumers appearing | AGENTS.md + openapi.yaml already cover the role |
| TS props doctor | never | the TS compiler is the contract (architecture.md §5B.1) |

---

## 6. AGENTS.md Maintenance Discipline

1. ≤40 lines; write only residual knowledge not derivable from code; link details to docs/, never copy them.
2. Path for new constraints: **write the arch test first, then add one line to AGENTS.md** — the doc only describes test-enforced rules and never carries enforcement on its own.
3. Content that proves useless for 5 consecutive Agent sessions → trim it (prevent bloat).

---

## 7. Diagnosing Agent Friction (Q1–Q5)

When an Agent gets stuck, crosses boundaries, invents its own verification, or reworks, diagnose with:

| # | Question | Fix lands as |
|---|---|---|
| Q1 | Did the Agent find the right file/package on the first try? | a missing navigation entry → extend the AGENTS.md navigation table |
| Q2 | Did the Agent cross boundaries (modify what it should not)? | the constraint is not explicit or not test-enforced → arch test first, then one AGENTS.md line |
| Q3 | Did the Agent invent its own verification command / use the wrong one? | missing commands → extend the Makefile / AGENTS.md |
| Q4 | Did the Agent read a large doc end to end? | progressive disclosure failed → split the index |
| Q5 | Did the same class of problem appear a second time? | solidify it: arch test / error code / doctor check item |
