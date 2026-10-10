# Development Environment

## npm workspaces single repository

The repository root `package.json` declares workspaces: `packages/client`, `packages/runtime`,
`packages/hooks`, `packages/ui`, `example/web`. **Install dependencies once, at the repository root only**:

```bash
npm install        # generates/updates the root package-lock.json and triggers example/web's postinstall (see below)
```

- The per-package and example/web `package-lock.json` and `node_modules` are abolished;
  there is exactly one lockfile, at the root (`package-lock.json`, committed).
- Dependencies are hoisted to the root `node_modules`; `node_modules/@ploykit/*` are workspace
  junctions created by npm, pointing at `packages/*`.
- Inter-package dependencies are declared with **version-matched semver ranges**
  (e.g. ui → `"@ploykit/client": "^0.2.0"`). npm does not support the pnpm/yarn `workspace:`
  protocol; a matching version is automatically linked to the local workspace. The side effect:
  **when bumping a package version you must update consumers' ranges in sync**, otherwise they
  silently fall back to the registry version.
- react-family packages are **exactly pinned** across the repository to guarantee a single copy:
  `react`/`react-dom`/`@types/react*` = `19.3.0`,
  `react-router(-dom)` = `7.18.4` (the declarations in example/web and packages/runtime must be changed in sync).

## Single source of truth for @ploykit/* module resolution (fixing the dual declaration of vite alias / tsconfig paths)

Module mapping **lives only in each package's `exports` field in `package.json`**:

```jsonc
"exports": {
  ".": {
    "development": "./src/index.ts",     // development: source directly
    "types": "./dist/index.d.ts",        // types: build output
    "default": "./dist/index.js"         // runtime: build output
  }
}
```

Who consumes which condition:

| Consumer | Mechanism | Resolves to |
|---|---|---|
| `vite dev` (example/web) | `resolve.conditions: ['development']` (attached only when `command === 'serve'`) | `packages/*/src` source; edits hot-reload |
| `vite build` (example/web) | default conditions | `dist` build output (**run `npm run build` first**, see below) |
| `tsc --noEmit` (example/web, ui) | tsconfig `customConditions: ["development"]` | source (no "build before type-check" dependency) |
| vitest (packages/ui) | `resolve.conditions: ['development']` | source (tests always test source, never a stale dist) |

