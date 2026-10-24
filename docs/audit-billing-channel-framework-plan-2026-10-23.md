# Audit: plan-billing-channel-framework-2026-10-23.md — round 1

> 2026-10-23, claim verification before finalizing the design doc. Same
> method as delivery-audit-shuijing-upstream-migration.md: every verifiable
> claim in the document was checked against both repos' code (ploykit @
> a988a30, shuijing @ 93b3fd9), with a four-state verdict: true / partially
> true / false / external (channel documentation, not code-verifiable).
> Findings were numbered N1.. and written back into the design doc.

## 1. Verdict matrix

### Document header and §0

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| A1 | "commit 31aa35d channel integration + later price-change batch" | partially true | Actually three commits: 31aa35d (channel), 1cdfed3 (price change 9.90/69), 93b3fd9 (webhook public key livekey reconciliation). The doc missed the third → N1 fixed |
| A2 | "three files + hermetic tests" | partially true | 3 source files (waffo.go 259 / client.go 122 / channel.go 327 = **708 lines**) + 2 test files (channel_test.go 464 hermetic + livekey_xcheck_test.go 36 gated) → N2 made precise |
| A3 | "every site repeats these 900 lines of internal/billingwaffo" | false (number) | Same as A2: 708 source lines. The qualitative conclusion stands → N2 |
| A4 | "real-API three-point verification: signature / product creation / create-session" | true | Session log: create-product x2, update-product x2 (price change), create-session x2 (one each for 19.00 and 9.90), all 2xx; cashier URL curl 200 |

### §1 Friction points F1–F20

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| F1 | waffo adapter silently swallows cancelURL | true | shuijing internal/billingwaffo/channel.go `CreateCheckout(ctx, order, successURL, _ string)`; comment says "waffo has no cancel URL" |
| F2 | domain.Order has no buyer email | true | ploykit billing/domain/model.go:35-54 (full field list: no email) |
| F3 | Stripe product names are currently planCode+interval concatenations | true | billing/adapters/stripe/channel.go:57 |
| F4 | product registration / price changes rely on one-off scripts | true | shuijing waffo-assets/create-products.mjs (create/update/publish/session subcommands) |
| F5 | cents↔display-string conversion is a private implementation | true | channel.go formatAmount/parseAmount (private); JPY zero-decimal branch present in tests |
| F6 | the taxIncluded convention lives only in adapter comments | true | channel.go priceSnapshot struct comment + waffo.go package comment "under MoR the tax comes out of the $19" |
| F7 | the idempotency key has no event-type dimension | partially true (stronger than claimed) | pgrepo/repo.go:203-216: `ON CONFLICT (channel, channel_event_id)` — a **composite of two columns**, not "a single column"; and a conflicting row with process_status='error' is revived via DO UPDATE for reprocessing (BQ1 semantics). The substance of F7 holds (no type column → it must be folded into the id string), but the "single column" wording was wrong → N3 fixed, and the revival semantics were added to §2 (good news for BC-4: sweeper/retry has a foundation) |
| F8/F9 | renewal dual events trust only money / first-period dual delivery dedup | true | channel.go ParseWebhook switch: `subscription.payment_succeeded` maps to renewed only when periodNumber>1; periodNumber=1 → "ignored" |
| F10 | orderId serves as the stable subscription ref + metadata echo | true | channel.go: `ev.SubscriptionRef = env.Data.OrderID`; metadata.order_id → orderMetadata read + orderMerchantExternalId as a second safety net |
| F11 | verification public keys are one per test/prod | external | docs.waffo.ai/api-reference/webhooks.md (platform-level, per environment, adding a URL does not rotate the key) |
| F12 | ConnectionTester not implemented; "later confirmed list-webhooks works" | partially true | The adapter indeed does not implement it (no TestConnection in channel.go); "confirmed" was too strong — llms.txt shows a "Webhooks: overview" endpoint exists, but it was never exercised → downgraded to "candidate probe, verify in BC-9" (N4) |
| F13 | SubscriptionCanceller not implemented | true | no CancelSubscription in channel.go; waffo REST has cancel-subscription (docs subscriptions/cancel-subscription.md) |
| F14 | FromEnvStrict discipline copied from the product repo | true | billingwaffo/waffo.go FromEnvStrict vs bracelet/provider.go:384 isomorphic |
| F15 | waffo abandoned checkouts get zero callbacks | external | create-checkout-session.md: "No cancelUrl — abandoned sessions just expire (order ends canceled, no webhook)". No local counter-evidence exists (channel behavior cannot be falsified from here); the sweeper design assumes this |
| F16 | knownChannelNames hardcodes stripe | true | billing/app/service_billingcfg.go:12 `var knownChannelNames = []string{"stripe"}` |
| F17 | admin is read-only with no editing surface; test-connection / cancel-subscription routes already exist | true | admin/adapters/http/routes_billingops.go:41 test-connection, :42 cancel-subscription, :189 BillingConfig; no channel config page in packages/ui/src/pages/admin/ |
| F18 | frontend hardcodes channel priority | true | shuijing web/src/pages/Pricing.tsx `channels.includes('waffo') ? 'waffo' : 'stripe'` |
| F19 | cashier language hardcoded to "en" | true | channel.go createSessionReq `Language: "en"` |
| F20 | product images are manual back-office work | true | waffo-assets/seller-plan-1200x630.jpg hand-cropped and uploaded |

