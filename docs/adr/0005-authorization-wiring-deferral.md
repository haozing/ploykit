# ADR 0005 · authorization + contractx with zero wiring: shelve and book as debt

Status: accepted (2026-10-07), in force — the decision is **shelve and book as debt**, not a permanent exemption; supersede this ADR (do not delete) when wiring lands or the shelve is reversed

## Background

When they landed (2026-10-06), `authorization` and `contractx` had zero import hits across the repo (outside themselves) — no consumers at all, example included.

This collides head-on with the AGENTS.md wiring discipline (established 2026-10-06: "new platform pieces/new domains must land with example wiring in the same batch... zero-wiring capabilities must not be merged"), and the timing is awkward: the same day's "zero-wiring inventory cleanup" (deleting 7 packages including outboxx/eventbus) removed inventory on zero-wiring grounds while merging in larger zero-wiring new pieces. The README claims "a single product can switch to the strong profile one operation at a time", yet not a single operation (example included) has switched. Without a documented decision, this is untracked suspension.

Options: ① wire the strong profile into 1-2 highly sensitive example operations (workspace deletion / ownership transfer) as the reference implementation; ② acknowledge them as reserved pieces planned for the strong authorization profile and add an ADR spelling out the shelving and restart conditions; ③ apply the zero-wiring cleanup doctrine and move them off the mainline (extract or delete).

## Decision

**Option ②, shelve and book as debt**: authorization and contractx stay on the mainline as the batch deliverable of the strong authorization profile; the wiring discipline is waived for them, the waiver is bound to this ADR, and an entry is logged in the docs/agent-native.md gap table.

Rationale:

1. **The strong authorization profile is a batch deliverable, not scattered inventory**: authz (the simple profile) and authorization (the strong profile) coexisting side by side is a deliberate architectural decision (authorization/README.md, "the solution to risk F3": the two profiles are mutually independent with no duplicated middleware entry points). With the parts merged batch by batch, the whole batch is functionally complete (catalog/facts/principal/scope/evaluator/registry/decision + contractx contract reconciliation); the only thing missing is the first consumer.
2. **No consumers means no attack surface**: the evaluator sits on no request path, so while unwired it cannot be reached by production traffic; its risk profile differs from the previously removed outboxx/eventbus packages (also zero-wiring casualties, but generic platform pieces) — authorization is decision-logic code, its correctness pinned by its own 2411 lines at a 1.2 test ratio.
3. **arch A6/A7 already lock its boundaries**: authorization is self-contained by commitment (importing nothing else in the framework, authz included) and contractx has zero business dependencies — neither can be quietly coupled into business domains, so the dependency graph will not rot while they sit shelved.

**Boundary of the waiver (pinned down so it cannot be cited as precedent)**:

- This waiver covers only the **current state** of the two packages, authorization and contractx; new platform pieces/new domains from here on must still follow the wiring discipline and may not invoke this ADR.
- This ADR is not a general rule that "zero-wiring may be merged"; any later zero-wiring merge must carry its own independent decision.

## Restart triggers (any single one triggers, and the example reference wiring must land first)

- Any product operation needs **step-up** (AAL2 / recent-auth / sudo mode, with challenge as a first-class decision);
- Any product needs a **closed-set operation catalog** (a reconcilable operation set, fail-closed on unknown operations);
- Any product needs a **hashable operation set** (`Catalog.Hash()` and contractx's catalog ↔ routes ↔ contract comparison).

Once triggered, the order is not reversible: **example reference wiring first, product integration second**.

## Acceptance criteria (verify item by item when the wiring restarts)

1. 1-2 highly sensitive example operations (suggested: delete workspace / transfer ownership) go through strong-profile evaluation, with the YAML catalog + route resolver + evaluator fully assembled;
2. The challenge/step-up path has end-to-end tests (challenge → re-authentication → allow, with replay not colliding back into the same denial), and the operation-catalog hash enters the contract reconciliation;
3. The docs/agent-native.md gap table closes this entry, and the authorization/README.md claim of "switching to the strong profile one operation at a time" is backed by a concrete example instance;
4. `python tools/check_api.py` and `make verify` are all green.

## Consequences

- Positive: the decision has a single point of reference and the self-contradiction with the "zero-wiring inventory cleanup" is resolved; the strong authorization profile assets are retained (removing them and later restoring costs more than booking the debt).
- Negative: the booked assets must be re-reviewed with each audit cycle (every domain audit re-confirms they still have zero consumers and the tests are still green); the README claim of "switching to the strong profile one operation at a time" stays on paper until the reference wiring lands.
- Revisit point: if no restart trigger has fired within 6 months, reopen this ADR to evaluate downgrading to option ③ (move off the mainline and archive).

## Addendum (2026-10-10): market research verdict + contractx's fate is bound to the role-management UI design

A four-way external survey (Go authorization libraries / full-stack frameworks / open-source multi-tenant SaaS starters / commercial authorization platforms — Clerk, WorkOS, Auth0, Permit, Oso) landed three findings that refine this ADR:

1. **Step-up (restart trigger #1) is market-validated but was repositioned, not consumed**: the validated need is served auth-layer-first (Clerk Reverification / WorkOS auth_time / Laravel password.confirm / GitHub sudo mode — unanimous "machinery in the auth layer, two-phase 403/redirect challenge"). It now lives in webx/identity (ADR 0011: `RequireRecentAuth` + `POST /auth/confirm-password`, example wired 2026-10-10). **This does NOT fire trigger #1** — the trigger is scoped to "challenge as a first-class decision" (the strong-profile form); authorization/Challenge is re-scoped to computed, catalog-driven escalation only.
2. **Closed-set catalogs (part of trigger #2) are mainstream platform practice** (GitHub FG-PAT / GCP IAM / AWS / Stripe / Slack), but no SaaS starter ships one — starter-grade products run on "membership role enum + guard + query filter", which is exactly authz's calibration.
3. **"Catalog-as-contract + hash reconciliation" (trigger #3, contractx) has zero market precedent** — no library, framework, or commercial platform does catalog↔route↔contract reconciliation; the closest analog is AWS Access Analyzer's usage↔policy diffing. It is simultaneously the differentiation and the unvalidated bet.

**Ruling on contractx's fate**: it is bound to the **role-management configuration UI** project (registered in the docs/ROADMAP.md Security section — the #1 pain point the survey validated that customers actually pay for). UI-editable role→permission data creates exactly the drift surface (DB permissions ↔ code guards ↔ routes/OpenAPI) that contractx's comparator addresses. When that project's design asks "do we drift-guard the permission data?", contractx either gains its first consumer (the exemption converts to wired) or is deleted via a superseding ADR recording "market vacuum + the sole candidate consumer declined". It is NOT deleted today: the carrying cost is near zero (self-contained per A7, zero consumers, tests green), and the role-UI decision will land well before the 2027-04 revisit point above.

**Outcome (same day, later batch)**: the role-config UI shipped and chose **write-boundary validation** (the management API rejects permissions absent from the code-registered catalog, fail-closed) — reconciliation is unnecessary for the only data-defined permission surface. contractx deleted per **ADR 0012**; trigger #3 retired; this ADR's shelving now covers authorization/ alone, with trigger #1 narrowed by ADR 0011.
