'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from '@/lib/auth/client';
import { useTranslations } from 'next-intl';

type PlanTranslation = {
  name?: string;
  description?: string;
  featuresList?: string[];
};

interface Plan {
  id: string;
  name: string;
  slug: string;
  priceMonthly?: number;
  priceYearly?: number | null;
  currency?: string;
  pricing?: {
    currency?: string;
    monthly?: number;
    yearly?: number;
    [key: string]: unknown;
  };
  features: unknown; // capabilities (machine enforced)
  limits: Record<string, unknown>; // quotas (not displayed on pricing page)
  langJsonb?: Record<string, PlanTranslation> | null;
  isPopular?: boolean;
  stripePriceIdMonthly?: string;
  stripePriceIdYearly?: string;
  isDefault?: boolean;
}

export default function PricingContent() {
  const router = useRouter();
  const params = useParams();
  const t = useTranslations('pricing');
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [loading, setLoading] = useState<string | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [currentSubscription, setCurrentSubscription] = useState<{
    planSlug: string;
    status: string;
    isActive: boolean;
  } | null>(null);

  const { data: session } = useSession();
  const isLoggedIn = !!session?.user;
  const lang = useMemo(() => (typeof params.lang === 'string' ? params.lang : 'zh'), [params.lang]);

  useEffect(() => {
    async function fetchPlans() {
      try {
        const response = await fetch('/api/plans');
        if (!response.ok) {
          throw new Error(t('errors.fetchPlans'));
        }
        const data = (await response.json()) as Plan[];
        setPlans(data);
      } catch (error) {
        console.error('Failed to fetch plans:', error);
      }
    }

    void fetchPlans();
  }, [t]);

  useEffect(() => {
    async function fetchSubscription() {
      if (!isLoggedIn) {
        setCurrentSubscription(null);
        return;
      }

      try {
        const response = await fetch('/api/user/subscription');
        if (response.ok) {
          const data = await response.json();
          setCurrentSubscription({
            planSlug: data.plan.slug,
            status: data.status,
            isActive: data.isActive,
          });
        } else if (response.status === 404) {
          setCurrentSubscription(null);
        }
      } catch (error) {
        console.error('Failed to fetch subscription:', error);
        setCurrentSubscription(null);
      }
    }

    void fetchSubscription();
  }, [isLoggedIn]);

  async function handleSubscribe(planId: string, slug: string) {
    if (!isLoggedIn) {
      const callbackUrl = `/${lang}/pricing`;
      router.push(`/${lang}/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
      return;
    }

    if (slug === 'free') {
      router.push(`/${lang}/billing`);
      return;
    }

    setLoading(planId);

    try {
      const response = await fetch('/api/checkout/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId,
          billingPeriod,
          lang,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || t('errors.checkout'));
      }

      const { url } = await response.json();
      window.location.href = url;
    } catch (error) {
      alert(
        `${t('errors.subscribeFailed')}: ${
          error instanceof Error ? error.message : t('errors.unknown')
        }`
      );
      setLoading(null);
    }
  }

  function isCurrentPlan(planSlug: string): boolean {
    return currentSubscription?.planSlug === planSlug && currentSubscription?.isActive;
  }

  function getPrice(plan: Plan): number {
    const pricing = plan.pricing || {};
    const monthlyAmount = pricing.monthly;
    const yearlyAmount = pricing.yearly;

    const fallbackMonthly = typeof plan.priceMonthly === 'number' ? plan.priceMonthly : 0;
    const fallbackYearly = typeof plan.priceYearly === 'number' ? plan.priceYearly : null;

    if (billingPeriod === 'monthly') {
      return typeof monthlyAmount === 'number' ? monthlyAmount : fallbackMonthly;
    }

    if (typeof yearlyAmount === 'number') return yearlyAmount;
    if (typeof fallbackYearly === 'number') return fallbackYearly;
    return fallbackMonthly * 10;
  }

  function getCurrency(_plan: Plan): string {
    return 'USD';
  }

  function formatMoney(amount: number, currency: string): string {
    return new Intl.NumberFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }

  function getDisplayTranslation(plan: Plan): PlanTranslation | undefined {
    const map = plan.langJsonb || undefined;
    if (!map) return undefined;
    return (
      map[lang] ||
      (lang.startsWith('zh') ? map['zh'] || map['zh-CN'] : map['en']) ||
      map['zh'] ||
      map['en']
    );
  }

  function getFeaturesList(plan: Plan): string[] {
    const translation = getDisplayTranslation(plan);
    if (translation?.featuresList?.length) {
      return translation.featuresList;
    }
    return [t('plans.noFeatureDetails')];
  }

  return (
    <div className="py-12">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4">{t('hero.title')}</h1>
          <p className="text-xl text-muted-foreground">{t('hero.subtitle')}</p>
          {!isLoggedIn && <p className="text-sm text-primary mt-2">{t('hero.loginTip')}</p>}
        </div>

        <div className="flex justify-center mb-12">
          <div className="bg-muted rounded-lg p-1 inline-flex">
            <button
              onClick={() => setBillingPeriod('monthly')}
              className={`px-6 py-2 rounded-md transition-colors ${
                billingPeriod === 'monthly'
                  ? 'bg-card shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('billingPeriod.monthly')}
            </button>
            <button
              onClick={() => setBillingPeriod('yearly')}
              className={`px-6 py-2 rounded-md transition-colors ${
                billingPeriod === 'yearly'
                  ? 'bg-card shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('billingPeriod.yearly')}{' '}
              <span className="text-success font-semibold">{t('billingPeriod.yearlySave')}</span>
            </button>
          </div>
        </div>

        {plans.length === 0 ? (
          <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-card rounded-lg shadow-lg p-8 border border-border animate-pulse"
              >
                <div className="h-8 bg-muted rounded w-3/4 mb-4"></div>
                <div className="h-4 bg-muted rounded w-full mb-6"></div>
                <div className="h-12 bg-muted rounded w-1/2 mb-6"></div>
                <div className="space-y-3 mb-8">
                  {[1, 2, 3, 4, 5].map((j) => (
                    <div key={j} className="flex items-start gap-2">
                      <div className="h-4 w-4 bg-muted rounded-full flex-shrink-0 mt-0.5"></div>
                      <div className="h-4 bg-muted rounded flex-1"></div>
                    </div>
                  ))}
                </div>
                <div className="h-12 bg-muted rounded w-full"></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {plans.map((plan) => {
              const translation = getDisplayTranslation(plan);
              const displayName = translation?.name || plan.name;
              const displayDescription = translation?.description || '';

              const features = getFeaturesList(plan);
              const currency = getCurrency(plan);
              const amount = getPrice(plan);
              const isCurrent = isCurrentPlan(plan.slug);
              const isFree = amount === 0 || plan.slug === 'free';
              const buttonText =
                loading === plan.id ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    {t('cta.processing')}
                  </span>
                ) : isCurrent ? (
                  t('cta.current')
                ) : plan.slug === 'free' ? (
                  t('cta.free')
                ) : (
                  t('cta.subscribe')
                );

              return (
                <div
                  key={plan.id}
                  className={`bg-card rounded-lg p-8 relative transition-all duration-300 ${
                    plan.isPopular
                      ? 'border-2 border-primary scale-105 shadow-2xl shadow-primary/20 ring-4 ring-primary/10'
                      : 'border border-border shadow-lg hover:shadow-2xl hover:scale-[1.02]'
                  }`}
                >
                  {plan.isPopular && (
                    <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                      <span className="bg-primary text-white px-4 py-1 rounded-full text-sm font-semibold">
                        {t('badges.popular')}
                      </span>
                    </div>
                  )}

                  <div className="mb-6">
                    <h2 className="text-2xl font-bold mb-2">{displayName}</h2>
                    <p className="text-muted-foreground">{displayDescription}</p>
                  </div>

                  <div className="mb-6">
                    <div className="flex items-baseline">
                      <span className="text-4xl font-bold">
                        {isFree ? t('price.free') : formatMoney(amount, currency)}
                      </span>
                      {!isFree && (
                        <span className="text-muted-foreground ml-2">
                          /{billingPeriod === 'monthly' ? t('unit.month') : t('unit.year')}
                        </span>
                      )}
                    </div>
                  </div>

                  <ul className="mb-8 space-y-3">
                    {features.map((feature, index) => (
                      <li key={index} className="flex items-start">
                        <span className="text-success mr-2 text-lg">*</span>
                        <span className="text-foreground">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <button
                    onClick={() => handleSubscribe(plan.id, plan.slug)}
                    disabled={loading === plan.id || isCurrent}
                    className={`w-full py-3 rounded-lg font-semibold transition-all duration-200 ${
                      isCurrent
                        ? 'bg-primary/20 text-primary/60 cursor-not-allowed'
                        : plan.isPopular
                          ? 'bg-gradient-to-r from-primary to-primary-600 text-white hover:from-primary-600 hover:to-primary-700 hover:scale-[1.02] shadow-lg hover:shadow-xl disabled:opacity-30'
                          : 'bg-gradient-to-r from-primary to-primary-600 text-white hover:from-primary-600 hover:to-primary-700 hover:scale-[1.02] shadow-md hover:shadow-lg disabled:opacity-30'
                    } disabled:cursor-not-allowed disabled:hover:scale-100`}
                  >
                    {buttonText}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="text-center mt-12 text-muted-foreground">
          <p className="mb-2">{t('footer.coreFeatures')}</p>
          <p>
            {t('footer.questions')}{' '}
            <Link href="/contact" className="text-primary hover:underline">
              {t('footer.contact')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
