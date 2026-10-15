# Changelog

All notable changes to ploykit are documented here. Format: Keep a Changelog;
versions follow semver — under 0.x, minor bumps may carry breaking changes
(each one is called out).

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
