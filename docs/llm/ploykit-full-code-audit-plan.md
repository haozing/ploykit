# PloyKit Full Code Audit Plan

Date: 2026-06-27

This document defines how to audit the whole PloyKit repository after the single-version clean-slate refactor. The goal is not to prove that every line is perfect. The goal is to find places where the code, generated artifacts, tests, templates, modules, runtime behavior, and LLM documentation disagree.

## Audit Position

Audit from the contract outward:

1. The public module contract is the source of truth.
2. Validators reject anything outside that contract.
3. Generators derive artifacts from the same contract shape.
4. Runtime uses generated manifests and normalized contracts only.
5. Templates and checked-in modules teach the same shape.
6. Tests and docs prevent the old shapes from returning.

If a feature needs another authoring path, treat it as a design finding first, not as an implementation detail.

## Scope

Audit these repository areas:

| Area | Files |
| --- | --- |
| SDK contract | `src/module-sdk/*` |
| Runtime contract and host adapters | `src/lib/module-runtime/*`, `apps/host-next/lib/*`, module route pages under `apps/host-next/app/*` |
| Generators and CLI | `scripts/*.mjs`, `scripts/lib/*.mjs`, `scripts/*.ts` |
| Checked-in modules | `modules/platform-smoke`, `modules/resource-smoke`, `modules/public-tool-smoke` |
| Templates | `templates/modules/app`, `templates/modules/resource`, `templates/modules/tool`, `templates/modules/connector` |
| Generated facts | `src/lib/module-map.ts`, `src/lib/module-map.manifest.json`, `docs/llm/*.generated.md`, module `.ploykit/generated/*` |
| Tests | `tests/*` |
| Active LLM docs | `AGENTS.md`, `docs/llm/*`, `docs/llm/concepts/*`, `docs/llm/recipes/*` |

Do not treat old `docs/*.zh-CN.md` as the LLM fact surface. They may be audited later as human narrative docs, but they should not override `AGENTS.md` and `docs/llm`.

## Audit Axes

### 1. Single-Contract Integrity

Question: does the repo expose exactly one module authoring model?

Check:

- `ModuleDefinition` has no `contractVersion`, no author-facing `routes`, no static assets under `resources`, and no `resources.pages`.
- `validateModuleDefinition` rejects removed fields rather than normalizing them.
- Runtime types do not reintroduce removed authoring fields.
- Any remaining `routes` vocabulary is clearly internal runtime route manifest, quality route evidence, or host presentation route terminology.

Evidence commands:

```bash
rg -n "contractVersion|routes\\.site|routes\\.dashboard|routes\\.admin|routes\\.api|resources\\.locales|resources\\.icons|resources\\.assets|resource\\.pages|resources\\?\\.(locales|icons|assets)" src scripts modules templates tests docs/llm
npm run test:module-contract
```

Findings to write:

- Any supported old authoring input is high severity.
- Any test-only rejection fixture is acceptable if it clearly proves refusal.
- Any diagnostic text that teaches old authoring is medium severity.

### 2. Validator And Runtime Agreement

Question: can a module pass validation but fail at runtime because the two systems understand different shapes?

Check:

- Every path-like field validated by SDK is loadable by `resolveModuleEntryLoader`.
- Every runtime route comes only from top-level `pages` and `apis`.
- `module:test` checks the same pages that host runtime can route.
- Public pages require metadata/cache before Web Shell exposes them.
- Public APIs require `anonymousPolicy`.
- Permissions declared on pages/APIs/actions/resources are also top-level permissions when needed.

Evidence commands:

```bash
npm run test:module-doctor
npm run test:host-runtime
npm run module:test -- platform-smoke --summary
npm run module:test -- resource-smoke --summary
npm run module:test -- public-tool-smoke --summary
```

Findings to write:

- Validator/runtime mismatch is high severity.
- A CLI smoke test that checks a non-runtime path is high severity.
- A missing negative test for a clean-slate invariant is medium severity.

### 3. Generated Artifact Truthfulness

Question: do generated files describe real runtime behavior, or do they invent facts?

Check:

- `src/lib/module-map.ts` imports only real module-local files.
- Module map assets come from `assets`, not compatibility fields.
- OpenAPI paths come only from explicit `apis`.
- Resource schemas and action schemas can appear as schemas/facts, but not as implicit HTTP paths.
- Generated data plan aligns with Data v2 tables/documents and runtime schema.
- Generated LLM docs reflect current SDK source.

Evidence commands:

```bash
npm run modules:scan
npm run llm-wiki:generate
npm run modules:check
npm run data:generate -- modules/resource-smoke
npm run data:types -- modules/resource-smoke
npm run test:advanced-runtime
```

Manual inspection targets:

