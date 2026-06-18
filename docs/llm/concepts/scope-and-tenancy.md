# Scope And Tenancy

Tenancy is a host concept carried by scope, not a module-owned convention.

## Boundary

- `ctx.scope` is the runtime source for product, environment, workspace, and module identity.
- Data v2 table scopes decide who owns records: `user`, `workspace`, `product`, `public-read`, or `system`.
- Workspace permissions and roles are host concerns; module code should consume them through contract and context.

## Use

- Pick the narrowest Data v2 `scope` that matches the product fact.
- Use `scope: 'workspace'` for workspace-owned collaborative records.
- Use `scope: 'product'` for product-wide CMS/site content.
- Declare `Permission.DataTableRead` and `Permission.DataTableWrite` before calling `ctx.data.table(...)`.

## Do Not

- Do not add `tenant_id` as the authority for isolation when Data v2 scope can express it.
- Do not infer workspace from route strings or local storage.
- Do not create session/user/workspace tables to bypass `ctx.user`, `ctx.auth`, or `ctx.workspace`.

Reference: `modules/cms-demo/module.ts` and `modules/capability-demo/module.ts`.
