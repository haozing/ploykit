/**
 * Billing Management Page - Platform Subscription
 *
 * Path: /billing
 * Design Reference: Payment & Subscription System Design Document, Section 5.2
 *
 * Features:
 * - Fetch user subscription information from real API
 * - Display current plan summary
 * - One-click redirect to Stripe customer portal
 */

'use client';

import Link from 'next/link';
import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useTranslations } from 'next-intl';
import { API_KEYS, fetcher, postFetcher } from '@/lib/swr';
import { useToast } from '@/hooks/use-toast';

type PlanTranslation = {
  name?: string;
  description?: string;
  featuresList?: string[];
};

interface Subscription {
  plan: {
    id: string;
    name: string;
    slug: string;
    description: string;
    langJsonb?: Record<string, PlanTranslation> | null;
  };
  status: string;
  isActive: boolean;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  metadata: Record<string, unknown>;
}

interface Order {
  id: string;
  orderType: string;
  amount: string | null;
  currency: string | null;
  status: string;
  createdAt: string;
  plan?: { id: string; name: string; slug: string } | null;
}

interface OrdersResponse {
  orders: Order[];
  count: number;
}

export default function BillingPage() {
  const t = useTranslations('dashboard.billing');
  const params = useParams();
  const lang = useMemo(() => (typeof params.lang === 'string' ? params.lang : 'zh'), [params.lang]);
  const { toast } = useToast();

  // Fetch subscription using SWR
  const {
    data: subscription,
    error: fetchError,
    isLoading: fetchLoading,
  } = useSWR<Subscription | null>(API_KEYS.USER.SUBSCRIPTION, async (url: string) => {
    const response = await fetcher<Subscription>(url).catch((err) => {
      // Return null for 404 (no subscription)
      if (err.status === 404) return null;
      throw err;
    });
    return response;
  });

  // Portal mutation
  const { trigger: openPortal, isMutating: _isPortalLoading } = useSWRMutation(
    API_KEYS.BILLING.PORTAL,
    postFetcher<{ url: string }, { returnUrl?: string }>
  );

  const { data: ordersData } = useSWR<OrdersResponse>(API_KEYS.USER.ORDERS(), fetcher);

  const error = fetchError?.message || null;

  async function _handleManageSubscription() {
    try {
      const returnUrl = `${window.location.origin}/${lang}/billing`;
      const result = await openPortal({ returnUrl });
      if (result?.url) {
        window.location.href = result.url;
      }
    } catch (_error) {
      toast({
        title: t('actions.portalErrorTitle'),
        description: t('actions.portalErrorDescription'),
        variant: 'error',
      });
    }
  }

  //
  // Loading State
  //
  if (fetchLoading) {
    return (
      <div className="container mx-auto max-w-5xl px-4 py-8">
        <div className="animate-pulse">
          <div className="h-8 bg-accent rounded w-1/4 mb-8"></div>
          <div className="h-32 bg-accent rounded mb-6"></div>
          <div className="h-32 bg-accent rounded mb-6"></div>
        </div>
      </div>
    );
  }

  //
  // Error State
  //
  if (error) {
    return (
      <div className="container mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-3xl font-bold mb-8">{t('title')}</h1>
        <div className="bg-destructive-50 border border-destructive rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-2 text-destructive-foreground">
            {t('error.title')}
          </h2>
          <p className="text-destructive mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="bg-destructive text-white px-4 py-2 rounded hover:bg-red-700"
          >
            {t('error.reload')}
          </button>
        </div>
      </div>
    );
  }

  //
  // No Subscription State
  //
  if (!subscription) {
    return (
      <div className="container mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-3xl font-bold mb-8">{t('title')}</h1>
        <div className="bg-warning-50 border border-warning rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-2">{t('noSubscription.title')}</h2>
          <p className="text-foreground mb-4">{t('noSubscription.description')}</p>
          <Link
            href={`/${lang}/pricing`}
            className="inline-block bg-primary text-white px-6 py-2 rounded-lg hover:bg-primary"
          >
            {t('noSubscription.button')}
          </Link>
        </div>
      </div>
    );
  }

  // Format date
  const planName = (() => {
    const map = subscription.plan.langJsonb || undefined;
    if (!map) return subscription.plan.name;
    const translation =
      map[lang] || (lang.startsWith('zh') ? map.zh || map['zh-CN'] : map.en) || map.zh || map.en;
    return translation?.name || subscription.plan.name;
  })();

  const periodEndDate = subscription.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US')
    : subscription.plan.slug === 'free'
      ? t('currentPlan.lifetime')
      : t('currentPlan.expiryUnknown');

  //
  //
  //
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">{t('title')}</h1>

      {/* Current Plan */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t('currentPlan.title')}</CardTitle>
          <CardDescription>{t('currentPlan.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground mb-1">{t('currentPlan.planName')}</p>
              <p className="text-lg font-semibold">{planName}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">{t('currentPlan.nextRenewal')}</p>
              <p className="text-lg">{periodEndDate}</p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {subscription.stripeCustomerId ? (
              <Button onClick={_handleManageSubscription} variant="outline">
                {t('actions.manageSubscription')}
              </Button>
            ) : null}
            <Button asChild>
              <Link href={`/${lang}/pricing`}>{t('actions.changePlan')}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Purchase Records */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t('records.title')}</CardTitle>
          <CardDescription>{t('records.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/${lang}/billing/orders`}>{t('actions.viewAllOrders')}</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/${lang}/billing/credit-history`}>{t('actions.viewCreditHistory')}</Link>
            </Button>
          </div>
          {!ordersData?.orders?.length ? (
            <div className="text-sm text-muted-foreground">{t('records.empty')}</div>
          ) : (
            <div className="space-y-3">
              {ordersData.orders.map((order) => {
                const date = new Date(order.createdAt).toLocaleDateString(
                  lang === 'zh' ? 'zh-CN' : 'en-US'
                );
                const amount = order.amount ? Number(order.amount) : 0;
                const formattedAmount = new Intl.NumberFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
                  style: 'currency',
                  currency: 'USD',
                  maximumFractionDigits: 2,
                }).format(amount);

                return (
                  <div key={order.id} className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {order.plan?.name || order.orderType}
                      </div>
                      <div className="text-xs text-muted-foreground">{date}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium whitespace-nowrap">
                        {formattedAmount}
                      </span>
                      <Badge variant="secondary" className="whitespace-nowrap">
                        {order.status}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
