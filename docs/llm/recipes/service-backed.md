# Recipe: Service-Backed Module

Intent: call a controlled external service through declared host policy.

## Use

- Declare `serviceRequirements` and `Permission.ServicesInvoke`.
- Call the service with `ctx.services.invoke(serviceName, operationName, input)`.
- Keep credentials, signing, redirects, body limits, and response parsing inside the host service policy.

## Contract Shape

```ts
import { defineModule, Permission } from '@ploykit/module-sdk';

export default defineModule({
  id: 'admin-sync',
  name: 'Admin Sync',
  version: '0.1.0',
  permissions: [Permission.ServicesInvoke],
  serviceRequirements: {
    adminApi: {
      required: true,
      provider: 'admin-api',
      kind: 'signed-http',
      connection: {
        egress: ['https://api.example.com'],
        timeoutMs: 10000,
        redirect: 'manual',
      },
      secrets: { token: { required: true } },
      operations: {
        listItems: {
          method: 'POST',
          path: '/items/search',
          auth: { type: 'bearer', secret: 'token' },
          request: { body: 'json' },
          response: { body: 'json', maxBytes: 1000000 },
        },
      },
    },
  },
});
```

## Handler Shape

```ts
export default action(async function listItems(ctx: ModuleContext, input = {}) {
  return ctx.services.invoke('adminApi', 'listItems', {
    json: { query: input.query ?? '' },
  });
});
```

## Verify

Run:

```bash
npm run modules:scan
npm run module:doctor -- <id>
npm run module:service-contract -- <id>
npm run module:test -- <id> --summary
```

## Red Lines

- Do not use global `fetch` for controlled signed services.
- Do not hand-build bearer or HMAC headers.
- Do not keep mock and live paths separate.
- Preserve platform errors; map product errors explicitly.
