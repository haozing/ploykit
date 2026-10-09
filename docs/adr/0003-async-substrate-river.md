# ADR 0003 · Async substrate selection: adopt River, at-least-once + idempotent subscriptions

Status: implemented (2026-10-06 decision, in force)

## Background

The zero-wiring async pieces that coexisted in the framework's early days (including outboxx / eventbus) were cleaned out first: their capabilities were either already carried by domain hooks, the webhooks deliveries queue, and workers interval polling, or belonged in a mature library rather than an in-house build. "Event fan-out / settle atomicity / automation scheduling" was then confirmed as a gap the framework had to fill.

**Decision**: optimize for the framework itself — the functional requirements of integrating products are the acceptance line, not design inputs; eventbus/outboxx are not restored, and no concession is made to existing wiring/test shapes; **functional equivalence, not mechanical compatibility**.

Relationship to [ADR 0001](0001-async-substrate-positioning.md): the reopen condition reserved by 0001 Decision 2 ("a job need of run-once + retry budget + same-transaction enqueue") has been triggered — event fan-out became an explicit framework need, and an integrator already runs River in production. 0001's **in-house scheduling decision remains in effect** (pure-function cronx + schedule rows persisted to the database, River serving only as the execution layer); this ADR supersedes the part of 0001 that said "no river_job table family, no River".

## Decision

**Adopt `github.com/riverqueue/river` v0.49 (riverpgxv5 driver) as the event and async substrate**. The framework provides a two-layer thin wrapper at `platform/events` (business code works through `Event`/`Emit`/`Subscribe` and never needs River types, apart from an optional `river.InsertOpts` override on `Emit`), fanning out through the single job kind `"ploykit.event"`, with idempotency keys via unique jobs (ByArgs, hashing only kind/workspace/idempotency_key, not the payload). The river table family is product-side schema: example introduces it through the `1005_river_job` migration (the official 001-008 merged).

Selection comparison:

1. **vs in-house outbox**: `InsertTx` transactional enqueue is outbox semantics outright (business rows and events in one transaction), plus CTE `FOR UPDATE SKIP LOCKED` claiming, exponential-backoff retries, maintenance services (cleaner/rescuer/reindexer), and `pg_notify` fast wakeup — exactly everything an in-house outbox must hand-write. Of the industry's two-part pattern (synchronous in-transaction hook + post-transaction async subscription), ploykit already has the first part (25 domain hooks, four semantics); River carries the entire pipeline of the second part.
2. **vs Watermill**: Watermill solves multi-subscriber topologies and egress forwarding (Forwarder), not transactional enqueue; its SQL PubSub still requires building your own schema and retries. The MVP ships no egress Kafka/GCP; if that becomes necessary later, revisit with the Watermill Forwarder as the reference.
3. **Ecosystem convergence**: the integrating product already runs River in production — framework and product share one execution substrate, collapsing mental models and operations into a single one.

**Semantic trade-offs (stated explicitly)**: ploykit provides **at-least-once + idempotent subscriptions**, not strict three-phase ordering, and no per-key strict ordering. The synchronous phase belongs to domain hooks / direct service calls; the asynchronous phase belongs to events. Integrators' existing strong-ordering invariants are **rewritten as idempotency tests** during migration (replaying the same event twice leaves the projection unchanged) — functionally equivalent, mechanically different; this is exactly where "satisfy the function, not the mechanism" lands.

**Boundary**: the webhooks deliveries queue stays untouched; migrating the delivery worker over (deleting the in-house ClaimPending/backoff) will be evaluated only after River has run stably for one milestone, as a second-stage convergence, not mixed into this batch.

## Consequences

- Positive: removing two packages actually yields stronger capabilities (retry budget, maintenance services, unique delivery for free); the event substrate has a single point of reference, so future contributors need not re-argue it; acceptance gates ①-⑤ (same-transaction behavior / retry after kill -9 lands exactly once / error backoff retries exhausting into discarded / example e2e / the idempotency contract) gained executable criteria.
- Negative: the river_job table family occupies a product migration slot and evolves with River versions (upgrades must reconcile official migration deltas; `1005_river_job` is the official 001-008 set merged flat and must be re-diffed against upstream on each River upgrade); at-least-once forces every subscriber to write idempotency as a contract — an extra layer of mental cost on the product side; the dependency budget gained a new exception (+riverqueue/river, rationale: the de-facto standard PG-native job/event substrate).
- Revisit points: ① the milestone for migrating webhooks deliveries onto River (second-stage convergence); ② when a second integrating product asks for per-key strict ordering / post-transaction ordering promises, reopen the "ordering" topic (comparing industry Outbox ordering practice at that time).
