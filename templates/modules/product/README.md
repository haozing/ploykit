# __MODULE_NAME__ Product Module

Product module generated from the PloyKit `product` template.

This is the main module shape for product work: public site, workspace console,
admin operations, white-label presentation, and Data v2 CRUD in one module root.

Optional extensions:

- `service-backed`: OpenAPI-backed privileged service client, mock fixtures, and
  live smoke evidence.
- `background`: jobs, events, webhooks, and lifecycle work.

Start narrow:

```bash
npm run module:doctor -- __MODULE_ID__
npm run module:test -- __MODULE_ID__
```

When the `service-backed` extension is enabled, keep
`tests/service-contract.json` aligned with the module service client and verify
it against the service machine contract:

```bash
npm run module:service-contract -- __MODULE_ID__ --openapi ../service/openapi.yaml
npm run module:service-contract -- __MODULE_ID__ --openapi ../service/openapi.yaml --write-fixtures
npm run module:evidence -- --module __MODULE_ID__ --file ./scripts/live-smoke.ts --runner tsx -- --required
```

Keep the boundary explicit: `--write-fixtures` refreshes contract mock fixtures
from the machine contract, fixture tests exercise UI/action branches through
`ctx.services.invoke(...)`, and live smoke proves real signing, tenant isolation,
idempotency, quota, one-time token, lease/retry, and state-machine behavior.
