# ADR 0001 · Async substrate positioning: four mechanisms coexist, River not introduced

> **Note 2026-10-06**: The "event/outbox substrate selection" portion of this ADR has been superseded by [ADR 0003](0003-async-substrate-river.md) (River); the in-house scheduling decision remains in effect (pure-function cronx + DB-persisted schedule rows + River as the execution layer).
>
> **Note 2026-10-09**: The Background and Decision 1 mechanism inventory describes the framework at decision time. eventbus and outboxx have since been removed (ADR 0003; the transactional-event role is now `platform/events` on River), and the schedx package is gone — its claim-before-execute CAS survives as `ClaimDue` in the schedule domain (`schedule/pgrepo.go`), with River unique jobs deduplicating fired jobs. The webhooks delivery loop is unchanged.

Status: implemented (2026-10-05 decision, landed with the async substrate)

## Background

The framework carries four mechanisms that all "look asynchronous" side by side (eventbus / outboxx / the webhooks delivery loop / schedx+cronx). Together with the existence of River, the industry background-job library, "why not unify on River" became a question that had to be decided once and pinned down permanently.

## Decision 1: Positioning table of the four mechanisms — semantically mutually exclusive, not interchangeable

| Mechanism | Positioning | Consistency/persistence | Recovery semantics |
|---|---|---|---|
| **eventbus** | In-process synchronous three-stage cascade (Cascade→Project→Broadcast), triggered post-commit | No persistence; lost on process crash | None (consumers guarantee idempotency themselves) |
| **outboxx** | Event egress in the same transaction as the business write | Outbox rows committed in the same transaction; SKIP LOCKED + lease + exponential-backoff replay; per-ws partitioning preserves order | After a crash the Relay replays, at-least-once |
| **webhooks delivery** | Scan-based loop inside the domain (outbound to third-party HTTP) | SKIP LOCKED claiming + next_attempt_at due filtering + retry backoff (industry precedent: Svix) | Rows survive a crash and are re-claimed in the next round |
| **schedx + cronx** | Late-compensation scheduling (cron semantics) | Enumerate (anchor, now], take only the latest, void anything later than 5 min, (job, scope, plan_time) uniqueness | Correct even after a stateless restart: facts are rebuilt from the enumeration window, not from memory |

What separates the four is not implementation style but **semantics**: eventbus answers "what should this process cascade once the transaction commits"; outboxx answers "how does this business fact reliably leave the database"; webhooks answers "how do we reliably deliver facts to third-party HTTP and control retries"; schedx answers "should a scheduled job run right now, and what about late ones". Any "replace Y with X" proposal (e.g. replacing schedx with River periodic jobs, or the webhooks queue with outboxx) loses the unique semantics of the replaced side and is rejected outright.

## Decision 2: The River verdict — scheduling semantics stay in-house forever

River's (riverqueue/river) periodic scheduling is **approximate triggering**: it is stateless across restarts, does not backfill missed periods, and cannot express schedx's late-run voiding (>5 min dropped) or (job, scope, plan_time) uniqueness — both are core semantics of compensation scheduling, not negotiable implementation details (validated by early implementation: a single minimal scan-based worker was enough to cover all three background-job classes, zero third-party dependencies). Therefore:

- **Scheduling (schedx+cronx) stays in-house forever**; no river_job table family, no periodic jobs.
- **outboxx is the in-house equivalent of River's transactional enqueue (`client.InsertTx`)**: the business write and the event enqueue share one transaction and live or die together with the rollback. River adds nothing to scan-based loops (webhooks/outbox relay) — SKIP LOCKED claiming is already the industry-standard idiom (the same one River uses internally).
- **The only shape under which River might be introduced**: a product-facing job primitive of "run once + retry budget + enqueue in the same transaction". Criterion: the need shows up in multiple integrating products. It would then be introduced standalone as `platform/riverx`, leaving the existing four mechanisms untouched.
- **Integration-seam memo**: transactions in this framework are `pg.Within` ambient transactions (carried in ctx, invisible to the repository layer), while River's `InsertTx` needs an explicit `*pgx.Tx`. If riverx is ever introduced, this impedance mismatch must be solved first (e.g. exposing the current tx inside Within). This is the real cost of "introducing River" and must not be left out of the evaluation.

## Decision 3: Multi-replica safety — scheduling claims must go through the ClaimDueTrigger CAS

On a single replica, "enumerate → execute → unconditionally advance next" is correct; with multi-replica horizontal scaling, two replicas enumerating the same due trigger inside the same window would **execute it twice** (the only real gap identified by the multi-replica safety analysis).

Decision: for every due trigger it enumerates, the scheduling loop **first** claims it via CAS — advancing only if the `next` column still equals the enumerated snapshot value (`UPDATE ... WHERE next IS NOT DISTINCT FROM $snapshot`); the claim winner executes, the loser exits with zero side effects (the next due round re-enumerates naturally). Anchoring on the snapshot value instead of only on the id means a concurrent reschedule (PATCH cron) cannot be swallowed by the claim. At decision time this was implemented as `ClaimDueTrigger` in `platform/schedx`; after schedx was folded into the schedule domain, the claim-before-execute CAS lives on as `ClaimDue` in `schedule/pgrepo.go` (conditional advance `UPDATE ... WHERE next_fire_at <= now`), and the fired job itself is deduplicated across replicas by River unique jobs (`UniqueOpts.ByArgs`). The other scan loops are already safe via `FOR UPDATE SKIP LOCKED` claiming — the webhooks delivery loop (`DeliverPending`/`ClaimPending`) is the surviving example; the outbox relay was removed together with outboxx per [ADR 0003](0003-async-substrate-river.md).

## Consequences

- Positive: the trade-offs among the four mechanisms have a single point of reference, so future contributors need not re-argue them; multi-replica deployments get a platform-level primitive for scheduling safety.
- Negative: if the "run-once + retry budget + same-transaction enqueue" need ever materializes, lease/retry/ledger machinery must be built in-house (or riverx introduced at that point); until then this is a known and accepted gap.
- Revisit point: when any integrating product raises the need for that job shape, reopen the last bullet of Decision 2.
