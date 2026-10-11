# ADR 0013 · Strong-profile restart: authorization/ gets its first consumer (example reference wiring), MFA freshness, in-tx facts, transport exclusivity

Status: accepted (2026-10-11); executed batch-by-batch in the same change series — supersedes ADR 0005's **shelve** (0005 remains as the record of the deferral and its acceptance criteria, marked superseded-by this ADR). Driver: the runlynk rebuild (cross-repo plan: `docs/runlynk-rebase.md`); framework-side plan: `docs/plan-strong-profile-restart.md`.

## Background

ADR 0005 shelved `authorization/` (the strong profile) as booked debt with two live restart triggers — #1 (step-up with challenge as a first-class decision, narrowed by ADR 0011 to the *computed* form) and #2 (closed-set operation catalog) — and a non-reversible order clause: **example reference wiring first, product integration second**. The runlynk rebuild fires both live triggers at once:

- runlynk needs **computed step-up** (trigger #1): escalation driven by a per-operation catalog, not a static route-level middleware — the exact form ADR 0011 reserved for `authorization.Challenge`;
- runlynk needs a **closed-set, reconcilable operation catalog** (trigger #2): every protectable operation declared once, fail-closed on unknown operation IDs.

Trigger #3 (hashable catalog ↔ contract reconciliation) was retired by ADR 0012 (contractx deleted; write-boundary validation won). `Catalog.Hash()` survives inside the package but has no reconciliation consumer.

## Scope decisions (2026-10 market survey)

| Item | Verdict | One-line basis |
|---|---|---|
| Reference wiring (restart) | **in, first** | ADR 0005 mandates example-first order, not reversible |
| G3 · in-tx FactsProvider reference impl | **in** | Correctness baseline; Supabase-RLS-shaped route; costs one provider |
| G4 · per-operation transport exclusivity | **in** | GitLab #22435 (systemic CSRF from mixed auth) is the cautionary tale; ploykit runs cookie+PAT dual-track |
| G1 · MFA/AAL2 freshness | **in** | Five-vendor isomorphism (GitHub sudo/2FA-on-sensitive-actions, Clerk reverification, Auth0 acr+max_age, WorkOS auth_time, Keycloak ACR); runlynk is the consumer ADR 0011 waited for |
| G2 · project membership storage | **out** (product side) | Single consumer — framework guessing the shape now would be overfitting |
| G5 · catalog→OpenAPI gate chain | **out** (product side) | Generation is mainstream but equality gates are a niche; ADR 0012 verdict stands |

G2 lands in the runlynk repo (PostHog is the open-source reference for membership storage); G5 lands as runlynk product scripts. Neither is a framework commitment, and neither blocks this restart.

## Hard boundaries

- **arch A6**: `authorization/` imports nothing — bridges (route resolver, transport mapping, challenge projection) live in composition roots. webx likewise never imports `authorization/` (A6 cuts both ways: batch 3's transport matcher speaks neutral kinds).
- **Two-profile story**: `authz/` (simple) and `authorization/` (strong) stay mutually independent; one product, one operation at a time.
- **ADR 0011 composition order**: permission check outermost/terminal, step-up challenge inner/recoverable — a role-denied principal gets the terminal denial, never a challenge.
- **Wiring discipline**: every batch lands with example wiring and green tests in the same change.

## Batch sequence

- **Batch 0 — decisions** (this ADR; ADR 0005 addendum; ROADMAP entry).
- **Batch 1 — example reference wiring + in-tx facts**: product catalog YAML (`workspace.delete`, `workspace.transfer_ownership`), method+path resolver (composition root), in-tx FactsProvider reference impl (reads through the caller's `pgx.Tx`), strong middleware with ADR-0011-order decision projection (terminal denial wins over challenge), recent-auth window moved from the package constant into a per-operation catalog field (explicit, no silent default — closes ADR 0011's flagged overreach), the two named ops rewire off `workspace.Deps.StepUp` (which stays for simple-profile consumers and the roles routes).
- **Batch 2 — G1 MFA/AAL2 freshness**: TOTP + backup codes only (WebAuthn deferred until a consumer asks — not even a ROADMAP entry); `user_mfa` migration, identity TOTP service (secrets via sealx), enroll/enable/disable/regenerate flows, `POST /auth/verify-mfa` step-up stamping on the shared attempt-limiter family, `webx.RequireRecentMFA` symmetric to `RequireRecentAuth`, born-confirmed semantics extended (a login completing MFA stamps both facts); example reference op: PAT creation requires `password_and_mfa`.
- **Batch 3 — G4 per-operation transport exclusivity**: webx transport classifier (single source of truth for session/PAT resolution), `RequireTransportKind` matcher on neutral kinds, CSRF conditional rule promoted next to the classifier, distinct 401 code for mixed-transport attempts (cookie + Authorization both present).
- **Batch 4 — closeout**: ADR 0005 acceptance re-verified item by item, `agent-native.md` gap entry closed, `authorization/README.md` rewritten around the two-profile wiring guide and the (extended) double-mount prohibition.

## Consequences

- Positive: the strong profile gains its mandated first consumer and the shelving ends the only way ADR 0005 allowed — by wiring, example-first; step-up becomes catalog-computable; the mixed-transport hole (GitLab #22435 class) closes before runlynk multiplies the surface; ADR 0011's flagged `RecentAuthWindow` overreach is corrected in the same restart.
- Negative: example grows heavier (accepted — it is the reference consumer; additions capped at the named ops + one AAL2 op); step-up semantics now span webx machinery and authorization computation, mitigated by the README decision matrix, the double-mount prohibition (extended to MFA), and composition-order tests.
- Non-goals (recorded so nobody re-litigates mid-flight): G2/G5 (runlynk side), WebAuthn/passkeys (deferred until a real consumer), role inheritance / ReBAC / policy engines / three-layer nesting (permanent non-goals), any runlynk-side work (separate repo, separate plan).
