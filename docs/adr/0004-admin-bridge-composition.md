# ADR 0004 · The admin bridge package: composition-layer code physically lives in the framework repo (exempted from inter-domain isolation)

Status: implemented (2026-10-07 decision, in force)

## Background

The admin console's operational surface (users/workspaces/billing/webhooks) consumes the capabilities of five domains through the admin/app ports. Inter-domain isolation (rule A3, precedent ADR 0002 admin→audit) keeps admin from importing the domains; bridge adapters previously had to be hand-written by each product's composition root (example/internal/adminops, 309 lines of pure DTO mapping, zero product semantics). Open-source precedents (Keycloak Admin REST, GitLab /admin, Medusa v2 src/api/admin, Saleor): the admin operational surface is always platform code, a single copy, sitting at the top of the dependency graph — not one of them makes downstream products rewrite it.

## Decision

Create `admin/adapters/bridge`: composition-layer code (semantically equivalent to a product's main.go assembly point), physically located in the framework repo, a single copy that all products assemble. Only this subtree is exempt from the inter-domain isolation rule and may import the five domains' app packages: identity/app, workspace/app, notify/app, billing/app, webhooks/app (the arch allowlist is tightened to from-subtree matching on admin/adapters/bridge, five exemption edges in total; the exemption mechanism is correspondingly broadened from A3-only to A2+A3, see below). Constraints:

- Business domains still must not import each other horizontally (A2/A3 stay closed for every other subtree, including the rest of admin);
- The dependency direction is always bridge → domain: domains must not import bridge;
- bridge imports only each domain's app layer and never touches adapters/domain internals;
- The bridge carries zero business logic: DTO mapping and forwarding only; operational semantics belong to the domains (the *For target-scoped methods).

## Consequences

- Product assembly shrinks from 309 lines to constructor calls; mapping drift is centralized at a single framework point for maintenance.
- When a domain API changes, bridge breaks at compile time (previously each product only found out at runtime).
- Small arch-test changes: the exemption graph (exemptEdgeSet/reducedAdj) broadens minimally from A3-only to A2+A3, with the rule descriptions in internal/arch/arch_test.go revised in step; A1/A4-A7 gain no exemptions.
- AllowlistFreshness guards the gate: if bridge is ever deleted, the five exemptions are cleaned up with it, preventing stale-list accumulation.
