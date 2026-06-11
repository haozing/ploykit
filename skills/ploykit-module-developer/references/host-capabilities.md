# Host Module-Runtime Capability Changes

Use this reference only when the requested change cannot be implemented inside a
single module.

## Host-Owned Capabilities

Treat these as host-owned by default:

- Account, login/logout, session, profile, and account menus.
- Product/workspace scope, workspace switching, workspace management, members,
  invitations, roles, and permissions.
- Global site/dashboard/admin shells, global navigation, language, theme, and
  host notifications.
- Billing, checkout, invoices, credits/entitlements, redeem codes, and
  authoritative commercial state.
- Full file upload/management loops, secrets, service connections, audit, and
  platform Admin.

If a module needs one of these and the host already has it, prefer reuse through
host chrome, a host page link, an existing API, a `ctx.*` capability, or a
generic contribution/registry seam. Do not add a module-local second
implementation.

If the host capability exists but is not visible to module UI, add a generic
extension such as a shell context, product-scope context, presentation slot, or
capability descriptor. The extension must be reusable by other modules; never
key it to one module id.

Temporary module fallbacks must be neutral and honest. Use labels such as
`Workspace` or `Account` plus real host links. Do not hard-code realistic
platform state such as workspace names, user initials, plans, member counts,
roles, purchase status, or security status.

## Change Surfaces

Common host-runtime files include:

- `src/module-sdk/*`: public module contract, context, permissions, and testing
  helpers
- `src/lib/module-runtime/*`: runtime adapters, host creation, security,
  routing, Data v2, stores, files, AI/RAG, commercial, and diagnostics
- `apps/host-next/*`: Web Shell, Next.js routes, module host mounting, admin,
  dashboard, public pages, and browser-facing integration
- `tests/*`: shared runtime regression tests
- `templates/modules/*`: generated module starter behavior

## Rules

- Preserve the `module.ts` contract as the source of truth.
- Add SDK types before using new fields in modules or runtime adapters.
- Mount new capabilities in every relevant host path: fake/testing host, shared
  runtime host, background contexts, and app host integration.
- When adding a capability, add both a positive test and a missing-capability or
  missing-permission test.
- Keep runtime adapters injectable. Avoid hard-coding production services into
  module code.
- Do not add compatibility fallbacks for removed models. v2 uses local modules,
  Data v2, and explicit capabilities.

## Regression Pattern

For a host capability fix, prefer this order:

```bash
npm run typecheck
npm run test:host-runtime
npm run test:web-shell
npm run runtime:check
```

For browser-facing Web Shell changes, also run production build/start and take
desktop/mobile screenshots of the affected pages.

## Real Bug Pattern To Guard

If a module API or action uses `ctx.ai`, `ctx.rag`, commercial capabilities, or
file capabilities, verify the app host actually mounts those capabilities. A
unit fake host may pass while the Next.js demo host fails at runtime if a
capability is missing from `apps/host-next/lib/module-host.ts`.
