# Changelog

All notable changes to ploykit are documented here. Format: Keep a Changelog;
versions follow semver — under 0.x, minor bumps may carry breaking changes
(each one is called out).

Version scope: the Go module and the `@ploykit/*` npm packages are versioned by the same
vX.Y.Z tags but NOT locked together — a tag whose diff touches no `packages/` code skips
npm entirely (the npm packages stay at the last release that changed them; each version's
entry below says whether it is Go-only). Consumers pin each side independently.

## [0.23.2] — 2026-10-31

npm-only patch (Go module diff vs v0.23.1 is empty; consumers of the Go
module can stay on v0.23.1). Ships the ui seam that landed on master
immediately after the v0.23.1 tag was cut — its changelog entry had
prematurely landed in the 0.23.1 section, which never matched that tag's
content; moved here so every section matches its tag.

### Added
- **@ploykit/ui (2.7.3): `SignInForm`/`SignInModal` `renderOAuth?: ReactNode`** —
  custom third-party sign-in block: when non-empty it REPLACES the default
  `SignInOAuthBlock` (the generic "使用 X 登录" buttons rendered from the
  `oauthProviders` array) and the「或使用邮箱」divider. Brands with official
  mark buttons and non-Chinese copy self-render; second occurrence of the
  need (shuijing login page hand-rolled it 2026-10-16, its sign-in modal
  2026-10-31) = framework seam. Untouched behavior when omitted.

## [0.23.1] — 2026-10-31

Go-only patch. Boot-time guard from the same shuijing OAuth field report.

### Added
- **identity: boot-time warning when OAuth is wired but `Deps.OAuthAppURL`
  points at loopback** — OAuth success/failure 302s land on `OAuthAppURL`,
  and a product that enables OAuth without setting `APP_URL` keeps the dev
  default (`http://localhost:5173`), sending every successful login to a
  dead localhost (shuijing production, 2026-10-31: first-ever OAuth enable
  surfaced it because nothing else exercised the field). `Mount` now logs
  one warning naming the URL and the fix; local dev with OAuth credentials
  sees it too (harmless, a fair reminder of where callbacks land).
  Deliberately NOT tied to `OAuth.Names()` — with a provider source the
  boot-time list can be empty and fill in 30s later, so names would
  under-report. Unparseable/hostless URLs never trip the check.

## [0.23.0] — 2026-10-31

OAuth provider hot source + the admin-settings save fix it depends on
(motivation and audit: shuijing `docs/oauth-admin-config-design-audit-2026-10-31.md`;
integration guide incl. the example-does-not-wire boundary:
docs/api-conventions.md "OAuth providers: static wiring vs the hot source").
Go module + npm packages both change in this tag (ui 2.7.2 — patch, behavior fix;
Go is a minor for the new `WithProviderSource` surface). Also carries the
post-v0.22.0 master fix below (wsx test race).

### Added
- **identity: `OAuthService.WithProviderSource(src func() []OAuthProvider)`** —
  the provider hot source: providers become a 30s-TTL cached set rebuilt from
  `src` on read (billing `AtomicRegistry` semantics: the source itself is the
  error policy — a failing read logs and returns the degraded set; an empty set
  IS a valid snapshot). Static construction is byte-for-byte unchanged (no
  source = immutable boot set, zero locking); with a source, `Names()` /
  `provider()` / `Start()` / `Callback()` are concurrent-safe under an
  RWMutex with double-checked rebuild. This is what lets a product register
  OAuth credentials as admin settings keys and hot-swap providers without a
  restart (`EffectiveKey` per provider pair; id+secret both non-empty =
  enabled).
- **identity/app: `ErrOAuthLinkConflict`** — sentinel for the OA-1 fix below.

### Fixed
- **wsx: fatal data race in the test fake's metrics** (post-v0.22.0 master
  fix, ships in this tag) — `fakeMetrics` maps were written by hub goroutines
  (register/unregister/evict) and read by the test goroutine inside
  `require.Eventually` conditions with no lock; when the scheduler interleaved
  them, the Go runtime's unrecoverable "concurrent map read and map write"
  fatal killed the whole test binary (CI 2026-10-31, run 41189360123:
  TestWSConnectionGauge died inside its second Eventually). All access now
  goes through a mutex with snapshot getters. Test-only; latent since the
  orkome ws batch.
- **identity/pgrepo: `LinkOAuthAccount` silently swallowed same-subject
  conflicts (OA-1, P2)** — `ON CONFLICT (provider, subject) DO NOTHING`
  returned success even when the row already pointed at a DIFFERENT user: two
  concurrent callbacks for one provider account (the email-change window)
  created a second user whose login succeeded while the row kept pointing at
  the first — the next login landed back on the old account, splitting the
  identity with no warning. Now a no-op upsert (`DO UPDATE SET user_id =
  oauth_account.user_id RETURNING user_id`) reads back the surviving owner and
  returns `app.ErrOAuthLinkConflict` on mismatch (fail-closed; a retry goes
  through `FindOAuthAccount` and hits the existing binding). Idempotent replay
  for the same user is unchanged.
- **identity: OAuth state compared in non-constant time (OA-4)** — the CSRF
  state check now goes through `subtle.ConstantTimeCompare` (hygiene; the
  value is a 256-bit random token, network timing makes the old `!=`
  practically unexploitable).
- **identity/oauth adapters: scope was a hand-pre-encoded query fragment
  (OA-8)** — `googleoidc`/`github` built `AuthURL` by concatenating a
  pre-percent-encoded scope const alongside `QueryEscape`-encoded params;
  any future wrapping would double-encode. Both now build the query with
  `url.Values.Encode()` (params alphabetical, space as `+` — equivalent
  encoding, goldens updated).
- **@ploykit/ui (2.7.2): AdminSettingsPage「扩展配置」saved every
  non-sensitive registered key on every save** — the extra-keys save PUT the
  hydrated `effective` values of ALL non-masked keys back to the store: one
  unrelated save froze the live env fallback of every product-registered key
  into the table (the exact "never frozen" invariant `settings.RegisterKeys`
  documents), and with no env present it wrote empty-string rows that
  permanently shadowed the fallback (no DELETE endpoint to recover). Saves
  now submit only keys the admin actually edited (dirty tracking); clearing a
  non-sensitive key still submits the empty string (the explicit-disable
  path, e.g. clearing `oauth_google_client_id` takes the provider offline),
  masked keys keep the leave-blank-unchanged semantics, typed secrets are
  wiped from state after a successful save, and the button is disabled until
  something is dirty.

## [0.22.0] — 2026-10-31

Framework fixes from the shuijing backlog triage (`docs/issues-backlog-2026-10-31.md`
items ①–④; all four confirmed as genuine framework problems and fixed).
Go module + npm packages both change in this tag (client 0.7.8, ui 2.7.1 —
both patch: additive-only surface, and a client minor would tear the
`^0.7.4` ranges ui/hooks declare and split the ApiError class into two
instances).

### Added
- **webx: `Timeouts(base, overrides)`** — the multi-tier timeout middleware:
  longest matching prefix wins, a zero override fully exempts that prefix
  (no context deadline — the handler owns its time budget), unmatched paths
  get base; fails fast (panic) at wiring time on `base <= 0` or a negative
  override. `TimeoutExcept` remains the single-tier shorthand. Motivation
  (shuijing ①): a three-tier policy (default 5s / generation 30s / negotiate
  unlimited) previously required nesting two `TimeoutExcept` layers, and the
  outer cap 504'd a negotiate route that still had its own 35s wall clock to
  honor — the middleware silently killed a handler-managed deadline, a
  semantics only visible by reading `timeout.go`. Example wiring swapped to
  `Timeouts(5s, {"/ws": 0, "/mcp": 0})`; AGENTS.md mounting pitfall #1 and
  docs/platform-api-index.md updated.
- **@ploykit/client: `ApiError.kind`** — first-class error taxonomy
  (`'business' | 'network' | 'gateway'`), derived from (status, code) in the
  constructor so every throw site carries it: application answers are
  `business` ("fix your input"), 502/503/504, `E_TIMEOUT`,
  `E_MALFORMED_RESPONSE` and `E_CSRF_BOOTSTRAP` are `gateway` ("retry later"),
  transport failures and aborts are `network`. Raw fetch rejections
  (`TypeError("Failed to fetch")` — unclassifiable, shown verbatim to users)
  are now wrapped as `ApiError(0, 'E_NETWORK')`. Motivation (shuijing ②):
  e2e repeatedly caught a backend 504 or a Vite-proxy HTML 500 being shown as
  "these parameters produce no plan" — callers had to reverse-engineer the
  classification from scattered status/code checks and got it wrong for many
  rounds. `ApiErrorKind` is exported from the package root; additive, no
  call-site changes required.
