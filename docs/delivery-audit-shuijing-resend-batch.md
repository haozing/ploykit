# Delivery audit — shuijing upstream batch 2026-10-25 (Resend email channel)

Pre-release completeness audit of the working tree against the issue report
`D:\code\shuijing\docs\ploykit-upstream-issues-2026-10-25.md` (five issues:
SMTP ctx correctness bug, settings key registry, Resend HTTP adapter, Svix
verification helper, AdminSettingsPage extension seams).

Method: every requirement item was itemized from the report (Phase 0, 21
items), traced to code with file:line evidence plus executable tests
(Phase 1), and graded on the four-state scale. Audit scope = the uncommitted
working tree on top of `a411bf4` (tag v0.14.0). All gates green at audit
time: framework `go build ./... && go vet ./... && go test ./...`; example
full suite against a real Postgres (`TEST_DATABASE_URL`, `-p 1`); ui vitest
883/883; root `npm ci && npm run build && npm test`; example prerender real
engine + precompress; `tools/check_api.py` (156/156, zero drift);
`tools/check_docs_language.py` clean; example web `tsc --noEmit` and vite
build.

## Traceability matrix

### Issue 1 — SMTP send ctx inherits the request lifecycle

| ID | Requirement | Verdict | Evidence | Gap |
|---|---|---|---|---|
| R1.1 | Send methods internally detach from caller cancellation/deadline with an independent fallback timeout (~30s) | ✅ | `notify/adapters/email/smtp/smtp.go:121` — `context.WithTimeout(context.WithoutCancel(ctx), s.sendTimeout)`; default `DefaultSendTimeout = 30s` (smtp.go:17); tests `TestSendDetachedFromCallerContext` (parent canceled mid-send, send survives until the connection actually breaks, error is NOT `context.Canceled`) and `TestSendOwnTimeoutCapsHangingRelay` (250ms cap bounds a silent relay) — smtp_test.go | — |
| R1.2 | ctx VALUES still propagate (request id, tenant values) | ✅ | `context.WithoutCancel` stdlib contract (drops cancellation/deadline, keeps values) + the call shape at smtp.go:121; behavioral proof of the detach half in R1.1's test | No direct assertion that a ctx value is observable inside the send path — the adapters read no ctx values themselves, so the stdlib contract is the complete statement |
| R1.3 | (Beyond the ask, added) Timeout configurable | ✅ | `Config.SendTimeout` (smtp.go:28-30), resolved at construction, AND mirrored into go-mail's own connection deadline via `gomail.WithTimeout(s.sendTimeout)` (smtp.go:63-69) — required because go-mail bounds the dial/greeting phases with its own timer (default 15s), not the ctx; `TestSendOwnTimeoutCapsHangingRelay` fails without it (verified: 15s elapsed before the option was added) | — |
| R1.4 | ctx contract documented on the send surface (doc option b) | ✅ | `Sender` doc comment (smtp.go:81-88) states the detach contract, the 30s cap, and how to bound a send instead; emaildev package doc states why detachment is irrelevant there (fixed during this audit round — was missing) | — |
| R1.5 | emaildev documented as unaffected (option c) | ✅ | `notify/adapters/email/emaildev/emaildev.go:1-6` package comment (no IO ⇒ no timeouts; ctx accepted for interface parity only) | — |

### Issue 2 — settings keys are a closed whitelist; no product-registered keys

