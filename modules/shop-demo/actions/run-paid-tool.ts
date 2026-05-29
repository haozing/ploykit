import { action, type ModuleContext } from '@ploykit/module-sdk';

export default action(async function runPaidTool(ctx: ModuleContext) {
  const userId = ctx.user?.id;

  if (!userId) {
    return {
      ok: false,
      code: 'SHOP_BILLING_AUTH_REQUIRED',
      upgrade: '/zh/login',
    };
  }

  try {
    const subject = { type: 'user' as const, id: userId };
    const charge = await ctx.metering.charge({
      subject,
      meter: 'shop.billing_guard.run',
      quantity: 1,
      unit: 'run',
      credits: { amount: 1 },
      idempotencyKey: `shop-demo:billing-guard:${userId}:${Date.now()}`,
      metadata: { feature: 'billing_guard' },
    });
    return { ok: true, charged: 1, balance: charge.balance, chargeId: charge.id };
  } catch (error) {
    return {
      ok: false,
      code: 'SHOP_BILLING_CREDITS_REQUIRED',
      message: error instanceof Error ? error.message : 'Credits are required.',
      upgrade: '/zh/dashboard/billing',
    };
  }
});
