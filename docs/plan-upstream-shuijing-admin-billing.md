# Plan: shuijing upstream batch — settings keys / admin guard / plans editing / admin bootstrap / notify templates (framework side)

> Status: audited 2026-10-16 (round 1: master plan; round 2: the three subsidiary volumes ①②③ — see
> `docs/delivery-audit-shuijing-upstream-migration.md`); **all decisions (D1-D5) ruled and all packages
> (UP-1..UP-8) implemented and landed the same day** — see §6/§7. Source:
> `D:\code\shuijing\docs\design-commercialization-master-plan.md` + ① `design-admin-settings-extensions.md`
> ② `design-credit-packs.md` ③ `design-pricing-page.md` (shuijing main@df6b27c, 2026-10-16) — the
> product-side master plan for the braceletmakeronline.com launch. Every framework-side claim was verified
> against ploykit v0.7.4 (`de8e9cf`) before migration; the evidence tables are §1. This doc migrates the
> framework scope (UP-1..UP-8) so it can be executed without the product repo. Product-side work (credit
> ledger, SKU pricing, pricing page, brand buttons — PR-1..PR-10 in the source) stays in shuijing and is
> out of scope here; product-contract divergences found across the four source docs (pack SKU naming,
> balance endpoint, 402 code, credits-per-shot) are catalogued in the audit report §3 for the product
> owner, not here.

## 0. Split rule (from source §2)

The swap test: "would another ploykit product want this?" → framework; "only meaningful to this business" →
product. Mechanism (settings key infrastructure, HTML-injection keys, admin API/pages, bootstrap, guard,
billing hook surface, email template configurability) comes upstream; business semantics (credit currency,
grant/refund policy, SKU prices, pricing-page UI, copy choices, domain ops) stay product-side. Upstream
precedent: v0.7.4 shipped the previous shuijing feedback batch directly into the package.

## 1. Audit of the source plan's framework claims — verdict: all true

Verified against v0.7.4 working tree on 2026-10-16. No factual errors found; three refinement notes (N1-N3)
are folded into the package specs below.

