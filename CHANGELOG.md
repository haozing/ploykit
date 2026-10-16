# Changelog

All notable changes to ploykit are documented here. Format: Keep a Changelog;
versions follow semver — under 0.x, minor bumps may carry breaking changes
(each one is called out).

Version scope: the Go module and the `@ploykit/*` npm packages are versioned by the same
vX.Y.Z tags but NOT locked together — a tag whose diff touches no `packages/` code skips
npm entirely (the npm packages stay at the last release that changed them; each version's
entry below says whether it is Go-only). Consumers pin each side independently.

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
