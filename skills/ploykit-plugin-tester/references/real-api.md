# Real API Validation

## Setup

Use a local app URL and local or Docker database. Prefer the repo scripts when
they already cover the target behavior:

```bash
npm run db:docker:up
npm run db:docker:wait
npm run db:migrate
npm run seed:tool-site
npm run runtime:check
npm run build
```

Start the app with a test port and stable test secrets. Stop it when finished.
For production-like checks, prefer `.next/standalone/server.js` after `npm run
build`; for quick API iteration, `npm run dev` is acceptable if the user asked
for speed over production parity.

## Discover Endpoints

For a plugin, derive endpoints from `plugin.ts`:

- `routes.apis`: `/api/plugins/<plugin-id>/<path>`
- `webhooks`: `/api/plugins/<plugin-id>/webhooks/<path>`
- install/enable/admin flows when runtime availability matters:
  `/api/admin/plugins`, `/api/admin/plugins/<plugin-id>/install`,
  `/api/admin/plugins/<plugin-id>/enable`, disable, uninstall
- file, run, asset, or internal-service endpoints when the plugin uses those
  capabilities

For host route sweeps, discover API handlers from `src/app/**/route.ts` and use
`docs/routes-and-apis*.md` only as a human overview, not as source of truth.

## Authentication

Use real auth, not mocked headers:

- sign in through `/api/auth/sign-in/email`
- collect the returned session cookie
- send realistic `origin`, `referer`, `content-type`, and cookie headers
- test guest requests before authenticated requests for protected endpoints

Use seeded local credentials when available:

```text
admin@example.com
Admin@123456
```

## Request Matrix

For each plugin API method, test the smallest meaningful matrix:

- guest access: expects `401`, `403`, or explicit anonymous policy behavior
- authenticated success: status, JSON shape, and expected fields
- invalid payload: validation error status and message/code
- disabled/uninstalled plugin state when runtime gating changed
- permission or commercial gating when the route declares permissions,
  `commercial`, meter, credits, or entitlement checks
- egress/service failure behavior when the plugin depends on external or
  internal services
- idempotency/retry behavior for webhooks, lifecycle, and long-running jobs

For storage APIs, verify side effects:

- inserted/updated row exists under the right plugin/user/workspace/product
  scope
- cross-user or cross-product reads are rejected or isolated
- uninstall/disable cleanup behavior matches the contract

## Evidence To Keep

Record for every endpoint:

- method and URL
- request body category, not secret values
- auth state
- status code
- response JSON summary
- important headers
- database side-effect check when relevant
- log file paths or summary JSON path

Never print secrets, full cookies, API keys, or signed URLs in the final answer.