| ID | Requirement | Verdict | Evidence | Gap |
|---|---|---|---|---|
| R2.1 | Product key registration mechanism: key → {validate, sensitive} | ✅ | `settings/registry.go:63` `Store.RegisterKeys(specs ...KeySpec)`; `KeySpec{Key, Description, Sensitive, Env, Default, Validate, Normalize}` (registry.go:34-60); atomic two-pass registration (a bad spec rejects the whole batch — unit test `TestRegisterKeys/批量中第一个非法即拒绝且不部分注册`); shape/collision/builtin/billing-prefix/env-name guards all unit-tested | — |
| R2.2 | Registered keys writable through the generic `PUT /api/admin/settings/{key}` | ✅ | `settings/adapters/http/http.go:140-148` delegates masked-echo/Validate/Normalize to store-level methods; unit tests `TestRegisteredKeysAdminSurface` (masked echo, custom Validate 400, unregistered key still 400); example DB integration `TestRegisteredKeysFullLoop/非法值被_spec_Validate拒绝` + valid writes | — |
| R2.3 | Sensitive registered keys seal at rest (`IsSensitive` extension) | ✅ | `settings/seal.go` sealValue → `s.IsSensitive`; `registry.go:123` store-level rule; DB test asserts the RAW `site_settings` row carries the `sealed:v1:` prefix and no plaintext (`TestRegisteredKeysFullLoop/合法写入`); fail-closed without sealer unit-tested (`TestStoreSensitivityAndSealing`) | — |
| R2.4 | Admin GET masks registered sensitive keys (maskMap) | ✅ | `http.go:123` `d.maskMap` uses `d.Store.IsSensitive`; DB test asserts both `items` and `effective` come back as `******` while the non-sensitive `resend_from` round-trips plaintext (`TestRegisteredKeysFullLoop/普通注册键明文落库_+_列表合并`) | — |
| R2.5 | Public `/config` never leaks registered sensitive keys | ✅ | `example/cmd/app/main.go:1055` filter switched to `siteSettings.IsSensitive(k)` (store-level, registry-aware); registered `resend_api_key` is Sensitive in the example registration (main.go:313-330) | — |
| R2.6 | Bootstrap seedable/envOf opened for custom keys (suggestion c) | 🟡 | `KeySpec.Env` live fallback implemented: DB row > env > Default, re-evaluated every read (`registry.go:192` `effectiveSpecValue`; unit tests `TestEffectiveSpecValue`); example registers `RESEND_API_KEY`/`RESEND_FROM` | Deliberate deviation: registered keys are NEVER bootstrap-seeded (one-shot env→DB freezing) — that would re-create the D2 "env silently stopped working" trap the existing decision record rejects (keys.go seeding-semantics block). The live fallback is strictly stronger for the reported use case (env works on every boot until an admin saves) |
| R2.7 | Registered keys appear in `Effective`/admin list envelope | ✅ | `settings/keys.go:250` Effective iterates KeyOrder + registration order; descriptions/defaults merged (`registry.go:161` Descriptions, DefaultsMap; `http.go:108-109`); DB test asserts envelope contents | — |

### Issue 3 — Resend HTTP email adapter upstreamed

