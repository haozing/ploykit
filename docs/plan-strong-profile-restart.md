# Implementation Plan: Strong-Profile Restart (authorization/ wiring + MFA freshness + in-tx facts + transport exclusivity)

> Status: accepted & executed (2026-10-11, batches 0-4; decision record ADR 0013). Driver: the runlynk rebuild (see `docs/runlynk-rebase.md` for the cross-repo plan)
> fires both live restart triggers of ADR 0005 at once — #1 (computed challenge) and #2 (closed-set catalog);
> trigger #3 was retired by ADR 0012. This plan covers the **framework side only**. Project-membership storage
> (G2) and catalog→OpenAPI tooling (G5) are product-side work in the runlynk repo and explicitly out of scope.

## 0. Scope decisions (from the 2026-10 market survey)

| Item | Verdict | One-line basis |
|---|---|---|
| Reference wiring (restart) | **in, first** | ADR 0005 mandates example-first order, not reversible |
| G3 · in-tx FactsProvider reference impl | **in** (batch 1) | Correctness baseline; Supabase-RLS-shaped route; costs one provider |
| G4 · per-operation transport exclusivity | **in** (batch 3) | GitLab #22435 (systemic CSRF from mixed auth) is the cautionary tale; ploykit runs cookie+PAT dual-track |
| G1 · MFA/AAL2 freshness | **in** (batch 2) | Five-vendor isomorphism (GitHub sudo/2FA-on-sensitive-actions, Clerk reverification, Auth0 acr+max_age, WorkOS auth_time, Keycloak ACR); runlynk is the consumer ADR 0011 waited for |
| G2 · project membership storage | **out** (product side) | Single consumer — framework guessing the shape now would be overfitting |
| G5 · catalog→OpenAPI gate chain | **out** (product side) | Generation is mainstream (Stripe/AWS Smithy) but equality gates are a niche; ADR 0012 verdict stands |

Hard boundaries that this plan must not cross: arch A6 (`authorization/` imports nothing — bridges live in
composition roots), the two-profile story (`authz/` simple and `authorization/` strong stay mutually independent),
ADR 0011's composition-order contract (permission check outermost/terminal, step-up challenge inner/recoverable),
and the wiring discipline (every batch lands with example wiring and green tests in the same change).

## 1. Current inventory (verified against code)

Already in place — do not rebuild:

- `authorization/decision.go`: `OutcomeDeny/Allow/Challenge`, staged reason codes, `Challenge{TargetOperationID, RequiredAssurance, MaxAge}`, `DenialError` with `ReauthHint`, `ErrReauthenticationRequired`.
- `authorization/facts.go`: `Facts` already carries `Assurance`, `RecentPasswordAt`, `RecentMFAAt`, `Product map[string]any`; `FactsProvider` is `ctx`-in — a `pgx.Tx`-backed provider is implementable today.
- `authorization/rules.go`: builtin `assurance` and `recent-auth` rules **already evaluate `RecentAuthPasswordAndMFA` against `Facts.RecentMFAAt`** — the rule-engine side of G1 is done; nothing stamps the fact yet.
- `authorization/scope.go`: workspace/project scope kinds (workspace_path / project_path / project_governance / project_credential).
- `webx` step-up machinery (ADR 0011): `Principal.PasswordConfirmedAt`, `RequireRecentAuth(maxAge)` → 403 `E_REAUTH_REQUIRED` + `details.max_age_seconds`, machine principals get plain 403.
- `identity`: sessions/PAT (PAT scopes via `webx.CredentialScope`), service accounts, OAuth federation. **Zero MFA** — no TOTP/WebAuthn anywhere in `identity/` or migrations (verified by grep).
- example reference point: `example/cmd/app/main.go:474-479` — workspace delete / transfer-ownership currently guarded by `StepUp: webx.RequireRecentAuth(15 * time.Minute)`. This is exactly the pair ADR 0005 names for the strong-profile wiring; batch 1 moves them behind the catalog evaluator.

Known debt to fix inside these batches:

- `authorization.RecentAuthWindow = 600 * time.Second` is a package-level hardcoded window — ADR 0011 explicitly flags this as overreach. Batch 1 makes the window a per-operation catalog field (explicit, no silent default).

## 2. Batch 0 — Decision records (S)