- example/web's `vite.config.ts` alias and `tsconfig.json` paths, and ui's
  `vitest.config.ts` alias (the client-shim has been deleted) are all removed — the previous
  "edit one place and everything drifts" problem is fixed at the root (before the fix, paths
  was already missing `@ploykit/runtime` and had drifted in practice, leaving
  `example/web`'s `tsc --noEmit` red; now fixed).
- All three packages point `main`/`types` at `dist` with `files: ["dist"]`, the npm publish
  shape; the output is ESM with extensionless relative imports, so consumers must resolve it
  through a bundler (vite/esbuild).

## The @types/react junction hack — abolished

The old approach (merging two physical @types/react copies with a directory junction) is no
longer needed: after workspaces hoisting, `@types/react` naturally exists as a single copy in
the root `node_modules` (19.3.0, exactly pinned across the repository to prevent drift).
**Do not create junctions manually** after rebuilding the environment; if tsc reports react
type-identity errors, first check `npm ls @types/react` for multiple versions (usually some
package pulled in a misaligned range).

## render CLI dependency sync bridge (temporary; remove once the Go side is fixed)

`example/cmd/render` (the Go esbuild SSR build in the `make -C example build` chain) pins the
Alias entries for the five react-family packages (react, react-dom, react-router,
react-router-dom, @tanstack/react-query) to absolute paths under `example/web/node_modules`,
and esbuild v0.28.2's Windows node_modules resolution cannot see through junctions
(observed error: "Incorrect function"). Therefore `example/web/scripts/sync-hoisted-deps.mjs`
uses a **postinstall hook** to sync these five packages from the root `node_modules` into real
directory copies under web:

- The copies serve only the Go SSR build and the vite `dedupe` target; tsc type identity is
  unaffected (react-family types live in `@types/*`, still a single copy at the root);
  every `npm install` refreshes them automatically, so there is no version drift;
- Other dependencies (lucide-react, sonner, @base-ui, etc.) are not synced: the SSR build's
  node_modules walk upward from the importer naturally lands at the repository root;
- **Removal condition**: once the Go side — the `Alias`/`NodePaths` in
  `example/cmd/render/main.go` — is changed to point at the repository root `node_modules`,
  delete this script and the `postinstall` line in web's `package.json`.

## Build and verification commands (run at the repository root)

```bash
npm install                 # install dependencies + sync bridge
npm run build               # tsc output (dist) for the three packages + example/web vite build
npm test                    # all vitest for packages/{client,runtime,ui}
npm run check:web           # example/web tsc --noEmit
npm run dev:web             # example/web vite dev (source directly; edits hot-reload)
```

**Dev vs production build behavior**: the vite dev server resolves `@ploykit/*` exports via
the `development` condition straight to package sources - **no pre-build needed**; a
production build (`vite build`) resolves the `default` condition pointing at `dist/`. So
"example/web can dev but cannot build directly" is expected: the build order is fixed -
root `npm run build` (produces packages/*/dist) first, then the product build.

## Native equivalents when make is unavailable (Windows / Git Bash)

`make` is usually absent from Windows Git Bash. Native equivalents per target
(verified by risk-engine-server in the field):

| make target | Native equivalent |
|---|---|
| `make verify` | `python tools/check_api.py && go build ./... && go vet ./... && go test ./...` |
| `make verify-ui` | `cd packages/ui && npx vitest run` |
| `make test-db` | `TEST_DATABASE_URL=postgres://pk:pk@localhost:5437/pk?sslmode=disable go test ./...` |
| `make -C example db-up` | `docker run -d --name ploykit-pg -e POSTGRES_USER=pk -e POSTGRES_PASSWORD=pk -e POSTGRES_DB=pk -p 5437:5432 postgres:16-alpine` |
| `make -C example backend` | `cd example && DATABASE_URL=postgres://pk:pk@localhost:5437/pk?sslmode=disable AUTH_SECRET=dev-pepper DEV_CODE=000000 go run ./cmd/app` |
| `make -C example frontend` | `cd example/web && npx vite --port 5173` |
| `make -C example build` | Follow example/Makefile line by line (npm build -> prerender -> cp dist -> go build) |

## Build and verification commands (run at the repository root)

```bash
npm install                 # install dependencies + sync bridge
npm run build               # tsc output (dist) for the three packages + example/web vite build
npm test                    # all vitest for packages/{client,runtime,ui}
npm run check:web           # example/web tsc --noEmit
npm run dev:web             # example/web vite dev (source directly; edits hot-reload)
```

**Dev vs production build behavior**: the vite dev server resolves `@ploykit/*` exports via
the `development` condition straight to package sources - **no pre-build needed**; a
production build (`vite build`) resolves the `default` condition pointing at `dist/`. So
"example/web can dev but cannot build directly" is expected: the build order is fixed -
root `npm run build` (produces packages/*/dist) first, then the product build.

## Native equivalents when make is unavailable (Windows / Git Bash)

`make` is usually absent from Windows Git Bash. Native equivalents per target
(verified by risk-engine-server in the field):

| make target | Native equivalent |
|---|---|
| `make verify` | `python tools/check_api.py && go build ./... && go vet ./... && go test ./...` |
| `make verify-ui` | `cd packages/ui && npx vitest run` |
| `make test-db` | `TEST_DATABASE_URL=postgres://pk:pk@localhost:5437/pk?sslmode=disable go test ./...` |
| `make -C example db-up` | `docker run -d --name ploykit-pg -e POSTGRES_USER=pk -e POSTGRES_PASSWORD=pk -e POSTGRES_DB=pk -p 5437:5432 postgres:16-alpine` |
| `make -C example backend` | `cd example && DATABASE_URL=postgres://pk:pk@localhost:5437/pk?sslmode=disable AUTH_SECRET=dev-pepper DEV_CODE=000000 go run ./cmd/app` |
| `make -C example frontend` | `cd example/web && npx vite --port 5173` |
| `make -C example build` | Follow example/Makefile line by line (npm build -> prerender -> cp dist -> go build) |

Clean rebuild (after switching machines or wiping installs):

```bash
# Git Bash; if files are locked, stop vite dev / Go processes first
cmd //c "rmdir /S /Q D:\code\ploykit\node_modules"
cmd //c "rmdir /S /Q D:\code\ploykit\example\web\node_modules"
cmd //c "rmdir /S /Q D:\code\ploykit\packages\ui\node_modules"   # conflicting nested location (lucide-react)
npm install && npm run build && npm test && npm run check:web
# Go rendering chain regression: cd example && go run ./cmd/render prerender
```

## Role of useApi

`useApi` wraps **imperative API calls** (submitting actions, non-cached requests); **all data
fetching goes through react-query hooks** (useBilling/useWorkspace, etc. — caching/invalidation/
retries managed by react-query, wired into the queryKeys invalidation bridge). Do not use
useApi's get as the data source for lists/details — that mixes two data layers and loses
caching and live invalidation.

## PLOYKIT_SEAL_KEY generation and configuration (encryption at rest for tenant credentials)

The `client_secret` of workspace OIDC federation configurations (migration 016, persisted by
the identity domain's FedService) is encrypted at rest with AES-256-GCM, stored in the form
`sealed:v1:<base64(nonce||ciphertext)>` — the prefix distinguishes new rows from old.
**Plaintext read compatibility has been removed** (no compatibility window): reading legacy plaintext rows fails directly with `E_SEAL_FAILED` (SSO login 500 /
webhook delivery failure). There is no "no data migration needed" compatibility window —
the only way out is to reconfigure credentials (re-enter workspace SSO configuration,
recreate webhook subscription secrets); once rewritten, rows converge to ciphertext
naturally. The master key comes from the environment
variable `PLOYKIT_SEAL_KEY`:

```bash
# Generate (base64 of 32 bytes):
openssl rand -base64 32
# example/.env or the deployment environment:
PLOYKIT_SEAL_KEY=<the base64 string printed by the command above>
```

example-side wiring (secrets are read by `sealx.NewSecretsFromEnv()` and injected into FedService):

```go
secrets, err := sealx.NewSecretsFromEnv() // unset → (nil, nil) → None mode; bad base64/length → err
if err != nil { log.Error("PLOYKIT_SEAL_KEY invalid", "err", err); os.Exit(1) }
opts := []identityapp.FedOption{}
if secrets != nil { opts = append(opts, identityapp.WithSecrets(secrets)) }
fedSvc := identityapp.NewFedService(idRepo, wsRepo.FindWorkspaceIDBySlug, oidcfed.NewResolver(), now, opts...)
```

Behavior contract (the identity/app Secrets port, default implementation in platform/sealx):

- **Configured**: PUT `/api/workspaces/{id}/sso` persists ciphertext; login reads and
  decrypts automatically.
- **Not configured** (None mode, the default): writes are rejected (500 `E_SEAL_KEY_MISSING`,
  no silent plaintext); reading legacy plaintext rows returns 500 `E_SEAL_FAILED`
  (plaintext read compatibility has been removed; re-enter the workspace SSO
  configuration to converge).
- **Bad configuration** (invalid base64 / length ≠ 32 bytes): example startup fails
  immediately; no silent degradation.
- **Key change**: old ciphertext rows fail to decrypt (warning logged on read, SSO login
  returns 500 `E_SEAL_FAILED`); re-entering the workspace SSO configuration once converges
  it. Automated key rotation is backlogged (trigger conditions in docs/ROADMAP.md).

## RLS context channels (pg.WithTenant / pg.WithService)

Database-layer multi-tenant isolation channels: business code inside a `pg.WithTenant`
transaction automatically carries `app.workspace_id` / `app.user_id`; product tables with an
RLS policy attached get row-level isolation
(framework tables, migrations 001-043, do not use RLS and keep using application-layer
authz filtering; RLS is **optional for product tables**).
The channel semantics live in `platform/pg/tenant.go` (`WithTenant` / `WithService`,
transaction-level `set_config`, nesting guards) and are pinned by
`platform/pg/tenant_test.go` and `example/internal/task/rls_test.go`. One pitfall to
remember: a custom GUC leaves an empty-string placeholder after the transaction rather
than disappearing; `current_setting` returns `''` instead of NULL (asserted in
`platform/pg/tenant_test.go`), so accessors must use `nullif(v,'')::uuid` — the same
shape as the `app.workspace_id()` accessor created by migration `1007_rls_demo`.

### Demo mode (example, single-account FORCE)

- Migration `example/cmd/app/migrations/1007_rls_demo.up.sql`: the `app` schema +
  accessor functions + `ENABLE` on the task table + **`FORCE` ROW LEVEL SECURITY** + the policy
  `using/with check (workspace_id = (select app.workspace_id()))`.
- FORCE is a **single-account demo mode**: the owner is subject to the policy too.
  In dev the example application connects as superuser `pk`, and superusers bypass all
  policies — so current behavior is unchanged and main.go needs no wiring; what is actually
  subject to the policy is the non-owner account created by the tests (see below).
- Three-state tests in `example/internal/task/rls_test.go`: (1) WithTenant(A) sees only
  A's rows; (2) a direct query without context returns 0 rows (fail-closed); (3)
  WithTenant(A) writing to tenant B is rejected by WITH CHECK (42501). Also includes a
  WithService escape-hatch comparison and concurrency without cross-tenant bleed. The tests
  run migrations themselves (the framework chain via pgm.Up plus the product chain completed
  from disk under the same bookkeeping convention), create the `ploykit_app` role
  themselves (TEST_DATABASE_URL needs CREATEROLE), and use it as the connection under test —
  **testing as owner is equivalent to not testing at all**.

How to run (Git Bash):

```bash
make -C example db-up   # or any reachable pk superuser instance
cd example && TEST_DATABASE_URL='postgres://pk:pk@localhost:5437/pk?sslmode=disable' \
  go test ./internal/task/ -run 'TestRLSTenantChannel' -v
# Framework-side channel semantics (GUC transaction-level lifecycle / nesting guards):
TEST_DATABASE_URL='postgres://pk:pk@localhost:5437/pk?sslmode=disable' \
  go test ./platform/pg/ -run 'Tenant|WithService' -v
```

(The compose instance started by `make -C example db-up` listens on port 5437:
`postgres://pk:pk@localhost:5437/pk?sslmode=disable` — the same URL `make test-db` uses at
the repository root. A native local instance on the default 5432 works equally if the `pk`
superuser is reachable.)

### Production three-account mode (ploykit_app / ploykit_migrator / ploykit_service)

Single-account FORCE is just a demo; production should separate three accounts. Then the
runtime account is not the owner, FORCE is optional (keeping it guards against accidental
owner queries), and policies are narrowed with `TO ploykit_app`:

| Account | Privileges | Purpose |
|---|---|---|
| `ploykit_app` | not owner, no BYPASSRLS | application runtime; RLS policies target it |
| `ploykit_migrator` | table owner (the table creator is the owner) | connects only during migration windows to run pgm.Up |
| `ploykit_service` | BYPASSRLS | background jobs / data repair, used only explicitly via `pg.WithService` |

Initialization example (**documented only; compose files unchanged, and not yet applied —
today the example runs migrations at startup over `DATABASE_URL` itself
(`example/cmd/app/main.go`, `pgm.Up`); the split `MIGRATE_DATABASE_URL` below is the
proposed shape, not an env var the code currently reads**; the `POSTGRES_USER`
bootstrap account is the first owner = the migration account):

```yaml
# docker-compose.yml snippet (example, not yet applied)
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: ploykit_migrator      # bootstrap account = table owner = migration account
      POSTGRES_PASSWORD: "…"
      POSTGRES_DB: pk
    volumes:
      - ./init:/docker-entrypoint-initdb.d # first startup creates the other two accounts
  app:
    environment:
      DATABASE_URL: postgres://ploykit_app:…@postgres:5432/pk?sslmode=disable             # runtime
      MIGRATE_DATABASE_URL: postgres://ploykit_migrator:…@postgres:5432/pk?sslmode=disable  # migration windows only
```

```sql
-- init/rls-accounts.sql (run once on first startup)
CREATE ROLE ploykit_app LOGIN PASSWORD '…' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE ploykit_service LOGIN PASSWORD '…' NOSUPERUSER BYPASSRLS;
GRANT USAGE ON SCHEMA public, app TO ploykit_app, ploykit_service;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ploykit_app, ploykit_service;
```

Notes: integration-test connection
strings always use the `ploykit_app` account; under pgbouncer transaction mode,
transaction-level set_config is the only safe approach (this package will never provide a
session-level setter); accessors referenced by policies must be STABLE and wrapped in
`(select fn())`, with a leading index on the tenant column; cross-tenant background
operations always go explicitly through `pg.WithService`, never implicitly.

## Adding long-tail components from the shadcn CLI (product side)

`@ploykit/ui` ships 23 `components/ui` components (Base-UI kernel + cva/cn/Tailwind semantic
tokens, isomorphic with current shadcn). The product default is to **import from
`@ploykit/ui`** (root curated exports, or the `@ploykit/ui/components/ui/<name>` subpath
exports). The shadcn CLI serves exactly one scenario: **long-tail components the framework
does not have** (calendar, command, drawer, ...). Do not re-pull the 23 framework components
through the CLI - that would create a second implementation of the same tokens, and the two
copies drift apart as the framework upgrades.

Current shadcn CLIs default to the Base-UI kernel - same kernel as the framework, same token
set (example/web/src/index.css already carries the full shadcn tokens), so mixing both
sources does not conflict. Steps (example/web as the example):

```bash
# 1) init in the product directory (cd example/web)
npx shadcn@latest init

# 2) generate long-tail components as needed
npx shadcn@latest add calendar

# 3) after generating, verify a single Base UI copy repo-wide (root)
npm ls @base-ui/react
```

init key settings:

- **Kernel: Base UI** (the CLI default - keep it).
- **Tailwind CSS path**: the product's own `src/index.css` (not the one in packages/ui).
- **Component aliases**: per the product tsconfig, generated into the product's
  `src/components/ui`.
- **cn utility**: the product's own `src/lib/utils` - a two-line file (clsx + tailwind-merge);
  see `packages/ui/src/lib/utils.ts` for the reference.

Step 3 rationale: the framework pins `@base-ui/react` to `^1.8.0`; workspace hoisting should
merge both declarations into one copy. Two copies shown by `npm ls` must be resolved (align
version ranges) before building, or the Go SSR build's node_modules resolution breaks.

Boundaries and notes:

- **Distinguish import sources, never mix same-named copies**: framework components come
  from `@ploykit/ui`, product components from the product's own `src/components/ui`. When a
  name collides, prefer deleting the product-side copy and importing from the framework.
- **Dependencies the CLI pulls in do not join the sync bridge**: cmdk, react-day-picker and
  friends are not part of the "react five" (react/react-dom/react-router/react-router-dom/
  @tanstack/react-query) and need no entry in `example/web/scripts/sync-hoisted-deps.mjs`
  (see the render CLI dependency sync bridge section above); the esbuild SSR build resolves
  upward from the product directory to the repo-root `node_modules`.
- **shadcn blocks** (full-page layout templates) travel the same channel when a product
  wants a fully custom layout.

One-line principle: **core components come from the framework (single copy, coherent
upgrades); the CLI is for the long tail only.**

### Token contract (the styling dependency surface of @ploykit/ui)

All `@ploykit/ui` sources use **semantic token classes** only (`bg-background`,
`text-muted-foreground`, `border-border`, ...) plus the CSS-variable direct syntax for
status colors (`text-(--success)`, same vocabulary as `STATUS_TONE_CLASS` in `lib/utils`) -
**never classic palette classes** (`bg-gray-50`, `text-blue-600`, ...); a semantic-tokens
guard test enforces this. Product CSS therefore needs exactly:

1. The full shadcn semantic token set (`@theme inline` mapping + `:root` variables);
2. The ploykit extension status variables `--success` and `--warning` (light + dark);
3. An `@source` directive pointing at the `@ploykit/ui` sources (workspace links live under
   node_modules, which Tailwind's automatic detection skips).

Product pages may freely use classic palette classes (the Tailwind default palette is
always generated); framework components never do.
