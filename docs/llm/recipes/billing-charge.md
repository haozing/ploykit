# Recipe: Billing Charge

Intent: charge or reserve usage through host commercial primitives.

## Use

- Metered charge: `ctx.metering.charge`.
- Credit reserve/commit: `ctx.credits.reserve`, `ctx.credits.commitReservation`.
- Entitlement gate: `ctx.entitlements.has`.
- Permissions: `Permission.MeteringWrite`, `Permission.CreditsConsume`, `Permission.CreditsRead`, `Permission.EntitlementsRead`.
- Reference: `modules/capability-demo/module.ts`.

## Contract Shape

```ts
permissions: [
  Permission.MeteringWrite,
  Permission.CreditsRead,
  Permission.CreditsConsume,
  Permission.EntitlementsRead,
],
routes: {
  dashboard: [{
    path: '/my-tool',
    component: './pages/ToolPage',
    auth: 'auth',
    commercial: { credits: { amount: 1 } },
  }],
},
```

## Handler Shape

```ts
export default action(async function runPaidTask(ctx: ModuleContext) {
  if (!ctx.user) throw new Error('AUTH_REQUIRED');
  const subject = { type: 'user' as const, id: ctx.user.id };
  const allowed = await ctx.entitlements.has({ subject, entitlement: 'my_tool.access' });
  if (!allowed) throw new Error('MY_TOOL_ENTITLEMENT_REQUIRED');
  const reservation = await ctx.credits.reserve({ subject, amount: 1, reason: 'my_tool.run' });
  try {
    await ctx.metering.charge({ subject, meter: 'my_tool.run', quantity: 1, reservationId: reservation.id });
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