1. **ADR 0013 · strong-profile restart**: records the trigger firing (runlynk rebuild, triggers #1+#2), the scope table from §0 (with the survey evidence links), G2/G5 exclusions with their product-side destination, and the batch sequence below. Supersedes ADR 0005's shelve (0005 stays, marked superseded-by).
2. **ADR 0005 addendum**: restart executed; acceptance re-verified item by item in batch 4 (criterion 3 — hash reconciliation — is recorded as retired by ADR 0012, not silently dropped).
3. ROADMAP entry pointing at this plan.

Exit: ADRs merged; this plan accepted (any scope dispute resolved here, not mid-batch).

## 3. Batch 1 — Example reference wiring + in-tx facts (M)

Goal: the first strong-profile consumer, per ADR 0005's named pair (workspace delete / transfer ownership), with the transactional facts pattern established as the reference.

Work items:

1. **Product catalog YAML** — `example/internal/authorization/catalog.yaml`: operations `workspace.delete`, `workspace.transfer_ownership` (auth_method `session`, scope `workspace_path`, workspace roles `[owner]`, recent-auth `password` with an explicit window). Schema-validated, closed-set, fail-closed on unknown operation IDs.
2. **Route resolver** — `example/internal/authorization/resolver.go`: method+path → operationID. Composition-level on purpose (arch A6); promotion to a framework package waits for the second consumer (runlynk) to confirm the shape.
3. **In-tx FactsProvider (G3)** — `example/internal/authorization/facts.go`: reads session validity, user state, workspace membership + role from the handler's own `pgx.Tx` (via platform `pg.Within`). This is the reference implementation ADR 0005's acceptance demands; its test pattern (revoke membership inside the tx → authorize → deny in the same tx) is the TOCTOU regression pin.
4. **Strong-profile middleware composition** — resolver → transport assertion (session-only for these ops in batch 1; full matcher arrives in batch 3) → `Evaluator.Authorize` → project the decision:
   - allow → next;
   - deny → 403 `PERMISSION_DENIED` envelope carrying stage+reason;
   - challenge → 403 `E_REAUTH_REQUIRED` + `details{target_operation, required_assurance, max_age_seconds}` — glued onto the existing webx reauthentication flow (`POST /auth/confirm-password`), preserving ADR 0011's composition order: a role-denied principal must get the terminal permission denial, never be coaxed through reauthentication.
5. **Window parameterization** — move recent-auth window from the package constant into the operation catalog (explicit value required for any recent-auth op; `RecentAuthWindow` const demoted to deprecated alias or deleted with golden tests updated in-batch).
6. **Rewire example** — the two ops move off `workspace.Deps.StepUp` onto the strong middleware. The `Deps.StepUp` mechanism itself stays (simple-profile consumers keep it); README notes the two roads and forbids double-mounting the same operation (extends ADR 0011's prohibition).

Tests (exit criteria):

- e2e: delete → challenge → confirm-password → retry → allow, with the retried request not colliding back into the same denial (ADR 0005 acceptance criterion 2);
- fail-closed: unknown operation ID and unknown route shape deny;
- composition-order: non-owner gets terminal `PERMISSION_DENIED` without a challenge (test-pinned);
- in-tx consistency: membership revoked in the same transaction flips the decision to deny (TOCTOU pin);
- golden: evaluator golden tests extended with challenge + window-parameterized cases.

## 4. Batch 2 — G1: MFA/AAL2 freshness (L)

Goal: the second leg of the step-up machinery. The rule engine already consumes `RecentMFAAt`; this batch makes it real end to end. Scope is strictly **TOTP + backup codes** — WebAuthn/passkeys are deferred until a consumer asks (YAGNI, same discipline as ADR 0011).

Work items:

1. **Migration** — `user_mfa` (user_id, secret sealed, confirmed_at, backup-code hashes with consumed_at) + `sessions.mfa_confirmed_at`.
2. **identity/app TOTP service** — RFC 6238, ±1 step drift, otpauth URI + QR payload for enrollment; secrets sealed via platform `sealx` (single existing sealing path, no new crypto).
3. **Flows** — enroll (start) / enable (verify first code) / disable (**requires step-up**, mirroring GitHub's sudo-guarded 2FA settings) / regenerate backup codes (step-up); `POST /auth/verify-mfa` as the step-up stamping endpoint, sharing the attempt-limiter family with confirm-password so a hijacked session cannot brute-force codes.
4. **webx** — `Principal.MFAConfirmedAt`, `SessionCreate.MFAConfirmed`, `RequireRecentMFA(maxAge)` symmetric to `RequireRecentAuth`; born-confirmed semantics extended: a login completing MFA stamps both facts, password-only login stamps only the password fact (ADR 0011 semantics carried over).
5. **authorization** — no structural change expected (rules already read `RecentMFAAt`); audit that `AssuranceAAL2` facts derive from the same session columns the webx layer stamps — consistent by construction, per ADR 0011's data-source rule.
6. **example wiring** — one AAL2-grade operation as the reference: personal-access-token **creation** requires `password_and_mfa` step-up (mirrors GitHub's sudo-guarded token generation — the natural demo of computed challenge over static middleware).

Tests (exit criteria):

- TOTP test vectors (RFC 6238 appendix) + drift windows; backup-code consume-once;
- e2e: enroll → enable → trigger AAL2 op → challenge → verify-mfa → retry → allow;
- disable/regenerate rejected without prior step-up;
- machine principals (PAT) receive a plain 403 on challenge ops (ADR 0011 semantics extended to MFA);
- `CreateSession`/minter signature ripple closed out one pass, compiler-driven (v0.x precedent, ADR 0011 note).

## 5. Batch 3 — G4: per-operation transport exclusivity (M)

Goal: close the mixed-authentication hole (GitLab #22435 class) by making the operation's declared `auth_method` the transport contract, enforced before anything else touches the request.

Work items:

1. **webx transport classifier** — one helper that classifies a request's auth transport (none / session-cookie / bearer) with runlynk-proven strictness (exactly one session cookie; exactly one well-formed `Authorization: Bearer` header). Single source of truth — both session and PAT resolution paths consume it.
2. **Matcher middleware** — `webx.RequireTransportKind(...)` taking a neutral kind (webx must not import `authorization/`; arch A6 cuts both ways). The catalog→kind mapping (auth_method → transport kind) is five lines at the composition root.
3. **CSRF conditional promotion** — the session path keeps CSRF, the bearer path skips it; promote example's `CSRFConditional` pattern into webx so the rule lives next to the classifier.
4. **Rejection semantics** — 401 auth envelope with a distinct code for *mixed-transport* attempts (cookie + Authorization both present) — a security signal worth its own log line and test.

Tests (exit criteria):

- full transport × auth_method matrix (unauthenticated / session / scoped-token / machine-credential);
- the GitLab-#22430-shaped regression: a state-changing bearer-only operation reached with a session cookie → rejected at the transport gate, before any handler logic;
- mixed-transport attempt (both credentials present) rejected on session ops and logged;
- CSRF: session path enforces, bearer path exempt — both pinned.

## 6. Batch 4 — Closeout (S)

1. ADR 0005 acceptance re-verified item by item; gap-table entry in `agent-native.md` closed.
2. `authorization/README.md` rewrite: the two-profile story, the wiring guide (resolver → transport → evaluator → challenge projection), the double-mount prohibition extended to MFA, and the webx-machinery/authorization-computation split from ADR 0011.
3. Golden/test-suite extension consolidated; ROADMAP checked off; `check_docs_language.py` clean.

## 7. Out of scope (recorded so nobody re-litigates mid-flight)

- G2 project-membership storage/domain — runlynk product side (PostHog is the open-source reference).
- G5 catalog→OpenAPI generation and equality gates — runlynk product scripts.
- WebAuthn/passkeys — deferred until a real consumer (not even a ROADMAP entry).
- Role inheritance, ReBAC/policy engines, three-layer nesting — permanent non-goals (existing verdicts).
- Any runlynk-side work — separate repo, separate plan.

## 8. Risks

| Risk | Mitigation |
|---|---|
| MFA scope creep (passkeys, recovery flows, SMS) | Batch 2 pinned to TOTP + backup codes; anything else is a new ADR |
| Confusion between static (webx) and computed (authorization) step-up | Composition-order test extended to MFA; README decision matrix; double-mount prohibition |
| `CreateSession` signature ripple repeats | One-pass, compiler-driven, v0.x precedent already set by ADR 0011 |
| Window parameterization breaks golden tests | Golden updated in the same batch as the constant removal |
| example grows heavy | Accepted by charter — it is the reference consumer; keep additions to the named ops + one AAL2 op |
