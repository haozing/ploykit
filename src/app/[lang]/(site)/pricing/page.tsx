/**
 * 定价页面 - 平台级Subscription
 *
 * Path: /[lang]/pricing
 * 设计方案参考：PaymentSubscriptionSystem设计方案.md 第5.1节
 *
 * 🆕 架构：
 * - Server Component wrapper with ShellLayout
 * - Client Component (PricingContent) for interactive features
 * - Ensures consistent layout with other frontend pages (about, contact)
 */

import { ShellLayout } from '@/components/layouts/ShellLayout';
import { HostPageSlotBoundary } from '@/components/HostPageSurfaceRenderer';
import { getTranslations } from 'next-intl/server';
import { createSitePageMetadata } from '@/lib/seo/site-metadata';
import { createHostPageOverrideMetadata } from '@/lib/plugin-runtime/seo';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { entitlementPlans } from '@/lib/db/schema';
import PricingContent, { type PricingPlan } from './PricingContent';

export const dynamic = 'force-dynamic';

interface PricingPageProps {
  params: Promise<{ lang: string }>;
}

export async function generateMetadata({ params }: PricingPageProps) {
  const { lang } = await params;
  const overrideMetadata = await createHostPageOverrideMetadata({ path: '/pricing', locale: lang });
  if (overrideMetadata) {
    return overrideMetadata;
  }

  const t = await getTranslations('pricing');

  return createSitePageMetadata({
    locale: lang,
    path: '/pricing',
    title: t('hero.title'),
    description: t('hero.subtitle'),
  });
}

async function getPricingPlans(): Promise<PricingPlan[]> {
  const plans = await db.query.entitlementPlans.findMany({
    where: eq(entitlementPlans.isActive, true),
    orderBy: (plans, { asc }) => [asc(plans.sortOrder)],
  });

  return plans.map((plan) => {
    const pricing = (plan.pricing as Record<string, unknown>) || {};
    const pricingMonthly = typeof pricing.monthly === 'number' ? pricing.monthly : undefined;
    const pricingYearly = typeof pricing.yearly === 'number' ? pricing.yearly : undefined;
    const pricingCurrency =
      typeof pricing.currency === 'string' && pricing.currency.trim() ? pricing.currency : 'USD';

    return {
      id: plan.id,
      name: plan.name,
      slug: plan.slug,
      pricing: {
        currency: pricingCurrency,
        monthly: pricingMonthly ?? 0,
        yearly: pricingYearly,
      },
      langJsonb: plan.langJsonb as PricingPlan['langJsonb'],
      isPopular: plan.isPopular || false,
    };
  });
}

export default async function PricingPage({ params }: PricingPageProps) {
  const { lang } = await params;
  const plans = await getPricingPlans();

  return (
    <ShellLayout pathname="/pricing" locale={lang}>
      <PricingContent
        lang={lang}
        plans={plans}
        heroBefore={
          <HostPageSlotBoundary
            pathname="/pricing"
            position="hero.before"
            locale={lang}
            className="mb-8"
          />
        }
        heroAfter={
          <HostPageSlotBoundary
            pathname="/pricing"
            position="hero.after"
            locale={lang}
            className="mb-12"
          />
        }
      />
    </ShellLayout>
  );
}
