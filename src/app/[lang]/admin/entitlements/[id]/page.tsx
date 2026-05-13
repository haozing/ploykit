'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Crown, Edit, Users, Check, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiFetch } from '@/lib/shared/auth-client';
import type { PlanWithSubscribers } from '@/hooks/use-entitlements';

/**
 * Plan Detail Page
 *
 * Shows detailed information about a subscription plan:
 * - Plan info and pricing
 * - Features and limits
 * - Subscriber count
 * - Configuration details
 */
export default function PlanDetailPage() {
  const params = useParams();
  const planId = params.id as string;
  const lang = params.lang as string;

  const [plan, setPlan] = useState<PlanWithSubscribers | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPlanDetails = async () => {
      try {
        setLoading(true);
        const response = await apiFetch(`/api/admin/entitlements/plans/${planId}`);

        if (!response.ok) {
          throw new Error('Failed to fetch plan details');
        }

        const result = await response.json();

        if (result.success && result.data) {
          setPlan(result.data);
        } else {
          throw new Error(result.error || 'Failed to load plan');
        }
      } catch (error) {
        console.error('Error fetching plan:', error);
        setError(error instanceof Error ? error.message : 'Failed to load plan');
      } finally {
        setLoading(false);
      }
    };

    fetchPlanDetails();
  }, [planId]);

  const formatPrice = () => {
    if (!plan) return 'Free';
    const pricing = plan.pricing || {};
    const billingInterval = plan.pricing?.monthly ? 'monthly' : 'yearly';
    const price = pricing[billingInterval] ?? 0;
    if (price === 0) return 'Free';

    const formatted = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: pricing.currency || 'USD',
      minimumFractionDigits: 0,
    }).format(price);
    return `${formatted}/${billingInterval === 'monthly' ? 'mo' : 'yr'}`;
  };

  const formatLimit = (value: number | undefined, unit?: string) => {
    if (!value) return '0';
    if (value === -1) return 'Unlimited';
    if (unit === 'storage') {
      if (value >= 1000) return `${value / 1000}GB`;
      return `${value}MB`;
    }
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
    return value.toString();
  };

  const getLocalizedDescription = () => {
    if (!plan) return '';
    const langJsonb = (plan.langJsonb || {}) as Record<string, Record<string, unknown> | undefined>;
    const direct = langJsonb[lang];
    const zh = langJsonb.zh || langJsonb['zh-CN'];
    const en = langJsonb.en;
    const localized = direct || (lang.startsWith('zh') ? zh : en) || zh || en;
    return (localized?.description as string | undefined) || '';
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Loading plan details...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !plan) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" asChild>
          <Link href={`/${lang}/admin/entitlements`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Plans
          </Link>
        </Button>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <p className="text-destructive">{error || 'Plan not found'}</p>
              <Button asChild>
                <Link href={`/${lang}/admin/entitlements`}>Return to Plans</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back Button */}
      <Button variant="ghost" asChild>
        <Link href={`/${lang}/admin/entitlements`}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Plans
        </Link>
      </Button>

      {/* Plan Header */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-6 md:flex-row md:items-start">
            {/* Icon */}
            <div className="flex h-24 w-24 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Crown className="h-12 w-12" />
            </div>

            {/* Plan Info */}
            <div className="flex-1 space-y-4">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-3xl font-bold">{plan.name}</h1>
                  <Badge variant={plan.isActive ? 'default' : 'secondary'}>
                    {plan.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                  {plan.isDefault && <Badge variant="outline">Default</Badge>}
                </div>
                {getLocalizedDescription() && (
                  <p className="mt-2 text-muted-foreground">{getLocalizedDescription()}</p>
                )}
                <div className="mt-4 flex items-baseline gap-2">
                  <span className="text-4xl font-bold">{formatPrice()}</span>
                  {(plan.pricing?.monthly || plan.pricing?.yearly) && (
                    <span className="text-sm text-muted-foreground">
                      per {plan.pricing?.monthly ? 'month' : 'year'}
                    </span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <Button asChild>
                  <Link href={`/${lang}/admin/entitlements`}>
                    <Edit className="mr-2 h-4 w-4" />
                    Edit Plan
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href={`/${lang}/admin/entitlements`}>
                    <Users className="mr-2 h-4 w-4" />
                    View Subscribers
                  </Link>
                </Button>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-4 md:w-64">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Subscribers</p>
                <p className="text-2xl font-bold">{plan.subscriberCount}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Status</p>
                <p className="text-2xl font-bold">{plan.isActive ? 'Active' : 'Inactive'}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="features" className="space-y-4">
        <TabsList>
          <TabsTrigger value="features">Features & Limits</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        {/* Features & Limits Tab */}
        <TabsContent value="features" className="space-y-4">
          {/* Features Card */}
          {plan.features && Object.keys(plan.features).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Features</CardTitle>
                <CardDescription>All available features in this plan</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {Object.entries(plan.features).map(([key, enabled]) => (
                    <div key={key} className="flex items-start gap-3 pb-4 border-b last:border-b-0">
                      {enabled ? (
                        <Check className="h-5 w-5 text-success flex-shrink-0 mt-0.5" />
                      ) : (
                        <X className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1">
                        <p className="font-medium capitalize">
                          {key.replace(/([A-Z])/g, ' $1').trim()}
                        </p>
                      </div>
                      <Badge variant={enabled ? 'default' : 'secondary'}>
                        {enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Limits Card */}
          {plan.limits && Object.keys(plan.limits).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Resource Limits</CardTitle>
                <CardDescription>Usage quotas and restrictions</CardDescription>
              </CardHeader>
              <CardContent>
                {(() => {
                  const limits = (plan.limits as unknown as Record<string, unknown>) || {};
                  const monthly = (limits.monthly as Record<string, number> | undefined) || {};
                  const yearly = (limits.yearly as Record<string, number> | undefined) || {};

                  const groups: Array<{ label: string; data: Record<string, number> }> = [
                    { label: 'Monthly', data: monthly },
                    { label: 'Yearly', data: yearly },
                  ];

                  return (
                    <div className="space-y-6">
                      {groups.map((group) => {
                        const entries = Object.entries(group.data);
                        if (entries.length === 0) return null;
                        return (
                          <div key={group.label} className="space-y-3">
                            <div className="text-sm font-semibold">{group.label}</div>
                            <div className="space-y-4">
                              {entries.map(([key, value]) => (
                                <div
                                  key={`${group.label}:${key}`}
                                  className="flex items-start justify-between pb-4 border-b last:border-b-0"
                                >
                                  <div>
                                    <p className="font-medium font-mono">{key}</p>
                                  </div>
                                  <Badge variant="outline" className="font-mono">
                                    {formatLimit(
                                      value,
                                      key.includes('storage') ? 'storage' : undefined
                                    )}
                                  </Badge>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Plan Settings</CardTitle>
              <CardDescription>Configuration and metadata</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Plan Slug</h4>
                <p className="text-sm text-muted-foreground font-mono">{plan.slug}</p>
              </div>

              <Separator />

              <div className="space-y-2">
                <h4 className="text-sm font-medium">Sort Order</h4>
                <p className="text-sm text-muted-foreground">{plan.sortOrder}</p>
              </div>

              <Separator />

              <div className="space-y-2">
                <h4 className="text-sm font-medium">Created</h4>
                <p className="text-sm text-muted-foreground">
                  {new Date(plan.createdAt).toLocaleString()}
                </p>
              </div>

              <Separator />

              <div className="space-y-2">
                <h4 className="text-sm font-medium">Last Updated</h4>
                <p className="text-sm text-muted-foreground">
                  {new Date(plan.updatedAt).toLocaleString()}
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