### §2 Current-state inventory

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| S1 | the kernel (state machine / reconciliation / hooks) needed zero changes for the waffo integration | true | the 31aa35d diff does not touch ploykit (the ploykit worktree was clean before this document); billing/app/service.go handlePaid/handleRenewed etc. untouched |
| S2 | the four optional interfaces exist | true | ports_billingcfg.go:17/21/34 + service.go:679 CheckoutCanceller |
| S3 | webhook raw body is read directly | true | billing/adapters/http/routes.go:126 `io.ReadAll(io.LimitReader(r.Body, 1<<20))` |
| S4 | event idempotency is "single-column unique" | false (wording) | same as F7 → N3: composite key + error-state revival, rewritten |
| S5 | settings sealing foundation (no DDL / IsSensitive single key / MaskedValue / card page) | true | settings/store.go:15-16 fail-closed sealer, keys.go:95 `IsSensitive = KeySMTPPass`, AdminSettingsPage.tsx |
| S6 | orders table has no expiry column, only channel_ref | true | pgrepo/repo.go:32-33 orderCols full column list (no expires_at); repo.go:108 SetOrderChannelRef writes only the ref |
| S7 | plans already have PATCH | true | routes_billingops.go:29 `PATCH /api/admin/plans/{code}` |

### Versions and phasing

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| V1 | P0/P1/P2 = v0.13.0/v0.14.0/v0.15.0 (assuming the next minor is 0.13.0) | true | CHANGELOG.md: [0.12.0] 2026-10-21 released + [Unreleased] on top → the next minor is 0.13.0 (the draft once derived values assuming 0.12.0 was unreleased; after the sed correction this matches 0.13.0, so the conclusion needs no further change) |

## 2. Findings and dispositions (written back into the design doc)

- **N1** The document header's commit list was completed to three (31aa35d/1cdfed3/93b3fd9).
- **N2** "900 lines / three files + hermetic tests" → "3 source files, 708 lines + 2 test files (hermetic 464 lines + live-gated 36 lines)".
- **N3** Idempotency-key wording: every "single-column ChannelEventID" became "(channel, channel_event_id) composite idempotency key, no event-type dimension; a conflicting row in error state is revived for reprocessing". §2 got the revival semantics added.
- **N4** F12 "later confirmed list-webhooks works" was downgraded to "candidate probe = webhooks overview endpoint (to be exercised when BC-9 lands)".
- **N5** (consistency clarification) BC-1 says "replace keeps serving the other packages" while §6 says "drop replace when tagging" — not contradictory but easy to misread: BC-1 develops the migration under replace, §6 describes the release wrap-up. BC-1 gained one sentence: "upstream development runs under replace; release per §6".

## 3. Audit conclusion

Of the 20 friction points (F1–F20): **18 true / 1 partially true (F7, substance holds, wording wrong) / 1 external (F15)**; of the 7 current-state claims, 1 was worded falsely (S4, same as F7); 2 numeric errors (A2/A3 line counts). **No design-shaking findings** — the only substantive correction (composite idempotency key + error-state revival) actually strengthens the BC-4 sweeper/retry foundation argument. N1–N5 were all written back into the design doc, and its status moved from draft to audited. The document is ready for execution.
