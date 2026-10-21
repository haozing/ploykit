# Changelog

All notable changes to ploykit are documented here. Format: Keep a Changelog;
versions follow semver — under 0.x, minor bumps may carry breaking changes
(each one is called out).

Version scope: the Go module and the `@ploykit/*` npm packages are versioned by the same
vX.Y.Z tags but NOT locked together — a tag whose diff touches no `packages/` code skips
npm entirely (the npm packages stay at the last release that changed them; each version's
entry below says whether it is Go-only). Consumers pin each side independently.

## [0.11.2] — 2026-10-21

Consumer-integration batch: the component-completeness work from the
risk-engine 补件三件套 report (collaboration issue #5) plus the four integration
defects the same consumer hit while adopting the package standalone. Touches
both tracks: Go (`platform/pg` fail-fast + logging) and npm (`@ploykit/ui`
2.2.0). This is the framework's first npm consumer that does not run TanStack
Router, which is what surfaced the host-coupling bugs below.

### Added
- **ui**: `SearchSelect` — searchable single-select built on Base UI Combobox
  (keyboard navigation, ARIA combobox semantics, built-in filtering). Contract:
  `options: { value, label, disabled? }[]`, controlled `value` may be `null` /
  `undefined`, `onChange` emits the raw value or `null` on clear; `clearable`,
  `searchable`, `size`, `triggerAriaLabel`, `emptyText`, `searchPlaceholder`,
  `triggerClassName` seams. Value type is preserved (numbers do not become
  strings).
- **ui**: `DatePicker` — single-date input. `value` is a local-calendar `Date`,
  `onChange` emits local `00:00:00` or `null`; formatting is local Y-M-D (never
  `toISOString().slice(0,10)`, which shifts a day in UTC+8). Supports `min` /
  `max`, `clearable`, `size`, and native `id` / `name` / aria passthrough.
  Built on the native date input per component-selection's "no third-party when
  the standard library suffices" principle.
- **ui**: `KitLabels` gains `pageSizeAria` / `pageSizeOption` (DataTable page-size
  selector), `searchSelectPlaceholder` / `searchSelectSearchPlaceholder` /
  `searchSelectEmpty` / `searchSelectClear`, and `datePickerPlaceholder` /
  `datePickerClear`. All have built-in defaults — consumers not mounting a
  provider see no change.

### Changed
- **ui**: `DataTable` pagination gains optional `onPageSizeChange` and
  `pageSizeOptions` (default candidates `[10, 20, 50, 100]`). The selector only
  renders when `onPageSizeChange` is supplied, so every existing call site keeps
  its current layout and behavior (additive, non-breaking).
- **ui**: `admin/AuditPage` and `workspace/WorkspaceAuditPage` filter bars now use
  `DatePicker` instead of hand-wired `<Input type="date">` (reverse clause: the
  framework consumes its own new capability).
- **ui**: `useLocation()` no longer requires a TanStack `RouterProvider`. Host
  detection goes through `useRouter({ warn: false })`; outside a router the hook
  returns a `window.location` / `window.history`-backed location instead of
  throwing `Cannot read properties of null (reading 'isServer')`. The fallback
  unwraps react-router's `history.state.usr` envelope, so `location.state.from`
  reads the same value. This unblocked `LoginPage` / `SignInForm` in react-router
  and plain-SPA products (risk-engine field report; regression tests in
  `router/__tests__/no-router-host.test.tsx`).

### Fixed
- **ui (packaging, silent-failure class)**: `@ploykit/ui/tailwind.css` now
  `@import "tw-animate-css"` and the package lists it in `dependencies`. Every
  overlay primitive closes with `data-closed:animate-out`, and Base UI unmounts
  a popup only after `animationend`; with no transition utilities the event never
  fired, so **closed Select / Popover / Sheet / Dialog / Combobox stayed mounted
  with `data-closed`** — visually gone but still covering the page and swallowing
  clicks, with no console error and no failing test. The example had wired the
  import by hand, which hid the gap from the framework's own suites. Consumers
  that followed the documented one-line `@import "@ploykit/ui/tailwind.css"`
  were dead-ended (risk-engine field report 2026-10-21).
- **ui (docs)**: `packages/ui/README.md` peer deps corrected — the routing peer
  is `@tanstack/react-router` 1.x, not `react-router` 7 (the 2.0 migration left
  this line stale and it actively misleads consumers into assuming stack
  compatibility). README gained a "样式接入" section stating the one-line CSS
  contract.
- **platform/pg (observability + fail-fast)**: `dialWithRetry` now logs every
  failed attempt (`slog.Warn` with attempt, backoff, err) and logs the terminal
  reasons; a permanently-failing target no longer spends the whole
  `StartupTimeout` silently. `isConnectTransient` now classifies server errors by
  SQLSTATE first — `3D000` (missing database), `28P01` (bad password) and
  `42501` (insufficient privilege) fail fast instead of being retried as
  transport faults, while class `08` connection exceptions, `53300`
  (too_many_connections), `57P03` (starting up), `40001` / `40P01` remain
  retryable. Symptom before the fix: a missing database produced a live process
  with zero output and an unbound port for three full minutes (risk-engine
  deployment field report).

## [0.11.1] — 2026-10-20

Adoption-seam batch from the migration consumer's v0.10.5 follow-up report
(delivery-audit-orkome-v105-adoption-addendum-2026-10-20 — seven findings,
all verified in source). npm only: `@ploykit/hooks` 0.8.2, `@ploykit/ui`
2.1.1. No Go changes.

### Added
- **hooks**: `PloykitProvider` gains `workspaceHeaderSource?: 'kit' |
  'consumer'`. Default `'kit'` (unchanged behavior); `'consumer'` means the
  provider never registers the global `X-Workspace-Id` header source —
  consumers that run their own workspace-switching state register their own
  getter via `@ploykit/client`'s `setWorkspaceIdProvider` and are no longer
  overwritten (the data-crossing risk in the report). In `'kit'` mode the
  registration is also now id-diff-gated (a layout effect writing only when
  the current workspace id actually changes, instead of every render) and is
  revoked on unmount — the same-commit timing child layers rely on is
  preserved and locked by tests.
- **ui**: `slugifyWorkspaceName` is now exported (same rules the built-in
  create flow uses: lowercase, ≤40 chars, random suffix below 4). The
  injected `data.create` seam receives `(name, { slug })` — the kit-generated
  slug rides along; single-arg consumers are unaffected (extra argument
  ignored). Stop copying the slug rules per consumer.
- **ui**: `PageHeader` gains `titleClassName?: string`, and the `h1` now
  carries built-in `min-w-0 truncate` plus a `title` attribute — long names
  truncate instead of wrapping, and archived-state de-emphasis migrates via
  the class seam (consumers adopting PageHeader had lost both behaviors).
- **ui**: `KitLabels` gains `pageLoading` / `pageEmpty` / `pageRetry` — the
  `PageLoading` / `PageEmpty` / `PageError` triad defaults are no longer
  hardcoded Chinese (bilingual consumers rendering the kit states directly
  leaked Chinese in `en`; explicit props keep winning over the provider;
  defaults are the exact legacy strings).

### Changed
- **ui**: `WorkspaceSwitcherData.error` widens from `string | null` to
  `unknown`. Strings keep rendering verbatim (legacy localized-copy
  contract), but pass the original `ApiError` to get unified translation
  AND the quota-guidance branch — under the old type, injected errors could
  never light up the `E_QUOTA_EXCEEDED` billing guidance (dead branch). The
  runtime pipeline was already dual-track; only the declared contract and
  docs catch up.

### Docs
- **ui**: README Tailwind integration gains a "build-alias" note — a
  prefix alias pointing at the package *entry file* (e.g.
  `dist/index.js`) hijacks `@import "@ploykit/ui/tailwind.css"` into an
  ENOENT (alias resolution precedes exports); alias the package *directory*
  instead. The data-seam README section now documents the `unknown` error
  contract and the `(name, { slug })` create signature.



Sign-in extraction batch (field reports #30/#31): the login flow becomes a
reusable surface. npm: `@ploykit/ui` 2.1.0 (new exports; LoginPage semantics
unchanged — the existing LoginPage test suite passes untouched, which is the
regression floor).

### Added
- **ui**: `<SignInForm>` — the entire sign-in flow extracted from LoginPage
  (code + 60s cooldown, password path, OAuth buttons, open-redirect guard,
  error mapping), shell-free and embeddable in product pages. New surface:
  `legalNote?: ReactNode` or `termsUrl?` + `privacyUrl?: string` (auto-renders
  the "signing in constitutes agreement" line with links — a compliance
  requirement for paid/UGC products that had no slot), `flow?: 'tabs' |
  'email-first'` (email-first shows only email + send on the first screen;
  the code field appears after the code is sent — progressive disclosure for
  mobile), and `loginRedirectTarget?: string` (overrides the default '/app'
  fallback). Labels: 12 auth keys join `KitLabels` (resolution order:
  explicit prop → provider → byte-identical defaults).
- **ui**: `<SignInModal>` — Dialog wrapper around SignInForm (X/focus/Esc/
  overlay close). **On success it hard-navigates the full page by default**
  (the #24 lesson is built in: the client's CSRF self-heal is insurance, not
  a license for in-page login; a full reload is the bulletproof floor) — pass
  `onSuccess` to opt into soft handling.
- **ui**: `<AdminSignInPage>` — the admin-door recipe in one component
  (#31): password-only, no registration link, sober defaults ("管理控制台 ·
  仅限授权人员"), lands on `adminPath` (default '/admin'), deep links via
  AdminShell's `state.from` honored through the open-redirect guard. Identity
  is NOT split — same user table, session and `is_platform_admin` privilege;
  only the door and route are separate. The recipe (passwordOnly + no
  registerPath + sober copy + dedicated route for AdminShell's loginPath) is
  documented in docs/pages.md; admin 2FA enforcement is on the ROADMAP (the
  real substance is 2FA + short sessions; the door is the policy landing
  point).
- **example**: in-flow sign-in wired on the blog post page — an unauthenticated
  comment attempt opens `SignInModal` in place instead of a full-page
  navigation (the wiring discipline for the new surface).


## [0.10.5] — 2026-10-20

Shell/slots enhancement batch from the migration consumer's shell-deepening
proposal (delivery-audit-orkome-shell-slots-proposal-2026-10-20 — five
findings, all verified in source, all addressed). npm: `@ploykit/ui` 2.0.5.

### Added
- **ui**: `AppShell` gains `sidebarMiddle?: ReactNode` — a content slot
  rendered between the flat nav and the nav groups, for interaction-dense
  custom lists (project navigations with row actions) that the pure
  path/label/icon nav protocol cannot host. Filters/highlights untouched;
  collapsible semantics stay the consumer's (same contract as
  `sidebarFooter`).
- **ui**: `WorkspaceSwitcher` gains a progressive-adoption data seam —
  `data?: Partial<WorkspaceSwitcherData>` (field-level merge over
  `useWorkspaceSwitch`; consumers that do not mount WorkspaceContext feed
  their own `current`/`list`/`switchTo`/`create`), `menuFooter?: ReactNode`
  (rendered after the built-in create block), and `billingHref?: string`
  (the quota-guidance link was hardcoded). Pure-injection consumers must
  supply `switchTo`/`create` themselves; the hook path is unchanged when no
  props are passed. Row-level trailing action buttons remain deliberately
  unsupported (ARIA menu anti-pattern — documented in the proposal).
- **ui**: `KitLabelsProvider` — the kit-level label override seam (26 keys
  across WorkspaceSwitcher / DataTable / SecretModal / UserMenu &
  SidebarUserMenu, including function keys for interpolated strings like the
  "workspace created" toast). Resolution order: component `labels` prop →
  provider → built-in defaults (existing per-component props keep winning;
  defaults are the exact legacy strings, so provider-less consumers see zero
  change). The DataTable pagination line is now a single overridable text
  node (consequence of the function key).
- **ui**: `SecretModal` accepts `secretValue: string | string[]` — an array
  renders N masked entries with one copy-all action (joined with `
`); the
  "我已保存" gate semantics are unchanged. `PageHeader` gains
  `leading?: ReactNode` (back-arrow/badge slot before the title).


## [0.10.4] — 2026-10-19

Settings IA + permission-gating batch (raised while reviewing the account vs
workspace menu split). npm: `@ploykit/ui` 2.0.4.

### Fixed
- **settings**: `TestEffectiveAndGateIntegration` was missing `shell_nav_hidden`
  in its expected key set (the key landed without updating this assertion —
  CI's DB job went red on the next push). Expectation completed; the clean-DB
  serial suite is green.
- **ui**: `SettingsShell` ignored `permKey` — it filtered only on `perm`
  (role), so a page gated on a fine-grained permission (e.g. `billing:read`)
  stayed visible to members without it, and clicking through 403'd. It now
  uses the same `permissionVisible` predicate as the AppShell sidebar and the
  user panel (one shared implementation, no drift), and `SettingsNavItem`
  gains the documented `permKey` field.
- **ui**: `UserMenuExtraItem` gains `perm` / `permKey` — user-panel entries can
  finally be permission-gated (a panel carried a `计费账单` shortcut that
  bypassed `billing:read`). Backward compatible: unknown `role_perms`
  (legacy payload / no Provider) keeps entries visible.
- **ui**: the provider-safe workspace/auth probes moved to
  `lib/useWorkspaceRoleSafe` so AppShell, SettingsShell and both user menus
  share one implementation (previously AppShell had a private copy).

### Changed (example)
- **example**: account and workspace settings now render through ONE shell
  with both nav groups side by side (`settingsNav = [...accountNav,
  ...workspaceNav]`), so users on `/account/*` see the workspace group and
  vice versa; the cross-scope `计费账单` entry was removed from the user panel
  (billing is reachable in the workspace group, with its real gate). Billing
  stays under the workspace group by design — `plan_code`/orders/
  subscriptions are workspace-scoped, so it cannot be an account-level page.


## [0.10.3] — 2026-10-19

Product adaptation field report (five findings; four verified in our tree and
fixed, one could not be reproduced and is documented + defensively hardened).
npm: `@ploykit/ui` 2.0.3 only.

### Fixed
- **ui**: the shell's "no Provider required" promise was self-contradictory —
  AppShell guards its own hooks with try/catch, but the always-rendered
  `UserMenu`/`SidebarUserMenu`/`ImpersonationBanner` called `useAuth()`
  unguarded, so a provider-less shell threw. All three now use a shared
  `useAuthSafe` and render nothing without an AuthContext (a product had to
  mount a bare `AuthContext.Provider` bridge to work around this).
- **ui**: menu copy had no override seam (Chinese hardcoded in
  `UserMenu`/`SidebarUserMenu`/`ImpersonationBanner`). `UserMenuLabels`
  (`accountSettings`/`logout`/`userMenuAria`/`logoutFailedToast`) and
  `ImpersonationBanner.label` are now optional props defaulting to the exact
  current strings — zero change for existing consumers, one line for a
  bilingual product.
- **ui**: `Alert` gains a `warning` variant (its absence made the most common
  alert flavour undeliverable). NOTE for consumers: Tailwind v4 only emits
  `text-warning` when the theme maps `--color-warning` — the README documents
  the required `@theme inline` line and the example theme now carries it.

### Documented / hardened
- **ui**: `@import "@ploykit/ui/tailwind.css"` was reported failing under
  vite8/rolldown (resolved as `dist/index.js/tailwind.css`, ENOENT). Not
  reproducible here across vite 8.1.6/8.3.4 × npm/pnpm layouts; the
  `./tailwind.css` export was changed to a conditional-map shape
  (`{"default": "./tailwind.css"}`) as defensive hardening and the README
  documents the equivalent `@source` workaround for anyone who hits it.


## [0.10.2] — 2026-10-19

Field-report batch from the migration consumer (five findings, all verified
against source): a dependency-range split that produced two runtime copies,
an unreachable adapter, a product-side Go mirror, a release-pipeline gap and
a silent hydration fallback. npm: `@ploykit/ui` 2.0.2, `@ploykit/hooks`
0.8.1, `@ploykit/runtime` 0.8.2 (client unchanged). Patch bumps by design:
raising any of them across a minor would re-fragment the `^0.8.x` ranges this
release exists to repair.

### Fixed
- **hooks**: published 0.8.0 declared `@ploykit/runtime ^0.7.4`, which does not
  intersect runtime 0.8.x — a normal upgrade installed a second, older runtime
  under hooks (field report #25: `npm ls` showed two copies; only the global
  directive channel made it harmless). 0.8.1 declares `^0.8.1`; the workspace
  now resolves a single runtime copy (verified with `npm ls @ploykit/runtime`).
- **runtime**: hydration props matching now works with NO matcher wiring —
  `matchPageByPath` (new, exported, dependency-free) matches the pathname
  against the client route table's own patterns (static, `:param`, `*`
  catch-all, most-specific wins). Previously a product without a `matchPage`
  fell back to the embedded pageId, which production minification breaks, and
  then mounted with NO props — a loader-driven page rendered empty data with
  only a devtools warning (field report #29). A genuine residual mismatch now
  logs `console.error` AND dispatches a `ploykit:hydration-miss` window event
  (detail: pathname, embeddedPageId) so monitoring can capture it.
  `ClientEntryOptions.matchPage` remains as an optional override.
- **renderx**: `TanstackPrelude()` / `AppendTanstackAliases()` moved into the
  framework (field report #27). Products previously hand-mirrored the JS shim
  strings into Go raw strings — v0.10.1 changed `PRELUDE_SHIMS` and every
  existing mirror silently kept running the old text, undetectable. The
  framework now owns the Go copy; a drift-guard test parses
  `PRELUDE_SHIMS`/`ESBUILD_ALIASES` from the TS source and fails when the Go
  constants diverge (verified by negative probe). The example's
  `internal/webrender` copy is deleted (reverse clause).

### Added
- **ui**: `@ploykit/ui/router` subpath exports the adapter (`Link`,
  `useNavigate`, `useParams`, `useLocation`, `useSearchParamsCompat`,
  `RouterTestHarness`, `rawStringifySearch`, `rawParseSearch`). It was
  internal-only, so products had to re-discover five semantic traps each —
  the README now carries the react-router ↔ raw TanStack ↔ adapter comparison
  table (field report #26).

### Release pipeline
- **release.yml**: a production-fidelity prerender smoke
  (`go test ./internal/fidelity/ -run TestPrerenderProductionFidelity`) now
  runs BEFORE publishing. v0.10.0 shipped a shim-unsafe call that broke every
  product's prerender in the QuickJS sandbox while all conventional gates
  stayed green; this seconds-long step renders a real page through the real
  engine, so an SSR-broken package can no longer be published (field report
  #28).


## [0.10.1] — 2026-10-19

Patch release fixing a **sandbox-only** regression shipped in 0.10.0: the
TanStack search serializer used `URLSearchParams.forEach`, which browsers and
Node provide but the renderx QuickJS prelude shim does not — every SSR
prerender died with `not a function` inside the sandbox while all other gates
(build, unit tests, CI, `go build`) stayed green. Discovered by running the
example's prerender after the 0.10.0 release.

npm: `@ploykit/ui` 2.0.1 + `@ploykit/runtime` 0.8.1 (client/hooks unchanged).

### Fixed
- **runtime + ui**: `rawParseSearch` no longer depends on
  `URLSearchParams.forEach` / iteration — it splits the query string directly
  (matching the shim's `+`-as-space semantics), so it runs inside the
  renderx QuickJS sandbox. Both adapters carry the identical implementation.
- **example**: the SSR prerender gate is now part of the fidelity lane
  (`example/internal/fidelity` TestPrerenderProductionFidelity) — it builds
  the real bundle, boots the real engine with the product prelude and renders
  the home page, failing with the sandbox error when a shim-unsafe call
  sneaks in. Verified by negative probe (reverting the fix turns it red).
  CI already runs the whole `internal/fidelity` package, so the gate is
  active without a workflow change.


## [0.10.0] — 2026-10-19

Router stack migration (orkome proposal, two steps landed): `@ploykit/runtime`
is router-free, and `@ploykit/ui` 2.0 runs on @tanstack/react-router.
npm: ui → **2.0.0** (major), runtime → **0.8.0** (new subpaths); client/hooks
unchanged (skip).

### Breaking
- **runtime 0.8.0**: `routeTable(input, assembler)` requires a `RouteAssembler`
  — the react-router assembly lives in the `@ploykit/runtime/router-react-router`
  subpath (`reactRouterAssembler`, `matchRoutePage`); `react-router` is a
  dependency of that subpath only. `ClientEntryOptions.matchPage` replaces the
  built-in pathname matching. RR products: pass the assembler + matcher (two
  lines). The package barrel is now router-free by construction (pinned by a
  static-graph sentinel test).
- **ui 2.0.0**: react-router is gone; the stack is @tanstack/react-router
  (peer `^1.170.0`). A thin internal adapter keeps the familiar surface —
  `Link`/`useNavigate`(bare path)/`useParams`/`useLocation` (RR shape: search
  with `?`, hash without `#`)/`useSearchParamsCompat` (tuple with functional
  updates and `{replace}`); tests use `RouterTestHarness`. **Host routers must
  wire the adapter's serialization contract** (`rawStringifySearch` /
  `rawParseSearch`) — TanStack's default JSON-quotes digit-only search values
  (`?mpage=%222%22`), which silently breaks pagination; the test harness wires
  it automatically, production routers must do the same. 46 files converted;
  suite 67 files / 665 tests green.

### Added
- **runtime**: `@ploykit/runtime/router-tanstack` — `tanstackAssembler`
  (RouteAssembler for TanStack trees; synchronous SSR populate — `await
  router.load()` is renderx-unsafe, a QuickJS-gate PoC established the
  synchronous path), `matchTanstackPage`, exported `PRELUDE_SHIMS` /
  `ESBUILD_ALIASES` (URLSearchParams + AbortController shims; the
  `@tanstack/router-core/isServer` alias) and `rawStringifySearch` /
  `rawParseSearch`. `@tanstack/react-router` is pinned exactly (1.170.45) —
  the SSR populate uses router internals by design.
- **example**: full TanStack migration (routes/entry-server/entry-client/blog
  + `internal/webrender` Go mirror of the shims/alias), prerender and SEO
  audit green through the QuickJS sandbox.

### Fixed
- **tools**: `fix-esm-extensions` resolves directory-index modules
  (`../router` → `../router/index.js`) instead of emitting a nonexistent
  `../router.js`.
- **tools**: the tarball fidelity lane packs **all** workspaces before any
  install, so cross-package `@ploykit/*` ranges resolve from the local
  tarballs during a release window (it previously failed with ETARGET
  before publish — the lane's own pre-publish gap).
- **example/web**: declares `@tanstack/react-router` (it imports it directly)
  and `@ploykit/ui ^2.0.0`; lockfile resynced — the v0.9.2-era declaration
  drift broke CI's `npm ci` (addressed in the audit commit).


## [0.9.1] — 2026-10-18

Field-verified follow-ups to the v0.9.0 provisioning capability (the product
that motivated ADR 0016 reviewed the release against its own incident), plus
the testing-strategy doctrine and three production-fidelity lanes distilled
from the full escape history (docs/testing-strategy.md). Go-only release (no
`@ploykit/*` package changes).

### Fixed
- **provisioning**: `PersonalConfig.Quota` is required only when `Credits`
  is non-empty — products running their own credit ledger now provision with
  `Credits`/`Quota` empty instead of being rejected as misconfigured.

### Documented
- **provisioning / migration 048 / ADR 0016**: the adoption path for
  products with pre-existing users is now explicit — 048 marks every legacy
  workspace `'team'`, so wiring the factory without first classifying legacy
  personal workspaces (product migration: `UPDATE workspace SET
  kind='personal' WHERE <product predicate>`) provisions a second workspace
  for existing users. Stated in the migration comment, the
  `PersonalConfig` docs, and a new "Adoption with existing users" ADR
  section. (Both found in the product-side review of v0.9.0.)

## [0.9.0] — 2026-10-18

The tenant-isolation and registration-provisioning batch (field evidence:
shuijing production incidents — a nil-tx panic in a copied registration hook
that left a half-provisioned account, and two RLS-outages caused by FORCE-RLS
tables queried through the bare pool). Three workstreams; the identity hooks
split is breaking.

### Breaking
- **identity**: `IdentityHooks.AfterRegister` split by lifecycle (ADR 0016).
  `OnRegisterTx(ctx, tx, userID)` fires inside the user-creation transaction
  (password register, admin create; error rolls the registration back — bind
  roles here). `AfterRegister(ctx, userID)` has NO tx parameter by design,
  fires after commit on every registration path, must be idempotent, and its
  failure no longer vanishes into a WARN: it logs at ERROR and surfaces as
  `LoginResult.ProvisioningPending`. `LoginResult` gains `registered` /
  `provisioning_pending` (wire) and `ProvisioningError` (in-process). The
  nil-tx trap that killed production is structurally gone — the no-tx hook
  has no tx parameter. Re-point your hook to the name matching its
  transactional needs.

### Added
- **provisioning** (new top-level composition package, ADR 0016):
  `PersonalWorkspace(cfg) identity.IdentityHooks` — one personal workspace
  per user (workspace gains a `kind` column with a partial unique index, so
  idempotency is a database invariant), owner membership, and optional
  onboarding credits (`quota.GrantTx`, the idempotent grant on a
  caller-provided transaction). The factory wires AfterRegister AND
  AfterLogin: every login re-ensures, so JIT half-provisioning and crashes
  converge on the next login. Migration 048. Example wired.
- **pg**: `TenantExec` / `TenantScan` — single-statement helpers that run
  inside a transaction carrying the tenant GUCs and commit immediately.
  Multi-statement units stay in `WithTenant`; session-level GUCs on pooled
  connections remain forbidden (the BEGIN/COMMIT cost is the price of
  correct tenant scoping).
- **devx**: `RLSCheck` — boot-time RLS guardrail, probe-based: fails when
  the app role bypasses RLS (superuser/BYPASSRLS — "works on the old
  machine" made explicit), enumerates FORCE-RLS tables, and probes each
  without tenant context; visible rows = a live policy that is dead weight.
  Register it next to the other doctor checks. Example wired.
- **architecture.md**: new "Tenant isolation (RLS)" section — the normative
  contract: FORCE-RLS tables make the tenant channel mandatory for every
  application query; framework migrations never ship RLS; the owner/superuser
  bypass is not a supported runtime mode.
- **example**: the task domain's production queries now run on the tenant
  channel (the RLS test had demonstrated correct usage for months while the
  production paths bypassed it — the reference implementation walks its talk
  now).

### Fixed
- **client**: the CSRF self-heal is now single-flight — N concurrent 403s
  share one re-bootstrap instead of N serial /config refetches — and a
  retried request that is rejected again triggers a one-shot
  `location.reload()` fallback guarded by a 10-second sessionStorage window
  (a full reload is the only guaranteed recovery; the guard prevents reload
  loops). (shuijing #24)

## [0.8.2] — 2026-10-17

orkome integration field-report batch (eight findings, all verified against
source): three code fixes, five contract/doc surfaces. npm: only `@ploykit/ui`
bumped (0.8.1 — button positioning fix); `client`/`runtime` stay 0.7.4 and
`hooks` stays 0.8.0.

### Fixed
- **identity**: `POST /api/tokens` now validates the PAT scope before minting —
  an empty non-nil `workspace_ids`/`permissions` list is rejected with 400 (the
  scope semantics make it allow-nothing, so minting was a silent useless
  token), entries must be workspace UUIDs, and the list is capped at 32.
  Deliberately NOT the consumer-suggested `[]`→`nil` normalization: that would
  silently widen deny-all to allow-all. (orkome #1)
- **authz**: a denial where the principal role is empty (the mount never wired
  its role middleware) is now diagnosable — the authorizer warns once per
  process, and `Require`/`RequireOwn` answer 403 `E_ROLE_UNRESOLVED` with a
  message pointing at the wiring instead of the indistinguishable
  "insufficient permission". Role-carrying denials keep the original shape.
  (orkome #2)
- **ui**: the button base carries `relative` — absolute-positioned children
  (badges/counters) anchor to the button instead of drifting to the nearest
  positioned ancestor. (orkome #6)

### Documented
- **pgmigrate**: `Down` godoc states "N most recently applied, NOT
  down-to-version" (goose-mental-model misuse is recurrent). (orkome #7)
- **events**: package doc pins the handler contract — one handler per kind,
  no cross-kind ordering guarantees; same-phase listener cascades are a
  consumer-side bus pattern. (orkome #3, attribution corrected)
- **api-conventions**: CSRF token lifetime vs page lifetime — cookie expiry
  or key rotation 403s loaded pages; `@ploykit/client` ≥0.7.4 self-heals.
  (orkome #4)
- **migration contract**: framework adapters reference framework-table columns
  (notify bell uses `notification.link`) — product migrations must not drop
  framework-table columns. In AGENTS.md and the bell adapter doc. (orkome #5)
- **ROADMAP**: the API-surface unification entry records orkome's hit-list
  offer and adds PUT/PATCH mixing to the collection. (orkome #8)

## [0.8.1] — 2026-10-17

Go-only batch from the shuijing blog-migration field report (five findings,
all verified against source): two disk-layout bugs, one adopted feature, two
documented dark constraints.

### Added
- **renderx**: `SitemapOptions.Lastmod` — an optional per-URL callback
  (`func(ctx, route, location, params) (time.Time, bool)`) emitting W3C-date
  `<lastmod>` entries; ok=false or a zero time degrades that URL to loc-only
  and legacy wiring is byte-compatible (implemented in the field, adopted
  upstream verbatim).

### Fixed
- **renderx**: the runtime disk cache's file keys and nested-directory
  namespaces collided in the flat filesystem — `/blog` (file `blog`) and
  `/blog/:slug` (files under directory `blog/`) could not coexist: whichever
  was written first silently broke the other's `Put` (memory-only entry) and
  made its `Delete` fail with "directory not empty" (every `/blog`
  invalidation WARNed while articles were cached). Entry files now carry a
  `.entry` suffix — valid path segments never contain a dot, so the two
  namespaces are disjoint; pre-suffix files are invisible to reads/listings
  and wiped by the next `PurgeForeign` (boot with a new buildID).
- **storagex**: `Local.Open` treated a missing `.meta.json` sidecar as
  "object does not exist" — files written outside `Put` (migration tools,
  rsync) were served 404 with zero logs (field report: 12 blog images lost
  to a silent 404). A missing sidecar now falls back to stat + content
  sniffing (with a WARN naming the key); a corrupt sidecar stays a hard
  error.

### Documented
- **rendering.md**: two dark constraints written down — query strings are not
  part of the cache key (pagination/filters must be path segments; a
  query-driven variant of a static page silently renders as its unparameterized
  twin), and `Intl`/locale-dependent formatting must not run inside
  SSR-rendered components (the wasm sandbox's Intl data and UTC clock differ
  from the browser's full ICU + user timezone — hydration text drift).

## [0.8.0] — 2026-10-16

Commercialization upstream batch from the shuijing master plan — settings keys
with credential sealing, the exported platform-admin guard, first-admin
bootstrap, plan editing, OAuth status card, and injectable email copy — plus
the useSEO OG-card fix. Spec and audit trail:
`docs/plan-upstream-shuijing-admin-billing.md` +
`docs/delivery-audit-shuijing-upstream-migration.md`.

npm: `@ploykit/ui` and `@ploykit/hooks` bumped to 0.8.0; `client`/`runtime`
unchanged (stay 0.7.4 — this tag does not republish what did not change).

### Breaking
- **settings**: `settingshttp.AdminDeps.MailMode` (string) → `MailModeFn`
  (`func() string`) so the mail channel can hot-reload. nil means the
  integrator does not track it (the list response then reports an empty
  `mail_mode`). The only known consumer was migrated in the same change.

### Added
- **settings**: six new admin-editable keys — `smtp_host`/`smtp_port`/
  `smtp_user`/`smtp_pass`/`smtp_from`/`site_verification_meta` — each with an
  env fallback (`SMTP_*`) that stays live until the first admin write (the
  new keys are never bootstrap-seeded; the five pre-existing env-backed keys
  keep first-boot seeding — the split is documented in `keys.go`). Sensitive
  values are masked on every surface (`IsSensitive`/`MaskedValue`: the list
  response's `items` and `effective`, the change log, the PUT response, and a
  mask-idempotent PUT short-circuit so round-tripping the masked echo never
  overwrites the stored value). `smtp_pass` seals at rest via
  `platform/sealx` (`Store.WithSealer`); without a configured seal key, new
  sensitive writes are rejected — fail-closed, per the tenant-credential
  sealing rule. Ships `ParseVerificationMeta` (normalized `name|content`
  storage; `<script>`-class input is a 400) plus `SMTPConfig` /
  `SiteVerificationMeta` hot-read accessors for product hot-mailer and
  HTML-injection middleware.
- **settingshttp**: `OAuthProviderInfo` + optional `AdminDeps.OAuthInfo` —
  the admin settings list response gains `mail_mode` and an `oauth` array so
  products can render a read-only OAuth status card (expected callback URL
  per provider; omitted entirely when the integrator wires nothing).
- **admin**: exported `PlatformAdminGuard()` — the four-check admin guard
  (401 / platform-admin / no impersonated sessions / no PATs) that was locked
  inside unexported `requireAdmin`; products hand-rolling their own guard
  closures were silently missing the last two checks. `requireAdmin` is now a
  thin wrapper over it.
- **admin**: `BootstrapPlatformAdmin(ctx, pool, email, log)` — promotes
  `BOOTSTRAP_ADMIN_EMAIL` to the first platform admin only while zero admins
  exist (idempotent on every boot; never demotes or mints a second admin;
  unknown email warns and skips; no audit record — the startup log is the
  trail). Replaces hand-SQL'd first-admin bootstrap in products.
- **billing + admin**: `PATCH /api/admin/plans/{code}` — full-replace plan
  editing (name / currency / sort_no / limits; code immutable) through the
  billing domain's admin-ops chain, audited as `admin.plan_change` with
  from/to snapshots. Plan edits take effect immediately (every reader hits
  the DB per request) and never touch existing orders (amounts are
  snapshotted at creation). New in openapi (151==151).
- **ui**: `PlansPage` — expandable per-plan editor with dynamic limits
  key/value rows, currency dropdown + free input, and server-error surfacing;
  registered in the AdminShell nav. `AdminSettingsPage` grows the SMTP card
  (the pass field never round-trips its real value — empty submit skips the
  key), the site-verification card, and the OAuth status card (hidden
  entirely when `oauth` is absent from the envelope).
- **notify/smtp**: `NewWithTemplates(cfg, Templates, log)` — per-product
  subject/body overrides for all four transactional emails (`{{.Code}}` /
  `{{.Link}}` / `{{.Workspace}}` placeholders; parse errors fail at
  construction). The zero value keeps the previous Chinese copy byte-for-byte,
  and empty fields fall back per-template.
- **hooks**: `useSEO` now emits the OpenGraph card essentials — the four
  text/URL fields never reached social/AI scrapers before (field report #22:
  live pages audited at zero og: hits). `og:title`/`og:description`/`og:url`
  mirror `title`/`description`/`canonical` by default (industry convention)
  and `og:type` defaults to `website`; explicit `ogTitle`/`ogDescription`/
  `ogUrl`/`ogType` fields override the mirrors. Twitter mirrors ride along:
  `twitter:title`/`twitter:description`/`twitter:image` follow the og values,
  `twitter:card` stays attached to `ogImage` (summary_large_image), and
  `twitterSite` is a new opt-in field. Behavior note: pages passing
  `title`/`description` now emit og/twitter metas where they previously
  emitted none — consumers that hand-rolled a side-channel og hook should
  remove it in the same upgrade to avoid duplicate tags.

### Fixed
- **ui**: `BillingPage` no longer renders one-time-only plans (SKU packs) as
  0-price monthly cards that checkout would reject anyway. The filter is
  capability-based — a plan with neither `price_monthly_cents` nor
  `price_yearly_cents` stays out of the subscription grid (a product's
  `pack_*` naming convention must not leak into a framework page) — and an
  empty state covers the all-one-time catalog.
- **example**: the public `/config` endpoint filters
  `settings.IsSensitive` keys instead of mirroring every effective setting
  verbatim — the second of the two disclosure surfaces this batch's masking
  was designed to close.

## [0.7.4] — 2026-10-16

shuijing field-report batch (21-item list + two upstream drafts): the headline
fix is a production hydration bug that silently discarded ALL page props on
every loader/static page (masked until now because pages refetch their data
client-side), plus CSRF 403 self-heal, two ui theme/tailwind gaps, and render
failure observability.

### Fixed
- **runtime**: production hydration lost every page prop. `pageId` is derived
  from component display names; the client bundle (vite, minified) mangles
  those names while the SSR bundle (Go esbuild, unminified) keeps them, so the
  props script's embedded pageId never matched the client route table's key —
  components mounted with no props and re-fetched everything (a product's
  "array field lost in hydration" was this bug wearing a costume: the
  "surviving" og meta was static SSR head output, not hydration). Hydration
  now resolves the props' owning page by matching `window.location.pathname`
  against the client's own route table (route patterns are string literals —
  minification-proof), keeping the embedded pageId as a legacy fallback and
  warning once when neither resolves. Pinned by a regression test that
  minifies a fixture with real esbuild.
- **client + webx**: a stale CSRF token (cookie expiry at the default 12h
  MaxAge, or a bootstrap race caching the loser of two concurrent /config
  responses) made every write 403 until a full page reload, with no recovery.
  CSRF rejections now carry a machine-readable `details.csrf_rejected` marker
  (plus gorilla's failure `reason`) from the server, and the client clears its
  token cache, re-bootstraps from /config, and retries the request exactly
  once (message-text matching keeps older servers covered). A plain
  permission 403 is untouched.
- **renderx**: a runtime render failure with no stale cache entry served the
  500 error page without any server-side log — the diagnosis (e.g. the wasm
  stack-overflow hint) never reached operators. The failure now goes through
  the injectable Warn sink with path and cause; pinned by a handler test.
- **ui**: `LoginPage`'s auth card and `NotificationBell`'s dropdown hardcoded
  `bg-white` (the only two non-token surfaces in the package), breaking any
  dark/custom-surface theme. Now `bg-card` / `bg-popover`.

### Added
- **ui**: `@ploykit/ui/tailwind.css` — a package-relative `@source "./src"`
  entry so Tailwind v4 generates framework-component classes for standalone
  (npm) consumers with one import line. Tailwind skips node_modules in
  automatic detection and the monorepo blueprint's relative `@source` silently
  breaks on repo splits (a real product shipped an unstyled login page for
  weeks); the import resolves in both layouts (validated through the example
  build). README documents the standalone wiring.

## [0.7.3] — 2026-10-16

QuickJS wasm rebuilt in-repo (ADR 0015): the engine's stack guard is restored
and the physical stack ceiling raised — the #15/#16 deep-tree failure class is
cured, not mitigated. Rendering behavior for ordinary pages is unchanged.
Go-only release (no `@ploykit/*` package changes).

### Fixed
- **renderx**: deep component trees no longer die with an uncatchable
  `out of bounds memory access`. Root cause: the embedded wasm (an upstream
  prebuilt quickjs-ng 0.11.0 with wasi-ld's default 64KiB shadow stack) had
  its JS-level stack guard compiled OUT under `__wasi__` — `MaxStackSize` was
  a silent no-op at every budget and one overflow permanently poisoned the
  pooled instance. The wasm is now built in-repo (`internal/qjs/csrc/`) from
  pinned quickjs-ng **v0.17.0** (upstream PR #1700 restores the wasi guard)
  with an **8MiB** shadow stack. Overflow is once again a catchable
  `Maximum call stack size exceeded` with a hint naming the budget; the
  instance survives (verified by probe and pinned by regression tests).
  Measured capacity for simple recursion: ~3.1k frames at the 1MiB default
  (was ~999 with no recoverable error), ~8.1k at the 7MiB cap.
- **renderx**: `PoolOptions.MaxStackSize` above the new `MaxLogicalStackSize`
  (7MiB = shadow stack − 1MiB headroom) is rejected at `NewEnginePool` with
  an error naming the physical stack — previously accepted and silently
  ineffective. If your wiring sets a larger budget, lower it.
- **renderx**: an instance that does take a wasm trap is now retired and
  replaced instead of being returned to the pool as a zombie (a trapped
  instance failed every subsequent render — measured).
- **renderx**: `bridge.c` hardening (carried in `csrc/`): the string arena
  grew 4MiB→8MiB (large products' minified SSR bundles sat within 1MiB of the
  old ceiling) and oversize single allocations now fail cleanly instead of
  wrapping to offset 0 and overrunning adjacent static data.
- **renderx**: the embedded wasm is ~760KB after `--strip-debug` (was ~1MB),
  with the `name` section preserved for stack-trace symbolization.

## [0.7.2] — 2026-10-15

Visitor-statistics / SEO-observation walkthrough (framework + example + npm
packages) plus the renderx #16 tail.

### Added
- **renderx**: SEO companions wired end-to-end — `RobotsHandler` (static
  config; malformed options panic at wiring time), `SitemapHandler` baseURL
  validation (absolute http(s) origin required), `AuditSEO` (head-signal
  extraction incl. duplicate-canonical count); `X-Renderx-Tier` response
  header naming the serving layer; `LayeredCache.GetOrLoadHit`. `IndexNow`
  stays a publish-hook capability (no publish endpoint in the example yet).
- **metrics**: `Mount.Traffic` — anonymous public-surface counter
  (`ploykit_traffic_requests{bot,tier,status}`) with `ClassifyUA`
  (human/google/search/ai/social/tool); UA heuristic, observation only.
- **hooks**: `useSEO({ canonical })` — canonical link support.
- **example**: robots/sitemap wiring (sitemap mounts only when
  `PUBLIC_BASE_URL` is a valid absolute origin; degraded mode never emits a
  dangling `Sitemap:` pointer); prerender SEO audit in `cmd/render` (a
  missing `<title>` fails the build; description/canonical/duplicates warn);
  traffic middleware counts the render surface; vite dev proxies
  robots/sitemap.

### Fixed
- **runtime**: `link[rel=canonical]` singleton semantics in the browser
  branch — SPA navigation updates the element in place and hydration adopts
  the SSR-emitted canonical instead of appending a duplicate; rel matching
  trims whitespace (parity with the Go-side audit).
- **renderx**: robots `SitemapURL` newline-injection guard; sitemap 405
  carries `Allow`; `GetOrLoadHit` reports a hit when the singleflight
  re-check serves a concurrently written entry; stack-ceiling errors now
  distinguish the logical `MaxStackSize` budget from the physical wasm stack
  (16MB physical ceiling pinned by a regression test).
- **metrics**: traffic counting survives handler panics (deferred; a
  response-less panic counts as 5xx) and passes `Flush` through; UA token
  table extended (Yeti / ImagesiftBot / uptime-kuma / reqwest / …).

### Docs
- `docs/visitor-analytics.md` — visitor-statistics boundary (why the
  framework ships no dashboard) + self-hosted analytics integration recipe;
  rendering.md "SEO observation vs. engine feedback" boundary + G7/G8
  refresh; ROADMAP trigger item; audit report
  `docs/delivery-audit-visitor-seo.md`.

## [0.7.1] — 2026-10-14 (Go only — npm packages unchanged)

Go-side fixes from three more walkthrough batches (aifengkong FP walk, a
rendering-chain walkthrough, and a storage walkthrough).

### Added
- **webx**: `BodyLimitExcept(n, exemptPrefixes...)` — the exemption BYPASSES
  the limit reader (layering two MaxBytesReaders clamps to the min; that was
  the product trap).
- **webx**: `NewMemoryLimiter()` doc'd in platform-api-index.
- **storagex**: `Store.List(ctx, prefix)` (Local via WalkDir, S3 via
  ListObjectsV2); `ServeUploads(store)` read-only handler;
  `ParseUpload/ParseUploadField` multipart helper;
  `ErrUploadTooLarge` sentinel.
- **renderx**: `PoolOptions.MaxStackSize` (default 1MB via
  `DefaultMaxStackSize`) — react-dom SSR recursion overflowed the wasm
  QuickJS default (~256KB) with an opaque out-of-bounds error; the error now
  carries a targeted hint.

### Fixed
- **identity**: `PATCH /auth/me` partial semantics (absent fields keep
  values; explicit `""` clears).
- **workspace**: `WorkspaceHeaderCtx` accepts `?workspace_id=` on GETs
  (browser-native downloads).
- **audit**: export truncation surfaced via `X-Truncated` /
  `X-Total-Filtered-Count` / `X-Rows-Exported`.
- **identity**: framework error messages translated to English (wire
  surface).
- **webx**: `/config` carries `framework_version`.
- **ci**: renderx watchdog test no longer flakes CI (`-short` in the unit
  job, 90s budget in the full job).

### Docs
- sealx key-format package doc (raw vs base64 env vs DeriveKey); identity
  root-mount contract with the prefixStripper wrapper recipe; rendering.md
  SSR-safe component rules; notify transactional-email recipe; anonymous-write
  CSRF decision rule.

## [0.7.0] — 2026-10-14

Two field-report batches (an FP walkthrough and a rendering-chain walkthrough)
plus platform hardening.

### Added
- **webx**: `NewMemoryLimiter()` — in-process sliding-window Limiter; single-binary
  deployments without Redis previously ran with rate limiting silently OFF.
- **hooks**: `useAuthState()` — provider-free `/auth/me` probe for product chrome
  outside AppShell (shares the `['auth','me']` queryKey with useAuth).
- **ui**: i18n override props on the remaining auth pages — `ResetPasswordPage`
  (`title`/`successHint`), `VerifyEmailPage` (`titles.{ok,failed,verifying}`).
- **audit**: export truncation is now visible — `X-Truncated` /
  `X-Total-Filtered-Count` / `X-Rows-Exported` headers when the 5000-row cap
  bites (`ExportCSV` returns the row count; `CountFiltered` added).
- **webx**: `/config` carries `framework_version` (build-info module version).

### Fixed
- **identity**: `PATCH /auth/me` is a PARTIAL update — absent fields keep their
  values (an absent `avatar_url` no longer silently wipes the avatar);
  explicit `""` still clears.
- **workspace**: `WorkspaceHeaderCtx` accepts `?workspace_id=` on GETs —
  browser-native downloads (`<a download>`) can pass the workspace without
  custom headers; writes stay header-only.
- **identity/webhooks**: empty-list endpoints serialize `[]` not `null`;
  framework error messages are English-only on the wire (11 translated).
- **renderx**: prerender logs when a loader route is skipped for not being in
  `--warm` (was a silent SEO failure).

### Docs
- rendering.md: loader→props unpacking rule with counter-example; SSR-safe
  component rules for static pages (banned provider hooks + alternatives);
  single-language cache-key boundary declared.
- notify: transactional vs notification email recipe (CAN-SPAM framing).

## [0.6.2] — 2026-10-13

npm artifact-quality batch from a product upgrade checklist (orkome; each
finding reproduced before fixing — issue 2 is a hard failure under Node's
native ESM).

### Added
- **client**: `./api` and `./ws` subpath exports (tree-shaking leaves);
  **hooks**: `./lib/ws-query-bridge` subpath export.
- **tools**: `fix-esm-extensions.mjs` wired into all four build chains;
  `esm-smoke.mjs` as a release gate (loads the packed artifact under native
  ESM; css side-effect packages fall back to an explicit-extension scan).
- **runtime**: README section — react-router is a value import
  (Routes/Route participate at runtime), so the peer is a hard binding, not
  a type dependency; products on another router simply skip this package
  (client/hooks stay router-agnostic).

### Fixed
- **packages**: `files` now include `src` — `exports.development` pointed
  at `./src/index.ts` that was absent from the tarball (dangling condition
  for monorepo-external source consumers).
- **packages**: dist relative imports carry explicit `.js` extensions
  (`tsc` bundler resolution does not emit them; under `"type": "module"`
  native ESM failed with ERR_MODULE_NOT_FOUND).

## [0.6.1] — 2026-10-12

Go-side fixes (npm packages unchanged from 0.6.0).

### Added
- **identity**: `user.updated_by` column (migration 047, nullable) with write-path
  attribution; `User.UpdatedBy` export. ⚠️ Migration 047 runs automatically at boot
  and issues DDL on the database.
- **identity**: login / register / verify-code responses now carry the rotated
  `csrf_token` in the body — clients can stop re-fetching `/config` after session
  establishment. Additive field; `@ploykit/client` picks it up automatically.
- **webx**: `DecodeJSONKnown` — strict typing with unknown-field-name capture
  (evolution-friendly counterpart of `DecodeJSON`).

### Fixed
- migrations test harness no longer miscounts when the shared dev database carries
  product migrations (1001+).

## [0.6.0] — 2026-10-12

Agent eyes+hands batch (ADR 0014) plus the first npm-published release of the
frontend packages.

### Added
- **platform packages**: `logring` (in-memory log ring), `devx` (dev console),
  `mcpx` (MCP server base).
- **events**: `events.Client` for out-of-band access.
- **logx**: `WrapHandler`.
- **example**: `/dev/*` API wiring.

### Changed
- River schema bootstrap unified into `events.Migrate` (no separate rivermigrate
  call). ⚠️ Check your boot sequence still calls `events.Migrate(ctx, pool)` once.
- example: `Drain` window aligned to 45s; `devtenant` slug fix.

### Fixed
- devtenant slug generation.

## [0.5.0] — 2026-10-12

Risk-control platform onboarding batch (aifengkong) plus orkome rounds 2-3.

### Added
- **identity**: admin provisioning — `AccountService.AdminCreateUser` (no mail, no
  session, signup-gate exempt, `AfterRegister` transactional hook),
  `AdminSetPassword` (hash + revoke-all-sessions + audit), `ListUsersByIDs`
  (batch display echo).
- **webx**: `Router` interface + `*webx.Mux` route recording (runtime route
  introspection; `Mount` signatures widened from `*http.ServeMux` — source
  compatible). `RequireRecentAuth` step-up; `webx.Transport` classifier.
- **platform/whsign**: zero-dependency webhook signature leaf package for
  RECEIVERS (protocol doc incl. non-Go recipe). `webhooks/app` delegates to it.
- **notify**: optional workspace dimension on notifications (migration 045) +
  retention sweeper worker. ⚠️ Migration 045 runs automatically at boot.
- **workspace**: role permission matrix (migration untouched; `roles:manage` +
  step-up). ⚠️ Migration 044 (`sessions.password_confirmed_at`) also auto-runs.
- **authz**: `BuiltinPerms` / `Perms` read side, `roles:manage` builtin.
- **identity**: MFA TOTP (migration 046: `user_mfa` + backup codes +
  `session.mfa_confirmed_at`); `webx.RequireRecentMFA`; 403
  `E_REAUTH_REQUIRED` two-phase protocol (ADR 0011/0013).
- **ui**: `LoginPage` `passwordOnly` prop; `resetPath`/`registerPath` empty-string
  hides the links; `AppProviders` composite; `Select` narrowed
  `onValueChange: (value: string) => void`; `Textarea`; Dialog/Sheet `size` props;
  `DataTable` `rowKey(row, index)` / `onRowClick` / `renderExpanded`;
  `useConfirm` fails fast without `ConfirmProvider`.

### Changed
- **BREAKING (0.5.0)**: `platform/pgm` renamed to `platform/pgmigrate` (package
  `pgmigrate`); accepts `fs.FS` instead of `embed.FS`.
- **BREAKING (0.5.0)**: `internal/contract/wswire` moved to `platform/wswire`
  (public import).
- **BREAKING (0.5.0)**: `webx.SessionStore.CreateSession` takes
  `webx.SessionCreate` struct.
- **BREAKING (0.5.0)**: `contractx` package removed (ADR 0012) — runtime route
  reconciliation via `webx.Mux` + `routes_contract_test` replaces it.
- `webx.DefaultAuthConfig` cookie `Secure` now defaults to false (production must
  opt in via `SECURE_COOKIE`).
- `workspace.WorkspaceConfig.MaxPerUser`: zero/negative means unlimited (only >0
  caps); the old zero-blocks-everything semantics is gone.
- **webx**: `CSRFConfig.MaxAge` knob (0 keeps the historical 12h cookie; negative
  = session cookie); `TrustLocalhostAnyPort` for dev origin drift.
- **webx**: `/config` returns 500 naming the missing middleware when
  `CSRFConditional` is not on the chain (was a silent empty token).
- **webhooks**: `Emit` rejects empty event IDs (fail-fast); delivery contract
  documented in `webhooks/doc.go`.
- **wsx**: control frames accepted in both flat and nested-payload shapes;
  unknown/unparseable control frames answered with `rejected:control` (was
  silent drop); nil `WorkspaceMember` warns once on first workspace subscribe.
- **relayx**: `Envelope.Hops` + `MaxHops` loop bound; `Forward` as the sanctioned
  re-publish.
- **egressx**: `LoopbackAllowCIDRs()` preset.
- **sealx**: `DeriveKey` (HMAC-SHA256 domain-separated key derivation).
- **identity**: `NoopEmailSender` embed base; PAT resolution failures log at
  debug with the configured prefix.
- **pgmigrate**: `Tables(pool)` introspection.

## [0.4.1] — 2026-10-10

- **client**: `WsClient.auth(token)` (PAT WebSocket auth frame);
  `__resetApiForTests` exported from the barrel.
- **ui**: `LoginPage` dead links fixable via `resetPath`/`registerPath: ''`.
- Go: orkome rounds (CSRF `TrustLocalhostAnyPort` docs, release tag guard).

## [0.4.0] — 2026-10-10

First release carrying the field-report fixes from four product onboardings
(aiblog, risk-engine, orkome, plus orkome's pack rollout preparation). See the
0.5.0 breaking-change list above — the pgmigrate rename and wswire move landed
here.

## [0.3.0] — 2026-10-09

Initial public tag (Go module + npm client/runtime/ui at their then-versions).
