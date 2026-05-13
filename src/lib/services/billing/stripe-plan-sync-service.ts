import 'server-only';

import { db } from '@/lib/db';
import { entitlementPlans } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getStripe } from '@/lib/stripe/client';

type BillingInterval = 'monthly' | 'yearly';

function toStripeCurrency(currency: string): string {
  return currency.toLowerCase();
}

function toUnitAmount(amount: number): number {
  // Stripe requires integer minor units (e.g., cents).
  return Math.round(amount * 100);
}

function getPlanDescription(
  langJsonb: Record<string, unknown> | null | undefined
): string | undefined {
  const map = langJsonb || {};
  return (
    ((map.en as Record<string, unknown> | undefined)?.description as string | undefined) ||
    ((map.zh as Record<string, unknown> | undefined)?.description as string | undefined) ||
    ((map['zh-CN'] as Record<string, unknown> | undefined)?.description as string | undefined) ||
    undefined
  );
}

export async function syncPlanToStripe(params: { planId: string }) {
  const stripe = getStripe();

  const plan = await db.query.entitlementPlans.findFirst({
    where: eq(entitlementPlans.id, params.planId),
  });
  if (!plan) {
    throw new Error(`Plan not found: ${params.planId}`);
  }
  const planRecord = plan;

  const pricing = (planRecord.pricing as Record<string, unknown>) || {};
  const currency = ((pricing.currency as string | undefined) || 'USD').toUpperCase();
  const monthlyAmount = pricing.monthly as number | undefined;
  const yearlyAmount = pricing.yearly as number | undefined;

  const stripeConfig = (planRecord.stripe as Record<string, unknown>) || {};
  const description = getPlanDescription(
    planRecord.langJsonb as Record<string, unknown> | null | undefined
  );
  const existingProductId = stripeConfig.productId as string | null | undefined;

  // 1) Ensure product exists
  let productId: string;
  if (existingProductId) {
    try {
      const product = await stripe.products.retrieve(existingProductId);
      if (product.deleted) throw new Error('Product deleted');
      productId = product.id;
    } catch {
      const created = await stripe.products.create({
        name: planRecord.name,
        description,
        metadata: { planId: planRecord.id, planSlug: planRecord.slug },
      });
      productId = created.id;
    }
  } else {
    const created = await stripe.products.create({
      name: planRecord.name,
      description,
      metadata: { planId: planRecord.id, planSlug: planRecord.slug },
    });
    productId = created.id;
  }

  const results: { monthly?: string; yearly?: string } = {};

  async function ensurePrice(interval: BillingInterval, amount: number | undefined) {
    if (amount === undefined || amount === null) return;

    const desiredUnitAmount = toUnitAmount(amount);
    const desiredCurrency = toStripeCurrency(currency);
    const recurringInterval = interval === 'monthly' ? 'month' : 'year';

    const currentPriceId =
      interval === 'monthly'
        ? (stripeConfig.priceIdMonthly as string | null | undefined)
        : (stripeConfig.priceIdYearly as string | null | undefined);

    if (currentPriceId) {
      try {
        const current = await stripe.prices.retrieve(currentPriceId);
        if ((current as { deleted?: boolean }).deleted) {
          throw new Error('Deleted price');
        }
        if (
          current.type === 'recurring' &&
          current.recurring?.interval === recurringInterval &&
          current.currency === desiredCurrency &&
          current.unit_amount === desiredUnitAmount
        ) {
          results[interval] = current.id;
          return;
        }
      } catch {
        // fall through to create a new price and remap
      }
    }

    const created = await stripe.prices.create({
      product: productId,
      unit_amount: desiredUnitAmount,
      currency: desiredCurrency,
      recurring: { interval: recurringInterval },
    });

    results[interval] = created.id;
  }

  await ensurePrice('monthly', monthlyAmount);
  await ensurePrice('yearly', yearlyAmount);

  await db
    .update(entitlementPlans)
    .set({
      stripe: {
        ...stripeConfig,
        productId,
        priceIdMonthly:
          results.monthly ?? (stripeConfig.priceIdMonthly as string | null | undefined) ?? null,
        priceIdYearly:
          results.yearly ?? (stripeConfig.priceIdYearly as string | null | undefined) ?? null,
      },
      updatedAt: new Date(),
    })
    .where(eq(entitlementPlans.id, planRecord.id));

  return {
    planId: planRecord.id,
    productId,
    currency,
    prices: results,
  };
}