- `modules/resource-smoke/.ploykit/generated/openapi.json`
- `modules/resource-smoke/.ploykit/generated/data-plan.json`
- `src/lib/module-map.manifest.json`
- `docs/llm/contract.generated.md`
- `docs/llm/errors.generated.md`

Findings to write:

- Generated APIs that are not executable APIs are high severity.
- Generated docs stale against source are medium severity.
- Generated map drift is high severity if the host would load stale modules.

### 4. Module Boundary And Capability Safety

Question: can module code bypass host primitives?

Check:

- No module imports host internals.
- No module uses Node builtins, `process.env`, global `fetch`, database clients, `eval`, or dynamic `ctx` access.
- Every used `ctx.*` capability has matching permission and contract metadata.
- External services use `serviceRequirements` and `ctx.services.invoke`.
- External HTTP uses `ctx.http.fetch`, `Permission.ExternalHttp`, and explicit `egress`.
- Data access goes through Data v2 and `ctx.scope`; no tenant authority columns are owned by modules.

Evidence commands:

```bash
rg -n "from ['\"]node:|process\\.env|globalThis\\.fetch|\\bfetch\\(|eval\\(|new Function|ctx\\[[^\\]]+\\]|src/lib|@host" modules templates
npm run modules:check
npm run test:security-runtime
```

Findings to write:

- Host internal import from a module is high severity.
- Direct DB or process environment access is high severity.
- Missing permission for a used capability is high severity.

### 5. Host Runtime Behavior

Question: does Web Shell route, render, secure, and present module output correctly?

Check:

- Dashboard, admin, and site pages all use strict React/TSX page output.
- Public aliases resolve to the expected canonical page behavior.
- Route auth and permission checks deny before loader/component execution.
- API/action/webhook routes enforce auth, anonymous policy, idempotency, permissions, and commercial guards.
- Host navigation labels resolve from locale keys where strict i18n is active and have clear fallback behavior otherwise.

Evidence commands:

```bash
npm run test:host-runtime
npm run test:module-action-route
npm run test:ui-runtime
npm run test:host-page-runtime
npm run test:web-shell
npm run test:seo-presentation
```

Findings to write:

- Loader/component execution before access check is critical severity.
- Public route without cache/metadata policy is high severity.
- UI fallback behavior that hides contract errors is medium severity.

### 6. Data, Scope, And Commercial Integrity

Question: do data isolation and commercial facts belong to host primitives?

Check:

- Data v2 tables/documents have explicit scopes and migrations.
- Resource schemas do not contain tenant/workspace authority fields.
- Runtime data guards prevent cross-scope writes.
- Commercial actions use `ctx.metering`, `ctx.credits`, `ctx.entitlements`, and `ctx.commerce`.
- Tests cover credit reservation/commit/revoke and entitlement access.

Evidence commands:

```bash
npm run test:advanced-runtime
npm run test:data-runtime
npm run test:security-runtime
npm run test:commercial-ledger
npm run test:web-shell
```

Environment note:

`npm run test:data-runtime` may require local Postgres. If Docker/Postgres is unavailable, record this as an environment gap, not as a passed check.

Findings to write:

- Module-owned tenant authority is high severity.
- Commercial state mocked inside modules is high severity.
- Missing Postgres evidence is a residual risk, not a code finding.

### 7. Templates And Reference Modules

Question: would a new user or LLM scaffold the clean architecture by default?

Check:

- Only `app`, `resource`, `tool`, and `connector` templates exist.
- Templates pass doctor and module test after variable replacement.
- Templates do not include deprecated fields or compatibility comments.
- Reference modules are focused smoke modules, not broad product demos.
- Template README files tell the shortest correct path.

Evidence commands:

```bash
npm run test:developer-experience
npm run modules:templates
rg -n "contractVersion|routes:|resources\\.locales|resources\\.icons|resource\\.pages|legacy|compatibility|v1|v3" templates modules docs/llm
```

Findings to write:

- Template teaches removed shape is high severity.
- Template passes doctor but fails runtime route access is high severity.
- Template contains broad optional architecture not needed for the target use case is medium severity.

### 8. LLM Documentation And Agent Usability

Question: can an LLM build modules correctly without hidden tribal knowledge?

Check:

- `AGENTS.md` points to active LLM docs and does not contradict them.
- `docs/llm/index.md` starts with the current workflow.
- `contract.generated.md` and `capabilities.generated.md` are generated from source.
- Recipes show complete current examples with `pages`, `apis`, `assets`, and `resources` in the right places.
- Docs do not say “later”, “adapter”, “fallback”, or “compatibility” unless describing host runtime fallback behavior, not module authoring compatibility.
- Error docs tell LLMs to surface platform errors rather than flattening them.

Evidence commands:

