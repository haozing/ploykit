# Delivery audit: shuijing commercialization plan → ploykit upstream migration

> Audit round 2, 2026-10-16. Audited deliverable: `docs/plan-upstream-shuijing-admin-billing.md`
> (written in round 1 from the master plan only). Round 2 extends the requirement surface to the three
> subsidiary volumes the master plan references — round 1 never opened them:
> ① `design-admin-settings-extensions.md` ② `design-credit-packs.md` ③ `design-pricing-page.md`
> (all shuijing `docs/`, 2026-10-16). Code ground truth: ploykit v0.7.4 `de8e9cf` (working tree clean).
> Every verdict below carries file:line evidence gathered this session; round-1 evidence (17 claim
> clusters, all true) lives in the plan doc §1 and is not duplicated here.

## 1. Claim matrix — subsidiary volumes vs code (part A, code truth)

| # | Claim (source) | Verdict | Evidence |
|---|---|---|---|
| A18 | site_settings is a generic KV table; new keys need zero DDL (①§1.3) | ✅ | `migrations/038_site_settings.up.sql:3-8` (key/value/updated_at/updated_by); `settings/store.go` Get/Set unrestricted |
| A19 | platform admin column exists, no seed, no bootstrap (①§6.1) | ✅ | `migrations/012_admin.up.sql:2` |
| A20 | AdminSettingsPage envelope = 4 tables, page uses `effective` only; batch `putKeys` helper exists; cards hand-written (①§1.1) | ✅ | `packages/ui/src/pages/admin/AdminSettingsPage.tsx:32-39` (envelope), `:75-89` (putKeys) |
| A21 | quota-grant三件套 shape: route + reason/amount/ref validation + idempotent conflict 409 (②§2.7) | ✅ | `admin/adapters/http/routes_wsops.go:30,76-91`; `admin/app/service_wsops.go:140-171` ("identical grant already applied (same key/reason/ref)") |
| A22 | planAmountCents: one_time → `price_one_time_cents`, missing → 0; amount ≤0 rejected "plan is not priced for this interval" (②§2.3, ③§1.3) | ✅ | `billing/app/service.go:76-84,713-729` |
| A23 | Stripe: Mode=Payment default; one_time adds PaymentIntent metadata; non-one_time switches Subscription+Recurring (②§2.3) | ✅ | `billing/adapters/stripe/channel.go:45-77` |
| A24 | refund → plan forced to `free` + OnPlanChanged(to=free); credits not clawed (product accepts) (②§1.2) | ✅ | `billing/app/service.go:291-303` (`ChangeWorkspacePlan(…, "free", "refund:"+order.ID…)`) |
| A25 | crash between order-paid and MarkEventProcessed → webhook replay re-runs ChangeWorkspacePlan + hook (grant must key on order id) (②§2.1) | ✅ | `billing/app/service.go:184-197` (ErrStatusConflict branch re-fetches, paid → continues into plan change) |
| A26 | OAuth callback URL computed per-request from Host + X-Forwarded-Proto (①§4.1) | ✅ | `identity/app/service_oauth.go:55-67` |
| A27 | LoginPage OAuth block: separator「或使用以下方式登录」+ button「使用 {p.label} 登录」hardcoded Chinese, no copy prop; card layout min-h-screen/max-w-sm (③§4.1) | ✅ | `packages/ui/src/pages/LoginPage.tsx:238-254,129-133`; props `:29-49` have no copy/slot prop |
| A28 | BillingSuccessPage `redirectTo` prop defaults to `/settings/workspace/billing`; toast「支付成功，套餐已生效」(③§1.5) | ✅ | `packages/ui/src/pages/workspace/BillingSuccessPage.tsx:23-27,55` (source cites :57/:33 — trivial drift) |
| A29 | AfterRegister hook is transactional `(ctx, tx pgx.Tx, userID)` (②§2.6) | ✅ | `identity/app/hooks.go:10` |
| A30 | `/api/usage` renders one item per plan-limits key → pack rows missing free keys = items vanish (②§2.4) | ✅ | `quota/adapters/http/usage.go:46-60` (LimitsFor → per-key items) |
| A31 | framework plan seed free/pro carry no price keys; free = workspaces:1, tasks_monthly:50 (②§2.4/§4.5) | ✅ | `migrations/007_plan_seed.up.sql:2-5` |
| A32 | plan.currency column CHECK `^[A-Z]{3}$`, default CNY (①§7.4) | ✅ | `migrations/040_plan_currency.up.sql` |
| A33 | **QuickJS: "MaxStackSize 无效 / 物理栈编译期天花板 / wasm 无构建配方可自救 / 上游短期不修" (③§5)** | ❌ **stale** | contradicted by the source's own declared baseline: v0.7.4 contains the ADR 0015 rebuild — in-repo wasm with 8 MiB physical shadow stack, `platform/renderx/engine.go:27-50` (`WasmShadowStackSize=8<<20`, `MaxLogicalStackSize=7<<20`, `DefaultMaxStackSize=1<<20`, "~3k frames at default, ~8k at max"). The §5.2 light-tree checklist remains sound conservative practice, but the "unfixable red line, upstream won't fix" premise is false against v0.7.4 |
| A34 | identity has GetUserByEmail (bootstrap can look users up without importing adapters) (①§6.1) | ✅ | `identity/adapters/pgrepo/users.go:54` |