| ID | Requirement | Verdict | Evidence | Gap |
|---|---|---|---|---|
| R3.1 | `notify/adapters/email/resend` package, `NewWithTemplates(Config{APIKey, From}, Templates, log)`, same interface/shape as smtp | ✅ | `notify/adapters/email/resend/resend.go` — `New`/`NewWithTemplates` (resend.go:98-117), all five Send methods; interface compliance pinned (`var _ app.EmailSender`, `var _ identityEmailSenderShape`, resend_test.go:22-27); request shape asserted against a fake API (`TestSendRequestShape`: POST /emails, Bearer, JSON from/to/subject/text) | — |
| R3.2 | Settings keys `resend_api_key` (sensitive) / `resend_from` (suggestion b) | ✅ | Registered in example wiring through the Issue-2 seam: `example/cmd/app/main.go:313` (sensitive + `re_` prefix validation / mail.ParseAddress); admin UI renders them as the generic registered-key card — zero product endpoints, which was the point of the report's ~200-line bypass | Deviation (documented): keys registered product-side via `RegisterKeys` instead of hardcoded into the framework `KeyOrder` — the framework ships no product-specific keys; the report itself framed the keys as "配合 Issue 2" |
| R3.3 | `MailModeResend = "resend"` constant | ✅ | `settings/adapters/http/http.go:19-27` | — |
| R3.4 | Channel priority stays product-orchestrated; framework forces no order | ✅ | Framework ships only the adapter + constant; example composes resend → smtp → dev in `assembleMailer` (main.go:205-247, call at main.go:431) | — |
| R3.5 | Single source of copy across channels (product re-implementing framework templates was the pain) | ✅ | `notify/adapters/email/mailtpl` shared package (`Compile`/`Render`, mailtpl.go:96/129); smtp re-exports as type aliases — `notifysmtp.Templates` IS `mailtpl.Templates` (smtp/templates.go:13-21), zero source break (existing smtp template tests unchanged and green); resend compiles the same value — `TestSendRequestShape` asserts the built-in Chinese default copy byte-parity with smtp's zero-value behavior | — |
| R3.6 | Send ctx detachment from day one | ✅ | resend.go:138 same `WithoutCancel + own timeout` pattern; `TestSendDetachedFromCallerContext` (already-canceled parent still delivers) and `TestSendOwnTimeoutCapsHangingAPI` (150ms cap) | — |
| R3.7 | Structured error semantics (distinguish "key invalid" from "recipient refused") | ✅ | `APIError{Status, Name, Message}` (resend.go:59-68) with `errors.As`-able typing; `TestAPIErrorMapping` asserts name/status/message extraction and the non-JSON degradation path (`http_error`) | — |
| R3.8 | (Means deviation) resend-go SDK | — | NOT taken: implemented with net/http directly; ruling recorded in the package comment (resend.go:1-16) — one endpoint/one JSON shape does not justify a dependency (same ruling as the report's own Issue-4 rationale), and it sidesteps resend-go v2's missing Receiving API | Deliberate deviation from the report's suggested means; capability requirement fully met |

### Issue 4 — webx Svix verification helper

| ID | Requirement | Verdict | Evidence | Gap |
|---|---|---|---|---|
| R4.1 | `webx.SvixVerify(secret, id, timestamp, signature, body) bool` implementing the Svix scheme | ✅ | `platform/webx/svix.go:38`; signed content `id.ts.body` HMAC-SHA256→base64; `whsec_` prefix strip + base64 key decode (svix.go:110); space-separated `v1,<sig>` candidates, any constant-time match (`subtle.ConstantTimeCompare`, svix.go:92-99); `TestSvixVerify` covers valid/tampered/wrong-id/multi-candidate/unknown-version/missing pieces | — |
| R4.2 | `webx.SvixHeaders(r)` triple extraction | ✅ | svix.go:31; `TestSvixHeaders` (present + absent) | — |
| R4.3 | No new dependency | ✅ | `git diff go.mod go.sum` empty at audit time; stdlib only (crypto/hmac, crypto/subtle, encoding/base64) | — |
| R4.4 | Replay tolerance ±5min with the report's boundaries (±4min pass / ±400s reject) unit-covered | ✅ | `SvixTolerance = 5 * time.Minute` (svix.go:27); subtests `timestamp_within_tolerance_passes_(4_min_skew)` and `stale_timestamp_rejected_(6m40s_skew)` (=400s) + future-skew rejection | — |

### Issue 5 — AdminSettingsPage extension seams

| ID | Requirement | Verdict | Evidence | Gap |
|---|---|---|---|---|
| R5.1 | Minimal seam: `children` rendered after the card list (option a) | ✅ | `packages/ui/src/pages/admin/AdminSettingsPage.tsx:175` signature, `:999` `{children}` after the last framework card; vitest: children render last, generic card absent without registered keys; example consumption `example/web/src/routes-admin.tsx:84-91` (NavVisibilityCard) | — |
| R5.2 | Registered keys render as a framework-standard form card from key metadata (option c) | ✅ | AdminSettingsPage.tsx:943 generic card: fields driven by `effective` + `descriptions`, sensitive keys (masked read-back) get password input + "留空 = 不修改" semantics identical to smtp_pass; skip-list `BUILTIN_SETTING_KEYS` (:86) with snapshot test pinning it to the backend KeyOrder; vitest covers hydrate/save/mask flows | — |
| R5.3 | Card-registry context, products inject `{title, node}[]` (option b, "more complete form") | ❌ | Not implemented — deliberate: both reported consumers (NavDisplayPage, ResendMailCard) are fully served by a+c (children for bespoke cards, metadata-driven generic card for registered keys); b would add API surface with no remaining reported consumer | Deliberate deferral; revisit if a consumer needs framework-styled cards for NON-settings data |

## Coverage report

- Itemization: 21 items from the 5-issue report; 21 traced (100%); 0 not reached.
- Verdict distribution: 18 ✅, 1 🟡 (R2.6 — satisfied by a stronger, decision-record-backed alternative), 1 ❌ deliberate deferral (R5.3), 1 means-deviation entry (R3.8, capability fully met). 0 ⚪.
- Evidence strength: every ✅ carries at least one executable test (unit hermetic or real-DB integration) plus behavior-path line evidence; the only non-test-backed claim is R1.2's value-propagation half, which is a stdlib contract with no adapter-side counter-behavior possible.
- Fixed during this audit round: R1.5 emaildev package doc comment (was the one genuine gap found; one comment, no code path change; framework tests re-run green after).

## Deliberate deviations from the report's suggested means

1. **No resend-go SDK** (R3.8) — net/http direct; the dependency-vs-lines ruling mirrors the report's own Issue-4 argument, and avoids the v2 SDK's missing Receiving API.
2. **Keys registered, not whitelisted** (R3.2) — `resend_*` live in example via `RegisterKeys`, keeping the framework free of product-specific keys; the report's suggestion (b) anticipated this via "配合 Issue 2".
3. **Live env fallback instead of bootstrap seeding** (R2.6) — consistent with the D2 seeding fork already recorded in `settings/keys.go`.
4. **Option a+c instead of b for the settings page** (R5.3) — covers both reported bypasses with less API surface.

## Top gaps, ordered

1. R5.3 (❌, deliberate deferral) — no affected consumer today.
2. R2.6 (🟡, deviation) — the letter of "open bootstrap seeding" is intentionally not implemented; the live fallback supersedes it for every use case the report describes.
