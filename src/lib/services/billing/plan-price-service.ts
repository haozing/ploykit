import 'server-only';

import { db } from '@/lib/db';
import { validateStripePriceEnvironment } from '@/lib/stripe/env-guard';

export type BillingInterval = 'monthly' | 'yearly';

export async function getCurrentStripePriceIdForPlan(params: {
  planId: string;
  interval: BillingInterval;
}): Promise<string | null> {
  const plan = await db.query.entitlementPlans.findFirst({
    where: (plans, { eq }) => eq(plans.id, params.planId),
    columns: { stripe: true },
  });

  if (!plan) return null;

  const stripe = (plan.stripe as Record<string, unknown>) || {};
  const stripePriceId =
    params.interval === 'monthly'
      ? (stripe.priceIdMonthly as string | undefined)
      : (stripe.priceIdYearly as string | undefined);

  if (!stripePriceId) return null;
  await validateStripePriceEnvironment(stripePriceId);
  return stripePriceId;
}

export async function getCurrentStripePriceIdsForPlans(params: { planIds: string[] }): Promise<
  Record<
    string,
    {
      monthly?: string;
      yearly?: string;
    }
  >
> {
  if (params.planIds.length === 0) return {};
  const rows = await db.query.entitlementPlans.findMany({
    where: (plans, { inArray: inArrayOp }) => inArrayOp(plans.id, params.planIds),
    columns: { id: true, stripe: true },
  });

  const result: Record<string, { monthly?: string; yearly?: string }> = {};
  for (const row of rows) {
    const stripe = (row.stripe as Record<string, unknown>) || {};
    const monthly = stripe.priceIdMonthly as string | undefined;
    const yearly = stripe.priceIdYearly as string | undefined;

    if (!result[row.id]) result[row.id] = {};
    if (monthly) {
      await validateStripePriceEnvironment(monthly);
      result[row.id].monthly = monthly;
    }
    if (yearly) {
      await validateStripePriceEnvironment(yearly);
      result[row.id].yearly = yearly;
    }
  }

  return result;
}

export async function getPlanForStripePriceId(params: {
  stripePriceId: string;
}): Promise<{ planId: string; interval: BillingInterval } | null> {
  await validateStripePriceEnvironment(params.stripePriceId);

  const plans = await db.query.entitlementPlans.findMany({
    columns: { id: true, stripe: true },
  });

  for (const plan of plans) {
    const stripe = (plan.stripe as Record<string, unknown>) || {};
    if (stripe.priceIdMonthly === params.stripePriceId) {
      return { planId: plan.id, interval: 'monthly' };
    }
    if (stripe.priceIdYearly === params.stripePriceId) {
      return { planId: plan.id, interval: 'yearly' };
    }
  }

  return null;
}
