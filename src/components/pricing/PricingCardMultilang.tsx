/**
 * Pricing Card with Multi-language Support
 *
 * This component demonstrates how to use the langJsonb field
 * for multi-language pricing content.
 *
 * Usage:
 *   <PricingCardMultilang plan={plan} locale="zh-CN" />
 */

'use client';

import { CheckIcon } from 'lucide-react';
import type { EntitlementPlan } from '@/lib/db/schema';

interface PlanTranslation {
  name: string;
  description: string;
  featuresList?: string[];
  buttonText?: string;
  highlightedText?: string;
}

interface PricingCardProps {
  plan: EntitlementPlan & {
    langJsonb?: Record<string, PlanTranslation> | null;
  };
  locale: string;
  isCurrentPlan?: boolean;
  isLoggedIn?: boolean;
  loading?: boolean;
  billingPeriod?: 'monthly' | 'yearly';
  onSubscribe: (planId: string, slug: string) => void;
}

/**
 * Get localized content for a plan
 *
 * Falls back to default content if translation not available
 */
function getPlanContent(plan: PricingCardProps['plan'], locale: string): PlanTranslation {
  // Try to get translation for current locale
  const translation = plan.langJsonb?.[locale];

  if (translation) {
    return translation;
  }

  // Fallback to default content
  return {
    name: plan.name,
    description: '',
    featuresList: extractFeaturesList(plan),
    buttonText: undefined, // Will use default button text
    highlightedText: undefined,
  };
}

/**
 * Extract features list from plan data
 *
 * Handles both array and object formats
 */
function extractFeaturesList(plan: PricingCardProps['plan']): string[] {
  // If features is array, return it
  if (Array.isArray(plan.features)) {
    return plan.features as string[];
  }

  // If features is object, construct feature list
  const features: string[] = [];
  const limits = (plan.limits || {}) as { monthly?: Record<string, number> };
  const monthlyLimits = limits.monthly || {};
  const callsPerMonth = monthlyLimits['runlynk.calls'];

  // Add quota information
  if (typeof callsPerMonth === 'number') {
    features.push(
      callsPerMonth === -1 ? 'Unlimited API calls' : `${callsPerMonth} API calls per month`
    );
  }

  // Add other features (extract from features object)
  if (typeof plan.features === 'object' && plan.features) {
    Object.entries(plan.features).forEach(([key, value]) => {
      if (value === true) {
        // Convert camelCase to readable text
        const readable = key.replace(/([A-Z])/g, ' $1').trim();
        features.push(readable);
      } else if (typeof value === 'string') {
        features.push(value);
      }
    });
  }

  return features.length > 0 ? features : ['Access to all tools'];
}

/**
 * Get price for current billing period
 */
function getPrice(plan: PricingCardProps['plan'], billingPeriod: 'monthly' | 'yearly'): number {
  const pricing = (plan.pricing || {}) as { monthly?: number; yearly?: number };

  return pricing[billingPeriod] ?? 0;
}

/**
 * Get button text based on plan and user state
 */
function getButtonText(props: {
  plan: PricingCardProps['plan'];
  content: PlanTranslation;
  isCurrentPlan: boolean;
  isLoggedIn: boolean;
  loading: boolean;
  locale: string;
}): React.ReactNode {
  const { plan, content, isCurrentPlan, isLoggedIn, loading, locale } = props;

  // Loading state
  if (loading) {
    return (
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
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
        {locale === 'zh-CN' ? '处理中...' : 'Processing...'}
      </span>
    );
  }

  // Current plan
  if (isCurrentPlan) {
    return locale === 'zh-CN' ? '当前计划' : 'Current Plan';
  }

  // Free plan - view dashboard
  if (plan.slug === 'free') {
    return locale === 'zh-CN' ? '免费使用' : 'Start Free';
  }

  // Not logged in
  if (!isLoggedIn) {
    return locale === 'zh-CN' ? '登录后订阅' : 'Login to Subscribe';
  }

  // Use custom button text if available
  if (content.buttonText) {
    return content.buttonText;
  }

  // Default subscribe text
  return locale === 'zh-CN' ? '立即订阅' : 'Subscribe Now';
}

