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

## 产品侧用 shadcn CLI 补长尾组件

框架的 `@ploykit/ui` 自带 23 个 `components/ui` 组件（Base UI 内核 + cva/cn/Tailwind 语义
token，与 shadcn 新版同构同源）。产品侧的默认动作是**直接从 `@ploykit/ui` 导入**（root
策展导出，或 `@ploykit/ui/components/ui/<name>` 子路径导出）。shadcn CLI 只服务于一个场景：
补**框架没有的长尾组件**（calendar、command、drawer 这一类）。框架已有的 23 件**不要**用
CLI 再拉一份 —— 那会变成同一套 token 的双实现，框架升级后两份各自漂移。

shadcn 新版 CLI 的默认内核就是 Base UI，与框架同源：拉下来的组件与框架组件无内核冲突、
token 同套（example/web/src/index.css 里就是完整的 shadcn token 集），所以产品侧混用两条
来源不会打架。具体步骤（以 example/web 为例）：

```bash
# 1) 在产品目录初始化（cd example/web）
npx shadcn@latest init

# 2) 按需生成长尾组件
npx shadcn@latest add calendar

# 3) 生成后必须在仓库根目录确认全仓只有一份 Base UI
npm ls @base-ui/react
```

`init` 的关键配置：

- **内核选 Base UI**（CLI 默认即是，保持默认即可）。
- **Tailwind CSS 路径**指向产品的 `src/index.css`（不是 packages/ui 里的那份）。
- **组件别名**按产品自己的 tsconfig，生成到产品的 `src/components/ui`。
- **cn 工具**指向产品自建的 `src/lib/utils` —— 产品需要自己建这个两行文件
  （clsx + tailwind-merge，可参照 `packages/ui/src/lib/utils.ts`）。

第 3 步的判定：框架把 `@base-ui/react` 钉在 `^1.8.0`，workspace hoist 应把两处声明合成
一份；`npm ls @base-ui/react` 出现**两份**时必须先解决（对齐版本范围）再构建，否则 Go SSR
构建的 node_modules 解析会出问题。

边界与注意事项：

- **import 来源分清，不要重名混用**：框架组件从 `@ploykit/ui` 导入，产品组件从产品自己的
  `src/components/ui` 导入；同名时优先删掉产品侧那份、改从框架导入。
- **CLI 顺带装的产品依赖不进同步桥**：cmdk、react-day-picker 等不属于"react 五件套"
  （react/react-dom/react-router/react-router-dom/@tanstack/react-query），不需要进
  `example/web/scripts/sync-hoisted-deps.mjs`（见上文 render CLI dependency sync bridge
  一节）；esbuild SSR 构建会从产品目录向上解析到仓库根 `node_modules`。
- **blocks 同一通道**：shadcn 官方 blocks（整页布局模板）也走同一通道，产品想自定义整套
  布局时可用。

一句话原则：**核心组件用框架的（保持单副本和升级一致性），CLI 只补长尾。**

### 令牌合同（@ploykit/ui 的样式依赖面）

`@ploykit/ui` 的全部源码只使用**语义令牌类**（`bg-background` / `text-muted-foreground` / `border-border` …）与 CSS 变量直引语法（`text-(--success)`，用于状态色，词汇表同 `lib/utils` 的 `STATUS_TONE_CLASS`），**不使用任何经典调色板类**（`bg-gray-50`、`text-blue-600`…）——有 semantic-tokens 守卫测试钉住。因此产品侧 CSS 只需保证：

1. 完整的 shadcn 语义令牌集（`@theme inline` 映射 + `:root` 变量）；
2. ploykit 扩展状态变量 `--success`、`--warning`（亮暗两套）；
3. `@source` 指到 `@ploykit/ui` 的源码目录（workspace 链接在 node_modules 下，Tailwind 自动探测会跳过）。

产品自己的页面可以自由使用经典调色板类（Tailwind 默认色板始终生成），但框架组件不会。
