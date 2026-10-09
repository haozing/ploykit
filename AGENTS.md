# ploykit

Go + React multi-tenant SaaS full-stack framework: business domains (identity / workspace / billing / quota / admin / notify / audit / analytics / webhooks / schedule / settings) + cross-cutting layer (authz) + platform packages (platform/*) + @ploykit/ui. **Dependencies are strictly one-way: product → framework.**

## Commands

- Verification: `make verify` (contract check + build + vet + test); full run with database: `make -C example db-up` first, then `make test-db`
- API contract drift: `python tools/check_api.py` (docs/openapi.yaml ↔ route registration; exit 1 on any endpoint present on one side but missing on the other)
- Frontend component tests: `make verify-ui` (packages/ui)

## Hard constraints (enforced by internal/arch tests; violations fail the build)

- Business domains must not import identity — decouple via webx.Principal / MemberCheck / RoleOf closure injection (docs/architecture.md §4.2)
- `platform/*` has zero business dependencies
- `authz` is a cross-cutting shared layer: business domains may depend on it; it must not depend on business domains or identity
- `authorization` (the strict-authorization profile) is self-contained — it must not import any other package in this module (A6); `contractx` has zero business dependencies (A7)
- No lateral imports between business domains (exceptions: admin → audit read-only queries, docs/adr/0002; admin/adapters/bridge composition bridge, docs/adr/0004)
- `migrations/` (001–999) are a framework contract, evolved only by the framework; product migrations are numbered from 1001
- `internal/` is not exposed to products
- **Wiring discipline**: a new platform package or new domain must land together with example wiring (at least three of page + API + DB + tests); capabilities shipped with zero wiring must not be merged. Optional external-service capabilities are always "fully wired, silently degrade when the env is missing". **Reverse clause**: in the same change set that adds or changes a platform capability (middleware, helper, port, contract endpoint), search example for existing hand-written equivalents and replace them with the framework capability — "framework grows a capability → clean up the product-side hand-written copy" is as mandatory as "new capability must be wired". The existing stock is guarded by the example anti-duplication tests in internal/arch.
- **Tenant credentials stored in the database must go through sealx** (PLOYKIT_SEAL_KEY; no key configured = new secret writes are rejected; legacy plaintext rows error on read — there is no plaintext-read fallback, such credentials must be reconfigured)

## Navigation

| Looking for | Go to |
|---|---|
| Domain extension points (hooks) | docs/api-index.md (master table with per-hook semantics) → each domain's `hooks.go` (signatures); transactional events go through `platform/events` (ADR 0003) |
| Cross-cutting authorization | `authz/` |
| Rendering (SSR / prerender / SEO) | `platform/renderx` + docs/rendering.md |
| API contract | docs/openapi.yaml + tools/check_api.py |
| Platform capabilities | `platform/<pkg>` |
| Platform API surface (middleware/helpers — check before writing code) | docs/platform-api-index.md → `platform/<pkg>` |
| Frontend | packages/ui, packages/client |
| Design / decisions / dev environment | docs/architecture.md / docs/adr/ / docs/dev-environment.md |
| Trigger-based deferral registry ("later" list) | docs/ROADMAP.md (single registry: trigger conditions + decided approach) |

## Hook semantics quick reference

Transactional = returning an error rolls back the whole operation; Observational = logging only; Validating = may block the operation; Cleanup = best-effort, one item failing does not block the rest. See docs/api-index.md for the per-hook table.