- **@ploykit/ui: `E_NETWORK` message mapping** — `网络连接失败，请检查网络后重试`
  in `apiErrorMessage`'s KNOWN_CODES, so the newly wrapped transport errors
  get actionable Chinese copy instead of the raw `Failed to fetch` English.
- **`.gitattributes` (repo root + example/)** — `* text=auto` with LF pins
  for Go/TS/JSON/YAML/SQL/sh sources and CRLF pins for `*.bat`/`*.cmd`/`*.ps1`;
  binaries marked binary. The repository index is already all-LF, so this is
  a pure no-op renormalization that makes Windows clones deterministic:
  zijianfang (shuijing ④) saw whole-repo `gofmt -l` "existing files
  unformatted" noise and LF→CRLF warnings on every `git add` because neither
  ploykit nor the example template carried the pins. The example copy travels
  with template clones, so products inherit the contract on day one.

### Fixed
- **quota: month-end flake in `TestRefreshWorker_RefreshesPeriodicGrants`** —
  the seed used `AddDate(0,-1,0)` as "one month ago", which on a 31st absent
  from the previous month rolls FORWARD into the current period (2026-10-31:
  Sep 31 → Oct 1), so the seeded grant's period equals the current one and the
  refresh predicate `period <> $1` never matches — the test failed for the
  whole last day of any such month (reproduced on clean HEAD v0.21.0, i.e.
  pre-existing, surfaced by this release's DB gate). The seed now constructs
  the previous period's first day via `time.Date(y, m-1, 1, ...)` (month
  normalization + day-1 are always valid). Production logic was correct;
  test-only fix.
- **repo: one-time gofmt pass over 22 files with real formatting drift** —
  struct-field alignment and import ordering that had been invisible because
  `gofmt -l` on Windows flagged EVERY file via CRLF; with line endings pinned
  (see .gitattributes above) the real drift surfaced and is now clean
  (`gofmt -l .` = 0). Mechanical only, no semantic changes.
- **example: `routes_contract_test` is no longer structurally red for
  template-cloned products** (shuijing ③): the test required
  `../../../docs/openapi.yaml` (the ploykit monorepo root, three levels up)
  and asserted the pinned route count BEFORE reading the file — a product
  cloned from the example template fails both on day one, forever (zijianfang
  carried a red `TestRuntimeRoutesMatchOpenAPI` for nine rounds). The spec is
  now resolved FIRST from `<monorepo>/docs/openapi.yaml` or
  `<product>/docs/openapi.yaml`, and the test skips with copy-the-spec-or-
  delete guidance when neither exists.

## [0.21.0] — 2026-10-30

Cloudflare Turnstile human verification, framework-native and
admin-configurable per product (Go module + npm packages both change in this
tag). Threat model and product wiring audited in
shuijing `docs/audit-cloudflare-turnstile-2026-10-30.md`; design doc
`docs/turnstile-integration-design-2026-10-30.md` (as corrected by the audit).

### Added
- **webx: Turnstile verification middleware** (`platform/webx/turnstile.go`)
  — enabled only when the product-supplied provider returns both a site key
  and a secret key (either missing = fully disabled, zero siteverify calls,
  30s TTL config cache). Token is read from the `X-Turnstile-Token` header
  (`webx.HeaderTurnstileToken`); a missing token or an explicit
  `success:false` verdict rejects with `400 webx.CodeTurnstile`
  (fail-closed on the verdict), while transport errors / timeouts / non-200 /
  unparseable responses fail OPEN with `log.Error` — fail-closed there would
  turn every Cloudflare outage window into "registration and password reset
  are down site-wide". `remoteip` is resolved via `webx.ClientIPFrom(ctx)`
  with a bare `webx.ClientIP(r)` fallback, and is omitted when unresolvable.
  The token itself is never logged; `error-codes` go to debug.
- **identity: optional `Deps.BotGuard` seam** — when non-nil, wraps
  `POST /auth/register`, `POST /auth/send-code`,
  `POST /auth/forgot-password` and `POST /auth/send-verification`
  (outermost of the existing `RequireHuman` on send-verification). Nil = the
  capability is absent, byte-identical behavior (products that do not wire
  Turnstile are unaffected). login / verify-code / reset-password are
  deliberately not guarded — the per-IP auth rate limit already covers
  brute-force without adding login friction.
- **@ploykit/ui: `TurnstileWidget` + auth form wiring** — renders `null` and
  injects nothing when the site key is absent from the public `/config`
  (unconfigured products are untouched); api.js is DOM-injected once per page
  (id-guarded promise gate, StrictMode-stable), explicit
  `turnstile.render`/`remove` lifecycle, `ref.reset()` for the one-time-token
  retry flow. Wired into `RegisterPage`, `ForgotPasswordPage` and the
  SignInForm code-tab path via a single header-injection point
  (`postTurnstileProtected` → `apiFetch`, `X-Turnstile-Token`), with an
  `E_TURNSTILE` human-readable message in `api-error.ts`.
- **@ploykit/hooks: `SiteConfig.turnstile_site_key?: string`** — additive
  type only.

### Fixed
- **@ploykit/ui: `@ploykit/hooks` moved from `dependencies` to
  `peerDependencies`** — ui imports it in 53 files and it owns the
  `PloykitProvider` React context; as a regular dependency, any future
  version-range split between a product's hooks and ui's would install two
  instances, making every `useContext` return null and white-screening the
  whole app (this exact failure mode hit shuijing on 2026-10-17, invisible to
  tsc/vitest/prerender). Peer-ization forces single-instance resolution at
  the product layer. Consumers should declare `@ploykit/hooks` explicitly.

## [0.20.0] — 2026-10-27

GA4 analytics wired in example, admin-configurable, site-wide (example-only
release: no Go module code, no `packages/` code — npm skipped by release.yml).

### Added
- **example: Google Analytics 4 site-wide tracking, admin-configurable** —
  the live wiring of docs/visitor-analytics.md Route 1. A product-registered
  settings key `ga4_measurement_id` (`settings.RegisterKeys`): non-sensitive
  by design — a measurement ID is a public identifier that ships in every
  page's HTML once configured, so it rides the public `/config` for the
  frontend; live `GA4_MEASUREMENT_ID` env fallback until an admin saves a DB
  row (never-seeded generation). Validation pins the `G-` shape and trims
  inside the Validate closure (the admin PUT pipeline runs Validate on the
  raw value before Normalize — audit round caught the original
  trim-after-validate mismatch; the test pins the real order).
- **example frontend**: one-shot `bootGA4` DOM injection
  (`example/web/src/analytics.ts`) fired by a `GA4Boot` provider-level
  effect (`providers.tsx`) when `/config` delivers a non-empty id. SPA route
  changes are counted by GA4 enhanced measurement (history-API listener) —
  no extra code. Script injection lives in the React tree, NOT renderx head
  directives: the renderx tag fence deliberately denies `script` on the
  server-side multi-source head assembly path.
- **CSP**: `spaCsp` gains `script-src 'self' https://www.googletagmanager.com`
  and `connect-src` additions for `*.google-analytics.com` /
  `*.analytics.google.com`. Statically allowed — with no id configured no
  request ever hits those origins.
- **The four formerly zero-JS marketing routes re-hydrated**: `/`,
  `/pricing`, `/docs`, `/about` drop `hydrate: 'none'` (prerender
  unchanged). A `hydrate: 'none'` page runs no client effects, so a beacon
  needs hydration; the trade-off (site-wide stats > one shared entry chunk
  per page) is recorded in `StaticPages.tsx` and visitor-analytics.md, which
  now points at example as the Route 1 live reference.
- Known blind spots (documented, by design): crawlers don't run JS — pair
  with the `ploykit_traffic_requests` counters; EEA visitors need a consent
  banner, which stays the product's legal responsibility; ad blockers drop
  the cross-origin gtag.js load.

## [0.19.0] — 2026-10-27

Hydration parity + anonymous login probe. Go (`identity/adapters/http`) +
npm (`@ploykit/runtime` 0.9.1, `@ploykit/hooks` 0.9.3, `@ploykit/client`
0.7.7 types-only; `@ploykit/ui` 2.6.0 unchanged — skipped by release.yml).