export default function PricingCardMultilang(props: PricingCardProps) {
  const {
    plan,
    locale,
    isCurrentPlan = false,
    isLoggedIn = false,
    loading = false,
    billingPeriod = 'monthly',
    onSubscribe,
  } = props;

  // Get localized content
  const content = getPlanContent(plan, locale);

  // Get price
  const price = getPrice(plan, billingPeriod);

  // Get button text
  const buttonText = getButtonText({
    plan,
    content,
    isCurrentPlan,
    isLoggedIn,
    loading,
    locale,
  });

  // Check if plan is popular/highlighted
  const isPopular = plan.isPopular === true;
  const highlightedText =
    content.highlightedText ||
    (isPopular ? (locale === 'zh-CN' ? '最受欢迎' : 'Most Popular') : undefined);

  return (
    <div
      className={`relative bg-card rounded-lg shadow-lg p-8 border transition-all hover:shadow-xl ${
        isPopular ? 'border-primary ring-2 ring-primary' : 'border-border'
      }`}
    >
      {/* Popular Badge */}
      {highlightedText && (
        <div className="absolute -top-4 left-1/2 -translate-x-1/2">
          <span className="bg-primary text-primary-foreground px-4 py-1 rounded-full text-sm font-semibold shadow-md">
            {highlightedText}
          </span>
        </div>
      )}

      {/* Plan Name */}
      <h3 className="text-2xl font-bold mb-2">{content.name}</h3>

      {/* Plan Description */}
      <p className="text-muted-foreground mb-6">{content.description}</p>

      {/* Price */}
      <div className="mb-6">
        <span className="text-4xl font-bold">${price}</span>
        <span className="text-muted-foreground ml-2">
          /{' '}
          {billingPeriod === 'monthly'
            ? locale === 'zh-CN'
              ? '月'
              : 'month'
            : locale === 'zh-CN'
              ? '年'
              : 'year'}
        </span>
      </div>

      {/* Features List */}
      <ul className="space-y-3 mb-8">
        {content.featuresList?.map((feature, index) => (
          <li key={index} className="flex items-start gap-2">
            <CheckIcon className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
            <span className="text-sm">{feature}</span>
          </li>
        ))}
      </ul>

      {/* Subscribe Button */}
      <button
        onClick={() => onSubscribe(plan.id, plan.slug)}
        disabled={isCurrentPlan || loading}
        className={`w-full py-3 px-4 rounded-lg font-semibold transition-colors ${
          isCurrentPlan
            ? 'bg-muted text-muted-foreground cursor-not-allowed'
            : isPopular
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
        }`}
      >
        {buttonText}
      </button>

      {/* Current Plan Indicator */}
      {isCurrentPlan && (
        <p className="text-center text-sm text-muted-foreground mt-4">
          {locale === 'zh-CN' ? '✓ 您当前的订阅计划' : '✓ Your current subscription'}
        </p>
      )}
    </div>
  );
}

/**
 * Usage Example:
 *
 * ```tsx
 * import PricingCardMultilang from '@/components/pricing/PricingCardMultilang';
 *
 * // In your PricingContent.tsx:
 * const params = useParams();
 * const locale = params.lang as string;
 *
 * return (
 *   <div className="grid md:grid-cols-3 gap-8">
 *     {plans.map((plan) => (
 *       <PricingCardMultilang
 *         key={plan.id}
 *         plan={plan}
 *         locale={locale}
 *         isCurrentPlan={currentSubscription?.planSlug === plan.slug}
 *         isLoggedIn={isLoggedIn}
 *         loading={loading === plan.id}
 *         billingPeriod={billingPeriod}
 *         onSubscribe={handleSubscribe}
 *       />
 *     ))}
 *   </div>
 * );
 * ```
 */
