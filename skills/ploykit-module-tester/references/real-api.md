# Real API And Action Validation

## Setup

Use a local app URL and local or Docker database. Prefer a production build for
final validation:

```bash
npm run host:build
npm run host:start
```

For quick iteration, `npm run host:dev` is acceptable when the user asks for
speed over production parity.

Stop any server process started for the test. Record the PID and log path under
the artifact directory.

## Discover Endpoints

For a module, derive endpoints from `module.ts`:

- `routes.api`: `/api/modules/<module-id><path>`
- `actions`: host action endpoint or app route used by the current runtime
- `webhooks`: configured inbound webhook paths
- lifecycle/admin flows when install, enable, disable, catalog, or admin
  behavior changed
- files, runs, commercial, AI/RAG, or service endpoints when the module uses
  those capabilities

For host route sweeps, discover API handlers from `apps/host-next/app/**/route.ts`
and runtime helpers from `src/lib/module-runtime/**`.

## Request Matrix

For each relevant endpoint or action, test the smallest meaningful matrix:

- guest access: expects `401`, `403`, or explicit anonymous policy behavior
- authenticated success: status, JSON shape, and expected fields
- invalid payload: validation status and message/code
- missing permission or disabled capability behavior
- public high-cost route behavior when AI/RAG/files/commercial work is possible
- commercial guard behavior for entitlements, metering, credits, or checkout
- egress failure behavior for external HTTP
- idempotency/retry behavior for webhooks, lifecycle, jobs, and actions

For Data v2 APIs, verify side effects:

- inserted or updated rows exist under the expected product, workspace, user, or
  public scope
- cross-scope reads are rejected or isolated
- failed transactions roll back

## Evidence To Keep

Record for every endpoint:

- method and URL
- request body category, not secret values
- auth state
- status code
- response JSON summary
- important headers
- database side-effect check when relevant
- log file path or summary JSON path

Never print secrets, full cookies, API keys, signed URLs, or full database URLs
in the final answer.