| # | Claim in source plan | Verdict | Evidence |
|---|---|---|---|
| 1 | settings has no sensitive-value masking; only 8 keys exist | true | `settings/keys.go:12-29` (banner/maintenance/signup/rate-limit keys only; no `IsSensitive`/`MaskedValue`) |
| 2 | Bootstrap seeds every key in `KeyOrder` unconditionally | true | `settings/bootstrap.go:15-27` (no seedable filter — an env value is frozen into the DB row on first boot) |
| 3 | `requireAdmin` is unexported; a product closure misses two defenses | true | `admin/adapters/http/routes.go:56-77` — export would carry the impersonation block (:67-70) and the PAT block (:71-74) that hand-written guards miss |
| 4 | no admin bootstrap exists | true | `admin/` has only `adapters/`, `app/`, `hooks.go` |
| 5 | no plans-edit endpoint; edit surface matches the Plan model | true | `admin/adapters/http/routes_billingops.go:28` (GET only); `billing/domain/model.go:8-15` (code/name/limits/sort_no/currency — exactly the proposed PATCH surface) |
| 6 | `AdminDeps` has no OAuth-status hook | true | `settings/adapters/http/http.go:28-38` |
| 7 | email templates are hardcoded Chinese | true | `notify/adapters/email/smtp/smtp.go:81-101` — **N1: four templates, not three**: `SendLoginCode`（“你的登录验证码”）, `SendInvite`（“工作区邀请”）, `SendPasswordReset`（“重置你的密码”）and `SendEmailVerification`（“验证你的邮箱”）. Same fix scope, but UP-7 must cover all four |
| 8 | BillingPage renders one_time packs as ¥0/$0 monthly cards | true | `packages/ui/src/pages/workspace/BillingPage.tsx:47-48` — `priceCentsOf` reads only `price_monthly_cents`/`price_yearly_cents` |
| 9 | manual mark-paid is a dead end: sets paid + emits event, no plan change, no hook, no framework consumer | true | `billing/app/service_markpaid.go:27-37` (only `PayOrder` + audit); `ports_events.go:71-90` (event carries idempotency key `billing.order_marked_paid:<orderID>`); example only bridges it to outbound webhooks (`example/cmd/app/main.go:647`). Plan provisioning on manual payment is deliberately a product subscription — the event is the extension point |
| 10 | a paid one_time order unconditionally changes `plan_code` | true | `billing/app/service.go` `handlePaid` calls `ChangeWorkspacePlan` for every paid order regardless of interval |
| 11 | `plan.currency` already takes precedence; hardcoded CNY is fallback only | true | `billing/app/service.go:730-735` (`planCurrency`); `example/cmd/app/main.go:428` (CNY is the `Config` default) |
| 12 | LoginPage reads only `location.state.from`; OAuth callback hardcodes a 302 to `/app` | true | `packages/ui/src/pages/LoginPage.tsx:23-26,65-67`; `identity/adapters/http/oauth.go:44` and `fed.go:43` (`appURL+"/app"`, no next passthrough) |
| 13 | two sensitive-value leaks: settings `put` logs plaintext from/to; `list` returns raw `items` + `effective` | true | `settings/adapters/http/http.go:102-104` (log `"from"/"to"`), `:66-71` (raw `Store.All` + `Effective` in response). The public `/config` leak is product-side (shuijing `main.go:797-799` copies `Effective` verbatim) |
| 14 | checkout `{plan_code, interval, channel}` → session with `action_url` already exists | true | `billing/adapters/http/routes.go:92-111`; `billing/domain/model.go:59`; stripe `channel.go:93`; manual `manual_channel.go:27` |
| 15 | webhook mount is `/webhooks/billing/{channel}`; prices are inline `PriceData`, never configured in Stripe | true | `billing/adapters/http/routes.go:41`; `billing/adapters/stripe/channel.go:52-75` |
| 16 | env facts: `IP_HASH_SECRET` refuses production start; `BILLING_SUCCESS_URL` defaults to localhost:5173; `BILLING_CANCEL_URL` is unset in example (cancel behavior undefined); `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SIGNING_KEY` names | true | `example/cmd/app/main.go:268` (fatal in production), `:428` (default `http://localhost:5173/billing/success`; `Config.CancelURL` exists at `billing/app/service.go:19-20` but example passes none), `:420-421` |
| 17 | `oauthProviders=[]` suppresses the framework OAuth block (brand-button strategy) | true | `packages/ui/src/pages/LoginPage.tsx:238` renders the section only when `length > 0`; `onSuccess` prop exists |

