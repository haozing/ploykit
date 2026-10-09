# ADR 0002 · admin's read-only dependency on audit: exempted from the inter-domain isolation rule

Status: implemented (2026-10-06 decision, in force)

## Background

The architecture boundary audit (docs/agent-native.md §4.2) found 4 existing violations of rule A3 "business domains must not import each other horizontally" — the admin package importing audit:

- `admin/app/ports.go` (the QueryAudit port signature references `audit.ListQuery`)
- `admin/app/service.go` (QueryAudit delegation)
- `admin/adapters/http/routes.go` and `admin/adapters/pgrepo/repo.go` (query assembly)

Taken apart, the coupling is only half a coupling: the **write path is already textbook dependency inversion** — admin defines a local structured `Auditor` port (nil-safe), which `audit.Recorder` happens to satisfy, injected by the product composition root; the **read path (viewing audit logs in the admin console) uses `audit.ListQuery` and audit's query implementation directly**, and that is the part that ran into A3.

Options: ① exemption (explicit allowlist); ② refactor for decoupling (an admin-local AuditQuery type + mapping in the composition root); ③ promote audit to a cross-cutting shared layer (like authz, importable by all domains).

## Decision

**Option ①, exemption**: the arch boundary tests (`internal/arch`, documented in docs/agent-native.md §4.2) carry an explicit exemption list, `internal/arch/allowlist.txt`. This ADR's entry is the single edge `admin -> audit`; A3 stays closed for every other business-domain edge except the `admin/adapters/bridge -> <domain>/app` entries registered under ADR 0004 (composition bridge, its own rationale).

Rationale:

1. admin is an **aggregation console** — it naturally reads the data plane of every domain, which is close in nature to the product composition layer (the composition root was always allowed to import everything). The horizontal isolation rule guards against business logic entangling itself, not read-side aggregation.
2. The cost of refactoring for decoupling (②) is duplicated types: every filter field added to the audit query must be mirrored into admin's local type — sustained friction for zero runtime benefit.
3. Promoting audit to a cross-cutting layer (③) opens the gate too wide: today every domain writes audit through the healthy pattern of port-injected Recorder; opening up imports would tempt future contributors to bypass the port and depend directly.

**Boundary of the exemption (pinned down so it cannot be cited as precedent)**:

- Limited to the **query surface** (`audit.ListQuery` / `Query` / reading audit entries).
- admin's **write path must keep going through local `Auditor` port injection**; calling `audit.Recorder` directly is not allowed.
- The exemption is a single package-level entry and creates no general rule that "other domains may do the same".

## Consequences

- Positive: zero code changes; the aggregation-console classification has a single point of reference and landing the arch tests is no longer blocked.
- Negative: the exemption list is long-term debt and every entry must carry an ADR; admin feels it (at compile time) when the audit query surface evolves. The arch tests flag stale entries (whose import has been removed) so the list cannot accumulate silently.
- Revisit point: when a **second** business domain needs to import the audit query surface, reopen this ADR — at that point escalate to option ③ (audit joins the cross-cutting shared layer, by analogy with authz / the A5 rule) and revise the layering model in agent-native.md in the same batch.
