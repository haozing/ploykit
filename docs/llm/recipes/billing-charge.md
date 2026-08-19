# Recipe: Billing Charge

Intent: charge, reserve, or gate usage through host commercial primitives.

## Use

- Metered charge: `ctx.metering.charge`.
- Credit reserve/commit: `ctx.credits.reserve`, `ctx.credits.commitReservation`, and `ctx.credits.releaseReservation`.
- Entitlement gate: `ctx.entitlements.has`.
- Permissions: `Permission.MeteringWrite`, `Permission.CreditsConsume`, `Permission.CreditsRead`, and `Permission.EntitlementsRead` as needed.

## Contract Shape

```ts
import { defineModule, page, Permission } from '@ploykit/module-sdk';

export default defineModule({
  id: 'paid-tool',
  name: 'Paid Tool',
  version: '0.1.0',
  permissions: [
    Permission.MeteringWrite,
    Permission.CreditsRead,
    Permission.CreditsConsume,
    Permission.EntitlementsRead,
  ],
  pages: [
    page({
      id: 'paid-tool.index',
      area: 'dashboard',
      path: '/paid-tool',
      frame: 'workspace',
      component: './pages/ToolPage.tsx',
      auth: 'auth',
      commercial: { credits: { amount: 1 } },
    }),
  ],
});
```

## Handler Shape

```ts
export default action(async function runPaidTask(ctx: ModuleContext) {
  if (!ctx.user) throw new Error('AUTH_REQUIRED');
  const subject = { type: 'user' as const, id: ctx.user.id };
  const allowed = await ctx.entitlements.has({ subject, entitlement: 'paid_tool.access' });
  if (!allowed) throw new Error('PAID_TOOL_ENTITLEMENT_REQUIRED');

  const reservation = await ctx.credits.reserve({ subject, amount: 1, reason: 'paid_tool.run' });
  try {
    await ctx.metering.charge({ subject, meter: 'paid_tool.run', quantity: 1, reservationId: reservation.id });
    await ctx.credits.commitReservation({ reservationId: reservation.id });
    return { ok: true };
  } catch (error) {
    await ctx.credits.releaseReservation({ reservationId: reservation.id });
    throw error;
  }
});
```

## Verify

Run:

```bash
npm run modules:scan
npm run module:doctor -- <id>
npm run module:test -- <id> --summary
```

## Red Lines

- Do not create balance, order, subscription, or entitlement authority tables.
- Do not fake paid status in UI.
- Do not charge long work without a reserve/release path.
