# Audit: plan-legal-compliance-framework-2026-10-25.md — round 1

> 2026-10-25, claim verification + DX review before execution. Same method as
> audit-billing-channel-framework-plan-2026-10-23.md: every verifiable claim
> checked against ploykit @ 4988a39 (v0.15.0) and the shuijing working tree
> (uncommitted legal rewrite), four-state verdicts (true / partially true /
> false / external), findings numbered L1.. and written back into the plan.
> Review lens per the framework owner's brief: **cleanest code design, most
> convenient configuration, smoothest adoption for framework consumers**.
>
> **2026-10-26 erratum (L1, second correction)**: `stripe.Channel` HAS
> implemented SubscriptionCanceller since v0.15.0 (adapters/stripe/channel.go
> CancelSubscription). The "stripe is the channel missing it" statements below
> stand as the round-1 reading, but the fact of record is that all three
> built-in channels implement it; stripe's Caps declaration was corrected to
> match its implementation (CancelTiming=immediate — DELETE
> /v1/subscriptions/{id} is Stripe's cancel-now call; the period-end variant
> lives on the subscription UPDATE path, which the adapter never sends).

## 1. Verdict matrix

### §1 Friction table F1–F10 (source: shuijing working tree + both repos)

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| F1 | 8 hand-filled placeholders (6 legal-entity name + 2 jurisdiction) | true | shuijing web/src/lib/i18n/messages/{en,zh}.ts working tree: `[Your full legal name]` (en) and its zh counterpart ×6, `[governing jurisdiction]` (en) and its zh counterpart ×2 |
| F2 | three promise/reality gaps (cancel path / log rotation / no export) | true | no user-facing cancel route in shuijing (channel portal only, TOS §6 wording); log rotation is ops-level (external to repo); identity exposes DeleteAccount only (identity/app/service_account.go:54) — no export anywhere |
| F3 | legal copy hardcoded in product i18n, 4 files hand-synced | true | en.ts/zh.ts terms+privacy blocks; structure parity enforced only by the `Messages` type |
| F4 | refund policy has two sources (TOS text vs Pancake shop settings) | external | Waffo dashboard side, not code-verifiable |
| F5 | change-notice email duty has zero implementation | true | notify templates are verification/receipt only; no bulk-notice job exists |
| F6 | SignInForm renders the legal line but records nothing | true | packages/ui/src/auth/SignInForm.tsx:67-111 (auto line from termsUrl+privacyUrl); no acceptance table in any migration (000–051) |
| F7 | "Waffo Pancake" hardcoded in both documents | true | ×5 in terms + ×5 in privacy across en/zh in the rewritten copy |
| F8 | template demands billing-model 3-way choice + placeholder checklist | external | docs.waffo.ai/zh/mor/account-reviews/tos |
| F9 | "waffo adapter does not implement SubscriptionCanceller (billing-plan F13 leftover)" + "no end-user self-cancel endpoint" | **partially true — premise inverted** | The endpoint half is true (AdminCancelSubscription is admin-only: billing/app/service_billingcfg.go:68/:151, mounted under admin routes). The canceller half is **stale**: waffo implements it (billing/adapters/waffo/channel.go:176, interface assertion :625, landed as BC-9/F13) and so does paypal (adapters/paypal/channel.go:176/:786); **stripe is the channel missing it** *(2026-10-26 erratum: stripe implements it too — see header)*. → L1 |
| F10 | analytics no-PII is an code-comment rule with no framework guard | true | analytics/event.go package doc: "no IP, no user-agent, no email" |

Additional fact found during verification (plan §4 said it, worth pinning):
AdminCancelSubscription semantics = **immediate downgrade** — channel cancel →
`ChangeWorkspacePlan(ws,"free",…)` → `SetWorkspaceSubscription("")` → OnPlanChanged(free)
(service_billingcfg.go:105-121). Exposing this to end users as-is contradicts the
"access continues until the end of the paid period" promise both the Waffo template and
the rewritten TOS §6 make. → L2

### §4 Current-state inventory

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| S1 | settings v0.15 KeySpec registry with auto-rendered admin card | true | settings/registry.go:20 (KeySpec{Key,Description,Sensitive,Env,Default,Validate,Normalize}); packages/ui/src/pages/admin/AdminSettingsPage.tsx:208-211 renders non-builtin effective keys as the product card |
| S2 | audit.Recorder Record/RecordTx | true | audit/audit.go (RecordTx shares caller tx; Record fire-and-forget) |
| S3 | identity DeleteAccount = soft-delete + audit row | true | identity/app/service_account.go:54-67 (SoftDeleteUserTx in tx; records `account.deleted`) |
| S4 | schedule + platform/cronx exist; order-expiry sweeper precedent | true | schedule/fireworker.go; migrations 049_order_expires_at |
| S5 | mailtpl single source across channels | true | v0.15 notify refactor (notifysmtp.Templates = mailtpl.Templates alias) |
| S6 | migrations next free number 052 | true | 049-051 latest |
| S7 | (implicit) acceptance writes need "wiring points" the plan must invent | **false — better than stated** | identity/hooks.go already has exactly the right seams: AfterRegister fires on EVERY registration path incl. OAuth/code JIT, is idempotent and re-fired on next login (hooks.go:21-31); AfterLogin fires on every successful login, observational (hooks.go:36-39). LC-3's three write points reduce to two existing hooks — zero identity changes. → L3 |
| S8 | (implicit) IP/UA for acceptance rows requires plumbing decisions | partially true | webx already carries ClientMetadata (platform/version/OS) in ctx (platform/webx/client.go:11-31) and computes ClientIP per request (webx/ratelimit.go:36, used by AccessLog middleware.go:86); the ctx carries metadata but NOT the IP → a WithClientIP/ClientIPFrom pair following the client.go pattern is the minimal clean addition; raw UA string unnecessary (platform/version/OS is better evidence). → L3 |