Round 2 — claims sourced from the subsidiary volumes ①②③ (all verified the same day; full matrix in the
audit report):

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 18 | new settings keys need zero DDL — `site_settings` is a generic KV table | true | `migrations/038_site_settings.up.sql:3-8`; `settings/store.go` Get/Set unrestricted |
| 19 | platform-admin column exists with no seed/bootstrap path | true | `migrations/012_admin.up.sql:2` |
| 20 | AdminSettingsPage envelope = items/effective/defaults/descriptions; batch `putKeys` helper; per-key hand-written cards | true | `packages/ui/src/pages/admin/AdminSettingsPage.tsx:32-39,75-89` |
| 21 | quota-grant三件套: route + reason/amount/ref validation + idempotent 409 ("identical grant already applied (same key/reason/ref)") — the shape any credits-grant port would mirror | true | `admin/adapters/http/routes_wsops.go:30,76-91`; `admin/app/service_wsops.go:140-171` |
| 22 | one_time amount = `limits.price_one_time_cents`, missing/≤0 → "plan is not priced for this interval" | true | `billing/app/service.go:76-84,713-729` |
| 23 | Stripe Mode=Payment default; one_time adds PaymentIntent metadata; subscriptions switch Mode+Recurring | true | `billing/adapters/stripe/channel.go:45-77` |
| 24 | refund forces plan to `free` (reason `refund:<orderID>`) and fires OnPlanChanged(to=free) — pack refunds reset the plan, credits are a product concern | true | `billing/app/service.go:291-303` |
| 25 | crash between order-paid and MarkEventProcessed → webhook replay re-runs ChangeWorkspacePlan + hook (grants must key on order id) | true | `billing/app/service.go:184-197` (ErrStatusConflict branch re-fetches, paid → continues) |
| 26 | OAuth callback URL computed per-request (Host + X-Forwarded-Proto) — proxy misconfig shows up as redirect_uri_mismatch, hence the UP-6 card | true | `identity/app/service_oauth.go:55-67` |
| 27 | LoginPage OAuth block copy is hardcoded Chinese with no copy/slot prop; card layout is min-h-screen/max-w-sm | true | `packages/ui/src/pages/LoginPage.tsx:238-254,129-133`; props `:29-49` |
| 28 | BillingSuccessPage `redirectTo` prop defaults to `/settings/workspace/billing`; toast copy「支付成功，套餐已生效」 | true | `packages/ui/src/pages/workspace/BillingSuccessPage.tsx:23-27,55` |
| 29 | AfterRegister hook is transactional `(ctx, tx pgx.Tx, userID string) error` — register-time grants can share the workspace-creation tx | true | `identity/app/hooks.go:10` |
| 30 | `/api/usage` renders one item per plan-limits key — a pack plan lacking free-tier keys blanks the usage list | true | `quota/adapters/http/usage.go:46-60` |
| 31 | framework plan seed (free/pro) carries no price keys; free = workspaces:1, tasks_monthly:50 | true | `migrations/007_plan_seed.up.sql:2-5` |
| 32 | plan.currency CHECK `^[A-Z]{3}$`, default CNY | true | `migrations/040_plan_currency.up.sql` |
| 33 | ③§5's premise "QuickJS physical stack ceiling is unfixable / upstream won't fix" | **stale** | contradicted by the source's own baseline: v0.7.4 ships the ADR 0015 rebuild — in-repo wasm, 8 MiB shadow stack, `platform/renderx/engine.go:27-50` (~3k frames at the 1 MiB default, ~8k at the 7 MiB cap). ③'s light-tree checklist stays good practice; its "cannot fix" framing does not |
| 34 | identity exposes GetUserByEmail (bootstrap doesn't need to import identity adapters) | true | `identity/adapters/pgrepo/users.go:54` |

## 2. The eight upstream packages

Effort figures come from the source plan (single-maintainer estimates). Each package is independently
revertable and lands as its own upstream commit; **each lands with example wiring in the same change**
(wiring discipline) — the source plan names framework drop-in points only, the wiring rows below are added
here. The reverse clause applies to UP-3: example's hand-written admin-guard closures switch to the exported
guard when it lands.

### UP-1 · settings key infrastructure + sensitive masking (serial prerequisite, 0.5d)

Spec completed from ①§1-§2 (round 2). Zero DDL — `site_settings` is a generic KV table (038, claim 18).

- Six new keys registered in `settings/keys.go`: `smtp_host`, `smtp_port` (default `"587"`), `smtp_user`,
  `smtp_pass`, `smtp_from`, `site_verification_meta` — consts + `KeyOrder` (whitelist; PUT of an unlisted
  key is rejected by the `Validate` default branch) + `Defaults` + `Descriptions` (cards render
  `descriptions.<key>` directly).
- Env fallbacks in `effectiveValue`: `SMTP_HOST/PORT/USER/PASS/FROM` (+ optional
  `SITE_VERIFICATION_META`) — non-empty raw fallback like `allowed_domains`; port parses as 1..65535.
  Env stays alive until the first admin write ("DB row > env" short-circuit in `value()`).
- **Masking mechanism**: `IsSensitive(key) bool` (v1: `smtp_pass` only) + exported
  `MaskedValue = "******"`. Enumerate every sink (**N2**): `put` audit log `from`/`to`
  (`http.go:102-104`), `list` response **both** `items` and `effective`, `test-email` log, and the `put`
  response body. A mechanism that fixes the log but leaves `list` raw still leaks through every product
  surface proxying `Effective` (shuijing `/config` is the live example).
- **Mask-idempotent short-circuit in `put`**: `IsSensitive(key) && body.Value == MaskedValue` → 200 with
  the mask, no write (UI round-trips the masked echo as "unchanged").
- **`list` gains a `mail_mode` field** and **`AdminDeps.MailMode` changes type `string` → `func() string`**
  (hot-reload; source flags this as a breaking change whose only consumer today is shuijing — same-repo
  clean cut).
- **Hot-read accessors** on `*Store` (same shape as `Maintenance`): `SMTPConfig(ctx) (host, port, user,
  pass, from, err)` and `SiteVerificationMeta(ctx) (string, error)` — what product hot-mailer/middleware
  poll on a short TTL.
- Validation (①§2.3): host ≤253 chars hostname charset, empty = dev-channel; port empty→587 else 1..65535;
  user ≤254 printable ASCII; pass ≤256; from empty-or-valid-email (implemented in `settings`, not by
  importing settingshttp); meta key per UP-2.
- Bootstrap seedable filter (`bootstrap.go`): `if !seedable(key) { continue }` — new keys never seeded;
  the five existing env-backed keys keep first-boot seeding. Unification is decision D2.
- No new endpoints; `GET/PUT /api/admin/settings` response semantics change (masked values + `mail_mode`)
  — schema note in `docs/openapi.yaml`.
- Wiring: AdminSettingsPage SMTP card (five inputs via batch `putKeys`; pass input never back-fills the
  real value, empty pass = key omitted from the save list) + vitest ("mask echo not back-filled / saves 5
  keys / empty pass skips"); masking unit tests in `settings`.
- **D1 (ruled)**: smtp_pass at rest is sealed day-one via sealx — see §6; the masking chain remains as
  defense for logs/responses (sealed values never appear anywhere in plaintext).

### UP-2 · site_verification_meta validation (folded into UP-1)

Spec from ①§3. Stored form is the normalized pair `name|content` (e.g.
`google-site-verification|abc123XYZ`). `Normalize` accepts two inputs — the full standard meta tag
(`(?i)^\s*<meta\s+name="…"\s+content="…"\s*/?>`, exactly what GSC/Bing hand you to paste) or a bare
`name|content` pair. `Validate` after normalization: name 1..64, content 1..256, both over the charset
`[A-Za-z0-9_.:/+=-]` (strict superset of GSC/Bing content chars); anything else — including stray
`<`/`>` — is a 400. Export `ParseVerificationMeta` so the product's injection middleware (shuijing PR-2)
can recompose the tag server-side: **stored user input is never reflected; only the recomposed tag is** —
that is the stored-XSS safety net, since the value is injected into every HTML page. Injection itself
(insertion before `</head>`, ETag recomputation, `If-None-Match` stripping, 404/non-HTML passthrough) is
product-side middleware; the framework ships only the key + parser + accessors.

### UP-3 · export the platform-admin guard (0.1d)

- `adminhttp.PlatformAdminGuard()` exported from `admin/adapters/http` wrapping the current four checks
  (`routes.go:56-77`): authenticated → `IsPlatformAdmin` → not impersonated → not PAT. Internal `requireAdmin`
  becomes a thin alias; zero behavior change.
- Wiring: example replaces its hand-written guard closures with the export (reverse clause); the example
  anti-duplication tests in `internal/arch` grow a case.

### UP-4 · first platform-admin bootstrap (0.25-0.5d)

Spec corrected in round 2 to match ①§6 (round 1 wrongly added an audit record).

- `admin/bootstrap.go` (package root, not adapters — it must not depend on identity adapters; a direct
  pool query is fine at boot): `BootstrapPlatformAdmin(ctx, pool, email string, log *slog.Logger) error`.
  The **caller** (product main.go) reads `BOOTSTRAP_ADMIN_EMAIL` and passes it in — env reading stays out
  of the framework function.
- Behavior: empty email → info-skip. Count platform admins; count > 0 → info-skip (never demotes, never
  promotes a second account — a post-compromise env flip cannot mint admin #2). Count == 0 →
  `UPDATE "user" SET is_platform_admin = true WHERE lower(email) = $1`; RowsAffected == 0 (user not
  registered yet — deploy-before-register is a legal order) → **warn and skip, not fatal**; reboot retries.
  Idempotent on every boot.
- **No audit record** (①§6.3: no principal exists at boot — the startup log *is* the trail). Later
  grant/revoke keeps going through `PATCH /api/admin/users/{id}/admin`; bootstrap only covers zero→one.
- Wiring: one call in example main.go after `settings.Bootstrap` (error → refuse to start, same severity
  as settings bootstrap) + test running it twice asserting no-op. Impl-time check (①§10.6): confirm
  identity's email storage normalization so the `lower(email)` match can't false-negative.

### UP-5 · plans editing API + admin page (1.5-2d)

Spec completed from ①§7 (round 2). Chosen path A (①§7.2): the write lives in the billing domain and rides
the existing ops chain — rejected alternative was admin-side direct SQL, which would duplicate plan-table
knowledge into a second module.

- Chain: `billing/adapters/pgrepo/repo_admin.go` `UpdatePlan(ctx, code, name, limitsJSON, sortNo,
  currency)` (UPDATE … WHERE code, RowsAffected==0 → not found) → `AdminRepo` port gains the method →
  `billing/app/service_adminops.go` `BillingAdminService.AdminUpdatePlan` (validate + write + audit) →
  `admin/app/ports_billing.go` + `service_billingops.go` wrapper → `admin/adapters/bridge` pass-through →
  `routes_billingops.go` `PATCH /api/admin/plans/{code}`.
- API: full-replace semantics (the UI submits the whole card; `code` immutable, carried in the path);
  response 200 `{PlanView}` (same shape as `GET /api/billing/plans`, `service_planview.go:9-16`); 400
  validation / 404 unknown code / 403 non-admin (requireAdmin covers impersonation + PAT).
- Validation (service-side backstop): name 1..100 runes; currency `^[A-Z]{3}$` aligned with the 040 CHECK;
  sort_no any int; limits keys `^[a-z][a-z0-9_]{0,63}$`, values JSON integers, `-1` = unlimited sentinel
  (seed semantics). Known price keys get numeric inputs in the UI; unknown keys pass server-side (limits is
  an open KV — unknown keys are harmless) with an "advanced key" hint in the UI only (①§10.3: tighten to a
  registry only if a later feature gives unknown keys behavior).
- Audit: `admin.plan_change` with `from`/`to` snapshots (platform-level, workspaceID nil) — queryable via
  `GET /api/admin/audit?action=admin.plan_change`.
- **Contract**: add the endpoint to `docs/openapi.yaml` — `tools/check_api.py` fails the build otherwise.
- Admin UI: `packages/ui/src/pages/admin/PlansPage.tsx` (new) + `index.ts` export + AdminShell NAV entry
  (`/admin/plans`, between workspaces and orders) + `__tests__/PlansPage.test.tsx`; expandable per-plan
  cards with dynamic limits key/value rows (add/remove row), numeric input via text+inputMode pattern.
- Effectiveness (verified, ①§7.4): every reader — checkout, `/api/billing/plans`, admin list — hits the DB
  per request with no cache; **PATCH takes effect immediately, no restart**. Existing orders are untouched
  (amount snapshotted at creation; `amountMismatch` compares order vs event, never plan — claims 22).
  Wiring: example mounts BillingOps already; add nav + handler test.

### UP-6 · OAuth status card (0.5d)

Spec corrected in round 2 to the ①§4 shape (round 1 had a weaker `[]string`).

- `settingshttp` gains `type OAuthProviderInfo struct { Name, CallbackURL string }` (json tags) and
  `AdminDeps.OAuthInfo func() []OAuthProviderInfo` (optional); `list` adds an `"oauth"` field when the
  func is non-nil (absent func → field omitted, card hidden — silently degrade when unwired).
- Card semantics (important, ①§4.3): the callback URL shown is the **expected** value derived from
  `SITE_BASE_URL` (fallback APP_URL) for comparison against what's registered in Google Console / GitHub
  App; the **actual** runtime callback is computed per-request from Host + X-Forwarded-Proto (claim 26).
  The card copy must say so, including "the reverse proxy must forward Host / X-Forwarded-Proto". Known
  limitation (①§10.5): one URL per provider — multi-domain deployments would need a request-scoped
  OAuthInfo; not in v1.
- Wiring: example closure mapping configured providers to name+URL; UI read-only card ("登录方式" style:
  provider badge + mono URL + copy button, empty state naming the env vars) + test.

### UP-7 · configurable email copy (0.5-1d)

- `notify/adapters/email/smtp`: replace the four hardcoded Chinese subjects/bodies (`smtp.go:81-101`, see N1)
  with an injectable copy set — constructor takes a `Templates` struct (per-method subject+body, `{{.Code}}`
  / `{{.Link}}` / `{{.Workspace}}` placeholders); zero value = current Chinese strings (back-compat default).
  Per-locale selection stays product-side (the product picks the copy it passes in).
- Wiring: example passes its own copy, proving the injection point; template-rendering unit tests.

### UP-8 · BillingPage one_time filtering (0.5d)

- `BillingPage` currently maps every plan onto the monthly/yearly grid (`BillingPage.tsx:47-48`), so a
  `pack_*` SKU with only `price_one_time_cents` renders as a 0-price monthly card (and checkout would
  reject it — claim 22). **D4 design divergence (round 2)**: source ②§3 filters by code prefix
  (`!p.code.startsWith('pack_')`) — that is product naming leaking into a framework page and would misfire
  for any other product; this plan recommends filtering by price-key presence (exclude plans with neither
  `price_monthly_cents` nor `price_yearly_cents`; a plan with both monthly and one_time prices keeps its
  monthly card). D4 picks between them.
- Wiring: the ui package's own vitest suite (a one_time-only fixture asserting exclusion).

### UP-C (candidate, blocked on D5) · admin credits-grant capability

Round 2 finding: the source docs **diverge on ownership**. ②§3's change matrix puts the三件套 in ploykit —
`admin/app/ports_wsops.go` gains `CreditsGranter` port (`GrantCredits(ctx, wsID, reason, refID string,
amount int, now) (bool, error)`), `service_wsops.go` gains `WithCreditsGranter` + `GrantCredits`
(mirroring `GrantQuota`: reason required, amount>0, ref defaults `manual:{uuid}`, same-key/reason/ref
idempotent conflict 409 — claim 21), `routes_wsops.go` gains `POST
/api/admin/workspaces/{id}/credits/grant`, plus a WorkspaceDetailPage credits card (mirroring the quota
card `:412-460`). The 总纲's PR-6 instead lists it product-side (`internal/credits、admin bridge、main.go`)
— and the 总纲's own split principle (credit ledger = business currency = product) argues the same.

- **Framework-side case** (②): pure additive surface, mirrors an existing pattern, and per the wiring
  discipline any framework route would land with example wiring anyway (a noop/example granter).
- **Product-side case** (总纲 §2): "credits" is a business concept; the swap test ("would another product
  want *credits*?") fails — what's generic is the *quota-grant pattern*, which already exists. A product
  can mount its own admin route guarded by the exported `PlatformAdminGuard()` (UP-3) without framework
  surface.
- **D5 ruling needed** before M2. If framework-side: openapi.yaml + check_api.py duty applies, example
  wiring = a bridge to an example credits-ish granter (or scope-checked noop), and the route must be
  audited (`admin.credits_grant`).

### Deferred minor · BILLING_CURRENCY env-ification

②§3 flags it deferrable: the subscription-currency fallback `Currency: "CNY"` hardcoded in example
`main.go:428` becomes `env("BILLING_CURRENCY", "CNY")` so USD-first products don't depend on per-plan
overrides. Zero framework-code change (the `Config.Currency` field already exists); it's an example +
docs touch. Fold into whichever batch touches example billing wiring.

## 3. Contract cross-references (framework ↔ product)

| Contract | Owner | Counterparty |
|---|---|---|
| SKU plan seed SQL (`pack_small/medium/large`, limits keys `credits`/`credits_bonus`/`price_one_time_cents`, `currency='USD'`) | product (migrations 1001+) | UP-5 edit form renders whatever keys the rows carry |
| pack limits must repeat the free-tier quota keys | product seed data | verified consequence of claim 10: `handlePaid` swaps the workspace's plan wholesale, so missing keys read as zero quota in `/api/usage` |
| checkout `{plan_code, interval:'one_time'}` → `action_url` | framework (exists, claim 14) | product purchase flow (PR-8) |
| `billing.order_marked_paid` event (idempotency key per order) | framework (exists, claim 9) | product manual-provisioning subscription (PR-4) |
| `oauthProviders=[]` + `onSuccess` on LoginPage | framework (exists, claim 17) | product brand login buttons (PR-10) |
| `BILLING_CANCEL_URL` | product env (framework `Config.CancelURL` already accepts it) | product cancel-yellow-bar flow (PR-8); unset = Stripe stays on-page after cancel |

Product-contract rows above use the majority position across the four source docs; where the sources
disagree with each other (pack SKU codes, balance endpoint path/shape, 402 code string, credits per
generation) see audit report §3 — those are product-side reconciliations, no framework impact.

## 4. Verified findings that shape framework work (from source §8)

1. **Manual mark-paid is a dead end by design** — the framework deliberately does not provision on manual
   payment; `billing.order_marked_paid` (in-tx, idempotent) is the extension point. No framework change;
   worth a row in `docs/api-conventions.md` when UP-5 touches billing docs.
2. **`/login?next=` dead params** — LoginPage honors `location.state.from` only; the framework-side residue
   is the OAuth callback's hardcoded `appURL+"/app"` 302 (`identity/adapters/http/oauth.go:44`, `fed.go:43`).
   Next-passthrough is a deferred framework candidate (D3 below) — needs a signed/validated next param, not
   a blind redirect.
3. **Sensitive-value leaks** (claim 13) are the driver for UP-1's masking; the public-`/config` filter is
   product-side but depends on UP-1 exporting a reusable masking helper.
4. **Currency needs no framework change** (claim 11).
5. **one_time side effects** (claim 10 + §3 table) are accepted semantics, not bugs: workspace shows
   `pack_*` after a pack purchase; quota keys must therefore ride along in pack limits.
6. **Replay window is real** (claim 25, round 2): a crash between order-paid and MarkEventProcessed makes
   the webhook replay re-run ChangeWorkspacePlan + OnPlanChangedTx. Framework unchanged (dedupe is
   event-level, and plan change is idempotent by nature) — but every product grant hook **must** key its
   ledger insert on the order id, which the source designs do. Worth a line in `docs/api-conventions.md`
   when UP-5 touches billing docs.
7. **Refund forces plan → free** (claim 24, round 2): `handleRefund` resets the workspace to free and
   fires OnPlanChanged(to=free) — a pack refund therefore does NOT re-fire the pack grant (prefix check
   sees "free") and does not claw back credits; the source explicitly accepts un-clawed credits as a
   known leniency. No framework change.
8. **The QuickJS "unfixable ceiling" premise in source ③§5 is stale** (claim 33): v0.7.4 ships the ADR
   0015 rebuild (8 MiB shadow stack, ~8k frames at max budget). ③'s light-tree checklist for /pricing
   remains sensible conservatism; its "cannot fix, upstream won't fix" framing no longer holds — products
   should size against `MaxLogicalStackSize`, not the old 64 KiB era.

## 5. Milestones (framework-side slices)

```
M1 (launch-blocking, ≈2-3d):  UP-1/UP-2 (0.5d) → UP-3 (0.1d) → UP-4 (0.25-0.5d) ∥ UP-6 (0.5d) ∥ UP-7 (0.5-1d)
M2 (billing, ≈2-2.5d):        UP-5 (1.5-2d) → UP-8 (0.5d); UP-C joins M2 only if D5 rules framework-side
```

Gates per package: `make verify` (+ `make verify-ui` for packages touching `packages/ui`), `python
tools/check_api.py` (UP-5), example wiring + tests in the same change, each package its own revertable
commit. Product-side milestones (M1/M2/M3 in the source) run in parallel against `go.mod replace` on this
checkout; on release the replace is dropped per the E1 convention.

## 6. Open decisions — all ruled 2026-10-16, implemented same day

- **D1 (smtp_pass at rest): sealx day-one.** Ruled against the source's plaintext-v1: sensitive keys seal
  via `platform/sealx` at the `Store.Set` boundary (`settings/seal.go`, `Store.WithSealer`); no sealer
  configured → new sensitive writes are rejected (fail-closed, matching the AGENTS sealing posture). No
  legacy rows exist (the key is introduced by this batch), so there is no migration.
- **D2 (seedable semantics): documented dual semantics.** The five pre-existing env-backed keys keep
  first-boot seeding; the six new keys are never seeded (env fallback stays alive until the first admin
  write). The split is explained in a comment block in `settings/keys.go`. Unification rejected — both
  directions either change existing deployments' behavior or re-create the env-freeze trap.
- **D3 (OAuth login next-passthrough): deferred.** Registered as candidate UP-9; shuijing ships with the
  limitation (code-login covers `next` via onSuccess; OAuth lands on `/app`).
- **D4 (BillingPage filter): capability-based.** Plans with neither `price_monthly_cents` nor
  `price_yearly_cents` are excluded from the subscription grid; the source's `pack_` code-prefix filter
  was rejected (product naming must not leak into framework pages).
- **D5 (admin credits-grant ownership): product-side.** The三件套 stays in shuijing (product route under
  the exported `PlatformAdminGuard()`); the generic pattern already exists as quota grant, and a
  framework credits card would render in every product regardless of wiring. ROADMAP trigger: a second
  product needing credits uplifting the三件套 into the framework.

## 7. Status — all packages landed 2026-10-16 (commits 332b4d9 → e223730)

| Package | State |
|---|---|
| UP-1 settings keys + sealx + masking (incl. D1/D2) | landed — 332b4d9 (with example wiring: WithSealer, MailModeFn, `/config` IsSensitive filter) |
| UP-2 meta-key validation | landed — 332b4d9 |
| UP-3 PlatformAdminGuard export | landed — f10cbce (example hand-written closure replaced, reverse clause) |
| UP-4 admin bootstrap | landed — f10cbce (example `BOOTSTRAP_ADMIN_EMAIL` wiring) |
| UP-5 plans PATCH + PlansPage | landed — 437f15b (openapi 151==151; example `/admin/plans` route; BILLING_CURRENCY env-ification folded in) |
| UP-6 OAuth status card | landed — 332b4d9 (example OAuthInfo closure) |
| UP-7 email copy injection | landed — 32a516a (example passes English copy proving the seam) |
| UP-8 BillingPage one_time filter | landed — e223730 |
| UP-9 OAuth next passthrough (candidate) | deferred — D3 |
| UP-C admin credits-grant | closed — D5 ruled product-side (no framework surface) |