### Fixed
- **runtime (TanStack adapter)**: client hydration rebuilt the entire
  server-rendered tree (minified React error #418), silently voiding the
  runtime benefit of prerendered HTML — FCP/LCP waited for the full JS
  chain instead of adopting the server DOM (measured live on shuijing:
  LCP 3.9s with a 2.5s element render delay on a page whose TTFB was
  30ms). Mechanism, pinned to @tanstack/react-router 1.170.45: `Matches`
  renders `MatchesInner` bare on the server (`isServer` true via the
  renderx `ESBUILD_ALIASES` swap) but wraps it in an extra root
  `<Suspense>` on the client, so the two sides shared only the root
  Outlet's single `<!--$-->` pair; the client's second boundary found no
  matching server marker and React 19 discarded the whole tree. Fix:
  `TanstackRouterMount` now sets the instance property `router.ssr =
  { manifest: undefined }` (the same shape TanStack's own `hydrate()`
  assigns; `Matches` gates its Suspense branch on `router.ssr`, NOT on
  `options.ssr` — the module-level `isServer=false` short-circuits the
  options path on the client). Assigned on both SSR and client mounts so
  same-module test environments are also isomorphic. Side-effect surface
  enumerated for 1.170.45 (`canWrapInSuspense` root-route parity,
  `MatchInner` pending branch unreachable under `populateSync`'s forced
  `success`, `Scripts`/`HeadContent` manifest readers never rendered by
  the framework). Regression test renders through the real
  `renderToString` → jsdom `hydrateRoot` chain with the isServer module
  mocked to the server variant for the SSR pass (mirroring the renderx
  alias) — red/green verified: without the fix the test fails with
  "Hydration failed" and zero comment nodes left in the container (the
  whole-tree-rebuild signature); with it the server's Suspense markers
  survive in place.
- **hooks**: `useAuthState` and `PloykitProvider`'s `AuthLayer` probe
  shared duplicated `/auth/me` normalization; both now use one
  `fetchMeNullable()` helper (also exported) that normalizes BOTH the new
  `200 {"authenticated":false}` body and the legacy `401` to `null`.

### Changed
- **BREAKING-ish (called out per house rule), identity**: `GET /auth/me`
  for anonymous callers now returns `200 {"authenticated": false}`
  instead of `401`. "Not logged in" is a normal answer to a read-only
  login probe, not an error state: every anonymous page load fires this
  probe from app chrome (`useAuthState`, `AuthLayer`), and a 401 is a
  hard browser-network error that fetch cannot suppress — Best Practices
  audits ("Browser errors were logged to the console") flagged every
  anonymous visitor (shuijing production, 2026-10-27). The authenticated
  response body is byte-identical (flat `PKUser`, `impersonated_by`
  unchanged); mutating endpoints (`PATCH`/`DELETE /auth/me`, logout)
  still return 401. `@ploykit/hooks` ≥ 0.9.3 accepts both shapes, so
  ploykit-based products are unaffected; direct API consumers that used
  401 as their anonymous signal must switch to the body flag
  (`openapi.yaml` getMe documents the union).

## [0.18.1] — 2026-10-26

Catalog-product fallback fix (billing). Go-only (`billing/app`,
`billing/adapters/waffo`; no `packages/` code — npm skipped by release.yml).

### Fixed
- **billing**: `resolveChannelProduct` refused checkout with a 400
  ("product not registered") even when the adapter held a valid statically
  configured product id — the service short-circuited before the adapter's
  own fallback could fire, which made waffo's "env-only wiring keeps
  working" fallback (`WAFFO_PRODUCT_MONTHLY`/`WAFFO_PRODUCT_YEARLY`) dead
  code behind the error. Found live on shuijing production (2026-10-26):
  static products configured, first real checkout still refused. New
  optional `StaticProductResolver` interface; catalog resolution order is
  now **DB mapping > adapter static product > auto-register > error**. The
  static tier sits deliberately before auto-register so the fallback never
  duplicates manually curated channel-side products. waffo implements it
  from the same source its `CreateCheckout` reads (env vars / channel
  fields).

## [0.18.0] — 2026-10-26

renderx SEO/pipeline batch (shuijing 2026-10-26 audit, F-1..F-5 all fixed
plus the shell-head inheritance mechanism that also resolves the audit's
product-side S-1/S-5 root causes and the example-side S-12 fallback switch;
audit record: `docs/audit-renderx-seo-pipeline-2026-10-26.md`; pre-release
3-agent audit fixes folded in — see the release-audit entries below). Go
(`platform/renderx`, `example`) + npm (`@ploykit/hooks` 0.9.2 — useSEO og
enrichment fields; ui 2.6.0 / client 0.7.6 / runtime 0.9.0 unchanged,
skipped by release.yml).

### Fixed
- **renderx**: RenderDocument had no viewport fallback — prerendered pages
  inherited nothing from the Vite shell, so every page that did not emit
  its own viewport rendered at a 980px desktop viewport on mobile
  (platform-level default gap; shuijing production was hit site-wide).
  RenderDocument now writes
  `<meta name="viewport" content="width=device-width, initial-scale=1">`
  after charset unless the page (or inherited shell head) declares its own
  — pages can still override (e.g. `user-scalable=no`).
- **renderx**: shell head inheritance — `renderx.ParseShellHead(shellHTML)`
  extracts the inheritable shell head tags (link/meta minus
  stylesheet/charset/viewport/title) plus html/body open-tag attributes,
  carried on `ViteAssets.Shell` through every document-assembly path
  (runtime SSR, Service refresh, prerender, direct RenderOnce) and emitted
  by RenderDocument (viewport → inherited → page head → preloads → CSS,
  page entries winning collisions). This restores favicon links (the
  audit's S-1 root cause), theme-color (S-5) and modulepreload (F-4)
  site-wide without per-page components, and adds
  `Document.HTMLAttrs`/`BodyAttrs` for shell-styled `<html>`/`<body>` tags
  (F-5, FOUC prevention; `lang` stays owned by `Lang`).
- **renderx**: relative `og:image` / `twitter:image` / `og:url` values are
  absolutized at render time against `Document.BaseURL` (sourced from
  PUBLIC_BASE_URL; empty/invalid = no-op; already-absolute untouched;
  canonical deliberately untouched; client-side SPA head updates keep
  page-emitted values — crawlers read the first HTML only).

### Added
- **hooks**: SeoMeta gains `ogSiteName`, `ogLocale` (ll_CC),
  `ogImageAlt`, `ogImageWidth`, `ogImageHeight` — emitted when present
  (image dimension/alt only alongside an actual ogImage). Example wires
  ogSiteName/ogLocale on its public pages; og:image dimensions stay
  unwired by example (no OG image asset — boundary declared in the
  useSEO JSDoc).
- **example**: renderx fallback switched to
  `UnknownPath: renderx.UnknownPathNotFound` — garbage/case-variant URLs
  now get an honest 404 instead of a 200 indexable SPA shell (the soft-404
  GSC exposure class documented on the policy). Humans still get the shell
  bytes (the client router boots from them) and every real static file the
  SPA handler serves keeps its genuine status — see the release-audit fix
  below.
- **renderx** (release-audit fixes, 3-agent pre-release review): the
  notFoundWriter that backs the not-found policy had never run against a
  real file-serving SPA handler and forced 404 on EVERY response —
  flipping example to the recommended policy took down all assets
  (audit P0, caught by a real-binary E2E before release). It now
  downgrades only the HTML shell document (Content-Type gated, with
  byte-sniffing for untyped shells and pass-through for redirects/errors);
  pinned by a fileServingSPA regression test. Hardening from the same
  review: link dedup keys include href so same-rel siblings survive (a
  page's font preload no longer retires the shell's image preload /
  modulepreload set; icons stay rel-only so a page favicon still replaces
  the shell's), event-handler attributes (on*) and case-variant
  http-equiv are rejected on every attr channel (head directives,
  HTMLAttrs/BodyAttrs, shell inheritance), and commented-out link/meta
  tags in the shell head stay dead instead of being resurrected. Docs
  corrected: registering a path as ModeCSR does not exempt it from the
  unknown-path policy (no serving branch exists for it — mount real-200
  CSR paths ahead of renderx).

## [0.17.0] — 2026-10-26

Legal compliance P0 batch (framework minimal compliance kernel, LC-1..LC-9
P0 scope; plan + round-1 audit docs live in docs/). Go (`legal`, `identity`,
`billing`, `settings`, `platform/webx`, `example`) + npm (`@ploykit/ui`
2.6.0; hooks/client/runtime unchanged, skipped by release.yml).

### Breaking (called out per repo policy)
- **webx**: `ClientMetadata` is now a middleware factory —
  `ClientMetadata(trustedProxies ...*net.IPNet) func(http.Handler) http.Handler`
  — instead of `ClientMetadata(next http.Handler)`. The proxies make the
  XFF-derived client IP consistent with AccessLog by construction.
  Migration: wrap the old call site and pass the same trusted-proxy list
  AccessLog uses (`example/cmd/app/main.go` shows the shape).

### Added
- **legal** (new composition package, provisioning-style per ADR-0016):
  `legal.Wire(...)` one-line wiring registers the six `legal_*` settings
  keys via RegisterKeys (`legal_billing_model` has Default
  `v1_subscription`, so a fresh deployment with no key and no env boots)
  and reconciles the declared billing model fail-fast — via the new
  single-key hot read `settings.Store.EffectiveKey`, so an unrelated
  sealed key without PLOYKIT_SEAL_KEY can no longer prevent boot.
  `RegisterDocs` is the versioned document registry (placeholders as a
  closed set, batch-validated atomically). Acceptance ledger (migration
  052: `(user_id, doc_key, doc_version)` unique, method CHECK, account
  CASCADE, ON CONFLICT idempotent): AfterRegister records `signup`,
  AfterLogin records `login_implicit` with zero steady-state writes.
  `legalhttp.Mount` (user re-accept + snapshot; webx.P anonymous 401) and
  `MountAdmin` (compliance + acceptances-by-user export; injected Guard,
  nil panics fail-fast). `Compliance` reconciles required keys plus a
  seven-point commitment checklist (manual items honestly marked).
- **billing**: user self-service cancellation — `POST
  /api/billing/subscription/cancel` (billing:manage; cross-workspace
  404): outcome `cancelled | period_end | operator_pending` derived from
  the channel's declared CancelTiming; idempotent replay derived from
  live state; channel pass-through via SubscriptionCanceller (waffo
  `period_end`, paypal `immediate`, stripe `immediate` — **erratum**: the
  plan's "stripe has no canceller" premise was wrong, stripe.Channel has
  implemented it since v0.15 via DELETE /v1/subscriptions; docs carry the
  correction). Channels without a canceller park `cancel_requested_at`
  (migration 053, partial index) in an operator queue (`GET
  /api/admin/billing/cancel-requests`). Five clear-points (renewal
  payment, refund, webhook canceled, admin cancel, expiry sweep);
  renewal after a cancel request logs ERROR, keeps the paid entitlement
  and the queue entry — no silent refund. `GET /api/billing/subscription`
  now carries `cancel_requested_at / renews_at / cancel_timing` so
  product UIs have a framework data source for the cancel affordance.
  `ProcessorDisplayName` maps channels to human names (waffo → "Waffo
  Pancake").
- **identity**: `ChainHooks` — compose multiple IdentityHooks into one
  slot (tx hooks sequential, first error short-circuits; observational
  hooks all run with errors joined and index-attributed; nil-safe).
- **webx**: `WithClientIP` / `ClientIPFrom` — request-scoped client IP
  using the same ClientIP(trustedProxies) resolution AccessLog uses.
- **ui 2.6.0**: `LegalAndPrivacySection` (account-page legal block:
  subscription snapshot, cancellation confirm modal with three-way
  timing copy, DSAR export hook) and `AdminComplianceCard`
  (self-fetching compliance dashboard). Boundary: LegalAndPrivacySection
  is NOT wired in example (it needs product-side subscription assembly —
  the GET subscription fields above are the data source);
  AdminComplianceCard is mounted in the example admin settings children
  seam.

### Fixed
- **docs/openapi.yaml**: two structural YAML faults from the batch draft
  (duplicate `responses` key on the cancel path; admin error responses
  misplaced under the wrong operation) — check_api is regex-based and
  could not catch them; the contract test's strict YAML parse does.
  New endpoints now carry the file's conventional default-error ref, and
  the admin compliance operation documents its envelope schema.
- **docs/platform-api-index.md**: restored the CachePrefix/CachePrefixTTL
  rows accidentally dropped from v0.16.0 by this batch's base revision.

### Caveats (P0 live verification still open)
- waffo/paypal CancelTiming declarations are document-derived
  (`TODO(lc4)` in channel.go); waffo's period_end timing should be
  re-confirmed against the live dashboard before copy promises it to
  users.

## [0.16.0] — 2026-10-26

shuijing performance/SEO audit batch (2026-10-25 perf report, six of seven
issues — all landed; the seventh, per-language cache keys, is already on
ROADMAP as a declared boundary and stays there). Go (`platform/renderx`,
`platform/renderx/internal/qjs`, `platform/webx`) + npm (`@ploykit/hooks`
0.9.1; ui/client/runtime unchanged, skipped by release.yml).

### Fixed
- **renderx/qjs (correctness — prerender bakes wrong content)**: the QuickJS
  sandbox wall clock was frozen at 2022-01-01. Root cause (definitive, no
  longer a suspicion): wazero installs a deterministic fake clock
  (`FakeEpochNanos` = midnight UTC 2022-01-01, +1ms per read) whenever a
  ModuleConfig does not explicitly opt into the real one, and the qjs
  bridge instantiated with a bare `wazero.NewModuleConfig()` — so any
  component whose rendered output reads `Date.now()` / `new Date()` baked
  2022 into the prerendered HTML, hydration mismatched (Minified React
  #418 → the client discarded and re-rendered the whole tree, prerender
  wasted), and a live site footer literally said "© 2022" for four years.
  Fixed by wiring `WithSysWalltime().WithSysNanotime()` at the single
  instantiation site (covers every engine instance; `performance.now()`
  was a fake monotonic counter likewise). `Math.random` seeding now varies
  with real time, matching browsers — prerender output must not depend on
  its determinism. New `qjs.VerifyClock(ctx, maxSkew)` fails fast when the
  sandbox drifts from the host, so broken clock wiring surfaces at build
  time instead of in production HTML. No wasm rebuild involved — the fake
  epoch lives on the Go side.
- **renderx (zombie pages)**: `Invalidate` only deleted the runtime
  LayeredCache — an embed-tier snapshot kept serving deleted resources
  with full prerendered content until the next build (field report: the
  page kept 200-ing while the API already 404'd and the sitemap had
  excluded the slug). Invalidate now also tombstones the embed tier
  (exact + pattern keys, the RegisterDep graph included — deleting a work
  drops the stale homepage snapshot that still linked to it); tombstones
  are in-memory and reset naturally on the next build.
- **hooks**: PloykitProvider fired `/auth/me` + `/api/workspaces`
  unconditionally on every route — anonymous visits to public pages
  produced two 401 console errors on every load (browser network-layer
  logs; JS cannot suppress them — the only fix is not sending). The
  workspace query is now gated on the auth probe result (fires only when
  /auth/me returns a user); hidden session expiry (cookie gone without an
  explicit logout) clears the stale workspace cache; the loading flag no
  longer sticks on the disabled state.

### Added
- **renderx: unknown-path policy + trailing-slash 301 + shell meta** —
  the soft-404 family. Unmatched paths used to fall through to a 200 SPA
  shell (search engines indexed /login, /random-page and every
  trailing-slash twin). `HandlerDeps.UnknownPath` selects `spa-shell`
  (v0.15.0 default, kept for compatibility — flip consciously) or
  `not-found` (reuses notFoundWriter: humans still get the shell, crawlers
  get 404); trailing-slash variants of extensionless GET/HEAD paths now
  301 to the canonical form; `HandlerDeps.ShellMeta` injects head meta
  (e.g. robots noindex) into shell responses — conservative: text/html
  only, never into compressed streams, 256KB scan cap, byte-identical
  when unconfigured.
- **renderx/template**: React 19 float preloads (`<link rel=preload>` for
  eager images) are hoisted from the leading run of `#root` into `<head>`,
  ahead of the CSS links — a preload buried in body depth loses the
  early-scan window it exists for. Conservative boundary: only the leading
  link run moves; without preloads the output is byte-identical.
- **webx**: `CachePrefix(rules)` / `CachePrefixTTL(paths, ttl)` —
  Cache-Control per path prefix for non-hashed public assets, the class
  AssetCache deliberately leaves to the product. Longest-prefix match,
  2xx only (never pin a 404 for the TTL), never overwrites a header the
  inner handler already set. Boundary: example does not wire it (example
  serves hashed assets only); intended for products with public/ media
  directories.

## [0.15.0] — 2026-10-25

shuijing upstream batch (2026-10-25 report, five issues — all adopted, all
landed): SMTP send-context correctness fix, product-registered settings
keys, Resend HTTP email adapter, Svix webhook verification helper, and the
AdminSettingsPage extension seams. Delivery audit:
`docs/delivery-audit-shuijing-resend-batch.md` (21 items traced, 18 ✅ /
1 🟡 / 1 deliberate deferral / 1 means-deviation; zero ⚪). Go (`notify`,
`settings`, `platform/webx`, `example`) + npm (`@ploykit/ui` 2.5.0;
client 0.7.6 / runtime 0.9.0 / hooks 0.9.0 unchanged, skipped by
release.yml).

### Fixed
- **notify/smtp**: send methods no longer inherit the caller's context
  cancellation/deadline — an HTTP request timeout (typically 5s) used to
  kill an in-flight login-code send mid-conversation: the mail lost AND the
  request failed. Every send now runs under its own timeout
  (`Config.SendTimeout`, default 30s) with the caller's ctx values
  preserved (`context.WithoutCancel`); the timeout is ALSO mirrored into
  go-mail's own connection deadline (`gomail.WithTimeout`) because the
  dial/greeting phases are bounded by go-mail's 15s default, not by ctx.
  Hermetic tests prove a canceled parent no longer kills the send and the
  own cap bounds a silent relay. emaildev documented as unaffected (no IO).
- **settings**: the admin test-email response echoed a hardcoded
  `"mode": "smtp"` even when the integrator did not track a mail mode — now
  reports the actual mode like every other surface.

### Added
- **settings**: `Store.RegisterKeys(specs ...KeySpec)` — product-registered
  settings keys (the report's ~200-line-per-consumer shadow-endpoint
  bypass, eliminated). A registered key behaves exactly like a built-in on
  every surface: generic admin PUT validates through the spec, sensitive
  keys seal at rest (sealx fail-closed) and mask on every read-back,
  `Effective`/list merge them with descriptions/defaults, and an optional
  live env fallback (`KeySpec.Env`) keeps working on every boot until an
  admin saves a DB row (never bootstrap-seeded — the D2 fork in
  `settings/keys.go`). Registration is atomic (a bad spec rejects the
  batch); the package-level `Validate`/`IsSensitive` stay closed-whitelist
  for callers without a Store. The admin HTTP adapter and the public
  `/config` sensitive-filter now go through store-level checks so
  registered credentials never leak publicly.
- **notify**: `adapters/email/resend` — the Resend HTTP email channel
  (sidesteps outbound SMTP port blocks; structured errors via
  `resend.APIError{Name, Status, Message}` distinguish "key invalid" from
  "recipient refused"). Implemented with net/http directly, no resend-go
  SDK (one endpoint/one JSON shape does not justify a dependency — same
  ruling as webx.SvixVerify below; also sidesteps resend-go v2's missing
  Receiving API). Same ctx-detachment contract as smtp from day one.
- **notify**: `adapters/email/mailtpl` — the email copy set shared by every
  email adapter; smtp re-exports it as type aliases so
  `notifysmtp.Templates` IS `mailtpl.Templates` (zero source break), giving
  SMTP and Resend a single source of copy.
- **settings**: `MailModeResend = "resend"` (the /config mail_mode value
  and the admin status badge share it).
- **platform/webx**: `SvixVerify` / `SvixHeaders` — Svix inbound-webhook
  signature verification (the standard behind Resend/Clerk-style inbound
  webhooks): v1 candidates space-separated with any constant-time match,
  `whsec_`-form secrets, ±5min replay tolerance. Stdlib only, no new
  dependency. Indexed in `docs/platform-api-index.md`.
- **ui (2.5.0)**: `AdminSettingsPage` gains two extension seams — optional
  `children` rendered after the framework cards, and a metadata-driven
  generic card that renders registered keys (settings.RegisterKeys) with
  the same masked-credential semantics as smtp_pass; the built-in key
  skip-list is pinned by a snapshot test against the backend KeyOrder.
- **example**: registers `resend_api_key` (sensitive, `re_` prefix
  validation) / `resend_from` as the RegisterKeys reference wiring; mail
  channel priority resend → smtp → dev; `NavVisibilityCard` (the
  shell_nav_hidden key had no admin surface anywhere) wired through the
  children seam; RESEND_* env documented in the README.

## [0.14.0] — 2026-10-24

Go-only release (no `packages/` code; npm packages stay at their last
changing release — @ploykit/ui 2.4.0 from 0.13.0).

### Added
- **billing**: self-serve onboarding for not-yet-configured channels —
  factories now return an `app.DisabledChannel` stub instead of nil when
  credentials are absent (waffo/paypal `FromEnv`/`NewFromFields`; stripe
  gains `stripe.Disabled()`). The stub carries the schema/capabilities
  descriptors, so the admin channel page renders a form for channels that
  have no credentials yet (configured: false) and `PUT` saves them —
  previously `ChannelCards` listed only registered channels and
  `UpdateChannelFields` 404'd unregistered names, a chicken-and-egg that
  made UI onboarding impossible for new channels (found adopting
  AtomicRegistry in shuijing). `FromEnv`/`NewFromFields` now return
  `app.PaymentChannel` directly — the typed-nil ghost-registration trap
  (concrete nil pointer as non-nil interface) is structurally impossible,
  and `rebuild` additionally reflect-guards factories that still return
  typed-nil. `OrderedNames()` filters `Configured:false` channels from
  `/config` and the billing config view; `OrderedChannels()` (new,
  `ChannelSet` breaking addition) enumerates all instances for the admin
  cards. Adapters expose package-level `Schema()`/`Caps()` with instance
  methods delegating (single source, drift-pinned by DeepEqual tests).
- **platform/sealx**: the key-format error now tells you the expected
  format (`openssl rand -base64 32`; a 64-char hex string base64-decodes to
  48 bytes and is rejected).

## [0.13.0] — 2026-10-24

Payment-channel framework batch (waffo upstream, credentials-in-DB hot
reload, self-serve admin page, catalog product mapping, PayPal touchstone)
plus the audit-fix pass over it: five parallel audit agents tested the batch
against real data; every confirmed defect is fixed here and pinned by a new
three-dialect channel simulator (`billing/adapters/sim`) driving ten
real-database pipeline scenarios. Go (`billing`, `settings`, migration 051)
+ npm (`@ploykit/ui` 2.4.0; client 0.7.6 / runtime 0.9.0 / hooks 0.9.0
unchanged).

### Added
- **billing**: `adapters/paypal` (P2, the touchstone of the channel-framework
  plan) — the third built-in payment channel, landed with **zero kernel
  changes**, validating the P0/P1 foundation. OAuth2 client with token cache;
  subscription checkout (approval link + custom_id order echo, buyer email
  and locale prefill, cancel URL honored); webhook verification via
  `POST /v1/notifications/verify-webhook-signature` (five PAYPAL-* headers,
  webhook_id required); event mapping per the five adapter laws
  (ACTIVATED→checkout.completed, SALE.COMPLETED→renewed with
  billing_agreement_id, CANCELLED→canceled, SALE.REFUNDED→refund with
  v1/v2 amount-shape tolerance, everything else ignored);
  `ProductRegistrar` (products→ACTIVE plans two-step, plural
  `update-pricing-schemes` for SyncPrice — catalog price is the charged
  price, so a DB price change without sync is rejected by amountMismatch,
  surfaced in the ConfigSchema help); `ConnectionTester` (token fetch),
  `SubscriptionCanceller`, ConfigSchema for the self-serve admin page.
  19 hermetic test functions / 32 runs against httptest-faked PayPal.
- **billing/admin/ui (P1 of the channel-framework plan)**: self-serve channel
  configuration — paste credentials in the admin Plans page, no env edits, no
  restart. `billing_channel.<name>.<field>` settings keys (prefix-sealed by
  the sealer, fail-closed unchanged; `settings.Set` whitelist accepts the
  prefix), `AtomicRegistry` rebuilds channel instances from
  settings-over-env on a 30s poll (and immediately after an admin save via
  `RefreshNow`); adapters self-describe their config forms via
  `ChannelSchemaViewer.ConfigSchema()` (text/secret/select FieldSpecs).
  New admin API: `GET/PUT /api/admin/billing/channels[/{name}]`,
  `GET /api/admin/billing/catalog`,
  `POST .../register-product`, `POST .../sync-price` (OpenAPI 151→156).
  Catalog channels (waffo/paypal-family) get a `billing_channel_products`
  mapping table (migration 050, PK channel×plan×interval) +
  `ProductRegistrar` (waffo implements create/update-product REST): admin
  registers products per plan×interval and one-click syncs channel catalog
  prices after a price change; `CreateCheckout` resolves the mapping into
  `CheckoutRequest.ChannelProductID` (with optional auto-registration via
  `Config.AutoRegisterCatalog`). Admin UI (`@ploykit/ui`): channel cards
  inside PlansPage — schema-driven forms, masked secrets ("__SET__",
  blank-keeps), webhook URL with copy button, test-connection, test-mode
  badges with waffo test cards, and a catalog-mapping table with
  pending-sync highlighting. No new sidebar entries.
- **billing**: `adapters/waffo` — the Waffo Pancake (MoR) payment channel,
  upstreamed from the shuijing product repo where it was battle-tested against
  the real API (request signing, checkout sessions, webhook verification,
  event mapping per the five adapter laws). `waffo.FromEnv(getenv, log,
  production)` with the all-or-nothing env discipline; implements
  `ConnectionTester` (GraphQL stores probe), `SubscriptionCanceller`
  (`POST /v1/actions/subscription-order/cancel-order`), and
  `ChannelCapabilityViewer` (catalog-based, DisplayOrder 100, five
  subscription currencies)
- **billing/money**: shared minor-units ↔ display-string conversion
  (`FormatCents`/`ParseAmount`/`ValidateCurrency`) with JPY zero-decimal
  handling; `ParseAmount` returns 0 on unparseable input so unverifiable
  amounts flow into the existing `amountMismatch` ignore path
- **billing**: adapter contract "five laws" documented in `billing/doc.go` —
  the acceptance checklist for any new channel, distilled from the waffo
  integration (money-event-once, first-charge dedup, stable subscription
  ref, globally-unique ChannelEventID, environment marking)
- **billing**: stale-checkout sweeper — `"order".expires_at` column
  (migration 049), `Repo.ExpireStaleOrders` (SKIP LOCKED, oldest-first),
  `BillingService.ExpireStaleOrders` + `workers.OrderExpiryWorker`; channels
  that expire abandoned sessions without a webhook (waffo) no longer leave
  orders pending forever
- **billing**: `adapters/sim` — a three-dialect payment-channel simulator
  (simwaffo / simpaypal / simstripe) mirroring the real adapters' event
  envelopes, HMAC-SHA256 raw-body signatures and five-law mapping; a
  `Harness` assembling a real `BillingService` behind the real webhook HTTP
  route for pipeline tests, plus dev-only `simhttp` endpoints
  (`POST /dev/billing-sim/{channel}/checkout|event`, gated by
  `PLOYKIT_DEV_ENABLED=1`, panics if mounted in production) wired in
  example — the "mock three payment channels" test interface, validated by
  ten real-database pipeline scenarios

### Changed
- **billing** (breaking, P0 of the channel-framework plan
  `docs/plan-billing-channel-framework-2026-10-23.md`):
  `PaymentChannel.CreateCheckout` now takes `CheckoutRequest{Order,
  SuccessURL, CancelURL, BuyerEmail, Locale}` — buyer email prefills the
  channel checkout, locale is passed through, and cancel-URL support is
  declared via the new `ChannelCapabilityViewer.Capabilities() ChannelCaps`
  instead of being silently ignored. `ChannelRegistry.Names()` replaced by
  `OrderedNames()` (DisplayOrder asc) so `/config` `billing_channels` is a
  priority-ordered array; stripe=200, manual=900, unset=500.
  `Repo.SetOrderChannelRef` → `SetOrderChannelRefAndExpiry`.
  `BillingService` gains `WithBuyerEmailResolver` (wired from identity at
  assembly; billing does not import identity) and `Config.Locale`;
  stripe/manual adapters and all fakes updated in the same batch
- **webx**: `Gzip(next)` — the runtime compression lane, promoted from
  example's hand-written middleware (reverse clause). Same behaviour as the
  product-side version it replaces, plus three defects that this class of
  hand-rolling reproduces: `Accept-Encoding: gzip;q=0` (an explicit refusal)
  and `x-gzip` (not gzip) both satisfied a substring check and got
  "compressed".
  Parses the header for real, skips already-encoded bodies (`Precompressed`
  answered those), stamps `Vary: Accept-Encoding` (deduped), and exposes
  `Unwrap` for `http.ResponseController`. Guard registered in internal/arch:
  example may not import `compress/gzip` directly

### Fixed (audit pass over this batch — five parallel audit agents, every
finding re-verified against the code before fixing)
- **billing**: late-payment race with the stale-checkout sweeper — the
  sweeper flipped expired pending orders to canceled with no grace period
  and `handlePaid` then terminally ignored the money event while the
  channel kept charging. Migration 051 adds `order.canceled_by`
  ('expiry'/'user'/'admin'); the sweeper runs behind a 24h grace window,
  and a late paid event revives an expiry-canceled order (canceled→paid,
  audited as `billing.order_revived_after_expiry`); user/admin cancels and
  pre-051 rows stay final
- **billing**: manual-channel orders no longer auto-expire after 7 days —
  offline transfers have no session TTL; `MarkOrderPaid` works at any age
- **billing**: renewal-path reconciliation (the PayPal seam) —
  `handleRenewed` now persists `payment_intent` when the event carries an
  order id (the refund lookup no longer dead-ends) and reconciles the
  charged amount against the *current* plan price, refusing to extend
  (audited `billing.amount_mismatch`, phase=renewal) when a price change
  was not synced — the defense the ConfigSchema help had promised; waffo/
  stripe renewals (no order id) behave exactly as before
- **billing/waffo**: idempotency key is now `eventType:eventId` (fallback
  `eventType:id`) — two renewals of the same order no longer collide on the
  entity-level id and silently drop the later period while the customer
  keeps being charged; signature tolerance window 45min→24h (covers the
  documented 8h retry chain); mapped events record their payload; and
  `Configured` is credential-only, so catalog-mode channels no longer show
  "unconfigured" with a disabled connection test
- **billing/paypal**: SALE events carry the order id (custom_id) so the
  renewal defenses engage; a 23-currency subscription whitelist rejects
  unsupported currencies before any network call; `RegisterProduct` reuses
  an existing catalog product by name, so a failed retry no longer
  accumulates orphan products; JPY `"4500.00"` echo amounts parse correctly
- **billing/money**: `ParseAmountForCurrency` (zero-decimal `"4500.00"`
  echo normalization), `FormatCentsChecked` and `CheckMinorUnit` —
  three-decimal currencies (KWD, BHD, …) are rejected at plan validation
  instead of being silently priced 10x off (`ValidateCurrency` was dead
  code; it is wired now)
- **settings**: a single unsealable `billing_channel.*` row no longer takes
  the whole channel registry down at boot (env-configured channels and the
  credential-free manual channel included) — poison rows are skipped
  per-channel with a named warning; submitting the `__SET__` marker keeps
  the stored secret (server-side short-circuit, mirroring masked-value
  handling in the generic settings API); `SetMany` writes one channel's
  fields in a single transaction; a missing seal key returns 503 with the
  PLOYKIT_SEAL_KEY hint instead of an opaque 500; clearing a required field
  is rejected unless the environment provides it
  (`ChannelEnvViewer.EnvProvidedKeys`, surfaced as `env_provided` on the
  channel card)
- **ui**: env-configured channels can save partial edits (the required
  check exempts env-provided fields); saving a plan price invalidates the
  channel-catalog table on the same page (it used to keep showing "synced"
  with the old price); concurrent register/sync buttons track per-row
  pending state; JPY prices display at true value (no ÷100); the channel
  PUT response type matches the `{channel}` envelope

## [0.12.0] — 2026-10-21

Frontend payload batch: the second render axis (`hydrate`), route-level code
splitting, and the delivery-layer work (cache headers, brotli, prefetch) needed
to make the split actually pay off. Go (`platform/renderx`, `platform/webx`) +
npm (`@ploykit/runtime` 0.9.0, `@ploykit/hooks` 0.9.0, `@ploykit/ui` 2.3.0).
Motivated by the Astro comparison: the framework already had static rendering,
cache invalidation and zero-Node deployment; what it lacked was the *default* of
not shipping JavaScript when a page does not need it.

Breaking surface (0.x minor): `renderx.RenderOnce` gained a `Hydrate` argument;
`RouteSpec`/`PageSpec` gained a `hydrate` field (required on `PageSpec`);
`useZodForm`'s `schema` type is now structural rather than `ZodSchema<T, T>`;
`SignInForm`/`SignInModal` default to `flow: 'email-first'`.

### Added
- **webx**: `AssetCacheManifest` / `AssetCacheManifestWithTTL` — the exact form
  of the asset cache: `files` is the list of paths the build emitted (from
  `renderx.ViteManifestFiles(manifest.json)`), so a path is immutable **iff the
  build listed it**. This exists because the filename heuristic cannot be made
  correct: `Some-Page-Banner.png`, `Hero-Image-Large.jpg` and `DOWNLOAD.png` all
  look exactly like hashes and were pinned `immutable, max-age=1y`, while
  tightening the rule to reject them also rejects real Vite hashes (`CYhS-pAS`,
  `B-WCCgPC`, `C-pQOpeV` — separator, no digit). The example now wires the
  manifest variant and falls back to `AssetCache` only when the manifest is
  absent. Verified 36/36 against the production build.
- **renderx**: `ViteManifestFiles(data)` — every file path in a Vite
  `manifest.json` (each entry's `file` plus its `css` list), slash-prefixed,
  deduped and sorted; the data source for `webx.AssetCacheManifest`.
- **webx**: `Precompressed` middleware — serves build-time `.br` sidecars when
  the client accepts brotli, falling back to identity, and always stamps
  `Vary: Accept-Encoding` (deduped against the outer gzip layer). Build-time
  because Go ships a brotli decoder but no encoder; `-q 11` at build time beats
  gzip -9 by ~14% on the entry chunk (171 KB → 144 KB). It sets `Content-Type`
  itself — the layer answers before the file server, and with `nosniff` a missing
  type silently blocks module execution.
- **tools**: `tools/precompress.mjs <dir>` generates the sidecars, skipping
  formats that are already compressed and sidecars larger than their source;
  wired into `example/Makefile`'s `build`.
- **webx**: `AssetCache` / `AssetCacheWithTTL` middleware — strong caching
  (`public, max-age=31536000, immutable` + URL-derived `ETag` with 304) for
  content-addressed asset paths only. The filename predicate is mechanical (a
  ≥8-char hash segment), so it does not depend on Vite's default `/assets/`
  directory. HTML and unhashed files pass through untouched. Found by
  measurement, not review: `http.FileServer` sends no cache headers at all, so
  after the code-splitting batch every in-site navigation re-downloaded the
  entry chunk (the same 178 KB gzip fetched twice across one `/login` →
  `/register` navigation). After wiring: second navigation 204 KB → 15 KB, hard
  reload of a visited page 0 KB.
- **ui**: `ConfirmProvider` no longer statically imports the AlertDialog primitive.
  The provider (context + promise queue) stays in the entry because `useConfirm()`
  must resolve synchronously; the dialog moved to `ConfirmDialogBody.tsx` and is
  imported on the first `confirm()` call. Measured: that primitive is 23.0 KB
  gzip, and it sat in the entry of *every* page while only firing for
  destructive actions. Entry 169 KB → 152 KB.
- **ui**: `LandingPage` accepts `navLinks` (rendered in both the header and the
  footer as real `<a href>`s). Needed because content pages now ship zero JS —
  a client-router `Link` has nothing to intercept there.
- **example**: `/pricing`, `/docs`, `/about` added as `render: 'static'` +
  `hydrate: 'none'`. Verified in a browser: **0 JS requests** on all four content
  pages, and the prerender sitemap picks them up automatically.
- **renderx**: `Hydrate` (`"none" | "load"`) joins `Mode` as the second axis of
  the route projection. `hydrate: "none"` omits both the props script and the
  client entry from the produced document — the HTML is final and the page ships
  zero JS. Empty string normalizes to `load`, so a product upgraded ahead of the
  framework keeps working. `hydrate: "none"` on a `csr` route is rejected at
  startup reconciliation (a CSR page that never mounts renders nothing).
  `RenderOnce` takes a `Hydrate` argument; `Document.NoHydration` skips the props
  script at the template level. CSS is still emitted — styling belongs to the
  final HTML, not to hydration. Docs: rendering.md §2.1.
- **runtime**: `lazyPage(name, load)` wraps a dynamic import into a route-table
  component. It exists for two reasons `React.lazy` does not cover: `displayName`
  (so `routeTable()` still derives a stable `pageId` from the component name
  instead of falling back to path-derived ids with `-2` suffixes) and a
  `preload()` hook that TanStack Router's `defaultPreload` can call.
- **runtime/ui**: `sideEffects: ["**/*.css"]` in `@ploykit/ui`. Without it a
  barrel import of one component pulled in zod + sonner + the whole form stack
  (measured: importing only `Button` cost 119 KB gzip; now 16 KB).
- **ui**: password-strength rule moved out of `RegisterPage.tsx` into
  `ui/src/lib/password-schema.ts`. Three pages consume it (register, reset,
  change-password), and the settings-area one was importing the *page module* —
  dragging the entire registration form into the settings chunk.
- **hooks**: `useZodForm`'s `schema` is now structurally typed (`{ parse(...) }`)
  instead of `ZodSchema<T, T>`, so callers may pass either full `zod` or
  `zod/mini`. `@hookform/resolvers/zod` keys off `"_zod" in schema` at runtime
  and both flavours satisfy it.

### Fixed (audit pass over this batch)
- **webx**: `AssetCache`'s content-addressed test was wrong in both directions.
  Splitting on separators and reading the last token missed 7 of 36 assets in the
  example build (`DialogTitle-7-VtvLIt`, `routes-settings-CQZQEAZD`, …) because
  Vite's hash is base64url — `-` is part of the alphabet, not always a separator;
  and a length-only rule classified `hero-image-large.jpg` as immutable, pinning a
  file products expect to replace in place. The rule is now a 8-16 char sliding
  suffix requiring a fingerprint signature (a digit or an uppercase letter):
  36/36 correct on the real build. Also: headers are attached only to 2xx (a 404
  on a fingerprinted path must not be cached for a year), non-GET/HEAD pass
  through, and 304 keeps `Vary`.
- **webx**: `Precompressed` answered `Range` and non-GET requests with a 200 +
  whole encoded body (wrong semantics for partial content), looked up sidecars for
  backslash paths, and served a sidecar whose identity file was gone (turning a
  404 into a 200 with bytes nothing references). All three now fall through to the
  file server, which owns existence and ranges.
- **tools**: `precompress.mjs` now deletes a stale sidecar when the fresh output
  would be larger than its source — leaving it in place kept the server sending
  brotli bytes that no longer matched.
- **renderx**: added `ErrServerSuspense` / assertion A2′. Documented as A2's job
  ("a lazy static page fails A2 at build time"), it could not be: `renderToString`
  emits `<!--$!-->` plus a template, which is non-empty. Verified against React 19
  directly; both the prerender pipeline and runtime misses now reject it.
- **ui**: `ConfirmProvider`'s on-demand dialog could hang its caller forever. A
  failed chunk import left the promise unresolved (the caller's `await confirm()`
  never continued, so the triggering button stayed busy), and a second `confirm()`
  while a dialog was open overwrote the pending request without settling it. The
  dialog module is now fetched per invocation (a failed import is retryable rather
  than permanently poisoned the way `React.lazy`'s rejected thunk is), a load
  failure settles as "cancelled", and a superseded request settles as "cancelled"
  too.
- **runtime**: `lazyPage` cached its rejected import promise, so one network blip
  made a route permanently unloadable for the session. Failures now clear the
  memo, and `preload()` returns its promise so TanStack's prefetch path can await
  it.
- **ui**: the login redirect guard was open to a backslash bypass.
  `loginRedirectTarget` rejected `//host` but allowed `/\evil.com` and
  `/\t/evil.com` — WHATWG URL parsing treats `\` as `/` for special schemes and
  strips control characters, so both resolve to `https://evil.com/`. The guard now
  rejects control characters and backslashes and confirms same-origin against the
  parsed URL.
- **example**: login/register pageIds now come from a shared `displayName` anchor
  in the route factory. Relying on the function name produced `register-page2` on
  the server (esbuild renamed one of two same-named functions) while the client
  lazy page derived `register-page`, silently disabling the embedded-pageId rung
  of the hydration ladder.
- **ui (test infra)**: the suite was flaky under parallel load — assertions that
  await a dynamic import failed with "unable to find element" against
  testing-library's 1s `asyncUtilTimeout`. Raised to 5s with a 15s test timeout,
  and the affected files warm the module cache in `beforeAll`. Three consecutive
  full runs are green.

### Changed
- **ui**: `SignInForm` now defaults to **`flow: 'email-first'`** and renders OAuth
  providers *above* the form. Rationale: the consumer-facing door should show one
  input, not a code-vs-password choice; one-click OAuth is the preferred path and
  the email form is the fallback after an "or" separator. The two-tab layout is
  still available as `flow: 'tabs'` but is no longer the default, and its
  implementation moved to `SignInFormTabs.tsx` behind a dynamic import — products
  that never use tabs no longer download Base UI's Tabs primitive (measured 4.9 KB gzip for
the whole tabs chunk in the example build).
  Password login stays reachable from the default shape via a "sign in with
  password" link (it cannot be removed: register-created users have a password,
  OAuth-created users do not, and both must be able to sign in). `SignInModal`'s
  default follows. Behavior/state moved verbatim into `useSignInFlow.ts`.
  **Constraint**: `flow: 'tabs'` cannot be used on a `render: 'static'` page —
  its dynamic import cannot resolve inside the synchronous QuickJS sandbox, so it
  collapses to a Suspense placeholder. `email-first` and `passwordOnly` prerender
  fine. Prerendered `/login` shrank 11.9 KB → 4.4 KB of HTML.
- **example**: the blog post's in-flow sign-in no longer passes `passwordOnly`.
  That flag locked out OAuth-created users, who have no `password_hash`.
- **runtime**: `tanstackAssembler` sets `defaultPreload: 'intent'` and forwards
  each page component's `preload()` onto the route component it builds. Both
  halves are required: TanStack's prefetch path reads
  `route.options.component.preload`, and the assembler wraps every page in a
  lambda (to close over `propsByPageId`), which has no such property — without
  the forward, `defaultPreload` silently loads nothing. Together they remove the
  request chain that splitting introduced (HTML → entry chunk → route chunk;
  measured ~137 ms of pure serialization locally, one extra round trip on a real
  network).
- **example**: login and register are now prerendered **without** paying for it in
  the client bundle. They previously returned 469 bytes of
  `<div id="root"></div>` — a blank screen until the whole entry chunk had
  downloaded and executed; the HTML now arrives complete (11.9 KB / 12.8 KB) with
  the form visible at first paint.
  The first version of this change sync-imported both pages on *both* entries,
  which pushed the client entry from 172 KB to 206 KB and made every unrelated
  route (the blog post notably) carry zod + react-hook-form. That coupling was
  unnecessary: Vite builds the client and esbuild builds the SSR bundle, so the
  two module graphs are independent. `routes-table.tsx` is now a **factory**
  holding all ~38 route declarations once and taking the two auth routes as
  parameters; `routes.tsx` (client) passes `lazyPage(...)`, `routes.server.tsx`
  (server) passes synchronous imports with `render: 'static'`. A factory rather
  than two tables because two tables drift silently — a path added to one side
  just serves the SPA shell on that entry.
  Result: entry back to **173 KB gzip** with login/register still prerendered.
  Hydration across the split verified end-to-end (React container present, tab
  switching live, zod messages on empty submit, lazy auth pages unaffected).
  Boundary: a client-lazy prerendered page shows its HTML immediately but stays
  non-interactive until its chunk lands (measured 162.5 KB gzip on `/login` —
  entry closure plus ~11.8 KB of route chunks); pages that must
  be interactive on a cold cache should import synchronously on both sides and
  accept the entry cost.
- **example**: the other low-frequency auth pages live in `routes-auth-misc.tsx`
  so a static import of login cannot drag them into the entry (Rollup keeps a
  module in the entry when it is both statically and dynamically imported).
- **ui**: form validation migrated from `zod` to `zod/mini` across all six
  schema-bearing pages (register, profile, security, members, workspace-general,
  schedules, webhooks). Same rules expressed as explicit `check()` compositions;
  measured 39 KB → 8 KB gzip for the same validation. Because a `.check()` list
  missing an entry type-checks silently, every rule is pinned by its
  user-visible message in `settings-schemas.test.ts` / `RegisterPageSchema.test.ts`,
  plus an end-to-end `RegisterPageValidation.test.tsx` asserting illegal input
  never reaches the network.
- **example**: the client graph is split along product-surface lines. Public
  pages (login/register/forgot/reset/verify) load on demand; the app area,
  settings area and admin console are one chunk each; the blog post's sign-in
  dialog + toast stack is an island loaded only when the reader clicks "collect".
  `render: 'static'` pages stay synchronous imports — the QuickJS sandbox renders
  them synchronously and never pumps a promise, so a lazy static page renders
  React's client-rendering placeholder. That placeholder is **non-empty**, so
  assertion A2 (empty output) does not see it; assertion A2′ does
  (`renderx: page suspended during server render`), at build time and on runtime
  misses.
- Measured on the example (gzip, production; marginal measured from the Vite
  manifest's import graph): entry **152 KB** (was 337 KB before the split),
  content pages (`/`, `/pricing`, `/docs`, `/about`) **0 KB**, blog post 152 KB
  initial (+31 KB only if the reader opens the sign-in island), login 162 KB /
  +11, register 181 KB / +29, `/app` 231 KB / +79, `/admin` 275 KB / +123,
  `/settings` 295 KB / +143. The entry is react-dom + TanStack Router + the root
  `Toaster`; brotli brings it to ~130 KB on the wire.

## [0.11.3] — 2026-10-21

Consumer-hardening batch from the risk-engine test sweep (28 parallel test
agents; findings audited line-by-line against source in
`risk-engine/test-reports/AUDIT.md`). Go only: `platform/pg`, `platform/webx`,
`platform/devx`, `identity/app` + `identity/adapters/pgrepo`. No npm changes.

### Added
- **pg**: the database-rejection classifier family that was missing next to
  `IsUniqueViolation`/`AsNotFound`: `IsStringTooLong` (SQLSTATE 22001),
  `IsInvalidTextRepresentation` (22P02), `IsNumericOutOfRange` (22003),
  `IsForeignKeyViolation` (23503). Plus `AsValidation(err, msg)` — folds those
  three into 400 E_VALIDATION and passes everything else through — and
  `AsConflict(err, msg)` for the "still referenced, cannot delete" reading of
  23503. Rationale: the same 500-instead-of-400 defect reproduced **seven
  independent times** in the consuming product (over-length names on products /
  policies / rulesets / scorecards / interfaces / list groups / list items, plus
  malformed-UUID path parameters) — every consumer was re-deriving this mapping
  by hand and the omission has no visible symptom until production traffic hits
  it. Foreign keys are deliberately NOT folded into `AsValidation`: 23503 means
  opposite things on insert and delete, so callers pick with
  `IsForeignKeyViolation` / `AsNotFound` / `AsConflict`.
- **webx**: `ParsePagination(r, defaultSize, maxSize) Pagination`
  (`PageNum`/`PageSize`/`Offset()`). Clamps instead of rejecting: pageNum < 1 or
  non-numeric → 1, pageSize < 1 or non-numeric → default, pageSize > max → max.
  The product had three different behaviors for the same parameters (pageNum
  clamped everywhere, pageSize=999 honored verbatim on one endpoint, pageSize=-1
  falling to the default on another) because each handler invented its own rule.
- **webx**: `NewRateLimitedRetry(msg, after time.Duration)`; `Error` gained a
  `RetryAfter` field that `WriteErr` renders as the standard `Retry-After`
  header (rounded up to whole seconds) and mirrors into
  `details.retry_after_seconds` for clients that cannot read cross-origin
  headers. Sub-second waits round up to 1 — `Retry-After: 0` reads as "retry
  now". A plain `NewRateLimited` still emits no header.
- **identity**: `Repo.EarliestRecentAttempt(...)` (port + pgrepo). The login and
  MFA limiter now answer 429 with the actual remaining wait — the time until the
  OLDEST failed attempt slides out of the window, the first moment the count can
  drop below the threshold. Before this the response was a bare "too many
  attempts, retry later" with no usable wait hint (the consuming product's login
  page could only print the English sentence).
- **devx**: auth-posture check trio, siblings of `CookieSecureCheck` — each
  catches a security setting that silently holds its development value in an
  otherwise-healthy deployment:
  - `AuthSecretCheck(secret, devDefault, production)` — a session pepper still
    at the documented default in production (sessions forgeable offline, CSRF
    keys predictable);
  - `IPHashSaltCheck(salt, production)` — an empty `AuthConfig.IPHashSecret`
    (throttling/step-up fingerprints enumerable);
  - `DevCodeCheck(devCode, production)` — a universal dev login code accepted
    because `PRODUCTION` was never set (the framework hard-fails when
    `Production=true` AND `DevCode` is set, so the dangerous state is the
    inverse, and it was completely silent).
  Wired into the example doctor.

### Changed
- **webx (docs)**: `DefaultAuthConfig`'s comment now states the
  `IPHashSecret` production requirement and points at
  `devx.IPHashSaltCheck`; previously only `Secure` was documented, so the empty
  salt was a one-line boot warning nobody read.
- **docs**: `platform-api-index.md` documents the new pg classifiers, the
  pagination helper, `NewRateLimitedRetry` / `Retry-After` behavior, and the
  auth-posture checks.

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