```bash
npm run llm-wiki:generate
npm run llm-wiki:check
npm run docs:encoding-check
rg -n "contractVersion|routes\\.site|routes\\.dashboard|routes\\.admin|routes\\.api|resources\\.locales|resources\\.icons|resource\\.pages|compatibility|legacy|v1|v3|adapter|later" AGENTS.md docs/llm
```

Findings to write:

- Active LLM docs teaching removed fields are high severity.
- Generated docs stale against source are medium severity.
- Human docs outside `docs/llm` that contradict active docs are low severity unless linked from `AGENTS.md`.

### 9. Test Suite Quality

Question: are tests proving architecture, or merely matching current implementation?

Check:

- Every clean-slate invariant has a negative test.
- Tests do not reintroduce old shapes as valid fixtures.
- Tests use real module fixtures where possible.
- Generated artifacts are checked for semantic truth, not just existence.
- Browser/Web Shell tests use discovered module facts rather than hard-coded deleted demo ids.

Evidence commands:

```bash
rg -n "public-tools-demo|capability-demo|cms-demo|shop-demo|white-label-site-demo|ai-rag-demo|modules/hello" tests scripts src apps docs/llm
npm run test:developer-experience
npm run test:release-candidate
```

Findings to write:

- Test fixture validates old model as success is high severity.
- Test asserts only existence of generated artifact while artifact can lie is medium severity.
- Test uses deleted demo ids is medium severity.

## Suggested Audit Order

Run the audit in this order:

1. **Residual scan first.** Search for removed authoring shapes and deleted module ids.
2. **Contract audit.** Read `src/module-sdk/types.ts`, `validator.ts`, `validator-clean-contract.ts`, and generated contract docs.
3. **Runtime route audit.** Follow `pages/apis` from module definitions through module map, normalization, route manifest, host route resolution, and page/API execution.
4. **Generated artifact audit.** Inspect module map, OpenAPI, data plan, generated docs, and tests around them.
5. **Security audit.** Review module boundary rules, capability permission coupling, route access checks, API/action/webhook guards, and service requirements.
6. **Fixture/template audit.** Create a module from each template and compare it to the maintained smoke modules.
7. **Docs audit.** Read only active LLM docs as the fact surface and check for contradictions.
8. **End-to-end verification.** Run the command matrix and record environment-limited checks separately.

## Command Matrix

Minimum local gate:

```bash
npm run typecheck
npm run modules:check
npm run docs:encoding-check
npm run test:module-contract
npm run test:module-doctor
npm run test:developer-experience
npm run test:host-runtime
npm run test:security-runtime
npm run test:advanced-runtime
npm run test:web-shell
npm run test:ui-runtime
npm run test:host-page-runtime
npm run test:seo-presentation
```

Focused module gate:

```bash
npm run module:doctor -- platform-smoke
npm run module:doctor -- resource-smoke
npm run module:doctor -- public-tool-smoke
npm run module:test -- platform-smoke --summary
npm run module:test -- resource-smoke --summary
npm run module:test -- public-tool-smoke --summary
```

Data gate:

```bash
npm run data:generate -- modules/resource-smoke
npm run data:types -- modules/resource-smoke
npm run data:verify -- --module resource-smoke
npm run test:data-runtime
```

Release-style evidence gate:

```bash
npm run test:release-candidate
npm run test:catalog-runtime
npm run test:module-map
npm run test:module-action-route
npm run test:module-service-contract
```

## Finding Severity

| Severity | Meaning |
| --- | --- |
| Critical | Access control, data isolation, commercial ledger, or secret boundary can be bypassed. |
| High | The clean-slate architecture is contradicted, runtime behavior differs from contract, or generated artifacts lie about executable behavior. |
| Medium | Docs, tests, templates, or diagnostics can mislead users/LLMs, but runtime is not immediately unsafe. |
| Low | Naming, organization, duplication, or polish issue that does not change behavior. |

## Audit Report Format

Use this format for the final audit document:

```md
# PloyKit Full Code Audit Report

Date:
Commit / worktree:

## Executive Judgment

## Findings

### F1. Title

- Severity:
- Area:
- Evidence:
- Why it matters:
- Recommended fix:
- Tests to add or update:

## Residual Risks

## Verification Results

## Clean-Slate Regression Scan

## Follow-Up Patch Plan
```

## Exit Criteria

The full audit can be called complete only when:

1. No active source path supports removed authoring shapes.
2. Validators, runtime, generators, templates, modules, tests, and LLM docs agree on the same contract.
3. Generated artifacts describe real executable runtime behavior.
4. Module boundary, scope, commercial, and service constraints are enforced before handler execution.
5. All required command gates pass or have explicit environment-limited evidence.
6. Every high or critical finding has either a patch or a deliberate architectural decision attached.
