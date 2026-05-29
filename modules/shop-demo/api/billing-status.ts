import { defineApi } from '@ploykit/module-sdk';

export default defineApi({
  async get(ctx) {
    const userId = ctx.user?.id;
    const subject = { type: 'user' as const, id: userId ?? 'anonymous' };
    const [balance, plan, entitled] = userId
      ? await Promise.all([
          ctx.credits.balance({ subject }),
          ctx.billing.getPlan(userId),
          ctx.entitlements.has({ subject, entitlement: 'demo.entitlement' }),
        ])
      : [null, null, false] as const;

    return ctx.json({
      ok: true,
      moduleId: ctx.module.id,
      entitlement: 'demo.entitlement',
      entitled,
      plan,
      balance,
      upgrade: {
        label: 'Upgrade',
        href: '/zh/dashboard/billing',
      },
    });
  },
});
