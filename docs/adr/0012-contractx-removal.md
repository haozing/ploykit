# ADR 0012 · contractx deleted: role-config management guards drift at the write boundary, not by reconciliation

Status: accepted (2026-10-10), executed within the same change — supersedes ADR 0005's restart trigger #3 ("hashable operation sets") and closes the contractx clause of its 2026-10-10 addendum. authorization/ itself remains shelved under ADR 0005 with triggers #1 (narrowed by ADR 0011 to the strong-profile challenge form) and #2 (closed-set catalog consumers).

## Context

ADR 0005 (2026-10-07) shelved authorization/ + contractx as zero-consumer debt and bound contractx's fate to the role-management configuration UI project: when that design answered "does UI-edited permission data drift-guard against routes/OpenAPI?", contractx would either gain its first consumer or be deleted. The role-config UI landed on 2026-10-10 and the design question got a concrete answer.

## Decision

**Delete contractx.** The role-config design chose **write-boundary validation** as the drift guard, which makes a reconciliation pipeline unnecessary for the only data-defined permission surface that exists:

1. **The permission vocabulary stays code-registered** (`authz.Catalog`, extended by products at wiring time — e.g. example adds `tasks:*`). The management API (`PUT /api/workspaces/{id}/roles/{role}`) rejects any permission not in the registered catalog with 400, fail-closed. UI-edited data cannot drift from the vocabulary because unknown values never enter the database — there is nothing left to reconcile after the fact.
2. **Everything else is code-anchored**: guards (`authz.Require`) and routes are both Go source compiled together; `tools/check_api.py` already guards spec↔route drift in CI. No third data surface exists to compare.
3. **Override semantics are replace, not merge** (a `workspace_role` row fully replaces the role's built-in set), so effective permissions are a direct function of (catalog ∩ stored set) — both already guarded.

Deleting also retires trigger #3: no consumer ever asked for `Catalog.Hash()`-based reconciliation, and the 2026-10-10 market survey found zero precedent for catalog↔route↔contract reconciliation anywhere (libraries, frameworks, starters, or commercial platforms). `authorization.Catalog.Hash()` itself stays — it is self-contained inside the shelved package and does not depend on contractx.

What shipped instead of reconciliation (same change): `GET/PUT/DELETE /api/workspaces/{id}/roles/{role}` (workspace domain, write side of migration 026's table; read side was already authz's `PermsFor`), the `roles:manage` permission (owner-only by default — an admin who could edit role permissions could self-escalate), step-up on the mutating routes (ADR 0011's `sensitive` composition), audit records (`role_perms.set` / `role_perms.reset`), authorizer cache invalidation on write, and the management UI page.

## Consequences

- Positive: the zero-wiring debt is gone rather than re-reviewed every audit cycle; the framework ships one guard mechanism (write-boundary validation) where two were planned; AGENTS.md/arch A7/README/architecture/agent-native updated in the same change.
- Negative: if a future consumer genuinely needs content-addressed permission manifests (e.g. cross-repo contract pinning), the deterministic-hash machinery must be rebuilt — recoverable from git history (deleted at ~920 lines incl. tests) or rewritten against the simpler need that surfaces.
- Recorded for the record: contractx never had a consumer from landing (2026-10-06) to deletion (2026-10-10, 4 days).