## 2. Findings (written back into the plan)

### Fact fixes

- **L1 (F9 premise inverted)** — canceller coverage today: waffo ✅ (channel.go:176),
  paypal ✅ (channel.go:176), stripe ❌ *(2026-10-26 erratum: stripe ✅ too —
  see header; Caps corrected to CancelTiming=immediate)*, DisabledChannel ✅ stub. LC-4's premise must
  change from "waffo lacks the canceller" to "stripe lacks it; the universal gap is the
  missing END-USER route and the admin service's immediate-downgrade semantics".

### Design corrections

- **L2 (LC-4 semantics)** — two flaws in the original LC-4:
  1. The original "in-product fallback stops the next charge" is impossible under MoR
     auto-renewal: without a channel-side API the framework cannot stop the next
     charge, only react to its webhook. The fallback must be honest:
     `cancel_requested` + operator queue + admin visibility, never a claimed
     self-serve stop.
  2. Re-exposing AdminCancelSubscription gives immediate plan downgrade — contradicting
     the period-end promise. Corrected shape: user cancel = channel-through cancel via
     SubscriptionCanceller; **timing is channel knowledge and belongs in ChannelCaps**
     (already the single source, waffo channel.go:55) — add
     `CancelTiming: immediate | period_end`; local plan flip follows the cap
     (immediate → flip now; period_end → cancel_requested + renewal-no-show sweeper,
     the same pattern as the order-expiry sweeper). Channels without a canceller
     (stripe today *(2026-10-26 erratum: stripe has one — this branch is for
     third-party channels only)*) return the existing CodeChannelCancelUnsupported error and land in
     the operator queue surfaced on the LC-9 card.

### DX simplifications (the owner's brief: cleanest code, smoothest config)

- **L3 (LC-3 wiring)** — acceptance recording rides IdentityHooks (AfterRegister =
  signup acceptance on every path incl. JIT, idempotent by contract; AfterLogin =
  login_implicit when the current version isn't yet recorded). IP via a new
  `webx.WithClientIP/ClientIPFrom` ctx carrier (client.go pattern); UA via existing
  ClientMetadata. Zero identity signature churn; product sees one wiring line.
- **L4 (LC-2 registry)** — drop the `legal_documents` DB table, the admin PUT route
  and "admins author versions" entirely: **document versions ship with product code**
  (the text already lives in product i18n files; a DB copy would be a second truth).
  Registry = code: `legal.RegisterDocs(Doc{Key, Version, EffectiveFrom, BillingModel,
  MaterialChange, Placeholders})`. The material-change email becomes an **armed admin
  button** (prefilled template, explicit send) — never an auto-blast on save.
- **L5 (LC-1 keys)** — the module constructor registers the whole `legal_*` key group
  itself (framework owns the KeySpecs; product never copies specs by hand):
  `legal.Wire(legal.Config{…})` = settings keys + identity hooks + sweepers in one
  line. Precedent: provisioning.PersonalWorkspace one-liner
  (example/cmd/app/main.go:487-498, ADR 0016). Product integration totals:
  1×Wire + 1×RegisterDocs (+optional RegisterSubprocessor / DataContributor).
- **L6 (public surface)** — no new `GET /api/legal/documents`: the resolved
  placeholder values and doc versions ride the **existing public /config payload**
  (settings/adapters/http is already that surface; every product frontend already
  consumes /config, and prerender loaders already warm it). Add a `legal` block:
  `{entity_name, jurisdiction, processor_name, docs:[{key,version,effective_from}]}`.
  Zero new consumer fetch surface.
- **L7 (LC-8 auto-derive)** — the sub-processor list is not a JSON textarea: the
  framework **derives its own entries from live configuration** (mail mode →
  Resend/SMTP; OrderedChannels → "Waffo Pancake"/"Stripe"/"PayPal"; hosting noted in
  docs), and the product registers only product-side providers (Google OAuth,
  hiapi/OpenAI) via `RegisterSubprocessor(name, purpose, url)`. Single source of truth
  = the channel registry the site actually runs; the list can never drift from it.

### Scope cuts

- **L8 (LC-6 + banner)** — RetentionSweeper.Register (generic table/TTL registry) is
  YAGNI: ship **concrete sweepers for framework-owned tables** (purged users,
  acceptances after purge, analytics events) with `retention_*` settings keys, and a
  documented SQL pattern for product tables — not a registry API. TermsReacceptBanner
  UI demoted to P2 (the re-accept endpoint stays P0 — it is a five-line handler; the
  banner is UI surface a young site rarely needs).

## 3. Residual risks / open questions

1. waffo cancel-subscription REST timing semantics (immediate vs period-end) —
   external; must be verified live when LC-4 lands, then encoded in waffo's Caps().
2. Acceptance-row IP retention follows account lifecycle (purge together) — kept from
   plan §12.4.
3. Effective-date defaults (14d TOS / 15d privacy) stay hardcoded until a real need.
4. Bulk notice email for very small account bases is fine; if a site grows past ~10k
   accounts the armed-button send needs chunking — note in implementation, not design.

## 4. Verdict

Plan is executable after in-place correction: 2 fact fixes (L1, S7-S8 upgrade), 2
design corrections (L2), 3 DX simplifications (L4-L6), 1 derivation upgrade (L7),
1 scope cut (L8). No finding invalidates the module boundary (§0) or the phase
structure; the corrected integration surface is: **one Wire line + one RegisterDocs
call per product**, everything else optional.
