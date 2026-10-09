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