**Part A verdict: 17/18 true; A33 is the single stale claim** (product doc lagging the ADR 0015 rebuild,
both dated 2026-10-16 — ③ was evidently written from shuijing's own `ploykit-issues.md` notes).

## 2. Coverage matrix — migrated plan doc vs subsidiary-volume framework scope (part B)

| # | Framework scope item (source) | In migrated doc? | Verdict → action this round |
|---|---|---|---|
| B1 | UP-1 detail from ①§2: `MaskedValue="******"` const, put mask-idempotent short-circuit (PUT masked = no-op), `list` adds `mail_mode`, hot-read accessors `SMTPConfig`/`SiteVerificationMeta`, per-key validation table, **`AdminDeps.MailMode` string→`func() string` breaking change** | partial | 🟡 → amended (UP-1 spec completed) |
| B2 | UP-2 detail from ①§3: stored form `name\|content`, exported `ParseVerificationMeta`, bounds name 1..64 / content 1..256 + charset whitelist, server re-composes tag so stored input never reflected (XSS net) | partial | 🟡 → amended |
| B3 | UP-3 shape `func(http.Handler) http.Handler` fits settingshttp Guard; settingshttp is the only product-supplied Guard admin face (panics if nil) | yes | ✅ (already correct) |
| B4 | UP-4 corrections from ①§6: **no audit record** (no principal at boot — logs only), email passed in by caller (env read stays in product main), `lower(email)` match, missing user = warn not fatal | **diverged** (my round-1 spec said "one audit record") | 🟡 → amended to match source design |
| B5 | UP-5 detail from ①§7: path A chain (`repo_admin.go UpdatePlan` → `service_adminops.AdminUpdatePlan` → `ports_billing` → bridge → `routes_billingops`), full-replace PATCH returning PlanView, validation rules (name 1..100 runes; currency aligned to 040 CHECK; limits keys `^[a-z][a-z0-9_]{0,63}$`; -1 sentinel), immediate effect (no cache anywhere), unknown-limits-keys policy (server passes, UI hints) | partial | 🟡 → amended |
| B6 | UP-6 shape from ①§4: `OAuthInfo func() []OAuthProviderInfo{Name, CallbackURL}` (not `[]string`); card URL is the SITE_BASE_URL-**expected** value vs request-time actual; multi-domain limitation noted | **diverged** (round-1 wrote `[]string`) | 🟡 → amended |
| B7 | UP-7 four templates (N1 from round 1) | yes | ✅ |
| B8 | UP-8 filter approach: source ②§3 = `!p.code.startsWith('pack_')` (product-coupled prefix); round-1 doc = price-key presence (framework-generic) | **open design divergence** | 🟡 → recorded in D4 with both options |
| B9 | credits-grant三件套: ②§3 puts port+service+route in **ploykit** (`ports_wsops.go` `CreditsGranter`, `service_wsops.go` `WithCreditsGranter/GrantCredits`, `routes_wsops.go` `POST /api/admin/workspaces/{id}/credits/grant`); 总纲 PR-6 puts it **product-side** (`internal/credits、admin bridge、main.go`) | **missing** + source-internal divergence | ❌ → new open decision **D5** (recorded, not resolved) |
| B10 | WorkspaceDetailPage credits card (framework UI, ②§3, mirrors quota card `:412-460`) — rides on B9 | missing | ❌ → folded into D5 |
| B11 | `BILLING_CURRENCY` env-ification of the CNY fallback (②§3, marked deferrable; example `main.go:428` hardcodes `Currency:"CNY"`) | missing | ❌ → added as deferred minor item |
| B12 | openapi/check_api duty for any new admin route (credits grant included) | implicit in UP-5 note | ✅ → made explicit for D5 |

## 3. Cross-document product-contract divergences (product-side; surfaced, not for ploykit to resolve)

The four shuijing docs disagree with each other on four product contracts — they will bite during
implementation and are called out here so the product owner reconciles them (majority position first):

| # | Contract | Positions |
|---|---|---|
| C1 | pack SKU codes | 总纲+② `pack_small/pack_medium/pack_large` vs ③ `pack_try/pack_starter/pack_pro` (③ is the outlier, likely an earlier draft) |
| C2 | balance endpoint | 总纲+② `GET /api/bracelet/credits` → `{ok, balance}` vs ③ `GET /api/credits/balance` → `{balance}` |
| C3 | 402 error code | 总纲 `CREDITS_REQUIRED` vs ② `CREDITS_EXHAUSTED` vs ③ `INSUFFICIENT_CREDITS` |
| C4 | credits per generation | 总纲+② `ShotCreditCost = 1` vs ③ footnote/§8.1 "10 credits per generation" |

## 4. Coverage report

- Requirement surface: 34 code-truth claim clusters (17 round-1 + A18-A34) + 12 framework-scope coverage
  items (B1-B12) + 4 product-contract divergences (C1-C4).
- Claims verified against code: **35/35 attempted, no ⚪** — 34 ✅ true, 1 ❌ stale (A33, QuickJS premise).
  Evidence strength: behavior code paths (medium) for all; several with tests/runnable probes from the
  ADR 0015 work (strong).
- Migration completeness before this round: 2 ✅ / 6 🟡 partial / 3 ❌ missing / 1 ✅ implicit.
  After amendments (§5): 9 ✅ closed, 2 remain deliberately open as user decisions (B8→D4, B9/B10→D5).
- Not audited (out of frozen scope): shuijing product-side implementation claims beyond what the framework
  work depends on (e.g. ③ route/i18n/CSS specifics, ② RLS DDL quality, pricing numbers).

## 5. Amendments made to `docs/plan-upstream-shuijing-admin-billing.md` this round

Completing the standing round-1 mandate ("migrate into a complete document"); direction-level items were
**recorded as decisions, not silently resolved**:

1. UP-1/UP-2/UP-4/UP-5/UP-6 specs completed from ①§2/§3/§6/§7/§4 (B1/B2/B4/B5/B6) — including the UP-4
   no-audit correction and the UP-6 `OAuthProviderInfo` shape.
2. D4 enriched with the source's prefix-filter option (B8).
3. New D5: credits-grant归属 (framework三件套 + WorkspaceDetailPage card vs product-side bridge) —
   source docs diverge; needs the maintainer (B9/B10/B12).
4. Deferred minor item added: BILLING_CURRENCY env-ification (B11).
5. §1 evidence table extended with the A18-A34 cluster, including the A33 staleness verdict.
6. §4 findings extended with the two verified framework properties product integrators rely on
   (replay window A25, refund→free A24).

## 6. Method notes

- Sources: shuijing `docs/design-commercialization-master-plan.md` + ①②③, all dated 2026-10-16,
  self-declared baseline shuijing main@df6b27c / ploykit v0.7.4 via go.mod replace.
- Ground truth: ploykit `de8e9cf` (== v0.7.4 tag, clean tree). Line numbers cited from this checkout.
- Per the skill's discipline, this audit round changed no code; the only artifact edits are the two
  documents named above. Direction-level divergences (D4, D5, and product-side C1-C4) await explicit
  rulings.
