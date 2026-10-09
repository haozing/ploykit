# ADR 0009 · audit_event / analytics_event retention policy: monthly RANGE partitioning + rolling DETACH/DROP

Status: **implemented** (2026-10-07); open booked items live in docs/ROADMAP.md (cold archive, partition health surface)
— migrations 035/036 (monthly RANGE partitions, PK changed to (id,created_at), atomic swap-in via transactional DDL) + the platform/pgpart maintenance worker (try-advisory-lock serialization + idempotent EnsureForward + DETACH CONCURRENTLY as a single statement inside the pool) + thin RetentionWorker shells in the audit/analytics domains + both workers wired in example; the keyset cursor's cross-partition EXPLAIN verification has passed. Subsequent maintenance follows the boundaries in this document.
Open booked items: a cold-archive exit for audit events (this ADR covers rolling cleanup only; the archival policy is a separate decision), and the Decision-4 partition-health admin surface (lag/oldest partition) — the wired workers log each round's created/dropped partitions only, so that surface stays booked (docs/ROADMAP.md, behind the first rolling-archive operational incident).

## Background

Two append-only hot tables grow without bound, and there is no retention mechanism of any kind (a repo-wide grep shows zero DELETE / retention wiring):

- **audit_event** (migration 006): appended to continuously by every domain site-wide (login/workspace/billing/admin operations all write), and the admin console's default view is exactly "an unfiltered global list ORDER BY created_at DESC" — the bigger the table, the pricier the console's own default page.
- **analytics_event** (migration 010): the analytics table, the fastest-growing table in the database (one row per user action); it is in the same family as audit but with different compliance properties (analytics carries none of audit's statutory retention obligation and can be kept on a more aggressively short retention).

Growth is linear, queries are recency-biased (both list and export order by created_at DESC), and writes are high-frequency small transactions — with these three traits stacked, the "unbounded growth + full-table index" shape will, past some data volume, degrade index depth, VACUUM duration, and backup size all at once.

## Candidate options

| # | Option | Pros | Cons |
|---|---|---|---|
| ① | **Monthly RANGE partitioning + rolling DETACH/DROP with N-month retention** | Expiring data is cleaned by a DDL metadata operation (milliseconds, zero dead tuples); old partitions can be DETACHed first (immediately invisible to queries) and DROPped later at leisure, or even kept as archive partitions; partition pruning makes "last N months" queries naturally touch only hot partitions | The two existing tables require a **one-time rebuild** to become partitioned (the partition key must join the PK; audit_event's PK changes from `id` to `(id, created_at)`); a worker is needed to pre-create future partitions (otherwise writes fail when no partition exists to land in); one more operations surface (partition inventory, lag monitoring) |
| ② | Periodic DELETE worker | No schema change; smallest implementation | Bulk DELETE is Postgres's most expensive cleanup path: dead-tuple bloat + table/index bloat, VACUUM/autovacuum occupied long-term (DELETE on an append-only table produces 100% dead tuples); a WAL flood during deletion hits replicas; the industry consensus treats "cleaning large append-only tables with DELETE" as an anti-pattern |
| ③ | Archive table + TTL (DELETE from the hot table, full copy in the cold table) | No data loss; the cold table can live on slow disks / a separate tablespace | Double storage + a doubled cleanup problem (the cold table also grows without bound, only slower); a split query surface (cross hot-cold merged queries need UNION or are unusable); for data like analytics with no retention obligation, pure over-engineering |
| ④ | Do nothing | Zero cost | Unbounded growth; the retention question stays booked forever; the cost is passed on to some future shutdown rescue |

Industry reference points: Sentry self-hosted events default to 90-day retention, Stripe API logs to 400 days ("hot data in a bounded window with explicit boundaries" is the SaaS convention); GitLab puts large append-only tables on its native partitioning framework (Gitlab::Database::Partitioning, RANGE by time); the ecosystem tools pg_partman + pg_cron are the managed form of option ①. **Decision: ①, with analytics on the same policy.**

## Decision

1. **Both audit_event and analytics_event move to monthly RANGE partitioning** (partition key `created_at`) with N-month rolling retention cleanup: at the start of each month (or in daily patrols) DETACH expired partitions → DROP them later at leisure. N is product-configurable: audit defaults to a suggested 12 months (the compliance-convention floor), analytics to a suggested 6 months — **this ADR fixes the mechanism; default values follow the implementation** — and the audit N must be explicitly configurable (some industry compliance demands longer retention; products may raise it but may not lower it below the floor).
2. **PKs rebuilt along with partitioning**: PostgreSQL requires the partition key in every unique constraint, so audit_event's PK `id` → `(id, created_at)` and analytics_event's PK `id` → `(id, created_at)`. The two tables' existing indexes (006/010/030) are rebuilt as partition-local indexes along with the partitioned tables; there are no secondary unique constraints on the `token`/`actor` side, so no additional breakage surface.
3. **The notification table is outside this ADR**: notification has read state (mutable rows), is not purely append-only, and has different partitioning semantics; it stays booked as a same-family item, to be decided independently when the time comes.
4. **Worker obligations (a framework platform piece, landed with the implementation)**:
   - Pre-create future partitions (at least 1 month ahead; **no default partition** — a default partition would silently swallow the "missing partition" configuration error into an unbounded partition; better to expose it as a write failure);
   - Rolling DETACH of expired partitions (DETACH CONCURRENTLY avoids locking queries) + lag alerting (partition progress reconciliation);
   - Wiring discipline per AGENTS: the platform piece must land with example wiring in the same batch (the retention window is env-tuned — `AUDIT_RETENTION_MONTHS` / `ANALYTICS_RETENTION_MONTHS` — falling back to the framework default of 12 months when unset; a failed round logs a warning and retries on the next tick rather than fatal), and expose partition health (lag/oldest partition) on the admin surface.
   - In-house rather than pg_partman: the framework's existing posture of zero external extension dependencies (cf. the in-house pgmigrate precedent); the partitioning cadence (monthly) and the operation set (pre-create/DETACH/DROP) are small enough that pg_partman's generality is not needed.

## Implementation notes

- **One-time rebuild migration**: `CREATE partitioned parent table → load data → rename-swap in within the same transaction`. These are framework tables (006/010 were created in 001-999), so the rebuild migration stays in the framework numbering range; but on shared databases the lock window and duration of rebuilding large tables must be evaluated (ACCESS EXCLUSIVE held = the duration of the copy), and very large databases need a product-provided offline migration path — the migration comments must state this.
- **Down migration**: partitioned parent → plain table likewise requires a one-time rebuild; the test gate (migrations_test.go's up→down→up idempotency convention) covers it following the 025/026 precedent.
- **Zero query-surface changes**: existing WHERE/ORDER clauses are all led by created_at (the 006/010/030 indexes all include created_at), so partition pruning hits naturally; the only new obligation is that **cross-partition uniqueness no longer holds globally** (once the PK includes the partition key, the same id can theoretically repeat across months) — ids are uuid/identity generated, collision probability is negligible, and the write surface has no CHECK dependencies.
- **Audit export keyset compatibility**: the export cursor `(created_at,id)` points the same way as the partition order; "cursor landing in an already-DROPped partition" caused by partition cleanup manifests as an empty page ending — semantically safe.

## Acceptance criteria (check item by item when implementation completes)

- [ ] The partitioning migrations of both tables are up/down/up idempotent (the migrations DB-gate tests);
- [ ] After the full up, EXPLAIN for the existing admin audit list/export and analytics aggregation queries shows partition pruning (no worse than the 030 index baseline);
- [ ] Worker: the three operations pre-create/DETACH/DROP + gaps are never silent (no default partition; write failures observable);
- [ ] Example wiring (worker startup + env switch + admin health) complete in all three pieces;
- [ ] N-month retention is configurable, with audit/analytics configured independently.

## Consequences

- Positive: growth is bounded, cleanup costs zero VACUUM, and queries become automatically recency-biased via partition pruning; a reusable decision template now exists for the same-family problem of the notification table's retention policy.
- Negative: the one-time rebuild migrations of two tables are the heaviest DDL in the framework's history (the lock window must be evaluated); the operations surface gains a partition inventory and worker lag monitoring; cross-partition global uniqueness weakens to (id, created_at).
- Revisit point: if the first product adopting this framework declares longer audit compliance retention (finance/healthcare), come back to this ADR to adjust "the audit N-month default" and evaluate adding "a cold-archive exit" (a one-sided introduction of option ③).
